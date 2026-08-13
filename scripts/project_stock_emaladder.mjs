// EMA래더 완전정배열(추세추종) 매매전략 — 확정판 검증 스크립트 (2026-08-10)
// 진입: 종목의 EMA5>20>50>100>200>400가 전부 순서대로 정배열되는 "전환일"(그 전날엔 미충족)
//       + 시장국면(KOSPI: 종가>EMA100 AND EMA100 10일전보다 상승, 이 상태가 10거래일 이상 지속)
// 청산: 손절-10% / EMA100 이탈(TREND_BREAK) / 트레일링-12%(고점대비) / 60거래일 시간청산, 최초 도달 규칙
// 부분익절: +10% 도달 시 50% 매도 확정, 잔량은 동일 청산규칙 유지
// 연혁:
//   1) project_tech_ema_ladder_signal_scan.mjs — 청산규칙 없는 1차 신호품질 스캔(TOP50×6년).
//      완전정배열 전환일만 베이스라인(무신호 랜덤시점) 대비 뚜렷한 우위 확인
//      (+40거래일 평균+10.52%/중앙값+4.61%/승률63%/Sharpe0.388 vs 베이스라인 +6.47%/+2.23%/57%/0.287).
//      개별 EMA쌍 골든크로스(5/20·20/50·50/100·100/200·200/400)는 전부 베이스라인과 비슷하거나 열세로 기각
//      (특히 EMA100/200 크로스는 승률47%로 최악 — 느린 이평 교차는 추세 끝물에 뒤늦게 발생하는 지연지표).
//      "4개 이상 정배열"처럼 기준을 완화해도 오히려 성과 저하 — 엄격한 "전부 정배열"이 핵심.
//   2) project_tech_ema_ladder_exit_grid.mjs — 실제 청산규칙(SL/TRAIL/TREND_BREAK EMA/TIME) 그리드서치.
//      TREND_BREAK 기준 EMA는 20/50/100 중 EMA100이 Sharpe 최우수(느린 이평일수록 휩소 감소, 눌림목 전략에서
//      EMA50이 EMA5/20보다 나았던 것과 같은 패턴). SL10%/TRAIL12%가 최적 조합.
//      ⚠️ 중요 특징: 국면필터 적용해도 TP 없는 baseline은 승률48%·중앙값-1.61%(음수) — 절반 이상이 소액손실이고
//      소수 대박 트레이드가 평균을 끌어올리는 구조. 괴리율(승률80%)·눌림목(승률56%)과 손익 분포 성격이 다름.
//   3) 시장국면(KOSPI EMA100상승+지속10일) 필터 적용 시 Sharpe 0.286→0.353로 개선(진입 756→421건, 눌림목과
//      동일 패턴). TP오버레이 비교: TP20%가 Sharpe 최고치(0.385)이나 승률49%·중앙값-1.41%(음수) 유지 —
//      "소수 대박" 구조 그대로. TP10%는 Sharpe 근소열세(0.371)이나 승률56%·중앙값+4.42%(양수)로 개선되고,
//      IS/OOS 양쪽에서 승률56%·중앙값 플러스가 일관 유지(IS Sharpe0.424→OOS0.303, 눌림목과 비슷한 감쇠폭).
//      사용자가 "실전형(TP10%)"을 최종 확정(Sharpe 최고치보다 승률·중앙값 안정성 우선 — 괴리율·눌림목과 같은 원칙).
// 사용법: node scripts/project_stock_emaladder.mjs [--max-hold N] [--calendar-days N]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' }, { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' }, { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' }, { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' }, { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' }, { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' }, { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const EMA_PERIODS = [5, 20, 50, 100, 200, 400]; // 사용자 표준 이평체계
const PAIRS = [[5, 20], [20, 50], [50, 100], [100, 200], [200, 400]];
const KOSPI_SYMBOL = '%5EKS11';
const REGIME_MA = 100, REGIME_SLOPE_LOOKBACK = 10, REGIME_STREAK_MIN = 10;
const TREND_BREAK_EMA = 100, SL = 10, TRAIL = 12, TP_PCT = 10, TP_FRAC = 0.5;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { maxHold: 60, calendarDays: 2200 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
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
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
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

async function fetchMarketRegime(p1, p2) {
  const chart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  if (!chart || !chart.ts.length) throw new Error('KOSPI지수 조회 실패');
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const ma = buildEma(closes, REGIME_MA);
  const regime = {}, streak = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (ma[i] == null || i < REGIME_MA + REGIME_SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > ma[i] && ma[i] > ma[i - REGIME_SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up;
    streak[dates[i]] = curStreak;
  }
  return { regime, streak };
}

async function loadStockSignals(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', entries: [] };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const emas = {};
  for (const p of EMA_PERIODS) emas[p] = buildEma(closes, p);

  const n = closes.length;
  const warmup = 400; // EMA400 시드 확보
  const alignCount = (i) => PAIRS.filter(([s, l]) => emas[s][i] > emas[l][i]).length;

  const entries = [];
  for (let i = warmup + 1; i < n - 1; i++) {
    if (closes[i] == null) continue;
    if (EMA_PERIODS.some(p => emas[p][i] == null || emas[p][i - 1] == null)) continue;
    const cntToday = alignCount(i), cntYest = alignCount(i - 1);
    if (cntToday === PAIRS.length && cntYest < PAIRS.length) entries.push({ i, date: dates[i] });
  }
  return { ...stock, dates, closes, emas, entries };
}

// 부분익절: 수익률이 tpPct에 도달하면 그 시점 가격으로 tpFrac 비율 매도(확정), 잔량은 동일 청산규칙으로 계속 보유
function simulatePartialTP(stock, i0, sl, trail, tb, maxHold, tpPct, tpFrac) {
  const entryClose = stock.closes[i0];
  let peak = entryClose, tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= stock.closes.length || stock.closes[j] == null) return null;
    const close = stock.closes[j];
    const breakLevel = stock.emas[tb][j];
    const ret = (close - entryClose) / entryClose * 100;

    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }

    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { ret: blended, reason, day: d, tpTaken };
    };

    if (ret <= -sl) return finish('SL');
    if (breakLevel != null && close < breakLevel) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

function simulateBaseline(stock, i0, sl, trail, tb, maxHold) {
  const entryClose = stock.closes[i0];
  let peak = entryClose;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= stock.closes.length || stock.closes[j] == null) return null;
    const close = stock.closes[j];
    const breakLevel = stock.emas[tb][j];
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) return { ret, reason: 'SL', day: d };
    if (breakLevel != null && close < breakLevel) return { ret, reason: 'TREND_BREAK', day: d };
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return { ret, reason: 'TRAIL', day: d };
    if (d === maxHold) return { ret, reason: 'TIME', day: d };
  }
  return null;
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}
function fmtRow(label, s) {
  if (!s) return `${label.padEnd(28)} 데이터 없음`;
  return label.padEnd(28) +
    String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA래더 완전정배열 최종판 검증] ${DEFAULT_STOCKS.length}종목, 최대${opts.maxHold}거래일, 최근${opts.calendarDays}일, TREND_BREAK=EMA${TREND_BREAK_EMA}, SL${SL}%/TRAIL${TRAIL}%, 시장국면지속≥${REGIME_STREAK_MIN}일`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);

  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, opts));
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  const valid = loaded.filter(r => !r.error && r.entries.length);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ stock: r, i: e.i, date: e.date, name: r.name });
  allEntries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const filtered = allEntries.filter(e => marketRegime.regime[e.date] === true && (marketRegime.streak[e.date] ?? 0) >= REGIME_STREAK_MIN);
  console.error(`[진입시점 추출 완료] 원본 ${allEntries.length}건 → 시장국면 필터 후 ${filtered.length}건\n`);

  console.log('\n════════ EMA래더 완전정배열 최종 확정 전략 — 전체구간 성과 ════════');
  console.log(`진입: EMA5/20/50/100/200/400 완전정배열 전환일 + 시장국면(KOSPI EMA${REGIME_MA} 상승·지속≥${REGIME_STREAK_MIN}일) / 청산: SL${SL}%·TRAIL${TRAIL}%·EMA${TREND_BREAK_EMA}이탈·시간청산${opts.maxHold}일\n`);

  console.log('전략'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(71));
  const baseline = summarize(filtered.map(e => simulateBaseline(e.stock, e.i, SL, TRAIL, TREND_BREAK_EMA, opts.maxHold)).filter(Boolean));
  const withTp = summarize(filtered.map(e => simulatePartialTP(e.stock, e.i, SL, TRAIL, TREND_BREAK_EMA, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean));
  console.log(fmtRow('baseline(전량매도만)', baseline));
  console.log(fmtRow(`TP+${TP_PCT}%에서 ${TP_FRAC * 100}%매도(최종전략)`, withTp));

  const splitIdx = Math.floor(filtered.length * 0.6);
  const splitDate = filtered[splitIdx]?.date;
  if (splitDate) {
    const isEntries = filtered.filter(e => e.date <= splitDate);
    const oosEntries = filtered.filter(e => e.date > splitDate);
    console.log(`\n════════ 확정 파라미터 IS/OOS 스냅샷 (재탐색 없음, ~${splitDate} 기준 60/40 분할) ════════\n`);
    console.log('구간'.padEnd(28) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
    console.log('─'.repeat(71));
    console.log(fmtRow('IS(튜닝당시 구간)', summarize(isEntries.map(e => simulatePartialTP(e.stock, e.i, SL, TRAIL, TREND_BREAK_EMA, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean))));
    console.log(fmtRow('OOS(그 이후 구간)', summarize(oosEntries.map(e => simulatePartialTP(e.stock, e.i, SL, TRAIL, TREND_BREAK_EMA, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean))));
    console.log('\n※ 파라미터는 이미 확정됨(재탐색 아님) — OOS가 IS 대비 크게 훼손되면 최근 시장 레짐 변화 가능성을 의심할 것.');
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
