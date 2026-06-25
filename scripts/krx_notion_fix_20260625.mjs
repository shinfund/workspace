/**
 * krx_notion_fix_20260625.mjs — 2026-06-24 거래대금DB 누락값 보정
 *
 * 문제점:
 *   1) 상장주식수 = 0 (전체 10건)
 *   2) 시가총액/거래대금/거래량/전일종가 등 KIS 실시간값 → KRX 확정값 교체
 *   3) 순위10 알테오젠 (KIS 오류) → 아카이브 후 LG전자(KRX 실제 10위) 추가
 *
 * Usage: node scripts/krx_notion_fix_20260625.mjs [--dry-run]
 */

import https from 'https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DB_ID = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const DATE  = '2026-06-24';
const DRY   = process.argv.includes('--dry-run');
const DELAY = 420;

// ── KRX 확정 데이터 (2026-06-24 TOP10) ───────────────────────
const KRX = [
  { 순위:1,  종목코드:'000660', 종목명:'SK하이닉스', 시장:'KOSPI',  시가:2598000, 고가:2703000, 저가:2453000, 종가:2580000, 전일종가:2555000, 전일대비:25000,  등락률:0.98,  변동폭:250000, 거래량:7487916,   거래대금:19385797230696, 시가총액:1838772101700000, 상장주식수:712702365,   회전율:1.05 },
  { 순위:2,  종목코드:'005930', 종목명:'삼성전자',   시장:'KOSPI',  시가:314000,  고가:341000,  저가:314000,  종가:340500, 전일종가:310000,  전일대비:30500,  등락률:9.84,  변동폭:27000,  거래량:47809959,  거래대금:15837943400424, 시가총액:1990657866024000, 상장주식수:5846278608, 회전율:0.82 },
  { 순위:3,  종목코드:'402340', 종목명:'SK스퀘어',   시장:'KOSPI',  시가:1885000, 고가:1910000, 저가:1611000, 종가:1799000, 전일종가:1832000, 전일대비:-33000, 등락률:-1.80, 변동폭:299000, 거래량:2170209,   거래대금:3832857085239,  시가총액:237393136414000,  상장주식수:131958386,  회전율:1.64 },
  { 순위:4,  종목코드:'009150', 종목명:'삼성전기',   시장:'KOSPI',  시가:1980000, 고가:2090000, 저가:1901000, 종가:1964000, 전일종가:1990000, 전일대비:-26000, 등락률:-1.31, 변동폭:189000, 거래량:1093489,   거래대금:2178350299461,  시가총액:146698418944000,  상장주식수:74693696,   회전율:1.46 },
  { 순위:5,  종목코드:'005380', 종목명:'현대차',     시장:'KOSPI',  시가:513000,  고가:522000,  저가:493500,  종가:509000, 전일종가:511000,  전일대비:-2000,  등락률:-0.39, 변동폭:28500,  거래량:1238769,   거래대금:631565471000,   시가총액:104221702894000,  상장주식수:204757766,  회전율:0.60 },
  { 순위:6,  종목코드:'028260', 종목명:'삼성물산',   시장:'KOSPI',  시가:477000,  고가:522000,  저가:470000,  종가:481500, 전일종가:455000,  전일대비:26500,  등락률:5.82,  변동폭:52000,  거래량:1136130,   거래대금:559273209750,   시가총액:78083690251500,   상장주식수:162167581,  회전율:0.70 },
  { 순위:7,  종목코드:'080220', 종목명:'제주반도체', 시장:'KOSDAQ', 시가:114500,  고가:121400,  저가:107900,  종가:112900, 전일종가:110800,  전일대비:2100,   등락률:1.90,  변동폭:13500,  거래량:3591097,   거래대금:411649072150,   시가총액:3888595845700,    상장주식수:34442833,   회전율:10.43 },
  { 순위:8,  종목코드:'011070', 종목명:'LG이노텍',   시장:'KOSPI',  시가:969000,  고가:1022000, 저가:936000,  종가:957000, 전일종가:991000,  전일대비:-34000, 등락률:-3.43, 변동폭:86000,  거래량:404278,    거래대금:392660595500,   시가총액:22649421399000,   상장주식수:23667107,   회전율:1.71 },
  { 순위:9,  종목코드:'032830', 종목명:'삼성생명',   시장:'KOSPI',  시가:435500,  고가:443000,  저가:415500,  종가:433000, 전일종가:425000,  전일대비:8000,   등락률:1.88,  변동폭:27500,  거래량:708886,    거래대금:305315030500,   시가총액:86600000000000,   상장주식수:200000000,  회전율:0.35 },
  { 순위:10, 종목코드:'066570', 종목명:'LG전자',     시장:'KOSPI',  시가:202500,  고가:209500,  저가:198200,  종가:204500, 전일종가:202000,  전일대비:2500,   등락률:1.24,  변동폭:11300,  거래량:1449985,   거래대금:295694415350,   시가총액:33309908471000,   상장주식수:162884638,  회전율:0.89 },
];

// ── 기존 Notion 페이지 ID (사전 조회 결과) ───────────────────
const EXISTING_BY_CODE = {
  '000660': '38959c8c-9c0a-819a-830c-e11736735ed8',
  '005930': '38959c8c-9c0a-81dd-8763-cfbffa943027',
  '402340': '38959c8c-9c0a-81ba-b76f-fdd546d3fe42',
  '009150': '38959c8c-9c0a-8112-95c0-d7e3c9390d71',
  '005380': '38959c8c-9c0a-81d6-a01e-ebb98be307ae',
  '028260': '38959c8c-9c0a-81cd-9be3-e8aedbe9828e',
  '080220': '38959c8c-9c0a-81e1-bb12-e1b51034f2e6',
  '011070': '38959c8c-9c0a-8181-a1b2-ed133544626a',
  '032830': '38959c8c-9c0a-812c-bb09-d06c55155f82',
};
const ALTEO_PAGE_ID = '38959c8c-9c0a-8115-8c74-e72c2d1ec1ed'; // 알테오젠(196170)

// ── 유틸 ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function notionReq(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: endpoint,
      method,
      headers: {
        'Authorization':  `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit 초과'));
            await sleep((parseInt(res.headers['retry-after'] || '2') * 1000) + 500);
            resolve(await notionReq(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message || d.slice(0, 200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`파싱 오류: ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function buildProps(r) {
  return {
    '종목명':    { title:     [{ text: { content: r.종목명 } }] },
    '날짜':      { date:      { start: DATE } },
    '순위':      { number:    r.순위 },
    '종목코드':  { rich_text: [{ text: { content: r.종목코드 } }] },
    '시장':      { rich_text: [{ text: { content: r.시장 } }] },
    '상장주식수':{ number:    r.상장주식수 },
    '시가':      { number:    r.시가 },
    '고가':      { number:    r.고가 },
    '저가':      { number:    r.저가 },
    '종가':      { number:    r.종가 },
    '전일종가':  { number:    r.전일종가 },
    '전일대비':  { number:    r.전일대비 },
    '등락률':    { number:    r.등락률 },
    '변동폭':    { number:    r.변동폭 },
    '거래량':    { number:    r.거래량 },
    '거래대금':  { number:    r.거래대금 },
    '시가총액':  { number:    r.시가총액 },
    '회전율':    { number:    r.회전율 },
  };
}

async function main() {
  if (!TOKEN) { console.error('[오류] NOTION_TOKEN 없음'); process.exit(1); }

  console.log(`=== 2026-06-24 거래대금DB 보정 시작${DRY ? ' [DRY-RUN]' : ''} ===`);
  console.log('보정 내용: 상장주식수/시가총액/거래대금 KRX 확정값 적용, 알테오젠→LG전자 교체\n');

  let patched = 0, created = 0, archived = 0, errors = 0;

  // ── Step 1: 알테오젠 아카이브 (KRX TOP30에 없는 오류 데이터) ─
  console.log('[1] 알테오젠(196170) 아카이브 — KRX 비확인 오류 데이터');
  if (!DRY) {
    try {
      await notionReq('PATCH', `/v1/pages/${ALTEO_PAGE_ID}`, { archived: true });
      archived++;
      console.log('    ✓ 알테오젠 아카이브 완료');
    } catch(e) {
      console.error(`    ✗ 아카이브 오류: ${e.message}`);
      errors++;
    }
    await sleep(DELAY);
  } else {
    console.log('    → DRY: 알테오젠 아카이브 예정');
  }

  // ── Step 2: 1-9위 기존 레코드 PATCH ─────────────────────────
  console.log('\n[2] 순위 1-9 PATCH (전 필드 KRX 확정값으로 보정)');
  for (const r of KRX.filter(x => x.순위 <= 9)) {
    const pageId = EXISTING_BY_CODE[r.종목코드];
    if (!pageId) {
      console.log(`    ! ${r.종목명} — 기존 페이지 없음 (스킵)`);
      continue;
    }
    if (!DRY) {
      try {
        await notionReq('PATCH', `/v1/pages/${pageId}`, { properties: buildProps(r) });
        patched++;
        console.log(`    ✓ ${r.순위}위 ${r.종목명}: 상장주식수=${r.상장주식수.toLocaleString()}, 거래대금=${Math.round(r.거래대금/1e8)}억`);
      } catch(e) {
        console.error(`    ✗ ${r.종목명} 오류: ${e.message}`);
        errors++;
      }
      await sleep(DELAY);
    } else {
      console.log(`    → DRY: ${r.순위}위 ${r.종목명} — 상장주식수:${r.상장주식수.toLocaleString()}, 시가총액:${(r.시가총액/1e12).toFixed(1)}조`);
    }
  }

  // ── Step 3: LG전자(10위) 신규 생성 ──────────────────────────
  const lgData = KRX.find(x => x.순위 === 10);
  console.log(`\n[3] LG전자(066570) 10위 신규 생성 — KRX 실제 10위`);
  if (!DRY) {
    try {
      await notionReq('POST', '/v1/pages', {
        parent: { database_id: DB_ID },
        properties: buildProps(lgData),
      });
      created++;
      console.log('    ✓ LG전자 생성 완료');
    } catch(e) {
      console.error(`    ✗ LG전자 생성 오류: ${e.message}`);
      errors++;
    }
  } else {
    console.log(`    → DRY: LG전자 생성 예정 (거래대금 ${Math.round(lgData.거래대금/1e8)}억)`);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`PATCH:   ${patched}건 (1-9위 필드 보정)`);
  console.log(`CREATE:  ${created}건 (LG전자 10위)`);
  console.log(`ARCHIVE: ${archived}건 (알테오젠 제거)`);
  console.log(`오류:    ${errors}건`);
  console.log('=== 완료 ===');
}

main().catch(e => { console.error('[치명 오류]', e.message); process.exit(1); });
