import ExcelJS from 'exceljs';
import https from 'node:https';

const filePath = 'C:\\Users\\shinf\\Downloads\\7월점검결과보고서_안전관리자_청하_2026_07.xlsx';
const DB_ID = '10bfd710-9afb-4b06-b6c2-7943da777956'; // 전력사용량DB
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

const records = [];
for (const [sheetName, tunnel] of [['전력사용량(주)', '청하터널(주)'], ['전력사용량(부)', '청하터널(부)']]) {
  const ws = wb.getWorksheet(sheetName);
  for (let r = 20; r <= 50; r++) {
    const 날짜raw = ws.getRow(r).getCell(1).value;
    if (!(날짜raw instanceof Date)) continue;
    const main = cellText(ws.getRow(r).getCell(2));
    if (main === '') continue; // 값 없는 미래 날짜는 스킵
    const light = cellText(ws.getRow(r).getCell(3));
    const note = cellText(ws.getRow(r).getCell(4));
    records.push({
      터널명: tunnel,
      일자: 날짜raw.toISOString().slice(0, 10),
      제목: `${tunnel} 전력사용량`,
      'MAIN(kWh)': Number(main),
      '조명용(kWh)': Number(light),
      비고: note || ''
    });
  }
}
console.log(`${records.length}건 추출`);

let saved = 0, errors = 0;
for (const r of records) {
  const props = {
    '터널명': { select: { name: r['터널명'] } },
    '일자': { date: { start: r['일자'] } },
    '제목': { title: [{ text: { content: r['제목'] } }] },
    'MAIN(kWh)': { number: r['MAIN(kWh)'] },
    '조명용(kWh)': { number: r['조명용(kWh)'] },
  };
  if (r['비고']) props['비고'] = { rich_text: [{ text: { content: r['비고'] } }] };
  try {
    await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
    saved++;
    console.log(`완료 (${saved}/${records.length}): ${r['터널명']} ${r['일자']}`);
  } catch (e) {
    errors++;
    console.log(`오류: ${r['터널명']} ${r['일자']} → ${e.message}`);
  }
  await sleep(DELAY_MS);
}
console.log(`\n완료: ${saved}건, 오류: ${errors}건`);
