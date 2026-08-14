import https from 'node:https';

// 전기시설점검DB(점검팀) - "비고" 컬럼 내용 전체 삭제(빈 값으로)
const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

const DB_ID = '23c03f3d-396b-46dc-8737-e0a6c7fdae70'; // 전기시설점검DB
const LABEL = '전기시설점검DB';

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

function getNoteText(page) {
  const prop = page.properties['비고'];
  if (!prop || prop.type !== 'rich_text') return null;
  return (prop.rich_text || []).map(t => t.plain_text).join('');
}

(async () => {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

  const pages = await queryAll(DB_ID);
  const toClear = pages.filter(p => {
    const note = getNoteText(p);
    return note != null && note !== '';
  });

  console.log(`[${LABEL}] 총 ${pages.length}건 / 비고 내용 있음(삭제 대상) ${toClear.length}건`);
  toClear.slice(0, 5).forEach(p => console.log(`  예시: "${getNoteText(p)}"`));

  if (APPLY && toClear.length) {
    let done = 0, errors = 0;
    let idx = 0;
    async function worker() {
      while (idx < toClear.length) {
        const cur = toClear[idx++];
        try {
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, {
            properties: { '비고': { rich_text: [] } }
          });
          done++;
        } catch (e) {
          errors++;
          console.log(`  오류 ${cur.id}: ${e.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`[${LABEL}] 적용 완료: ${done}건, 오류 ${errors}건`);
  } else if (!APPLY) {
    console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
  }
})();
