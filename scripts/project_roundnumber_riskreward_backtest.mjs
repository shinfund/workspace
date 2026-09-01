// 라운드넘버 전략 — 진입시점 손익비(RR) 필터 효과 검증 (2026-09-01)
// 배경: 한국전력 개별종목 최근이력 조회 중 "승률 50%인데 손익비가 나빠서(평균승리+1.86% vs 평균패배
// -5.81%) 기대값이 마이너스"인 사례 발견 → 진입 시점에 이미 계산 가능한 사전(ex-ante) 손익비
// (RR = (TP가-진입가)/(진입가-STOP가))를 필터로 걸면 승률·수익률이 개선되는지 확인.
// project_roundnumber_strategy_backtest.mjs(확정 파라미터: window=150/ticks=30/stopBuffer=3%/
// reclaimWindow=5/minEntryPosition=20%/minBandWidth=2.5%)와 완전히 동일한 진입·청산 로직 위에
// RR 임계값 스윕만 추가 — 진입조건 자체는 변경하지 않는다(순수 사후 필터 효과 측정).
// 사용법: node scripts/project_roundnumber_riskreward_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// project_roundnumber_strategy_backtest.mjs v15 확정값 그대로 고정
const OPTS = {
  calendarDays: 2555, windowDays: 150, targetTicks: 30, minTouches: 3,
  recentLookback: 20, priorAboveDays: 5, reclaimWindow: 5,
  stopBufferPct: 3, maxHold: 60, minEntryPositionPct: 20, minBandWidthPct: 2.5,
};
const RR_THRESHOLDS = [0, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5];

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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) {
    if (highs[k] > hi) hi = highs[k];
    if (lows[k] < low) low = lows[k];
  }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}

function detectRoundSignals(seq, highs, lows, opts) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, opts.windowDays, opts.targetTicks);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < opts.minBandWidthPct) continue;
    const lo = Math.max(0, i - 1 - opts.recentLookback);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < opts.priorAboveDays) continue;
    const touch = touchCountBefore(highs, lows, i, L, opts.windowDays);
    if (touch < opts.minTouches) continue;
    for (let f = i; f < Math.min(n, i + opts.reclaimWindow); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= opts.minEntryPositionPct) {
            events.push({ entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, entryPosition });
          }
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
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - opts.stopBufferPct / 100);
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
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
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    seq.push({ date: dates[i], close: chart.close[i] });
    highs.push(chart.high[i] ?? chart.close[i]);
    lows.push(chart.low[i] ?? chart.close[i]);
  }
  const minLen = opts.windowDays + opts.recentLookback + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows, opts);
  const trades = [];
  for (const ev of events) {
    const res = simulateRoundTrade(seq, ev, opts);
    if (!res) continue;
    const entry = seq[ev.entryIdx].close;
    const target = ev.level + ev.step;
    const stop = ev.level * (1 - opts.stopBufferPct / 100);
    const rrRatio = (target - entry) / (entry - stop); // 사전(진입시점) 손익비 — 결과와 무관하게 계산 가능
    trades.push({ name: stock.name, market: stock.market, entryDate: seq[ev.entryIdx].date, entryPosition: ev.entryPosition, rrRatio, ...res });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function statsOf(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  return { n: trades.length, avg: mean(rets), med: median(rets), win, avgDays, perDay: mean(rets) / avgDays };
}

async function main() {
  console.error(`[손익비(RR) 필터 백테스트] ${DEFAULT_STOCKS.length}종목, 확정파라미터 고정, RR=(TP가-진입가)/(진입가-STOP가) 임계값 스윕`);

  const results = await batchAll(DEFAULT_STOCKS, s => backtestStock(s, OPTS));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  console.log(`\n유효표본 ${pooled.length}건 (미확정 최근 신호 제외)`);

  const base = statsOf(pooled);
  console.log(`\n━━━ 필터 없음(현행, 기준선) ━━━`);
  console.log(`n=${base.n}  평균 ${base.avg >= 0 ? '+' : ''}${base.avg.toFixed(2)}%  중앙값 ${base.med >= 0 ? '+' : ''}${base.med.toFixed(2)}%  승률 ${base.win.toFixed(1)}%  평균보유 ${base.avgDays.toFixed(1)}거래일  perDay ${base.perDay.toFixed(3)}%`);

  console.log(`\n[RR 분포 참고]`);
  const rrs = pooled.map(t => t.rrRatio).sort((a, b) => a - b);
  console.log(`  최소 ${rrs[0].toFixed(2)}  10%ile ${rrs[Math.floor(rrs.length * 0.1)].toFixed(2)}  중앙값 ${median(rrs).toFixed(2)}  90%ile ${rrs[Math.floor(rrs.length * 0.9)].toFixed(2)}  최대 ${rrs[rrs.length - 1].toFixed(2)}`);

  console.log(`\n━━━ RR 임계값 스윕(RR >= 임계값인 신호만 채택) ━━━`);
  console.log('임계값\t표본수(비중)\t평균수익률\t중앙값\t승률\t평균보유일\tperDay');
  for (const th of RR_THRESHOLDS) {
    const g = pooled.filter(t => t.rrRatio >= th);
    if (!g.length) { console.log(`RR>=${th}\t0건\t-\t-\t-\t-\t-`); continue; }
    const s = statsOf(g);
    const pct = (g.length / pooled.length * 100).toFixed(0);
    console.log(`RR>=${th}\t${s.n}건(${pct}%)\t${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%\t${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%\t${s.win.toFixed(1)}%\t${s.avgDays.toFixed(1)}일\t${s.perDay.toFixed(3)}%`);
  }

  console.log(`\n━━━ RR 5분위 성과 ━━━`);
  const q = Math.floor(pooled.length / 5);
  const sortedByRR = [...pooled].sort((a, b) => a.rrRatio - b.rrRatio);
  for (let i = 0; i < 5; i++) {
    const g = sortedByRR.slice(i * q, i === 4 ? pooled.length : (i + 1) * q);
    if (!g.length) continue;
    const s = statsOf(g);
    const rrLo = g[0].rrRatio.toFixed(2), rrHi = g[g.length - 1].rrRatio.toFixed(2);
    console.log(`  ${i + 1}분위(RR ${rrLo}~${rrHi}): n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  승률${s.win.toFixed(0)}%`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
