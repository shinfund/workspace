// 5EMA+20EMA 이중 괴리율 진입 + 재진입(매일 신호충족시마다 매수) + 2단계 EMA5기반 청산 백테스트
// 스킬: stock-deviation (2026-08-11 사용자 요청 — project_deviation_dual_ema_exit_backtest.mjs 기반,
//   ①EMA20 2차매도 레그 제거하고 EMA5 돌파/하향이탈 2단계만 사용 ②이벤트를 신호 첫날(rising edge)이 아니라
//   신호 충족 매일로 바꿔 "매수진입조건마다 매수"(재진입/피라미딩) 반영 ③--no-trend로 장기하락추세 필터 on/off 비교)
// 사용법: node scripts/project_deviation_reentry_ema5_exit_backtest.mjs [--max-hold N] [--sl N] [--calendar-days N] [--no-trend] [--edge-only] [--stocks 코드:이름:시장,...]
// 진입: EMA5·EMA20 각각 롤링250일 Z<=-2 & 위치<=3%ile 동시충족 (기본: AND EMA50<EMA200 하락추세, --no-trend로 제거)
//   기본은 신호 충족 "매일" 신규진입(재진입) 이벤트로 취급. --edge-only 주면 기존 방식(신호 시작일 1회)과 비교 가능.
// 청산(2단계, 신규):
//   ① 손절(전량): 진입가 대비 -SL%(기본15) 도달 시 잔여 전량 청산 — 항상 최우선 판정
//   ② 1차 매도(수량50%): 종가가 EMA5 돌파(종가>=EMA5)한 날 발생
//   ③ 잔량(50%) 홀딩 중 종가가 EMA5 아래로 하향 이탈 시 잔량 전량 청산
//   ④ 시간청산: 위 조건 없이 최대보유일(N거래일) 도달 시 잔량 전량 청산
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (project_deviation_tp20_exit_backtest.mjs와 동일 유니버스)
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
const ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5;
const SLOW_PERIOD = 20;
const TREND_MID_PERIOD = 50;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, maxHold: 20, sl: 15, calendarDays: 2555, trendFilter: true, edgeOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--no-trend') o.trendFilter = false;
    if (argv[i] === '--edge-only') o.edgeOnly = true;
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

// 2단계 매도 시뮬레이션
// stage: INIT(5EMA돌파 대기) -> LEG5_DONE(잔량50%, 5EMA하향이탈 감시)
function simulateTrade(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0;
  let stage = 'INIT';
  const legs = [];
  let leg5Done = false;

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정(최근 신호)
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ret = (close - entryClose) / entryClose * 100;

    // ① 손절 최우선 판정 (진입가 대비 -SL%)
    if (ret <= -opts.sl) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d, date: seq[j].date });
      openWeight = 0;
      break;
    }

    // ② 1차 매도: 종가가 EMA5 돌파
    if (stage === 'INIT' && close >= ema5) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG5', day: d, date: seq[j].date });
      openWeight -= w;
      leg5Done = true;
      stage = 'LEG5_DONE';
    }

    // ③ 잔량(50%) 홀딩 중 EMA5 하향 이탈 시 전량 청산
    if (stage === 'LEG5_DONE' && close < ema5) {
      legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN', day: d, date: seq[j].date });
      openWeight = 0;
      break;
    }

    // ④ 시간청산(최대보유일 도달)
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalDay = legs[legs.length - 1].day;
  return { legs, weightedRet, finalDay, entryDate: seq[i0].date, leg5Done };
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i],
      ema50: ema50s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100,
      dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100,
    });
  }
  if (seq.length < ROLL + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5');
    const z20 = rollingZPct(seq, i, 'dev20');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const sig20 = z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
    const downTrend = !opts.trendFilter || (seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200);
    flags[i] = sig5 && sig20 && downTrend;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (!flags[i]) continue;
    if (opts.edgeOnly) { if (!flags[i - 1]) events.push(i); }
    else events.push(i); // 재진입: 신호 충족 매일 신규 진입 이벤트로 취급
  }

  const trades = [];
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts);
    if (t) trades.push({ name: stock.name, ...t });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.finalDay));
  const reasonCount = {};
  const reasonWeight = {};
  for (const t of trades) {
    for (const l of t.legs) {
      reasonCount[l.reason] = (reasonCount[l.reason] || 0) + 1;
      reasonWeight[l.reason] = (reasonWeight[l.reason] || 0) + l.weight;
    }
  }
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays,
    reasonCount, reasonWeight,
  };
}

function byStockSummary(results) {
  const rows = [];
  for (const r of results) {
    if (r.error || !r.trades?.length) continue;
    const s = summarizeTrades(r.trades);
    rows.push({ name: r.name, totalEvents: r.totalEvents, ...s });
  }
  return rows.sort((a, b) => b.n - a.n);
}

async function main() {
  const opts = parseArgs();
  console.error(`[재진입+2단계EMA5청산 백테스트] ${opts.stocks.length}종목, 손절-${opts.sl}%/최대${opts.maxHold}거래일, 하락추세필터=${opts.trendFilter ? 'ON' : 'OFF'}, 진입방식=${opts.edgeOnly ? '신호시작일 1회' : '신호충족 매일(재진입)'}`);
  console.error(`진입: EMA5·EMA20 각각 Z<=${Z_THRESHOLD} & 위치<=${ENTRY_PCT_THRESHOLD}%ile 동시충족${opts.trendFilter ? ' AND EMA50<EMA200(장기 하락추세)' : ''}`);
  console.error(`청산: ①손절-${opts.sl}%(최우선) ②종가≥EMA5 돌파 시 50%매도 ③이후 종가<EMA5 하향이탈 시 잔량전량매도 ④시간청산(${opts.maxHold}거래일)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n전체 신호(이벤트) 발생: ${totalEvents}건 (미확정 최근 신호 제외 유효표본: ${pooled.length}건)`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }

  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  가중평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률(가중수익>0) ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균종결일 ${s.avgDays.toFixed(1)}거래일`);
  console.log(`\n[레그(leg)별 발생 빈도 / 가중치 합]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(12)}: ${cnt}건  (가중치 합 ${s.reasonWeight[reason].toFixed(2)})`);
  }

  console.log(`\n━━━ 종목별 신호수 ━━━`);
  const byStock = byStockSummary(results);
  for (const row of byStock) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(유효${row.n}건)  가중평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
