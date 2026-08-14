import { notionRequest, sleep, log, initLog, TOKEN } from './notion_upload_lib.mjs';

const DB_ID = '23c03f3d396b46dc8737e0a6c7fdae70';
const BARRIER = '터널진입차단설비';
const ITEMS = [
  '현장제어반 및 차단막 프레임 등 외관',
  '전원공급 및 차단기 투입상태',
  '전원 및 제어케이블 외관 및 단자 결선',
  '관리동, 상황실, 현장제어반 동작상태',
  '차단막 원단 파손 및 음향, 경광등 상태',
];
const GAPS = [
  { date: '2026-05-20', tunnels: ['남정4터널', '남정6터널'], title: '2026년 5월 터널전기시설점검표' },
];
async function main() {
  initLog('터널진입차단설비 누락 복원(3차)');
  if (!TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }
  let done = 0, err = 0;
  for (const gap of GAPS) {
    for (const tunnel of gap.tunnels) {
      for (const content of ITEMS) {
        try {
          const props = {
            '제목': { title: [{ text: { content: gap.title } }] },
            '터널명': { select: { name: tunnel } },
            '구분': { select: { name: BARRIER } },
            '점검내용': { rich_text: [{ text: { content } }] },
            '날짜': { date: { start: gap.date } },
            '점검방법': { select: { name: '조작' } },
            '점검결과': { select: { name: '양호' } },
          };
          await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
          done++;
          log(`  생성: ${tunnel} ${gap.date} ${content}`);
          await sleep(150);
        } catch (e) {
          err++;
          log(`  오류: ${tunnel} ${gap.date} ${content} → ${e.message}`);
        }
      }
    }
  }
  log(`[완료] 생성 ${done}건, 오류 ${err}건`);
}
main().catch(e => { console.error(e); process.exit(1); });
