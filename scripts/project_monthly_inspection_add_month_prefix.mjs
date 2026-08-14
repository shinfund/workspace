import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

// 1단계(터널명 접두어 삭제) 이후, "제목"에 레코드 자신의 날짜 필드 기준 "YYYY년 M월 " 접두어를 붙인다.
const DBS = [
  { key: 'monthly',     id: 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69', label: '월간점검DB',     dateKey: '점검일자' },
  { key: 'elec',        id: '8c447abd-4a95-4b07-ba6c-1bdf7c53872f', label: '전기설비기록1DB', dateKey: '점검일자' },
  { key: 'elec2',       id: '1adf636e-efc7-429f-a4b0-fbfa531a5a41', label: '전기설비기록2DB', dateKey: '점검일자' },
  { key: 'elec3',       id: '48bed518-8009-4b24-ad4c-28e30ac12d80', label: '전기설비기록3DB', dateKey: '점검일자' },
  { key: 'transformer', id: '998fab1e-2d5c-4cae-a6aa-55a131931546', label: '변압기온도DB',    dateKey: '측정일자' },
  { key: 'generator',   id: 'c778d924-49a9-4c44-b444-681ebeb166e1', label: '발전기점검1DB',   dateKey: '가동일자' },
  { key: 'generator2',  id: '3a359c8c-9c0a-804f-8857-f1c2cbdeb4af', label: '발전기점검2DB',   dateKey: '가동일자' },
  { key: 'generator3',  id: '19f4f433-846e-4b99-a993-7eeb7c4b1fa8', label: '발전기점검3DB',   dateKey: '가동일자' },
  { key: 'photo',       id: '60f5cbbf-54e4-465e-8901-af41ba515dd0', label: '점검사진DB',      dateKey: '일자' },
  { key: 'power',       id: '10bfd710-9afb-4b06-b6c2-7943da777956', label: '전력사용량DB',    dateKey: '일자' },
  { key: 'task',        id: '125ebd28-64c9-4a9a-b265-e0ab6ed4f21f', label: '업무처리DB',      dateKey: '날짜' },
];

const MONTH_PREFIX_RE = /^\d{4}년\s*\d{1,2}월\s/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: endpoint, method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 5) return reject(new Error('Rate limit exceeded'));
            await sleep(parseInt(res.headers['retry-after'] || '2') * 1000);
            resolve(await notionRequest(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          else resolve(json);
        } catch (e) { reject(new Error(`Parse error: ${d.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function queryAll(dbId) {
  const pages = [];
  let cursor;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notionRequest('POST', `/v1/databases/${dbId}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
    await sleep(DELAY_MS);
  }
  return pages;
}

function getTitleText(page) {
  const prop = page.properties['제목'];
  if (!prop || prop.type !== 'title') return null;
  return (prop.title || []).map(t => t.plain_text).join('');
}
function getDateStart(page, dateKey) {
  const prop = page.properties[dateKey];
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start ? prop.date.start.slice(0, 10) : null;
}

async function processDb(db) {
  const pages = await queryAll(db.id);
  const toUpdate = [];
  const noDate = [];
  for (const p of pages) {
    const title = getTitleText(p);
    if (title == null) continue;
    if (MONTH_PREFIX_RE.test(title)) continue; // 이미 처리됨(재실행 안전)
    const dateStart = getDateStart(p, db.dateKey);
    if (!dateStart) { noDate.push({ id: p.id, title }); continue; }
    const year = dateStart.slice(0, 4);
    const month = parseInt(dateStart.slice(5, 7), 10);
    const newTitle = `${year}년 ${month}월 ${title}`;
    toUpdate.push({ id: p.id, oldTitle: title, newTitle });
  }

  console.log(`\n[${db.label}] 총 ${pages.length}건 / 변경대상 ${toUpdate.length}건 / 날짜없음(수동확인필요) ${noDate.length}건`);
  toUpdate.slice(0, 3).forEach(u => console.log(`  예시: "${u.oldTitle}" -> "${u.newTitle}"`));

  if (APPLY && toUpdate.length) {
    let done = 0, errors = 0;
    let idx = 0;
    async function worker() {
      while (idx < toUpdate.length) {
        const cur = toUpdate[idx++];
        try {
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, {
            properties: { '제목': { title: [{ text: { content: cur.newTitle } }] } }
          });
          done++;
        } catch (e) {
          errors++;
          console.log(`  오류 ${cur.id}: ${e.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`[${db.label}] 적용 완료: ${done}건, 오류 ${errors}건`);
  }

  return { label: db.label, total: pages.length, toUpdate: toUpdate.length, noDate };
}

(async () => {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }
  const summary = [];
  for (const db of DBS) summary.push(await processDb(db));
  console.log('\n=== 전체 요약 ===');
  let totalChange = 0, totalNoDate = 0;
  summary.forEach(s => { console.log(`${s.label}: 총 ${s.total} / 변경 ${s.toUpdate} / 날짜없음 ${s.noDate.length}`); totalChange += s.toUpdate; totalNoDate += s.noDate.length; });
  console.log(`\n변경 대상 합계: ${totalChange}건 / 날짜없음 합계: ${totalNoDate}건`);
  if (totalNoDate) {
    const fs = await import('node:fs');
    const rows = summary.flatMap(s => s.noDate.map(u => ({ db: s.label, ...u })));
    fs.writeFileSync('scripts/_tmp_no_date_titles.json', JSON.stringify(rows, null, 2), 'utf8');
    console.log('날짜없음 상세는 scripts/_tmp_no_date_titles.json 참고');
  }
  if (!APPLY) console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
})();
