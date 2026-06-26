/**
 * patch_listed_shares_20260625.mjs
 * 노션 거래대금DB 2026-06-25 레코드의 상장주식수를 KRX 데이터로 패치
 * Usage: node patch_listed_shares_20260625.mjs [--dry-run]
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

function log(msg) { console.log(`${new Date().toTimeString().slice(0,8)} ${msg}`); }

// ── KRX API 조회 ─────────────────────────────────────────────
function krxGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error(`KRX 파싱 오류: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchKrxShares(basDt) {
  const BASE = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo`;
  const url1 = `${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=1&resultType=json&basDt=${basDt}`;
  const first = await krxGet(url1);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  let items   = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];

  log(`[KRX] ${basDt} 전체 ${total}건, 1페이지 ${items.length}건`);

  for (let p = 2; p <= Math.ceil(total / 2000); p++) {
    const r = await krxGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=${p}&resultType=json&basDt=${basDt}`);
    const more = r?.response?.body?.items?.item || [];
    items = items.concat(more);
    log(`[KRX] ${p}페이지 ${more.length}건`);
  }

  // 종목코드 → 상장주식수 맵
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const shares = Number(item.lstgStCnt || 0);
    if (shares > 0) map.set(code, shares);
  }
  log(`[KRX] 상장주식수 보유 종목 ${map.size}개`);
  return map;
}

// ── Notion REST API ───────────────────────────────────────────
async function notionReq(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: endpoint,
      method,
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
            if (retry >= 3) return reject(new Error('Notion rate limit 초과'));
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

// ── 노션 DB에서 6/25 페이지 전체 조회 ───────────────────────
async function getNotionPages() {
  const pages = [];
  let cursor = undefined;
  while (true) {
    const body = {
      filter: { property: '날짜', date: { equals: TARGET_DATE } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    };
    const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, body);
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN) { log('[오류] NOTION_TOKEN 환경변수 없음'); process.exit(1); }

  log(`====== 상장주식수 패치 시작 [${TARGET_DATE}]${DRY_RUN ? ' (DRY-RUN)' : ''} ======`);

  // 1. KRX 데이터 수집
  log('[Step 1] KRX 상장주식수 조회...');
  const krxMap = await fetchKrxShares(KRX_DATE);

  // 2. 노션 6/25 페이지 조회
  log('[Step 2] 노션 거래대금DB 6/25 페이지 조회...');
  const pages = await getNotionPages();
  log(`[Step 2] 노션 페이지 ${pages.length}건`);

  if (pages.length === 0) {
    log('[완료] 업데이트할 페이지 없음');
    return;
  }

  // 3. 각 페이지 PATCH
  log('[Step 3] 상장주식수 패치...');
  let ok = 0, skip = 0, err = 0;

  for (const page of pages) {
    const code = page.properties['종목코드']?.rich_text?.[0]?.plain_text || '';
    const name = page.properties['종목명']?.title?.[0]?.plain_text || '';
    const currentShares = page.properties['상장주식수']?.number ?? null;
    const newShares = krxMap.get(code);

    if (!code) { skip++; continue; }

    if (!newShares) {
      log(`  SKIP ${name}(${code}) — KRX 상장주식수 없음`);
      skip++;
      continue;
    }

    if (currentShares === newShares) {
      log(`  SKIP ${name}(${code}) — 이미 동일 (${newShares.toLocaleString()}주)`);
      skip++;
      continue;
    }

    log(`  PATCH ${name}(${code}) ${(currentShares ?? 0).toLocaleString()} → ${newShares.toLocaleString()}주`);

    if (!DRY_RUN) {
      try {
        await notionReq('PATCH', `/v1/pages/${page.id}`, {
          properties: { '상장주식수': { number: newShares } }
        });
        ok++;
      } catch(e) {
        log(`  ERROR ${name}(${code}): ${e.message}`);
        err++;
      }
      await sleep(DELAY_MS);
    } else {
      ok++;
    }
  }

  log(`====== 완료 — 패치:${ok} 스킵:${skip} 오류:${err} ======`);
}

main().catch(e => { log(`[치명 오류] ${e.message}`); process.exit(1); });
