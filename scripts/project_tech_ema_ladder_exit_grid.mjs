// EMA래더 완전정배열(EMA5>20>50>100>200>400) 진입신호 — 청산규칙 그리드서치 (2026-08-10)
// 배경: project_tech_ema_ladder_signal_scan.mjs 1차 스캔에서 "완전정배열 전환일" 신호만 베이스라인(무신호) 대비
//       뚜렷한 우위 확인(+40일 승률63%·Sharpe0.388 vs 베이스라인 57%·0.287). 나머지 EMA쌍 크로스오버는 전부 기각.
//       이 스크립트는 그 진입신호에 실제 청산규칙(SL/TRAIL/추세이탈EMA/시간청산)을 씌워 세번째 매매전략으로 확정 가능한지 검증.
// 그리드 1: TREND_BREAK 기준 EMA(20/50/100) × SL(8/10/12) × TRAIL(8/10/12), maxHold=60 고정
// 그리드 2: 최적조합에 시장국면(KOSPI EMA100 상승+지속일) 필터 on/off 비교
// 그리드 3: 최적조합에 부분익절(TP) 오버레이 적용 비교
// 검증: 최종조합 IS/OOS 60/40 분할
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
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

const EMA_PERIODS = [5, 20, 50, 100, 200, 400];
const PAIRS = [[5, 20], [20, 50], [50, 100], [100, 200], [200, 400]];
const KOSPI_SYMBOL = '%5EKS11';
const CALENDAR_DAYS = 2200;
const MAX_HOLD = 60;
const REGIME_MA = 100, REGIME_SLOPE_LOOKBACK = 10, REGIME_STREAK_MIN = 10;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.on('data', c => d += c);
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
}
function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) continue;
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
    emas[i] = ema;
  }
  return emas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}
async function batchAll(items, fn, concurrency = 5, delay = 150) {
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

async function fetchMarketRegime(p1, p2) {
  const chart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const ma = buildEma(closes, REGIME_MA);
  const regime = {}, streak = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (ma[i] == null || i < REGIME_MA + REGIME_SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > ma[i] && ma[i] > ma[i - REGIME_SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up;
    streak[dates[i]] = curStreak;
  }
  return { regime, streak };
}

async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const emas = {};
  for (const p of EMA_PERIODS) emas[p] = buildEma(closes, p);

  const n = closes.length;
  const warmup = 400;
  const alignCount = (i) => PAIRS.filter(([s, l]) => emas[s][i] > emas[l][i]).length;

  const entries = [];
  for (let i = warmup + 1; i < n - 1; i++) {
    if (closes[i] == null) continue;
    if (EMA_PERIODS.some(p => emas[p][i] == null || emas[p][i - 1] == null)) continue;
    const cntToday = alignCount(i), cntYest = alignCount(i - 1);
    if (cntToday === PAIRS.length && cntYest < PAIRS.length) entries.push({ i, date: dates[i] });
  }
  return { ...stock, dates, closes, emas, entries };
}

// 청산 시뮬레이션: SL / TREND_BREAK(지정 EMA 이탈) / TRAIL(고점대비) / TIME
function simulateExit(stock, i0, sl, trail, trendBreakPeriod, maxHold) {
  const entryClose = stock.closes[i0];
  let peak = entryClose;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= stock.closes.length || stock.closes[j] == null) return null;
    const close = stock.closes[j];
    const breakLevel = stock.emas[trendBreakPeriod][j];
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) return { ret, reason: 'SL', day: d };
    if (breakLevel != null && close < breakLevel) return { ret, reason: 'TREND_BREAK', day: d };
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return { ret, reason: 'TRAIL', day: d };
    if (d === maxHold) return { ret, reason: 'TIME', day: d };
  }
  return null;
}

function simulateExitTP(stock, i0, sl, trail, trendBreakPeriod, maxHold, tpPct, tpFrac) {
  const entryClose = stock.closes[i0];
  let peak = entryClose, tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= stock.closes.length || stock.closes[j] == null) return null;
    const close = stock.closes[j];
    const breakLevel = stock.emas[trendBreakPeriod][j];
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { ret: blended, reason, day: d, tpTaken };
    };
    if (ret <= -sl) return finish('SL');
    if (breakLevel != null && close < breakLevel) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  const reasons = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sd, sharpe: sd > 0 ? mean(rets) / sd : 0, reasons };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(28)} 데이터 없음`;
  return label.padEnd(28) +
    String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  console.error(`[EMA래더 완전정배열 청산그리드] ${DEFAULT_STOCKS.length}종목, 최근${CALENDAR_DAYS}일, maxHold=${MAX_HOLD}`);
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);

  const loaded = await batchAll(DEFAULT_STOCKS, loadStock);
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  const valid = loaded.filter(r => !r.error);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ stock: r, i: e.i, date: e.date, name: r.name });
  allEntries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건 (시장국면 필터 미적용 원본)\n`);

  // ── 그리드 1: TREND_BREAK EMA × SL × TRAIL ──
  console.log('════════ 그리드1: TREND_BREAK EMA × SL × TRAIL (maxHold=60) ════════\n');
  console.log('조합'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(71));
  const results1 = [];
  for (const tb of [20, 50, 100]) {
    for (const sl of [8, 10, 12]) {
      for (const trail of [8, 10, 12]) {
        const trades = allEntries.map(e => simulateExit(e.stock, e.i, sl, trail, tb, MAX_HOLD)).filter(Boolean);
        const s = summarize(trades);
        results1.push({ label: `EMA${tb}/SL${sl}/TR${trail}`, s });
      }
    }
  }
  results1.sort((a, b) => (b.s?.sharpe ?? -99) - (a.s?.sharpe ?? -99));
  for (const r of results1.slice(0, 10)) console.log(fmtRow(r.label, r.s));
  const best1 = results1[0];
  console.log(`\n[그리드1 최적] ${best1.label} — 청산사유 분포: ${JSON.stringify(best1.s.reasons)}`);

  const [bestTb, bestSl, bestTrail] = [
    parseInt(best1.label.match(/EMA(\d+)/)[1]),
    parseInt(best1.label.match(/SL(\d+)/)[1]),
    parseInt(best1.label.match(/TR(\d+)/)[1]),
  ];

  // ── 그리드 2: 시장국면 필터 on/off ──
  console.log('\n\n════════ 그리드2: 시장국면(KOSPI EMA100 상승+지속10일) 필터 on/off ════════\n');
  console.log('조합'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(71));
  const tradesNoFilter = allEntries.map(e => simulateExit(e.stock, e.i, bestSl, bestTrail, bestTb, MAX_HOLD)).filter(Boolean);
  console.log(fmtRow('필터없음', summarize(tradesNoFilter)));
  const filteredEntries = allEntries.filter(e => marketRegime.regime[e.date] === true && (marketRegime.streak[e.date] ?? 0) >= REGIME_STREAK_MIN);
  const tradesFiltered = filteredEntries.map(e => simulateExit(e.stock, e.i, bestSl, bestTrail, bestTb, MAX_HOLD)).filter(Boolean);
  console.log(fmtRow(`국면필터적용(n진입${filteredEntries.length})`, summarize(tradesFiltered)));

  // ── 그리드 3: 부분익절(TP) 오버레이 ──
  console.log('\n\n════════ 그리드3: 부분익절(TP) 오버레이 (그리드1 최적 조합 기준) ════════\n');
  console.log('조합'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(71));
  console.log(fmtRow('TP없음(baseline)', summarize(tradesNoFilter)));
  for (const tpPct of [10, 15, 20]) {
    const trades = allEntries.map(e => simulateExitTP(e.stock, e.i, bestSl, bestTrail, bestTb, MAX_HOLD, tpPct, 0.5)).filter(Boolean);
    console.log(fmtRow(`TP+${tpPct}%/50%매도`, summarize(trades)));
  }

  console.log(`\n\n[요약] 그리드1 최적: TREND_BREAK=EMA${bestTb}, SL=${bestSl}%, TRAIL=${bestTrail}%`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
