// EMA200 기준선 파동 전략 — 청산 트리거를 괴리율 전략 방식으로 교체한 백테스트 — 2026-08-26
// 사용자 요청: "괴리율 청산 트리거를 기준선 전략 청산 트리거에 사용하면 어떤 결과가 나오는지" —
// 두 전략 모두 하향추세(EMA200 아래) 구간에서 진입하는 역추세 전략이라 청산 기준도 비슷하게 맞을 것
// 같다는 가설 검증. 기준선 전략은 원래 손절 자동규칙이 없어(사용자 지시: 수동판단 영역) 이번에 괴리율의
// 손절(-12%, 2026-08-26 재조정 확정)도 함께 이식.
//
// 진입은 기준선 전략 그대로 유지 + 신규 필터 2종(2026-08-26 사용자 요청):
//   ① 종가<EMA200 연속 --min-streak(기본16)거래일 이상 ② dev200 롤링250일 Z<=--z(기본-1.25)
//   ③ vlow 반등신호(최저점 갱신 후 첫 EMA5 상향돌파) — 충족마다 최대 --max-buy-legs(기본2)회 분할매수(50%씩)
//   ④ [신규·항상적용] 진입일 당일 종가 < EMA20 (이미 EMA20 위로 올라온 신호는 배제 — "당연히 안 되는" 케이스)
//   ⑤ [신규·옵션 --require-high-touch-ema20] 진입일 당일 고가 >= EMA20 (당일 장중 EMA20에 닿았는지) — 효과
//      불확실해 사용자가 백테스트로 확인 요청, 기본 비활성으로 두고 두 버전을 나란히 비교 실행
//   단, 이번 버전은 "청산 1단계(TP20)가 시작되기 전까지만" 추가매수 허용(그 이후는 포지션 정리 단계로 간주)
//
// 청산을 괴리율 전략 5단계로 전면 교체(기준선 고유의 회복대기/파동매도/BASELINE_BREAK 전부 제거):
//   ①손절(평단가 대비 -12%, 최우선) ②평단가 대비 +20%도달시 50%익절 ③이후 종가>=EMA20 돌파시 잔량50%
//   (전체25%)익절 ④이후 종가<EMA5 하향이탈시 잔량전량청산 ⑤시간청산 20거래일(최초진입일 기준)
//
// 사용법: node scripts/project_baseline_deviation_exit_backtest.mjs [--min-streak N] [--z N] [--max-buy-legs N]
//   [--sl N] [--tp N] [--max-hold N] [--calendar-days N] [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (기준선 백테스트와 동일 유니버스, 2026-08-03 KIS 기준)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '105560', name: 'KB금융' }, { code: '028260', name: '삼성물산' }, { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' }, { code: '068270', name: '셀트리온' }, { code: '012330', name: '현대모비스' }, { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '006400', name: '삼성SDI' }, { code: '000810', name: '삼성화재' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' }, { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' }, { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' }, { code: '042700', name: '한미반도체' }, { code: '011200', name: 'HMM' }, { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' }, { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' }, { code: '010140', name: '삼성중공업' }, { code: '051910', name: 'LG화학' }, { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' }, { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' }, { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const ROLL = 250, FAST_PERIOD = 5, SLOW_PERIOD = 20, BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, minStreak: 16, z: -1.25, maxBuyLegs: 2, sl: 12, tp: 20, maxHold: 20, calendarDays: 2555, requireHighTouchEma20: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-streak') o.minStreak = parseInt(argv[++i]);
    if (argv[i] === '--z') o.z = parseFloat(argv[++i]);
    if (argv[i] === '--max-buy-legs') o.maxBuyLegs = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--tp') o.tp = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--require-high-touch-ema20') o.requireHighTouchEma20 = true; // 진입일 고가>=EMA20 추가 요구(옵션)
    if (argv[i] === '--stocks') o.stocks = argv[++i].split(',').map(s => { const [code, name, market] = s.split(':'); return { code, name: name || code, market: market || 'KOSPI' }; });
  }
  return o;
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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) { const price = closes[i]; if (price == null) continue; if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; } else ema = price * k + ema * (1 - k); emas[i] = ema; }
  return emas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// 기준선 전략과 동일한 vlow 반등신호(최저점 갱신 후 첫 EMA5 상향돌파)
function buildVLowSignal(seq) {
  const sig = new Array(seq.length).fill(false);
  let runningLow = null, awaitingBounce = false;
  for (let i = 0; i < seq.length; i++) {
    const belowBase = seq[i].close < seq[i].ema200;
    if (!belowBase) { runningLow = null; awaitingBounce = false; continue; }
    if (runningLow === null || seq[i].close < runningLow) { runningLow = seq[i].close; awaitingBounce = true; }
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
    if (crossUp5 && awaitingBounce) { sig[i] = true; awaitingBounce = false; }
  }
  return sig;
}
function rollingZ(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  return sd ? (seq[j].dev200 - m) / sd : 0;
}

// 진입: 기준선 전략 그대로(스트릭+Z+vlow반등, 최대 maxBuyLegs회 분할매수 — TP20 시작 전까지만 추가매수 허용)
// 청산: 괴리율 전략 5단계(SL→TP+20%50%→EMA20돌파25%→EMA5하향이탈전량→시간청산) 그대로 이식
function simulateTrade(seq, i0, opts) {
  let buyCount = 1, costSum = seq[i0].close;
  let stage = 'INIT', remaining = 1.0, weightedRet = 0;
  const legs = [];
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 미확정(최근 신호)
    const close = seq[j].close, ema5 = seq[j].ema5, ema20 = seq[j].ema20;

    // 추가 분할매수(청산 1단계 시작 전까지만, 기준선 원본과 동일 조건: 스트릭 유지+Z+vlow재충족)
    if (stage === 'INIT' && buyCount < opts.maxBuyLegs && seq[j].close < seq[j].ema200 && seq[j].bounce && rollingZ(seq, j) <= opts.z) {
      buyCount += 1; costSum += close;
    }

    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;

    if (ret <= -opts.sl) { weightedRet += remaining * ret; legs.push({ reason: 'SL', ret, day: d }); return finish('SL'); }
    if (stage === 'INIT' && ret >= opts.tp) { weightedRet += 0.5 * ret; remaining -= 0.5; stage = 'TP20_DONE'; legs.push({ reason: 'TP20', ret, day: d }); }
    if (stage === 'TP20_DONE' && ema20 != null && close >= ema20) { weightedRet += 0.25 * ret; remaining -= 0.25; stage = 'HOLD'; legs.push({ reason: 'LEG20', ret, day: d }); }
    if (stage === 'HOLD' && ema5 != null && close < ema5) { weightedRet += remaining * ret; legs.push({ reason: 'BREAKDOWN', ret, day: d }); return finish('BREAKDOWN'); }
    if (d >= opts.maxHold && remaining > 0) { weightedRet += remaining * ret; legs.push({ reason: 'TIME', ret, day: d }); return finish('TIME'); }

    function finish(reason) {
      return { legs, weightedRet, finalDay: d, finalReason: reason, entryDate: seq[i0].date, buyCount };
    }
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
  const closes = chart.close, highs = chart.high;
  const ema5s = buildEma(closes, FAST_PERIOD), ema20s = buildEma(closes, SLOW_PERIOD), ema200s = buildEma(closes, BASE_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || highs[i] == null || ema5s[i] == null || ema20s[i] == null || ema200s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], high: highs[i], ema5: ema5s[i], ema20: ema20s[i], ema200: ema200s[i], dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100 });
  }
  if (seq.length < ROLL + opts.minStreak + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  const bounceSig = buildVLowSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const belowEma20 = seq[i].close < seq[i].ema20; // 신규 필터: 진입일 종가가 이미 EMA20 위면 배제
    const highTouchOk = !opts.requireHighTouchEma20 || seq[i].high >= seq[i].ema20; // 신규 옵션 필터: 진입일 고가가 EMA20에 닿았는지
    flags[i] = streak[i] >= opts.minStreak && seq[i].bounce && rollingZ(seq, i) <= opts.z && belowEma20 && highTouchOk;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) if (flags[i] && !flags[i - 1]) events.push(i);

  const trades = [];
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts);
    if (t) trades.push({ name: stock.name, ...t });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.finalDay));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.finalReason] = (reasonCount[t.finalReason] || 0) + 1;
  const tp20Rate = trades.filter(t => t.legs.some(l => l.reason === 'TP20')).length / trades.length * 100;
  const leg20Rate = trades.filter(t => t.legs.some(l => l.reason === 'LEG20')).length / trades.length * 100;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, reasonCount, tp20Rate, leg20Rate };
}

async function main() {
  const opts = parseArgs();
  console.error(`[기준선전략 + 괴리율청산 이식 백테스트] ${opts.stocks.length}종목, 진입: 최소스트릭${opts.minStreak}/Z<=${opts.z}/vlow반등/종가<EMA20(신규필터)${opts.requireHighTouchEma20 ? '/고가>=EMA20(신규옵션필터ON)' : ''}/분할매수최대${opts.maxBuyLegs}회, 청산(괴리율식): SL${opts.sl}%/TP+${opts.tp}%50%익절/EMA20돌파25%익절/EMA5하향이탈전량/시간청산${opts.maxHold}거래일`);
  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = []; const errors = [];
  for (const r of results) { if (r.error) { errors.push(`${r.name}:${r.error}`); continue; } pooled.push(...r.trades); }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);
  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n전체 신호 발생: ${totalEvents}건 (유효표본 ${pooled.length}건)`);
  const s = summarize(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }
  console.log(`\n━━━ 결과: 기준선 진입 + 괴리율 청산(SL${opts.sl}%) ━━━`);
  console.log(`n=${s.n}  가중평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균종결 ${s.avgDays.toFixed(1)}거래일`);
  console.log(`TP20도달률 ${s.tp20Rate.toFixed(1)}%  LEG20도달률 ${s.leg20Rate.toFixed(1)}%`);
  console.log(`최종청산 사유: ${Object.entries(s.reasonCount).map(([k, v]) => `${k}:${v}(${(v / s.n * 100).toFixed(0)}%)`).join(' ')}`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
