// 괴리율(평균회귀) 전략 청산조건 v3 백테스트 — 2026-08-26
// 사용자 요청: 기존 5단계 청산(SL15%→TP+20%50%익절→EMA20돌파25%익절→EMA5하향이탈 전량→시간청산20일)에서
//   ① 손절(SL): -15% 유지하되 재조정(sweep)
//   ② +20% 익절 단계: 완전 삭제
//   ③ 신규: EMA20 돌파(확인) 이후 → EMA5 하향이탈 시 전량청산 (부분매도 없음, 단일 트리거)
//   ④ 시간청산: 20거래일 유지하되 재조정(sweep)
// 진입조건은 변경 없음(project_3strategy_combined_portfolio_backtest.mjs의 precomputeDeviation과 동일):
//   EMA5·EMA20 각각 Z<=-2 & 위치<=3%ile(롤링250일) AND EMA50<EMA200(장기하락추세), 신호 onset(새로 참이 된 날)만 채택
// 신호단위(비중동일) 백테스트 — 포트폴리오 자본배분은 반영하지 않음(순수 청산규칙 비교 목적)
//
// 사용법: node scripts/project_deviation_exit_v3_sweep.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
const UNIVERSE = [...FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })), ...FALLBACK_KOSDAQ];

const DV = { ROLL: 250, Z_THRESHOLD: -2, ENTRY_PCT_THRESHOLD: 3, FAST: 5, SLOW: 20, MID: 50, LONG: 200 };
const BASE_SL = 15, BASE_HOLD = 20; // 기존값
const SL_CANDIDATES = [8, 10, 12, 15, 18, 20, 25, Infinity]; // Infinity=무손절
const HOLD_CANDIDATES = [10, 15, 20, 25, 30, 40];

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
      return { ts: result.timestamp || [], close: q.close || [] };
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
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdevPop(arr, m) { return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function loadStock(stock, p1, p2) {
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  return { ...stock, dates, closes };
}

function precomputeDeviation(st) {
  const { closes } = st; const n = closes.length;
  const ema5 = buildEma(closes, DV.FAST), ema20 = buildEma(closes, DV.SLOW), ema50 = buildEma(closes, DV.MID), ema200 = buildEma(closes, DV.LONG);
  const dev5 = closes.map((c, i) => ema5[i] != null ? (c - ema5[i]) / ema5[i] * 100 : null);
  const dev20 = closes.map((c, i) => ema20[i] != null ? (c - ema20[i]) / ema20[i] * 100 : null);
  const cond = new Array(n).fill(false);
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
  }
  const onset = []; for (let i = DV.ROLL; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  return { ema5, ema20, onsetIdx: onset };
}

// 신규 청산 시뮬레이션: SL(slPct) 최우선 → EMA20종가돌파 확인(HOLD진입) → HOLD중 EMA5종가하향이탈 시 전량청산 → 시간청산(maxHold)
function simulateExit(closes, ema5, ema20, entryIdx, slPct, maxHold) {
  const entryPrice = closes[entryIdx];
  let stage = 'INIT';
  const n = closes.length;
  for (let i = entryIdx + 1; i < n; i++) {
    const close = closes[i]; if (close == null) continue;
    const daysHeld = i - entryIdx;
    const ret = (close - entryPrice) / entryPrice * 100;
    if (Number.isFinite(slPct) && ret <= -slPct) return { exitIdx: i, ret, reason: 'SL', daysHeld };
    if (stage === 'INIT' && ema20[i] != null && close >= ema20[i]) stage = 'HOLD';
    if (stage === 'HOLD' && ema5[i] != null && close < ema5[i]) return { exitIdx: i, ret, reason: 'BREAKDOWN', daysHeld };
    if (daysHeld >= maxHold) return { exitIdx: i, ret, reason: 'TIME', daysHeld };
  }
  const lastIdx = n - 1, lastClose = closes[lastIdx];
  return { exitIdx: lastIdx, ret: (lastClose - entryPrice) / entryPrice * 100, reason: 'OPEN', daysHeld: lastIdx - entryIdx };
}

function aggregate(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const rets = trades.map(t => t.ret);
  const avg = mean(rets);
  const sorted = [...rets].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const winRate = trades.filter(t => t.ret > 0).length / n * 100;
  const sd = Math.sqrt(mean(rets.map(r => (r - avg) ** 2)));
  const avgDays = mean(trades.map(t => t.daysHeld));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  const worst = Math.min(...rets);
  return { n, avg, median, winRate, sd, avgDays, reasonCount, worst };
}
function fmtRow(label, agg) {
  if (agg.n === 0) return `${label}\tn=0`;
  const rc = Object.entries(agg.reasonCount).map(([k, v]) => `${k}:${v}`).join(' ');
  return `${label}\tn=${agg.n}\t평균${agg.avg >= 0 ? '+' : ''}${agg.avg.toFixed(2)}%\t중앙값${agg.median >= 0 ? '+' : ''}${agg.median.toFixed(2)}%\t승률${agg.winRate.toFixed(1)}%\t표준편차${agg.sd.toFixed(2)}%p\t최저${agg.worst.toFixed(2)}%\t평균보유${agg.avgDays.toFixed(1)}일\t[${rc}]`;
}

async function main() {
  const from = '2019-08-27', fetchFrom = '2017-01-01', to = new Date().toISOString().slice(0, 10);
  const p1 = Math.floor(new Date(fetchFrom + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);

  console.error(`[1/3] ${UNIVERSE.length}종목 시세 로드 중...`);
  const stocks = await batchAll(UNIVERSE, s => loadStock(s, p1, p2));
  const ok = stocks.filter(s => !s.error);
  console.error(`[1/3] 완료 — ${ok.length}/${UNIVERSE.length}종목 로드 성공`);

  console.error('[2/3] 진입신호(onset) 계산 중...');
  const fromIdx = new Map(); // code -> index of `from` date (for filtering onset to backtest window)
  const pre = new Map();
  for (const st of ok) {
    const dv = precomputeDeviation(st);
    pre.set(st.code, dv);
    let fi = st.dates.findIndex(d => d >= from);
    if (fi < 0) fi = st.dates.length;
    fromIdx.set(st.code, fi);
  }
  let totalOnsets = 0;
  const signals = []; // {code, name, idx, closes, ema5, ema20}
  for (const st of ok) {
    const dv = pre.get(st.code);
    const fi = fromIdx.get(st.code);
    for (const idx of dv.onsetIdx) {
      if (idx < fi) continue;
      signals.push({ code: st.code, name: st.name, idx, closes: st.closes, ema5: dv.ema5, ema20: dv.ema20 });
      totalOnsets++;
    }
  }
  console.error(`[2/3] 완료 — 2019-08-27~${to} 구간 진입신호 ${totalOnsets}건`);

  console.error('[3/3] 청산 sweep 실행 중...');

  // (a) SL sweep, HOLD=기존(20일 고정)
  console.log('\n━━━ ① SL(손절) sweep — 시간청산 20거래일(기존) 고정, EMA20돌파확인→EMA5하향이탈 전량청산 ━━━');
  for (const sl of SL_CANDIDATES) {
    const trades = signals.map(s => simulateExit(s.closes, s.ema5, s.ema20, s.idx, sl, BASE_HOLD)).filter(t => t.reason !== 'OPEN');
    const agg = aggregate(trades);
    console.log(fmtRow(`SL${Number.isFinite(sl) ? -sl + '%' : '무손절'}${sl === BASE_SL ? '(기존)' : ''}`, agg));
  }

  // (b) HOLD sweep, SL=기존(-15% 고정)
  console.log('\n━━━ ② 시간청산 sweep — 손절 -15%(기존) 고정, EMA20돌파확인→EMA5하향이탈 전량청산 ━━━');
  for (const hold of HOLD_CANDIDATES) {
    const trades = signals.map(s => simulateExit(s.closes, s.ema5, s.ema20, s.idx, BASE_SL, hold)).filter(t => t.reason !== 'OPEN');
    const agg = aggregate(trades);
    console.log(fmtRow(`시간청산${hold}일${hold === BASE_HOLD ? '(기존)' : ''}`, agg));
  }

  // (c) 기준(기존값 SL15/HOLD20) 신규규칙 vs 구규칙(TP20+LEG20 포함) 비교
  console.log('\n━━━ ③ 참고: 기존값(SL-15%/시간청산20일) 기준, 신규청산(TP삭제) vs 구청산(+20%익절 포함) 비교 ━━━');
  const newTrades = signals.map(s => simulateExit(s.closes, s.ema5, s.ema20, s.idx, BASE_SL, BASE_HOLD)).filter(t => t.reason !== 'OPEN');
  console.log(fmtRow('신규청산(TP삭제, EMA20확인→EMA5이탈)', aggregate(newTrades)));
  console.log('(구청산 수치는 이전 대화의 "괴리율 전략 진입/청산조건" 응답 참고 — TP20/LEG20 부분매도 포함이라 이 스크립트와 직접 비교 시 부분매도 가중평균 방식 차이 유의)');

  console.error('[3/3] 완료');
}

main().catch(e => { console.error('실행 실패:', e); process.exit(1); });
