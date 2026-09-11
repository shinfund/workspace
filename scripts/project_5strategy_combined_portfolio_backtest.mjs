// 5전략(눌림목+괴리율+라운드넘버+장대양봉+스윙지지저항) 통합 4슬롯 공유자본 포트폴리오 (2026-09-11)
// 배경: [[project_swing_high_low_strategy_plan]]에서 스윙 고점/저점 전략의 트레이드레벨 perDay(0.098%)가
// 기존 확정 4전략(눌림목/괴리율/라운드넘버/장대양봉)보다 낮게 나온 상태 — 그러나 이 계정 히스토리에서
// "개별/단독 지표가 낮아도 4전략 슬롯공유에서는 빈 슬롯을 채워 헤드라인을 오히려 개선"시킨 전례가
// 라운드넘버·장대양봉(headroom 필터) 둘 다 있어, perDay만으로 사전 판단하지 않고 실제 슬롯공유
// 포트폴리오로 순증분을 검증하기 위해 project_4strategy_combined_portfolio_backtest.mjs 엔진에
// 스윙 전략(project_swing_support_resistance_backtest.mjs 확정 파라미터)을 5번째 후보로 추가.
// 사용법: node scripts/project_5strategy_combined_portfolio_backtest.mjs [--from 2019-08-27] [--to ...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const PB = { MA_SHORT: 50, MA_LONG: 100, SLOPE_LOOKBACK: 10, BREAKOUT_LOOKBACK: 6, ATR_PERIOD: 14, BAND_K: 0.4, SL: 8, TRAIL: 8, TP_PCT: 20, TP_FRAC: 0.4, REGIME_STREAK_MIN: 10, KOSPI_ATR_PERIOD: 14, VOL_CAP: 4, STOCK_ATR_CAP: 6, MAX_HOLD: 40, CAP: 3, COOLDOWN_DAYS: 5 };
const DV = { ROLL: 250, Z_THRESHOLD: -2, ENTRY_PCT_THRESHOLD: 3, FAST: 5, SLOW: 20, MID: 50, MID2: 100, LONG: 200, SL: 18, TP: 20, MAX_HOLD: 20, CAP: 3 };
const RN = { WINDOW_DAYS: 150, TARGET_TICKS: 30, RECENT_LOOKBACK: 20, PRIOR_ABOVE_DAYS: 5, MIN_TOUCHES: 3, RECLAIM_WINDOW: 5, STOP_BUFFER_PCT: 3, MAX_HOLD: 60, MIN_ENTRY_POSITION_PCT: 20, MIN_BAND_WIDTH_PCT: 2.5, CAP: 3 };
const BC = { bodyPct: 5, bodyPctMax: 25, minHeadroomPct: 1, retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, confirmWindow: 5, requireUptrend: true, CAP: 3, BASE_PERIOD: 200 };
// 스윙 지지/저항(2026-09-11 확정 파라미터, project_swing_support_resistance_backtest.mjs와 동일)
const SW = { pivotLeft: 5, pivotRight: 5, windowDays: 150, minTouches: 10, recentLookback: 20, priorAboveDays: 5, reclaimWindow: 5, stopBufferPct: 3, maxHold: 60, CAP: 3 };

const SLOTS = 4;
const START_CAPITAL = 10_000_000;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { from: '2019-08-27', to: null, fetchFrom: '2017-01-01' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') o.from = argv[++i];
    if (argv[i] === '--to') o.to = argv[++i];
  }
  return o;
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) { const price = closes[i]; if (price == null) continue; if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; } else ema = price * k + ema * (1 - k); emas[i] = ema; }
  return emas;
}
function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) { if (h[i] == null || l[i] == null) continue; if (i === 0) { tr[i] = h[i] - l[i]; continue; } const pc = c[i - 1]; tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) { const v = tr[i]; if (v != null) { sum += v; cnt++; } if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } } if (cnt === period) smas[i] = sum / period; }
  return smas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdevPop(arr, m) { return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep))); const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) { const dist = Math.abs(Math.log(norm) - Math.log(f)); if (dist < bestDist) { bestDist = dist; best = f; } }
  return best * mag;
}
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1); let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) { if (highs[k] > hi) hi = highs[k]; if (lows[k] < low) low = lows[k]; }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays); let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// 스윙 고점/저점 탐지(project_swing_support_resistance_backtest.mjs와 동일 로직)
function detectSwingPoints(highs, lows, left, right) {
  const n = highs.length;
  const swingLows = [], swingHighs = [];
  for (let p = left; p < n - right; p++) {
    let isLow = true, isHigh = true;
    for (let k = p - left; k <= p + right; k++) {
      if (k === p) continue;
      if (lows[k] < lows[p]) isLow = false;
      if (highs[k] > highs[p]) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) swingLows.push({ idx: p, price: lows[p], confirmedIdx: p + right });
    if (isHigh) swingHighs.push({ idx: p, price: highs[p], confirmedIdx: p + right });
  }
  return { swingLows, swingHighs };
}
function nearestKnownSwingLowBelow(swingLows, idx, price, windowDays) {
  let best = null;
  for (const sl of swingLows) {
    if (sl.confirmedIdx > idx - 1) continue;
    if (sl.idx < idx - windowDays) continue;
    if (sl.price > price) continue;
    if (!best || sl.price > best.price) best = sl;
  }
  return best;
}
function nearestKnownSwingHighAbove(swingHighs, idx, price) {
  let best = null;
  for (const sh of swingHighs) {
    if (sh.confirmedIdx > idx) continue;
    if (sh.price <= price) continue;
    if (!best || sh.price < best.price) best = sh;
  }
  return best;
}

async function loadStock(stock, p1, p2) {
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low), opens = fillForward(chart.open);
  return { ...stock, dates, closes, highs, lows, opens };
}

function precomputePullback(st, regimeByMarket) {
  const { dates, closes, highs, lows } = st; const n = dates.length;
  const maShort = buildEma(closes, PB.MA_SHORT), maLong = buildEma(closes, PB.MA_LONG);
  const atr = buildAtr(highs, lows, closes, PB.ATR_PERIOD);
  const atrPct = atr.map((v, i) => v != null && closes[i] ? v / closes[i] * 100 : null);
  const marketRegime = regimeByMarket.KOSPI, otherRegime = regimeByMarket.KOSDAQ;
  const cond = new Array(n).fill(false); const scoreArr = new Array(n).fill(null);
  for (let i = PB.MA_LONG + PB.SLOPE_LOOKBACK; i < n - 1; i++) {
    if (maShort[i] == null || maLong[i] == null) continue;
    const prior = maLong[i - PB.SLOPE_LOOKBACK]; if (prior == null) continue;
    const trendUp = closes[i] > maLong[i] && maShort[i] > maLong[i] && maLong[i] > prior;
    if (!trendUp) continue;
    const d = dates[i];
    if (marketRegime.regime[d] !== true || otherRegime.regime[d] !== true) continue;
    if ((marketRegime.streak[d] ?? 0) < PB.REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[d]; if (kospiVol == null || kospiVol > PB.VOL_CAP) continue;
    if (i < PB.MA_SHORT || atrPct[i] == null || atrPct[i] <= 0 || atrPct[i] > PB.STOCK_ATR_CAP) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (PB.MA_SHORT - 1); k <= i - 1; k++) { if (closes[k] > highS) { highS = closes[k]; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - PB.BREAKOUT_LOOKBACK;
    if (!recentBreakout || closes[i] > highS || closes[i] <= maShort[i]) continue;
    const pullbackPct = (highS - closes[i]) / highS * 100;
    const pullbackNorm = pullbackPct / atrPct[i];
    if (pullbackNorm > PB.BAND_K) continue;
    cond[i] = true; scoreArr[i] = { trendStrength: (maLong[i] - prior) / prior * 100, pullbackNorm };
  }
  const onset = []; for (let i = 1; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  const score = new Map(onset.map(i => [i, scoreArr[i]]));
  return { maShort, atrPct, onsetIdx: new Set(onset), score };
}
function precomputeDeviation(st) {
  const { dates, closes } = st; const n = dates.length;
  const ema5 = buildEma(closes, DV.FAST), ema20 = buildEma(closes, DV.SLOW), ema50 = buildEma(closes, DV.MID), ema200 = buildEma(closes, DV.LONG);
  const dev5 = closes.map((c, i) => ema5[i] != null ? (c - ema5[i]) / ema5[i] * 100 : null);
  const dev20 = closes.map((c, i) => ema20[i] != null ? (c - ema20[i]) / ema20[i] * 100 : null);
  const cond = new Array(n).fill(false); const scoreArr = new Array(n).fill(null);
  for (let i = DV.ROLL - 1; i < n; i++) {
    if (dev5[i] == null || dev20[i] == null || ema50[i] == null || ema200[i] == null) continue;
    const win5 = dev5.slice(i - DV.ROLL + 1, i + 1), win20 = dev20.slice(i - DV.ROLL + 1, i + 1);
    if (win5.some(v => v == null) || win20.some(v => v == null)) continue;
    const m5 = mean(win5), sd5 = stdevPop(win5, m5), z5 = sd5 ? (dev5[i] - m5) / sd5 : 0, pct5 = win5.filter(v => v <= dev5[i]).length / win5.length * 100;
    const m20 = mean(win20), sd20 = stdevPop(win20, m20), z20 = sd20 ? (dev20[i] - m20) / sd20 : 0, pct20 = win20.filter(v => v <= dev20[i]).length / win20.length * 100;
    const sig5 = z5 <= DV.Z_THRESHOLD && pct5 <= DV.ENTRY_PCT_THRESHOLD;
    const sig20 = z20 <= DV.Z_THRESHOLD && pct20 <= DV.ENTRY_PCT_THRESHOLD;
    const downTrend = ema50[i] < ema200[i];
    cond[i] = sig5 && sig20 && downTrend;
    if (cond[i]) scoreArr[i] = { zSum: z5 + z20, pctSum: pct5 + pct20 };
  }
  const onset = []; for (let i = DV.ROLL; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  const score = new Map(onset.map(i => [i, scoreArr[i]]));
  return { ema5, ema20, onsetIdx: new Set(onset), score };
}
function precomputeRoundnumber(st) {
  const { dates, closes, highs, lows } = st; const n = dates.length;
  const events = new Map();
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1], cur = closes[i];
    const step = computeStepAt(highs, lows, i, RN.WINDOW_DAYS, RN.TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < RN.MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, i - 1 - RN.RECENT_LOOKBACK);
    let aboveCount = 0; for (let k = lo; k < i - 1; k++) if (closes[k] >= L) aboveCount++;
    if (aboveCount < RN.PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, RN.WINDOW_DAYS);
    if (touch < RN.MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RN.RECLAIM_WINDOW); f++) {
      if (closes[f] < L - step) break;
      if (closes[f] >= L) {
        if (closes[f] < L + step) {
          const entryPosition = (closes[f] - L) / step * 100;
          if (entryPosition >= RN.MIN_ENTRY_POSITION_PCT) events.set(f, { level: L, step, touchCount: touch, aboveCount });
        }
        break;
      }
    }
  }
  return { events };
}
function precomputeBigcandle(st) {
  const { dates, closes, highs, lows, opens } = st; const n = dates.length;
  const ema200 = buildEma(closes, BC.BASE_PERIOD);
  const events = new Map();
  for (let i = 0; i < n; i++) {
    const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < BC.bodyPct) continue;
    if (bodyPct > BC.bodyPctMax) continue;
    const mid = (o + c) / 2, candleLow = l, candleHigh = h;
    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + BC.retestWindow); f++) {
      if (closes[f] < candleLow) break;
      if (lows[f] <= mid) { touchIdx = f; break; }
    }
    if (touchIdx == null) continue;
    const touchHigh = highs[touchIdx];
    if (touchHigh >= candleHigh) continue;
    let confirmIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + BC.confirmWindow + 1); c2++) {
      if (closes[c2] < candleLow) break;
      if (closes[c2] > touchHigh) { confirmIdx = c2; break; }
    }
    if (confirmIdx == null) continue;
    if (closes[confirmIdx] >= candleHigh) continue;
    const headroomPct = (candleHigh - closes[confirmIdx]) / closes[confirmIdx] * 100;
    if (headroomPct < BC.minHeadroomPct) continue;
    const e200 = ema200[confirmIdx];
    if (BC.requireUptrend && (e200 == null || closes[confirmIdx] < e200)) continue;
    const stop = candleLow * (1 - BC.stopBufferPct / 100);
    if (!events.has(confirmIdx)) events.set(confirmIdx, { stop, candleHigh, candleLow, bodyPct });
  }
  return { events };
}
// 스윙 지지/저항 신호 사전계산(project_swing_support_resistance_backtest.mjs 확정 파라미터·로직 재사용)
function precomputeSwing(st) {
  const { closes, highs, lows } = st; const n = closes.length;
  const { swingLows, swingHighs } = detectSwingPoints(highs, lows, SW.pivotLeft, SW.pivotRight);
  const events = new Map();
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1], cur = closes[i];
    const sl = nearestKnownSwingLowBelow(swingLows, i, prev, SW.windowDays);
    if (!sl) continue;
    const L = sl.price;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    const lo = Math.max(0, i - 1 - SW.recentLookback);
    let aboveCount = 0; for (let k = lo; k < i - 1; k++) if (closes[k] >= L) aboveCount++;
    if (aboveCount < SW.priorAboveDays) continue;
    const touch = touchCountBefore(highs, lows, i, L, SW.windowDays);
    if (touch < SW.minTouches) continue;
    const stop = L * (1 - SW.stopBufferPct / 100);
    for (let f = i; f < Math.min(n, i + SW.reclaimWindow); f++) {
      if (closes[f] < stop) break;
      if (closes[f] >= L) {
        const target = nearestKnownSwingHighAbove(swingHighs, f, closes[f]);
        if (target && !events.has(f)) events.set(f, { level: L, target: target.price, touchCount: touch, aboveCount });
        break;
      }
    }
  }
  return { events };
}

async function fetchMarketRegime(p1, p2, symbol) {
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, PB.MA_LONG);
  const kospiAtr = buildAtr(chart.high, chart.low, closes, PB.KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {}; let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < PB.MA_LONG + PB.SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - PB.SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}

function computeBeta(st, kospiRetByDate) {
  const rets = [], kospiRets = [];
  for (let i = 1; i < st.dates.length; i++) {
    if (st.closes[i] == null || st.closes[i - 1] == null) continue;
    const kr = kospiRetByDate.get(st.dates[i]); if (kr == null) continue;
    rets.push((st.closes[i] - st.closes[i - 1]) / st.closes[i - 1] * 100); kospiRets.push(kr);
  }
  if (rets.length < 30) return null;
  const mR = mean(rets), mK = mean(kospiRets);
  let cov = 0, varK = 0;
  for (let i = 0; i < rets.length; i++) { cov += (rets[i] - mR) * (kospiRets[i] - mK); varK += (kospiRets[i] - mK) ** 2; }
  return varK ? cov / varK : null;
}

function runPortfolioSim(calendar, ctx, includeSwing) {
  const { byCode, idxMap, pbData, dvData, rnData, bcData, swData, betaMap } = ctx;
  let cash = START_CAPITAL, costBasisTotal = 0;
  const positions = [], trades = [];
  let skipCount = 0;
  const pbCooldownUntil = new Map();

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];

    // EXIT PHASE
    for (let pi = positions.length - 1; pi >= 0; pi--) {
      const pos = positions[pi];
      const m = idxMap.get(pos.code); const i = m ? m.get(date) : null;
      if (i == null) continue;
      const st = byCode.get(pos.code);
      const close = st.closes[i];
      const daysHeld = i - pos.entryIdx;

      if (pos.strategy === '눌림목') {
        const pb = pbData.get(pos.code);
        const maShort = pb.maShort[i];
        const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
        if (!pos.st.tpTaken && ret >= PB.TP_PCT) {
          pos.st.tpTaken = true; if (close > pos.st.peak) pos.st.peak = close;
          const sellShares = Math.round(pos.shares * PB.TP_FRAC);
          const shares = Math.min(sellShares, pos.remainingShares);
          if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
        } else {
          let exited = false;
          if (ret <= -PB.SL) { exited = true; pbCooldownUntil.set(pos.code, i + PB.COOLDOWN_DAYS); }
          else if (maShort != null && close < maShort) exited = true;
          else {
            if (close > pos.st.peak) pos.st.peak = close;
            const trailRet = (close - pos.st.peak) / pos.st.peak * 100;
            if (trailRet <= -PB.TRAIL) exited = true;
            else if (daysHeld >= PB.MAX_HOLD) exited = true;
          }
          if (exited) {
            const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining;
            pos.realizedCash += proceeds;
            trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100 });
            positions.splice(pi, 1); continue;
          }
        }
        if (pos.remainingShares <= 0) positions.splice(pi, 1);
      } else if (pos.strategy === '괴리율') {
        const dv = dvData.get(pos.code);
        const ema20 = dv.ema20[i], ema5 = dv.ema5[i];
        const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
        const fullExit = () => { const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining; pos.realizedCash += proceeds; trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100 }); positions.splice(pi, 1); };
        if (ret <= -DV.SL) { fullExit(); continue; }
        if (pos.st.stage === 'INIT' && ret >= DV.TP) {
          const shares = Math.min(Math.round(pos.shares * 0.5), pos.remainingShares);
          if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
          pos.st.stage = 'TP20_DONE';
        }
        if (pos.st.stage === 'TP20_DONE' && ema20 != null && close >= ema20) {
          const shares = Math.min(Math.round(pos.shares * 0.25), pos.remainingShares);
          if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
          pos.st.stage = 'HOLD';
        }
        if (pos.st.stage === 'HOLD' && ema5 != null && close < ema5) { fullExit(); continue; }
        if (daysHeld >= DV.MAX_HOLD && pos.remainingShares > 0) { fullExit(); continue; }
        if (pos.remainingShares <= 0) positions.splice(pi, 1);
      } else if (pos.strategy === '라운드넘버') {
        const stop = pos.st.level * (1 - RN.STOP_BUFFER_PCT / 100), target = pos.st.level + pos.st.step;
        if (close <= stop || close >= target || daysHeld >= RN.MAX_HOLD) {
          const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining; pos.realizedCash += proceeds;
          trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100 });
          positions.splice(pi, 1);
        }
      } else if (pos.strategy === '장대양봉') {
        if (close <= pos.st.stop || close >= pos.st.candleHigh || daysHeld >= BC.maxHold) {
          const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining; pos.realizedCash += proceeds;
          trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100 });
          positions.splice(pi, 1);
        }
      } else if (pos.strategy === '스윙') {
        const stop = pos.st.level * (1 - SW.stopBufferPct / 100), target = pos.st.target;
        if (close <= stop || close >= target || daysHeld >= SW.maxHold) {
          const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining; pos.realizedCash += proceeds;
          trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100 });
          positions.splice(pi, 1);
        }
      }
    }

    // ENTRY PHASE
    let openSlots = SLOTS - positions.length;
    if (openSlots <= 0) continue;
    const held = new Set(positions.map(p => p.code));

    const pbCandsRaw = [], dvCandsRaw = [], rnCandsRaw = [], bcCandsRaw = [], swCandsRaw = [];
    for (const s of UNIVERSE) {
      if (held.has(s.code)) continue;
      const st = byCode.get(s.code); if (!st) continue;
      const m = idxMap.get(s.code); const i = m ? m.get(date) : null; if (i == null) continue;
      const pb = pbData.get(s.code); if (pb.onsetIdx.has(i) && i > (pbCooldownUntil.get(s.code) ?? -1)) pbCandsRaw.push({ s, i, sc: pb.score.get(i) });
      const dv = dvData.get(s.code); if (dv.onsetIdx.has(i)) dvCandsRaw.push({ s, i, sc: dv.score.get(i) });
      const rn = rnData.get(s.code); const ev = rn?.events.get(i); if (ev) rnCandsRaw.push({ s, i, ev });
      const bc = bcData.get(s.code); const bev = bc?.events.get(i); if (bev) bcCandsRaw.push({ s, i, bev });
      if (includeSwing) { const sw = swData.get(s.code); const sev = sw?.events.get(i); if (sev) swCandsRaw.push({ s, i, sev }); }
    }
    pbCandsRaw.sort((a, b) => (b.sc.trendStrength - a.sc.trendStrength) || (a.sc.pullbackNorm - b.sc.pullbackNorm));
    const pbCands = pbCandsRaw.slice(0, PB.CAP); skipCount += Math.max(0, pbCandsRaw.length - PB.CAP);
    dvCandsRaw.sort((a, b) => (a.sc.zSum - b.sc.zSum) || (a.sc.pctSum - b.sc.pctSum));
    const dvCands = dvCandsRaw.slice(0, DV.CAP); skipCount += Math.max(0, dvCandsRaw.length - DV.CAP);
    rnCandsRaw.sort((a, b) => (b.ev.touchCount - a.ev.touchCount) || (b.ev.aboveCount - a.ev.aboveCount));
    const rnCands = rnCandsRaw.slice(0, RN.CAP); skipCount += Math.max(0, rnCandsRaw.length - RN.CAP);
    bcCandsRaw.sort((a, b) => b.bev.bodyPct - a.bev.bodyPct);
    const bcCands = bcCandsRaw.slice(0, BC.CAP); skipCount += Math.max(0, bcCandsRaw.length - BC.CAP);
    swCandsRaw.sort((a, b) => (b.sev.touchCount - a.sev.touchCount) || (b.sev.aboveCount - a.sev.aboveCount));
    const swCands = swCandsRaw.slice(0, SW.CAP); skipCount += Math.max(0, swCandsRaw.length - SW.CAP);

    const queue = [...pbCands.map(c => ({ ...c, strategy: '눌림목' })), ...dvCands.map(c => ({ ...c, strategy: '괴리율' })), ...rnCands.map(c => ({ ...c, strategy: '라운드넘버' })), ...bcCands.map(c => ({ ...c, strategy: '장대양봉' })), ...swCands.map(c => ({ ...c, strategy: '스윙' }))];
    if (queue.length > openSlots) {
      queue.sort((a, b) => (betaMap.get(b.s.code) ?? -Infinity) - (betaMap.get(a.s.code) ?? -Infinity));
    }

    for (const cand of queue) {
      if (openSlots <= 0) { skipCount++; continue; }
      if (held.has(cand.s.code)) continue;
      const st = byCode.get(cand.s.code);
      const price = st.closes[cand.i];
      const budget = Math.min(START_CAPITAL / SLOTS, cash);
      const shares = Math.floor(budget / price);
      if (shares <= 0) { skipCount++; continue; }
      const investedTotal = shares * price;
      cash -= investedTotal; costBasisTotal += investedTotal;
      const pos = {
        strategy: cand.strategy, code: cand.s.code, name: cand.s.name,
        entryDate: date, entryIdx: cand.i, entryPrice: price, shares, remainingShares: shares, costRemaining: investedTotal,
        investedTotal, realizedCash: 0,
        st: cand.strategy === '눌림목' ? { tpTaken: false, peak: price }
          : cand.strategy === '괴리율' ? { stage: 'INIT' }
          : cand.strategy === '라운드넘버' ? { level: cand.ev.level, step: cand.ev.step }
          : cand.strategy === '장대양봉' ? { stop: cand.bev.stop, candleHigh: cand.bev.candleHigh }
          : { level: cand.sev.level, target: cand.sev.target },
      };
      positions.push(pos); held.add(cand.s.code); openSlots--;
    }
  }

  return { trades, finalCash: cash, finalPositions: positions, skipCount };
}

async function main() {
  const opts = parseArgs();
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(new Date(opts.fetchFrom + 'T00:00:00Z').getTime() / 1000);
  const toDate = opts.to || tsToKstDate(p2 - 9 * 3600);

  console.error('[1/4] 지수·유니버스 시세 로드 중...');
  const [regimeKospi, regimeKosdaq] = await Promise.all([fetchMarketRegime(p1, p2, '^KS11'), fetchMarketRegime(p1, p2, '^KQ11')]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };
  const loaded = await batchAll(UNIVERSE, s => loadStock(s, p1, p2));
  const byCode = new Map();
  for (const st of loaded) if (!st.error) byCode.set(st.code, st);
  console.error(`[1/4] 완료 — ${byCode.size}/${UNIVERSE.length}종목`);

  const kospiChartForBeta = await fetchYahooChart('^KS11', p1, p2);
  const kospiRetByDate = new Map();
  { const kd = kospiChartForBeta.ts.map(tsToKstDate), kc = fillForward(kospiChartForBeta.close);
    for (let i = 1; i < kd.length; i++) if (kc[i] != null && kc[i - 1] != null) kospiRetByDate.set(kd[i], (kc[i] - kc[i - 1]) / kc[i - 1] * 100); }
  const betaMap = new Map();
  for (const st of byCode.values()) { const b = computeBeta(st, kospiRetByDate); if (b != null) betaMap.set(st.code, b); }

  console.error('[2/4] 전략별 지표·진입시그널 사전계산 중...');
  const pbData = new Map(), dvData = new Map(), rnData = new Map(), bcData = new Map(), swData = new Map();
  for (const st of byCode.values()) {
    pbData.set(st.code, precomputePullback(st, regimeByMarket));
    dvData.set(st.code, precomputeDeviation(st));
    rnData.set(st.code, precomputeRoundnumber(st));
    bcData.set(st.code, precomputeBigcandle(st));
    swData.set(st.code, precomputeSwing(st));
  }
  console.error('[2/4] 완료');

  const kospiChart = await fetchYahooChart('^KS11', p1, p2);
  const calendar = kospiChart.ts.map(tsToKstDate).filter(d => d >= opts.from && d <= toDate);
  console.error(`[3/4] 캘린더 ${calendar.length}거래일 (${opts.from} ~ ${toDate})`);
  const idxMap = new Map();
  for (const st of byCode.values()) { const m = new Map(); st.dates.forEach((d, i) => m.set(d, i)); idxMap.set(st.code, m); }

  const ctx = { byCode, idxMap, pbData, dvData, rnData, bcData, swData, betaMap };

  console.error('[4/4] 시뮬레이션 실행 중(기준 4전략 vs 스윙 포함 5전략)...');
  const runBaseline = runPortfolioSim(calendar, ctx, false);
  const runWithSwing = runPortfolioSim(calendar, ctx, true);

  function report(run, label) {
    const finalCapital = run.finalCash + run.finalPositions.reduce((a, p) => a + p.remainingShares * (byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice), 0);
    const totalReturn = (finalCapital - START_CAPITAL) / START_CAPITAL * 100;
    console.log(`\n━━━ ${label} ━━━`);
    console.log(`기간: ${calendar[0]} ~ ${calendar.at(-1)} (${calendar.length}거래일)`);
    console.log(`시작자본 ${fmtWon(START_CAPITAL)}원 → 최종 ${fmtWon(finalCapital)}원 (${fmtPct(totalReturn)})`);
    console.log(`총 청산 ${run.trades.length}건, 미청산 ${run.finalPositions.length}건, 슬롯부족 스킵 ${run.skipCount}건`);
    console.log('전략별 청산 실적:');
    for (const strat of ['눌림목', '괴리율', '라운드넘버', '장대양봉', '스윙']) {
      const arr = run.trades.filter(t => t.strategy === strat);
      if (!arr.length && strat === '스윙' && label.includes('기준')) continue;
      const pnl = arr.reduce((a, t) => a + t.realizedPnl, 0);
      console.log(`  ${strat.padEnd(6)} ${String(arr.length).padStart(4)}건  실현손익 ${fmtWon(pnl)}원`);
    }
    return { finalCapital, totalReturn };
  }

  const base = report(runBaseline, '기준(4전략: 눌림목+괴리율+라운드넘버+장대양봉)');
  const withSw = report(runWithSwing, '5전략(기준+스윙 지지/저항)');

  console.log(`\n━━━ 순증분(스윙 편입 전/후) ━━━`);
  console.log(`헤드라인 ${fmtPct(base.totalReturn)} → ${fmtPct(withSw.totalReturn)} (${fmtPct(withSw.totalReturn - base.totalReturn)}p)`);
  console.log(`최종자본 ${fmtWon(base.finalCapital)}원 → ${fmtWon(withSw.finalCapital)}원 (차액 ${fmtWon(withSw.finalCapital - base.finalCapital)}원)`);
}

main().catch(e => { console.error('오류:', e.message, e.stack); process.exit(1); });
