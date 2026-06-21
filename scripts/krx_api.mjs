/**
 * krx_api.mjs — KRX OpenAPI 통합 조회 (과거 데이터 전용)
 *
 * Usage:
 *   node krx_api.mjs [YYYYMMDD]
 *     [--sort trade|mktcap|rise|fall|volume|turnover]  (default: trade)
 *     [--market kospi|kosdaq|all]                       (default: all)
 *     [--top N]                                          (default: 10)
 *     [--all]                                            (모든 정렬 차원 한번에 출력)
 *
 * stdout: JSON (원 단위 raw 값)
 * stderr: 테이블 (조/억·만주 단위, 캔들·OHLC 포함)
 */

import https from 'https';

const API_KEY = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST    = 'apis.data.go.kr';
const PATH    = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;

// IBK 제거: IBK계열 ETF는 코드 범위 필터로 이미 차단, IBK기업은행 오필터 방지
const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999)||n>=300000;
}
const PREF_RE = /우[BCbc]?$/;

const SORTS = {
  trade:    { label:'거래대금',  fn:(a,b)=>b.거래대금-a.거래대금 },
  mktcap:   { label:'시가총액',  fn:(a,b)=>b.시가총액-a.시가총액 },
  rise:     { label:'상승률',    fn:(a,b)=>b.등락률-a.등락률 },
  fall:     { label:'하락률',    fn:(a,b)=>a.등락률-b.등락률 },
  volume:   { label:'거래량',    fn:(a,b)=>b.거래량-a.거래량 },
  turnover: { label:'회전율(%)', fn:(a,b)=>b.회전율-a.회전율 },
};
const MKT_LABEL = { all:'전체(KOSPI+KOSDAQ)', kospi:'KOSPI', kosdaq:'KOSDAQ' };
const TERM_W = parseInt(process.env.COLUMNS||'0') || process.stderr.columns || process.stdout.columns || 160;
const USE_COLOR = process.stderr.isTTY || false;
const RED  = USE_COLOR ? '\x1b[31m' : '';
const BLUE = USE_COLOR ? '\x1b[34m' : '';
const GRAY = USE_COLOR ? '\x1b[90m' : '';
const RST  = USE_COLOR ? '\x1b[0m'  : '';

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { date:null, sort:'trade', market:'all', top:10, all:false };
  for (let i=0; i<argv.length; i++) {
    if (/^\d{8}$/.test(argv[i]))   { o.date   = argv[i];                   continue; }
    if (argv[i]==='--sort')         { o.sort   = argv[++i];                 continue; }
    if (argv[i]==='--market')       { o.market = argv[++i].toLowerCase();   continue; }
    if (argv[i]==='--top')          { o.top    = parseInt(argv[++i]);        continue; }
    if (argv[i]==='--all')          { o.all    = true;                       continue; }
  }
  return o;
}

function kstBefore(n) {
  const d = new Date(Date.now()+9*3600*1000);
  d.setUTCDate(d.getUTCDate()-n);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function get(url) {
  return new Promise((res,rej)=>{
    https.get(url,r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch(e){rej(new Error(`파싱실패: ${d.slice(0,200)}`));} }); }).on('error',rej);
  });
}

async function findDate() {
  for (let d=1; d<=7; d++) {
    const c=kstBefore(d);
    const r=await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=1&pageNo=1&resultType=json&basDt=${c}`);
    if (Number(r?.response?.body?.totalCount||0)>0) { console.error(`[날짜] 최근 유효 거래일: ${c}`); return c; }
    console.error(`[날짜] ${c} 없음...`);
  }
  throw new Error('7일 이내 유효 데이터 없음');
}

async function fetchAll(basDt) {
  console.error(`[KRX] ${basDt} 조회 중...`);
  const first = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount||0);
  let items   = body?.items?.item||[];
  if (!Array.isArray(items)) items = items?[items]:[];
  console.error(`[KRX] 전체 ${total}건, 1페이지 ${items.length}건`);
  for (let p=2; p<=Math.ceil(total/NUM_ROWS); p++) {
    const r = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`);
    const more = r?.response?.body?.items?.item||[];
    items = items.concat(more);
    console.error(`[KRX] ${p}페이지 ${more.length}건`);
  }
  return items;
}

function buildStocks(items, market) {
  const map = new Map();
  for (const item of items) {
    const code=(item.srtnCd||'').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev=map.get(code);
    if (!prev||Number(item.mrktTotAmt||0)>Number(prev.mrktTotAmt||0)) map.set(code,item);
  }
  const stocks=[];
  for (const item of map.values()) {
    const name=(item.itmsNm||'').trim();
    const code=(item.srtnCd||'').trim();
    const mkt=(item.mrktCtg||'').trim().toUpperCase();
    if (ETF_RE.test(name)||isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name)||code.endsWith('5'))      continue;
    if (market!=='all'&&mkt.toLowerCase()!==market)  continue;
    const 거래대금  = Number(item.trPrc||0);
    const 시가총액  = Number(item.mrktTotAmt||0);
    const 등락률   = Number(item.fltRt||0);
    const 거래량   = Number(item.trqu||0);
    const 종가     = Number(item.clpr||0);
    const 시가     = Number(item.mkp||0);
    const 고가     = Number(item.hipr||0);
    const 저가     = Number(item.lopr||0);
    const 상장주식수 = Number(item.lstgStCnt||0);
    const 전일대비  = Number(item.vs||0);
    if (!거래대금&&!시가총액) continue;
    const _to  = 시가총액>0  ? 거래대금/시가총액*100 : 0;
    const 회전율 = 상장주식수>0 ? 거래량/상장주식수*100 : 0;
    stocks.push({ 시장:mkt, 종목코드:code, 종목명:name, 상장주식수, 시가, 고가, 저가, 종가, 전일대비, 등락률, 거래량, 거래대금, 시가총액, 회전율, _to });
  }
  return stocks;
}

function mark(chg) { return chg>=29?'🔴':chg<=-29?'🔵':''; }
function fmtTrade(v) {
  if (v>=1e12) return `${(v/1e12).toFixed(1)}조`;
  return `${Math.round(v/1e8).toLocaleString()}억`;
}

// TERM_W >= 160: 풀뷰(OHLC 포함) / < 160: 컴팩트(핵심 9컬럼)
function printSection(title, rows, sk, dateLabel) {
  const wide = TERM_W >= 160;
  console.error(`\n━━━ ${title}  [${dateLabel}] ━━━`);
  if (wide) {
    console.error(`${'#'.padStart(2)}  코드    종목명              종가        등락률  거래량(만)   거래대금      회전율(%)     시총     캔  시가          고가          저가        변동폭  시가대비`);
    console.error('─'.repeat(150));
  } else {
    console.error(`${'#'.padStart(2)}  코드    종목명              종가        등락률  거래량(만)   거래대금      회전율(%)     시총`);
    console.error('─'.repeat(95));
  }
  rows.forEach((st,i)=>{
    const m=mark(st.등락률);
    const nm=(m+st.종목명).padEnd(18);
    const clr = st.등락률>0 ? RED : st.등락률<0 ? BLUE : GRAY;
    const price=`${clr}${st.종가.toLocaleString().padStart(10)}${RST}`;
    const chg=`${clr}${`${st.등락률>=0?'+':''}${st.등락률}`.padStart(7)}%${RST}`;
    const vol=`${Math.round(st.거래량/10000).toLocaleString()}만`.padStart(8);
    const tr=fmtTrade(st.거래대금).padStart(9);
    const rot=`${st.회전율.toFixed(2)}%`.padStart(8);
    const mc=`${(st.시가총액/1e12).toFixed(1)}조`.padStart(9);
    const core=`${String(i+1).padStart(2)}  ${st.종목코드}  ${nm}  ${price}  ${chg}  ${vol}  ${tr}  ${rot}  ${mc}`;
    if (!wide) { console.error(core); return; }
    const candleRaw=st.시가>0?(st.종가>st.시가?'▲':st.종가<st.시가?'▼':'─'):' ';

    const candleClr=candleRaw==='▲'?RED:candleRaw==='▼'?BLUE:GRAY;
    const 캔들=st.시가>0?`${candleClr}${candleRaw}${RST}`:' ';
    const open=st.시가>0?st.시가.toLocaleString().padStart(10):' '.repeat(10);
    const high=st.고가>0?st.고가.toLocaleString().padStart(10):' '.repeat(10);
    const low =st.저가>0?st.저가.toLocaleString().padStart(10):' '.repeat(10);
    const vola=st.저가>0?`${((st.고가-st.저가)/st.저가*100).toFixed(1)}%`.padStart(6):' '.repeat(6);
    const sdv =st.시가>0?(st.종가-st.시가)/st.시가*100:null;
    const sdvS=sdv!==null?`${sdv>=0?'+':''}${sdv.toFixed(1)}%`.padStart(7):' '.repeat(7);
    console.error(`${core}  ${캔들}  ${open}  ${high}  ${low}  ${vola}  ${sdvS}`);
  });
}

async function main() {
  const opts = parseArgs();
  const basDt = opts.date ?? await findDate();
  const dateLabel = `${basDt.slice(0,4)}-${basDt.slice(4,6)}-${basDt.slice(6,8)}`;
  const mktLabel  = MKT_LABEL[opts.market]||opts.market.toUpperCase();

  const items = await fetchAll(basDt);
  if (!items.length) { console.error('[오류] 데이터 없음 (휴장일 또는 잘못된 날짜)'); process.exit(1); }

  const stocks  = buildStocks(items, opts.market);
  const sortKeys = opts.all ? Object.keys(SORTS) : [opts.sort];
  const jsonOut  = {};

  for (const sk of sortKeys) {
    if (!SORTS[sk]) { console.error(`[오류] --sort 옵션: ${Object.keys(SORTS).join('|')}`); process.exit(1); }
    const sorted = [...stocks].sort(SORTS[sk].fn).slice(0, opts.top);
    printSection(`${mktLabel} ${SORTS[sk].label} TOP ${opts.top}`, sorted, sk, dateLabel);
    jsonOut[sk] = sorted.map((st,i)=>({
      날짜:dateLabel, 순위:i+1, 시장:st.시장, 종목코드:st.종목코드, 종목명:st.종목명,
      상장주식수:st.상장주식수,
      시가:st.시가, 고가:st.고가, 저가:st.저가, 종가:st.종가,
      전일종가:st.종가-st.전일대비, 전일대비:st.전일대비, 등락률:st.등락률,
      변동폭:st.고가-st.저가,
      거래량:st.거래량, 거래대금:st.거래대금,
      시가총액:st.시가총액, 회전율:parseFloat(st.회전율.toFixed(2)),
    }));
  }

  console.log(JSON.stringify(opts.all ? jsonOut : jsonOut[opts.sort], null, 2));
}

main().catch(e=>{ console.error('[오류]', e.message); process.exit(1); });
