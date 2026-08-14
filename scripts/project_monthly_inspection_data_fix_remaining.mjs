// project_monthly_inspection_data_fix_remaining.mjs
// 월간점검DB: 구분 상관없이 아직 마이그레이션 안 된(점검내용이 비어있는) 레코드 전부 정리
//   - 기존 제목 내용 → 점검내용으로 이동
//   - 제목 → "{터널명} 월간점검결과표"
//   - 설비명은 건드리지 않음(기타/태양광은 이전 작업에서 이미 공란 처리됨)
//
// 사용법:
//   node scripts/project_monthly_inspection_data_fix_remaining.mjs           # dry-run
//   node scripts/project_monthly_inspection_data_fix_remaining.mjs --apply   # 실제 반영

import { notionRequest, sleep, log, initLog } from './notion_upload_lib.mjs';

const DB_ID = 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69'; // 월간점검DB
const APPLY = process.argv.includes('--apply');

async function fetchAll() {
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
  return results;
}

function buildUpdate(page) {
  const p = page.properties;
  const tunnel = p['터널명']?.select?.name || '';
  const oldTitle = (p['제목']?.title || []).map(t => t.plain_text).join('');
  const gubun = p['구분']?.select?.name || '';
  const content = (p['점검내용']?.rich_text || []).map(t => t.plain_text).join('');
  const newTitle = `${tunnel} 월간점검결과표`;
  return { pageId: page.id, tunnel, gubun, oldTitle, content, newTitle };
}

async function main() {
  initLog(APPLY ? '월간점검DB 전체구분 데이터정리 [APPLY]' : '월간점검DB 전체구분 데이터정리 [DRY-RUN]');
  const pages = await fetchAll();
  let targets = pages.map(buildUpdate).filter(u => !u.content && u.oldTitle && u.newTitle !== u.oldTitle);

  // 목록 쿼리 단계에서 터널명이 간헐적으로 빈값 반환되는 노션 인덱싱 지연 이슈가 있어(참고: 업무처리DB
  // title 필드 지연 버그와 유사 계열) 페이지 단건 재조회로 실제 값 재확인 후에만 스킵 처리한다.
  for (const t of targets.filter(u => !u.tunnel)) {
    const fresh = await notionRequest('GET', `/v1/pages/${t.pageId}`);
    t.tunnel = fresh.properties['터널명']?.select?.name || '';
    t.newTitle = `${t.tunnel} 월간점검결과표`;
    await sleep(200);
  }

  const skipped = targets.filter(u => !u.tunnel);
  const applicable = targets.filter(u => u.tunnel);
  log(`[조회] 전체 ${pages.length}건 중 대상 ${targets.length}건 (점검내용 비어있고 제목이 아직 고정문구 아님)`);
  if (skipped.length) {
    log(`[스킵] 터널명 공란이라 제외: ${skipped.length}건`);
    skipped.forEach(u => log(`  스킵: pageId=${u.pageId} | [${u.gubun}] "${u.oldTitle}"`));
  }

  const byGubun = {};
  targets.forEach(t => { byGubun[t.gubun] = (byGubun[t.gubun] || 0) + 1; });
  log(`[구분별] ${JSON.stringify(byGubun)}`);

  if (!APPLY) {
    for (const t of applicable.slice(0, 20)) {
      log(`  예정: [${t.gubun}] ${t.tunnel} | 제목 "${t.oldTitle}" → 점검내용 | 제목 → "${t.newTitle}"`);
    }
    if (applicable.length > 20) log(`  ... 외 ${applicable.length - 20}건`);
    log('──────────────────────────────────');
    log(`dry-run 완료: ${applicable.length}건 반영 예정, ${skipped.length}건 스킵. 실제 반영하려면 --apply 옵션으로 재실행.`);
    return;
  }

  let done = 0, errors = 0;
  for (const t of applicable) {
    try {
      await notionRequest('PATCH', `/v1/pages/${t.pageId}`, {
        properties: {
          '점검내용': { rich_text: [{ text: { content: t.oldTitle } }] },
          '제목': { title: [{ text: { content: t.newTitle } }] },
        },
      });
      done++;
      if (done % 20 === 0) log(`  진행: ${done}/${applicable.length}`);
      await sleep(350);
    } catch (e) {
      errors++;
      log(`  오류: ${t.pageId} → ${e.message}`);
    }
  }
  log('──────────────────────────────────');
  log(`완료: ${done}건, 오류: ${errors}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
