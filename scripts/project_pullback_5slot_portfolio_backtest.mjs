// 눌림목(추세추종) 전략 — 5슬롯 실측 포트폴리오 시뮬레이션 (2026-09-02)
// 배경: [[project_bigcandle_strategy]] headroom 필터 검증 때 "단독 포트폴리오 vs 4전략 통합"이 반대로
// 나올 수 있음을 확인한 뒤, 동일 discipline을 눌림목에도 적용 — 기존 확정필터(v9~v15: 시장국면지속10일·
// KOSPI변동성≤4%·지수병행확인·개별ATR%상한6%·SL8/TRAIL8·TP20%40%매도·쿨다운5일)가 실제 슬롯공유
// 자본에서도 유효한지 재검증. 엔진 구조는 project_bigcandle_5slot_portfolio_backtest.mjs·신호탐지/청산
// 로직은 project_4strategy_combined_portfolio_backtest.mjs의 precomputePullback+눌림목 청산분기를 그대로 이식.
// 사용법: node scripts/project_pullback_5slot_portfolio_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// 확정 파라미터(v15, 2026-08-26, project_stock_pullback.mjs·project_4strategy_combined_portfolio_backtest.mjs와 동일)
const PB = { MA_SHORT: 50, MA_LONG: 100, SLOPE_LOOKBACK: 10, BREAKOUT_LOOKBACK: 6, ATR_PERIOD: 14, BAND_K: 0.4, SL: 8, TRAIL: 8, TP_PCT: 20, TP_FRAC: 0.4, REGIME_STREAK_MIN: 10, KOSPI_ATR_PERIOD: 14, VOL_CAP: 4, STOCK_ATR_CAP: 6, MAX_HOLD: 40, CAP: 3, COOLDOWN_DAYS: 5 };
const SLOTS = 5;
const START_CAPITAL = 10_000_000;

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
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
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
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

async function loadStock(stock, p1, p2) {
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  return { ...stock, dates, closes, highs, lows };
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

function precomputePullback(st, regimeByMarket) {
  const { dates, closes, highs, lows } = st; const n = dates.length;
  const maShort = buildEma(closes, PB.MA_SHORT), maLong = buildEma(closes, PB.MA_LONG);
  const atr = buildAtr(highs, lows, closes, PB.ATR_PERIOD);
  const atrPct = atr.map((v, i) => v != null && closes[i] ? v / closes[i] * 100 : null);
  const marketRegime = regimeByMarket.KOSPI, otherRegime = regimeByMarket.KOSDAQ;
  const cond = new Array(n).fill(false); const scoreArr = new Array(n).fill(null);
  for (let i = PB.MA_LONG + PB.SLOPE_LOOKBACK; i < n - 1; i++) {
    if (maShort[i] == null || maLong[i] == null) continue;
    const prior = maLong[i - PB.SLOPE_LOOKBACK]; if (prior == null) continue;
    const trendUp = closes[i] > maLong[i] && maShort[i] > maLong[i] && maLong[i] > prior;
    if (!trendUp) continue;
    const d = dates[i];
    if (marketRegime.regime[d] !== true || otherRegime.regime[d] !== true) continue;
    if ((marketRegime.streak[d] ?? 0) < PB.REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[d]; if (kospiVol == null || kospiVol > PB.VOL_CAP) continue;
    if (i < PB.MA_SHORT || atrPct[i] == null || atrPct[i] <= 0 || atrPct[i] > PB.STOCK_ATR_CAP) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (PB.MA_SHORT - 1); k <= i - 1; k++) { if (closes[k] > highS) { highS = closes[k]; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - PB.BREAKOUT_LOOKBACK;
    if (!recentBreakout || closes[i] > highS || closes[i] <= maShort[i]) continue;
    const pullbackPct = (highS - closes[i]) / highS * 100;
    const pullbackNorm = pullbackPct / atrPct[i];
    if (pullbackNorm > PB.BAND_K) continue;
    cond[i] = true; scoreArr[i] = { trendStrength: (maLong[i] - prior) / prior * 100, pullbackNorm };
  }
  const onset = []; for (let i = 1; i < n; i++) if (cond[i] && !cond[i - 1]) onset.push(i);
  const score = new Map(onset.map(i => [i, scoreArr[i]]));
  return { maShort, onsetIdx: new Set(onset), score };
}

function runPortfolioSim(calendar, byCode, idxMap, pbData) {
  let cash = START_CAPITAL, costBasisTotal = 0;
  const positions = [], trades = [];
  let skipCount = 0;
  const cooldownUntil = new Map();

  function runningCapital() { return cash + costBasisTotal; }

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];

    for (let pi = positions.length - 1; pi >= 0; pi--) {
      const pos = positions[pi];
      const m = idxMap.get(pos.code); const i = m ? m.get(date) : null;
      if (i == null) continue;
      const st = byCode.get(pos.code);
      const close = st.closes[i];
      const daysHeld = i - pos.entryIdx;
      const pb = pbData.get(pos.code);
      const maShort = pb.maShort[i];
      const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
      if (!pos.tpTaken && ret >= PB.TP_PCT) {
        pos.tpTaken = true; if (close > pos.peak) pos.peak = close;
        const sellShares = Math.round(pos.shares * PB.TP_FRAC);
        const shares = Math.min(sellShares, pos.remainingShares);
        if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
      } else {
        let exited = false, exitReason = null;
        if (ret <= -PB.SL) { exited = true; exitReason = 'SL'; cooldownUntil.set(pos.code, i + PB.COOLDOWN_DAYS); }
        else if (maShort != null && close < maShort) { exited = true; exitReason = 'TREND_BREAK'; }
        else {
          if (close > pos.peak) pos.peak = close;
          const trailRet = (close - pos.peak) / pos.peak * 100;
          if (trailRet <= -PB.TRAIL) { exited = true; exitReason = 'TRAIL'; }
          else if (daysHeld >= PB.MAX_HOLD) { exited = true; exitReason = 'TIME'; }
        }
        if (exited) {
          const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining;
          pos.realizedCash += proceeds;
          trades.push({ code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100, day: daysHeld, reason: exitReason });
          positions.splice(pi, 1); continue;
        }
      }
      if (pos.remainingShares <= 0) positions.splice(pi, 1);
    }

    let openSlots = SLOTS - positions.length;
    if (openSlots <= 0) continue;
    const held = new Set(positions.map(p => p.code));

    const candsRaw = [];
    for (const s of UNIVERSE) {
      if (held.has(s.code)) continue;
      const st = byCode.get(s.code); if (!st) continue;
      const m = idxMap.get(s.code); const i = m ? m.get(date) : null; if (i == null) continue;
      const pb = pbData.get(s.code);
      if (pb.onsetIdx.has(i) && i > (cooldownUntil.get(s.code) ?? -1)) candsRaw.push({ s, i, sc: pb.score.get(i) });
    }
    // 동시신호 우선순위: 실제 4전략 통합 엔진과 동일 — trendStrength desc → pullbackNorm asc, CAP=3
    candsRaw.sort((a, b) => (b.sc.trendStrength - a.sc.trendStrength) || (a.sc.pullbackNorm - b.sc.pullbackNorm));
    const cands = candsRaw.slice(0, PB.CAP); skipCount += Math.max(0, candsRaw.length - PB.CAP);

    for (const cand of cands) {
      if (openSlots <= 0) { skipCount++; continue; }
      const price = cand.s ? byCode.get(cand.s.code).closes[cand.i] : null;
      const budget = runningCapital() / SLOTS;
      const shares = Math.floor(budget / price);
      if (shares <= 0) { skipCount++; continue; }
      const investedTotal = shares * price;
      cash -= investedTotal; costBasisTotal += investedTotal;
      positions.push({ code: cand.s.code, name: cand.s.name, entryDate: date, entryIdx: cand.i, entryPrice: price, shares, remainingShares: shares, costRemaining: investedTotal, investedTotal, realizedCash: 0, tpTaken: false, peak: price });
      held.add(cand.s.code); openSlots--;
    }
  }

  return { trades, finalCash: cash, finalPositions: positions, skipCount };
}

async function main() {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(new Date('2017-01-01T00:00:00Z').getTime() / 1000);
  const fromDate = '2019-08-27';

  console.error('[1/4] 지수·유니버스 시세 로드 중...');
  const [regimeKospi, regimeKosdaq] = await Promise.all([fetchMarketRegime(p1, p2, '^KS11'), fetchMarketRegime(p1, p2, '^KQ11')]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };
  const loaded = await batchAll(UNIVERSE, s => loadStock(s, p1, p2));
  const byCode = new Map();
  for (const st of loaded) if (!st.error) byCode.set(st.code, st);
  console.error(`[1/4] 완료 — ${byCode.size}/${UNIVERSE.length}종목`);

  console.error('[2/4] 종목별 진입신호 사전계산 중...');
  const pbData = new Map();
  for (const st of byCode.values()) pbData.set(st.code, precomputePullback(st, regimeByMarket));
  const totalSignals = [...pbData.values()].reduce((a, m) => a + m.onsetIdx.size, 0);
  console.error(`[2/4] 완료 — 유효 진입신호 ${totalSignals}건(슬롯 무시, 전체 발생기준)`);

  const kospiChart = await fetchYahooChart('^KS11', p1, p2);
  const calendar = kospiChart.ts.map(tsToKstDate).filter(d => d >= fromDate);
  console.error(`[3/4] 캘린더 ${calendar.length}거래일 (${fromDate} ~ ${calendar.at(-1)})`);
  const idxMap = new Map();
  for (const st of byCode.values()) { const m = new Map(); st.dates.forEach((d, i) => m.set(d, i)); idxMap.set(st.code, m); }

  console.error('[4/4] 5슬롯 포트폴리오 시뮬레이션 실행 중...');
  const { trades, finalCash, finalPositions, skipCount } = runPortfolioSim(calendar, byCode, idxMap, pbData);
  const finalCapital = finalCash + finalPositions.reduce((a, p) => a + p.remainingShares * (byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice), 0);
  const totalReturn = (finalCapital - START_CAPITAL) / START_CAPITAL * 100;

  console.log(`\n━━━ 눌림목 — 5슬롯 실측 포트폴리오 시뮬레이션 ━━━`);
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
