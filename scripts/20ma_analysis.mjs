/**
 * 20ma_analysis.mjs — 거래대금 TOP10 유니버스 × MA20 괴리율 일간 분석
 *
 * 데이터 소스 (자동 선택):
 *   KRX API       → KRX 확정 과거 데이터 (최근 거래일·주말·공휴일 제외)
 *   Yahoo Finance → 최근 거래일(당일 포함) + 마지막 거래일 이후 주말·공휴일 (KRX 미제공 구간 자동 폴백)
 *
 * 실행:
 *   node 20ma_analysis.mjs
 *   ※ 날짜 범위 자동 계산, 엑셀 파일 불필요
 *   ※ Yahoo 미포함 종목은 MANUAL_PRICES에 직접 추가
 *
 * 출력: 방식A(당일TOP10×MA20) / 방식B(유니버스×MA20) / 저점대비상승률
 */

import https from 'https';

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
    return { ts, close: q.close||[], volume: q.volume||[] };
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

    const 종가 = yf.close[tIdx];
    const vol  = yf.volume[tIdx];
    if (!종가) return;

    resultMap.set(stock.code, {
      종목코드: stock.code,
      종목명:   stock.종목명,
      시장:     stock.시장,
      종가:     Math.round(종가),
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
      const rank    = inTop10 ? top10.findIndex(s => s.종목코드 === code) + 1 : null;

      if (ratio <= -20) {
        const entry = { date, rank, 종목코드: code, 종목명: meta.종목명, 시장: meta.시장, 종가, ma20: Math.round(ma20), ratio, 데이터수: prices.length, inTop10 };
        findingsB.push(entry);
        if (inTop10) findingsA.push({ ...entry });
      }
    }
  }

  // ── 8. 출력 헬퍼
  function printSection(label, findings) {
    console.log('\n' + '═'.repeat(72));
    console.log(` ${label}`);
    console.log(' 기간: ' + fmtDate(targetDates[0]) + ' ~ ' + fmtDate(targetDates[targetDates.length-1]));
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
      if (!stockSummary[f.종목명]) stockSummary[f.종목명] = { 시장: f.시장, 건수: 0, 최대괴리: 0, 날짜들: [] };
      stockSummary[f.종목명].건수++;
      if (f.ratio < stockSummary[f.종목명].최대괴리) stockSummary[f.종목명].최대괴리 = f.ratio;
      stockSummary[f.종목명].날짜들.push(f.date.slice(4));
    }
    const sorted = Object.entries(stockSummary).sort((a, b) => b[1].건수 - a[1].건수 || a[1].최대괴리 - b[1].최대괴리);
    for (const [name, s] of sorted)
      console.log(`  ${name.padEnd(12)}  ${s.시장.padEnd(6)}  ${s.건수}일 해당  최대괴리 ${s.최대괴리.toFixed(1)}%  (${s.날짜들.join(', ')})`);
    console.log('\n' + '═'.repeat(72));
    console.log(`  총 ${findings.length}건 / ${[...new Set(findings.map(f=>f.종목명))].length}개 종목`);
    console.log('═'.repeat(72));
  }

  printSection('【방식A】 당일 TOP10 종목 × MA20 -20% 이하 (기존 방식)', findingsA);
  printSection(`【방식B】 20일 유니버스(${universeMap.size}종목) × 날짜별 MA20 -20% 이하`, findingsB);

  // ── 9. 종가 기준 저점 대비 상승률 분석
  console.log('\n' + '═'.repeat(84));
  console.log(' 【종가 기준 저점 대비 현재 상승률 분석】');
  console.log(' 저점 = 방식B 해당 기간 내 실제 최저 종가일  /  최근가 = 가장 최근 가용 종가');
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

  // ── 10. 최근 거래일 미포함 종목 탐지
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

main().catch(e => { console.error('오류:', e); process.exit(1); });
