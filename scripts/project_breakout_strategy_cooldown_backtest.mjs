// 돌파 매매전략 쿨다운 필터 적용 재검증 (2026-09-01)
// 확정조합(120일돌파+거래량필터없음+SL5%/TRAIL5%/최대40거래일+KOSPI상승국면필터)에서
// 동일 랠리 구간 내 재진입 중복집계(삼성전기 한 종목 6연속 재진입 등) 문제 확인됨.
// 종목별 직전 청산 후 N거래일 이내 재진입 금지(쿨다운) 필터를 추가해 클러스터 의존도가 해소되는지 검증.
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
const CALENDAR_DAYS = 2555;
const MIN_N = 150;

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
      return { ts: result.timestamp || [], close: q.close || [], volume: q.volume || [] };
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

async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], volume: chart.volume[i] ?? null, ema200: ema200s[i] ?? null, name: stock.name });
  }
  if (seq.length < BASE_PERIOD + 150) return { ...stock, error: '데이터 부족' };
  return { ...stock, seq };
}

async function loadIndex(symbol) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);
  const map = new Map();
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    map.set(dates[i], { close: closes[i], ema200: ema200s[i] ?? null });
  }
  return map;
}

function makeRegimeFn(kospiMap) {
  const kospiDates = [...kospiMap.keys()].sort();
  return function regimeAt(date) {
    let lo = 0, hi = kospiDates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (kospiDates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans === -1) return null;
    const rec = kospiMap.get(kospiDates[ans]);
    if (!rec || rec.ema200 == null) return null;
    return rec.close >= rec.ema200 ? 'BULL' : 'BEAR';
  };
}

// opts.cooldown: 직전 청산일(exit) 이후 N거래일 이내 동일 종목 재진입 금지
function detectAndSimulate(seq, opts, regimeAt) {
  const n = seq.length;
  const trades = [];
  const startIdx = Math.max(opts.lookback, opts.volLookback, BASE_PERIOD) + 1;
  let nextEligibleIdx = 0;
  for (let i = startIdx; i < n; i++) {
    if (i < nextEligibleIdx) continue;
    const close = seq[i].close;
    const priorHigh = Math.max(...seq.slice(i - opts.lookback, i).map(s => s.close));
    const prevClose = seq[i - 1].close;
    const prevPriorHigh = Math.max(...seq.slice(i - 1 - opts.lookback, i - 1).map(s => s.close));
    const isBreakout = close > priorHigh;
    const wasAlreadyHigh = prevClose > prevPriorHigh;
    if (!isBreakout || wasAlreadyHigh) continue;
    if (opts.volMult > 1.0) {
      const avgVol = mean(seq.slice(i - opts.volLookback, i).map(s => s.volume).filter(v => v != null));
      if (!avgVol || seq[i].volume == null || seq[i].volume < avgVol * opts.volMult) continue;
    }
    const ema200 = seq[i].ema200;
    const uptrend = ema200 != null ? close >= ema200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;
    const marketRegime = regimeAt(seq[i].date);
    if (opts.requireMarketUptrend && marketRegime !== 'BULL') continue;
    const entry = close;
    const entryIdx = i;
    let peak = entry;
    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const c = seq[j].close;
      if (c > peak) peak = c;
      const slLevel = entry * (1 - opts.sl / 100);
      const trailLevel = peak * (1 - opts.trail / 100);
      const stopLevel = Math.max(slLevel, trailLevel);
      if (c <= stopLevel) { result = { ret: (c - entry) / entry * 100, day: d, reason: trailLevel > slLevel ? 'TRAIL' : 'SL', date: seq[j].date, exitIdx: j }; break; }
      if (d === opts.maxHold) { result = { ret: (c - entry) / entry * 100, day: d, reason: 'TIME', date: seq[j].date, exitIdx: j }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, entryDate: seq[entryIdx].date, entry, uptrend, marketRegime, ...result });
    nextEligibleIdx = result.exitIdx + (opts.cooldown || 0);
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return { n: 0, avg: null, med: null, win: null, avgDays: null, perDay: null };
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, avgDays, perDay: avg / avgDays };
}

function fmtRow(label, s) {
  if (!s || s.n === 0) return `${label}\tn=0\t-\t-\t-\t-\t-`;
  return `${label}\tn=${s.n}\t${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%\t${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%\t${s.win.toFixed(0)}%\t${s.avgDays.toFixed(1)}일\t${s.perDay >= 0 ? '+' : ''}${s.perDay.toFixed(3)}%`;
}

async function main() {
  console.error(`[돌파 매매전략 쿨다운 필터 재검증]`);
  const [loaded, kospiMap] = await Promise.all([
    batchAll(DEFAULT_STOCKS, loadStock),
    loadIndex('^KS11'),
  ]);
  const stocks = loaded.filter(r => !r.error);
  console.error(`로드 완료: ${stocks.length}/${DEFAULT_STOCKS.length}종목`);
  const regimeAt = makeRegimeFn(kospiMap);

  const baseOpts = { lookback: 120, volMult: 1.0, volLookback: 20, sl: 5, trail: 5, maxHold: 40, requireUptrend: true, requireMarketUptrend: true };

  function runGrid(opts) {
    const all = [];
    for (const st of stocks) all.push(...detectAndSimulate(st.seq, opts, regimeAt));
    return { opts, trades: all, s: summarize(all) };
  }

  // ── ① 쿨다운 스윕 ──
  console.log(`\n━━━ ① 쿨다운(직전 청산 후 재진입 금지 거래일) 스윕 ━━━`);
  console.log('쿨다운\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const COOLDOWNS = [0, 10, 20, 30, 40, 60, 90];
  const results = {};
  for (const cd of COOLDOWNS) {
    const { trades, s } = runGrid({ ...baseOpts, cooldown: cd });
    results[cd] = trades;
    console.log(fmtRow(`${cd}거래일`, s));
  }

  // ── ② 대표 쿨다운(40거래일≈2개월) 선택 후 꼬리의존도 재확인 ──
  const PICK = 40;
  const trades = results[PICK];
  const sorted = [...trades].sort((a, b) => b.ret - a.ret);
  const totalSumRet = trades.reduce((a, t) => a + t.ret, 0);
  console.log(`\n━━━ ② 쿨다운 ${PICK}거래일 적용 시 꼬리의존도 재확인 ━━━`);
  console.log(fmtRow('전체', summarize(trades)));
  for (const topN of [5, 10, 20]) {
    console.log(fmtRow(`상위${topN}건 제거`, summarize(sorted.slice(topN))));
  }
  for (const pct of [0.05, 0.10]) {
    const cut = Math.round(trades.length * pct);
    console.log(fmtRow(`상위${(pct*100).toFixed(0)}%(${cut}건) 제거`, summarize(sorted.slice(cut))));
  }
  const top10Sum = sorted.slice(0, 10).reduce((a, t) => a + t.ret, 0);
  console.log(`상위 10건 수익 기여도: ${(top10Sum/totalSumRet*100).toFixed(1)}%`);

  console.log(`\n━━━ 쿨다운${PICK}거래일 상위 15건 개별 내역(중복종목 확인) ━━━`);
  console.log('종목\t진입일\t수익률\t보유일\t청산사유');
  for (const t of sorted.slice(0, 15)) {
    console.log(`${t.name}\t${t.entryDate}\t${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(2)}%\t${t.day}일\t${t.reason}`);
  }

  // ── ③ 쿨다운40 확정 시 OOS 시간분할 ──
  const dates = trades.map(t => t.entryDate).sort();
  const midDate = dates[Math.floor(dates.length / 2)];
  const firstHalf = trades.filter(t => t.entryDate < midDate);
  const secondHalf = trades.filter(t => t.entryDate >= midDate);
  console.log(`\n━━━ ③ 쿨다운${PICK}거래일 OOS 시간분할(분기점 ${midDate}) ━━━`);
  console.log(fmtRow('전체', summarize(trades)));
  console.log(fmtRow('전반부', summarize(firstHalf)));
  console.log(fmtRow('후반부', summarize(secondHalf)));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
