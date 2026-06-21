/**
 * krx_notion_upload.mjs — 거래대금 Excel → Notion 거래대금DB 직접 업로드
 *
 * Usage:
 *   node krx_notion_upload.mjs YYYY MM          ← 해당 월 전체 업로드
 *   node krx_notion_upload.mjs YYYY MM --dry-run ← 실제 업로드 없이 확인만
 *
 * 진행 모니터링 (별도 터미널):
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\krx_notion_upload.log"
 *
 * 특징:
 *   - LLM 없이 Excel → Notion REST API 직접 호출 → 초고속
 *   - 월 단위 중복 날짜 일괄 조회 → 이미 업로드된 날짜 자동 스킵
 *   - 18개 필드 전체 업로드
 *   - 429 Rate Limit 발생 시 자동 재시도 (최대 3회)
 *   - 진행상황 로그: C:\Users\shinf\Workspace\logs\krx_notion_upload.log
 */

import https   from 'https';
import fs      from 'fs';
import path    from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const ExcelJS   = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));

// ── 설정 ─────────────────────────────────────────────────
const TOKEN    = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DB_ID    = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const BASE_DIR = 'C:\\Users\\shinf\\Workspace\\data\\거래대금';
const LOG_FILE = 'C:\\Users\\shinf\\Workspace\\logs\\krx_notion_upload.log';
const DELAY_MS = 400;   // 페이지 생성 간 딜레이 (2.5 req/sec, 한도 3/sec)

// ── 로그 ─────────────────────────────────────────────────
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function log(msg) {
  const line = `${new Date().toTimeString().slice(0,8)} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ── 유틸 ─────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
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
            if (retry >= 3) return reject(new Error('Rate limit: 재시도 초과'));
            const wait = parseInt(res.headers['retry-after'] || '2') * 1000;
            await sleep(wait);
            resolve(await notionRequest(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          } else {
            resolve(json);
          }
        } catch(e) { reject(new Error(`파싱 오류: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── 중복 날짜 조회 (월 단위 1회) ────────────────────────
async function getUploadedDates(year, month) {
  const mm       = String(month).padStart(2, '0');
  const lastDay  = new Date(year, month, 0).getDate();
  const startDt  = `${year}-${mm}-01`;
  const endDt    = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const dates  = new Set();
  let hasMore  = true;
  let cursor;

  while (hasMore) {
    const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
      filter: {
        and: [
          { property: '날짜', date: { on_or_after:  startDt } },
          { property: '날짜', date: { on_or_before: endDt   } },
        ],
      },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results) {
      const d = page.properties['날짜']?.date?.start;
      if (d) dates.add(d.slice(0, 10));
    }
    hasMore = res.has_more;
    cursor  = res.next_cursor;
    if (hasMore) await sleep(DELAY_MS);
  }
  return dates;
}

// ── Excel 읽기 ────────────────────────────────────────────
function cellNum(row, idx) {
  const v = row.getCell(idx).value;
  return v === null || v === undefined ? 0 : Number(v);
}
function cellStr(row, idx) {
  const v = row.getCell(idx).value;
  return v === null || v === undefined ? '' : String(v);
}
function cellDate(row, idx) {
  const v = row.getCell(idx).value;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  }
  return String(v).slice(0, 10);
}

async function readExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    rows.push({
      날짜:      cellDate(row, 1),
      순위:      cellNum(row, 2),
      시장:      cellStr(row, 3),
      종목코드:  cellStr(row, 4).padStart(6, '0'),
      종목명:    cellStr(row, 5),
      상장주식수: cellNum(row, 6),
      시가:      cellNum(row, 7),
      고가:      cellNum(row, 8),
      저가:      cellNum(row, 9),
      종가:      cellNum(row, 10),
      전일종가:  cellNum(row, 11),
      전일대비:  cellNum(row, 12),
      등락률:    cellNum(row, 13),
      변동폭:    cellNum(row, 14),
      거래량:    cellNum(row, 15),
      거래대금:  cellNum(row, 16),
      시가총액:  cellNum(row, 17),
      회전율:    cellNum(row, 18),
    });
  });
  return rows;
}

// ── 페이지 생성 ───────────────────────────────────────────
async function createPage(row) {
  return notionRequest('POST', '/v1/pages', {
    parent: { database_id: DB_ID },
    properties: {
      '종목명':   { title:     [{ text: { content: row.종목명 } }] },
      '날짜':     { date:      { start: row.날짜 } },
      '순위':     { number:    row.순위 },
      '종목코드': { rich_text: [{ text: { content: row.종목코드 } }] },
      '시장':     { rich_text: [{ text: { content: row.시장 } }] },
      '상장주식수': { number:  row.상장주식수 },
      '시가':     { number:    row.시가 },
      '고가':     { number:    row.고가 },
      '저가':     { number:    row.저가 },
      '종가':     { number:    row.종가 },
      '전일종가': { number:    row.전일종가 },
      '전일대비': { number:    row.전일대비 },
      '등락률':   { number:    row.등락률 },
      '변동폭':   { number:    row.변동폭 },
      '거래량':   { number:    row.거래량 },
      '거래대금': { number:    row.거래대금 },
      '시가총액': { number:    row.시가총액 },
      '회전율':   { number:    row.회전율 },
    },
  });
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  if (!TOKEN) {
    console.error('[오류] NOTION_TOKEN 환경변수가 없습니다.');
    process.exit(1);
  }

  const argv   = process.argv.slice(2);
  const year   = parseInt(argv[0]);
  const month  = parseInt(argv[1]);
  const dryRun = argv.includes('--dry-run');

  if (!year || !month || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    console.error('사용법: node krx_notion_upload.mjs YYYY MM [--dry-run]');
    process.exit(1);
  }

  const mm       = String(month).padStart(2, '0');
  const monthDir = path.join(BASE_DIR, `${year}년`, `${mm}월`);

  if (!fs.existsSync(monthDir)) {
    console.error(`[오류] 폴더 없음: ${monthDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(monthDir)
    .filter(f => /^거래대금_\d{8}\.xlsx$/.test(f))
    .sort();

  if (!files.length) {
    console.log('업로드할 파일 없음');
    return;
  }

  // 로그 파일 초기화 (새 실행마다 덮어쓰기)
  fs.writeFileSync(LOG_FILE, `=== ${year}년 ${month}월 거래대금DB 업로드 시작 ===\n`);

  const label = dryRun ? ' [DRY-RUN]' : '';
  log(`[Notion] ${year}년 ${month}월 거래대금DB 업로드${label}`);
  log(`[파일] ${files.length}일치 Excel 발견`);
  log('[조회] 이미 업로드된 날짜 확인 중...');
  const uploadedDates = await getUploadedDates(year, month);
  log(`[조회] ${uploadedDates.size}일 기확인`);

  let saved = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  for (const file of files) {
    const basDt   = file.replace('거래대금_', '').replace('.xlsx', '');
    const dateStr = `${basDt.slice(0,4)}-${basDt.slice(4,6)}-${basDt.slice(6,8)}`;

    if (uploadedDates.has(dateStr)) {
      log(`  ${dateStr} ... 스킵 (이미 업로드됨)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      log(`  ${dateStr} ... 업로드 예정 (dry-run)`);
      saved++;
      continue;
    }

    try {
      const rows = await readExcel(path.join(monthDir, file));
      for (const row of rows) {
        await createPage(row);
        await sleep(DELAY_MS);
      }
      saved++;
      log(`  ${dateStr} ... 완료 (${rows.length}건)`);
    } catch(e) {
      log(`  ${dateStr} ... 오류: ${e.message}`);
      errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('──────────────────────────────────');
  log(`업로드 완료: ${saved}일 × 20건 = ${saved * 20}건`);
  if (skipped) log(`스킵 (중복): ${skipped}일`);
  if (errors)  log(`오류: ${errors}일`);
  log(`소요 시간: ${elapsed}초`);
  log(`[경로] ${monthDir}`);
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
