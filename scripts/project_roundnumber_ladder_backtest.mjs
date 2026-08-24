// 라운드넘버(피겨라운드) 전략 — 사다리형 분할매도 청산 백테스트 (2026-08-24, 5번째 전략 후속 검증)
// 배경: project_roundnumber_strategy_backtest.mjs(2026-08-21 확정)는 청산이 "다음 라운드레벨 1개(TP) 100% 매도"
// 단일 방식 — SK하이닉스처럼 승률은 나쁘지 않은데 평균수익률이 마이너스인 종목이 나오는 건 "한 방에 다
// 팔아버려서 그 이상 오르는 구간의 이익을 못 먹는" 구조 때문일 수 있다는 가설(2026-08-21 세션, 사용자
// 요청으로 다음 세션 검증 예정 항목). 이 스크립트는 같은 진입 시그널(entry 로직 100% 동일, entry 자체는
// 이미 검증 완료라 재검증 안 함)에 대해 청산만 "라운드레벨 3단계 사다리 분할매도"로 바꿔 기존 단일 TP
// 방식과 나란히(동일 이벤트셋) 비교한다.
//
// 사다리 규칙(2026-08-24 사용자 확정):
//   1차 25% @ L+1×step(TP1) / 2차 25% @ L+2×step(TP2) / 3차 25% @ L+3×step(TP3)
//   나머지 25%("전량" 잔량)는 STOP(L×98%, 기존과 동일값) 또는 TIME(60거래일) 중 먼저 오는 조건까지 보유
//   체결가는 기존 백테스트와 동일하게 "트리거를 넘긴/이탈한 날의 종가"(정확한 목표가 아님, 갭 반영)
//   한 거래일에 여러 단계가 동시 충족되면(갭업) 그날 종가로 동시 체결 처리
//   STOP은 아직 매도하지 않은 잔여 물량 전체를 그 시점에 청산(예: 1차만 체결된 상태에서 STOP 발생 시
//   남은 75% 전량을 STOP가로 매도) — 이미 실현한 단계별 이익/손실은 그대로 유지(사용자 확정: 기존 STOP값
//   전종목 동일 적용, 단계별 트레일링 없음)
//
// 사용법: node scripts/project_roundnumber_ladder_backtest.mjs [동일 파라미터 옵션, 기본값은
//   project_roundnumber_strategy_backtest.mjs 확정값과 동일: window-days 150 / target-ticks 30 /
//   min-touches 3 / recent-lookback 20 / prior-above-days 5 / reclaim-window 5 / stop-buffer-pct 2 / max-hold 60]

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 + 코스닥 TOP20 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 재현성 유지)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
const DEFAULT_STOCKS = [...FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })), ...FALLBACK_KOSDAQ];

const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    stocks: DEFAULT_STOCKS, calendarDays: 2555,
    windowDays: 150, targetTicks: 30, minTouches: 3,
    recentLookback: 20, priorAboveDays: 5, reclaimWindow: 5,
    stopBufferPct: 2, maxHold: 60,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--window-days') o.windowDays = parseInt(argv[++i]);
    if (argv[i] === '--target-ticks') o.targetTicks = parseInt(argv[++i]);
    if (argv[i] === '--min-touches') o.minTouches = parseInt(argv[++i]);
    if (argv[i] === '--recent-lookback') o.recentLookback = parseInt(argv[++i]);
    if (argv[i] === '--prior-above-days') o.priorAboveDays = parseInt(argv[++i]);
    if (argv[i] === '--reclaim-window') o.reclaimWindow = parseInt(argv[++i]);
    if (argv[i] === '--stop-buffer-pct') o.stopBufferPct = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
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

// 진입 로직은 project_roundnumber_strategy_backtest.mjs와 100% 동일(재검증 대상 아님)
function detectRoundSignals(seq, highs, lows, opts) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, opts.windowDays, opts.targetTicks);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;

    const lo = Math.max(0, i - 1 - opts.recentLookback);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < opts.priorAboveDays) continue;

    const touch = touchCountBefore(highs, lows, i, L, opts.windowDays);
    if (touch < opts.minTouches) continue;

    for (let f = i; f < Math.min(n, i + opts.reclaimWindow); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        events.push({ entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, breachIdx: i });
        break;
      }
    }
  }
  return events;
}

// 기존 단일 TP 방식(비교 기준선)
function simulateSingleTP(seq, ev, opts) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - opts.stopBufferPct / 100);
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    if (close <= stop) return { ret: (close - entry) / entry * 100, day: d, reason: 'STOP' };
    if (close >= target) return { ret: (close - entry) / entry * 100, day: d, reason: 'TP' };
    if (d === opts.maxHold) return { ret: (close - entry) / entry * 100, day: d, reason: 'TIME' };
  }
  return null;
}

// 사다리 분할매도: 25%씩 TP1/TP2/TP3, 잔여 25%는 STOP/TIME 중 먼저 오는 조건
const TRANCHE = 0.25;
function simulateLadder(seq, ev, opts) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const step = ev.step, level = ev.level;
  const tp = [level + step, level + 2 * step, level + 3 * step];
  const stop = level * (1 - opts.stopBufferPct / 100);
  const filled = [false, false, false];
  let remaining = 1 - TRANCHE * 0; // 시작 100%
  let weightedRet = 0;
  const legs = [];

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 미확정
    const close = seq[j].close;
    const retHere = (close - entry) / entry * 100;

    if (close <= stop) {
      if (remaining > 0) {
        weightedRet += remaining * retHere;
        legs.push({ reason: 'STOP', day: d, portion: remaining, ret: retHere });
        remaining = 0;
      }
      break;
    }
    for (let k = 0; k < 3; k++) {
      if (!filled[k] && close >= tp[k]) {
        filled[k] = true;
        weightedRet += TRANCHE * retHere;
        legs.push({ reason: `TP${k + 1}`, day: d, portion: TRANCHE, ret: retHere });
        remaining -= TRANCHE;
      }
    }
    if (d === opts.maxHold && remaining > 0) {
      weightedRet += remaining * retHere;
      legs.push({ reason: 'TIME', day: d, portion: remaining, ret: retHere });
      remaining = 0;
    }
  }
  if (remaining > 1e-9) return null;
  const lastReason = legs[legs.length - 1]?.reason || 'TIME';
  const lastDay = legs[legs.length - 1]?.day || opts.maxHold;
  return { ret: weightedRet, day: lastDay, reason: lastReason, legs, tp1Hit: filled[0], tp2Hit: filled[1], tp3Hit: filled[2] };
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

  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema200: ema200s[i] ?? null });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
  }
  const minLen = opts.windowDays + opts.recentLookback + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows, opts);
  const pairs = [];
  for (const ev of events) {
    const single = simulateSingleTP(seq, ev, opts);
    const ladder = simulateLadder(seq, ev, opts);
    if (!single || !ladder) continue; // 둘 다 확정된 경우만 공정 비교
    pairs.push({ name: stock.name, entryDate: seq[ev.entryIdx].date, level: ev.level, single, ladder });
  }
  return { ...stock, pairs, totalEvents: events.length };
}

function summarize(items, key) {
  const rets = items.map(p => p[key].ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(items.map(p => p[key].day));
  const reasonCount = {};
  for (const p of items) reasonCount[p[key].reason] = (reasonCount[p[key].reason] || 0) + 1;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, reasonCount };
}

function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

async function main() {
  const opts = parseArgs();
  console.error(`[라운드넘버 사다리 분할매도 백테스트] ${opts.stocks.length}종목, 진입로직은 기존 확정판과 동일`);
  console.error(`비교: 기존 단일TP(다음 라운드레벨 100%) vs 사다리(TP1/TP2/TP3 각25%+잔여25% STOP/TIME)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const errors = [];
  const pooled = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.pairs);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  if (!pooled.length) { console.log('유효 표본 없음'); return; }

  const s1 = summarize(pooled, 'single');
  const s2 = summarize(pooled, 'ladder');

  console.log(`\n동일 이벤트셋 n=${pooled.length}건 비교`);
  console.log(`\n━━━ 기존 단일TP 방식 ━━━`);
  console.log(`평균 ${fmtPct(s1.avg)}  중앙값 ${fmtPct(s1.med)}  승률 ${s1.win.toFixed(0)}%  최고 ${fmtPct(s1.best)}  최저 ${fmtPct(s1.worst)}  평균보유 ${s1.avgDays.toFixed(1)}일`);
  for (const [reason, cnt] of Object.entries(s1.reasonCount)) console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / s1.n * 100).toFixed(0)}%)`);

  console.log(`\n━━━ 사다리 분할매도 방식 ━━━`);
  console.log(`평균 ${fmtPct(s2.avg)}  중앙값 ${fmtPct(s2.med)}  승률 ${s2.win.toFixed(0)}%  최고 ${fmtPct(s2.best)}  최저 ${fmtPct(s2.worst)}  평균보유 ${s2.avgDays.toFixed(1)}일`);
  console.log(`  (마지막 청산 사유 기준 — 잔여25%가 최종 어떻게 빠졌는지)`);
  for (const [reason, cnt] of Object.entries(s2.reasonCount)) console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / s2.n * 100).toFixed(0)}%)`);

  const tp1n = pooled.filter(p => p.ladder.tp1Hit).length;
  const tp2n = pooled.filter(p => p.ladder.tp2Hit).length;
  const tp3n = pooled.filter(p => p.ladder.tp3Hit).length;
  console.log(`\n[사다리 단계별 도달률] TP1도달 ${(tp1n / pooled.length * 100).toFixed(0)}%(${tp1n}건)  TP2도달 ${(tp2n / pooled.length * 100).toFixed(0)}%(${tp2n}건)  TP3도달 ${(tp3n / pooled.length * 100).toFixed(0)}%(${tp3n}건)`);

  console.log(`\n[개선폭] 평균수익률 ${fmtPct(s2.avg - s1.avg)}p  중앙값 ${fmtPct(s2.med - s1.med)}p  승률 ${(s2.win - s1.win).toFixed(0)}p`);

  // 종목별(주력 종목 SK하이닉스 평균마이너스 이슈 검증 초점)
  console.log(`\n━━━ 종목별 비교(단일TP → 사다리) ━━━`);
  const byName = {};
  for (const p of pooled) {
    (byName[p.name] ||= []).push(p);
  }
  const rows = Object.entries(byName).map(([name, items]) => {
    const a = summarize(items, 'single'), b = summarize(items, 'ladder');
    return { name, n: items.length, singleAvg: a.avg, singleWin: a.win, ladderAvg: b.avg, ladderWin: b.win };
  }).sort((x, y) => y.n - x.n);
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(12)} n=${row.n}  단일TP ${fmtPct(row.singleAvg)}(승률${row.singleWin.toFixed(0)}%) → 사다리 ${fmtPct(row.ladderAvg)}(승률${row.ladderWin.toFixed(0)}%)`);
  }

  console.log('\n※ 두 방식 모두 확정(청산 완료)된 이벤트만 표본에 포함(공정 비교, 미확정 최근 신호 제외)');
  console.log('※ 체결가는 트리거를 넘긴/이탈한 날의 종가 기준(정확한 목표가 아님, 갭 반영)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
