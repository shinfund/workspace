// 4전략(눌림목+괴리율+라운드넘버+장대양봉) 통합 5슬롯 포트폴리오 — "오늘" 진입신호 스캔
// 기준선(EMA200 파동) 전략은 [[project_trading_plan_3strategy_portfolio]] 결정에 따라 운용에서 제외됨.
// 장대양봉(2026-09-01 4번째 확정전략 편입, [[project_bigcandle_strategy]])은 project_bigcandle_pullback_reconfirm_backtest.mjs
// 확정 로직(몸통5%+되돌림20일+재돌파확인5일+STOP0.5%+최대15일+상승국면필터)을 그대로 복제.
// 각 전략의 정식 스크립트(project_stock_pullback.mjs / project_deviation_tp20_exit_backtest.mjs /
// project_roundnumber_strategy_backtest.mjs)의 진입조건을 그대로 복제해 "오늘(마지막 봉)" 기준으로만 판정한다.
// 노션 보유종목DB(9f666aeb-832a-4aa2-9e52-e37515b75e56)에서 현재 보유종목수를 읽어 빈슬롯을 계산하고,
// 빈슬롯 개수만큼 우선순위(눌림목>괴리율>라운드넘버, project_trading_plan_3strategy_portfolio 메모 기준)로 추천한다.
// 같은 날 같은 전략 내 후보가 3건을 넘으면 신호강도 기준 1~3순위만 채택(project_3strategy_combined_portfolio_backtest.mjs와
// 동일 기준, 2026-08-26 눌림목·괴리율까지 확장): 눌림목=추세강도desc·눌림폭(ATR정규화)asc, 괴리율=EMA5·20 Z합asc·백분위합asc,
// 라운드넘버=밀집도(touchCount)desc·지지일수(aboveCount)desc.
// 베타 우선순위(2026-08-27, [[project_stock_factor_score_backtest]]): 위 캡을 통과한 전체 후보가 오늘 빈슬롯보다
// 많을 때만 전략우선순위(눌림목>괴리율>라운드넘버) 대신 베타(KOSPI상관) 높은 종목부터 추천 — 유니버스 축소판은
// 헤드라인 하락(+1814.72%→+1445.49%)으로 기각, 이 방식(유니버스 유지)은 헤드라인 개선(+1814.72%→+2200.44%) 확인.
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

const KOSPI_SIZE = 50;
// 코스피 TOP50 (project_pullback_recent_signals.mjs / project_deviation_recent_signals.mjs /
// project_roundnumber_strategy_backtest.mjs와 100% 동일한 폴백 유니버스 — 세 스크립트 실파일 대조 확인 완료)
// 2026-08-26: 눌림목·괴리율도 라운드넘버와 동일하게 코스피 전용으로 전환 — 코스닥 유니버스(FALLBACK_KOSDAQ)
// 완전 제외(3전략 통합 월별 집계표 분석 결과 코스닥이 코스피보다 불안정하다고 판단, 사용자 확정).
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
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
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
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
      let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.write(data); req.end();
  });
}
async function refetchHeldRow(pageId) {
  try {
    const page = await new Promise((res, rej) => {
      https.get(`https://api.notion.com/v1/pages/${pageId}`, { headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } }, r => {
        let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
      }).on('error', rej);
    });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      strategy: page?.properties?.['전략']?.select?.name || null,
    };
  } catch { return null; }
}
// 2026-08-26 버그 수정: Notion API의 page_size 최대치는 100(요청값 200은 조용히 100으로 잘림)이라
// has_more를 무시하고 단건 조회하면 "오늘 날짜" 보유종목 중 일부가 응답 순서에 따라 간헐적으로
// 누락됨(project_portfolio3_exit_check.mjs에서 HD현대중공업 실사례로 먼저 발견) — start_cursor로 끝까지 순회한다.
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
async function fetchHeldCodes() {
  // 빈슬롯은 3전략(눌림목/괴리율/라운드넘버) 5슬롯 공유자본 기준 — 매도완료(보유수량 0)나 기준선 전략(축소·배제 대상) 보유분은 슬롯 점유로 세지 않는다.
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음 — 빈슬롯 계산 불가, 5슬롯 전부 빈 것으로 가정'); return new Set(); }
  const results = await queryAllNotion(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 100 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!results.length) return new Set();
  const data = { results };
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate);
  const codes = [];
  for (const p of rows) {
    let code = (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim();
    let qty = Number(p.properties['보유수량']?.number || 0);
    let strategy = p.properties['전략']?.select?.name || null;
    // 2026-08-26 추가: select("전략") 필드가 간헐적으로 null을 반환하는 현상 보정(같은 페이지 재조회하면
    // 정상값 — title lag와 동일 계열). null이면 기준선 여부를 오판해 빈슬롯 계산이 틀어질 수 있어 재조회.
    for (let attempt = 0; attempt < 3 && (!code || !strategy); attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 400));
      const refetched = await refetchHeldRow(p.id);
      if (refetched) { code = code || refetched.code; qty = qty || refetched.qty; strategy = strategy || refetched.strategy; }
    }
    if (code && qty > 0 && strategy !== '기준선') codes.push(code);
  }
  return new Set(codes);
}

// ── 눌림목: 시장국면 ──
const KOSPI_SYMBOL = '^KS11', KOSDAQ_SYMBOL = '^KQ11'; // fetchYahooChart가 encodeURIComponent 처리하므로 여기선 미인코딩 원문 사용
const PB_MA_SHORT = 50, PB_MA_LONG = 100, PB_SLOPE_LOOKBACK = 10, PB_BREAKOUT_LOOKBACK = 6;
const PB_ATR_PERIOD = 14, PB_BAND_K = 0.4;
const PB_SL = 8, PB_TRAIL = 8;
const PB_REGIME_STREAK_MIN = 10, PB_KOSPI_ATR_PERIOD = 14, PB_VOL_CAP = 4, PB_STOCK_ATR_CAP = 6;
const PB_TP_PCT = 20, PB_TP_FRAC = 0.4, PB_MAX_HOLD = 40, PB_COOLDOWN_DAYS = 5; // v15(2026-08-26): TP%·TP비율 청산 그리드서치 재확정(perDay 기준, v13은 재진입쿨다운)
// v14(2026-08-26): 코스닥 종목을 유니버스에서 완전 제외 — 코스닥 전용 SL18/TRAIL18(v11) 분기 제거
function pbSlFor() { return PB_SL; }
function pbTrailFor() { return PB_TRAIL; }
function pbSimulate(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose; let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d; if (j >= seq.length) return null;
    const close = seq[j].close, maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;
    if (!tpTaken && ret >= tpPct) { tpTaken = true; tpReturn = ret; if (close > peak) peak = close; continue; }
    const finish = (reason) => ({ reason, day: d, ret: tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret, date: seq[j].date });
    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}
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
  const marketRegime = regimeByMarket.KOSPI; // v14: 코스피 전용 유니버스로 전환
  const otherRegime = regimeByMarket.KOSDAQ; // v12: 반대쪽 지수(코스닥) 병행확인용 — 종목이 아닌 시장 breadth 신호라 계속 유지
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 1100 * 24 * 3600;
  const symbol = `${stock.code}.KS`;
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

  // v13: 오늘 이전 구간을 재생하며 손절후 재진입쿨다운 상태를 계산(동일종목 휩소 재진입 배제)
  const sl = pbSlFor(stock.market), trail = pbTrailFor(stock.market);
  let blockedUntilIdx = -1;
  for (let k = PB_MA_LONG + PB_SLOPE_LOOKBACK; k < lastIdx; k++) {
    const sk = seq[k], priorK = seq[k - PB_SLOPE_LOOKBACK];
    const trendUpK = sk.close > sk.maLong && sk.maShort > sk.maLong && sk.maLong > priorK.maLong;
    if (!trendUpK || marketRegime.regime[sk.date] !== true || otherRegime.regime[sk.date] !== true) continue;
    if ((marketRegime.streak[sk.date] ?? 0) < PB_REGIME_STREAK_MIN) continue;
    const volK = marketRegime.volPct[sk.date];
    if (volK == null || volK > PB_VOL_CAP) continue;
    if (k < PB_MA_SHORT || sk.atrPct == null || sk.atrPct <= 0 || sk.atrPct > PB_STOCK_ATR_CAP) continue;
    let highK = -Infinity, highKIdx = -1;
    for (let m = k - (PB_MA_SHORT - 1); m <= k - 1; m++) if (seq[m].close > highK) { highK = seq[m].close; highKIdx = m; }
    if (!(highKIdx >= k - PB_BREAKOUT_LOOKBACK) || sk.close > highK || sk.close <= sk.maShort) continue;
    if (((highK - sk.close) / highK * 100) / sk.atrPct > PB_BAND_K) continue; // 2026-08-27 버그수정: *100 누락으로 눌림폭 필터 사실상 무력화됐던 것 정정
    if (k <= blockedUntilIdx) continue;
    const trade = pbSimulate(seq, k, sk.close, sl, trail, PB_MAX_HOLD, PB_TP_PCT, PB_TP_FRAC);
    if (trade && trade.reason === 'SL') blockedUntilIdx = k + trade.day + PB_COOLDOWN_DAYS;
  }

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
  if (i <= blockedUntilIdx) return null; // v13: 손절후 재진입쿨다운 중
  const trendStrength = (s.maLong - prior.maLong) / prior.maLong * 100;
  return { code: stock.code, name: stock.name, market: stock.market, price: s.close, trendStrength, pullbackNorm: normDepth, reason: `50일신고가(${Math.round(highS).toLocaleString()}) 대비 -${pullbackPct.toFixed(1)}% 눌림, EMA50/100 정배열` };
}

// ── 괴리율: 오늘 진입신호 판정 ──
const DV_ROLL = 250, DV_Z = -2, DV_PCT = 3, DV_FAST = 5, DV_SLOW = 20, DV_MID = 50, DV_LONG = 200;
const DV_SL = 18, DV_TP = 20, DV_MAXHOLD = 20; // v15(2026-08-26): project_deviation_tp20_exit_backtest.mjs 확정값과 동일(SL18/TP20/최대보유20일, 3단계 부분매도)
async function checkDeviationEntry(stock, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 1100 * 24 * 3600;
  const symbol = `${stock.code}.KS`; // v14: 코스피 전용 유니버스로 전환
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
const RN_WINDOW = 150, RN_TICKS = 30, RN_LOOKBACK = 20, RN_PRIOR = 5, RN_TOUCHES = 3, RN_RECLAIM = 5, RN_STOPBUF = 3, RN_MINPOS = 20, RN_MINBAND = 2.5, RN_MAXHOLD = 60; // stopBufferPct v15(2026-08-26): 2→3 재확정(기존 미사용 상수 정정)
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

// ── 장대양봉: 오늘 진입신호 판정(2026-09-01 4번째 확정전략 편입) ──
// 몸통5%↑ 장대양봉 → 되돌림20일 내 중간값 저가터치 → 터치일고가 재돌파확인5일창(종가기준) → 상승국면필터(EMA200)
const BC_BODY_PCT = 5, BC_BODY_PCT_MAX = 25, BC_RETEST_WINDOW = 20, BC_CONFIRM_WINDOW = 5, BC_STOP_BUFFER_PCT = 0.5, BC_MAX_HOLD = 15, BC_EMA_PERIOD = 200;
async function checkBigcandleEntry(stock, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 2555 * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low), opens = fillForward(chart.open);
  const ema200s = buildEma(closes, BC_EMA_PERIOD);
  const n = dates.length;
  const lastIdx = n - 1;
  if (lastIdx < BC_EMA_PERIOD + BC_RETEST_WINDOW + BC_CONFIRM_WINDOW) return null;
  if (dates[lastIdx] === todayDate && kisMap?.has(stock.code)) closes[lastIdx] = kisMap.get(stock.code);

  // 오늘(lastIdx)이 confirmIdx(재돌파확인 성립일)인 원본 장대양봉 이벤트를 역탐색
  const searchFrom = Math.max(0, lastIdx - (BC_RETEST_WINDOW + BC_CONFIRM_WINDOW + 5));
  for (let i = searchFrom; i < lastIdx; i++) {
    const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < BC_BODY_PCT) continue;
    if (bodyPct > BC_BODY_PCT_MAX) continue; // 2026-09-02 상한캡: 투기적 초급등봉(꼬리위험) 배제
    const mid = (o + c) / 2, candleLow = l, candleHigh = h;

    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + BC_RETEST_WINDOW); f++) {
      if (closes[f] < candleLow) break;
      if (lows[f] <= mid) { touchIdx = f; break; }
    }
    if (touchIdx == null || touchIdx > lastIdx) continue;

    const touchHigh = highs[touchIdx];
    if (touchHigh >= candleHigh) continue; // 2026-09-01 결함수정: 터치일 고가가 이미 TP목표를 넘으면 무효셋업
    let confirmIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + BC_CONFIRM_WINDOW + 1); c2++) {
      if (closes[c2] < candleLow) break;
      if (closes[c2] > touchHigh) { confirmIdx = c2; break; }
    }
    if (confirmIdx !== lastIdx) continue; // 오늘 확정된 신호만 채택
    if (closes[lastIdx] >= candleHigh) continue; // 2026-09-02 결함수정: 진입가가 이미 TP가 초과인 무효셋업 배제

    const e200 = ema200s[lastIdx];
    if (e200 == null || closes[lastIdx] < e200) continue;
    const stop = candleLow * (1 - BC_STOP_BUFFER_PCT / 100);
    return { code: stock.code, name: stock.name, market: stock.market, price: closes[lastIdx], bodyPct, candleHigh, candleLow, stop, candleDate: dates[i], touchDate: dates[touchIdx], reason: `${dates[i]} 장대양봉(몸통+${bodyPct.toFixed(1)}%) 중간값눌림 후 오늘 캔들고가(${Math.round(touchHigh).toLocaleString()}) 재돌파, TP ${Math.round(candleHigh).toLocaleString()}/STOP ${Math.round(stop).toLocaleString()}` };
  }
  return null;
}
async function backtestBigcandleStock(stock) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 2555 * 24 * 3600;
  const chart = await fetchYahooChart(`${stock.code}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low), opens = fillForward(chart.open);
  const ema200s = buildEma(closes, BC_EMA_PERIOD);
  const n = dates.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < BC_BODY_PCT) continue;
    if (bodyPct > BC_BODY_PCT_MAX) continue; // 2026-09-02 상한캡: 투기적 초급등봉(꼬리위험) 배제
    const mid = (o + c) / 2, candleLow = l, candleHigh = h;
    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + BC_RETEST_WINDOW); f++) {
      if (closes[f] < candleLow) break;
      if (lows[f] <= mid) { touchIdx = f; break; }
    }
    if (touchIdx == null) continue;
    const touchHigh = highs[touchIdx];
    if (touchHigh >= candleHigh) continue; // 2026-09-01 결함수정
    let confirmIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + BC_CONFIRM_WINDOW + 1); c2++) {
      if (closes[c2] < candleLow) break;
      if (closes[c2] > touchHigh) { confirmIdx = c2; break; }
    }
    if (confirmIdx == null) continue;
    if (closes[confirmIdx] >= candleHigh) continue; // 2026-09-02 결함수정: 진입가가 이미 TP가 초과인 무효셋업 배제
    const e200 = ema200s[confirmIdx];
    if (e200 == null || closes[confirmIdx] < e200) continue;
    const stop = candleLow * (1 - BC_STOP_BUFFER_PCT / 100);
    const entryPrice = closes[confirmIdx];
    for (let d = 1; d <= BC_MAX_HOLD; d++) {
      const j = confirmIdx + d;
      if (j >= n) break; // 미확정 표본 제외
      const close = closes[j];
      if (close <= stop) { trades.push({ date: dates[confirmIdx], reason: 'STOP', ret: (close - entryPrice) / entryPrice * 100 }); break; }
      if (close >= candleHigh) { trades.push({ date: dates[confirmIdx], reason: 'TP', ret: (close - entryPrice) / entryPrice * 100 }); break; }
      if (d === BC_MAX_HOLD) { trades.push({ date: dates[confirmIdx], reason: 'TIME', ret: (close - entryPrice) / entryPrice * 100 }); break; }
    }
  }
  return summarizeBtTrades(trades);
}

// ── 추천 후보 전용: 개별종목 과거 매매성과 백테스트(2026-08-27 추가) ──
// 전체 유니버스가 아닌 "오늘 추천된 소수 후보"에 대해서만 각 전략의 확정 파라미터로 전체기간 재현,
// 진입신호체크 결과에 승률·평균수익률·최근 트레이드 이력을 덧붙여 매수 판단 근거를 함께 보여준다.
function summarizeBtTrades(trades) {
  if (!trades.length) return null;
  const n = trades.length;
  const winRate = trades.filter(t => t.ret > 0).length / n * 100;
  const avgRet = trades.reduce((a, t) => a + t.ret, 0) / n;
  const recent = trades.slice(-3).reverse();
  return { n, winRate, avgRet, recent };
}
async function backtestPullbackStock(stock, regimeByMarket) {
  const marketRegime = regimeByMarket.KOSPI, otherRegime = regimeByMarket.KOSDAQ;
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 1100 * 24 * 3600; // project_stock_pullback.mjs 기본 calendarDays=1100과 동일(정식 스크립트 기준)
  const chart = await fetchYahooChart(`${stock.code}.KS`, p1, p2);
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
  const sl = pbSlFor(), trail = pbTrailFor();
  const trades = [];
  let blockedUntilIdx = -1;
  for (let k = PB_MA_LONG + PB_SLOPE_LOOKBACK; k < seq.length - 1; k++) {
    const sk = seq[k], priorK = seq[k - PB_SLOPE_LOOKBACK];
    const trendUpK = sk.close > sk.maLong && sk.maShort > sk.maLong && sk.maLong > priorK.maLong;
    if (!trendUpK || marketRegime.regime[sk.date] !== true || otherRegime.regime[sk.date] !== true) continue;
    if ((marketRegime.streak[sk.date] ?? 0) < PB_REGIME_STREAK_MIN) continue;
    const volK = marketRegime.volPct[sk.date];
    if (volK == null || volK > PB_VOL_CAP) continue;
    if (k < PB_MA_SHORT || sk.atrPct == null || sk.atrPct <= 0 || sk.atrPct > PB_STOCK_ATR_CAP) continue;
    let highK = -Infinity, highKIdx = -1;
    for (let m = k - (PB_MA_SHORT - 1); m <= k - 1; m++) if (seq[m].close > highK) { highK = seq[m].close; highKIdx = m; }
    if (!(highKIdx >= k - PB_BREAKOUT_LOOKBACK) || sk.close > highK || sk.close <= sk.maShort) continue;
    if (((highK - sk.close) / highK * 100) / sk.atrPct > PB_BAND_K) continue;
    if (k <= blockedUntilIdx) continue;
    const trade = pbSimulate(seq, k, sk.close, sl, trail, PB_MAX_HOLD, PB_TP_PCT, PB_TP_FRAC);
    if (!trade) continue; // 미확정(최근 진입, 아직 청산 안됨)은 표본 제외
    trades.push({ date: sk.date, reason: trade.reason, ret: trade.ret });
    if (trade.reason === 'SL') blockedUntilIdx = k + trade.day + PB_COOLDOWN_DAYS;
  }
  return summarizeBtTrades(trades);
}
async function backtestDeviationStock(stock) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 2555 * 24 * 3600;
  const chart = await fetchYahooChart(`${stock.code}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, DV_FAST), ema20s = buildEma(closes, DV_SLOW), ema50s = buildEma(closes, DV_MID), ema200s = buildEma(closes, DV_LONG);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema200: ema200s[i], dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100 });
  }
  if (seq.length < DV_ROLL + DV_MAXHOLD + 1) return null;
  const flags = new Array(seq.length).fill(false);
  for (let i = DV_ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5', DV_ROLL), z20 = rollingZPct(seq, i, 'dev20', DV_ROLL);
    const sig5 = z5.z <= DV_Z && z5.pct <= DV_PCT, sig20 = z20.z <= DV_Z && z20.pct <= DV_PCT;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    flags[i] = sig5 && sig20 && downTrend;
  }
  const trades = [];
  for (let i = DV_ROLL - 1; i < seq.length; i++) {
    if (!(flags[i] && !flags[i - 1])) continue;
    // 3단계 부분매도(SL18/TP20/EMA20 2차매도/EMA5 이탈 전량청산/시간청산20일) — project_deviation_tp20_exit_backtest.mjs와 동일
    const entryClose = seq[i].close;
    let openWeight = 1.0, stage = 'INIT', tpTaken = false;
    const legs = [];
    for (let d = 1; d <= DV_MAXHOLD; d++) {
      const j = i + d;
      if (j >= seq.length) { legs.length = 0; break; } // 미확정 표본 제외
      const close = seq[j].close, ema20 = seq[j].ema20, ema5 = seq[j].ema5;
      const ret = (close - entryClose) / entryClose * 100;
      if (ret <= -DV_SL) { legs.push({ weight: openWeight, ret }); openWeight = 0; break; }
      if (stage === 'INIT' && ret >= DV_TP) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; tpTaken = true; stage = 'TP20_DONE'; }
      if (stage === 'TP20_DONE' && close >= ema20) { const w = openWeight * 0.5; legs.push({ weight: w, ret }); openWeight -= w; stage = 'HOLD'; }
      if (stage === 'HOLD' && close < ema5) { legs.push({ weight: openWeight, ret }); openWeight = 0; break; }
      if (d === DV_MAXHOLD && openWeight > 1e-9) { legs.push({ weight: openWeight, ret }); openWeight = 0; }
    }
    if (!legs.length || openWeight > 1e-9) continue;
    const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
    trades.push({ date: seq[i].date, reason: tpTaken ? 'TP경유청산' : (weightedRet <= -DV_SL + 0.01 ? 'SL' : '청산'), ret: weightedRet });
  }
  return summarizeBtTrades(trades);
}
async function backtestRoundnumberStock(stock) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 2555 * 24 * 3600;
  const chart = await fetchYahooChart(`${stock.code}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const closes = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    closes.push(chart.close[i]); highs.push(chart.high[i] ?? chart.close[i]); lows.push(chart.low[i] ?? chart.close[i]);
  }
  const seq = closes.map((c, i) => ({ date: dates[i], close: c }));
  const n = seq.length;
  const trades = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
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
    for (let f = i; f < Math.min(n, i + RN_RECLAIM); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= RN_MINPOS) {
            const target = L + step, stop = L * (1 - RN_STOPBUF / 100);
            for (let d = 1; d <= RN_MAXHOLD; d++) {
              const j = f + d;
              if (j >= n) break; // 미확정 표본 제외
              const close = seq[j].close;
              if (close <= stop) { trades.push({ date: seq[f].date, reason: 'STOP', ret: (close - seq[f].close) / seq[f].close * 100 }); break; }
              if (close >= target) { trades.push({ date: seq[f].date, reason: 'TP', ret: (close - seq[f].close) / seq[f].close * 100 }); break; }
              if (d === RN_MAXHOLD) { trades.push({ date: seq[f].date, reason: 'TIME', ret: (close - seq[f].close) / seq[f].close * 100 }); break; }
            }
          }
        }
        break;
      }
    }
  }
  return summarizeBtTrades(trades);
}
async function backtestCandidate(r, regimeByMarket) {
  const stock = { code: r.code, name: r.name };
  const bt = r.strategy === '눌림목' ? await backtestPullbackStock(stock, regimeByMarket)
    : r.strategy === '괴리율' ? await backtestDeviationStock(stock)
    : r.strategy === '라운드넘버' ? await backtestRoundnumberStock(stock)
    : await backtestBigcandleStock(stock);
  return { ...r, bt };
}
function judgeBt(bt) {
  if (!bt || bt.n < 3) return '표본 부족(참고용)';
  if (bt.winRate >= 55 && bt.avgRet > 0) return '우호적(승률·평균수익률 양호)';
  if (bt.avgRet <= 0) return '주의(평균수익률 마이너스)';
  return '중립';
}

// ── 베타 우선순위(2026-08-27, [[project_stock_factor_score_backtest]]): 오늘 빈슬롯보다 후보가 많을 때만
// 전략우선순위 대신 베타(KOSPI상관) 높은 종목부터 슬롯 배정. project_3strategy_combined_portfolio_backtest.mjs
// --beta-priority(기본ON)와 동일 로직 — 유니버스 축소판(--beta-filter)은 헤드라인 하락으로 기각됐음.
function computeBetaVsSeries(closes, dates, kospiRetByDate) {
  const rets = [], kospiRets = [];
  for (let i = 1; i < dates.length; i++) {
    if (closes[i] == null || closes[i - 1] == null) continue;
    const kr = kospiRetByDate.get(dates[i]); if (kr == null) continue;
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100); kospiRets.push(kr);
  }
  if (rets.length < 30) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const mR = mean(rets), mK = mean(kospiRets);
  let cov = 0, varK = 0;
  for (let i = 0; i < rets.length; i++) { cov += (rets[i] - mR) * (kospiRets[i] - mK); varK += (kospiRets[i] - mK) ** 2; }
  return varK ? cov / varK : null;
}
async function fetchBetaMap(codes, p1, p2) {
  const kospiChart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  if (!kospiChart || !kospiChart.ts.length) return new Map();
  const kDates = kospiChart.ts.map(tsToKstDate), kCloses = fillForward(kospiChart.close);
  const kospiRetByDate = new Map();
  for (let i = 1; i < kDates.length; i++) if (kCloses[i] != null && kCloses[i - 1] != null) kospiRetByDate.set(kDates[i], (kCloses[i] - kCloses[i - 1]) / kCloses[i - 1] * 100);
  const map = new Map();
  await batchAll(codes, async (code) => {
    const chart = await fetchYahooChart(`${code}.KS`, p1, p2);
    if (!chart || !chart.ts.length) return;
    const dates = chart.ts.map(tsToKstDate), closes = fillForward(chart.close);
    const b = computeBetaVsSeries(closes, dates, kospiRetByDate);
    if (b != null) map.set(code, b);
  });
  return map;
}

async function main() {
  console.error('[4전략 진입신호 체크] 시작');
  const heldCodes = await fetchHeldCodes();
  const openSlots = Math.max(0, MAX_SLOTS - heldCodes.size);
  console.error(`[슬롯] 보유 ${heldCodes.size}종목 / 5슬롯 → 빈슬롯 ${openSlots}개`);

  const kospiUniverse = await buildKospiUniverse();
  const pdUniverse = kospiUniverse.filter(s => !heldCodes.has(s.code));
  const rnUniverse = kospiUniverse.filter(s => !heldCodes.has(s.code));

  const todayDate = kstTodayDate();
  const allCodes = [...new Set(kospiUniverse.map(s => s.code))];
  const kisMap = await fetchKisPriceMap(allCodes);

  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 1100 * 24 * 3600;
  console.error('[눌림목] 시장국면(KOSPI/KOSDAQ) 조회...');
  const [regimeKospi, regimeKosdaq] = await Promise.all([fetchMarketRegime(p1, p2, KOSPI_SYMBOL), fetchMarketRegime(p1, p2, KOSDAQ_SYMBOL)]);
  const regimeByMarket = { KOSPI: regimeKospi, KOSDAQ: regimeKosdaq };

  console.error(`[스캔] 눌림목·괴리율·장대양봉 ${pdUniverse.length}종목, 라운드넘버 ${rnUniverse.length}종목 진입조건 확인 중...`);
  const pbRaw = (await batchAll(pdUniverse, s => checkPullbackEntry(s, regimeByMarket, kisMap, todayDate))).filter(Boolean);
  const dvRaw = (await batchAll(pdUniverse, s => checkDeviationEntry(s, kisMap, todayDate))).filter(Boolean);
  const rnRaw = (await batchAll(rnUniverse, s => checkRoundnumberEntry(s, kisMap, todayDate))).filter(Boolean);
  const bcRaw = (await batchAll(pdUniverse, s => checkBigcandleEntry(s, kisMap, todayDate))).filter(Boolean);

  // 같은 날 같은 전략 내 후보 1~3순위 캡(project_3strategy_combined_portfolio_backtest.mjs와 동일 기준)
  const SAME_DAY_CAP = 3;
  pbRaw.sort((a, b) => (b.trendStrength - a.trendStrength) || (a.pullbackNorm - b.pullbackNorm));
  const dvSorted = [...dvRaw].sort((a, b) => (a.zSum - b.zSum) || (a.pctSum - b.pctSum));
  rnRaw.sort((a, b) => (b.touchCount - a.touchCount) || (b.aboveCount - a.aboveCount));
  bcRaw.sort((a, b) => b.bodyPct - a.bodyPct); // 장대양봉: 몸통크기 큰 순(더 강한 캔들 우선, project_4strategy_combined_portfolio_backtest.mjs와 동일 기준)
  const pbCapExcess = Math.max(0, pbRaw.length - SAME_DAY_CAP);
  const dvCapExcess = Math.max(0, dvSorted.length - SAME_DAY_CAP);
  const rnCapExcess = Math.max(0, rnRaw.length - SAME_DAY_CAP);
  const bcCapExcess = Math.max(0, bcRaw.length - SAME_DAY_CAP);
  const pbResults = pbRaw.slice(0, SAME_DAY_CAP);
  const dvResults = dvSorted.slice(0, SAME_DAY_CAP);
  const rnResults = rnRaw.slice(0, SAME_DAY_CAP);
  const bcResults = bcRaw.slice(0, SAME_DAY_CAP);
  if (pbCapExcess || dvCapExcess || rnCapExcess || bcCapExcess) {
    console.error(`[동시신호 캡] 눌림목 ${pbCapExcess}건·괴리율 ${dvCapExcess}건·라운드넘버 ${rnCapExcess}건·장대양봉 ${bcCapExcess}건이 1~3순위 밖으로 제외됨`);
  }

  const combined = [
    ...pbResults.map(r => ({ ...r, strategy: '눌림목' })),
    ...dvResults.map(r => ({ ...r, strategy: '괴리율' })),
    ...rnResults.map(r => ({ ...r, strategy: '라운드넘버' })),
    ...bcResults.map(r => ({ ...r, strategy: '장대양봉' })),
  ];

  let betaReordered = false;
  if (combined.length > openSlots && openSlots > 0) {
    console.error('[베타 우선순위] 후보가 빈슬롯보다 많아 베타(KOSPI상관) 조회 중...');
    const betaMap = await fetchBetaMap(combined.map(r => r.code), p1, p2);
    combined.sort((a, b) => (betaMap.get(b.code) ?? -Infinity) - (betaMap.get(a.code) ?? -Infinity));
    betaReordered = true;
  }

  console.log(`\n━━━ 4전략 진입신호 체크 (${todayDate} 기준) ━━━`);
  if (openSlots === 0) console.log('⚠ 빈슬롯 없음 — 신규 진입 보류(아래는 참고용 전체 후보)');
  else if (betaReordered) console.log(`빈슬롯 ${openSlots}개 — 후보(${combined.length}건)가 슬롯보다 많아 전략우선순위 대신 베타(KOSPI상관) 상위 ${openSlots}개 추천`);
  else console.log(`빈슬롯 ${openSlots}개 — 아래 우선순위(눌림목>괴리율>라운드넘버>장대양봉) 상위 ${openSlots}개 추천`);

  if (!combined.length) {
    console.log('\n오늘 발생한 진입신호 없음.');
  } else {
    console.log(`\n[추천 ${Math.min(openSlots, combined.length)}건]`);
    const finalists = combined.slice(0, openSlots);
    finalists.forEach((r, i) => console.log(`${i + 1}. [${r.strategy}] ${r.name}(${r.code}) ${Math.round(r.price).toLocaleString()}원 — ${r.reason}`));

    if (finalists.length) {
      console.error('[백테스트] 추천 후보 과거 매매성과 조회 중...');
      const withBt = await Promise.all(finalists.map(r => backtestCandidate(r, regimeByMarket)));
      console.log(`\n[추천 후보 과거 매매성과]`);
      withBt.forEach((r, i) => {
        if (!r.bt) { console.log(`${i + 1}. ${r.name}: 과거 신호 없음/데이터 부족`); return; }
        const { n, winRate, avgRet, recent } = r.bt;
        console.log(`${i + 1}. ${r.name}: n=${n}  평균 ${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%  승률${winRate.toFixed(0)}%  → 판단: ${judgeBt(r.bt)}`);
        console.log(`   최근: ${recent.map(t => `${t.date} ${t.reason} ${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(2)}%`).join(', ')}`);
      });
    }

    console.log(`\n[전체 후보 ${combined.length}건]`);
    for (const strat of ['눌림목', '괴리율', '라운드넘버', '장대양봉']) {
      const rows = combined.filter(r => r.strategy === strat);
      if (!rows.length) continue;
      console.log(`\n· ${strat} (${rows.length}건)`);
      rows.forEach(r => console.log(`  - ${r.name}(${r.code}) ${Math.round(r.price).toLocaleString()}원 — ${r.reason}`));
    }
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
