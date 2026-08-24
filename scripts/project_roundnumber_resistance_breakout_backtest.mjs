// 라운드넘버(피겨라운드) 저항 상향돌파 성공률 백테스트 — 2026-08-24 신규
// 배경: 보유종목 시세표(project_holdings_quote_table.mjs)에서 두산로보틱스가 라운드저항(70,000원,
// 터치15회)에 근접한 상황에서, "터치횟수가 많은 저항일수록 상향돌파가 잘 되는지/안 되는지" 실증 요청.
// [[project_roundnumber_strategy]]의 확정 전략(승률59%)은 "지지 하향이탈 후 재돌파" 매수 진입용이라
// 저항 상향돌파와는 방향·성격이 다름 — 이 스크립트는 별도의 독립 통계.
//
// 그리드는 화면표시용(project_holdings_quote_table.mjs)과 동일한 window=200일/ticks=10을 기본값으로
// 사용(사용자가 실제로 보고 있는 라운드저항 숫자와 일치시키기 위함, 매매용 150/30 그리드와는 목적이 다름).
//
// 이벤트 정의(각 저항 레벨에 대해 "새로운 접근"마다 1건, lookahead 없음):
//   ① 트레일링 라운드 그리드로 저항 R = 직전종가 기준 바로 위 라운드레벨 계산
//   ② 당일 고가가 R을 처음 터치(전일 고가는 R 미만, 당일 고가>=R) — 이미 돌파 진행중인 구간은 재계산 안 함
//   ③ 그 시점까지의 과거 windowDays 동안 R을 통과한 캔들 수(터치카운트) 기록
// 결과: 이후 --hold-window(기본10)거래일 내 종가가 R 이상으로 마감하면 "상향돌파 성공", 아니면 "실패(저항유지)"
//
// 사용법: node scripts/project_roundnumber_resistance_breakout_backtest.mjs [--window-days 200]
//   [--target-ticks 10] [--hold-window 10] [--calendar-days 2555] [--stocks 코드:이름:시장,...]

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 + 코스닥 TOP20 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 비교 가능성 유지)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
const DEFAULT_STOCKS = [...FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })), ...FALLBACK_KOSDAQ];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, calendarDays: 2555, windowDays: 200, targetTicks: 10, holdWindow: 10 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--window-days') o.windowDays = parseInt(argv[++i]);
    if (argv[i] === '--target-ticks') o.targetTicks = parseInt(argv[++i]);
    if (argv[i] === '--hold-window') o.holdWindow = parseInt(argv[++i]);
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

// 저항 접근/테스트 이벤트 탐지: 당일 고가가 처음으로 라운드저항 R에 도달(전일 고가는 R 미만)
function detectResistanceTests(seq, highs, lows, opts) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const step = computeStepAt(highs, lows, i - 1, opts.windowDays, opts.targetTicks);
    if (!step) continue;
    const prevClose = seq[i - 1].close;
    const support = Math.floor(prevClose / step) * step;
    const R = support + step;
    if (R <= 0) continue;
    const firstTouch = highs[i] >= R && highs[i - 1] < R;
    if (!firstTouch) continue;
    const touch = touchCountBefore(highs, lows, i, R, opts.windowDays);
    events.push({ testIdx: i, level: R, step, touchCount: touch });
  }
  return events;
}

function simulateBreakoutOutcome(seq, ev, opts) {
  for (let d = 0; d < opts.holdWindow; d++) {
    const j = ev.testIdx + d;
    if (j >= seq.length) return null; // 아직 결과 미확정
    if (seq[j].close >= ev.level) return { success: true, day: d, date: seq[j].date };
  }
  return { success: false, day: opts.holdWindow, date: seq[Math.min(ev.testIdx + opts.holdWindow - 1, seq.length - 1)].date };
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;

  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || chart.high[i] == null || chart.low[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
    highs.push(chart.high[i]);
    lows.push(chart.low[i]);
  }
  const minLen = opts.windowDays + opts.holdWindow + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectResistanceTests(seq, highs, lows, opts);
  const tests = [];
  for (const ev of events) {
    const res = simulateBreakoutOutcome(seq, ev, opts);
    if (!res) continue;
    tests.push({ name: stock.name, testDate: seq[ev.testIdx].date, level: ev.level, touchCount: ev.touchCount, ...res });
  }
  return { ...stock, tests, totalEvents: events.length };
}

function summarize(tests) {
  if (!tests.length) return null;
  const succ = tests.filter(t => t.success);
  const successRate = succ.length / tests.length * 100;
  const avgDaysToBreak = succ.length ? mean(succ.map(t => t.day)) : null;

  const buckets = [
    { label: '낮음(0~2회)', test: t => t.touchCount <= 2 },
    { label: '중간(3~9회)', test: t => t.touchCount >= 3 && t.touchCount <= 9 },
    { label: '높음(10~14회)', test: t => t.touchCount >= 10 && t.touchCount <= 14 },
    { label: '매우높음(15회+)', test: t => t.touchCount >= 15 },
  ];
  const touchSplit = buckets.map(b => {
    const g = tests.filter(b.test);
    if (!g.length) return { label: b.label, n: 0 };
    const gs = g.filter(t => t.success);
    return { label: b.label, n: g.length, successRate: gs.length / g.length * 100, avgDaysToBreak: gs.length ? mean(gs.map(t => t.day)) : null };
  });

  return { n: tests.length, successRate, avgDaysToBreak, touchSplit };
}

async function main() {
  const opts = parseArgs();
  console.error(`[라운드저항 상향돌파 성공률 백테스트] ${opts.stocks.length}종목, 그리드=최근${opts.windowDays}거래일 고저범위÷${opts.targetTicks}눈금(niceStep), 판정창=${opts.holdWindow}거래일`);
  console.error(`이벤트: 저항레벨 R을 당일 고가가 처음 터치(전일 고가<R) → ${opts.holdWindow}거래일 내 종가가 R 이상 마감하면 "성공"`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.tests);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n전체 저항테스트 발생: ${totalEvents}건 (미확정 최근 이벤트 제외 유효표본: ${pooled.length}건)`);

  const s = summarize(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }

  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  상향돌파 성공률 ${s.successRate.toFixed(1)}%  (성공시 평균 ${s.avgDaysToBreak.toFixed(1)}거래일 소요)`);

  console.log(`\n[터치횟수(밀집도) 구간별 상향돌파 성공률]`);
  for (const b of s.touchSplit) {
    if (!b.n) { console.log(`  ${b.label}: 해당 없음`); continue; }
    const days = b.avgDaysToBreak != null ? `, 성공시 평균${b.avgDaysToBreak.toFixed(1)}거래일` : '';
    console.log(`  ${b.label}: n=${b.n}  성공률 ${b.successRate.toFixed(1)}%${days}`);
  }
  console.log('\n※ 미완료 이벤트(최근이라 아직 판정창 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ 같은 레벨이라도 고가가 R 아래로 내려갔다가 다시 터치하면 별개 이벤트로 재집계됨');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
