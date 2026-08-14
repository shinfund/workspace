/**
 * notion_upload_lib.mjs — 업무 DB Notion 업로드 공통 라이브러리
 *
 * 진행 모니터링 (별도 터미널):
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\notion_upload.log"
 */

import https  from 'https';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const ExcelJS   = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));

export const TOKEN    = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
export const DELAY_MS = 400;

// ── 로그 ─────────────────────────────────────────────────
const LOG_FILE = 'C:\\Users\\shinf\\Workspace\\logs\\notion_upload.log';
const logDir   = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

export function initLog(label) {
  fs.writeFileSync(LOG_FILE, `=== ${label} ===\n`);
}
export function log(msg) {
  const line = `${new Date().toTimeString().slice(0, 8)} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ── 유틸 ─────────────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function notionRequest(method, endpoint, body, retry = 0) {
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
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        const d = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit: 재시도 초과'));
            await sleep(parseInt(res.headers['retry-after'] || '2') * 1000);
            resolve(await notionRequest(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          } else {
            resolve(json);
          }
        } catch(e) { reject(new Error(`파싱 오류: ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── 날짜 변환 ─────────────────────────────────────────────
export function toDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  }
  if (typeof value === 'number') {
    const d = new Date((value - 25569) * 86400 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return String(value).slice(0, 10);
}

// ── Excel 읽기 (헤더명 기준) ──────────────────────────────
export async function readExcelByHeader(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const headers = [];
  const rows = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        headers[colNum] = String(cell.value ?? '').trim();
      });
      return;
    }
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const h = headers[colNum];
      if (h) obj[h] = cell.value ?? null;
    });
    if (Object.values(obj).some(v => v !== null && v !== '')) rows.push(obj);
  });
  return rows;
}

// ── 관계형 DB 조회 (title → pageId 맵) ───────────────────
export async function buildRelationMap(dbId) {
  const map = new Map();
  let hasMore = true, cursor;
  while (hasMore) {
    const res = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results) {
      for (const val of Object.values(page.properties)) {
        if (val.type === 'title' && val.title.length > 0) {
          map.set(val.title[0].plain_text.trim(), page.id);
          break;
        }
      }
    }
    hasMore = res.has_more;
    cursor  = res.next_cursor;
    if (hasMore) await sleep(DELAY_MS);
  }
  return map;
}

// ── 기존 레코드 조회 (날짜 범위 + 중복 키 세트) ───────────
export async function buildExistingSet(dbId, dateField, startDate, endDate, keyFn) {
  const existing = new Set();
  let hasMore = true, cursor;
  while (hasMore) {
    const res = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
      filter: {
        and: [
          { property: dateField, date: { on_or_after:  startDate } },
          { property: dateField, date: { on_or_before: endDate   } },
        ],
      },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results) {
      const key = keyFn(page);
      if (key) existing.add(key);
    }
    hasMore = res.has_more;
    cursor  = res.next_cursor;
    if (hasMore) await sleep(DELAY_MS);
  }
  return existing;
}

// ── Notion 속성 생성 ──────────────────────────────────────
/**
 * fieldDefs: [{ excel, notion, type }]
 *   excel   — Excel 헤더명 (생략 시 notion 값 사용)
 *   notion  — Notion 속성명
 *   type    — title | date | number | select | multi_select | rich_text | phone_number | relation
 * relationMaps: { [notionKey]: Map<title, pageId> }
 */
export function buildProps(row, fieldDefs, relationMaps = {}) {
  const props = {};
  for (const def of fieldDefs) {
    const excelKey = def.excel ?? def.notion;
    const val = row[excelKey];
    if (val === null || val === undefined || val === '') continue;
    const key = def.notion;

    switch (def.type) {
      case 'title':
        props[key] = { title: [{ text: { content: String(val) } }] };
        break;
      case 'date': {
        const ds = toDateStr(val);
        if (ds) props[key] = { date: { start: ds } };
        break;
      }
      case 'number':
        if (!isNaN(Number(val))) props[key] = { number: Number(val) };
        break;
      case 'select':
        props[key] = { select: { name: String(val).trim() } };
        break;
      case 'multi_select':
        props[key] = {
          multi_select: String(val).split(',').map(s => ({ name: s.trim() })).filter(s => s.name),
        };
        break;
      case 'rich_text':
        props[key] = { rich_text: [{ text: { content: String(val) } }] };
        break;
      case 'phone_number':
        props[key] = { phone_number: String(val) };
        break;
      case 'relation': {
        const rm = relationMaps[key];
        const pid = rm?.get(String(val).trim());
        if (pid) props[key] = { relation: [{ id: pid }] };
        else if (rm) log(`  [경고] 관계 미발견: ${key}="${val}"`);
        break;
      }
    }
  }
  return props;
}

// ── 페이지 생성 ───────────────────────────────────────────
export async function createPage(dbId, props) {
  return notionRequest('POST', '/v1/pages', {
    parent: { database_id: dbId },
    properties: props,
  });
}

// ── 공통 메인 흐름 ────────────────────────────────────────
export async function runUpload({ label, filePath, dbId, dateField, fieldDefs, keyFn, relationSetup = async () => ({}), dryRun = false }) {
  if (!TOKEN) { console.error('[오류] NOTION_TOKEN 환경변수 없음'); process.exit(1); }
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`[오류] 파일 없음: ${filePath}`);
    process.exit(1);
  }

  const runLabel = dryRun ? `${label} [DRY-RUN]` : label;
  initLog(runLabel);
  log(`[업로드] ${runLabel}`);
  log(`[파일] ${filePath}`);

  log('[읽기] Excel 파싱 중...');
  const rows = await readExcelByHeader(filePath);
  if (!rows.length) { log('데이터 없음'); return; }
  log(`[읽기] ${rows.length}행 발견`);

  // 날짜 범위 산출
  const dates = rows.map(r => toDateStr(r[dateField])).filter(Boolean).sort();
  const startDate = dates[0];
  const endDate   = dates[dates.length - 1];
  log(`[범위] ${startDate} ~ ${endDate}`);

  log('[조회] 노션 기존 데이터 확인 중...');
  const existing = await buildExistingSet(dbId, dateField, startDate, endDate, keyFn);
  log(`[조회] 기존 ${existing.size}건`);

  const relationMaps = {};
  if (!dryRun) {
    log('[관계] 관계형 DB 로딩 중...');
    Object.assign(relationMaps, await relationSetup());
  }

  let saved = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  for (const row of rows) {
    const rowKey = keyFn({ properties: buildMockProps(row, fieldDefs) });
    const label2 = rowKey ?? JSON.stringify(row).slice(0, 40);

    if (existing.has(rowKey)) {
      log(`  스킵: ${label2}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      log(`  예정: ${label2}`);
      saved++;
      continue;
    }

    try {
      const props = buildProps(row, fieldDefs, relationMaps);
      await createPage(dbId, props);
      await sleep(DELAY_MS);
      saved++;
      log(`  완료: ${label2}`);
    } catch(e) {
      log(`  오류: ${label2} → ${e.message}`);
      errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('──────────────────────────────────');
  if (dryRun) log(`예정: ${saved}건 업로드, ${skipped}건 스킵`);
  else        log(`완료: ${saved}건 업로드, ${skipped}건 스킵, ${errors}건 오류`);
  log(`소요: ${elapsed}초`);
}

// keyFn 내부에서 buildMockProps로 속성 값 추출용 헬퍼
function buildMockProps(row, fieldDefs) {
  const p = {};
  for (const def of fieldDefs) {
    const excelKey = def.excel ?? def.notion;
    const val = row[excelKey];
    if (val === null || val === undefined || val === '') continue;
    const key = def.notion;
    switch (def.type) {
      case 'title':    p[key] = { type: 'title', title: [{ plain_text: String(val) }] }; break;
      case 'date':     p[key] = { type: 'date', date: { start: toDateStr(val) } }; break;
      case 'select':   p[key] = { type: 'select', select: { name: String(val).trim() } }; break;
      case 'rich_text': p[key] = { type: 'rich_text', rich_text: [{ plain_text: String(val) }] }; break;
      default:         p[key] = { type: def.type, _val: val }; break;
    }
  }
  return p;
}
