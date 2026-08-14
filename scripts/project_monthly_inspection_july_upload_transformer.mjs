import fs from 'node:fs';
import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DB_ID = '998fab1e-2d5c-4cae-a6aa-55a131931546'; // 변압기온도DB
const DELAY_MS = 350;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit exceeded'));
            await sleep(parseInt(res.headers['retry-after'] || '2') * 1000);
            resolve(await notionRequest(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          } else {
            resolve(json);
          }
        } catch (e) { reject(new Error(`Parse error: ${d.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const records = JSON.parse(fs.readFileSync('scripts/_tmp_transformer_july_extracted.json', 'utf8'));

let saved = 0, errors = 0;
for (const r of records) {
  const props = {
    '터널명': { select: { name: r['터널명'] } },
    '측정일자': { date: { start: r['측정일자'] } },
    '점검자': { select: { name: r['점검자'] } },
    '변압기종류': { select: { name: r['변압기종류'] } },
    '용량': { rich_text: [{ text: { content: r['용량'] } }] },
    '측정지점': { rich_text: [{ text: { content: r['측정지점'] } }] },
    '지점번호': { number: r['지점번호'] },
    '온도(℃)': { number: r['온도(℃)'] },
    '비고': { select: { name: r['비고'] } },
    '제목': { title: [{ text: { content: `${r['터널명']} 변압기온도측정표` } }] },
  };
  try {
    await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
    saved++;
    console.log(`완료 (${saved}/${records.length}): ${r['터널명']} ${r['측정지점']}`);
  } catch (e) {
    errors++;
    console.log(`오류: ${r['터널명']} ${r['측정지점']} → ${e.message}`);
  }
  await sleep(DELAY_MS);
}
console.log(`\n완료: ${saved}건, 오류: ${errors}건`);
