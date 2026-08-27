/**
 * project_index_quote_table.mjs — 지수 시세표 (한국·미국 주요 지수/지표 EMA 5/20/50/100/200 괴리율 + 정배열·변동성)
 *
 * project_stock_quote_ema_table.mjs(개별종목), project_holdings_quote_table.mjs(보유종목)와 동일 계열의
 * 참고용 시세표. 매매전략 필터로 쓰지 않음(시장국면 필터 3종은 이미 백테스트 순이익 개선 실패로 기각,
 * project_market_regime_filter_rejected 메모리 참고) — 수시 조회용 스냅샷.
 *
 * 데이터 소스: Yahoo Finance (지수 현재가·과거 종가/고가/저가 전부)
 * 출력: 터미널 표 — 지수명,현재가,등락률,5/20/50/100/200EMA(괴리율%,돌파▲▼),변동성(ATR14%),5일누적등락률
 *
 * Usage: node project_index_quote_table.mjs
 */
import https from 'https';

const INDICES = [
  { symbol: '^KS11', name: '코스피' },
  { symbol: '^KQ11', name: '코스닥' },
  { symbol: '^GSPC', name: 'S&P500' },
  { symbol: '^IXIC', name: '나스닥종합' },
  { symbol: '^DJI',  name: '다우존스' },
  { symbol: '^SOX',  name: '필라델피아반도체' },
  { symbol: '^VIX',  name: 'VIX(변동성)' },
  { symbol: 'KRW=X', name: '원/달러' },
];

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};
const EMA_PERIODS = [5, 20, 50, 100, 200];
const WARMUP_DAYS = Math.max(...EMA_PERIODS) * 8; // 400EMA 안정 수렴 위해 여유있게 확보
const ATR_PERIOD = 14; // project_3strategy_combined_portfolio_backtest.mjs KOSPI_ATR_PERIOD와 동일 기준

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
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp?.length) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [], meta: result.meta || {} };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function fillForward(arr) {
  let last = null;
  return arr.map(v => { if (v != null) last = v; return v == null ? last : v; });
}

function buildEmaSeries(closes, period) {
  const k = 2 / (period + 1);
  const series = new Array(closes.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) { series[i] = ema; continue; }
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) { series[i] = null; continue; }
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
    series[i] = ema;
  }
  return series;
}

function crossMarker(closes, emaSeries) {
  const n = closes.length;
  if (n < 2) return '';
  const c1 = closes[n - 1], c0 = closes[n - 2];
  const e1 = emaSeries[n - 1], e0 = emaSeries[n - 2];
  if (c1 == null || c0 == null || e1 == null || e0 == null) return '';
  if (c0 < e0 && c1 >= e1) return '▲';
  if (c0 > e0 && c1 <= e1) return '▼';
  return '';
}

function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i]; if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}

function fmtIdx(n) { return n != null ? n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function fmtPctPlain(n) { return n != null ? `${n.toFixed(2)}%` : '─'; }
function fmtDev(n, marker) { return n == null ? '─' : `${marker ? marker + ' ' : ''}${fmtPct(n)}`; }

async function main() {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - WARMUP_DAYS * 24 * 3600;

  const rows = [];
  for (const idx of INDICES) {
    const chart = await fetchYahooChart(idx.symbol, p1, p2);
    await new Promise(r => setTimeout(r, 150));
    if (!chart) { rows.push({ name: idx.name, error: true }); continue; }

    const closes = fillForward(chart.close);
    const highs = fillForward(chart.high);
    const lows = fillForward(chart.low);
    const meta = chart.meta || {};
    // meta.chartPreviousClose는 "요청 기간 시작일 기준" 종가라 장기 히스토리 요청 시 틀어짐 — 종가 배열에서 직접 산출
    const 전일종가 = closes[closes.length - 2];
    let 현재가 = meta.regularMarketPrice ?? closes[closes.length - 1];
    if (현재가 != null && closes.length) closes[closes.length - 1] = 현재가; // Yahoo 지연 대비 최신가로 덮어쓰기
    const 등락률 = (현재가 != null && 전일종가) ? (현재가 - 전일종가) / 전일종가 * 100 : null;

    const devByPeriod = {}, crossByPeriod = {};
    for (const period of EMA_PERIODS) {
      const series = buildEmaSeries(closes, period);
      const ema = series[series.length - 1];
      devByPeriod[period] = (ema && 현재가) ? (현재가 - ema) / ema * 100 : null;
      crossByPeriod[period] = crossMarker(closes, series);
    }
    const atrSeries = buildAtr(highs, lows, closes, ATR_PERIOD);
    const atrLast = atrSeries[atrSeries.length - 1];
    const atrPct = (atrLast != null && 현재가) ? atrLast / 현재가 * 100 : null;
    const n = closes.length;
    const ret5d = (n > 5 && closes[n - 1] != null && closes[n - 6] != null) ? (closes[n - 1] - closes[n - 6]) / closes[n - 6] * 100 : null;

    rows.push({ name: idx.name, 현재가, 등락률, dev: devByPeriod, cross: crossByPeriod, atrPct, ret5d });
  }

  console.log(`\n지수 시세표 (${new Date().toLocaleString('ko-KR')})`);
  console.log(`지수명\t\t현재가\t\t등락률\t${EMA_PERIODS.map(p => `${p}EMA`).join('\t')}\t변동성(ATR14)\t5일누적`);
  for (const r of rows) {
    if (r.error) { console.log(`${r.name}\t조회실패`); continue; }
    const emaCols = EMA_PERIODS.map(p => fmtDev(r.dev[p], r.cross[p])).join('\t');
    console.log(`${r.name}\t${fmtIdx(r.현재가)}\t${fmtPct(r.등락률)}\t${emaCols}\t${fmtPctPlain(r.atrPct)}\t${fmtPct(r.ret5d)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
