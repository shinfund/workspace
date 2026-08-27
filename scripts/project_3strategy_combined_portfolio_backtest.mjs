// 3전략(눌림목+괴리율+라운드넘버) 통합 5슬롯 공유자본 포트폴리오 — 이벤트드리븐 재구축 엔진 (2026-08-25)
// project_trading_plan_3strategy_portfolio.md 메모의 헤드라인 수치(+1458.56%, 585건 청산, 눌림목230/괴리율119/
// 라운드넘버236건)를 낸 원본 엔진은 커밋되지 않은 1회성 스크래치패드 스크립트라 유실됨 — 이 스크립트는 그
// 결론을 재현하기 위해 확정 3전략 스크립트(project_stock_pullback.mjs v12 / project_deviation_tp20_exit_backtest.mjs /
// project_roundnumber_strategy_backtest.mjs, KOSPI전용)의 진입·청산 로직을 그대로 이식해 새로 만든 것이다.
// 완전 동일 재현은 원본 코드가 없어 불가능 — 아래 가정은 문서화된 것이며 결과는 "근사 재구축치"로 취급할 것.
//
// 설계 가정(원본 미상이라 이 스크립트에서 새로 결정):
//  - 유니버스: project_portfolio3_entry_scan.mjs의 FALLBACK_KOSPI(50종목), 눌림목·괴리율·라운드넘버 3전략
//    전부 코스피 전용(2026-08-26: 3전략 통합 월별 집계표 분석 결과 코스닥이 코스피보다 불안정하다고 판단해
//    코스닥 유니버스(FALLBACK_KOSDAQ, 20종목) 완전 제외, 사용자 확정). 메모의 "51종목"과는 불일치 — 정확한 51종목
//    구성을 알 수 없어 그대로 진행.
//  - 포지션 사이징: 슬롯당 예산 = (현금+보유포지션 원가) / 5, 정수 주 단위. 신규진입 때마다 재계산되므로 복리 반영.
//  - 슬롯 우선순위: 같은 날 여러 신규진입 후보가 남은 빈슬롯보다 많으면 눌림목>괴리율>라운드넘버 순으로 채움
//    (project_trading_plan_3strategy_portfolio.md 명시 우선순위). 세 전략 모두 같은 날 자기 전략 내 후보가 3건을
//    넘으면 그 안에서 신호강도 기준 1~3순위만 채택(2026-08-26 눌림목·괴리율까지 확장 적용, 라운드넘버는 2026-08-25
//    확정 방식 유지): 라운드넘버=밀집도(touchCount)desc·지지일수(aboveCount)desc, 눌림목=추세강도(장기EMA
//    기울기)desc·눌림폭(ATR정규화)asc(얕을수록 우선), 괴리율=EMA5·20 Z합asc·백분위합asc(더 과매도일수록 우선).
//  - 진입 이벤트는 "조건이 새로 참이 된 날(onset)"만 인정(지속일 전부를 독립 이벤트로 잡지 않음) — 눌림목 자체
//    백테스트는 지속일마다 잡지만, 메모에 이 방식이 "연단위 5슬롯 가정"에서 비현실적 수치(+35,405%)를 냈다고
//    명시돼 있어 실제 포지션 엔진에서는 onset만 쓰는 쪽이 안전하다고 판단.
//  - 청산은 각 전략 확정 스크립트의 일별 로직을 그대로 스텝 단위로 이식(부분매도 포함): 눌림목 SL8/18%·
//    TRAIL8/18%·EMA50이탈·TP+10%50%매도·시간청산40일·손절후 5거래일 재진입쿨다운(v13, 2026-08-26 신설),
//    괴리율 SL12%(2026-08-26 15→12 재조정)·TP+20%50%매도→EMA20돌파25%매도→
//    EMA5이탈 잔량전량·시간청산20일, 라운드넘버 STOP(레벨×98%)·TP(레벨+step)·시간청산60일(부분매도 없음).
//
// 사용법: node scripts/project_3strategy_combined_portfolio_backtest.mjs [--from 2019-08-27] [--to 2026-08-25] [--month 2026-08]
//   --month(기본: 이번달 KST): 그 달만 별도로 두 방식으로 집계 — ① 전체기간 복리 실행 결과에서 그 달분만 발췌(슬롯예산=운용자산/5, 계속 성장)
//   ② 슬롯당 고정 200만원(5슬롯=1,000만원 예산) 전체기간 연속 시뮬레이션 결과에서 그 달분만 발췌 — 월초 리셋 없이
//      2019-08-27부터 쭉 이어지되, 슬롯예산이 복리로 커지지 않고 실전 운용방침(2026-08-25 확정)과 동일하게 항상 200만원 고정(2026-08-26 변경)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// ── 유니버스 (project_portfolio3_entry_scan.mjs FALLBACK_KOSPI와 동일) ──
// 2026-08-26: 코스닥 종목(FALLBACK_KOSDAQ) 완전 제외 — 3전략 통합 월별 집계표를 분석한 사용자가
// 코스닥이 코스피보다 불안정하다고 판단, 실측 시장별 리스크 지표(눌림목 코스닥 평균+3.13%·최악-18.09%
// vs 코스피 평균+6.87%·최악-11.51%; 괴리율 코스닥 최악-38.00% vs 코스피-28.63%)로 확인 후 확정.
// 라운드넘버는 애초부터 코스피 전용이라 변경 없음 — 이제 3전략 전부 코스피 전용으로 통일.
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const PD_UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })); // 눌림목·괴리율(코스피 전용)
const RN_UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })); // 라운드넘버(코스피 전용)

// ── 파라미터 (각 확정 전략 스크립트와 동일) ──
const PB = { MA_SHORT: 50, MA_LONG: 100, SLOPE_LOOKBACK: 10, BREAKOUT_LOOKBACK: 6, ATR_PERIOD: 14, BAND_K: 0.4, SL: 8, TRAIL: 8, TP_PCT: 20, TP_FRAC: 0.4, REGIME_STREAK_MIN: 10, KOSPI_ATR_PERIOD: 14, VOL_CAP: 4, STOCK_ATR_CAP: 6, MAX_HOLD: 40, CAP: 3, COOLDOWN_DAYS: 5 }; // COOLDOWN_DAYS: 손절 후 재진입쿨다운(v13, 2026-08-26 확정). TP_PCT/TP_FRAC은 v15(2026-08-26) 청산 그리드서치 재확정(perDay 기준, TRAIL은 슬롯회전 비용 때문에 불변 유지). SL_KOSDAQ/TRAIL_KOSDAQ는 v14(코스닥 제외)로 삭제
const DV = { ROLL: 250, Z_THRESHOLD: -2, ENTRY_PCT_THRESHOLD: 3, FAST: 5, SLOW: 20, MID: 50, MID2: 100, LONG: 200, SL: 18, TP: 20, MAX_HOLD: 20, CAP: 3 }; // SL은 v15(2026-08-26) 청산 그리드서치 재확정(perDay 기준, 12→18, 최대보유일은 슬롯회전 비용 때문에 불변)
const RN = { WINDOW_DAYS: 150, TARGET_TICKS: 30, RECENT_LOOKBACK: 20, PRIOR_ABOVE_DAYS: 5, MIN_TOUCHES: 3, RECLAIM_WINDOW: 5, STOP_BUFFER_PCT: 3, MAX_HOLD: 60, MIN_ENTRY_POSITION_PCT: 20, MIN_BAND_WIDTH_PCT: 2.5, CAP: 3 }; // STOP_BUFFER_PCT는 v15(2026-08-26) 청산 그리드서치 재확정(2→3)
// 급락주 필터(2026-08-27 신설): 일/주 단위 인과분석 결과 라운드넘버 STOP의 70%·괴리율 SL의 40%가 KOSPI 급락주(하위10%)에 집중,
// 눌림목은 비례적 수준(9.4%)이라 제외. 직전 5거래일 KOSPI 누적수익률이 임계치 이하면 괴리율·라운드넘버 신규진입만 중단.
const CRASH_FILTER = { LOOKBACK_DAYS: 5, THRESHOLD_PCT: -3 };
// 급락주 청산측 필터(2026-08-27 신설, --crash-filter A/B에서 진입차단이 효과 없어 방향 전환): 신규진입 대신
// 폭락 감지 시(위와 동일 임계치) 이미 보유중인 괴리율·라운드넘버 포지션을 그 날 즉시 강제청산(CRASH_EXIT).
// STOP/SL 손실의 대부분이 폭락 전에 이미 잡혀있던 포지션에서 발생한다는 분석 결과에 직접 대응.

const SLOTS = 5;
const START_CAPITAL = 10_000_000;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { from: '2019-08-27', to: null, fetchFrom: '2017-01-01', month: null, year: null, list: false, dump: null, crashFilter: false, crashExit: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') o.from = argv[++i];
    if (argv[i] === '--to') o.to = argv[++i];
    if (argv[i] === '--month') o.month = argv[++i]; // YYYY-MM, 월/주간 집계 대상 월(기본: 이번달)
    if (argv[i] === '--year') o.year = argv[++i]; // YYYY, 연간 월별 집계 대상 연도(지정 시 --month 대신 이 모드로 동작)
    if (argv[i] === '--list') o.list = true; // 대상월(--month) 개별 청산건 목록 출력(원인 분석용)
    if (argv[i] === '--dump') o.dump = argv[++i]; // 파일경로: 전체기간 거래내역(복리·고정)+시장국면(KOSPI/KOSDAQ 변동성·추세) JSON 덤프(상관분석용)
    if (argv[i] === '--crash-filter') o.crashFilter = true; // 급락주 진입차단 필터 활성화(기본 OFF, A/B 검증 결과 순개선 미확인이라 기본값 유지)
    if (argv[i] === '--no-crash-filter') o.crashFilter = false;
    if (argv[i] === '--crash-scope') o.crashScope = argv[++i]; // 'dv,rn'(기본) | 'rn' | 'dv' — 진입차단 필터를 적용할 전략 범위(A/B 비교용)
    if (argv[i] === '--crash-exit') o.crashExit = true; // 급락주 청산측 필터 활성화(기본 OFF): 폭락 감지 시 보유중인 포지션 강제청산
    if (argv[i] === '--no-crash-exit') o.crashExit = false;
    if (argv[i] === '--crash-exit-scope') o.crashExitScope = argv[++i]; // 'dv,rn'(기본) | 'rn' | 'dv' — 강제청산을 적용할 전략 범위(A/B 비교용)
  }
  o.crashScope = new Set((o.crashScope || 'dv,rn').split(','));
  o.crashExitScope = new Set((o.crashExitScope || 'dv,rn').split(','));
  return o;
}
// dateStr(YYYY-MM-DD) 기준 이번주 월요일 날짜(YYYY-MM-DD) 계산 — weekBucket과 동일 주 정의
function weekMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
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
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) { const price = closes[i]; if (price == null) continue; if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; } else ema = price * k + ema * (1 - k); emas[i] = ema; }
  return emas;
}
function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) { if (h[i] == null || l[i] == null) continue; if (i === 0) { tr[i] = h[i] - l[i]; continue; } const pc = c[i - 1]; tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) { const v = tr[i]; if (v != null) { sum += v; cnt++; } if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } } if (cnt === period) smas[i] = sum / period; }
  return smas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdevPop(arr, m) { return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
function stdevSamp(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }

async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep))); const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) { const dist = Math.abs(Math.log(norm) - Math.log(f)); if (dist < bestDist) { bestDist = dist; best = f; } }
  return best * mag;
}
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1); let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) { if (highs[k] > hi) hi = highs[k]; if (lows[k] < low) low = lows[k]; }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays); let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
// project_roundnumber_recent_trades.mjs와 동일한 월~일 주간 버킷팅
function weekBucket(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() + diff);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x) => `${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(monday)}~${fmt(sunday)}`;
}
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// ── 1) 전 종목 시세 로드 ──
async function loadStock(stock, p1, p2) {
  const symbol = `${stock.code}.KS`; // v14: 코스피 전용 유니버스로 전환
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  return { ...stock, dates, closes, highs, lows };
}

// ── 2) 종목별 사전계산: 눌림목/괴리율/라운드넘버 각각의 지표열 + onset entry set ──
function precomputePullback(st, regimeByMarket) {
  const { dates, closes, highs, lows } = st;
  const n = dates.length;
  const maShort = buildEma(closes, PB.MA_SHORT), maLong = buildEma(closes, PB.MA_LONG);
  const atr = buildAtr(highs, lows, closes, PB.ATR_PERIOD);
  const atrPct = atr.map((v, i) => v != null && closes[i] ? v / closes[i] * 100 : null);
  const marketRegime = regimeByMarket.KOSPI; // v14: 코스피 전용 유니버스로 전환
  const otherRegime = regimeByMarket.KOSDAQ; // v12: 반대쪽 지수(코스닥) 병행확인용 — 종목이 아닌 시장 breadth 신호라 계속 유지
  const cond = new Array(n).fill(false);
  const scoreArr = new Array(n).fill(null); // {trendStrength, pullbackNorm} — 동시신호 우선순위용
  for (let i = PB.MA_LONG + PB.SLOPE_LOOKBACK; i < n - 1; i++) {
    if (maShort[i] == null || maLong[i] == null) continue;
    const prior = maLong[i - PB.SLOPE_LOOKBACK];
    if (prior == null) continue;
    const trendUp = closes[i] > maLong[i] && maShort[i] > maLong[i] && maLong[i] > prior;
    if (!trendUp) continue;
    const d = dates[i];
    if (marketRegime.regime[d] !== true || otherRegime.regime[d] !== true) continue;
    if ((marketRegime.streak[d] ?? 0) < PB.REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[d];
    if (kospiVol == null || kospiVol > PB.VOL_CAP) continue;
    if (i < PB.MA_SHORT || atrPct[i] == null || atrPct[i] <= 0 || atrPct[i] > PB.STOCK_ATR_CAP) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (PB.MA_SHORT - 1); k <= i - 1; k++) { if (closes[k] > highS) { highS = closes[k]; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - PB.BREAKOUT_LOOKBACK;
    if (!recentBreakout || closes[i] > highS || closes[i] <= maShort[i]) continue;
    const pullbackPct = (highS - closes[i]) / highS * 100;
    const pullbackNorm = pullbackPct / atrPct[i];
    if (pullbackNorm > PB.BAND_K) continue;
    cond[i] = true;
    scoreArr[i] = { trendStrength: (maLong[i] - prior) / prior * 100, pullbackNorm };
  }
  const onset = []; for (let i = 1; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  const score = new Map(onset.map(i => [i, scoreArr[i]]));
  return { maShort, atrPct, onsetIdx: new Set(onset), score };
}
function precomputeDeviation(st) {
  const { dates, closes } = st; const n = dates.length;
  const ema5 = buildEma(closes, DV.FAST), ema20 = buildEma(closes, DV.SLOW), ema50 = buildEma(closes, DV.MID), ema200 = buildEma(closes, DV.LONG);
  const dev5 = closes.map((c, i) => ema5[i] != null ? (c - ema5[i]) / ema5[i] * 100 : null);
  const dev20 = closes.map((c, i) => ema20[i] != null ? (c - ema20[i]) / ema20[i] * 100 : null);
  const cond = new Array(n).fill(false);
  const scoreArr = new Array(n).fill(null); // {zSum, pctSum} — 동시신호 우선순위용
  for (let i = DV.ROLL - 1; i < n; i++) {
    if (dev5[i] == null || dev20[i] == null || ema50[i] == null || ema200[i] == null) continue;
    const win5 = dev5.slice(i - DV.ROLL + 1, i + 1), win20 = dev20.slice(i - DV.ROLL + 1, i + 1);
    if (win5.some(v => v == null) || win20.some(v => v == null)) continue;
    const m5 = mean(win5), sd5 = stdevPop(win5, m5), z5 = sd5 ? (dev5[i] - m5) / sd5 : 0, pct5 = win5.filter(v => v <= dev5[i]).length / win5.length * 100;
    const m20 = mean(win20), sd20 = stdevPop(win20, m20), z20 = sd20 ? (dev20[i] - m20) / sd20 : 0, pct20 = win20.filter(v => v <= dev20[i]).length / win20.length * 100;
    const sig5 = z5 <= DV.Z_THRESHOLD && pct5 <= DV.ENTRY_PCT_THRESHOLD;
    const sig20 = z20 <= DV.Z_THRESHOLD && pct20 <= DV.ENTRY_PCT_THRESHOLD;
    const downTrend = ema50[i] < ema200[i];
    cond[i] = sig5 && sig20 && downTrend;
    if (cond[i]) scoreArr[i] = { zSum: z5 + z20, pctSum: pct5 + pct20 };
  }
  const onset = []; for (let i = DV.ROLL; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  const score = new Map(onset.map(i => [i, scoreArr[i]]));
  return { ema5, ema20, onsetIdx: new Set(onset), score };
}
function precomputeRoundnumber(st) {
  const { dates, closes, highs, lows } = st; const n = dates.length;
  const events = new Map(); // idx -> {level, step, touchCount, aboveCount}
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1], cur = closes[i];
    const step = computeStepAt(highs, lows, i, RN.WINDOW_DAYS, RN.TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < RN.MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, i - 1 - RN.RECENT_LOOKBACK);
    let aboveCount = 0; for (let k = lo; k < i - 1; k++) if (closes[k] >= L) aboveCount++;
    if (aboveCount < RN.PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, RN.WINDOW_DAYS);
    if (touch < RN.MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RN.RECLAIM_WINDOW); f++) {
      if (closes[f] < L - step) break;
      if (closes[f] >= L) {
        if (closes[f] < L + step) {
          const entryPosition = (closes[f] - L) / step * 100;
          if (entryPosition >= RN.MIN_ENTRY_POSITION_PCT) events.set(f, { level: L, step, touchCount: touch, aboveCount });
        }
        break;
      }
    }
  }
  return { events };
}

async function fetchMarketRegime(p1, p2, symbol) {
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, PB.MA_LONG);
  const kospiAtr = buildAtr(chart.high, chart.low, closes, PB.KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {}; let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < PB.MA_LONG + PB.SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - PB.SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}

function currentKstMonth() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthEndDate(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // 다음달 0일 = 이번달 마지막날
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 이벤트드리븐 포지션/자본 시뮬레이션 — calendarSlice·startCapital만 바꾸면 "전체기간 복리" 실행과
// "특정월 1,000만원 리셋" 격리실행을 동일 로직으로 재사용(진입시그널 사전계산 데이터 pbData/dvData/rnData는
// 자본과 무관하므로 공유). snapshotTargets 지정 시 해당 날짜 직전 거래일 종가 기준 시가평가 스냅샷도 반환.
function runPortfolioSim(calendarSlice, startCapital, ctx, snapshotTargets = [], fixedSlotBudget = null) {
  const { byCode, idxMap, pbData, dvData, rnData, kospi5dRet, crashFilterOn, crashScope, crashExitOn, crashExitScope } = ctx;
  let cash = startCapital;
  let costBasisTotal = 0;
  const positions = [];
  const trades = [];
  let skipCount = 0;
  const pbCooldownUntil = new Map(); // code -> 종목자체seq idx(눌림목 손절 후 이 idx까지 재진입 금지, v13)
  const pendingSnapshots = [...snapshotTargets];
  const snapshots = {};

  function runningCapital() { return cash + costBasisTotal; }
  function markToMarket(asOfDate) {
    let mv = cash;
    for (const pos of positions) {
      const m = idxMap.get(pos.code); const i = m ? m.get(asOfDate) : null;
      const st = byCode.get(pos.code);
      const px = (i != null ? st.closes[i] : pos.entryPrice);
      mv += pos.remainingShares * px;
    }
    return mv;
  }
  function tryFullExit(pos, idx, price, reason, date) {
    const sharesSold = pos.remainingShares;
    const proceeds = sharesSold * price;
    cash += proceeds;
    costBasisTotal -= pos.costRemaining;
    pos.remainingShares = 0; pos.costRemaining = 0;
    pos.realizedCash += proceeds;
    pos.legs.push({ reason, date, shares: sharesSold });
    const totalReturn = (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100;
    trades.push({ strategy: pos.strategy, code: pos.code, name: pos.name, market: pos.market, entryDate: pos.entryDate, exitDate: date, entryPrice: pos.entryPrice, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: totalReturn, reason });
    return true;
  }
  function partialSell(pos, price, weightFrac, reason, date) {
    const sellShares = Math.round(pos.shares * weightFrac);
    const shares = Math.min(sellShares, pos.remainingShares);
    if (shares <= 0) return;
    const proceeds = shares * price;
    const costPortion = shares * pos.entryPrice;
    cash += proceeds; costBasisTotal -= costPortion;
    pos.remainingShares -= shares; pos.costRemaining -= costPortion;
    pos.realizedCash += proceeds;
    pos.legs.push({ reason, date, shares });
  }

  for (let di = 0; di < calendarSlice.length; di++) {
    const date = calendarSlice[di];

    while (pendingSnapshots.length && date >= pendingSnapshots[0]) {
      const target = pendingSnapshots.shift();
      const asOf = di > 0 ? calendarSlice[di - 1] : date; // 전일 종가 기준 시가평가("해당일 시작 시점" 자산)
      snapshots[target] = { asOfDate: asOf, value: markToMarket(asOf) };
    }

    const crash5d = kospi5dRet ? kospi5dRet.get(date) : null;
    const crashNow = crash5d != null && crash5d <= CRASH_FILTER.THRESHOLD_PCT;

    // ── EXIT PHASE ──
    for (let pi = positions.length - 1; pi >= 0; pi--) {
      const pos = positions[pi];
      const m = idxMap.get(pos.code); const i = m ? m.get(date) : null;
      if (i == null) continue; // 그 종목이 오늘 데이터 없음(상장폐지 등) — 스킵
      const st = byCode.get(pos.code);
      const close = st.closes[i];
      const daysHeld = i - pos.entryIdx;

      if (crashExitOn && crashNow) {
        const scopeKey = pos.strategy === '라운드넘버' ? 'rn' : pos.strategy === '괴리율' ? 'dv' : null;
        if (scopeKey && crashExitScope?.has(scopeKey)) {
          tryFullExit(pos, i, close, 'CRASH_EXIT', date);
          positions.splice(pi, 1);
          continue;
        }
      }

      if (pos.strategy === '눌림목') {
        const pb = pbData.get(pos.code);
        const maShort = pb.maShort[i];
        const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
        if (!pos.st.tpTaken && ret >= PB.TP_PCT) {
          pos.st.tpTaken = true; pos.st.tpReturn = ret; if (close > pos.st.peak) pos.st.peak = close;
          partialSell(pos, close, PB.TP_FRAC, 'TP10', date);
        } else {
          let exited = false;
          if (ret <= -pos.slFor) { tryFullExit(pos, i, close, 'SL', date); exited = true; pbCooldownUntil.set(pos.code, i + PB.COOLDOWN_DAYS); }
          else if (maShort != null && close < maShort) { tryFullExit(pos, i, close, 'TREND_BREAK', date); exited = true; }
          else {
            if (close > pos.st.peak) pos.st.peak = close;
            const trailRet = (close - pos.st.peak) / pos.st.peak * 100;
            if (trailRet <= -pos.trailFor) { tryFullExit(pos, i, close, 'TRAIL', date); exited = true; }
            else if (daysHeld >= PB.MAX_HOLD) { tryFullExit(pos, i, close, 'TIME', date); exited = true; }
          }
          if (exited) { positions.splice(pi, 1); continue; }
        }
        if (pos.remainingShares <= 0) positions.splice(pi, 1);
      } else if (pos.strategy === '괴리율') {
        const dv = dvData.get(pos.code);
        const ema20 = dv.ema20[i], ema5 = dv.ema5[i];
        const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
        if (ret <= -DV.SL) { tryFullExit(pos, i, close, 'SL', date); positions.splice(pi, 1); continue; }
        if (pos.st.stage === 'INIT' && ret >= DV.TP) { partialSell(pos, close, 0.5, 'TP20', date); pos.st.stage = 'TP20_DONE'; }
        if (pos.st.stage === 'TP20_DONE' && ema20 != null && close >= ema20) { partialSell(pos, close, 0.25, 'LEG20', date); pos.st.stage = 'HOLD'; } // 원본shares 기준 25%(=잔량50%의 50%)
        if (pos.st.stage === 'HOLD' && ema5 != null && close < ema5) { tryFullExit(pos, i, close, 'BREAKDOWN', date); positions.splice(pi, 1); continue; }
        if (daysHeld >= DV.MAX_HOLD && pos.remainingShares > 0) { tryFullExit(pos, i, close, 'TIME', date); positions.splice(pi, 1); continue; }
        if (pos.remainingShares <= 0) positions.splice(pi, 1);
      } else if (pos.strategy === '라운드넘버') {
        const stop = pos.st.level * (1 - RN.STOP_BUFFER_PCT / 100), target = pos.st.level + pos.st.step;
        if (close <= stop) { tryFullExit(pos, i, close, 'STOP', date); positions.splice(pi, 1); }
        else if (close >= target) { tryFullExit(pos, i, close, 'TP', date); positions.splice(pi, 1); }
        else if (daysHeld >= RN.MAX_HOLD) { tryFullExit(pos, i, close, 'TIME', date); positions.splice(pi, 1); }
      }
    }

    // ── ENTRY PHASE ──
    let openSlots = SLOTS - positions.length;
    if (openSlots <= 0) continue;
    const held = new Set(positions.map(p => p.code));

    const dvBlocked = !!crashFilterOn && crashNow && crashScope?.has('dv');
    const rnBlocked = !!crashFilterOn && crashNow && crashScope?.has('rn');

    const pbCandsRaw = [], dvCandsRaw = [], rnCandsRaw = [];
    for (const s of PD_UNIVERSE) {
      if (held.has(s.code)) continue;
      const st = byCode.get(s.code); if (!st) continue;
      const m = idxMap.get(s.code); const i = m ? m.get(date) : null; if (i == null) continue;
      const pb = pbData.get(s.code); if (pb.onsetIdx.has(i) && i > (pbCooldownUntil.get(s.code) ?? -1)) pbCandsRaw.push({ s, st, i, sc: pb.score.get(i) });
      const dv = dvData.get(s.code); if (!dvBlocked && dv.onsetIdx.has(i)) dvCandsRaw.push({ s, st, i, sc: dv.score.get(i) });
    }
    if (!rnBlocked) {
      for (const s of RN_UNIVERSE) {
        if (held.has(s.code)) continue;
        const rn = rnData.get(s.code); if (!rn) continue;
        const m = idxMap.get(s.code); const i = m ? m.get(date) : null; if (i == null) continue;
        const ev = rn.events.get(i); if (ev) rnCandsRaw.push({ s, st: byCode.get(s.code), i, ev });
      }
    }
    // 눌림목 동시신호 1~3순위 캡(추세강도desc·눌림폭ATR정규화asc, 2026-08-26 확장 적용)
    pbCandsRaw.sort((a, b) => (b.sc.trendStrength - a.sc.trendStrength) || (a.sc.pullbackNorm - b.sc.pullbackNorm));
    const pbCands = pbCandsRaw.slice(0, PB.CAP);
    skipCount += Math.max(0, pbCandsRaw.length - PB.CAP);
    // 괴리율 동시신호 1~3순위 캡(EMA5·20 Z합asc·백분위합asc, 2026-08-26 확장 적용)
    dvCandsRaw.sort((a, b) => (a.sc.zSum - b.sc.zSum) || (a.sc.pctSum - b.sc.pctSum));
    const dvCands = dvCandsRaw.slice(0, DV.CAP);
    skipCount += Math.max(0, dvCandsRaw.length - DV.CAP);
    // 라운드넘버 동시신호 1~3순위 캡(밀집도desc·지지일수desc)
    rnCandsRaw.sort((a, b) => (b.ev.touchCount - a.ev.touchCount) || (b.ev.aboveCount - a.ev.aboveCount));
    const rnCands = rnCandsRaw.slice(0, RN.CAP);
    skipCount += Math.max(0, rnCandsRaw.length - RN.CAP);

    const queue = [...pbCands.map(c => ({ ...c, strategy: '눌림목' })), ...dvCands.map(c => ({ ...c, strategy: '괴리율' })), ...rnCands.map(c => ({ ...c, strategy: '라운드넘버' }))];

    for (const cand of queue) {
      if (openSlots <= 0) { skipCount++; continue; }
      if (held.has(cand.s.code)) { continue; } // 같은 날 다른 전략이 이미 선점
      const price = cand.st.closes[cand.i];
      const budget = fixedSlotBudget != null ? Math.min(fixedSlotBudget, cash) : runningCapital() / SLOTS;
      const shares = Math.floor(budget / price);
      if (shares <= 0) { skipCount++; continue; }
      const investedTotal = shares * price;
      cash -= investedTotal; costBasisTotal += investedTotal;
      const pos = {
        strategy: cand.strategy, code: cand.s.code, name: cand.s.name, market: cand.s.market || 'KOSPI',
        entryDate: date, entryIdx: cand.i, entryPrice: price, shares, remainingShares: shares, costRemaining: investedTotal,
        investedTotal, realizedCash: 0, legs: [],
        slFor: cand.strategy === '눌림목' ? PB.SL : null,
        trailFor: cand.strategy === '눌림목' ? PB.TRAIL : null,
        st: cand.strategy === '눌림목' ? { tpTaken: false, tpReturn: null, peak: price }
          : cand.strategy === '괴리율' ? { stage: 'INIT' }
          : { level: cand.ev.level, step: cand.ev.step },
      };
      positions.push(pos); held.add(cand.s.code); openSlots--;
    }
  }

  return { trades, finalCash: cash, finalPositions: positions, skipCount, snapshots };
}

async function main() {
  const opts = parseArgs();
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(new Date(opts.fetchFrom + 'T00:00:00Z').getTime() / 1000);
  const toDate = opts.to || tsToKstDate(p2 - 9 * 3600);
  const targetMonth = opts.month || currentKstMonth();
  const monthStart = `${targetMonth}-01`;
  const isolatedTo = [monthEndDate(targetMonth), toDate].sort()[0]; // min(월말, toDate)

  console.error('[1/5] 지수·유니버스 시세 로드 중...');
  const [regimeKospi, regimeKosdaq] = await Promise.all([
    fetchMarketRegime(p1, p2, '^KS11'), fetchMarketRegime(p1, p2, '^KQ11'),
  ]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };

  const loaded = await batchAll(PD_UNIVERSE, s => loadStock(s, p1, p2));
  const byCode = new Map();
  for (const st of loaded) { if (!st.error) byCode.set(st.code, st); }
  console.error(`[1/5] 완료 — ${byCode.size}/${PD_UNIVERSE.length}종목 로드 성공`);

  console.error('[2/5] 전략별 지표·진입시그널 사전계산 중...');
  const pbData = new Map(), dvData = new Map(), rnData = new Map();
  for (const st of byCode.values()) {
    pbData.set(st.code, precomputePullback(st, regimeByMarket));
    dvData.set(st.code, precomputeDeviation(st));
  }
  for (const s of RN_UNIVERSE) { const st = byCode.get(s.code); if (st) rnData.set(s.code, precomputeRoundnumber(st)); }
  console.error('[2/5] 완료');

  // ── 3) 공용 거래일 캘린더 (코스피 지수 날짜 기준) ──
  const kospiChart = await fetchYahooChart('^KS11', p1, p2);
  if (!kospiChart || !kospiChart.ts.length) throw new Error('KOSPI 캘린더 조회 실패');
  const calendar = kospiChart.ts.map(tsToKstDate).filter(d => d >= opts.from && d <= toDate);
  console.error(`[3/5] 캘린더 ${calendar.length}거래일 (${opts.from} ~ ${toDate})`);

  // 종목별 date->idx 맵
  const idxMap = new Map();
  for (const st of byCode.values()) { const m = new Map(); st.dates.forEach((d, i) => m.set(d, i)); idxMap.set(st.code, m); }

  // ── 4) 시뮬레이션 실행 ──
  const kospiDatesAll = kospiChart.ts.map(tsToKstDate);
  const kospiClosesFF = fillForward(kospiChart.close);
  const kospi5dRet = new Map();
  for (let i = 0; i < kospiDatesAll.length; i++) {
    const from = Math.max(0, i - CRASH_FILTER.LOOKBACK_DAYS);
    if (kospiClosesFF[from] == null || kospiClosesFF[i] == null) continue;
    kospi5dRet.set(kospiDatesAll[i], (kospiClosesFF[i] - kospiClosesFF[from]) / kospiClosesFF[from] * 100);
  }
  const ctx = { byCode, idxMap, pbData, dvData, rnData, kospi5dRet, crashFilterOn: opts.crashFilter, crashScope: opts.crashScope, crashExitOn: opts.crashExit, crashExitScope: opts.crashExitScope };
  console.error(`[4/5] 급락주 진입차단: ${opts.crashFilter ? `ON(직전${CRASH_FILTER.LOOKBACK_DAYS}거래일 KOSPI ${CRASH_FILTER.THRESHOLD_PCT}% 이하 시 [${[...opts.crashScope].join(',')}] 신규진입 중단)` : 'OFF'} / 급락주 강제청산: ${opts.crashExit ? `ON([${[...opts.crashExitScope].join(',')}] 보유포지션 강제청산)` : 'OFF'}`);

  // (A) 전체기간 복리 실행 — 헤드라인/검증용, 기존과 동일
  const SNAPSHOT_TARGETS = ['2026-08-01', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'];
  console.error(`[4/5] 전체기간(복리) 시뮬레이션 실행 중...`);
  const fullRun = runPortfolioSim(calendar, START_CAPITAL, ctx, SNAPSHOT_TARGETS);
  const { trades, finalCash, finalPositions, skipCount, snapshots } = fullRun;
  console.error(`[4/5] 완료 — 청산 ${trades.length}건, 미청산(보유중) ${finalPositions.length}건, 슬롯부족 스킵 ${skipCount}건`);

  const finalCapital = finalCash + finalPositions.reduce((a, p) => a + p.remainingShares * (byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice), 0);
  const totalReturn = (finalCapital - START_CAPITAL) / START_CAPITAL * 100;

  console.log(`\n━━━ 기초자산 스냅샷(복리반영, 전일 종가 시가평가) ━━━`);
  for (const target of SNAPSHOT_TARGETS) {
    const s = snapshots[target];
    if (s) console.log(`  ${target} 기준(${s.asOfDate} 종가 시가평가): ${fmtWon(s.value)}원`);
  }

  console.log(`\n━━━ 전체 검증(${opts.from}~${toDate}) ━━━`);
  console.log(`시작자본 ${fmtWon(START_CAPITAL)}원 → 최종(현금+미청산 시가평가) ${fmtWon(finalCapital)}원 (${fmtPct(totalReturn)})`);
  console.log(`총 청산 ${trades.length}건 (미청산 보유중 ${finalPositions.length}건 제외)`);
  const byStrat = {};
  for (const t of trades) { (byStrat[t.strategy] ||= []).push(t); }
  console.log('\n전략별 청산 실적(전체 기간):');
  for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
    const arr = byStrat[strat] || [];
    const pnl = arr.reduce((a, t) => a + t.realizedPnl, 0);
    console.log(`  ${strat.padEnd(6)} ${String(arr.length).padStart(4)}건  실현손익 ${fmtWon(pnl)}원`);
  }
  const totalPnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  console.log(`  합계    ${String(trades.length).padStart(4)}건  실현손익 ${fmtWon(totalPnl)}원`);

  function monthAgg(fromD, toD, label) {
    const sub = trades.filter(t => t.exitDate >= fromD && t.exitDate <= toD);
    console.log(`\n━━━ ${label}(${fromD}~${toD}) 청산 집계 — 전략별 수익금(복리·실제 슬롯예산) ━━━`);
    let totN = 0, totPnl = 0;
    for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
      const arr = sub.filter(t => t.strategy === strat);
      const pnl = arr.reduce((a, t) => a + t.realizedPnl, 0);
      const stocks = new Set(arr.map(t => t.code)).size;
      totN += arr.length; totPnl += pnl;
      console.log(`  ${strat.padEnd(6)} ${String(arr.length).padStart(3)}건(${stocks}종목)  실현손익 ${fmtWon(pnl)}원  건당평균 ${arr.length ? fmtWon(pnl / arr.length) : '─'}원`);
    }
    console.log(`  합계    ${String(totN).padStart(3)}건  실현손익 ${fmtWon(totPnl)}원  건당평균 ${totN ? fmtWon(totPnl / totN) : '─'}원`);
    return sub;
  }
  const compoundedMonthTrades = opts.year ? null : monthAgg(monthStart, isolatedTo, `${targetMonth}`);

  function printWeeklyTable(label, arr, tag) {
    const byWeek = {};
    for (const t of arr) {
      const wk = weekBucket(t.exitDate);
      byWeek[wk] ||= { n: 0, invested: 0, pnl: 0 };
      byWeek[wk].n++; byWeek[wk].invested += t.investedTotal; byWeek[wk].pnl += t.realizedPnl;
    }
    console.log(`\n· ${label} (${targetMonth} 주간 청산 집계${tag ? ', ' + tag : ''})`);
    console.log('주(월~일)\t건수\t투입금액\t손익금액\t수익률');
    let tn = 0, tinv = 0, tpnl = 0;
    for (const wk of Object.keys(byWeek).sort()) {
      const s = byWeek[wk];
      const pct = s.invested ? (s.pnl / s.invested * 100).toFixed(2) : '0.00';
      console.log(`${wk}\t${s.n}건\t${fmtWon(s.invested)}원\t${fmtWon(s.pnl)}원\t${pct}%`);
      tn += s.n; tinv += s.invested; tpnl += s.pnl;
    }
    const tpct = tinv ? (tpnl / tinv * 100).toFixed(2) : '0.00';
    console.log(`합계\t${tn}건\t${fmtWon(tinv)}원\t${fmtWon(tpnl)}원\t${tpct}%`);
  }
  if (!opts.year) {
    console.log(`\n━━━ ${targetMonth} 전략별 주간 세부표(복리반영, 실제 슬롯예산) ━━━`);
    for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
      printWeeklyTable(strat, compoundedMonthTrades.filter(t => t.strategy === strat));
    }
    printWeeklyTable('전체(3전략 합계)', compoundedMonthTrades);
  }

  if (opts.list && !opts.year) {
    console.log(`\n━━━ ${targetMonth} 개별 청산건 목록(복리 실행 기준, 진입일 순) ━━━`);
    console.log('전략\t종목\t진입일\t청산일\t사유\t진입가\t수익률\t손익금');
    const sorted = [...compoundedMonthTrades].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    for (const t of sorted) {
      console.log(`${t.strategy}\t${t.name}(${t.code})\t${t.entryDate}\t${t.exitDate}\t${t.reason}\t${fmtWon(t.entryPrice)}\t${t.ret.toFixed(2)}%\t${fmtWon(t.realizedPnl)}원`);
    }
  }

  // (B) 슬롯당 고정 200만원(5슬롯=1,000만원) 예산 — 월초 리셋 없이 전체기간 연속 시뮬레이션(실전 운용방침과 동일한
  // 고정 슬롯예산, 2026-08-25 확정). 진입시그널 사전계산은 자본과 무관해 그대로 재사용, 슬롯 예산만 복리로 커지지
  // 않고 매 진입 시 항상 200만원(현금 부족 시 남은 현금까지만)으로 고정. 여기서 해당월 청산분만 발췌해 집계.
  const FIXED_SLOT_BUDGET = 2_000_000;
  console.error(`[5/5] 슬롯당 고정 ${fmtWon(FIXED_SLOT_BUDGET)}원 전체기간 시뮬레이션 실행 중...`);
  const fixedRun = runPortfolioSim(calendar, SLOTS * FIXED_SLOT_BUDGET, ctx, [], FIXED_SLOT_BUDGET);
  console.error(`[5/5] 완료 — 청산 ${fixedRun.trades.length}건, 미청산 ${fixedRun.finalPositions.length}건, 슬롯부족 스킵 ${fixedRun.skipCount}건`);

  if (opts.dump) {
    const fs = await import('fs');
    const kospiDates = kospiChart.ts.map(tsToKstDate);
    fs.writeFileSync(opts.dump, JSON.stringify({
      trades, fixedTrades: fixedRun.trades,
      kospi: { dates: kospiDates, close: kospiChart.close, high: kospiChart.high, low: kospiChart.low },
      regimeKospi, regimeKosdaq,
    }));
    console.error(`[dump] ${opts.dump} 저장 완료`);
  }

  if (!opts.year) {
    const fixedMonthTrades = fixedRun.trades.filter(t => t.exitDate >= monthStart && t.exitDate <= isolatedTo);
    console.log(`\n━━━ ${targetMonth} 청산 집계 — 전략별 수익금(슬롯당 고정 ${fmtWon(FIXED_SLOT_BUDGET)}원, 전체기간 연속 시뮬) ━━━`);
    let ftotN = 0, ftotPnl = 0, ftotInv = 0;
    for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
      const arr = fixedMonthTrades.filter(t => t.strategy === strat);
      const pnl = arr.reduce((a, t) => a + t.realizedPnl, 0);
      const invested = arr.reduce((a, t) => a + t.investedTotal, 0);
      const stocks = new Set(arr.map(t => t.code)).size;
      ftotN += arr.length; ftotPnl += pnl; ftotInv += invested;
      console.log(`  ${strat.padEnd(6)} ${String(arr.length).padStart(3)}건(${stocks}종목)  투입 ${fmtWon(invested)}원  실현손익 ${fmtWon(pnl)}원  건당평균 ${arr.length ? fmtWon(pnl / arr.length) : '─'}원`);
    }
    const ftotPct = ftotInv ? (ftotPnl / ftotInv * 100).toFixed(2) : '0.00';
    console.log(`  합계    ${String(ftotN).padStart(3)}건  투입 ${fmtWon(ftotInv)}원  실현손익 ${fmtWon(ftotPnl)}원  수익률 ${ftotPct}%`);

    console.log(`\n━━━ ${targetMonth} 전략별 주간 세부표(슬롯당 고정 ${fmtWon(FIXED_SLOT_BUDGET)}원, 전체기간 연속 시뮬) ━━━`);
    for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
      printWeeklyTable(strat, fixedMonthTrades.filter(t => t.strategy === strat), '고정슬롯시뮬');
    }
    printWeeklyTable('전체(3전략 합계)', fixedMonthTrades, '고정슬롯시뮬');
  }

  // ── 연간 월별 집계 모드(--year) ──
  if (opts.year) {
    const y = opts.year;
    const nowKstMonth = currentKstMonth(); // YYYY-MM
    const lastMonthNum = y === nowKstMonth.slice(0, 4) ? Number(nowKstMonth.slice(5, 7)) : 12;
    console.log(`\n━━━ ${y}년 월별 청산 수익금 집계 — 복리(실제 슬롯예산) vs 슬롯당 고정 ${fmtWon(FIXED_SLOT_BUDGET)}원 ━━━`);
    console.log('월\t복리건수\t복리투입금\t복리손익금\t복리수익률\t고정건수\t고정투입금\t고정손익금\t고정수익률');
    let cTotN = 0, cTotInv = 0, cTotPnl = 0, fTotN = 0, fTotInv = 0, fTotPnl = 0;
    for (let m = 1; m <= lastMonthNum; m++) {
      const mm = `${y}-${String(m).padStart(2, '0')}`;
      const mStart = `${mm}-01`;
      const mEnd = [monthEndDate(mm), toDate].sort()[0];
      if (mStart > toDate) break;
      const cArr = trades.filter(t => t.exitDate >= mStart && t.exitDate <= mEnd);
      const cPnl = cArr.reduce((a, t) => a + t.realizedPnl, 0);
      const cInv = cArr.reduce((a, t) => a + t.investedTotal, 0);
      const cPct = cInv ? (cPnl / cInv * 100).toFixed(2) : '0.00';
      const fArr = fixedRun.trades.filter(t => t.exitDate >= mStart && t.exitDate <= mEnd);
      const fPnl = fArr.reduce((a, t) => a + t.realizedPnl, 0);
      const fInv = fArr.reduce((a, t) => a + t.investedTotal, 0);
      const fPct = fInv ? (fPnl / fInv * 100).toFixed(2) : '0.00';
      cTotN += cArr.length; cTotInv += cInv; cTotPnl += cPnl; fTotN += fArr.length; fTotInv += fInv; fTotPnl += fPnl;
      console.log(`${mm}\t${cArr.length}건\t${fmtWon(cInv)}원\t${fmtWon(cPnl)}원\t${cPct}%\t${fArr.length}건\t${fmtWon(fInv)}원\t${fmtWon(fPnl)}원\t${fPct}%`);
    }
    const cTotPct = cTotInv ? (cTotPnl / cTotInv * 100).toFixed(2) : '0.00';
    const fTotPct = fTotInv ? (fTotPnl / fTotInv * 100).toFixed(2) : '0.00';
    console.log(`합계\t${cTotN}건\t${fmtWon(cTotInv)}원\t${fmtWon(cTotPnl)}원\t${cTotPct}%\t${fTotN}건\t${fmtWon(fTotInv)}원\t${fmtWon(fTotPnl)}원\t${fTotPct}%`);
  }
}

main().catch(e => { console.error('오류:', e.message, e.stack); process.exit(1); });
