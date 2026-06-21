/**
 * kis_api.mjs — KIS+KRX 통합 당일 조회
 * 당일 데이터 전용: KRX 전일 시총 유니버스 → KIS 당일 시세 적용
 *
 * Usage:
 *   node kis_api.mjs
 *     [--sort trade|mktcap|rise|fall|volume|turnover]  (default: trade)
 *     [--market kospi|kosdaq|all]                       (default: all)
 *     [--top N]                                          (default: 10)
 *     [--all]                                            (모든 정렬 차원 한번에 출력)
 *
 * 유니버스: KOSPI 전일 시총 상위 200 + KOSDAQ 상위 50 (ETF·우선주 제외)
 * ※ 상승률/하락률은 이 유니버스 내 순위 (전체 시장 대비 커버리지 ~95%)
 * ※ 시총 순위는 전일 KRX 기준 (당일 시총 ≈ 전일 시총, 오차 무시 수준)
 * stdout: JSON (원 단위 raw 값)
 * stderr: 테이블 (조/억·만주 단위, 캔들·OHLC 포함)
 */

import https from 'https';
import fs    from 'fs';

const KRX_KEY    = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST   = 'openapi.koreainvestment.com';
const KIS_PORT   = 9443;

const KOSPI_N  = 200;
const KOSDAQ_N = 50;
const BATCH    = 5;
const DELAY    = 200;

const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999)||n>=300000;
}
const PREF_RE = /우[BCbc]?$/;

const SORTS = {
  trade:    { label:'거래대금',  fn:(a,b)=>b.거래대금-a.거래대금 },
  mktcap:   { label:'시가총액',  fn:(a,b)=>b._mktcap-a._mktcap  },
  rise:     { label:'상승률',    fn:(a,b)=>b.등락률-a.등락률     },
  fall:     { label:'하락률',    fn:(a,b)=>a.등락률-b.등락률     },
  volume:   { label:'거래량',    fn:(a,b)=>b.거래량-a.거래량     },
  turnover: { label:'회전율(%)', fn:(a,b)=>b.회전율-a.회전율     },
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
  const o = { sort:'trade', market:'all', top:10, all:false };
  for (let i=0; i<argv.length; i++) {
    if (argv[i]==='--sort')   { o.sort   = argv[++i];               continue; }
    if (argv[i]==='--market') { o.market = argv[++i].toLowerCase(); continue; }
    if (argv[i]==='--top')    { o.top    = parseInt(argv[++i]);      continue; }
    if (argv[i]==='--all')    { o.all    = true;                     continue; }
  }
  return o;
}

function kstNow() {
  const d = new Date(Date.now()+9*3600*1000);
  const hm = d.getUTCHours()*100+d.getUTCMinutes();
  return {
    date:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`,
    hm,
    timeStr:`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`,
  };
}

function get(url) {
  return new Promise((res,rej)=>{
    https.get(url,r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch(e){rej(new Error(`파싱실패: ${d.slice(0,200)}`));} }); }).on('error',rej);
  });
}

async function getToken() {
  if (fs.existsSync(TOKEN_CACHE)) {
    try {
      const c=JSON.parse(fs.readFileSync(TOKEN_CACHE,'utf8'));
      if (new Date(c.access_token_token_expired)>new Date(Date.now()+60000)) { console.error('[토큰] 캐시 사용'); return c.access_token; }
    } catch {}
  }
  console.error('[토큰] 신규 발급...');
  const body=JSON.stringify({grant_type:'client_credentials',appkey:APP_KEY,appsecret:APP_SECRET});
  const res=await new Promise((res,rej)=>{
    const r=https.request({hostname:KIS_HOST,port:KIS_PORT,path:'/oauth2/tokenP',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
      resp=>{ let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>res(JSON.parse(d))); });
    r.on('error',rej); r.write(body); r.end();
  });
  if (!res.access_token) throw new Error(`토큰 실패: ${JSON.stringify(res)}`);
  fs.writeFileSync(TOKEN_CACHE,JSON.stringify(res));
  return res.access_token;
}

async function fetchKrxUniverse() {
  console.error('[KRX] 전일 시총 유니버스 조회...');
  const r = await get(`https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo?serviceKey=${KRX_KEY}&numOfRows=5000&pageNo=1&resultType=json`);
  const items = r?.response?.body?.items?.item ?? [];
  const basDt = items[0]?.basDt ?? '?';
  console.error(`[KRX] ${items.length}건 수신 (기준일: ${basDt})`);

  const kospiMap=new Map(), kosdaqMap=new Map();
  for (const item of items) {
    const name=(item.itmsNm||'').trim();
    const code=(item.srtnCd||'').trim();
    if (!/^\d{6}$/.test(code)) continue;
    if (ETF_RE.test(name)||isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name)||code.endsWith('5')) continue;
    const mktAmt=Number(item.mrktTotAmt||0);
    if (!mktAmt) continue;
    if (item.mrktCtg==='KOSPI') {
      const prev=kospiMap.get(code);
      if (!prev||mktAmt>Number(prev.mrktTotAmt||0)) kospiMap.set(code,item);
    } else if (item.mrktCtg==='KOSDAQ') {
      const prev=kosdaqMap.get(code);
      if (!prev||mktAmt>Number(prev.mrktTotAmt||0)) kosdaqMap.set(code,item);
    }
  }

  const pick=(map,n,mkt)=>[...map.values()]
    .sort((a,b)=>Number(b.mrktTotAmt)-Number(a.mrktTotAmt))
    .slice(0,n)
    .map((item,i)=>({ mktRank:i+1, 시장:mkt, 종목코드:item.srtnCd.trim(), 종목명:item.itmsNm.trim(), _mktcap:Number(item.mrktTotAmt), krx기준일:basDt }));

  const kospi=pick(kospiMap,KOSPI_N,'KOSPI');
  const kosdaq=pick(kosdaqMap,KOSDAQ_N,'KOSDAQ');
  console.error(`[KRX] KOSPI ${kospi.length}종목, KOSDAQ ${kosdaq.length}종목`);
  return { kospi, kosdaq, basDt };
}

async function fetchKisPrice(token, code) {
  const qs=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code});
  return new Promise(res=>{
    const r=https.request({
      hostname:KIS_HOST, port:KIS_PORT,
      path:`/uapi/domestic-stock/v1/quotations/inquire-price?${qs}`,
      method:'GET',
      headers:{'Content-Type':'application/json',authorization:`Bearer ${token}`,appkey:APP_KEY,appsecret:APP_SECRET,tr_id:'FHKST01010100',custtype:'P'}
    },resp=>{
      let d=''; resp.on('data',c=>d+=c);
      resp.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if (j.rt_cd!=='0') return res(null);
          const o=j.output;
          res({
            현재가:Number(o.stck_prpr||0), 등락률:Number(o.prdy_ctrt||0),
            거래대금:Number(o.acml_tr_pbmn||0), 거래량:Number(o.acml_vol||0),
            시가:Number(o.stck_oprc||0), 고가:Number(o.stck_hgpr||0),
            저가:Number(o.stck_lwpr||0), 상장주식수:Number(o.lstn_stcn||0),
          });
        } catch { res(null); }
      });
    });
    r.on('error',()=>res(null)); r.end();
  });
}

async function batchKis(token, codes) {
  const map={};
  for (let i=0; i<codes.length; i+=BATCH) {
    const batch=codes.slice(i,i+BATCH);
    const results=await Promise.all(batch.map(c=>fetchKisPrice(token,c)));
    batch.forEach((c,j)=>{ if (results[j]) map[c]=results[j]; });
    if (i+BATCH<codes.length) await new Promise(r=>setTimeout(r,DELAY));
  }
  // 누락 재시도
  const missing=codes.filter(c=>!map[c]);
  if (missing.length) {
    console.error(`[KIS] 누락 ${missing.length}건 재시도...`);
    for (let attempt=0; attempt<2&&missing.length; attempt++) {
      await new Promise(r=>setTimeout(r,300));
      for (const c of [...missing]) {
        const p=await fetchKisPrice(token,c);
        if (p) { map[c]=p; missing.splice(missing.indexOf(c),1); }
        await new Promise(r=>setTimeout(r,150));
      }
    }
  }
  return map;
}

function mark(chg) { return chg>=29?'🔴':chg<=-29?'🔵':''; }
function fmtTrade(v) {
  if (v>=1e12) return `${(v/1e12).toFixed(1)}조`;
  return `${Math.round(v/1e8).toLocaleString()}억`;
}

// TERM_W >= 160: 풀뷰(OHLC 포함) / < 160: 컴팩트(핵심 9컬럼)
function printSection(title, rows, sk, dateInfo) {
  const wide = TERM_W >= 160;
  console.error(`\n━━━ ${title}  [${dateInfo}] ━━━`);
  if (wide) {
    console.error(`${'#'.padStart(2)}  코드    종목명              현재가      등락률  거래량(만)   거래대금      회전율(%)     시총     캔  시가          고가          저가        변동폭  시가대비`);
    console.error('─'.repeat(150));
  } else {
    console.error(`${'#'.padStart(2)}  코드    종목명              현재가      등락률  거래량(만)   거래대금      회전율(%)     시총`);
    console.error('─'.repeat(95));
  }
  rows.forEach((st,i)=>{
    const m=mark(st.등락률);
    const nm=(m+st.종목명).padEnd(18);
    const clr = st.등락률>0 ? RED : st.등락률<0 ? BLUE : GRAY;
    const price=`${clr}${st.현재가.toLocaleString().padStart(10)}${RST}`;
    const chg=`${clr}${`${st.등락률>=0?'+':''}${st.등락률}`.padStart(7)}%${RST}`;
    const vol=`${Math.round(st.거래량/10000).toLocaleString()}만`.padStart(8);
    const tr=fmtTrade(st.거래대금).padStart(9);
    const rot=`${st.회전율.toFixed(2)}%`.padStart(8);
    const mc=`${(st._mktcap/1e12).toFixed(1)}조`.padStart(9);
    const core=`${String(i+1).padStart(2)}  ${st.종목코드}  ${nm}  ${price}  ${chg}  ${vol}  ${tr}  ${rot}  ${mc}`;
    if (!wide) { console.error(core); return; }
    const candleRaw=st.시가>0?(st.현재가>st.시가?'▲':st.현재가<st.시가?'▼':'─'):' ';
    const candleClr=candleRaw==='▲'?RED:candleRaw==='▼'?BLUE:GRAY;
    const 캔들=st.시가>0?`${candleClr}${candleRaw}${RST}`:' ';
    const open=st.시가>0?st.시가.toLocaleString().padStart(10):' '.repeat(10);
    const high=st.고가>0?st.고가.toLocaleString().padStart(10):' '.repeat(10);
    const low =st.저가>0?st.저가.toLocaleString().padStart(10):' '.repeat(10);
    const vola=st.저가>0?`${((st.고가-st.저가)/st.저가*100).toFixed(1)}%`.padStart(6):' '.repeat(6);
    const sdv =st.시가>0?(st.현재가-st.시가)/st.시가*100:null;
    const sdvS=sdv!==null?`${sdv>=0?'+':''}${sdv.toFixed(1)}%`.padStart(7):' '.repeat(7);
    console.error(`${core}  ${캔들}  ${open}  ${high}  ${low}  ${vola}  ${sdvS}`);
  });
}

async function main() {
  const opts = parseArgs();
  const { date, hm, timeStr } = kstNow();

  if (hm<900)   console.error(`⚠️  장 전(${timeStr}) — 전일 기준 데이터`);
  else if (hm<1530) console.error(`⚠️  장 중(${timeStr}) — 확정 종가 아님`);
  else          console.error(`✅ 장 후(${timeStr}) — 확정 데이터`);

  const { kospi, kosdaq, basDt } = await fetchKrxUniverse();
  const basDtLabel=`${basDt.slice(0,4)}-${basDt.slice(4,6)}-${basDt.slice(6,8)}`;
  const dateInfo=`KRX기준: ${basDtLabel} / KIS기준: ${date} ${timeStr}`;

  // 시장 필터
  let universe;
  if      (opts.market==='kospi')  universe=kospi;
  else if (opts.market==='kosdaq') universe=kosdaq;
  else                             universe=[...kospi,...kosdaq];

  const codes=universe.map(s=>s.종목코드);
  console.error(`[KIS] ${codes.length}종목 현재가 조회 중... (~${Math.ceil(codes.length/BATCH)*DELAY/1000}초 소요 예상)`);
  const token=await getToken();
  const priceMap=await batchKis(token, codes);
  console.error(`[KIS] ${Object.keys(priceMap).length}/${codes.length}건 수신`);

  // 종목별 데이터 병합
  const stocks=universe.map(s=>{
    const p=priceMap[s.종목코드];
    const 거래대금  = p?.거래대금??0;
    const 거래량   = p?.거래량??0;
    const 상장주식수 = p?.상장주식수??0;
    return {
      시장: s.시장, 종목코드: s.종목코드, 종목명: s.종목명,
      현재가: p?.현재가??0, 등락률: p?.등락률??0,
      시가: p?.시가??0, 고가: p?.고가??0, 저가: p?.저가??0,
      거래량, 거래대금,
      회전율: 상장주식수>0 ? 거래량/상장주식수*100 : 0,
      _mktcap: s._mktcap,
      _to: s._mktcap>0 ? 거래대금/s._mktcap*100 : 0,
    };
  }).filter(s=>s.현재가>0);

  const mktLabel=MKT_LABEL[opts.market]||opts.market.toUpperCase();
  const sortKeys=opts.all ? Object.keys(SORTS) : [opts.sort];
  const jsonOut={};

  for (const sk of sortKeys) {
    if (!SORTS[sk]) { console.error(`[오류] --sort 옵션: ${Object.keys(SORTS).join('|')}`); process.exit(1); }
    const sorted=[...stocks].sort(SORTS[sk].fn).slice(0,opts.top);
    printSection(`${mktLabel} ${SORTS[sk].label} TOP ${opts.top}`, sorted, sk, dateInfo);
    jsonOut[sk]=sorted.map((st,i)=>({
      순위:i+1, 날짜:date, 시장:st.시장, 종목코드:st.종목코드, 종목명:st.종목명,
      현재가:st.현재가, 시가:st.시가, 고가:st.고가, 저가:st.저가,
      등락률:st.등락률, 거래량:st.거래량, 거래대금:st.거래대금,
      시가총액전일:st._mktcap, 회전율:parseFloat(st.회전율.toFixed(2)),
    }));
  }

  console.log(JSON.stringify(opts.all ? jsonOut : jsonOut[opts.sort], null, 2));
}

main().catch(e=>{ console.error('[오류]', e.message); process.exit(1); });
