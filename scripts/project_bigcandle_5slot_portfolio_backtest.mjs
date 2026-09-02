// 되돌림형 장대양봉 전략 — 5슬롯 실측 포트폴리오 시뮬레이션 (2026-09-01)
// 배경: 트레이드당 지표(perDay 등)만으로는 실제 5슬롯 공유자본 운용시 복리성과를 알 수 없음.
// project_strategy_comparison_baseline_vs_roundnumber.md의 방법론(실제 슬롯점유 이벤트드리븐 시뮬레이션,
// 시작자본 1,000만원·5슬롯·복리 재계산)과 project_3strategy_combined_portfolio_backtest.mjs의 엔진 구조를
// 참고해 되돌림형 장대양봉 단독 5슬롯 시뮬레이션을 신규 구축.
// 확정 파라미터: 몸통5%↑ + 되돌림20일 + 재돌파확인5일창(터치일고가 종가재돌파) + STOP(캔들저가×99.5%) +
//   최대15거래일 + 상승국면필터(진입시 종가>=EMA200)
// 사용법: node scripts/project_bigcandle_5slot_portfolio_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
const BASE_PERIOD = 200;
const CALENDAR_DAYS = 2555;
const OPTS = { bodyPct: 5, retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, confirmWindow: 5, requireUptrend: true };
const SLOTS = 5;
const START_CAPITAL = 10_000_000;

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
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else ema = price * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// 종목별 신호 사전계산: 각 장대양봉 이벤트마다 독립적으로 (entryIdx, stop, candleHigh, candleLow, bodyPct)를 생성.
// 트레이드당 백테스트(project_bigcandle_pullback_reconfirm_backtest.mjs)와 동일한 탐지 로직이지만
// 여기서는 청산 시뮬레이션을 하지 않고 "진입 신호"만 뽑아 포트폴리오 엔진에 넘긴다.
function detectSignals(seq, opts) {
  const n = seq.length;
  const signals = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;

    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) break;
      if (seq[f].low <= mid) { touchIdx = f; break; }
    }
    if (touchIdx == null) continue;

    const touchHigh = seq[touchIdx].high;
    if (touchHigh >= candleHigh) continue; // 2026-09-01 결함수정: 무효셋업 배제
    let confirmIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) {
      if (seq[c2].close < candleLow) break;
      if (seq[c2].close > touchHigh) { confirmIdx = c2; break; }
    }
    if (confirmIdx == null) continue;
    if (seq[confirmIdx].close >= candleHigh) continue; // 2026-09-02 결함수정: 진입가가 이미 TP가 초과인 무효셋업 배제

    const entryEma200 = seq[confirmIdx].ema200;
    const uptrend = entryEma200 != null ? seq[confirmIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    const stop = candleLow * (1 - opts.stopBufferPct / 100);
    signals.push({ entryIdx: confirmIdx, stop, candleHigh, candleLow, bodyPct });
  }
  // 같은 날 같은 종목에 여러 신호가 겹칠 수 있음(다른 캔들 유래) — entryIdx별로 첫 신호만 채택
  const byIdx = new Map();
  for (const s of signals) if (!byIdx.has(s.entryIdx)) byIdx.set(s.entryIdx, s);
  return byIdx; // Map<entryIdx, signal>
}

async function loadStock(stock, p1, p2) {
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low), opens = fillForward(chart.open);
  const ema200s = buildEma(closes, BASE_PERIOD);
  const seq = dates.map((d, i) => ({ date: d, open: opens[i], close: closes[i], high: highs[i], low: lows[i], ema200: ema200s[i] ?? null }));
  return { ...stock, dates, closes, seq };
}

function runPortfolioSim(calendar, byCode, idxMap, sigData) {
  let cash = START_CAPITAL;
  let costBasisTotal = 0;
  const positions = [];
  const trades = [];
  let skipCount = 0;

  function runningCapital() { return cash + costBasisTotal; }

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];

    // EXIT PHASE
    for (let pi = positions.length - 1; pi >= 0; pi--) {
      const pos = positions[pi];
      const m = idxMap.get(pos.code); const i = m ? m.get(date) : null;
      if (i == null) continue;
      const st = byCode.get(pos.code);
      const close = st.seq[i].close;
      const daysHeld = i - pos.entryIdx;
      let reason = null;
      if (close <= pos.stop) reason = 'STOP';
      else if (close >= pos.candleHigh) reason = 'TP';
      else if (daysHeld >= OPTS.maxHold) reason = 'TIME';
      if (reason) {
        const proceeds = pos.shares * close;
        cash += proceeds; costBasisTotal -= pos.investedTotal;
        const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
        trades.push({ code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, entryPrice: pos.entryPrice, exitPrice: close, investedTotal: pos.investedTotal, realizedPnl: proceeds - pos.investedTotal, ret, day: daysHeld, reason });
        positions.splice(pi, 1);
      }
    }

    // ENTRY PHASE
    let openSlots = SLOTS - positions.length;
    if (openSlots <= 0) continue;
    const held = new Set(positions.map(p => p.code));

    const candsRaw = [];
    for (const s of UNIVERSE) {
      if (held.has(s.code)) continue;
      const st = byCode.get(s.code); if (!st) continue;
      const m = idxMap.get(s.code); const i = m ? m.get(date) : null; if (i == null) continue;
      const sig = sigData.get(s.code)?.get(i);
      if (sig) candsRaw.push({ s, st, i, sig });
    }
    // 동시신호 우선순위: 몸통크기(bodyPct) 큰 순(더 강한 장대양봉 우선)
    candsRaw.sort((a, b) => b.sig.bodyPct - a.sig.bodyPct);

    for (const cand of candsRaw) {
      if (openSlots <= 0) { skipCount++; continue; }
      const price = cand.st.seq[cand.i].close;
      const budget = runningCapital() / SLOTS;
      const shares = Math.floor(budget / price);
      if (shares <= 0) { skipCount++; continue; }
      const investedTotal = shares * price;
      cash -= investedTotal; costBasisTotal += investedTotal;
      positions.push({ code: cand.s.code, name: cand.s.name, entryDate: date, entryIdx: cand.i, entryPrice: price, shares, investedTotal, stop: cand.sig.stop, candleHigh: cand.sig.candleHigh });
      held.add(cand.s.code); openSlots--;
    }
  }

  return { trades, finalCash: cash, finalPositions: positions, skipCount };
}

async function main() {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;

  console.error('[1/3] 지수·유니버스 시세 로드 중...');
  const loaded = await batchAll(UNIVERSE, s => loadStock(s, p1, p2));
  const byCode = new Map();
  for (const st of loaded) if (!st.error) byCode.set(st.code, st);
  console.error(`[1/3] 완료 — ${byCode.size}/${UNIVERSE.length}종목 로드 성공`);

  console.error('[2/3] 종목별 진입신호 사전계산 중...');
  const sigData = new Map();
  for (const st of byCode.values()) sigData.set(st.code, detectSignals(st.seq, OPTS));
  const totalSignals = [...sigData.values()].reduce((a, m) => a + m.size, 0);
  console.error(`[2/3] 완료 — 유효 진입신호 ${totalSignals}건(슬롯 무시, 전체 발생기준)`);

  const kospiChart = await fetchYahooChart('^KS11', p1, p2);
  const calendar = kospiChart.ts.map(tsToKstDate);
  const idxMap = new Map();
  for (const st of byCode.values()) { const m = new Map(); st.dates.forEach((d, i) => m.set(d, i)); idxMap.set(st.code, m); }

  console.error('[3/3] 5슬롯 포트폴리오 시뮬레이션 실행 중...');
  const { trades, finalCash, finalPositions, skipCount } = runPortfolioSim(calendar, byCode, idxMap, sigData);
  const finalCapital = finalCash + finalPositions.reduce((a, p) => a + p.shares * (byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice), 0);
  const totalReturn = (finalCapital - START_CAPITAL) / START_CAPITAL * 100;

  console.log(`\n━━━ 되돌림형 장대양봉 — 5슬롯 실측 포트폴리오 시뮬레이션 ━━━`);
  console.log(`기간: ${calendar[0]} ~ ${calendar.at(-1)} (${calendar.length}거래일)`);
  console.log(`시작자본 ${fmtWon(START_CAPITAL)}원 → 최종(현금+미청산 시가평가) ${fmtWon(finalCapital)}원 (${fmtPct(totalReturn)})`);
  console.log(`총 청산 ${trades.length}건 (미청산 보유중 ${finalPositions.length}건 제외), 슬롯부족 스킵 ${skipCount}건`);

  const wins = trades.filter(t => t.ret > 0).length;
  const avgRet = trades.reduce((a, t) => a + t.ret, 0) / trades.length;
  const avgDays = trades.reduce((a, t) => a + t.day, 0) / trades.length;
  console.log(`\n청산 트레이드 통계: 평균 ${fmtPct(avgRet)}  승률 ${(wins / trades.length * 100).toFixed(0)}%  평균보유 ${avgDays.toFixed(1)}거래일`);
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  console.log(`청산사유: ` + Object.entries(reasonCount).map(([r, c]) => `${r} ${c}건(${(c / trades.length * 100).toFixed(0)}%)`).join(' / '));

  // 연도별 실현손익
  const byYear = {};
  for (const t of trades) { const y = t.exitDate.slice(0, 4); (byYear[y] ||= []).push(t); }
  console.log(`\n━━━ 연도별 청산 실적 ━━━`);
  console.log('연도\t청산건수\t실현손익\t승률');
  for (const y of Object.keys(byYear).sort()) {
    const arr = byYear[y];
    const pnl = arr.reduce((a, t) => a + t.realizedPnl, 0);
    const w = arr.filter(t => t.ret > 0).length;
    console.log(`${y}\t${arr.length}건\t${fmtWon(pnl)}원\t${(w / arr.length * 100).toFixed(0)}%`);
  }

  console.log(`\n━━━ 미청산 보유중 포지션(${finalPositions.length}건) ━━━`);
  for (const p of finalPositions) {
    const lastClose = byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice;
    const ret = (lastClose - p.entryPrice) / p.entryPrice * 100;
    console.log(`  ${p.name}\t진입${p.entryDate}\t평가 ${fmtPct(ret)}`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
