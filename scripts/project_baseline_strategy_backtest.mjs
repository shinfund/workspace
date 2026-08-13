// EMA200 기준선 파동(波動) 전략 백테스트 — 스킬: stock-baseline (2026-08-13 신규 확정, 4번째 매매전략)
// 사용법: node scripts/project_baseline_strategy_backtest.mjs [--min-streak N] [--z N] [--max-buy-legs N] [--recover-timeout N] [--post-recover-hold N] [--baseline-confirm N] [--baseline-buffer N] [--max-hold N] [--calendar-days N] [--stocks 코드:이름:시장,...]
//
// 컨셉: EMA200을 "기준선"으로 삼아, 기준선을 하향돌파한 뒤 일정 기간(기본 20거래일) 눌린 종목이
//       단기(5EMA) 반등을 시작하는 시점에 진입한다. 기준선 회복(첫 상향돌파) 이후에는 5EMA
//       상향/하향 교차를 "파동"(상승1파→2파→3파...)으로 카운트하며, 눌림목(5EMA 하향이탈)마다
//       매도하지 않고 계속 보유한다 — 매도는 오직 기준선(EMA200) 재하향돌파 시점에만 전량 실행한다.
//
// 진입 (2026-08-13 분할매수로 확정 — 사용자 요청 + Claude 추천 반영):
//   ① 종가가 EMA200 아래로 연속 `--min-streak`(기본20)거래일 이상 머문 상태(기준선 하향돌파 후 경과)
//   ② 그 상태에서 EMA200 대비 괴리율(dev200)의 롤링(250거래일) Z-score <= `--z`(기본-1) — "괴리율" 조건
//   ③ 종가가 EMA5를 상향 돌파(전일 종가<EMA5, 당일 종가>=EMA5)한 날 — "기타 등등"의 핵심 트리거
//   ①②③ 동시 충족일 최초 매수(1/`--max-buy-legs`, 기본2분의1=50%). "회복"(EMA200 재상향돌파) 전까지는
//   ①이 유지되는 동안 ②③이 다시 충족되면(최대 `--max-buy-legs`회, 기본2회까지) 나머지 50% 추가매수.
//   Claude 추천: 매 분할매수마다 Z조건을 동일하게 재확인 — 반등이 진행될수록 EMA200과의 괴리가 좁혀져
//   Z-score가 자연히 완화되므로, 별도 규칙 없이도 "쌀 때 많이, 비쌀수록 적게" 매수하는 효과가 생김.
//   회복 이후에는 추가 매수를 하지 않고(진입 전 구간에만 적용, 사용자 확인), 실제 누적 매수분(평단가
//   기준)에 대해 아래 파동별 분할매도 로직을 그대로 적용.
//   ※ 분할횟수 확정(2026-08-13): 종목별 고정배정(자금 미리 쪼개서 배치) 스타일에서는 미체결 잔여자금이
//   0%수익으로 노는 비용까지 반영한 "배치율×가중평균수익률=실질기대수익률" 기준으로 legs를 늘릴수록
//   오히려 하락(1회6.49%→2회6.27%→4회5.23%→6회4.14%) — 무분할(1회) 대비 승률·최악값 개선 효과는
//   최소한으로 살리면서 배치율 손실을 줄인 2회로 확정(자본배치율 84%).
//
// 청산 (먼저 오는 조건, 사용자 지시 + Claude 추천 안전장치 — 2026-08-13 파동별 분할매도로 확정):
//   ※ 손절은 자동 규칙에 포함하지 않음(사용자 지시: "-15% 일률 손절이 아닌 본인 판단하의 수동 손절").
//      대신 "최대낙폭(minRet, 트레이드 중 진입가 대비 최저 수익률)"을 참고용으로만 기록·집계 —
//      매도 트리거로 쓰지 않으며, 실전에서는 이 구간에서 사용자가 재량으로 손절할 수 있음을 보여주는 용도.
//   ① 기준선(EMA200) 첫 상향돌파 확인 → "회복" 상태 진입, 이 시점부터 파동 카운트 시작(상승1파)
//   ② 회복 이후 기준선(EMA200) 재하향돌파 시 그 즉시 잔량 전량 매도(BASELINE_BREAK, 사용자 명시
//      안전장치) — 어느 파동 단계에 있든 최우선으로 잔량을 정리.
//   ③ 파동별 분할매도(사용자 확정, 2026-08-13): 1파 하향돌파(첫 5EMA 이탈) 시 50% 매도 → 2파
//      하향돌파(재상향돌파 후 다시 5EMA 이탈) 시 잔량의 50%(전체25%) 매도 → 3파 하향돌파 시 잔량 전량
//      매도(여기서 트레이드 종료, 4파는 구조상 발생하지 않음)
//   ④ 시간청산(Claude 추천, 2026-08-13 2단계로 분리): 진단 결과 "회복까지" 소요기간(중앙값57일·p90 102일)과
//      "회복 후 파동청산까지" 소요기간(중앙값3일·p90 20일)이 전혀 달라 단일 --max-hold(기존120일)로는
//      두 성격이 다른 구간이 뒤섞여 있었음. 이를 회복 전 `--recover-timeout`(기본120거래일)과 회복 후
//      `--post-recover-hold`(기본60거래일 — 회복일 기준 상대일수)로 분리.
//      ※ 스윕 검증(2026-08-13): recoverTimeout을 40~60일로 줄이면 오히려 성과가 나빠짐(느리게
//      회복하는 트레이드도 결국 상당수 이익으로 끝남) — "120일이 길다"는 가설은 기각, 120일 유지가
//      데이터상 합리적. 대신 postRecoverHold는 실측 최대소요(41일)보다 넉넉한 60일로 확실히 압축해
//      회복 후 불필요하게 긴 보유(구120일)를 줄임 — 실질 개선은 recoverTimeout 단축이 아니라 두 구간의
//      구조적 분리 자체.

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (2026-08-03 KIS 기준, 괴리율 백테스트 계열과 동일 유니버스)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' },
  { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' },
  { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' },
  { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' },
  { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' },
  { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' },
  { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' },
  { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' },
  { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' },
  { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' },
  { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' },
  { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' },
  { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' },
  { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' },
  { code: '010950', name: 'S-Oil' },
];

const ROLL = 250;
const FAST_PERIOD = 5;
const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  // EMA200 워밍업 + 롤링Z(250일) + minStreak까지 감안해 넉넉히(약 7년) 조회
  // z=-1.5: 2026-08-13 Z스윕 결론(표본크기·성과 균형점)으로 확정한 기본 진입임계값.
  // Z<=-2 도달분은 이 임계값 내에서 사후분리해 "고확신" 비중 태그로만 활용(별도 임계값 전환 아님)
  // recoverTimeout/postRecoverHold: 2026-08-13 시간청산 2단계 분리 — 회복까지(중앙값57일·p90 102일)와
  // 회복 후 파동청산까지(중앙값3일·p90 20일)의 소요기간이 전혀 다르다는 진단 결과 반영. maxHold는 둘의
  // 합을 넘지 않는 전체 안전판으로만 사용(개별 청산은 recoverTimeout/postRecoverHold가 담당)
  // maxBuyLegs=2: 2026-08-13 자본배치율 스윕으로 확정. 종목별 고정배정(자금 미리 쪼개서 배치) 스타일에서는
  // 미체결 잔여자금이 0%수익으로 노는 비용이 커서, 단순 가중평균수익률(legs↑일수록 계속 개선)이 아니라
  // "배치율×가중평균수익률=실질기대수익률" 기준으로 비교해야 함 — 이 기준으로는 legs가 늘수록 오히려
  // 하락(1회6.49%→2회6.27%→...→6회4.14%). 1회(분할없음) 대비 승률·최악값 개선 효과를 살리면서 배치율
  // 손실을 최소화하는 2회를 최종 채택(3회 대비 배치율+13%p, 리스크지표는 3회가 근소 우위인 절충).
  // "잔여매수를 회복시점에 캐치업" 방식도 검토했으나 회복일은 이미 저점대비 많이 오른 시점이라 캐치업
  // 매수가 평단가를 크게 악화시켜(가중평균 +9.20%→+2.01%) 폐기.
  const o = { stocks: DEFAULT_STOCKS, minStreak: 20, z: -1.5, maxHold: 180, calendarDays: 2555, maxBuyLegs: 2, recoverTimeout: 120, postRecoverHold: 60, baselineConfirm: 1, baselineBuffer: 0, baselinePartialPct: 100, catchUpBuy: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--min-streak') o.minStreak = parseInt(argv[++i]);
    if (argv[i] === '--z') o.z = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--max-buy-legs') o.maxBuyLegs = parseInt(argv[++i]);
    if (argv[i] === '--recover-timeout') o.recoverTimeout = parseInt(argv[++i]);
    if (argv[i] === '--post-recover-hold') o.postRecoverHold = parseInt(argv[++i]);
    if (argv[i] === '--baseline-confirm') o.baselineConfirm = parseInt(argv[++i]);
    if (argv[i] === '--baseline-buffer') o.baselineBuffer = parseFloat(argv[++i]);
    if (argv[i] === '--baseline-partial-pct') o.baselinePartialPct = parseFloat(argv[++i]);
    if (argv[i] === '--catch-up-buy') o.catchUpBuy = true;
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
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[idx];
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

// dev200 기준 롤링 Z-score (위치%ile은 스킬 결론(Z-score 단독으로 충분)에 따라 생략)
function rollingZ(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j].dev200;
  return sd ? (v - m) / sd : 0;
}

// 분할매수(회복 전) + 파동별 분할매도(회복 후) 시뮬레이션 (2026-08-13 사용자 확정)
// 회복 전: 5EMA 상향돌파 + Z조건 재충족마다 25%씩 추가매수(최대 --max-buy-legs회), 평단가(avgCost) 갱신.
// 회복(기준선 첫 상향돌파) 후: 매수 중단, 평단가 기준으로 1파 하향돌파→50%매도, 2파 하향돌파→잔량50%
// (전체25%)매도, 3파 하향돌파→잔량 전량매도(트레이드 종료). 기준선 재하향돌파는 파동단계 무관 잔량 전량 즉시매도.
// 손절은 자동 규칙에 없음(사용자 지시: 수동 판단 영역) — minRet(평단가 대비 최대낙폭)만 참고용으로 기록.
function simulateTrade(seq, i0, opts) {
  let buyCount = 1;             // 최초 매수(i0) 포함 누적 매수 횟수
  let costSum = seq[i0].close;  // 매수가 합산(균등 25%씩이므로 단순평균으로 평단가 산출)
  let openWeight = 1.0;
  let recovered = false;   // 기준선(EMA200) 첫 상향돌파 여부
  let inWaveUp = false;    // 현재 5EMA 위(상승파 진행 중)인지
  let waveCount = 0;       // 회복 이후 시작된 상승파 번호(1파, 2파, 3파)
  let minRet = 0;          // 참고용 최대낙폭(트레이드 중 평단가 대비 최저 수익률)
  let recoverDay = null;   // 진입 후 회복까지 걸린 거래일수(진단용)
  let belowBaselineStreak = 0; // 회복 후 기준선(버퍼 적용) 아래 연속일수 — 확인일수(baselineConfirm) 카운트용
  const legs = [];
  const buyLog = [{ day: 0, price: seq[i0].close }];

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정(최근 신호)
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema200 = seq[j].ema200;

    if (!recovered) {
      // 분할매수: 회복 전 구간에서만 5EMA 상향돌파 + Z조건 재충족마다 추가매수(최대 maxBuyLegs회)
      if (buyCount < opts.maxBuyLegs) {
        const crossUp5 = seq[j - 1].close < seq[j - 1].ema5 && close >= ema5;
        if (crossUp5 && rollingZ(seq, j) <= opts.z) {
          buyCount += 1;
          costSum += close;
          buyLog.push({ day: d, price: close });
        }
      }
    }

    // 회복 캐치업 매수(옵션, 2026-08-13 사용자 지적 반영): 분할매수 목표를 다 못 채운 채 회복이
    // 확정되면(예: 6분할 목표에 3회만 체결) 그만큼 실투입 자금이 작아지는 문제 — --catch-up-buy 켜면
    // 회복 확정일에 잔여 목표수량을 그날 종가로 일괄 매수해 자본 배치를 100%로 채움(평단가는 다소 상승)
    if (!recovered && close >= ema200 && opts.catchUpBuy && buyCount < opts.maxBuyLegs) {
      const remaining = opts.maxBuyLegs - buyCount;
      costSum += close * remaining;
      buyCount = opts.maxBuyLegs;
      buyLog.push({ day: d, price: close, catchUp: remaining });
    }

    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;
    if (ret < minRet) minRet = ret; // 참고용 최대낙폭 추적(매도 트리거 아님 — 손절은 수동 판단 영역)

    if (!recovered) {
      // ① 기준선(EMA200) 첫 상향돌파 확인 → 회복 상태 진입(매수 종료), 파동 카운트 시작
      if (close >= ema200) {
        recovered = true;
        recoverDay = d;
        waveCount = 1; // 상승1파 시작
        inWaveUp = close >= ema5;
      } else if (d >= opts.recoverTimeout) {
        // ①-보완(2026-08-13, 회복 전용 시간청산): 회복 자체를 못 한 채 recoverTimeout 도달 시 조기 청산
        // — 회복 못한 트레이드는 사실상 전부 시간청산으로 끝나는데(진단상 82%가 손실), 굳이 120일까지
        // 붙잡지 않고 회복 실패가 통계적으로 확인되는 시점에 자본을 회수. (회복 후 파동은 중앙값 3일·
        // p90 20일 만에 끝나 postRecoverHold와는 별개 문제임을 진단으로 확인)
        legs.push({ weight: openWeight, ret, reason: 'RECOVER_TIMEOUT', day: d, date: seq[j].date });
        openWeight = 0;
        break;
      }
    } else {
      // ② 회복 이후 기준선 재하향돌파 → 잔량 전량 즉시매도(사용자 명시 안전장치, 파동단계 무관 최우선)
      // 2026-08-13 조정 가능하게 확장: --baseline-buffer(%, 기준선 아래 버퍼폭)와 --baseline-confirm
      // (연속확인일수)로 노이즈성 순간 이탈에 대한 민감도를 조정할 수 있게 함(기본값은 기존과 동일 —
      // 버퍼0%·확인1일 = 종가가 EMA200 밑으로 내려간 당일 즉시매도)
      const baselineThreshold = ema200 * (1 - opts.baselineBuffer / 100);
      if (close < baselineThreshold) {
        belowBaselineStreak += 1;
      } else {
        belowBaselineStreak = 0;
      }
      if (belowBaselineStreak >= opts.baselineConfirm) {
        // 2026-08-13 부분매도 변형 추가: --baseline-partial-pct(기본100=현행 전량매도)를 100 미만으로
        // 주면 그날 잔량의 해당 비율만 정리 — 계속 기준선 아래면 매일(확인일수 재충족마다) 같은 비율씩
        // 추가 정리(기하급수적 청산), 중간에 기준선 위로 복귀하면 남은 잔량은 파동 로직으로 복귀
        const sellFrac = Math.min(1, opts.baselinePartialPct / 100);
        const w = openWeight * sellFrac;
        legs.push({ weight: w, ret, reason: 'BASELINE_BREAK', day: d, date: seq[j].date });
        openWeight -= w;
        belowBaselineStreak = 0;
        if (openWeight <= 1e-9) { openWeight = 0; break; }
        continue;
      }
      // ③ 파동별 분할매도
      if (inWaveUp && close < ema5) {
        inWaveUp = false;
        if (waveCount === 1) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE1', day: d, date: seq[j].date });
          openWeight -= w;
        } else if (waveCount === 2) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE2', day: d, date: seq[j].date });
          openWeight -= w;
        } else {
          legs.push({ weight: openWeight, ret, reason: 'WAVE3', day: d, date: seq[j].date });
          openWeight = 0;
          break;
        }
      } else if (!inWaveUp && close >= ema5) {
        inWaveUp = true;
        waveCount += 1;
      }
      // ③-보완: 회복 후 시간청산 — postRecoverHold(회복일 기준 상대일수) 도달 시 잔량 정리
      if (openWeight > 1e-9 && d - recoverDay >= opts.postRecoverHold) {
        legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
        openWeight = 0;
        break;
      }
    }

    // ④ 최종 안전판(회복 전 구간에서 recoverTimeout보다 maxHold가 먼저 도달하는 경우 대비)
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalDay = legs[legs.length - 1].day;
  return { legs, weightedRet, finalDay, entryDate: seq[i0].date, recovered, maxWaveReached: waveCount, minRet, buyCount, buyLog, recoverDay };
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

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
  if (seq.length < ROLL + opts.minStreak + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  // 기준선(EMA200) 연속 하향 스트릭 계산
  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const streakOk = streak[i] >= opts.minStreak;
    const crossUp5 = seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
    const z = rollingZ(seq, i);
    flags[i] = streakOk && crossUp5 && z <= opts.z;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const trades = [];
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts);
    if (t) trades.push({ name: stock.name, entryZ: rollingZ(seq, i0), ...t });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.finalDay));
  const reasonCount = {};
  const reasonWeight = {};
  for (const t of trades) {
    for (const l of t.legs) {
      reasonCount[l.reason] = (reasonCount[l.reason] || 0) + 1;
      reasonWeight[l.reason] = (reasonWeight[l.reason] || 0) + l.weight;
    }
  }
  const recoveredCount = trades.filter(t => t.recovered).length;
  // 회복까지 걸린 거래일수 분포(진단용) — 시간청산 파라미터 조정 근거
  const recoverDays = trades.filter(t => t.recoverDay != null).map(t => t.recoverDay);
  const recoverDayStats = recoverDays.length ? {
    p25: percentile(recoverDays, 25), p50: percentile(recoverDays, 50),
    p75: percentile(recoverDays, 75), p90: percentile(recoverDays, 90),
    max: Math.max(...recoverDays),
  } : null;
  // 회복 후 파동을 타는 데 걸린 보유일수(회복일→최종청산일) 분포(진단용)
  const postDays = trades.filter(t => t.recoverDay != null).map(t => t.finalDay - t.recoverDay);
  const postRecoverStats = postDays.length ? {
    p25: percentile(postDays, 25), p50: percentile(postDays, 50),
    p75: percentile(postDays, 75), p90: percentile(postDays, 90),
    max: Math.max(...postDays),
  } : null;
  // 파동 도달 분포 — 사용자 가설("3파까지 진행")을 데이터로 검증(트레이드 종료 시점의 최종 파동번호 기준)
  const waveBuckets = {}; // 0(회복못함), 1, 2, 3
  for (const t of trades) {
    const key = String(t.maxWaveReached);
    waveBuckets[key] = (waveBuckets[key] || 0) + 1;
  }
  const waveAvgRet = {};
  for (const key of Object.keys(waveBuckets)) {
    const matching = trades.filter(t => String(t.maxWaveReached) === key);
    waveAvgRet[key] = mean(matching.map(t => t.weightedRet));
  }
  // 참고용 최대낙폭 분포(손절 미적용 상태의 실제 낙폭 — 매도 트리거 아님)
  const minRets = trades.map(t => t.minRet);
  const dd15 = trades.filter(t => t.minRet <= -15).length;
  const dd20 = trades.filter(t => t.minRet <= -20).length;
  const dd30 = trades.filter(t => t.minRet <= -30).length;
  // 분할매수 횟수 분포
  const buyBuckets = {};
  for (const t of trades) buyBuckets[t.buyCount] = (buyBuckets[t.buyCount] || 0) + 1;
  const avgBuyCount = mean(trades.map(t => t.buyCount));
  // 레그별 손실구간 매도 진단 — 파동별 분할매도가 평단가 대비 손실 상태에서 발생하는 비중 점검
  const legLossStats = {};
  for (const t of trades) {
    for (const l of t.legs) {
      if (!legLossStats[l.reason]) legLossStats[l.reason] = { total: 0, loss: 0 };
      legLossStats[l.reason].total += 1;
      if (l.ret < 0) legLossStats[l.reason].loss += 1;
    }
  }
  // 고확신(Z<=-2) vs 일반(-2<Z<=진입임계값) 성과 분리 — 별도 재백테스트가 아닌 동일 표본 내 사후분리
  const highConv = trades.filter(t => t.entryZ <= -2);
  const normalConv = trades.filter(t => t.entryZ > -2);
  const convSplit = {
    high: highConv.length ? { n: highConv.length, avg: mean(highConv.map(t => t.weightedRet)), win: highConv.filter(t => t.weightedRet > 0).length / highConv.length * 100 } : null,
    normal: normalConv.length ? { n: normalConv.length, avg: mean(normalConv.map(t => t.weightedRet)), win: normalConv.filter(t => t.weightedRet > 0).length / normalConv.length * 100 } : null,
  };
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win, avgBuyCount, buyBuckets,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays,
    reasonCount, reasonWeight, recoveredCount, waveBuckets, waveAvgRet,
    avgMinRet: mean(minRets), worstMinRet: Math.min(...minRets), dd15, dd20, dd30,
    legLossStats, convSplit, recoverDayStats, postRecoverStats,
  };
}

function byStockSummary(results) {
  const rows = [];
  for (const r of results) {
    if (r.error || !r.trades?.length) continue;
    const s = summarizeTrades(r.trades);
    rows.push({ name: r.name, totalEvents: r.totalEvents, ...s });
  }
  return rows.sort((a, b) => b.n - a.n);
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA200 기준선 파동 전략 백테스트] ${opts.stocks.length}종목, 최소스트릭${opts.minStreak}거래일/Z<=${opts.z}/회복전타임아웃${opts.recoverTimeout}일/회복후보유${opts.postRecoverHold}일/분할매수최대${opts.maxBuyLegs}회 (손절은 수동판단 영역이라 자동규칙 제외)`);
  console.error(`진입: 종가<EMA200 연속${opts.minStreak}거래일↑ 구간에서 (dev200 롤링Z<=${opts.z} AND 종가 EMA5 상향돌파) 재충족마다 ${(100 / opts.maxBuyLegs).toFixed(0)}%씩 최대${opts.maxBuyLegs}회 분할매수(회복 전까지만)`);
  console.error(`청산: ①회복전${opts.recoverTimeout}거래일 내 미회복시 조기청산(RECOVER_TIMEOUT) ②기준선재하향돌파시 잔량전량(BASELINE_BREAK) ③1파하향돌파 50%매도→④2파하향돌파 잔량50%(전체25%)매도→⑤3파하향돌파 잔량전량매도 ⑥회복후${opts.postRecoverHold}거래일 시간청산(TIME)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n전체 신호(이벤트) 발생: ${totalEvents}건 (미확정 최근 신호 제외 유효표본: ${pooled.length}건)`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }

  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  가중평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률(가중수익>0) ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균종결일 ${s.avgDays.toFixed(1)}거래일`);
  console.log(`\n[레그(leg)별 발생 빈도 / 가중치 합]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(14)}: ${cnt}건  (가중치 합 ${s.reasonWeight[reason].toFixed(2)})`);
  }
  console.log(`\n[기준선(EMA200) 회복 도달 여부]`);
  console.log(`  회복(종가≥EMA200 재돌파) 도달: ${s.recoveredCount}건 (${(s.recoveredCount / s.n * 100).toFixed(0)}%)`);
  console.log(`  회복 못하고 종료(시간청산): ${s.n - s.recoveredCount}건`);
  if (s.recoverDayStats) {
    const rd = s.recoverDayStats;
    console.log(`  [회복까지 걸린 거래일수 분포(진단용)] p25=${rd.p25}일  중앙값=${rd.p50}일  p75=${rd.p75}일  p90=${rd.p90}일  최대=${rd.max}일`);
  }
  if (s.postRecoverStats) {
    const pr = s.postRecoverStats;
    console.log(`  [회복 후 파동청산까지 보유일수 분포(진단용)] p25=${pr.p25}일  중앙값=${pr.p50}일  p75=${pr.p75}일  p90=${pr.p90}일  최대=${pr.max}일`);
  }

  console.log(`\n[참고용 최대낙폭 — 손절 미적용, 실제 매도 트리거 아님]`);
  console.log(`  평균 최대낙폭 ${s.avgMinRet.toFixed(2)}%  최악 ${s.worstMinRet.toFixed(2)}%`);
  console.log(`  -15% 이상 낙폭 경험: ${s.dd15}건 (${(s.dd15 / s.n * 100).toFixed(0)}%)  -20%이상: ${s.dd20}건 (${(s.dd20 / s.n * 100).toFixed(0)}%)  -30%이상: ${s.dd30}건 (${(s.dd30 / s.n * 100).toFixed(0)}%)`);

  console.log(`\n[분할매수 횟수 분포 — 평균 ${s.avgBuyCount.toFixed(2)}회 / 목표${opts.maxBuyLegs}회 대비 평균 자본배치율 ${(s.avgBuyCount / opts.maxBuyLegs * 100).toFixed(0)}%]`);
  for (const k of Object.keys(s.buyBuckets).sort()) {
    console.log(`  ${k}회 매수: ${s.buyBuckets[k]}건 (${(s.buyBuckets[k] / s.n * 100).toFixed(0)}%)`);
  }

  console.log(`\n[레그별 손실구간 매도 진단 — 파동별 분할매도가 평단가 대비 손실 상태에서 발생하는 비중]`);
  for (const [reason, st] of Object.entries(s.legLossStats)) {
    console.log(`  ${reason.padEnd(14)}: ${st.total}건 중 손실상태 매도 ${st.loss}건 (${(st.loss / st.total * 100).toFixed(0)}%)`);
  }

  console.log(`\n[고확신(진입Z<=-2) vs 일반(진입Z>-2) 성과 분리 — Z=-1.5 단일신호 내 사후분리, 별도 재백테스트 아님]`);
  if (s.convSplit.high) console.log(`  고확신(Z<=-2): n=${s.convSplit.high.n}  가중평균 ${s.convSplit.high.avg >= 0 ? '+' : ''}${s.convSplit.high.avg.toFixed(2)}%  승률${s.convSplit.high.win.toFixed(0)}%`);
  else console.log(`  고확신(Z<=-2): 해당 없음`);
  if (s.convSplit.normal) console.log(`  일반(-2<Z<=진입임계값): n=${s.convSplit.normal.n}  가중평균 ${s.convSplit.normal.avg >= 0 ? '+' : ''}${s.convSplit.normal.avg.toFixed(2)}%  승률${s.convSplit.normal.win.toFixed(0)}%`);
  else console.log(`  일반: 해당 없음`);

  console.log(`\n[파동(波動) 도달 분포 — 트레이드 종료 시점 기준 최종 파동번호, "3파까지 진행" 가설 검증]`);
  const waveOrder = ['0', '1', '2', '3'];
  const waveLabel = { '0': '회복못함(파동시작전)', '1': '1파에서 종료', '2': '2파에서 종료', '3': '3파 완주(전량매도)' };
  for (const key of waveOrder) {
    if (!s.waveBuckets[key]) continue;
    const cnt = s.waveBuckets[key];
    const avgR = s.waveAvgRet[key];
    console.log(`  ${waveLabel[key].padEnd(18)}: ${cnt}건 (${(cnt / s.n * 100).toFixed(0)}%)  가중평균수익률 ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}%`);
  }

  console.log(`\n━━━ 종목별 신호수 ━━━`);
  const byStock = byStockSummary(results);
  for (const row of byStock) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(유효${row.n}건)  가중평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ 각 이벤트는 독립 트레이드로 시뮬레이션(동일종목 포지션 중복보유 여부는 반영하지 않음)');
  console.log('※ weightedRet = 각 레그(분할청산분) 수익률을 진입가 기준으로 계산 후 비중(가중치)만큼 가중합산한 트레이드 전체 수익률');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
