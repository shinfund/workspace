/**
 * yahoo_api.mjs — Yahoo Finance 주식 시세 조회
 * KRX 유니버스(코드·시장명) + Yahoo Finance 시세 (당일·과거 모두 지원)
 *
 * Usage:
 *   node yahoo_api.mjs [YYYYMMDD] [--date YYYYMMDD]
 *     [--sort trade|rise|fall|volume]   (default: trade)
 *     [--market kospi|kosdaq|all]       (default: all)
 *     [--top N]                         (default: 10)
 *     [--universe N]                    (Yahoo 조회 종목수, default: 250)
 *     [--code 005930,000660,...]        (개별 코드 직접 지정, 쉼표 구분)
 *     [--all]                           (모든 정렬 동시 출력)
 *
 * stdout: JSON / stderr: 터미널 테이블
 */

import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'krx_universe_cache.json');
const CACHE_TTL_MS = 6 * 3600 * 1000; // 6시간

const KRX_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const KRX_HOST = 'apis.data.go.kr';
const KRX_PATH = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';

const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999);
}
const PREF_RE = /우[BCbc]?$/;

const SORTS = {
  trade:  { label:'거래대금',  fn:(a,b)=>b.거래대금-a.거래대금 },
  rise:   { label:'상승률',    fn:(a,b)=>b.등락률-a.등락률     },
  fall:   { label:'하락률',    fn:(a,b)=>a.등락률-b.등락률     },
  volume: { label:'거래량',    fn:(a,b)=>b.거래량-a.거래량     },
};
const MKT_LABEL = { all:'전체(KOSPI+KOSDAQ)', kospi:'KOSPI', kosdaq:'KOSDAQ' };
const TERM_W = parseInt(process.env.COLUMNS||'0') || process.stderr.columns || process.stdout.columns || 160;
const USE_COLOR = process.stderr.isTTY || false;
const RED  = USE_COLOR ? '\x1b[31m' : '';
const BLUE = USE_COLOR ? '\x1b[34m' : '';
const GRAY = USE_COLOR ? '\x1b[90m' : '';
const RST  = USE_COLOR ? '\x1b[0m'  : '';

// ─── CLI 파싱 ─────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { date:null, sort:'trade', market:'all', top:10, universe:250, all:false, codes:[] };
  for (let i=0; i<argv.length; i++) {
    if (/^\d{8}$/.test(argv[i]))   { o.date      = argv[i];                   continue; }
    if (argv[i]==='--date')         { o.date      = argv[++i];                 continue; }
    if (argv[i]==='--sort')         { o.sort      = argv[++i];                 continue; }
    if (argv[i]==='--market')       { o.market    = argv[++i].toLowerCase();   continue; }
    if (argv[i]==='--top')          { o.top       = parseInt(argv[++i]);       continue; }
    if (argv[i]==='--universe')     { o.universe  = parseInt(argv[++i]);       continue; }
    if (argv[i]==='--all')          { o.all       = true;                      continue; }
    if (argv[i]==='--code')         { o.codes     = argv[++i].split(',').map(c=>c.trim()); continue; }
  }
  return o;
}

// ─── 날짜 유틸 ───────────────────────────────────────────
function kstYesterday() {
  const d = new Date(Date.now() + 9*3600*1000);
  d.setUTCDate(d.getUTCDate()-1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

// YYYYMMDD → {p1, p2} Unix (KST 해당일 + 10일 이전 범위)
function dateRange(yyyymmdd) {
  const y=yyyymmdd.slice(0,4), m=yyyymmdd.slice(4,6), d=yyyymmdd.slice(6,8);
  const endMs   = new Date(`${y}-${m}-${d}T23:59:59+09:00`).getTime();
  const startMs = endMs - 14*24*3600*1000; // 14일 이전 (전일 종가 확보)
  return { p1: Math.floor(startMs/1000), p2: Math.floor(endMs/1000) };
}

// Unix timestamp → KST YYYYMMDD
function tsToKstDate(ts) {
  const d = new Date((ts + 9*3600)*1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

// ─── HTTP ────────────────────────────────────────────────
function httpGet(url, headers={}) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch(e) { rej(new Error(`파싱실패: ${d.slice(0,100)}`)); }
      });
    });
    req.on('error', rej);
    req.setTimeout(12000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

// ─── KRX 유니버스 조회 ───────────────────────────────────
async function fetchKrxUniverse(maxStocks) {
  // 전 종목 2페이지 조회
  async function fetchPage(basDd, pageNo) {
    const url = `https://${KRX_HOST}${KRX_PATH}?serviceKey=${KRX_KEY}&numOfRows=2000&pageNo=${pageNo}&resultType=json&basDt=${basDd}`;
    return httpGet(url);
  }

  let date = kstYesterday();
  for (let tries=0; tries<10; tries++) {
    process.stderr.write(`[KRX] ${date} 유니버스 조회...\n`);
    const d1 = await fetchPage(date, 1);
    const items1 = d1?.response?.body?.items?.item || [];
    if (items1.length === 0) {
      const prev = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
      prev.setDate(prev.getDate()-1);
      date = `${prev.getFullYear()}${String(prev.getMonth()+1).padStart(2,'0')}${String(prev.getDate()).padStart(2,'0')}`;
      continue;
    }
    const d2 = await fetchPage(date, 2);
    const items2 = d2?.response?.body?.items?.item || [];
    const all = [...items1, ...items2];

    // ETF·우선주 제거 + 시장 추출
    const filtered = all
      .filter(it => {
        const name = it.itmsNm||'';
        const code = parseInt(it.srtnCd||'0', 10);
        if (ETF_RE.test(name)) return false;
        if (isEtfCode(code))   return false;
        if (PREF_RE.test(name)) return false;
        return true;
      })
      .map(it => ({
        code:   it.srtnCd,
        name:   it.itmsNm,
        market: it.mrktCtg === 'KOSPI' ? 'KOSPI' : 'KOSDAQ',
        krxTrade: parseInt(it.trPrc||'0', 10),  // KRX 기준 거래대금 (유니버스 우선순위용)
      }));

    // 거래대금 기준 정렬 후 maxStocks개 추출 (가장 중요한 종목 우선)
    filtered.sort((a,b) => b.krxTrade - a.krxTrade);
    const universe = filtered.slice(0, maxStocks);
    process.stderr.write(`[KRX] ${date} — 필터 후 ${filtered.length}종목 중 상위 ${universe.length}종목 선택\n`);
    return universe;
  }
  throw new Error('KRX 유니버스 조회 실패');
}

// ─── KRX 유니버스 캐시 래퍼 ─────────────────────────────
async function loadKrxUniverse(maxStocks) {
  // 캐시 읽기 시도
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS) {
      process.stderr.write(`[KRX캐시] ${cache.date} 유니버스 캐시 사용 (${cache.stocks.length}종목)\n`);
      return cache.stocks.slice(0, maxStocks);
    }
  } catch { /* cache miss */ }

  // 캐시 miss — 전체 종목 조회 후 저장
  const stocks = await fetchKrxUniverse(9999);
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), date: kstYesterday(), stocks }), 'utf8');
    process.stderr.write(`[KRX캐시] 저장 완료 (${stocks.length}종목)\n`);
  } catch (e) {
    process.stderr.write(`[캐시 저장 실패] ${e.message}\n`);
  }
  return stocks.slice(0, maxStocks);
}

// ─── Yahoo Finance v8 chart API ──────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

async function fetchYahoo(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGet(url, YF_HEADERS);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q  = result.indicators?.quote?.[0] || {};
      return { ts, open:q.open||[], high:q.high||[], low:q.low||[], close:q.close||[], volume:q.volume||[] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

// ─── 배치 처리 ───────────────────────────────────────────
async function batchAll(items, fn, concurrency=10, delay=80) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      if (delay) await new Promise(r => setTimeout(r, delay));
    }
  }
  await Promise.all(Array.from({length: concurrency}, worker));
  return results;
}

// ─── 포맷 유틸 ───────────────────────────────────────────
function col(s, w, align='l') {
  const str = String(s ?? '');
  const len = [...str].reduce((a,c) => a + (c.codePointAt(0) > 127 ? 2 : 1), 0);
  const pad = Math.max(0, w - len);
  return align === 'r' ? ' '.repeat(pad) + str : str + ' '.repeat(pad);
}
function fmtRate(v) {
  if (v == null || isNaN(v)) return '  -  ';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtAmt(v) {
  if (!v) return '-';
  if (v >= 1e12) return `${(v/1e12).toFixed(1)}조`;
  return `${Math.round(v/1e8)}억`;
}
function fmtVol(v) { return v ? `${Math.round(v/1e4)}만` : '-'; }
function fmtPrice(v) { return v ? v.toLocaleString('ko-KR') : '-'; }
function candle(o, c) {
  if (c > o) return `${RED}▲${RST}`;
  if (c < o) return `${BLUE}▼${RST}`;
  return '─';
}
function colorRate(str, v) {
  if (v > 0) return `${RED}${str}${RST}`;
  if (v < 0) return `${BLUE}${str}${RST}`;
  return str;
}

// ─── 테이블 출력 ─────────────────────────────────────────
function printTable(rows, sortLabel, targetDate, market) {
  const label   = MKT_LABEL[market] || market;
  const dateFmt = `${targetDate.slice(0,4)}-${targetDate.slice(4,6)}-${targetDate.slice(6,8)}`;
  const COMPACT  = TERM_W < 160;

  process.stderr.write(`\n━━━ ${label} ${sortLabel} TOP ${rows.length}  [${dateFmt}]  (출처: Yahoo Finance) ━━━\n`);

  // [표1] 수급·규모
  process.stderr.write('\n[표1] 수급·규모\n');
  if (COMPACT) {
    process.stderr.write(` ${'#'.padStart(2)}  ${'코드'.padEnd(6)}  ${'종목명'.padEnd(14)}  ${'종가'.padStart(10)}  ${'등락률'.padStart(8)}  ${'거래대금'.padStart(10)}\n`);
    process.stderr.write(`${'─'.repeat(60)}\n`);
    rows.forEach((r, i) => {
      process.stderr.write(
        ` ${String(i+1).padStart(2)}  ${col(r.code,6)}  ${col(r.name,14)}  ${col(fmtPrice(r.종가),10,'r')}  ${colorRate(col(fmtRate(r.등락률),8,'r'), r.등락률)}  ${col(fmtAmt(r.거래대금),10,'r')}\n`
      );
    });
  } else {
    process.stderr.write(` ${'#'.padStart(2)}  ${'코드'.padEnd(6)}  ${'종목명'.padEnd(16)}  ${'종가'.padStart(12)}  ${'등락률'.padStart(8)}  ${'거래량(만)'.padStart(10)}  ${'거래대금'.padStart(12)}  ${'시장'.padEnd(6)}\n`);
    process.stderr.write(`${'─'.repeat(80)}\n`);
    rows.forEach((r, i) => {
      process.stderr.write(
        ` ${String(i+1).padStart(2)}  ${col(r.code,6)}  ${col(r.name,16)}  ${col(fmtPrice(r.종가),12,'r')}  ${colorRate(col(fmtRate(r.등락률),8,'r'), r.등락률)}  ${col(fmtVol(r.거래량),10,'r')}  ${col(fmtAmt(r.거래대금),12,'r')}  ${col(r.market,6)}\n`
      );
    });
  }

  // [표2] 가격흐름 (OHLC)
  process.stderr.write('\n[표2] 가격흐름 (OHLC)\n');
  process.stderr.write(` ${'#'.padStart(2)}  ${'종목명'.padEnd(16)}  캔  ${'시가'.padStart(12)}  ${'고가'.padStart(12)}  ${'저가'.padStart(12)}  ${'종가'.padStart(12)}  ${'변동폭'.padStart(7)}\n`);
  process.stderr.write(`${'─'.repeat(88)}\n`);
  rows.forEach((r, i) => {
    const c     = candle(r.시가, r.종가);
    const range = r.고가 && r.저가 ? `${((r.고가-r.저가)/r.저가*100).toFixed(1)}%` : '-';
    process.stderr.write(
      ` ${String(i+1).padStart(2)}  ${col(r.name,16)}  ${c}  ${col(fmtPrice(r.시가),12,'r')}  ${col(fmtPrice(r.고가),12,'r')}  ${col(fmtPrice(r.저가),12,'r')}  ${col(fmtPrice(r.종가),12,'r')}  ${col(range,7,'r')}\n`
    );
  });

  process.stderr.write(`\n  ${GRAY}※ 거래대금은 종가×거래량 근사값 (KRX 확정값과 미세 차이 가능)${RST}\n`);
}

// ─── 메인 ────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const targetDate = opts.date || kstYesterday();
  const { p1, p2 } = dateRange(targetDate);
  const dateFmt = `${targetDate.slice(0,4)}-${targetDate.slice(4,6)}-${targetDate.slice(6,8)}`;

  process.stderr.write(`[Yahoo Finance] 조회 날짜: ${dateFmt}\n`);

  let universe;

  if (opts.codes.length > 0) {
    // --code 직접 지정 모드 — KRX 유니버스에서 이름·시장 조회
    const allStocks = await loadKrxUniverse(9999);
    const codeMap = new Map(allStocks.map(s => [s.code, s]));
    universe = opts.codes.map(c => {
      const padded = c.padStart(6, '0');
      const found = codeMap.get(padded);
      return found ? { ...found } : { code: padded, name: padded, market: null, krxTrade: 0 };
    });
    process.stderr.write(`[개별] ${universe.length}종목 직접 조회\n`);
  } else {
    // KRX 유니버스 기반
    universe = await loadKrxUniverse(opts.universe);
    if (opts.market !== 'all') {
      universe = universe.filter(s => s.market.toLowerCase() === opts.market);
    }
  }

  // Yahoo Finance 조회
  process.stderr.write(`[Yahoo] ${universe.length}종목 조회 중 (10개 동시)...\n`);
  let done = 0;

  const results = await batchAll(universe, async (stock) => {
    let yf = null;

    if (stock.market === null) {
      // --code 모드 매핑 실패: .KS → .KQ 순서로 시도
      yf = await fetchYahoo(`${stock.code}.KS`, p1, p2);
      if (!yf || yf.ts.length === 0) yf = await fetchYahoo(`${stock.code}.KQ`, p1, p2);
      if (yf && yf.ts.length > 0) stock.market = 'KOSPI?';
    } else {
      const suffix = stock.market === 'KOSDAQ' ? '.KQ' : '.KS';
      yf = await fetchYahoo(`${stock.code}${suffix}`, p1, p2);
    }

    done++;
    if (done % 50 === 0) process.stderr.write(`  ${GRAY}[진행] ${done}/${universe.length}${RST}\n`);

    if (!yf || yf.ts.length === 0) return null;

    // 타겟 날짜 인덱스 탐색
    let tIdx = -1;
    for (let i=0; i<yf.ts.length; i++) {
      if (tsToKstDate(yf.ts[i]) === targetDate) { tIdx = i; break; }
    }
    if (tIdx === -1) return null;

    const close = yf.close[tIdx];
    const open  = yf.open[tIdx];
    const high  = yf.high[tIdx];
    const low   = yf.low[tIdx];
    const vol   = yf.volume[tIdx];
    if (!close) return null;

    // 전일 종가 (등락률 계산)
    let prevClose = null;
    for (let i=tIdx-1; i>=0; i--) {
      if (yf.close[i] != null) { prevClose = yf.close[i]; break; }
    }
    const chgRate = prevClose ? (close - prevClose) / prevClose * 100 : null;

    return {
      code:     stock.code,
      name:     stock.name,
      market:   stock.market || '?',
      종가:     Math.round(close),
      시가:     open   != null ? Math.round(open)  : null,
      고가:     high   != null ? Math.round(high)  : null,
      저가:     low    != null ? Math.round(low)   : null,
      거래량:   vol    || 0,
      거래대금: vol    ? Math.round(close * vol)   : 0,
      등락률:   chgRate,
      전일종가: prevClose ? Math.round(prevClose)  : null,
    };
  }, 10, 80);

  const valid = results.filter(Boolean);
  process.stderr.write(`\n[완료] 유효 데이터: ${valid.length}/${universe.length}종목\n`);

  if (valid.length === 0) {
    process.stderr.write(`[오류] ${dateFmt} 데이터 없음 — 휴장일이거나 Yahoo Finance 미제공\n`);
    process.exit(1);
  }

  // 출력
  const sortKeys = opts.all ? Object.keys(SORTS) : [opts.sort];
  for (const sk of sortKeys) {
    const def    = SORTS[sk] || SORTS.trade;
    const sorted = [...valid].sort(def.fn).slice(0, opts.top);
    printTable(sorted, def.label, targetDate, opts.market);
  }

  // stdout: JSON
  const def = SORTS[opts.sort] || SORTS.trade;
  process.stdout.write(JSON.stringify(
    [...valid].sort(def.fn).slice(0, opts.top), null, 2
  ) + '\n');
}

main().catch(e => {
  process.stderr.write(`[치명적 오류] ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
