// 삼성전자·SK하이닉스 "가격 밀집구간(터치빈도 히스토그램)" 지지·저항 전략 2차 feasibility 테스트
// 스윙피벗(1차, project_megacap_support_resistance_backtest.mjs)과 별개 실험 — 정의 방식만 교체, 청산규칙은 동일하게 유지해 비교 가능하게 함
//
// 지지/저항 정의: 매일 직전 LOOKBACK거래일 종가 범위를 nBins개 구간으로 나눠 각 구간에 종가가 몇 번
// 들어왔는지(터치횟수) 집계 → 터치횟수>=minTouches인 구간만 "밀집구간(유효 지지/저항 후보)"로 인정.
// 현재가 바로 아래의 밀집구간을 지지, 바로 위를 저항으로 사용(둘 다 롤링 윈도우로 매일 재계산).
//
// 진입: 지지 밀집구간에 ATR%×band 이내 근접 + 반등일(종가>전일종가)
// 청산: 지지붕괴(종가<진입시점 지지가) / SL -12%(백업) / 트레일 -8% / 저항 터치 시 50%익절 / 시간청산 40거래일
// 사용법: node scripts/project_megacap_density_sr_backtest.mjs [--stocks 코드:이름,...] [--lookback N] [--bins N] [--min-touches N] [--band K]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
];

const ATR_PERIOD = 14;
const SL = 12, TRAIL = 8, TIME_EXIT = 40, TP_FRAC = 0.5;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, lookback: 250, bins: 40, minTouches: 3, band: 0.5, calendarDays: 1100, regime: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lookback') o.lookback = parseInt(argv[++i]);
    if (argv[i] === '--bins') o.bins = parseInt(argv[++i]);
    if (argv[i] === '--min-touches') o.minTouches = parseInt(argv[++i]);
    if (argv[i] === '--band') o.band = parseFloat(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--regime') o.regime = argv[++i]; // all|up|down|side — EMA50/200 교차+기울기 기준(project_megacap_regime_distribution.mjs와 동일 정의)
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => { const [code, name] = s.split(':'); return { code, name: name || code }; });
    }
  }
  return o;
}

const SLOPE_LB = 10;
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

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); }
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
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function fillForward(arr) {
  const out = arr.slice(); let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
}

function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i];
    if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}

// 직전 lookback 거래일 종가로 밀집구간(터치빈도 히스토그램) 계산 — 현재가 기준 바로 아래(지지)/위(저항) 유효구간 반환
function densityLevels(close, i, lookback, nBins, minTouches) {
  const start = Math.max(0, i - lookback);
  const win = close.slice(start, i).filter(v => v != null);
  if (win.length < lookback * 0.5) return null;
  const lo = Math.min(...win), hi = Math.max(...win);
  if (hi <= lo) return null;
  const binW = (hi - lo) / nBins;
  const counts = new Array(nBins).fill(0);
  for (const v of win) {
    let b = Math.floor((v - lo) / binW);
    if (b >= nBins) b = nBins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const centers = counts.map((cnt, b) => ({ price: lo + binW * (b + 0.5), touches: cnt })).filter(z => z.touches >= minTouches);
  const cur = close[i];
  const below = centers.filter(z => z.price < cur);
  const above = centers.filter(z => z.price > cur);
  const support = below.length ? below.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const resistance = above.length ? above.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  return { support, resistance };
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }

function simulateSRTrade(close, i0, entryClose, supportAtEntry, resistanceAtEntry, sl, trail, tpFrac, maxHold) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= close.length) return null;
    const c = close[j];
    const ret = (c - entryClose) / entryClose * 100;

    if (!tpTaken && resistanceAtEntry != null && c >= resistanceAtEntry) {
      tpTaken = true; tpReturn = ret;
      if (c > peak) peak = c;
      continue;
    }

    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { ret: blended, reason, day: d, tpTaken };
    };

    if (c < supportAtEntry) return finish('SUPPORT_BREAK');
    if (ret <= -sl) return finish('SL');
    if (c > peak) peak = c;
    const trailRet = (c - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', trades: [] };

  const dates = chart.ts.map(tsToKstDate);
  const close = fillForward(chart.close);
  const high = fillForward(chart.high);
  const low = fillForward(chart.low);
  const atr = buildAtr(high, low, close, ATR_PERIOD);
  const ema50 = buildEma(close, 50), ema200 = buildEma(close, 200);

  const trades = [];
  for (let i = opts.lookback; i < close.length; i++) {
    if (close[i] == null || atr[i] == null || atr[i] <= 0 || close[i - 1] == null) continue;
    if (opts.regime !== 'all') {
      const regime = classifyRegime(ema50, ema200, i);
      if (regime !== opts.regime) continue;
    }
    const atrPct = atr[i] / close[i] * 100;
    const lv = densityLevels(close, i, opts.lookback, opts.bins, opts.minTouches);
    if (!lv || !lv.support) continue;
    const support = lv.support.price;
    const proximity = (close[i] - support) / support * 100;
    if (proximity < 0 || proximity > atrPct * opts.band) continue;
    const bounceDay = close[i] > close[i - 1];
    if (!bounceDay) continue;

    const resistance = lv.resistance ? lv.resistance.price : null;
    const result = simulateSRTrade(close, i, close[i], support, resistance, SL, TRAIL, TP_FRAC, opts.maxHold ?? TIME_EXIT);
    if (result) trades.push({ date: dates[i], name: stock.name, entry: close[i], support, resistance, supportTouches: lv.support.touches, ...result });
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
  console.error(`[가격밀집구간 S/R 백테스트] ${opts.stocks.length}종목, lookback=${opts.lookback}일, bins=${opts.bins}, 최소터치=${opts.minTouches}, 근접밴드=ATR%×${opts.band}, 국면필터=${opts.regime}, SL${SL}%/TRAIL${TRAIL}%/시간청산${TIME_EXIT}일`);

  const results = [];
  for (const s of opts.stocks) {
    const r = await backtestStock(s, opts);
    if (r.error) { console.error(`[실패] ${r.name}: ${r.error}`); continue; }
    results.push(r);
    await new Promise(res => setTimeout(res, 300));
  }

  const allTrades = results.flatMap(r => r.trades);
  console.log(`\n════════ 가격 밀집구간(터치빈도) S/R 전략 — 2차 feasibility 결과 ════════`);
  console.log(`진입: 밀집구간(직전${opts.lookback}일 ${opts.bins}구간 중 터치≥${opts.minTouches}회) ATR%×${opts.band} 이내 근접+반등일 / 청산: 지지붕괴·SL${SL}%·TRAIL${TRAIL}%·저항터치50%익절·시간${TIME_EXIT}일\n`);
  console.log('전략'.padEnd(26) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(69));
  console.log(fmtRow('전체(2종목 합산)', summarize(allTrades)));
  for (const r of results) console.log(fmtRow(r.name, summarize(r.trades)));

  const reasons = {};
  for (const t of allTrades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  console.log('\n청산 사유 분포:', JSON.stringify(reasons));
  const tpCount = allTrades.filter(t => t.tpTaken).length;
  if (allTrades.length) console.log(`저항선 터치(부분익절 발동) 비율: ${tpCount}/${allTrades.length} (${(tpCount / allTrades.length * 100).toFixed(0)}%)`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
