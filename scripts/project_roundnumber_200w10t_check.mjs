// 라운드넘버 전략 — 오늘 진입신호 종목의 "200일창/10틱"(HTS 축표시용 그리드) 지지/저항 참고용 표 (2026-08-24)
// 매매 확정 그리드(150일/30틱, project_roundnumber_strategy_backtest.mjs)와는 별개로,
// 실제 HTS 차트 축 간격과 더 가까운 200일/10틱 그리드로 지지/저항을 참고 확인하기 위한 스크립트.
// 2026-09-01: "분석해줘" 요청 표준 포맷으로 2단계 확장(지지2/지지1/저항1/저항2, 지지 먼저)+터치 날짜 이력 추가.
// 2026-09-11: 지지3/저항3 한 단계 더 추가(3단계) — 당일 어디까지 터치했는지 더 넓게 확인.
// 2026-09-11: --price=live|close 플래그 추가 — 기준가를 KIS 실시간 현재가/정규장 확정 종가 중 선택(holdings_quote_table과 동일 패턴).
//   지정 시 해당 KIS 가격을 "현재가"로 쓰고, Yahoo 당일 고/저에도 반영해 지지/저항 산출. 생략 시 기존처럼 Yahoo 종가 기준(변경 없음).
// 2026-09-11: 종목 헤더 아래 "추세: 정배열/역배열/혼조" 한 줄 추가(5/20/50/100/200 EMA, holdings_quote_table의 emaStructure 로직 재사용).
// 2026-09-11: "현재가"/"전일종가" 참고행을 지지/저항 레벨과 함께 실제 가격순으로 정렬해 출력 — 저항 돌파 여부를 행 순서로 바로 확인 가능.
// 2026-09-11: "최근터치"에 날짜 2개 표시(기존 1개), 어제 날짜엔 "(어제)" 표기 추가(기존 "(오늘)"과 동일 패턴).
// 사용법: node scripts/project_roundnumber_200w10t_check.mjs --stocks 코드:이름:시장,... [--window 150] [--ticks 30] [--price=live|close]
//   --window/--ticks 생략 시 기본 200일/10틱(참고용 그리드). 150/30 지정 시 매매확정 그리드(project_roundnumber_strategy_backtest.mjs)와 동일 산식.
import https from 'https';
import { getToken, fetchKisPrice, fetchKisDailyClose } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NICE_FAMILY = [1, 2, 2.5, 5, 10];
const EMA_PERIODS = [5, 20, 50, 100, 200];
const WARMUP_DAYS = Math.max(...EMA_PERIODS) * 6;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: null, window: 200, ticks: 10, price: null };
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
    } else if (argv[i].startsWith('--price=')) {
      o.price = argv[i].split('=')[1];
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
function emaStructure(rawEma) {
  const vals = EMA_PERIODS.map(p => rawEma[p]);
  if (vals.some(v => v == null)) return '데이터부족';
  let asc = true, desc = true;
  for (let i = 1; i < vals.length; i++) {
    if (!(vals[i - 1] > vals[i])) asc = false;
    if (!(vals[i - 1] < vals[i])) desc = false;
  }
  if (asc) return '정배열';
  if (desc) return '역배열';
  return '혼조';
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '─'; }

function kstTimeStr() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function kstDateStr(tsSec) {
  const ms = tsSec != null ? tsSec * 1000 + 9 * 3600 * 1000 : Date.now() + 9 * 3600 * 1000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const opts = parseArgs();
  if (!opts.stocks) {
    console.error('사용법: node scripts/project_roundnumber_200w10t_check.mjs --stocks 코드:이름:시장,... [--price=live|close]');
    process.exit(1);
  }
  if (opts.price != null && opts.price !== 'live' && opts.price !== 'close') {
    console.error('--price 는 live 또는 close 만 허용됩니다.');
    process.exit(1);
  }
  const windowDays = opts.window, targetTicks = opts.ticks;
  const gridLabel = `${windowDays}일창/${targetTicks}틱`;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - Math.max(windowDays * 3, WARMUP_DAYS) * 24 * 3600; // 주말/휴장 감안 여유 + EMA200 워밍업

  const token = opts.price ? await getToken() : null;
  const fetchKis = opts.price === 'live' ? fetchKisPrice : opts.price === 'close' ? fetchKisDailyClose : null;

  console.log(`\n[${gridLabel} 그리드 — 지지3/지지2/지지1/저항1/저항2/저항3 3단계]`);
  for (const s of opts.stocks) {
    const symbol = s.market === 'KOSDAQ' ? `${s.code}.KQ` : `${s.code}.KS`;
    const [chart, kis] = await Promise.all([
      fetchYahooChart(symbol, p1, p2),
      fetchKis ? fetchKis(token, s.code) : Promise.resolve(null),
    ]);
    if (!chart) { console.log(`\n===== ${s.name}(${s.code}) — 조회 실패 =====`); continue; }
    const ts = chart.ts;
    const highs = fillForward(chart.high);
    const lows = fillForward(chart.low);
    const closes = fillForward(chart.close);
    const price = kis ? kis.현재가 : closes[closes.length - 1];
    // KIS 가격 기준일 땐 당일 고/저에도 반영해야 step·터치 계산이 오늘 캔들을 놓치지 않음.
    if (kis && highs.length) {
      highs[highs.length - 1] = Math.max(highs[highs.length - 1] ?? price, price);
      lows[lows.length - 1] = Math.min(lows[lows.length - 1] ?? price, price);
    }
    const step = computeStep(highs, lows, windowDays, targetTicks);
    if (!step || price == null) { console.log(`\n===== ${s.name}(${s.code}) — 데이터 부족 =====`); continue; }

    const emaCloses = closes.slice();
    if (emaCloses.length) emaCloses[emaCloses.length - 1] = price;
    const rawEma = {};
    for (const period of EMA_PERIODS) {
      const series = buildEmaSeries(emaCloses, period);
      rawEma[period] = series[series.length - 1];
    }
    const 구조 = emaStructure(rawEma);

    const todayStr = kstDateStr();
    const yesterdayStr = kstDateStr(Math.floor(Date.now() / 1000) - 24 * 3600);
    let 전일종가 = null, 전일종가Date = null;
    for (let i = ts.length - 1; i >= 0; i--) {
      const dStr = kstDateStr(ts[i]);
      if (dStr === todayStr) continue;
      if (chart.close[i] != null) { 전일종가 = chart.close[i]; 전일종가Date = dStr; break; }
    }

    const support1 = Math.floor(price / step) * step;
    const resistance1 = support1 + step;
    const support2 = support1 - step;
    const resistance2 = resistance1 + step;
    const support3 = support2 - step;
    const resistance3 = resistance2 + step;

    const priceLabel = opts.price === 'live' ? `실시간 현재가` : opts.price === 'close' ? `정규장 확정 종가` : `현재가(Yahoo 종가)`;
    const priceSuffix = kis ? ` (등락률 ${fmtPct(kis.등락률)}, ${kstTimeStr()} 조회)` : '';
    console.log(`\n===== ${s.name}(${s.code}) — ${priceLabel} ${fmtWon(price)}원${priceSuffix} / step ${fmtWon(step)}원 =====`);
    console.log(`  추세: ${구조} (5/20/50/100/200 EMA, 정배열=상승구조·역배열=하락구조)`);
    const levels = [
      { label: '지지3', price: support3, dist: (price - support3) / price * 100 * -1 },
      { label: '지지2', price: support2, dist: (price - support2) / price * 100 * -1 },
      { label: '지지1', price: support1, dist: (price - support1) / price * 100 * -1 },
      { label: '저항1', price: resistance1, dist: (resistance1 - price) / price * 100 },
      { label: '저항2', price: resistance2, dist: (resistance2 - price) / price * 100 },
      { label: '저항3', price: resistance3, dist: (resistance3 - price) / price * 100 },
    ];
    const refRows = [{ label: '현재가', price, dist: 0, isRef: true }];
    if (전일종가 != null) {
      refRows.push({ label: '전일종가', price: 전일종가, dist: (전일종가 - price) / price * 100, isRef: true });
    }
    const displayRows = [...levels, ...refRows].sort((a, b) => b.price - a.price);
    for (const lv of displayRows) {
      if (lv.isRef) {
        console.log(`  ${lv.label}: ${fmtWon(lv.price)}원 (${fmtPct(lv.dist)})`);
        continue;
      }
      const hits = touches(ts, highs, lows, step, lv.price, windowDays);
      const recent = hits.slice(-8).reverse();
      const dateLabel = (d) => `${d}${d === todayStr ? '(오늘)' : d === yesterdayStr ? '(어제)' : ''}`;
      const lastDatesLabel = recent.length ? recent.slice(0, 2).map(h => dateLabel(h.date)).join(', ') : '없음';
      console.log(`  ${lv.label}: ${fmtWon(lv.price)}원 (${fmtPct(lv.dist)}, ${windowDays}일내 ${hits.length}봉 터치, 최근터치 ${lastDatesLabel})`);
      if (recent.length) {
        console.log('    ' + recent.map(h => `${h.date}(고${fmtWon(h.high)}/저${fmtWon(h.low)})`).join(', '));
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const sourceLabel = opts.price === 'live' ? 'KIS API 실시간 현재가' : opts.price === 'close' ? 'KIS API 정규장 확정 종가' : 'Yahoo Finance 일봉 종가';
  console.log(`\n[데이터 소스] 현재가: ${sourceLabel} / 고가·저가 이력: Yahoo Finance 일봉, 기준 그리드: ${gridLabel}`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
