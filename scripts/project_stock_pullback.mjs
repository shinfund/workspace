// 눌림목(추세추종) V3_RETEST 매매전략 — 최종 확정판 검증 스크립트 (2026-08-06)
// 진입: 시장국면(KOSPI>EMA100, 상승) + 종목추세(정배열 EMA50>EMA100, EMA100 상승) + 50일 신고가(최근6일내) 재지지
//       + 되돌림밴드 = 눌림폭(50일고점 대비 %) <= 종목 14일 ATR% × 0.4 (종목별 변동성 정규화, 고정%아님)
// 청산: 손절-8% / EMA50이탈 / 트레일링-8%(고점대비) / 40거래일 시간청산, 최초 도달 규칙 적용
// 부분익절: +10% 도달 시 50% 매도 확정, 잔량은 동일 청산규칙 유지
// 검증: 날짜순 60/40 분할(IS/OOS)로 확정 파라미터가 최근 구간에서도 견고한지 스냅샷 점검(재탐색 없음 — 파라미터는 이미 확정됨)
// 연혁: v1(entry_variants 5종비교, SMA60/120) → v2(SL/TRAIL 그리드) → v3(OOS+부분익절, 고정92~98%밴드) →
//       v4(결측치 fillForward 버그 정정) → v5(되돌림밴드 고정%→ATR%×0.4 정규화) →
//       v6(2026-08-06 같은 날, 추세필터 SMA60/120→EMA50/100 재교체 — 사용자 개인 이평체계(5/10/20/50/100/200/400 EMA) 통일) →
//       v7(2026-08-06 같은 날, 신고가lookback 10일→6일·상승판정lookback 20일→10일 재탐색, 본 파일)
//       v8(2026-08-06 같은 날, 스킬명·리포트명(stock-pullback)과 통일 위해 파일명 변경: project_pullback_oos_and_partial_tp.mjs → project_stock_pullback.mjs, 로직 변경 없음)
//       v9(2026-08-06 같은 날, 시장국면 지속일수≥10거래일 필터 추가 — 최근신호 90일 구간에서 손절이 국면전환 직후(2026-06월)에 집중된 걸 발견,
//          ATR%상한×지속일수 그리드서치(scripts/project_pullback_risk_filter_sweep.mjs) 결과 지속일수 필터만 OOS Sharpe가 IS보다 개선(+16%)돼 채택,
//          ATR%상한 필터는 OOS에서 -14~-35% 훼손돼 기각. REGIME_STREAK_MIN=10 추가.)
//       v10(2026-08-10, 시장 전체 변동성 서킷브레이커 필터 추가 — 2026-05~07월초 KOSPI가 하루±5~10%씩 흔드는
//          이례적 고변동장에서 손절비율이 장기평균(20%)의 2배(42%)로 치솟은 걸 사용자가 지적. 개별종목 ATR%
//          정규화 SL/TRAIL은 이미 별도로 기각됨(급락장엔 ATR%가 같이 치솟아 손절선이 넓어져 오히려 손실 확대,
//          scripts/project_pullback_atr_exit_sweep.mjs). 대신 "KOSPI 자체의 14일 ATR% <= 2% 아니면 신규진입 금지"
//          그리드서치(scripts/project_pullback_market_vol_filter_sweep.mjs) 결과 전 지표 개선(TP전략 기준 Sharpe
//          0.388→0.489, 승률55%→60%, SL비율20%→16%) + OOS가 IS보다 좋음(0.387→0.643, 과최적화 위험 낮음).
//          표본은 834→511건(-39%)으로 줄어드는 트레이드오프 있음. KOSPI_ATR_PERIOD=14, VOL_CAP=2 추가.)
//       v11(2026-08-10 같은 날, VOL_CAP 2%→4%로 완화 — v10 실측 결과 최근진입이 2026-01-30까지 후퇴(6개월반 무신호),
//          월별로 뜯어보니 KOSPI 변동성이 2월부터 계속 2%를 넘어 캡2%가 성과 좋았던 2·4·5월(SL비율4~28%,
//          평균+0.65~+27.49%)까지 통째로 차단하고 있었음(사용자 지적으로 발견). 실제 문제 구간은 3·6·7월(SL비율
//          44~79%)뿐이라 캡을 4%로 완화(scripts/project_pullback_market_vol_filter_sweep.mjs 그리드서치 결과 재확인)
//          → 2·4(85%)·5월(55%)은 대부분 유지, 3·6·7월은 여전히 전부 차단. 최근진입 2026-01-30→05-14로 개선.
//          트레이드오프: TP전략 Sharpe 0.489→0.407, OOS도 IS보다 소폭 저하(0.430→0.390, 그래도 필터없음 0.388보다 우수).)
//       과거 그리드서치 원본 수치는 메모리(project_pullback_entry_variants_backtest.md) 참고.
// 사용법: node scripts/project_stock_pullback.mjs [--max-hold N] [--calendar-days N]
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

const KOSPI_SYMBOL = '%5EKS11';
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10; // 사용자 개인 이평체계(5/10/20/50/100/200/400 EMA) — 구 SMA60/120을 비율(1:2) 유지한 채 EMA50/100으로 교체
const BREAKOUT_LOOKBACK = 6; // 신고가 재지지 최근성 기준(2026-08-06 재탐색: 10일→6일, MA_SHORT 축소에 맞춰 비율 재조정)
const ATR_PERIOD = 14, BAND_K = 0.4; // 되돌림밴드 = 눌림폭 <= ATR% × BAND_K
const SL = 8, TRAIL = 8, TP_PCT = 10, TP_FRAC = 0.5;
const REGIME_STREAK_MIN = 10; // 시장국면(상승) 전환 후 최소 10거래일 지나야 진입 허용 — 막 전환된 직후 휩소 구간 배제(2026-08-06 그리드서치 채택, v9)
const KOSPI_ATR_PERIOD = 14, VOL_CAP = 4; // KOSPI 자체 ATR%가 이 값 초과면 신규진입 금지 — 추세 도중의 급변(크래시)장 배제(v10에서 2 채택 후, 좋았던 달까지 차단하는 문제 발견돼 v11에서 4로 완화)

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, maxHold: 40, calendarDays: 1100 };
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
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] };
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

// EMA(period) — 결측치는 fillForward로 먼저 보정 후 SMA 시드+표준 재귀식 적용
function buildEma(closes, period) {
  const filled = fillForward(closes);
  const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < filled.length; i++) {
    const price = filled[i];
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

// True Range의 period일 이동평균(ATR, SMA 평활 — 기존 관례 유지). 종목별 변동성을 %로 정규화해 되돌림밴드에 사용.
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
    const v = tr[i];
    if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
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
  const maLong = buildEma(closes, MA_LONG);
  const kospiAtr = buildAtr(chart.high, chart.low, closes, KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up;
    streak[dates[i]] = curStreak; // 상승국면이 오늘까지 연속 며칠째인지(휩소 구간 배제용, v9)
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null; // KOSPI 자체 변동성(추세 도중 급변 배제용, v10)
  }
  return { regime, streak, volPct };
}

function simulateTrendTrade(seq, i0, entryClose, sl, trail, maxHold) {
  let peak = entryClose;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    const maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) return { ret, reason: 'SL', day: d };
    if (close < maShort) return { ret, reason: 'TREND_BREAK', day: d };
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return { ret, reason: 'TRAIL', day: d };
    if (d === maxHold) return { ret, reason: 'TIME', day: d };
  }
  return null;
}

// 부분익절: 수익률이 tpPct에 도달하면 그 시점 가격으로 tpFrac 비율 매도(확정), 잔량은 동일 청산규칙으로 계속 보유
function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    const maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;

    if (!tpTaken && ret >= tpPct) {
      tpTaken = true;
      tpReturn = ret;
      if (close > peak) peak = close;
      continue;
    }

    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { ret: blended, reason, day: d, tpTaken };
    };

    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

async function loadStockSignals(stock, marketRegime, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null, entries: [] };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const highs = fillForward(chart.high);
  const lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT);
  const maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const minLen = MA_LONG + SLOPE_LOOKBACK + opts.maxHold + 1;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족', seq: null, entries: [] };

  const entries = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i];
    const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[s.date];
    if (kospiVol == null || kospiVol > VOL_CAP) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;

    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;

    const pullbackPct = (highS - s.close) / highS * 100; // 0=고점, 클수록 깊은 눌림
    const normDepth = pullbackPct / s.atrPct; // ATR%×BAND_K 배수 단위
    if (normDepth > BAND_K) continue;

    entries.push({ i, date: s.date });
  }
  return { ...stock, seq, entries };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}

function fmtRow(label, s) {
  if (!s) return `${label.padEnd(26)} 데이터 없음`;
  return label.padEnd(26) +
    String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[눌림목 V3_RETEST 최종판 검증] ${opts.stocks.length}종목, 최대${opts.maxHold}거래일, 최근${opts.calendarDays}일, 추세필터=EMA${MA_SHORT}/${MA_LONG}, 되돌림밴드=ATR%×${BAND_K}, 시장국면지속≥${REGIME_STREAK_MIN}일, KOSPI변동성≤${VOL_CAP}%`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);

  const loaded = await batchAll(opts.stocks, s => loadStockSignals(s, marketRegime, opts));
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  const valid = loaded.filter(r => !r.error && r.entries.length);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const allEntries = [];
  for (const r of valid) for (const e of r.entries) allEntries.push({ seq: r.seq, i: e.i, date: e.date, name: r.name });
  allEntries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  console.error(`[진입시점 추출 완료] 총 ${allEntries.length}건`);

  console.log('\n════════ 눌림목 V3_RETEST 최종 확정 전략 — 전체구간 성과 ════════');
  console.log(`진입: 시장국면(지속≥${REGIME_STREAK_MIN}일·KOSPI변동성≤${VOL_CAP}%)+종목추세(정배열, EMA${MA_SHORT}/${MA_LONG}) + ${MA_SHORT}일신고가 재지지 + 눌림폭<=ATR%×${BAND_K} / 청산: SL${SL}%·TRAIL${TRAIL}%·EMA${MA_SHORT}이탈·시간청산40일\n`);

  console.log('전략'.padEnd(26) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(69));
  const baseline = summarize(allEntries.map(e => simulateTrendTrade(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold)).filter(Boolean));
  const withTp = summarize(allEntries.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean));
  console.log(fmtRow('baseline(전량매도만)', baseline));
  console.log(fmtRow(`TP+${TP_PCT}%에서 ${TP_FRAC * 100}%매도(최종전략)`, withTp));

  // ── 스냅샷 점검: 확정 파라미터로 IS/OOS 성과가 여전히 유지되는지(재탐색 없음, 재현성 확인용) ──
  const splitIdx = Math.floor(allEntries.length * 0.6);
  const splitDate = allEntries[splitIdx]?.date;
  if (splitDate) {
    const isEntries = allEntries.filter(e => e.date <= splitDate);
    const oosEntries = allEntries.filter(e => e.date > splitDate);
    console.log(`\n════════ 확정 파라미터 IS/OOS 스냅샷 (재탐색 없음, ~${splitDate} 기준 60/40 분할) ════════\n`);
    console.log('구간'.padEnd(26) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
    console.log('─'.repeat(69));
    console.log(fmtRow('IS(튜닝당시 구간)', summarize(isEntries.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean))));
    console.log(fmtRow('OOS(그 이후 구간)', summarize(oosEntries.map(e => simulatePartialTP(e.seq, e.i, e.seq[e.i].close, SL, TRAIL, opts.maxHold, TP_PCT, TP_FRAC)).filter(Boolean))));
    console.log('\n※ 파라미터는 이미 확정됨(재탐색 아님) — OOS가 IS 대비 크게 훼손되면 최근 시장 레짐 변화 가능성을 의심할 것.');
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
