// 4전략(눌림목+괴리율+라운드넘버+장대양봉) 통합 5슬롯 포트폴리오 — 보유종목 강제청산 체크
// 노션 보유종목DB(9f666aeb-832a-4aa2-9e52-e37515b75e56)의 "전략" 선택 필드(눌림목/괴리율/라운드넘버/장대양봉/미분류)로
// 그룹화해, 각 전략의 정식 청산조건(project_stock_pullback.mjs / project_deviation_tp20_exit_backtest.mjs /
// project_roundnumber_strategy_backtest.mjs)을 그대로 적용해 판정한다.
// 장대양봉(2026-09-01 편입)은 진입캔들 고가/저가/진입일자가 노션DB에 없어 정밀 청산판정 불가 — 아래
// judgeBigcandleApprox 참고(참고용 손익률만 표시).
// 주의: 이 노션DB엔 정확한 진입일자가 없어(증권사 연동 스냅샷) TRAIL(고점대비)·TIME(경과일수) 같은 상태이력
// 기반 청산조건은 완전 재현 불가 — project_pullback_holdings_candidates.mjs 등 기존 스크립트와 동일하게
// EMA크로스·현재손익률 기준 근사 판정(verdict)을 사용한다.
// 사용법: node scripts/project_portfolio3_exit_check.mjs
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { fetchKrxUniverse, getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.setEncoding('utf8'); // 멀티바이트 문자가 청크 경계에서 잘려 깨지는 것 방지
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

// ── 노션 보유종목DB: 최신 스냅샷 + 전략 태그 ──
async function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, r => {
      let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.write(data); req.end();
  });
}
async function refetchPage(pageId) {
  try {
    const page = await new Promise((res, rej) => {
      https.get(`https://api.notion.com/v1/pages/${pageId}`, { headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }, r => {
        let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
      }).on('error', rej);
    });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      name: (page?.properties?.['종목명']?.title?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      avgPrice: Number(page?.properties?.['매 입 가']?.number || 0),
      strategy: page?.properties?.['전략']?.select?.name || null,
    };
  } catch { return null; }
}
// 2026-08-26 버그 수정: Notion API의 page_size 최대치는 100(요청값 200은 조용히 100으로 잘림)이라
// has_more를 무시하고 단건 조회하면 "오늘 날짜" 보유종목 중 일부가 응답 순서에 따라 간헐적으로
// 누락됨(HD현대중공업이 "전략 미지정"으로 잘못 표시되던 실사례로 발견) — start_cursor로 끝까지 순회한다.
async function queryAllNotion(url, baseBody, headers) {
  const results = [];
  let cursor = undefined;
  for (let page = 0; page < 20; page++) {
    const body = cursor ? { ...baseBody, start_cursor: cursor } : baseBody;
    const data = await httpPostJson(url, body, headers);
    if (!data?.results) break;
    results.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return results;
}
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음'); return []; }
  const results = await queryAllNotion(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 100 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!results.length) return [];
  const data = { results };
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate).map(p => ({
    pageId: p.id,
    code: (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
    name: (p.properties['종목명']?.title?.[0]?.plain_text || '').trim(),
    qty: Number(p.properties['보유수량']?.number || 0),
    avgPrice: Number(p.properties['매 입 가']?.number || 0),
    strategy: p.properties['전략']?.select?.name || null,
  }));
  // name/code/qty/avgPrice가 비어있는 경우(신규 페이지 인덱싱 지연 등) 단건 재조회로 보정한다.
  for (const h of rows) {
    for (let attempt = 0; attempt < 3 && (!h.name || !h.code || h.qty <= 0 || !h.avgPrice || !h.strategy); attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 400));
      const fixed = await refetchPage(h.pageId);
      if (fixed) {
        if (!h.name && fixed.name) h.name = fixed.name;
        if (!h.code && fixed.code) h.code = fixed.code;
        if (h.qty <= 0 && fixed.qty > 0) h.qty = fixed.qty;
        if (!h.avgPrice && fixed.avgPrice) h.avgPrice = fixed.avgPrice;
        if (!h.strategy && fixed.strategy) h.strategy = fixed.strategy;
      }
    }
  }
  return rows.filter(h => h.code && h.qty > 0);
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// ── 눌림목 판정 ──
const PB_MA_SHORT = 50, PB_SL = 8, PB_SL_KOSDAQ = 18;
async function judgePullback(h, market) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 400 * 24 * 3600;
  const symbol = market === 'KOSDAQ' ? `${h.code}.KQ` : `${h.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...h, market, error: '데이터 조회 실패' };
  const closes = fillForward(chart.close);
  const ema50s = buildEma(closes, PB_MA_SHORT);
  const n = closes.length;
  if (n < 2 || ema50s[n - 1] == null) return { ...h, market, error: '데이터 부족' };
  const close = closes[n - 1], prevClose = closes[n - 2], ema50 = ema50s[n - 1];
  const sl = market === 'KOSDAQ' ? PB_SL_KOSDAQ : PB_SL;
  const ret = (close - h.avgPrice) / h.avgPrice * 100;
  const prevRet = (prevClose - h.avgPrice) / h.avgPrice * 100;
  const aboveEma50 = close >= ema50;
  const breakdown50 = !aboveEma50;
  const freshTp20 = ret >= 20 && !(prevRet >= 20); // v15(2026-08-26): TP 10%→20% 청산 그리드서치 재확정(perDay 기준)
  let v;
  if (ret <= -sl) v = { label: `손절검토(-${sl}%)`, urgent: true };
  else if (breakdown50) v = { label: '전량매도검토(50EMA이탈)', urgent: true };
  else if (freshTp20) v = { label: '1차익절검토(+20%)', urgent: true };
  else if (aboveEma50) v = { label: '홀딩(50EMA위)', urgent: false };
  else if (ret <= -sl * 0.6) v = { label: '주의', urgent: false };
  else v = { label: '관찰', urgent: false };
  return { ...h, market, close, ema50, ret, verdict: v.label, urgent: v.urgent };
}

// ── 괴리율 판정 ──
const DV_FAST = 5, DV_SLOW = 20, DV_SL = 18; // v15(2026-08-26): 청산 그리드서치 재확정(perDay 기준, SL 12→18)
async function judgeDeviation(h, market) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 400 * 24 * 3600;
  const symbol = market === 'KOSDAQ' ? `${h.code}.KQ` : `${h.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...h, market, error: '데이터 조회 실패' };
  const closes = chart.close;
  const ema5s = buildEma(closes, DV_FAST), ema20s = buildEma(closes, DV_SLOW);
  const n = closes.length;
  if (n < 2 || ema5s[n - 1] == null || ema20s[n - 1] == null) return { ...h, market, error: '데이터 부족' };
  const close = closes[n - 1], prevClose = closes[n - 2], ema5 = ema5s[n - 1], ema20 = ema20s[n - 1];
  const prevEma20 = ema20s[n - 2];
  const ret = (close - h.avgPrice) / h.avgPrice * 100;
  const prevRet = (prevClose - h.avgPrice) / h.avgPrice * 100;
  const aboveEma5 = close >= ema5, aboveEma20 = close >= ema20;
  const prevAboveEma20 = prevEma20 != null ? prevClose >= prevEma20 : aboveEma20;
  const breakdown5 = !aboveEma5;
  const freshTp20 = ret >= 20 && !(prevRet >= 20);
  const freshLeg20 = aboveEma20 && !prevAboveEma20;
  let v;
  if (ret <= -DV_SL) v = { label: `손절검토(-${DV_SL}%)`, urgent: true };
  else if (breakdown5) v = { label: '전량매도검토(5EMA이탈)', urgent: true };
  else if (freshLeg20) v = { label: '2차익절검토(20EMA돌파)', urgent: true };
  else if (aboveEma20) v = { label: '홀딩(20EMA위)', urgent: false };
  else if (freshTp20) v = { label: '익절검토(+20%)', urgent: true };
  else if (ret <= -8) v = { label: '주의', urgent: false };
  else v = { label: '관찰', urgent: false };
  return { ...h, market, close, ema5, ema20, ret, verdict: v.label, urgent: v.urgent };
}

// ── 기준선(EMA200 파동) 판정 — 축소·배제 대상, 우선 매도후보로 항상 노출 ──
// 주의: 노션DB에 진입일자가 없어 project_baseline_strategy_backtest.mjs의 recovered 상태·RECOVER_TIMEOUT
// (회복전 120거래일)·TIME(회복후 60거래일)은 정확 재현 불가. "현재 종가 vs EMA200/EMA5" 스냅샷으로
// BASELINE_BREAK(오늘 기준선 하향돌파)·WAVE1_FULL(오늘 EMA5 하향이탈, 기준선 위일 때만) 여부만 근사 판정한다.
const BL_LONG = 200, BL_SHORT = 5;
async function judgeBaseline(h, market) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 700 * 24 * 3600;
  const symbol = market === 'KOSDAQ' ? `${h.code}.KQ` : `${h.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...h, market, error: '데이터 조회 실패' };
  const closes = fillForward(chart.close);
  const ema5s = buildEma(closes, BL_SHORT), ema200s = buildEma(closes, BL_LONG);
  const n = closes.length;
  if (n < 2 || ema200s[n - 1] == null || ema5s[n - 1] == null) return { ...h, market, error: '데이터 부족' };
  const close = closes[n - 1], prevClose = closes[n - 2];
  const ema200 = ema200s[n - 1], prevEma200 = ema200s[n - 2];
  const ema5 = ema5s[n - 1], prevEma5 = ema5s[n - 2];
  const ret = (close - h.avgPrice) / h.avgPrice * 100;

  let signal = null; // 정식 청산신호(있으면 라벨)
  if (close < ema200) {
    if (prevEma200 != null && prevClose >= prevEma200) signal = 'BASELINE_BREAK(오늘 기준선 하향돌파)';
  } else {
    if (prevEma5 != null && prevClose >= prevEma5 && close < ema5) signal = 'WAVE1_FULL(오늘 EMA5 하향이탈)';
  }
  return { ...h, market, close, ema200, ema5, ret, formalSignal: signal };
}

// ── 장대양봉 판정(2026-09-01 4번째 확정전략 편입) — 한계: 정밀판정 불가(참고용) ──
// 정식 청산조건(TP=진입캔들고가/STOP=진입캔들저가×99.5%/TIME=진입후15거래일)은 원본 장대양봉의
// 고가·저가와 정확한 진입일자가 있어야 계산되는데, 노션 보유종목DB(증권사 연동 스냅샷)엔 이 값이
// 없다. 억지 근사치를 만들어 잘못된 매도신호를 내는 것보다, 현재가·평단·손익률만 참고용으로 보여주고
// 실제 매도판단은 매수 당시 별도로 기록해둔 진입캔들 고가/저가/진입일로 수동 확인하도록 안내한다.
async function judgeBigcandleApprox(h) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 60 * 24 * 3600;
  const chart = await fetchYahooChart(`${h.code}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return { ...h, market: 'KOSPI', error: '데이터 조회 실패' };
  const closes = fillForward(chart.close);
  const close = closes[closes.length - 1];
  if (close == null) return { ...h, market: 'KOSPI', error: '데이터 부족' };
  const ret = (close - h.avgPrice) / h.avgPrice * 100;
  return { ...h, market: 'KOSPI', close, ret, verdict: '정밀판정불가(참고용) — 매수시 기록한 진입캔들 고가/저가/진입일로 수동확인', urgent: false };
}

// ── 라운드넘버 판정 ──
const RN_WINDOW = 150, RN_TICKS = 30, RN_LOOKBACK = 20, RN_PRIOR = 5, RN_TOUCHES = 3, RN_STOPBUF = 3; // v15(2026-08-26): stopBufferPct 2→3 청산 그리드서치 재확정(누락분 반영, 2026-08-27 정정)
async function judgeRoundnumber(h) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 400 * 24 * 3600;
  const symbol = `${h.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...h, market: 'KOSPI', error: '데이터 조회 실패' };
  const closes = [], highs = [], lows = [];
  for (let i = 0; i < chart.ts.length; i++) {
    if (chart.close[i] == null) continue;
    closes.push(chart.close[i]); highs.push(chart.high[i] ?? chart.close[i]); lows.push(chart.low[i] ?? chart.close[i]);
  }
  const i = closes.length - 1;
  if (i < RN_WINDOW + RN_LOOKBACK) return { ...h, market: 'KOSPI', error: '데이터 부족' };
  const price = closes[i];
  const ret = (price - h.avgPrice) / h.avgPrice * 100;
  const step = computeStepAt(highs, lows, i, RN_WINDOW, RN_TICKS);
  if (!step) return { ...h, market: 'KOSPI', close: price, ret, verdict: '감시레벨 계산 불가', urgent: false };

  // 2026-08-26 버그 수정: 감시레벨을 "오늘 종가" 기준으로 다시 잡으면, 진입 후 주가가 이미 TP를
  // 돌파한 종목도 그 돌파가격을 새 지지선으로 재설정해버려 TP 도달 사실이 영구히 사라짐(LS ELECTRIC·
  // POSCO홀딩스 실사례로 발견). 진입가(h.avgPrice) 기준으로 감시레벨을 잡아야 실제 매수 시점의
  // 지지/저항이 유지되고, 그 이후 가격이 얼마나 올랐든 TP 도달 여부를 정확히 판정할 수 있다.
  const lo0 = Math.max(0, i - RN_LOOKBACK);
  let watchLevel = null;
  for (let L = Math.floor(h.avgPrice / step) * step; L > 0 && (h.avgPrice - L) / h.avgPrice < 0.3; L -= step) {
    let aboveCount = 0;
    for (let k = lo0; k < i; k++) if (closes[k] >= L) aboveCount++;
    const touch = touchCountBefore(highs, lows, i, L, RN_WINDOW);
    if (aboveCount >= RN_PRIOR && touch >= RN_TOUCHES) { watchLevel = L; break; }
  }
  if (watchLevel == null) return { ...h, market: 'KOSPI', close: price, ret, verdict: '감시레벨 없음(관찰)', urgent: false };
  const stop = watchLevel * (1 - RN_STOPBUF / 100);
  const tp = watchLevel + step;
  let v;
  if (price <= stop) v = { label: `손절검토(라운드지지 ${fmtWon(watchLevel)} 붕괴)`, urgent: true };
  else if (price >= tp) v = { label: `익절검토(라운드저항 ${fmtWon(tp)} 도달)`, urgent: true };
  else v = { label: `홀딩(지지 ${fmtWon(watchLevel)}~저항 ${fmtWon(tp)} 박스권)`, urgent: false };
  return { ...h, market: 'KOSPI', close: price, ret, support: watchLevel, resistance: tp, stop, verdict: v.label, urgent: v.urgent };
}

async function buildMarketMap() {
  const { kospi, kosdaq } = await fetchKrxUniverse();
  const map = new Map();
  for (const s of kospi) map.set(s.종목코드, 'KOSPI');
  for (const s of kosdaq) map.set(s.종목코드, 'KOSDAQ');
  return map;
}

// 웹(stock-portal "매매신호" 탭) 반영용 JSON 스냅샷 — 콘솔 출력과 별개로 추가 저장(기존 동작 변경 없음)
function writeOutputJson(data) {
  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_portfolio3_exit_check_output.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2), 'utf8');
  console.error(`[JSON] 결과 저장: ${outPath}`);
}

async function main() {
  console.error('[보유종목 청산체크] 시작');
  const holdings = await fetchNotionHoldings();
  if (!holdings.length) {
    console.log('보유종목 없음.');
    writeOutputJson({ todayDate: kstTodayDate(), baseline: [], urgent: [], all: [], unassigned: [] });
    return;
  }
  console.error(`[Notion] 보유종목 ${holdings.length}건: ${holdings.map(h => `${h.name}(${h.strategy || '미분류'})`).join(', ')}`);

  const marketMap = await buildMarketMap();
  const todayDate = kstTodayDate();

  const pb = holdings.filter(h => h.strategy === '눌림목');
  const dv = holdings.filter(h => h.strategy === '괴리율');
  const rn = holdings.filter(h => h.strategy === '라운드넘버');
  const bc = holdings.filter(h => h.strategy === '장대양봉');
  const bl = holdings.filter(h => h.strategy === '기준선');
  const un = holdings.filter(h => !['눌림목', '괴리율', '라운드넘버', '장대양봉', '기준선'].includes(h.strategy));

  const pbResults = await batchAll(pb, h => judgePullback(h, marketMap.get(h.code) || 'KOSPI'));
  const dvResults = await batchAll(dv, h => judgeDeviation(h, marketMap.get(h.code) || 'KOSPI'));
  const rnResults = await batchAll(rn, h => judgeRoundnumber(h));
  const bcResults = await batchAll(bc, h => judgeBigcandleApprox(h));
  const blResults = await batchAll(bl, h => judgeBaseline(h, marketMap.get(h.code) || 'KOSPI'));

  const all = [...pbResults.map(r => ({ ...r, strategy: '눌림목' })), ...dvResults.map(r => ({ ...r, strategy: '괴리율' })), ...rnResults.map(r => ({ ...r, strategy: '라운드넘버' })), ...bcResults.map(r => ({ ...r, strategy: '장대양봉' }))];

  console.log(`\n━━━ 보유종목 청산체크 (${todayDate} 기준) ━━━`);

  // 기준선 전략은 축소·배제 확정([[project_trading_plan_3strategy_portfolio]]) — 정식청산신호 충족 여부와
  // 무관하게 항상 최상단에 "우선 매도후보"로 노출(사용자 명시 요청). 정식청산신호 있는 건을 최우선,
  // 그다음은 손익률 내림차순(익절 좋은 것부터 매도해 슬롯 확보 — 2026-08-25 사용자 확정 방침).
  if (blResults.length) {
    console.log(`\n⚠ 우선 매도후보(기준선 전략 축소 대상, ${blResults.length}건) — 청산조건 충족 여부와 무관하게 전부 노출, 매도순번은 익절 유리한 순`);
    const sorted = [...blResults].sort((a, b) => (b.formalSignal ? 1 : 0) - (a.formalSignal ? 1 : 0) || (b.ret ?? -Infinity) - (a.ret ?? -Infinity));
    let n = 0;
    for (const r of sorted) {
      if (r.error) { console.log(`  - ${r.name}(${r.code}): ${r.error}`); continue; }
      n++;
      const sigLabel = r.formalSignal ? `정식청산신호: 있음(${r.formalSignal})` : '정식청산신호: 없음(홀딩중, 축소 방침상 매도 검토는 별도 가능)';
      console.log(`  ${n}. ${r.name}(${r.code}) 현재가 ${fmtWon(r.close)} / 평단 ${fmtWon(r.avgPrice)} / 손익 ${fmtPct(r.ret)} → ${sigLabel}`);
    }
  }

  const urgentRows = all.filter(r => r.urgent && !r.error);
  if (urgentRows.length) {
    console.log(`\n🔴 청산검토 대상 ${urgentRows.length}건`);
    for (const r of urgentRows) console.log(`  [${r.strategy}] ${r.name}(${r.code}) 현재가 ${fmtWon(r.close)} / 평단 ${fmtWon(r.avgPrice)} / 손익 ${fmtPct(r.ret)} → ${r.verdict}`);
  } else {
    console.log('\n청산검토 대상 없음 — 전 종목 홀딩/관찰');
  }

  for (const strat of ['눌림목', '괴리율', '라운드넘버', '장대양봉']) {
    const rows = all.filter(r => r.strategy === strat);
    if (!rows.length) continue;
    console.log(`\n· ${strat} (${rows.length}건)`);
    for (const r of rows) {
      if (r.error) { console.log(`  - ${r.name}(${r.code}): ${r.error}`); continue; }
      console.log(`  - ${r.name}(${r.code}) 현재가 ${fmtWon(r.close)} / 평단 ${fmtWon(r.avgPrice)} / 손익 ${fmtPct(r.ret)} → ${r.verdict}`);
    }
  }

  if (un.length) {
    console.log(`\n⚠ 전략 미지정 ${un.length}건 — 노션 보유종목DB에서 "전략" 필드를 지정해야 청산조건 판정 가능`);
    for (const h of un) console.log(`  - ${h.name}(${h.code}) 보유수량 ${h.qty} / 평단 ${fmtWon(h.avgPrice)}`);
  }

  writeOutputJson({ todayDate, baseline: blResults, urgent: urgentRows, all, unassigned: un });
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
