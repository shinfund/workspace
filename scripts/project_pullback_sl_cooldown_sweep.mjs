// 눌림목 V3_RETEST 동일종목 손절후 재진입 쿨다운 그리드서치 (2026-08-26)
// 배경: stock-portal 최근신호 표에서 "손실난 종목이 많다"는 사용자 지적으로 원인 진단 →
//       LG화학이 2026-05-06/05-07/05-11 사흘~나흘 간격으로 3회 연속 재진입해 3회 전부 손절,
//       삼성SDI도 05-04/05-06 이틀 만에 재진입해 2회 전부 손절되는 "휩소 재진입" 패턴 발견.
//       현재 로직엔 동일종목 손절 후 쿨다운이 없어 같은 눌림구간에서 반복 손절이 가능함.
// 검증: v12 확정 필터(지수병행확인+개별ATR%상한6%+시장별SL/TRAIL) 고정, 종목별 손절 종료 후
//       N거래일 재진입 금지 쿨다운을 추가해 N=0(현행)/5/10/20/40 그리드서치.
// 원본 project_stock_pullback.mjs(v12 확정판)는 수정하지 않음 — 별도 스윕 스크립트로 검증만 수행.
// 사용법: node scripts/project_pullback_sl_cooldown_sweep.mjs [--calendar-days N] [--max-hold N]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

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
const KOSDAQ_SYMBOL = '%5EKQ11';
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10;
const BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4;
const REGIME_STREAK_MIN = 10;
const KOSPI_ATR_PERIOD = 14, VOL_CAP = 4;
const STOCK_ATR_CAP = 6; // v12 확정값 고정
const TP_PCT = 10, TP_FRAC = 0.5;
const SL_BY_MARKET = { KOSPI: 8, KOSDAQ: 18 };
const TRAIL_BY_MARKET = { KOSPI: 8, KOSDAQ: 18 };

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, maxHold: 40, calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
  }
  return o;
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const data = await httpGetJson(url); const result = data?.chart?.result?.[0]; if (!result) return null;
      const ts = result.timestamp || []; const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes); const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < filled.length; i++) { const p = filled[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) { if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) { const v = tr[i]; if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }

async function batchAll(items, fn, concurrency = 5, delay = 150) {
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

function computeQualifyArray(seq, marketRegime) {
  const qualify = new Array(seq.length).fill(false);
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i];
    const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    const vol = marketRegime.volPct[s.date];
    if (vol == null || vol > VOL_CAP) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0 || s.atrPct > STOCK_ATR_CAP) continue;

    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;

    const pullbackPct = (highS - s.close) / highS * 100;
    const normDepth = pullbackPct / s.atrPct;
    if (normDepth > BAND_K) continue;
    qualify[i] = true;
  }
  return qualify;
}

async function loadStockSignals(stock, regimeByMarket, opts) {
  const marketRegime = stock.market === 'KOSDAQ' ? regimeByMarket.KOSDAQ : regimeByMarket.KOSPI;
  const otherRegime = stock.market === 'KOSDAQ' ? regimeByMarket.KOSPI : regimeByMarket.KOSDAQ;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null, qualify: null };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const highs = fillForward(chart.high);
  const lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT);
  const maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const minLen = MA_LONG + SLOPE_LOOKBACK + opts.maxHold + 1;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족', seq: null, qualify: null };

  const qualify = computeQualifyArray(seq, marketRegime);
  return { ...stock, seq, qualify, otherRegime };
}

function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const close = seq[j].close; const maShort = seq[j].maShort;
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

// 종목별로 시간순 진행하며 쿨다운 적용: 손절 종료 후 N거래일 이내 재진입 신호는 스킵
function buildEntriesWithCooldown(valid, cooldownDays, opts) {
  const entries = [];
  for (const r of valid) {
    if (r.error || !r.seq) continue;
    const sl = SL_BY_MARKET[r.market || 'KOSPI'], trail = TRAIL_BY_MARKET[r.market || 'KOSPI'];
    let blockedUntilIdx = -1;
    for (let i = 0; i < r.qualify.length; i++) {
      if (!r.qualify[i]) continue;
      const date = r.seq[i].date;
      if (r.otherRegime?.regime?.[date] !== true) continue; // v12 지수병행확인(고정)
      if (i <= blockedUntilIdx) continue; // 쿨다운 중 스킵
      const trade = simulatePartialTP(r.seq, i, r.seq[i].close, sl, trail, opts.maxHold, TP_PCT, TP_FRAC);
      if (!trade) continue;
      entries.push({ date, name: r.name, market: r.market || 'KOSPI', trade });
      if (trade.reason === 'SL' && cooldownDays > 0) blockedUntilIdx = i + trade.day + cooldownDays;
    }
  }
  entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return entries;
}

function summarize(entries) {
  if (!entries.length) return null;
  const rets = entries.map(e => e.trade.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const slRatio = entries.filter(e => e.trade.reason === 'SL').length / entries.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, slRatio, sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(28)} 데이터 없음`;
  return label.padEnd(28) + String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(9) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(9) +
    `${s.win.toFixed(0)}%`.padStart(7) +
    `${s.slRatio.toFixed(0)}%`.padStart(7) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[눌림목 손절쿨다운 스윕] ${opts.stocks.length}종목, 최대${opts.maxHold}거래일, 최근${opts.calendarDays}일`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const [regimeKospi, regimeKosdaq] = await Promise.all([
    fetchMarketRegime(p1, p2, KOSPI_SYMBOL),
    fetchMarketRegime(p1, p2, KOSDAQ_SYMBOL),
  ]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };

  const loaded = await batchAll(opts.stocks, s => loadStockSignals(s, regimeByMarket, opts));
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);
  const valid = loaded.filter(r => !r.error);

  const COOLDOWNS = [0, 5, 10, 20, 40];
  console.log('\n════════ 눌림목 동일종목 손절후 재진입 쿨다운 그리드서치 ════════');
  console.log('(0거래일 = v12 확정 baseline, 쿨다운 없음)\n');
  console.log('쿨다운'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(9) + '중앙값'.padStart(9) + '승률'.padStart(7) + 'SL비율'.padStart(7) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(75));
  const rows = [];
  for (const cd of COOLDOWNS) {
    const entries = buildEntriesWithCooldown(valid, cd, opts);
    const s = summarize(entries);
    rows.push({ cd, entries, s });
    console.log(fmtRow(`${cd}거래일 쿨다운`, s));
  }

  console.log('\n────────────────────────────────────────');
  console.log('IS/OOS 검증(60/40 분할, 재탐색 없음):');
  console.log('쿨다운'.padEnd(24) + '구간'.padEnd(10) + 'n'.padStart(6) + '평균'.padStart(9) + '중앙값'.padStart(9) + '승률'.padStart(7) + 'SL비율'.padStart(7) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(80));
  for (const r of rows) {
    const splitIdx = Math.floor(r.entries.length * 0.6);
    const splitDate = r.entries[splitIdx]?.date;
    if (!splitDate) { console.log(`${r.cd}거래일 표본부족(n=${r.entries.length})`); continue; }
    const isE = r.entries.filter(e => e.date <= splitDate);
    const oosE = r.entries.filter(e => e.date > splitDate);
    console.log(fmtRow(`${r.cd}거래일 / IS`, summarize(isE)));
    console.log(fmtRow(`${r.cd}거래일 / OOS`, summarize(oosE)));
    console.log(`  → 최근 진입일: ${r.entries[r.entries.length - 1]?.date}`);
  }

  // 최근 120일 구간만 별도로 살펴보기(사용자가 실제로 본 "최근신호" 표와 동일 범위)
  console.log('\n────────────────────────────────────────');
  console.log('최근 120일 구간만(포털 "최근신호" 탭과 동일 범위):');
  const cutoff = new Date(Date.now() - 120 * 24 * 3600 * 1000);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  for (const r of rows) {
    const recent = r.entries.filter(e => e.date >= cutoffDate);
    console.log(fmtRow(`${r.cd}거래일 쿨다운(최근120일)`, summarize(recent)));
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
