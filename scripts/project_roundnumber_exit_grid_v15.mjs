// 라운드넘버 확정 진입로직은 그대로 두고, 청산 파라미터(stopBufferPct)만 재확인하는 그리드서치.
// 2026-08-21 35조합 스윕에서 이미 2%가 변곡점으로 확정됐으나, 유니버스가 코스피 전용(2026-08-24)으로
// 바뀐 뒤 재검증된 적 없어 사용자 요청("진입/청산 트리거 재튜닝")에 따라 확인차 재실행.
// maxHold=60은 TP/STOP이 평균보유 2.8일 내 거의 항상 먼저 발생해(TIME청산 0건 확인됨) 튜닝 대상에서 제외.
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const WINDOW_DAYS = 150, TARGET_TICKS = 30, MIN_TOUCHES = 3, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5, RECLAIM_WINDOW = 5;
const MIN_ENTRY_POSITION_PCT = 20, MIN_BAND_WIDTH_PCT = 2.5, MAX_HOLD = 60, CALENDAR_DAYS = 2555;

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
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [], high: result.indicators?.quote?.[0]?.high || [], low: result.indicators?.quote?.[0]?.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) { const dist = Math.abs(Math.log(norm) - Math.log(f)); if (dist < bestDist) { bestDist = dist; best = f; } }
  return best * mag;
}
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) { if (highs[k] > hi) hi = highs[k]; if (lows[k] < low) low = lows[k]; }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) { if (lows[k] <= level && level <= highs[k]) count++; }
  return count;
}
function detectRoundSignals(seq, highs, lows) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, WINDOW_DAYS, TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, i - 1 - RECENT_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (touch < MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RECLAIM_WINDOW); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= MIN_ENTRY_POSITION_PCT) events.push({ entryIdx: f, level: L, step });
        }
        break;
      }
    }
  }
  return events;
}
function simulateRoundTrade(seq, ev, stopBufferPct, maxHold) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - stopBufferPct / 100);
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    if (close <= stop) return { ret: (close - entry) / entry * 100, day: d, date: seq[j].date };
    if (close >= target) return { ret: (close - entry) / entry * 100, day: d, date: seq[j].date };
    if (d === maxHold) return { ret: (close - entry) / entry * 100, day: d, date: seq[j].date };
  }
  return null;
}
async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, events: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
  }
  const minLen = WINDOW_DAYS + RECENT_LOOKBACK + MAX_HOLD + 10;
  if (seq.length < minLen) return { ...stock, seq: null, events: [] };
  const events = detectRoundSignals(seq, highs, lows);
  return { ...stock, seq, events };
}
function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  const avgDays = mean(trades.map(t => t.day));
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, sd, sharpe: sd > 0 ? avg / sd : 0, avgDays, perDay: avg / avgDays };
}
function runCombo(loaded, stopBufferPct, maxHold) {
  const trades = [];
  for (const r of loaded) {
    if (!r.seq || !r.events.length) continue;
    for (const ev of r.events) { const t = simulateRoundTrade(r.seq, ev, stopBufferPct, maxHold); if (t) trades.push(t); }
  }
  trades.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return trades;
}

async function main() {
  console.error(`[라운드넘버 청산 그리드서치] ${DEFAULT_STOCKS.length}종목(TOP50 확정 유니버스 동일), 진입로직 그대로 고정`);
  const loaded = await batchAll(DEFAULT_STOCKS, loadStock);
  const totalEvents = loaded.reduce((a, r) => a + (r.events?.length || 0), 0);
  console.error(`[진입이벤트 추출 완료] 총 ${totalEvents}건`);

  const STOP_GRID = [1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5];
  const results = [];
  for (const stopBufferPct of STOP_GRID) {
    const trades = runCombo(loaded, stopBufferPct, MAX_HOLD);
    if (trades.length < 100) continue;
    const splitIdx = Math.floor(trades.length * 0.6);
    const splitDate = trades[splitIdx]?.date;
    const isT = trades.filter(t => t.date <= splitDate);
    const oosT = trades.filter(t => t.date > splitDate);
    const all = summarize(trades), isS = summarize(isT), oosS = summarize(oosT);
    if (!all || !isS || !oosS) continue;
    const degrade = isS.sharpe > 0 ? (isS.sharpe - oosS.sharpe) / isS.sharpe : 0;
    const robustScore = oosS.sharpe - Math.max(0, degrade) * 0.3;
    results.push({ stopBufferPct, all, isS, oosS, robustScore });
  }
  // perDay(하루당 기대수익률) 순 정렬 — 2026-08-21 원 스윕이 채택한 기준(슬롯 회전율=자본효율이 핵심인
  // 5슬롯 공유자본 포트폴리오 특성상, 단순 트레이드당 Sharpe보다 하루당 기대치가 실전과 더 부합)
  results.sort((a, b) => b.all.perDay - a.all.perDay);

  console.log('\n════════ 라운드넘버 stopBufferPct 재확인 그리드서치 (perDay 순) ════════\n');
  console.log('stopBufferPct'.padEnd(16) + 'n'.padStart(6) + '평균'.padStart(9) + '승률'.padStart(7) + '평균보유일'.padStart(10) + 'perDay'.padStart(9) + '전체Sharpe'.padStart(11) + 'IS_Sharpe'.padStart(11) + 'OOS_Sharpe'.padStart(11));
  console.log('─'.repeat(96));
  for (const r of results) {
    console.log(
      `${r.stopBufferPct}%`.padEnd(16) + String(r.all.n).padStart(6) +
      `${r.all.avg >= 0 ? '+' : ''}${r.all.avg.toFixed(2)}%`.padStart(9) +
      `${r.all.win.toFixed(0)}%`.padStart(7) +
      `${r.all.avgDays.toFixed(1)}일`.padStart(10) +
      `${r.all.perDay.toFixed(3)}%`.padStart(9) +
      r.all.sharpe.toFixed(3).padStart(11) + r.isS.sharpe.toFixed(3).padStart(11) + r.oosS.sharpe.toFixed(3).padStart(11)
    );
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
