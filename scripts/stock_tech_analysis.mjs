/**
 * stock_tech_analysis.mjs
 * 개별 종목 기술적 분석 스크립트 (KRX API 기반)
 *
 * 사용법:
 *   node stock_tech_analysis.mjs CODE [DAYS] [KIWOOM_XLSX]
 *
 * 예시:
 *   node stock_tech_analysis.mjs 028260           # 삼성물산 75거래일
 *   node stock_tech_analysis.mjs 028260 60        # 삼성물산 60거래일
 *   node stock_tech_analysis.mjs 000660 120       # SK하이닉스 120거래일
 *   node stock_tech_analysis.mjs 028260 75 "C:/Users/shinf/Downloads/거래대금상위_20260619_임시.xlsx"
 *
 * stdout: JSON (분석 결과)
 * stderr: 진행 로그
 */

import https from 'https';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ExcelJS = require('C:/Users/shinf/workspace/node_modules/exceljs');

// ── 인자 파싱 ──
const [CODE, DAYS_STR, KIWOOM_PATH] = process.argv.slice(2);
if (!CODE) { console.error('사용법: node stock_tech_analysis.mjs CODE [DAYS] [KIWOOM_XLSX]'); process.exit(1); }
const DAYS = parseInt(DAYS_STR ?? '75');
const API_KEY = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── KRX API 조회 ──
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
    const items = data?.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) break;
    results.push(...items);
    const total = data?.response?.body?.totalCount ?? 0;
    if (results.length >= total) break;
    await sleep(200);
  }
  return results;
}

// ── 조회 날짜 목록 생성 (최신일 → 과거 순, 평일만) ──
function candidateDates(days) {
  const dates = [];
  const today = new Date();
  // 넉넉하게 days*2 캘린더 일수 소급
  const start = new Date(today.getTime() - days * 2 * 24 * 60 * 60 * 1000);
  // 최신일부터 과거 방향으로 생성 (newest first)
  for (let d = new Date(today); d >= start; d.setDate(d.getDate() - 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    dates.push(
      d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0')
    );
  }
  return dates; // newest first → 수집 후 raw.sort()로 정렬
}

// ── 키움 엑셀에서 최신일 데이터 읽기 (선택) ──
async function readKiwoom(xlsxPath, code) {
  if (!xlsxPath || !fs.existsSync(xlsxPath)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  let result = null;
  // 파일명에서 날짜 추출 (거래대금상위_YYYYMMDD_*.xlsx)
  const m = path.basename(xlsxPath).match(/(\d{8})/);
  const fileDate = m ? m[1] : '20260619';
  ws.eachRow((row, rn) => {
    if (rn < 2) return;
    const v = row.values;
    const c = String(v[1]).padStart(6, '0');
    if (c !== code) return;
    const 종가 = v[4], 등락률 = v[5];
    const 전일종가 = 종가 / (1 + 등락률 / 100);
    const 시가 = v[8] != null ? Math.round(전일종가 * (1 + v[8] / 100)) : Math.round(전일종가);
    const 고가 = v[9] != null ? Math.round(전일종가 * (1 + v[9] / 100)) : 종가;
    const 저가 = v[10] != null ? Math.round(전일종가 * (1 + v[10] / 100)) : 종가;
    result = { 날짜: fileDate, 시가, 고가, 저가, 종가, 등락률, 거래대금: v[6] * 1_000_000, 거래량: v[7] };
  });
  return result;
}

// ── 지표 함수 ──
function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  const result = [e];
  for (let i = 1; i < values.length; i++) { e = values[i] * k + e * (1 - k); result.push(e); }
  return result;
}
function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((s, v) => s + v, 0) / n;
}
function calcRSI(closes, p = 14) {
  if (closes.length < p + 1) return null;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  let ag = 0, al = 0;
  for (let i = 0; i < p; i++) { if (ch[i] >= 0) ag += ch[i]; else al += Math.abs(ch[i]); }
  ag /= p; al /= p;
  for (let i = p; i < ch.length; i++) {
    ag = (ag * (p - 1) + (ch[i] >= 0 ? ch[i] : 0)) / p;
    al = (al * (p - 1) + (ch[i] < 0 ? Math.abs(ch[i]) : 0)) / p;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function calcStoch(data, kp = 14, dp = 3) {
  if (data.length < kp) return { k: null, d: null };
  const kArr = [];
  for (let i = kp - 1; i < data.length; i++) {
    const s = data.slice(i - kp + 1, i + 1);
    const ll = Math.min(...s.map(d => d.저가)), hh = Math.max(...s.map(d => d.고가));
    kArr.push(hh === ll ? 50 : (data[i].종가 - ll) / (hh - ll) * 100);
  }
  const k = kArr[kArr.length - 1];
  const d = kArr.slice(-dp).reduce((s, v) => s + v, 0) / Math.min(dp, kArr.length);
  return { k, d };
}
function calcBB(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const sl = closes.slice(-n), mid = sl.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / n);
  return { upper: Math.round(mid + k * std), mid: Math.round(mid), lower: Math.round(mid - k * std), bw: +(std * 2 / mid * 100).toFixed(1) };
}

// ── 메인 ──
const raw = [];
const candidates = candidateDates(DAYS);
process.stderr.write(`[${CODE}] 조회 시작 (최대 ${DAYS}거래일, 후보 ${candidates.length}일)...\n`);

for (const date of candidates) {
  const items = await fetchDate(date);
  if (!items.length) { process.stderr.write(`[${date}] 휴장\n`); await sleep(100); continue; }
  const found = items.find(i => i.srtnCd === CODE);
  if (!found) { process.stderr.write(`[${date}] 종목 미포함\n`); await sleep(100); continue; }
  raw.push({
    날짜: date, 시가: +found.mkp, 고가: +found.hipr, 저가: +found.lopr, 종가: +found.clpr,
    등락률: +found.fltRt, 거래대금: +found.trPrc, 거래량: +found.trqu,
  });
  process.stderr.write(`[${date}] ${(+found.clpr).toLocaleString()}원 ${+found.fltRt >= 0 ? '+' : ''}${+found.fltRt}%\n`);
  await sleep(150);
  if (raw.length >= DAYS) break;
}

// 키움 엑셀 추가
const kiwoom = await readKiwoom(KIWOOM_PATH, CODE);
if (kiwoom && !raw.find(d => d.날짜 === kiwoom.날짜)) raw.push(kiwoom);
raw.sort((a, b) => a.날짜.localeCompare(b.날짜));
process.stderr.write(`\n[완료] ${raw.length}거래일 수집\n`);

// 지표 시리즈
const closes = raw.map(d => d.종가);
const ema12s = ema(closes, 12), ema26s = ema(closes, 26);
const macdLine = ema12s.map((v, i) => v - ema26s[i]);
const signArr = ema(macdLine, 9);

const series = raw.map((d, i) => {
  const cl = closes.slice(0, i + 1);
  const vol5 = raw.slice(Math.max(0, i - 5), i).map(x => x.거래대금);
  const avgVol5 = vol5.length ? vol5.reduce((s, v) => s + v, 0) / vol5.length : null;
  const stoch = calcStoch(raw.slice(0, i + 1));
  const bb = calcBB(cl);
  return {
    ...d,
    ma5: sma(cl, 5), ma10: sma(cl, 10), ma20: sma(cl, 20), ma60: sma(cl, 60),
    rsi: calcRSI(cl),
    macd: macdLine[i], signal: signArr[i], hist: macdLine[i] - signArr[i],
    stochK: stoch.k, stochD: stoch.d,
    bb,
    volRatio: avgVol5 ? +(d.거래대금 / avgVol5).toFixed(2) : null,
  };
});

// 최신 스냅샷
const L = series[series.length - 1];
const bb = L.bb;
const maOrder = L.ma5 && L.ma10 && L.ma20 && L.ma60
  ? (L.ma5 > L.ma10 && L.ma10 > L.ma20 && L.ma20 > L.ma60 ? '완전 정배열'
    : L.ma5 > L.ma10 && L.ma10 > L.ma20 ? '단기 정배열'
    : L.ma5 < L.ma10 && L.ma10 < L.ma20 ? '역배열' : '혼조') : '-';

// 스윙 고저 (3봉 기준)
const swingH = [], swingL = [];
for (let i = 3; i < series.length - 3; i++) {
  if ([1,2,3].every(d => series[i].고가 > series[i-d].고가 && series[i].고가 > series[i+d].고가))
    swingH.push({ 날짜: series[i].날짜, 가격: series[i].고가 });
  if ([1,2,3].every(d => series[i].저가 < series[i-d].저가 && series[i].저가 < series[i+d].저가))
    swingL.push({ 날짜: series[i].날짜, 가격: series[i].저가 });
}

// 거래대금 급증일
const volSpikes = series.filter(r => r.volRatio >= 2.0).map(r => ({
  날짜: r.날짜, 거래대금: r.거래대금, 배율: r.volRatio, 등락률: r.등락률, 종가: r.종가
}));

// 결과 JSON 출력
const result = {
  code: CODE,
  name: raw[0]?.종목명 ?? CODE,
  days: series.length,
  기준일: L.날짜,
  현재가: L.종가,
  등락률: L.등락률,
  거래대금: L.거래대금,
  volRatio: L.volRatio,
  ma: { ma5: L.ma5, ma10: L.ma10, ma20: L.ma20, ma60: L.ma60, order: maOrder },
  rsi: L.rsi,
  macd: { macd: L.macd, signal: L.signal, hist: L.hist },
  stoch: { k: L.stochK, d: L.stochD },
  bb: L.bb,
  저항: Math.max(...series.slice(-20).map(d => d.고가)),
  지지: Math.min(...series.slice(-20).map(d => d.저가)),
  전고점: Math.max(...series.map(d => d.고가)),
  전저점: Math.min(...series.map(d => d.저가)),
  swingH, swingL,
  volSpikes,
  series,
};
console.log(JSON.stringify(result, null, 2));
