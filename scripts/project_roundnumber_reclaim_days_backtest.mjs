// 라운드넘버(피겨라운드) 전략 — "재돌파 경과일수(이탈일→재돌파일, 1~5일)"별 성과 분리 백테스트
// 배경(2026-09-10): 재돌파 대기 스캔(project_roundnumber_recent_signals.mjs)에서 "경과 1/5일 vs 5/5일"에
// 최소조건이 없다는 질문에 이어, 경과일수 자체가 승률/수익률과 상관관계가 있는지 실증 검증 요청.
// project_portfolio_integrated_entry_scan.mjs의 checkRoundnumberEntry(RN_*)와 100% 동일한 확정 파라미터·필터
// (밴드폭 RN_MINBAND=2.5%, STOP_BUFFER_PCT=3 포함)로 이벤트를 탐지하고, entryIdx-breachIdx(재돌파 경과일)로
// 트레이드를 1~5일 버킷 분리해 승률·평균수익률·STOP비율을 비교한다.
// 사용법: node scripts/project_roundnumber_reclaim_days_backtest.mjs

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 재현성 유지)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// 운영 확정값(entry_scan.mjs RN_* / recent_signals.mjs 100% 동일)
const WINDOW_DAYS = 150, TARGET_TICKS = 30, MIN_TOUCHES = 3, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 3, MIN_ENTRY_POSITION_PCT = 20, MIN_BAND_WIDTH_PCT = 2.5, MAX_HOLD = 60;
const CALENDAR_DAYS = 2555;

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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
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

const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) {
    const dist = Math.abs(Math.log(norm) - Math.log(f));
    if (dist < bestDist) { bestDist = dist; best = f; }
  }
  return best * mag;
}
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) {
    if (highs[k] > hi) hi = highs[k];
    if (lows[k] < low) low = lows[k];
  }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) {
    if (lows[k] <= level && level <= highs[k]) count++;
  }
  return count;
}

// detectRoundSignals — entry_scan.mjs checkRoundnumberEntry와 100% 동일 필터(밴드폭 포함) + daysSinceBreach 기록
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
    if (step / L * 100 < MIN_BAND_WIDTH_PCT) continue; // 밴드폭 필터(entry_scan RN_MINBAND)

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
          events.push({ entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, breachIdx: i, daysSinceBreach: f - i + 1 });
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
    if (close <= stop) return { ret: (close - entry) / entry * 100, day: d, reason: 'STOP', date: seq[j].date };
    if (close >= target) return { ret: (close - entry) / entry * 100, day: d, reason: 'TP', date: seq[j].date };
    if (d === MAX_HOLD) return { ret: (close - entry) / entry * 100, day: d, reason: 'TIME', date: seq[j].date };
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

  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
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
    const entry = seq[ev.entryIdx].close;
    const entryPosition = (entry - ev.level) / ev.step * 100;
    if (entryPosition < MIN_ENTRY_POSITION_PCT) continue; // 진입위치 20% 컷(운영 확정 필터)
    trades.push({ name: stock.name, entryDate: seq[ev.entryIdx].date, daysSinceBreach: ev.daysSinceBreach, touchCount: ev.touchCount, entryPosition, ...res });
  }
  return { ...stock, trades, totalEvents: events.length };
}

async function main() {
  console.error(`[라운드넘버 재돌파 경과일수별 성과 백테스트] ${DEFAULT_STOCKS.length}종목(코스피TOP50), 확정파라미터: window${WINDOW_DAYS}/ticks${TARGET_TICKS}/밴드폭>=${MIN_BAND_WIDTH_PCT}%/밀집도>=${MIN_TOUCHES}봉/트랙레코드${RECENT_LOOKBACK}일중${PRIOR_ABOVE_DAYS}일/재돌파윈도우${RECLAIM_WINDOW}일/진입위치>=${MIN_ENTRY_POSITION_PCT}%/STOP버퍼${STOP_BUFFER_PCT}%`);

  const results = await batchAll(DEFAULT_STOCKS, s => backtestStock(s));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  console.log(`\n전체 유효 표본: ${pooled.length}건 (진입위치>=20% 필터 통과분만)`);
  if (!pooled.length) { console.log('표본 없음'); return; }

  const win = g => g.filter(t => t.ret > 0).length / g.length * 100;
  const stopRate = g => g.filter(t => t.reason === 'STOP').length / g.length * 100;
  const tpRate = g => g.filter(t => t.reason === 'TP').length / g.length * 100;

  const all = pooled;
  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${all.length}  평균 ${mean(all.map(t => t.ret)) >= 0 ? '+' : ''}${mean(all.map(t => t.ret)).toFixed(2)}%  중앙값 ${median(all.map(t => t.ret)) >= 0 ? '+' : ''}${median(all.map(t => t.ret)).toFixed(2)}%  승률${win(all).toFixed(0)}%  TP비율${tpRate(all).toFixed(0)}%  STOP비율${stopRate(all).toFixed(0)}%`);

  console.log(`\n═══ 재돌파 경과일수(이탈일→재돌파일, 1~${RECLAIM_WINDOW}일)별 성과 ═══`);
  for (let d = 1; d <= RECLAIM_WINDOW; d++) {
    const g = pooled.filter(t => t.daysSinceBreach === d);
    if (!g.length) { console.log(`  ${d}일째: 해당 없음`); continue; }
    const avg = mean(g.map(t => t.ret));
    const med = median(g.map(t => t.ret));
    const avgDays = mean(g.map(t => t.day));
    console.log(`  ${d}일째: n=${g.length}(${(g.length / pooled.length * 100).toFixed(0)}%)  평균 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%  중앙값 ${med >= 0 ? '+' : ''}${med.toFixed(2)}%  승률${win(g).toFixed(0)}%  TP비율${tpRate(g).toFixed(0)}%  STOP비율${stopRate(g).toFixed(0)}%  평균보유${avgDays.toFixed(1)}거래일`);
  }

  // 조기재돌파(1~2일) vs 지연재돌파(3~5일) 비교
  const early = pooled.filter(t => t.daysSinceBreach <= 2);
  const late = pooled.filter(t => t.daysSinceBreach >= 3);
  console.log(`\n[조기(1~2일) vs 지연(3~${RECLAIM_WINDOW}일) 재돌파 비교]`);
  if (early.length) console.log(`  조기(1~2일): n=${early.length}  평균 ${mean(early.map(t=>t.ret))>=0?'+':''}${mean(early.map(t=>t.ret)).toFixed(2)}%  승률${win(early).toFixed(0)}%  STOP비율${stopRate(early).toFixed(0)}%`);
  if (late.length) console.log(`  지연(3~${RECLAIM_WINDOW}일): n=${late.length}  평균 ${mean(late.map(t=>t.ret))>=0?'+':''}${mean(late.map(t=>t.ret)).toFixed(2)}%  승률${win(late).toFixed(0)}%  STOP비율${stopRate(late).toFixed(0)}%`);

  console.log(`\n[임계값 스윕] "경과일수 <= X일"만 신호로 채택할 때`);
  for (let th = 1; th <= RECLAIM_WINDOW; th++) {
    const g = pooled.filter(t => t.daysSinceBreach <= th);
    if (!g.length) continue;
    console.log(`  <=${th}일: n=${g.length}(${(g.length / pooled.length * 100).toFixed(0)}%)  평균 ${mean(g.map(t=>t.ret))>=0?'+':''}${mean(g.map(t=>t.ret)).toFixed(2)}%  승률${win(g).toFixed(0)}%  STOP비율${stopRate(g).toFixed(0)}%`);
  }

  console.log('\n※ 표본: 코스피TOP50, 최근 약 7년, entry_scan.mjs 운영 확정 파라미터(밴드폭·진입위치20%컷 포함) 100% 동일 적용');
  console.log('※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
