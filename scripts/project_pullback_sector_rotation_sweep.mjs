// 눌림목 V3_RETEST 섹터 로테이션(상대강도) 필터 그리드서치 (2026-08-26)
// 배경: v12(지수병행확인+개별ATR%상한6%) 확정 후 "추가 트리거 개선 없는지 재검증" 요청으로
//       스킬 "미해결 과제"에 유일하게 남아있던 미시도 후보(섹터 로테이션) 검증.
//       외부 섹터지수 데이터소스가 없어(Yahoo Finance 단일종목 API만 사용 중), 유니버스(48종목) 자체를
//       업종별로 정적 분류(직접 매핑)해 "섹터 평균 N일수익률 - 자기시장지수 N일수익률"을 상대강도(RS)로 계산.
// 원본 project_stock_pullback.mjs(v12 확정판)는 수정하지 않음 — 별도 스윕 스크립트로 검증만 수행.
// 사용법: node scripts/project_pullback_sector_rotation_sweep.mjs [--calendar-days N] [--max-hold N]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 업종 정적 매핑(외부 데이터소스 없이 직접 분류, 그룹당 최소 2종목 이상 확보)
const SECTOR_MAP = {
  '005930': '반도체IT', '000660': '반도체IT', '402340': '반도체IT', '009150': '반도체IT',
  '042700': '반도체IT', '066570': '반도체IT', '018260': '반도체IT',
  '005380': '자동차', '000270': '자동차', '012330': '자동차', '086280': '자동차',
  '373220': '2차전지화학', '006400': '2차전지화학', '051910': '2차전지화학',
  '207940': '바이오', '068270': '바이오', '196170': '바이오',
  '032830': '금융', '105560': '금융', '055550': '금융', '086790': '금융',
  '316140': '금융', '000810': '금융', '006800': '금융', '024110': '금융',
  '329180': '조선중공업', '009540': '조선중공업', '042660': '조선중공업',
  '010140': '조선중공업', '034020': '조선중공업', '267250': '조선중공업',
  '012450': '방산', '079550': '방산',
  '010120': '전력기기', '267260': '전력기기', '298040': '전력기기', '015760': '전력기기',
  '028260': '지주상사', '034730': '지주상사', '000150': '지주상사', '003550': '지주상사',
  '005490': '철강비철', '010130': '철강비철',
  '096770': '정유에너지', '010950': '정유에너지',
  '011200': '해운물류',
  '035420': 'IT플랫폼통신', '017670': 'IT플랫폼통신', '035720': 'IT플랫폼통신',
  '033780': '소비재',
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
].map(s => ({ ...s, sector: SECTOR_MAP[s.code] || '기타' }));

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
function nDayReturn(closes, i, n) { if (i < n || closes[i] == null || closes[i - n] == null || closes[i - n] === 0) return null; return (closes[i] - closes[i - n]) / closes[i - n] * 100; }
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
  const regime = {}, streak = {}, volPct = {}, closeByDate = {}, idxByDate = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    closeByDate[dates[i]] = closes[i]; idxByDate[dates[i]] = i;
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = atr[i] != null ? atr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct, closes, dates, closeByDate, idxByDate };
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
  // 날짜→종가 맵(섹터 평균수익률 산출용) + 원본 dates/closes(N일수익률 산출용)
  const closeByDate = {}; seq.forEach(s => closeByDate[s.date] = s.close);
  const dateIdx = {}; dates.forEach((d, i) => { if (!(d in dateIdx)) dateIdx[d] = i; });
  return { ...stock, seq, qualify, otherRegime, marketRegime, closeByDate, rawDates: dates, rawCloses: closes, dateIdx };
}

// 섹터 평균 N일수익률 사전계산: date -> sector -> avgReturn
function buildSectorReturns(valid, n) {
  const bySector = {};
  for (const r of valid) {
    if (r.error) continue;
    for (const d of r.rawDates) {
      const i = r.dateIdx[d];
      const ret = nDayReturn(r.rawCloses, i, n);
      if (ret == null) continue;
      (bySector[r.sector] ??= {})[d] ??= [];
      bySector[r.sector][d].push(ret);
    }
  }
  const sectorAvg = {};
  for (const sector in bySector) {
    sectorAvg[sector] = {};
    for (const d in bySector[sector]) sectorAvg[sector][d] = mean(bySector[sector][d]);
  }
  return sectorAvg;
}

function buildEntries(valid, sectorAvgByN, opts) {
  const entries = [];
  for (const r of valid) {
    if (r.error || !r.seq) continue;
    for (let i = 0; i < r.qualify.length; i++) {
      if (!r.qualify[i]) continue;
      const date = r.seq[i].date;
      if (r.otherRegime?.regime?.[date] !== true) continue; // v12 지수병행확인(고정)
      if (opts.sectorLookback != null) {
        const sectorAvg = sectorAvgByN[opts.sectorLookback];
        const sr = sectorAvg?.[r.sector]?.[date];
        const marketIdx = r.marketRegime.idxByDate[date];
        const mr = nDayReturn(r.marketRegime.closes, marketIdx, opts.sectorLookback);
        if (sr == null || mr == null) continue;
        const rs = sr - mr;
        if (opts.sectorMode === 'rel' && rs <= opts.sectorThreshold) continue; // 섹터가 시장보다 강해야 진입
        if (opts.sectorMode === 'abs' && sr <= opts.sectorThreshold) continue; // 섹터 자체가 상승해야 진입
      }
      entries.push({ seq: r.seq, i, date, name: r.name, sector: r.sector, market: r.market || 'KOSPI' });
    }
  }
  entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return entries;
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
function tradesFor(entries, opts) {
  return entries.map(e => {
    const sl = SL_BY_MARKET[e.market] ?? 8, trail = TRAIL_BY_MARKET[e.market] ?? 8;
    return simulatePartialTP(e.seq, e.i, e.seq[e.i].close, sl, trail, opts.maxHold, TP_PCT, TP_FRAC);
  }).filter(Boolean);
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const slRatio = trades.filter(t => t.reason === 'SL').length / trades.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, slRatio, sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(34)} 데이터 없음`;
  return label.padEnd(34) + String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(9) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(9) +
    `${s.win.toFixed(0)}%`.padStart(7) +
    `${s.slRatio.toFixed(0)}%`.padStart(7) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[눌림목 섹터로테이션 스윕] ${opts.stocks.length}종목, 최대${opts.maxHold}거래일, 최근${opts.calendarDays}일`);
  const sectors = [...new Set(opts.stocks.map(s => s.sector))];
  console.error(`[섹터그룹] ${sectors.map(s => `${s}(${opts.stocks.filter(x => x.sector === s).length})`).join(', ')}`);

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

  const LOOKBACKS = [10, 20, 40];
  const sectorAvgByN = {}; for (const n of LOOKBACKS) sectorAvgByN[n] = buildSectorReturns(valid, n);

  const baselineEntries = buildEntries(valid, sectorAvgByN, { sectorLookback: null });
  const baselineTrades = tradesFor(baselineEntries, opts);
  const baselineS = summarize(baselineTrades);

  console.log('\n════════ 눌림목 섹터로테이션 필터 그리드서치 결과 ════════');
  console.log('(baseline = v12 확정: 지수병행확인+개별ATR%상한6%+시장별SL/TRAIL, 섹터필터 없음)');
  console.log(fmtRow('baseline(v12)', baselineS));
  console.log('─'.repeat(85));

  const MODES = ['rel', 'abs'];
  const THRESHOLDS = { rel: [-2, 0, 2], abs: [-5, 0, 5] };
  console.log('조합'.padEnd(34) + 'n'.padStart(6) + '평균'.padStart(9) + '중앙값'.padStart(9) + '승률'.padStart(7) + 'SL비율'.padStart(7) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(85));
  const rows = [];
  for (const n of LOOKBACKS) {
    for (const mode of MODES) {
      for (const th of THRESHOLDS[mode]) {
        const entries = buildEntries(valid, sectorAvgByN, { sectorLookback: n, sectorMode: mode, sectorThreshold: th });
        const trades = tradesFor(entries, opts);
        const s = summarize(trades);
        const label = `${n}일·${mode === 'rel' ? '섹터-시장' : '섹터자체'}${th >= 0 ? '>' + th : '>' + th}`;
        rows.push({ label, s, n, mode, th });
      }
    }
  }
  rows.sort((a, b) => (b.s?.sharpe ?? -99) - (a.s?.sharpe ?? -99));
  for (const r of rows) console.log(fmtRow(r.label, r.s));

  console.log('\n────────────────────────────────────────');
  console.log('상위 3개 조합 IS/OOS 검증(60/40 분할, 재탐색 없음):');
  console.log('후보'.padEnd(28) + '구간'.padEnd(10) + 'n'.padStart(6) + '평균'.padStart(9) + '중앙값'.padStart(9) + '승률'.padStart(7) + 'SL비율'.padStart(7) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(85));
  console.log(fmtRow('baseline(v12) 전체', baselineS));
  const top3 = rows.slice(0, 3);
  for (const cand of top3) {
    const entries = buildEntries(valid, sectorAvgByN, { sectorLookback: cand.n, sectorMode: cand.mode, sectorThreshold: cand.th });
    const splitIdx = Math.floor(entries.length * 0.6);
    const splitDate = entries[splitIdx]?.date;
    if (!splitDate) { console.log(`${cand.label.padEnd(28)} 표본부족(n=${entries.length})`); continue; }
    const isE = entries.filter(e => e.date <= splitDate);
    const oosE = entries.filter(e => e.date > splitDate);
    const isS = summarize(tradesFor(isE, opts));
    const oosS = summarize(tradesFor(oosE, opts));
    console.log(fmtRow(`${cand.label} / IS`, isS));
    console.log(fmtRow(`${cand.label} / OOS`, oosS));
    console.log(`  → 최근 진입일: ${entries[entries.length - 1]?.date}, 전체표본 n=${entries.length}`);
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
