// 장대양봉(bigcandle) 전략 — 최근 진입/청산 신호 조회 (2026-09-01, 4번째 확정전략 편입 반영)
// project_bigcandle_pullback_reconfirm_backtest.mjs의 최종 확정 파라미터·로직(몸통5%↑+되돌림20일+
// 재돌파확인5일창+STOP0.5%+최대15일+상승국면필터)을 그대로 사용해, 계산된 전체 이벤트 중
// 최근(--days 거래일 기준, 기본20거래일) 진입분만 개별 트레이드 단위로 표시. OPEN(진행중)/TP/STOP/TIME 상태 표시.
// 사용법: node scripts/project_bigcandle_recent_signals.mjs [--days 20] [--stocks 코드:이름:시장,...]
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
const OPTS = { calendarDays: 2555, bodyPct: 5, retestWindow: 20, confirmWindow: 5, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true };

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { days: 20, stocks: DEFAULT_STOCKS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.days = parseInt(argv[++i]);
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

// 장대양봉 탐지 + 중간값눌림 + 재돌파확인(터치일고가 종가재돌파, confirmWindow일 이내) 진입 +
// TP/STOP/TIME/OPEN 청산 시뮬레이션 (OPEN 상태 포함) — 확정 로직(2026-09-01)
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
    if (touchIdx == null) continue; // 아직 눌림(중간값 터치) 미발생 또는 붕괴 — 대기중 셋업은 생략

    const touchHigh = seq[touchIdx].high;
    let entryIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) {
      if (seq[c2].close < candleLow) break;
      if (seq[c2].close > touchHigh) { entryIdx = c2; break; }
    }
    if (entryIdx == null) continue; // 재돌파 미확인(대기중) 또는 확인창 경과 — 체결된 것만 추적

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    const entryPrice = seq[entryIdx].close;
    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = { status: 'OPEN', day: d - 1, curClose: seq[n - 1].close }; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { status: 'STOP', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { status: 'TP', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { status: 'TIME', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, candleDate: seq[i].date, touchDate: seq[touchIdx].date, entryDate: seq[entryIdx].date, entryIdx, mid: entryPrice, candleHigh, stop, ...result });
  }
  return trades;
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

  const trades = detectAndSimulate(seq, opts);
  return { ...stock, trades, lastIdx: seq.length - 1 };
}

async function main() {
  const opts = { ...OPTS, ...parseArgs() };
  console.error(`[장대양봉(bigcandle) — 최근 신호] ${opts.stocks.length}종목, 최근 ${opts.days}거래일 이내 진입건만 표시(확정파라미터: 몸통5%↑/되돌림20일/재돌파확인5일/STOP99.5%/최대15일/상승국면필터)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const rows = [];
  for (const r of results) {
    if (r.error) continue;
    for (const t of r.trades) {
      if (r.lastIdx - t.entryIdx > opts.days) continue; // 거래일 기준(각 종목 자체 거래일 시퀀스)
      rows.push(t);
    }
  }
  rows.sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  console.log(`\n최근 ${opts.days}일 이내 진입 신호: ${rows.length}건\n`);
  console.log('종목명\t장대양봉일\t눌림터치일\t진입일(재돌파확정)\t진입가\tTP가(캔들고가)\tSTOP가\t상태\t수익률/경과일');
  for (const t of rows) {
    const statusStr = t.status === 'OPEN' ? `OPEN(${t.day}일경과)` : `${t.status}(${t.day}일)`;
    const retStr = t.status === 'OPEN'
      ? `${((t.curClose - t.mid) / t.mid * 100).toFixed(2)}%(현재가기준)`
      : `${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(2)}%`;
    console.log(`${t.name}\t${t.candleDate}\t${t.touchDate}\t${t.entryDate}\t${Math.round(t.mid).toLocaleString()}\t${t.candleHigh.toLocaleString()}\t${Math.round(t.stop).toLocaleString()}\t${statusStr}\t${retStr}`);
  }

  const openCount = rows.filter(t => t.status === 'OPEN').length;
  const closedCount = rows.length - openCount;
  const closedWin = rows.filter(t => t.status !== 'OPEN' && t.ret > 0).length;
  console.log(`\n※ OPEN(진행중) ${openCount}건, 청산완료 ${closedCount}건(승률 ${closedCount ? (closedWin / closedCount * 100).toFixed(0) : '-'}%)`);
  console.log('※ 아직 눌림(중간값 터치) 또는 재돌파확인이 발생하지 않아 대기중인 셋업은 이 표에 포함되지 않음(체결된 진입만 표시)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
