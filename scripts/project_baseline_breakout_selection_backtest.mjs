// EMA200 기준선 파동 전략 — "돌파확률 기반 종목 선별"이 실제로 도움이 되는지 검증하는
// 자본제약(슬롯) 포트폴리오 백테스트 (2026-08-20 신규, project_baseline_strategy_backtest.mjs의
// 확정 진입·청산 로직을 그대로 재사용해 동일한 트레이드 결과를 만든 뒤, "동시에 여러 종목이
// 신호를 낼 때 한정된 슬롯(자금)으로 어느 종목을 우선 채택할지"를 4가지 정책으로 비교한다.
//
// 배경: project_holdings_ema200_breakout_probability.mjs로 만든 "200EMA 상향돌파 확률"을
// project_baseline_holdings_check.mjs·project_baseline_recent_signals.mjs 화면에 표시만 해뒀는데,
// 이게 실제로 종목 선별(우선순위 결정)에 유의미한지는 검증이 안 됐다는 지적(2026-08-20)에 따라 작성.
//
// 방법:
//   1. project_baseline_strategy_backtest.mjs와 동일한 진입·청산 규칙으로 전체 유니버스의 트레이드를
//      독립적으로 시뮬레이션(entryDate·exitDate·weightedRet·entryZ 확보).
//   2. 각 진입 시점(i0)마다, 그 시점 "이전"(i0 미만) 데이터만 사용한 인과적(causal, lookahead 없음)
//      200EMA 상향돌파 확률(동구간 60거래일)을 추가로 계산 — project_holdings_ema200_breakout_probability.mjs
//      와 동일 로직이지만 전체 이력이 아니라 "그날까지 알 수 있었던 이력"만 사용.
//   3. 진입일(entryDate) 기준으로 트레이드를 모아, 슬롯(동시보유 가능 종목수, 기본5) 제약 아래
//      4가지 정책으로 "그날 어느 후보를 채택할지" 결정하는 포트폴리오 시뮬레이션:
//      - ALL          : 슬롯 제약 없음(전부 채택) — 기존 백테스트와 동일한 상한 참고값
//      - NAIVE        : 무정보 배정(가나다순) — "선별 안 함" 대조군
//      - Z_RANK       : 롤링Z가 더 음수인(더 과매도) 종목을 우선 채택 — 현재 진입조건이 암묵적으로 쓰는 기준
//      - BREAKOUT_RANK: 인과적 동구간 60거래일 돌파확률이 더 높은 종목을 우선 채택(표본 부족시 최하순위)
//   4. 추가로 "경쟁일"(그날 후보수 > 슬롯수)만 따로 모아, 정책별 채택분의 평균수익률을 정적으로도 비교
//      (포트폴리오 상태 이월 효과를 제거한 순수 랭킹 품질 비교).
//
// Usage: node scripts/project_baseline_breakout_selection_backtest.mjs [--slots N] [--min-sample N] [--calendar-days N] [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// project_baseline_strategy_backtest.mjs와 동일 유니버스(시가총액 TOP50, 2026-08-03 KIS 기준)
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
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' }, { code: '018260', name: '삼성에스디에스' },
  { code: '267250', name: 'HD현대' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const ROLL = 250, FAST_PERIOD = 5, BASE_PERIOD = 200;

// project_baseline_strategy_backtest.mjs 확정 기본값 그대로 고정(전략 자체를 바꾸는 게 목적이 아니므로
// CLI로 노출하지 않음 — 슬롯/표본기준/유니버스만 조정 가능)
const STRAT = {
  minStreak: 16, z: -1.25, maxHold: 180, maxBuyLegs: 2, recoverTimeout: 120, postRecoverHold: 60,
  baselineConfirm: 1, baselineBuffer: 0, baselinePartialPct: 100, catchUpBuy: false,
  reboundMode: 'vlow', exitMode: 'full1', baselineBreak: true, maxDaysSinceLow: null,
  maxSignalOccurrence: null, preRecoverEma5ExitFrom: null,
};

const DEV_BUCKETS = [
  { lo: -5,        hi: 0,   label: '0%~-5%' },
  { lo: -10,       hi: -5,  label: '-5%~-10%' },
  { lo: -15,       hi: -10, label: '-10%~-15%' },
  { lo: -20,       hi: -15, label: '-15%~-20%' },
  { lo: -Infinity, hi: -20, label: '-20% 이하' },
];
const BREAKOUT_HORIZONS = [20, 60, 120];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, calendarDays: 2555, slots: 5, minSample: 15 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--slots') o.slots = parseInt(argv[++i]);
    if (argv[i] === '--min-sample') o.minSample = parseInt(argv[++i]);
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
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
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

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

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

function rollingZ(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win);
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / (win.length - 1));
  const v = seq[j].dev200;
  return sd ? (v - m) / sd : 0;
}

// project_baseline_strategy_backtest.mjs buildVLowSignal()와 동일
function buildVLowSignal(seq) {
  const sig = new Array(seq.length).fill(false);
  let runningLow = null;
  let awaitingBounce = false;
  for (let i = 0; i < seq.length; i++) {
    const belowBase = seq[i].close < seq[i].ema200;
    if (!belowBase) { runningLow = null; awaitingBounce = false; continue; }
    if (runningLow === null || seq[i].close < runningLow) { runningLow = seq[i].close; awaitingBounce = true; }
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
    if (crossUp5 && awaitingBounce) { sig[i] = true; awaitingBounce = false; }
  }
  return sig;
}

// project_baseline_strategy_backtest.mjs simulateTrade()와 동일(occIdx 필터·EARLY_EMA5_BREAK 포함)
function simulateTrade(seq, i0, opts, occIdx) {
  let buyCount = 1, costSum = seq[i0].close, openWeight = 1.0;
  let recovered = false, inWaveUp = false, waveCount = 0, minRet = 0, recoverDay = null, belowBaselineStreak = 0;
  const legs = [];
  const preRecoverEma5ExitActive = opts.preRecoverEma5ExitFrom != null && occIdx != null && occIdx >= opts.preRecoverEma5ExitFrom;
  let wasAboveEma5 = seq[i0].close >= seq[i0].ema5;

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close, ema5 = seq[j].ema5, ema200 = seq[j].ema200;

    if (!recovered) {
      const conditionMet = seq[j].bounce && rollingZ(seq, j) <= opts.z;
      if (buyCount < opts.maxBuyLegs && conditionMet) { buyCount += 1; costSum += close; }
      if (preRecoverEma5ExitActive) {
        const nowAboveEma5 = close >= ema5;
        const avgCostEarly = costSum / buyCount;
        const retEarly = (close - avgCostEarly) / avgCostEarly * 100;
        if (retEarly < minRet) minRet = retEarly;
        if (wasAboveEma5 && !nowAboveEma5 && retEarly > 0) {
          legs.push({ weight: openWeight, ret: retEarly, reason: 'EARLY_EMA5_BREAK', day: d, date: seq[j].date });
          return { legs, weightedRet: retEarly, finalDay: d, entryDate: seq[i0].date, recovered, minRet };
        }
        wasAboveEma5 = nowAboveEma5;
      }
    }
    if (!recovered && close >= ema200 && opts.catchUpBuy && buyCount < opts.maxBuyLegs) {
      const remaining = opts.maxBuyLegs - buyCount;
      costSum += close * remaining;
      buyCount = opts.maxBuyLegs;
    }
    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;
    if (ret < minRet) minRet = ret;

    if (!recovered) {
      if (close >= ema200) { recovered = true; recoverDay = d; waveCount = 1; inWaveUp = close >= ema5; }
      else if (d >= opts.recoverTimeout) {
        legs.push({ weight: openWeight, ret, reason: 'RECOVER_TIMEOUT', day: d, date: seq[j].date });
        openWeight = 0; break;
      }
    } else {
      if (opts.baselineBreak) {
        const baselineThreshold = ema200 * (1 - opts.baselineBuffer / 100);
        belowBaselineStreak = close < baselineThreshold ? belowBaselineStreak + 1 : 0;
        if (belowBaselineStreak >= opts.baselineConfirm) {
          const sellFrac = Math.min(1, opts.baselinePartialPct / 100);
          const w = openWeight * sellFrac;
          legs.push({ weight: w, ret, reason: 'BASELINE_BREAK', day: d, date: seq[j].date });
          openWeight -= w; belowBaselineStreak = 0;
          if (openWeight <= 1e-9) { openWeight = 0; break; }
          continue;
        }
      }
      if (inWaveUp && close < ema5) {
        inWaveUp = false;
        if (opts.exitMode === 'full1') {
          legs.push({ weight: openWeight, ret, reason: 'WAVE1_FULL', day: d, date: seq[j].date });
          openWeight = 0; break;
        } else if (waveCount === 1) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE1', day: d, date: seq[j].date });
          openWeight -= w;
        } else if (waveCount === 2) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE2', day: d, date: seq[j].date });
          openWeight -= w;
        } else {
          legs.push({ weight: openWeight, ret, reason: 'WAVE3', day: d, date: seq[j].date });
          openWeight = 0; break;
        }
      } else if (!inWaveUp && close >= ema5) { inWaveUp = true; waveCount += 1; }
      if (openWeight > 1e-9 && d - recoverDay >= opts.postRecoverHold) {
        legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
        openWeight = 0; break;
      }
    }
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;
  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalDay = legs[legs.length - 1].day;
  return { legs, weightedRet, finalDay, entryDate: seq[i0].date, recovered, minRet };
}

function bucketOf(dev) { return DEV_BUCKETS.find(b => dev > b.lo && dev <= b.hi) || DEV_BUCKETS[DEV_BUCKETS.length - 1]; }

function computeDaysToCross(prefixSeq) {
  const n = prefixSeq.length;
  const nextAboveIdx = new Array(n).fill(null);
  let nearest = null;
  for (let i = n - 1; i >= 0; i--) {
    if (prefixSeq[i].close >= prefixSeq[i].ema200) nearest = i;
    nextAboveIdx[i] = nearest;
  }
  return prefixSeq.map((r, i) => {
    if (r.close >= r.ema200) return null;
    const j = i + 1 < n ? nextAboveIdx[i + 1] : null;
    return j != null ? j - i : Infinity;
  });
}

function probAtHorizon(samples, h) {
  let success = 0, denom = 0;
  for (const s of samples) {
    if (s.daysToCross <= h) { success++; denom++; }
    else if (s.remain >= h) { denom++; }
  }
  return { p: denom ? success / denom * 100 : null, n: denom };
}

// 인과적(lookahead 없음) 돌파확률: prefixSeq(= seq.slice(0, i0), 즉 진입일 이전 데이터)만으로
// 과거 "하회 상태였던 날"을 표본화하고, 진입일 당일 dev(curDev)로 구간을 정한다.
function causalBreakoutProbability(prefixSeq, curDev) {
  const n = prefixSeq.length;
  const daysToCross = computeDaysToCross(prefixSeq);
  const belowSamples = [];
  for (let i = 0; i < n; i++) {
    if (prefixSeq[i].close >= prefixSeq[i].ema200) continue;
    belowSamples.push({ dev: prefixSeq[i].dev200, daysToCross: daysToCross[i], remain: n - 1 - i });
  }
  const curBucket = bucketOf(curDev);
  const sameBucketSamples = belowSamples.filter(s => s.dev > curBucket.lo && s.dev <= curBucket.hi);
  const byBucket = {};
  for (const h of BREAKOUT_HORIZONS) byBucket[h] = probAtHorizon(sameBucketSamples, h);
  return { curBucket, byBucket };
}

async function backtestStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - STRAT_CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', events: [] };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i], dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100 });
  }
  if (seq.length < ROLL + STRAT.minStreak + STRAT.maxHold + 1) return { ...stock, error: '데이터 부족', events: [] };

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  const bounceSig = buildVLowSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    flags[i] = streak[i] >= STRAT.minStreak && seq[i].bounce && rollingZ(seq, i) <= STRAT.z;
  }
  const eventIdxs = [];
  for (let i = ROLL - 1; i < seq.length; i++) if (flags[i] && !flags[i - 1]) eventIdxs.push(i);

  const events = [];
  for (let k = 0; k < eventIdxs.length; k++) {
    const i0 = eventIdxs[k];
    const t = simulateTrade(seq, i0, STRAT, k + 1);
    if (!t) continue; // 미확정(최근 신호) 제외
    const entryZ = rollingZ(seq, i0);
    const breakout = causalBreakoutProbability(seq.slice(0, i0), seq[i0].dev200);
    events.push({
      name: stock.name, code: stock.code, entryDate: t.entryDate,
      exitDate: seq[i0 + t.finalDay].date, weightedRet: t.weightedRet, entryZ, breakout,
    });
  }
  return { ...stock, events, totalRaw: eventIdxs.length };
}

let STRAT_CALENDAR_DAYS = 2555;

function summarize(list) {
  if (!list.length) return { n: 0, avg: null, win: null };
  const rets = list.map(e => e.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const zs = list.map(e => e.entryZ);
  const bos = list.map(e => e.breakout.byBucket[60].p).filter(p => p != null);
  return { n: rets.length, avg: mean(rets), win, avgZ: mean(zs), avgBreakout60: bos.length ? mean(bos) : null };
}

// 슬롯 제약 포트폴리오 시뮬레이션: 진입일 순서로 처리, 그날 만료(exitDate<=date)된 슬롯을 먼저 반납한 뒤
// 남은 슬롯만큼 rankFn이 매긴 우선순위대로 채택. 초과분은 그날 탈락(대기열 없음 — 신호는 반등형이라
// 재진입까지 기다리는 게 실전과 다르므로 단순 드롭).
function runPortfolio(events, slots, rankFn) {
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.entryDate)) byDate.set(e.entryDate, []);
    byDate.get(e.entryDate).push(e);
  }
  const dates = [...byDate.keys()].sort();
  let openExitDates = [];
  const admitted = [], rejected = [];
  for (const date of dates) {
    openExitDates = openExitDates.filter(exitDate => exitDate > date);
    const candidates = byDate.get(date);
    const freeSlots = slots - openExitDates.length;
    if (freeSlots <= 0) { rejected.push(...candidates); continue; }
    const ranked = rankFn(candidates);
    const admit = ranked.slice(0, freeSlots);
    const reject = ranked.slice(freeSlots);
    for (const e of admit) openExitDates.push(e.exitDate);
    admitted.push(...admit);
    rejected.push(...reject);
  }
  return { admitted, rejected };
}

function rankZ(cands) { return [...cands].sort((a, b) => a.entryZ - b.entryZ); }
function rankNaive(cands) { return [...cands].sort((a, b) => a.name.localeCompare(b.name, 'ko')); }
function makeRankBreakout(minSample) {
  return cands => [...cands].sort((a, b) => {
    const sa = a.breakout.byBucket[60].n >= minSample ? a.breakout.byBucket[60].p : -1;
    const sb = b.breakout.byBucket[60].n >= minSample ? b.breakout.byBucket[60].p : -1;
    return sb - sa;
  });
}

function fmtPct(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

async function main() {
  const opts = parseArgs();
  STRAT_CALENDAR_DAYS = opts.calendarDays;
  console.error(`[돌파확률 기반 종목선별 백테스트] ${opts.stocks.length}종목, 슬롯=${opts.slots}(동시보유 최대), 표본기준(min-sample)=${opts.minSample}, 기간 ${opts.calendarDays}일`);
  console.error(`진입·청산 로직은 project_baseline_strategy_backtest.mjs 확정 기본값 그대로(전략 변경 없음) — 오직 "동시신호 시 어느 종목을 채택할지"만 비교`);

  const results = await batchAll(opts.stocks, backtestStock);
  const errors = results.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);
  const allEvents = results.flatMap(r => r.events || []);
  console.log(`\n전체 유효 트레이드(미확정 최근신호 제외): ${allEvents.length}건`);

  const rankBreakout = makeRankBreakout(opts.minSample);

  console.log(`\n━━━ 정책별 포트폴리오 시뮬레이션(슬롯=${opts.slots}) ━━━`);
  const allSummary = summarize(allEvents);
  console.log(`ALL(무제한, 참고상한)   n=${allSummary.n}  평균수익률 ${fmtPct(allSummary.avg)}  승률 ${allSummary.win.toFixed(0)}%`);

  const policies = [
    ['NAIVE(가나다순, 무선별)', rankNaive],
    ['Z_RANK(과매도 우선)', rankZ],
    ['BREAKOUT_RANK(돌파확률 우선)', rankBreakout],
  ];
  for (const [label, rankFn] of policies) {
    const { admitted, rejected } = runPortfolio(allEvents, opts.slots, rankFn);
    const s = summarize(admitted);
    console.log(`${label.padEnd(26)} n=${String(s.n).padStart(4)}  평균수익률 ${fmtPct(s.avg).padStart(8)}  승률 ${s.win.toFixed(0).padStart(3)}%  평균Z ${s.avgZ.toFixed(2)}  평균돌파확률(60D) ${s.avgBreakout60 != null ? s.avgBreakout60.toFixed(0) + '%' : '─'}  (탈락 ${rejected.length}건)`);
  }

  // 경쟁일(그날 후보수 > 슬롯수)만 따로 — 포트폴리오 상태 이월 효과를 제거한 정적 랭킹 품질 비교
  const byDate = new Map();
  for (const e of allEvents) { if (!byDate.has(e.entryDate)) byDate.set(e.entryDate, []); byDate.get(e.entryDate).push(e); }
  const contestedDates = [...byDate.entries()].filter(([, cands]) => cands.length > opts.slots);
  console.log(`\n━━━ 경쟁일 정적 비교(그날 후보 ${opts.slots}종목 초과 발생일 ${contestedDates.length}일, 포트폴리오 이월효과 배제) ━━━`);
  if (!contestedDates.length) {
    console.log(`해당 없음(슬롯=${opts.slots}을 넘는 동시신호일이 없었음 — 슬롯을 줄이거나 유니버스를 늘려 재시도)`);
  } else {
    const zPicked = [], boPicked = [], allContested = [];
    for (const [, cands] of contestedDates) {
      allContested.push(...cands);
      zPicked.push(...rankZ(cands).slice(0, opts.slots));
      boPicked.push(...rankBreakout(cands).slice(0, opts.slots));
    }
    const sAll = summarize(allContested), sZ = summarize(zPicked), sBo = summarize(boPicked);
    console.log(`  해당일 전체 후보(선별 안 함) n=${sAll.n}  평균수익률 ${fmtPct(sAll.avg)}  승률 ${sAll.win.toFixed(0)}%`);
    console.log(`  Z_RANK가 그날 뽑았을 상위${opts.slots}       n=${sZ.n}  평균수익률 ${fmtPct(sZ.avg)}  승률 ${sZ.win.toFixed(0)}%`);
    console.log(`  BREAKOUT_RANK가 그날 뽑았을 상위${opts.slots}  n=${sBo.n}  평균수익률 ${fmtPct(sBo.avg)}  승률 ${sBo.win.toFixed(0)}%`);
  }

  console.log(`\n※ 슬롯 제약 시뮬레이션은 진입일 순서로 처리하며, 그날 채택되지 못한 신호는 대기열 없이 즉시 탈락(반등형 신호 특성상 재진입 대기가 비현실적이라 드롭 처리).`);
  console.log(`※ 돌파확률은 각 진입 시점 "이전" 데이터만 사용한 인과적(lookahead 없음) 값 — 표본(n)이 min-sample(${opts.minSample}) 미만이면 랭킹에서 최하순위로 처리.`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
