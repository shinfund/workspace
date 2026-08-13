// 5EMA+20EMA 진입신호에 장기추세 필터(EMA50/100/200/400)를 추가 검토하는 백테스트 — 스킬: stock-deviation (2026-08-07 신규)
// 목적: 하락추세 구간에서 과도하게 발생하는 매수신호(예: 현대차 6~7월 사례)를 걸러내
//       신호건수 감소·승률 개선·손절(SL) 비율 감소 효과가 있는 장기추세 필터를 탐색
// 사용법: node scripts/project_deviation_trend_filter_backtest.mjs [--max-hold N] [--sl N] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입 기저신호: EMA5·EMA20 각각 롤링250일 Z<=-2 & 위치<=3%ile 동시 충족(기존 project_deviation_dual_ema_exit_backtest.mjs와 동일, 2026-08-07 스윕 백테스트로 10→3 조임)
// 청산: 기존과 동일한 3단계 매도 규칙(EMA5돌파50%→EMA20돌파25%→EMA5하향이탈 전량, SL-15% 최우선, 시간청산)
// 이 스크립트는 "신호 발생 시점의 장기추세 상태"별로 위 신호를 사후 분류해 필터 후보의 효과만 비교(진입로직 자체는 변경하지 않음)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' },
  { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' },
  { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' },
  { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' },
  { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' },
  { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' },
  { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' },
  { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' },
  { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' },
  { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' },
  { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' },
  { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' },
  { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' },
  { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' },
  { code: '010950', name: 'S-Oil' },
];

const ROLL = 250;
const Z_THRESHOLD = -2;
const ENTRY_PCT_THRESHOLD = 3; // 2026-08-07 스윕 백테스트로 10→3 조임(dual_ema_exit_backtest.mjs와 동일)
const EMA_PERIODS = { fast: 5, slow: 20, mid: 50, long: 100, xlong: 200, xxlong: 400 };

function parseArgs() {
  const argv = process.argv.slice(2);
  // 장기추세(EMA400) 워밍업까지 감안해 기본 조회기간을 넉넉히(약 7년) 잡음
  const o = { stocks: DEFAULT_STOCKS, maxHold: 20, sl: 15, calendarDays: 2555 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => {
        const [code, name, market] = s.split(':');
        return { code, name: name || code, market: market || 'KOSPI' };
      });
    }
  }
  return o;
}

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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
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
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
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

function rollingZPct(seq, j, devKey) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r[devKey]);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j][devKey];
  const z = sd ? (v - m) / sd : 0;
  const pct = win.filter(d => d <= v).length / win.length * 100;
  return { z, pct };
}

// 3단계 매도 시뮬레이션 (project_deviation_dual_ema_exit_backtest.mjs와 동일 규칙)
function simulateTrade(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0;
  let stage = 'INIT';
  const legs = [];

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema20 = seq[j].ema20;
    const ret = (close - entryClose) / entryClose * 100;

    if (ret <= -opts.sl) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d });
      openWeight = 0;
      break;
    }
    if (stage === 'INIT' && close >= ema5) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG5', day: d });
      openWeight -= w;
      stage = 'LEG5_DONE';
    }
    if (stage === 'LEG5_DONE' && close >= ema20) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG20', day: d });
      openWeight -= w;
      stage = 'HOLD';
    }
    if (stage === 'HOLD' && close < ema5) {
      legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN', day: d });
      openWeight = 0;
      break;
    }
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const hasSL = legs.some(l => l.reason === 'SL');
  const leg5Done = legs.some(l => l.reason === 'LEG5' || l.reason === 'LEG20' || l.reason === 'BREAKDOWN');
  const leg20Done = legs.some(l => l.reason === 'LEG20' || l.reason === 'BREAKDOWN');
  return { weightedRet, hasSL, leg5Done, leg20Done };
}

// 신호 발생 시점(i0)의 장기추세 상태를 태깅
function classifyTrend(seq, i0) {
  const r = seq[i0];
  const has50 = r.ema50 != null, has100 = r.ema100 != null, has200 = r.ema200 != null, has400 = r.ema400 != null;
  const ema50Prev = i0 >= 20 ? seq[i0 - 20].ema50 : null;
  return {
    aboveEma50: has50 ? r.close >= r.ema50 : null,
    aboveEma100: has100 ? r.close >= r.ema100 : null,
    aboveEma200: has200 ? r.close >= r.ema200 : null,
    aboveEma400: has400 ? r.close >= r.ema400 : null,
    ema50Rising: has50 && ema50Prev != null ? r.ema50 >= ema50Prev : null,
    ema50gt200: has50 && has200 ? r.ema50 >= r.ema200 : null,
    ema100gt200: has100 && has200 ? r.ema100 >= r.ema200 : null,
    fullBullStack: has50 && has100 && has200 ? (r.ema50 >= r.ema100 && r.ema100 >= r.ema200) : null,
  };
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emaSeries = {};
  for (const [key, period] of Object.entries(EMA_PERIODS)) {
    emaSeries[key] = buildEma(closes, period);
  }

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emaSeries.fast[i] == null || emaSeries.slow[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i],
      ema5: emaSeries.fast[i], ema20: emaSeries.slow[i],
      ema50: emaSeries.mid[i], ema100: emaSeries.long[i], ema200: emaSeries.xlong[i], ema400: emaSeries.xxlong[i],
      dev5: (closes[i] - emaSeries.fast[i]) / emaSeries.fast[i] * 100,
      dev20: (closes[i] - emaSeries.slow[i]) / emaSeries.slow[i] * 100,
    });
  }
  if (seq.length < ROLL + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5');
    const z20 = rollingZPct(seq, i, 'dev20');
    flags[i] = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD && z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const records = [];
  for (const i0 of events) {
    const trade = simulateTrade(seq, i0, opts);
    if (!trade) continue; // 미확정(최근 신호)
    const trend = classifyTrend(seq, i0);
    records.push({ name: stock.name, date: seq[i0].date, ...trend, ...trade });
  }
  return { ...stock, records };
}

function bucketStats(records, predicate) {
  const subset = records.filter(r => predicate(r) === true);
  if (!subset.length) return { n: 0 };
  const rets = subset.map(r => r.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const slRate = subset.filter(r => r.hasSL).length / subset.length * 100;
  return { n: subset.length, avg: mean(rets), med: median(rets), win, slRate };
}

function fmtRow(label, s, baselineN) {
  if (!s || s.n === 0) return `  ${label.padEnd(28)}: 표본 없음(장기EMA 데이터 부족)`;
  const pct = baselineN ? (s.n / baselineN * 100).toFixed(0) : '-';
  return `  ${label.padEnd(28)}: n=${String(s.n).padStart(4)} (전체대비 ${pct}%)  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  SL비율 ${s.slRate.toFixed(0)}%`;
}

async function main() {
  const opts = parseArgs();
  console.error(`[장기추세 필터 검토 백테스트] ${opts.stocks.length}종목, 조회기간 ${opts.calendarDays}일(약 ${(opts.calendarDays / 365).toFixed(1)}년)`);
  console.error(`기저신호(진입): EMA5·EMA20 각각 Z<=${Z_THRESHOLD} & 위치<=${ENTRY_PCT_THRESHOLD}%ile 동시충족 / 청산: 3단계 매도(EMA5→EMA20→EMA5하향이탈) + SL-15% + 시간청산20일`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const errors = [];
  const records = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    records.push(...r.records);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const baseline = bucketStats(records, () => true);
  console.log(`\n━━━ 기저(필터 없음) ━━━`);
  console.log(fmtRow('전체', baseline, null));

  console.log(`\n━━━ 장기추세 필터별 효과 비교 ━━━`);
  console.log(`(각 필터를 "충족한 신호만" 매수했다고 가정할 때의 성과 — 신호건수 감소폭과 승률·SL비율 변화를 함께 확인)`);
  const filters = [
    ['종가 ≥ EMA50', r => r.aboveEma50],
    ['종가 ≥ EMA100', r => r.aboveEma100],
    ['종가 ≥ EMA200', r => r.aboveEma200],
    ['종가 ≥ EMA400', r => r.aboveEma400],
    ['EMA50 상승중(20일前 대비)', r => r.ema50Rising],
    ['EMA50 ≥ EMA200(장기 상승추세)', r => r.ema50gt200],
    ['EMA100 ≥ EMA200', r => r.ema100gt200],
    ['EMA50≥EMA100≥EMA200(완전 정배열)', r => r.fullBullStack],
    ['[역필터] EMA50 < EMA200(하락추세)', r => r.ema50gt200 === false],
  ];
  for (const [label, pred] of filters) {
    console.log(fmtRow(label, bucketStats(records, pred), baseline.n));
  }

  console.log(`\n━━━ 조합 필터 ━━━`);
  const combos = [
    ['EMA50≥200 AND 종가≥EMA200', r => r.ema50gt200 && r.aboveEma200],
    ['EMA50≥200 AND EMA50 상승중', r => r.ema50gt200 && r.ema50Rising],
    ['완전정배열 AND 종가≥EMA200', r => r.fullBullStack && r.aboveEma200],
  ];
  for (const [label, pred] of combos) {
    console.log(fmtRow(label, bucketStats(records, pred), baseline.n));
  }

  console.log(`\n※ n(표본수) 절대값이 작은 필터(특히 EMA400 관련)는 상장이력 짧은 종목이 제외되며 표본이 급감할 수 있음 — 참고용`);
  console.log('※ SL비율 = 해당 구간 신호 중 손절(-15%)로 종료된 비중 (낮을수록 좋음)');

  // ── 강건성 검증: "하락추세(EMA50<EMA200)" 필터가 특정 시기·종목에 편중된 결과인지 확인 ──
  console.log(`\n\n━━━ 강건성 검증: [하락추세] 필터(승률·SL비율 최우수) 편중 여부 ━━━`);
  const downTrend = records.filter(r => r.ema50gt200 === false);
  const upTrend = records.filter(r => r.ema50gt200 === true);

  console.log(`\n[연도별 분포] (특정 폭락장 한 해에 몰려있는지 확인)`);
  const years = [...new Set(records.map(r => r.date.slice(0, 4)))].sort();
  for (const y of years) {
    const dn = bucketStats(downTrend.filter(r => r.date.startsWith(y)), () => true);
    const up = bucketStats(upTrend.filter(r => r.date.startsWith(y)), () => true);
    const dnStr = dn.n ? `n=${dn.n} 평균${dn.avg >= 0 ? '+' : ''}${dn.avg.toFixed(1)}% 승률${dn.win.toFixed(0)}% SL${dn.slRate.toFixed(0)}%` : 'n=0';
    const upStr = up.n ? `n=${up.n} 평균${up.avg >= 0 ? '+' : ''}${up.avg.toFixed(1)}% 승률${up.win.toFixed(0)}% SL${up.slRate.toFixed(0)}%` : 'n=0';
    console.log(`  ${y}  [하락추세] ${dnStr.padEnd(32)} [상승추세] ${upStr}`);
  }

  console.log(`\n[종목별 분포] (하락추세 필터 신호 상위 기여 종목 — 특정 종목 편중 여부 확인)`);
  const byStockCount = {};
  for (const r of downTrend) byStockCount[r.name] = (byStockCount[r.name] || 0) + 1;
  const topStocks = Object.entries(byStockCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [name, cnt] of topStocks) {
    const s = bucketStats(downTrend.filter(r => r.name === name), () => true);
    console.log(`  ${name.padEnd(14)} ${cnt}건  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  SL ${s.slRate.toFixed(0)}%`);
  }
  console.log(`  (하락추세 필터 전체 ${downTrend.length}건 중 상위 10종목 합계: ${topStocks.reduce((a, [, c]) => a + c, 0)}건, ${(topStocks.reduce((a, [, c]) => a + c, 0) / downTrend.length * 100).toFixed(0)}%)`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
