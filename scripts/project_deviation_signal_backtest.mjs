// EMA 괴리율 Z-score/percentile 신호 백테스트 — 스킬: stock-deviation
// 사용법: node scripts/project_deviation_signal_backtest.mjs [--stocks 코드:이름,...] [--period N] [--calendar-days N]
// 신호 정의: 과거 250거래일(롤링) 기준 Z<=-2 AND 위치<=10%ile (당일까지 데이터만 사용, 미래참조 없음)
// 신호 "발생일"(직전일 미신호→당일 신호 전환) 기준으로 이후 5/10/20거래일 수익률 집계 + 날짜별 정리
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP20 (2026-07-25 기준) — 확정 유니버스
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

const ROLL = 250;               // 롤링 통계 창(거래일)
const Z_THRESHOLD = -2;
const PCT_THRESHOLD = 10;
const HORIZONS = [5, 10, 20];   // 신호 발생 이후 N거래일 수익률

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, calendarDays: 1100, period: 20 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
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

async function backtestStock(stock, calendarDays, period) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emas = buildEma(closes, period);

  // 유효 거래일(종가·EMA 모두 존재)만 압축
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emas[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], dev: (closes[i] - emas[i]) / emas[i] * 100 });
  }
  if (seq.length < ROLL + Math.max(...HORIZONS) + 1) return { ...stock, error: '데이터 기간 부족' };

  // 롤링 Z-score / percentile (해당 시점까지의 데이터만 사용 — 미래참조 없음)
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const win = seq.slice(i - ROLL + 1, i + 1).map(r => r.dev);
    const m = mean(win), sd = stdev(win, m);
    const z = sd ? (seq[i].dev - m) / sd : 0;
    const pct = win.filter(d => d <= seq[i].dev).length / win.length * 100;
    flags[i] = z <= Z_THRESHOLD && pct <= PCT_THRESHOLD;
  }

  // 신호 "발생일"만 추출 (직전일 미신호 → 당일 신호)
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const horizonStats = {};
  for (const h of HORIZONS) {
    const rets = [];
    for (const i of events) {
      if (i + h >= seq.length) continue; // 미래 데이터 부족 → 제외
      rets.push((seq[i + h].close - seq[i].close) / seq[i].close * 100);
    }
    horizonStats[h] = rets;
  }

  const today = seq[seq.length - 1];
  const eventsToToday = events.map(i => ({
    date: seq[i].date,
    close: seq[i].close,
    retToToday: (today.close - seq[i].close) / seq[i].close * 100,
    daysHeld: seq.length - 1 - i, // 보유 거래일수(신호일 다음날 매수 가정 아님, 신호일 종가 매수 기준)
  }));

  return {
    ...stock,
    period: { start: seq[ROLL - 1].date, end: seq[seq.length - 1].date },
    eventDates: events.map(i => seq[i].date),
    horizonStats,
    todayDate: today.date,
    todayClose: today.close,
    eventsToToday,
  };
}

function summarize(rets) {
  if (!rets.length) return null;
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets) };
}

async function main() {
  const opts = parseArgs();
  console.error(`[백테스트] ${opts.stocks.length}개 종목 × EMA${opts.period} 롤링${ROLL}일 Z<=${Z_THRESHOLD} & 위치<=${PCT_THRESHOLD}%ile 신호 탐색 중...`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts.calendarDays, opts.period));

  // ── 날짜별 정리 (어느 날 어떤 종목이 신호에 왔는지 + 그 날 종가 매수 시 오늘까지 수익률) ──
  const byDate = new Map(); // date -> [{name, ret, daysHeld}, ...]
  const allRets = [];
  for (const r of results) {
    if (r.error) continue;
    for (const e of r.eventsToToday) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push({ name: r.name, ret: e.retToToday, daysHeld: e.daysHeld });
      allRets.push(e.retToToday);
    }
  }
  const sortedDatesDesc = [...byDate.keys()].sort().reverse();

  console.log(`\n━━━ EMA${opts.period} 괴리율 신호 — 날짜별 정리 + 그 날 종가 매수 시 오늘(${results.find(r=>!r.error)?.todayDate})까지 수익률 ━━━`);
  console.log(`(롤링 ${ROLL}거래일 기준 신호 탐지, 미래참조 없음 — 수익률은 신호일 종가 → 오늘 종가 기준, 매수 후 계속 보유 가정)\n`);
  for (const d of sortedDatesDesc) {
    const items = byDate.get(d);
    const line = items.map(e => `${e.name} ${e.ret >= 0 ? '+' : ''}${e.ret.toFixed(1)}%(${e.daysHeld}일보유)`).join(', ');
    console.log(`${d}  ${line}`);
  }
  const s = summarize(allRets);
  console.log(`\n총 ${sortedDatesDesc.length}개 날짜, ${allRets.length}건`);
  if (s) console.log(`전체 보유수익률: 평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%`);
  console.log('※ 주의: 최근 신호(예: 오늘)는 보유기간이 0일에 가까워 수익률이 0% 근처로 나오는 게 당연함 — 오래된 신호와 단순 평균 비교 시 왜곡 가능\n');

  console.log(`━━━ EMA${opts.period} 괴리율 신호 발생 후 수익률 백테스트 (종목별) ━━━\n`);

  const pooled = {};
  for (const h of HORIZONS) pooled[h] = [];

  for (const r of results) {
    if (r.error) { console.log(`[${r.name}] ${r.error}\n`); continue; }
    console.log(`[${r.name}] 분석기간: ${r.period.start} ~ ${r.period.end}  신호발생 ${r.eventDates.length}회`);
    if (r.eventDates.length) console.log(`  발생일: ${r.eventDates.join(', ')}`);
    for (const h of HORIZONS) {
      const rets = r.horizonStats[h];
      pooled[h].push(...rets);
      const s = summarize(rets);
      if (!s) { console.log(`  +${h}거래일: 유효 표본 없음`); continue; }
      console.log(`  +${h}거래일: n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%`);
    }
    console.log('');
  }

  console.log(`━━━ ${opts.stocks.length}종목 전체 통합(pooled) ━━━`);
  for (const h of HORIZONS) {
    const s = summarize(pooled[h]);
    if (!s) { console.log(`+${h}거래일: 유효 표본 없음`); continue; }
    console.log(`+${h}거래일: n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
