/**
 * overtime_notion_upload.mjs — 연장근무DB Notion 업로드
 *
 * Usage:
 *   node overtime_notion_upload.mjs "C:\path\to\연장근무.xlsx"
 *   node overtime_notion_upload.mjs "C:\path\to\연장근무.xlsx" --dry-run
 *
 * Excel 헤더 (1행):
 *   내용 | 날짜 | 근무명 | 소속 | 성명 | 상태 | 시간 | 계(Hr) | 지급액 | 비고 | 예금주
 *   - 근무명: 비상대기 / 비상출동 / 비상근무 / 당직근무
 *   - 소속: 흥해터널 / 청하터널(주) / 청하터널(부) / 남정5터널 / 점검팀
 *   - 성명: select 값 (Notion에 등록된 성명과 일치 필요)
 *   - 상태: 예정 / 진행중 / 완료 / 반려
 *   - 시간: 텍스트 (예: "18:00~21:00")
 *   - 예금주: 예금주DB 이름과 정확히 일치 필요 (관계형 자동 연결)
 *   - 계좌번호·입금은행: rollup이므로 무시됨 (자동 조회)
 *
 * 진행 모니터링:
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\notion_upload.log"
 */

import { runUpload, buildRelationMap, log } from './notion_upload_lib.mjs';

const DB_ID       = '2e659c8c-9c0a-803c-8a47-fd63ec0e9b5e';
const DATE_FIELD  = '날짜';
const 예금주DB_ID = '2e659c8c-9c0a-806d-a8fe-c5edc5891467';

const FIELDS = [
  { notion: '내용',    type: 'title'     },
  { notion: '날짜',    type: 'date'      },
  { notion: '근무명',  type: 'select'    },
  { notion: '소속',    type: 'select'    },
  { notion: '성명',    type: 'select'    },
  { notion: '상태',    type: 'select'    },
  { notion: '시간',    type: 'rich_text' },
  { notion: '계(Hr)',  type: 'number'    },
  { notion: '지급액',  type: 'number'    },
  { notion: '비고',    type: 'rich_text' },
  { notion: '예금주',  type: 'relation'  },
];

// 중복 키: 날짜|내용|성명
function keyFn(page) {
  const p = page.properties;
  const date  = p['날짜']?.date?.start?.slice(0, 10) ?? '';
  const title = p['내용']?.title?.[0]?.plain_text ?? '';
  const name  = p['성명']?.select?.name ?? '';
  return `${date}|${title}|${name}`;
}

const argv     = process.argv.slice(2);
const filePath = argv.find(a => !a.startsWith('--'));
const dryRun   = argv.includes('--dry-run');

await runUpload({
  label:     '연장근무DB',
  filePath,
  dbId:      DB_ID,
  dateField: DATE_FIELD,
  fieldDefs: FIELDS,
  keyFn,
  relationSetup: async () => {
    log('[관계] 예금주DB 로딩 중...');
    const 예금주Map = await buildRelationMap(예금주DB_ID);
    log(`[관계] 예금주 ${예금주Map.size}건 로드`);
    return { '예금주': 예금주Map };
  },
  dryRun,
});
