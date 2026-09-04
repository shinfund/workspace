/**
 * project_stock_watchlist_data.mjs — 관심종목/종목조회 앱(stock-watchlist.html) 통합 데이터 생성
 *
 * 코스피TOP50·코스닥TOP20·보유종목·지수 4개 스크립트(project_kospi_mktcap_top50_quote_table.mjs /
 * project_kosdaq_mktcap_top20_quote_table.mjs / project_holdings_quote_table.mjs /
 * project_index_quote_table.mjs)와 동일 로직을 재사용해 하나의 JSON으로 통합 출력한다.
 * 앱은 자체 API 호출이 없는 정적 파일이므로(stock-portal CLAUDE.md 원칙), 이 스크립트 결과 JSON을
 * stock-watchlist.html의 WATCHLIST_DATA 상수에 수동으로 임베드하는 방식으로 갱신한다.
 *
 * 데이터 소스:
 *   KRX API       → 전종목 목록(관심종목 자유검색용) + 코스피/코스닥 시총 유니버스·순위
 *   KIS API       → 당일 현재가·등락률 실시간
 *   Yahoo Finance → EMA 계산용 과거 종가(코스닥은 .KQ, 코스피는 .KS, 마지막날은 KIS 당일가로 대체)
 *
 * 출력: JSON 1개(stdout)
 * Usage: node project_stock_watchlist_data.mjs > watchlist_data.json
 */
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getToken, fetchKrxUniverse, fetchKisPrice } from './kis_api.mjs';

const EMA_PERIODS = [5, 20, 50, 100, 200];
const BATCH = 5, DELAY = 200;
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// SECTOR_MAP: project_kospi_mktcap_top50_quote_table.mjs / project_kosdaq_mktcap_top20_quote_table.mjs와 동일(2026-09-02 도입)
const SECTOR_MAP_KOSPI = {
  '005930': '반도체/IT부품', '000660': '반도체/IT부품', '009150': '반도체/IT부품', '042700': '반도체/IT부품',
  '402340': '지주회사', '028260': '지주회사', '034730': '지주회사', '000150': '지주회사', '003550': '지주회사', '267250': '지주회사',
  '105560': '금융(은행/지주)', '055550': '금융(은행/지주)', '086790': '금융(은행/지주)', '316140': '금융(은행/지주)', '024110': '금융(은행/지주)',
  '005380': '자동차/부품', '000270': '자동차/부품', '012330': '자동차/부품',
  '373220': '2차전지', '006400': '2차전지', '003670': '2차전지',
  '329180': '조선', '042660': '조선', '009540': '조선', '010140': '조선',
  '207940': '바이오/제약', '068270': '바이오/제약',
  '096770': '에너지/화학', '051910': '에너지/화학', '010950': '에너지/화학',
  '034020': '원전',
  '032830': '금융(보험/증권)', '000810': '금융(보험/증권)', '006800': '금융(보험/증권)',
  '010120': '전력기기/유틸리티', '267260': '전력기기/유틸리티', '298040': '전력기기/유틸리티', '015760': '전력기기/유틸리티',
  '012450': '방산/항공우주', '079550': '방산/항공우주', '064350': '방산/항공우주',
  '035420': 'IT/인터넷/서비스', '035720': 'IT/인터넷/서비스', '018260': 'IT/인터넷/서비스',
  '010130': '철강/비철금속', '005490': '철강/비철금속',
  '033780': '소비재/화장품', '278470': '소비재/화장품',
  '066570': '전자/가전',
  '017670': '통신',
  '011200': '해운',
  '086280': '물류',
};
const SECTOR_MAP_KOSDAQ = {
  '196170': '바이오/제약', '028300': '바이오/제약', '214450': '바이오/제약', '087010': '바이오/제약',
  '298380': '바이오/제약', '000250': '바이오/제약', '141080': '바이오/제약',
  '036930': '반도체장비/부품', '240810': '반도체장비/부품', '058470': '반도체장비/부품', '039030': '반도체장비/부품',
  '222800': '반도체장비/부품', '403870': '반도체장비/부품', '319660': '반도체장비/부품', '095340': '반도체장비/부품',
  '086520': '2차전지소재', '247540': '2차전지소재',
  '277810': '로봇', '108490': '로봇',
  '257720': '화장품/뷰티유통',
};
// 보유종목 전용(project_holdings_quote_table.mjs SECTOR_MAP)
const SECTOR_MAP_HOLDINGS = {
  '010140': '조선', '015760': '전력', '454910': '로봇/자동화', '032830': '금융(보험/증권)',
};

const INDICES = [
  { symbol: '^KS11', name: '코스피' }, { symbol: '^KQ11', name: '코스닥' },
  { symbol: '^GSPC', name: 'S&P500' }, { symbol: '^IXIC', name: '나스닥종합' }, { symbol: '^DJI', name: '다우존스' },
  { symbol: '^SOX', name: '필라델피아반도체' }, { symbol: '^VIX', name: 'VIX(변동성)' },
  { symbol: 'KRW=X', name: '원/달러' }, { symbol: 'CL=F', name: 'WTI원유' }, { symbol: 'GC=F', name: '금(Gold)' },
  { symbol: '^TNX', name: '美10년물금리' }, { symbol: 'DX-Y.NYB', name: '달러인덱스' }, { symbol: 'HG=F', name: '구리' },
];
const ATR_PERIOD = 14;
const WARMUP_DAYS = Math.max(...EMA_PERIODS) * 8;

// ── 공용 유틸 ────────────────────────────────────────────────
function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp?.length) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [], meta: result.meta || {} };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([
    fetchYahooChart(`${code}.KS`, p1, p2),
    fetchYahooChart(`${code}.KQ`, p1, p2),
  ]);
  const ksLen = ks?.ts?.length || 0, kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return null;
  return ksLen >= kqLen ? ks : kq;
}
function fillForward(arr) {
  let last = null;
  return arr.map(v => { if (v != null) last = v; return v == null ? last : v; });
}
function buildEmaSeries(closes, period) {
  const k = 2 / (period + 1);
  const series = new Array(closes.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) { series[i] = ema; continue; }
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) { series[i] = null; continue; }
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else { ema = price * k + ema * (1 - k); }
    series[i] = ema;
  }
  return series;
}
function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i]; if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}
function emaStructure(devByPeriod) {
  const vals = EMA_PERIODS.map(p => devByPeriod[p]);
  if (vals.some(v => v == null)) return '데이터부족';
  // dev(%) 부호만으로는 순서를 알 수 없으므로 원본 EMA 값이 필요 — 호출부에서 rawEma 넘겨줄 것
  return null;
}
function emaStructureFromRaw(rawEma) {
  const vals = EMA_PERIODS.map(p => rawEma[p]);
  if (vals.some(v => v == null)) return '데이터부족';
  let asc = true, desc = true;
  for (let i = 1; i < vals.length; i++) {
    if (!(vals[i - 1] > vals[i])) asc = false;
    if (!(vals[i - 1] < vals[i])) desc = false;
  }
  if (asc) return '정배열';
  if (desc) return '역배열';
  return '혼조';
}
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}
async function batchAll(items, fn, concurrency = 6, delay = 120) {
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
async function batchKis(token, codes) {
  const map = {};
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(c => fetchKisPrice(token, c)));
    batch.forEach((c, j) => { if (results[j]) map[c] = results[j]; });
    if (i + BATCH < codes.length) await new Promise(r => setTimeout(r, DELAY));
  }
  const missing = codes.filter(c => !map[c]);
  if (missing.length) {
    console.error(`[KIS] 누락 ${missing.length}건 재시도...`);
    for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
      await new Promise(r => setTimeout(r, 300));
      for (const c of [...missing]) {
        const p = await fetchKisPrice(token, c);
        if (p) { map[c] = p; missing.splice(missing.indexOf(c), 1); }
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }
  return map;
}

// ── ① 코스피TOP50 / 코스닥TOP20 유니버스 ─────────────────────
async function loadUniverse(list, market, sectorMap, token, today) {
  const codes = list.map(s => s.종목코드);
  const priceMap = await batchKis(token, codes);
  const stocks = list.map((s, i) => {
    const p = priceMap[s.종목코드];
    return { rank: i + 1, code: s.종목코드, name: s.종목명, market, price: p?.현재가 ?? 0, changePct: p?.등락률 ?? 0, mktcap: s._mktcap };
  }).filter(s => s.price > 0);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 900 * 24 * 3600;
  const ySuffix = market === 'KOSPI' ? '.KS' : '.KQ';
  const loaded = await batchAll(stocks, async s => {
    const chart = await fetchYahooChart(`${s.code}${ySuffix}`, p1, p2);
    if (!chart || !chart.ts.length) return { ...s, ema: null, structure: '데이터부족' };
    const dates = chart.ts.map(ts => { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; });
    const closes = fillForward(chart.close);
    if (dates[dates.length - 1] === today) closes[closes.length - 1] = s.price;
    else closes.push(s.price);
    const rawEma = {}, dev = {}, cross = {};
    for (const p of EMA_PERIODS) {
      const series = buildEmaSeries(closes, p);
      const ema = series[series.length - 1];
      rawEma[p] = ema;
      dev[p] = (ema && s.price) ? (s.price - ema) / ema * 100 : null;
      cross[p] = crossMarker(closes, series);
    }
    return { ...s, ema: dev, cross, structure: emaStructureFromRaw(rawEma) };
  });

  return loaded.map(s => ({ ...s, sector: sectorMap[s.code] || '기타' }));
}

function buildSectorSummary(rows) {
  const bySector = {};
  for (const r of rows) {
    if (!bySector[r.sector]) bySector[r.sector] = { name: r.sector, count: 0, mktcap: 0, chgSum: 0 };
    bySector[r.sector].count++;
    bySector[r.sector].mktcap += r.mktcap;
    bySector[r.sector].chgSum += r.changePct;
  }
  return Object.values(bySector).map(s => ({ ...s, avgChg: s.chgSum / s.count })).sort((a, b) => b.avgChg - a.avgChg);
}

// ── ② 보유종목 ──────────────────────────────────────────────
export async function loadHoldings(token) {
  let holdings = [];
  try { holdings = JSON.parse(fs.readFileSync('C:\\Users\\shinf\\workspace\\data\\holdings.json', 'utf8')); } catch { return null; }
  if (!holdings.length) return null;

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - WARMUP_DAYS * 24 * 3600;

  const rows = await batchAll(holdings, async h => {
    const [kis, chart] = await Promise.all([fetchKisPrice(token, h.종목코드), fetchChartAutoMarket(h.종목코드, p1, p2)]);
    const price = kis ? kis.현재가 : null;
    const value = price != null ? price * h.보유수량 : null;
    const cost = h.평균단가 * h.보유수량;
    const pnl = value != null ? value - cost : null;
    const pnlPct = value != null ? (pnl / cost) * 100 : null;

    let closes = chart ? fillForward(chart.close) : [];
    if (price && closes.length) closes[closes.length - 1] = price;
    const rawEma = {}, dev = {};
    for (const period of EMA_PERIODS) {
      const series = buildEmaSeries(closes, period);
      const ema = series[series.length - 1];
      rawEma[period] = ema;
      dev[period] = (ema && price) ? (price - ema) / ema * 100 : null;
    }
    return {
      code: h.종목코드, name: h.종목명, market: h.시장, price, changePct: kis?.등락률 ?? null,
      value, cost, pnl, pnlPct, avgPrice: h.평균단가, qty: h.보유수량,
      ema: dev, structure: emaStructureFromRaw(rawEma), sector: SECTOR_MAP_HOLDINGS[h.종목코드] || '기타',
    };
  }, 4, 150);

  rows.sort((a, b) => (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity));

  let totalCost = 0, totalValue = 0;
  for (const r of rows) { totalCost += r.cost; if (r.value != null) totalValue += r.value; }
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : null;

  const bySector = {};
  for (const r of rows) {
    if (!bySector[r.sector]) bySector[r.sector] = { name: r.sector, stocks: [], cost: 0, value: 0 };
    bySector[r.sector].stocks.push(r.name);
    bySector[r.sector].cost += r.cost;
    if (r.value != null) bySector[r.sector].value += r.value;
  }
  const sectors = Object.values(bySector).map(s => {
    const pnl = s.value - s.cost;
    return { name: s.name, count: s.stocks.length, cost: s.cost, pnl, pnlPct: (pnl / s.cost) * 100, contribution: totalPnl !== 0 ? (pnl / totalPnl) * 100 : null };
  }).sort((a, b) => b.pnlPct - a.pnlPct);

  const contribution = [...rows].filter(r => r.pnl != null).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .map(r => ({ name: r.name, code: r.code, pnl: r.pnl, contribution: totalPnl !== 0 ? (r.pnl / totalPnl) * 100 : null }));

  return { rows, totals: { cost: totalCost, value: totalValue, pnl: totalPnl, pnlPct: totalPnlPct }, sectors, contribution };
}

// ── ③ 지수 ──────────────────────────────────────────────────
function crossMarker(closes, emaSeries) {
  const n = closes.length; if (n < 2) return '';
  const c1 = closes[n - 1], c0 = closes[n - 2], e1 = emaSeries[n - 1], e0 = emaSeries[n - 2];
  if (c1 == null || c0 == null || e1 == null || e0 == null) return '';
  if (c0 < e0 && c1 >= e1) return '▲';
  if (c0 > e0 && c1 <= e1) return '▼';
  return '';
}
async function loadIndices() {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - WARMUP_DAYS * 24 * 3600;
  const rows = [];
  for (const idx of INDICES) {
    const chart = await fetchYahooChart(idx.symbol, p1, p2);
    await new Promise(r => setTimeout(r, 150));
    if (!chart) { rows.push({ name: idx.name, error: true }); continue; }
    const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
    const meta = chart.meta || {};
    const 전일종가 = closes[closes.length - 2];
    let price = meta.regularMarketPrice ?? closes[closes.length - 1];
    if (price != null && closes.length) closes[closes.length - 1] = price;
    const changePct = (price != null && 전일종가) ? (price - 전일종가) / 전일종가 * 100 : null;
    const dev = {}, cross = {};
    for (const period of EMA_PERIODS) {
      const series = buildEmaSeries(closes, period);
      const ema = series[series.length - 1];
      dev[period] = (ema && price) ? (price - ema) / ema * 100 : null;
      cross[period] = crossMarker(closes, series);
    }
    const atrSeries = buildAtr(highs, lows, closes, ATR_PERIOD);
    const atrLast = atrSeries[atrSeries.length - 1];
    const atrPct = (atrLast != null && price) ? atrLast / price * 100 : null;
    const n = closes.length;
    const ret5d = (n > 5 && closes[n - 1] != null && closes[n - 6] != null) ? (closes[n - 1] - closes[n - 6]) / closes[n - 6] * 100 : null;
    rows.push({ name: idx.name, price, changePct, dev, cross, atrPct, ret5d });
  }
  return rows;
}
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function judgeTrend(r) {
  if (!r || r.error) return '조회실패';
  const parts = [`${fmtPct(r.changePct)}(5일 ${fmtPct(r.ret5d)})`];
  const dev20 = r.dev[20], dev200 = r.dev[200];
  if (dev20 != null && dev200 != null) {
    if (dev20 > 0 && dev200 > 0) parts.push('단기·장기 동반 강세');
    else if (dev20 < 0 && dev200 > 0) parts.push('장기 상승추세 속 단기 조정');
    else if (dev20 > 0 && dev200 < 0) parts.push('장기 약세 속 단기 반등');
    else parts.push('단기·장기 동반 약세');
  }
  const crosses = EMA_PERIODS.filter(p => r.cross[p]).map(p => `${p}EMA${r.cross[p]}`);
  if (crosses.length) parts.push(crosses.join(' '));
  return parts.join(', ');
}
function judgeGroup(members) {
  const valids = members.filter(r => r && !r.error);
  if (!valids.length) return '데이터없음';
  const avgChg = valids.reduce((a, r) => a + (r.changePct || 0), 0) / valids.length;
  const dev200s = valids.map(r => r.dev[200]).filter(v => v != null);
  const avgDev200 = dev200s.length ? dev200s.reduce((a, b) => a + b, 0) / dev200s.length : null;
  const trend = avgDev200 == null ? '' : (avgDev200 > 0 ? '장기 상승추세 유지' : '장기 하락추세');
  const move = avgChg > 0.5 ? '뚜렷한 상승' : avgChg < -0.5 ? '뚜렷한 하락' : '보합권';
  return `${trend ? trend + ' 속 ' : ''}${move}(평균 ${fmtPct(avgChg)})`;
}
function judgeVix(r) {
  if (!r || r.error) return '조회실패';
  const v = r.price;
  const level = v == null ? '' : v < 15 ? '안정(저변동)' : v < 20 ? '보통' : v < 30 ? '경계(변동성 확대)' : '위험(패닉권)';
  return `${level}, ${fmtPct(r.changePct)}`;
}
function judgeFx(r) {
  if (!r || r.error) return '조회실패';
  const dir = r.changePct > 0 ? '원화 약세' : r.changePct < 0 ? '원화 강세' : '보합';
  const dev20 = r.dev[20];
  const trend = dev20 == null ? '' : dev20 > 0 ? '단기 상승(약세)추세' : '단기 하락(강세)추세';
  return `${dir}${trend ? ', ' + trend : ''}`;
}
function judgeCommodities(wti, gold, copper) {
  if (!wti || !gold || !copper || wti.error || gold.error || copper.error) return '데이터없음';
  const goldUp = gold.changePct > 0, copperUp = copper.changePct > 0;
  let label;
  if (goldUp && copperUp) label = '금·구리 동반 상승 — 안전자산 선호와 경기 기대가 동시 반영(리플레이션 신호)';
  else if (goldUp && !copperUp) label = '금 강세·구리 약세 — 안전자산 선호 우위(경기 불확실성)';
  else if (!goldUp && copperUp) label = '구리 강세·금 약세 — 위험선호·경기 회복 기대 우위';
  else label = '금·구리 동반 약세 — 원자재 수요 둔화 우려';
  return `WTI ${fmtPct(wti.changePct)}, ${label}`;
}
function judgeRatesFx(tnx, dxy) {
  if (!tnx || !dxy || tnx.error || dxy.error) return '데이터없음';
  const rateUp = tnx.changePct > 0, dollarUp = dxy.changePct > 0;
  let label;
  if (rateUp && dollarUp) label = '금리·달러 동반 강세 — 긴축 우려/안전자산 선호(신흥국 자금유출 경계)';
  else if (!rateUp && !dollarUp) label = '금리·달러 동반 약세 — 완화 기대(위험자산 우호적)';
  else if (rateUp && !dollarUp) label = '금리는 상승, 달러는 약세 — 인플레 기대 반영';
  else label = '금리는 하락, 달러는 강세 — 안전자산 선호(경기 둔화 경계)';
  return label;
}
function buildMarketSummary(rows) {
  const bySym = name => rows.find(r => r.name === name);
  const kospi = bySym('코스피'), kosdaq = bySym('코스닥');
  const sp = bySym('S&P500'), nasdaq = bySym('나스닥종합'), dow = bySym('다우존스');
  const sox = bySym('필라델피아반도체'), vix = bySym('VIX(변동성)'), fx = bySym('원/달러');
  const wti = bySym('WTI원유'), gold = bySym('금(Gold)'), copper = bySym('구리');
  const tnx = bySym('美10년물금리'), dxy = bySym('달러인덱스');
  return [
    { 구분: '국내증시', 현황: `코스피 ${fmtPct(kospi?.changePct)} / 코스닥 ${fmtPct(kosdaq?.changePct)}`, 판단: `코스피: ${judgeTrend(kospi)} | 코스닥: ${judgeTrend(kosdaq)}` },
    { 구분: '미국증시', 현황: `S&P500 ${fmtPct(sp?.changePct)} / 나스닥 ${fmtPct(nasdaq?.changePct)} / 다우 ${fmtPct(dow?.changePct)}`, 판단: judgeGroup([sp, nasdaq, dow]) },
    { 구분: '반도체(필라델피아)', 현황: `${fmtPct(sox?.changePct)}(5일 ${fmtPct(sox?.ret5d)})`, 판단: judgeTrend(sox) },
    { 구분: '변동성(VIX)', 현황: `${sox && vix ? vix.price?.toFixed(2) : '─'}`, 판단: judgeVix(vix) },
    { 구분: '환율(원/달러)', 현황: `${fx?.price?.toFixed(2) ?? '─'}원(${fmtPct(fx?.changePct)})`, 판단: judgeFx(fx) },
    { 구분: '원자재', 현황: `WTI ${fmtPct(wti?.changePct)} / 금 ${fmtPct(gold?.changePct)} / 구리 ${fmtPct(copper?.changePct)}`, 판단: judgeCommodities(wti, gold, copper) },
    { 구분: '금리·달러', 현황: `美10년물 ${fmtPct(tnx?.changePct)} / 달러인덱스 ${fmtPct(dxy?.changePct)}`, 판단: judgeRatesFx(tnx, dxy) },
  ];
}

// ── main ────────────────────────────────────────────────────
async function main() {
  const { date, time } = kstNow();
  console.error('[1/4] KRX 전종목 유니버스 조회...');
  const { kospi, kosdaq, basDt } = await fetchKrxUniverse();
  const lookup = [
    ...kospi.map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSPI' })),
    ...kosdaq.map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSDAQ' })),
  ];

  const token = await getToken();
  const kospiTop = kospi.sort((a, b) => b._mktcap - a._mktcap).slice(0, 50);
  const kosdaqTop = kosdaq.sort((a, b) => b._mktcap - a._mktcap).slice(0, 20);

  console.error('[2/4] 코스피TOP50/코스닥TOP20 현재가·EMA 조회...');
  const [kospiRows, kosdaqRows] = await Promise.all([
    loadUniverse(kospiTop, 'KOSPI', SECTOR_MAP_KOSPI, token, date),
    loadUniverse(kosdaqTop, 'KOSDAQ', SECTOR_MAP_KOSDAQ, token, date),
  ]);

  console.error('[3/4] 보유종목 조회...');
  const holdings = await loadHoldings(token);

  console.error('[4/4] 지수 조회...');
  const indexRows = await loadIndices();

  const out = {
    meta: { date, time, krxBasDt: `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}` },
    lookup,
    universe: { kospi: kospiRows, kosdaq: kosdaqRows },
    sectorSummary: { kospi: buildSectorSummary(kospiRows), kosdaq: buildSectorSummary(kosdaqRows) },
    holdings,
    indices: { rows: indexRows, summary: buildMarketSummary(indexRows) },
  };

  console.error(`[완료] lookup ${lookup.length}건, 코스피 ${kospiRows.length}건, 코스닥 ${kosdaqRows.length}건, 보유종목 ${holdings?.rows?.length ?? 0}건, 지수 ${indexRows.length}건`);
  console.log(JSON.stringify(out));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('오류:', e); process.exit(1); });
}
