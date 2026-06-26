/**
 * sync_krx_notion.mjs — KRX 확정 데이터로 노션 거래대금DB 패치 (범용)
 *
 * Usage:
 *   node sync_krx_notion.mjs --date YYYYMMDD [--dry-run]
 *   (--date 생략 시 직전 거래일 자동 감지)
 *
 * 비교·패치 필드: 상장주식수, OHLC, 전일종가, 전일대비, 등락률,
 *                 변동폭, 거래량, 거래대금, 시가총액, 회전율, 종목명
 */

import https from 'https';
import fs    from 'fs';
import path  from 'path';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_TRADEAMT  = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const KRX_API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const LOG_FILE     = 'C:\\Users\\shinf\\Workspace\\logs\\sync_krx_notion.log';
const DELAY_MS     = 420;

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const dateIdx = argv.indexOf('--date');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `${new Date().toTimeString().slice(0,8)} ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ── 직전 거래일 자동 감지 (KRX API 조회) ────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error(`파싱 오류: ${d.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

function kstDateStr(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

async function resolveDateArg() {
  if (dateIdx >= 0 && argv[dateIdx + 1]) {
    const raw = argv[dateIdx + 1];
    if (!/^\d{8}$/.test(raw)) throw new Error(`--date 형식 오류: ${raw} (YYYYMMDD 필요)`);
    return raw;
  }
  // 자동 감지: 최근 7일 중 KRX 데이터 있는 가장 최근 거래일
  const BASE = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo`;
  for (let d = 1; d <= 7; d++) {
    const dt = kstDateStr(d);
    const r  = await httpGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=1&pageNo=1&resultType=json&basDt=${dt}`);
    if (Number(r?.response?.body?.totalCount || 0) > 0) {
      log(`[날짜] 자동 감지: ${dt}`);
      return dt;
    }
    log(`[날짜] ${dt} 없음...`);
  }
  throw new Error('7일 이내 유효 KRX 데이터 없음');
}

// ── KRX 전체 조회 → 종목코드 맵 ─────────────────────────────
async function fetchKrxMap(basDt) {
  const BASE = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo`;
  const first = await httpGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=1&resultType=json&basDt=${basDt}`);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  let items   = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  log(`[KRX] ${basDt} 전체 ${total}건, 1페이지 ${items.length}건`);

  for (let p = 2; p <= Math.ceil(total / 2000); p++) {
    const r    = await httpGet(`${BASE}?serviceKey=${KRX_API_KEY}&numOfRows=2000&pageNo=${p}&resultType=json&basDt=${basDt}`);
    const more = r?.response?.body?.items?.item || [];
    items      = items.concat(more);
  }

  // 종목코드 중복 시 시가총액 최대값 우선
  const raw = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev = raw.get(code);
    if (!prev || Number(item.mrktTotAmt || 0) > Number(prev.mrktTotAmt || 0)) raw.set(code, item);
  }

  const map = new Map();
  for (const [code, item] of raw.entries()) {
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
    map.set(code, {
      종목명: (item.itmsNm || '').trim(),
      상장주식수, 종가, 시가, 고가, 저가,
      전일대비, 전일종가, 등락률,
      거래량, 거래대금, 시가총액, 회전율, 변동폭,
    });
  }
  log(`[KRX] 유효 종목 ${map.size}개`);
  return map;
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
            reject(new Error(`Notion ${res.statusCode}: ${json.message || d.slice(0,200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Notion 파싱 오류: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getNotionPages(notionDate) {
  const pages = [];
  let cursor;
  while (true) {
    const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, {
      filter: { property: '날짜', date: { equals: notionDate } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

// ── 비교 필드 [노션속성명, KRX키, 허용오차] ──────────────────
const FIELDS = [
  ['상장주식수', '상장주식수', 0   ],
  ['시가',      '시가',       0   ],
  ['고가',      '고가',       0   ],
  ['저가',      '저가',       0   ],
  ['종가',      '종가',       0   ],
  ['전일종가',  '전일종가',   0   ],
  ['전일대비',  '전일대비',   0   ],
  ['등락률',    '등락률',     0.01],
  ['변동폭',    '변동폭',     0   ],
  ['거래량',    '거래량',     0   ],
  ['거래대금',  '거래대금',   0   ],
  ['시가총액',  '시가총액',   0   ],
  ['회전율',    '회전율',     0.01],
];

// ── YYYYMMDD → YYYY-MM-DD ────────────────────────────────────
function toNotionDate(krxDate) {
  return `${krxDate.slice(0,4)}-${krxDate.slice(4,6)}-${krxDate.slice(6,8)}`;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN) { log('[오류] NOTION_TOKEN 환경변수 없음'); process.exit(1); }

  const krxDate    = await resolveDateArg();
  const notionDate = toNotionDate(krxDate);

  log(`====== KRX→Notion 동기화 [${notionDate}]${DRY_RUN ? ' (DRY-RUN)' : ''} ======`);

  const [krxMap, pages] = await Promise.all([
    fetchKrxMap(krxDate),
    (async () => {
      log(`[Notion] 거래대금DB ${notionDate} 페이지 조회...`);
      const p = await getNotionPages(notionDate);
      log(`[Notion] ${p.length}건`);
      return p;
    })()
  ]);

  if (pages.length === 0) {
    log(`[완료] 노션 ${notionDate} 데이터 없음 — 스킵`);
    return;
  }

  let ok = 0, same = 0, noKrx = 0, err = 0;

  for (const page of pages) {
    const code = page.properties['종목코드']?.rich_text?.[0]?.plain_text || '';
    const name = page.properties['종목명']?.title?.[0]?.plain_text || `(${code})`;
    const krx  = krxMap.get(code);

    if (!code || !krx) {
      log(`[SKIP] ${name} — KRX 데이터 없음`);
      noKrx++;
      continue;
    }

    const diffs = {};
    for (const [prop, key, tol] of FIELDS) {
      const nVal = page.properties[prop]?.number ?? null;
      const kVal = krx[key];
      if (nVal === null || kVal === undefined) continue;
      if (Math.abs(nVal - kVal) > tol) diffs[prop] = { n: nVal, k: kVal };
    }

    // 종목명 비어있으면 KRX값으로 보정
    const notionName = page.properties['종목명']?.title?.[0]?.plain_text || '';
    const nameFix    = !notionName && krx.종목명;

    if (Object.keys(diffs).length === 0 && !nameFix) {
      log(`[OK] ${name}(${code})`);
      same++;
      continue;
    }

    // 차이 출력
    const diffList = Object.entries(diffs).map(([p, {n, k}]) =>
      `${p}(${n.toLocaleString()}→${k.toLocaleString()})`).join(', ');
    log(`[PATCH] ${name}(${code}) — ${nameFix ? '종목명 보정, ' : ''}${diffList}`);

    if (!DRY_RUN) {
      const patchProps = {};
      if (nameFix) patchProps['종목명'] = { title: [{ text: { content: krx.종목명 } }] };
      for (const [prop, { k }] of Object.entries(diffs)) patchProps[prop] = { number: k };
      try {
        await notionReq('PATCH', `/v1/pages/${page.id}`, { properties: patchProps });
        ok++;
      } catch(e) {
        log(`  ERROR: ${e.message}`);
        err++;
      }
      await sleep(DELAY_MS);
    } else {
      ok++;
    }
  }

  log(`====== 완료 [${notionDate}] — 패치:${ok} 일치:${same} KRX없음:${noKrx} 오류:${err} ======`);
}

main().catch(e => { log(`[치명 오류] ${e.message}`); process.exit(1); });
