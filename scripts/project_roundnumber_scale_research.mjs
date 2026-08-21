// 라운드넘버(피겨라운드) 자동스케일 검증용 리서치 스크립트 — 2026-08-21
// 배경: project_roundnumber_strategy_backtest.mjs / project_holdings_quote_table.mjs는 "가격 자릿수"만으로
// 라운드 단위(step)를 정했는데(예: 28만원대→10만원단위), 사용자가 실제 키움 HTS 화면을 보면 축 눈금 간격이
// 자릿수가 아니라 "화면에 보이는 캔들 구간의 가격범위"에 맞춰 정해지는 것으로 보인다는 관찰을 줌
// (스크린샷: 삼성전자 100,000~400,000원 범위를 25,000원 간격 13개 눈금으로 표시 — 이는 자릿수 규칙이면
// 나왔을 10만원 간격이 아니라, "가격범위÷목표눈금수"를 1-2-2.5-5-10 계열의 "보기 좋은 수"로 반올림한
// 축(axis) 눈금 알고리즘(D3.js ticks 등 차트 라이브러리의 표준 방식)과 정확히 일치).
//
// 이 스크립트는 그 가설을 실데이터로 검증한다:
//   ① niceStep(range, targetTicks): 1/2/2.5/5/10 계열로 "보기 좋은" 눈금 간격 산출
//   ② 최근 N거래일(윈도우, 기본120≈6개월 — 스크린샷 차트 기간과 유사) 고가/저가 범위로 range 계산
//   ③ 여러 (windowDays, targetTicks) 조합을 스윕해 실제 25,000원(삼성전자 관찰값)에 가장 가깝게
//      수렴하는 조합을 찾는다
//   ④ 밀집도(터치카운트)는 종가 근접이 아니라 "그날 저가~고가(캔들 몸통+꼬리) 범위가 그 레벨을 통과했는지"
//      기준으로 계산(사용자 지적 — "봉의 움직임"을 반영, 기존 종가 근접 방식보다 실제 캔들 시각과 일치)
// 사용법: node scripts/project_roundnumber_scale_research.mjs [--stocks 코드:이름:시장,...] [--window 120]
//   [--ticks 12] [--calendar-days 730] [--sweep]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

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

async function fetchYahooOHLC(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([fetchYahooOHLC(`${code}.KS`, p1, p2), fetchYahooOHLC(`${code}.KQ`, p1, p2)]);
  const ksLen = ks?.ts?.length || 0, kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return null;
  return ksLen >= kqLen ? ks : kq;
}

// ① "보기 좋은 눈금" 산출 — 1/2/2.5/5/10 계열(D3.js ticks 류 축 알고리즘과 동일 패밀리)
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
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

// ② 최근 windowDays 고가/저가 범위 → niceStep
function computeVisibleStep(seq, windowDays, targetTicks) {
  const n = seq.length;
  const lo = Math.max(0, n - windowDays);
  const win = seq.slice(lo);
  const hi = Math.max(...win.map(r => r.high));
  const low = Math.min(...win.map(r => r.low));
  const range = hi - low;
  return { step: niceStep(range / targetTicks), rangeHi: hi, rangeLo: low, range, n: win.length };
}

// ④ 밀집도(터치카운트) — 종가 근접이 아니라 "그날 저가~고가 범위가 레벨을 통과했는지"(캔들 실제 움직임 반영)
function densityByLevel(seq, step, lookbackDays) {
  const n = seq.length;
  const lo = Math.max(0, n - lookbackDays);
  const win = seq.slice(lo);
  const minP = Math.min(...win.map(r => r.low));
  const maxP = Math.max(...win.map(r => r.high));
  const levels = [];
  for (let L = Math.ceil(minP / step) * step; L <= maxP + 1e-9; L += step) levels.push(Math.round(L));
  return levels.map(L => {
    let count = 0;
    for (const r of win) if (r.low <= L && L <= r.high) count++;
    return { level: L, count };
  }).sort((a, b) => b.count - a.count);
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: [{ code: '005930', name: '삼성전자', market: 'KOSPI' }], windowDays: 120, targetTicks: 12, calendarDays: 730, sweep: false, densityWindow: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window') o.windowDays = parseInt(argv[++i]);
    if (argv[i] === '--ticks') o.targetTicks = parseInt(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--sweep') o.sweep = true;
    if (argv[i] === '--density-window') o.densityWindow = parseInt(argv[++i]);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => {
        const [code, name, market] = s.split(':');
        return { code, name: name || code, market: market || 'KOSPI' };
      });
    }
  }
  return o;
}

async function main() {
  const opts = parseArgs();
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;

  for (const stock of opts.stocks) {
    const chart = await fetchChartAutoMarket(stock.code, p1, p2);
    if (!chart) { console.log(`${stock.name}: 데이터 조회 실패`); continue; }
    const dates = chart.ts.map(tsToKstDate);
    const seq = [];
    for (let i = 0; i < dates.length; i++) {
      if (chart.close[i] == null || chart.high[i] == null || chart.low[i] == null) continue;
      seq.push({ date: dates[i], close: chart.close[i], high: chart.high[i], low: chart.low[i] });
    }
    const cur = seq[seq.length - 1];
    console.log(`\n━━━ ${stock.name}(${stock.code}) 현재가 ${fmtWon(cur.close)}원 (${cur.date}) ━━━`);

    if (opts.sweep) {
      console.log(`\n[윈도우×목표눈금수 스윕 — 어느 조합이 "보기 좋은" 실제 차트축과 가까운 step을 주는지]`);
      console.log(`윈도우(일)\\눈금수` + [8, 10, 12, 15].map(t => `\t${t}`).join(''));
      for (const w of [60, 90, 120, 150, 200, 250]) {
        const cells = [8, 10, 12, 15].map(t => {
          const r = computeVisibleStep(seq, w, t);
          return `${fmtWon(r.step)}(범위${fmtWon(r.range)})`;
        });
        console.log(`${w}\t${cells.join('\t')}`);
      }
    }

    const vis = computeVisibleStep(seq, opts.windowDays, opts.targetTicks);
    console.log(`\n[선택 파라미터: 윈도우${opts.windowDays}일 × 목표눈금${opts.targetTicks}개]`);
    console.log(`  최근${opts.windowDays}거래일 범위: ${fmtWon(vis.rangeLo)} ~ ${fmtWon(vis.rangeHi)} (범위폭 ${fmtWon(vis.range)}) → 눈금간격(step) = ${fmtWon(vis.step)}`);

    const densityWindow = Math.min(seq.length, opts.densityWindow ?? opts.windowDays);
    const density = densityByLevel(seq, vis.step, densityWindow);
    const support = Math.floor(cur.close / vis.step) * vis.step;
    const resistance = support + vis.step;
    console.log(`  현재가 기준 인접 라운드: 지지 ${fmtWon(support)} / 저항 ${fmtWon(resistance)}`);

    console.log(`\n[밀집도(캔들 저가~고가 통과횟수) TOP10 — 최근 ${densityWindow}거래일(=화면에 보이는 구간과 동일 윈도우), step=${fmtWon(vis.step)}]`);
    for (const d of density.slice(0, 10)) {
      const distPct = (d.level - cur.close) / cur.close * 100;
      console.log(`  ${fmtWon(d.level).padStart(10)}원  터치 ${String(d.count).padStart(3)}봉  현재가 대비 ${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%`);
    }
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
