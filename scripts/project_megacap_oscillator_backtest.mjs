// 삼성전자·SK하이닉스 "횡보국면 전용 오실레이터(RSI·볼린저밴드)" 매매전략 3차 feasibility 테스트
// 지지저항(스윙피벗·밀집구간) 2가지 모두 기각된 후 시도하는 대안 — 가격대(레벨) 대신 모멘텀 소진(RSI)·
// 통계적 밴드(볼린저) 방식으로 횡보구간 평균회귀를 재검증. 국면필터는 project_megacap_regime_distribution.mjs와
// 동일 정의(EMA50/200 교차+기울기)를 사용해 SIDE 구간에만 진입 허용.
//
// 진입(모드별): RSI14<=oversold 또는 종가<=볼린저하단(20,2) — 둘 다 전일대비 반등일(종가>전일종가) 조건 동반
// 청산: 목표(볼린저 중심선=SMA20 터치) / SL -8% / 시간청산 --max-hold(기본15거래일)
// 사용법: node scripts/project_megacap_oscillator_backtest.mjs [--mode rsi|bb|both] [--regime side|all] [--rsi-th N] [--sl N] [--max-hold N]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const DEFAULT_STOCKS = [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }];
const SLOPE_LB = 10;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, mode: 'both', regime: 'side', rsiTh: 30, sl: 8, maxHold: 15, calendarDays: 2555, bbPeriod: 20, bbK: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') o.mode = argv[++i];
    if (argv[i] === '--regime') o.regime = argv[++i];
    if (argv[i] === '--rsi-th') o.rsiTh = parseFloat(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--stocks') o.stocks = argv[++i].split(',').map(s => { const [code, name] = s.split(':'); return { code, name: name || code }; });
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
    try { const data = await httpGetJson(url); const result = data?.chart?.result?.[0]; if (!result) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < closes.length; i++) { const p = closes[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
function classifyRegime(ema50, ema200, i) {
  if (ema50[i] == null || ema200[i] == null || i < SLOPE_LB || ema50[i - SLOPE_LB] == null) return null;
  const rising = ema50[i] > ema50[i - SLOPE_LB];
  if (ema50[i] > ema200[i] && rising) return 'up';
  if (ema50[i] < ema200[i] && !rising) return 'down';
  return 'side';
}

// Wilder RSI
function buildRsi(closes, period = 14) {
  const n = closes.length;
  const rsi = new Array(n).fill(null);
  let avgGain = null, avgLoss = null;
  const gains = [], losses = [];
  for (let i = 1; i < n; i++) {
    if (closes[i] == null || closes[i - 1] == null) continue;
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0, loss = diff < 0 ? -diff : 0;
    if (avgGain === null) {
      gains.push(gain); losses.push(loss);
      if (gains.length < period) continue;
      avgGain = gains.reduce((a, b) => a + b, 0) / period;
      avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return rsi;
}

function sma(closes, i, period) {
  if (i < period - 1) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) { if (closes[k] == null) return null; sum += closes[k]; }
  return sum / period;
}
function stdevWindow(closes, i, period, m) {
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += (closes[k] - m) ** 2;
  return Math.sqrt(sum / period);
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }

function simulate(close, i0, entryClose, target, sl, maxHold) {
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= close.length) return null;
    const c = close[j];
    const ret = (c - entryClose) / entryClose * 100;
    if (ret <= -sl) return { ret, reason: 'SL', day: d };
    if (target != null && c >= target) return { ret, reason: 'TARGET', day: d };
    if (d === maxHold) return { ret, reason: 'TIME', day: d };
  }
  return null;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const chart = await fetchYahooChart(`${stock.code}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', trades: [] };

  const dates = chart.ts.map(tsToKstDate);
  const close = fillForward(chart.close);
  const ema50 = buildEma(close, 50), ema200 = buildEma(close, 200);
  const rsi = buildRsi(close, 14);

  const trades = [];
  for (let i = Math.max(200 + SLOPE_LB, opts.bbPeriod); i < close.length - 1; i++) {
    if (close[i] == null || close[i - 1] == null) continue;
    if (opts.regime !== 'all') {
      const regime = classifyRegime(ema50, ema200, i);
      if (regime !== opts.regime) continue;
    }
    const bounceDay = close[i] > close[i - 1];
    if (!bounceDay) continue;

    const midBB = sma(close, i, opts.bbPeriod);
    const sdBB = midBB != null ? stdevWindow(close, i, opts.bbPeriod, midBB) : null;
    const lowerBB = midBB != null && sdBB != null ? midBB - opts.bbK * sdBB : null;

    const rsiOk = rsi[i] != null && rsi[i] <= opts.rsiTh;
    const bbOk = lowerBB != null && close[i] <= lowerBB;

    let fire = false;
    if (opts.mode === 'rsi') fire = rsiOk;
    else if (opts.mode === 'bb') fire = bbOk;
    else if (opts.mode === 'both') fire = rsiOk && bbOk;
    if (!fire) continue;

    const result = simulate(close, i, close[i], midBB, opts.sl, opts.maxHold);
    if (result) trades.push({ date: dates[i], name: stock.name, entry: close[i], rsi: rsi[i], midBB, ...result });
  }
  return { ...stock, trades };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(26)} 데이터 없음`;
  return label.padEnd(26) + String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) + `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[오실레이터 횡보전략] ${opts.stocks.length}종목, mode=${opts.mode}, 국면필터=${opts.regime}, RSI임계=${opts.rsiTh}, SL${opts.sl}%, 시간청산${opts.maxHold}일, BB(${opts.bbPeriod},${opts.bbK})`);
  const results = [];
  for (const s of opts.stocks) {
    const r = await backtestStock(s, opts);
    if (r.error) { console.error(`[실패] ${r.name}: ${r.error}`); continue; }
    results.push(r);
    await new Promise(res => setTimeout(res, 300));
  }
  const allTrades = results.flatMap(r => r.trades);
  console.log(`\n════════ 오실레이터(RSI·볼린저) 횡보전략 — 3차 feasibility 결과 ════════`);
  console.log(`진입: mode=${opts.mode}(RSI<=${opts.rsiTh} / 볼린저하단터치) AND 반등일 / 청산: SMA20 터치(TARGET) or SL-${opts.sl}% or 시간${opts.maxHold}일\n`);
  console.log('전략'.padEnd(26) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(69));
  console.log(fmtRow('전체(2종목 합산)', summarize(allTrades)));
  for (const r of results) console.log(fmtRow(r.name, summarize(r.trades)));
  const reasons = {};
  for (const t of allTrades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  console.log('\n청산 사유 분포:', JSON.stringify(reasons));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
