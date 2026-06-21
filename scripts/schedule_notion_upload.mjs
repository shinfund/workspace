/**
 * schedule_notion_upload.mjs — 일정DB Notion 업로드
 *
 * Usage:
 *   node schedule_notion_upload.mjs "C:\path\to\일정.xlsx"
 *   node schedule_notion_upload.mjs "C:\path\to\일정.xlsx" --dry-run
 *
 * Excel 헤더 (1행):
 *   내용 | 날짜 | 상태 | 구분 | 키워드
 *   - 상태: 예정 / 진행중 / 완료
 *   - 구분: 업무 / 개인 / 공휴일  (복수 시 쉼표 구분)
 *   - 키워드: 쉼표 구분 (예: 점검,터널,청하)
 *   - 이미지·첨부파일 컬럼은 무시됨
 *
 * 진행 모니터링:
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\notion_upload.log"
 */

import { runUpload } from './notion_upload_lib.mjs';

const DB_ID     = '2db59c8c-9c0a-80c7-810b-d4f033acdf47';
const DATE_FIELD = '날짜';

const FIELDS = [
  { notion: '내용',   type: 'title'        },
  { notion: '날짜',   type: 'date'         },
  { notion: '상태',   type: 'select'       },
  { notion: '구분',   type: 'multi_select' },
  { notion: '키워드', type: 'multi_select' },
];

// 중복 키: 날짜|내용
function keyFn(page) {
  const p = page.properties;
  const date  = p['날짜']?.date?.start?.slice(0, 10) ?? '';
  const title = p['내용']?.title?.[0]?.plain_text ?? '';
  return `${date}|${title}`;
}

const argv     = process.argv.slice(2);
const filePath = argv.find(a => !a.startsWith('--'));
const dryRun   = argv.includes('--dry-run');

await runUpload({
  label:     '일정DB',
  filePath,
  dbId:      DB_ID,
  dateField: DATE_FIELD,
  fieldDefs: FIELDS,
  keyFn,
  dryRun,
});
