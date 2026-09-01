// 장대양봉 돌파추격형 매매전략 백테스트 (2026-09-01)
// 배경: project_bigcandle_retest_backtest.mjs(중간값 되돌림, 평균회귀 성격)의 perDay가 낮고 신호빈도가
// 과도해(3전략 통합 포트폴리오에 편입 시 슬롯 잠식 우려) 반대 철학의 대안으로 검증 요청받음.
// 진입 철학을 "눌림 대기" 대신 "재돌파 확인"으로 교체 — 장대양봉 이후 그 캔들 고가를 종가기준으로
// 재돌파(더 강하게 뻗음)하면 추격매수. 장중 돌파가 아니라 종가 확정 기준(휩소 배제, 데이터 정확도,
// 기존 3전략과의 방법론 일관성 — 사용자와 상의 후 결정).
//
// 진입: ①장대양봉 탐지(몸통 4%↑) → ②이후 retestWindow(20거래일) 이내 첫 종가>=캔들고가인 날 그 종가에 매수
//   단, 그 사이 종가가 캔들 저가 아래로 무너지면(붕괴) 셋업 폐기 → ③상승국면필터(진입시 종가>=EMA200)
// 청산: TP=진입가+캔들실체범위(고가-저가, 측정이동/measured move 투영) / STOP=캔들저가×(1-stopBufferPct%) / TIME=maxHold거래일
//
// 되돌림형(기존 project_bigcandle_retest_backtest.mjs)과 동일 이벤트셋·동일 기간으로 나란히 비교 출력.
// 사용법: node scripts/project_bigcandle_breakout_backtest.mjs [--body-pct 4] [--breakout-window 20]
//   [--stop-buffer-pct 0.5] [--max-hold 15] [--no-require-uptrend]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    stocks: DEFAULT_STOCKS, calendarDays: 2555,
    bodyPct: 4, breakoutWindow: 20, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--body-pct') o.bodyPct = parseFloat(argv[++i]);
    if (argv[i] === '--breakout-window') o.breakoutWindow = parseInt(argv[++i]);
    if (argv[i] === '--stop-buffer-pct') o.stopBufferPct = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--require-uptrend') o.requireUptrend = true;
    if (argv[i] === '--no-require-uptrend') o.requireUptrend = false;
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
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
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

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
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

// 돌파추격형: 캔들고가 종가재돌파 진입 + 측정이동 TP / 캔들저가 STOP / TIME 청산
function detectAndSimulateBreakout(seq, opts) {
  const n = seq.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;

    const candleLow = l, candleHigh = h;
    const range = candleHigh - candleLow;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let entryIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.breakoutWindow); f++) {
      if (seq[f].close < candleLow) break; // 캔들 저가 붕괴 — 셋업 폐기
      if (seq[f].close >= candleHigh) { entryIdx = f; break; } // 종가기준 재돌파
    }
    if (entryIdx == null) continue;

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    const entry = seq[entryIdx].close;
    const target = entry + range;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - entry) / entry * 100, day: d, reason: 'STOP', date: seq[j].date }; break; }
      if (close >= target) { result = { ret: (close - entry) / entry * 100, day: d, reason: 'TP', date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { ret: (close - entry) / entry * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, candleDate: seq[i].date, entryDate: seq[entryIdx].date, bodyPct, entry, uptrend, ...result });
  }
  return trades;
}

// 되돌림형(기존, 비교용): project_bigcandle_retest_backtest.mjs와 동일 로직
function detectAndSimulateRetest(seq, opts) {
  const n = seq.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let entryIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.breakoutWindow); f++) {
      if (seq[f].close < candleLow) break;
      if (seq[f].low <= mid) { entryIdx = f; break; }
    }
    if (entryIdx == null) continue;

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'STOP', date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TP', date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, candleDate: seq[i].date, entryDate: seq[entryIdx].date, bodyPct, entry: mid, uptrend, ...result });
  }
  return trades;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || chart.open[i] == null) continue;
    seq.push({
      date: dates[i], open: chart.open[i], close: closes[i],
      high: chart.high[i] ?? closes[i], low: chart.low[i] ?? closes[i],
      ema200: ema200s[i] ?? null, name: stock.name,
    });
  }
  const minLen = BASE_PERIOD + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const breakoutTrades = detectAndSimulateBreakout(seq, opts);
  const retestTrades = detectAndSimulateRetest(seq, opts);
  return { ...stock, breakoutTrades, retestTrades };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, perDay: avg / avgDays, reasonCount };
}

function printSummary(label, s) {
  if (!s) { console.log(`\n[${label}] 유효 표본 없음`); return; }
  console.log(`\n[${label}]`);
  console.log(`n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균보유 ${s.avgDays.toFixed(1)}거래일  perDay ${s.perDay >= 0 ? '+' : ''}${s.perDay.toFixed(3)}%`);
  const parts = Object.entries(s.reasonCount).map(([r, c]) => `${r} ${c}건(${(c / s.n * 100).toFixed(0)}%)`);
  console.log(`청산사유: ${parts.join(' / ')}`);
}

async function main() {
  const opts = parseArgs();
  console.error(`[장대양봉 돌파추격형 vs 되돌림형 비교] ${opts.stocks.length}종목, 몸통 ${opts.bodyPct}%↑, 재돌파/되돌림 대기 ${opts.breakoutWindow}거래일, STOP캔들저가×${(100 - opts.stopBufferPct).toFixed(1)}%, 최대보유${opts.maxHold}거래일, 상승국면필터=${opts.requireUptrend}`);
  console.error(`돌파추격형 TP=진입가+캔들범위(측정이동) / 되돌림형 TP=캔들고가 (동일 이벤트셋·기간)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const breakoutAll = [], retestAll = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    breakoutAll.push(...r.breakoutTrades);
    retestAll.push(...r.retestTrades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  printSummary('되돌림형(기존, 중간값 매수)', summarize(retestAll));
  printSummary('돌파추격형(신규, 캔들고가 종가재돌파 매수)', summarize(breakoutAll));

  // 국면별(상승/그외) 분리
  const bUp = breakoutAll.filter(t => t.uptrend === true);
  console.log(`\n[돌파추격형 상승국면 필터 적용 후(이미 requireUptrend 반영됨) 참고: 전체건 중 상승국면 비중] ${bUp.length}/${breakoutAll.length}`);

  // 종목별 상위 15 (돌파추격형)
  const byStock = {};
  for (const t of breakoutAll) {
    if (!byStock[t.name]) byStock[t.name] = [];
    byStock[t.name].push(t);
  }
  const stockRows = Object.entries(byStock).map(([name, ts]) => ({ name, ...summarize(ts) })).sort((a, b) => b.n - a.n);
  console.log(`\n━━━ 돌파추격형 종목별 신호수(상위 15) ━━━`);
  for (const row of stockRows.slice(0, 15)) {
    console.log(`  ${row.name.padEnd(12)} n=${row.n}건  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%  perDay ${row.perDay >= 0 ? '+' : ''}${row.perDay.toFixed(3)}%`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
