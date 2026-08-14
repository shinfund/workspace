import ExcelJS from 'exceljs';
import https from 'node:https';

const filePath = 'C:\\Users\\shinf\\Downloads\\7월점검결과보고서_안전관리자_청하_2026_07.xlsx';
const DB_ID = '125ebd28-64c9-4a9a-b265-e0ab6ed4f21f'; // 업무처리DB
const TUNNEL = '청하터널';
const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DELAY_MS = 350;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: endpoint, method,
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
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

function cellText(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const ws = wb.getWorksheet('업무처리사항');

const records = [];
let lastDate = null;
for (let r = 4; r <= ws.rowCount; r++) {
  const 날짜raw = ws.getRow(r).getCell(1).value;
  const 업무내용 = cellText(ws.getRow(r).getCell(2));
  if (!업무내용) continue;
  if (날짜raw instanceof Date) lastDate = 날짜raw.toISOString().slice(0, 10);
  const 조치사항 = cellText(ws.getRow(r).getCell(3));
  const 업체명 = cellText(ws.getRow(r).getCell(4));
  const 비고 = cellText(ws.getRow(r).getCell(5));
  records.push({ 터널명: TUNNEL, 날짜: lastDate, 제목: `${TUNNEL} 업무처리사항`, 업무내용, 조치사항, 업체명, 비고 });
}

console.log(`${records.length}건 추출`);
records.forEach(r => console.log(JSON.stringify(r)));

let saved = 0, errors = 0;
for (const r of records) {
  const props = {
    '터널명': { select: { name: r['터널명'] } },
    '날짜': { date: { start: r['날짜'] } },
    '제목': { title: [{ text: { content: r['제목'] } }] },
    '업무내용': { rich_text: [{ text: { content: r['업무내용'] } }] },
  };
  if (r['조치사항']) props['조치사항'] = { rich_text: [{ text: { content: r['조치사항'] } }] };
  if (r['업체명']) props['업체명'] = { rich_text: [{ text: { content: r['업체명'] } }] };
  if (r['비고']) props['비고'] = { rich_text: [{ text: { content: r['비고'] } }] };
  try {
    await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
    saved++;
    console.log(`완료 (${saved}/${records.length}): ${r['날짜']} ${r['업무내용']}`);
  } catch (e) {
    errors++;
    console.log(`오류: ${r['날짜']} ${r['업무내용']} → ${e.message}`);
  }
  await sleep(DELAY_MS);
}
console.log(`\n완료: ${saved}건, 오류: ${errors}건`);
