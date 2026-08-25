// 라운드넘버 전략 — 오늘 진입신호 종목의 "200일창/10틱"(HTS 축표시용 그리드) 지지/저항 참고용 표 (2026-08-24)
// 매매 확정 그리드(150일/30틱, project_roundnumber_strategy_backtest.mjs)와는 별개로,
// 실제 HTS 차트 축 간격과 더 가까운 200일/10틱 그리드로 지지/저항을 참고 확인하기 위한 스크립트.
// 사용법: node scripts/project_roundnumber_200w10t_check.mjs [--stocks 코드:이름:시장,...] [--days 1]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const WINDOW_DAYS = 200, TARGET_TICKS = 10;
const NICE_FAMILY = [1, 2, 2.5, 5, 10];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: null };
  for (let i = 0; i < argv.length; i++) {
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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function fillForward(arr) {
  let last = null;
  return arr.map(v => { if (v != null) last = v; return v == null ? last : v; });
}

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
function computeStep(highs, lows) {
  const n = highs.length;
  const lo = Math.max(0, n - WINDOW_DAYS);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k < n; k++) {
    if (highs[k] != null && highs[k] > hi) hi = highs[k];
    if (lows[k] != null && lows[k] < low) low = lows[k];
  }
  if (hi === -Infinity || low === Infinity) return null;
  return niceStep((hi - low) / TARGET_TICKS);
}
function touchCount(highs, lows, step, level) {
  const n = highs.length;
  const lo = Math.max(0, n - WINDOW_DAYS);
  let count = 0;
  for (let k = lo; k < n; k++) {
    if (highs[k] == null || lows[k] == null) continue;
    if (lows[k] <= level && level <= highs[k]) count++;
  }
  return count;
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '─'; }

async function main() {
  const opts = parseArgs();
  if (!opts.stocks) {
    console.error('사용법: node scripts/project_roundnumber_200w10t_check.mjs --stocks 코드:이름:시장,...');
    process.exit(1);
  }
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (WINDOW_DAYS * 3) * 24 * 3600; // 주말/휴장 감안 여유

  console.log('\n[200일창/10틱 참고 그리드] — 매매확정(150일/30틱)과 별개 참고용\n');
  console.log('종목명\t\t현재가\t지지\t\t저항\t\tstep');
  for (const s of opts.stocks) {
    const symbol = s.market === 'KOSDAQ' ? `${s.code}.KQ` : `${s.code}.KS`;
    const chart = await fetchYahooChart(symbol, p1, p2);
    if (!chart) { console.log(`${s.name}\t조회 실패`); continue; }
    const highs = fillForward(chart.high);
    const lows = fillForward(chart.low);
    const closes = fillForward(chart.close);
    const price = closes[closes.length - 1];
    const step = computeStep(highs, lows);
    if (!step || price == null) { console.log(`${s.name}\t데이터 부족`); continue; }
    const support = Math.floor(price / step) * step;
    const resistance = support + step;
    const supDist = (price - support) / price * 100;
    const resDist = (resistance - price) / price * 100;
    const supTouch = touchCount(highs, lows, step, support);
    const resTouch = touchCount(highs, lows, step, resistance);
    console.log(`${s.name}\t${fmtWon(price)}\t${fmtWon(support)}(${fmtPct(-supDist)},${supTouch}봉)\t${fmtWon(resistance)}(${fmtPct(resDist)},${resTouch}봉)\t${fmtWon(step)}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
