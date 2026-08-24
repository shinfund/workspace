// 라운드넘버 전략 — "진입일 갭업으로 진입가가 TP가(저항)를 이미 넘긴 경우" 성과 분리 백테스트 — 2026-08-24 신규
// 배경: 2026-08-24 신규 진입신호 중 삼성SDI가 진입가(514,500)가 TP가(500,000)보다 이미 높은 상태로
// 포착됨 — 재돌파일에 갭업이 크면 종가가 라운드레벨 L뿐 아니라 다음 레벨(L+step, 저항/TP)까지도
// 하루 만에 넘어버릴 수 있음. 이런 "오버슈트" 진입이 정상 진입(진입가<TP가)과 성과가 다른지,
// [[project_roundnumber_strategy]] 확정 매매그리드(150일/30틱)로 실증.
//
// 진입·청산 로직은 project_roundnumber_strategy_backtest.mjs와 100% 동일(같은 유니버스·같은 확정
// 파라미터) — 이벤트를 진입가 vs TP가(level+step) 대소로 두 그룹으로 나눠 별도 집계만 추가.
//
// 사용법: node scripts/project_roundnumber_entry_overshoot_backtest.mjs [--window-days 150] [--target-ticks 30]
//   [--min-touches 3] [--recent-lookback 20] [--prior-above-days 5] [--reclaim-window 5]
//   [--stop-buffer-pct 2] [--max-hold 60] [--calendar-days 2555] [--stocks 코드:이름:시장,...]

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
const DEFAULT_STOCKS = [...FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' })), ...FALLBACK_KOSDAQ];

function parseArgs() {
  const argv = process.argv.slice(2);
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

    const lo = Math.max(0, i - 1 - opts.recentLookback);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < opts.priorAboveDays) continue;

    const touch = touchCountBefore(highs, lows, i, L, opts.windowDays);
    if (touch < opts.minTouches) continue;

    for (let f = i; f < Math.min(n, i + opts.reclaimWindow); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        events.push({ entryIdx: f, level: L, step, touchCount: touch, priorAboveCount: aboveCount, breachIdx: i });
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
  const closes = chart.close;

  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i] });
    highs.push(chart.high[i] ?? closes[i]);
    lows.push(chart.low[i] ?? closes[i]);
  }
  const minLen = opts.windowDays + opts.recentLookback + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows, opts);
  const trades = [];
  for (const ev of events) {
    const res = simulateRoundTrade(seq, ev, opts);
    if (!res) continue;
    const entryPrice = seq[ev.entryIdx].close;
    const target = ev.level + ev.step;
    const overshoot = entryPrice >= target; // 진입일 종가가 이미 TP가(저항)를 넘긴 "갭업 오버슈트" 케이스
    trades.push({ name: stock.name, entryDate: seq[ev.entryIdx].date, level: ev.level, entryPrice, target, overshoot, touchCount: ev.touchCount, ...res });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeGroup(trades) {
  if (!trades.length) return { n: 0 };
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  return { n: rets.length, avg: mean(rets), med: median(rets), win, avgDays: mean(trades.map(t => t.day)), reasonCount };
}

async function main() {
  const opts = parseArgs();
  console.error(`[라운드넘버 진입 오버슈트(진입가>=TP가) 성과 분리 백테스트] ${opts.stocks.length}종목, 그리드=최근${opts.windowDays}거래일÷${opts.targetTicks}눈금, 밀집도>=${opts.minTouches}회`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const overshoot = pooled.filter(t => t.overshoot);
  const normal = pooled.filter(t => !t.overshoot);

  console.log(`\n전체 유효표본: ${pooled.length}건 (오버슈트 ${overshoot.length}건 / 정상 ${normal.length}건)`);

  const so = summarizeGroup(overshoot);
  const sn = summarizeGroup(normal);

  console.log(`\n━━━ 오버슈트(진입가≥TP가로 진입) ━━━`);
  if (so.n) {
    console.log(`n=${so.n}  평균 ${so.avg >= 0 ? '+' : ''}${so.avg.toFixed(2)}%  중앙값 ${so.med >= 0 ? '+' : ''}${so.med.toFixed(2)}%  승률 ${so.win.toFixed(0)}%  평균보유 ${so.avgDays.toFixed(1)}거래일`);
    for (const [reason, cnt] of Object.entries(so.reasonCount)) console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / so.n * 100).toFixed(0)}%)`);
  } else console.log('표본 없음');

  console.log(`\n━━━ 정상(진입가<TP가로 진입) ━━━`);
  if (sn.n) {
    console.log(`n=${sn.n}  평균 ${sn.avg >= 0 ? '+' : ''}${sn.avg.toFixed(2)}%  중앙값 ${sn.med >= 0 ? '+' : ''}${sn.med.toFixed(2)}%  승률 ${sn.win.toFixed(0)}%  평균보유 ${sn.avgDays.toFixed(1)}거래일`);
    for (const [reason, cnt] of Object.entries(sn.reasonCount)) console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / sn.n * 100).toFixed(0)}%)`);
  } else console.log('표본 없음');

  console.log('\n※ 오버슈트 = 진입일 종가가 이미 다음 라운드레벨(TP가/저항)을 넘어선 상태로 진입된 이벤트(갭업 재돌파)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
