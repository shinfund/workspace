// EMA200 기준선 파동(波動) 전략 백테스트 — 스킬: stock-baseline (2026-08-13 신규 확정, 4번째 매매전략)
// 사용법: node scripts/project_baseline_strategy_backtest.mjs [--min-streak N] [--z N] [--max-buy-legs N] [--recover-timeout N] [--post-recover-hold N] [--baseline-confirm N] [--baseline-buffer N] [--exit-mode wave|full1] [--max-hold N] [--calendar-days N] [--stocks 코드:이름:시장,...]
//
// 컨셉: EMA200을 "기준선"으로 삼아, 기준선을 하향돌파한 뒤 일정 기간(기본 16거래일) 눌린 종목이
//       단기(5EMA) 반등을 시작하는 시점에 진입한다. 기준선 회복(첫 상향돌파) 이후에는 매수 없이
//       계속 보유하다가, 회복 후 첫 5EMA 하향돌파(첫 눌림목) 시점에 잔량을 전량 매도한다
//       (`--exit-mode full1`, 기본값, 2026-08-18 확정). 파동(1파→2파→3파)별로 나눠 파는 기존 방식은
//       `--exit-mode wave`로 코드에 남아있음(비교용, 아래 청산 항목 참조).
//
// 진입 (2026-08-13 분할매수로 확정, 2026-08-14 반등신호 조건 vlow로 전환 — 사용자 요청 + Claude 추천 반영):
//   ① 종가가 EMA200 아래로 연속 `--min-streak`(기본16, 2026-08-18 20→16 스윕 후 변경)거래일 이상 머문 상태(기준선 하향돌파 후 경과)
//   ② 그 상태에서 EMA200 대비 괴리율(dev200)의 롤링(250거래일) Z-score <= `--z`(기본-1) — "괴리율" 조건
//   ③ 반등 신호(2026-08-14 확정, `--rebound-mode vlow` 기본값): 기준선 아래 구간에서 종가가 "새로운
//   최저점"을 갱신한 뒤, 그 이후 첫 EMA5 상향돌파(전일 종가<EMA5, 당일 종가>=EMA5)만 신호로 인정.
//   최저점을 다시 갱신하기 전까지는 같은 구간 내 잦은 휩쏘(등락)로 재신호가 나지 않음 — 기존 방식
//   (`--rebound-mode cross`, EMA5 상향돌파가 재발생할 때마다 매번 신호)은 잦은 매수신호를 유발해
//   폐기하고 vlow로 전환(사용자 확인, 2026-08-14). buildVLowSignal() 참조.
//   ※ 2026-08-14 3차 수정(HD현대중공업 사례로 발견): 최저점 추적을 스트릭이 minStreak에 도달하는
//   시점에 리셋하던 중간 버전은, 리셋 시점에 이미 반등이 진행 중이면 그날 종가를 "가짜 저점"으로
//   오인해 실제로는 이전 저점보다 얕은(더 높은) 반등에도 신호를 냈다(08-04 리셋 시점 종가가 07-29
//   실제 저점보다 훨씬 높았는데 그 이후 조정 반등에 신호 발생). belowBase 구간 진입 시점부터 종가
//   기준 최저점을 리셋 없이 계속 추적하도록 되돌려 해결 — 삼성중공업 실측 재검증(2021-12-02,
//   2026-07-31 2건, 사용자 기억과 일치)과 저가(intraday low) 기준 대안 비교(휩쏘로 신호 오히려
//   증가해 기각)를 거쳐 확정. 이 수정으로 Z=-1.25 유지/분할매수 2회 유지 결론은 재검증 결과 동일.
//   ①②③ 동시 충족일 최초 매수(1/`--max-buy-legs`, 기본2분의1=50%). "회복"(EMA200 재상향돌파) 전까지는
//   ①이 유지되는 동안 ②③이 다시 충족되면(최대 `--max-buy-legs`회, 기본2회까지) 나머지 50% 추가매수.
//   Claude 추천: 매 분할매수마다 Z조건을 동일하게 재확인 — 반등이 진행될수록 EMA200과의 괴리가 좁혀져
//   Z-score가 자연히 완화되므로, 별도 규칙 없이도 "쌀 때 많이, 비쌀수록 적게" 매수하는 효과가 생김.
//   회복 이후에는 추가 매수를 하지 않고(진입 전 구간에만 적용, 사용자 확인), 실제 누적 매수분(평단가
//   기준)에 대해 아래 파동별 분할매도 로직을 그대로 적용.
//   ※ 분할횟수 확정(2026-08-13, vlow 전환 후 2026-08-14 재검증에서도 동일 결론): 종목별 고정배정(자금
//   미리 쪼개서 배치) 스타일에서는 미체결 잔여자금이 0%수익으로 노는 비용까지 반영한
//   "배치율×가중평균수익률=실질기대수익률" 기준으로 legs를 늘릴수록 오히려 하락 — 무분할(1회) 대비
//   승률·최악값 개선 효과는 최소한으로 살리면서 배치율 손실을 줄인 2회로 확정
//   (vlow 기준: 1회+5.87%/배치율100% → 2회+7.57%(실질+5.75%)/배치율76% → 3회부터 실질기대수익률 하락폭 확대).
//
// 청산 (먼저 오는 조건, 사용자 지시 + Claude 추천 안전장치 — 2026-08-13 파동별 분할매도로 확정):
//   ※ 손절은 자동 규칙에 포함하지 않음(사용자 지시: "-15% 일률 손절이 아닌 본인 판단하의 수동 손절").
//      대신 "최대낙폭(minRet, 트레이드 중 진입가 대비 최저 수익률)"을 참고용으로만 기록·집계 —
//      매도 트리거로 쓰지 않으며, 실전에서는 이 구간에서 사용자가 재량으로 손절할 수 있음을 보여주는 용도.
//   ① 기준선(EMA200) 첫 상향돌파 확인 → "회복" 상태 진입, 이 시점부터 파동 카운트 시작(상승1파)
//   ② 회복 이후 기준선(EMA200) 재하향돌파 시 그 즉시 잔량 전량 매도(BASELINE_BREAK, 사용자 명시
//      안전장치) — 어느 파동 단계에 있든 최우선으로 잔량을 정리.
//   ③ 청산(회복 후 첫 눌림, `--exit-mode full1` 기본값, 2026-08-18 확정): 회복 후 5EMA 하향돌파가
//      처음 발생하는 시점에 잔량 전량 매도(WAVE1_FULL, 여기서 트레이드 종료). 기존 파동별 분할매도
//      (`--exit-mode wave`: 1파 50%→2파 잔량50%(전체25%)→3파 잔량전량)와 비교 스윕한 결과, 3파까지
//      완주하는 17%(+29.16%)의 상단이익을 일부 포기하는데도 전체 가중평균·중앙값·회복도달률·평균
//      보유일수(자본회전) 전부 근소 우위(+8.31%→+8.49%, 회복 후 재차 눌림에 다시 노출되지 않는 효과)
//      라 기본값으로 채택.
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
  const o = { stocks: DEFAULT_STOCKS, minStreak: 16, z: -1.25, maxHold: 180, calendarDays: 2555, maxBuyLegs: 2, recoverTimeout: 120, postRecoverHold: 60, baselineConfirm: 1, baselineBuffer: 0, baselinePartialPct: 100, catchUpBuy: false, reboundMode: 'vlow', exitMode: 'full1', baselineBreak: true };
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
    if (argv[i] === '--no-baseline-break') o.baselineBreak = false; // 2026-08-18 비교용: 회복 후 기준선 재하향돌파 매도(②)를 아예 제거하고 5EMA 홀딩(③)만 남긴 변형
    if (argv[i] === '--rebound-mode') o.reboundMode = argv[++i]; // 'cross'(기존, EMA5 상향돌파마다) | 'vlow'(최저점 갱신 후 첫 상향돌파만)
    if (argv[i] === '--exit-mode') o.exitMode = argv[++i]; // 'wave'(기존, 1파50%→2파25%→3파전량) | 'full1'(회복 후 홀딩, 첫 5EMA 하향돌파에 전량매도)
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

// 반등신호(condition③) 계산 — 두 모드
// 'cross': 기존 확정 로직. EMA5 상향돌파(전일<EMA5, 당일>=EMA5)가 일어날 때마다 신호(재충족마다 매번 신호).
// 'vlow' : 2026-08-14 검토 변형. 기준선(EMA200) 아래 구간에서 종가가 "새로운 최저점"을 갱신할 때마다
//          다음 EMA5 상향돌파 1회만 신호로 인정(최저점을 다시 갱신하기 전까지는 재신호 없음) — 노이즈성
//          잦은 휩쏘 대신 "매번 더 깊이 눌린 뒤의 첫 반등"만 추가매수 트리거로 인정.
function buildCrossSignal(seq) {
  const sig = new Array(seq.length).fill(false);
  for (let i = 1; i < seq.length; i++) {
    sig[i] = seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
  }
  return sig;
}
// 2026-08-14 3차 수정(HD현대중공업 사례로 발견된 버그 수정): 스트릭이 minStreak에 도달하는 날 최저점
// 추적을 리셋하던 기존 로직은, 리셋 시점에 이미 더 깊은 저점에서 반등이 끝나고 주가가 오르는 중이면
// 그날 종가를 "가짜 저점"으로 새로 세워버려 실제로는 이전 저점보다 얕은(더 높은) 반등에도 신호를
// 발생시키는 문제가 있었다(HD현대중공업 2026-08-14: 08-04 스트릭20 도달 시점의 종가가 07-29 실제
// 최저점(434,000)보다 훨씬 높았는데도 그 이후 조정 반등에 신호 발생). 이제는 belowBase 구간에 진입한
// 시점부터 종가 기준 최저점을 스트릭 상태와 무관하게 계속 추적하고(리셋 없음), 그 최저점을 갱신한 뒤의
// 첫 EMA5 상향돌파만 신호로 인정한다 — minStreak 미달 구간의 신호는 기존과 동일하게 외부(streakOk)에서
// 걸러지므로 별도 처리 불필요. 저점 기준은 저가(intraday low) 대신 종가를 유지(재검증 결과 저가 기준은
// 잦은 휩쏘로 신호가 오히려 늘어나 vlow 전환 취지에 역행 — 삼성중공업 실측 대조로 확인, 2026-08-14).
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
  const signalLog = [{ day: 0, price: seq[i0].close }]; // 2026-08-14: max-buy-legs 상한과 무관하게 조건①②③ 충족일 전부 기록(참고용)

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정(최근 신호)
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema200 = seq[j].ema200;

    if (!recovered) {
      const conditionMet = seq[j].bounce && rollingZ(seq, j) <= opts.z;
      if (conditionMet) signalLog.push({ day: d, price: close });
      // 분할매수: 회복 전 구간에서만 5EMA 상향돌파 + Z조건 재충족마다 추가매수(최대 maxBuyLegs회)
      if (buyCount < opts.maxBuyLegs && conditionMet) {
        buyCount += 1;
        costSum += close;
        buyLog.push({ day: d, price: close });
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
      if (opts.baselineBreak) {
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
      }
      // ③ 파동별 분할매도(exitMode='wave', 기본값) | 회복 후 홀딩, 첫 5EMA 하향돌파에 전량매도(exitMode='full1')
      if (inWaveUp && close < ema5) {
        inWaveUp = false;
        if (opts.exitMode === 'full1') {
          legs.push({ weight: openWeight, ret, reason: 'WAVE1_FULL', day: d, date: seq[j].date });
          openWeight = 0;
          break;
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
  return { legs, weightedRet, finalDay, entryDate: seq[i0].date, recovered, maxWaveReached: waveCount, minRet, buyCount, buyLog, signalLog, recoverDay };
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

  // 기준선(EMA200) 연속 하향 스트릭 계산 (반등신호 리셋 기준점 산출을 위해 bounce보다 먼저 계산)
  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }

  const bounceSig = opts.reboundMode === 'vlow' ? buildVLowSignal(seq) : buildCrossSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const streakOk = streak[i] >= opts.minStreak;
    const z = rollingZ(seq, i);
    flags[i] = streakOk && seq[i].bounce && z <= opts.z;
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
  // 2026-08-14: 분할매수 상한(max-buy-legs)을 초과해 조건①②③이 추가로 충족된 트레이드 진단(사용자 요청)
  // — signalLog(상한 무관 전체 신호)가 buyCount(실제 체결, 상한 적용)보다 많은 경우만 추림
  const excessSignalTrades = trades
    .filter(t => (t.signalLog?.length || 0) > t.buyCount)
    .map(t => ({ name: t.name, entryDate: t.entryDate, buyCount: t.buyCount, signalCount: t.signalLog.length, signalLog: t.signalLog, weightedRet: t.weightedRet }))
    .sort((a, b) => b.signalCount - a.signalCount);
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win, avgBuyCount, buyBuckets,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays,
    reasonCount, reasonWeight, recoveredCount, waveBuckets, waveAvgRet,
    avgMinRet: mean(minRets), worstMinRet: Math.min(...minRets), dd15, dd20, dd30,
    legLossStats, convSplit, recoverDayStats, postRecoverStats, excessSignalTrades,
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
  const reboundDesc = opts.reboundMode === 'vlow' ? '최저점갱신 후 첫 EMA5 상향돌파' : 'EMA5 상향돌파 재충족마다';
  console.error(`진입: 종가<EMA200 연속${opts.minStreak}거래일↑ 구간에서 (dev200 롤링Z<=${opts.z} AND ${reboundDesc}) 충족마다 ${(100 / opts.maxBuyLegs).toFixed(0)}%씩 최대${opts.maxBuyLegs}회 분할매수(회복 전까지만)`);
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

  console.log(`\n[분할매수 상한(${opts.maxBuyLegs}회) 초과 신호 진단 — 상한만 없었다면 추가매수가 더 있었을 트레이드]`);
  if (!s.excessSignalTrades.length) {
    console.log(`  해당 없음(모든 트레이드가 상한 이내에서 신호 종료)`);
  } else {
    const excessNames = new Set(s.excessSignalTrades.map(t => t.name));
    const excessRets = pooled.filter(t => excessNames.has(t.name) && s.excessSignalTrades.some(e => e.name === t.name && e.entryDate === t.entryDate)).map(t => t.weightedRet);
    const nonExcessRets = pooled.filter(t => !s.excessSignalTrades.some(e => e.name === t.name && e.entryDate === t.entryDate)).map(t => t.weightedRet);
    console.log(`  ${s.excessSignalTrades.length}건 (전체의 ${(s.excessSignalTrades.length / s.n * 100).toFixed(0)}%)  초과신호그룹 가중평균 ${mean(excessRets) >= 0 ? '+' : ''}${mean(excessRets).toFixed(2)}%  vs  비초과그룹 가중평균 ${mean(nonExcessRets) >= 0 ? '+' : ''}${mean(nonExcessRets).toFixed(2)}%`);
    for (const t of s.excessSignalTrades) {
      const sig = t.signalLog.map((b, i) => `${i + 1}차 D+${b.day}(${Math.round(b.price).toLocaleString('ko-KR')})`).join(' → ');
      console.log(`    ${t.name.padEnd(12)} 진입${t.entryDate}  실제매수${t.buyCount}회/신호${t.signalCount}회  가중평균 ${t.weightedRet >= 0 ? '+' : ''}${t.weightedRet.toFixed(2)}%  [${sig}]`);
    }
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
