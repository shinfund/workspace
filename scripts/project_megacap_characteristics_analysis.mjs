// 삼성전자·SK하이닉스(시총 1,2위) 매매전략 설계를 위한 종목 특성 분석
// 사용법: node scripts/project_megacap_characteristics_analysis.mjs
//
// 목적: 기존 괴리율(하락추세 평균회귀)·눌림목(상승추세 추세추종) 전략은 중소형/거래대금 상위
//       유니버스 기준으로 캘리브레이션됨. 삼성전자·SK하이닉스는 시총 1,2위 대형주로 변동성·
//       추세지속성·평균회귀 성향이 다를 가능성이 있어, 전략 설계 전 특성부터 정량 분석한다.
//
// 산출: 변동성(ATR%·연환산 변동성)·KOSPI 상관도(베타)·EMA200 괴리율 분포·평균회귀 검증
//       (Z-score 구간별 N일 후 수익률)·추세지속성 검증(완전정배열 후 N일 수익률)·자기상관(모멘텀
//       vs 평균회귀 성향)·최대낙폭 을 종목별로 계산해 콘솔에 표로 출력한다.

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const TARGETS = [
  { code: '005930', name: '삼성전자',   symbol: '005930.KS' },
  { code: '000660', name: 'SK하이닉스', symbol: '000660.KS' },
];
const KOSPI_SYMBOL = '^KS11';

const YEARS_BACK = 3;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); }
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
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, open: q.open || [], high: q.high || [], low: q.low || [], close: q.close || [], volume: q.volume || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

function fillForward(arr) {
  const out = arr.slice();
  for (let i = 1; i < out.length; i++) if (out[i] == null) out[i] = out[i - 1];
  for (let i = out.length - 2; i >= 0; i--) if (out[i] == null) out[i] = out[i + 1];
  return out;
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m = mean(arr)) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function computeReturns(closes) {
  const rets = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] != null && closes[i - 1] != null) rets[i] = closes[i] / closes[i - 1] - 1;
  }
  return rets;
}

function computeATR(high, low, close, period = 14) {
  const tr = new Array(close.length).fill(null);
  for (let i = 1; i < close.length; i++) {
    if (high[i] == null || low[i] == null || close[i - 1] == null) continue;
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  // Wilder smoothing
  const atr = new Array(close.length).fill(null);
  let a = null;
  const seed = [];
  for (let i = 0; i < tr.length; i++) {
    if (tr[i] == null) continue;
    if (a === null) {
      seed.push(tr[i]);
      if (seed.length < period) continue;
      a = mean(seed);
    } else {
      a = (a * (period - 1) + tr[i]) / period;
    }
    atr[i] = a;
  }
  return atr;
}

function maxDrawdown(closes) {
  let peak = -Infinity, mdd = 0;
  for (const c of closes) {
    if (c == null) continue;
    if (c > peak) peak = c;
    const dd = (c / peak - 1);
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function lag1Autocorr(rets) {
  const pairs = [];
  for (let i = 1; i < rets.length; i++) {
    if (rets[i] != null && rets[i - 1] != null) pairs.push([rets[i - 1], rets[i]]);
  }
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const mx = mean(xs), my = mean(ys);
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    sx += (xs[i] - mx) ** 2;
    sy += (ys[i] - my) ** 2;
  }
  return cov / Math.sqrt(sx * sy);
}

function betaAndCorr(retsA, retsB) {
  const pairs = [];
  for (let i = 0; i < retsA.length; i++) {
    if (retsA[i] != null && retsB[i] != null) pairs.push([retsA[i], retsB[i]]);
  }
  const xs = pairs.map(p => p[1]); // market (KOSPI)
  const ys = pairs.map(p => p[0]); // stock
  const mx = mean(xs), my = mean(ys);
  let cov = 0, varX = 0, sy = 0, sx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varX += (xs[i] - mx) ** 2;
    sx += (xs[i] - mx) ** 2;
    sy += (ys[i] - my) ** 2;
  }
  const beta = cov / varX;
  const corr = cov / Math.sqrt(sx * sy);
  return { beta, corr };
}

// 롤링(250거래일) Z-score of EMA200 괴리율
function rollingZ(seq, j, window = 250) {
  const start = Math.max(0, j - window + 1);
  const win = [];
  for (let k = start; k <= j; k++) if (seq[k] != null) win.push(seq[k]);
  if (win.length < 60) return null;
  const m = mean(win), sd = stdev(win, m);
  if (!sd) return null;
  return (seq[j] - m) / sd;
}

function forwardReturn(closes, i, n) {
  if (i + n >= closes.length || closes[i] == null || closes[i + n] == null) return null;
  return closes[i + n] / closes[i] - 1;
}

async function analyzeStock(target, kospiClose) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - YEARS_BACK * 365 * 86400;
  const chart = await fetchYahooChart(target.symbol, p1, now);
  if (!chart || !chart.close.length) { console.error(`[실패] ${target.name} 데이터 조회 실패`); return null; }

  const close = fillForward(chart.close);
  const high = fillForward(chart.high);
  const low = fillForward(chart.low);
  const rets = computeReturns(close);

  const ema5 = buildEma(close, 5), ema20 = buildEma(close, 20), ema50 = buildEma(close, 50),
        ema100 = buildEma(close, 100), ema200 = buildEma(close, 200);
  const atr = computeATR(high, low, close, 14);
  const atrPct = close.map((c, i) => (atr[i] != null && c) ? atr[i] / c * 100 : null).filter(v => v != null);

  const dev200 = close.map((c, i) => (ema200[i] != null) ? (c / ema200[i] - 1) * 100 : null);
  const validDev200 = dev200.filter(v => v != null);

  const validRets = rets.filter(v => v != null);
  const annualVol = stdev(validRets) * Math.sqrt(252) * 100;

  const kospiRetsAligned = computeReturns(kospiClose).slice(0, rets.length);
  // 길이 불일치 대비: 뒤에서부터 정렬(최신 거래일 기준)
  const n = Math.min(rets.length, kospiRetsAligned.length);
  const { beta, corr } = betaAndCorr(rets.slice(-n), kospiRetsAligned.slice(-n));

  const autocorr = lag1Autocorr(rets);
  const mdd = maxDrawdown(close) * 100;
  const pctAboveEma200 = close.filter((c, i) => ema200[i] != null && c >= ema200[i]).length /
                          close.filter((_, i) => ema200[i] != null).length * 100;

  // 평균회귀 검증: EMA200 대비 롤링Z <= -1 / -1.5 시점의 향후 N일 수익률
  const zSeries = dev200.map((_, j) => rollingZ(dev200, j));
  const bucket = { all: [], zLe1: [], zLe1_5: [], zGe1: [] };
  for (let i = 0; i < close.length; i++) {
    const fr20 = forwardReturn(close, i, 20);
    if (fr20 == null) continue;
    bucket.all.push(fr20);
    const z = zSeries[i];
    if (z == null) continue;
    if (z <= -1) bucket.zLe1.push(fr20);
    if (z <= -1.5) bucket.zLe1_5.push(fr20);
    if (z >= 1) bucket.zGe1.push(fr20);
  }

  // 추세지속성 검증: 완전정배열(5>20>50>100>200) 시점의 향후 N일 수익률
  const alignedRets20 = [];
  for (let i = 0; i < close.length; i++) {
    if (ema5[i] == null || ema20[i] == null || ema50[i] == null || ema100[i] == null || ema200[i] == null) continue;
    if (ema5[i] > ema20[i] && ema20[i] > ema50[i] && ema50[i] > ema100[i] && ema100[i] > ema200[i]) {
      const fr = forwardReturn(close, i, 20);
      if (fr != null) alignedRets20.push(fr);
    }
  }

  return {
    name: target.name, code: target.code,
    days: close.length,
    annualVol,
    atrPctMean: mean(atrPct), atrPctMedian: percentile(atrPct, 0.5),
    beta, corr,
    autocorr,
    mdd,
    pctAboveEma200,
    dev200Mean: mean(validDev200), dev200Sd: stdev(validDev200),
    dev200P5: percentile(validDev200, 0.05), dev200P95: percentile(validDev200, 0.95),
    fr20All: mean(bucket.all), nAll: bucket.all.length,
    fr20ZLe1: bucket.zLe1.length ? mean(bucket.zLe1) : null, nZLe1: bucket.zLe1.length,
    fr20ZLe1_5: bucket.zLe1_5.length ? mean(bucket.zLe1_5) : null, nZLe1_5: bucket.zLe1_5.length,
    fr20ZGe1: bucket.zGe1.length ? mean(bucket.zGe1) : null, nZGe1: bucket.zGe1.length,
    fr20Aligned: alignedRets20.length ? mean(alignedRets20) : null, nAligned: alignedRets20.length,
    lastClose: close[close.length - 1],
  };
}

async function main() {
  console.log(`[조회] KOSPI 지수(${KOSPI_SYMBOL}) 기준 데이터 로딩...`);
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - YEARS_BACK * 365 * 86400;
  const kospiChart = await fetchYahooChart(KOSPI_SYMBOL, p1, now);
  if (!kospiChart) { console.error('[실패] KOSPI 지수 조회 실패'); process.exit(1); }
  const kospiClose = fillForward(kospiChart.close);

  const results = [];
  for (const t of TARGETS) {
    console.log(`[조회] ${t.name}(${t.code}) 데이터 로딩...`);
    const r = await analyzeStock(t, kospiClose);
    if (r) results.push(r);
    await new Promise(res => setTimeout(res, 300));
  }

  console.log(`\n=== 삼성전자·SK하이닉스 특성 분석 (최근 ${YEARS_BACK}년, ${results[0]?.days ?? '?'}거래일) ===\n`);

  console.log('--- 변동성·시장연동성 ---');
  console.log('종목        연환산변동성   ATR%(평균/중앙값)   KOSPI베타   KOSPI상관도   최대낙폭   EMA200위상승비율');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(10,' ')} ${r.annualVol.toFixed(1).padStart(10)}%  ` +
      `${r.atrPctMean.toFixed(2).padStart(6)}% / ${r.atrPctMedian.toFixed(2).padStart(6)}%  ` +
      `${r.beta.toFixed(2).padStart(8)}   ${r.corr.toFixed(2).padStart(8)}   ` +
      `${r.mdd.toFixed(1).padStart(7)}%   ${r.pctAboveEma200.toFixed(1).padStart(6)}%`
    );
  }

  console.log('\n--- EMA200 괴리율 분포 (평균회귀 성향 참고) ---');
  console.log('종목        평균     표준편차   P5      P95     자기상관(lag1)');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(10,' ')} ${r.dev200Mean.toFixed(2).padStart(6)}%  ` +
      `${r.dev200Sd.toFixed(2).padStart(6)}%  ${r.dev200P5.toFixed(2).padStart(7)}%  ` +
      `${r.dev200P95.toFixed(2).padStart(6)}%   ${r.autocorr.toFixed(3).padStart(8)}`
    );
  }

  console.log('\n--- 평균회귀 검증: Z-score 구간별 이후 20거래일 수익률 (표본수) ---');
  console.log('종목        전체평균(n)          Z<=-1(n)             Z<=-1.5(n)           Z>=+1(n)');
  for (const r of results) {
    const f = (v, n) => v == null ? 'N/A' : `${(v*100).toFixed(2)}%(${n})`;
    console.log(
      `${r.name.padEnd(10,' ')} ${f(r.fr20All, r.nAll).padStart(18)}  ` +
      `${f(r.fr20ZLe1, r.nZLe1).padStart(18)}  ${f(r.fr20ZLe1_5, r.nZLe1_5).padStart(18)}  ${f(r.fr20ZGe1, r.nZGe1).padStart(18)}`
    );
  }

  console.log('\n--- 추세지속성 검증: 완전정배열(5>20>50>100>200) 시점 이후 20거래일 수익률 (표본수) ---');
  for (const r of results) {
    const f = (v, n) => v == null ? 'N/A(0)' : `${(v*100).toFixed(2)}%(${n})`;
    console.log(`${r.name.padEnd(10,' ')} ${f(r.fr20Aligned, r.nAligned)}`);
  }

  console.log('\n(참고) 마지막 종가:');
  for (const r of results) console.log(`  ${r.name}: ${r.lastClose.toLocaleString()}원`);
}

main();
