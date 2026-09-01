// 장대양봉 되돌림 레벨 — 피보나치 vs 몸통50%(현재값) 비교 백테스트 (2026-09-01)
// 배경: 기존 설계는 몸통(시가~종가) 중간값 50%를 눌림 매수 레벨로 사용. 사용자 제안: 표준
// 피보나치 되돌림(캔들 전체 변동폭 저가~고가 기준 23.6/38.2/50/61.8/78.6%)도 검증해볼 필요.
// 레벨 정의: level = 캔들고가 - fibRatio×(캔들고가-캔들저가)  (변동폭 기준, 표준 피보나치 방식)
// 비교기준: 몸통50%(=(시가+종가)/2, 기존 mid) — 변동폭 기준이 아닌 몸통 기준이라 별도 표기.
// 각 레벨에 대해 ①즉시터치매수 ②재돌파확인(5일창) 두 방식 모두 테스트.
// 확정 파라미터(그 외 고정): bodyPct=5%/retestWindow=20일/stopBufferPct=0.5%/maxHold=15일/상승국면필터
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

// levelMode: 'body50'(기존, (시가+종가)/2) | 'fib'(고가-fibRatio×(고가-저가))
// entryMode: 'touch'(즉시터치매수) | 'reconfirm'(터치일고가 재돌파 종가매수, confirmWindow일 이내)
function detectAndSimulate(seq, opts) {
  const n = seq.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;

    const candleLow = l, candleHigh = h;
    const level = opts.levelMode === 'body50' ? (o + c) / 2 : candleHigh - opts.fibRatio * (candleHigh - candleLow);
    if (level <= candleLow || level >= candleHigh) continue; // 레벨이 범위를 벗어나면 무효(과도한 fibRatio 등)
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) break;
      if (seq[f].low <= level) { touchIdx = f; break; }
    }
    if (touchIdx == null) continue;

    let entryIdx, entryPrice;
    if (opts.entryMode === 'touch') {
      entryIdx = touchIdx; entryPrice = level;
    } else {
      const touchHigh = seq[touchIdx].high;
      let confirmIdx = null;
      for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) {
        if (seq[c2].close < candleLow) break;
        if (seq[c2].close > touchHigh) { confirmIdx = c2; break; }
      }
      if (confirmIdx == null) continue;
      entryIdx = confirmIdx; entryPrice = seq[confirmIdx].close;
    }

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'STOP', date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'TP', date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, entryDate: seq[entryIdx].date, ...result });
  }
  return trades;
}

async function loadAllSeqs() {
  const results = await batchAll(DEFAULT_STOCKS, async (stock) => {
    const p2 = Math.floor(Date.now() / 1000);
    const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
    const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
    const chart = await fetchYahooChart(symbol, p1, p2);
    if (!chart || !chart.ts.length) return null;
    const dates = chart.ts.map(tsToKstDate);
    const closes = chart.close;
    const ema200s = buildEma(closes, BASE_PERIOD);
    const seq = [];
    for (let i = 0; i < dates.length; i++) {
      if (closes[i] == null || chart.open[i] == null) continue;
      seq.push({
        date: dates[i], open: chart.open[i], close: closes[i],
        high: chart.high[i] ?? closes[i], low: chart.low[i] ?? closes[i],
        ema200: ema200s[i] ?? null, name: stock.name,
      });
    }
    return seq.length >= BASE_PERIOD + 40 ? seq : null;
  });
  return results.filter(Boolean);
}

function statOf(trades) {
  if (!trades.length) return { n: 0 };
  const rets = trades.map(t => t.ret);
  const avg = mean(rets), med = median(rets), avgDays = mean(trades.map(t => t.day));
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  return { n: rets.length, avg, med, win, avgDays, perDay: avg / avgDays };
}
function fmtRow(label, s) {
  if (!s || s.n === 0) return `${label}\tn=0`;
  return `${label}\tn=${s.n}\t${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%\t${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%\t${s.win.toFixed(0)}%\t${s.avgDays.toFixed(1)}일\t${s.perDay >= 0 ? '+' : ''}${s.perDay.toFixed(3)}%`;
}

async function main() {
  console.error(`[장대양봉 되돌림레벨 — 피보나치 vs 몸통50% 비교] ${DEFAULT_STOCKS.length}종목 로딩 중...`);
  const seqs = await loadAllSeqs();
  console.error(`로드 완료: ${seqs.length}/${DEFAULT_STOCKS.length}종목`);

  const BASE = { bodyPct: 5, retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true };
  const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

  console.log('\n━━━ ① 즉시터치매수 방식 ━━━');
  console.log('레벨\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const body50Touch = seqs.flatMap(seq => detectAndSimulate(seq, { ...BASE, levelMode: 'body50', entryMode: 'touch' }));
  console.log(fmtRow('몸통50%(기존)', statOf(body50Touch)));
  for (const fr of FIB_RATIOS) {
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, { ...BASE, levelMode: 'fib', fibRatio: fr, entryMode: 'touch' }));
    console.log(fmtRow(`Fib ${(fr * 100).toFixed(1)}%(변동폭)`, statOf(trades)));
  }

  console.log('\n━━━ ② 재돌파확인(5일창) 방식 ━━━');
  console.log('레벨\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const body50Reconfirm = seqs.flatMap(seq => detectAndSimulate(seq, { ...BASE, levelMode: 'body50', entryMode: 'reconfirm', confirmWindow: 5 }));
  console.log(fmtRow('몸통50%(기존)', statOf(body50Reconfirm)));
  for (const fr of FIB_RATIOS) {
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, { ...BASE, levelMode: 'fib', fibRatio: fr, entryMode: 'reconfirm', confirmWindow: 5 }));
    console.log(fmtRow(`Fib ${(fr * 100).toFixed(1)}%(변동폭)`, statOf(trades)));
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
