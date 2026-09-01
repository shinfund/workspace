// 장대양봉 눌림+재돌파(확인창5일) 파라미터 재검증 그리드서치 (2026-09-01)
// 배경: 기존 bodyPct=4%는 2026-08-27 그리드서치(재돌파확인 로직 도입 전, requireUptrend/OOS검증 전)에서
// 정해진 값. 재돌파확인(확인창5일) 로직이 새로 확정된 뒤 사용자 요청으로 몸통길이 등 파라미터
// 재검증. 1단계: bodyPct 단독 스윕(나머지 고정) → 2단계: 유력 bodyPct에서 retestWindow/stopBufferPct/
// maxHold/confirmWindow 재탐색.
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

// 재돌파확인 로직(터치 후 confirmWindow일 이내 터치일 고가 종가재돌파 매수)
function detectAndSimulate(seq, opts) {
  const n = seq.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) break;
      if (seq[f].low <= mid) { touchIdx = f; break; }
    }
    if (touchIdx == null) continue;

    const touchHigh = seq[touchIdx].high;
    let confirmIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) {
      if (seq[c2].close < candleLow) break;
      if (seq[c2].close > touchHigh) { confirmIdx = c2; break; }
    }
    if (confirmIdx == null) continue;
    const entryIdx = confirmIdx, entryPrice = seq[confirmIdx].close;

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'STOP' }; break; }
      if (close >= candleHigh) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'TP' }; break; }
      if (d === opts.maxHold) { result = { ret: (close - entryPrice) / entryPrice * 100, day: d, reason: 'TIME' }; break; }
    }
    if (!result) continue;
    trades.push(result);
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
  console.error(`[장대양봉 눌림+재돌파(확인창5일) 파라미터 재검증] ${DEFAULT_STOCKS.length}종목 로딩 중...`);
  const seqs = await loadAllSeqs();
  console.error(`로드 완료: ${seqs.length}/${DEFAULT_STOCKS.length}종목`);

  const BASE = { retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true, confirmWindow: 5 };

  console.log('\n━━━ 1단계: 몸통길이(bodyPct) 단독 스윕 (나머지 고정: 되돌림20일/STOP99.5%/최대15일/확인창5일/상승국면필터) ━━━');
  console.log('bodyPct\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const BODY_PCTS = [2, 3, 4, 5, 6, 8, 10, 12, 15];
  let bestBody = { bodyPct: 4, perDay: -Infinity };
  for (const bp of BODY_PCTS) {
    const opts = { ...BASE, bodyPct: bp };
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, opts));
    const s = statOf(trades);
    console.log(fmtRow(`${bp}%`, s));
    if (s.n >= 100 && s.perDay > bestBody.perDay) bestBody = { bodyPct: bp, perDay: s.perDay };
  }
  console.log(`\n[1단계 채택] bodyPct=${bestBody.bodyPct}% (perDay ${bestBody.perDay.toFixed(3)}%, n≥100 조건)`);

  console.log(`\n━━━ 2단계: bodyPct=${bestBody.bodyPct}% 고정, retestWindow 재탐색 ━━━`);
  console.log('retestWindow\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const RETEST_WINDOWS = [10, 15, 20, 30, 40];
  let bestRW = { retestWindow: 20, perDay: -Infinity };
  for (const rw of RETEST_WINDOWS) {
    const opts = { ...BASE, bodyPct: bestBody.bodyPct, retestWindow: rw };
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, opts));
    const s = statOf(trades);
    console.log(fmtRow(`${rw}일`, s));
    if (s.n >= 100 && s.perDay > bestRW.perDay) bestRW = { retestWindow: rw, perDay: s.perDay };
  }
  console.log(`\n[2단계 채택] retestWindow=${bestRW.retestWindow}일`);

  console.log(`\n━━━ 3단계: stopBufferPct 재탐색 ━━━`);
  console.log('stopBufferPct\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const STOP_BUFFERS = [0.25, 0.5, 1, 2, 3, 5];
  let bestSB = { stopBufferPct: 0.5, perDay: -Infinity };
  for (const sb of STOP_BUFFERS) {
    const opts = { ...BASE, bodyPct: bestBody.bodyPct, retestWindow: bestRW.retestWindow, stopBufferPct: sb };
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, opts));
    const s = statOf(trades);
    console.log(fmtRow(`${sb}%`, s));
    if (s.n >= 100 && s.perDay > bestSB.perDay) bestSB = { stopBufferPct: sb, perDay: s.perDay };
  }
  console.log(`\n[3단계 채택] stopBufferPct=${bestSB.stopBufferPct}%`);

  console.log(`\n━━━ 4단계: maxHold 재탐색 ━━━`);
  console.log('maxHold\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const MAX_HOLDS = [5, 10, 15, 20, 30, 40];
  let bestMH = { maxHold: 15, perDay: -Infinity };
  for (const mh of MAX_HOLDS) {
    const opts = { ...BASE, bodyPct: bestBody.bodyPct, retestWindow: bestRW.retestWindow, stopBufferPct: bestSB.stopBufferPct, maxHold: mh };
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, opts));
    const s = statOf(trades);
    console.log(fmtRow(`${mh}일`, s));
    if (s.n >= 100 && s.perDay > bestMH.perDay) bestMH = { maxHold: mh, perDay: s.perDay };
  }
  console.log(`\n[4단계 채택] maxHold=${bestMH.maxHold}일`);

  console.log(`\n━━━ 5단계: confirmWindow(재돌파 확인 대기일) 재탐색 ━━━`);
  console.log('confirmWindow\tn\t평균\t중앙값\t승률\t평균보유\tperDay');
  const CONFIRM_WINDOWS = [1, 3, 5, 7, 10, 15, 20];
  let bestCW = { confirmWindow: 5, perDay: -Infinity };
  for (const cw of CONFIRM_WINDOWS) {
    const opts = { ...BASE, bodyPct: bestBody.bodyPct, retestWindow: bestRW.retestWindow, stopBufferPct: bestSB.stopBufferPct, maxHold: bestMH.maxHold, confirmWindow: cw };
    const trades = seqs.flatMap(seq => detectAndSimulate(seq, opts));
    const s = statOf(trades);
    console.log(fmtRow(`${cw}일`, s));
    if (s.n >= 100 && s.perDay > bestCW.perDay) bestCW = { confirmWindow: cw, perDay: s.perDay };
  }
  console.log(`\n[5단계 채택] confirmWindow=${bestCW.confirmWindow}일`);

  console.log(`\n━━━ 최종 조합 ━━━`);
  const finalOpts = { ...BASE, bodyPct: bestBody.bodyPct, retestWindow: bestRW.retestWindow, stopBufferPct: bestSB.stopBufferPct, maxHold: bestMH.maxHold, confirmWindow: bestCW.confirmWindow };
  const finalTrades = seqs.flatMap(seq => detectAndSimulate(seq, finalOpts));
  console.log(`bodyPct=${finalOpts.bodyPct}% / retestWindow=${finalOpts.retestWindow}일 / stopBufferPct=${finalOpts.stopBufferPct}% / maxHold=${finalOpts.maxHold}일 / confirmWindow=${finalOpts.confirmWindow}일`);
  console.log(fmtRow('최종', statOf(finalTrades)));

  console.log(`\n━━━ 기존 확정값 대비(bodyPct4%/되돌림20일/STOP0.5%/최대15일/확인창5일) ━━━`);
  const oldTrades = seqs.flatMap(seq => detectAndSimulate(seq, { ...BASE, bodyPct: 4 }));
  console.log(fmtRow('기존(bodyPct4%)', statOf(oldTrades)));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
