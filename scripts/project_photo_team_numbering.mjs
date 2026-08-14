import https from 'node:https';
import XLSX from 'xlsx';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const APPLY = process.argv.includes('--apply');
const DELAY_MS = 150;
const CONCURRENCY = 6;

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

// 엑셀 "사진" 시트의 터널명 표기 -> Notion "터널명" select 값 매핑 (긴 것부터 매칭)
const TUNNEL_PREFIXES = [
  ['청하터널(주)', '청하터널(주·부)', '(주)'],
  ['청하터널(부)', '청하터널(주·부)', '(부)'],
  ['청하터널', '청하터널(주·부)', ''],
  ['흥해터널', '흥해터널', ''],
  ['남정1,2터널', '남정1·2터널', ''],
  ['남정3터널', '남정3터널', ''],
  ['남정4터널', '남정4터널', ''],
  ['남정5터널', '남정5터널', ''],
  ['남정6터널', '남정6터널', ''],
  ['남정7터널', '남정7터널', ''],
  ['남정8터널', '남정8터널', ''],
  ['남정9터널', '남정9터널', ''],
  ['강구1터널', '강구1터널', ''],
  ['강구2터널', '강구2터널', ''],
  ['강구3터널', '강구3터널', ''],
].sort((a, b) => b[0].length - a[0].length);

function parseDesc(raw) {
  const s = String(raw).trim();
  for (const [prefix, tunnel, itemPrefix] of TUNNEL_PREFIXES) {
    if (s.startsWith(prefix)) {
      const rest = s.slice(prefix.length).trim();
      return { tunnel, desc: itemPrefix + rest };
    }
  }
  return { tunnel: null, desc: null };
}

function extractMonthEntries(month) {
  const wb = XLSX.readFile(DIR + FILES[month]);
  const entries = [];
  for (let sheetNum = 1; sheetNum <= 7; sheetNum++) {
    const ws = wb.Sheets['사진' + sheetNum];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const descRow = data[i + 1] || [];
      if (String(r[0]).startsWith('#')) {
        const num = parseInt(String(r[0]).replace('#', ''), 10);
        entries.push({ num, ...parseDesc(descRow[2]) });
      }
      if (String(r[5]).startsWith('#')) {
        const num = parseInt(String(r[5]).replace('#', ''), 10);
        entries.push({ num, ...parseDesc(descRow[7]) });
      }
    }
  }
  return entries;
}

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
function getRichText(page, key) {
  const prop = page.properties[key];
  if (!prop || prop.type !== 'rich_text') return null;
  return (prop.rich_text || []).map(t => t.plain_text).join('');
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

async function main() {
  if (!TOKEN) { console.error('NOTION_TOKEN 환경변수가 없습니다.'); process.exit(1); }

  // 1) 엑셀 파싱
  const excelEntries = [];
  for (const month of Object.keys(FILES)) {
    const entries = extractMonthEntries(Number(month));
    const unparsed = entries.filter(e => !e.tunnel);
    if (unparsed.length) {
      console.log(`[${month}월] 파싱 실패 ${unparsed.length}건:`, JSON.stringify(unparsed));
    }
    entries.forEach(e => excelEntries.push({ month: Number(month), ...e }));
  }
  console.log(`엑셀 총 ${excelEntries.length}건 파싱 완료 (6개월 x 42건 기대)`);

  // 2) Notion 조회 + 매칭 키 구성
  const pages = await queryAll(PHOTO_DB_ID);
  const lookup = {}; // key: 터널명|YYYY-MM|사진설명 -> page
  for (const p of pages) {
    const tunnel = getSelectName(p, '터널명');
    const dateStart = getDateStart(p, '일자');
    const desc = getRichText(p, '사진설명');
    if (!tunnel || !dateStart || desc == null) continue;
    const ym = dateStart.slice(0, 7);
    const key = `${tunnel}|${ym}|${desc}`;
    lookup[key] = p;
  }

  // 3) 매칭 + 변경목록 산출
  const toUpdate = [];
  const noMatch = [];
  const alreadyDone = [];
  for (const e of excelEntries) {
    const ym = `2026-${String(e.month).padStart(2, '0')}`;
    const key = `${e.tunnel}|${ym}|${e.desc}`;
    const page = lookup[key];
    if (!page) { noMatch.push({ ...e, key }); continue; }
    const existingNum = getNumber(page, '번호');
    if (existingNum === e.num) { alreadyDone.push(page.id); continue; }
    toUpdate.push({ id: page.id, key, num: e.num, existingNum });
  }

  console.log(`\n매칭 결과: 변경대상 ${toUpdate.length}건 / 이미처리 ${alreadyDone.length}건 / 매칭실패 ${noMatch.length}건`);
  toUpdate.slice(0, 5).forEach(u => console.log(`  예시: ${u.key} -> 번호 ${u.num}${u.existingNum != null ? ` (기존 ${u.existingNum})` : ''}`));
  if (noMatch.length) {
    console.log('  매칭실패 상세:');
    noMatch.forEach(u => console.log(`    [${u.month}월 #${u.num}] ${u.key}`));
  }

  if (APPLY && toUpdate.length) {
    let done = 0, errors = 0, idx = 0;
    async function worker() {
      while (idx < toUpdate.length) {
        const cur = toUpdate[idx++];
        try {
          await notionRequest('PATCH', `/v1/pages/${cur.id}`, {
            properties: { '번호': { number: cur.num } }
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
