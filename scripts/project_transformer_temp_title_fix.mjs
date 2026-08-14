/**
 * project_transformer_temp_title_fix.mjs — 변압기온도DB 일회성 정리
 *
 * "제목" 컬럼 값(예: "조명용 #4")을 "측정지점" 컬럼으로 이동하고,
 * "제목" 컬럼은 "{터널명} 변압기온도측정표" 형식으로 재작성한다.
 *
 * 실행: node scripts/project_transformer_temp_title_fix.mjs
 */
import { notionRequest, sleep, initLog, log } from './notion_upload_lib.mjs';

const DB_ID = '998fab1e-2d5c-4cae-a6aa-55a131931546';
const DELAY_MS = 350;

function getTitleText(page) {
  const arr = page.properties['제목']?.title || [];
  return arr.map(t => t.plain_text).join('');
}
function getTunnelName(page) {
  return page.properties['터널명']?.select?.name || null;
}

async function fetchAllPages() {
  const pages = [];
  let cursor;
  while (true) {
    const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

async function main() {
  initLog('변압기온도DB 제목/측정지점 정리');
  const pages = await fetchAllPages();
  log(`대상 ${pages.length}건 조회 완료`);

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const oldTitle = getTitleText(page);
    const tunnel = getTunnelName(page);

    if (!oldTitle || !tunnel) {
      log(`  SKIP (${i + 1}/${pages.length}) id=${page.id} 제목="${oldTitle}" 터널명="${tunnel}"`);
      skip++;
      continue;
    }

    const newTitle = `${tunnel} 변압기온도측정표`;
    try {
      await notionRequest('PATCH', `/v1/pages/${page.id}`, {
        properties: {
          '측정지점': { rich_text: [{ text: { content: oldTitle } }] },
          '제목': { title: [{ text: { content: newTitle } }] },
        },
      });
      ok++;
      if ((i + 1) % 50 === 0) log(`  진행 ${i + 1}/${pages.length}`);
    } catch (e) {
      fail++;
      log(`  ERROR id=${page.id}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  log(`완료 — 성공 ${ok} / 스킵 ${skip} / 실패 ${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
