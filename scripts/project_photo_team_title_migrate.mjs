import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

// 점검팀사진DB: "제목" 원래 내용을 "사진설명"으로 옮기고, "제목"은 "일자" 기준 "YYYY년 M월 점검사진"으로 통일
const DB_ID = '83a945c6-79fe-4f2b-87e6-2ceef9557d0a';
const DB_LABEL = '점검팀사진DB';
const DATE_KEY = '일자';

const TITLE_FORMAT_RE = /^\d{4}년\s*\d{1,2}월\s점검사진$/;

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
function getRichText(page, key) {
  const prop = page.properties[key];
  if (!prop || prop.type !== 'rich_text') return null;
  return (prop.rich_text || []).map(t => t.plain_text).join('');
}
function getDateStart(page, dateKey) {
  const prop = page.properties[dateKey];
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start ? prop.date.start.slice(0, 10) : null;
}

async function main() {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

  const pages = await queryAll(DB_ID);
  const toUpdate = [];
  const noDate = [];
  const alreadyDone = [];

  for (const p of pages) {
    const title = getTitleText(p);
    if (title == null) continue;
    if (TITLE_FORMAT_RE.test(title)) { alreadyDone.push(p.id); continue; } // 재실행 안전
    const dateStart = getDateStart(p, DATE_KEY);
    if (!dateStart) { noDate.push({ id: p.id, title }); continue; }
    const year = dateStart.slice(0, 4);
    const month = parseInt(dateStart.slice(5, 7), 10);
    const newTitle = `${year}년 ${month}월 점검사진`;
    const existingDesc = getRichText(p, '사진설명');
    toUpdate.push({ id: p.id, oldTitle: title, newTitle, existingDesc });
  }

  console.log(`[${DB_LABEL}] 총 ${pages.length}건 / 변경대상 ${toUpdate.length}건 / 이미처리 ${alreadyDone.length}건 / 날짜없음 ${noDate.length}건`);
  toUpdate.slice(0, 5).forEach(u => console.log(`  예시: 제목 "${u.oldTitle}" -> "${u.newTitle}" / 사진설명 <- "${u.oldTitle}"${u.existingDesc ? ` (기존 사진설명 "${u.existingDesc}" 덮어씀)` : ''}`));
  const withExistingDesc = toUpdate.filter(u => u.existingDesc);
  if (withExistingDesc.length) {
    console.log(`  ⚠ 사진설명에 기존 값이 있는 레코드 ${withExistingDesc.length}건 (제목 값으로 덮어씀)`);
  }
  if (noDate.length) {
    console.log('  날짜없음(수동확인 필요):');
    noDate.forEach(u => console.log(`    ${u.id}: "${u.title}"`));
  }

  if (APPLY && toUpdate.length) {
    let done = 0, errors = 0, idx = 0;
    async function worker() {
      while (idx < toUpdate.length) {
        const cur = toUpdate[idx++];
        try {
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, {
            properties: {
              '사진설명': { rich_text: [{ text: { content: cur.oldTitle } }] },
              '제목': { title: [{ text: { content: cur.newTitle } }] },
            }
          });
          done++;
        } catch (e) {
          errors++;
          console.log(`  오류 ${cur.id}: ${e.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`[${DB_LABEL}] 적용 완료: ${done}건, 오류 ${errors}건`);
  }

  if (!APPLY) console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
}

main();
