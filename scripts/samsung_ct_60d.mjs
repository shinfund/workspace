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

function candidateDates(startY, startM, startD) {
  const dates = [];
  const start = new Date(startY, startM - 1, startD);
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
  let result = null;
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
    result = { 날짜:'20260619', 시가, 고가, 저가, 종가, 등락률, 거래대금: v[6]*1000000, 거래량: v[7] };
  });
  return result;
}

// ── 지표 함수 ──
function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  const result = [e];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    result.push(e);
  }
  return result;
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: null, signal: null, hist: null };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(25), 9);
  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  return {
    macd: lastMACD,
    signal: lastSignal,
    hist: lastMACD - lastSignal,
    macdLine, signalLine,
    ema12, ema26,
  };
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) gains += changes[i]; else losses += Math.abs(changes[i]);
  }
  let ag = gains / period, al = losses / period;
  for (let i = period; i < changes.length; i++) {
    ag = (ag * (period - 1) + (changes[i] >= 0 ? changes[i] : 0)) / period;
    al = (al * (period - 1) + (changes[i] < 0 ? Math.abs(changes[i]) : 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function calcStochastic(data, kPeriod = 14, dPeriod = 3) {
  if (data.length < kPeriod) return { k: null, d: null };
  const slice = data.slice(-kPeriod);
  const lowestLow  = Math.min(...slice.map(d => d.저가));
  const highestHigh = Math.max(...slice.map(d => d.고가));
  if (highestHigh === lowestLow) return { k: 50, d: 50 };
  const k = (data[data.length - 1].종가 - lowestLow) / (highestHigh - lowestLow) * 100;
  // %D: SMA3 of last 3 %K values
  const kArr = [];
  for (let i = Math.max(0, data.length - dPeriod - kPeriod + 1); i <= data.length - kPeriod; i++) {
    const s = data.slice(i, i + kPeriod);
    const ll = Math.min(...s.map(d => d.저가));
    const hh = Math.max(...s.map(d => d.고가));
    kArr.push(hh === ll ? 50 : (data[i + kPeriod - 1].종가 - ll) / (hh - ll) * 100);
  }
  const d = kArr.slice(-dPeriod).reduce((s, v) => s + v, 0) / Math.min(dPeriod, kArr.length);
  return { k, d };
}

function bollingerBands(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  const mid = slice.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - mid, 2), 0) / n);
  return { upper: Math.round(mid + k * std), mid: Math.round(mid), lower: Math.round(mid - k * std), bw: +(std * 2 / mid * 100).toFixed(1) };
}

function sma(arr, n) {
  if (arr.length < n) return null;
  return Math.round(arr.slice(-n).reduce((s, v) => s + v, 0) / n);
}

function trAmt(n) {
  if (!n) return '-';
  const 억 = n / 1e8;
  return 억 >= 10000 ? (억/10000).toFixed(1)+'조' : Math.round(억)+'억';
}
function comma(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '-'; }
function pct(n, d=2) { return n != null ? (n>=0?'+':'')+n.toFixed(d)+'%' : '-'; }
function sign(n) { return n > 0 ? '▲' : n < 0 ? '▼' : '─'; }

// ── Main ──
const raw = [];
const dates = candidateDates(2026, 3, 2);
process.stderr.write(`[조회] ${dates.length}개 날짜 (3/2~6/18) 조회 시작...\n`);

for (const date of dates) {
  const items = await fetchDate(date);
  if (!items.length) { process.stderr.write(`[${date}] 휴장\n`); await sleep(100); continue; }
  const found = items.find(i => i.srtnCd === CODE);
  if (found) {
    raw.push({ 날짜:date, 시가:+found.mkp, 고가:+found.hipr, 저가:+found.lopr, 종가:+found.clpr, 등락률:+found.fltRt, 거래대금:+found.trPrc, 거래량:+found.trqu });
    process.stderr.write(`[${date}] ${comma(+found.clpr)}  ${pct(+found.fltRt)}\n`);
  }
  await sleep(150);
}
const k619 = await readKiwoom();
if (k619) raw.push(k619);
raw.sort((a, b) => a.날짜.localeCompare(b.날짜));
process.stderr.write(`\n[완료] 총 ${raw.length}거래일\n\n`);

// ── 지표 시리즈 ──
const closes  = raw.map(d => d.종가);
const ema12s  = ema(closes, 12);
const ema26s  = ema(closes, 26);
const macdArr = ema12s.map((v,i) => v - ema26s[i]);
const signArr = ema(macdArr, 9);

const rows = raw.map((d, i) => {
  const cl = closes.slice(0, i+1);
  const vol5 = raw.slice(Math.max(0,i-5),i).map(x=>x.거래대금);
  const avgVol = vol5.length ? vol5.reduce((s,v)=>s+v,0)/vol5.length : null;
  const stoch = calcStochastic(raw.slice(0, i+1));
  const bb = bollingerBands(cl, 20);
  return {
    ...d,
    ma5:  sma(cl,5),
    ma10: sma(cl,10),
    ma20: sma(cl,20),
    ma60: sma(cl,60),
    rsi:  calcRSI(cl,14),
    macd: macdArr[i],
    signal: signArr[i],
    hist: macdArr[i] - signArr[i],
    stochK: stoch.k,
    stochD: stoch.d,
    bb,
    volRatio: avgVol ? d.거래대금/avgVol : null,
  };
});

// ── 출력 1: 일별 시세 전체 ──
console.log('\n══════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  삼성물산(028260)  60일 일별 시세');
console.log('══════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('날짜    종가        등락률   거래대금  거래비  MA5         MA10        MA20        MA60        RSI    MACD히스토  스토K  스토D  BB위치');
console.log('─'.repeat(160));

for (const r of rows) {
  const d = r.날짜.slice(4,6)+'/'+r.날짜.slice(6,8);
  const bb = r.bb;
  const bbPos = bb ? (+(((r.종가-bb.lower)/(bb.upper-bb.lower))*100).toFixed(0))+'%' : '-';
  const histStr = r.hist != null ? (r.hist>=0?'+':'')+Math.round(r.hist) : '-';
  const skStr = r.stochK!=null ? r.stochK.toFixed(0) : '-';
  const sdStr = r.stochD!=null ? r.stochD.toFixed(0) : '-';
  const vrStr = r.volRatio!=null ? r.volRatio.toFixed(1)+'x' : '-';
  console.log(
    `${d}  ${String(comma(r.종가)).padStart(9)} ${sign(r.등락률)}${String(pct(r.등락률)).padStart(7)}  ${String(trAmt(r.거래대금)).padStart(6)}  ${String(vrStr).padStart(5)}  ${String(r.ma5?comma(r.ma5):'-').padStart(9)}   ${String(r.ma10?comma(r.ma10):'-').padStart(9)}   ${String(r.ma20?comma(r.ma20):'-').padStart(9)}   ${String(r.ma60?comma(r.ma60):'-').padStart(9)}   ${r.rsi!=null?r.rsi.toFixed(1).padStart(5):'-    '}  ${String(histStr).padStart(10)}  ${skStr.padStart(5)}  ${sdStr.padStart(5)}  ${bbPos}`
  );
}

// ── 출력 2: 현재 지표 스냅샷 ──
const L = rows[rows.length-1];
const bb = L.bb;
const bbPos = bb ? ((L.종가-bb.lower)/(bb.upper-bb.lower)*100).toFixed(0) : null;

console.log('\n══════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  현재 기술적 지표 스냅샷 (2026-06-19 기준)');
console.log('══════════════════════════════════════════════════════════════════════════════════════════════════════════');

const maOrder = (L.ma5 && L.ma10 && L.ma20 && L.ma60)
  ? (L.ma5>L.ma10 && L.ma10>L.ma20 && L.ma20>L.ma60 ? '완전 정배열 ★' :
     L.ma5>L.ma10 && L.ma10>L.ma20 ? '단기 정배열' :
     L.ma5<L.ma10 && L.ma10<L.ma20 ? '역배열' : '혼조') : '-';

console.log(`\n[ 이동평균 ]`);
console.log(`  현재가   ${comma(L.종가)}  (등락률 ${pct(L.등락률)})`);
console.log(`  MA5      ${comma(L.ma5)}   현재가比 ${pct(L.ma5?(L.종가-L.ma5)/L.ma5*100:null)}`);
console.log(`  MA10     ${comma(L.ma10)}   현재가比 ${pct(L.ma10?(L.종가-L.ma10)/L.ma10*100:null)}`);
console.log(`  MA20     ${comma(L.ma20)}   현재가比 ${pct(L.ma20?(L.종가-L.ma20)/L.ma20*100:null)}`);
console.log(`  MA60     ${comma(L.ma60)}   현재가比 ${pct(L.ma60?(L.종가-L.ma60)/L.ma60*100:null)}`);
console.log(`  배열     ${maOrder}`);

console.log(`\n[ 모멘텀 지표 ]`);
console.log(`  RSI14    ${L.rsi!=null?L.rsi.toFixed(1):'-'}  ${L.rsi>70?'과매수 주의':L.rsi<30?'과매도 (반등 기대)':L.rsi>60?'강세 구간':'중립'}`);
console.log(`  MACD     ${L.macd!=null?Math.round(L.macd):'-'}  (Signal: ${L.signal!=null?Math.round(L.signal):'-'})`);
console.log(`  히스토   ${L.hist!=null?(L.hist>=0?'+':'')+Math.round(L.hist):'-'}  ${L.hist>0?'MACD > Signal (매수 우위)':'MACD < Signal (매도 우위)'}`);
console.log(`  스토K    ${L.stochK!=null?L.stochK.toFixed(1):'-'}  / D: ${L.stochD!=null?L.stochD.toFixed(1):'-'}  ${L.stochK>80?'과매수':L.stochK<20?'과매도':'중립'}`);

if (bb) {
  console.log(`\n[ 볼린저 밴드 (20일, 2σ) ]`);
  console.log(`  상단     ${comma(bb.upper)}  (현재가까지 ${pct((bb.upper-L.종가)/L.종가*100)})`);
  console.log(`  중단     ${comma(bb.mid)}`);
  console.log(`  하단     ${comma(bb.lower)}  (현재가까지 ${pct((bb.lower-L.종가)/L.종가*100)})`);
  console.log(`  밴드폭   ${bb.bw}%   BB위치 ${bbPos}%  ${bbPos>80?'상단 과열':bbPos<20?'하단 과매도':'중립'}`);
}

// ── 출력 3: 스윙 고저점 (3봉 기준) ──
const swingH = [], swingL = [];
for (let i = 3; i < rows.length-3; i++) {
  if (rows[i].고가 > rows[i-1].고가 && rows[i].고가 > rows[i-2].고가 && rows[i].고가 > rows[i-3].고가 &&
      rows[i].고가 > rows[i+1].고가 && rows[i].고가 > rows[i+2].고가 && rows[i].고가 > rows[i+3].고가)
    swingH.push({날짜:rows[i].날짜, 가격:rows[i].고가});
  if (rows[i].저가 < rows[i-1].저가 && rows[i].저가 < rows[i-2].저가 && rows[i].저가 < rows[i-3].저가 &&
      rows[i].저가 < rows[i+1].저가 && rows[i].저가 < rows[i+2].저가 && rows[i].저가 < rows[i+3].저가)
    swingL.push({날짜:rows[i].날짜, 가격:rows[i].저가});
}

console.log(`\n[ 스윙 고점 (3봉 기준) ]`);
for (const h of swingH) {
  const d=h.날짜.slice(4,6)+'/'+h.날짜.slice(6,8);
  console.log(`  ${d}  ${comma(h.가격)}  (현재가比 ${pct((h.가격-L.종가)/L.종가*100)})`);
}
console.log(`\n[ 스윙 저점 (3봉 기준) ]`);
for (const l of swingL) {
  const d=l.날짜.slice(4,6)+'/'+l.날짜.slice(6,8);
  console.log(`  ${d}  ${comma(l.가격)}  (현재가比 ${pct((l.가격-L.종가)/l.가격*100)})`);
}

// ── 출력 4: 거래대금 급증일 ──
console.log(`\n[ 거래대금 급증일 (전일比 2배 이상) ]`);
for (const r of rows) {
  if (r.volRatio && r.volRatio >= 2.0) {
    const d=r.날짜.slice(4,6)+'/'+r.날짜.slice(6,8);
    console.log(`  ${d}  ${trAmt(r.거래대금)}  (${r.volRatio.toFixed(1)}x)  종가 ${comma(r.종가)}  ${pct(r.등락률)}`);
  }
}

// ── 출력 5: 매매 시나리오 ──
const 현재가 = L.종가;
const 최고가 = Math.max(...rows.map(r=>r.고가));
const 최저가 = Math.min(...rows.map(r=>r.저가));
const 단기저항 = Math.max(...rows.slice(-10).map(r=>r.고가));
const 주요저항 = 최고가;
const 손절MA10 = L.ma10;
const 손절MA20 = L.ma20;

console.log('\n══════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  눌림목 매수 시나리오 (60일 기반)');
console.log('══════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log(`\n[ 진입 조건 ]`);
console.log(`  필수 1 : MA5(${comma(L.ma5)}) 종가 재탈환 확인`);
console.log(`  필수 2 : 거래대금 전일比 0.8배 이상 (수급 유지)`);
console.log(`  필수 3 : RSI ${L.rsi!=null?L.rsi.toFixed(1):'-'} → 70 미만 유지 시 추가 진입 여력`);
console.log(`  보조   : MACD 히스토그램 양(+) 유지`);
console.log(`  보조   : 스토캐스틱 K(${L.stochK!=null?L.stochK.toFixed(0):'-'}) > D(${L.stochD!=null?L.stochD.toFixed(0):'-'}) 교차 확인`);

console.log(`\n[ 목표가 ]`);
console.log(`  1차 목표 : ${comma(단기저항)}  (단기 저항  ${pct((단기저항-현재가)/현재가*100)})`);
console.log(`  2차 목표 : ${comma(주요저항)}  (60일 최고가 ${pct((주요저항-현재가)/현재가*100)})`);
if (bb) console.log(`  볼린저 상단 : ${comma(bb.upper)}  (${pct((bb.upper-현재가)/현재가*100)})`);

console.log(`\n[ 손절선 ]`);
console.log(`  1차 손절 : MA5  종가 이탈 → ${comma(L.ma5)}  (${pct(L.ma5?(L.ma5-현재가)/현재가*100:null)})`);
console.log(`  2차 손절 : MA10 종가 이탈 → ${comma(손절MA10)}  (${pct(손절MA10?(손절MA10-현재가)/현재가*100:null)})`);
console.log(`  3차 손절 : MA20 종가 이탈 → ${comma(손절MA20)}  (${pct(손절MA20?(손절MA20-현재가)/현재가*100:null)})`);

if (손절MA10) {
  const rr1 = ((단기저항-현재가)/현재가) / ((현재가-손절MA10)/현재가);
  const rr2 = ((주요저항-현재가)/현재가) / ((현재가-손절MA10)/현재가);
  console.log(`\n[ 리스크/보상 (MA10 손절 기준) ]`);
  console.log(`  1차 목표 R/R : ${rr1.toFixed(1)}`);
  console.log(`  2차 목표 R/R : ${rr2.toFixed(1)}`);
}

console.log(`\n[ 분할매수 전략 ]`);
console.log(`  1분할 50% : MA5 재탈환 양봉 확인 즉시  (${comma(L.ma5)} 근처)`);
console.log(`  2분할 30% : 단기저항(${comma(단기저항)}) 돌파 확인 후`);
console.log(`  3분할 20% : 2차 목표(${comma(주요저항)}) 근접 시 보유 or 익절`);

console.log(`\n[ 60일 가격 범위 ]`);
console.log(`  60일 최고가 : ${comma(최고가)}  /  최저가 : ${comma(최저가)}`);
console.log(`  현재가 위치 : 전체 레인지 ${(+(((현재가-최저가)/(최고가-최저가))*100).toFixed(0))}% 위치`);
