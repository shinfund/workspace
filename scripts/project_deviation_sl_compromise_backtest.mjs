// 괴리율(평균회귀) 전략 손절 절충안 백테스트 — 2026-08-26
// project_deviation_exit_v3_sweep.mjs에서 "+20% 익절 삭제"가 성과를 악화시킨다는 결과가 나온 뒤,
// 사용자가 "손절만 절충안으로 백테스트"(+20% 익절은 유지, 손절만 -8%~-12%로 조임)를 요청 → 이 스크립트로 검증.
// 청산은 기존 5단계 그대로 유지, SL만 sweep:
//   ①손절(sweep) ②진입가대비+20%도달시 50%익절 ③이후 종가>=EMA20 돌파시 잔량50%(전체25%)익절
//   ④이후 종가<EMA5 하향이탈시 잔량전량청산 ⑤시간청산20거래일(기존)
// 진입조건은 변경 없음(EMA5·EMA20 각각 Z<=-2 & 위치<=3%ile AND EMA50<EMA200), 신호단위(가중평균) 백테스트.
//
// 사용법: node scripts/project_deviation_sl_compromise_backtest.mjs
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
const TP_PCT = 20, BASE_HOLD = 20, BASE_SL = 15; // 기존값(변경 없음)
const SL_CANDIDATES = [8, 10, 12, 15]; // 절충안 후보(8/10/12) + 기존(15) 비교기준

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

// 기존 5단계 청산 그대로(SL만 파라미터화): SL(sweep) → +20%도달시 50%익절 → EMA20돌파시 잔량50%(전체25%)익절
// → EMA5하향이탈시 잔량전량 → 시간청산20일. 트레이드 수익률은 레그별 매도비중 가중평균.
function simulateExitOriginal(closes, ema5, ema20, entryIdx, slPct, tpPct, maxHold) {
  const entryPrice = closes[entryIdx];
  let stage = 'INIT', remaining = 1.0, weightedRet = 0;
  const legs = [];
  const n = closes.length;
  for (let i = entryIdx + 1; i < n; i++) {
    const close = closes[i]; if (close == null) continue;
    const daysHeld = i - entryIdx;
    const ret = (close - entryPrice) / entryPrice * 100;
    if (ret <= -slPct) { weightedRet += remaining * ret; legs.push('SL'); return { ret: weightedRet, reason: 'SL', daysHeld, legs }; }
    if (stage === 'INIT' && ret >= tpPct) { weightedRet += 0.5 * ret; remaining -= 0.5; stage = 'TP20_DONE'; legs.push('TP20'); }
    if (stage === 'TP20_DONE' && ema20[i] != null && close >= ema20[i]) { weightedRet += 0.25 * ret; remaining -= 0.25; stage = 'HOLD'; legs.push('LEG20'); }
    if (stage === 'HOLD' && ema5[i] != null && close < ema5[i]) { weightedRet += remaining * ret; legs.push('BREAKDOWN'); return { ret: weightedRet, reason: 'BREAKDOWN', daysHeld, legs }; }
    if (daysHeld >= maxHold && remaining > 0) { weightedRet += remaining * ret; legs.push('TIME'); return { ret: weightedRet, reason: 'TIME', daysHeld, legs }; }
  }
  const lastIdx = n - 1, lastClose = closes[lastIdx];
  const ret = (lastClose - entryPrice) / entryPrice * 100;
  weightedRet += remaining * ret;
  return { ret: weightedRet, reason: 'OPEN', daysHeld: lastIdx - entryIdx, legs };
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
  const tp20Rate = trades.filter(t => t.legs.includes('TP20')).length / n * 100;
  const leg20Rate = trades.filter(t => t.legs.includes('LEG20')).length / n * 100;
  const worst = Math.min(...rets);
  return { n, avg, median, winRate, sd, avgDays, reasonCount, worst, tp20Rate, leg20Rate };
}
function fmtRow(label, agg) {
  if (agg.n === 0) return `${label}\tn=0`;
  const rc = Object.entries(agg.reasonCount).map(([k, v]) => `${k}:${v}`).join(' ');
  return `${label}\tn=${agg.n}\t평균${agg.avg >= 0 ? '+' : ''}${agg.avg.toFixed(2)}%\t중앙값${agg.median >= 0 ? '+' : ''}${agg.median.toFixed(2)}%\t승률${agg.winRate.toFixed(1)}%\t표준편차${agg.sd.toFixed(2)}%p\t최저${agg.worst.toFixed(2)}%\t평균보유${agg.avgDays.toFixed(1)}일\tTP20도달률${agg.tp20Rate.toFixed(1)}%\tLEG20도달률${agg.leg20Rate.toFixed(1)}%\t[최종청산${rc}]`;
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
  const fromIdx = new Map(); const pre = new Map();
  for (const st of ok) {
    const dv = precomputeDeviation(st);
    pre.set(st.code, dv);
    let fi = st.dates.findIndex(d => d >= from); if (fi < 0) fi = st.dates.length;
    fromIdx.set(st.code, fi);
  }
  const signals = [];
  for (const st of ok) {
    const dv = pre.get(st.code); const fi = fromIdx.get(st.code);
    for (const idx of dv.onsetIdx) { if (idx < fi) continue; signals.push({ code: st.code, name: st.name, idx, closes: st.closes, ema5: dv.ema5, ema20: dv.ema20 }); }
  }
  console.error(`[2/3] 완료 — 진입신호 ${signals.length}건`);

  console.error('[3/3] SL 절충안 sweep 실행 중(TP+20%·시간청산20일 기존 유지)...');
  console.log('\n━━━ 손절 절충안 sweep — TP+20%익절/EMA20돌파25%익절/EMA5하향이탈전량/시간청산20일 기존 구조 유지, SL만 조정 ━━━');
  for (const sl of SL_CANDIDATES) {
    const trades = signals.map(s => simulateExitOriginal(s.closes, s.ema5, s.ema20, s.idx, sl, TP_PCT, BASE_HOLD)).filter(t => t.reason !== 'OPEN');
    const agg = aggregate(trades);
    console.log(fmtRow(`SL-${sl}%${sl === BASE_SL ? '(기존)' : ''}`, agg));
  }
  console.error('[3/3] 완료');
}

main().catch(e => { console.error('실행 실패:', e); process.exit(1); });
