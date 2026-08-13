// 이동평균선 "기간" 파라미터화 백테스트 — 어떤 EMA 기간이 괴리율 과매도 신호에 가장 적합한지 비교 — 스킬: stock-deviation
// 사용법: node scripts/project_deviation_period_backtest.mjs [--stocks 코드:이름,...] [--periods 10,20,60,120] [--calendar-days N]
// 기본 대상: 시가총액 TOP20, 기본 비교 기간: 10/20/60/120일 EMA (2026-07-25: 20일이 최적으로 확정되어 25일은 비교대상에서 제외)
// 신호 정의: 각 기간별 EMA 기준 괴리율의 롤링 250거래일 Z<=-2 & 위치<=10%ile (해당 시점까지 데이터만 사용)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP20 (2026-07-25 기준)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '032830', name: '삼성생명' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '105560', name: 'KB금융' },
  { code: '000270', name: '기아' },
  { code: '028260', name: '삼성물산' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '012330', name: '현대모비스' },
  { code: '034730', name: 'SK' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '068270', name: '셀트리온' },
  { code: '006400', name: '삼성SDI' },
  { code: '086790', name: '하나금융지주' },
];

const ROLL = 250;
const Z_THRESHOLD = -2;
const PCT_THRESHOLD = 10;
const HORIZONS = [5, 10, 20];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, periods: [10, 20, 60, 120], calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--periods') o.periods = argv[++i].split(',').map(Number);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => {
        const [code, name] = s.split(':');
        return { code, name: name || code };
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

async function batchAll(items, fn, concurrency = 4, delay = 150) {
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

// closes 하나로 여러 period에 대한 이벤트·수익률을 동시에 계산 (네트워크 호출은 1회)
function analyzeAllPeriods(dates, closes, periods) {
  const perPeriod = {};
  for (const period of periods) {
    const emas = buildEma(closes, period);
    const seq = [];
    for (let i = 0; i < dates.length; i++) {
      if (closes[i] == null || emas[i] == null) continue;
      seq.push({ date: dates[i], close: closes[i], dev: (closes[i] - emas[i]) / emas[i] * 100 });
    }
    if (seq.length < ROLL + Math.max(...HORIZONS) + 1) { perPeriod[period] = { error: '데이터 부족' }; continue; }

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
    perPeriod[period] = { events: events.length, horizonRets };
  }
  return perPeriod;
}

function summarize(rets) {
  if (!rets.length) return null;
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  return { n: rets.length, avg: mean(rets), med: median(rets), win };
}

async function main() {
  const opts = parseArgs();
  console.error(`[기간 백테스트] ${opts.stocks.length}개 종목 × EMA기간 [${opts.periods.join(',')}] 비교 중...`);

  const chartsByStock = await batchAll(opts.stocks, async (s) => {
    const p2 = Math.floor(Date.now() / 1000);
    const p1 = p2 - opts.calendarDays * 24 * 3600;
    const chart = await fetchYahooChart(`${s.code}.KS`, p1, p2);
    if (!chart || !chart.ts.length) return { ...s, error: '데이터 조회 실패' };
    return { ...s, dates: chart.ts.map(tsToKstDate), closes: chart.close };
  });

  // period -> pooled horizon -> 배열
  const pooled = {};
  for (const period of opts.periods) {
    pooled[period] = {};
    for (const h of HORIZONS) pooled[period][h] = [];
  }
  const eventCountByPeriod = {};
  for (const period of opts.periods) eventCountByPeriod[period] = 0;

  for (const st of chartsByStock) {
    if (st.error) { console.error(`[${st.name}] ${st.error}`); continue; }
    const perPeriod = analyzeAllPeriods(st.dates, st.closes, opts.periods);
    for (const period of opts.periods) {
      const r = perPeriod[period];
      if (r.error) continue;
      eventCountByPeriod[period] += r.events;
      for (const h of HORIZONS) pooled[period][h].push(...r.horizonRets[h]);
    }
  }

  console.log(`\n━━━ EMA 기간별 신호(Z<=${Z_THRESHOLD} & 위치<=${PCT_THRESHOLD}%ile) 후 수익률 비교 (${opts.stocks.length}종목 통합) ━━━`);
  console.log(`롤링 통계창: ${ROLL}거래일 / 대상: ${opts.stocks.map(s => s.name).join(', ')}\n`);

  console.log('EMA기간'.padEnd(9) + '신호수'.padStart(8) +
    HORIZONS.map(h => `+${h}일(n/평균/승률)`.padStart(22)).join(''));
  console.log('─'.repeat(9 + 8 + 22 * HORIZONS.length));

  for (const period of opts.periods) {
    let line = `${period}일`.padEnd(9) + `${eventCountByPeriod[period]}회`.padStart(8);
    for (const h of HORIZONS) {
      const s = summarize(pooled[period][h]);
      const cell = s ? `${s.n}/${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}%/${s.win.toFixed(0)}%` : '─';
      line += cell.padStart(22);
    }
    console.log(line);
  }
  console.log('');
  console.log('※ 표기: n(유효표본) / 평균수익률 / 승률(양수비율)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
