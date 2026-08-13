// 시가총액 유니버스 크기(TOP10/20/30/50 등) 백테스트 — EMA20 고정, 유니버스를 넓힐수록 신호품질이 어떻게 변하는지 비교
// 사용법: node scripts/project_deviation_universe_backtest.mjs [--period N] [--tiers 10,20,30,50] [--calendar-days N]
// 스킬: stock-deviation — 시가총액 TOP50까지 한 번에 조회 후 순위 컷오프별로 누적 집계(네트워크 호출은 종목당 1회)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (2026-07-25 기준, rank 오름차순)
const DEFAULT_STOCKS = [
  { rank: 1, code: '005930', name: '삼성전자', market: 'KOSPI' },
  { rank: 2, code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
  { rank: 3, code: '402340', name: 'SK스퀘어', market: 'KOSPI' },
  { rank: 4, code: '009150', name: '삼성전기', market: 'KOSPI' },
  { rank: 5, code: '005380', name: '현대차', market: 'KOSPI' },
  { rank: 6, code: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
  { rank: 7, code: '032830', name: '삼성생명', market: 'KOSPI' },
  { rank: 8, code: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
  { rank: 9, code: '105560', name: 'KB금융', market: 'KOSPI' },
  { rank: 10, code: '000270', name: '기아', market: 'KOSPI' },
  { rank: 11, code: '028260', name: '삼성물산', market: 'KOSPI' },
  { rank: 12, code: '329180', name: 'HD현대중공업', market: 'KOSPI' },
  { rank: 13, code: '055550', name: '신한지주', market: 'KOSPI' },
  { rank: 14, code: '012450', name: '한화에어로스페이스', market: 'KOSPI' },
  { rank: 15, code: '012330', name: '현대모비스', market: 'KOSPI' },
  { rank: 16, code: '034730', name: 'SK', market: 'KOSPI' },
  { rank: 17, code: '034020', name: '두산에너빌리티', market: 'KOSPI' },
  { rank: 18, code: '068270', name: '셀트리온', market: 'KOSPI' },
  { rank: 19, code: '006400', name: '삼성SDI', market: 'KOSPI' },
  { rank: 20, code: '086790', name: '하나금융지주', market: 'KOSPI' },
  { rank: 21, code: '035420', name: 'NAVER', market: 'KOSPI' },
  { rank: 22, code: '010120', name: 'LS ELECTRIC', market: 'KOSPI' },
  { rank: 23, code: '267260', name: 'HD현대일렉트릭', market: 'KOSPI' },
  { rank: 24, code: '066570', name: 'LG전자', market: 'KOSPI' },
  { rank: 25, code: '000810', name: '삼성화재', market: 'KOSPI' },
  { rank: 26, code: '042660', name: '한화오션', market: 'KOSPI' },
  { rank: 27, code: '009540', name: 'HD한국조선해양', market: 'KOSPI' },
  { rank: 28, code: '298040', name: '효성중공업', market: 'KOSPI' },
  { rank: 29, code: '005490', name: 'POSCO홀딩스', market: 'KOSPI' },
  { rank: 30, code: '015760', name: '한국전력', market: 'KOSPI' },
  { rank: 31, code: '316140', name: '우리금융지주', market: 'KOSPI' },
  { rank: 32, code: '096770', name: 'SK이노베이션', market: 'KOSPI' },
  { rank: 33, code: '006800', name: '미래에셋증권', market: 'KOSPI' },
  { rank: 34, code: '010130', name: '고려아연', market: 'KOSPI' },
  { rank: 35, code: '017670', name: 'SK텔레콤', market: 'KOSPI' },
  { rank: 36, code: '010140', name: '삼성중공업', market: 'KOSPI' },
  { rank: 37, code: '000150', name: '두산', market: 'KOSPI' },
  { rank: 38, code: '042700', name: '한미반도체', market: 'KOSPI' },
  { rank: 39, code: '011200', name: 'HMM', market: 'KOSPI' },
  { rank: 40, code: '051910', name: 'LG화학', market: 'KOSPI' },
  { rank: 41, code: '033780', name: 'KT&G', market: 'KOSPI' },
  { rank: 42, code: '267250', name: 'HD현대', market: 'KOSPI' },
  { rank: 43, code: '064350', name: '현대로템', market: 'KOSPI' },
  { rank: 44, code: '018260', name: '삼성에스디에스', market: 'KOSPI' },
  { rank: 45, code: '010950', name: 'S-Oil', market: 'KOSPI' },
  { rank: 46, code: '024110', name: '기업은행', market: 'KOSPI' },
  { rank: 47, code: '035720', name: '카카오', market: 'KOSPI' },
  { rank: 48, code: '196170', name: '알테오젠', market: 'KOSDAQ' },
  { rank: 49, code: '079550', name: 'LIG디펜스앤에어로스페이스', market: 'KOSPI' },
  { rank: 50, code: '011070', name: 'LG이노텍', market: 'KOSPI' },
];

const ROLL = 250;
const Z_THRESHOLD = -2;
const PCT_THRESHOLD = 10;
const HORIZONS = [5, 10, 20];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, period: 20, tiers: [10, 20, 30, 50], calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--tiers') o.tiers = argv[++i].split(',').map(Number);
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

function summarize(rets) {
  if (!rets.length) return null;
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  return { n: rets.length, avg: mean(rets), med: median(rets), win };
}

async function analyzeStock(stock, period) {
  const WARMUP_DAYS = Math.max(60, period * 3);
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (1100) * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emas = buildEma(closes, period);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emas[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], dev: (closes[i] - emas[i]) / emas[i] * 100 });
  }
  if (seq.length < ROLL + Math.max(...HORIZONS) + 1) return { ...stock, error: '데이터 부족' };

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const win = seq.slice(i - ROLL + 1, i + 1).map(r => r.dev);
    const m = mean(win), sd = stdev(win, m);
    const z = sd ? (seq[i].dev - m) / sd : 0;
    const pct = win.filter(d => d <= seq[i].dev).length / win.length * 100;
    flags[i] = z <= Z_THRESHOLD && pct <= PCT_THRESHOLD;
  }

  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const horizonRets = {};
  for (const h of HORIZONS) {
    const rets = [];
    for (const i of events) {
      if (i + h >= seq.length) continue;
      rets.push((seq[i + h].close - seq[i].close) / seq[i].close * 100);
    }
    horizonRets[h] = rets;
  }

  return { ...stock, events: events.length, horizonRets };
}

async function main() {
  const opts = parseArgs();
  const maxTier = Math.max(...opts.tiers);
  const stocks = opts.stocks.filter(s => s.rank <= maxTier);

  console.error(`[유니버스 백테스트] EMA${opts.period} 고정, 시가총액 상위 ${maxTier}종목 조회 후 TOP[${opts.tiers.join(',')}] 컷오프별 비교 중...`);

  const results = await batchAll(stocks, s => analyzeStock(s, opts.period));

  console.log(`\n━━━ 시가총액 유니버스 크기별 신호(EMA${opts.period}, Z<=${Z_THRESHOLD} & 위치<=${PCT_THRESHOLD}%ile) 비교 ━━━\n`);
  console.log('유니버스'.padEnd(10) + '신호수'.padStart(8) +
    HORIZONS.map(h => `+${h}일(n/평균/승률)`.padStart(22)).join(''));
  console.log('─'.repeat(10 + 8 + 22 * HORIZONS.length));

  for (const tier of opts.tiers) {
    const subset = results.filter(r => r.rank <= tier && !r.error);
    const errCount = results.filter(r => r.rank <= tier && r.error).length;
    let eventCount = 0;
    const pooled = {};
    for (const h of HORIZONS) pooled[h] = [];
    for (const r of subset) {
      eventCount += r.events;
      for (const h of HORIZONS) pooled[h].push(...r.horizonRets[h]);
    }
    let line = `TOP${tier}`.padEnd(10) + `${eventCount}회`.padStart(8);
    for (const h of HORIZONS) {
      const s = summarize(pooled[h]);
      const cell = s ? `${s.n}/${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}%/${s.win.toFixed(0)}%` : '─';
      line += cell.padStart(22);
    }
    console.log(line + (errCount ? `   (오류 ${errCount}종목 제외)` : ''));
  }
  console.log('');
  console.log('※ 표기: n(유효표본) / 평균수익률 / 승률(양수비율)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
