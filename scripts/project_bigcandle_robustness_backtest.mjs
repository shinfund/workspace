// 장대양봉 중간값 되돌림 전략 — 견고성(robustness) 검증 (2026-09-01)
// 배경: project_bigcandle_retest_backtest.mjs에서 확정한 파라미터(bodyPct=4/retestWindow=20/
// stopBufferPct=0.5/maxHold=15/requireUptrend=true, perDay 0.291%, n=2017)가 특정 종목이나
// 특정 구간에만 의존하는 결과가 아닌지 확인. 라운드넘버 전략 검증(RR필터·종목별 유의성 검정)과
// 동일한 방법론을 적용:
//   ① 표본외(OOS) 시간분할 — 전체기간을 전반부/후반부로 나눠 확정 파라미터가 후반부에도 유지되는지
//   ② 종목별 통계적 유의성 — 정확이항검정으로 개별 종목 승률이 풀링 기준과 유의하게 다른지(다중비교 고려)
//   ③ 최근 거래일 구간별(10/20/40/60/120/250거래일) 성과 — 최근 들어 약화되는 패턴 없는지
// 사용법: node scripts/project_bigcandle_robustness_backtest.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
const BASE_PERIOD = 200;

// 확정 파라미터(2026-08-27 그리드서치)
const OPTS = { calendarDays: 2555, bodyPct: 4, retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true };

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

function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) continue;
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
    emas[i] = ema;
  }
  return emas;
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
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

// ── 통계 함수 (정확이항검정 + 필요표본수) ──
function logFactorial(n) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
function logChoose(n, k) { return logFactorial(n) - logFactorial(k) - logFactorial(n - k); }
function binomPmf(n, k, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function exactBinomTwoSided(n, k, p0) {
  const pk = binomPmf(n, k, p0);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const pi = binomPmf(n, i, p0);
    if (pi <= pk * (1 + 1e-9)) total += pi;
  }
  return Math.min(1, total);
}
function requiredN(p0, p1) {
  if (p1 === p0) return Infinity;
  const zAlpha = 1.959964, zBeta = 0.841621;
  const num = zAlpha * Math.sqrt(p0 * (1 - p0)) + zBeta * Math.sqrt(p1 * (1 - p1));
  return Math.ceil((num / (p1 - p0)) ** 2);
}

// ── 장대양봉 탐지 + 중간값 되돌림 진입 + TP/STOP/TIME 청산 시뮬레이션 (project_bigcandle_retest_backtest.mjs와 동일 로직) ──
function detectAndSimulate(seq, opts) {
  const n = seq.length;
  const trades = [];
  let totalEvents = 0;
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;
    totalEvents++;

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let entryIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) break;
      if (seq[f].low <= mid) { entryIdx = f; break; }
    }
    if (entryIdx == null) continue;

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'STOP', date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TP', date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, market: seq[0].market, candleDate: seq[i].date, entryIdx, entryDate: seq[entryIdx].date, bodyPct, mid, uptrend, ...result });
  }
  return { trades, totalEvents };
}

async function backtestStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - OPTS.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || chart.open[i] == null) continue;
    seq.push({
      date: dates[i], open: chart.open[i], close: closes[i],
      high: chart.high[i] ?? closes[i], low: chart.low[i] ?? closes[i],
      ema200: ema200s[i] ?? null, name: stock.name, market: stock.market,
    });
  }
  const minLen = BASE_PERIOD + OPTS.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const { trades, totalEvents } = detectAndSimulate(seq, OPTS);
  return { ...stock, trades, totalEvents, lastIdx: seq.length - 1 };
}

function statOf(trades) {
  if (!trades.length) return { n: 0, avg: null, win: null };
  const rets = trades.map(t => t.ret);
  return { n: rets.length, avg: mean(rets), med: median(rets), win: rets.filter(r => r > 0).length / rets.length * 100 };
}

async function main() {
  console.error(`[장대양봉 중간값 되돌림 전략 — 견고성 검증] ${DEFAULT_STOCKS.length}종목, 확정파라미터(몸통4%↑/되돌림20일/STOP99.5%/최대15일/상승국면필터)`);
  const results = await batchAll(DEFAULT_STOCKS, backtestStock);

  const allTrades = [];
  const byStock = [];
  let totalEvents = 0;
  for (const r of results) {
    if (r.error) continue;
    totalEvents += r.totalEvents || 0;
    allTrades.push(...r.trades.map(t => ({ ...t, stock: r.name, lastIdx: r.lastIdx })));
    byStock.push({ name: r.name, trades: r.trades });
  }
  console.log(`\n장대양봉 발생 ${totalEvents}건 → 유효표본(되돌림진입+결과확정) ${allTrades.length}건`);

  // ① 표본외(OOS) 시간분할
  const dates = allTrades.map(t => t.entryDate).sort();
  const midDate = dates[Math.floor(dates.length / 2)];
  const firstHalf = allTrades.filter(t => t.entryDate < midDate);
  const secondHalf = allTrades.filter(t => t.entryDate >= midDate);
  const fs = statOf(firstHalf), ss = statOf(secondHalf);
  console.log(`\n━━━ ① 표본외(OOS) 시간분할 검증 — 분기점: ${midDate} ━━━`);
  console.log(`전반부: n=${fs.n}  평균 ${fs.avg >= 0 ? '+' : ''}${fs.avg.toFixed(2)}%  중앙값 ${fs.med >= 0 ? '+' : ''}${fs.med.toFixed(2)}%  승률 ${fs.win.toFixed(0)}%`);
  console.log(`후반부: n=${ss.n}  평균 ${ss.avg >= 0 ? '+' : ''}${ss.avg.toFixed(2)}%  중앙값 ${ss.med >= 0 ? '+' : ''}${ss.med.toFixed(2)}%  승률 ${ss.win.toFixed(0)}%`);
  console.log(ss.avg > 0 && ss.win >= 50 ? '→ 후반부에도 우위 유지(양호)' : '→ 후반부 약화 확인 필요');

  // ② 최근 거래일 구간별 성과
  const maxLastIdx = Math.max(...allTrades.map(t => t.lastIdx));
  const TD_WINDOWS = [10, 20, 40, 60, 120, 250];
  console.log(`\n━━━ ② 최근 거래일 구간별 성과 ━━━`);
  console.log('최근N거래일이내진입\t표본수\t평균수익\t중앙값수익\t승률');
  for (const w of TD_WINDOWS) {
    const sub = allTrades.filter(t => (t.lastIdx - t.entryIdx) <= w);
    const s = statOf(sub);
    console.log(`${w}거래일\t${s.n}건\t${s.avg != null ? (s.avg >= 0 ? '+' : '') + s.avg.toFixed(2) + '%' : '-'}\t${s.med != null ? (s.med >= 0 ? '+' : '') + s.med.toFixed(2) + '%' : '-'}\t${s.win != null ? s.win.toFixed(0) + '%' : '-'}`);
  }
  console.log(`전체(${OPTS.calendarDays}일)\t${statOf(allTrades).n}건\t+${statOf(allTrades).avg.toFixed(2)}%\t+${statOf(allTrades).med.toFixed(2)}%\t${statOf(allTrades).win.toFixed(0)}%`);

  // ③ 종목별 통계적 유의성
  const p0 = statOf(allTrades).win / 100;
  const sigRows = byStock
    .map(s => ({ name: s.name, ...statOf(s.trades) }))
    .filter(s => s.n > 0)
    .map(s => {
      const wins = Math.round(s.win / 100 * s.n);
      const pValue = exactBinomTwoSided(s.n, wins, p0);
      const reqN = requiredN(p0, s.win / 100);
      return { ...s, wins, pValue, reqN };
    })
    .sort((a, b) => a.pValue - b.pValue);

  console.log(`\n━━━ ③ 종목별 통계적 유의성 (귀무가설: 풀링 승률 ${(p0 * 100).toFixed(1)}%, n=${allTrades.length}) ━━━`);
  console.log('종목명\t표본수\t승수\t승률\t기준대비\tp값\t유의(p<0.05)\t80%검정력필요n');
  for (const r of sigRows) {
    const diff = r.win - p0 * 100;
    const reqStr = r.reqN > 2000 ? `${r.reqN}건(비현실적)` : `${r.reqN}건`;
    console.log(`${r.name}\t${r.n}건\t${r.wins}승\t${r.win.toFixed(0)}%\t${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%p\t${r.pValue.toFixed(3)}\t${r.pValue < 0.05 ? 'Y' : 'N'}\t${reqStr}`);
  }
  const sigCount = sigRows.filter(r => r.pValue < 0.05).length;
  const bonferroni = 0.05 / sigRows.length;
  const sigCountBonf = sigRows.filter(r => r.pValue < bonferroni).length;
  console.log(`\n총 ${sigRows.length}종목 중 유의(p<0.05)한 종목: ${sigCount}개 (다중비교 보정 Bonferroni α=${bonferroni.toFixed(4)} 적용시: ${sigCountBonf}개)`);
  console.log(`※ 종목 ${sigRows.length}개를 개별 α=0.05로 검정하면 우연만으로도 평균 ${(sigRows.length * 0.05).toFixed(1)}개는 "유의하게" 나올 수 있음`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
