// 라운드넘버 전략 — 체결 방식 현실화 비교 백테스트 (2026-08-25)
// 배경: 확정 전략(project_roundnumber_strategy_backtest.mjs)은 진입/청산 모두 "신호 발생일 종가"로
// 즉시 체결된다고 가정(이상화된 가정 — 종가는 그날 장이 끝나야 확정되므로 실제로는 그 가격에 살 수 없음).
// 사용자 질문: ①진입을 신호 다음날 "봉의 중심선"((고가+저가)/2)에 지정가로 걸어두는 방식,
// ②청산(TP/STOP/TIME)도 조건 발생일 종가가 아니라 그 다음날 시가에 시장가로 체결하는 방식으로 바꾸면
// 결과가 어떻게 달라지는지 — 원본과 동일한 신호탐지(detectRoundSignals) 위에 체결 로직만 교체해 비교.
//
// 원본(기준) 체결: 진입=신호일(i0) 종가, 청산=조건충족일(j) 종가(즉시)
// 현실화 체결:   진입=신호일 다음날(i0+1) (고가+저가)/2, 청산=조건충족일(j) 다음날(j+1) 시가
//   → 조건 판정 자체(종가 기준 TP/STOP/TIME 체크)는 원본과 동일 로직 유지, "체결 시점·가격"만 하루씩 밀림.
//   → 데이터 마지막 구간에서 다음날 데이터가 없으면 미확정 트레이드로 제외(원본보다 제외폭이 약간 커짐).
//
// 사용법: node scripts/project_roundnumber_realistic_execution_backtest.mjs [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const WINDOW_DAYS = 150, TARGET_TICKS = 30, MIN_TOUCHES = 3, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 2, MAX_HOLD = 60, CALENDAR_DAYS = 2555;
const MIN_ENTRY_POSITION_PCT = 20, MIN_BAND_WIDTH_PCT = 2.5;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS };
  for (let i = 0; i < argv.length; i++) {
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
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
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
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
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
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}

// 신호탐지는 확정 전략과 완전히 동일(체결 방식만 비교 대상) — ⑤⑥⑦ 필터 전부 포함
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
          if (entryPosition >= MIN_ENTRY_POSITION_PCT) {
            events.push({ entryIdx: f, level: L, step });
          }
        }
        break;
      }
    }
  }
  return events;
}

// ── 원본(기준) 체결: 진입=신호일 종가, 청산=조건충족일 종가 즉시 ──
function simulateOriginal(seq, ev) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - STOP_BUFFER_PCT / 100);
  for (let d = 1; d <= MAX_HOLD; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    if (close <= stop) return { ret: (close - entry) / entry * 100, day: d, reason: 'STOP' };
    if (close >= target) return { ret: (close - entry) / entry * 100, day: d, reason: 'TP' };
    if (d === MAX_HOLD) return { ret: (close - entry) / entry * 100, day: d, reason: 'TIME' };
  }
  return null;
}

// ── 현실화 체결: 진입=신호 다음날 (고가+저가)/2 지정가, 청산=조건충족일 다음날 시가 시장가 ──
function simulateRealistic(seq, highs, lows, opens, ev) {
  const entryIdx = ev.entryIdx + 1; // 신호 다음날
  if (entryIdx >= seq.length) return null;
  const entry = (highs[entryIdx] + lows[entryIdx]) / 2; // 그날 봉의 중심선(지정가 체결 가정)
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - STOP_BUFFER_PCT / 100);
  for (let d = 1; d <= MAX_HOLD; d++) {
    const j = entryIdx + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    let reason = null;
    if (close <= stop) reason = 'STOP';
    else if (close >= target) reason = 'TP';
    else if (d === MAX_HOLD) reason = 'TIME';
    if (reason) {
      const execDay = j + 1; // 조건 발생 다음날 시가 시장가 체결
      if (execDay >= seq.length || opens[execDay] == null) return null; // 다음날 데이터 없음 → 미확정 제외
      const exitPrice = opens[execDay];
      return { ret: (exitPrice - entry) / entry * 100, day: execDay - entryIdx, reason };
    }
  }
  return null;
}

async function backtestStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const seq = [], highs = [], lows = [], opens = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
    opens.push(chart.open[i] ?? closes[i]);
  }
  const minLen = WINDOW_DAYS + RECENT_LOOKBACK + MAX_HOLD + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows);
  const original = [], realistic = [];
  for (const ev of events) {
    const ro = simulateOriginal(seq, ev);
    if (ro) original.push(ro);
    const rr = simulateRealistic(seq, highs, lows, opens, ev);
    if (rr) realistic.push(rr);
  }
  return { ...stock, original, realistic };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  return {
    n: trades.length, win, avg: mean(rets), med: median(rets),
    avgDays: mean(trades.map(t => t.day)),
    tp: reasonCount.TP || 0, stop: reasonCount.STOP || 0, time: reasonCount.TIME || 0,
  };
}
function fmtSummary(s) {
  if (!s) return '표본없음';
  return `n=${s.n}  승률${s.win.toFixed(0)}%  평균${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  평균보유${s.avgDays.toFixed(1)}일  TP${s.tp}(${(s.tp/s.n*100).toFixed(0)}%)/STOP${s.stop}(${(s.stop/s.n*100).toFixed(0)}%)/TIME${s.time}(${(s.time/s.n*100).toFixed(0)}%)`;
}

async function main() {
  const opts = parseArgs();
  console.error(`[체결방식 현실화 비교] ${opts.stocks.length}종목 백테스트 시작...`);
  const results = await batchAll(opts.stocks, backtestStock, 5, 150);

  const allOriginal = [], allRealistic = [];
  for (const r of results) {
    if (r.error) { console.error(`[조회실패] ${r.name}: ${r.error}`); continue; }
    allOriginal.push(...r.original);
    allRealistic.push(...r.realistic);
  }

  console.log('\n━━━ 원본(기준) 체결: 진입=신호일 종가 / 청산=조건충족일 종가 즉시 ━━━');
  console.log(fmtSummary(summarize(allOriginal)));

  console.log('\n━━━ 현실화 체결: 진입=신호 다음날 (고가+저가)/2 지정가 / 청산=조건충족 다음날 시가 시장가 ━━━');
  console.log(fmtSummary(summarize(allRealistic)));

  const so = summarize(allOriginal), sr = summarize(allRealistic);
  if (so && sr) {
    console.log('\n━━━ 차이 ━━━');
    console.log(`표본수: ${so.n} → ${sr.n} (${sr.n - so.n >= 0 ? '+' : ''}${sr.n - so.n}, 다음날 데이터 없어 미확정 제외분 포함)`);
    console.log(`승률:   ${so.win.toFixed(1)}% → ${sr.win.toFixed(1)}%p (${(sr.win - so.win >= 0 ? '+' : '')}${(sr.win - so.win).toFixed(1)}%p)`);
    console.log(`평균수익률: ${so.avg.toFixed(2)}% → ${sr.avg.toFixed(2)}% (${(sr.avg - so.avg >= 0 ? '+' : '')}${(sr.avg - so.avg).toFixed(2)}%p)`);
    console.log(`중앙값: ${so.med.toFixed(2)}% → ${sr.med.toFixed(2)}% (${(sr.med - so.med >= 0 ? '+' : '')}${(sr.med - so.med).toFixed(2)}%p)`);
    console.log(`평균보유일수: ${so.avgDays.toFixed(1)}일 → ${sr.avgDays.toFixed(1)}일`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
