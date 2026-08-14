// 눌림목 v11 전략 — 추세이탈(TREND_BREAK) 청산 기준을 EMA50(현재) 대신 EMA20·EMA5로 바꾸면 개선되는지 검증.
// 배경: 괴리율 매매전략(평균회귀)은 청산에 EMA5/EMA20 단계적 기준을 쓰는데, 눌림목(추세추종)은 EMA50 이탈만
// 쓰고 EMA5/EMA20이 전혀 관여하지 않음 — 사용자가 이 비대칭을 지적하며 검증 요청(2026-08-10).
// 주의: 괴리율 전략의 EMA5/EMA20 규칙은 "하락추세 저점매수 후 반등 시 돌파 단계별 익절"(매도측 상승 돌파) 구조라
// 눌림목(상승추세 중 매수 후 하락 시 이탈 손절) 구조와는 정반대 방향이라 그대로 이식할 수 없음 — 대신 "이탈 기준이
// 되는 이평선의 기간(50일 vs 20일 vs 5일)"만 비교 대상으로 삼음(더 타이트한 손절이 나은지 확인).
// 진입조건(V3_RETEST, v11: 시장국면지속10일+KOSPI변동성≤4%+ATR%×0.4밴드)은 그대로, 청산 SL8%/TRAIL8%/TIME40일도
// 그대로 유지하고 TREND_BREAK 판정에 쓰는 이평선만 EMA50/EMA20/EMA5로 교체 비교.
import https from 'https';
const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json' };
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' }, { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' }, { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' }, { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' }, { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' }, { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' }, { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];
const KOSPI_SYMBOL = '%5EKS11';
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10;
const BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4;
const REGIME_STREAK_MIN = 10;
const KOSPI_ATR_PERIOD = 14, VOL_CAP = 4;
const SL = 8, TRAIL = 8, TP_PCT = 10, TP_FRAC = 0.5, MAX_HOLD = 40;
const CALENDAR_DAYS = 1100;
const TREND_BREAK_CANDIDATES = [5, 20, 50]; // 이탈 판정에 쓸 이평 기간 후보(50=현재값)

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } }); });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) { try { const data = await httpGetJson(url); const result = data?.chart?.result?.[0]; if (!result) return null; const q = result.indicators?.quote?.[0] || {}; return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] }; } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); } }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes); const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < filled.length; i++) { const price = filled[i]; if (price == null) continue; if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; } else ema = price * k + ema * (1 - k); emas[i] = ema; }
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
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
async function fetchMarketRegime(p1, p2) {
  const chart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  const dates = chart.ts.map(tsToKstDate); const closes = fillForward(chart.close);
  const maLong = buildEma(closes, MA_LONG);
  const kospiAtr = buildAtr(chart.high, chart.low, closes, KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {}; let curStreak = 0;
  for (let i = 0; i < dates.length; i++) { if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue; const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK]; curStreak = up ? curStreak + 1 : 0; regime[dates[i]] = up; streak[dates[i]] = curStreak; volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null; }
  return { regime, streak, volPct };
}
async function loadStockSignals(stock, marketRegime) {
  const p2 = Math.floor(Date.now() / 1000); const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, entries: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const ema5 = buildEma(closes, 5), ema20 = buildEma(closes, 20), ema50 = buildEma(closes, MA_SHORT), maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) { if (closes[i] == null || ema50[i] == null || maLong[i] == null) continue; const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null; seq.push({ date: dates[i], close: closes[i], ema5: ema5[i], ema20: ema20[i], ema50: ema50[i], maLong: maLong[i], atrPct }); }
  const entries = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i]; const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.ema50 > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[s.date];
    if (kospiVol == null || kospiVol > VOL_CAP) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.ema50) continue;
    const pullbackPct = (highS - s.close) / highS * 100;
    if (pullbackPct / s.atrPct > BAND_K) continue;
    entries.push({ i, date: s.date });
  }
  return { ...stock, seq, entries };
}
// trendBreakField: 'ema5' | 'ema20' | 'ema50' — 이 이평 아래로 종가 이탈 시 TREND_BREAK 청산
function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac, trendBreakField) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const row = seq[j]; const close = row.close; const trendLine = row[trendBreakField];
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => { const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret; return { ret: blended, reason, day: d, tpTaken }; };
    if (ret <= -sl) return finish('SL');
    if (trendLine != null && close < trendLine) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100; if (trailRet <= -trail) return finish('TRAIL'); if (d === maxHold) return finish('TIME');
  }
  return null;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(a) { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }
function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  const counts = {}; for (const t of trades) counts[t.reason] = (counts[t.reason] || 0) + 1;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sharpe: sd > 0 ? mean(rets) / sd : 0, counts };
}
function fmt(label, s) {
  if (!s) { console.log(`${label}: 데이터없음`); return; }
  const c = s.counts;
  console.log(`${label.padEnd(22)} n=${String(s.n).padStart(4)}  평균 ${s.avg>=0?'+':''}${s.avg.toFixed(2)}%  중앙값 ${s.med>=0?'+':''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  Sharpe ${s.sharpe.toFixed(3)}   [SL ${c.SL||0}(${((c.SL||0)/s.n*100).toFixed(0)}%) TREND_BREAK ${c.TREND_BREAK||0}(${((c.TREND_BREAK||0)/s.n*100).toFixed(0)}%) TRAIL ${c.TRAIL||0}(${((c.TRAIL||0)/s.n*100).toFixed(0)}%) TIME ${c.TIME||0}(${((c.TIME||0)/s.n*100).toFixed(0)}%)]`);
}

async function main() {
  console.error(`[눌림목 v11 TREND_BREAK 이평기간 비교] ${DEFAULT_STOCKS.length}종목, 최근${CALENDAR_DAYS}일`);
  const p2 = Math.floor(Date.now() / 1000); const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);
  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, marketRegime));
  const valid = loaded.filter(r => r.seq && r.entries.length);
  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ seq: r.seq, i: e.i, date: e.date, name: r.name });
  allEntries.sort((a, b) => a.date < b.date ? -1 : 1);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건(v11 진입조건 그대로, TREND_BREAK 이평만 교체)`);

  console.log('\n════════ TREND_BREAK 이평기간별 비교 (SL8%/TRAIL8%/TP+10%50%/시간청산40일 동일) ════════\n');
  const results = {};
  for (const period of TREND_BREAK_CANDIDATES) {
    const field = period === 5 ? 'ema5' : period === 20 ? 'ema20' : 'ema50';
    const trades = allEntries.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC, field)).filter(Boolean);
    const s = summarize(trades);
    results[period] = s;
    fmt(`EMA${period}이탈${period===50?'(현재v11)':''}`, s);
  }

  const best = Object.entries(results).filter(([,s])=>s).sort((a,b)=>b[1].sharpe-a[1].sharpe)[0];
  console.log(`\n[Sharpe 기준 최우수] EMA${best[0]}이탈`);

  if (Number(best[0]) !== 50) {
    const field = best[0] === '5' ? 'ema5' : 'ema20';
    const splitIdx = Math.floor(allEntries.length * 0.6);
    const splitDate = allEntries[splitIdx]?.date;
    console.log(`\n════════ IS/OOS 검증 (EMA${best[0]}이탈, ~${splitDate} 기준 60/40) ════════\n`);
    const isE = allEntries.filter(e => e.date <= splitDate), oosE = allEntries.filter(e => e.date > splitDate);
    fmt('IS', summarize(isE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC, field)).filter(Boolean)));
    fmt('OOS', summarize(oosE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC, field)).filter(Boolean)));
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
