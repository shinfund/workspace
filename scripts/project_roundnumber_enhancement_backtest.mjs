// 라운드넘버 전략 보완 검증 4종 — 2026-09-11
// 배경: 4전략 통합포트폴리오에서 라운드넘버 신호비중이 압도적으로 커짐 → "라운드넘버를 더 튼튼하게"
// 요청으로, 기존에 시도 안 해본 4개 방향을 동일 데이터셋(코스피TOP50, 확정필터⑤⑥⑦ 적용)으로 검증:
//   A) 밴드폭 비례 포지션사이징 — 기존은 밴드폭>=2.5% 이진필터, 필터 통과셋 내에서도 밴드폭이 클수록
//      성과가 더 좋은지(연속변수로서 추가 개선여지) 재검증
//   B) 트레일링 스탑 — 기존 TP(다음 라운드레벨)는 고정청산. TP가 도달 후 즉시 팔지 않고 트레일링으로
//      추가상승 포착 시 성과 개선되는지(2026-08-24 "사다리형 분할매도"와는 다른 메커니즘 — 그건 물량을
//      나눠 파는 것, 이건 전량 유지하며 청산선만 동적으로 올리는 것)
//   C) 멀티타임프레임 컨플루언스 — 일봉 라운드레벨이 주봉 기준 라운드레벨과도 겹치는("이중 확인") 경우
//      성과가 다른지
//   D) 레벨 신선도(recency) 가중 — 터치카운트(횟수)는 이미 무의미 확인됐으나, "최근에도 터치가 있었는지"
//      (recency)는 다른 차원의 지표라 별도 검증
//
// 데이터셋: project_roundnumber_strategy_backtest.mjs와 동일 로직 재사용(신호탐지 함수 그대로 복사),
// 확정 파라미터(windowDays=150, targetTicks=30, minTouches=3, recentLookback=20, priorAboveDays=5,
// reclaimWindow=5, stopBufferPct=3, maxHold=60, minEntryPositionPct=20, minBandWidthPct=2.5) 고정.

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const OPTS = {
  calendarDays: 2555, windowDays: 150, targetTicks: 30, minTouches: 3,
  recentLookback: 20, priorAboveDays: 5, reclaimWindow: 5,
  stopBufferPct: 3, maxHold: 60, minEntryPositionPct: 20, minBandWidthPct: 2.5,
};

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

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }
function median(arr) {
  if (!arr.length) return NaN;
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
// 터치카운트 + 신선도(recency) 정보 함께 반환 — idx 이전 windowDays 동안 level을 통과한 봉의 인덱스 목록
function touchInfoBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0, lastTouchIdx = -1, recentCount = 0; // recentCount: 최근 30거래일 이내 터치수
  for (let k = lo; k < idx; k++) {
    if (lows[k] <= level && level <= highs[k]) {
      count++;
      lastTouchIdx = k;
      if (idx - k <= 30) recentCount++;
    }
  }
  return { count, ageOfLastTouch: lastTouchIdx >= 0 ? idx - lastTouchIdx : null, recentCount };
}

// 주봉(월요일 시작) 바 구성 — 일봉 시퀀스를 캘린더 주 단위로 그룹화(공휴일 무관, 실제 거래일만 집계)
function buildWeeklyBars(seq, highs, lows) {
  const bars = []; // { key, hi, lo, close, endIdx }
  let cur = null;
  for (let i = 0; i < seq.length; i++) {
    const d = new Date(seq[i].date + 'T00:00:00Z');
    const day = d.getUTCDay();
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!cur || cur.key !== key) {
      if (cur) bars.push(cur);
      cur = { key, hi: highs[i], lo: lows[i], close: seq[i].close, endIdx: i };
    } else {
      if (highs[i] > cur.hi) cur.hi = highs[i];
      if (lows[i] < cur.lo) cur.lo = lows[i];
      cur.close = seq[i].close;
      cur.endIdx = i;
    }
  }
  if (cur) bars.push(cur);
  return bars;
}
// 일봉 인덱스 idx 시점에서 "완결된"(idx 이전 주) 주봉 windowWeeks개로 만든 트레일링 그리드 step
function computeWeeklyStepAt(weeklyBars, idx, windowWeeks, targetTicksWeekly) {
  // idx가 속한 주 이전까지 완결된 주봉만 사용(lookahead 방지)
  let lastCompletedWeek = -1;
  for (let w = 0; w < weeklyBars.length; w++) {
    if (weeklyBars[w].endIdx < idx) lastCompletedWeek = w; else break;
  }
  if (lastCompletedWeek < windowWeeks - 1) return null;
  const lo = Math.max(0, lastCompletedWeek - windowWeeks + 1);
  let hi = -Infinity, low = Infinity;
  for (let w = lo; w <= lastCompletedWeek; w++) {
    if (weeklyBars[w].hi > hi) hi = weeklyBars[w].hi;
    if (weeklyBars[w].lo < low) low = weeklyBars[w].lo;
  }
  return niceStep((hi - low) / targetTicksWeekly);
}

// 확정 필터(⑤⑥⑦) 그대로 적용한 신호탐지 — project_roundnumber_strategy_backtest.mjs와 동일 로직
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

    const bandWidthPct = step / L * 100;
    if (bandWidthPct < opts.minBandWidthPct) continue;

    const lo = Math.max(0, i - 1 - opts.recentLookback);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < opts.priorAboveDays) continue;

    const touchInfo = touchInfoBefore(highs, lows, i, L, opts.windowDays);
    if (touchInfo.count < opts.minTouches) continue;

    for (let f = i; f < Math.min(n, i + opts.reclaimWindow); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= opts.minEntryPositionPct) {
            events.push({
              entryIdx: f, level: L, step, bandWidthPct,
              touchCount: touchInfo.count, ageOfLastTouch: touchInfo.ageOfLastTouch, recentTouchCount: touchInfo.recentCount,
              priorAboveCount: aboveCount, breachIdx: i, entryPosition,
            });
          }
        }
        break;
      }
    }
  }
  return events;
}

// 기존 확정 방식: TP(다음 라운드레벨 고정청산) / STOP(레벨×(1-stopBufferPct%)) / TIME
function simulateFixed(seq, ev, opts) {
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

// B) 트레일링 스탑: TP가(target) 도달 후 즉시 청산하지 않고, 전량 유지하며 청산선을 "최고종가×(1-trailPct%)"로
// 동적으로 올려가며 추가상승 포착 — 트레일선 이탈 또는 maxHold 도달 시 청산. TP 도달 전까지는 기존과 동일(STOP 유지).
function simulateTrailing(seq, ev, opts, trailPct) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const initStop = ev.level * (1 - opts.stopBufferPct / 100);
  let trailingActive = false;
  let peak = entry;
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    if (!trailingActive) {
      if (close <= initStop) return { ret: (close - entry) / entry * 100, day: d, reason: 'STOP' };
      if (close >= target) { trailingActive = true; peak = close; continue; }
    } else {
      if (close > peak) peak = close;
      const trailStop = peak * (1 - trailPct / 100);
      if (close <= trailStop) return { ret: (close - entry) / entry * 100, day: d, reason: 'TRAIL' };
    }
    if (d === opts.maxHold) return { ret: (close - entry) / entry * 100, day: d, reason: 'TIME' };
  }
  return null;
}

async function loadStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
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
  const minLen = opts.windowDays + opts.recentLookback + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };
  const events = detectRoundSignals(seq, highs, lows, opts);
  return { ...stock, seq, highs, lows, events };
}

function perDay(avg, avgDays) { return avgDays ? avg / avgDays : NaN; }

function fmtRow(label, n, avg, med, win, avgDays) {
  const pd = perDay(avg, avgDays);
  return `  ${label.padEnd(22)} n=${String(n).padEnd(5)} 평균 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%  중앙값 ${med >= 0 ? '+' : ''}${med.toFixed(2)}%  승률${win.toFixed(0)}%  평균보유${avgDays.toFixed(1)}일  perDay${pd.toFixed(3)}%`;
}

async function main() {
  console.error(`[라운드넘버 보완 4종 검증] 코스피TOP50, 확정필터(⑤⑥⑦)+stopBufferPct=3% 그대로 적용, 동일 데이터셋 재사용`);
  const stockResults = await batchAll(DEFAULT_STOCKS, s => loadStock(s, OPTS));
  const errors = stockResults.filter(r => r.error);
  if (errors.length) console.error(`[조회실패] ${errors.map(e => e.name).join(', ')}`);
  const valid = stockResults.filter(r => !r.error);

  // 공통: 기존 고정방식(TP/STOP/TIME) 트레이드셋 생성 — 모든 분석의 baseline
  const baseTrades = [];
  for (const r of valid) {
    for (const ev of r.events) {
      const res = simulateFixed(r.seq, ev, OPTS);
      if (!res) continue;
      baseTrades.push({ name: r.name, ...ev, ...res });
    }
  }
  const bN = baseTrades.length;
  console.log(`\n━━━ 기준(baseline, 기존 확정방식) ━━━`);
  console.log(fmtRow('전체', bN, mean(baseTrades.map(t => t.ret)), median(baseTrades.map(t => t.ret)), baseTrades.filter(t => t.ret > 0).length / bN * 100, mean(baseTrades.map(t => t.day))));

  // ── A) 밴드폭 비례 포지션사이징 ──────────────────────────────────────
  console.log(`\n\n=========================================`);
  console.log(`[A] 밴드폭 비례 포지션사이징 (필터 통과셋 n=${bN} 내 연속변수 재검증)`);
  console.log(`=========================================`);
  const bwSorted = [...baseTrades].sort((a, b) => a.bandWidthPct - b.bandWidthPct);
  const tertSize = Math.floor(bN / 3);
  const bwTerts = [
    { label: '하위33%(밴드폭 좁음)', g: bwSorted.slice(0, tertSize) },
    { label: '중위33%', g: bwSorted.slice(tertSize, tertSize * 2) },
    { label: '상위33%(밴드폭 넓음)', g: bwSorted.slice(tertSize * 2) },
  ];
  for (const t of bwTerts) {
    if (!t.g.length) continue;
    console.log(fmtRow(t.label, t.g.length, mean(t.g.map(x => x.ret)), median(t.g.map(x => x.ret)), t.g.filter(x => x.ret > 0).length / t.g.length * 100, mean(t.g.map(x => x.day))));
  }
  // 동일자본 균등가중 vs 밴드폭비례가중 기대수익 비교(가중평균수익률)
  const eqW = mean(baseTrades.map(t => t.ret));
  const totalBw = baseTrades.reduce((a, t) => a + t.bandWidthPct, 0);
  const propW = baseTrades.reduce((a, t) => a + t.bandWidthPct * t.ret, 0) / totalBw;
  console.log(`\n  균등가중 평균수익률: ${eqW >= 0 ? '+' : ''}${eqW.toFixed(2)}%`);
  console.log(`  밴드폭비례가중 평균수익률(가중평균): ${propW >= 0 ? '+' : ''}${propW.toFixed(2)}%`);
  const bwDirection = (bwTerts[2].g.length && bwTerts[0].g.length && mean(bwTerts[2].g.map(x => x.ret)) > mean(bwTerts[0].g.map(x => x.ret))) ? '양(+), 넓을수록 유리' : '음(-) 또는 무관';
  console.log(`  밴드폭-수익률 상관: ${bwDirection}`);

  // ── B) 트레일링 스탑 ──────────────────────────────────────────────
  console.log(`\n\n=========================================`);
  console.log(`[B] 트레일링 스탑 (TP도달 후 전량유지+동적청산, trailPct 스윕)`);
  console.log(`=========================================`);
  console.log(fmtRow('기존(TP 고정청산)', bN, mean(baseTrades.map(t => t.ret)), median(baseTrades.map(t => t.ret)), baseTrades.filter(t => t.ret > 0).length / bN * 100, mean(baseTrades.map(t => t.day))));
  for (const trailPct of [3, 5, 8, 12]) {
    const trades = [];
    for (const r of valid) {
      for (const ev of r.events) {
        const res = simulateTrailing(r.seq, ev, OPTS, trailPct);
        if (!res) continue;
        trades.push({ name: r.name, ...ev, ...res });
      }
    }
    const n = trades.length;
    const reasonCount = {};
    for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
    console.log(fmtRow(`trailPct=${trailPct}%`, n, mean(trades.map(t => t.ret)), median(trades.map(t => t.ret)), trades.filter(t => t.ret > 0).length / n * 100, mean(trades.map(t => t.day))));
    console.log(`    청산사유: ${Object.entries(reasonCount).map(([k, v]) => `${k} ${v}건(${(v/n*100).toFixed(0)}%)`).join(', ')}`);
  }

  // ── C) 멀티타임프레임 컨플루언스(일봉 레벨 vs 주봉 레벨) ──────────────
  console.log(`\n\n=========================================`);
  console.log(`[C] 멀티타임프레임 컨플루언스 (일봉 라운드레벨이 주봉 레벨과도 겹치는지)`);
  console.log(`=========================================`);
  const WINDOW_WEEKS = 30, TARGET_TICKS_WEEKLY = 6;
  const confTrades = [];
  for (const r of valid) {
    const weeklyBars = buildWeeklyBars(r.seq, r.highs, r.lows);
    for (const ev of r.events) {
      const res = simulateFixed(r.seq, ev, OPTS);
      if (!res) continue;
      const stepW = computeWeeklyStepAt(weeklyBars, ev.breachIdx, WINDOW_WEEKS, TARGET_TICKS_WEEKLY);
      let distPct = null;
      if (stepW) {
        const nearestWeeklyLevel = Math.round(ev.level / stepW) * stepW;
        distPct = Math.abs(ev.level - nearestWeeklyLevel) / stepW * 100; // 0%=완전일치, 50%=주봉그리드 중간(가장 먼 지점)
      }
      confTrades.push({ name: r.name, ...ev, ...res, distPct });
    }
  }
  const withConf = confTrades.filter(t => t.distPct != null);
  console.log(`  주봉 그리드 계산 가능 표본: ${withConf.length}건 / 전체 ${confTrades.length}건`);
  const cSorted = [...withConf].sort((a, b) => a.distPct - b.distPct);
  const cTertSize = Math.floor(cSorted.length / 3);
  const cTerts = [
    { label: '상위33%(주봉레벨과 근접)', g: cSorted.slice(0, cTertSize) },
    { label: '중위33%', g: cSorted.slice(cTertSize, cTertSize * 2) },
    { label: '하위33%(주봉레벨과 무관)', g: cSorted.slice(cTertSize * 2) },
  ];
  for (const t of cTerts) {
    if (!t.g.length) continue;
    console.log(fmtRow(t.label, t.g.length, mean(t.g.map(x => x.ret)), median(t.g.map(x => x.ret)), t.g.filter(x => x.ret > 0).length / t.g.length * 100, mean(t.g.map(x => x.day))));
  }

  // ── D) 레벨 신선도(recency) 가중 ────────────────────────────────────
  console.log(`\n\n=========================================`);
  console.log(`[D] 레벨 신선도(recency) — 터치횟수(count)와 별개로 "최근성"이 성과와 연관있는지`);
  console.log(`=========================================`);
  // D-1: 최근30거래일 내 터치가 있었는지(recentTouchCount>0) vs 없었는지
  const recentFresh = baseTrades.filter(t => t.recentTouchCount > 0);
  const recentStale = baseTrades.filter(t => t.recentTouchCount === 0);
  console.log(`  최근30일내 터치 있음(fresh): ${recentFresh.length ? fmtRow('', recentFresh.length, mean(recentFresh.map(t=>t.ret)), median(recentFresh.map(t=>t.ret)), recentFresh.filter(t=>t.ret>0).length/recentFresh.length*100, mean(recentFresh.map(t=>t.day))).trim() : 'n=0'}`);
  console.log(`  최근30일내 터치 없음(stale): ${recentStale.length ? fmtRow('', recentStale.length, mean(recentStale.map(t=>t.ret)), median(recentStale.map(t=>t.ret)), recentStale.filter(t=>t.ret>0).length/recentStale.length*100, mean(recentStale.map(t=>t.day))).trim() : 'n=0'}`);
  // D-2: 마지막 터치 이후 경과일수(ageOfLastTouch) 3분위
  const ageValid = baseTrades.filter(t => t.ageOfLastTouch != null);
  const aSorted = [...ageValid].sort((a, b) => a.ageOfLastTouch - b.ageOfLastTouch);
  const aTertSize = Math.floor(aSorted.length / 3);
  const aTerts = [
    { label: '상위33%(최근터치 신선)', g: aSorted.slice(0, aTertSize) },
    { label: '중위33%', g: aSorted.slice(aTertSize, aTertSize * 2) },
    { label: '하위33%(최근터치 오래됨)', g: aSorted.slice(aTertSize * 2) },
  ];
  console.log(`\n  마지막 터치 경과일수(ageOfLastTouch) 3분위:`);
  for (const t of aTerts) {
    if (!t.g.length) continue;
    console.log(fmtRow(t.label, t.g.length, mean(t.g.map(x => x.ret)), median(t.g.map(x => x.ret)), t.g.filter(x => x.ret > 0).length / t.g.length * 100, mean(t.g.map(x => x.day))));
  }

  const ages = aSorted.map(t => t.ageOfLastTouch);
  const pct = p => ages[Math.floor(p * (ages.length - 1))];
  console.log(`\n  ageOfLastTouch 분포: min=${ages[0]} p10=${pct(0.1)} p25=${pct(0.25)} p33=${pct(0.33)} p50=${pct(0.5)} p67=${pct(0.67)} p75=${pct(0.75)} p90=${pct(0.9)} max=${ages[ages.length-1]}`);
  // D-3: ageOfLastTouch 임계값 스윕 — perDay 변곡점 탐색(신호단위 필터 채택 여부 판단용)
  console.log(`\n  ageOfLastTouch(마지막터치 경과일) 임계값 스윕 — "이 값 이하만 진입" 필터 가정:`);
  for (const maxAge of [0, 1, 2, 3, 5, 7, 10, 20, 30, 40, 60, 90, 120, 150]) {
    const g = ageValid.filter(t => t.ageOfLastTouch <= maxAge);
    if (!g.length) continue;
    console.log(fmtRow(`maxAge<=${maxAge}일`, g.length, mean(g.map(x => x.ret)), median(g.map(x => x.ret)), g.filter(x => x.ret > 0).length / g.length * 100, mean(g.map(x => x.day))));
  }

  console.log(`\n※ 전체 baseline n=${bN}, 각 분석은 동일 이벤트셋 재사용(공정비교)`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
