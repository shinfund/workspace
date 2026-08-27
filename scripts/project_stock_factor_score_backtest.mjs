// 종목별 팩터 점수 백테스트 (2026-08-27 신설, 1회성 분석용)
// "매매결과 기반이 아닌 다른 기준으로 종목 점수를 매기면 진입 판단에 도움이 될까?" 질문에 대한 검증.
// [[project_roundnumber_strategy]] 2026-08-25 OOS 검증에서 "종목별 과거 매매성과로 선별"은 이미 기각됐으므로
// 이번엔 매매결과와 무관한 정적/구조적 팩터 4종을 시도한다: ①유동성(평균거래대금) ②변동성(ATR%) ③베타(KOSPI상관)
// ④시총순위(코스피50 내 랭크). 룩어헤드 편향을 피하기 위해 전반부 구간에서만 팩터값을 계산하고,
// 후반부 구간의 3전략(눌림목+괴리율+라운드넘버, 슬롯제약 없는 순수 신호 단위) 매매성과로 검증한다
// (project_roundnumber_stock_selection_oos_backtest.mjs와 동일한 전반부/후반부 분리 방법론).
// 사용법: node scripts/project_stock_factor_score_backtest.mjs
import https from 'https';
import { fetchKrxUniverse } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];

const PB = { MA_SHORT: 50, MA_LONG: 100, SLOPE_LOOKBACK: 10, BREAKOUT_LOOKBACK: 6, ATR_PERIOD: 14, BAND_K: 0.4, SL: 8, TRAIL: 8, TP_PCT: 20, TP_FRAC: 0.4, REGIME_STREAK_MIN: 10, KOSPI_ATR_PERIOD: 14, VOL_CAP: 4, STOCK_ATR_CAP: 6, MAX_HOLD: 40, COOLDOWN_DAYS: 5 };
const DV = { ROLL: 250, Z_THRESHOLD: -2, ENTRY_PCT_THRESHOLD: 3, FAST: 5, SLOW: 20, MID: 50, LONG: 200, SL: 18, TP: 20, MAX_HOLD: 20 };
const RN = { WINDOW_DAYS: 150, TARGET_TICKS: 30, RECENT_LOOKBACK: 20, PRIOR_ABOVE_DAYS: 5, MIN_TOUCHES: 3, RECLAIM_WINDOW: 5, STOP_BUFFER_PCT: 3, MAX_HOLD: 60, MIN_ENTRY_POSITION_PCT: 20, MIN_BAND_WIDTH_PCT: 2.5 };

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
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
      if (!result) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes);
  const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < filled.length; i++) {
    const price = filled[i]; if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else ema = price * k + ema * (1 - k);
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
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdevPop(arr, m) { return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
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
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function fetchMarketRegime(p1, p2, symbol) {
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, PB.MA_LONG);
  const atr = buildAtr(chart.high, chart.low, closes, PB.KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {}; let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < PB.MA_LONG + PB.SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - PB.SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = atr[i] != null ? atr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct, dates };
}

// ── 종목별 3전략 전체 트레이드(슬롯제약 없음, 순수 신호단위) 생성 ──
function pullbackTrades(st, regimeByMarket) {
  const { dates, closes, highs, lows } = st;
  const n = dates.length;
  const marketRegime = regimeByMarket.KOSPI, otherRegime = regimeByMarket.KOSDAQ;
  const maShort = buildEma(closes, PB.MA_SHORT), maLong = buildEma(closes, PB.MA_LONG);
  const atr = buildAtr(highs, lows, closes, PB.ATR_PERIOD);
  const atrPct = atr.map((v, i) => v != null && closes[i] ? v / closes[i] * 100 : null);
  const cond = new Array(n).fill(false);
  for (let i = PB.MA_LONG + PB.SLOPE_LOOKBACK; i < n; i++) {
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
    for (let k = i - (PB.MA_SHORT - 1); k <= i - 1; k++) if (closes[k] > highS) { highS = closes[k]; highSIdx = k; }
    if (!(highSIdx >= i - PB.BREAKOUT_LOOKBACK) || closes[i] > highS || closes[i] <= maShort[i]) continue;
    const pullbackPct = (highS - closes[i]) / highS * 100;
    if (pullbackPct / atrPct[i] > PB.BAND_K) continue;
    cond[i] = true;
  }
  const trades = [];
  let blockedUntilIdx = -1;
  for (let i = 1; i < n - 1; i++) {
    if (!(cond[i] && !cond[i - 1])) continue;
    if (i <= blockedUntilIdx) continue;
    const entryClose = closes[i];
    let peak = entryClose, tpTaken = false, tpReturn = null;
    for (let d = 1; d <= PB.MAX_HOLD; d++) {
      const j = i + d; if (j >= n) break;
      const close = closes[j], ret = (close - entryClose) / entryClose * 100;
      if (!tpTaken && ret >= PB.TP_PCT) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
      const finish = (reason) => ({ reason, ret: tpTaken ? PB.TP_FRAC * tpReturn + (1 - PB.TP_FRAC) * ret : ret, date: dates[j] });
      if (ret <= -PB.SL) { trades.push({ date: dates[i], ...finish('SL') }); blockedUntilIdx = j + PB.COOLDOWN_DAYS; break; }
      if (maShort[j] != null && close < maShort[j]) { trades.push({ date: dates[i], ...finish('TREND_BREAK') }); break; }
      if (close > peak) peak = close;
      if ((close - peak) / peak * 100 <= -PB.TRAIL) { trades.push({ date: dates[i], ...finish('TRAIL') }); break; }
      if (d === PB.MAX_HOLD) trades.push({ date: dates[i], ...finish('TIME') });
    }
  }
  return trades;
}
function deviationTrades(st) {
  const { dates, closes } = st; const n = dates.length;
  const ema5 = buildEma(closes, DV.FAST), ema20 = buildEma(closes, DV.SLOW), ema50 = buildEma(closes, DV.MID), ema200 = buildEma(closes, DV.LONG);
  const dev5 = closes.map((c, i) => ema5[i] != null ? (c - ema5[i]) / ema5[i] * 100 : null);
  const dev20 = closes.map((c, i) => ema20[i] != null ? (c - ema20[i]) / ema20[i] * 100 : null);
  const cond = new Array(n).fill(false);
  for (let i = DV.ROLL - 1; i < n; i++) {
    if (dev5[i] == null || dev20[i] == null || ema50[i] == null || ema200[i] == null) continue;
    const win5 = dev5.slice(i - DV.ROLL + 1, i + 1), win20 = dev20.slice(i - DV.ROLL + 1, i + 1);
    if (win5.some(v => v == null) || win20.some(v => v == null)) continue;
    const m5 = mean(win5), sd5 = stdevPop(win5, m5), z5 = sd5 ? (dev5[i] - m5) / sd5 : 0, pct5 = win5.filter(v => v <= dev5[i]).length / win5.length * 100;
    const m20 = mean(win20), sd20 = stdevPop(win20, m20), z20 = sd20 ? (dev20[i] - m20) / sd20 : 0, pct20 = win20.filter(v => v <= dev20[i]).length / win20.length * 100;
    const sig5 = z5 <= DV.Z_THRESHOLD && pct5 <= DV.ENTRY_PCT_THRESHOLD, sig20 = z20 <= DV.Z_THRESHOLD && pct20 <= DV.ENTRY_PCT_THRESHOLD;
    cond[i] = sig5 && sig20 && ema50[i] < ema200[i];
  }
  const trades = [];
  for (let i = DV.ROLL; i < n; i++) {
    if (!(cond[i] && !cond[i - 1])) continue;
    const entryClose = closes[i];
    let openWeight = 1.0, stage = 'INIT', tpTaken = false;
    const legs = [];
    for (let d = 1; d <= DV.MAX_HOLD; d++) {
      const j = i + d; if (j >= n) { legs.length = 0; break; }
      const close = closes[j], e20 = ema20[j], e5 = ema5[j];
      const ret = (close - entryClose) / entryClose * 100;
      if (ret <= -DV.SL) { legs.push({ weight: openWeight, ret }); openWeight = 0; break; }
      if (stage === 'INIT' && ret >= DV.TP) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; tpTaken = true; stage = 'TP20_DONE'; }
      if (stage === 'TP20_DONE' && e20 != null && close >= e20) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; stage = 'HOLD'; }
      if (stage === 'HOLD' && e5 != null && close < e5) { legs.push({ weight: openWeight, ret }); openWeight = 0; break; }
      if (d === DV.MAX_HOLD && openWeight > 1e-9) { legs.push({ weight: openWeight, ret }); openWeight = 0; }
    }
    if (!legs.length || openWeight > 1e-9) continue;
    const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
    trades.push({ date: dates[i], reason: tpTaken ? 'TP경유청산' : (weightedRet <= -DV.SL + 0.01 ? 'SL' : '청산'), ret: weightedRet });
  }
  return trades;
}
function roundnumberTrades(st) {
  const { dates, closes, highs, lows } = st; const n = dates.length;
  const trades = [];
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1], cur = closes[i];
    const step = computeStepAt(highs, lows, i, RN.WINDOW_DAYS, RN.TARGET_TICKS); if (!step) continue;
    const L = Math.floor(prev / step) * step;
    if (!(prev >= L && cur < L) || L <= 0) continue;
    if (step / L * 100 < RN.MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, i - 1 - RN.RECENT_LOOKBACK);
    let aboveCount = 0; for (let k = lo; k < i - 1; k++) if (closes[k] >= L) aboveCount++;
    if (aboveCount < RN.PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, RN.WINDOW_DAYS); if (touch < RN.MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RN.RECLAIM_WINDOW); f++) {
      if (closes[f] < L - step) break;
      if (closes[f] >= L) {
        if (closes[f] < L + step) {
          const entryPosition = (closes[f] - L) / step * 100;
          if (entryPosition >= RN.MIN_ENTRY_POSITION_PCT) {
            const target = L + step, stop = L * (1 - RN.STOP_BUFFER_PCT / 100);
            for (let d = 1; d <= RN.MAX_HOLD; d++) {
              const j = f + d; if (j >= n) break;
              const close = closes[j];
              if (close <= stop) { trades.push({ date: dates[f], reason: 'STOP', ret: (close - closes[f]) / closes[f] * 100 }); break; }
              if (close >= target) { trades.push({ date: dates[f], reason: 'TP', ret: (close - closes[f]) / closes[f] * 100 }); break; }
              if (d === RN.MAX_HOLD) { trades.push({ date: dates[f], reason: 'TIME', ret: (close - closes[f]) / closes[f] * 100 }); break; }
            }
          }
        }
        break;
      }
    }
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return { n: 0, winRate: null, avgRet: null };
  const n = trades.length;
  const winRate = trades.filter(t => t.ret > 0).length / n * 100;
  const avgRet = trades.reduce((a, t) => a + t.ret, 0) / n;
  return { n, winRate, avgRet };
}
function tercileLabel(rank, total) {
  if (rank < total / 3) return '상위33%';
  if (rank < total * 2 / 3) return '중위34%';
  return '하위33%';
}
function reportTercile(factorName, stocks, getFactor) {
  const ranked = stocks.filter(s => getFactor(s) != null).sort((a, b) => getFactor(b) - getFactor(a));
  const buckets = { '상위33%': [], '중위34%': [], '하위33%': [] };
  ranked.forEach((s, i) => buckets[tercileLabel(i, ranked.length)].push(s));
  console.log(`\n=== 팩터: ${factorName} (전반부 값 기준, 후반부 매매성과) ===`);
  console.log('구간\t종목수\t트레이드n\t승률\t평균수익률');
  for (const key of ['상위33%', '중위34%', '하위33%']) {
    const bs = buckets[key];
    const allTrades = bs.flatMap(s => s.laterTrades);
    const sm = summarize(allTrades);
    console.log(`${key}\t${bs.length}\t${sm.n}\t${sm.winRate != null ? sm.winRate.toFixed(1) + '%' : '-'}\t${sm.avgRet != null ? (sm.avgRet >= 0 ? '+' : '') + sm.avgRet.toFixed(2) + '%' : '-'}`);
  }
  return buckets;
}

async function main() {
  console.error('[팩터 점수 백테스트] 시작');
  let universe;
  try {
    const { kospi, basDt } = await fetchKrxUniverse();
    const sorted = kospi.sort((a, b) => b._mktcap - a._mktcap);
    const top50Codes = new Set(FALLBACK_KOSPI.map(s => s.code));
    universe = FALLBACK_KOSPI.map(s => {
      const rank = sorted.findIndex(k => k.종목코드 === s.code);
      return { ...s, mktcapRank: rank >= 0 ? rank : null };
    });
    console.error(`[시총] KRX 기준일 ${basDt} 랭크 매핑 완료`);
  } catch (e) {
    console.error(`[시총] KRX 조회 실패(${e.message}) → FALLBACK_KOSPI 원 순서를 랭크로 사용`);
    universe = FALLBACK_KOSPI.map((s, i) => ({ ...s, mktcapRank: i }));
  }

  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 2555 * 24 * 3600;
  const [regimeKospi, regimeKosdaq] = await Promise.all([
    fetchMarketRegime(p1, p2, '^KS11'), fetchMarketRegime(p1, p2, '^KQ11'),
  ]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };
  const kospiCloses = fillForward((await fetchYahooChart('^KS11', p1, p2)).close);
  const kospiDates = regimeKospi.dates;
  const kospiRetByDate = new Map();
  for (let i = 1; i < kospiDates.length; i++) if (kospiCloses[i] != null && kospiCloses[i - 1] != null) kospiRetByDate.set(kospiDates[i], (kospiCloses[i] - kospiCloses[i - 1]) / kospiCloses[i - 1] * 100);

  console.error(`[스캔] ${universe.length}종목 데이터 로드 중...`);
  const loaded = await batchAll(universe, async (s) => {
    const chart = await fetchYahooChart(`${s.code}.KS`, p1, p2);
    if (!chart || !chart.ts.length) return { ...s, error: true };
    const dates = chart.ts.map(tsToKstDate);
    return { ...s, dates, closes: fillForward(chart.close), highs: fillForward(chart.high), lows: fillForward(chart.low), volume: chart.volume };
  });
  const stocks = loaded.filter(s => !s.error);
  console.error(`[스캔] ${stocks.length}/${universe.length}종목 로드 성공, 3전략 전체구간 트레이드 생성 중...`);

  for (const s of stocks) {
    const st = { dates: s.dates, closes: s.closes, highs: s.highs, lows: s.lows };
    const pb = pullbackTrades(st, regimeByMarket).map(t => ({ ...t, strategy: '눌림목' }));
    const dv = deviationTrades(st).map(t => ({ ...t, strategy: '괴리율' }));
    const rn = roundnumberTrades(st).map(t => ({ ...t, strategy: '라운드넘버' }));
    s.allTrades = [...pb, ...dv, ...rn].sort((a, b) => a.date < b.date ? -1 : 1);
  }

  // ── 2026-08-27 검증 단계 추가: 단일 분리(median) 1회 대신, 캘린더 4분위 경계로 "확장윈도우 3회" 워크포워드 ──
  // exp1: train[start,Q1) → test[Q1,Q2) / exp2: train[start,Q2) → test[Q2,Q3) / exp3: train[start,Q3) → test[Q3,end]
  // 팩터값이 훈련구간에서만 계산되고 검증구간과 겹치지 않는 구조는 동일 유지, 3개 독립 구간에서 패턴 재현되는지 확인.
  function computeFactors(s, trainEndDate) {
    const idx = s.dates.map((d, i) => (d < trainEndDate ? i : -1)).filter(i => i >= 0);
    const liqVals = idx.map(i => (s.closes[i] != null && s.volume[i] != null) ? s.closes[i] * s.volume[i] : null).filter(v => v != null);
    const liquidity = liqVals.length ? mean(liqVals) : null;
    const atr = s._atr || (s._atr = buildAtr(s.highs, s.lows, s.closes, 14));
    const atrPctVals = idx.map(i => (atr[i] != null && s.closes[i]) ? atr[i] / s.closes[i] * 100 : null).filter(v => v != null);
    const volatility = atrPctVals.length ? mean(atrPctVals) : null;
    const rets = [], kospiRets = [];
    for (let k = 1; k < idx.length; k++) {
      const cur = idx[k], prev = idx[k - 1];
      if (s.closes[cur] == null || s.closes[prev] == null) continue;
      const r = (s.closes[cur] - s.closes[prev]) / s.closes[prev] * 100;
      const kr = kospiRetByDate.get(s.dates[cur]); if (kr == null) continue;
      rets.push(r); kospiRets.push(kr);
    }
    let beta = null;
    if (rets.length > 30) {
      const mR = mean(rets), mK = mean(kospiRets);
      let cov = 0, varK = 0;
      for (let k = 0; k < rets.length; k++) { cov += (rets[k] - mR) * (kospiRets[k] - mK); varK += (kospiRets[k] - mK) ** 2; }
      beta = varK ? cov / varK : null;
    }
    return { liquidity, volatility, beta };
  }

  const uniqDates = [...new Set(kospiDates)].sort();
  const qAt = f => uniqDates[Math.floor(uniqDates.length * f)];
  const Q1 = qAt(0.25), Q2 = qAt(0.50), Q3 = qAt(0.75), QEND = uniqDates[uniqDates.length - 1];
  const windows = [
    { label: 'exp1', trainEnd: Q1, testStart: Q1, testEnd: Q2 },
    { label: 'exp2', trainEnd: Q2, testStart: Q2, testEnd: Q3 },
    { label: 'exp3', trainEnd: Q3, testStart: Q3, testEnd: QEND },
  ];
  console.log(`\n━━━ 종목별 팩터 점수 백테스트 — 워크포워드 3구간 검증 (코스피50, 3전략 통합·슬롯제약 없음) ━━━`);
  console.log(`구간 경계: 시작~${Q1}(exp1 훈련) | ~${Q2}(exp2 훈련) | ~${Q3}(exp3 훈련) | ~${QEND}(끝)`);

  const FACTORS = [
    { key: 'liquidity', name: '유동성(평균거래대금)' },
    { key: 'volatility', name: '변동성(ATR%)' },
    { key: 'beta', name: '베타(KOSPI상관)' },
  ];
  const spreadByFactor = { liquidity: [], volatility: [], beta: [], mktcap: [] };
  let anchorFactors = null; // exp2(중간 분리) 시점 팩터값 — 상관분석/이중정렬용, 기존 median-split과 동급

  for (const w of windows) {
    console.log(`\n--- ${w.label}: train<${w.trainEnd} → test[${w.testStart},${w.testEnd}) ---`);
    const computed = new Map();
    for (const s of stocks) {
      const f = computeFactors(s, w.trainEnd);
      computed.set(s.code, f);
      s[`_beta_${w.label}`] = f.beta;
      if (w.label === 'exp2') { s._anchorBeta = f.beta; }
    }
    const testTrades = s => s.allTrades.filter(t => t.date >= w.testStart && t.date < w.testEnd);
    for (const fac of FACTORS) {
      const ranked = stocks.filter(s => computed.get(s.code)[fac.key] != null).sort((a, b) => computed.get(b.code)[fac.key] - computed.get(a.code)[fac.key]);
      const top = ranked.slice(0, Math.floor(ranked.length / 3));
      const bot = ranked.slice(-Math.floor(ranked.length / 3));
      const topSm = summarize(top.flatMap(testTrades)), botSm = summarize(bot.flatMap(testTrades));
      console.log(`  ${fac.name}: 상위33% n=${topSm.n} 승률${topSm.winRate?.toFixed(1) ?? '-'}% 평균${topSm.avgRet != null ? (topSm.avgRet >= 0 ? '+' : '') + topSm.avgRet.toFixed(2) + '%' : '-'} | 하위33% n=${botSm.n} 승률${botSm.winRate?.toFixed(1) ?? '-'}% 평균${botSm.avgRet != null ? (botSm.avgRet >= 0 ? '+' : '') + botSm.avgRet.toFixed(2) + '%' : '-'}`);
      spreadByFactor[fac.key].push((topSm.avgRet ?? 0) - (botSm.avgRet ?? 0));
    }
    // 시총순위는 정적 스냅샷(현재 랭크) — 훈련구간과 무관하게 항상 동일
    const rankedCap = stocks.filter(s => s.mktcapRank != null).sort((a, b) => a.mktcapRank - b.mktcapRank);
    const topCap = rankedCap.slice(0, Math.floor(rankedCap.length / 3));
    const botCap = rankedCap.slice(-Math.floor(rankedCap.length / 3));
    const topCapSm = summarize(topCap.flatMap(testTrades)), botCapSm = summarize(botCap.flatMap(testTrades));
    console.log(`  시총순위(대형주 상위): 상위33% n=${topCapSm.n} 승률${topCapSm.winRate?.toFixed(1) ?? '-'}% 평균${topCapSm.avgRet != null ? (topCapSm.avgRet >= 0 ? '+' : '') + topCapSm.avgRet.toFixed(2) + '%' : '-'} | 하위33% n=${botCapSm.n} 승률${botCapSm.winRate?.toFixed(1) ?? '-'}% 평균${botCapSm.avgRet != null ? (botCapSm.avgRet >= 0 ? '+' : '') + botCapSm.avgRet.toFixed(2) + '%' : '-'}`);
    spreadByFactor.mktcap.push((topCapSm.avgRet ?? 0) - (botCapSm.avgRet ?? 0));
  }

  console.log(`\n=== 재현성 요약 (상위33% 평균수익률 − 하위33% 평균수익률, %p — 3구간 전부 같은 부호면 재현) ===`);
  console.log('팩터\texp1\texp2\texp3\t재현여부');
  for (const [key, label] of [['liquidity', '유동성'], ['volatility', '변동성'], ['beta', '베타'], ['mktcap', '시총순위']]) {
    const sp = spreadByFactor[key];
    const allPos = sp.every(v => v > 0), allNeg = sp.every(v => v < 0);
    console.log(`${label}\t${sp.map(v => (v >= 0 ? '+' : '') + v.toFixed(2)).join('\t')}\t${allPos ? '✓ 일관 상위우세' : allNeg ? '✓ 일관 하위우세(역방향)' : '✗ 불일치'}`);
  }

  // ── 베타 vs 시총순위 상관관계(스피어만) + 이중정렬(교호작용 통제) ──
  const withAnchor = stocks.filter(s => s._anchorBeta != null && s.mktcapRank != null);
  const betaRanks = new Map(withAnchor.slice().sort((a, b) => b._anchorBeta - a._anchorBeta).map((s, i) => [s.code, i]));
  const capRanks = new Map(withAnchor.map(s => [s.code, s.mktcapRank]));
  const n = withAnchor.length;
  let dSq = 0;
  for (const s of withAnchor) { const d = betaRanks.get(s.code) - capRanks.get(s.code); dSq += d * d; }
  const spearman = 1 - (6 * dSq) / (n * (n * n - 1));
  console.log(`\n=== 베타×시총순위 스피어만 상관계수: ${spearman.toFixed(3)} (exp2 훈련구간 베타 vs 현재 시총랭크, |r|>0.5면 사실상 같은 신호로 간주) ===`);

  const capSorted = stocks.filter(s => s.mktcapRank != null).sort((a, b) => a.mktcapRank - b.mktcapRank);
  const capMedianIdx = Math.floor(capSorted.length / 2);
  const bigCap = new Set(capSorted.slice(0, capMedianIdx).map(s => s.code));

  console.log(`\n=== 이중정렬(시총×베타) 3구간 전부 재검증 — exp2 단일구간에서 나온 교호작용(대형주=저베타 유리/소형주=고베타 유리)이 재현되는지 ===`);
  const interactionSigns = [];
  for (const w of windows) {
    const withBeta = stocks.filter(s => s[`_beta_${w.label}`] != null);
    const betaSorted = withBeta.slice().sort((a, b) => b[`_beta_${w.label}`] - a[`_beta_${w.label}`]);
    const highBeta = new Set(betaSorted.slice(0, Math.floor(betaSorted.length / 2)).map(s => s.code));
    const testTrades = s => s.allTrades.filter(t => t.date >= w.testStart && t.date < w.testEnd);
    console.log(`\n--- ${w.label} 검증구간[${w.testStart},${w.testEnd}) ---`);
    console.log('구분\t고베타\t저베타');
    const rowVals = {};
    for (const capLabel of ['대형주(상위50%)', '소형주(하위50%)']) {
      const inCap = s => (capLabel.startsWith('대형') ? bigCap.has(s.code) : !bigCap.has(s.code));
      const cells = ['고베타', '저베타'].map(betaLabel => {
        const inBeta = s => (betaLabel === '고베타' ? highBeta.has(s.code) : !highBeta.has(s.code));
        const group = withBeta.filter(s => inCap(s) && inBeta(s));
        const sm = summarize(group.flatMap(testTrades));
        rowVals[`${capLabel}_${betaLabel}`] = sm.avgRet;
        return `n=${sm.n} 승률${sm.winRate?.toFixed(0) ?? '-'}% 평균${sm.avgRet != null ? (sm.avgRet >= 0 ? '+' : '') + sm.avgRet.toFixed(2) + '%' : '-'}`;
      });
      console.log(`${capLabel}\t${cells[0]}\t${cells[1]}`);
    }
    // 교호작용 부호: 대형주는 저베타가 유리(양수), 소형주는 고베타가 유리(양수)한 방향인지
    const bigFavorsLowBeta = (rowVals['대형주(상위50%)_저베타'] ?? 0) > (rowVals['대형주(상위50%)_고베타'] ?? 0);
    const smallFavorsHighBeta = (rowVals['소형주(하위50%)_고베타'] ?? 0) > (rowVals['소형주(하위50%)_저베타'] ?? 0);
    interactionSigns.push(bigFavorsLowBeta && smallFavorsHighBeta);
  }
  console.log(`\n=== 교호작용(대형주=저베타 유리 & 소형주=고베타 유리) 재현 여부: ${interactionSigns.map((v, i) => `exp${i + 1}=${v ? 'Y' : 'N'}`).join(', ')} ===`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
