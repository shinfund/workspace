// 라운드넘버(피겨라운드) 지지/저항 되돌림 매매전략 백테스트 — 2026-08-21 신규(5번째 전략 후보)
// 배경: 키움 HTS "피겨라운드" 기능으로 삼성전자 차트를 보다가, 가격이 딱 떨어지는 자리수(라운드 넘버,
// 예: 250,000/300,000/350,000원)에서 반복적으로 지지·저항을 형성하는 현상을 발견 — 지정가 주문이
// 라운드 넘버에 몰리는 습성(주문 클러스터링) 때문에 심리적 레벨이 실제 매물대와 겹치는 경우가 많음.
// 사용법: node scripts/project_roundnumber_strategy_backtest.mjs [--window-days 150] [--target-ticks 30]
//   [--min-touches 3] [--recent-lookback 20] [--prior-above-days 5] [--reclaim-window 5]
//   [--stop-buffer-pct 2] [--max-hold 60] [--calendar-days 2555] [--stocks 코드:이름:시장,...]
//
// 라운드 레벨 산출(2026-08-21 재검증 후 교체 — 처음엔 "가격 자릿수"만으로 단위를 정했으나, 삼성전자·
// SK하이닉스 실제 키움 HTS 차트(project_roundnumber_scale_research.mjs)와 대조한 결과 실제 축 간격은
// 자릿수가 아니라 "화면에 보이는 최근 구간의 가격범위"로 정해짐을 확인 — "최근 `--window-days`거래일
// 고가~저가 범위 ÷ `--target-ticks`"를 1/2/2.5/5/10 계열의 "보기 좋은 수"(niceStep, D3.js 축 눈금
// 알고리즘과 동일 계열)로 반올림하는 방식. 화면표시용(project_holdings_quote_table.mjs)은 실제 HTS
// 축과 시각적으로 일치하는 window=200/ticks=10을 그대로 쓰지만, 이 백테스트는 그 뒤 파라미터
// 스윕(windowDays×targetTicks×stopBufferPct×reclaimWindow, 총 35조합)에서 매매 성과 기준으로 별도
// 확정한 window=150/ticks=30(더 촘촘한 그리드)을 기본값으로 쓴다 — "차트에 보기 좋은 눈금"과 "매매에
// 유리한 눈금"은 목적이 달라 반드시 같을 필요가 없다는 것을 스윕으로 확인.
// 그날그날 트레일링 윈도우로 매일 다시 계산하므로(고정 그리드 아님, causal — 미래 데이터 미사용)
// HTS에서 봉마다 축이 재조정되는 것과 동일한 방식.
//
// 파라미터 스윕 결론(2026-08-21, 70종목×7년, perDay=평균수익률/평균보유일수):
//   ① windowDays×targetTicks 15조합(100~400일×6~15눈금): perDay 0.12~0.14%로 전 구간 안정적
//      (전략의 하루당 edge는 특정 파라미터에 의존하지 않는 강건한 성질) — 다만 targetTicks를 올릴수록
//      (그리드가 촘촘해질수록) 승률이 오르고 중앙값이 마이너스에서 플러스로 전환.
//   ② minTouches(2/3/5/8): 성과에 유의미한 영향 없음 — "터치 많은 레벨이 더 잘 작동한다"는 밀집도
//      가설은 이번에도 기각(project_roundnumber_strategy_backtest.mjs 최초 버전 진단과 동일 결론).
//   ③ stopBufferPct(0.5~3): 손절폭을 넓힐수록 승률·중앙값·평균수익률 모두 단조 상승(48%/-0.21%→
//      61%/+1.33%)하지만 보유일수도 늘어 perDay는 반대로 하락 — 2%가 " perDay 손실 거의 없이
//      승률·중앙값을 크게 개선"하는 변곡점.
//   ④ reclaimWindow(5~20): 영향 미미, 5(가장 짧음)가 근소 우위.
//   ⑤ recentLookback/priorAboveDays를 강화(트랙레코드 조건을 더 엄격히)하면 오히려 perDay 하락 —
//      기존값(20일 중 5일) 유지.
//   최종 windowDays=150/targetTicks=30/stopBufferPct=2/reclaimWindow=5 조합이 승률(59%)·중앙값(+0.72%)·
//   perDay(0.143%, 전체 스윕 최고) 세 지표 동시 최상위로 확정.
//
// 진입 (지지 이탈 후 재돌파="되돌림 확인 후 재진입", 2026-08-21):
//   ① 라운드 레벨 L을 종가 기준 하향이탈(전일종가>=L, 당일종가<L)
//   ② 트랙레코드 확인: 이탈 직전 `--recent-lookback`(기본20)거래일 중 `--prior-above-days`(기본5)일
//      이상 L 위에서 머물렀던 적이 있어야 함(그냥 지나가던 레벨이 아니라 최근에 지지로 기능했던 레벨만 인정)
//   ③ 밀집도(터치카운트) 확인(사용자 요청 2026-08-21 — "실제로 가격이 라운드 넘버 부근에서 형성됐는지"
//      실증 근거, 재검증 후 종가 근접 대신 캔들 실제 움직임 기준으로 교체): 이탈일 기준 과거
//      `--window-days`(기본200거래일) 동안 저가~고가(캔들 몸통+꼬리) 범위가 L을 통과한 봉의 개수
//      (터치카운트) >= `--min-touches`(기본3)여야 "검증된 라운드 레벨"로 인정.
//   ④ ①②③ 충족 후 `--reclaim-window`(기본10)거래일 내 종가가 L을 다시 회복(재돌파)하는 첫날 진입
//      (그 사이 L-step 아래로 한 번 더 떨어지면 지지 완전붕괴로 보고 포기)
//   ⑤ 오버슈트 필터(2026-08-24 추가): 재돌파일 종가가 갭업으로 다음 라운드레벨(L+step, TP가)까지
//      이미 넘겨버린 경우는 진입 제외 — project_roundnumber_entry_overshoot_backtest.mjs로 분리
//      검증한 결과 오버슈트 케이스가 정상 케이스보다 뚜렷이 열위(승률55%/중앙값+0.28% vs
//      정상 61%/+1.13%)라 확정 전략에서 제외. 필터 적용 후 전체 결과가 아래 "정상" 수치와 동일해짐
//      (n=4,660, 승률61%, 중앙값+1.13%, 평균+0.31%, 평균보유2.5거래일 — 기존 59%/+0.72%/n=7,846에서 개선).
//
// 코스피 전용 확정(2026-08-24): 시장별(코스피/코스닥) 성과 분리 결과 코스피 n=3,337(승률63%,
// 평균+0.35%, TP비율63%) vs 코스닥 n=1,323(승률56%, 평균+0.21%, TP비율56%) — 중앙값은 거의 동일
// (+1.13%/+1.12%)해서 "이긴 트레이드 크기"는 같지만 코스닥이 STOP에 더 자주 먼저 닿아 승률만 낮음.
// 코스닥 전용 STOP버퍼 스윕(2~5%)으로도 해소 안 됨 — 버퍼를 넓히면 승률은 56%→64%(4%)까지 오르지만
// 평균수익률은 +0.21%→+0.23%로 거의 그대로고, perDay(하루당 기대치)는 0.091%→0.072%로 오히려
// 하락(코스피 기준값 0.130%에 한참 못 미침). 변동성이 커서 라운드 지지가 코스피만큼 안정적으로
// 안 지켜지는 구조적 문제로 판단, 사용자 승인으로 기본 유니버스를 코스피 전용으로 확정
// (project_roundnumber_recent_trades.mjs·project_roundnumber_recent_signals.mjs도 동일 적용).
//
// 청산(먼저 오는 조건):
//   TP: 종가가 다음 라운드 레벨(L+step, 저항)에 도달
//   STOP: 종가가 L×(1-stopBufferPct/100) 아래로 하락(라운드 지지가 결국 무너짐)
//   TIME: `--max-hold`(기본60)거래일 경과
//
// 진단: 터치카운트(밀집도) 구간별 성과 분리(검증 강도가 실제 승률에 영향을 주는지), EMA200 기준
// 상승/하락 국면별 성과 분리(회귀/추세추종 어느 쪽에 더 유리한지, feedback_strategy_regime_pairing 관점).

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 + 코스닥 TOP20 (2026-08-19 KRX 스냅샷, project_baseline_recent_signals.mjs 폴백 유니버스와 동일 — 재현성 유지)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
// 2026-08-24 코스닥 제외 확정(아래 시장별 성과분리 결과 참고) — 백테스트용 참조 목록으로만 보존,
// 기본 유니버스에서는 제외.
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
// 기본 유니버스는 코스피 전용(2026-08-24부). 코스닥 포함 비교가 필요하면 --stocks로 FALLBACK_KOSDAQ 직접 지정.
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const BASE_PERIOD = 200; // EMA200(국면 진단용, 진입조건 아님)

function parseArgs() {
  const argv = process.argv.slice(2);
  // 2026-08-21 파라미터 스윕 확정값(윈도우×눈금×손절폭×재돌파대기 4단계 스윕, 총 35조합 비교):
  // windowDays=150/targetTicks=30(기존10→상향)/stopBufferPct=2(기존1.5→상향)/reclaimWindow=5(기존10→단축)
  // 조합이 승률(59%)·중앙값(+0.72%)·일평균기대치(0.143%, 전체 스윕 최고) 세 지표 모두 동시 최상위.
  // minTouches·recentLookback·priorAboveDays는 스윕 결과 성과에 유의미한 영향 없어 기존값 유지
  // (밀집도 가설 재확인 기각 — 터치카운트 임계값을 2~8회로 바꿔도 결과 거의 동일).
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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] };
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

// "보기 좋은" 눈금 간격 산출 — 1/2/2.5/5/10 계열(D3.js ticks 류 축 알고리즘과 동일 패밀리)
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
// idx 시점의 라운드 단위(step) — idx 이전 windowDays거래일 고가~저가 범위 기준(트레일링, lookahead 없음)
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) {
    if (highs[k] > hi) hi = highs[k];
    if (lows[k] < low) low = lows[k];
  }
  return niceStep((hi - low) / targetTicks);
}
// 밀집도(터치카운트): idx 이전 windowDays거래일 동안 저가~고가(캔들 실제 움직임) 범위가 level을 통과한 봉 개수
// (lookahead 없음 — idx 이전 데이터만 사용, "이 레벨이 실제로 과거에 여러 번 가격을 형성했는지" 실증 근거,
// 2026-08-21 재검증 후 종가 근접 방식에서 교체 — 캔들 실제 움직임이 chart 시각과 더 잘 맞음)
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) {
    if (lows[k] <= level && level <= highs[k]) count++;
  }
  return count;
}

// 2026-08-25 신규: 손실종목 필터 후보 4종 진단용 피처 계산(모두 causal, lookahead 없음)
function meanRange(arr, lo, hi) { // [lo, hi) 구간 평균, 표본 부족시 null
  const a = arr.slice(Math.max(0, lo), hi).filter(v => v != null && v > 0);
  return a.length ? mean(a) : null;
}
// ① 진입시점 변동성(ATR%) — breachIdx 직전 recentLookback일간 평균 (고-저)/종가×100
function computeAtrPctBefore(seq, highs, lows, breachIdx, lookback) {
  const lo = Math.max(0, breachIdx - lookback);
  const vals = [];
  for (let k = lo; k < breachIdx; k++) {
    if (seq[k]?.close > 0) vals.push((highs[k] - lows[k]) / seq[k].close * 100);
  }
  return vals.length ? mean(vals) : null;
}
// ④ 거래량 급증 — 특정일 거래량 ÷ 그 직전 lookback일 평균 거래량
function computeVolRatioAt(volumes, idx, lookback) {
  const avg = meanRange(volumes, idx - lookback, idx);
  if (!avg || volumes[idx] == null) return null;
  return volumes[idx] / avg;
}

// 진입신호: 라운드레벨 하향이탈 → 트랙레코드+밀집도 검증 → reclaimWindow 내 재돌파
function detectRoundSignals(seq, highs, lows, volumes, opts) {
  const n = seq.length;
  const events = []; // { entryIdx, level, step, touchCount, priorAboveCount, breachIdx }
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, opts.windowDays, opts.targetTicks);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;

    // ② 트랙레코드: 최근 recentLookback거래일 중 priorAboveDays일 이상 L 위에서 머문 적 있는지
    const lo = Math.max(0, i - 1 - opts.recentLookback);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < opts.priorAboveDays) continue;

    // ③ 밀집도(터치카운트) — 과거 실제 가격형성 빈도 검증(사용자 요청, 봉 갯수 기반 실증)
    const touch = touchCountBefore(highs, lows, i, L, opts.windowDays);
    if (touch < opts.minTouches) continue;

    const stopLevel = L * (1 - opts.stopBufferPct / 100);
    const stopTouchCount = touchCountBefore(highs, lows, i, stopLevel, opts.windowDays);
    const atrPct = computeAtrPctBefore(seq, highs, lows, i, opts.recentLookback);
    const breachVolRatio = computeVolRatioAt(volumes, i, opts.recentLookback);

    // ④ reclaimWindow 내 첫 재돌파 탐색(그 전에 L-step 아래로 더 떨어지면 포기), 그 사이 최저가로 whipsaw폭 계산
    let minLowInPath = lows[i];
    for (let f = i; f < Math.min(n, i + opts.reclaimWindow); f++) {
      if (lows[f] < minLowInPath) minLowInPath = lows[f];
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        // 2026-08-24 오버슈트 필터: 재돌파일 종가가 갭업으로 TP가(L+step)까지 이미 넘겨버리면
        // 리스크(STOP까지)만 남고 리워드는 사실상 소진된 셋업 — 별도 백테스트로 확인된 저품질
        // (승률55%, 중앙값+0.28% vs 정상 61%/+1.13%, project_roundnumber_entry_overshoot_backtest.mjs)
        // 라 신호에서 제외 확정.
        if (seq[f].close < L + step) {
          const whipsawPct = (L - minLowInPath) / L * 100; // 이탈~재돌파 구간 L 대비 최대 낙폭(%)
          const entryVolRatio = computeVolRatioAt(volumes, f, opts.recentLookback);
          events.push({
            entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, breachIdx: i,
            stopTouchCount, atrPct, whipsawPct, breachVolRatio, entryVolRatio,
          });
        }
        break;
      }
    }
  }
  return events;
}

function simulateRoundTrade(seq, ev, opts) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;      // 다음 라운드 레벨(저항)
  const stop = ev.level * (1 - opts.stopBufferPct / 100);
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정
    const close = seq[j].close;
    if (close <= stop) return { ret: (close - entry) / entry * 100, day: d, reason: 'STOP', date: seq[j].date };
    if (close >= target) return { ret: (close - entry) / entry * 100, day: d, reason: 'TP', date: seq[j].date };
    if (d === opts.maxHold) return { ret: (close - entry) / entry * 100, day: d, reason: 'TIME', date: seq[j].date };
  }
  return null;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD); // 국면 진단용

  const seq = [], highs = [], lows = [], volumes = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema200: ema200s[i] ?? null });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
    volumes.push(chart.volume[i] ?? null);
  }
  const minLen = opts.windowDays + opts.recentLookback + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows, volumes, opts);
  const trades = [];
  for (const ev of events) {
    const res = simulateRoundTrade(seq, ev, opts);
    if (!res) continue;
    const entryEma200 = seq[ev.entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[ev.entryIdx].close >= entryEma200 : null;
    trades.push({
      name: stock.name, market: stock.market, entryDate: seq[ev.entryIdx].date, level: ev.level,
      touchCount: ev.touchCount, priorAboveCount: ev.priorAboveCount, uptrend,
      stopTouchCount: ev.stopTouchCount, atrPct: ev.atrPct, whipsawPct: ev.whipsawPct,
      breachVolRatio: ev.breachVolRatio, entryVolRatio: ev.entryVolRatio,
      ...res,
    });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;

  // 밀집도(터치카운트) 구간별 성과 분리 — "검증된(터치 많은) 레벨일수록 성과가 나은지" 실증
  const buckets = [
    { label: `${trades[0] ? '' : ''}낮음(3~5회)`, test: t => t.touchCount >= 3 && t.touchCount <= 5 },
    { label: '중간(6~9회)', test: t => t.touchCount >= 6 && t.touchCount <= 9 },
    { label: '높음(10회+)', test: t => t.touchCount >= 10 },
  ];
  const touchSplit = buckets.map(b => {
    const g = trades.filter(b.test);
    if (!g.length) return { label: b.label, n: 0 };
    return { label: b.label, n: g.length, avg: mean(g.map(t => t.ret)), win: g.filter(t => t.ret > 0).length / g.length * 100 };
  });

  // EMA200 기준 국면별 성과 분리(추세추종 vs 역추세 어느 쪽에 유리한지)
  const up = trades.filter(t => t.uptrend === true);
  const down = trades.filter(t => t.uptrend === false);
  const regimeSplit = {
    up: up.length ? { n: up.length, avg: mean(up.map(t => t.ret)), win: up.filter(t => t.ret > 0).length / up.length * 100 } : null,
    down: down.length ? { n: down.length, avg: mean(down.map(t => t.ret)), win: down.filter(t => t.ret > 0).length / down.length * 100 } : null,
  };

  // 시장별(코스피/코스닥) 성과 분리 — 2026-08-24 사용자 요청("코스닥 승률이 낮아 보인다")
  const kospi = trades.filter(t => t.market === 'KOSPI');
  const kosdaq = trades.filter(t => t.market === 'KOSDAQ');
  const marketStat = g => g.length ? {
    n: g.length, avg: mean(g.map(t => t.ret)), med: median(g.map(t => t.ret)),
    win: g.filter(t => t.ret > 0).length / g.length * 100, avgDays: mean(g.map(t => t.day)),
    tpRate: g.filter(t => t.reason === 'TP').length / g.length * 100,
  } : null;
  const marketSplit = { KOSPI: marketStat(kospi), KOSDAQ: marketStat(kosdaq) };

  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, reasonCount, touchSplit, regimeSplit, marketSplit };
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
  console.error(`[라운드넘버 지지/저항 되돌림 전략 백테스트] ${opts.stocks.length}종목, 라운드단위=최근${opts.windowDays}거래일 고저범위÷${opts.targetTicks}눈금(niceStep), 밀집도터치(캔들통과)>=${opts.minTouches}회, 트랙레코드 최근${opts.recentLookback}일중${opts.priorAboveDays}일↑, 재돌파대기${opts.reclaimWindow}거래일`);
  console.error(`청산: TP(다음 라운드레벨 도달) / STOP(레벨×${(100 - opts.stopBufferPct).toFixed(1)}% 이탈) / TIME(${opts.maxHold}거래일)`);

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
  console.log(`n=${s.n}  평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균보유 ${s.avgDays.toFixed(1)}거래일`);

  console.log(`\n[청산 사유별 발생 빈도]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / s.n * 100).toFixed(0)}%)`);
  }

  console.log(`\n[밀집도(터치카운트) 구간별 성과 — "검증된 라운드 레벨"일수록 성과가 나은지 실증]`);
  for (const b of s.touchSplit) {
    if (!b.n) { console.log(`  ${b.label}: 해당 없음`); continue; }
    console.log(`  ${b.label}: n=${b.n}  평균 ${b.avg >= 0 ? '+' : ''}${b.avg.toFixed(2)}%  승률${b.win.toFixed(0)}%`);
  }

  console.log(`\n[EMA200 국면별 성과 분리 — 진입시점 종가가 EMA200 위/아래]`);
  if (s.regimeSplit.up) console.log(`  상승국면(종가>=EMA200): n=${s.regimeSplit.up.n}  평균 ${s.regimeSplit.up.avg >= 0 ? '+' : ''}${s.regimeSplit.up.avg.toFixed(2)}%  승률${s.regimeSplit.up.win.toFixed(0)}%`);
  else console.log(`  상승국면: 해당 없음`);
  if (s.regimeSplit.down) console.log(`  하락국면(종가<EMA200): n=${s.regimeSplit.down.n}  평균 ${s.regimeSplit.down.avg >= 0 ? '+' : ''}${s.regimeSplit.down.avg.toFixed(2)}%  승률${s.regimeSplit.down.win.toFixed(0)}%`);
  else console.log(`  하락국면: 해당 없음`);

  console.log(`\n[시장별(코스피/코스닥) 성과 분리]`);
  for (const [mkt, st] of Object.entries(s.marketSplit)) {
    if (!st) { console.log(`  ${mkt}: 해당 없음`); continue; }
    console.log(`  ${mkt}: n=${st.n}  평균 ${st.avg >= 0 ? '+' : ''}${st.avg.toFixed(2)}%  중앙값 ${st.med >= 0 ? '+' : ''}${st.med.toFixed(2)}%  승률${st.win.toFixed(0)}%  TP비율${st.tpRate.toFixed(0)}%  평균보유${st.avgDays.toFixed(1)}거래일`);
  }

  // 2026-08-25 손실종목(STOP) 필터 후보 4종 진단 — 각 지표를 하위/중위/상위 33%로 나눠
  // STOP비율이 특정 구간에 몰려있는지(=필터로 쓸 수 있는지) 확인
  function tertileEdges(vals) {
    const sorted = [...vals].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    return [q(1 / 3), q(2 / 3)];
  }
  function statOf(g) {
    if (!g.length) return null;
    return {
      n: g.length, avg: mean(g.map(t => t.ret)),
      win: g.filter(t => t.ret > 0).length / g.length * 100,
      stopRate: g.filter(t => t.reason === 'STOP').length / g.length * 100,
    };
  }
  function analyzeMetric(title, key, fmt = v => v.toFixed(2)) {
    const withVal = pooled.filter(t => t[key] != null && isFinite(t[key]));
    console.log(`\n[손실필터 후보] ${title} (표본 n=${withVal.length}/${pooled.length})`);
    if (withVal.length < 30) { console.log('  표본 부족, 분석 생략'); return; }
    const [e1, e2] = tertileEdges(withVal.map(t => t[key]));
    const buckets = [
      { label: `하위33%(~${fmt(e1)})`, g: withVal.filter(t => t[key] <= e1) },
      { label: `중위33%(${fmt(e1)}~${fmt(e2)})`, g: withVal.filter(t => t[key] > e1 && t[key] <= e2) },
      { label: `상위33%(${fmt(e2)}~)`, g: withVal.filter(t => t[key] > e2) },
    ];
    let worst = null;
    for (const b of buckets) {
      const st = statOf(b.g);
      if (!st) { console.log(`  ${b.label}: 해당 없음`); continue; }
      console.log(`  ${b.label}: n=${st.n}  평균 ${st.avg >= 0 ? '+' : ''}${st.avg.toFixed(2)}%  승률${st.win.toFixed(0)}%  STOP비율${st.stopRate.toFixed(0)}%`);
      if (!worst || st.stopRate > worst.st.stopRate) worst = { b, st };
    }
    if (worst && worst.st.stopRate - s.reasonCount.STOP / s.n * 100 >= 5) {
      const kept = pooled.filter(t => !(t[key] != null && worst.b.g.includes(t)));
      const keptStat = statOf(kept);
      console.log(`  → "${worst.b.label}" 구간 제외 시뮬레이션: n=${pooled.length}→${kept.length}(${(pooled.length - kept.length)}건 감소), 승률 ${s.win.toFixed(0)}%→${keptStat.win.toFixed(0)}%, STOP비율 ${(s.reasonCount.STOP / s.n * 100).toFixed(0)}%→${keptStat.stopRate.toFixed(0)}%, 평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%→${keptStat.avg >= 0 ? '+' : ''}${keptStat.avg.toFixed(2)}%`);
    } else {
      console.log('  → 구간별 STOP비율 차이 미미(5%p 미만), 필터로서 실효성 낮음');
    }
  }

  console.log(`\n═══ 손실종목(STOP) 축소 필터 후보 4종 검증 ═══`);
  analyzeMetric('① 진입시점 변동성(ATR%, 이탈 전 20일 평균 고저범위%)', 'atrPct');
  analyzeMetric('② STOP가 자체의 과거 밀집도(터치카운트)', 'stopTouchCount', v => v.toFixed(0));
  analyzeMetric('③ 이탈~재돌파 구간 최대 되돌림폭(whipsaw%, L 대비)', 'whipsawPct');
  analyzeMetric('④-1 이탈일 거래량급증(직전20일 평균 대비 배수)', 'breachVolRatio', v => v.toFixed(1) + 'x');
  analyzeMetric('④-2 재돌파(진입)일 거래량급증(직전20일 평균 대비 배수)', 'entryVolRatio', v => v.toFixed(1) + 'x');

  console.log(`\n━━━ 종목별 신호수 ━━━`);
  const byStock = byStockSummary(results);
  for (const row of byStock) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(유효${row.n}건)  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ 각 이벤트는 독립 트레이드로 시뮬레이션(동일종목 포지션 중복보유 여부는 반영하지 않음)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
