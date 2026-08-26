// 괴리율 확정 진입로직(project_deviation_tp20_exit_backtest.mjs)은 그대로 두고, 청산 파라미터(SL/TP%/최대보유일)만
// 재탐색하는 그리드서치. 코스피 유니버스는 DEFAULT_STOCKS(TOP50, 49종목)로 고정. 진입시그널 1회만 로드해 재사용.
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' }, { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' }, { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' }, { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '006400', name: '삼성SDI' },
  { code: '000810', name: '삼성화재' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' }, { code: '005490', name: 'POSCO홀딩스' },
  { code: '267260', name: 'HD현대일렉트릭' }, { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' }, { code: '042700', name: '한미반도체' },
  { code: '011200', name: 'HMM' }, { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' }, { code: '010140', name: '삼성중공업' },
  { code: '051910', name: 'LG화학' }, { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '024110', name: '기업은행' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' }, { code: '086280', name: '현대글로비스' },
  { code: '010950', name: 'S-Oil' },
];

const ROLL = 250, Z_THRESHOLD = -2, ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5, SLOW_PERIOD = 20, TREND_MID_PERIOD = 50, TREND_LONG_PERIOD = 200;
const CALENDAR_DAYS = 2555;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
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
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i]; if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else { ema = price * k + ema * (1 - k); }
    emas[i] = ema;
  }
  return emas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
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

// 진입 이벤트 + seq만 캐시(청산과 무관)
async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, events: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD), ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD), ema200s = buildEma(closes, TREND_LONG_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100 });
  }
  if (seq.length < ROLL + 30 + 1) return { ...stock, seq: null, events: [] };
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5'), z20 = rollingZPct(seq, i, 'dev20');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const sig20 = z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    flags[i] = sig5 && sig20 && downTrend;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) { if (flags[i] && !flags[i - 1]) events.push(i); }
  return { ...stock, seq, events };
}

function simulateTrade(seq, i0, sl, tp, maxHold) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0, stage = 'INIT';
  const legs = [];
  let finalDay = null, finalDate = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close, ema20 = seq[j].ema20, ema5 = seq[j].ema5;
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) { legs.push({ weight: openWeight, ret }); openWeight = 0; finalDay = d; finalDate = seq[j].date; break; }
    if (stage === 'INIT' && ret >= tp) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; stage = 'TP20_DONE'; }
    if (stage === 'TP20_DONE' && close >= ema20) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; stage = 'HOLD'; }
    if (stage === 'HOLD' && close < ema5) { legs.push({ weight: openWeight, ret }); openWeight = 0; finalDay = d; finalDate = seq[j].date; break; }
    if (d === maxHold && openWeight > 1e-9) { legs.push({ weight: openWeight, ret }); openWeight = 0; finalDay = d; finalDate = seq[j].date; }
  }
  if (openWeight > 1e-9) return null;
  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  return { weightedRet, day: finalDay, date: finalDate };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets, mean(rets));
  const avgDays = mean(trades.map(t => t.day));
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, sd, sharpe: sd > 0 ? avg / sd : 0, avgDays, perDay: avg / avgDays };
}

function runCombo(loaded, sl, tp, maxHold) {
  const trades = [];
  for (const r of loaded) {
    if (!r.seq || !r.events.length) continue;
    for (const i0 of r.events) { const t = simulateTrade(r.seq, i0, sl, tp, maxHold); if (t) trades.push(t); }
  }
  trades.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return trades;
}

async function main() {
  console.error(`[괴리율 청산 그리드서치] ${DEFAULT_STOCKS.length}종목(TOP50 확정 유니버스 동일), 진입로직 그대로 고정`);
  const loaded = await batchAll(DEFAULT_STOCKS, loadStock);
  const totalEvents = loaded.reduce((a, r) => a + (r.events?.length || 0), 0);
  console.error(`[진입이벤트 추출 완료] 총 ${totalEvents}건`);

  const SL_GRID = [8, 10, 12, 13, 14, 15, 16, 17, 18, 20];
  const TP_GRID = [12, 15, 18, 20, 25, 30];
  const MAXHOLD_GRID = [15, 20, 25, 30];

  const results = [];
  for (const sl of SL_GRID) for (const tp of TP_GRID) for (const maxHold of MAXHOLD_GRID) {
    const trades = runCombo(loaded, sl, tp, maxHold);
    if (trades.length < 100) continue;
    const splitIdx = Math.floor(trades.length * 0.6);
    const splitDate = trades[splitIdx]?.date;
    const isT = trades.filter(t => t.date <= splitDate);
    const oosT = trades.filter(t => t.date > splitDate);
    const all = summarize(trades), isS = summarize(isT), oosS = summarize(oosT);
    if (!all || !isS || !oosS) continue;
    results.push({ sl, tp, maxHold, all, isS, oosS });
  }
  console.error(`[그리드서치 완료] ${results.length}개 조합 평가`);

  for (const r of results) {
    const degrade = r.isS.sharpe > 0 ? (r.isS.sharpe - r.oosS.sharpe) / r.isS.sharpe : 0;
    r.robustScore = r.oosS.sharpe - Math.max(0, degrade) * 0.3;
  }
  // perDay 순 — 5슬롯 공유자본 포트폴리오는 슬롯 회전율이 핵심(2026-08-26 라운드넘버 재검증에서 확인)
  results.sort((a, b) => b.all.perDay - a.all.perDay);

  console.log('\n════════ 괴리율 청산 그리드서치 결과 (perDay 순) — 상위 20 ════════\n');
  console.log('SL  TP  maxHold'.padEnd(20) + 'n'.padStart(6) + '가중평균'.padStart(10) + '평균보유'.padStart(9) + 'perDay'.padStart(9) + '전체Sharpe'.padStart(11) + 'IS_Sharpe'.padStart(11) + 'OOS_Sharpe'.padStart(11));
  console.log('─'.repeat(97));
  for (const r of results.slice(0, 20)) {
    console.log(
      `${String(r.sl).padStart(2)}  ${String(r.tp).padStart(2)}  ${String(r.maxHold).padStart(2)}`.padEnd(20) +
      String(r.all.n).padStart(6) +
      `${r.all.avg >= 0 ? '+' : ''}${r.all.avg.toFixed(2)}%`.padStart(10) +
      `${r.all.avgDays.toFixed(1)}일`.padStart(9) +
      `${r.all.perDay.toFixed(3)}%`.padStart(9) +
      r.all.sharpe.toFixed(3).padStart(11) + r.isS.sharpe.toFixed(3).padStart(11) + r.oosS.sharpe.toFixed(3).padStart(11)
    );
  }
  const cur = results.find(r => r.sl === 12 && r.tp === 20 && r.maxHold === 20);
  console.log('\n════════ 현재 확정값(SL12/TP20/maxHold20) 그리드 내 위치(perDay 순위) ════════\n');
  if (cur) console.log(`n=${cur.all.n} avg=${cur.all.avg.toFixed(2)}% 평균보유${cur.all.avgDays.toFixed(1)}일 perDay=${cur.all.perDay.toFixed(3)}% 전체Sharpe=${cur.all.sharpe.toFixed(3)} IS=${cur.isS.sharpe.toFixed(3)} OOS=${cur.oosS.sharpe.toFixed(3)} → 전체 ${results.length}개 중 순위 ${results.findIndex(r => r === cur) + 1}위`);
  else console.log('현재 확정값 조합이 그리드에 없음');

  console.log('\n════════ 후보 비교(maxHold20 고정, SL·TP 조합) ════════\n');
  for (const sl of [12, 15, 16, 18]) for (const tp of [15, 18, 20]) {
    const r = results.find(x => x.sl === sl && x.tp === tp && x.maxHold === 20);
    if (r) console.log(`SL${sl}/TP${tp}: n=${r.all.n} avg=${r.all.avg.toFixed(2)}% 평균보유${r.all.avgDays.toFixed(1)}일 perDay=${r.all.perDay.toFixed(3)}% Sharpe=${r.all.sharpe.toFixed(3)} IS=${r.isS.sharpe.toFixed(3)} OOS=${r.oosS.sharpe.toFixed(3)}`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
