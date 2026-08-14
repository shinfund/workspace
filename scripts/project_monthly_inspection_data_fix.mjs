// project_monthly_inspection_data_fix.mjs
// 월간점검DB: 구분="기타"/"태양광발전설비" 레코드 정리
//   - 설비명 공란화
//   - 기존 제목 내용 → 점검내용으로 이동
//   - 제목 → "{터널명} 월간점검결과표"
//
// 사용법:
//   node scripts/project_monthly_inspection_data_fix.mjs           # dry-run (변경 예정 목록만 출력)
//   node scripts/project_monthly_inspection_data_fix.mjs --apply   # 실제 반영

import { notionRequest, sleep, log, initLog } from './notion_upload_lib.mjs';

const DB_ID = 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69'; // 월간점검DB
const APPLY = process.argv.includes('--apply');

async function fetchTargets() {
  const results = [];
  let cursor;
  do {
    const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
      filter: {
        or: [
          { property: '구분', select: { equals: '기타' } },
          { property: '구분', select: { equals: '태양광발전설비' } },
        ],
      },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function buildUpdate(page) {
  const p = page.properties;
  const tunnel = p['터널명']?.select?.name || '';
  const oldTitle = (p['제목']?.title || []).map(t => t.plain_text).join('');
  const gubun = p['구분']?.select?.name || '';
  const equip = p['설비명']?.select?.name || null;
  const newTitle = `${tunnel} 월간점검결과표`;
  return { pageId: page.id, tunnel, gubun, equip, oldTitle, newTitle };
}

async function main() {
  initLog(APPLY ? '월간점검DB 데이터정리 [APPLY]' : '월간점검DB 데이터정리 [DRY-RUN]');
  const pages = await fetchTargets();
  log(`[조회] 대상 ${pages.length}건 (구분: 기타/태양광발전설비)`);

  const updates = pages.map(buildUpdate);

  if (!APPLY) {
    for (const u of updates) {
      log(`  예정: [${u.gubun}] ${u.tunnel} | 설비명 "${u.equip ?? '(공란)'}"→공란 | 제목 "${u.oldTitle}" → 점검내용 | 제목 → "${u.newTitle}"`);
    }
    log('──────────────────────────────────');
    log(`dry-run 완료: ${updates.length}건. 실제 반영하려면 --apply 옵션으로 재실행.`);
    return;
  }

  let done = 0, errors = 0;
  for (const u of updates) {
    try {
      await notionRequest('PATCH', `/v1/pages/${u.pageId}`, {
        properties: {
          '설비명': { select: null },
          '점검내용': { rich_text: [{ text: { content: u.oldTitle } }] },
          '제목': { title: [{ text: { content: u.newTitle } }] },
        },
      });
      done++;
      log(`  완료: ${u.tunnel} | ${u.oldTitle} → "${u.newTitle}"`);
      await sleep(350);
    } catch (e) {
      errors++;
      log(`  오류: ${u.pageId} → ${e.message}`);
    }
  }
  log('──────────────────────────────────');
  log(`완료: ${done}건, 오류: ${errors}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
