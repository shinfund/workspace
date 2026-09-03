// 라운드넘버 전략 — 오늘 진입신호 종목의 "200일창/10틱"(HTS 축표시용 그리드) 지지/저항 참고용 표 (2026-08-24)
// 매매 확정 그리드(150일/30틱, project_roundnumber_strategy_backtest.mjs)와는 별개로,
// 실제 HTS 차트 축 간격과 더 가까운 200일/10틱 그리드로 지지/저항을 참고 확인하기 위한 스크립트.
// 2026-09-01: "분석해줘" 요청 표준 포맷으로 2단계 확장(지지2/지지1/저항1/저항2, 지지 먼저)+터치 날짜 이력 추가.
// 사용법: node scripts/project_roundnumber_200w10t_check.mjs --stocks 코드:이름:시장,... [--window 150] [--ticks 30]
//   --window/--ticks 생략 시 기본 200일/10틱(참고용 그리드). 150/30 지정 시 매매확정 그리드(project_roundnumber_strategy_backtest.mjs)와 동일 산식.
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NICE_FAMILY = [1, 2, 2.5, 5, 10];

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: null, window: 200, ticks: 10 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => {
        const [code, name, market] = s.split(':');
        return { code, name: name || code, market: market || 'KOSPI' };
      });
    } else if (argv[i] === '--window') {
      o.window = Number(argv[++i]);
    } else if (argv[i] === '--ticks') {
      o.ticks = Number(argv[++i]);
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
function computeStep(highs, lows, windowDays, targetTicks) {
  const n = highs.length;
  const lo = Math.max(0, n - windowDays);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k < n; k++) {
    if (highs[k] != null && highs[k] > hi) hi = highs[k];
    if (lows[k] != null && lows[k] < low) low = lows[k];
  }
  if (hi === -Infinity || low === Infinity) return null;
  return niceStep((hi - low) / targetTicks);
}
function touches(ts, highs, lows, step, level, windowDays) {
  const n = highs.length;
  const lo = Math.max(0, n - windowDays);
  const hits = [];
  for (let k = lo; k < n; k++) {
    if (highs[k] == null || lows[k] == null) continue;
    if (lows[k] <= level && level <= highs[k]) {
      const d = new Date((ts[k] + 9 * 3600) * 1000);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      hits.push({ date: dateStr, high: highs[k], low: lows[k] });
    }
  }
  return hits;
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '─'; }

async function main() {
  const opts = parseArgs();
  if (!opts.stocks) {
    console.error('사용법: node scripts/project_roundnumber_200w10t_check.mjs --stocks 코드:이름:시장,...');
    process.exit(1);
  }
  const windowDays = opts.window, targetTicks = opts.ticks;
  const gridLabel = `${windowDays}일창/${targetTicks}틱`;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (windowDays * 3) * 24 * 3600; // 주말/휴장 감안 여유

  console.log(`\n[${gridLabel} 그리드 — 지지2/지지1/저항1/저항2 2단계]`);
  for (const s of opts.stocks) {
    const symbol = s.market === 'KOSDAQ' ? `${s.code}.KQ` : `${s.code}.KS`;
    const chart = await fetchYahooChart(symbol, p1, p2);
    if (!chart) { console.log(`\n===== ${s.name}(${s.code}) — 조회 실패 =====`); continue; }
    const ts = chart.ts;
    const highs = fillForward(chart.high);
    const lows = fillForward(chart.low);
    const closes = fillForward(chart.close);
    const price = closes[closes.length - 1];
    const step = computeStep(highs, lows, windowDays, targetTicks);
    if (!step || price == null) { console.log(`\n===== ${s.name}(${s.code}) — 데이터 부족 =====`); continue; }

    const support1 = Math.floor(price / step) * step;
    const resistance1 = support1 + step;
    const support2 = support1 - step;
    const resistance2 = resistance1 + step;

    console.log(`\n===== ${s.name}(${s.code}) — 현재가 ${fmtWon(price)}원 / step ${fmtWon(step)}원 =====`);
    const levels = [
      { label: '지지2', price: support2, dist: (price - support2) / price * 100 * -1 },
      { label: '지지1', price: support1, dist: (price - support1) / price * 100 * -1 },
      { label: '저항1', price: resistance1, dist: (resistance1 - price) / price * 100 },
      { label: '저항2', price: resistance2, dist: (resistance2 - price) / price * 100 },
    ];
    for (const lv of levels) {
      const hits = touches(ts, highs, lows, step, lv.price, windowDays);
      const recent = hits.slice(-8).reverse();
      const lastDate = recent.length ? recent[0].date : '없음';
      console.log(`  ${lv.label}: ${fmtWon(lv.price)}원 (${fmtPct(lv.dist)}, ${windowDays}일내 ${hits.length}봉 터치, 최근터치 ${lastDate})`);
      if (recent.length) {
        console.log('    ' + recent.map(h => `${h.date}(고${fmtWon(h.high)}/저${fmtWon(h.low)})`).join(', '));
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`\n[데이터 소스] Yahoo Finance 일봉(고가/저가), 기준 그리드: ${gridLabel}`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
