import ExcelJS from 'exceljs';
import https from 'node:https';

const filePath = 'C:\\Users\\shinf\\Downloads\\26년 07월점검결과보고서_흥해터널.xlsx';
const DB_ID = '60f5cbbf-54e4-465e-8901-af41ba515dd0'; // 점검사진DB
const TUNNEL = '흥해터널';
const YM = '2026년 7월';
const WORKER_URL = 'https://notion-proxy.shinfund.workers.dev';
const PASSWORD = process.argv[2];
const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DELAY_MS = 350;

if (!PASSWORD) {
  console.error('사용법: node project_monthly_inspection_july_heunghae_upload_photo.mjs <Worker비밀번호>');
  process.exit(1);
}

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

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

function cellText(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}
function excelSerialToISO(n) { return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); }
function cellDate(cell) {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerialToISO(v);
  if (v && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
  if (v && typeof v.result === 'number') return excelSerialToISO(v.result);
  if (v && typeof v.result === 'string') return v.result.slice(0, 10);
  return '';
}
function bandOf(row) { if (row < 10) return 0; if (row < 25) return 1; return 2; }

function extractSheet(ws) {
  const LABEL_ROWS = [[16, 17], [31, 32], [46, 47]];
  const slots = {};
  for (let band = 0; band < 3; band++) {
    const [dateRow, descRow] = LABEL_ROWS[band];
    for (const [colBand, col] of [[0, 1], [1, 6]]) {
      const no = 2 * band + colBand + 1;
      const 일자 = cellDate(ws.getRow(dateRow).getCell(col + 2));
      const 사진설명 = cellText(ws.getRow(descRow).getCell(col + 2));
      slots[no] = { 번호: no, 일자, 사진설명 };
    }
  }
  const images = ws.getImages();
  for (const img of images) {
    const row = img.range.tl.nativeRow;
    const col = img.range.tl.nativeCol;
    const band = bandOf(row);
    const colBand = col < 3 ? 0 : 1;
    const no = 2 * band + colBand + 1;
    const media = ws.workbook.getImage(Number(img.imageId));
    slots[no].buffer = Buffer.from(media.buffer);
    slots[no].ext = media.extension;
  }
  return Object.values(slots).map(s => ({ ...s, 터널명: TUNNEL, 제목: `${YM} 점검사진` }));
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const ws = wb.getWorksheet('점검사진');
const all = extractSheet(ws);

console.log(`${all.length}건 추출`);
all.forEach(r => console.log(`  ${r.터널명} #${r.번호} ${r.일자} ${r.사진설명} (이미지 ${r.buffer ? r.buffer.length + 'bytes.' + r.ext : '없음!'})`));

const missing = all.filter(r => !r.buffer);
if (missing.length) {
  console.error(`\n[중단] 이미지 없는 슬롯 ${missing.length}건 있음 — 매핑 로직 재확인 필요`);
  process.exit(1);
}

const loginRes = await fetch(`${WORKER_URL}/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
});
if (!loginRes.ok) { console.error('로그인 실패:', await loginRes.text()); process.exit(1); }
const { token } = await loginRes.json();
const authHeaders = { Authorization: `Bearer ${token}` };

let saved = 0, errors = 0;
for (const r of all) {
  try {
    const filename = `${r.터널명}_${r.일자}_점검사진${r.번호}.${r.ext}`;
    const blob = new Blob([r.buffer], { type: MIME_BY_EXT[r.ext] || 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('app', 'monthly-inspection');
    const upRes = await fetch(`${WORKER_URL}/upload`, { method: 'POST', headers: authHeaders, body: formData });
    if (!upRes.ok) throw new Error(`R2 업로드 HTTP ${upRes.status}: ${await upRes.text()}`);
    const { url } = await upRes.json();
    console.log(`  [R2 업로드 완료] ${r.터널명} #${r.번호} → ${url}`);

    const props = {
      '터널명': { select: { name: r['터널명'] } },
      '일자': { date: { start: r['일자'] } },
      '제목': { title: [{ text: { content: r['제목'] } }] },
      '번호': { number: r['번호'] },
      '사진설명': { rich_text: [{ text: { content: r['사진설명'] } }] },
      '점검사진': { files: [{ name: filename, external: { url } }] },
    };
    await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
    saved++;
    console.log(`완료 (${saved}/${all.length}): ${r.터널명} #${r.번호} → ${url}`);
  } catch (e) {
    errors++;
    console.log(`오류: ${r.터널명} #${r.번호} → ${e.message}`);
  }
  await sleep(DELAY_MS);
}
console.log(`\n완료: ${saved}건, 오류: ${errors}건`);
