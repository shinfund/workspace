// 장대양봉 중간값(50% 되돌림) 매수전략 백테스트 — 2026-08-27 신규(사용자 제안 재량기법 검증)
// 배경: 에프에스티 종목에서 2거래일전 장대양봉(시가22,150→종가27,300)이 나온 뒤 당일 저가가
// 그 몸통 중간값(24,725원)을 터치한 사례를 보고, "장대양봉 몸통 중간값을 매수타점(지지)으로
// 삼는" 재량기법이 통계적으로 유효한지 확인하기 위해 신설. 기존 3전략(눌림목/괴리율/라운드넘버)
// 어디에도 속하지 않는 별도 후보 로직.
// 사용법: node scripts/project_bigcandle_retest_backtest.mjs [--body-pct 4] [--retest-window 20]
//   [--stop-buffer-pct 0.5] [--max-hold 15] [--calendar-days 2555] [--stocks 코드:이름:시장,...]
//   [--no-require-uptrend]
//
// 진입: (당일종가-당일시가)/당일시가 >= bodyPct(%) 인 양봉("장대양봉")을 탐지 → 중간값
//   M=(시가+종가)/2 산출 → 이후 retestWindow거래일 내 첫 저가<=M인 날 M가에 체결(지정가 가정).
//   단, 그 사이 종가가 장대양봉 저가 아래로 무너지면(붕괴) 셋업 폐기.
//   requireUptrend(기본true): 진입시점 종가>=EMA200(상승국면)인 경우만 채택.
// 청산(먼저 오는 조건):
//   TP: 종가가 장대양봉 고가(캔들 꼭대기) 도달 — 중간값에서 반등해 캔들 상단까지 되돌아가는
//       자연스러운 목표가(대칭적 회귀 개념)
//   STOP: 종가가 장대양봉 저가×(1-stopBufferPct/100) 아래로 하락(중간값 지지 완전 붕괴)
//   TIME: maxHold거래일 경과
//
// 파라미터 튜닝 확정(2026-08-27, 코스피 TOP50×7년, perDay=평균수익률/평균보유일수 기준 그리드서치):
//   body-pct(3~15%)·retest-window(5~60일)·stop-buffer-pct(0.25~8%)·max-hold(10~40일) 순차 스윕
//   결과 body-pct=4/retest-window=20/stop-buffer-pct=0.5/max-hold=15가 perDay 최고(0.176%→0.261%,
//   n=679→2,942). 손절을 촘촘히(0.5%) 잡고 짧게(15일) 회전시키는 쪽이 승률·평균수익은 원안과
//   비슷해도 자본회전 효율이 크게 앞섬. 추가로 requireUptrend(진입시 종가>=EMA200) 필터를 걸면
//   n=2,017로 줄어도 perDay 0.291%로 한 단계 더 개선(하락국면 진입이 상승국면보다 열위인 진단
//   결과와 일치) — 기본값 true로 확정. 단, 아직 실전 3전략(눌림목/괴리율/라운드넘버) 포트폴리오에
//   통합되지 않은 백테스트 전용 후보 로직임.

import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 재현성 유지)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    stocks: DEFAULT_STOCKS, calendarDays: 2555,
    // 2026-08-27 그리드서치 확정값(perDay 기준, 상세는 파일 상단 주석 참고)
    bodyPct: 4, retestWindow: 20, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--body-pct') o.bodyPct = parseFloat(argv[++i]);
    if (argv[i] === '--retest-window') o.retestWindow = parseInt(argv[++i]);
    if (argv[i] === '--stop-buffer-pct') o.stopBufferPct = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--require-uptrend') o.requireUptrend = true;
    if (argv[i] === '--no-require-uptrend') o.requireUptrend = false;
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
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

// 장대양봉 탐지 + 중간값 되돌림 진입 + TP/STOP/TIME 청산 시뮬레이션
function detectAndSimulate(seq, opts) {
  const n = seq.length;
  const trades = [];
  let totalEvents = 0;
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;
    totalEvents++;

    const mid = (o + c) / 2;
    const candleLow = l, candleHigh = h;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);

    let entryIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) {
      if (seq[f].close < candleLow) break; // 되돌림 전 붕괴 — 셋업 폐기
      if (seq[f].low <= mid) { entryIdx = f; break; }
    }
    if (entryIdx == null) continue;

    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; } // 미확정
      const close = seq[j].close;
      if (close <= stop) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'STOP', date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TP', date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { ret: (close - mid) / mid * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, market: seq[0].market, candleDate: seq[i].date, entryDate: seq[entryIdx].date, bodyPct, mid, uptrend, ...result });
  }
  return { trades, totalEvents };
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
      ema200: ema200s[i] ?? null, name: stock.name, market: stock.market,
    });
  }
  const minLen = BASE_PERIOD + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const { trades, totalEvents } = detectAndSimulate(seq, opts);
  return { ...stock, trades, totalEvents };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;

  const up = trades.filter(t => t.uptrend === true);
  const down = trades.filter(t => t.uptrend === false);
  const regimeStat = g => g.length ? { n: g.length, avg: mean(g.map(t => t.ret)), win: g.filter(t => t.ret > 0).length / g.length * 100 } : null;
  const regimeSplit = { up: regimeStat(up), down: regimeStat(down) };

  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, reasonCount, regimeSplit };
}

function byStockSummary(results) {
  const rows = [];
  for (const r of results) {
    if (r.error || !r.trades?.length) continue;
    const s = summarizeTrades(r.trades);
    rows.push({ name: r.name, totalEvents: r.totalEvents, ...s });
  }
  return rows.sort((a, b) => b.n - a.n);
}

async function main() {
  const opts = parseArgs();
  console.error(`[장대양봉 중간값 되돌림 전략 백테스트] ${opts.stocks.length}종목, 장대양봉=몸통 ${opts.bodyPct}%↑ 양봉, 되돌림 대기 ${opts.retestWindow}거래일 내 중간값 저가터치`);
  console.error(`청산: TP(캔들 고가 도달) / STOP(캔들 저가×${(100 - opts.stopBufferPct).toFixed(1)}% 이탈) / TIME(${opts.maxHold}거래일)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n장대양봉 발생: ${totalEvents}건 (그 중 되돌림 진입+결과확정 유효표본: ${pooled.length}건)`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }

  const perDay = s.avg / s.avgDays;
  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균보유 ${s.avgDays.toFixed(1)}거래일  perDay ${perDay >= 0 ? '+' : ''}${perDay.toFixed(3)}%`);

  console.log(`\n[청산 사유별 발생 빈도]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(6)}: ${cnt}건 (${(cnt / s.n * 100).toFixed(0)}%)`);
  }

  console.log(`\n[EMA200 국면별 성과 분리 — 진입시점 종가가 EMA200 위/아래]`);
  if (s.regimeSplit.up) console.log(`  상승국면(종가>=EMA200): n=${s.regimeSplit.up.n}  평균 ${s.regimeSplit.up.avg >= 0 ? '+' : ''}${s.regimeSplit.up.avg.toFixed(2)}%  승률${s.regimeSplit.up.win.toFixed(0)}%`);
  else console.log(`  상승국면: 해당 없음`);
  if (s.regimeSplit.down) console.log(`  하락국면(종가<EMA200): n=${s.regimeSplit.down.n}  평균 ${s.regimeSplit.down.avg >= 0 ? '+' : ''}${s.regimeSplit.down.avg.toFixed(2)}%  승률${s.regimeSplit.down.win.toFixed(0)}%`);
  else console.log(`  하락국면: 해당 없음`);

  console.log(`\n━━━ 종목별 신호수(상위 20) ━━━`);
  const byStock = byStockSummary(results);
  for (const row of byStock.slice(0, 20)) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(유효${row.n}건)  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ 각 이벤트는 독립 트레이드로 시뮬레이션(동일종목 포지션 중복보유 여부는 반영하지 않음)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
