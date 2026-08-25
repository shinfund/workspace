// 2026-08-25 신규 진단: "기대수익 높은 종목만 선별해서 매매하면?" 질문에 대한 표본외(out-of-sample)
// 검증 — 종목별 성과 테이블(project_roundnumber_strategy_backtest.mjs 종목별 결과)을 그대로 보고
// "상위 종목만 거래"를 결정하면 사후확증(in-sample) 편향 위험이 크다(같은 표본에서 뽑고 같은 표본으로
// 검증하는 순환논리). 이를 피하기 위해 기간을 전반부/후반부로 나눠 전반부 성과로 종목을 선별한 뒤
// 후반부(선별 시점 기준 "미래")에서도 그 선별이 실제로 유지되는지를 확인한다.
// 사용법: node scripts/project_roundnumber_stock_selection_oos_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const OPTS = {
  calendarDays: 2555, windowDays: 150, targetTicks: 30, minTouches: 3,
  recentLookback: 20, priorAboveDays: 5, reclaimWindow: 5,
  stopBufferPct: 2, maxHold: 60, minEntryPositionPct: 20, minBandWidthPct: 2.5,
};

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

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

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
  for (let k = lo; k < idx; k++) {
    if (lows[k] <= level && level <= highs[k]) count++;
  }
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
            events.push({ entryIdx: f, level: L, step });
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

async function backtestStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - OPTS.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
  }
  const minLen = OPTS.windowDays + OPTS.recentLookback + OPTS.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows, OPTS);
  const trades = [];
  for (const ev of events) {
    const res = simulateRoundTrade(seq, ev, OPTS);
    if (!res) continue;
    trades.push({ name: stock.name, entryDate: seq[ev.entryIdx].date, ...res });
  }
  return { ...stock, trades };
}

function statOf(trades) {
  if (!trades.length) return { n: 0, avg: null, win: null };
  const rets = trades.map(t => t.ret);
  return { n: rets.length, avg: mean(rets), win: rets.filter(r => r > 0).length / rets.length * 100 };
}

async function main() {
  console.error(`[종목선별 표본외(OOS) 검증] ${DEFAULT_STOCKS.length}종목, 확정전략(⑤+⑥+⑦) 그대로, 기간을 전반부/후반부로 분리해 "전반부 상위종목이 후반부에도 유지되는지" 확인`);
  const results = await batchAll(DEFAULT_STOCKS, backtestStock);

  const byStock = [];
  const allTrades = [];
  for (const r of results) {
    if (r.error) continue;
    allTrades.push(...r.trades.map(t => ({ ...t, stock: r.name })));
    byStock.push({ name: r.name, trades: r.trades });
  }
  const dates = allTrades.map(t => t.entryDate).sort();
  const midDate = dates[Math.floor(dates.length / 2)];
  console.error(`전체 ${allTrades.length}건, 분기점(중앙값 진입일): ${midDate} — 이전=전반부, 이후=후반부`);

  const firstHalf = {}, secondHalf = {};
  for (const s of byStock) {
    firstHalf[s.name] = s.trades.filter(t => t.entryDate < midDate);
    secondHalf[s.name] = s.trades.filter(t => t.entryDate >= midDate);
  }

  // 전반부 표본 n>=5인 종목만 순위 대상(너무 적은 표본은 노이즈)
  const ranked = Object.keys(firstHalf)
    .map(name => ({ name, ...statOf(firstHalf[name]) }))
    .filter(s => s.n >= 5)
    .sort((a, b) => b.avg - a.avg);

  console.log(`\n[전반부(~${midDate} 이전) 종목별 순위 — n>=5 대상 ${ranked.length}종목]`);
  console.log('순위\t종목명\tn\t전반부평균\t전반부승률');
  ranked.forEach((s, i) => console.log(`${i + 1}\t${s.name}\t${s.n}건\t${s.avg.toFixed(2)}%\t${s.win.toFixed(0)}%`));

  const topKs = [5, 10, 15, 20];
  console.log(`\n[핵심 검증] 전반부 성과로 뽑은 상위 K종목이 "후반부(미래)"에도 전체 평균보다 나은지`);
  console.log('K\t상위그룹후반부 n/평균/승률\t하위그룹후반부 n/평균/승률\t전종목후반부 n/평균/승률');
  const allSecond = Object.values(secondHalf).flat();
  const allSecondStat = statOf(allSecond);
  for (const K of topKs) {
    const topNames = new Set(ranked.slice(0, K).map(s => s.name));
    const bottomNames = new Set(ranked.slice(-K).map(s => s.name));
    const topSecond = Object.keys(secondHalf).filter(n => topNames.has(n)).flatMap(n => secondHalf[n]);
    const bottomSecond = Object.keys(secondHalf).filter(n => bottomNames.has(n)).flatMap(n => secondHalf[n]);
    const ts = statOf(topSecond), bs = statOf(bottomSecond);
    console.log(`${K}\t${ts.n}건/${ts.avg?.toFixed(2)}%/${ts.win?.toFixed(0)}%\t${bs.n}건/${bs.avg?.toFixed(2)}%/${bs.win?.toFixed(0)}%\t${allSecondStat.n}건/${allSecondStat.avg?.toFixed(2)}%/${allSecondStat.win?.toFixed(0)}%`);
  }

  // 반대 방향도 확인: 후반부 상위종목이 "그 이전 전반부"에도 상위였는지(생존편향 대칭 확인용)
  const rankedSecond = Object.keys(secondHalf)
    .map(name => ({ name, ...statOf(secondHalf[name]) }))
    .filter(s => s.n >= 5)
    .sort((a, b) => b.avg - a.avg);
  const top10SecondNames = new Set(rankedSecond.slice(0, 10).map(s => s.name));
  const overlap = ranked.slice(0, 10).filter(s => top10SecondNames.has(s.name));
  console.log(`\n[교차확인] 전반부 상위10 vs 후반부 상위10 종목 중복: ${overlap.length}개 (${overlap.map(s => s.name).join(', ') || '없음'})`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
