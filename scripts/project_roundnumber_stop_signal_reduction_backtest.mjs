// 라운드넘버 전략 — STOP(손절) 발생 종목/신호 특성 분석 → 진입신호 감소용 필터 탐색 (2026-08-24)
// 배경: 코스피 전용 확정(project_roundnumber_strategy_backtest.mjs) 이후에도 STOP 비율이 37%(1,231/3,337건)
// 남아있음. 진입신호 발생건수 자체를 줄이면서 품질(승률)을 높일 수 있는 필터가 있는지, 기존 이벤트에
// 이미 계산되던 특성(트랙레코드 강도, 밀집도) 외에 새로 추가한 두 특성으로 STOP vs TP 그룹을 비교한다.
//   ① reclaimDays: 이탈일(breachIdx)부터 재돌파(entryIdx)까지 걸린 거래일수(1~reclaimWindow=5) —
//      빨리 회복할수록 지지가 강하다는 가설.
//   ② breachDepthTicks: 이탈 당일 종가가 레벨 L 아래로 얼마나 깊이 뚫었는지(스텝 단위) —
//      살짝 스친 이탈보다 깊이 뚫은 이탈이 재돌파해도 신뢰도가 낮을 수 있다는 가설.
// 사용법: node scripts/project_roundnumber_stop_signal_reduction_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 전용(2026-08-24 확정) — project_roundnumber_strategy_backtest.mjs DEFAULT_STOCKS와 동일
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const WINDOW_DAYS = 150, TARGET_TICKS = 30, MIN_TOUCHES = 3, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 2, MAX_HOLD = 60, CALENDAR_DAYS = 2555, BASE_PERIOD = 200;

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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
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
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null); let idx = 0;
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

// 확정 전략과 동일 규칙 + reclaimDays·breachDepthTicks 신규 계산
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

    const lo = Math.max(0, i - 1 - RECENT_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < PRIOR_ABOVE_DAYS) continue;

    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (touch < MIN_TOUCHES) continue;

    const breachDepthTicks = (L - cur) / step; // 이탈 당일 종가가 L 아래로 몇 틱 뚫었는지

    for (let f = i; f < Math.min(n, i + RECLAIM_WINDOW); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) { // 오버슈트 필터(확정 전략과 동일)
          events.push({ entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, breachIdx: i, reclaimDays: f - i, breachDepthTicks });
        }
        break;
      }
    }
  }
  return events;
}

function simulateRoundTrade(seq, ev) {
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

async function backtestStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema200: ema200s[i] ?? null });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
  }
  const minLen = WINDOW_DAYS + RECENT_LOOKBACK + MAX_HOLD + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows);
  const trades = [];
  for (const ev of events) {
    const res = simulateRoundTrade(seq, ev);
    if (!res) continue;
    const entryEma200 = seq[ev.entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[ev.entryIdx].close >= entryEma200 : null;
    const stepPct = ev.step / ev.level * 100; // 라운드 눈금 크기 ÷ 가격 = 상대 변동성 대용
    trades.push({ name: stock.name, ...ev, ...res, uptrend, stepPct });
  }
  return { ...stock, trades };
}

function bucketReport(trades, label, buckets) {
  console.log(`\n[${label}]`);
  for (const b of buckets) {
    const g = trades.filter(b.test);
    if (!g.length) { console.log(`  ${b.label}: 해당 없음`); continue; }
    const win = g.filter(t => t.ret > 0).length / g.length * 100;
    const tpRate = g.filter(t => t.reason === 'TP').length / g.length * 100;
    console.log(`  ${b.label}: n=${g.length}(${(g.length / trades.length * 100).toFixed(0)}%)  평균 ${mean(g.map(t => t.ret)) >= 0 ? '+' : ''}${mean(g.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(g.map(t => t.ret)) >= 0 ? '+' : ''}${median(g.map(t => t.ret)).toFixed(2)}%  승률${win.toFixed(0)}%  TP비율${tpRate.toFixed(0)}%`);
  }
}

async function main() {
  console.error(`[STOP 손절 특성 분석] 코스피 ${DEFAULT_STOCKS.length}종목, 확정 전략 규칙 동일 + reclaimDays·breachDepthTicks 신규 계산`);
  const results = await batchAll(DEFAULT_STOCKS, backtestStock);
  const pooled = [];
  const errors = [];
  for (const r of results) { if (r.error) { errors.push(`${r.name}:${r.error}`); continue; } pooled.push(...r.trades); }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  console.log(`\n전체 표본 n=${pooled.length}`);
  const stopTrades = pooled.filter(t => t.reason === 'STOP');
  const tpTrades = pooled.filter(t => t.reason === 'TP');
  console.log(`STOP n=${stopTrades.length}(${(stopTrades.length / pooled.length * 100).toFixed(0)}%)  TP n=${tpTrades.length}(${(tpTrades.length / pooled.length * 100).toFixed(0)}%)`);

  console.log(`\n━━━ STOP vs TP 그룹 평균 특성 비교 ━━━`);
  console.log(`  트랙레코드(priorAboveCount, 최근20일중 L위 일수): STOP평균 ${mean(stopTrades.map(t => t.priorAboveCount)).toFixed(1)}일  vs  TP평균 ${mean(tpTrades.map(t => t.priorAboveCount)).toFixed(1)}일`);
  console.log(`  밀집도(touchCount): STOP평균 ${mean(stopTrades.map(t => t.touchCount)).toFixed(1)}봉  vs  TP평균 ${mean(tpTrades.map(t => t.touchCount)).toFixed(1)}봉`);
  console.log(`  재돌파소요일(reclaimDays): STOP평균 ${mean(stopTrades.map(t => t.reclaimDays)).toFixed(2)}일  vs  TP평균 ${mean(tpTrades.map(t => t.reclaimDays)).toFixed(2)}일`);
  console.log(`  이탈깊이(breachDepthTicks, 스텝단위): STOP평균 ${mean(stopTrades.map(t => t.breachDepthTicks)).toFixed(2)}틱  vs  TP평균 ${mean(tpTrades.map(t => t.breachDepthTicks)).toFixed(2)}틱`);

  bucketReport(pooled, '트랙레코드(priorAboveCount) 구간별', [
    { label: '약함(5~9일)', test: t => t.priorAboveCount >= 5 && t.priorAboveCount <= 9 },
    { label: '중간(10~14일)', test: t => t.priorAboveCount >= 10 && t.priorAboveCount <= 14 },
    { label: '강함(15~20일)', test: t => t.priorAboveCount >= 15 },
  ]);

  bucketReport(pooled, '재돌파 소요일(reclaimDays) 구간별', [
    { label: '당일(0일)', test: t => t.reclaimDays === 0 },
    { label: '1일', test: t => t.reclaimDays === 1 },
    { label: '2일', test: t => t.reclaimDays === 2 },
    { label: '3~5일', test: t => t.reclaimDays >= 3 },
  ]);

  bucketReport(pooled, '이탈깊이(breachDepthTicks) 구간별', [
    { label: '얕음(<0.5틱)', test: t => t.breachDepthTicks < 0.5 },
    { label: '보통(0.5~1틱)', test: t => t.breachDepthTicks >= 0.5 && t.breachDepthTicks < 1 },
    { label: '깊음(1~2틱)', test: t => t.breachDepthTicks >= 1 && t.breachDepthTicks < 2 },
    { label: '매우깊음(2틱+)', test: t => t.breachDepthTicks >= 2 },
  ]);

  console.log(`\n━━━ 후보 필터 적용 시뮬레이션(기준 n=${pooled.length}, 승률${(pooled.filter(t => t.ret > 0).length / pooled.length * 100).toFixed(0)}%) ━━━`);
  const candidates = [
    { label: '당일 재돌파만(reclaimDays=0)', test: t => t.reclaimDays === 0 },
    { label: '재돌파 1일 이내(reclaimDays<=1)', test: t => t.reclaimDays <= 1 },
    { label: '얕은 이탈만(breachDepthTicks<1)', test: t => t.breachDepthTicks < 1 },
    { label: '강한 트랙레코드만(priorAboveCount>=10)', test: t => t.priorAboveCount >= 10 },
    { label: '얕은이탈+당일재돌파 조합', test: t => t.breachDepthTicks < 1 && t.reclaimDays === 0 },
    { label: '강트랙레코드+얕은이탈 조합', test: t => t.priorAboveCount >= 10 && t.breachDepthTicks < 1 },
  ];
  for (const c of candidates) {
    const g = pooled.filter(c.test);
    if (!g.length) { console.log(`  ${c.label}: 해당 없음`); continue; }
    const win = g.filter(t => t.ret > 0).length / g.length * 100;
    const tpRate = g.filter(t => t.reason === 'TP').length / g.length * 100;
    console.log(`  ${c.label}: n=${g.length}(전체대비${(g.length / pooled.length * 100).toFixed(0)}%, 신호${(100 - g.length / pooled.length * 100).toFixed(0)}%감소)  평균 ${mean(g.map(t => t.ret)) >= 0 ? '+' : ''}${mean(g.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(g.map(t => t.ret)) >= 0 ? '+' : ''}${median(g.map(t => t.ret)).toFixed(2)}%  승률${win.toFixed(0)}%  TP비율${tpRate.toFixed(0)}%`);
  }

  // 종목단위 배제 후보 — 신호단위 특성이 무력했으므로, 종목별 평균수익률 음수인 종목을 통째로 제외하면
  // 어떻게 되는지 확인(2026-08-24, 코스닥 제외와 동일한 논리를 코스피 내부에도 적용)
  console.log(`\n━━━ 종목별 평균수익률 ━━━`);
  const byName = {};
  for (const t of pooled) { (byName[t.name] ||= []).push(t); }
  const stockStats = Object.entries(byName).map(([name, g]) => ({
    name, n: g.length, avg: mean(g.map(t => t.ret)), win: g.filter(t => t.ret > 0).length / g.length * 100,
  })).sort((a, b) => a.avg - b.avg);
  for (const s of stockStats) console.log(`  ${s.name.padEnd(14)} n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  승률${s.win.toFixed(0)}%`);

  const negNames = new Set(stockStats.filter(s => s.avg < 0).map(s => s.name));
  console.log(`\n━━━ 종목단위 배제 시뮬레이션(평균수익률 음수 종목 ${negNames.size}개 제외: ${[...negNames].join(', ')}) ━━━`);
  const filtered = pooled.filter(t => !negNames.has(t.name));
  const win = filtered.filter(t => t.ret > 0).length / filtered.length * 100;
  const tpRate = filtered.filter(t => t.reason === 'TP').length / filtered.length * 100;
  console.log(`  n=${filtered.length}(전체대비${(filtered.length / pooled.length * 100).toFixed(0)}%, 신호${(100 - filtered.length / pooled.length * 100).toFixed(0)}%감소)  평균 ${mean(filtered.map(t => t.ret)) >= 0 ? '+' : ''}${mean(filtered.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(filtered.map(t => t.ret)) >= 0 ? '+' : ''}${median(filtered.map(t => t.ret)).toFixed(2)}%  승률${win.toFixed(0)}%  TP비율${tpRate.toFixed(0)}%`);

  // 음수/양수 종목 그룹이 기술적 특성(EMA200 국면 비중, 상대변동성)으로 설명되는지 검증(2026-08-24)
  console.log(`\n━━━ 음수그룹 vs 양수그룹 기술적 특성 비교(우연 여부 검증) ━━━`);
  const negTrades = pooled.filter(t => negNames.has(t.name));
  const posTrades = pooled.filter(t => !negNames.has(t.name));
  const upRate = g => g.filter(t => t.uptrend === true).length / g.filter(t => t.uptrend != null).length * 100;
  console.log(`  진입시점 EMA200 상승국면 비중: 음수그룹(14종목) ${upRate(negTrades).toFixed(0)}%  vs  양수그룹(36종목) ${upRate(posTrades).toFixed(0)}%`);
  console.log(`  상대변동성(step/level%, 클수록 변동성↑): 음수그룹 평균 ${mean(negTrades.map(t => t.stepPct)).toFixed(2)}%  vs  양수그룹 평균 ${mean(posTrades.map(t => t.stepPct)).toFixed(2)}%`);

  const upTrades = pooled.filter(t => t.uptrend === true), downTrades = pooled.filter(t => t.uptrend === false);
  const winOf = g => g.filter(t => t.ret > 0).length / g.length * 100;
  console.log(`\n  [국면별 승률 — 음수그룹만] 상승국면 n=${negTrades.filter(t=>t.uptrend===true).length} 승률${winOf(negTrades.filter(t=>t.uptrend===true)).toFixed(0)}%  하락국면 n=${negTrades.filter(t=>t.uptrend===false).length} 승률${winOf(negTrades.filter(t=>t.uptrend===false)).toFixed(0)}%`);
  console.log(`  [국면별 승률 — 양수그룹만] 상승국면 n=${posTrades.filter(t=>t.uptrend===true).length} 승률${winOf(posTrades.filter(t=>t.uptrend===true)).toFixed(0)}%  하락국면 n=${posTrades.filter(t=>t.uptrend===false).length} 승률${winOf(posTrades.filter(t=>t.uptrend===false)).toFixed(0)}%`);

  // 상대변동성(stepPct) 구간별 성과 — 전체 풀 기준(음수그룹 가설: 변동성 클수록 성과 나쁜지)
  bucketReport(pooled, '상대변동성(stepPct) 구간별 — 전체풀', [
    { label: '낮음(<3%)', test: t => t.stepPct < 3 },
    { label: '중간(3~5%)', test: t => t.stepPct >= 3 && t.stepPct < 5 },
    { label: '높음(5%+)', test: t => t.stepPct >= 5 },
  ]);

  // 더 엄격한 컷오프 재검증(2026-08-24 사용자 지시): 평균수익률<=-0.2% 또는 승률<=55%
  // (기존 "평균<0" 단순부호 기준의 통계적 취약점 지적에 따른 재설정)
  const strictNames = new Set(stockStats.filter(s => s.avg <= -0.2 || s.win <= 55).map(s => s.name));
  console.log(`\n━━━ 재검증: 평균수익률<=-0.2% 또는 승률<=55% 기준(${strictNames.size}종목: ${[...strictNames].join(', ')}) ━━━`);
  const strictFiltered = pooled.filter(t => !strictNames.has(t.name));
  const strictWin = strictFiltered.filter(t => t.ret > 0).length / strictFiltered.length * 100;
  const strictTp = strictFiltered.filter(t => t.reason === 'TP').length / strictFiltered.length * 100;
  console.log(`  n=${strictFiltered.length}(전체대비${(strictFiltered.length / pooled.length * 100).toFixed(0)}%, 신호${(100 - strictFiltered.length / pooled.length * 100).toFixed(0)}%감소)  평균 ${mean(strictFiltered.map(t => t.ret)) >= 0 ? '+' : ''}${mean(strictFiltered.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(strictFiltered.map(t => t.ret)) >= 0 ? '+' : ''}${median(strictFiltered.map(t => t.ret)).toFixed(2)}%  승률${strictWin.toFixed(0)}%  TP비율${strictTp.toFixed(0)}%`);
  console.log(`  제외된 종목 상세:`);
  for (const s of stockStats.filter(s => strictNames.has(s.name))) console.log(`    ${s.name.padEnd(10)} n=${s.n}  평균${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  승률${s.win.toFixed(0)}%`);

  // (종목단위 조건은 보류 — 2026-08-24 사용자 지시) 아래는 종목 구분 없이 EMA200 국면 자체만으로
  // 전체 풀(50종목)을 나눈 상세 검증. 확정 백테스트의 국면분리(승률만 표시)보다 더 많은 지표를 본다.
  console.log(`\n━━━ EMA200 국면별 상세 검증(종목 구분 없음, 전체 50종목 풀) ━━━`);
  function regimeDetail(g, label) {
    if (!g.length) { console.log(`  ${label}: 해당 없음`); return; }
    const rets = g.map(t => t.ret);
    const win = g.filter(t => t.ret > 0).length / g.length * 100;
    const tp = g.filter(t => t.reason === 'TP').length;
    const stop = g.filter(t => t.reason === 'STOP').length;
    const time = g.filter(t => t.reason === 'TIME').length;
    console.log(`  [${label}] n=${g.length}(${(g.length / pooled.length * 100).toFixed(0)}%)`);
    console.log(`    평균 ${mean(rets) >= 0 ? '+' : ''}${mean(rets).toFixed(2)}%  중앙값 ${median(rets) >= 0 ? '+' : ''}${median(rets).toFixed(2)}%  승률${win.toFixed(0)}%  최고+${Math.max(...rets).toFixed(2)}%  최저${Math.min(...rets).toFixed(2)}%  평균보유${mean(g.map(t => t.day)).toFixed(1)}일`);
    console.log(`    청산사유: TP ${tp}건(${(tp / g.length * 100).toFixed(0)}%)  STOP ${stop}건(${(stop / g.length * 100).toFixed(0)}%)  TIME ${time}건(${(time / g.length * 100).toFixed(0)}%)`);
  }
  regimeDetail(upTrades, '상승국면(진입시 종가>=EMA200)');
  regimeDetail(downTrades, '하락국면(진입시 종가<EMA200)');

  console.log(`\n  [국면×밀집도 교차] `);
  for (const [rLabel, rTrades] of [['상승국면', upTrades], ['하락국면', downTrades]]) {
    for (const tb of [{ l: '낮음(3~5회)', f: t => t.touchCount <= 5 }, { l: '중간(6~9회)', f: t => t.touchCount >= 6 && t.touchCount <= 9 }, { l: '높음(10회+)', f: t => t.touchCount >= 10 }]) {
      const g = rTrades.filter(tb.f);
      if (!g.length) continue;
      console.log(`    ${rLabel}×${tb.l}: n=${g.length}  평균 ${mean(g.map(t => t.ret)) >= 0 ? '+' : ''}${mean(g.map(t => t.ret)).toFixed(2)}%  승률${winOf(g).toFixed(0)}%`);
    }
  }

  console.log(`\n━━━ 후보 필터: EMA200 국면만으로 신호 축소(종목 조건 없음) ━━━`);
  console.log(`  하락국면 진입만 채택: n=${downTrades.length}(전체대비${(downTrades.length / pooled.length * 100).toFixed(0)}%, 신호${(100 - downTrades.length / pooled.length * 100).toFixed(0)}%감소)  평균 ${mean(downTrades.map(t => t.ret)) >= 0 ? '+' : ''}${mean(downTrades.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(downTrades.map(t => t.ret)) >= 0 ? '+' : ''}${median(downTrades.map(t => t.ret)).toFixed(2)}%  승률${winOf(downTrades).toFixed(0)}%`);
  console.log(`  상승국면 진입만 채택: n=${upTrades.length}(전체대비${(upTrades.length / pooled.length * 100).toFixed(0)}%, 신호${(100 - upTrades.length / pooled.length * 100).toFixed(0)}%감소)  평균 ${mean(upTrades.map(t => t.ret)) >= 0 ? '+' : ''}${mean(upTrades.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(upTrades.map(t => t.ret)) >= 0 ? '+' : ''}${median(upTrades.map(t => t.ret)).toFixed(2)}%  승률${winOf(upTrades).toFixed(0)}%`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
