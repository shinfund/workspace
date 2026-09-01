// 눌림목 V3_RETEST(v11) — "예상종목"(정배열+되돌림밴드 근접 top6) · "보유종목"(Notion 보유종목DB 연동) 탭용 데이터 생성
// project_pullback_recent_signals.mjs와 project_holdings_deviation_stats.mjs의 로직을 눌림목 전략에 맞춰 결합.
// 사용법: node scripts/project_pullback_holdings_candidates.mjs
import https from 'https';
import { fetchKrxUniverse, getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

const KOSPI_SIZE = 50;

// KRX 조회 실패 시에만 사용하는 폴백 유니버스(2026-08-26 코스닥 제외, 코스피 전용으로 전환)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];

async function buildKospiUniverse() {
  try {
    const { kospi, basDt } = await fetchKrxUniverse();
    const top = kospi.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSPI_SIZE).map(s => ({ code: s.종목코드, name: s.종목명 }));
    console.error(`[유니버스] 코스피 시총 TOP${KOSPI_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스피 폴백 스냅샷 사용`);
    return FALLBACK_KOSPI;
  }
}

const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10, BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4;
const SL = 8, TRAIL = 8, TP_PCT = 20, TP_FRAC = 0.4, MAX_HOLD = 40, COOLDOWN_DAYS = 5; // v15(2026-08-26): 청산 그리드서치 재확정(TP 10→20, perDay 기준)
// v14(2026-08-26): 코스닥 종목을 유니버스에서 완전 제외 — 코스닥 전용 SL18(v11) 분기 제거
function slFor() { return SL; }
const CHART_DAYS = 70, CALENDAR_DAYS = 400;
// v12(2026-08-20): project_stock_pullback.mjs와 동일한 시장국면·개별변동성 필터를 예상종목 판정에도 반영
const KOSPI_SYMBOL = '%5EKS11', KOSDAQ_SYMBOL = '%5EKQ11';
const REGIME_STREAK_MIN = 10, KOSPI_ATR_PERIOD = 14, VOL_CAP = 4, STOCK_ATR_CAP = 6;
// 2026-09-01: 예상종목 필터가 실제 진입조건(project_portfolio3_entry_scan.mjs checkPullbackEntry)의
// breakout lookback·손절후쿨다운 2개 필터를 빠뜨려 "조건상 진입 불가능한 종목"이 섞여 보일 수 있던 정밀도
// 이슈를 보정 — pbSimulate/fetchMarketRegimeHistory로 두 필터를 동일하게 재현한다.
function pbSimulate(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const close = seq[j].close, maShort = seq[j].ema50;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => ({ reason, day: d, ret: tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret, date: seq[j].date });
    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const o = new URL(url);
    const req = https.request({ hostname: o.hostname, port: 443, path: o.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } }, resp => {
      resp.setEncoding('utf8');
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}
function httpGetPage(url, headers) {
  return new Promise((res, rej) => {
    const o = new URL(url);
    const req = https.request({ hostname: o.hostname, port: 443, path: o.pathname, method: 'GET', headers }, resp => {
      resp.setEncoding('utf8');
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.end();
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [], high: result.indicators?.quote?.[0]?.high || [], low: result.indicators?.quote?.[0]?.low || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([fetchYahooChart(`${code}.KS`, p1, p2), fetchYahooChart(`${code}.KQ`, p1, p2)]);
  const ksLen = ks?.ts?.length || 0, kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return null;
  return ksLen >= kqLen ? { chart: ks, market: 'KOSPI' } : { chart: kq, market: 'KOSDAQ' };
}
function tsToKst(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function kstTodayDate() { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
// 장중/장마감 직후 Yahoo 당일 종가 지연 보정용 KIS 당일 현재가 일괄조회(stock-baseline·project_deviation_holdings_candidates.mjs와 동일 기법, [[feedback_price_cross_verify]])
async function fetchKisPriceMap(codes) {
  let token;
  try { token = await getKisToken(); } catch (e) {
    console.error(`[KIS] 토큰 실패: ${e.message} → 당일 종가는 Yahoo 값 사용`);
    return new Map();
  }
  const map = new Map();
  const BATCH = 5, DELAY_KIS = 200;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(c => fetchKisPrice(token, c)));
    batch.forEach((c, j) => { if (res[j] && res[j].현재가 > 0) map.set(c, res[j].현재가); });
    if (i + BATCH < codes.length) await new Promise(r => setTimeout(r, DELAY_KIS));
  }
  console.error(`[KIS] 당일 현재가 ${map.size}/${codes.length}종목 확보`);
  return map;
}
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes); const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < filled.length; i++) {
    const p = filled[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
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
// v12: 지수(코스피/코스닥) 현재 시장국면(상승지속·변동성) — project_stock_pullback.mjs의 fetchMarketRegime과 동일 정의, 최신일만 사용
async function fetchIndexRegimeToday(symbol) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { up: false, streak: 0, volPct: 999 };
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(chart.high, chart.low, closes, KOSPI_ATR_PERIOD);
  let curStreak = 0, up = false, volPct = null;
  for (let i = 0; i < closes.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    volPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
  }
  return { up, streak: curStreak, volPct };
}

async function fetchMarketRegimeHistory(symbol) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
  const dates = chart.ts.map(tsToKst);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(chart.high, chart.low, closes, KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = atr[i] != null ? atr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}

async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function analyzeStock(code, marketHint, kisMap, todayDate, regimeByMarket) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const got = marketHint ? { chart: await fetchYahooChart(`${code}.${marketHint === 'KOSDAQ' ? 'KQ' : 'KS'}`, p1, p2), market: marketHint } : await fetchChartAutoMarket(code, p1, p2);
  if (!got || !got.chart || !got.chart.ts.length) return { error: '데이터 조회 실패' };
  const { chart, market } = got;
  const dates = chart.ts.map(tsToKst);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const ema50s = buildEma(closes, MA_SHORT), ema100s = buildEma(closes, MA_LONG);
  const atrs = buildAtr(highs, lows, closes, ATR_PERIOD);

  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema50s[i] == null || ema100s[i] == null) continue;
    const atrPct = atrs[i] != null ? atrs[i] / closes[i] * 100 : null;
    rows.push({ date: dates[i], close: closes[i], ema50: ema50s[i], ema100: ema100s[i], atrPct });
  }
  if (rows.length < MA_LONG + SLOPE_LOOKBACK + 1) return { error: '데이터 부족' };

  // 장중/장마감 직후 Yahoo 당일 종가가 지연 반영될 수 있어, 오늘 날짜 마지막 봉은 KIS 당일 현재가로 덮어쓴다
  const lastIdx = rows.length - 1;
  if (rows[lastIdx].date === todayDate && kisMap?.has(code)) {
    rows[lastIdx].close = kisMap.get(code);
  }

  const n = rows.length;
  const cur = rows[n - 1], prev = rows[n - 2];
  const trendUp = cur.ema50 > cur.ema100 && cur.ema50 > rows[n - 1 - SLOPE_LOOKBACK].ema50;

  let highS = -Infinity, highSIdx = -1;
  for (let k = n - MA_SHORT; k <= n - 1; k++) { if (k >= 0 && rows[k].close > highS) { highS = rows[k].close; highSIdx = k; } }
  const pullbackPct = highS > 0 ? (highS - cur.close) / highS * 100 : null;
  const normDepth = (pullbackPct != null && cur.atrPct) ? pullbackPct / cur.atrPct : null;
  const recentBreakout = highSIdx >= 0 && highSIdx >= (n - 1) - BREAKOUT_LOOKBACK;

  // checkPullbackEntry와 동일하게 과거 구간을 재생하며 손절후 재진입쿨다운 상태를 계산(휩소 재진입 배제)
  let inCooldown = false;
  if (regimeByMarket) {
    const marketRegime = regimeByMarket.KOSPI, otherRegime = regimeByMarket.KOSDAQ;
    let blockedUntilIdx = -1;
    for (let k = MA_LONG + SLOPE_LOOKBACK; k < n - 1; k++) {
      const sk = rows[k], priorK = rows[k - SLOPE_LOOKBACK];
      const trendUpK = sk.close > sk.ema100 && sk.ema50 > sk.ema100 && sk.ema50 > priorK.ema50;
      if (!trendUpK || marketRegime.regime[sk.date] !== true || otherRegime.regime[sk.date] !== true) continue;
      if ((marketRegime.streak[sk.date] ?? 0) < REGIME_STREAK_MIN) continue;
      const volK = marketRegime.volPct[sk.date];
      if (volK == null || volK > VOL_CAP) continue;
      if (k < MA_SHORT || sk.atrPct == null || sk.atrPct <= 0 || sk.atrPct > STOCK_ATR_CAP) continue;
      let highK = -Infinity, highKIdx = -1;
      for (let m = k - (MA_SHORT - 1); m <= k - 1; m++) if (rows[m].close > highK) { highK = rows[m].close; highKIdx = m; }
      if (!(highKIdx >= k - BREAKOUT_LOOKBACK) || sk.close > highK || sk.close <= sk.ema50) continue;
      if (((highK - sk.close) / highK * 100) / sk.atrPct > BAND_K) continue;
      if (k <= blockedUntilIdx) continue;
      const trade = pbSimulate(rows, k, sk.close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC);
      if (trade && trade.reason === 'SL') blockedUntilIdx = k + trade.day + COOLDOWN_DAYS;
    }
    inCooldown = (n - 1) <= blockedUntilIdx;
  }

  const chartRows = rows.slice(-CHART_DAYS);
  return { market, cur, prev, trendUp, highS, pullbackPct, normDepth, recentBreakout, inCooldown, chartRows, rows };
}

function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function devClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

// 예상종목·보유종목 탭용 SVG/카드 HTML — project_deviation_holdings_candidates.mjs의
// buildChartSvg/candidateCardHtml/holdingCardHtml과 동일 패턴(EMA5/EMA20 대신 EMA50/EMA100만 사용)
function buildChartSvg(rows, opts) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema50, r.ema100));
  if (opts.avgPrice) allVals.push(opts.avgPrice, opts.slPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema100', 'gray600', '6,3', 1.3) + poly('ema50', 'teal', '4,3', 1.4);
  if (opts.avgPrice) {
    svg += `<line x1="${x0}" y1="${yAt(opts.avgPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.avgPrice).toFixed(1)}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<line x1="${x0}" y1="${yAt(opts.slPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.slPrice).toFixed(1)}" stroke="var(--coral)" stroke-width="1.1" stroke-dasharray="1,3"/>`;
  }
  svg += poly('close', 'txt', null, 1.7);
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}
function candidateCardHtml(r) {
  const svg = buildChartSvg(r.chartRows, {});
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge bdg-sky">정배열</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> EMA50대비 <span class="${devClass(dev50)}">${fmt(dev50)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>최근 신고가 대비 눌림폭 <span>${r.pullbackPct.toFixed(2)}%</span> <span class="sep">|</span> 되돌림밴드(ATR&times;0.4) 대비 <span>${r.normDepth.toFixed(2)}배</span></span>
        </div>
        <div class="chart-card-stats">
          <span>기준선(EMA50) <span>${fmtV(r.ema50)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--teal)"></i>기준선(EMA50)</span><span><i class="dash" style="border-color:var(--gray600)"></i>EMA100</span></div>
      </div>`;
}
function candidateRowHtml(r) {
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  return `<tr><td class="l">${esc(r.name)}</td><td class="c">${r.market}</td><td>${fmtV(r.close)}</td><td class="${devClass(dev50)}">${fmt(dev50)}</td><td>${r.pullbackPct.toFixed(2)}%</td><td>${r.normDepth.toFixed(2)}배</td><td class="c">${r.held ? '보유중' : '─'}</td></tr>`;
}
function holdingCardHtml(r) {
  const v = verdict(r);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const sl = slFor(r.market);
  const slPrice = r.avgPrice * (1 - sl / 100);
  const svg = buildChartSvg(r.chartRows, { avgPrice: r.avgPrice, slPrice });
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  const trendLbl = r.trendUp ? '정배열 유지' : '역배열/조정';
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badgeCls}">${v.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> 평단대비 <span class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA50대비 <span class="${devClass(dev50)}">${fmt(dev50)}</span> <span class="sep">|</span> 추세 <span>${trendLbl}</span> <span class="sep">|</span> 기준선(EMA50) <span>${fmtV(r.ema50)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--teal)"></i>기준선(EMA50)</span><span><i class="dash" style="border-color:var(--gray600)"></i>EMA100</span><span><i style="background:var(--${v.cls})"></i>판단 <span style="color:var(--${v.cls})">${v.label}</span></span><span><i style="background:var(--txt2)"></i>평단 <span>${fmtV(r.avgPrice)}</span></span><span><i style="background:var(--coral)"></i>손절선(-${sl}%) <span>${fmtV(slPrice)}</span></span></div>
      </div>`;
}
function holdingRowHtml(r) {
  const v = verdict(r);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  const trendLbl = r.trendUp ? '정배열 유지' : '역배열/조정';
  return `<tr><td class="l">${esc(r.name)}</td><td class="c">${r.market}</td><td class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</td><td class="${devClass(dev50)}">${fmt(dev50)}</td><td class="c">${trendLbl}</td><td class="c"><span class="badge ${badgeCls}">${v.label}</span></td></tr>`;
}

async function refetchPage(pageId) {
  try {
    const page = await httpGetPage(`https://api.notion.com/v1/pages/${pageId}`, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      name: (page?.properties?.['종목명']?.title?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      avgPrice: Number(page?.properties?.['매 입 가']?.number || 0),
    };
  } catch { return null; }
}
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음'); return []; }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) return [];
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate).map(p => ({
    pageId: p.id,
    code: (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
    name: (p.properties['종목명']?.title?.[0]?.plain_text || '').trim(),
    qty: Number(p.properties['보유수량']?.number || 0),
    avgPrice: Number(p.properties['매 입 가']?.number || 0),
  }));
  for (const h of rows) {
    if (!h.name || !h.code || h.qty <= 0 || !h.avgPrice) {
      const fixed = await refetchPage(h.pageId);
      if (fixed) {
        if (!h.name && fixed.name) h.name = fixed.name;
        if (!h.code && fixed.code) h.code = fixed.code;
        if (h.qty <= 0 && fixed.qty > 0) h.qty = fixed.qty;
        if (!h.avgPrice && fixed.avgPrice) h.avgPrice = fixed.avgPrice;
      }
    }
  }
  return rows.filter(h => h.code && h.qty > 0);
}

function verdict(r) {
  const sl = slFor(r.market);
  if (r.unrealizedRet != null && r.unrealizedRet <= -sl) return { label: '손절검토', cls: 'red' };
  if (r.breakdown50) return { label: '전량매도검토(50EMA이탈)', cls: 'red' };
  if (r.freshTp10) return { label: '1차익절검토(+20%)', cls: 'teal' };
  if (r.aboveEma50) return { label: '홀딩(50EMA위)', cls: 'teal' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -sl * 0.6) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

async function main() {
  const kospiUniverse = await buildKospiUniverse();
  const allUniverse = kospiUniverse;
  console.error(`[조회] 후보 유니버스 코스피${kospiUniverse.length}종목 분석 중(v14: 코스닥 제외)...`);

  console.error('[조회] Notion 보유종목DB 조회 중...');
  const holdingsRaw = await fetchNotionHoldings();
  console.error(`[조회] 보유종목 ${holdingsRaw.length}개 분석 중... (${holdingsRaw.map(h => h.name).join(', ')})`);
  const holdCodes = new Set(holdingsRaw.map(h => h.code));

  const todayDate = kstTodayDate();
  const allCodes = [...new Set([...allUniverse, ...holdingsRaw].map(s => s.code))];
  const kisMap = await fetchKisPriceMap(allCodes);

  console.error('[조회] 시장국면 히스토리(코스피·코스닥) 조회 중... (breakout lookback·쿨다운 필터용)');
  const [kospiRegimeHist, kosdaqRegimeHist] = await Promise.all([fetchMarketRegimeHistory(KOSPI_SYMBOL), fetchMarketRegimeHistory(KOSDAQ_SYMBOL)]);
  const regimeByMarket = { KOSPI: kospiRegimeHist, KOSDAQ: kosdaqRegimeHist };

  const universeResults = await batchAll(allUniverse, async s => {
    const a = await analyzeStock(s.code, s.market, kisMap, todayDate, regimeByMarket);
    return a.error ? { ...s, error: a.error } : { ...s, ...a };
  });

  // held 종목이 유니버스에 없으면(코스닥 소형주 등) 개별 조회
  const missingHoldCodes = holdingsRaw.filter(h => !allUniverse.some(s => s.code === h.code));

  const holdingAnalysis = new Map();
  for (const s of universeResults) if (holdCodes.has(s.code)) holdingAnalysis.set(s.code, s);
  const extraResults = await batchAll(missingHoldCodes, async h => {
    const a = await analyzeStock(h.code, null, kisMap, todayDate, regimeByMarket);
    return { code: h.code, ...a };
  });
  for (const r of extraResults) if (!r.error) holdingAnalysis.set(r.code, r);

  const holdings = holdingsRaw.map(h => {
    const a = holdingAnalysis.get(h.code);
    if (!a || a.error) return { ...h, error: a?.error || '데이터 조회 실패' };
    const unrealizedRet = h.avgPrice ? (a.cur.close - h.avgPrice) / h.avgPrice * 100 : null;
    const aboveEma50 = a.cur.close >= a.cur.ema50;
    const prevUnrealizedRet = h.avgPrice && a.prev ? (a.prev.close - h.avgPrice) / h.avgPrice * 100 : null;
    const breakdown50 = !aboveEma50; // 상태 기준(현재 EMA50 아래) — 당일 신규이탈만 잡던 이전 로직은 며칠째 이탈 지속 중인 종목을 "관찰"로 방치하는 사각지대가 있어 2026-08-12 수정
    const freshTp10 = unrealizedRet != null && unrealizedRet >= TP_PCT && !(prevUnrealizedRet != null && prevUnrealizedRet >= TP_PCT);
    return { ...h, ...a, unrealizedRet, aboveEma50, breakdown50, freshTp10 };
  });

  // 2026-08-19: 예상종목 = "초근접"(정배열 유지 + 되돌림밴드 진입조건 normDepth<=BAND_K를 이미 충족한
  // 종목)만 표시. 기존엔 top6를 무조건 채워서 밴드 밖(진입조건 미충족) 종목까지 보여줬음(사용자 지적) —
  // 이제 조건 충족분만, 개수 제한 없이(없으면 빈 목록) 코스피/코스닥 각각 분리해 보여준다.
  // v12: 코스피·코스닥 지수 둘 다 상승국면(지속≥10일·변동성≤4%)이어야 예상종목 표시(백테스트 진입조건과 동일 기준)
  const [kospiRegime, kosdaqRegime] = await Promise.all([fetchIndexRegimeToday(KOSPI_SYMBOL), fetchIndexRegimeToday(KOSDAQ_SYMBOL)]);
  const marketGateOk = r => r.up && r.streak >= REGIME_STREAK_MIN && r.volPct != null && r.volPct <= VOL_CAP;
  const dualIndexOk = marketGateOk(kospiRegime) && marketGateOk(kosdaqRegime);
  console.error(`[v12 시장국면] 코스피 상승${kospiRegime.up}·지속${kospiRegime.streak}일·변동성${kospiRegime.volPct?.toFixed(2)}% / 코스닥 상승${kosdaqRegime.up}·지속${kosdaqRegime.streak}일·변동성${kosdaqRegime.volPct?.toFixed(2)}% → 지수병행조건 ${dualIndexOk ? '충족' : '미충족(예상종목 없음)'}`);

  const validUniverse = universeResults.filter(r => !r.error);
  function buildCandidates(pool) {
    if (!dualIndexOk) return [];
    return pool
      .filter(r => r.trendUp && r.normDepth != null && r.normDepth >= 0 && r.normDepth <= BAND_K && r.cur.atrPct != null && r.cur.atrPct <= STOCK_ATR_CAP && r.recentBreakout && !r.inCooldown)
      .sort((a, b) => a.normDepth - b.normDepth)
      .map(r => ({ ...r, held: holdCodes.has(r.code) }));
  }
  const candidatesKs = buildCandidates(validUniverse);

  function toOutCandidates(list) {
    return list.map(r => ({
      code: r.code, name: r.name, market: r.market, held: r.held,
      close: r.cur.close, ema50: r.cur.ema50, ema100: r.cur.ema100,
      pullbackPct: r.pullbackPct, normDepth: r.normDepth, atrPct: r.cur.atrPct,
      date: r.cur.date,
      chartRows: r.chartRows.map(x => ({ date: x.date, close: x.close, ema50: x.ema50, ema100: x.ema100 })),
    }));
  }
  const outCandidatesKs = toOutCandidates(candidatesKs);
  const outHoldings = holdings.map(h => h.error ? { code: h.code, name: h.name, error: h.error } : {
    code: h.code, name: h.name, market: h.market, avgPrice: h.avgPrice, qty: h.qty,
    close: h.cur.close, ema50: h.cur.ema50, ema100: h.cur.ema100,
    unrealizedRet: h.unrealizedRet, aboveEma50: h.aboveEma50, breakdown50: h.breakdown50, freshTp10: h.freshTp10,
    trendUp: h.trendUp, date: h.cur.date,
    chartRows: h.chartRows.map(x => ({ date: x.date, close: x.close, ema50: x.ema50, ema100: x.ema100 })),
  });
  const validHoldingsOut = outHoldings.filter(h => !h.error);

  const fs = await import('fs');
  fs.writeFileSync('candidates_table_rows_ks.html', outCandidatesKs.map(candidateRowHtml).join('\n          '), 'utf-8');
  fs.writeFileSync('candidates_cards_ks.html', outCandidatesKs.map(candidateCardHtml).join('\n'), 'utf-8');
  fs.writeFileSync('holdings_table_rows.html', validHoldingsOut.map(holdingRowHtml).join('\n          '), 'utf-8');
  fs.writeFileSync('holdings_cards.html', validHoldingsOut.map(holdingCardHtml).join('\n'), 'utf-8');
  console.error('[산출완료] 예상종목 *_ks.html(코스피전용) 2개 + holdings 2개');

  const out = {
    generatedAt: new Date().toISOString(),
    universeTotal: allUniverse.length,
    universeValid: validUniverse.length,
    trendUpCount: validUniverse.filter(r => r.trendUp).length,
    kospi: {
      universeTotal: kospiUniverse.length,
      trendUpCount: validUniverse.filter(r => r.trendUp).length,
      candidatesKpi: { total: outCandidatesKs.length },
    },
    holdingsKpi: {
      total: validHoldingsOut.length,
      trendUp: validHoldingsOut.filter(h => h.trendUp).length,
      avgUnrealizedRet: validHoldingsOut.length ? validHoldingsOut.reduce((a, h) => a + h.unrealizedRet, 0) / validHoldingsOut.length : null,
    },
    candidatesKospi: outCandidatesKs,
    holdings: outHoldings,
  };
  console.log(JSON.stringify(out));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
