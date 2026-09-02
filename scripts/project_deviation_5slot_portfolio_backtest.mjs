// 괴리율(평균회귀) 전략 — 5슬롯 실측 포트폴리오 시뮬레이션 (2026-09-02)
// 배경: [[project_bigcandle_strategy]] headroom 필터 검증 때 "단독 포트폴리오 vs 4전략 통합"이 반대로
// 나올 수 있음을 확인한 뒤, 동일 discipline을 괴리율에도 적용 — 기존 확정필터(EMA5+20 Z≤-2&위치≤3%ile
// AND EMA50<200, 청산 SL-18%→TP+20%50%익절→EMA20돌파25%익절→EMA5하향이탈전량→시간청산20일, v15)가
// 실제 슬롯공유 자본에서도 유효한지 재검증. 엔진 구조는 project_bigcandle_5slot_portfolio_backtest.mjs·
// 신호탐지/청산 로직은 project_4strategy_combined_portfolio_backtest.mjs의 precomputeDeviation+괴리율
// 청산분기를 그대로 이식.
// 사용법: node scripts/project_deviation_5slot_portfolio_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const UNIVERSE = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// 확정 파라미터(v15, 2026-08-26, project_4strategy_combined_portfolio_backtest.mjs DV와 동일)
const DV = { ROLL: 250, Z_THRESHOLD: -2, ENTRY_PCT_THRESHOLD: 3, FAST: 5, SLOW: 20, MID: 50, MID2: 100, LONG: 200, SL: 18, TP: 20, MAX_HOLD: 20, CAP: 3 };
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
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

async function loadStock(stock, p1, p2) {
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  return { ...stock, dates, closes };
}

function precomputeDeviation(st) {
  const { dates, closes } = st; const n = dates.length;
  const ema5 = buildEma(closes, DV.FAST), ema20 = buildEma(closes, DV.SLOW), ema50 = buildEma(closes, DV.MID), ema200 = buildEma(closes, DV.LONG);
  const dev5 = closes.map((c, i) => ema5[i] != null ? (c - ema5[i]) / ema5[i] * 100 : null);
  const dev20 = closes.map((c, i) => ema20[i] != null ? (c - ema20[i]) / ema20[i] * 100 : null);
  const cond = new Array(n).fill(false); const scoreArr = new Array(n).fill(null);
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

function runPortfolioSim(calendar, byCode, idxMap, dvData) {
  let cash = START_CAPITAL, costBasisTotal = 0;
  const positions = [], trades = [];
  let skipCount = 0;

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
      const dv = dvData.get(pos.code);
      const ema20 = dv.ema20[i], ema5 = dv.ema5[i];
      const ret = (close - pos.entryPrice) / pos.entryPrice * 100;
      const fullExit = (reason) => {
        const proceeds = pos.remainingShares * close; cash += proceeds; costBasisTotal -= pos.costRemaining; pos.realizedCash += proceeds;
        trades.push({ code: pos.code, name: pos.name, entryDate: pos.entryDate, exitDate: date, investedTotal: pos.investedTotal, realizedPnl: pos.realizedCash - pos.investedTotal, ret: (pos.realizedCash - pos.investedTotal) / pos.investedTotal * 100, day: daysHeld, reason });
        positions.splice(pi, 1);
      };
      if (ret <= -DV.SL) { fullExit('SL'); continue; }
      if (pos.stage === 'INIT' && ret >= DV.TP) {
        const shares = Math.min(Math.round(pos.shares * 0.5), pos.remainingShares);
        if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
        pos.stage = 'TP20_DONE';
      }
      if (pos.stage === 'TP20_DONE' && ema20 != null && close >= ema20) {
        const shares = Math.min(Math.round(pos.shares * 0.25), pos.remainingShares);
        if (shares > 0) { const proceeds = shares * close, costPortion = shares * pos.entryPrice; cash += proceeds; costBasisTotal -= costPortion; pos.remainingShares -= shares; pos.costRemaining -= costPortion; pos.realizedCash += proceeds; }
        pos.stage = 'HOLD';
      }
      if (pos.stage === 'HOLD' && ema5 != null && close < ema5) { fullExit('BREAKDOWN'); continue; }
      if (daysHeld >= DV.MAX_HOLD && pos.remainingShares > 0) { fullExit('TIME'); continue; }
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
      const dv = dvData.get(s.code);
      if (dv.onsetIdx.has(i)) candsRaw.push({ s, i, sc: dv.score.get(i) });
    }
    // 동시신호 우선순위: 실제 4전략 통합 엔진과 동일 — zSum asc → pctSum asc, CAP=3
    candsRaw.sort((a, b) => (a.sc.zSum - b.sc.zSum) || (a.sc.pctSum - b.sc.pctSum));
    const cands = candsRaw.slice(0, DV.CAP); skipCount += Math.max(0, candsRaw.length - DV.CAP);

    for (const cand of cands) {
      if (openSlots <= 0) { skipCount++; continue; }
      const price = byCode.get(cand.s.code).closes[cand.i];
      const budget = runningCapital() / SLOTS;
      const shares = Math.floor(budget / price);
      if (shares <= 0) { skipCount++; continue; }
      const investedTotal = shares * price;
      cash -= investedTotal; costBasisTotal += investedTotal;
      positions.push({ code: cand.s.code, name: cand.s.name, entryDate: date, entryIdx: cand.i, entryPrice: price, shares, remainingShares: shares, costRemaining: investedTotal, investedTotal, realizedCash: 0, stage: 'INIT' });
      held.add(cand.s.code); openSlots--;
    }
  }

  return { trades, finalCash: cash, finalPositions: positions, skipCount };
}

async function main() {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(new Date('2017-01-01T00:00:00Z').getTime() / 1000);
  const fromDate = '2019-08-27';

  console.error('[1/3] 유니버스 시세 로드 중...');
  const loaded = await batchAll(UNIVERSE, s => loadStock(s, p1, p2));
  const byCode = new Map();
  for (const st of loaded) if (!st.error) byCode.set(st.code, st);
  console.error(`[1/3] 완료 — ${byCode.size}/${UNIVERSE.length}종목`);

  console.error('[2/3] 종목별 진입신호 사전계산 중...');
  const dvData = new Map();
  for (const st of byCode.values()) dvData.set(st.code, precomputeDeviation(st));
  const totalSignals = [...dvData.values()].reduce((a, m) => a + m.onsetIdx.size, 0);
  console.error(`[2/3] 완료 — 유효 진입신호 ${totalSignals}건(슬롯 무시, 전체 발생기준)`);

  const kospiChart = await fetchYahooChart('^KS11', p1, p2);
  const calendar = kospiChart.ts.map(tsToKstDate).filter(d => d >= fromDate);
  console.error(`[3/3] 캘린더 ${calendar.length}거래일 (${fromDate} ~ ${calendar.at(-1)}), 5슬롯 포트폴리오 시뮬레이션 실행 중...`);
  const idxMap = new Map();
  for (const st of byCode.values()) { const m = new Map(); st.dates.forEach((d, i) => m.set(d, i)); idxMap.set(st.code, m); }

  const { trades, finalCash, finalPositions, skipCount } = runPortfolioSim(calendar, byCode, idxMap, dvData);
  const finalCapital = finalCash + finalPositions.reduce((a, p) => a + p.remainingShares * (byCode.get(p.code)?.closes?.at(-1) ?? p.entryPrice), 0);
  const totalReturn = (finalCapital - START_CAPITAL) / START_CAPITAL * 100;

  console.log(`\n━━━ 괴리율 — 5슬롯 실측 포트폴리오 시뮬레이션 ━━━`);
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
