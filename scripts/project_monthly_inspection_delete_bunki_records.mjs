// project_monthly_inspection_delete_bunki_records.mjs
// 월간점검DB: 비고="분기" 이면서 점검일자가 있는 레코드 삭제(노션 휴지통으로 archive)
//
// 사용법:
//   node scripts/project_monthly_inspection_delete_bunki_records.mjs           # dry-run
//   node scripts/project_monthly_inspection_delete_bunki_records.mjs --apply   # 실제 삭제(archive)

import { notionRequest, sleep, log, initLog } from './notion_upload_lib.mjs';

const DB_ID = 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69'; // 월간점검DB
const APPLY = process.argv.includes('--apply');
const KEYWORDS = ['분기', '반기', '연차'];

function hasKeyword(text) {
  return KEYWORDS.some(k => (text || '').includes(k));
}

async function fetchTargets() {
  const results = [];
  let cursor;
  do {
    const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return results.filter(page => {
    const p = page.properties;
    const bigo = (p['비고']?.rich_text || []).map(t => t.plain_text).join('');
    const date = p['점검일자']?.date?.start;
    return hasKeyword(bigo) && !!date;
  });
}

function describe(page) {
  const p = page.properties;
  const tunnel = p['터널명']?.select?.name || '';
  const date = p['점검일자']?.date?.start || '';
  const gubun = p['구분']?.select?.name || '';
  const equip = p['설비명']?.select?.name || '';
  const title = (p['제목']?.title || []).map(t => t.plain_text).join('');
  const bigo = (p['비고']?.rich_text || []).map(t => t.plain_text).join('');
  return { pageId: page.id, tunnel, date, gubun, equip, title, bigo };
}

async function main() {
  initLog(APPLY ? '월간점검DB 분기/반기/연차 레코드 삭제 [APPLY]' : '월간점검DB 분기/반기/연차 레코드 삭제 [DRY-RUN]');
  const pages = await fetchTargets();
  log(`[조회] 대상 ${pages.length}건 (비고에 분기/반기/연차 포함 + 점검일자 있음)`);

  const targets = pages.map(describe);

  if (!APPLY) {
    for (const t of targets) {
      log(`  예정: ${t.tunnel} | ${t.date} | [${t.gubun}/${t.equip}] "${t.title}" | 비고="${t.bigo}"`);
    }
    log('──────────────────────────────────');
    log(`dry-run 완료: ${targets.length}건. 실제 삭제(archive)하려면 --apply 옵션으로 재실행.`);
    return;
  }

  let done = 0, errors = 0;
  for (const t of targets) {
    try {
      await notionRequest('PATCH', `/v1/pages/${t.pageId}`, { archived: true });
      done++;
      log(`  삭제완료: ${t.tunnel} | ${t.date} | "${t.title}"`);
      await sleep(350);
    } catch (e) {
      errors++;
      log(`  오류: ${t.pageId} → ${e.message}`);
    }
  }
  log('──────────────────────────────────');
  log(`완료: ${done}건 삭제, 오류: ${errors}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
