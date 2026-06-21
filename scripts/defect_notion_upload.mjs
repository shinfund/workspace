/**
 * defect_notion_upload.mjs — 하자보수DB Notion 업로드
 *
 * Usage:
 *   node defect_notion_upload.mjs "C:\path\to\하자보수.xlsx"
 *   node defect_notion_upload.mjs "C:\path\to\하자보수.xlsx" --dry-run
 *
 * Excel 헤더 (1행):
 *   하자내용 | 날짜 | 조치일 | 터널명 | 공종 | 조치여부 | 위치 | 업체명 | 관리 | 비고 | 업체담당자 | 전화번호
 *   - 터널명: 흥해 / 청하 / 남정1~9 / 강구1~3 / 기타
 *   - 공종: 전기 / 설비 / 소방 / 통신 / 토목 / 건축 / 환기 / 기타  (복수 시 쉼표 구분)
 *   - 조치여부: 미흡 / 진행중 / 완료
 *   - 관리: 안전관리자 / 점검팀
 *   - 하자사진·조치사진 컬럼은 무시됨
 *
 * 진행 모니터링:
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\notion_upload.log"
 */

import { runUpload } from './notion_upload_lib.mjs';

const DB_ID      = '2e159c8c-9c0a-80d4-afa2-d9421e1fdc0e';
const DATE_FIELD = '날짜';

const FIELDS = [
  { notion: '하자내용',   type: 'title'        },
  { notion: '날짜',       type: 'date'         },
  { notion: '조치일',     type: 'date'         },
  { notion: '터널명',     type: 'select'       },
  { notion: '공종',       type: 'multi_select' },
  { notion: '조치여부',   type: 'select'       },
  { notion: '위치',       type: 'rich_text'    },
  { notion: '업체명',     type: 'rich_text'    },
  { notion: '관리',       type: 'select'       },
  { notion: '비고',       type: 'rich_text'    },
  { notion: '업체담당자', type: 'rich_text'    },
  { notion: '전화번호',   type: 'phone_number' },
];

// 중복 키: 날짜|하자내용
function keyFn(page) {
  const p = page.properties;
  const date  = p['날짜']?.date?.start?.slice(0, 10) ?? '';
  const title = p['하자내용']?.title?.[0]?.plain_text ?? '';
  return `${date}|${title}`;
}

const argv     = process.argv.slice(2);
const filePath = argv.find(a => !a.startsWith('--'));
const dryRun   = argv.includes('--dry-run');

await runUpload({
  label:     '하자보수DB',
  filePath,
  dbId:      DB_ID,
  dateField: DATE_FIELD,
  fieldDefs: FIELDS,
  keyFn,
  dryRun,
});
