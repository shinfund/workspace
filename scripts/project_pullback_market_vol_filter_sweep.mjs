// 눌림목 v9 전략에 "시장 전체 변동성 서킷브레이커" 필터를 추가하면 개선되는지 그리드서치.
// 배경: 2026-05~07월초 KOSPI가 하루 ±5~10%씩 흔드는 이례적 고변동장이었고, 이 구간 손절비율이
// 장기평균(19.7%)의 2배(42.1%)로 치솟음(사용자 지적, 2026-08-10 확인). ATR%정규화 SL/TRAIL은 이미
// 기각됐고(오히려 손실을 더 키움, 급락장에선 ATR%가 같이 치솟아 손절선이 넓어지므로) — 이번엔 손절폭 자체가
// 아니라 "이런 장에는 아예 신규 진입을 쉰다"는 시장 전체 변동성 게이트를 시도.
// 기존 REGIME_STREAK_MIN(추세전환 직후 휩소 방지)과는 별개 축 — 추세 중간의 급변(크래시)을 잡기 위함.
// 진입조건(V3_RETEST)·청산(SL8/TRAIL8/TP10%50%)은 v9 그대로, KOSPI 자체의 ATR%가 CAP을 넘으면
// 그날은 신규 진입 자체를 막는 조건만 추가.
// 사용법: node scripts/project_pullback_market_vol_filter_sweep.mjs
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
const SL = 8, TRAIL = 8, TP_PCT = 10, TP_FRAC = 0.5, MAX_HOLD = 40;
const CALENDAR_DAYS = 1100;
const KOSPI_ATR_PERIOD = 14;
const VOL_CAPS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 999]; // 999=필터없음(기준선)

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
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(a) { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }
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
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}
async function loadStockSignals(stock, marketRegime) {
  const p2 = Math.floor(Date.now() / 1000); const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, entries: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT), maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) { if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue; const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null; seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct }); }
  const entries = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i]; const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;
    const pullbackPct = (highS - s.close) / highS * 100;
    if (pullbackPct / s.atrPct > BAND_K) continue;
    const kospiVol = marketRegime.volPct[s.date] ?? null;
    entries.push({ i, date: s.date, kospiVol });
  }
  return { ...stock, seq, entries };
}
function simulateTrendTrade(seq, i0, entryClose, sl, trail, maxHold) {
  let peak = entryClose;
  for (let d = 1; d <= maxHold; d++) { const j = i0 + d; if (j >= seq.length) return null; const close = seq[j].close, maShort = seq[j].maShort; const ret = (close - entryClose) / entryClose * 100; if (ret <= -sl) return { ret, reason: 'SL', day: d }; if (close < maShort) return { ret, reason: 'TREND_BREAK', day: d }; if (close > peak) peak = close; const trailRet = (close - peak) / peak * 100; if (trailRet <= -trail) return { ret, reason: 'TRAIL', day: d }; if (d === maxHold) return { ret, reason: 'TIME', day: d }; }
  return null;
}
function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const close = seq[j].close, maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => { const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret; return { ret: blended, reason, day: d, tpTaken }; };
    if (ret <= -sl) return finish('SL'); if (close < maShort) return finish('TREND_BREAK'); if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100; if (trailRet <= -trail) return finish('TRAIL'); if (d === maxHold) return finish('TIME');
  }
  return null;
}
function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  const counts = {}; for (const t of trades) counts[t.reason] = (counts[t.reason] || 0) + 1;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sd, sharpe: sd > 0 ? mean(rets) / sd : 0, counts };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(20)} 데이터 없음`;
  const slPct = ((s.counts.SL || 0) / s.n * 100).toFixed(0);
  return label.padEnd(20) + String(s.n).padStart(6) + `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) + `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) + `${s.win.toFixed(0)}%`.padStart(8) + `${s.sharpe.toFixed(3)}`.padStart(9) + `${slPct}%`.padStart(9);
}

async function main() {
  console.error(`[눌림목 시장변동성 서킷브레이커 그리드서치] ${DEFAULT_STOCKS.length}종목, 최근${CALENDAR_DAYS}일`);
  const p2 = Math.floor(Date.now() / 1000); const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);
  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, marketRegime));
  const valid = loaded.filter(r => r.seq && r.entries.length);
  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ seq: r.seq, i: e.i, date: e.date, name: r.name, kospiVol: e.kospiVol });
  allEntries.sort((a, b) => a.date < b.date ? -1 : 1);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건(필터 전, KOSPI ATR% 캡 미적용)`);

  console.log('\n════════ KOSPI 변동성(ATR%) 캡 그리드서치 (baseline SL8/TRAIL8, TP미적용) ════════\n');
  console.log('캡(%)'.padEnd(20) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9) + 'SL비율'.padStart(9));
  console.log('─'.repeat(72));
  const gridResults = [];
  for (const cap of VOL_CAPS) {
    const filtered = allEntries.filter(e => e.kospiVol != null && e.kospiVol <= cap);
    const trades = filtered.map(e => simulateTrendTrade(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD)).filter(Boolean);
    const s = summarize(trades);
    gridResults.push({ cap, s });
    console.log(fmtRow(cap === 999 ? '필터없음(기준선)' : `KOSPI ATR%<=${cap}`, s));
  }

  const withFilter = gridResults.filter(g => g.cap !== 999 && g.s && g.s.n >= 300); // 표본 급감 방지(기준선 834건의 최소 1/3 이상)
  const ranked = withFilter.sort((a, b) => b.s.sharpe - a.s.sharpe);
  const baseline = gridResults.find(g => g.cap === 999);

  if (!ranked.length) {
    console.log('\n[결론] 표본 300건 이상을 유지하는 캡 후보가 없어 유효한 대안을 찾지 못함.');
    return;
  }
  const best = ranked[0];
  console.log(`\n════════ 최우수 캡(KOSPI ATR%<=${best.cap}) vs 기준선(필터없음) — TP+10%/50%매도 적용 비교 ════════\n`);
  console.log('전략'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9) + 'SL비율'.padStart(9));
  console.log('─'.repeat(80));
  const baseTp = summarize(allEntries.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean));
  const bestFiltered = allEntries.filter(e => e.kospiVol != null && e.kospiVol <= best.cap);
  const bestTp = summarize(bestFiltered.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean));
  console.log(fmtRow('필터없음(v9 기존)+TP', baseTp));
  console.log(fmtRow(`KOSPI ATR%<=${best.cap}+TP(신규)`, bestTp));

  // OOS 검증
  const splitIdx = Math.floor(bestFiltered.length * 0.6);
  const splitDate = bestFiltered[splitIdx]?.date;
  if (splitDate) {
    console.log(`\n════════ IS/OOS 검증 (필터 적용 표본, ~${splitDate} 기준 60/40, TP 적용) ════════\n`);
    console.log('구간'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9) + 'SL비율'.padStart(9));
    console.log('─'.repeat(80));
    const isE = bestFiltered.filter(e => e.date <= splitDate), oosE = bestFiltered.filter(e => e.date > splitDate);
    console.log(fmtRow('IS(신규필터)', summarize(isE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean))));
    console.log(fmtRow('OOS(신규필터)', summarize(oosE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean))));
  }

  // 최근90일 구간에서 이 필터가 실제로 얼마나 걸러냈는지 확인
  const cutoff90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recentAll = allEntries.filter(e => e.date >= cutoff90);
  const recentFiltered = recentAll.filter(e => e.kospiVol != null && e.kospiVol <= best.cap);
  console.log(`\n════════ 최근90일 구간 적용 시뮬레이션(캡=${best.cap}) ════════\n`);
  console.log(`필터 전 ${recentAll.length}건 → 필터 후 ${recentFiltered.length}건 (${recentAll.length - recentFiltered.length}건 차단)`);
  const recentTp = summarize(recentFiltered.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC)).filter(Boolean));
  console.log(fmtRow('최근90일(필터적용)+TP', recentTp));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
