import https from 'node:https';
import { extractPhotoSheetImages } from './_lib_xlsx_photo_extract.mjs';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const WORKER_URL = 'https://notion-proxy.shinfund.workers.dev';
const PASSWORD = process.argv[2];
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 200;
const CONCURRENCY = 4;

const PHOTO_DB_ID = '83a945c6-79fe-4f2b-87e6-2ceef9557d0a';
const PHOTO_LABEL = '점검팀사진DB';

const DIR = 'D:/01. 업무용/01. 청하터널_수자원/10. 월점검결과보고서/2026년/점검팀/';
const FILES = {
  1: '2026년 01월 점검결과보고서_점검팀.xlsx',
  2: '2026년 02월 점검결과보고서_점검팀.xlsx',
  3: '2026년 03월 점검결과보고서_점검팀.xlsx',
  4: '2026년 04월 점검결과보고서_점검팀.xlsx',
  5: '2026년 05월 점검결과보고서_점검팀.xlsx',
  6: '2026년 06월 점검결과보고서_점검팀.xlsx',
};

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

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
      res.setEncoding('utf8');
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
function getNumber(page, key) {
  const prop = page.properties[key];
  return prop && prop.type === 'number' ? prop.number : null;
}
function getFiles(page, key) {
  const prop = page.properties[key];
  return prop && prop.type === 'files' ? (prop.files || []) : [];
}

async function main() {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }
  if (!PASSWORD) { console.error('사용법: node project_photo_team_r2_upload.mjs <Worker비밀번호> [--apply]'); process.exit(1); }

  // 1) 엑셀에서 이미지 추출 (월별 1~42번)
  const imagesByMonth = {};
  for (const month of Object.keys(FILES)) {
    const all = [];
    for (let s = 1; s <= 7; s++) {
      const imgs = await extractPhotoSheetImages(DIR + FILES[month], '사진' + s, s);
      all.push(...imgs);
    }
    all.sort((a, b) => a.num - b.num);
    imagesByMonth[month] = all;
    console.log(`[${month}월] 이미지 ${all.length}장 추출`);
  }

  // 2) Notion 조회 + 매칭 (터널명|YYYY-MM|번호 -> page)
  const pages = await queryAll(PHOTO_DB_ID);
  const byTunnelYmNum = {};
  for (const p of pages) {
    const tunnel = getSelectName(p, '터널명');
    const dateStart = getDateStart(p, '일자');
    const num = getNumber(p, '번호');
    if (!tunnel || !dateStart || num == null) continue;
    const ym = dateStart.slice(0, 7);
    byTunnelYmNum[`${ym}|${num}`] = p; // 번호는 해당 월 전체 일련번호이므로 월+번호만으로 유일
  }

  // 3) 업로드 대상 산출 (이미 점검사진이 채워진 레코드는 skip — 재실행 안전)
  const toUpload = [];
  const alreadyDone = [];
  const noMatch = [];
  for (const month of Object.keys(FILES)) {
    const ym = `2026-${String(month).padStart(2, '0')}`;
    for (const img of imagesByMonth[month]) {
      const key = `${ym}|${img.num}`;
      const page = byTunnelYmNum[key];
      if (!page) { noMatch.push({ month, num: img.num }); continue; }
      const existingFiles = getFiles(page, '점검사진');
      if (existingFiles.length > 0) { alreadyDone.push(page.id); continue; }
      toUpload.push({ pageId: page.id, month, num: img.num, buffer: img.buffer, ext: img.ext });
    }
  }

  console.log(`\n업로드 대상 ${toUpload.length}건 / 이미완료 ${alreadyDone.length}건 / 매칭실패 ${noMatch.length}건`);
  if (noMatch.length) console.log('  매칭실패:', JSON.stringify(noMatch));

  if (!APPLY) {
    console.log('\n(dry-run만 실행됨 — 실제 반영하려면 --apply 옵션을 추가해 다시 실행)');
    return;
  }
  if (!toUpload.length) return;

  // 4) Worker 로그인
  const loginRes = await fetch(`${WORKER_URL}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  });
  if (!loginRes.ok) { console.error('로그인 실패:', await loginRes.text()); process.exit(1); }
  const { token } = await loginRes.json();
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 5) 업로드 + Notion 반영
  let done = 0, errors = 0, idx = 0;
  async function worker() {
    while (idx < toUpload.length) {
      const cur = toUpload[idx++];
      try {
        const filename = `점검팀사진_${cur.month}월_${cur.num}.${cur.ext}`;
        const blob = new Blob([cur.buffer], { type: MIME_BY_EXT[cur.ext] || 'application/octet-stream' });
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('app', 'monthly-inspection-team');
        const upRes = await fetch(`${WORKER_URL}/upload`, { method: 'POST', headers: authHeaders, body: formData });
        if (!upRes.ok) throw new Error(`R2 업로드 HTTP ${upRes.status}: ${await upRes.text()}`);
        const { url } = await upRes.json();

        await notionRequest('PATCH', `/v1/pages/${cur.pageId}`, {
          properties: { '점검사진': { files: [{ name: filename, external: { url } }] } }
        });
        done++;
        if (done % 20 === 0) console.log(`  진행 ${done}/${toUpload.length}`);
      } catch (e) {
        errors++;
        console.log(`  오류 [${cur.month}월 #${cur.num}]: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n[${PHOTO_LABEL}] 적용 완료: ${done}건, 오류 ${errors}건`);
}

main();
