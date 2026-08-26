// 눌림목 v14 확정 진입로직은 그대로 두고, 청산 파라미터(SL/TRAIL/TP%/TP비율)만 재탐색하는 그리드서치.
// 코스피 유니버스는 project_stock_pullback.mjs DEFAULT_STOCKS(TOP50, 49종목)와 동일하게 고정.
// 진입 시그널은 1회만 로드해 재사용(청산 파라미터는 진입에 영향 없음 — 네트워크 비용 절감).
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
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
  { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const KOSPI_SYMBOL = '%5EKS11';
const KOSDAQ_SYMBOL = '%5EKQ11';
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10;
const BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4;
const REGIME_STREAK_MIN = 10;
const KOSPI_ATR_PERIOD = 14, VOL_CAP = 4;
const STOCK_ATR_CAP = 6;
const COOLDOWN_DAYS = 5;
const MAX_HOLD = 40;
const CALENDAR_DAYS = 1100;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
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
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes);
  const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < filled.length; i++) {
    const price = filled[i]; if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else { ema = price * k + ema * (1 - k); }
    emas[i] = ema;
  }
  return emas;
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
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }

async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function fetchMarketRegime(p1, p2, symbol) {
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
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
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}

// 진입 시그널만 추출(청산 로직 없음) — 각 진입 인덱스에서 이후 청산 시뮬은 그리드서치 단계에서 별도 수행
async function loadEntries(stock, regimeByMarket) {
  const marketRegime = regimeByMarket.KOSPI;
  const otherRegime = regimeByMarket.KOSDAQ;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, seq: null, entryIdx: [] };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT), maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const minLen = MA_LONG + SLOPE_LOOKBACK + MAX_HOLD + 1;
  if (seq.length < minLen) return { ...stock, seq: null, entryIdx: [] };

  // COOLDOWN_DAYS는 SL로 청산됐을 때만 발동하므로 청산파라미터에 의존 — 그리드서치에선 쿨다운 계산을
  // 각 SL/TRAIL 조합마다 다시 해야 정확하지만, 여기서는 "후보 진입 인덱스"만 필터없이(쿨다운 제외) 모두 뽑고
  // 그리드서치 단계에서 조합별로 쿨다운을 시뮬레이션 순서대로 적용한다.
  const entryIdx = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length - 1; i++) {
    const s = seq[i];
    const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if (otherRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[s.date];
    if (kospiVol == null || kospiVol > VOL_CAP) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;
    if (s.atrPct > STOCK_ATR_CAP) continue;
    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;
    const pullbackPct = (highS - s.close) / highS * 100;
    const normDepth = pullbackPct / s.atrPct;
    if (normDepth > BAND_K) continue;
    entryIdx.push(i);
  }
  return { ...stock, seq, entryIdx };
}

function simulatePartialTP(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close;
    const maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => { const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret; return { ret: blended, reason, day: d, tpTaken }; };
    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  const avgDays = mean(trades.map(t => t.day));
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, sd, sharpe: sd > 0 ? avg / sd : 0, avgDays, perDay: avg / avgDays };
}

// 종목별 seq/entryIdx를 날짜순 통합 리스트로 만들고, 조합별 쿨다운을 시뮬레이션 순서대로 적용해 트레이드 생성
function runCombo(loaded, sl, trail, tpPct, tpFrac) {
  const allTrades = [];
  for (const r of loaded) {
    if (!r.seq || !r.entryIdx.length) continue;
    let blockedUntilIdx = -1;
    for (const i of r.entryIdx) {
      if (i <= blockedUntilIdx) continue;
      const s = r.seq[i];
      const trade = simulatePartialTP(r.seq, i, s.close, sl, trail, MAX_HOLD, tpPct, tpFrac);
      if (trade && trade.reason === 'SL') blockedUntilIdx = i + trade.day + COOLDOWN_DAYS;
      if (trade) allTrades.push({ ...trade, date: s.date });
    }
  }
  allTrades.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return allTrades;
}

async function main() {
  console.error(`[눌림목 청산 그리드서치] ${DEFAULT_STOCKS.length}종목(TOP50 확정 유니버스 동일), 진입로직 v14 그대로 고정`);
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const [regimeKospi, regimeKosdaq] = await Promise.all([
    fetchMarketRegime(p1, p2, KOSPI_SYMBOL), fetchMarketRegime(p1, p2, KOSDAQ_SYMBOL),
  ]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };
  const loaded = await batchAll(DEFAULT_STOCKS, s => loadEntries(s, regimeByMarket));
  const totalEntries = loaded.reduce((a, r) => a + (r.entryIdx?.length || 0), 0);
  console.error(`[진입후보 추출 완료] 총 ${totalEntries}건(쿨다운 미적용 원시 후보)`);

  const SL_GRID = [6, 7, 8, 9, 10];
  const TRAIL_GRID = [8, 9, 10, 11, 12, 14, 16, 18, 20];
  const TP_GRID = [8, 10, 12, 15, 18, 20];
  const TPFRAC_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  const results = [];
  for (const sl of SL_GRID) for (const trail of TRAIL_GRID) for (const tp of TP_GRID) for (const tpFrac of TPFRAC_GRID) {
    const trades = runCombo(loaded, sl, trail, tp, tpFrac);
    if (trades.length < 100) continue;
    const splitIdx = Math.floor(trades.length * 0.6);
    const splitDate = trades[splitIdx]?.date;
    const isT = trades.filter(t => t.date <= splitDate);
    const oosT = trades.filter(t => t.date > splitDate);
    const all = summarize(trades), isS = summarize(isT), oosS = summarize(oosT);
    if (!all || !isS || !oosS) continue;
    results.push({ sl, trail, tp, tpFrac, all, isS, oosS });
  }
  console.error(`[그리드서치 완료] ${results.length}개 조합 평가`);

  // 강건성 점수: OOS Sharpe를 우선하되, IS 대비 심하게 훼손된 조합(과최적화 의심)은 페널티
  for (const r of results) {
    const degrade = r.isS.sharpe > 0 ? (r.isS.sharpe - r.oosS.sharpe) / r.isS.sharpe : 0;
    r.robustScore = r.oosS.sharpe - Math.max(0, degrade) * 0.3;
  }
  // perDay(하루당 기대수익률) 순 정렬 — 5슬롯 공유자본 포트폴리오는 슬롯 회전율(자본효율)이 핵심이라
  // 트레이드당 Sharpe보다 하루당 기대치가 실전 헤드라인과 더 잘 맞는다(2026-08-26 라운드넘버 재검증에서 확인).
  results.sort((a, b) => b.all.perDay - a.all.perDay);

  console.log('\n════════ 눌림목 청산 그리드서치 결과 (perDay 순) — 상위 20 ════════\n');
  console.log('SL  TRAIL TP  TPfrac'.padEnd(24) + 'n(전체)'.padStart(8) + '전체avg'.padStart(9) + '평균보유'.padStart(9) + 'perDay'.padStart(9) + '전체Sharpe'.padStart(11) + 'IS_Sharpe'.padStart(11) + 'OOS_Sharpe'.padStart(11));
  console.log('─'.repeat(104));
  for (const r of results.slice(0, 20)) {
    console.log(
      `${String(r.sl).padStart(2)}   ${String(r.trail).padStart(2)}   ${String(r.tp).padStart(2)}  ${r.tpFrac.toFixed(1)}`.padEnd(24) +
      String(r.all.n).padStart(8) +
      `${r.all.avg >= 0 ? '+' : ''}${r.all.avg.toFixed(2)}%`.padStart(9) +
      `${r.all.avgDays.toFixed(1)}일`.padStart(9) +
      `${r.all.perDay.toFixed(3)}%`.padStart(9) +
      r.all.sharpe.toFixed(3).padStart(11) +
      r.isS.sharpe.toFixed(3).padStart(11) +
      r.oosS.sharpe.toFixed(3).padStart(11)
    );
  }

  // 현재 확정값(SL8/TRAIL8/TP10/frac0.5)도 비교용으로 별도 출력
  const cur = results.find(r => r.sl === 8 && r.trail === 8 && r.tp === 10 && r.tpFrac === 0.5);
  console.log('\n════════ 현재 확정값(SL8/TRAIL8/TP10/frac0.5) 그리드 내 위치(perDay 순위) ════════\n');
  if (cur) {
    console.log(`n=${cur.all.n} avg=${cur.all.avg.toFixed(2)}% 평균보유${cur.all.avgDays.toFixed(1)}일 perDay=${cur.all.perDay.toFixed(3)}% 전체Sharpe=${cur.all.sharpe.toFixed(3)} IS=${cur.isS.sharpe.toFixed(3)} OOS=${cur.oosS.sharpe.toFixed(3)} → 전체 ${results.length}개 중 순위 ${results.findIndex(r => r === cur) + 1}위`);
  } else {
    console.log('현재 확정값 조합이 그리드에 없음(별도 확인 필요)');
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
