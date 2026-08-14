import https from 'node:https';

// 고장수리DB - "이상발생내역", "조치내역" 컬럼 앞에 붙은 "-" 기호 제거
const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 6;

const DB_ID = '22c4ad18-8a82-457b-ba8b-f74b1d6174cd';
const LABEL = '고장수리DB';
const COLS = ['이상발생내역', '조치내역'];

const DASH_PREFIX_RE = /^-+\s*/;

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
    await sleep(150);
  }
  return pages;
}

function getRichText(page, key) {
  const prop = page.properties[key];
  if (!prop || prop.type !== 'rich_text') return null;
  return (prop.rich_text || []).map(t => t.plain_text).join('');
}

(async () => {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

  const pages = await queryAll(DB_ID);
  const toUpdate = [];
  for (const p of pages) {
    const props = {};
    let changed = false;
    for (const col of COLS) {
      const text = getRichText(p, col);
      if (!text || !DASH_PREFIX_RE.test(text)) continue;
      const stripped = text.replace(DASH_PREFIX_RE, '');
      props[col] = { old: text, new: stripped };
      changed = true;
    }
    if (changed) toUpdate.push({ id: p.id, props });
  }

  console.log(`[${LABEL}] 총 ${pages.length}건 / "-" 제거 대상 ${toUpdate.length}건`);
  toUpdate.forEach(u => {
    for (const col of COLS) {
      if (u.props[col]) console.log(`  [${col}] "${u.props[col].old}" -> "${u.props[col].new}"`);
    }
  });

  if (APPLY && toUpdate.length) {
    let done = 0, errors = 0;
    let idx = 0;
    async function worker() {
      while (idx < toUpdate.length) {
        const cur = toUpdate[idx++];
        try {
          const properties = {};
          for (const col of COLS) {
            if (cur.props[col]) properties[col] = { rich_text: [{ text: { content: cur.props[col].new } }] };
          }
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, { properties });
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
