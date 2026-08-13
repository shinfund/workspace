// 위치(%ile) 신호 임계값 스윕 백테스트 — 스킬: stock-deviation (2026-08-07 신규)
// 목적: 현재 "Z<=-2 & 위치<=10%ile" 기준에서, Z<=-2일 때 위치가 보통 이미 10%ile보다 훨씬 낮게(예: ~2%ile) 떨어진다는
//       관찰을 근거로 위치 임계값을 더 타이트하게(5/3/2/1%ile) 조여도 되는지, 조이면 신호수·승률·SL비율이 어떻게 바뀌는지 검증
// 사용법: node scripts/project_deviation_pct_threshold_sweep.mjs [--pct-list 10,5,3,2,1] [--max-hold N] [--sl N] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입 기저: EMA5·EMA20 각각 Z<=-2 충족 AND EMA50<EMA200(장기하락추세) — 위치(%ile) 임계값만 후보별로 교체하며 비교
// 청산: project_deviation_dual_ema_exit_backtest.mjs와 동일한 3단계 매도(EMA5→EMA20→EMA5하향이탈) + SL-15% + 시간청산20일
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
const FAST_PERIOD = 5;
const SLOW_PERIOD = 20;
const TREND_MID_PERIOD = 50;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, maxHold: 20, sl: 15, calendarDays: 2555, pctList: [10, 5, 3, 2, 1] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--pct-list') o.pctList = argv[++i].split(',').map(Number);
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
      legs.push({ weight: openWeight, ret, reason: 'SL' });
      openWeight = 0;
      break;
    }
    if (stage === 'INIT' && close >= ema5) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG5' });
      openWeight -= w;
      stage = 'LEG5_DONE';
    }
    if (stage === 'LEG5_DONE' && close >= ema20) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG20' });
      openWeight -= w;
      stage = 'HOLD';
    }
    if (stage === 'HOLD' && close < ema5) {
      legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN' });
      openWeight = 0;
      break;
    }
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME' });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const hasSL = legs.some(l => l.reason === 'SL');
  return { weightedRet, hasSL };
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

  // Z/위치는 한 번만 계산해두고, 각 pct후보는 이 캐시된 값으로 재평가(재조회·재계산 없음)
  const zpc = new Array(seq.length).fill(null);
  for (let i = ROLL - 1; i < seq.length; i++) {
    zpc[i] = { z5: rollingZPct(seq, i, 'dev5'), z20: rollingZPct(seq, i, 'dev20') };
  }

  const results = {};
  for (const pctTh of opts.pctList) {
    const flags = new Array(seq.length).fill(false);
    for (let i = ROLL - 1; i < seq.length; i++) {
      const zp = zpc[i];
      const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
      const sig5 = zp.z5.z <= Z_THRESHOLD && zp.z5.pct <= pctTh;
      const sig20 = zp.z20.z <= Z_THRESHOLD && zp.z20.pct <= pctTh;
      flags[i] = sig5 && sig20 && downTrend;
    }
    const events = [];
    for (let i = ROLL - 1; i < seq.length; i++) {
      if (flags[i] && !flags[i - 1]) events.push(i);
    }
    const trades = [];
    for (const i0 of events) {
      const t = simulateTrade(seq, i0, opts);
      if (t) trades.push(t);
    }
    results[pctTh] = { trades, totalEvents: events.length };
  }
  return { ...stock, results };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const slRate = trades.filter(t => t.hasSL).length / trades.length * 100;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, slRate };
}

async function main() {
  const opts = parseArgs();
  console.error(`[위치(%ile) 임계값 스윕] ${opts.stocks.length}종목 × 후보 [${opts.pctList.join(', ')}]%ile, Z<=${Z_THRESHOLD} 고정, AND 하락추세, 손절-${opts.sl}%/최대${opts.maxHold}거래일`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const errors = results.filter(r => r.error);
  if (errors.length) console.error(`[조회실패] ${errors.map(r => r.name).join(', ')}`);

  console.log(`\n━━━ 위치(%ile) 임계값별 비교 (Z<=-2 고정, AND 하락추세) ━━━\n`);
  console.log('임계값'.padEnd(10) + 'n'.padStart(6) + '가중평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'SL비율'.padStart(8));
  console.log('─'.repeat(52));
  for (const pctTh of opts.pctList) {
    const pooled = [];
    for (const r of results) if (!r.error) pooled.push(...r.results[pctTh].trades);
    const s = summarize(pooled);
    if (!s) { console.log(`≤${pctTh}%ile`.padEnd(10) + '표본없음'); continue; }
    console.log(
      `≤${pctTh}%ile`.padEnd(10) +
      String(s.n).padStart(6) +
      `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
      `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
      `${s.win.toFixed(0)}%`.padStart(8) +
      `${s.slRate.toFixed(0)}%`.padStart(8)
    );
  }

  console.log(`\n━━━ 종목별 신호수 변화 (임계값 조일수록 얼마나 줄어드는지) ━━━\n`);
  console.log('종목명'.padEnd(16) + opts.pctList.map(p => `≤${p}%ile`.padStart(9)).join(''));
  for (const r of results) {
    if (r.error) continue;
    console.log(r.name.padEnd(16) + opts.pctList.map(p => String(r.results[p].totalEvents).padStart(9)).join(''));
  }

  console.log('\n※ n=유효표본(최근 미확정 이벤트 제외) / SL비율=손절(-15%)로 종료된 비중(낮을수록 좋음)');
  console.log('※ 진입 Z조건(-2)·하락추세 필터는 모든 후보에서 동일 고정, 위치(%ile) 임계값만 교체 비교');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
