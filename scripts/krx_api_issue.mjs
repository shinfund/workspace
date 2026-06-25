import https from 'https';

const API_KEY = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST = 'apis.data.go.kr';
const PATH = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;
const TRADE_TOP_N = 10;  // 거래대금 상위 N개 보통주 내에서만 탐색
const CHG_MIN = 5.0;     // |등락률| 기준 (%)

const ETF_NAME_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n >= 69500 && n <= 69999) ||
         (n >= 102000 && n <= 102999) ||
         (n >= 114000 && n <= 114999) ||
         (n >= 133000 && n <= 139999) ||
         (n >= 160000 && n <= 299999) ||
         n >= 300000;
}
const PREF_RE = /우[BCbc]?$/;

function getDir(chg) {
  if (chg > 0) return '급등';
  if (chg < 0) return '급락';
  return '보합';
}

// 이슈강도 추정 (등락률 절댓값 기준)
function getStrength(chg) {
  const a = Math.abs(chg);
  if (a >= 15) return '🔴 핵심';
  if (a >= 7)  return '🟠 강함';
  if (a >= 5)  return '🟡 보통';
  return '⚪ 약함';
}

function kstDateBefore(daysAgo) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - daysAgo);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON 파싱 실패 [${res.statusCode}]: ${d.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
  });
}

async function fetchAll(basDt) {
  const url1 = `https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`;
  console.error(`[KRX] ${basDt} 조회 중...`);
  const first = await get(url1);
  const body = first?.response?.body;
  if (!body) throw new Error(`응답 구조 이상: ${JSON.stringify(first).slice(0, 200)}`);
  const totalCount = Number(body.totalCount || 0);
  let items = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  console.error(`[KRX] 전체 ${totalCount}건, 1페이지 ${items.length}건 수신`);
  if (totalCount > NUM_ROWS) {
    for (let p = 2; p <= Math.ceil(totalCount / NUM_ROWS); p++) {
      const res = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`);
      const more = res?.response?.body?.items?.item || [];
      console.error(`[KRX] ${p}페이지 ${more.length}건 수신`);
      items = items.concat(more);
    }
  }
  return { items, totalCount };
}

async function findLatestDate() {
  for (let d = 1; d <= 7; d++) {
    const candidate = kstDateBefore(d);
    const res = await get(`https://${HOST}${PATH}?serviceKey=${API_KEY}&numOfRows=1&pageNo=1&resultType=json&basDt=${candidate}`);
    if (Number(res?.response?.body?.totalCount || 0) > 0) {
      console.error(`[날짜] 최근 유효 거래일: ${candidate}`);
      return candidate;
    }
    console.error(`[날짜] ${candidate} 데이터 없음 (${d}일 전)...`);
  }
  throw new Error('7일 이내 유효 데이터 없음');
}

async function main() {
  const arg = process.argv[2];
  let basDt;
  if (arg && /^\d{8}$/.test(arg)) {
    basDt = arg;
    console.error(`[날짜] 지정일: ${basDt}`);
  } else {
    basDt = await findLatestDate();
  }

  const { items } = await fetchAll(basDt);
  if (!items.length) {
    console.error(`[오류] 데이터 없음 — 휴장일이거나 날짜가 잘못됨 (basDt=${basDt})`);
    process.exit(1);
  }

  // 중복 제거
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev = map.get(code);
    if (!prev || Number(item.mrktTotAmt || 0) > Number(prev.mrktTotAmt || 0)) map.set(code, item);
  }

  // ETF·우선주 필터
  const filtered = [];
  for (const item of map.values()) {
    const name = (item.itmsNm || '').trim();
    const code = (item.srtnCd || '').trim();
    if (ETF_NAME_RE.test(name) || isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name) || code.endsWith('5')) continue;
    const trPrc = Number(item.trPrc || 0);
    if (trPrc === 0) continue;
    filtered.push({ ...item, _trPrc: trPrc });
  }

  // 거래대금 TOP 10 → |등락률| >= 5% 필터
  filtered.sort((a, b) => b._trPrc - a._trPrc);
  const top10 = filtered.slice(0, TRADE_TOP_N);
  const candidates = top10
    .map(item => {
      const chg = Number(item.fltRt || 0);
      return { ...item, _chg: chg };
    })
    .filter(item => Math.abs(item._chg) >= CHG_MIN)
    .sort((a, b) => Math.abs(b._chg) - Math.abs(a._chg))
    .map(item => {
      const chg = item._chg;
      const notionDate = `${basDt.slice(0,4)}-${basDt.slice(4,6)}-${basDt.slice(6,8)}`;
      return {
        종목명: (item.itmsNm || '').trim(),
        종목코드: (item.srtnCd || '').trim(),
        날짜: notionDate,
        시장구분: (item.mrktCtg || '').trim(),
        종가: Number(item.clpr || 0),
        등락률: chg,
        거래량: Number(item.trqu || 0),
        거래대금: Number(item.trPrc || 0),
        방향: getDir(chg),
        이슈강도_추정: getStrength(chg),
        섹터: '',        // AI 분석 필요
        트리거: '',      // AI 분석 필요
        이슈요약: '',    // AI 분석 필요
        이슈상세: '',    // AI 분석 필요
        출처: ''         // 웹 검색 필요
      };
    });

  // stderr 요약
  console.error(`\n[결과] 거래대금 TOP ${TRADE_TOP_N} 중 |등락률| ≥ ${CHG_MIN}% 종목: ${candidates.length}건\n`);
  if (!candidates.length) {
    console.error('⚠️  이슈DB 업로드 대상 없음');
    console.log(JSON.stringify([], null, 2));
    return;
  }

  console.error('순위(등락) | 시장   | 코드   | 종목명           | 종가       | 등락률   | 이슈강도(추정)');
  console.error('─'.repeat(80));
  candidates.forEach((s, i) => {
    const 등락 = (s.등락률 >= 0 ? `+${s.등락률}` : `${s.등락률}`).padStart(7);
    const 종가 = s.종가.toLocaleString().padStart(9);
    console.error(
      `${String(i + 1).padStart(2)}          | ${s.시장구분.padEnd(6)} | ${s.종목코드} | ${s.종목명.padEnd(16)} | ${종가} | ${등락}% | ${s.이슈강도_추정}`
    );
  });

  console.error('\n[다음 단계] 각 종목 뉴스 웹 검색 → 섹터·트리거·이슈요약 AI 분석 → Notion 이슈DB 업로드');

  // stdout JSON (다음 단계용)
  console.log(JSON.stringify(candidates, null, 2));
}

main().catch(e => {
  console.error('[오류]', e.message || e);
  process.exit(1);
});
