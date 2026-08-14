// 눌림목 v11 전략 — SL비율을 더 낮추기 위해 "개별종목 모멘텀(RSI)·거래량 확인" 진입필터를 추가 그리드서치.
// 배경: SL비율을 낮추려면 손절폭을 건드리지 말고 진입품질을 높여야 한다는 원칙(괴리율 전략의 3%SL비율도
// 손절폭이 아니라 진입필터 강화로 달성됨, 위 메모 참고) — 사용자가 "개별종목 모멘텀/거래량 확인 추가"를 선택.
// 진입조건(V3_RETEST, v11: 시장국면지속10일+KOSPI변동성≤4%+ATR%×0.4밴드)은 그대로 두고, 아래 2개 필터를 추가:
//   ① RSI(14) >= 임계값(모멘텀이 죽은 상태의 눌림 배제)
//   ② 진입일 거래량 / 20일 평균거래량 >= 배수(거래량 실린 진짜 매수세인지 확인, 관심 저조한 드리프트 배제)
// 청산 SL8%/TRAIL8%/EMA50이탈/시간청산40일/TP+10%50%는 그대로 유지.
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
const RSI_PERIOD = 14, VOL_MA_PERIOD = 20;
const RSI_THRESHOLDS = [0, 40, 45, 50, 55, 60];
const VOLRATIO_THRESHOLDS = [0, 0.8, 1.0, 1.2, 1.5];

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } }); });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) { try { const data = await httpGetJson(url); const result = data?.chart?.result?.[0]; if (!result) return null; const q = result.indicators?.quote?.[0] || {}; return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] }; } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); } }
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
// Wilder RSI(period)
function buildRsi(closes, period) {
  const c = fillForward(closes);
  const rsi = new Array(c.length).fill(null);
  let avgGain = null, avgLoss = null;
  const gains = [], losses = [];
  for (let i = 1; i < c.length; i++) {
    const diff = c[i] - c[i - 1];
    const gain = diff > 0 ? diff : 0, loss = diff < 0 ? -diff : 0;
    if (avgGain === null) {
      gains.push(gain); losses.push(loss);
      if (gains.length < period) continue;
      avgGain = gains.reduce((a, b) => a + b, 0) / period;
      avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return rsi;
}
function buildVolMa(volume, period) {
  const v = fillForward(volume);
  const ma = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] || 0;
    if (i >= period) sum -= v[i - period] || 0;
    if (i >= period - 1) ma[i] = sum / period;
  }
  return ma;
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
  const ema50 = buildEma(closes, MA_SHORT), maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);
  const rsi = buildRsi(closes, RSI_PERIOD);
  const volMa = buildVolMa(chart.volume, VOL_MA_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema50[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    const volRatio = volMa[i] && volMa[i] > 0 && chart.volume[i] != null ? chart.volume[i] / volMa[i] : null;
    seq.push({ date: dates[i], close: closes[i], ema50: ema50[i], maLong: maLong[i], atrPct, rsi: rsi[i], volRatio });
  }
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
    entries.push({ i, date: s.date, rsi: s.rsi, volRatio: s.volRatio });
  }
  return { ...stock, seq, entries };
}
function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const row = seq[j]; const close = row.close;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => { const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret; return { ret: blended, reason, day: d, tpTaken }; };
    if (ret <= -sl) return finish('SL');
    if (close < row.ema50) return finish('TREND_BREAK');
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
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sharpe: sd > 0 ? mean(rets) / sd : 0, slPct: (counts.SL || 0) / rets.length * 100 };
}

async function main() {
  console.error(`[눌림목 v11 모멘텀·거래량 필터 그리드서치] ${DEFAULT_STOCKS.length}종목, 최근${CALENDAR_DAYS}일`);
  const p2 = Math.floor(Date.now() / 1000); const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);
  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, marketRegime));
  const valid = loaded.filter(r => r.seq && r.entries.length);
  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ seq: r.seq, i: e.i, date: e.date, name: r.name, rsi: e.rsi, volRatio: e.volRatio });
  allEntries.sort((a, b) => a.date < b.date ? -1 : 1);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건(v11 진입조건 그대로, RSI/거래량 필터는 사후분류)`);

  console.log('\n════════ RSI 임계값 × 거래량배수 그리드서치 (TP+10%50% 적용, Sharpe) ════════\n');
  console.log('RSI\\거래량배수'.padEnd(16) + VOLRATIO_THRESHOLDS.map(v => `x${v}`.padStart(9)).join(''));
  const gridResults = [];
  for (const rsiTh of RSI_THRESHOLDS) {
    let row = `RSI>=${rsiTh}`.padEnd(16);
    for (const volTh of VOLRATIO_THRESHOLDS) {
      const filtered = allEntries.filter(e => (rsiTh === 0 || (e.rsi != null && e.rsi >= rsiTh)) && (volTh === 0 || (e.volRatio != null && e.volRatio >= volTh)));
      const trades = filtered.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean);
      const s = summarize(trades);
      gridResults.push({ rsiTh, volTh, s });
      row += (s ? s.sharpe.toFixed(3) : '─').padStart(9);
    }
    console.log(row);
  }

  const withFilter = gridResults.filter(g => !(g.rsiTh === 0 && g.volTh === 0) && g.s && g.s.n >= 300);
  const baseline = gridResults.find(g => g.rsiTh === 0 && g.volTh === 0);
  const ranked = withFilter.sort((a, b) => b.s.sharpe - a.s.sharpe);

  console.log('\n[표본 300건 이상 유지 조건 중 Sharpe 상위 5개]');
  console.log('조건'.padEnd(20) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9) + 'SL비율'.padStart(9));
  for (const g of ranked.slice(0, 5)) {
    const s = g.s;
    console.log(`RSI>=${g.rsiTh},Vol>=${g.volTh}x`.padEnd(20) + String(s.n).padStart(6) + `${s.avg>=0?'+':''}${s.avg.toFixed(2)}%`.padStart(10) + `${s.med>=0?'+':''}${s.med.toFixed(2)}%`.padStart(10) + `${s.win.toFixed(0)}%`.padStart(8) + `${s.sharpe.toFixed(3)}`.padStart(9) + `${s.slPct.toFixed(0)}%`.padStart(9));
  }
  console.log(`\n기준선(필터없음, v11 그대로): n=${baseline.s.n}, Sharpe ${baseline.s.sharpe.toFixed(3)}, SL비율 ${baseline.s.slPct.toFixed(0)}%`);

  const best = ranked[0];
  if (best) {
    const bestFiltered = allEntries.filter(e => (best.rsiTh === 0 || (e.rsi != null && e.rsi >= best.rsiTh)) && (best.volTh === 0 || (e.volRatio != null && e.volRatio >= best.volTh)));
    const splitIdx = Math.floor(bestFiltered.length * 0.6);
    const splitDate = bestFiltered[splitIdx]?.date;
    if (splitDate) {
      const isE = bestFiltered.filter(e => e.date <= splitDate), oosE = bestFiltered.filter(e => e.date > splitDate);
      const isS = summarize(isE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean));
      const oosS = summarize(oosE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean));
      console.log(`\n════════ 최우수 조합(RSI>=${best.rsiTh}, Vol>=${best.volTh}x) IS/OOS 검증 (~${splitDate} 기준 60/40) ════════\n`);
      console.log(`IS:  n=${isS.n}, 평균 ${isS.avg>=0?'+':''}${isS.avg.toFixed(2)}%, 승률 ${isS.win.toFixed(0)}%, Sharpe ${isS.sharpe.toFixed(3)}, SL비율 ${isS.slPct.toFixed(0)}%`);
      console.log(`OOS: n=${oosS.n}, 평균 ${oosS.avg>=0?'+':''}${oosS.avg.toFixed(2)}%, 승률 ${oosS.win.toFixed(0)}%, Sharpe ${oosS.sharpe.toFixed(3)}, SL비율 ${oosS.slPct.toFixed(0)}%`);
    }
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
