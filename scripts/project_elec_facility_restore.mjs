/**
 * project_elec_facility_restore.mjs — 전기시설점검DB 잘못 삭제된 레코드 복구
 * scratchpad/restore_ids.json 에 저장된 id 목록을 archived:false 로 되돌린다.
 */
import fs from 'fs';
import { notionRequest, sleep, log, initLog, TOKEN } from './notion_upload_lib.mjs';

const IDS_PATH = process.argv[2] || 'C:\\Users\\shinf\\AppData\\Local\\Temp\\claude\\C--users-shinf-workspace\\2ef23ba3-0760-4dbd-bce1-66483a9b57e3\\scratchpad\\restore_ids.json';

async function main() {
  initLog('전기시설점검DB 복구');
  if (!TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }
  const records = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
  log(`[복구 시작] ${records.length}건`);
  let done = 0, errors = 0;
  for (const r of records) {
    try {
      await notionRequest('PATCH', `/v1/pages/${r.id}`, { archived: false });
      done++;
      if (done % 50 === 0) log(`  진행 ${done}/${records.length}`);
      await sleep(120);
    } catch (e) {
      errors++;
      log(`  오류: ${r.id} (${r.tunnel} ${r.date} ${r.gubun}) → ${e.message}`);
    }
  }
  log(`[완료] 복구 ${done}건, 오류 ${errors}건`);
}
main().catch(e => { console.error(e); process.exit(1); });
