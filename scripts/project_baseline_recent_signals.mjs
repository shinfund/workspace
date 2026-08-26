// EMA200 기준선 파동 전략(stock-baseline) — "최근신호"·"예상종목" 탭용 라이브 데이터 생성 스크립트 (2026-08-13)
// project_baseline_strategy_backtest.mjs(확정 진입·청산 로직)와 동일한 규칙을 실시간(오늘 기준)으로 적용해
// ①최근 365일 내 발생한 진입 신호의 현재 상태(보유중/청산완료)와 ②아직 신호는 안 났지만 조건①(16거래일↑
// 기준선 이탈)을 충족한 관찰(워치) 후보종목을 산출해 HTML 조각 + JSON으로 출력한다.
// 사용법: node scripts/project_baseline_recent_signals.mjs [--days 365] [--chart-cap 10] [--watch-cap 8]
import https from 'https';
import fs from 'fs';
import { getToken as getKisToken, fetchKisPrice, fetchKrxUniverse } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const KOSPI_SIZE = 50, KOSDAQ_SIZE = 20;

// KRX 조회 실패 시에만 사용하는 폴백 유니버스(2026-08-19 KRX 기준 스냅샷, ETF·우선주 제외)
// 2026-08-19: 코스피/코스닥은 시장 성격(변동성 등)이 달라 "최근신호" 탭을 KS/KQ 두 탭으로 분리하면서
// 유니버스도 통합랭킹(top50) 대신 코스피 전용 TOP50 / 코스닥 전용 TOP20으로 나눴다(사용자 확정 —
// 진단 결과 TOP20이 컷오프 전 구간 중 가중평균 최고(+15.60%, n=122)라 표본을 더 늘릴 이유가 없었음).
// FALLBACK_KOSDAQ은 TOP30까지 넉넉히 보관하고 실제 사용 시 KOSDAQ_SIZE만큼만 잘라 쓴다.
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' }, { code: '214370', name: '케어젠', market: 'KOSDAQ' }, { code: '310210', name: '보로노이', market: 'KOSDAQ' }, { code: '145020', name: '휴젤', market: 'KOSDAQ' }, { code: '084370', name: '유진테크', market: 'KOSDAQ' }, { code: '131290', name: '티에스이', market: 'KOSDAQ' }, { code: '257720', name: '실리콘투', market: 'KOSDAQ' }, { code: '095610', name: '테스', market: 'KOSDAQ' }, { code: '080220', name: '제주반도체', market: 'KOSDAQ' }, { code: '319400', name: '현대무벡스', market: 'KOSDAQ' }, { code: '064760', name: '티씨케이', market: 'KOSDAQ' },
];

// 매 실행마다 KRX 전일 시총 기준으로 코스피/코스닥을 각각 새로 산출한다(2026-08-19, 통합랭킹 폐지).
// project_baseline_strategy_backtest.mjs의 백테스트는 재현성을 위해 2026-08-03 스냅샷 유니버스를 계속 유지한다.
async function buildKospiUniverse() {
  try {
    const { kospi, basDt } = await fetchKrxUniverse();
    const top = kospi.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSPI_SIZE)
      .map(s => ({ code: s.종목코드, name: s.종목명 }));
    console.error(`[유니버스] 코스피 시총 TOP${KOSPI_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스피 폴백 스냅샷 사용`);
    return FALLBACK_KOSPI;
  }
}
async function buildKosdaqUniverse() {
  try {
    const { kosdaq, basDt } = await fetchKrxUniverse();
    const top = kosdaq.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSDAQ_SIZE)
      .map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSDAQ' }));
    console.error(`[유니버스] 코스닥 시총 TOP${KOSDAQ_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스닥 폴백 스냅샷 사용`);
    return FALLBACK_KOSDAQ.slice(0, KOSDAQ_SIZE);
  }
}

const ROLL = 250, MIN_STREAK = 16, Z_THRESHOLD = -1.25;
const FAST_PERIOD = 5, BASE_PERIOD = 200;
const MAX_BUY_LEGS = 2, RECOVER_TIMEOUT = 120, POST_RECOVER_HOLD = 60;
const SL_PCT = 25; // 2026-08-26 확정: 평단가 대비 -25% 손절(최우선 안전장치). project_baseline_strategy_backtest.mjs와 동일값
const CALENDAR_DAYS = 2555; // ROLL(250) 워밍업 + minStreak + 7년치 확보(백테스트와 동일)
const CHART_LEAD_DAYS = 15;

// ─── 200EMA 상향돌파 확률(2026-08-20 추가, project_baseline_holdings_check.mjs와 동일 로직) ──────
// 예상종목(워치) 탭에서 스트릭·Z조건이 같은 후보들 사이에 우선순위를 매길 때 참고 — 이미 위에서
// 불러온 seq(7년치)를 그대로 재사용, 추가 API 호출 없음.
const DEV_BUCKETS = [
  { lo: -5,        hi: 0,   label: '0%~-5%' },
  { lo: -10,       hi: -5,  label: '-5%~-10%' },
  { lo: -15,       hi: -10, label: '-10%~-15%' },
  { lo: -20,       hi: -15, label: '-15%~-20%' },
  { lo: -Infinity, hi: -20, label: '-20% 이하' },
];
const BREAKOUT_HORIZONS = [20, 60, 120];

function bucketOf(dev) { return DEV_BUCKETS.find(b => dev > b.lo && dev <= b.hi) || DEV_BUCKETS[DEV_BUCKETS.length - 1]; }

function computeDaysToCross(seq) {
  const n = seq.length;
  const nextAboveIdx = new Array(n).fill(null);
  let nearest = null;
  for (let i = n - 1; i >= 0; i--) {
    if (seq[i].close >= seq[i].ema200) nearest = i;
    nextAboveIdx[i] = nearest;
  }
  return seq.map((r, i) => {
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

function breakoutProbability(seq) {
  const n = seq.length;
  const daysToCross = computeDaysToCross(seq);
  const belowSamples = [];
  for (let i = 0; i < n; i++) {
    if (seq[i].close >= seq[i].ema200) continue;
    belowSamples.push({ dev: seq[i].dev200, daysToCross: daysToCross[i], remain: n - 1 - i });
  }
  const cur = seq[n - 1];
  const curBelow = cur.close < cur.ema200;
  const curBucket = curBelow ? bucketOf(cur.dev200) : null;
  const sameBucketSamples = curBucket ? belowSamples.filter(s => s.dev > curBucket.lo && s.dev <= curBucket.hi) : [];
  const overall = {}, byBucket = {};
  for (const h of BREAKOUT_HORIZONS) { overall[h] = probAtHorizon(belowSamples, h); byBucket[h] = probAtHorizon(sameBucketSamples, h); }
  return { curBucket, overall, byBucket };
}
function fmtProb(p) { return p.p != null ? `${p.p.toFixed(0)}%(n=${p.n})` : '─'; }

// ─── KIS API (당일 현재가 — 장중 Yahoo가 전일종가로 지연되는 문제 보완) ──────────────────
// 인증·시세조회 함수는 kis_api.mjs에서 그대로 가져다 쓴다(자격증명 중복 방지).
async function fetchKisPriceMap(stocks) {
  let token;
  try { token = await getKisToken(); } catch (e) {
    console.error(`[KIS] 토큰 실패: ${e.message} → 당일 현재가는 Yahoo 값 사용`);
    return new Map();
  }
  const map = new Map();
  const BATCH = 5, DELAY_KIS = 200;
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(s => fetchKisPrice(token, s.code)));
    batch.forEach((s, j) => { if (res[j] && res[j].현재가 > 0) map.set(s.code, res[j].현재가); });
    if (i + BATCH < stocks.length) await new Promise(r => setTimeout(r, DELAY_KIS));
  }
  console.error(`[KIS] 당일 현재가 ${map.size}/${stocks.length}종목 확보`);
  return map;
}

function kstTodayDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { recentDays: 365, chartCap: 10, watchCap: 8 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.recentDays = parseInt(argv[++i]);
    if (argv[i] === '--chart-cap') o.chartCap = parseInt(argv[++i]);
    if (argv[i] === '--watch-cap') o.watchCap = parseInt(argv[++i]);
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
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
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
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }

// 반등신호(2026-08-14 vlow로 전환, 2026-08-14 3차수정: HD현대중공업 사례로 발견된 버그 수정 —
// 스트릭 minStreak 도달 시점 리셋은 리셋 시점에 이미 반등 중이면 그날 종가를 가짜 저점으로 오인해
// 더 얕은 반등에도 신호를 냄. belowBase 진입 시점부터 종가 기준 최저점을 리셋 없이 계속 추적하도록
// 되돌림 — 상세 근거는 project_baseline_strategy_backtest.mjs buildVLowSignal() 주석 참조) —
// backtest 스크립트와 동일 로직
function buildVLowSignal(seq) {
  const sig = new Array(seq.length).fill(false);
  let runningLow = null;
  let awaitingBounce = false;
  for (let i = 0; i < seq.length; i++) {
    const belowBase = seq[i].close < seq[i].ema200;
    if (!belowBase) { runningLow = null; awaitingBounce = false; continue; }
    if (runningLow === null || seq[i].close < runningLow) {
      runningLow = seq[i].close;
      awaitingBounce = true;
    }
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
    if (crossUp5 && awaitingBounce) {
      sig[i] = true;
      awaitingBounce = false;
    }
  }
  return sig;
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

function rollingZStats(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j].dev200;
  return { z: sd ? (v - m) / sd : 0, mean: m, sd };
}

// 백테스트(project_baseline_strategy_backtest.mjs simulateTrade)와 동일 규칙을 "오늘"까지 실행해
// 진행 중(OPEN, 아직 미종결)이면 현재 상태를, 종결됐으면(CLOSED) 최종 사유를 반환한다.
function simulateLiveStatus(seq, i0) {
  let buyCount = 1;
  let costSum = seq[i0].close;
  let openWeight = 1.0;
  let recovered = false;
  let inWaveUp = false;
  let waveCount = 0;
  let minRet = 0;
  let recoverDay = null;
  const legs = [];
  const buyLog = [{ day: 0, price: seq[i0].close }];
  const signalLog = [{ day: 0, price: seq[i0].close }]; // 2026-08-14: max-buy-legs 상한 무관, 조건①②③ 충족일 전부 기록
  const lastIdx = seq.length - 1;

  for (let d = 1; ; d++) {
    const j = i0 + d;
    if (j > lastIdx) {
      const cur = seq[lastIdx];
      const avgCost = costSum / buyCount;
      const curRet = (cur.close - avgCost) / avgCost * 100;
      const closedWeighted = legs.reduce((a, l) => a + l.weight * l.ret, 0);
      const weightedSoFar = closedWeighted + openWeight * curRet;
      return {
        status: 'OPEN', day: lastIdx - i0, ret: weightedSoFar, legs, buyCount, buyLog, signalLog,
        recovered, waveCount, inWaveUp, minRet, recoverDay, avgCost, curClose: cur.close,
      };
    }
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema200 = seq[j].ema200;

    if (!recovered) {
      const conditionMet = seq[j].bounce && rollingZStats(seq, j).z <= Z_THRESHOLD;
      if (conditionMet) signalLog.push({ day: d, price: close });
      if (buyCount < MAX_BUY_LEGS && conditionMet) {
        buyCount += 1;
        costSum += close;
        buyLog.push({ day: d, price: close });
      }
    }

    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;
    if (ret < minRet) minRet = ret;

    // 손절(-25%, 2026-08-26 확정) — 회복 전/후 무관 최우선. project_baseline_strategy_backtest.mjs와 동일 로직
    if (ret <= -SL_PCT) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d, date: seq[j].date });
      openWeight = 0;
      return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'SL', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
    }

    if (!recovered) {
      if (close >= ema200) {
        recovered = true;
        recoverDay = d;
        waveCount = 1;
        inWaveUp = close >= ema5;
      } else if (d >= RECOVER_TIMEOUT) {
        legs.push({ weight: openWeight, ret, reason: 'RECOVER_TIMEOUT', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'RECOVER_TIMEOUT', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
    } else {
      if (close < ema200) {
        legs.push({ weight: openWeight, ret, reason: 'BASELINE_BREAK', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'BASELINE_BREAK', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
      if (inWaveUp && close < ema5) {
        inWaveUp = false;
        legs.push({ weight: openWeight, ret, reason: 'WAVE1_FULL', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'WAVE1_FULL', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      } else if (!inWaveUp && close >= ema5) {
        inWaveUp = true;
        waveCount += 1;
      }
      if (openWeight > 1e-9 && d - recoverDay >= POST_RECOVER_HOLD) {
        legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'TIME', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
    }
  }
}

async function loadStock(stock, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i],
      dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100,
    });
  }
  if (seq.length < ROLL + MIN_STREAK + 1) return { ...stock, error: '데이터 부족', seq: null };

  // 장중에는 Yahoo의 "오늘" 캔들이 전일종가로 지연 반영되는 경우가 있어, 오늘 날짜 마지막 봉은
  // KIS 당일 현재가로 덮어써서 최근신호 탭의 "현재가"가 실시간에 가깝게 표시되도록 보정한다.
  const lastIdx = seq.length - 1;
  if (seq[lastIdx].date === todayDate && kisMap?.has(stock.code)) {
    const live = kisMap.get(stock.code);
    seq[lastIdx].close = live;
    seq[lastIdx].dev200 = (live - seq[lastIdx].ema200) / seq[lastIdx].ema200 * 100;
  }

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }

  const bounceSig = buildVLowSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const streakOk = streak[i] >= MIN_STREAK;
    const z = rollingZStats(seq, i).z;
    flags[i] = streakOk && seq[i].bounce && z <= Z_THRESHOLD;
  }
  const entries = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) entries.push({ i, date: seq[i].date });
  }
  const breakout = breakoutProbability(seq);
  return { ...stock, seq, streak, entries, breakout };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function retClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

const REASON_LABEL = {
  SL: { cls: 'bdg-red', label: `손절매도(-${SL_PCT}%)` },
  BASELINE_BREAK: { cls: 'bdg-red', label: '기준선이탈매도' },
  RECOVER_TIMEOUT: { cls: 'bdg-purple', label: '회복실패시간청산' },
  TIME: { cls: 'bdg-purple', label: '회복후시간청산' },
  WAVE1_FULL: { cls: 'bdg-sky', label: '1파매도(전량)' },
};

// 2026-08-18: CLOSED 상태(기준선이탈매도·1파매도 등)는 발생일자가 없으면 표에서 언제 청산됐는지
// 알 수 없다는 피드백 → legs의 마지막 항목(청산 확정 레그) 날짜를 뱃지에 같이 표기
// 2026-08-18(정정): "기준선돌파" 태그를 recovered=true인 한 영구히 표시했더니, 며칠 전 회복한 종목의
// "상태"에 오늘도 계속 "기준선돌파"가 붙어 마치 오늘 막 돌파한 것처럼 보이는 문제 발생(사용자 지적).
// "기준선돌파"는 그 날짜의 상태이지 오늘의 상태가 아님 — 회복일이 데이터상 마지막 거래일(오늘/최신가
// 기준일=todayDate)과 같을 때만("오늘 막 돌파") 태그를 붙이고, 그 다음날부터는 그냥 "보유중"만 표기.
// CLOSED는 정의상 회복(recoverDay) 이후 최소 하루 뒤에 청산되므로 이 조건에서 태그가 뜨는 일이 없음
// (=청산된 건은 항상 뱃지+청산일자만 표기, 회복시점은 별도 표기하지 않음).
function statusInfo(row, todayDate) {
  let primary;
  let closeDate = null;
  if (row.status === 'OPEN') {
    primary = { cls: 'bdg-teal', label: '보유중' };
  } else {
    primary = REASON_LABEL[row.finalReason] || { cls: 'bdg-gray', label: row.finalReason };
    closeDate = row.legs?.length ? row.legs[row.legs.length - 1].date : null;
  }
  const recoverTag = row.status === 'OPEN' && row.recovered && row.recoverDate === todayDate ? `기준선돌파 ${row.recoverDate}` : '';
  const subBadges = '';
  let note = '';
  if (row.status === 'OPEN') {
    if (!row.recovered) note = `<span style="color:var(--txt3);font-size:12.5px">(회복 전 · 매수${row.buyCount}/${MAX_BUY_LEGS}회)</span>`;
    else {
      // 2026-08-19: "경과"(D+N) 컬럼은 진입일 기준이라, 회복 후 시간청산(POST_RECOVER_HOLD=60거래일)은
      // 회복일 기준으로 별도로 도는 시계라는 걸 표에서 알기 어렵다는 지적(사용자) — 회복 후 경과일수를
      // "회복D+N/60"으로 병기해 60일 룰까지 남은 거리를 바로 보이게 함.
      const daysSinceRecover = row.day - row.recoverDay;
      note = `<span style="color:var(--txt3);font-size:12.5px">(회복후 보유100% · 회복D+${daysSinceRecover}/${POST_RECOVER_HOLD} · 1파 진행중)</span>`;
    }
  }
  const day = row.status === 'OPEN' ? row.day : row.finalDay;
  return { primary, subBadges, note, day, closeDate, recoverTag };
}

// 2026-08-18: 상태 뱃지+회복시점+청산일자를 시간순으로 배열 — OPEN 상태에서 "오늘" 막 회복한 경우에만
// "기준선돌파 날짜"(이벤트) → "보유중"(현재 상태) 순으로 보여줌(recoverTag는 statusInfo에서 오늘 회복한
// 경우로 이미 필터링됨). CLOSED는 recoverTag가 항상 빈 값이라 뱃지+청산일자만 표기.
function badgeGroup(s) {
  const wrap = text => `<span style="color:var(--txt3);font-size:12.5px">${text}</span>`;
  const badge = `<span class="badge ${s.primary.cls}">${s.primary.label}</span>`;
  const parts = s.recoverTag
    ? [wrap(s.recoverTag), badge]
    : [badge, s.closeDate ? wrap(s.closeDate) : ''];
  if (s.subBadges) parts.push(s.subBadges.trim());
  return parts.filter(Boolean).join('&nbsp;');
}

// 2026-08-14: max-buy-legs(2회) 상한과 무관하게 조건①②③ 충족일 전체를 표시 — 실제 체결된 건(굵게)과
// 상한 초과로 신호만 발생하고 체결되지 않은 건(연하게 "신호만")을 구분 표기
function signalDatesLabel(signalDates) {
  if (!signalDates || signalDates.length < 1) return '';
  const legLabel = { 1: '1차', 2: '2차', 3: '3차', 4: '4차', 5: '5차', 6: '6차' };
  const parts = signalDates.map(b => {
    const tag = legLabel[b.leg] || `${b.leg}차`;
    return b.executed
      ? `${tag} ${b.date}(${fmtV(b.price)})`
      : `<span style="opacity:.65">${tag}(신호만) ${b.date}(${fmtV(b.price)})</span>`;
  });
  return `<div style="color:var(--txt3);font-size:12.5px;margin-top:3px">신호: ${parts.join(' &middot; ')}</div>`;
}

// 2026-08-20: "돌파확률" 컬럼(회복 전이면 돌파확률 추정치, 회복됐으면 실제 돌파소요일수, 미회복 청산이면
// "미돌파") — 회복 전(OPEN·미회복)만 예측(확률)이고 나머지는 이미 결과가 확정된 실측값이라 성격이 다름을
// 셀 표기(퍼센트 vs D+N vs 텍스트)로 구분한다. 사용자 요청(2026-08-20): 최근신호 탭도 예상종목·보유종목과
// 동일하게 돌파확률을 보여주되, 청산완료 행은 예측이 아니라 실제 돌파기간/미돌파로 표기.
function recentSignalBreakoutCellHtml(row) {
  if (row.recovered) {
    return `<span title="진입 후 실제 기준선(EMA200) 돌파까지 걸린 거래일수">D+${row.recoverDay}</span>`;
  }
  if (row.status === 'CLOSED') {
    return `<span class="t-neg">미돌파</span>`; // 회복 못하고 RECOVER_TIMEOUT으로 청산된 경우
  }
  const b = row.breakout?.curBucket ? row.breakout.byBucket[60] : null;
  if (!b) return '<span class="t-flat">&mdash;</span>';
  return b.p != null
    ? `<span title="괴리율구간 ${esc(row.breakout.curBucket.label)}, 표본 n=${b.n}">${b.p.toFixed(0)}%</span>`
    : '<span class="t-flat">표본부족</span>';
}

// 2026-08-14: "진행상황" 단일 컬럼에 상태·경과일·수익률·매수현황·신호일자가 다 뭉쳐 있어 컬럼 분리(사용자 요청)
// 2026-08-18: "상태" 뱃지만으로는 현재 기준선(EMA200) 위/아래 위치를 알기 어렵다는 피드백 → 괴리율(dev200,
// 현재가 기준) 컬럼 추가. 부호(+/-)가 그대로 기준선 위/아래를 나타내고 수치까지 보여줘 별도 위/아래
// 뱃지보다 정보량이 많음(예상종목 탭과 표현방식 통일)
function tableRowHtml(row, seq) {
  const cur = seq[seq.length - 1];
  const s = statusInfo(row, cur.date);
  const statusCell = badgeGroup(s);
  const noteCell = s.note ? s.note.replace(/^<span/, '<span').trim() : '<span class="t-flat">&mdash;</span>';
  const signalCell = row.signalDates && row.signalDates.length ? signalDatesLabel(row.signalDates).replace(/^<div[^>]*>|<\/div>$/g, '') : '<span class="t-flat">&mdash;</span>';
  return `          <tr><td class="l">${row.date}</td><td class="l">${esc(row.name)}</td><td>${fmtV(cur.close)}</td><td class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</td><td>${fmtV(row.entryClose)}</td><td class="l">${statusCell}</td><td class="c">D+${s.day}</td><td class="c">${recentSignalBreakoutCellHtml(row)}</td><td class="${retClass(row.ret)}">${fmt(row.ret)}</td><td class="l">${noteCell}</td><td class="l">${signalCell}</td></tr>`;
}

function buildChartSvg(rows, markers) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema200));
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema200', 'amber', '6,3', 1.8) + poly('ema5', 'sky', '6,3', 1.8) + poly('close', 'txt', null, 1.7);
  if (markers?.entryIdx != null && markers.entryIdx >= 0) {
    const ei = markers.entryIdx;
    const entryY = yAt(rows[ei].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
    svg += `<line x1="${xAt(ei).toFixed(1)}" y1="${yTop}" x2="${xAt(ei).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<circle cx="${xAt(ei).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  if (markers?.buyLog) {
    for (const b of markers.buyLog) {
      if (b.day === 0) continue; // 최초 매수는 entryIdx 점으로 이미 표시
      // 2026-08-18 버그수정: markers.entryIdx는 이미 windowStart 기준 로컬 인덱스라 여기서 windowStart를
      // 다시 빼면 이중차감되어 인덱스가 음수로 튀어 range체크(idx>=0)에서 항상 걸러짐 — 2차 이상
      // 추가매수 마커가 전혀 표시되지 않던 원인. b.day는 진입일 기준 경과거래일수 = 행 오프셋과 동일하므로
      // entryIdx에 그대로 더하기만 하면 됨.
      const idx = markers.entryIdx + b.day;
      if (idx >= 0 && idx < n) {
        const buyY = yAt(rows[idx].close).toFixed(1);
        svg += `<line x1="${x0}" y1="${buyY}" x2="${x1}" y2="${buyY}" stroke="var(--purple)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
        svg += `<line x1="${xAt(idx).toFixed(1)}" y1="${yTop}" x2="${xAt(idx).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
        svg += `<circle cx="${xAt(idx).toFixed(1)}" cy="${buyY}" r="3.5" fill="var(--purple)" stroke="var(--card)" stroke-width="1"/>`;
      }
    }
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function signalChartCardHtml(row, seq, entryIdx) {
  const windowStart = Math.max(0, entryIdx - CHART_LEAD_DAYS);
  const chartRows = seq.slice(windowStart, seq.length);
  const localEntryIdx = entryIdx - windowStart;
  const svg = buildChartSvg(chartRows, { entryIdx: localEntryIdx, buyLog: row.buyLog, windowStart, entryIdxGlobal: entryIdx });
  const cur = seq[seq.length - 1];
  const s = statusInfo(row, cur.date);
  const recovLabel = row.recovered
    ? (row.status === 'OPEN' ? `회복(D+${row.recoverDay}) · 회복D+${row.day - row.recoverDay}/${POST_RECOVER_HOLD}` : `회복(D+${row.recoverDay})`)
    : '회복전';
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(row.name)}</span>${badgeGroup(s)}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입일 ${row.date} <span class="sep">|</span> 진입가 <span>${fmtV(row.entryClose)}</span> <span class="sep">|</span> 현재가 <span>${fmtV(cur.close)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>D+${s.day} <span class="sep">|</span> 수익률(가중) <span class="${retClass(row.ret)}">${fmt(row.ret)}</span> <span class="sep">|</span> 매수 ${row.buyCount}/${MAX_BUY_LEGS}회</span>
        </div>
        <div class="chart-card-stats">
          <span>EMA200괴리 <span class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</span> <span class="sep">|</span> 기준선(EMA200) <span>${fmtV(cur.ema200)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>${recovLabel}</span>
        </div>
        ${!row.recovered && row.status === 'OPEN' && row.breakout?.curBucket ? `<div class="chart-card-stats">
          <span>200EMA 상향돌파확률(동구간 ${esc(row.breakout.curBucket.label)}) 20D <b>${fmtProb(row.breakout.byBucket[20])}</b> <span class="sep">|</span> 60D <b>${fmtProb(row.breakout.byBucket[60])}</b> <span class="sep">|</span> 120D <b>${fmtProb(row.breakout.byBucket[120])}</b></span>
        </div>` : ''}
        <div class="chart-card-stats">
          <span>신호일 ${(row.signalDates || []).map(b => b.executed ? `${b.leg}차 ${b.date}(${fmtV(b.price)})` : `<span style="opacity:.65">${b.leg}차(신호만) ${b.date}(${fmtV(b.price)})</span>`).join(' <span class="sep">|</span> ')}</span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA200(기준선)</span><span><i style="background:var(--sky600)"></i>1차 진입가</span>${row.buyCount >= 2 ? '<span><i style="background:var(--purple)"></i>2차 진입가</span>' : ''}<span><i style="background:var(--${s.primary.cls === 'bdg-red' ? 'red' : s.primary.cls === 'bdg-purple' ? 'purple' : s.primary.cls === 'bdg-teal' ? 'teal' : 'gray600'})"></i>상태 <span>${s.primary.label}</span></span></div>
      </div>`;
}

function breakoutCellHtml(r) {
  const b = r.breakout?.curBucket ? r.breakout.byBucket[60] : null;
  if (!b) return '<span class="t-flat">&mdash;</span>';
  return b.p != null
    ? `<span title="괴리율구간 ${esc(r.breakout.curBucket.label)}, 표본 n=${b.n}">${b.p.toFixed(0)}%</span>`
    : '<span class="t-flat">표본부족</span>';
}

function watchRowHtml(r) {
  const seq = r.seq;
  const last = seq.length - 1;
  const cur = seq[last];
  const zs = rollingZStats(seq, last);
  const zHit = zs.z <= Z_THRESHOLD;
  const badge = zHit ? '<span class="badge bdg-amber">Z충족&middot;돌파대기</span>' : '<span class="badge bdg-gray">관찰</span>';
  return `          <tr><td class="l">${esc(r.name)}</td><td>${fmtV(cur.close)}</td><td>${fmtV(cur.ema200)}</td><td class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</td><td>${zs.z.toFixed(2)}</td><td class="c">${r.curStreak}일</td><td class="c">${breakoutCellHtml(r)}</td><td class="c">${badge}</td></tr>`;
}

function watchChartCardHtml(r) {
  const seq = r.seq;
  const last = seq.length - 1;
  const cur = seq[last];
  const zs = rollingZStats(seq, last);
  const zHit = zs.z <= Z_THRESHOLD;
  const aboveEma5 = cur.close >= cur.ema5;
  const targetDev = Z_THRESHOLD * zs.sd + zs.mean;
  const targetPrice = cur.ema200 * (1 + targetDev / 100);
  const windowStart = Math.max(0, last - 250);
  const chartRows = seq.slice(windowStart, seq.length);
  const svg = buildChartSvg(chartRows, {});
  const badge = zHit ? { cls: 'bdg-amber', label: 'Z충족·돌파대기' } : { cls: 'bdg-gray', label: '관찰' };
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badge.cls}">${badge.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(cur.close)}</span> <span class="sep">|</span> 기준선(EMA200) <span>${fmtV(cur.ema200)}</span> <span class="sep">|</span> 이탈 <b>${r.curStreak}거래일째</b></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA200괴리 <span class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</span> <span class="sep">|</span> 롤링Z <span>${zs.z.toFixed(2)}</span> <span class="sep">|</span> Z≤${Z_THRESHOLD} 예상가 <span>${fmtV(targetPrice)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA5 <span>${fmtV(cur.ema5)}</span> <span class="sep">|</span> 종가-EMA5 관계 <b>${aboveEma5 ? 'EMA5 위(상향돌파 완료 대기)' : 'EMA5 아래(상향돌파 대기)'}</b></span>
        </div>
        ${r.breakout?.curBucket ? `<div class="chart-card-stats">
          <span>200EMA 상향돌파확률(동구간 ${esc(r.breakout.curBucket.label)}) 20D <b>${fmtProb(r.breakout.byBucket[20])}</b> <span class="sep">|</span> 60D <b>${fmtProb(r.breakout.byBucket[60])}</b> <span class="sep">|</span> 120D <b>${fmtProb(r.breakout.byBucket[120])}</b></span>
        </div>` : ''}
        <div class="chart-card-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA200(기준선)</span></div>
      </div>`;
}

// 종목당 실제로는 동시에 1사이클만 보유 가능(재진입 없음)하므로, 같은 종목이 아직 보유중인 동안
// 발생한 후속 rising-edge는 "새 진입"이 아니라 같은 사이클의 잡음(휩쏘)이다 — 시계열 순서대로
// 걸으며 이전 사이클이 청산(CLOSED)되기 전까지 발생한 신규 신호는 건너뛴다(중복표시 방지).
function primaryEntriesForStock(seq, entries) {
  const primary = [];
  let nextAllowedIdx = -Infinity;
  for (const e of entries) {
    if (e.i < nextAllowedIdx) continue;
    const status = simulateLiveStatus(seq, e.i);
    primary.push({ ...e, status });
    nextAllowedIdx = status.status === 'OPEN' ? Infinity : e.i + status.finalDay + 1;
  }
  return primary;
}

// 2026-08-19: 코스피/코스닥 분리 — 유니버스 로드부터 최근신호·예상종목 fragment 생성까지 전체
// 파이프라인을 시장 하나 단위로 실행하는 함수로 뽑아, main()에서 코스피/코스닥 각각 1회씩 호출한다.
async function runMarket(universe, opts, todayDate, cutoffDate) {
  const kisMap = await fetchKisPriceMap(universe);
  const loaded = await batchAll(universe, s => loadStock(s, kisMap, todayDate));
  const valid = loaded.filter(r => !r.error);
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  // ── 최근신호 ──────────────────────────────────────────
  const rows = [];
  const rowMeta = [];
  for (const r of valid) {
    const primary = primaryEntriesForStock(r.seq, r.entries);
    for (const e of primary) {
      if (e.date < cutoffDate) continue;
      const buyDays = new Set(e.status.buyLog.map(b => b.day));
      const signalDates = (e.status.signalLog || e.status.buyLog).map((b, idx) => ({ leg: idx + 1, date: r.seq[e.i + b.day].date, price: b.price, executed: buyDays.has(b.day) }));
      const buyDates = e.status.buyLog.map((b, idx) => ({ leg: idx + 1, date: r.seq[e.i + b.day].date, price: b.price }));
      // 2026-08-18 버그수정: "진입가"가 항상 1차 매수가만 표시되고 있었음(2회 분할매수 시에도 평단가
      // 반영 안 됨) — 수익률(ret)은 이미 avgCost(=buyLog 가격 단순평균, 균등 50%씩 매수라 단순평균=평단가)
      // 기준으로 계산되고 있었으므로 표시값만 buyLog 평균으로 맞춤(2회 매수면 1,2차 평균)
      const avgEntryClose = e.status.buyLog.reduce((a, b) => a + b.price, 0) / e.status.buyLog.length;
      const recoverDate = e.status.recovered && e.status.recoverDay != null ? r.seq[e.i + e.status.recoverDay].date : null;
      rows.push({ date: e.date, name: r.name, code: r.code, entryClose: avgEntryClose, buyDates, signalDates, recoverDate, breakout: r.breakout, ...e.status });
      rowMeta.push({ seq: r.seq, entryIdx: e.i });
    }
  }
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date < rows[b].date ? 1 : rows[a].date > rows[b].date ? -1 : 0);
  const sortedRows = order.map(i => rows[i]);
  const sortedMeta = order.map(i => rowMeta[i]);

  const closed = sortedRows.filter(x => x.status === 'CLOSED');
  const open = sortedRows.filter(x => x.status === 'OPEN');
  const wins = closed.filter(x => x.ret > 0).length;

  const tableHtml = sortedRows.map((row, i) => tableRowHtml(row, sortedMeta[i].seq)).join('\n');
  const chartRowsForCards = sortedRows.slice(0, opts.chartCap);
  const chartMetaForCards = sortedMeta.slice(0, opts.chartCap);
  const chartCardsHtml = chartRowsForCards.map((row, i) => signalChartCardHtml(row, chartMetaForCards[i].seq, chartMetaForCards[i].entryIdx)).join('\n');

  return {
    valid, tableHtml, chartCardsHtml,
    openNames: new Set(open.map(r => r.name)), // 이미 이 전략으로 보유중인 종목(예상종목 탭에서 중복 배제용)
    stats: { total: sortedRows.length, openCount: open.length, closedCount: closed.length, closedWinRate: closed.length ? (wins / closed.length * 100) : null },
  };
}

// 2026-08-19: 예상종목(워치) 탭도 최근신호와 동일하게 코스피/코스닥 각 시장 단위로 분리 산출한다.
// 2026-08-19(2차): "예상종목"은 문자 그대로 진입조건 초근접(Z조건까지 충족, EMA5 상향돌파만 대기) 종목만
// 보여준다(사용자 지적 — 스트릭만 충족하고 Z는 한참 먼 종목까지 강제로 채워 보여주던 문제). 스트릭만
// 충족한 전체 개수는 KPI 카드(관찰대상)로만 참고 제공하고, 표·차트에는 Z조건까지 충족한 종목만 표시—
// 초근접 후보가 없으면 빈 목록을 그대로 보여준다(강제 상위 N개 채우기 없음).
function computeWatch(valid, openNames, opts) {
  const watchCandidates = [];
  for (const r of valid) {
    if (openNames.has(r.name)) continue;
    const seq = r.seq;
    const last = seq.length - 1;
    const curStreak = r.streak[last];
    if (curStreak < MIN_STREAK) continue;
    const zs = rollingZStats(seq, last);
    watchCandidates.push({ ...r, curStreak, curZ: zs.z });
  }
  watchCandidates.sort((a, b) => a.curZ - b.curZ);
  const watchZHit = watchCandidates.filter(r => r.curZ <= Z_THRESHOLD);
  const watchTop = watchZHit.slice(0, opts.watchCap);
  return {
    watchChartsHtml: watchTop.map(watchChartCardHtml).join('\n'),
    watchTableHtml: watchTop.map(watchRowHtml).join('\n'),
    stats: {
      total: watchCandidates.length, zHitCount: watchZHit.length, notYetCount: watchCandidates.length - watchZHit.length,
      watchNames: watchTop.map(r => ({ name: r.name, streak: r.curStreak, z: r.curZ, breakout60d: r.breakout?.curBucket ? r.breakout.byBucket[60] : null })),
    },
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[기준선 전략 최근신호/예상종목 산출] recentDays=${opts.recentDays} chartCap=${opts.chartCap} watchCap=${opts.watchCap}`);

  const todayDate = kstTodayDate();
  const cutoffMs = Date.now() - opts.recentDays * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  const kospiUniverse = await buildKospiUniverse();
  const kosdaqUniverse = await buildKosdaqUniverse();
  console.error(`[기준선] 코스피 ${kospiUniverse.length}종목 / 코스닥 ${kosdaqUniverse.length}종목 스캔 시작`);

  const ks = await runMarket(kospiUniverse, opts, todayDate, cutoffDate);
  const kq = await runMarket(kosdaqUniverse, opts, todayDate, cutoffDate);
  const watchKs = computeWatch(ks.valid, ks.openNames, opts);
  const watchKq = computeWatch(kq.valid, kq.openNames, opts);

  fs.writeFileSync('baseline_signals_table_ks.html', ks.tableHtml, 'utf-8');
  fs.writeFileSync('baseline_signals_charts_ks.html', ks.chartCardsHtml, 'utf-8');
  fs.writeFileSync('baseline_signals_table_kq.html', kq.tableHtml, 'utf-8');
  fs.writeFileSync('baseline_signals_charts_kq.html', kq.chartCardsHtml, 'utf-8');
  fs.writeFileSync('baseline_watch_table_ks.html', watchKs.watchTableHtml, 'utf-8');
  fs.writeFileSync('baseline_watch_charts_ks.html', watchKs.watchChartsHtml, 'utf-8');
  fs.writeFileSync('baseline_watch_table_kq.html', watchKq.watchTableHtml, 'utf-8');
  fs.writeFileSync('baseline_watch_charts_kq.html', watchKq.watchChartsHtml, 'utf-8');
  console.error(`[산출완료] 최근신호·예상종목 각 *_ks/kq.html(코스피/코스닥 분리), 총 8개 fragment 생성`);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), cutoffDate,
    kospi: { signals: ks.stats, watch: watchKs.stats }, kosdaq: { signals: kq.stats, watch: watchKq.stats },
  }, null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
