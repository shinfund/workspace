/**
 * holdings_report.mjs — 보유종목 포트폴리오 분석 리포트
 *
 * 데이터 소스:
 *   KIS API       → 당일 현재가 실시간 (실패 시 Yahoo 폴백)
 *   KRX API       → 과거 확정 종가 for MA20 (조회 실패 시 Yahoo 폴백)
 *   Yahoo Finance → KRX 미제공(최근 5일) 자동 보완
 *
 * 입력:  data/holdings.json
 *   [{ "종목코드":"005930", "종목명":"삼성전자", "시장":"KOSPI", "보유수량":100, "평균단가":58000 }, ...]
 *
 * 출력:  data/analysis/보유종목분석_YYYYMMDDHHmm.html
 */

import https from 'https';
import fs    from 'fs';

const API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST     = 'apis.data.go.kr';
const PATH     = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;
const DELAY_MS = 300;

const KIS_APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const KIS_APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const KIS_TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname, port: 443, path: opts.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}

async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 환경변수 없음'); return null; }
  try {
    const data = await httpPostJson(
      `https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`,
      { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 },
      { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
    );
    if (!data?.results?.length) { console.error('[Notion] 결과 없음'); return null; }
    const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
    if (!allDates.length) { console.error('[Notion] 날짜 필드 없음'); return null; }
    const latestDate = allDates[allDates.length - 1];
    const prevDate   = allDates.length >= 2 ? allDates[allDates.length - 2] : null;
    console.error(`[Notion] 보유종목DB 기준일: ${latestDate}${prevDate ? ` (전일: ${prevDate})` : ''}`);
    const parseRows = date => data.results
      .filter(p => p.properties['날짜']?.date?.start === date)
      .map(p => ({
        종목코드: (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
        종목명:   (p.properties['종목명']?.title?.[0]?.plain_text || '').trim(),
        보유수량:  Number(p.properties['보유수량']?.number || 0),
        평균단가:  Number(p.properties['매 입 가']?.number || 0),
        시장:     'KOSPI',
      }))
      .filter(h => h.종목코드 && h.보유수량 > 0 && h.평균단가 > 0);
    return { holdings: parseRows(latestDate), prevHoldings: prevDate ? parseRows(prevDate) : [], latestDate, prevDate };
  } catch(e) {
    console.error(`[Notion] 조회 실패: ${e.message}`); return null;
  }
}

function computeDiff(today, prev) {
  if (!prev || !prev.length) return null;
  const todayMap = new Map(today.map(h => [h.종목코드, h]));
  const prevMap  = new Map(prev.map(h => [h.종목코드, h]));
  const added    = today.filter(h => !prevMap.has(h.종목코드));
  const removed  = prev.filter(h => !todayMap.has(h.종목코드));
  const changed  = today
    .filter(h => {
      const p = prevMap.get(h.종목코드);
      if (!p) return false;
      return h.보유수량 !== p.보유수량 || Math.abs(h.평균단가 - p.평균단가) >= 1;
    })
    .map(h => {
      const p = prevMap.get(h.종목코드);
      return { ...h, prev수량: p.보유수량, prev단가: p.평균단가,
               수량변화: h.보유수량 - p.보유수량, 단가변화: h.평균단가 - p.평균단가 };
    });
  return { added, removed, changed };
}

function kstToday() {
  const d = new Date(Date.now() + 9*3600*1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function addDays(yyyymmdd, n) {
  const d = new Date(`${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function calDiff(a, b) {
  const da = new Date(`${a.slice(0,4)}-${a.slice(4,6)}-${a.slice(6,8)}`);
  const db = new Date(`${b.slice(0,4)}-${b.slice(4,6)}-${b.slice(6,8)}`);
  return Math.abs(Math.round((db - da) / 86400000));
}

function weekdayRange(startStr, endStr) {
  const dates = [];
  const cur = new Date(`${startStr.slice(0,4)}-${startStr.slice(4,6)}-${startStr.slice(6,8)}`);
  const end = new Date(`${endStr.slice(0,4)}-${endStr.slice(4,6)}-${endStr.slice(6,8)}`);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6)
      dates.push(`${cur.getFullYear()}${String(cur.getMonth()+1).padStart(2,'0')}${String(cur.getDate()).padStart(2,'0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function fmtDate(s) { return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtMD(s)   { return `${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtNum(n)  { return n != null ? Number(n).toLocaleString('ko-KR') : '─'; }

// ─── KRX API ─────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(JSON.parse(d)); }
        catch(e) { rej(new Error(`파싱실패: ${d.slice(0,200)}`)); }
      });
    }).on('error', rej);
  });
}

async function fetchDate(basDt) {
  const first = await get(
    `https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`
  );
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  if (total === 0) return null;

  let items = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];

  for (let p = 2; p <= Math.ceil(total / NUM_ROWS); p++) {
    await sleep(100);
    const r = await get(
      `https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`
    );
    const more = r?.response?.body?.items?.item || [];
    items = items.concat(Array.isArray(more) ? more : [more]);
  }
  return items;
}

// ─── KIS API ─────────────────────────────────────────────────────────────────
async function getKisToken() {
  try {
    const c = JSON.parse(fs.readFileSync(KIS_TOKEN_CACHE, 'utf8'));
    if (new Date(c.access_token_token_expired) > new Date(Date.now() + 60000)) return c.access_token;
  } catch { /* cache miss */ }
  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const res = JSON.parse(d);
          if (!res.access_token) return reject(new Error('KIS 토큰 실패'));
          fs.writeFileSync(KIS_TOKEN_CACHE, JSON.stringify(res));
          resolve(res.access_token);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function fetchKisPrice(token, code) {
  const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  return new Promise(resolve => {
    const req = https.request({
      hostname: KIS_HOST, port: KIS_PORT,
      path: `/uapi/domestic-stock/v1/quotations/inquire-price?${qs}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json', authorization: `Bearer ${token}`,
        appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET, tr_id: 'FHKST01010100', custtype: 'P',
      },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.rt_cd !== '0') return resolve(null);
          const o = j.output;
          resolve({ 현재가: Number(o.stck_prpr || 0), 고가: Number(o.stck_hgpr || 0), 저가: Number(o.stck_lwpr || 0) });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function fetchKisDate(stockList) {
  let token;
  try { token = await getKisToken(); } catch(e) {
    console.error(`[KIS] 토큰 실패: ${e.message}`); return new Map();
  }
  const resultMap = new Map();
  const BATCH = 5, DELAY_KIS = 200;
  for (let i = 0; i < stockList.length; i += BATCH) {
    const batch = stockList.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(s => fetchKisPrice(token, s.code)));
    batch.forEach((s, j) => {
      const d = res[j];
      if (d && d.현재가 > 0)
        resultMap.set(s.code, { 종목코드: s.code, 종가: d.현재가, 고가: d.고가 || d.현재가, 저가: d.저가 || d.현재가 });
    });
    if (i + BATCH < stockList.length) await new Promise(r => setTimeout(r, DELAY_KIS));
  }
  return resultMap;
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

function yfDateRange(yyyymmdd) {
  const y=yyyymmdd.slice(0,4), m=yyyymmdd.slice(4,6), d=yyyymmdd.slice(6,8);
  const p2 = Math.floor(new Date(`${y}-${m}-${d}T23:59:59+09:00`).getTime() / 1000);
  const p1 = p2 - 14*24*3600;
  return { p1, p2 };
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9*3600) * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function httpGetYf(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch(e) { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(12000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  try {
    const data = await httpGetYf(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp || [];
    const q  = result.indicators?.quote?.[0] || {};
    return { ts, close: q.close||[], high: q.high||[], low: q.low||[] };
  } catch { return null; }
}

async function batchAll(items, fn, concurrency=5, delay=80) {
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

async function fetchYahooDate(targetDate, stockList) {
  const { p1, p2 } = yfDateRange(targetDate);
  const resultMap = new Map();
  await batchAll(stockList, async (stock) => {
    const suffix = stock.시장 === 'KOSDAQ' ? '.KQ' : '.KS';
    const yf = await fetchYahooChart(`${stock.code}${suffix}`, p1, p2);
    if (!yf || yf.ts.length === 0) return;
    let tIdx = -1;
    for (let i = 0; i < yf.ts.length; i++) {
      if (tsToKstDate(yf.ts[i]) === targetDate) { tIdx = i; break; }
    }
    if (tIdx === -1) return;
    const 종가 = yf.close[tIdx];
    const 고가 = yf.high[tIdx];
    const 저가 = yf.low?.[tIdx];
    if (!종가) return;
    resultMap.set(stock.code, { 종목코드: stock.code, 종가: Math.round(종가), 고가: 고가 ? Math.round(고가) : Math.round(종가), 저가: 저가 ? Math.round(저가) : Math.round(종가) });
  }, 5, 80);
  return resultMap;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── 1. 보유종목 로드 (노션 보유종목DB → 실패 시 data/holdings.json 폴백)
  const notionData = await fetchNotionHoldings();
  let holdings, prevHoldings = [], prevDate = null;
  if (notionData && notionData.holdings?.length > 0) {
    holdings     = notionData.holdings;
    prevHoldings = notionData.prevHoldings || [];
    prevDate     = notionData.prevDate;
  } else {
    console.error('[폴백] data/holdings.json 사용');
    const holdingsPath = 'C:/Users/shinf/workspace/data/holdings.json';
    if (!fs.existsSync(holdingsPath)) {
      console.error('[오류] data/holdings.json 파일도 없습니다.');
      process.exit(1);
    }
    holdings = JSON.parse(fs.readFileSync(holdingsPath, 'utf-8'));
  }
  if (!Array.isArray(holdings) || holdings.length === 0) {
    console.error('[오류] 보유종목이 없습니다.');
    process.exit(1);
  }

  const holdingCodes = new Set(holdings.map(h => h.종목코드));
  const stockList    = holdings.map(h => ({ code: h.종목코드, 종목명: h.종목명, 시장: h.시장 }));
  console.error(`\n[보유종목] ${holdings.length}개: ${holdings.map(h => h.종목명).join(', ')}`);

  // ── 2. 날짜 범위: 35일 (20거래일 + 여유)
  const today      = kstToday();
  const startDate  = addDays(today, -35);
  const allWeekdays = weekdayRange(startDate, today);
  console.error(`\n[조회] ${fmtDate(startDate)} ~ ${fmtDate(today)} (주말 제외 ${allWeekdays.length}개 날짜)`);

  // ── 3. KRX API 일별 조회 (보유종목만 필터)
  const priceHistory   = new Map();
  const tradingDates   = [];
  const krxFailedRecent = [];
  let marketResolved = false;

  for (const date of allWeekdays) {
    process.stderr.write(`  ${fmtDate(date)}... `);
    try {
      await sleep(DELAY_MS);
      const items = await fetchDate(date);
      if (!items) {
        if (calDiff(date, today) <= 5) {
          krxFailedRecent.push(date);
          process.stderr.write('KRX 미제공 → KIS/Yahoo 대상\n');
        } else {
          process.stderr.write('휴장\n');
        }
        continue;
      }
      // 시장 정보 1회 업데이트 (첫 번째 KRX 성공 날짜)
      if (!marketResolved) {
        for (const item of items) {
          const code = (item.srtnCd || '').trim();
          const h = holdings.find(x => x.종목코드 === code);
          if (h && item.mrktCtg) h.시장 = (item.mrktCtg || '').trim().toUpperCase() || h.시장;
        }
        marketResolved = true;
      }
      const dm = new Map();
      for (const item of items) {
        const code = (item.srtnCd || '').trim();
        if (!holdingCodes.has(code)) continue;
        const 종가 = Number(item.clpr || 0);
        const 고가 = Number(item.hipr || 0);
        const 저가 = Number(item.lopr || 0);
        if (종가 <= 0) continue;
        dm.set(code, { 종목코드: code, 종가, 고가, 저가 });
      }
      priceHistory.set(date, dm);
      tradingDates.push(date);
      process.stderr.write(`보유종목 ${dm.size}/${holdings.length}종목 확보\n`);
    } catch(e) {
      process.stderr.write(`오류: ${e.message}\n`);
    }
  }

  console.error(`\n[완료] KRX API ${tradingDates.length}일 수집`);

  // ── 4. KRX 미제공 최근 날짜: 당일=KIS 우선, 나머지=Yahoo
  if (krxFailedRecent.length > 0) {
    console.error(`\n[KIS/Yahoo] ${krxFailedRecent.length}개 날짜 보완`);
    for (const date of krxFailedRecent) {
      if (date === today) {
        process.stderr.write(`  [KIS] ${fmtDate(date)}... `);
        const km = await fetchKisDate(stockList);
        if (km.size > 0) {
          priceHistory.set(date, km);
          tradingDates.push(date);
          process.stderr.write(`${km.size}종목 (KIS)\n`);
          continue;
        }
        process.stderr.write('KIS 실패 → Yahoo 폴백\n');
      }
      process.stderr.write(`  [Yahoo] ${fmtDate(date)}... `);
      const ym = await fetchYahooDate(date, stockList);
      if (ym.size > 0) {
        priceHistory.set(date, ym);
        tradingDates.push(date);
        process.stderr.write(`${ym.size}종목 (Yahoo)\n`);
      } else {
        process.stderr.write('데이터 없음\n');
      }
    }
    tradingDates.sort();
  }

  console.error(`[거래일] 총 ${tradingDates.length}일\n`);

  const latestDate = tradingDates[tradingDates.length - 1];

  // ── 5. 보유종목별 지표 계산
  const results = [];
  for (const h of holdings) {
    const { 종목코드: code, 종목명, 시장, 보유수량, 평균단가 } = h;

    let 현재가 = null, 고가 = null, 저가 = null, 현재일 = null;
    for (let i = tradingDates.length - 1; i >= 0; i--) {
      const dm = priceHistory.get(tradingDates[i]);
      if (dm && dm.has(code) && dm.get(code).종가 > 0) {
        현재가 = dm.get(code).종가;
        고가   = dm.get(code).고가 || dm.get(code).종가;
        저가   = dm.get(code).저가 || dm.get(code).종가;
        현재일 = tradingDates[i];
        break;
      }
    }

    if (현재가 == null) {
      console.error(`[경고] ${종목명}(${code}) 가격 데이터 없음`);
      results.push({ 종목코드: code, 종목명, 시장, 보유수량, 평균단가, 현재가: null, 고가: null, 저가: null, 현재일: null, ma20: null, ma20Ratio: null, stage: '─', 투자금액: 평균단가*보유수량, 평가금액: null, 수익금액: null, 수익률: null, target1: null, target2: null, pnl1: null, pnl2: null, ret1: null, ret2: null, dataCount: 0 });
      continue;
    }

    // MA20
    const latestDi = tradingDates.indexOf(현재일);
    const lookback = tradingDates.slice(Math.max(0, latestDi - 19), latestDi + 1);
    const prices = [];
    for (const d of lookback) {
      const dm = priceHistory.get(d);
      if (dm && dm.has(code) && dm.get(code).종가 > 0) prices.push(dm.get(code).종가);
    }
    const ma20raw   = prices.length >= 5 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const ma20      = ma20raw ? Math.round(ma20raw) : null;
    const ma20Ratio = ma20 ? (현재가 / ma20 - 1) * 100 : null;

    // 엔벨로프 단계
    let stage = '─';
    if (ma20) {
      if (현재가 >= Math.round(ma20 * 1.2)) stage = '2차달성';
      else if (현재가 >= ma20)              stage = '1차달성';
      else if (현재가 >= Math.round(ma20 * 0.8)) stage = '회복중';
      else                                  stage = '매수구간';
    }

    const 투자금액 = 평균단가 * 보유수량;
    const 평가금액 = 현재가 * 보유수량;
    const 수익금액 = 평가금액 - 투자금액;
    const 수익률   = (현재가 / 평균단가 - 1) * 100;
    const target1  = ma20;
    const target2  = ma20 ? Math.round(ma20 * 1.2) : null;
    const ret1     = target1 ? (target1 / 평균단가 - 1) * 100 : null;
    const ret2     = target2 ? (target2 / 평균단가 - 1) * 100 : null;
    const pnl1     = target1 ? (target1 - 평균단가) * 보유수량 : null;
    const pnl2     = target2 ? (target2 - 평균단가) * 보유수량 : null;

    results.push({ 종목코드: code, 종목명, 시장, 보유수량, 평균단가, 현재가, 고가, 저가, 현재일, ma20, ma20Ratio, stage, 투자금액, 평가금액, 수익금액, 수익률, target1, target2, pnl1, pnl2, ret1, ret2, dataCount: prices.length });
    console.error(`  ${종목명}(${code}): ${fmtNum(현재가)}원 / MA20 ${ma20?fmtNum(ma20):'─'}원 / 괴리 ${ma20Ratio!=null?ma20Ratio.toFixed(1):'─'}% / ${stage}`);
  }

  generateAndSaveHTML({ results, latestDate, diff: computeDiff(holdings, prevHoldings), prevDate });
}

// ─── HTML 리포트 생성 ─────────────────────────────────────────────────────────
function generateAndSaveHTML({ results, latestDate, diff, prevDate }) {
  const now = new Date(Date.now() + 9*3600*1000);
  const p2n = n => String(n).padStart(2,'0');
  const ts  = `${now.getUTCFullYear()}${p2n(now.getUTCMonth()+1)}${p2n(now.getUTCDate())}${p2n(now.getUTCHours())}${p2n(now.getUTCMinutes())}`;

  const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fN  = n => n != null ? Number(n).toLocaleString('ko-KR') : '─';
  const fP  = n => n != null ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '─';
  const fP1 = n => n != null ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '─';
  const fKrw = n => n != null ? (n >= 0 ? '+' : '') + fN(n) + '원' : '─';
  const pc  = n => n == null ? 't-flat' : n > 0 ? 't-pos' : n < -10 ? 't-neg-hi' : n < 0 ? 't-neg' : 't-flat';
  const rpc = n => n == null ? 't-flat' : n > 0 ? 't-pos' : n < -10 ? 't-neg-hi' : n < 0 ? 't-neg' : 't-flat';

  const stageMap = { '매수구간': 'bdg-blue', '회복중': 'bdg-amber', '1차달성': 'bdg-teal', '2차달성': 'bdg-purple', '─': 'bdg-gray' };
  const envBadge = stage => `<span class="badge ${stageMap[stage]||'bdg-gray'}">${stage}</span>`;

  const validR = results.filter(r => r.현재가 != null);
  const allR   = results;

  // 포트폴리오 집계
  const totalInvest = validR.reduce((s, r) => s + r.투자금액, 0);
  const totalValue  = validR.reduce((s, r) => s + r.평가금액, 0);
  const totalPnl    = totalValue - totalInvest;
  const totalPct    = totalInvest > 0 ? totalPnl / totalInvest * 100 : 0;
  const profitCnt   = validR.filter(r => r.수익률 > 0).length;
  const lossCnt     = validR.filter(r => r.수익률 < 0).length;

  const buyZone    = validR.filter(r => r.stage === '매수구간');
  const recovering = validR.filter(r => r.stage === '회복중');
  const first1     = validR.filter(r => r.stage === '1차달성');
  const second2    = validR.filter(r => r.stage === '2차달성');

  const sortedByPnl = [...validR].sort((a, b) => b.수익률 - a.수익률);
  const best  = sortedByPnl[0];
  const worst = sortedByPnl[sortedByPnl.length - 1];

  const latestFmt = latestDate ? fmtDate(latestDate) : '─';

  // ── 탭0 요약 행
  const p0Rows = sortedByPnl.map(r =>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${pc(r.수익률)}">${fP(r.수익률)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="c">${envBadge(r.stage)}</td></tr>`
  ).join('');
  const p0Cards = sortedByPnl.map(r =>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${pc(r.수익률)}">${fP(r.수익률)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20괴리율</span><span class="sc-item-v ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">엔벨로프</span><span class="sc-item-v">${envBadge(r.stage)}</span></div></div></div>`
  ).join('');

  // ── 탭1 종목별 상세 행
  const p1Rows = sortedByPnl.map(r =>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="c mob-hide">${fN(r.보유수량)}</td><td class="mob-hide">${fN(r.평균단가)}</td><td class="t-price">${fN(r.현재가)}</td><td class="mob-hide">${fN(r.평가금액)}</td><td class="${pc(r.수익금액)}">${r.수익금액!=null?fKrw(r.수익금액):'─'}</td><td class="${pc(r.수익률)}">${fP(r.수익률)}</td><td class="mob-hide">${fN(r.ma20)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="c mob-hide">${envBadge(r.stage)}</td></tr>`
  ).join('');
  const p1Cards = sortedByPnl.map(r =>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${pc(r.수익률)}">${fP(r.수익률)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">평균단가</span><span class="sc-item-v">${fN(r.평균단가)}원</span></div><div class="sc-item"><span class="sc-item-l">평가금액</span><span class="sc-item-v">${fN(r.평가금액)}원</span></div><div class="sc-item"><span class="sc-item-l">수익금액</span><span class="sc-item-v ${pc(r.수익금액)}">${r.수익금액!=null?fKrw(r.수익금액):'─'}</span></div><div class="sc-item"><span class="sc-item-l">MA20</span><span class="sc-item-v">${fN(r.ma20)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20괴리율</span><span class="sc-item-v ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-item sc-full"><span class="sc-item-l">엔벨로프</span><span class="sc-item-v">${envBadge(r.stage)}</span></div></div></div>`
  ).join('');

  // ── 탭2 엔벨로프: 매수구간
  const p2BuyRows = buyZone.map(r => {
    const toMA20 = r.target1 && r.현재가 ? (r.target1/r.현재가-1)*100 : null;
    const to2nd  = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="${pc(r.수익률)} mob-hide">${fP(r.수익률)}</td><td class="mob-hide">${fN(r.target1)}</td><td class="t-pos mob-hide">${toMA20!=null?'+'+toMA20.toFixed(1)+'%':'─'}</td><td class="${pc(r.ret1)} mob-hide">${fP1(r.ret1)}</td><td class="mob-hide">${fN(r.target2)}</td><td class="t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</td><td class="${pc(r.ret2)}">${fP1(r.ret2)}</td></tr>`;
  }).join('');
  const p2BuyCards = buyZone.map(r => {
    const toMA20 = r.target1 && r.현재가 ? (r.target1/r.현재가-1)*100 : null;
    const to2nd  = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<div class="stock-card" style="border-top:3px solid var(--blue)"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">평단대비</span><span class="sc-item-v ${pc(r.수익률)}">${fP(r.수익률)}</span></div><div class="sc-item"><span class="sc-item-l">1차목표(MA20)</span><span class="sc-item-v">${fN(r.target1)}원</span></div><div class="sc-item"><span class="sc-item-l">1차까지 상승</span><span class="sc-item-v t-pos">${toMA20!=null?'+'+toMA20.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차목표(+20%)</span><span class="sc-item-v">${fN(r.target2)}원</span></div><div class="sc-item"><span class="sc-item-l">2차까지 상승</span><span class="sc-item-v t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">1차달성시 손익</span><span class="sc-item-v ${pc(r.pnl1)}">${r.pnl1!=null?fKrw(r.pnl1):'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차달성시 손익</span><span class="sc-item-v ${pc(r.pnl2)}">${r.pnl2!=null?fKrw(r.pnl2):'─'}</span></div></div></div>`;
  }).join('');

  // ── 탭2 회복중
  const p2RecRows = recovering.map(r => {
    const toMA20 = r.target1 && r.현재가 ? (r.target1/r.현재가-1)*100 : null;
    const to2nd  = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="${pc(r.수익률)}">${fP(r.수익률)}</td><td class="mob-hide">${fN(r.target1)}</td><td class="t-pos mob-hide">${toMA20!=null?'+'+toMA20.toFixed(1)+'%':'─'}</td><td class="mob-hide">${fN(r.target2)}</td><td class="t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</td></tr>`;
  }).join('');
  const p2RecCards = recovering.map(r => {
    const toMA20 = r.target1 && r.현재가 ? (r.target1/r.현재가-1)*100 : null;
    const to2nd  = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<div class="stock-card" style="border-top:3px solid var(--amber)"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">평단대비</span><span class="sc-item-v ${pc(r.수익률)}">${fP(r.수익률)}</span></div><div class="sc-item"><span class="sc-item-l">1차목표(MA20)</span><span class="sc-item-v">${fN(r.target1)}원</span></div><div class="sc-item"><span class="sc-item-l">1차까지 상승</span><span class="sc-item-v t-pos">${toMA20!=null?'+'+toMA20.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차목표(+20%)</span><span class="sc-item-v">${fN(r.target2)}원</span></div><div class="sc-item"><span class="sc-item-l">2차까지 상승</span><span class="sc-item-v t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</span></div></div></div>`;
  }).join('');

  // ── 탭2 1차달성
  const p2FirstRows = first1.map(r => {
    const to2nd = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="${pc(r.수익률)} t-pos">${fP(r.수익률)}</td><td class="mob-hide">${fN(r.target2)}</td><td class="t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</td><td class="${pc(r.ret2)}">${fP1(r.ret2)}</td><td class="${pc(r.pnl2)} mob-hide">${r.pnl2!=null?fKrw(r.pnl2):'─'}</td></tr>`;
  }).join('');
  const p2FirstCards = first1.map(r => {
    const to2nd = r.target2 && r.현재가 ? (r.target2/r.현재가-1)*100 : null;
    return `<div class="stock-card" style="border-top:3px solid var(--teal600)"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio t-pos">${fP(r.수익률)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20괴리율</span><span class="sc-item-v ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차목표(+20%)</span><span class="sc-item-v">${fN(r.target2)}원</span></div><div class="sc-item"><span class="sc-item-l">2차까지 상승</span><span class="sc-item-v t-pos">${to2nd!=null?'+'+to2nd.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차달성시 평단수익률</span><span class="sc-item-v ${pc(r.ret2)}">${fP1(r.ret2)}</span></div><div class="sc-item"><span class="sc-item-l">2차달성시 손익</span><span class="sc-item-v ${pc(r.pnl2)}">${r.pnl2!=null?fKrw(r.pnl2):'─'}</span></div></div></div>`;
  }).join('');

  // ── 탭2 2차달성
  const p2SecRows = second2.map(r =>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="t-pos">${fP(r.수익률)}</td><td class="${pc(r.수익금액)}">${r.수익금액!=null?fKrw(r.수익금액):'─'}</td><td class="t-pos">${fP1(r.ret2)}</td></tr>`
  ).join('');
  const p2SecCards = second2.map(r =>
    `<div class="stock-card" style="border-top:3px solid var(--purple)"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio t-pos">${fP(r.수익률)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20괴리율</span><span class="sc-item-v ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">수익금액</span><span class="sc-item-v ${pc(r.수익금액)}">${r.수익금액!=null?fKrw(r.수익금액):'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차 기준 수익률</span><span class="sc-item-v t-pos">${fP1(r.ret2)}</span></div></div></div>`
  ).join('');

  // ── AI 인사이트
  const _aiIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;
  const _aiHdr = t => `<div class="ai-title">${_aiIcon} ${t}<span class="badge bdg-sky ai-badge" style="font-size:11px">AI 분석</span></div>`;
  const _ai    = (dot, h) => `<div class="ai-item"><div class="ai-dot ai-dot-${dot}"></div><div>${h}</div></div>`;

  // AI 카드 0: 포트폴리오 종합
  const aiCard0 = (() => {
    const pnlDot = totalPct >= 0 ? 'teal' : 'red';
    const pnlCls = totalPct >= 0 ? 'ok' : 'hi';
    const items = [
      _ai(pnlDot, `<b>포트폴리오 종합</b> — 총 투자금액 <b>${fN(totalInvest)}원</b> → 평가금액 <b>${fN(totalValue)}원</b> · 손익 <span class="${pnlCls}">${totalPnl>=0?'+':''}${fN(totalPnl)}원 (${fP(totalPct)})</span> · 수익 <b>${profitCnt}</b>종목 / 손실 <b>${lossCnt}</b>종목 / 전체 <b>${validR.length}</b>종목`),
      best && best.수익률 > 0 ? _ai('teal', `<b>선두 수익</b> — <b>${esc(best.종목명)}</b> <span class="ok">${fP(best.수익률)}</span> (평단 ${fN(best.평균단가)}→현재 ${fN(best.현재가)}원) · 수익금액 <span class="ok">+${fN(best.수익금액)}원</span> · 엔벨로프: ${best.stage}`) : null,
      worst && worst.수익률 < 0 ? _ai('red', `<b>주의 종목</b> — <b>${esc(worst.종목명)}</b> <span class="hi">${fP(worst.수익률)}</span> · 현재가 ${fN(worst.현재가)}원 / 평단 ${fN(worst.평균단가)}원 · MA20괴리율 <span class="hi">${worst.ma20Ratio!=null?worst.ma20Ratio.toFixed(1)+'%':'─'}</span> · ${worst.stage === '매수구간' ? '분할매수로 단가 인하 전략 고려' : 'MA20 회복 추세 주시'}`) : null,
      second2.length > 0 ? _ai('purple', `<b>익절 기회</b> — <b>${second2.map(r=>esc(r.종목명)).join(', ')}</b> MA20+20% 달성 · 목표가 초과 구간 진입 · 수익 실현(부분 매도) 또는 트레일링 스탑 설정 권고`) : null,
      buyZone.length > 0 ? _ai('sky', `<b>매수구간 포착</b> — <b>${buyZone.map(r=>esc(r.종목명)).join(', ')}</b> MA20 −20% 이하 이탈 · 엔벨로프 매수 타점 진입 상태 · 분할매수로 평균단가 인하 효과 기대`) : null,
      validR.length && buyZone.length === 0 && second2.length === 0 ? _ai('amber', `<b>중립 포지션</b> — 전체 종목이 MA20 기준 중간 구간(회복중/1차달성) · 추세 방향성 확인 후 비중 조절 전략 유효`) : null,
    ].filter(Boolean).join('');
    return `<div class="ai-sc">${_aiHdr('AI 분석 — 포트폴리오 종합 진단')}<div class="ai-list">${items}</div></div>`;
  })();

  // AI 카드 2: 엔벨로프 전략
  const aiCard2 = (() => {
    const buyUpsides = buyZone.filter(r=>r.target2&&r.현재가).map(r=>(r.target2/r.현재가-1)*100);
    const avgBuyUp   = buyUpsides.length ? (buyUpsides.reduce((a,b)=>a+b,0)/buyUpsides.length).toFixed(1) : null;
    const f1Upsides  = first1.filter(r=>r.target2&&r.현재가).map(r=>(r.target2/r.현재가-1)*100);
    const avgF1Up    = f1Upsides.length ? (f1Upsides.reduce((a,b)=>a+b,0)/f1Upsides.length).toFixed(1) : null;
    const items = [
      buyZone.length ? _ai('blue', `<b>매수구간 ${buyZone.length}종목</b> — MA20 −20% 이하 이탈로 엔벨로프 최적 매수구간 진입 · 2차 목표(MA20+20%)까지 현재가 대비 평균 <span class="ok">+${avgBuyUp?avgBuyUp:'─'}%</span> 잠재 수익 · 분할매수 단가인하 전략으로 반등 시 레버리지 효과 극대화`) : null,
      recovering.length ? _ai('amber', `<b>회복 중 ${recovering.length}종목</b> — MA20 −20%~0% 구간 회복 중 · MA20 종가 돌파 시 1차달성 전환 · 추가 매수보다 기존 포지션 유지로 반등 흐름 추종 권고`) : null,
      first1.length ? _ai('teal', `<b>1차달성 ${first1.length}종목</b> — MA20 상향 돌파 성공 · 2차 목표(MA20+20%)까지 현재가 대비 평균 <span class="ok">+${avgF1Up?avgF1Up:'─'}%</span> 여유 · 보유 유지하되 상승 속도 둔화 시 부분 익절로 수익 보전 고려`) : null,
      second2.length ? _ai('purple', `<b>2차달성 ${second2.length}종목</b> — <b>${second2.map(r=>esc(r.종목명)).join(', ')}</b> MA20+20% 전량 달성 · <span style="color:var(--purple);font-weight:700">엔벨로프 최종 목표 완료 — 30~50% 익절 후 잔량 트레일링 스탑</span> 또는 전량 익실 후 재진입 타점 탐색 권고`) : null,
    ].filter(Boolean).join('');
    return items ? `<div class="ai-sc">${_aiHdr('AI 분석 — 엔벨로프 전략 진행 현황')}<div class="ai-list">${items}</div></div>` : '';
  })();

  // ── 자동매도 전략 데이터 (손절 -15%/-20% + 익절 +20% + 트레일링 -12%)
  const trData = [...validR].map(r => {
    // 수동매도 수량: 1차(MA20) 50% → 2차(MA20+20%) 잔량 전량
    const qty1  = Math.floor(r.보유수량 * 0.5);
    const qty2  = r.보유수량 - qty1;
    const qtyR  = 0;
    const pct1  = r.target1 && r.현재가 ? (r.target1/r.현재가 - 1)*100 : null;
    const pct2  = r.target2 && r.현재가 ? (r.target2/r.현재가 - 1)*100 : null;
    // 고가 기준 돌파 체크 (당일 고가가 목표가에 닿았지만 종가는 미달성)
    const pct1H = r.고가 && r.target1 ? (r.target1/r.고가 - 1)*100 : null;
    const pct2H = r.고가 && r.target2 ? (r.target2/r.고가 - 1)*100 : null;
    const break1 = pct1 != null && pct1 <= 0 ? '1차 종가돌파' : (pct1H != null && pct1H <= 0 ? '1차 고가돌파' : null);
    const break2 = pct2 != null && pct2 <= 0 ? '2차 종가돌파' : (pct2H != null && pct2H <= 0 ? '2차 고가돌파' : null);
    const breakStatus = break2 || break1 || null;
    const prof1 = r.target1 ? qty1 * (r.target1 - r.평균단가) : null;
    const prof2 = r.target2 ? qty2 * (r.target2 - r.평균단가) : null;
    const profR = null;
    const profT = (prof1||0) + (prof2||0);
    // 자동매도 주문가 계산
    const sl1    = Math.round(r.평균단가 * 0.85);
    const sl2    = Math.round(r.평균단가 * 0.80);
    const pt20   = Math.round(r.평균단가 * 1.20);
    const sl1Gap = r.현재가 ? (r.현재가/sl1 - 1)*100 : null;
    const ptGap  = r.현재가 ? (pt20/r.현재가 - 1)*100 : null;
    const ptQty  = Math.floor(r.보유수량 * 0.5);
    const trQty  = r.보유수량 - ptQty;
    const slQty1 = Math.floor(r.보유수량 * 0.5);
    const slQty2 = r.보유수량 - slQty1;
    // 트레일링스탑 상태: 돌파 우선 → 자동전략(pt20) 순
    let trailStop = null, trailStage = '대기', trailBadge = 'bdg-sky';
    if      (pct2 != null && pct2 <= 0)                    { trailStage = '2차돌파';   trailBadge = 'bdg-purple'; }
    else if (pct2H != null && pct2H <= 0)                  { trailStage = '2차(고가)'; trailBadge = 'bdg-purple'; }
    else if (pct1 != null && pct1 <= 0)                    { trailStage = '1차돌파';   trailBadge = 'bdg-teal';   }
    else if (pct1H != null && pct1H <= 0)                  { trailStage = '1차(고가)'; trailBadge = 'bdg-teal';   }
    else if (ptGap != null && ptGap <= 0)                   { trailStop = Math.round(r.현재가 * 0.88); trailStage = '트레일링발동'; trailBadge = 'bdg-teal'; }
    else if (sl1Gap != null && sl1Gap < 5)                  { trailStage = '손절주의';  trailBadge = 'bdg-red';    }
    else if (ptGap != null && ptGap > 0 && ptGap < 10)     { trailStage = '익절근접';  trailBadge = 'bdg-amber';  }
    else if (r.stage === '매수구간')                         { trailStage = '매수구간';  trailBadge = 'bdg-blue';   }
    return { ...r, qty1, qty2, qtyR, pct1, pct2, pct1H, pct2H, breakStatus, prof1, prof2, profR, profT,
             trailStop, trailStage, trailBadge, sl1, sl2, pt20, sl1Gap, ptGap, ptQty, trQty, slQty1, slQty2 };
  });
  const trSorted = [...trData].sort((a,b) => {
    const rank = s => s==='2차돌파'?0 : s==='2차(고가)'?1 : s==='1차돌파'?2 : s==='1차(고가)'?3 : s==='트레일링발동'?4 : s==='손절주의'?5 : s==='익절근접'?6 : s==='매수구간'?7 : 8;
    if (rank(a.trailStage) !== rank(b.trailStage)) return rank(a.trailStage) - rank(b.trailStage);
    return (a.pct1??999) - (b.pct1??999);
  });
  const trActive1 = trData.filter(r => r.stage === '1차달성').length;
  const trActive2 = trData.filter(r => r.stage === '2차달성').length;
  const trNear    = trData.filter(r => r.pct1!=null && r.pct1>0 && r.pct1<=5).length;
  const totalProfitComplete = trData.reduce((s,r) => s+(r.profT||0), 0);
  const slDanger    = trData.filter(r => r.sl1Gap != null && r.sl1Gap < 5).length;
  const ptNear      = trData.filter(r => r.ptGap != null && r.ptGap > 0 && r.ptGap < 10).length;
  const ptTriggered = trData.filter(r => r.ptGap != null && r.ptGap <= 0).length;

  const p3StatusRows = trSorted.map(r => {
    const p1d = r.pct1!=null?`<span class="${pc(r.pct1)}">${r.pct1>=0?'+':''}${r.pct1.toFixed(1)}%</span>`:'─';
    const p2d = r.pct2!=null?`<span class="${pc(r.pct2)}">${r.pct2>=0?'+':''}${r.pct2.toFixed(1)}%</span>`:'─';
    const brkCell = r.breakStatus
      ? `<span class="${r.breakStatus.includes('종가')?'t-pos':'t-flat'}" style="font-size:12px">${r.breakStatus}</span>`
      : '─';
    return `<tr${r.trailStop?' class="ts-active"':''}><td class="l t-name">${esc(r.종목명)}</td><td class="t-price">${fN(r.현재가)}</td><td class="${rpc(r.ma20Ratio)} mob-hide">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</td><td class="mob-hide">${fN(r.target1)}</td><td>${p1d}</td><td class="mob-hide">${fN(r.target2)}</td><td>${p2d}</td><td class="mob-hide c">${brkCell}</td><td class="ts-stop mob-hide">${r.trailStop?fN(r.trailStop)+'원':'─'}</td><td class="c"><span class="badge ${r.trailBadge}">${r.trailStage}</span></td></tr>`;
  }).join('');
  const p3StatusCards = trSorted.map(r => {
    const p1d = r.pct1!=null?`<span class="${pc(r.pct1)}">${r.pct1>=0?'+':''}${r.pct1.toFixed(1)}%</span>`:'─';
    const p2d = r.pct2!=null?`<span class="${pc(r.pct2)}">${r.pct2>=0?'+':''}${r.pct2.toFixed(1)}%</span>`:'─';
    return `<div class="stock-card${r.trailStop?' ts-active-card':''}"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="badge ${r.trailBadge}">${r.trailStage}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">현재가</span><span class="sc-item-v">${fN(r.현재가)}원</span></div><div class="sc-item"><span class="sc-item-l">MA20괴리율</span><span class="sc-item-v ${rpc(r.ma20Ratio)}">${r.ma20Ratio!=null?r.ma20Ratio.toFixed(1)+'%':'─'}</span></div><div class="sc-item"><span class="sc-item-l">1차</span><span class="sc-item-v">${p1d}</span></div><div class="sc-item"><span class="sc-item-l">2차</span><span class="sc-item-v">${p2d}</span></div>${r.breakStatus?`<div class="sc-item sc-full"><span class="sc-item-l">돌파</span><span class="sc-item-v ${r.breakStatus.includes('종가')?'t-pos':'t-flat'}">${r.breakStatus}</span></div>`:''}</div></div>`;
  }).join('');
  const p3ScenRows = trSorted.map(r =>
    `<tr><td class="l t-name">${esc(r.종목명)}</td><td class="mob-hide">${fN(r.target1)}</td><td class="c mob-hide">${r.qty1}주</td><td class="${pc(r.prof1)}">${r.prof1!=null?fKrw(r.prof1):'─'}</td><td class="mob-hide">${fN(r.target2)}</td><td class="c mob-hide">${r.qty2}주</td><td class="${pc(r.prof2)}">${r.prof2!=null?fKrw(r.prof2):'─'}</td><td class="${pc(r.profT)}" style="font-weight:800">${fKrw(r.profT)}</td></tr>`
  ).join('');
  const p3ScenCards = trSorted.map(r =>
    `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="sc-ratio ${pc(r.profT)}">${fKrw(r.profT)}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">1차매도(50%) ${r.qty1}주 @MA20</span><span class="sc-item-v ${pc(r.prof1)}">${r.prof1!=null?fKrw(r.prof1):'─'}</span></div><div class="sc-item"><span class="sc-item-l">2차매도(잔량) ${r.qty2}주 @MA20+20%</span><span class="sc-item-v ${pc(r.prof2)}">${r.prof2!=null?fKrw(r.prof2):'─'}</span></div><div class="sc-item"><span class="sc-item-l">전략완료 총수익</span><span class="sc-item-v ${pc(r.profT)}" style="font-weight:800">${fKrw(r.profT)}</span></div></div></div>`
  ).join('');

  // ── 주문 설정 가이드 (손절위험 → 익절임박 → 일반 → 장기적립 순)
  const orderSorted = [...trData].sort((a, b) => {
    const aSl = a.sl1Gap ?? 999, bSl = b.sl1Gap ?? 999;
    if (aSl !== bSl) return aSl - bSl;
    return (a.ptGap ?? 999) - (b.ptGap ?? 999);
  });
  const orderRows = orderSorted.map(r => {
    const isDanger = r.sl1Gap != null && r.sl1Gap < 5;
    const isReady  = r.ptGap != null && r.ptGap <= 0;
    const sl1Cell  = `${fN(r.sl1)}<br><small class="${isDanger?'t-neg-hi':'t-flat'}" style="font-size:11.5px">여유 ${r.sl1Gap!=null?r.sl1Gap.toFixed(1)+'%':'─'}</small>`;
    const ptCell   = isReady
      ? `${fN(r.pt20)} <span class="t-pos" style="font-weight:800">✓발동</span>`
      : `${fN(r.pt20)}<br><small class="t-flat" style="font-size:11.5px">+${r.ptGap!=null?r.ptGap.toFixed(1)+'%':'─'}</small>`;
    const trCell   = isReady ? `잔량 ${r.trQty}주 · -12%` : `익절 후 설정`;
    return `<tr${isDanger?' class="ts-active"':''}><td class="l t-name">${esc(r.종목명)}</td><td class="mob-hide">${fN(r.평균단가)}</td><td>${sl1Cell}</td><td class="mob-hide">${fN(r.sl2)}</td><td class="mob-hide c">${r.slQty1}주</td><td>${ptCell}</td><td class="mob-hide c">${r.ptQty}주</td><td class="mob-hide">${trCell}</td></tr>`;
  }).join('');
  const orderCards = orderSorted.map(r => {
    const isDanger = r.sl1Gap != null && r.sl1Gap < 5;
    const isReady  = r.ptGap != null && r.ptGap <= 0;
    return `<div class="stock-card${isDanger?' ts-active-card':''}"><div class="sc-head"><span class="sc-name">${esc(r.종목명)}</span><span class="badge ${isReady?'bdg-teal':isDanger?'bdg-red':'bdg-gray'}">${isReady?'익절발동':isDanger?'손절주의':'대기'}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">손절1 (-15%) ${r.slQty1}주</span><span class="sc-item-v ${isDanger?'t-neg-hi':''}">${fN(r.sl1)}원</span></div><div class="sc-item"><span class="sc-item-l">손절2 (-20%) ${r.slQty2}주</span><span class="sc-item-v">${fN(r.sl2)}원</span></div><div class="sc-item"><span class="sc-item-l">익절 (+20%) ${r.ptQty}주</span><span class="sc-item-v ${isReady?'t-pos':''}">${fN(r.pt20)}원</span></div><div class="sc-item"><span class="sc-item-l">익절까지</span><span class="sc-item-v">${isReady?'✓ 발동가능':r.ptGap!=null?'+'+r.ptGap.toFixed(1)+'%':'─'}</span></div><div class="sc-item sc-full"><span class="sc-item-l">트레일링 (익절 후 ${r.trQty}주)</span><span class="sc-item-v">${isReady?'-12% 설정 필요':'익절 발동 후 설정'}</span></div></div></div>`;
  }).join('');

  const aiCardTrail = (() => {
    const danger   = trData.filter(r => !r.isLT && r.sl1Gap != null && r.sl1Gap < 5);
    const ready    = trData.filter(r => r.ptGap != null && r.ptGap <= 0);
    const near     = trData.filter(r => r.ptGap != null && r.ptGap > 0 && r.ptGap < 10);
    const bestProf = [...trData].sort((a,b) => b.profT-a.profT)[0];
    const items = [
      danger.length ? _ai('red', `<b>손절 주의 ${danger.length}종목</b> — <b>${danger.map(r=>`${esc(r.종목명)}(여유 ${r.sl1Gap!=null?r.sl1Gap.toFixed(1)+'%':'─'})`).join(', ')}</b> · 손절1선(-15%)까지 5% 미만 · HTS 스탑로스 주문 설정 여부 재확인`) : null,
      ready.length  ? _ai('teal', `<b>익절 발동 가능 ${ready.length}종목</b> — <b>${ready.map(r=>esc(r.종목명)).join(', ')}</b> · 매입가 +20% 초과 달성 · 50% 즉시 익절 + 잔량 50%에 트레일링 -12% 설정`) : null,
      near.length   ? _ai('amber', `<b>익절 10% 이내 근접 ${near.length}종목</b> — <b>${near.map(r=>`${esc(r.종목명)}(+${r.ptGap!=null?r.ptGap.toFixed(1):'─'}%)`).join(', ')}</b> · 익절 주문(매입가×1.20) 설정 확인`) : null,
      bestProf      ? _ai('teal', `<b>MA20 시나리오 완료 시 최고 수익</b> — <b>${esc(bestProf.종목명)}</b> 합산 <span class="ok">+${fN(bestProf.profT)}원</span>`) : null,
      _ai('sky', `<b>전체 MA20 시나리오 완료 시 총 예상 수익</b> — <span class="ok">${totalProfitComplete>=0?'+':''}${fN(totalProfitComplete)}원</span> · 현재 대비 <span class="ok">+${fN(totalProfitComplete - totalPnl)}원</span> 추가`),
      _ai('purple', `<b>운영 원칙</b> — [매수 즉시] 전 종목 손절1(×0.85)·손절2(×0.80)·익절(×1.20) 3주문 동시 설정 → [+20% 발동 후] 퇴근 후 잔량 트레일링 -12% 1회 추가`),
    ].filter(Boolean).join('');
    return `<div class="ai-sc">${_aiHdr('AI 분석 — 자동매도 전략 실행 가이드')}<div class="ai-list">${items}</div></div>`;
  })();

  // ── 전일 대비 HTML 섹션
  const prevFmt = prevDate || null; // 노션 날짜는 이미 YYYY-MM-DD 형식
  const diffSection = (() => {
    if (!diff || !prevFmt) return '';
    const { added, removed, changed } = diff;
    if (!added.length && !removed.length && !changed.length)
      return `<div class="sc"><div class="sc-title">전일(${prevFmt}) 대비 변동<span class="badge bdg-gray">변동없음</span></div><div class="sc-note">전일 대비 보유종목·수량·평균단가 변동 없음</div></div>`;

    const addedRows  = added.map(h =>
      `<tr><td class="l t-name">${esc(h.종목명)}</td><td class="t-pos">신규 매수</td><td class="c">${fN(h.보유수량)}주</td><td>${fN(h.평균단가)}원</td><td class="mob-hide">${fN(h.평균단가*h.보유수량)}원</td><td class="mob-hide">─</td><td class="mob-hide">─</td></tr>`
    ).join('');
    const removedRows = removed.map(h =>
      `<tr><td class="l t-name">${esc(h.종목명)}</td><td class="t-neg">매도/청산</td><td class="c">${fN(h.보유수량)}주</td><td>${fN(h.평균단가)}원</td><td class="mob-hide">${fN(h.평균단가*h.보유수량)}원</td><td class="mob-hide">─</td><td class="mob-hide">─</td></tr>`
    ).join('');
    const changedRows = changed.map(h => {
      const qDiff = h.수량변화 > 0 ? `<span class="t-pos">+${fN(h.수량변화)}</span>` : `<span class="t-neg">${fN(h.수량변화)}</span>`;
      const pDiff = h.단가변화 > 0 ? `<span class="t-pos">+${fN(Math.round(h.단가변화))}</span>` : `<span class="t-neg">${fN(Math.round(h.단가변화))}</span>`;
      const label = h.수량변화 > 0 ? '추가매수' : h.수량변화 < 0 ? '부분매도' : '평단변경';
      const cls   = h.수량변화 > 0 ? 't-pos' : h.수량변화 < 0 ? 't-neg' : 't-flat';
      return `<tr><td class="l t-name">${esc(h.종목명)}</td><td class="${cls}">${label}</td><td class="c">${fN(h.prev수량)} → ${fN(h.보유수량)}주 (${qDiff})</td><td>${fN(h.평균단가)}원</td><td class="mob-hide">${fN(h.평균단가*h.보유수량)}원</td><td class="mob-hide">${fN(h.prev단가)}원</td><td class="mob-hide">${pDiff}원</td></tr>`;
    }).join('');

    const addedCards  = added.map(h =>
      `<div class="stock-card" style="border-top:3px solid var(--teal)"><div class="sc-head"><span class="sc-name">${esc(h.종목명)}</span><span class="badge bdg-teal">신규매수</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">매수수량</span><span class="sc-item-v t-pos">${fN(h.보유수량)}주</span></div><div class="sc-item"><span class="sc-item-l">평균단가</span><span class="sc-item-v">${fN(h.평균단가)}원</span></div><div class="sc-item"><span class="sc-item-l">매입금액</span><span class="sc-item-v">${fN(h.평균단가*h.보유수량)}원</span></div></div></div>`
    ).join('');
    const removedCards = removed.map(h =>
      `<div class="stock-card" style="border-top:3px solid var(--blue)"><div class="sc-head"><span class="sc-name">${esc(h.종목명)}</span><span class="badge bdg-blue">매도/청산</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">매도수량</span><span class="sc-item-v t-neg">${fN(h.보유수량)}주</span></div><div class="sc-item"><span class="sc-item-l">평균단가</span><span class="sc-item-v">${fN(h.평균단가)}원</span></div><div class="sc-item"><span class="sc-item-l">매입금액</span><span class="sc-item-v">${fN(h.평균단가*h.보유수량)}원</span></div></div></div>`
    ).join('');
    const changedCards = changed.map(h => {
      const qDiff = h.수량변화 > 0 ? `<span class="t-pos">+${fN(h.수량변화)}</span>` : `<span class="t-neg">${fN(h.수량변화)}</span>`;
      const pDiff = h.단가변화 !== 0 ? (h.단가변화 > 0 ? `<span class="t-pos">+${fN(Math.round(h.단가변화))}</span>` : `<span class="t-neg">${fN(Math.round(h.단가변화))}</span>`) : '─';
      const label = h.수량변화 > 0 ? '추가매수' : h.수량변화 < 0 ? '부분매도' : '평단변경';
      const cls   = h.수량변화 > 0 ? 'bdg-teal' : h.수량변화 < 0 ? 'bdg-coral' : 'bdg-amber';
      return `<div class="stock-card"><div class="sc-head"><span class="sc-name">${esc(h.종목명)}</span><span class="badge ${cls}">${label}</span></div><div class="sc-grid"><div class="sc-item"><span class="sc-item-l">수량 변화</span><span class="sc-item-v">${fN(h.prev수량)} → ${fN(h.보유수량)}주 (${qDiff})</span></div><div class="sc-item"><span class="sc-item-l">현재 평단</span><span class="sc-item-v">${fN(h.평균단가)}원</span></div><div class="sc-item"><span class="sc-item-l">매입금액</span><span class="sc-item-v">${fN(h.평균단가*h.보유수량)}원</span></div><div class="sc-item"><span class="sc-item-l">전일 평단</span><span class="sc-item-v">${fN(h.prev단가)}원</span></div><div class="sc-item"><span class="sc-item-l">평단 변화</span><span class="sc-item-v">${pDiff}원</span></div></div></div>`;
    }).join('');

    const allRows  = addedRows + removedRows + changedRows;
    const allCards = addedCards + removedCards + changedCards;
    const badges   = [
      added.length   ? `<span class="badge bdg-teal">신규 ${added.length}종목</span>` : '',
      removed.length ? `<span class="badge bdg-blue">매도 ${removed.length}종목</span>` : '',
      changed.length ? `<span class="badge bdg-amber">변경 ${changed.length}종목</span>` : '',
    ].filter(Boolean).join(' ');

    return `<div class="sc">
  <div class="sc-title">전일(${prevFmt}) 대비 변동 ${badges}</div>
  <div class="sc-note">▪ 신규매수: 전일 미보유 → 오늘 신규 편입 &nbsp;▪ 매도/청산: 전일 보유 → 오늘 제외 &nbsp;▪ 변경: 수량 또는 평균단가 변동</div>
  <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c">구분</th><th>수량(변화)</th><th>평균단가</th><th class="mob-hide">매입금액</th><th class="mob-hide">전일평단</th><th class="mob-hide">평단변화</th></tr></thead><tbody>${allRows}</tbody></table></div>
  <div class="stock-cards">${allCards}</div>
</div>`;
  })();

  // ── CSS (괴리율분석 동일 디자인 시스템)
  const CSS = `:root{
  --sky:#378ADD;--sky50:#E6F1FB;--sky100:#B5D4F4;--sky600:#185FA5;--sky800:#0C447C;
  --teal:#1D9E75;--teal50:#E1F5EE;--teal600:#147a5a;
  --coral:#D85A30;--coral50:#FAECE7;
  --amber:#BA7517;--amber50:#FAEEDA;
  --green:#639922;--green50:#EAF3DE;
  --purple:#534AB7;--purple50:#EEEDFE;
  --red:#D8302F;--red50:#FBE9E8;--blue:#2563C9;--blue50:#E7EFFB;
  --gray50:#F1EFE8;--gray600:#5F5E5A;
  --bg:#F5F8FF;--card:#FFFFFF;--border:#E0EAF5;--border2:#EBF3FF;
  --txt:#1A2535;--txt2:#3D4F68;--txt3:#6B7E99;
  --r8:8px;--r12:12px;--r16:16px;--r20:20px;
  --shadow:0 2px 12px rgba(55,138,221,.08);--shadow-h:0 6px 24px rgba(55,138,221,.15);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;word-break:keep-all;color:var(--txt);background:var(--bg);-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;min-height:100dvh}
.hdr-wrap{position:fixed;top:0;left:0;right:0;z-index:50;box-shadow:0 2px 12px rgba(12,68,124,.18);user-select:none;-webkit-user-select:none}
.header{background:var(--sky800);padding:max(12px,env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;justify-content:space-between;max-width:1100px;margin:0 auto}
.header-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0;overflow:hidden}
.logo-mark{width:38px;height:38px;background:rgba(255,255,255,.15);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.logo-mark svg{display:block}
.logo-info{display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden}
.logo-title{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logo-sub{font-size:11.5px;color:rgba(255,255,255,.90);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;margin-left:10px}
.hdr-date{font-size:12.5px;font-weight:700;color:#fff;white-space:nowrap}
.hdr-meta{font-size:11px;color:rgba(255,255,255,.88);white-space:nowrap}
.nav-spacer{height:calc(104px + env(safe-area-inset-top,0px))}
.top-nav{background:#fff;border-bottom:1.5px solid var(--border);display:flex;padding:0 4px;max-width:1100px;margin:0 auto;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.top-nav::-webkit-scrollbar{display:none}
.tab-btn{flex:1;flex-shrink:0;min-width:64px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--txt);font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;padding:13px 6px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:color .15s;position:relative;white-space:nowrap;pointer-events:auto;user-select:none;-webkit-user-select:none}
.tab-btn.on{color:var(--sky600)}
.tab-btn.on::after{content:'';position:absolute;bottom:0;left:8%;right:8%;height:2.5px;background:var(--sky);border-radius:2px 2px 0 0}
.tab-btn:hover:not(.on){color:var(--txt)}
.tab-badge{display:inline-flex;align-items:center;justify-content:center;background:var(--sky100);color:var(--sky800);font-size:11.5px;font-weight:800;border-radius:9px;padding:1px 6px;margin-left:4px;min-width:18px}
.tab-btn.on .tab-badge{background:var(--sky);color:#fff}
.main{padding:0 14px max(14px,env(safe-area-inset-bottom))}
.panel{display:none}
.panel.on{display:block;animation:fade .22s}
@keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.kpi-row{display:flex;gap:9px;margin-bottom:14px;padding-top:10px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:80px;background:var(--card);border:1px solid var(--border);border-radius:var(--r12);padding:12px 10px;text-align:center;box-shadow:var(--shadow)}
.kpi-card .num{font-size:20px;font-weight:800;line-height:1.1}
.kpi-card .lbl{font-size:13px;margin-top:4px;font-weight:700;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi-sky .num,.kpi-sky .lbl{color:var(--sky600)}
.kpi-red .num,.kpi-red .lbl{color:var(--red)}
.kpi-blue .num,.kpi-blue .lbl{color:var(--blue)}
.kpi-coral .num,.kpi-coral .lbl{color:var(--coral)}
.kpi-teal .num,.kpi-teal .lbl{color:var(--teal600)}
.kpi-amber .num,.kpi-amber .lbl{color:var(--amber)}
.kpi-purple .num,.kpi-purple .lbl{color:var(--purple)}
.kpi-pnl-pos .num,.kpi-pnl-pos .lbl{color:var(--red)}
.kpi-pnl-neg .num,.kpi-pnl-neg .lbl{color:var(--blue)}
.sc{background:var(--card);border-radius:var(--r12);border:1px solid var(--border);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.sc-title{font-size:14.5px;font-weight:800;color:var(--txt);margin-bottom:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.sc-title .sub{font-size:12px;font-weight:600;color:var(--txt2)}
.badge{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap}
.bdg-red{background:var(--red50);color:var(--red)}
.bdg-blue{background:var(--blue50);color:var(--blue)}
.bdg-sky{background:var(--sky50);color:var(--sky600)}
.bdg-teal{background:var(--teal50);color:var(--teal600)}
.bdg-amber{background:var(--amber50);color:var(--amber)}
.bdg-coral{background:var(--coral50);color:var(--coral)}
.bdg-gray{background:var(--gray50);color:var(--gray600)}.bdg-purple{background:var(--purple50);color:var(--purple)}
.env-overview{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0 2px}
.env-zone{flex:1;min-width:78px;text-align:center;padding:9px 6px;border-radius:var(--r8)}
.env-zone-label{font-size:11px;font-weight:700;margin-bottom:3px}
.env-zone-val{font-size:12px;font-weight:800}
.env-arrow{color:var(--txt2);font-weight:700;font-size:16px;flex-shrink:0}
.env-buy{background:var(--blue50);border:1.5px solid var(--blue)}.env-buy .env-zone-label,.env-buy .env-zone-val{color:var(--blue)}
.env-rec{background:var(--amber50);border:1.5px solid var(--amber)}.env-rec .env-zone-label,.env-rec .env-zone-val{color:var(--amber)}
.env-r1{background:var(--teal50);border:1.5px solid var(--teal600)}.env-r1 .env-zone-label,.env-r1 .env-zone-val{color:var(--teal600)}
.env-r2{background:var(--purple50);border:1.5px solid var(--purple)}.env-r2 .env-zone-label,.env-r2 .env-zone-val{color:var(--purple)}
.sc-note{font-size:12.5px;color:var(--txt);margin-bottom:12px;line-height:1.6;padding:8px 10px;background:var(--bg);border-radius:var(--r8)}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r8);overscroll-behavior-x:contain}
table{min-width:100%;border-collapse:collapse;font-size:13.5px}
thead th{background:var(--sky50);color:var(--sky800);font-weight:800;font-size:12.5px;padding:9px 8px;text-align:right;white-space:nowrap}
thead th.l{text-align:left}thead th.c{text-align:center}
tbody td{padding:9px 8px;border-bottom:1px solid var(--border2);text-align:right;white-space:nowrap;color:var(--txt);vertical-align:middle}
tbody td.l{text-align:left}tbody td.c{text-align:center}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--sky50)}
.t-rank{font-weight:800;color:var(--txt2)}.t-name{font-weight:700;font-size:14px}.t-mkt{font-size:12px;color:var(--txt);font-weight:600}
.t-neg-hi{color:var(--blue);font-weight:800}.t-neg{color:var(--blue);font-weight:700}.t-pos{color:var(--red);font-weight:800}.t-flat{color:var(--txt2);font-weight:600}
.t-price{font-weight:700}.t-days{font-weight:700;color:var(--purple)}
.stock-cards{display:none}
.stock-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:13px 14px;margin-bottom:10px}
.stock-card:last-child{margin-bottom:0}
.sc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sc-name{font-size:15px;font-weight:800;color:var(--txt)}
.sc-ratio{font-size:17px;font-weight:900}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
.sc-item{display:flex;flex-direction:column;gap:1px}
.sc-item-l{font-size:12.5px;color:var(--txt);font-weight:700}
.sc-item-v{font-size:14px;font-weight:700;color:var(--txt)}.sc-full{grid-column:1/-1}
.pnl-banner{border-radius:var(--r12);padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700}
.pnl-pos{background:var(--red50);border:1.5px solid var(--red);color:var(--red)}
.pnl-neg{background:var(--blue50);border:1.5px solid var(--blue);color:var(--blue)}
.empty{text-align:center;padding:40px 20px;color:var(--txt2)}
.empty .msg{font-size:14px;font-weight:700;color:var(--txt2)}
.footer{margin-top:20px;font-size:12px;color:var(--txt2);text-align:center;padding:12px 0 24px;border-top:1px solid var(--border)}
@media(max-width:374px){.logo-sub{display:none}.tab-btn{font-size:12px;padding:11px 2px;min-width:52px}.tab-badge{display:none}.kpi-card{min-width:60px;padding:8px 4px}.kpi-card .num{font-size:16px}.kpi-card .lbl{font-size:11px}}
@media(max-width:600px){.nav-spacer{height:calc(108px + env(safe-area-inset-top,0px))}.main{padding:0 10px max(20px,env(safe-area-inset-bottom))}.sc{padding:12px 12px}.sc-title{font-size:14px;gap:5px}.kpi-row{gap:6px;padding-top:8px;margin-bottom:12px}.kpi-card{min-width:64px;padding:9px 6px}.kpi-card .num{font-size:19px}.kpi-card .lbl{font-size:12.5px;margin-top:3px}.tab-btn{font-size:13px;padding:12px 4px}table{font-size:12.5px}thead th,tbody td{padding:8px 5px}.t-name{font-size:13.5px}.stock-cards{display:block}.stock-cards-target{display:none}.mob-hide{display:none!important}}
@media(min-width:601px) and (max-width:900px){.kpi-card .num{font-size:20px}}
@media(min-width:769px){.nav-spacer{height:calc(106px + env(safe-area-inset-top,0px))}.main{padding:0 20px max(20px,env(safe-area-inset-bottom))}.sc{padding:18px 20px}.sc-title{font-size:15px;margin-bottom:14px}.kpi-card{padding:13px 16px}.kpi-card .num{font-size:22px}.kpi-card .lbl{font-size:13px;margin-top:5px}table{font-size:14px}thead th{font-size:13px}thead th,tbody td{padding:10px 9px}.tab-btn{font-size:14px}}
@media(min-width:1024px){.kpi-row{gap:12px}.kpi-card .num{font-size:24px}}
.ai-sc{background:linear-gradient(135deg,var(--sky50) 0%,var(--card) 100%);border:1px solid var(--sky100);border-left:4px solid var(--sky);border-radius:var(--r12);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}.ai-title{font-size:14.5px;font-weight:800;color:var(--sky800);margin-bottom:12px;display:flex;align-items:center;gap:8px}.ai-badge{margin-left:auto}.ai-list{display:flex;flex-direction:column;gap:7px}.ai-item{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--txt);line-height:1.55}.ai-dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:8px}.ai-dot-red{background:var(--red)}.ai-dot-teal{background:var(--teal)}.ai-dot-sky{background:var(--sky)}.ai-dot-amber{background:var(--amber)}.ai-dot-purple{background:var(--purple)}.ai-dot-blue{background:var(--blue)}
.summary-sc{border-left:3px solid var(--sky);padding-left:12px;margin-bottom:14px}.summary-line{font-size:13.5px;color:var(--txt);line-height:1.8;margin-bottom:2px}.summary-line b{font-weight:800;color:var(--txt)}.summary-line .hi{color:var(--blue);font-weight:700}.summary-line .ok{color:var(--red);font-weight:700}
.ts-stop{font-weight:800;color:var(--purple)}.ts-active td{background:rgba(216,48,47,.04)}.ts-active-card{border-left:3px solid var(--red)!important}`;

  // ── HTML 조립
  const pnlBanner = `<div class="pnl-banner ${totalPct>=0?'pnl-pos':'pnl-neg'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${totalPct>=0?'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>':'<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/>'}</svg>총 손익 <b>${totalPnl>=0?'+':''}${fN(totalPnl)}원</b> (<b>${fP(totalPct)}</b>)</div>`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>보유종목 분석 — ${latestFmt}</title>
<link rel="preload" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.css"></noscript>
<style>${CSS}</style>
</head>
<body>
<div class="hdr-wrap"><div class="wrap">
<div class="header">
  <div class="header-left">
    <div class="logo-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><polyline points="7 10 10 7 13 10 17 6"/></svg></div>
    <div class="logo-info"><div class="logo-title">보유종목 분석</div><div class="logo-sub">${latestFmt} 기준 · 노션 보유종목DB · 괴리율 종가 기준</div></div>
  </div>
  <div class="header-right"><div class="hdr-date">${latestFmt} 기준</div><div class="hdr-meta">보유 ${allR.length}종목 · MA20 엔벨로프</div></div>
</div>
<nav class="top-nav">
  <button class="tab-btn on" data-tab="0">요약</button>
  <button class="tab-btn" data-tab="1">종목상세<span class="tab-badge">${validR.length}</span></button>
  <button class="tab-btn" data-tab="2">엔벨로프</button>
  <button class="tab-btn" data-tab="3">트레일링스탑</button>
</nav>
</div></div>
<div class="nav-spacer"></div>
<div class="wrap"><div class="main">

<!-- ── Panel 0: 요약 ── -->
<div class="panel on" id="p0">
  <div class="kpi-row">
    <div class="kpi-card ${totalPct>=0?'kpi-pnl-pos':'kpi-pnl-neg'}"><div class="num">${totalPct>=0?'+':''}${totalPct.toFixed(1)}%</div><div class="lbl">포트수익률</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${validR.length}</div><div class="lbl">보유종목</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${profitCnt}</div><div class="lbl">수익종목</div></div>
    <div class="kpi-card kpi-red"><div class="num">${lossCnt}</div><div class="lbl">손실종목</div></div>
    <div class="kpi-card kpi-purple"><div class="num">${second2.length}</div><div class="lbl">2차달성</div></div>
  </div>
  ${pnlBanner}
  ${diffSection}
  <div class="sc">
    <div class="sc-title">${latestFmt} 보유종목 현황<span class="badge bdg-sky">${validR.length}종목</span></div>
    <div class="sc-note">수익률 = 평균단가 대비 현재가 기준 · MA20괴리율 = 종가 vs 20거래일 이동평균(종가 기준)</div>
    ${validR.length ? `<div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>수익률</th><th>MA20괴리율</th><th class="c">단계</th></tr></thead><tbody>${p0Rows}</tbody></table></div><div class="stock-cards">${p0Cards}</div>` : '<div class="empty"><div class="msg">데이터 없음</div></div>'}
  </div>
  ${aiCard0}
</div>

<!-- ── Panel 1: 종목별 상세 ── -->
<div class="panel" id="p1">
  <div class="kpi-row">
    <div class="kpi-card ${totalPct>=0?'kpi-pnl-pos':'kpi-pnl-neg'}"><div class="num">${totalPct>=0?'+':''}${totalPct.toFixed(1)}%</div><div class="lbl">포트수익률</div></div>
    <div class="kpi-card ${profitCnt>lossCnt?'kpi-teal':'kpi-red'}"><div class="num">${profitCnt}/${validR.length}</div><div class="lbl">수익/전체</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${fN(totalValue)}</div><div class="lbl">총평가(원)</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">종목별 상세<span class="sub">· 수익률순 정렬</span></div>
    <div class="sc-note">▪ 수익금액 = 평가금액 − 투자금액 &nbsp;▪ MA20 = 최근 20거래일 종가 평균 &nbsp;▪ 색상: 빨강=수익, 파랑=손실</div>
    ${validR.length ? `<div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="c mob-hide">수량</th><th class="mob-hide">평균단가</th><th>현재가</th><th class="mob-hide">평가금액</th><th>수익금액</th><th>수익률</th><th class="mob-hide">MA20</th><th>MA20괴리율</th><th class="c mob-hide">단계</th></tr></thead><tbody>${p1Rows}</tbody></table></div><div class="stock-cards">${p1Cards}</div>` : '<div class="empty"><div class="msg">데이터 없음</div></div>'}
  </div>
</div>

<!-- ── Panel 2: 엔벨로프 ── -->
<div class="panel" id="p2">
  <div class="kpi-row">
    <div class="kpi-card kpi-blue"><div class="num">${buyZone.length}</div><div class="lbl">매수구간</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${recovering.length}</div><div class="lbl">회복중</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${first1.length}</div><div class="lbl">1차달성</div></div>
    <div class="kpi-card kpi-purple"><div class="num">${second2.length}</div><div class="lbl">2차달성</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">엔벨로프 전략 개요<span class="badge bdg-sky">MA20 기준</span></div>
    <div class="env-overview">
      <div class="env-zone env-buy"><div class="env-zone-label">매수구간</div><div class="env-zone-val">MA20 −20% 이하</div></div>
      <div class="env-arrow">→</div>
      <div class="env-zone env-rec"><div class="env-zone-label">회복 중</div><div class="env-zone-val">MA20 −20%~0%</div></div>
      <div class="env-arrow">→</div>
      <div class="env-zone env-r1"><div class="env-zone-label">1차 저항</div><div class="env-zone-val">MA20 (0%)</div></div>
      <div class="env-arrow">→</div>
      <div class="env-zone env-r2"><div class="env-zone-label">2차 저항/목표</div><div class="env-zone-val">MA20 +20%</div></div>
    </div>
    <div class="sc-note" style="margin-top:10px">▪ 1차 목표가 = MA20 &nbsp;▪ 2차 목표가 = MA20 × 1.2 &nbsp;▪ 수익률은 평균단가 대비 달성 시 예상치</div>
  </div>
  ${buyZone.length ? `<div class="sc"><div class="sc-title">【매수구간】 1·2차 목표 시나리오<span class="badge bdg-blue">${buyZone.length}종목</span></div><div class="sc-note">MA20 −20% 이하 이탈 — 엔벨로프 최적 매수 타점 구간. 1차 목표(MA20) 및 2차 목표(MA20+20%) 달성 시 예상 수익률.</div><div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>MA20괴리율</th><th class="mob-hide">평단대비</th><th class="mob-hide">1차목표(MA20)</th><th class="mob-hide">1차까지+%</th><th class="mob-hide">1차평단수익</th><th class="mob-hide">2차목표</th><th>2차까지+%</th><th>2차평단수익</th></tr></thead><tbody>${p2BuyRows}</tbody></table></div><div class="stock-cards">${p2BuyCards}</div></div>` : ''}
  ${recovering.length ? `<div class="sc"><div class="sc-title">【회복 중】 MA20 회복 진행 현황<span class="badge bdg-amber">${recovering.length}종목</span></div><div class="sc-note">MA20 −20%~0% 구간. MA20 종가 돌파 시 1차달성 전환.</div><div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>MA20괴리율</th><th>평단대비</th><th class="mob-hide">1차목표(MA20)</th><th class="mob-hide">1차까지+%</th><th class="mob-hide">2차목표</th><th>2차까지+%</th></tr></thead><tbody>${p2RecRows}</tbody></table></div><div class="stock-cards">${p2RecCards}</div></div>` : ''}
  ${first1.length ? `<div class="sc"><div class="sc-title">【1차달성 → 2차 목표 추적】<span class="badge bdg-teal">${first1.length}종목</span></div><div class="sc-note">MA20 상향 돌파 완료. 2차 목표(MA20+20%) 달성 시 예상 수익률 및 손익금액.</div><div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>MA20괴리율</th><th>평단수익률</th><th class="mob-hide">2차목표</th><th>2차까지+%</th><th>2차평단수익</th><th class="mob-hide">2차달성시손익</th></tr></thead><tbody>${p2FirstRows}</tbody></table></div><div class="stock-cards">${p2FirstCards}</div></div>` : ''}
  ${second2.length ? `<div class="sc"><div class="sc-title">【2차달성 완료】 익절 고려 구간<span class="badge bdg-purple">${second2.length}종목</span></div><div class="sc-note">MA20+20% 초과 달성. 엔벨로프 최종 목표가 도달 — 수익 실현 또는 트레일링 스탑 설정 권고.</div><div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>MA20괴리율</th><th>평단수익률</th><th>수익금액</th><th>2차기준수익</th></tr></thead><tbody>${p2SecRows}</tbody></table></div><div class="stock-cards">${p2SecCards}</div></div>` : ''}
  ${!buyZone.length && !recovering.length && !first1.length && !second2.length ? '<div class="empty"><div class="msg">엔벨로프 분석 데이터 없음</div></div>' : ''}
  ${aiCard2}
</div>

<!-- ── Panel 3: 트레일링스탑 ── -->
<div class="panel" id="p3">
  <div class="kpi-row">
    <div class="kpi-card kpi-red"><div class="num">${slDanger}</div><div class="lbl">손절주의</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${ptTriggered}</div><div class="lbl">익절발동가능</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${ptNear}</div><div class="lbl">익절근접(10%)</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${validR.length - slDanger - ptTriggered}</div><div class="lbl">대기중</div></div>
  </div>
  <div class="sc">
    <div class="sc-title">트레일링스탑 현황<span class="sub">· 발동중 우선 · 1차 근접 순</span></div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th class="mob-hide">MA20괴리율</th><th class="mob-hide">1차(MA20)</th><th>1차</th><th class="mob-hide">2차목표</th><th>2차</th><th class="mob-hide c">돌파</th><th class="mob-hide">이론스탑가</th><th class="c">상태</th></tr></thead><tbody>${p3StatusRows}</tbody></table></div>
    <div class="stock-cards">${p3StatusCards}</div>
  </div>
  <div class="sc">
    <div class="sc-title">수동매도 시나리오<span class="sub">· 1차(MA20) 50% → 2차(MA20+20%) 잔량 전량</span></div>
    <div class="sc-note">▪ 전략완료 총수익 = 1차(50%) + 2차(잔량 전량) 합산 &nbsp;▪ 수량은 소수점 버림(절사)</div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="mob-hide">1차(MA20)</th><th class="c mob-hide">1차수량</th><th>1차수익금</th><th class="mob-hide">2차(MA20+20%)</th><th class="c mob-hide">2차수량</th><th>2차수익금</th><th>전략완료 총수익</th></tr></thead><tbody>${p3ScenRows}</tbody></table></div>
    <div class="stock-cards">${p3ScenCards}</div>
  </div>
  <div class="sc">
    <div class="sc-title">HTS 주문 설정 가이드<span class="sub">· 손절주의 우선 순</span></div>
    <div class="sc-note">▪ 매수 즉시 아래 3가지 주문을 동시 설정 &nbsp;▪ 손절1 도달 시 50% 자동청산, 손절2로 잔량 보호 &nbsp;▪ 익절 도달 시 50% 확정 후 잔량에 트레일링 추가</div>
    <div class="tbl-wrap stock-cards-target"><table><thead><tr><th class="l">종목명</th><th class="mob-hide">평균단가</th><th>손절1 (-15%)</th><th class="mob-hide">손절2 (-20%)</th><th class="mob-hide c">손절수량</th><th>익절가 (+20%)</th><th class="mob-hide c">익절수량</th><th class="mob-hide">트레일링</th></tr></thead><tbody>${orderRows}</tbody></table></div>
    <div class="stock-cards">${orderCards}</div>
  </div>
  <div class="sc">
    <div class="sc-title">자동매도 전략 — HTS 주문 설정<span class="badge bdg-sky">방치형</span></div>
    <div class="sc-note">
      ▪ <b>① 익절</b>: 매입가 +20% 도달 → 50% 즉시 자동매도 &nbsp;
      ▪ <b>② 트레일링</b>: 익절 발동 후 잔량 50%에 고점 대비 -12% 트레일링 설정 (퇴근 후 1회) → 전량매도<br>
      ▪ <b>③ 손절1</b>: 매입가 -15% 도달 → 50% 자동매도 &nbsp;
      ▪ <b>④ 손절2</b>: 매입가 -20% 도달 → 잔량 전량 자동매도<br>
      ▪ +20% ≈ MA20 도달 (MA20 −20% 매수구간 기준) · 전 종목 동일 적용
    </div>
  </div>
  <div class="sc">
    <div class="sc-title">수동 매도 전략 — MA20 엔벨로프 기반<span class="badge bdg-amber">매일 리포트 확인</span></div>
    <div class="sc-note">
      ▪ <b>① 1차 매도</b>: MA20 도달 시 보유수량 50% 분할매도 &nbsp;
      ▪ <b>② 2차 매도</b>: MA20+20% 도달 시 잔량 전량 매도<br>
      ▪ 매일 리포트 확인 후 도달 종목 수동 매도 · 자동매도 전략(HTS)과 상호보완 운영
    </div>
  </div>
  ${aiCardTrail}
</div>

</div></div>
<div class="footer">holdings_report.mjs · 노션 보유종목DB · KIS + KRX + Yahoo Finance · ${latestFmt} 기준 · MA20괴리율 종가 기준</div>
<script>
function showTab(i){
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('on',j===i));
  document.querySelectorAll('.tab-btn').forEach((t,j)=>t.classList.toggle('on',j===i));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    showTab(parseInt(this.dataset.tab));
  });
});
</script>
</body></html>`;

  const savePath = `C:/Users/shinf/workspace/data/analysis/보유종목분석_${ts}.html`;
  try {
    fs.writeFileSync(savePath, html, 'utf-8');
    console.log(`\n[HTML] 저장 완료: ${savePath}`);
  } catch(err) {
    console.error(`[HTML] 저장 실패: ${err.message}`);
  }
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
