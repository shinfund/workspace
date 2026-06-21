/**
 * corpcard_notion_upload.mjs — 법인카드DB Notion 업로드
 *
 * Usage:
 *   node corpcard_notion_upload.mjs "C:\path\to\법인카드.xlsx"
 *   node corpcard_notion_upload.mjs "C:\path\to\법인카드.xlsx" --dry-run
 *
 * Excel 헤더 (1행):
 *   사용목적 및 지출내역 | 사용일자 | 공급가 | 부가세 | 계정항목 | 총인원 | 비고 | 상호 | 카드명
 *   - 상호: 거래처DB 상호명과 정확히 일치 필요 (관계형 자동 연결)
 *   - 카드명: 카드DB 카드명과 정확히 일치 필요 (관계형 자동 연결)
 *   - 합계·카드번호·사업자등록번호: formula/rollup이므로 무시됨 (자동 계산)
 *
 * 진행 모니터링:
 *   Get-Content -Wait "C:\Users\shinf\Workspace\logs\notion_upload.log"
 */

import { runUpload, buildRelationMap, log } from './notion_upload_lib.mjs';

const DB_ID        = '2f559c8c-9c0a-804a-9201-e861453d6b48';
const DATE_FIELD   = '사용일자';
const 거래처DB_ID  = '2f559c8c-9c0a-8076-9f26-d8539c292c62';
const 카드DB_ID    = '2f559c8c-9c0a-8021-8c19-ef8e48dcaec5';

const FIELDS = [
  { notion: '사용목적 및 지출내역', type: 'title'     },
  { notion: '사용일자',             type: 'date'      },
  { notion: '공급가',               type: 'number'    },
  { notion: '부가세',               type: 'number'    },
  { notion: '계정항목',             type: 'select'    },
  { notion: '총인원',               type: 'number'    },
  { notion: '비고',                 type: 'rich_text' },
  { notion: '상호',                 type: 'relation'  },
  { notion: '카드명',               type: 'relation'  },
];

// 중복 키: 사용일자|사용목적
function keyFn(page) {
  const p = page.properties;
  const date  = p['사용일자']?.date?.start?.slice(0, 10) ?? '';
  const title = p['사용목적 및 지출내역']?.title?.[0]?.plain_text ?? '';
  return `${date}|${title}`;
}

const argv     = process.argv.slice(2);
const filePath = argv.find(a => !a.startsWith('--'));
const dryRun   = argv.includes('--dry-run');

await runUpload({
  label:     '법인카드DB',
  filePath,
  dbId:      DB_ID,
  dateField: DATE_FIELD,
  fieldDefs: FIELDS,
  keyFn,
  relationSetup: async () => {
    log('[관계] 거래처DB 로딩 중...');
    const 상호Map = await buildRelationMap(거래처DB_ID);
    log(`[관계] 거래처 ${상호Map.size}건 로드`);

    log('[관계] 카드DB 로딩 중...');
    const 카드Map = await buildRelationMap(카드DB_ID);
    log(`[관계] 카드 ${카드Map.size}건 로드`);

    return { '상호': 상호Map, '카드명': 카드Map };
  },
  dryRun,
});
