/**
 * sync_krx_notion_20260625.mjs
 * KRX 20260625 데이터와 노션 거래대금DB 2026-06-25 데이터 비교 → 차이 패치
 * Usage: node sync_krx_notion_20260625.mjs [--dry-run]
 */

import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_TRADEAMT  = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const TARGET_DATE  = '2026-06-25';
const KRX_DATE     = '20260625';
const KRX_API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const DRY_RUN      = process.argv.includes('--dry-run');
const DELAY_MS     = 420;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`${new Date().toTimeString().slice(0,8)} ${msg}`);

// ── KRX 전체 조회 ─────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error(`파싱 오류: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchKrx(basDt) {
  const BASE = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo`;
  const first = await httpGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=1&resultType=json&basDt=${basDt}`);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  let items   = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  log(`[KRX] ${basDt} 전체 ${total}건, 1페이지 ${items.length}건`);
  for (let p = 2; p <= Math.ceil(total / 2000); p++) {
    const r = await httpGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=${p}&resultType=json&basDt=${basDt}`);
    const more = r?.response?.body?.items?.item || [];
    items = items.concat(more);
    log(`[KRX] ${p}페이지 ${more.length}건`);
  }

  // 종목코드 → KRX 데이터 맵 (시가총액 최대값 우선)
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev = map.get(code);
    if (!prev || Number(item.mrktTotAmt || 0) > Number(prev.mrktTotAmt || 0)) {
      map.set(code, item);
    }
  }

  const result = new Map();
  for (const [code, item] of map.entries()) {
    const 상장주식수 = Number(item.lstgStCnt || 0);
    const 종가      = Number(item.clpr || 0);
    const 시가      = Number(item.mkp  || 0);
    const 고가      = Number(item.hipr || 0);
    const 저가      = Number(item.lopr || 0);
    const 전일대비  = Number(item.vs   || 0);
    const 전일종가  = 종가 - 전일대비;
    const 등락률    = Number(item.fltRt || 0);
    const 거래량    = Number(item.trqu  || 0);
    const 거래대금  = Number(item.trPrc || 0);
    const 시가총액  = Number(item.mrktTotAmt || 0);
    const 회전율    = 상장주식수 > 0 ? 거래량 / 상장주식수 * 100 : 0;
    const 변동폭    = 고가 - 저가;
    result.set(code, {
      종목명: (item.itmsNm || '').trim(),
      상장주식수, 종가, 시가, 고가, 저가,
      전일대비, 전일종가, 등락률,
      거래량, 거래대금, 시가총액, 회전율, 변동폭,
    });
  }
  log(`[KRX] 유효 종목 ${result.size}개`);
  return result;
}

// ── Notion API ────────────────────────────────────────────────
async function notionReq(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: endpoint, method,
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('rate limit 초과'));
            await sleep((parseInt(res.headers['retry-after'] || '2') * 1000) + 500);
            resolve(await notionReq(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message || d.slice(0, 200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Notion 파싱 오류: ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getNotionPages() {
  const pages = [];
  let cursor;
  while (true) {
    const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, {
      filter: { property: '날짜', date: { equals: TARGET_DATE } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

// ── 비교 대상 필드 정의 ───────────────────────────────────────
// [노션 속성명, KRX 키, 허용오차, 소수점자리]
const FIELDS = [
  ['상장주식수', '상장주식수', 0,    0],
  ['시가',      '시가',       0,    0],
  ['고가',      '고가',       0,    0],
  ['저가',      '저가',       0,    0],
  ['종가',      '종가',       0,    0],
  ['전일종가',  '전일종가',   0,    0],
  ['전일대비',  '전일대비',   0,    0],
  ['등락률',    '등락률',     0.01, 2],  // 부동소수점 오차 허용
  ['변동폭',    '변동폭',     0,    0],
  ['거래량',    '거래량',     0,    0],
  ['거래대금',  '거래대금',   0,    0],
  ['시가총액',  '시가총액',   0,    0],
  ['회전율',    '회전율',     0.01, 4],  // 부동소수점 오차 허용
];

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }

  log(`====== KRX ↔ 노션 비교 패치 [${TARGET_DATE}]${DRY_RUN ? ' (DRY-RUN)' : ''} ======`);

  const [krxMap, pages] = await Promise.all([
    fetchKrx(KRX_DATE),
    (async () => {
      log('[Notion] 거래대금DB 6/25 페이지 조회...');
      const p = await getNotionPages();
      log(`[Notion] ${p.length}건 조회 완료`);
      return p;
    })()
  ]);

  let totalDiff = 0, patchOk = 0, patchErr = 0, noKrx = 0;

  for (const page of pages) {
    const code = page.properties['종목코드']?.rich_text?.[0]?.plain_text || '';
    const name = page.properties['종목명']?.title?.[0]?.plain_text || `(${code})`;
    const krx  = krxMap.get(code);

    if (!krx) {
      log(`\n[SKIP] ${name}(${code}) — KRX 데이터 없음`);
      noKrx++;
      continue;
    }

    // 필드별 차이 계산
    const diffs = {};
    for (const [prop, key, tol] of FIELDS) {
      const notion = page.properties[prop]?.number ?? null;
      const krxVal = krx[key];
      if (notion === null || krxVal === undefined) continue;
      if (Math.abs(notion - krxVal) > tol) {
        diffs[prop] = { notion, krx: krxVal };
      }
    }

    // 종목명 비어있으면 KRX명으로 보정
    const notionName = page.properties['종목명']?.title?.[0]?.plain_text || '';
    const nameDiff = !notionName && krx.종목명;

    if (Object.keys(diffs).length === 0 && !nameDiff) {
      log(`[OK] ${name}(${code}) — 모든 필드 일치`);
      continue;
    }

    totalDiff += Object.keys(diffs).length + (nameDiff ? 1 : 0);

    // 차이 출력
    console.log(`\n[DIFF] ${name}(${code})`);
    if (nameDiff) {
      console.log(`  종목명   : 노션=비어있음 → KRX="${krx.종목명}"`);
    }
    for (const [prop, { notion, krx: krxVal }] of Object.entries(diffs)) {
      const fmtN = typeof notion === 'number' ? notion.toLocaleString() : notion;
      const fmtK = typeof krxVal === 'number' ? krxVal.toLocaleString() : krxVal;
      console.log(`  ${prop.padEnd(6)}: 노션=${fmtN}  →  KRX=${fmtK}`);
    }

    // PATCH 바디 구성
    const patchProps = {};
    if (nameDiff) {
      patchProps['종목명'] = { title: [{ text: { content: krx.종목명 } }] };
    }
    for (const [prop, { krx: krxVal }] of Object.entries(diffs)) {
      patchProps[prop] = { number: krxVal };
    }

    if (!DRY_RUN) {
      try {
        await notionReq('PATCH', `/v1/pages/${page.id}`, { properties: patchProps });
        log(`  → PATCH 완료`);
        patchOk++;
        await sleep(DELAY_MS);
      } catch(e) {
        log(`  → PATCH 오류: ${e.message}`);
        patchErr++;
      }
    } else {
      patchOk++;
    }
  }

  console.log('');
  log(`====== 완료 — 총 차이 ${totalDiff}건 | 패치:${patchOk} 오류:${patchErr} KRX없음:${noKrx} ======`);
}

main().catch(e => { log(`[치명 오류] ${e.message}`); process.exit(1); });
