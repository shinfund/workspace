// 눌림목 v7 확정전략에 위험필터 2종(ATR%상한 × 시장국면 지속일수) 그리드서치 (2026-08-06)
// 배경: 최근신호(TOP50) 90일 구간에서 손절이 2026-06월에 집중(19건중15건, 79%)되고,
//       손절종목의 평균ATR%(7.05%)가 정상청산종목(5.65%)보다 높게 나타남 — 두 가설을 검증:
//       ① ATR%상한 필터: 진입시 종목 ATR%가 임계값 초과면 제외
//       ② 시장국면 지속일수 필터: KOSPI가 EMA100 위로 전환된 지 최소 N거래일 지나야 진입 허용(막 전환된 휩소 구간 배제)
// v7 로직(project_stock_pullback.mjs)은 그대로 두고 별도 스크립트로 검증만 수행. 채택 시에만 v7에 반영.
// 사용법: node scripts/project_pullback_risk_filter_sweep.mjs
import https from 'https';

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9' };
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
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10, BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4, SL = 8, TRAIL = 8, TP_PCT = 10, TP_FRAC = 0.5, MAX_HOLD = 40;
const CALENDAR_DAYS = 1100;

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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0]; if (!result) return null;
      const ts = result.timestamp || []; const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes); const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < filled.length; i++) {
    const price = filled[i]; if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else { ema = price * k + ema * (1 - k); }
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
    const pc = c[i - 1]; tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i]; if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
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
  if (!chart || !chart.ts.length) throw new Error('KOSPI지수 조회 실패');
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, MA_LONG);
  const regime = {}, streak = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up;
    streak[dates[i]] = curStreak; // 오늘까지 상승국면이 연속 며칠째인지(0=오늘 처음 켜짐 이전, 1=오늘 막 켜짐)
  }
  return { regime, streak };
}

async function loadStockSignals(stock, marketRegime, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, entries: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT), maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const minLen = MA_LONG + SLOPE_LOOKBACK + opts.maxHold + 1;
  if (seq.length < minLen) return { ...stock, seq: null, entries: [] };

  const entries = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i];
    const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;

    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;

    const pullbackPct = (highS - s.close) / highS * 100;
    const normDepth = pullbackPct / s.atrPct;
    if (normDepth > BAND_K) continue;

    entries.push({ i, date: s.date, atrPct: s.atrPct, regimeStreak: marketRegime.streak[s.date] ?? 0 });
  }
  return { ...stock, seq, entries };
}

function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    const maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => { const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret; return { ret: blended, reason, day: d, tpTaken }; };
    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}
function simulateBaseline(seq, i0, entryClose, sl, trail, maxHold) {
  let peak = entryClose;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const close = seq[j].close, maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) return { ret, reason: 'SL', day: d };
    if (close < maShort) return { ret, reason: 'TREND_BREAK', day: d };
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return { ret, reason: 'TRAIL', day: d };
    if (d === maxHold) return { ret, reason: 'TIME', day: d };
  }
  return null;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(28)} 데이터 없음`;
  return label.padEnd(28) + String(s.n).padStart(6) + `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) + `${s.win.toFixed(0)}%`.padStart(8) + `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = { stocks: DEFAULT_STOCKS, maxHold: MAX_HOLD, calendarDays: CALENDAR_DAYS };
  console.error(`[위험필터 그리드서치] ${opts.stocks.length}종목, 최근${opts.calendarDays}일`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);

  const loaded = await batchAll(opts.stocks, s => loadStockSignals(s, marketRegime, opts));
  const valid = loaded.filter(r => r.seq && r.entries.length);

  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ seq: r.seq, i: e.i, date: e.date, name: r.name, atrPct: e.atrPct, regimeStreak: e.regimeStreak });
  allEntries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건(필터 적용 전, v7 기준선)`);

  const ATR_CAPS = [Infinity, 8, 7, 6, 5];
  const MIN_STREAKS = [0, 3, 5, 10, 15, 20];

  const results = [];
  for (const atrCap of ATR_CAPS) {
    for (const minStreak of MIN_STREAKS) {
      const filtered = allEntries.filter(e => e.atrPct <= atrCap && e.regimeStreak >= minStreak);
      const baseline = summarize(filtered.map(e => simulateBaseline(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold)).filter(Boolean));
      const withTp = summarize(filtered.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean));
      results.push({ atrCap, minStreak, baseline, withTp });
    }
  }

  console.log('\n════════ baseline(전량매도) 그리드 — ATR%상한 × 시장국면지속일수 ════════\n');
  console.log('ATR상한'.padEnd(10) + '지속일수≥'.padEnd(12) + fmtRow('', null).replace('데이터 없음', '').padStart(0) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(80));
  for (const r of results) {
    const capLabel = r.atrCap === Infinity ? '없음' : `${r.atrCap}%`;
    console.log(capLabel.padEnd(10) + String(r.minStreak).padEnd(12) + fmtRow('', r.baseline).trimStart());
  }

  console.log('\n════════ TP+10%/50%매도(최종전략) 그리드 — ATR%상한 × 시장국면지속일수 ════════\n');
  console.log('ATR상한'.padEnd(10) + '지속일수≥'.padEnd(12) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(80));
  for (const r of results) {
    const capLabel = r.atrCap === Infinity ? '없음' : `${r.atrCap}%`;
    console.log(capLabel.padEnd(10) + String(r.minStreak).padEnd(12) + fmtRow('', r.withTp).trimStart());
  }

  // Sharpe 기준 상위 5개(TP전략) 출력 + baseline(필터없음) 대비
  const ranked = results.filter(r => r.withTp && r.withTp.n >= 100).sort((a, b) => b.withTp.sharpe - a.withTp.sharpe);
  console.log('\n════════ TP전략 Sharpe 상위 5(표본 100건 이상만) ════════\n');
  for (const r of ranked.slice(0, 5)) {
    const capLabel = r.atrCap === Infinity ? '없음' : `${r.atrCap}%`;
    console.log(`ATR상한=${capLabel}, 지속일수≥${r.minStreak}: ` + fmtRow('', r.withTp).trimStart());
  }

  // 여러 조합 IS/OOS 검증(과최적화 확인) — 최우수 단독 검증이 아니라 요인 분리를 위해 5개 비교
  const checkCombos = [
    { atrCap: Infinity, minStreak: 0, label: 'v7 기준선(필터없음)' },
    { atrCap: Infinity, minStreak: 10, label: '지속일수 필터만(10일)' },
    { atrCap: 6, minStreak: 0, label: 'ATR상한 필터만(6%)' },
    { atrCap: 7, minStreak: 10, label: '완화조합(ATR7%+지속10일)' },
    { atrCap: 5, minStreak: 10, label: 'Sharpe최상위조합(ATR5%+지속10일)' },
  ];
  console.log(`\n════════ 후보 조합별 IS/OOS 검증(60/40 분할, 과최적화 여부 확인) ════════\n`);
  for (const combo of checkCombos) {
    const filtered = allEntries.filter(e => e.atrPct <= combo.atrCap && e.regimeStreak >= combo.minStreak);
    const splitIdx = Math.floor(filtered.length * 0.6);
    const splitDate = filtered[splitIdx]?.date;
    console.log(`--- ${combo.label} (n=${filtered.length}) ---`);
    if (splitDate) {
      const isE = filtered.filter(e => e.date <= splitDate);
      const oosE = filtered.filter(e => e.date > splitDate);
      const isS = summarize(isE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean));
      const oosS = summarize(oosE.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean));
      console.log(fmtRow('IS', isS));
      console.log(fmtRow('OOS', oosS));
      if (isS && oosS) console.log(`Sharpe 변화율: ${((oosS.sharpe - isS.sharpe) / isS.sharpe * 100).toFixed(0)}%`);
    }
    console.log('');
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
