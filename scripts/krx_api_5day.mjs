/**
 * krx_api_5day.mjs — KRX 최근 N거래일 거래대금 추이 분석
 *
 * Usage:
 *   node krx_api_5day.mjs [YYYYMMDD(기준일)]
 *     [--top N]              각 날짜 추적 범위 (default: 20)
 *     [--market all|kospi|kosdaq]
 *     [--days N]             분석 기간 (default: 5)
 *
 * 분석 항목:
 *   [표1] N일 거래대금 순위 추이 (출현횟수·순위·누적등락률·거래대금배수·모멘텀)
 *   [표2] 거래대금 폭발 탐지 (오늘/과거평균 ≥ 1.5x)
 *   [표3] 모멘텀 분류 (지속강세·신규진입·재진입·소멸 등)
 *
 * stdout: JSON
 * stderr: 분석 테이블
 */

import https from 'https';

const API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST     = 'apis.data.go.kr';
const PATH     = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;

const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999);
}
const PREF_RE = /우[BCbc]?$/;

const TERM_W    = parseInt(process.env.COLUMNS||'0')||process.stderr.columns||process.stdout.columns||160;
const USE_COLOR = process.stderr.isTTY||false;
const RED  = USE_COLOR ? '\x1b[31m' : '';
const BLUE = USE_COLOR ? '\x1b[34m' : '';
const GRN  = USE_COLOR ? '\x1b[32m' : '';
const GRAY = USE_COLOR ? '\x1b[90m' : '';
const BOLD = USE_COLOR ? '\x1b[1m'  : '';
const RST  = USE_COLOR ? '\x1b[0m'  : '';

// ─── 인수 파싱 ──────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { date: null, top: 20, market: 'all', days: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (/^\d{8}$/.test(argv[i]))   { o.date   = argv[i];                   continue; }
    if (argv[i] === '--top')        { o.top    = parseInt(argv[++i]);        continue; }
    if (argv[i] === '--market')     { o.market = argv[++i].toLowerCase();   continue; }
    if (argv[i] === '--days')       { o.days   = parseInt(argv[++i]);        continue; }
  }
  return o;
}

// ─── HTTP ────────────────────────────────────────────────────
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(new Error(`파싱실패: ${d.slice(0,100)}`)); } });
    }).on('error', rej);
  });
}

async function fetchDay(basDt) {
  const first = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  if (!total) return null;
  let items = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  for (let p = 2; p <= Math.ceil(total / NUM_ROWS); p++) {
    const r = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`);
    items = items.concat(r?.response?.body?.items?.item || []);
  }
  return items;
}

// ─── 종목 정제 ───────────────────────────────────────────────
function buildStocks(items, market) {
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev = map.get(code);
    if (!prev || Number(item.mrktTotAmt||0) > Number(prev.mrktTotAmt||0)) map.set(code, item);
  }
  const stocks = [];
  for (const item of map.values()) {
    const name = (item.itmsNm || '').trim();
    const code = (item.srtnCd || '').trim();
    const mkt  = (item.mrktCtg || '').trim().toUpperCase();
    if (ETF_RE.test(name) || isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name) || code.endsWith('5'))     continue;
    if (market !== 'all' && mkt.toLowerCase() !== market) continue;
    const 거래대금 = Number(item.trPrc || 0);
    if (!거래대금) continue;
    stocks.push({
      시장: mkt, 종목코드: code, 종목명: name,
      종가: Number(item.clpr||0), 시가: Number(item.mkp||0),
      고가: Number(item.hipr||0), 저가: Number(item.lopr||0),
      등락률: Number(item.fltRt||0), 거래량: Number(item.trqu||0),
      거래대금, 시가총액: Number(item.mrktTotAmt||0),
      상장주식수: Number(item.lstgStCnt||0),
    });
  }
  return stocks.sort((a, b) => b.거래대금 - a.거래대금);
}

// ─── 거래일 탐색 (API 결과 캐시) ─────────────────────────────
async function findTradingDays(baseDate, count) {
  let cursor;
  if (baseDate) {
    cursor = new Date(Date.UTC(
      parseInt(baseDate.slice(0,4)),
      parseInt(baseDate.slice(4,6)) - 1,
      parseInt(baseDate.slice(6,8))
    ));
  } else {
    cursor = new Date(Date.now() + 9 * 3600 * 1000);
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const found = []; // [{date, items}] oldest first
  let attempts = 0;
  while (found.length < count && attempts < count * 4) {
    const ds = `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth()+1).padStart(2,'0')}${String(cursor.getUTCDate()).padStart(2,'0')}`;
    process.stderr.write(`[날짜] ${fmtDate(ds)} ... `);
    const items = await fetchDay(ds);
    if (items && items.length > 0) {
      found.unshift({ date: ds, items });
      process.stderr.write(`✓ (${found.length}/${count})\n`);
    } else {
      process.stderr.write(`휴장\n`);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    attempts++;
  }
  return found;
}

// ─── 유틸 ────────────────────────────────────────────────────
function fmtDate(s) { return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtTrade(v) {
  if (v >= 1e12) return `${(v/1e12).toFixed(1)}조`;
  return `${Math.round(v/1e8).toLocaleString()}억`;
}
function clrChg(v) { return v > 0 ? RED : v < 0 ? BLUE : GRAY; }

// ─── 메인 ────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  // 1. 거래일 탐색 + 데이터 수집 (한 번에)
  console.error(`\n[분석] 최근 ${opts.days}거래일 탐색 및 수집 중...`);
  const dayRaw = await findTradingDays(opts.date, opts.days);
  if (dayRaw.length < 2) { console.error('[오류] 거래일 2일 이상 필요'); process.exit(1); }

  const D = dayRaw.length;
  const dayData = dayRaw.map(({ date, items }) => ({
    date,
    dateLabel: fmtDate(date),
    stocks: buildStocks(items, opts.market),
  }));
  const todayIdx = D - 1;

  // 2. 유니버스 구성 (전 기간 TOP N 등장 종목)
  const universe = new Map();
  for (const [di, day] of dayData.entries()) {
    day.stocks.slice(0, opts.top).forEach((st, rank) => {
      if (!universe.has(st.종목코드)) {
        universe.set(st.종목코드, {
          종목코드: st.종목코드, 종목명: st.종목명, 시장: st.시장,
          ranks:   new Array(D).fill(null),
          trades:  new Array(D).fill(0),
          changes: new Array(D).fill(null),
        });
      }
      const u = universe.get(st.종목코드);
      u.ranks[di]   = rank + 1;
      u.trades[di]  = st.거래대금;
      u.changes[di] = st.등락률;
    });
  }

  // 3. 지표 계산
  const results = [...universe.values()].map(u => {
    const appearances   = u.ranks.filter(r => r !== null).length;
    const todayRank     = u.ranks[todayIdx];
    const prevTrades    = u.trades.slice(0, -1).filter(t => t > 0);
    const avgTrade      = prevTrades.length > 0 ? prevTrades.reduce((a,b)=>a+b,0) / prevTrades.length : 0;
    const todayTrade    = u.trades[todayIdx] || 0;
    const tradeRatio    = avgTrade > 0 && todayTrade > 0 ? todayTrade / avgTrade : 0;
    const cumChange     = u.changes.filter(c => c !== null).reduce((a,b)=>a+b, 0);

    // 순위 방향성
    const validRanks = u.ranks.map((r,i) => r !== null ? { i, r } : null).filter(Boolean);
    let direction = '─';
    if (validRanks.length >= 2) {
      const first = validRanks[0].r, last = validRanks[validRanks.length-1].r;
      if (last <= first - 3)      direction = `${GRN}↑${RST}`;
      else if (last >= first + 3) direction = `${BLUE}↓${RST}`;
    }

    // 모멘텀 분류
    const prevRank = u.ranks[todayIdx - 1] ?? null;
    let momentum;
    if      (appearances === D)                                   momentum = '지속강세';
    else if (todayRank !== null && u.ranks.slice(0,-1).every(r=>r===null)) momentum = '신규진입';
    else if (todayRank !== null && appearances >= Math.ceil(D*0.6)) momentum = '지속등장';
    else if (todayRank !== null && prevRank === null)             momentum = '재진입';
    else if (todayRank !== null)                                  momentum = '간헐등장';
    else if (prevRank !== null && todayRank === null)             momentum = '소멸';
    else                                                          momentum = '산발';

    return { ...u, appearances, todayRank, avgTrade, todayTrade, tradeRatio, cumChange, direction, momentum };
  }).sort((a, b) => {
    const aT = a.todayRank ?? 999, bT = b.todayRank ?? 999;
    if (aT !== bT) return aT - bT;
    return b.appearances - a.appearances;
  });

  // ─── 출력 ───────────────────────────────────────────────────
  const mktLabel   = opts.market==='all' ? '전체(KOSPI+KOSDAQ)' : opts.market.toUpperCase();
  const dateLabels = dayData.map(d => d.dateLabel.slice(5)); // MM-DD
  const wide       = TERM_W >= 160;
  const periodStr  = `${dayData[0].dateLabel} ~ ${dayData[D-1].dateLabel}`;

  // 표1: N일 순위 추이
  console.error(`\n━━━ [표1] ${mktLabel} 거래대금 TOP${opts.top} — ${opts.days}일 순위 추이  [${periodStr}] ━━━`);
  const showDates  = wide ? dateLabels : dateLabels.slice(-2);
  const hDates     = showDates.map(l => l.padStart(5)).join('  ');
  const hdr1 = `${'종목명'.padEnd(18)}  출현  ${hDates}  누적등락    배수  방향  모멘텀`;
  console.error(hdr1);
  console.error('─'.repeat(Math.min(hdr1.length + 2, TERM_W - 1)));

  for (const r of results) {
    const nm    = r.종목명.padEnd(18);
    const ap    = `${r.appearances}/${D}`.padStart(4);
    const showR = wide ? r.ranks : r.ranks.slice(-2);
    const rankCols = showR.map(rk => rk != null ? String(rk).padStart(5) : '    -').join('  ');
    const cc    = clrChg(r.cumChange);
    const cum   = `${cc}${(r.cumChange >= 0 ? '+' : '')}${r.cumChange.toFixed(1)}%${RST}`.padStart(wide?8:8);
    let   ratio = '    -';
    if (r.tradeRatio > 0) {
      const rc = r.tradeRatio >= 2 ? RED : r.tradeRatio >= 1.5 ? GRN : '';
      ratio = `${rc}${r.tradeRatio.toFixed(1)}x${RST}`.padStart(5 + (rc ? RST.length + rc.length : 0));
    }
    const today = r.todayRank !== null ? '' : `${GRAY}`;
    const rst2  = r.todayRank !== null ? '' : RST;
    console.error(`${today}${nm}  ${ap}  ${rankCols}  ${cum}  ${ratio}  ${r.direction}  ${r.momentum}${rst2}`);
  }

  // 표2: 거래대금 폭발 탐지
  const explosions = results
    .filter(r => r.todayRank !== null && r.tradeRatio >= 1.5)
    .sort((a, b) => b.tradeRatio - a.tradeRatio);
  console.error(`\n━━━ [표2] 거래대금 폭발 탐지 (오늘 / 과거평균 ≥ 1.5x) ━━━`);
  if (explosions.length === 0) {
    console.error('  해당 종목 없음');
  } else {
    const h2 = `${'종목명'.padEnd(18)}  오늘순위  오늘 거래대금  과거평균    배수   오늘 등락률  모멘텀`;
    console.error(h2);
    console.error('─'.repeat(Math.min(h2.length + 2, TERM_W - 1)));
    for (const r of explosions) {
      const nm   = r.종목명.padEnd(18);
      const rank = `${r.todayRank}위`.padStart(5);
      const td   = fmtTrade(r.todayTrade).padStart(10);
      const avg  = fmtTrade(r.avgTrade).padStart(8);
      const rc   = r.tradeRatio >= 2 ? RED : GRN;
      const rx   = `${rc}${r.tradeRatio.toFixed(1)}x${RST}`.padStart(5 + rc.length + RST.length);
      const todaySt = dayData[todayIdx].stocks.find(s => s.종목코드 === r.종목코드);
      const chgV = todaySt?.등락률 ?? 0;
      const cc   = clrChg(chgV);
      const chg  = `${cc}${chgV >= 0 ? '+' : ''}${chgV}%${RST}`.padStart(7 + cc.length + RST.length);
      console.error(`${nm}  ${rank}  ${td}  ${avg}  ${rx}  ${chg}  ${r.momentum}`);
    }
  }

  // 표3: 모멘텀 분류
  const MOMENTUM_DESC = {
    '지속강세': `전 기간(${D}/${D}) — 세력 지속 유입, 핵심 관심종목`,
    '지속등장': `3일↑ 연속 등장 — 모멘텀 지속 중`,
    '재진입':   `중간 이탈 후 재등장 — 방향성 재확인 필요`,
    '신규진입': `오늘 처음 등장 — 단발성 vs 지속 여부 주시`,
    '간헐등장': `산발적 등장 — 뚜렷한 추세 없음`,
    '소멸':     `전일 TOP${opts.top} 이탈 — 수급 이탈 주의`,
  };
  const groups = Object.fromEntries(Object.keys(MOMENTUM_DESC).map(k => [k, []]));
  for (const r of results) {
    if (groups[r.momentum]) groups[r.momentum].push(r.종목명);
  }
  console.error(`\n━━━ [표3] 모멘텀 분류 ━━━`);
  for (const [key, names] of Object.entries(groups)) {
    if (names.length === 0) continue;
    const kc = key === '지속강세' ? BOLD+GRN : key === '소멸' ? GRAY : '';
    console.error(`  ${kc}${key.padEnd(6)}${RST}  ${MOMENTUM_DESC[key]}`);
    console.error(`         → ${names.join(', ')}`);
  }

  // JSON 출력
  console.log(JSON.stringify({
    분석기간: periodStr,
    거래일수: D,
    추적범위: `TOP${opts.top}`,
    시장: mktLabel,
    거래일목록: dayData.map(d => d.dateLabel),
    종목분석: results.map(r => ({
      종목코드:   r.종목코드,
      종목명:    r.종목명,
      시장:      r.시장,
      출현횟수:   r.appearances,
      순위추이:   r.ranks,
      거래대금추이: r.trades,
      등락률추이:  r.changes,
      누적등락률:  parseFloat(r.cumChange.toFixed(2)),
      거래대금배수: r.tradeRatio > 0 ? parseFloat(r.tradeRatio.toFixed(2)) : null,
      오늘순위:   r.todayRank,
      모멘텀:    r.momentum,
    })),
  }, null, 2));
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
