// 3전략(눌림목+괴리율+라운드넘버) 통합 5슬롯 포트폴리오 — "오늘" 진입신호 스캔
// 기준선(EMA200 파동) 전략은 [[project_trading_plan_3strategy_portfolio]] 결정에 따라 운용에서 제외됨.
// 각 전략의 정식 스크립트(project_stock_pullback.mjs / project_deviation_tp20_exit_backtest.mjs /
// project_roundnumber_strategy_backtest.mjs)의 진입조건을 그대로 복제해 "오늘(마지막 봉)" 기준으로만 판정한다.
// 노션 보유종목DB(9f666aeb-832a-4aa2-9e52-e37515b75e56)에서 현재 보유종목수를 읽어 빈슬롯을 계산하고,
// 빈슬롯 개수만큼 우선순위(눌림목>괴리율>라운드넘버, project_trading_plan_3strategy_portfolio 메모 기준)로 추천한다.
// 같은 날 같은 전략 내 후보가 3건을 넘으면 신호강도 기준 1~3순위만 채택(project_3strategy_combined_portfolio_backtest.mjs와
// 동일 기준, 2026-08-26 눌림목·괴리율까지 확장): 눌림목=추세강도desc·눌림폭(ATR정규화)asc, 괴리율=EMA5·20 Z합asc·백분위합asc,
// 라운드넘버=밀집도(touchCount)desc·지지일수(aboveCount)desc.
// 사용법: node scripts/project_portfolio3_entry_scan.mjs
import https from 'https';
import { fetchKrxUniverse, getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';
const MAX_SLOTS = 5;

const KOSPI_SIZE = 50, KOSDAQ_SIZE = 20;
// 코스피 TOP50 + 코스닥 TOP20 (project_pullback_recent_signals.mjs / project_deviation_recent_signals.mjs /
// project_roundnumber_strategy_backtest.mjs와 100% 동일한 폴백 유니버스 — 세 스크립트 실파일 대조 확인 완료,
// 눌림목·괴리율은 코스피+코스닥 전체를, 라운드넘버는 이 중 코스피만 사용)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];

async function buildKospiUniverse() {
  try {
    const { kospi, basDt } = await fetchKrxUniverse();
    const top = kospi.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSPI_SIZE).map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSPI' }));
    console.error(`[유니버스] 코스피 시총 TOP${KOSPI_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스피 폴백 스냅샷 사용`);
    return FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
  }
}
async function buildKosdaqUniverse() {
  try {
    const { kosdaq, basDt } = await fetchKrxUniverse();
    const top = kosdaq.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSDAQ_SIZE).map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSDAQ' }));
    console.error(`[유니버스] 코스닥 시총 TOP${KOSDAQ_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스닥 폴백 스냅샷 사용`);
    return FALLBACK_KOSDAQ;
  }
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
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function kstTodayDate() { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
}
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
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function rollingZPct(seq, j, devKey, roll) {
  const win = seq.slice(j - roll + 1, j + 1).map(r => r[devKey]);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j][devKey];
  const z = sd ? (v - m) / sd : 0;
  const pct = win.filter(d => d <= v).length / win.length * 100;
  return { z, pct };
}
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
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) { if (highs[k] > hi) hi = highs[k]; if (lows[k] < low) low = lows[k]; }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
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
async function fetchKisPriceMap(codes) {
  let token;
  try { token = await getKisToken(); } catch (e) {
    console.error(`[KIS] 토큰 실패: ${e.message} → 당일 종가는 Yahoo 값 사용`);
    return new Map();
  }
  const map = new Map();
  const BATCH = 5, DELAY_KIS = 200;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(c => fetchKisPrice(token, c)));
    batch.forEach((c, j) => { if (res[j] && res[j].현재가 > 0) map.set(c, res[j].현재가); });
    if (i + BATCH < codes.length) await new Promise(r => setTimeout(r, DELAY_KIS));
  }
  console.error(`[KIS] 당일 현재가 ${map.size}/${codes.length}종목 확보`);
  return map;
}

// ── 노션 보유종목DB: 최신 스냅샷 종목코드 집합(빈슬롯 계산용) ──
async function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.write(data); req.end();
  });
}
async function refetchHeldRow(pageId) {
  try {
    const page = await new Promise((res, rej) => {
      https.get(`https://api.notion.com/v1/pages/${pageId}`, { headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
      }).on('error', rej);
    });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      strategy: page?.properties?.['전략']?.select?.name || null,
    };
  } catch { return null; }
}
async function fetchHeldCodes() {
  // 빈슬롯은 3전략(눌림목/괴리율/라운드넘버) 5슬롯 공유자본 기준 — 매도완료(보유수량 0)나 기준선 전략(축소·배제 대상) 보유분은 슬롯 점유로 세지 않는다.
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음 — 빈슬롯 계산 불가, 5슬롯 전부 빈 것으로 가정'); return new Set(); }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) return new Set();
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate);
  const codes = [];
  for (const p of rows) {
    let code = (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim();
    let qty = Number(p.properties['보유수량']?.number || 0);
    let strategy = p.properties['전략']?.select?.name || null;
    if (!code) { // rich_text가 인덱싱 지연으로 비어있는 경우 재조회
      const refetched = await refetchHeldRow(p.id);
      if (refetched) { code = refetched.code; qty = refetched.qty; strategy = refetched.strategy; }
    }
    if (code && qty > 0 && strategy !== '기준선') codes.push(code);
  }
  return new Set(codes);
}

// ── 눌림목: 시장국면 ──
const KOSPI_SYMBOL = '^KS11', KOSDAQ_SYMBOL = '^KQ11'; // fetchYahooChart가 encodeURIComponent 처리하므로 여기선 미인코딩 원문 사용
const PB_MA_SHORT = 50, PB_MA_LONG = 100, PB_SLOPE_LOOKBACK = 10, PB_BREAKOUT_LOOKBACK = 6;
const PB_ATR_PERIOD = 14, PB_BAND_K = 0.4;
const PB_SL = 8, PB_TRAIL = 8, PB_SL_KOSDAQ = 18, PB_TRAIL_KOSDAQ = 18;
const PB_REGIME_STREAK_MIN = 10, PB_KOSPI_ATR_PERIOD = 14, PB_VOL_CAP = 4, PB_STOCK_ATR_CAP = 6;
async function fetchMarketRegime(p1, p2, symbol) {
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) throw new Error(`${symbol} 지수 조회 실패`);
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, PB_MA_LONG);
  const atr = buildAtr(chart.high, chart.low, closes, PB_KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < PB_MA_LONG + PB_SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - PB_SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up; streak[dates[i]] = curStreak;
    volPct[dates[i]] = atr[i] != null ? atr[i] / closes[i] * 100 : null;
  }
  return { regime, streak, volPct };
}

// ── 눌림목: 오늘 진입신호 판정 ──
async function checkPullbackEntry(stock, regimeByMarket, kisMap, todayDate) {
  const marketRegime = stock.market === 'KOSDAQ' ? regimeByMarket.KOSDAQ : regimeByMarket.KOSPI;
  const otherRegime = stock.market === 'KOSDAQ' ? regimeByMarket.KOSPI : regimeByMarket.KOSDAQ;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 1100 * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const maShort = buildEma(closes, PB_MA_SHORT), maLong = buildEma(closes, PB_MA_LONG);
  const atr = buildAtr(highs, lows, closes, PB_ATR_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const lastIdx = seq.length - 1;
  if (lastIdx < PB_MA_LONG + PB_SLOPE_LOOKBACK) return null;
  if (seq[lastIdx].date === todayDate && kisMap?.has(stock.code)) seq[lastIdx].close = kisMap.get(stock.code);

  const i = lastIdx, s = seq[i], prior = seq[i - PB_SLOPE_LOOKBACK];
  const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
  if (!trendUp || marketRegime.regime[s.date] !== true || otherRegime.regime[s.date] !== true) return null;
  if ((marketRegime.streak[s.date] ?? 0) < PB_REGIME_STREAK_MIN) return null;
  const vol = marketRegime.volPct[s.date];
  if (vol == null || vol > PB_VOL_CAP) return null;
  if (i < PB_MA_SHORT || s.atrPct == null || s.atrPct <= 0 || s.atrPct > PB_STOCK_ATR_CAP) return null;
  let highS = -Infinity, highSIdx = -1;
  for (let k = i - (PB_MA_SHORT - 1); k <= i - 1; k++) if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; }
  const recentBreakout = highSIdx >= i - PB_BREAKOUT_LOOKBACK;
  if (!recentBreakout || s.close > highS || s.close <= s.maShort) return null;
  const pullbackPct = (highS - s.close) / highS * 100;
  const normDepth = pullbackPct / s.atrPct;
  if (normDepth > PB_BAND_K) return null;
  const trendStrength = (s.maLong - prior.maLong) / prior.maLong * 100;
  return { code: stock.code, name: stock.name, market: stock.market, price: s.close, trendStrength, pullbackNorm: normDepth, reason: `50일신고가(${Math.round(highS).toLocaleString()}) 대비 -${pullbackPct.toFixed(1)}% 눌림, EMA50/100 정배열` };
}

// ── 괴리율: 오늘 진입신호 판정 ──
const DV_ROLL = 250, DV_Z = -2, DV_PCT = 3, DV_FAST = 5, DV_SLOW = 20, DV_MID = 50, DV_LONG = 200;
async function checkDeviationEntry(stock, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 1100 * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, DV_FAST), ema20s = buildEma(closes, DV_SLOW), ema50s = buildEma(closes, DV_MID), ema200s = buildEma(closes, DV_LONG);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema200: ema200s[i], dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100 });
  }
  const lastIdx = seq.length - 1;
  if (lastIdx < DV_ROLL) return null;
  if (seq[lastIdx].date === todayDate && kisMap?.has(stock.code)) {
    const live = kisMap.get(stock.code);
    seq[lastIdx].close = live;
    seq[lastIdx].dev5 = (live - seq[lastIdx].ema5) / seq[lastIdx].ema5 * 100;
    seq[lastIdx].dev20 = (live - seq[lastIdx].ema20) / seq[lastIdx].ema20 * 100;
  }
  const flag = i => {
    if (i < DV_ROLL - 1) return false;
    const z5 = rollingZPct(seq, i, 'dev5', DV_ROLL), z20 = rollingZPct(seq, i, 'dev20', DV_ROLL);
    const sig5 = z5.z <= DV_Z && z5.pct <= DV_PCT, sig20 = z20.z <= DV_Z && z20.pct <= DV_PCT;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    return sig5 && sig20 && downTrend;
  };
  if (!flag(lastIdx) || flag(lastIdx - 1)) return null; // rising edge만 인정(원본 entries 로직과 동일)
  const s = seq[lastIdx];
  const z5 = rollingZPct(seq, lastIdx, 'dev5', DV_ROLL), z20 = rollingZPct(seq, lastIdx, 'dev20', DV_ROLL);
  return { code: stock.code, name: stock.name, market: stock.market, price: s.close, zSum: z5.z + z20.z, pctSum: z5.pct + z20.pct, reason: `EMA5·EMA20 동시 Z≤-2&하위3%ile 과매도(오늘 신규), EMA50<EMA200 하락추세` };
}

// ── 라운드넘버: 오늘 진입신호 판정 ──
const RN_WINDOW = 150, RN_TICKS = 30, RN_LOOKBACK = 20, RN_PRIOR = 5, RN_TOUCHES = 3, RN_RECLAIM = 5, RN_STOPBUF = 2, RN_MINPOS = 20, RN_MINBAND = 2.5;
async function checkRoundnumberEntry(stock, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 2555 * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    closes.push(chart.close[i]); highs.push(chart.high[i] ?? chart.close[i]); lows.push(chart.low[i] ?? chart.close[i]);
  }
  const lastIdx = closes.length - 1;
  if (lastIdx < RN_WINDOW + RN_LOOKBACK + 10) return null;
  if (dates[dates.length - 1] === todayDate && kisMap?.has(stock.code)) closes[lastIdx] = kisMap.get(stock.code);

  const seq = closes.map((c, i) => ({ date: dates[i], close: c }));
  // detectRoundSignals 전체 로직(project_roundnumber_strategy_backtest.mjs와 동일) — 오늘이 진입일(entryIdx===lastIdx)인 이벤트만 채택
  for (let i = Math.max(1, lastIdx - RN_RECLAIM - 2); i < lastIdx; i++) {
    const prev = seq[i - 1]?.close, cur = seq[i].close;
    if (prev == null) continue;
    const step = computeStepAt(highs, lows, i, RN_WINDOW, RN_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < RN_MINBAND) continue;
    const lo = Math.max(0, i - 1 - RN_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < RN_PRIOR) continue;
    const touch = touchCountBefore(highs, lows, i, L, RN_WINDOW);
    if (touch < RN_TOUCHES) continue;
    for (let f = i; f < Math.min(seq.length, i + RN_RECLAIM); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step && f === lastIdx) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= RN_MINPOS) {
            return { code: stock.code, name: stock.name, market: 'KOSPI', price: seq[f].close, touchCount: touch, aboveCount, reason: `라운드지지 ${Math.round(L).toLocaleString()} 이탈 후 오늘 재돌파(터치${touch}봉, 진입위치${entryPosition.toFixed(0)}%), TP ${Math.round(L + step).toLocaleString()}` };
          }
        }
        break;
      }
    }
  }
  return null;
}

async function main() {
  console.error('[3전략 진입신호 체크] 시작');
  const heldCodes = await fetchHeldCodes();
  const openSlots = Math.max(0, MAX_SLOTS - heldCodes.size);
  console.error(`[슬롯] 보유 ${heldCodes.size}종목 / 5슬롯 → 빈슬롯 ${openSlots}개`);

  const kospiUniverse = await buildKospiUniverse();
  const kosdaqUniverse = await buildKosdaqUniverse();
  const pdUniverse = [...kospiUniverse, ...kosdaqUniverse].filter(s => !heldCodes.has(s.code));
  const rnUniverse = kospiUniverse.filter(s => !heldCodes.has(s.code));

  const todayDate = kstTodayDate();
  const allCodes = [...new Set([...kospiUniverse, ...kosdaqUniverse].map(s => s.code))];
  const kisMap = await fetchKisPriceMap(allCodes);

  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 1100 * 24 * 3600;
  console.error('[눌림목] 시장국면(KOSPI/KOSDAQ) 조회...');
  const [regimeKospi, regimeKosdaq] = await Promise.all([fetchMarketRegime(p1, p2, KOSPI_SYMBOL), fetchMarketRegime(p1, p2, KOSDAQ_SYMBOL)]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };

  console.error(`[스캔] 눌림목·괴리율 ${pdUniverse.length}종목, 라운드넘버 ${rnUniverse.length}종목 진입조건 확인 중...`);
  const pbRaw = (await batchAll(pdUniverse, s => checkPullbackEntry(s, regimeByMarket, kisMap, todayDate))).filter(Boolean);
  const dvRaw = (await batchAll(pdUniverse, s => checkDeviationEntry(s, kisMap, todayDate))).filter(Boolean);
  const rnRaw = (await batchAll(rnUniverse, s => checkRoundnumberEntry(s, kisMap, todayDate))).filter(Boolean);

  // 같은 날 같은 전략 내 후보 1~3순위 캡(project_3strategy_combined_portfolio_backtest.mjs와 동일 기준)
  const SAME_DAY_CAP = 3;
  pbRaw.sort((a, b) => (b.trendStrength - a.trendStrength) || (a.pullbackNorm - b.pullbackNorm));
  const dvSorted = [...dvRaw].sort((a, b) => (a.zSum - b.zSum) || (a.pctSum - b.pctSum));
  rnRaw.sort((a, b) => (b.touchCount - a.touchCount) || (b.aboveCount - a.aboveCount));
  const pbCapExcess = Math.max(0, pbRaw.length - SAME_DAY_CAP);
  const dvCapExcess = Math.max(0, dvSorted.length - SAME_DAY_CAP);
  const rnCapExcess = Math.max(0, rnRaw.length - SAME_DAY_CAP);
  const pbResults = pbRaw.slice(0, SAME_DAY_CAP);
  const dvResults = dvSorted.slice(0, SAME_DAY_CAP);
  const rnResults = rnRaw.slice(0, SAME_DAY_CAP);
  if (pbCapExcess || dvCapExcess || rnCapExcess) {
    console.error(`[동시신호 캡] 눌림목 ${pbCapExcess}건·괴리율 ${dvCapExcess}건·라운드넘버 ${rnCapExcess}건이 1~3순위 밖으로 제외됨`);
  }

  const combined = [
    ...pbResults.map(r => ({ ...r, strategy: '눌림목' })),
    ...dvResults.map(r => ({ ...r, strategy: '괴리율' })),
    ...rnResults.map(r => ({ ...r, strategy: '라운드넘버' })),
  ];

  console.log(`\n━━━ 3전략 진입신호 체크 (${todayDate} 기준) ━━━`);
  if (openSlots === 0) console.log('⚠ 빈슬롯 없음 — 신규 진입 보류(아래는 참고용 전체 후보)');
  else console.log(`빈슬롯 ${openSlots}개 — 아래 우선순위(눌림목>괴리율>라운드넘버) 상위 ${openSlots}개 추천`);

  if (!combined.length) {
    console.log('\n오늘 발생한 진입신호 없음.');
  } else {
    console.log(`\n[추천 ${Math.min(openSlots, combined.length)}건]`);
    combined.slice(0, openSlots).forEach((r, i) => console.log(`${i + 1}. [${r.strategy}] ${r.name}(${r.code}) ${Math.round(r.price).toLocaleString()}원 — ${r.reason}`));

    console.log(`\n[전체 후보 ${combined.length}건]`);
    for (const strat of ['눌림목', '괴리율', '라운드넘버']) {
      const rows = combined.filter(r => r.strategy === strat);
      if (!rows.length) continue;
      console.log(`\n· ${strat} (${rows.length}건)`);
      rows.forEach(r => console.log(`  - ${r.name}(${r.code}) ${Math.round(r.price).toLocaleString()}원 — ${r.reason}`));
    }
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
