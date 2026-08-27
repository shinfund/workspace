/**
 * project_index_quote_table.mjs — 지수 시세표 (한국·미국 주요 지수/지표 EMA 5/20/50/100/200 괴리율 + 정배열·변동성)
 *
 * project_stock_quote_ema_table.mjs(개별종목), project_holdings_quote_table.mjs(보유종목)와 동일 계열의
 * 참고용 시세표. 매매전략 필터로 쓰지 않음(시장국면 필터 3종은 이미 백테스트 순이익 개선 실패로 기각,
 * project_market_regime_filter_rejected 메모리 참고) — 수시 조회용 스냅샷.
 *
 * 데이터 소스: Yahoo Finance (지수 현재가·과거 종가/고가/저가 전부)
 * 출력: 터미널 표 2개
 *   ① 지수 시세표 — 지수명,현재가,등락률,5/20/50/100/200EMA(괴리율%,돌파▲▼),변동성(ATR14%),5일누적등락률
 *   ② 시황 요약 — 국내증시/미국증시/반도체/VIX/환율 5개 구분별 현황+판단(규칙 기반 자동 생성, 2026-08-27 추가)
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

// 개별 지수의 단기(20EMA)·장기(200EMA) 추세 조합 + EMA 돌파 여부를 문장으로 요약
function judgeTrend(r) {
  if (!r || r.error) return '조회실패';
  const parts = [`${fmtPct(r.등락률)}(5일 ${fmtPct(r.ret5d)})`];
  const dev20 = r.dev[20], dev200 = r.dev[200];
  if (dev20 != null && dev200 != null) {
    if (dev20 > 0 && dev200 > 0) parts.push('단기·장기 동반 강세');
    else if (dev20 < 0 && dev200 > 0) parts.push('장기 상승추세 속 단기 조정');
    else if (dev20 > 0 && dev200 < 0) parts.push('장기 약세 속 단기 반등');
    else parts.push('단기·장기 동반 약세');
  }
  const crosses = EMA_PERIODS.filter(p => r.cross[p]).map(p => `${p}EMA${r.cross[p]}`);
  if (crosses.length) parts.push(crosses.join(' '));
  return parts.join(', ');
}

// 여러 지수를 묶어 평균 등락률·평균 200EMA 괴리로 그룹 추세를 요약(예: 미국증시 3개 지수)
function judgeGroup(members) {
  const valids = members.filter(r => r && !r.error);
  if (!valids.length) return '데이터없음';
  const avgChg = valids.reduce((a, r) => a + (r.등락률 || 0), 0) / valids.length;
  const dev200s = valids.map(r => r.dev[200]).filter(v => v != null);
  const avgDev200 = dev200s.length ? dev200s.reduce((a, b) => a + b, 0) / dev200s.length : null;
  const trend = avgDev200 == null ? '' : (avgDev200 > 0 ? '장기 상승추세 유지' : '장기 하락추세');
  const move = avgChg > 0.5 ? '뚜렷한 상승' : avgChg < -0.5 ? '뚜렷한 하락' : '보합권';
  return `${trend ? trend + ' 속 ' : ''}${move}(평균 ${fmtPct(avgChg)})`;
}

function judgeVix(r) {
  if (!r || r.error) return '조회실패';
  const v = r.현재가;
  const level = v == null ? '' : v < 15 ? '안정(저변동)' : v < 20 ? '보통' : v < 30 ? '경계(변동성 확대)' : '위험(패닉권)';
  return `${level}, ${fmtPct(r.등락률)}`;
}

function judgeFx(r) {
  if (!r || r.error) return '조회실패';
  const dir = r.등락률 > 0 ? '원화 약세' : r.등락률 < 0 ? '원화 강세' : '보합';
  const dev20 = r.dev[20];
  const trend = dev20 == null ? '' : dev20 > 0 ? '단기 상승(약세)추세' : '단기 하락(강세)추세';
  return `${dir}${trend ? ', ' + trend : ''}`;
}

function buildMarketSummary(rows) {
  const bySym = name => rows.find(r => r.name === name);
  const kospi = bySym('코스피'), kosdaq = bySym('코스닥');
  const sp = bySym('S&P500'), nasdaq = bySym('나스닥종합'), dow = bySym('다우존스');
  const sox = bySym('필라델피아반도체'), vix = bySym('VIX(변동성)'), fx = bySym('원/달러');

  return [
    {
      구분: '국내증시',
      현황: `코스피 ${fmtPct(kospi?.등락률)} / 코스닥 ${fmtPct(kosdaq?.등락률)}`,
      판단: `코스피: ${judgeTrend(kospi)} | 코스닥: ${judgeTrend(kosdaq)}`,
    },
    {
      구분: '미국증시',
      현황: `S&P500 ${fmtPct(sp?.등락률)} / 나스닥 ${fmtPct(nasdaq?.등락률)} / 다우 ${fmtPct(dow?.등락률)}`,
      판단: judgeGroup([sp, nasdaq, dow]),
    },
    {
      구분: '반도체(필라델피아)',
      현황: `${fmtPct(sox?.등락률)}(5일 ${fmtPct(sox?.ret5d)})`,
      판단: judgeTrend(sox),
    },
    {
      구분: '변동성(VIX)',
      현황: `${fmtIdx(vix?.현재가)}`,
      판단: judgeVix(vix),
    },
    {
      구분: '환율(원/달러)',
      현황: `${fmtIdx(fx?.현재가)}원(${fmtPct(fx?.등락률)})`,
      판단: judgeFx(fx),
    },
  ];
}

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

  console.log(`\n시황 요약`);
  console.log(`구분\t현황\t판단`);
  for (const s of buildMarketSummary(rows)) {
    console.log(`${s.구분}\t${s.현황}\t${s.판단}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
