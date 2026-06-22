import https from 'https';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ExcelJS = require('C:/Users/shinf/workspace/node_modules/exceljs');

const CODE = '028260';
const API_KEY = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDate(basDt) {
  const results = [];
  for (let page = 1; page <= 2; page++) {
    const url = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo?serviceKey=${API_KEY}&numOfRows=2000&pageNo=${page}&resultType=json&basDt=${basDt}`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    const items = data?.response?.body?.items?.item || [];
    if (!Array.isArray(items)) break;
    results.push(...items);
    const total = data?.response?.body?.totalCount || 0;
    if (results.length >= total) break;
    await sleep(200);
  }
  return results;
}

function candidateDates() {
  const dates = [];
  const start = new Date(2026, 4, 19);
  const end   = new Date(2026, 5, 18);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    dates.push(
      d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0')
    );
  }
  return dates;
}

async function readKiwoom() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:/Users/shinf/Downloads/거래대금상위_20260619_임시.xlsx');
  const ws = wb.worksheets[0];
  let row619 = null;
  ws.eachRow((row, rn) => {
    if (rn < 2) return;
    const v = row.values;
    const code = String(v[1]).padStart(6, '0');
    if (code !== CODE) return;
    const 종가 = v[4], 등락률 = v[5];
    const 전일종가 = 종가 / (1 + 등락률 / 100);
    const 시가 = v[8] != null ? Math.round(전일종가 * (1 + v[8] / 100)) : Math.round(전일종가);
    const 고가 = v[9] != null ? Math.round(전일종가 * (1 + v[9] / 100)) : 종가;
    const 저가 = v[10] != null ? Math.round(전일종가 * (1 + v[10] / 100)) : 종가;
    row619 = { 날짜: '20260619', 시가, 고가, 저가, 종가, 등락률, 거래대금: v[6] * 1000000, 거래량: v[7] };
  });
  return row619;
}

// ── 기술적 지표 함수 ──
function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((s, v) => s + v, 0) / n;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) gains += changes[i];
    else losses += Math.abs(changes[i]);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + (changes[i] >= 0 ? changes[i] : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (changes[i] < 0 ? Math.abs(changes[i]) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function bollingerBands(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  const mid = slice.reduce((s, v) => s + v, 0) / n;
  const variance = slice.reduce((s, v) => s + Math.pow(v - mid, 2), 0) / n;
  const std = Math.sqrt(variance);
  return { upper: Math.round(mid + k * std), mid: Math.round(mid), lower: Math.round(mid - k * std), std: Math.round(std) };
}

function comma(n) { return n ? Math.round(n).toLocaleString('ko-KR') : '-'; }
function pct(n) { return n != null ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '-'; }
function trAmt(n) {
  if (!n) return '-';
  const 억 = n / 100000000;
  return 억 >= 10000 ? (억/10000).toFixed(1) + '조' : Math.round(억) + '억';
}

// ── Main ──
const data = [];

process.stderr.write('[조회] 삼성물산(028260) 역사 데이터 수집...\n');
for (const date of candidateDates()) {
  const items = await fetchDate(date);
  if (!items.length) { process.stderr.write(`[${date}] 휴장\n`); await sleep(100); continue; }
  const found = items.find(i => i.srtnCd === CODE);
  if (found) {
    data.push({
      날짜: date,
      시가: +found.mkp, 고가: +found.hipr, 저가: +found.lopr, 종가: +found.clpr,
      등락률: +found.fltRt, 거래대금: +found.trPrc, 거래량: +found.trqu,
    });
    process.stderr.write(`[${date}] ${comma(+found.clpr)}원 ${pct(+found.fltRt)}\n`);
  }
  await sleep(150);
}

// 6/19 추가
const k619 = await readKiwoom();
if (k619) data.push(k619);
data.sort((a, b) => a.날짜.localeCompare(b.날짜));

process.stderr.write(`\n[완료] 총 ${data.length}거래일 수집\n\n`);

// ── 일별 지표 계산 ──
const rows = data.map((d, i) => {
  const closes = data.slice(0, i + 1).map(x => x.종가);
  const ma5  = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const bb = bollingerBands(closes, 20);

  // 전일 거래대금
  const prev5trades = data.slice(Math.max(0, i-5), i).map(x => x.거래대금);
  const avgTrade5 = prev5trades.length ? prev5trades.reduce((s,v)=>s+v,0)/prev5trades.length : null;
  const 거래대금비 = avgTrade5 ? d.거래대금 / avgTrade5 : null;

  return { ...d, ma5, ma10, ma20, rsi14, bb, 거래대금비 };
});

// ── 출력 ──
console.log('\n━━━ 삼성물산(028260) 일별 시세 ━━━');
console.log('날짜       시가       고가       저가       종가       등락률   거래대금   MA5        MA10       MA20       RSI14');
console.log('─'.repeat(120));
for (const r of rows) {
  const d = r.날짜.slice(4,6)+'/'+r.날짜.slice(6,8);
  const candle = r.등락률 > 0 ? '▲' : r.등락률 < 0 ? '▼' : '─';
  console.log(
    `${d}  ${String(comma(r.시가)).padStart(9)}  ${String(comma(r.고가)).padStart(9)}  ${String(comma(r.저가)).padStart(9)}  ${String(comma(r.종가)).padStart(9)}  ${candle}${String(pct(r.등락률)).padStart(7)}  ${String(trAmt(r.거래대금)).padStart(7)}  ${String(r.ma5?comma(r.ma5):'-').padStart(9)}  ${String(r.ma10?comma(r.ma10):'-').padStart(9)}  ${String(r.ma20?comma(r.ma20):'-').padStart(9)}  ${r.rsi14?r.rsi14.toFixed(1):'-'}`
  );
}

// ── 최신 지표 상세 ──
const latest = rows[rows.length - 1];
const bb = latest.bb;

console.log('\n━━━ 현재 기술적 지표 (2026-06-19 기준) ━━━');
console.log(`현재가       : ${comma(latest.종가)}`);
console.log(`MA5          : ${comma(latest.ma5)}  (현재가 대비 ${pct(latest.ma5?(latest.종가-latest.ma5)/latest.ma5*100:null)})`);
console.log(`MA10         : ${comma(latest.ma10)}  (현재가 대비 ${pct(latest.ma10?(latest.종가-latest.ma10)/latest.ma10*100:null)})`);
console.log(`MA20         : ${comma(latest.ma20)}  (현재가 대비 ${pct(latest.ma20?(latest.종가-latest.ma20)/latest.ma20*100:null)})`);
console.log(`RSI14        : ${latest.rsi14?latest.rsi14.toFixed(1):'-'}`);
if (bb) {
  console.log(`볼린저상단   : ${comma(bb.upper)}`);
  console.log(`볼린저중단   : ${comma(bb.mid)}`);
  console.log(`볼린저하단   : ${comma(bb.lower)}`);
  console.log(`밴드폭(σ)   : ${comma(bb.std)}`);
}

// ── 스윙 고저 ──
const highs = rows.map((r,i) => {
  if (i < 2 || i > rows.length-3) return null;
  if (r.고가 > rows[i-1].고가 && r.고가 > rows[i-2].고가 && r.고가 > rows[i+1].고가 && r.고가 > rows[i+2].고가) return {날짜:r.날짜, 가격:r.고가};
  return null;
}).filter(Boolean);

const lows = rows.map((r,i) => {
  if (i < 2 || i > rows.length-3) return null;
  if (r.저가 < rows[i-1].저가 && r.저가 < rows[i-2].저가 && r.저가 < rows[i+1].저가 && r.저가 < rows[i+2].저가) return {날짜:r.날짜, 가격:r.저가};
  return null;
}).filter(Boolean);

console.log('\n━━━ 스윙 고점 ━━━');
for (const h of highs) console.log(`  ${h.날짜.slice(4,6)}/${h.날짜.slice(6,8)}  ${comma(h.가격)}`);
console.log('\n━━━ 스윙 저점 ━━━');
for (const l of lows) console.log(`  ${l.날짜.slice(4,6)}/${l.날짜.slice(6,8)}  ${comma(l.가격)}`);

// ── 매매 시나리오 ──
const 현재가 = latest.종가;
const ma5  = latest.ma5;
const ma10 = latest.ma10;
const 저항1 = Math.max(...rows.slice(-10).map(r=>r.고가));
const 저항2 = Math.max(...rows.map(r=>r.고가));
const 지지1 = ma10 ? Math.round(ma10) : null;
const 지지2 = bb ? bb.lower : null;

console.log('\n━━━ 눌림목 매매 시나리오 ━━━');
console.log(`[진입 조건]`);
console.log(`  1차 : MA5(${comma(ma5)}) 재탈환 + 당일 양봉 마감 확인`);
console.log(`  2차 : MA5 위 눌림목 → 장중 MA5 터치 후 반등 시 분할매수`);
console.log(`  거래대금 조건 : 진입일 거래대금 전일比 0.8배 이상 유지`);
console.log(`\n[목표가]`);
console.log(`  1차 목표 : ${comma(저항1)}  (단기 저항 / ${pct((저항1-현재가)/현재가*100)})`);
console.log(`  2차 목표 : ${comma(저항2)}  (20일 최고가 / ${pct((저항2-현재가)/현재가*100)})`);
console.log(`\n[손절선]`);
console.log(`  1차 손절 : MA10 종가 이탈  ${comma(지지1)}  (${pct(지지1?(지지1-현재가)/현재가*100:null)})`);
console.log(`  2차 손절 : 볼린저 하단    ${comma(지지2)}  (${pct(지지2?(지지2-현재가)/현재가*100:null)})`);
if (지지1) {
  const rr1 = ((저항1-현재가)/현재가) / ((현재가-지지1)/현재가);
  const rr2 = ((저항2-현재가)/현재가) / ((현재가-지지1)/현재가);
  console.log(`\n[리스크/보상 비율]`);
  console.log(`  1차 목표 기준 R/R : ${rr1.toFixed(1)}`);
  console.log(`  2차 목표 기준 R/R : ${rr2.toFixed(1)}`);
}
console.log(`\n[분할매수 전략]`);
console.log(`  1분할(50%) : MA5 재탈환 확인 즉시`);
console.log(`  2분할(30%) : 전고점(${comma(저항1)}) 돌파 시 추격`);
console.log(`  3분할(20%) : 2차 목표 도달 전 보유`);
