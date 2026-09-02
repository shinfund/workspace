// 장대양봉(bigcandle) 전략 — 진행중(대기) 셋업 조회
// project_bigcandle_recent_signals.mjs와 동일 확정 로직(몸통5%↑/되돌림20일/재돌파확인5일/touchHigh<candleHigh가드/상승국면필터)을 사용하되,
// 그 스크립트가 생략하는 "아직 체결 안 된" 셋업(눌림대기/재돌파대기)만 종목당 최신 1건씩 추출해 진행상태와 함께 표시.
// 사용법: node scripts/project_bigcandle_pending_setups.mjs
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
const OPTS = { calendarDays: 2555, bodyPct: 5, bodyPctMax: 25, retestWindow: 20, confirmWindow: 5, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true };

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

// 종목당 가장 최근 "아직 살아있는" 미체결 셋업 1건만 반환 (눌림대기 또는 재돌파대기)
function findPendingSetup(seq, opts) {
  const n = seq.length;
  let pending = null;
  for (let i = n - 1; i >= 0; i--) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;
    if (bodyPct > opts.bodyPctMax) continue; // 2026-09-02 상한캡: 투기적 초급등봉(꼬리위험) 배제

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;

    let touchIdx = null, brokenLow = false;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) { brokenLow = true; break; }
      if (seq[f].low <= mid) { touchIdx = f; break; }
    }
    const daysSinceCandle = n - 1 - i;

    if (touchIdx == null) {
      if (brokenLow) continue; // 붕괴, 무효
      if (daysSinceCandle > opts.retestWindow) continue; // 눌림 대기창 만료
      pending = { stage: 'AWAIT_TOUCH', candleDate: seq[i].date, candleHigh, candleLow, mid, daysWaiting: daysSinceCandle, windowLeft: opts.retestWindow - daysSinceCandle };
      break;
    }

    const touchHigh = seq[touchIdx].high;
    if (touchHigh >= candleHigh) continue; // 무효셋업(가드)

    let entryIdx = null, brokenLow2 = false;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) {
      if (seq[c2].close < candleLow) { brokenLow2 = true; break; }
      if (seq[c2].close > touchHigh) { entryIdx = c2; break; }
    }
    if (entryIdx != null) continue; // 이미 체결됨 — recent_signals가 담당, 여기선 생략
    if (brokenLow2) continue; // 붕괴, 무효

    const daysSinceTouch = n - 1 - touchIdx;
    if (daysSinceTouch > opts.confirmWindow) continue; // 재돌파 확인창 만료

    pending = { stage: 'AWAIT_BREAKOUT', candleDate: seq[i].date, candleHigh, candleLow, touchDate: seq[touchIdx].date, touchHigh, daysWaiting: daysSinceTouch, windowLeft: opts.confirmWindow - daysSinceTouch };
    break;
  }
  return pending;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
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
      ema200: ema200s[i] ?? null, name: stock.name,
    });
  }
  const minLen = BASE_PERIOD + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const curClose = seq[seq.length - 1].close;
  const curEma200 = seq[seq.length - 1].ema200;
  const uptrend = curEma200 != null ? curClose >= curEma200 : null;

  const pending = findPendingSetup(seq, opts);
  return { ...stock, pending, curClose, uptrend };
}

async function main() {
  console.error(`[장대양봉(bigcandle) — 진행중 셋업] ${DEFAULT_STOCKS.length}종목 스캔 중(확정파라미터: 몸통5%↑/되돌림20일/재돌파확인5일/상승국면필터)`);

  const results = await batchAll(DEFAULT_STOCKS, s => backtestStock(s, OPTS));
  const rows = results.filter(r => !r.error && r.pending);

  const awaitBreakout = rows.filter(r => r.pending.stage === 'AWAIT_BREAKOUT');
  const awaitTouch = rows.filter(r => r.pending.stage === 'AWAIT_TOUCH');

  console.log(`\n진행중 셋업: 재돌파대기 ${awaitBreakout.length}건, 눌림대기 ${awaitTouch.length}건\n`);

  console.log('■ 재돌파대기 (눌림 터치 완료, 터치일 고가 종가돌파 시 즉시 매수)');
  console.log('종목명\t장대양봉일\t눌림터치일\t터치일고가(돌파기준)\tTP가(캔들고가)\t현재가\t상승국면\t확인창 잔여');
  for (const r of awaitBreakout.sort((a, b) => b.pending.touchDate.localeCompare(a.pending.touchDate))) {
    const p = r.pending;
    console.log(`${r.name}\t${p.candleDate}\t${p.touchDate}\t${Math.round(p.touchHigh).toLocaleString()}\t${Math.round(p.candleHigh).toLocaleString()}\t${Math.round(r.curClose).toLocaleString()}\t${r.uptrend ? 'O' : 'X'}\t${p.windowLeft}일`);
  }

  console.log('\n■ 눌림대기 (장대양봉 발생, 중간값 눌림 아직 미발생)');
  console.log('종목명\t장대양봉일\t중간값(눌림목표)\tTP가(캔들고가)\t현재가\t상승국면\t대기창 잔여');
  for (const r of awaitTouch.sort((a, b) => b.pending.candleDate.localeCompare(a.pending.candleDate))) {
    const p = r.pending;
    console.log(`${r.name}\t${p.candleDate}\t${Math.round(p.mid).toLocaleString()}\t${Math.round(p.candleHigh).toLocaleString()}\t${Math.round(r.curClose).toLocaleString()}\t${r.uptrend ? 'O' : 'X'}\t${p.windowLeft}일`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
