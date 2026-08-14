import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

// 점검팀사진DB "일자"(월초 1일만 기록됨)를 전기시설점검DB의 "해당 월 최초 방문일"로 보정
const PHOTO_DB_ID = '83a945c6-79fe-4f2b-87e6-2ceef9557d0a';
const ELEC_DB_ID = '23c03f3d-396b-46dc-8737-e0a6c7fdae70';
const PHOTO_LABEL = '점검팀사진DB';

// 점검팀사진DB 터널명 표기 -> 전기시설점검DB 터널명 표기
const TUNNEL_MAP = {
  '청하터널(주·부)': '청하터널',
};

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

function getSelectName(page, key) {
  const prop = page.properties[key];
  return prop && prop.type === 'select' && prop.select ? prop.select.name : null;
}
function getDateStart(page, key) {
  const prop = page.properties[key];
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start ? prop.date.start.slice(0, 10) : null;
}

async function buildFirstVisitLookup() {
  const pages = await queryAll(ELEC_DB_ID);
  const lookup = {}; // key: `${터널명}-${YYYY-MM}` -> earliest date string
  for (const p of pages) {
    const tunnel = getSelectName(p, '터널명');
    const dateStart = getDateStart(p, '날짜');
    if (!tunnel || !dateStart) continue;
    const ym = dateStart.slice(0, 7);
    const key = `${tunnel}-${ym}`;
    if (!lookup[key] || dateStart < lookup[key]) lookup[key] = dateStart;
  }
  return lookup;
}

async function main() {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

  const lookup = await buildFirstVisitLookup();
  console.log(`[전기시설점검DB] 터널×월 최초방문일 ${Object.keys(lookup).length}건 확보`);

  const pages = await queryAll(PHOTO_DB_ID);
  const toUpdate = [];
  const noMatch = [];
  const alreadyDone = [];

  for (const p of pages) {
    const tunnelRaw = getSelectName(p, '터널명');
    const dateStart = getDateStart(p, '일자');
    if (!tunnelRaw || !dateStart) { noMatch.push({ id: p.id, reason: '터널명/일자 없음' }); continue; }
    const tunnel = TUNNEL_MAP[tunnelRaw] || tunnelRaw;
    const ym = dateStart.slice(0, 7);
    const key = `${tunnel}-${ym}`;
    const firstDate = lookup[key];
    if (!firstDate) { noMatch.push({ id: p.id, reason: `매칭실패(${key})` }); continue; }
    if (firstDate === dateStart) { alreadyDone.push(p.id); continue; } // 이미 보정됨(재실행 안전)
    toUpdate.push({ id: p.id, tunnelRaw, oldDate: dateStart, newDate: firstDate });
  }

  console.log(`[${PHOTO_LABEL}] 총 ${pages.length}건 / 변경대상 ${toUpdate.length}건 / 이미처리 ${alreadyDone.length}건 / 매칭실패 ${noMatch.length}건`);
  toUpdate.slice(0, 5).forEach(u => console.log(`  예시: ${u.tunnelRaw} "${u.oldDate}" -> "${u.newDate}"`));
  if (noMatch.length) {
    console.log('  매칭실패 상세:');
    noMatch.forEach(u => console.log(`    ${u.id}: ${u.reason}`));
  }

  if (APPLY && toUpdate.length) {
    let done = 0, errors = 0, idx = 0;
    async function worker() {
      while (idx < toUpdate.length) {
        const cur = toUpdate[idx++];
        try {
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, {
            properties: {
              '일자': { date: { start: cur.newDate } },
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
    console.log(`[${PHOTO_LABEL}] 적용 완료: ${done}건, 오류 ${errors}건`);
  }

  if (!APPLY) console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
}

main();
