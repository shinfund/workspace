import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

const DBS = [
  { key: 'monthly',     id: 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69', label: '월간점검DB',     suffix: '월간점검결과표' },
  { key: 'elec',        id: '8c447abd-4a95-4b07-ba6c-1bdf7c53872f', label: '전기설비기록1DB', suffix: '전기설비점검결과기록표' },
  { key: 'elec2',       id: '1adf636e-efc7-429f-a4b0-fbfa531a5a41', label: '전기설비기록2DB', suffix: '측정값' },
  { key: 'elec3',       id: '48bed518-8009-4b24-ad4c-28e30ac12d80', label: '전기설비기록3DB', suffix: '점검내역' },
  { key: 'transformer', id: '998fab1e-2d5c-4cae-a6aa-55a131931546', label: '변압기온도DB',    suffix: '변압기온도측정표' },
  { key: 'generator',   id: 'c778d924-49a9-4c44-b444-681ebeb166e1', label: '발전기점검1DB',   suffix: '발전기운전' },
  { key: 'generator2',  id: '3a359c8c-9c0a-804f-8857-f1c2cbdeb4af', label: '발전기점검2DB',   suffix: '유류사용량' },
  { key: 'generator3',  id: '19f4f433-846e-4b99-a993-7eeb7c4b1fa8', label: '발전기점검3DB',   suffix: '점검사항' },
  { key: 'photo',       id: '60f5cbbf-54e4-465e-8901-af41ba515dd0', label: '점검사진DB',      suffix: '점검사진' },
  { key: 'power',       id: '10bfd710-9afb-4b06-b6c2-7943da777956', label: '전력사용량DB',    suffix: '전력사용량' },
  { key: 'task',        id: '125ebd28-64c9-4a9a-b265-e0ab6ed4f21f', label: '업무처리DB',      suffix: '업무처리사항' },
];

const TUNNEL_PREFIXES = ['청하터널(주)', '청하터널(부)', '남정5터널', '흥해터널', '청하터널']
  .sort((a, b) => b.length - a.length);

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

function getTunnelSelect(page) {
  const prop = page.properties['터널명'];
  if (!prop || prop.type !== 'select') return null;
  return prop.select ? prop.select.name : null;
}

function stripPrefix(title) {
  for (const t of TUNNEL_PREFIXES) {
    if (title.startsWith(t)) return title.slice(t.length).replace(/^\s+/, '');
  }
  return null;
}

async function processDb(db) {
  const pages = await queryAll(db.id);
  const toUpdate = [];
  const unmatched = [];
  for (const p of pages) {
    const title = getTitleText(p);
    if (title == null) continue;
    let stripped = stripPrefix(title);
    if ((stripped == null || !stripped) && getTunnelSelect(p)) {
      // 인코딩 깨짐 등으로 접두어 매칭 실패했지만 터널명 속성값이 있으면
      // DB별 고정 접미어로 바로 교체(어차피 터널명 부분은 삭제 대상이라 복구 불필요)
      stripped = db.suffix;
    }
    if (stripped == null || !stripped || stripped === title) { unmatched.push({ id: p.id, title }); continue; }
    toUpdate.push({ id: p.id, oldTitle: title, newTitle: stripped });
  }

  console.log(`\n[${db.label}] 총 ${pages.length}건 / 변경대상 ${toUpdate.length}건 / 매칭실패(수동확인필요) ${unmatched.length}건`);
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

  return { label: db.label, total: pages.length, toUpdate: toUpdate.length, unmatched };
}

(async () => {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }
  const summary = [];
  for (const db of DBS) summary.push(await processDb(db));
  console.log('\n=== 전체 요약 ===');
  let totalChange = 0, totalUnmatched = 0;
  summary.forEach(s => { console.log(`${s.label}: 총 ${s.total} / 변경 ${s.toUpdate} / 매칭실패 ${s.unmatched.length}`); totalChange += s.toUpdate; totalUnmatched += s.unmatched.length; });
  console.log(`\n변경 대상 합계: ${totalChange}건 / 매칭실패 합계: ${totalUnmatched}건`);
  if (totalUnmatched) {
    const fs = await import('node:fs');
    const rows = summary.flatMap(s => s.unmatched.map(u => ({ db: s.label, ...u })));
    fs.writeFileSync('scripts/_tmp_unmatched_titles.json', JSON.stringify(rows, null, 2), 'utf8');
    console.log('매칭실패 상세는 scripts/_tmp_unmatched_titles.json 참고');
  }
  if (!APPLY) console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
})();
