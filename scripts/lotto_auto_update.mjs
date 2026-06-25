/**
 * lotto_auto_update.mjs
 * 1) 최신 엑셀에서 현재 최신 회차 확인
 * 2) lottery.io.kr에서 다음 회차 데이터 수집
 * 3) 엑셀에 행 추가 후 버전 파일로 저장
 * 4) 노션 로또DB에 동일 데이터 추가
 * stdout: JSON 결과
 * 컬럼: 회차·추첨일·번호1~6·보너스·1등당첨자수·1인당당첨금
 */
import pkg from 'xlsx';
import https from 'https';
import fs from 'fs';
import path from 'path';

const { readFile, writeFile, utils } = pkg;

const LOTTO_DIR      = 'C:/Users/shinf/Workspace/data/로또';
const ROUND1_SERIAL  = 37597; // 1회차(2002-12-07) Excel 날짜 시리얼
const getSerial      = round => ROUND1_SERIAL + (round - 1) * 7;
const NOTION_DB_ID   = 'baa8d59d4b474d73ac64ca4fee93f58f';
const NOTION_TOKEN   = process.env.NOTION_TOKEN;

// 추첨일 ISO 문자열 (노션용)
const getDrawDateISO = round => {
  const base = new Date('2002-12-07');
  const d = new Date(base.getTime() + (round - 1) * 7 * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

async function notionAddRow(row) {
  const body = JSON.stringify({
    parent: { database_id: NOTION_DB_ID },
    properties: {
      '회차':        { title:  [{ text: { content: String(row.round) } }] },
      '추첨일':      { date:   { start: row.date } },
      '번호1':       { number: row.n1 }, '번호2': { number: row.n2 },
      '번호3':       { number: row.n3 }, '번호4': { number: row.n4 },
      '번호5':       { number: row.n5 }, '번호6': { number: row.n6 },
      '보너스':      { number: row.bonus },
      '1등당첨자수': { number: row.winners },
      '1인당당첨금': { number: row.prize },
    }
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: '/v1/pages', method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28',
                 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode >= 400
        ? reject(new Error(`Notion ${res.statusCode}: ${JSON.parse(d).message}`))
        : resolve(true));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function cleanOldFiles(keepPath) {
  fs.readdirSync(LOTTO_DIR)
    .filter(f => f.startsWith('로또당첨번호_') && f.endsWith('.xlsx'))
    .filter(f => path.join(LOTTO_DIR, f) !== keepPath)
    .forEach(f => { try { fs.unlinkSync(path.join(LOTTO_DIR, f)); } catch {} });
}

// 최신 엑셀 파일 찾기
const files = fs.readdirSync(LOTTO_DIR)
  .filter(f => f.startsWith('로또당첨번호_') && f.endsWith('.xlsx')).sort().reverse();
if (!files.length) { console.log(JSON.stringify({ error: '엑셀 파일 없음' })); process.exit(1); }

const xlsxPath = path.join(LOTTO_DIR, files[0]);
const wb = readFile(xlsxPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = utils.sheet_to_json(ws, { header: 1, defval: '' });
// 회차는 index 0 (새 구조)
const curMax = Math.max(...rows.slice(1).map(r => Number(r[0]) || 0));
const nextRound = curMax + 1;

// lottery.io.kr 수집
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,*/*' }
    }, res => {
      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => resolve(html));
    }).on('error', reject);
  });
}

function parsePrice(text) {
  const m = text.match(/([\d,]+)억\s*([\d,]+)만원/);
  if (m) return BigInt(m[1].replace(/,/g,'')) * 100000000n + BigInt(m[2].replace(/,/g,'')) * 10000n;
  const m2 = text.match(/([\d,]+)만원/);
  if (m2) return BigInt(m2[1].replace(/,/g,'')) * 10000n;
  return 0n;
}

const html = await fetch(`https://lottery.io.kr/lotto/results/${nextRound}`);

const nums = [...html.matchAll(/href="\/lotto\/numbers\/(\d+)"/g)].map(m => parseInt(m[1]));
if (nums.length < 7) {
  cleanOldFiles(xlsxPath);
  console.log(JSON.stringify({ status: 'waiting', round: nextRound, found: nums.length }));
  process.exit(0);
}

const [n1,n2,n3,n4,n5,n6,bonus] = nums;
const wMatch = html.match(/1등 당첨자<\/span><p[^>]+>(\d+)명/);
const winners = wMatch ? parseInt(wMatch[1]) : 0;
const pMatch = html.match(/1등 당첨금[^<]*<\/span><p[^>]+>([^<]+)<\/p>/);
const prize = pMatch ? Number(parsePrice(pMatch[1])) : 0;

// 새 행: 회차·추첨일(시리얼플레이스홀더)·번호1~6·보너스·1등당첨자수·1인당당첨금
const newRow = [nextRound, 0, n1,n2,n3,n4,n5,n6, bonus, winners, prize];
rows.splice(1, 0, newRow);

const newWs = utils.aoa_to_sheet(rows);
newWs['!cols'] = [{wch:6},{wch:12},{wch:7},{wch:7},{wch:7},{wch:7},{wch:7},{wch:7},{wch:7},{wch:12},{wch:18}];
const rng = utils.decode_range(newWs['!ref']);
for (let R = 1; R <= rng.e.r; R++) {
  const round = Number(newWs[utils.encode_cell({ r: R, c: 0 })]?.v || 0);
  if (round) newWs[utils.encode_cell({ r: R, c: 1 })] = { t: 'n', v: getSerial(round), z: 'yyyy-mm-dd' };
  const pAddr = utils.encode_cell({ r: R, c: 10 });
  if (newWs[pAddr] && newWs[pAddr].t === 'n') newWs[pAddr].z = '#,##0';
}
wb.Sheets[wb.SheetNames[0]] = newWs;

const d = new Date();
const p2 = n => String(n).padStart(2,'0');
const stamp = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;
const dest = path.join(LOTTO_DIR, `로또당첨번호_${stamp}.xlsx`);
writeFile(wb, dest);

cleanOldFiles(dest);

// 노션 로또DB 업데이트
const drawDateISO = getDrawDateISO(nextRound);
let notionStatus = 'ok';
try {
  await notionAddRow({ round:nextRound, date:drawDateISO,
    n1, n2, n3, n4, n5, n6, bonus, winners, prize });
} catch(e) {
  notionStatus = e.message;
}

console.log(JSON.stringify({ status:'success', round:nextRound, drawDate:drawDateISO,
  nums:[n1,n2,n3,n4,n5,n6], bonus, winners, prize, saved:dest, notion:notionStatus }));
