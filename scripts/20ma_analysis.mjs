/**
 * 20ma_analysis.mjs — 거래대금 TOP10 유니버스 × MA20 괴리율 일간 분석
 *
 * 데이터 소스 (자동 선택):
 *   KIS API       → 당일 실시간 (실패 시 Yahoo 폴백)
 *   Yahoo Finance → 최근 거래일(당일 포함) + 마지막 거래일 이후 주말·공휴일 + KRX 실패 구간 자동 폴백
 *   KRX API       → KRX 확정 과거 데이터 (조회 실패 시 Yahoo 폴백)
 *
 * 실행:
 *   node 20ma_analysis.mjs
 *   ※ 날짜 범위 자동 계산, 엑셀 파일 불필요
 *   ※ Yahoo 미포함 종목은 MANUAL_PRICES에 직접 추가
 *
 * 출력: 방식A(당일TOP10×MA20) / 방식B(유니버스×MA20) / 저점대비상승률
 */

import https from 'https';
import fs    from 'fs';

const API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST     = 'apis.data.go.kr';
const PATH     = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;
const DELAY_MS = 300;

const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999);
}
const PREF_RE = /우[BCbc]?$/;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 날짜 유틸 ─────────────────────────────────────────────────────────────
function kstToday() {
  const d = new Date(Date.now() + 9*3600*1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function addDays(yyyymmdd, n) {
  const d = new Date(`${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function calDiff(a, b) {
  const da = new Date(`${a.slice(0,4)}-${a.slice(4,6)}-${a.slice(6,8)}`);
  const db = new Date(`${b.slice(0,4)}-${b.slice(4,6)}-${b.slice(6,8)}`);
  return Math.abs(Math.round((db - da) / 86400000));
}

function weekdayRange(startStr, endStr) {
  const dates = [];
  const cur = new Date(`${startStr.slice(0,4)}-${startStr.slice(4,6)}-${startStr.slice(6,8)}`);
  const end = new Date(`${endStr.slice(0,4)}-${endStr.slice(4,6)}-${endStr.slice(6,8)}`);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6)
      dates.push(`${cur.getFullYear()}${String(cur.getMonth()+1).padStart(2,'0')}${String(cur.getDate()).padStart(2,'0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function fmtDate(s) { return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtMD(s)   { return `${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtNum(n)  { return n.toLocaleString('ko-KR'); }

// ─── KRX API ────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(JSON.parse(d)); }
        catch(e) { rej(new Error(`파싱실패: ${d.slice(0, 200)}`)); }
      });
    }).on('error', rej);
  });
}

async function fetchDate(basDt) {
  const first = await get(
    `https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`
  );
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  if (total === 0) return null;

  let items = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];

  for (let p = 2; p <= Math.ceil(total / NUM_ROWS); p++) {
    await sleep(100);
    const r = await get(
      `https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`
    );
    const more = r?.response?.body?.items?.item || [];
    items = items.concat(Array.isArray(more) ? more : [more]);
  }
  return items;
}

function buildStockMap(items) {
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const name = (item.itmsNm || '').trim();
    if (ETF_RE.test(name) || isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name) || code.endsWith('5')) continue;
    const prev = map.get(code);
    if (!prev || Number(item.mrktTotAmt||0) > Number(prev.mrktTotAmt||0)) {
      map.set(code, {
        종목코드: code,
        종목명:   name,
        시장:     (item.mrktCtg || '').trim().toUpperCase(),
        종가:     Number(item.clpr  || 0),
        고가:     Number(item.hipr  || 0),
        거래대금: Number(item.trPrc || 0),
        거래량:   Number(item.trqu  || 0),
        등락률:   Number(item.fltRt || 0),
      });
    }
  }
  return map;
}

// ─── Yahoo Finance ──────────────────────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 대상 날짜 포함 14일 이전까지 범위 (전일 종가 확보용)
function yfDateRange(yyyymmdd) {
  const y=yyyymmdd.slice(0,4), m=yyyymmdd.slice(4,6), d=yyyymmdd.slice(6,8);
  const p2 = Math.floor(new Date(`${y}-${m}-${d}T23:59:59+09:00`).getTime() / 1000);
  const p1 = p2 - 14*24*3600;
  return { p1, p2 };
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9*3600) * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function httpGetYf(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch(e) { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(12000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  try {
    const data = await httpGetYf(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp || [];
    const q  = result.indicators?.quote?.[0] || {};
    return { ts, close: q.close||[], high: q.high||[], volume: q.volume||[] };
  } catch {
    return null;
  }
}

async function batchAll(items, fn, concurrency=10, delay=80) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      if (delay) await new Promise(r => setTimeout(r, delay));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// stockList: [{ code, 종목명, 시장 }, ...]
// 반환: Map<code, stockData>
async function fetchYahooDate(targetDate, stockList) {
  const { p1, p2 } = yfDateRange(targetDate);
  const resultMap = new Map();

  await batchAll(stockList, async (stock) => {
    const suffix = stock.시장 === 'KOSDAQ' ? '.KQ' : '.KS';
    const yf = await fetchYahooChart(`${stock.code}${suffix}`, p1, p2);
    if (!yf || yf.ts.length === 0) return;

    let tIdx = -1;
    for (let i = 0; i < yf.ts.length; i++) {
      if (tsToKstDate(yf.ts[i]) === targetDate) { tIdx = i; break; }
    }
    if (tIdx === -1) return;

    const 종가   = yf.close[tIdx];
    const 고가yf = yf.high[tIdx];
    const vol    = yf.volume[tIdx];
    if (!종가) return;

    resultMap.set(stock.code, {
      종목코드: stock.code,
      종목명:   stock.종목명,
      시장:     stock.시장,
      종가:     Math.round(종가),
      고가:     고가yf ? Math.round(고가yf) : Math.round(종가),
      거래대금: vol ? Math.round(종가 * vol) : 0, // 근사값 (종가×거래량)
      거래량:   vol || 0,
      등락률:   0, // MA20 분석에 미사용
    });
  }, 10, 80);

  return resultMap;
}

// ─── 메인 ───────────────────────────────────────────────────────────────────
async function main() {
  // ── 0. 수동 보완 가격 (Yahoo Finance 미포함 종목을 직접 입력)
  // 형식: { 'YYYYMMDD': { '종목코드': 종가, ... } }
  const MANUAL_PRICES = {
    // '20260627': { '000000': 10000 },
  };

  // ── 1. 날짜 범위: KST 오늘 기준 ~65일 (MA20 + 분석 20일 여유)
  const today      = kstToday();
  const startDate  = addDays(today, -65);
  const allWeekdays = weekdayRange(startDate, today);
  console.error(`\n[조회] ${fmtDate(startDate)} ~ ${fmtDate(today)} (주말 제외 ${allWeekdays.length}개 날짜)`);

  // ── 2. KRX API 일별 조회
  const priceHistory   = new Map();
  const tradingDates   = [];
  const krxFailedRecent = []; // KRX 미제공 + 최근 5일 → Yahoo 대상

  for (const date of allWeekdays) {
    process.stderr.write(`  ${fmtDate(date)}... `);
    try {
      await sleep(DELAY_MS);
      const items = await fetchDate(date);
      if (!items) {
        if (calDiff(date, today) <= 5) {
          krxFailedRecent.push(date);
          process.stderr.write('KRX 미제공 → Yahoo 대상\n');
        } else {
          process.stderr.write('휴장\n');
        }
        continue;
      }
      const sm = buildStockMap(items);
      priceHistory.set(date, sm);
      tradingDates.push(date);
      process.stderr.write(`${sm.size}종목\n`);
    } catch(e) {
      process.stderr.write(`오류: ${e.message}\n`);
    }
  }

  console.error(`\n[완료] KRX API 거래일 ${tradingDates.length}일 수집`);

  // ── 3. Yahoo Finance 폴백 (KRX 미제공 최근 날짜)
  if (krxFailedRecent.length > 0 && tradingDates.length > 0) {
    // 사전 유니버스 = 최근 20 거래일 TOP10 출현 + 마지막 KRX일 TOP150
    const recent20 = tradingDates.slice(-20);
    const preMap   = new Map();

    for (const d of recent20) {
      const dm = priceHistory.get(d);
      if (!dm) continue;
      [...dm.values()]
        .filter(s => s.거래대금 > 0)
        .sort((a, b) => b.거래대금 - a.거래대금)
        .slice(0, 10)
        .forEach(s => preMap.set(s.종목코드, { 종목명: s.종목명, 시장: s.시장 }));
    }
    const lastKrxMap = priceHistory.get(tradingDates[tradingDates.length - 1]);
    if (lastKrxMap) {
      [...lastKrxMap.values()]
        .sort((a, b) => b.거래대금 - a.거래대금)
        .slice(0, 150)
        .forEach(s => {
          if (!preMap.has(s.종목코드)) preMap.set(s.종목코드, { 종목명: s.종목명, 시장: s.시장 });
        });
    }
    const preUniverse = [...preMap.entries()].map(([code, m]) => ({ code, ...m }));

    console.error(`\n[Yahoo] ${krxFailedRecent.length}개 날짜 × ${preUniverse.length}종목 조회`);

    for (const date of krxFailedRecent) {
      process.stderr.write(`  [Yahoo] ${fmtDate(date)}... `);
      const ym = await fetchYahooDate(date, preUniverse);
      if (ym.size > 0) {
        priceHistory.set(date, ym);
        tradingDates.push(date);
        process.stderr.write(`${ym.size}종목 (Yahoo Finance)\n`);
      } else {
        process.stderr.write('데이터 없음 (휴장 또는 미래)\n');
      }
    }
    tradingDates.sort();
  }

  console.error(`[거래일] 총 ${tradingDates.length}일 (KRX + Yahoo 합산)`);

  // ── 4. MANUAL_PRICES 보완
  for (const [date, pm] of Object.entries(MANUAL_PRICES)) {
    const dm = priceHistory.get(date) || new Map();
    let added = 0;
    for (const [code, 종가] of Object.entries(pm)) {
      if (dm.has(code)) continue;
      let market = '─', 종목명 = code;
      for (let i = tradingDates.length - 1; i >= 0; i--) {
        const m = priceHistory.get(tradingDates[i]);
        if (m && m.has(code)) { market = m.get(code).시장; 종목명 = m.get(code).종목명; break; }
      }
      dm.set(code, { 종목코드: code, 종목명, 시장: market, 종가, 거래대금: 0, 거래량: 0, 등락률: 0 });
      console.error(`[수동] ${종목명}(${code}) ${fmtDate(date)} 종가 ${종가.toLocaleString()}원 보완`);
      added++;
    }
    if (added > 0 && !priceHistory.has(date)) {
      priceHistory.set(date, dm);
      if (!tradingDates.includes(date)) { tradingDates.push(date); tradingDates.sort(); }
    }
  }

  // ── 5. 분석 대상: 마지막 20거래일
  const TARGET_DAYS  = 20;
  const targetDates  = tradingDates.slice(-TARGET_DAYS);
  console.error(`[분석] ${fmtDate(targetDates[0])} ~ ${fmtDate(targetDates[targetDates.length-1])} (${targetDates.length}일)\n`);

  // ── 6. 20일 유니버스: TOP10에 1번 이상 출현한 종목
  const universeMap = new Map();
  for (const date of targetDates) {
    const dayMap = priceHistory.get(date);
    if (!dayMap) continue;
    const allStocks = Array.from(dayMap.values()).filter(s => s.거래대금 > 0 && s.종가 > 0);
    allStocks.sort((a, b) => b.거래대금 - a.거래대금);
    allStocks.slice(0, 10).forEach(s => {
      if (!universeMap.has(s.종목코드)) universeMap.set(s.종목코드, { 종목명: s.종목명, 시장: s.시장 });
    });
  }
  console.error(`[유니버스] 20일 TOP10 출현 고유 종목: ${universeMap.size}개`);

  const latestDate = tradingDates[tradingDates.length - 1];

  // ── 7. 방식A / 방식B 동시 분석
  const findingsA = [];
  const findingsB = [];

  for (const date of targetDates) {
    const dayMap = priceHistory.get(date);
    if (!dayMap) continue;

    const allStocks = Array.from(dayMap.values()).filter(s => s.거래대금 > 0 && s.종가 > 0);
    allStocks.sort((a, b) => b.거래대금 - a.거래대금);
    const top10      = allStocks.slice(0, 10);
    const top10Codes = new Set(top10.map(s => s.종목코드));

    const di = tradingDates.indexOf(date);
    const lookbackDates = tradingDates.slice(Math.max(0, di - 19), di + 1);

    for (const [code, meta] of universeMap) {
      const stockData = dayMap.get(code);
      if (!stockData || stockData.종가 <= 0) continue;

      const { 종가 } = stockData;
      const prices = [];
      for (const d of lookbackDates) {
        const m = priceHistory.get(d);
        if (m && m.has(code)) prices.push(m.get(code).종가);
      }
      if (prices.length < 5) continue;

      const ma20  = prices.reduce((a, b) => a + b, 0) / prices.length;
      const ratio = (종가 / ma20 - 1) * 100;
      const inTop10 = top10Codes.has(code);
      const rankAll = allStocks.findIndex(s => s.종목코드 === code) + 1 || null;
      const rank    = inTop10 ? top10.findIndex(s => s.종목코드 === code) + 1 : rankAll;

      if (ratio <= -20) {
        const entry = { date, rank, 종목코드: code, 종목명: meta.종목명, 시장: meta.시장, 종가, ma20: Math.round(ma20), ratio, 데이터수: prices.length, inTop10 };
        findingsB.push(entry);
        if (inTop10) findingsA.push({ ...entry });
      }
    }
  }

  // ── 8. 출력 헬퍼
  function printSection(label, findings, showCurrentRatio = false) {
    console.log('\n' + '═'.repeat(72));
    console.log(` ${label}`);
    console.log('═'.repeat(72));
    if (findings.length === 0) { console.log('\n  해당 조건 종목 없음'); return; }
    const byDate = {};
    for (const f of findings) { if (!byDate[f.date]) byDate[f.date] = []; byDate[f.date].push(f); }
    for (const date of Object.keys(byDate).sort()) {
      const items = byDate[date].sort((a, b) => a.ratio - b.ratio);
      console.log(`\n  ▶ ${fmtDate(date)}`);
      console.log(`    ${'순위'.padStart(4)}  ${'종목명'.padEnd(12)}  ${'시장'.padEnd(6)}  ${'종가'.padStart(10)}  ${'MA20'.padStart(10)}  ${'괴리율'.padStart(8)}`);
      console.log('    ' + '─'.repeat(60));
      for (const f of items) {
        const rankStr = f.rank ? `${f.rank}위` : '─';
        console.log(`    ${rankStr.padStart(4)}  ${f.종목명.padEnd(12)}  ${f.시장.padEnd(6)}  ${fmtNum(f.종가).padStart(10)}  ${fmtNum(f.ma20).padStart(10)}  ${f.ratio.toFixed(1).padStart(7)}%`);
      }
    }
    console.log('\n' + '─'.repeat(72));
    const stockSummary = {};
    for (const f of findings) {
      if (!stockSummary[f.종목명]) stockSummary[f.종목명] = { 시장: f.시장, 종목코드: f.종목코드, 건수: 0, 최대괴리: 0, 날짜들: [] };
      stockSummary[f.종목명].건수++;
      if (f.ratio < stockSummary[f.종목명].최대괴리) stockSummary[f.종목명].최대괴리 = f.ratio;
      stockSummary[f.종목명].날짜들.push(f.date.slice(4));
    }

    // 현재 괴리율 계산 (방식B 요청 시)
    const currentRatioMap = new Map();
    if (showCurrentRatio) {
      for (const [name, s] of Object.entries(stockSummary)) {
        const code = s.종목코드;
        let latestP = null, latestDi2 = -1;
        for (let i = tradingDates.length - 1; i >= 0; i--) {
          const m = priceHistory.get(tradingDates[i]);
          if (m && m.has(code)) { latestP = m.get(code).종가; latestDi2 = i; break; }
        }
        if (latestP == null) continue;
        const lb = tradingDates.slice(Math.max(0, latestDi2 - 19), latestDi2 + 1);
        const ps = [];
        for (const ld of lb) { const m = priceHistory.get(ld); if (m && m.has(code)) ps.push(m.get(code).종가); }
        if (ps.length >= 5) currentRatioMap.set(name, (latestP / (ps.reduce((a, b) => a + b, 0) / ps.length) - 1) * 100);
      }
    }

    const sorted = Object.entries(stockSummary).sort((a, b) => b[1].건수 - a[1].건수 || a[1].최대괴리 - b[1].최대괴리);
    for (const [name, s] of sorted) {
      const ratioStr = showCurrentRatio && currentRatioMap.has(name) ? `  현재괴리 ${currentRatioMap.get(name).toFixed(1).padStart(6)}%` : '';
      console.log(`  ${name.padEnd(14)}  ${s.시장.padEnd(6)}  ${s.건수}일 해당  최대괴리 ${s.최대괴리.toFixed(1).padStart(6)}%${ratioStr}  (${s.날짜들.join(', ')})`);
    }
    console.log('\n' + '═'.repeat(72));
    console.log(`  총 ${findings.length}건 / ${[...new Set(findings.map(f=>f.종목명))].length}개 종목`);
    console.log('═'.repeat(72));
  }

  const pd = `${fmtMD(targetDates[0])}~${fmtMD(targetDates[targetDates.length-1])}`;
  printSection(`【방식A】 당일 TOP10(${[...new Set(findingsA.map(f=>f.종목명))].length}종목) × MA20 -20% 이하 (${pd} · ${findingsA.length}건)`, findingsA);
  printSection(`【방식B】 20일 유니버스(${universeMap.size}종목) × MA20 -20% 이하 (${pd} · ${findingsB.length}건)`, findingsB, true);

  // ── 9. 종가 기준 저점 대비 상승률 분석
  console.log('\n' + '═'.repeat(84));
  console.log(` 【저점 대비 현재 상승률】 방식B 종목 × 종가저점 기준 (${pd} · ${[...new Set(findingsB.map(f=>f.종목코드))].length}종목)`);
  console.log(' ▪ 저점 = 기간 내 실제 최저 종가일   ▪   최근가 = 가장 최근 가용 종가');
  console.log('═'.repeat(84));

  const stockDateRange = new Map();
  for (const f of findingsB) {
    if (!stockDateRange.has(f.종목코드))
      stockDateRange.set(f.종목코드, { 종목명: f.종목명, 시장: f.시장, dates: [] });
    stockDateRange.get(f.종목코드).dates.push(f.date);
  }

  function latestPrice(code) {
    for (let i = tradingDates.length - 1; i >= 0; i--) {
      const m = priceHistory.get(tradingDates[i]);
      if (m && m.has(code)) return { date: tradingDates[i], 종가: m.get(code).종가 };
    }
    return null;
  }

  const recoveries = [];
  for (const [code, meta] of stockDateRange) {
    const sortedDates = [...meta.dates].sort();
    const firstDate   = sortedDates[0];

    let bottomDate = null, bottomPrice = Infinity;
    for (const d of tradingDates) {
      if (d < firstDate) continue;
      const m = priceHistory.get(d);
      if (!m || !m.has(code)) continue;
      const p = m.get(code).종가;
      if (p < bottomPrice) { bottomPrice = p; bottomDate = d; }
    }
    if (!bottomDate) continue;

    const latest = latestPrice(code);
    if (!latest) continue;

    const 상승률 = (latest.종가 / bottomPrice - 1) * 100;
    const deviations = findingsB
      .filter(f => f.종목코드 === code)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(f => ({ date: f.date, ratio: f.ratio }));

    recoveries.push({
      종목코드: code, 종목명: meta.종목명, 시장: meta.시장,
      bottomDate, bottomPrice,
      latestDate: latest.date, latestPrice: latest.종가,
      상승률, deviations,
    });
  }

  recoveries.sort((a, b) => b.상승률 - a.상승률);

  const HDR = `  ${'종목명'.padEnd(12)}  ${'시장'.padEnd(6)}  ${'종가저점일'.padEnd(10)}  ${'저점가'.padStart(10)}  ${'최근가'.padStart(10)}  ${'저점대비'.padStart(8)}  ${'괴리일'.padEnd(10)}  ${'괴리율'.padStart(7)}`;
  console.log('\n' + HDR);
  console.log('  ' + '─'.repeat(88));

  for (const r of recoveries) {
    const s = r.상승률 >= 0 ? '+' : '';
    const summary = `  ${r.종목명.padEnd(12)}  ${r.시장.padEnd(6)}  ${fmtDate(r.bottomDate).padEnd(10)}  ${fmtNum(r.bottomPrice).padStart(10)}  ${fmtNum(r.latestPrice).padStart(10)}  ${(s+r.상승률.toFixed(1)+'%').padStart(8)}`;
    for (const dev of r.deviations)
      console.log(`${summary}  ${fmtDate(dev.date).padEnd(10)}  ${dev.ratio.toFixed(1).padStart(6)}%`);
    console.log('  ' + '─'.repeat(88));
  }

  console.log('');
  const recovered  = recoveries.filter(r => r.상승률 >= 10);
  const stillDown  = recoveries.filter(r => r.상승률 < 0);
  const nearBottom = recoveries.filter(r => r.상승률 >= 0 && r.상승률 < 10);
  console.log(`  ✔ 저점 대비 +10% 이상 반등: ${recovered.map(r=>r.종목명).join(', ') || '없음'}`);
  console.log(`  ▲ 소폭 반등(0~+10%):       ${nearBottom.map(r=>r.종목명).join(', ') || '없음'}`);
  console.log(`  ▼ 저점 대비 추가 하락 중:   ${stillDown.map(r=>r.종목명).join(', ') || '없음'}`);
  console.log('═'.repeat(88) + '\n');

  // ── 10. 종가저점 후 MA20 터치/돌파 분석
  console.log('\n' + '═'.repeat(88));
  console.log(` 【MA20 터치/돌파 분석】 종가저점 이후 (${pd} · ${stockDateRange.size}종목)`);
  console.log(' ▪ 고가 터치 = 장중 고가 ≥ MA20   ▪   종가 돌파 = 종가 ≥ MA20');
  console.log(' ▪ 종가저점일 다음 거래일부터 탐색');
  console.log('═'.repeat(88));

  const ma20Events = [];

  for (const r of recoveries) {
    const bottomIdx = tradingDates.indexOf(r.bottomDate);
    const datesAfterBottom = bottomIdx >= 0 ? tradingDates.slice(bottomIdx + 1) : [];

    let firstEvent = null;
    for (const d of datesAfterBottom) {
      const di = tradingDates.indexOf(d);
      const lb = tradingDates.slice(Math.max(0, di - 19), di + 1);
      const prices = [];
      for (const ld of lb) {
        const m = priceHistory.get(ld);
        if (m && m.has(r.종목코드)) prices.push(m.get(r.종목코드).종가);
      }
      if (prices.length < 5) continue;
      const ma20 = prices.reduce((a, b) => a + b, 0) / prices.length;

      const dayMap = priceHistory.get(d);
      if (!dayMap || !dayMap.has(r.종목코드)) continue;
      const stock = dayMap.get(r.종목코드);

      if (stock.종가 >= ma20) {
        firstEvent = { date: d, type: '종가돌파', price: stock.종가, ma20: Math.round(ma20) };
        break;
      }
      if (stock.고가 && stock.고가 >= ma20) {
        firstEvent = { date: d, type: '고가터치', price: stock.고가, ma20: Math.round(ma20) };
        break;
      }
    }

    // 저점일 MA20 괴리율 계산
    let bottomRatio = null;
    if (bottomIdx >= 0) {
      const lb = tradingDates.slice(Math.max(0, bottomIdx - 19), bottomIdx + 1);
      const ps = [];
      for (const ld of lb) {
        const m = priceHistory.get(ld);
        if (m && m.has(r.종목코드)) ps.push(m.get(r.종목코드).종가);
      }
      if (ps.length >= 5) {
        const ma20AtBottom = ps.reduce((a, b) => a + b, 0) / ps.length;
        bottomRatio = (r.bottomPrice / ma20AtBottom - 1) * 100;
      }
    }

    // 현재 MA20 괴리율 계산
    let currentMA20 = null, currentRatio = null;
    const lastDi = tradingDates.indexOf(r.latestDate);
    if (lastDi >= 0) {
      const lb = tradingDates.slice(Math.max(0, lastDi - 19), lastDi + 1);
      const ps = [];
      for (const ld of lb) {
        const m = priceHistory.get(ld);
        if (m && m.has(r.종목코드)) ps.push(m.get(r.종목코드).종가);
      }
      if (ps.length >= 5) {
        currentMA20 = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
        currentRatio = (r.latestPrice / currentMA20 - 1) * 100;
      }
    }

    ma20Events.push({ ...r, firstEvent, bottomRatio, currentMA20, currentRatio });
  }

  const touchedStocks    = ma20Events.filter(r => r.firstEvent);
  const notTouchedStocks = ma20Events.filter(r => !r.firstEvent);

  // 날짜별로 정렬해서 출력
  const byTouchDate = {};
  for (const r of touchedStocks) {
    const k = r.firstEvent.date;
    if (!byTouchDate[k]) byTouchDate[k] = [];
    byTouchDate[k].push(r);
  }

  console.log(`\n  ■ 터치/돌파 완료: ${touchedStocks.length}개 종목`);
  if (touchedStocks.length > 0) {
    for (const date of Object.keys(byTouchDate).sort()) {
      console.log(`\n  ▶ ${fmtDate(date)}`);
      for (const r of byTouchDate[date]) {
        const ev = r.firstEvent;
        const touchRatio = (ev.price / r.bottomPrice - 1) * 100;
        const sp = touchRatio >= 0 ? '+' : '';
        const brStr = r.bottomRatio != null ? `${r.bottomRatio.toFixed(1)}%` : '─';
        console.log(`    ${r.종목명.padEnd(14)} ${r.시장.padEnd(6)}  저점 ${fmtDate(r.bottomDate)}  ${fmtNum(r.bottomPrice).padStart(9)}원  (저점괴리 ${brStr.padStart(7)})  →  ${ev.type}  ${fmtNum(ev.price).padStart(9)}원  (MA20 ${fmtNum(ev.ma20)}원)  상승폭 ${sp}${touchRatio.toFixed(1)}%`);
      }
    }
  } else {
    console.log('\n  (없음)');
  }

  console.log(`\n  ■ 미돌파: ${notTouchedStocks.length}개 종목`);
  if (notTouchedStocks.length > 0) {
    console.log(`\n    ${'종목명'.padEnd(14)} ${'시장'.padEnd(6)}  ${'저점일'.padEnd(12)}  ${'저점가'.padStart(9)}  ${'현재가'.padStart(9)}  ${'저점대비'.padStart(8)}  ${'현재MA20'.padStart(9)}  ${'현재괴리율'.padStart(9)}`);
    console.log('    ' + '─'.repeat(88));
    const sorted = notTouchedStocks.sort((a, b) => (b.currentRatio ?? -Infinity) - (a.currentRatio ?? -Infinity));
    for (const r of sorted) {
      const sp = r.상승률 >= 0 ? '+' : '';
      const ma20Str  = r.currentMA20  != null ? fmtNum(r.currentMA20) + '원' : '─';
      const ratioStr = r.currentRatio != null ? `${r.currentRatio.toFixed(1)}%`  : '─';
      console.log(`    ${r.종목명.padEnd(14)} ${r.시장.padEnd(6)}  ${fmtDate(r.bottomDate).padEnd(12)}  ${fmtNum(r.bottomPrice).padStart(9)}  ${fmtNum(r.latestPrice).padStart(9)}  ${(sp + r.상승률.toFixed(1) + '%').padStart(8)}  ${ma20Str.padStart(9)}  ${ratioStr.padStart(9)}`);
    }
  } else {
    console.log('\n  (없음)');
  }

  console.log('\n' + '═'.repeat(88) + '\n');

  // ── HTML 리포트 자동 생성
  const stockSummaryB = {};
  for (const f of findingsB) {
    if (!stockSummaryB[f.종목명]) stockSummaryB[f.종목명] = { 시장: f.시장, 종목코드: f.종목코드, 건수: 0, 최대괴리: 0, 현재괴리: null, 날짜들: [] };
    stockSummaryB[f.종목명].건수++;
    if (f.ratio < stockSummaryB[f.종목명].최대괴리) stockSummaryB[f.종목명].최대괴리 = f.ratio;
    stockSummaryB[f.종목명].날짜들.push(f.date);
  }
  for (const [, s] of Object.entries(stockSummaryB)) {
    const code = s.종목코드;
    let latestP = null, latestDi = -1;
    for (let i = tradingDates.length - 1; i >= 0; i--) {
      const m = priceHistory.get(tradingDates[i]);
      if (m && m.has(code)) { latestP = m.get(code).종가; latestDi = i; break; }
    }
    if (latestP == null) continue;
    const lb = tradingDates.slice(Math.max(0, latestDi - 19), latestDi + 1);
    const ps = [];
    for (const ld of lb) { const m = priceHistory.get(ld); if (m && m.has(code)) ps.push(m.get(code).종가); }
    if (ps.length >= 5) s.현재괴리 = (latestP / (ps.reduce((a, b) => a + b, 0) / ps.length) - 1) * 100;
  }
  generateAndSaveHTML({
    period: { start: targetDates[0], end: targetDates[targetDates.length - 1], pd },
    universeSize: universeMap.size,
    findingsA, findingsB,
    stockSummaryB,
    recoveries, ma20Events,
    latestDate,
  });

  // ── 11. 최근 거래일 미포함 종목 탐지
  const latestMap       = priceHistory.get(latestDate);
  const missingAnalysis = [...stockDateRange.entries()].filter(([code]) => !latestMap?.has(code));
  if (missingAnalysis.length > 0) {
    console.error(`${'─'.repeat(60)}`);
    console.error(`[요청] ${fmtDate(latestDate)} 종가 미확보 — 분석 대상 종목:`);
    for (const [code, info] of missingAnalysis)
      console.error(`  → ${info.종목명} (${code})`);
    console.error(`  ※ MANUAL_PRICES['${latestDate}'] 에 추가 후 재실행`);
    console.error(`${'─'.repeat(60)}`);
  }
}

// ─── HTML 리포트 생성 ───────────────────────────────────────────────────────
function generateAndSaveHTML({ period, universeSize, findingsA, findingsB, stockSummaryB, recoveries, ma20Events, latestDate }) {
  const now = new Date(Date.now() + 9*3600*1000);
  const p2  = n => String(n).padStart(2,'0');
  const ts  = `${now.getUTCFullYear()}${p2(now.getUTCMonth()+1)}${p2(now.getUTCDate())}${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
  const { start, end, pd } = period;

  // ── 유틸
  const esc  = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fN   = n => n!=null ? Number(n).toLocaleString('ko-KR') : '─';
  const rS   = r => (r>=0?'+':'')+r.toFixed(1)+'%';
  const rc   = r => r<=-25?'t-neg-hi':r<-5?'t-neg':r>=10?'t-pos':'t-flat';
  const fMD  = s => s.slice(4,6)+'-'+s.slice(6,8);
  const dow  = s => { const d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`); return ['일','월','화','수','목','금','토'][d.getDay()]; };
  const latestFmt = fmtDate(latestDate);

  // ── 데이터 가공
  const latestFindingsB = findingsB.filter(f=>f.date===latestDate).sort((a,b)=>a.ratio-b.ratio);
  const findingsAByDate = {};
  for (const f of findingsA) { if(!findingsAByDate[f.date])findingsAByDate[f.date]=[]; findingsAByDate[f.date].push(f); }
  const ssB = Object.entries(stockSummaryB).sort((a,b)=>b[1].건수-a[1].건수||a[1].최대괴리-b[1].최대괴리);
  const touchedStocks = ma20Events.filter(r=>r.firstEvent);
  const notTouched    = ma20Events.filter(r=>!r.firstEvent).sort((a,b)=>(b.currentRatio??-Infinity)-(a.currentRatio??-Infinity));
  const recovered  = recoveries.filter(r=>r.상승률>=10);
  const nearBottom = recoveries.filter(r=>r.상승률>=0&&r.상승률<10);
  const stillDown  = recoveries.filter(r=>r.상승률<0);
  const uA = [...new Set(findingsA.map(f=>f.종목명))].length;
  const uB = [...new Set(findingsB.map(f=>f.종목명))].length;

  // 방식A 종목 요약
  const ssA = {};
  for (const f of findingsA) {
    if(!ssA[f.종목명]) ssA[f.종목명]={시장:f.시장,건수:0,최대괴리:0,날짜들:[]};
    ssA[f.종목명].건수++;
    if(f.ratio<ssA[f.종목명].최대괴리) ssA[f.종목명].최대괴리=f.ratio;
    ssA[f.종목명].날짜들.push(fMD(f.date));
  }

  // ── 날짜 섹션 생성 헬퍼
  function dateSection(date, items) {
    const sorted = [...items].sort((a,b)=>a.ratio-b.ratio);
    const tag = date===latestDate
      ? `<span class="date-tag today">최근거래일</span>`
      : `<span class="date-tag">${dow(date)}</span>`;
    const trows = sorted.map(f=>
      `<tr><td class="c t-rank">${f.rank?f.rank+'위':'─'}</td><td class="l t-name">${esc(f.종목명)}</td><td class="c t-mkt">${f.시장}</td><td class="t-price">${fN(f.종가)}</td><td>${fN(f.ma20)}</td><td class="${rc(f.ratio)}">${f.ratio.toFixed(1)}%</td></tr>`
    ).join('');
    const cards = sorted.map(f=>
      `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(f.종목명)}</span><span class="sc-ratio ${rc(f.ratio)}">${f.ratio.toFixed(1)}%</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">시장</span><span class="sc-item-v">${f.시장}</span></div><div class="sc-item"><span class="sc-item-l">순위</span><span class="sc-item-v">${f.rank?f.rank+'위':'─'}</span></div><div class="sc-item"><span class="sc-item-l">종가</span><span class="sc-item-v">${fN(f.종가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20</span><span class="sc-item-v">${fN(f.ma20)}원</span></div></div></div>`
    ).join('');
    return `<div class="date-hdr"><span class="date-lbl">${fmtDate(date)}</span>${tag}</div><div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="c">순위</th><th class="l">종목명</th><th class="c">시장</th><th>종가</th><th>MA20</th><th>괴리율</th></tr></thead><tbody>${trows}</tbody></table></div><div class="stock-cards">${cards}</div>`;
  }

  // ── 패널별 데이터 행
  const p0Rows  = latestFindingsB.map(f=>
    `<tr><td class="c t-rank" style="color:${f.inTop10?'var(--coral)':'var(--amber)'}">방식${f.inTop10?'A':'B'}</td><td class="l t-name">${esc(f.종목명)}</td><td class="c t-mkt mob-hide">${f.시장}</td><td class="t-price">${fN(f.종가)}</td><td class="mob-hide">${fN(f.ma20)}</td><td class="${rc(f.ratio)}">${f.ratio.toFixed(1)}%</td><td class="c mob-hide"><span class="badge ${f.rank&&f.rank<=10?'bdg-coral':'bdg-gray'}">${f.rank?f.rank+'위':'─'}</span></td></tr>`
  ).join('');
  const p0Cards = latestFindingsB.map(f=>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(f.종목명)}</span><span class="sc-ratio ${rc(f.ratio)}">${f.ratio.toFixed(1)}%</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">구분</span><span class="sc-item-v" style="color:${f.inTop10?'var(--coral)':'var(--amber)'}">방식${f.inTop10?'A':'B'}</span></div><div class="sc-item"><span class="sc-item-l">시장</span><span class="sc-item-v">${f.시장}</span></div><div class="sc-item"><span class="sc-item-l">종가</span><span class="sc-item-v">${fN(f.종가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20</span><span class="sc-item-v">${fN(f.ma20)}원</span></div></div></div>`
  ).join('');

  const p1Sections = Object.keys(findingsAByDate).sort().map(d=>dateSection(d, findingsAByDate[d])).join('');
  const ssAEntries = Object.entries(ssA).sort((a,b)=>b[1].건수-a[1].건수||a[1].최대괴리-b[1].최대괴리);
  const p1SumRows  = ssAEntries
    .map(([nm,s])=>`<tr><td class="l t-name">${esc(nm)}</td><td class="c t-mkt mob-hide">${s.시장}</td><td class="c t-days">${s.건수}일</td><td class="${rc(s.최대괴리)}">${s.최대괴리.toFixed(1)}%</td><td class="c mob-hide" style="font-size:11.5px;color:var(--txt)">${s.날짜들.join('·')}</td></tr>`).join('');
  const p1SumCards = ssAEntries
    .map(([nm,s])=>`<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(nm)}</span><span class="sc-ratio ${rc(s.최대괴리)}">${s.최대괴리.toFixed(1)}%</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">시장</span><span class="sc-item-v">${s.시장}</span></div><div class="sc-item"><span class="sc-item-l">이탈일수</span><span class="sc-item-v">${s.건수}일</span></div><div class="sc-item sc-full"><span class="sc-item-l">이탈일</span><span class="sc-item-v" style="font-size:11.5px;color:var(--txt2)">${s.날짜들.join('·')}</span></div></div></div>`).join('');

  const p2LatestSection = latestFindingsB.length ? dateSection(latestDate, latestFindingsB) : '<div class="empty"><div class="msg">해당 없음</div></div>';
  const p2SumRows = ssB.map(([nm,s])=>
    `<tr><td class="l t-name">${esc(nm)}</td><td class="c t-mkt mob-hide">${s.시장}</td><td class="c t-days">${s.건수}일</td><td class="${rc(s.최대괴리)}">${s.최대괴리.toFixed(1)}%</td><td class="${s.현재괴리!=null?rc(s.현재괴리):'t-flat'}">${s.현재괴리!=null?s.현재괴리.toFixed(1)+'%':'─'}</td><td class="c mob-hide" style="font-size:11px;color:var(--txt)">${s.날짜들.map(fMD).join('·')}</td></tr>`
  ).join('');
  const p2SumCards = ssB.map(([nm,s])=>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(nm)}</span><span class="sc-ratio ${rc(s.최대괴리)}">${s.최대괴리.toFixed(1)}%</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">시장</span><span class="sc-item-v">${s.시장}</span></div><div class="sc-item"><span class="sc-item-l">이탈일수</span><span class="sc-item-v">${s.건수}일</span></div><div class="sc-item"><span class="sc-item-l">최대괴리</span><span class="sc-item-v ${rc(s.최대괴리)}">${s.최대괴리.toFixed(1)}%</span></div><div class="sc-item"><span class="sc-item-l">현재괴리</span><span class="sc-item-v ${s.현재괴리!=null?rc(s.현재괴리):'t-flat'}">${s.현재괴리!=null?s.현재괴리.toFixed(1)+'%':'─'}</span></div><div class="sc-item sc-full"><span class="sc-item-l">이탈일</span><span class="sc-item-v" style="font-size:11.5px;color:var(--txt)">${s.날짜들.map(fMD).join('·')}</span></div></div></div>`
  ).join('');

  const p3Rows = recoveries.map(r=>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="c t-mkt mob-hide">${r.시장}</td><td class="c">${fMD(r.bottomDate)}</td><td class="t-price mob-hide">${fN(r.bottomPrice)}</td><td class="t-price">${fN(r.latestPrice)}</td><td class="${rc(r.상승률)}">${rS(r.상승률)}</td></tr>`
  ).join('');
  const p3Cards = recoveries.map(r=>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${rc(r.상승률)}">${rS(r.상승률)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">시장</span><span class="sc-item-v">${r.시장}</span></div><div class="sc-item"><span class="sc-item-l">저점일</span><span class="sc-item-v">${fMD(r.bottomDate)}</span></div><div class="sc-item"><span class="sc-item-l">저점가</span><span class="sc-item-v">${fN(r.bottomPrice)}원</span></div><div class="sc-item"><span class="sc-item-l">최근가</span><span class="sc-item-v">${fN(r.latestPrice)}원</span></div></div></div>`
  ).join('');

  const p4TouchRows = touchedStocks.map(r=>{
    const ev=r.firstEvent, tr2=(ev.price/r.bottomPrice-1)*100;
    const brStr=r.bottomRatio!=null?r.bottomRatio.toFixed(1)+'%':'─';
    return `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="c t-mkt">${r.시장}</td><td class="c">${fMD(r.bottomDate)}</td><td class="t-price">${fN(r.bottomPrice)}</td><td class="${rc(r.bottomRatio??0)}">${brStr}</td><td class="c"><span class="badge bdg-teal">${ev.type}</span></td><td class="c">${fMD(ev.date)}</td><td class="t-price">${fN(ev.price)}</td><td>${fN(ev.ma20)}</td><td class="t-pos">${rS(tr2)}</td></tr>`;
  }).join('');
  const p4TouchCards = touchedStocks.map(r=>{
    const ev=r.firstEvent, tr2=(ev.price/r.bottomPrice-1)*100;
    return `<div class="stock-card" style="border-top:3px solid var(--teal600)"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio t-pos">${rS(tr2)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">저점일</span><span class="sc-item-v">${fMD(r.bottomDate)}</span></div><div class="sc-item"><span class="sc-item-l">터치일</span><span class="sc-item-v">${fMD(ev.date)}</span></div><div class="sc-item"><span class="sc-item-l">저점가</span><span class="sc-item-v">${fN(r.bottomPrice)}원</span></div><div class="sc-item"><span class="sc-item-l">터치가</span><span class="sc-item-v">${fN(ev.price)}원</span></div><div class="sc-item"><span class="sc-item-l">저점괴리</span><span class="sc-item-v ${rc(r.bottomRatio??0)}">${r.bottomRatio!=null?r.bottomRatio.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">터치유형</span><span class="sc-item-v" style="color:var(--teal600)">${ev.type}</span></div></div></div>`;
  }).join('');
  const p4MissRows = notTouched.map(r=>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="c t-mkt">${r.시장}</td><td class="c">${fMD(r.bottomDate)}</td><td class="t-price">${fN(r.bottomPrice)}</td><td class="t-price">${fN(r.latestPrice)}</td><td class="${rc(r.상승률)}">${rS(r.상승률)}</td><td>${fN(r.currentMA20)}원</td><td class="${rc(r.currentRatio??0)}">${r.currentRatio!=null?r.currentRatio.toFixed(1)+'%':'─'}</td></tr>`
  ).join('');
  const p4MissCards = notTouched.map(r=>
    `<div class="stock-card"${(r.currentRatio??0)<=-25?' style="border-top:3px solid var(--red)"':''}><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${rc(r.currentRatio??0)}">${r.currentRatio!=null?r.currentRatio.toFixed(1)+'%':'─'}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">저점가</span><span class="sc-item-v">${fN(r.bottomPrice)}원</span></div><div class="sc-item"><span class="sc-item-l">현재MA20</span><span class="sc-item-v">${fN(r.currentMA20)}원</span></div></div></div>`
  ).join('');

  // ── AI 인사이트 계산
  const _cr  = latestFindingsB.map(f=>f.ratio);
  const _avgCr = _cr.length ? _cr.reduce((s,v)=>s+v,0)/_cr.length : null;
  const _worst = latestFindingsB[0]??null;
  const _kospiN  = latestFindingsB.filter(f=>f.시장==='KOSPI').length;
  const _kosdaqN = latestFindingsB.filter(f=>f.시장==='KOSDAQ').length;
  const _recOk = recoveries.filter(r=>r.상승률>=10).sort((a,b)=>b.상승률-a.상승률);
  const _bestRec  = _recOk[0]??null;
  const _worstRec = [...recoveries].sort((a,b)=>a.상승률-b.상승률)[0]??null;
  const _recPct = recoveries.length ? Math.round(_recOk.length/recoveries.length*100) : 0;
  const _recAvg = _recOk.length ? (_recOk.reduce((s,r)=>s+r.상승률,0)/_recOk.length).toFixed(1) : null;
  const _avgTG = touchedStocks.length ? (touchedStocks.reduce((s,r)=>{const ev=r.firstEvent;return s+(ev.price/r.bottomPrice-1)*100;},0)/touchedStocks.length).toFixed(1) : null;
  const _nearMA = [...notTouched].sort((a,b)=>(b.currentRatio??-Infinity)-(a.currentRatio??-Infinity)).slice(0,3);
  const _persistS = ssB.filter(([,s])=>s.건수>=5);
  const _aiIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;
  const _aiHdr = (t) => `<div class="ai-title">${_aiIcon} ${t}<span class="badge bdg-sky ai-badge" style="font-size:11px">AI 분석</span></div>`;
  const _ai = (dot, h) => `<div class="ai-item"><div class="ai-dot ai-dot-${dot}"></div><div>${h}</div></div>`;

  const aiCard0 = `<div class="ai-sc">${_aiHdr('AI 분석 인사이트')}<div class="ai-list">${[
    _cr.length
      ? _ai('red', `<b>이탈 강도</b> — ${latestFindingsB.length}종목 이탈 중, 평균 괴리율 <span class="hi">${_avgCr.toFixed(1)}%</span>${_worst ? ` · 최심각: <b>${esc(_worst.종목명)}</b> (<span class="hi">${_worst.ratio.toFixed(1)}%</span>)` : ''}`)
      : _ai('teal', '최근거래일 기준 MA20 이탈 종목 없음 — 안정적 상태'),
    _cr.length ? _ai('sky', `<b>시장 분포</b> — KOSPI <b>${_kospiN}</b> / KOSDAQ <b>${_kosdaqN}</b>종목 이탈${_kospiN > _kosdaqN ? ' · KOSPI 집중 양상' : _kosdaqN > _kospiN ? ' · KOSDAQ 집중 양상' : ' · 균등 분포'}`) : null,
    recoveries.length ? _ai('teal', `<b>반등 현황</b> — 추적 ${recoveries.length}종목 중 <b>${_recOk.length}</b>종목(${_recPct}%) +10%↑ 성공${_bestRec ? ` · 선두: <b>${esc(_bestRec.종목명)}</b> <span class="ok">${rS(_bestRec.상승률)}</span>` : ''}`) : null,
    (touchedStocks.length || notTouched.length) ? _ai('amber', `<b>MA20 회복</b> — 돌파 완료 <b>${touchedStocks.length}</b>종목${_avgTG ? ` (평균 <span class="ok">+${_avgTG}%</span>)` : ''} · 미돌파 <b>${notTouched.length}</b>종목 진행 중${_nearMA.length ? ` · 근접 후보: ${_nearMA.map(r=>`<b>${esc(r.종목명)}</b>`).join(', ')}` : ''}`) : null,
    _persistS.length ? _ai('purple', `<b>지속 이탈 경고</b> — 5일↑ 연속 이탈: ${_persistS.map(([nm,s])=>`<b>${esc(nm)}</b>(${s.건수}일)`).join(' · ')} · 단기 반등보다 구조적 약세 원인 점검 권장`) : null,
  ].filter(Boolean).join('')}</div></div>`;

  const aiCard3 = (() => {
    const items = [
      _recOk.length ? _ai('teal', `<b>반등 성공</b>(+10%↑) <b>${_recOk.length}</b>종목${_recAvg ? ` · 평균 <span class="ok">+${_recAvg}%</span>` : ''} · 최고: <b>${esc(_recOk[0].종목명)}</b> <span class="ok">${rS(_recOk[0].상승률)}</span>`) : null,
      nearBottom.length ? _ai('amber', `<b>소폭 반등</b>(0~10%) <b>${nearBottom.length}</b>종목 · MA20 재터치 여부가 단기 방향성 분기점`) : null,
      _worstRec && _worstRec.상승률 < 0 ? _ai('red', `<b>추가 하락 주의</b> · 낙폭 최대: <b>${esc(_worstRec.종목명)}</b> <span class="hi">${rS(_worstRec.상승률)}</span> · 저점 재탐색 가능성 유의`) : null,
    ].filter(Boolean).join('');
    return items ? `<div class="ai-sc">${_aiHdr('저점 패턴 분석')}<div class="ai-list">${items}</div></div>` : '';
  })();

  const aiCard4 = (() => {
    const deepDown = notTouched.filter(r=>(r.currentRatio??0)<-25);
    const items = [
      _avgTG ? _ai('teal', `<b>돌파 완료 평균 상승폭</b> <span class="ok">+${_avgTG}%</span> · 저점 이후 MA20 터치까지 평균 수익 구간 확인`) : null,
      _nearMA.length ? _ai('sky', `<b>MA20 근접 후보</b> · ${_nearMA.map(r=>`<b>${esc(r.종목명)}</b>(${r.currentRatio!=null?r.currentRatio.toFixed(1)+'%':'─'})`).join(' · ')} · 돌파 시 단기 수익 실현 가능`) : null,
      deepDown.length ? _ai('red', `<b>심층 이탈 주의</b> · 현재괴리 -25% 이하 <b>${deepDown.length}</b>종목 · 반등 시 강한 MA20 저항 구간 예상`) : null,
    ].filter(Boolean).join('');
    return items ? `<div class="ai-sc">${_aiHdr('MA20 회복 전망')}<div class="ai-list">${items}</div></div>` : '';
  })();

  // ── CSS
  const CSS = `:root{
  --sky:#378ADD;--sky50:#E6F1FB;--sky100:#B5D4F4;--sky600:#185FA5;--sky800:#0C447C;
  --teal:#1D9E75;--teal50:#E1F5EE;--teal600:#147a5a;
  --coral:#D85A30;--coral50:#FAECE7;
  --amber:#BA7517;--amber50:#FAEEDA;
  --green:#639922;--green50:#EAF3DE;
  --purple:#534AB7;--purple50:#EEEDFE;
  --red:#D8302F;--red50:#FBE9E8;--blue:#2563C9;--blue50:#E7EFFB;
  --gray50:#F1EFE8;--gray600:#5F5E5A;
  --bg:#F5F8FF;--card:#FFFFFF;--border:#E0EAF5;--border2:#EBF3FF;
  --txt:#1A2535;--txt2:#3D4F68;--txt3:#6B7E99;
  --r8:8px;--r12:12px;--r16:16px;--r20:20px;
  --shadow:0 2px 12px rgba(55,138,221,.08);--shadow-h:0 6px 24px rgba(55,138,221,.15);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;word-break:keep-all;color:var(--txt);background:var(--bg);-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;min-height:100dvh}
.hdr-wrap{position:fixed;top:0;left:0;right:0;z-index:50;box-shadow:0 2px 12px rgba(12,68,124,.18);user-select:none;-webkit-user-select:none}
.header{background:var(--sky800);padding:max(12px,env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;justify-content:space-between;max-width:1100px;margin:0 auto}
.header-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0;overflow:hidden}
.logo-mark{width:38px;height:38px;background:rgba(255,255,255,.15);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.logo-mark svg{display:block}
.logo-info{display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden}
.logo-title{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logo-sub{font-size:11.5px;color:rgba(255,255,255,.90);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;margin-left:10px}
.hdr-date{font-size:12.5px;font-weight:700;color:#fff;white-space:nowrap}
.hdr-meta{font-size:11px;color:rgba(255,255,255,.88);white-space:nowrap}
.nav-spacer{height:calc(104px + env(safe-area-inset-top,0px))}
.top-nav{background:#fff;border-bottom:1.5px solid var(--border);display:flex;padding:0 4px;max-width:1100px;margin:0 auto;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.top-nav::-webkit-scrollbar{display:none}
.tab-btn{flex:1;flex-shrink:0;min-width:64px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--txt);font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;padding:13px 6px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:color .15s;position:relative;white-space:nowrap}
.tab-btn.on{color:var(--sky600)}
.tab-btn.on::after{content:'';position:absolute;bottom:0;left:8%;right:8%;height:2.5px;background:var(--sky);border-radius:2px 2px 0 0}
.tab-btn:hover:not(.on){color:var(--txt)}
.tab-badge{display:inline-flex;align-items:center;justify-content:center;background:var(--sky100);color:var(--sky800);font-size:11.5px;font-weight:800;border-radius:9px;padding:1px 6px;margin-left:4px;min-width:18px}
.tab-btn.on .tab-badge{background:var(--sky);color:#fff}
.main{padding:0 14px max(14px,env(safe-area-inset-bottom))}
.panel{display:none}
.panel.on{display:block;animation:fade .22s}
@keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.kpi-row{display:flex;gap:9px;margin-bottom:14px;padding-top:10px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:80px;background:var(--card);border:1px solid var(--border);border-radius:var(--r12);padding:12px 10px;text-align:center;box-shadow:var(--shadow)}
.kpi-card .num{font-size:20px;font-weight:800;line-height:1.1}
.kpi-card .lbl{font-size:13px;margin-top:4px;font-weight:700;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi-sky .num,.kpi-sky .lbl{color:var(--sky600)}
.kpi-red .num,.kpi-red .lbl{color:var(--red)}
.kpi-blue .num,.kpi-blue .lbl{color:var(--blue)}
.kpi-coral .num,.kpi-coral .lbl{color:var(--coral)}
.kpi-teal .num,.kpi-teal .lbl{color:var(--teal600)}
.kpi-amber .num,.kpi-amber .lbl{color:var(--amber)}
.kpi-purple .num,.kpi-purple .lbl{color:var(--purple)}
.sc{background:var(--card);border-radius:var(--r12);border:1px solid var(--border);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.sc-title{font-size:14.5px;font-weight:800;color:var(--txt);margin-bottom:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.sc-title .sub{font-size:12px;font-weight:600;color:var(--txt2)}
.badge{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap}
.bdg-red{background:var(--red50);color:var(--red)}
.bdg-blue{background:var(--blue50);color:var(--blue)}
.bdg-sky{background:var(--sky50);color:var(--sky600)}
.bdg-teal{background:var(--teal50);color:var(--teal600)}
.bdg-amber{background:var(--amber50);color:var(--amber)}
.bdg-coral{background:var(--coral50);color:var(--coral)}
.bdg-gray{background:var(--gray50);color:var(--gray600)}
.sc-note{font-size:12.5px;color:var(--txt);margin-bottom:12px;line-height:1.6;padding:8px 10px;background:var(--bg);border-radius:var(--r8)}
.date-hdr{display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--border)}
.date-hdr:first-child{margin-top:0}
.date-hdr .date-lbl{font-size:14px;font-weight:800;color:var(--sky800)}
.date-hdr .date-tag{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:9px;background:var(--sky50);color:var(--sky600)}
.date-hdr .date-tag.today{background:var(--sky800);color:#fff}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r8);overscroll-behavior-x:contain}
table{min-width:100%;border-collapse:collapse;font-size:13.5px}
thead th{background:var(--sky50);color:var(--sky800);font-weight:800;font-size:12.5px;padding:9px 8px;text-align:right;white-space:nowrap}
thead th.l{text-align:left}thead th.c{text-align:center}
tbody td{padding:9px 8px;border-bottom:1px solid var(--border2);text-align:right;white-space:nowrap;color:var(--txt);vertical-align:middle}
tbody td.l{text-align:left}tbody td.c{text-align:center}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--sky50)}
.t-rank{font-weight:800;color:var(--txt2)}.t-name{font-weight:700;font-size:14px}.t-mkt{font-size:12px;color:var(--txt);font-weight:600}
.t-neg-hi{color:var(--red);font-weight:800}.t-neg{color:var(--red);font-weight:700}.t-pos{color:var(--teal600);font-weight:800}.t-flat{color:var(--txt2);font-weight:600}
.t-price{font-weight:700}.t-days{font-weight:700;color:var(--purple)}
.stock-cards{display:none}
.stock-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:13px 14px;margin-bottom:10px}
.stock-card:last-child{margin-bottom:0}
.sc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sc-name{font-size:15px;font-weight:800;color:var(--txt)}
.sc-ratio{font-size:17px;font-weight:900}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
.sc-item{display:flex;flex-direction:column;gap:1px}
.sc-item-l{font-size:12.5px;color:var(--txt);font-weight:700}
.sc-item-v{font-size:14px;font-weight:700;color:var(--txt)}.sc-full{grid-column:1/-1}
.summary-sc{border-left:3px solid var(--sky);padding-left:12px;margin-bottom:14px}
.summary-line{font-size:13.5px;color:var(--txt);line-height:1.8;margin-bottom:2px}
.summary-line b{font-weight:800;color:var(--txt)}
.summary-line .hi{color:var(--red);font-weight:700}
.summary-line .ok{color:var(--teal600);font-weight:700}
.touch-banner{background:var(--teal50);border:1.5px solid var(--teal600);border-radius:var(--r12);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:var(--teal600)}
.miss-banner{background:var(--red50);border:1.5px solid var(--red);border-radius:var(--r12);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:var(--red)}
.empty{text-align:center;padding:40px 20px;color:var(--txt2)}
.empty .msg{font-size:14px;font-weight:700;color:var(--txt2)}
.footer{margin-top:20px;font-size:12px;color:var(--txt2);text-align:center;padding:12px 0 24px;border-top:1px solid var(--border)}
@media(max-width:374px){.logo-sub{display:none}.tab-btn{font-size:12px;padding:11px 2px;min-width:52px}.tab-badge{display:none}.kpi-card{min-width:60px;padding:8px 4px}.kpi-card .num{font-size:16px}.kpi-card .lbl{font-size:11px}}
@media(max-width:600px){.nav-spacer{height:calc(108px + env(safe-area-inset-top,0px))}.main{padding:0 10px max(20px,env(safe-area-inset-bottom))}.sc{padding:12px 12px}.sc-title{font-size:14px;gap:5px}.kpi-row{gap:6px;padding-top:8px;margin-bottom:12px}.kpi-card{min-width:64px;padding:9px 6px}.kpi-card .num{font-size:19px}.kpi-card .lbl{font-size:12.5px;margin-top:3px}.tab-btn{font-size:13px;padding:12px 4px}table{font-size:12.5px}thead th,tbody td{padding:8px 5px}.t-name{font-size:13.5px}.stock-cards{display:block}.stock-cards-target{display:none}.mob-hide{display:none!important}}
@media(min-width:601px) and (max-width:900px){.kpi-card .num{font-size:20px}}
@media(min-width:769px){.nav-spacer{height:calc(106px + env(safe-area-inset-top,0px))}.main{padding:0 20px max(20px,env(safe-area-inset-bottom))}.sc{padding:18px 20px}.sc-title{font-size:15px;margin-bottom:14px}.kpi-card{padding:13px 16px}.kpi-card .num{font-size:22px}.kpi-card .lbl{font-size:13px;margin-top:5px}table{font-size:14px}thead th{font-size:13px}thead th,tbody td{padding:10px 9px}.tab-btn{font-size:14px}}
@media(min-width:1024px){.kpi-row{gap:12px}.kpi-card .num{font-size:24px}}.ai-sc{background:linear-gradient(135deg,var(--sky50) 0%,var(--card) 100%);border:1px solid var(--sky100);border-left:4px solid var(--sky);border-radius:var(--r12);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}.ai-title{font-size:14.5px;font-weight:800;color:var(--sky800);margin-bottom:12px;display:flex;align-items:center;gap:8px}.ai-badge{margin-left:auto}.ai-list{display:flex;flex-direction:column;gap:7px}.ai-item{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--txt);line-height:1.55}.ai-dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:8px}.ai-dot-red{background:var(--red)}.ai-dot-teal{background:var(--teal)}.ai-dot-sky{background:var(--sky)}.ai-dot-amber{background:var(--amber)}.ai-dot-purple{background:var(--purple)}`;

  // ── HTML 조립
  const touchSummary = touchedStocks.length
    ? touchedStocks.map(r=>{const ev=r.firstEvent,tr2=(ev.price/r.bottomPrice-1)*100;return `<div class="summary-line"><b>${esc(r.종목명)}</b> — ${fMD(r.bottomDate)} 저점(${fN(r.bottomPrice)}원, <span class="hi">${rS(r.bottomRatio??0)}</span>) → ${fMD(ev.date)} ${ev.type}(${fN(ev.price)}원) <span class="ok">${rS(tr2)}</span></div>`;}).join('')
    : '<div class="summary-line">(없음)</div>';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>MA20 괴리율 분석 — ${latestFmt}</title>
<link rel="preload" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css"></noscript>
<style>${CSS}</style>
</head>
<body>
<div class="hdr-wrap"><div class="wrap">
<div class="header">
  <div class="header-left">
    <div class="logo-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div>
    <div class="logo-info"><div class="logo-title">MA20 괴리율 분석</div><div class="logo-sub">${fmtDate(start)} ~ ${fmtDate(end)} · KRX + Yahoo Finance</div></div>
  </div>
  <div class="header-right"><div class="hdr-date">${latestFmt} 기준</div><div class="hdr-meta">20거래일 · 유니버스 ${universeSize}종목</div></div>
</div>
<nav class="top-nav">
  <button class="tab-btn on" data-tab="0">요약</button>
  <button class="tab-btn" data-tab="1">방식A<span class="tab-badge">${findingsA.length}건</span></button>
  <button class="tab-btn" data-tab="2">방식B<span class="tab-badge">${findingsB.length}건</span></button>
  <button class="tab-btn" data-tab="3">저점분석</button>
  <button class="tab-btn" data-tab="4">터치/돌파</button>
</nav>
</div></div>
<div class="nav-spacer"></div>
<div class="wrap"><div class="main">

<!-- ── Panel 0: 요약 ── -->
<div class="panel on" id="p0">
  <div class="kpi-row">
    <div class="kpi-card kpi-sky"><div class="num">${uB}</div><div class="lbl">이탈종목</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${findingsB.length}</div><div class="lbl">방식B 총건</div></div>
    <div class="kpi-card kpi-coral"><div class="num">${findingsA.length}</div><div class="lbl">방식A 총건</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${touchedStocks.length}</div><div class="lbl">MA20 터치</div></div>
    <div class="kpi-card kpi-red"><div class="num">${notTouched.length}</div><div class="lbl">미돌파</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">${latestFmt} 핵심 현황<span class="badge bdg-red">최근거래일</span></div>
    ${latestFindingsB.length ? `<div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="c">구분</th><th class="l">종목명</th><th class="c mob-hide">시장</th><th>종가</th><th class="mob-hide">MA20</th><th>괴리율</th><th class="c mob-hide">비고</th></tr></thead><tbody>${p0Rows}</tbody></table></div><div class="stock-cards">${p0Cards}</div>` : '<div class="empty"><div class="msg">해당 없음</div></div>'}
  </div>
  <div class="sc">
    <div class="sc-title">MA20 터치/돌파 요약</div>
    ${touchedStocks.length ? `<div class="touch-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>터치/돌파 완료 ${touchedStocks.length}종목</div>` : ''}
    ${notTouched.length ? `<div class="miss-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>미돌파 ${notTouched.length}종목</div>` : ''}
    <div class="summary-sc">${touchSummary}</div>
  </div>
  ${aiCard0}
</div>

<!-- ── Panel 1: 방식A ── -->
<div class="panel" id="p1">
  <div class="kpi-row">
    <div class="kpi-card kpi-coral"><div class="num">${findingsA.length}</div><div class="lbl">총 건수</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${uA}</div><div class="lbl">해당종목</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${Object.keys(findingsAByDate).length}</div><div class="lbl">해당일수</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">【방식A】 당일 TOP10 × MA20 -20% 이하<span class="badge bdg-coral">${pd} · ${findingsA.length}건</span></div>
    <div class="sc-note">당일 거래대금 TOP10 종목 중 MA20 대비 -20% 이하 이탈 종목. 순위는 해당일 거래대금 기준.</div>
    ${p1Sections || '<div class="empty"><div class="msg">해당 없음</div></div>'}
  </div>
  <div class="sc">
    <div class="sc-title">종목별 요약</div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c mob-hide">시장</th><th>이탈일수</th><th>최대괴리율</th><th class="mob-hide">이탈일</th></tr></thead><tbody>${p1SumRows}</tbody></table></div><div class="stock-cards">${p1SumCards}</div>
  </div>
</div>

<!-- ── Panel 2: 방식B ── -->
<div class="panel" id="p2">
  <div class="kpi-row">
    <div class="kpi-card kpi-amber"><div class="num">${findingsB.length}</div><div class="lbl">총 건수</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${uB}</div><div class="lbl">해당종목</div></div>
    <div class="kpi-card kpi-coral"><div class="num">${latestFindingsB.length}</div><div class="lbl">최근일 해당</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">최근거래일(${latestFmt}) 해당 종목<span class="badge bdg-red">${latestFindingsB.length}종목</span></div>
    <div class="sc-note">유니버스 ${universeSize}종목 중 최근 거래일 MA20 -20% 이하. 순위는 전체 거래대금 기준.</div>
    ${p2LatestSection}
  </div>
  <div class="sc">
    <div class="sc-title">종목별 요약 (${uB}종목)<span class="sub">· 현재괴리 = 최근가 기준 MA20 대비</span></div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c mob-hide">시장</th><th>이탈일수</th><th>최대괴리율</th><th>현재괴리율</th><th class="mob-hide">이탈일</th></tr></thead><tbody>${p2SumRows}</tbody></table></div><div class="stock-cards">${p2SumCards}</div>
  </div>
</div>

<!-- ── Panel 3: 저점분석 ── -->
<div class="panel" id="p3">
  <div class="kpi-row">
    <div class="kpi-card kpi-teal"><div class="num">${recovered.length}</div><div class="lbl">+10% 이상</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${nearBottom.length}</div><div class="lbl">소폭 반등</div></div>
    <div class="kpi-card kpi-red"><div class="num">${stillDown.length}</div><div class="lbl">추가 하락</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">【저점 대비 현재 상승률】<span class="badge bdg-sky">${uB}종목</span></div>
    <div class="sc-note">저점 = 방식B 첫 이탈일~최근일 중 실제 최저 종가일. 최근가 = ${latestFmt} 종가.</div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c mob-hide">시장</th><th>저점일</th><th class="mob-hide">저점가</th><th>최근가</th><th>저점대비</th></tr></thead><tbody>${p3Rows}</tbody></table></div><div class="stock-cards">${p3Cards}</div>
  </div>
  <div class="sc">
    <div class="sc-title">저점 분류</div>
    <div class="summary-sc">
      <div class="summary-line"><span class="ok">✔ +10% 이상 반등</span>: ${recovered.length ? recovered.map(r=>esc(r.종목명)).join(', ') : '없음'}</div>
      <div class="summary-line"><span style="color:var(--amber);font-weight:700">▲ 소폭 반등(0~+10%)</span>: ${nearBottom.length ? nearBottom.map(r=>esc(r.종목명)).join(', ') : '없음'}</div>
      <div class="summary-line"><span class="hi">▼ 추가 하락</span>: ${stillDown.length ? stillDown.map(r=>esc(r.종목명)).join(', ') : '없음'}</div>
    </div>
  </div>
  ${aiCard3}
</div>

<!-- ── Panel 4: 터치/돌파 ── -->
<div class="panel" id="p4">
  <div class="kpi-row">
    <div class="kpi-card kpi-teal"><div class="num">${touchedStocks.length}</div><div class="lbl">터치완료</div></div>
    <div class="kpi-card kpi-red"><div class="num">${notTouched.length}</div><div class="lbl">미돌파</div></div>
    ${touchedStocks.length ? `<div class="kpi-card kpi-sky"><div class="num">${rS(Math.max(...touchedStocks.map(r=>(r.firstEvent.price/r.bottomPrice-1)*100)))}</div><div class="lbl">최대상승폭</div></div>` : ''}
  </div>
  <div class="sc">
    <div class="sc-title">【MA20 터치/돌파 완료】<span class="badge bdg-teal">${touchedStocks.length}종목</span></div>
    <div class="sc-note">▪ 종가돌파 = 종가 ≥ MA20 (더 강한 신호) &nbsp;▪ 고가터치 = 장중 고가 ≥ MA20 &nbsp;▪ 종가저점일 다음 거래일부터 탐색</div>
    ${touchedStocks.length ? `<div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c">시장</th><th>저점일</th><th>저점가</th><th>저점괴리율</th><th class="c">터치유형</th><th>터치일</th><th>터치가</th><th>MA20</th><th>상승폭</th></tr></thead><tbody>${p4TouchRows}</tbody></table></div><div class="stock-cards">${p4TouchCards}</div>` : '<div class="empty"><div class="msg">없음</div></div>'}
  </div>
  <div class="sc">
    <div class="sc-title">【MA20 미돌파】<span class="badge bdg-red">${notTouched.length}종목</span></div>
    <div class="sc-note">현재괴리율 낮을수록 MA20 회복에 가까운 종목. 현재괴리율 높은 순 정렬.</div>
    ${notTouched.length ? `<div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c">시장</th><th>저점일</th><th>저점가</th><th>현재가</th><th>저점대비</th><th>현재MA20</th><th>현재괴리율</th></tr></thead><tbody>${p4MissRows}</tbody></table></div><div class="stock-cards">${p4MissCards}</div>` : '<div class="empty"><div class="msg">없음</div></div>'}
  </div>
  ${aiCard4}
</div>

</div></div>
<div class="footer">20ma_analysis.mjs · KRX + Yahoo Finance · 분석기준 ${latestFmt} 종가</div>
<script>
function showTab(i){document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('on',j===i));document.querySelectorAll('.tab-btn').forEach((t,j)=>t.classList.toggle('on',j===i));}
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>showTab(parseInt(btn.dataset.tab)));
  btn.addEventListener('touchend',e=>{e.preventDefault();showTab(parseInt(btn.dataset.tab));});
});
</script>
</body></html>`;

  const savePath = `C:/Users/shinf/Workspace/data/analysis/괴리율분석_${ts}.html`;
  try {
    fs.writeFileSync(savePath, html, 'utf-8');
    console.log(`\n[HTML] 저장 완료: ${savePath}`);
  } catch(err) {
    console.error(`[HTML] 저장 실패: ${err.message}`);
  }
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
