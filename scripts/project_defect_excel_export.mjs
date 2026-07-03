/**
 * project_defect_excel_export.mjs — 하자보수DB → 엑셀 export (인쇄/보고용)
 *
 * work-portal 앱의 브라우저 내 엑셀 생성 버튼이 계속 실패하여 대체.
 * 실제 생성 로직은 scripts/lib/xlsx_report_lib.mjs 공통 라이브러리를 사용 —
 * 이 파일은 하자보수DB 조회·필터링과 컬럼 정의만 담당하는 얇은 래퍼.
 *
 * Usage:
 *   node project_defect_excel_export.mjs [--tunnel=청하터널] [--status=진행중] [--manager=안전관리자] [--out=경로]
 *
 * --tunnel, --status, --manager 생략 시 전체 대상.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildReportWorkbook, buildHeaderFooter, fetchImage } from './lib/xlsx_report_lib.mjs';

const WORKER_URL = 'https://notion-proxy.shinfund.workers.dev';
const DB_ID = '2e159c8c9c0a80d4afa2d9421e1fdc0e';
// work-portal은 다른 사람도 함께 쓰는 포털 앱이므로, 특정 사용자 workspace 경로가 아니라
// 실행 계정 기준 범용 Downloads 폴더에 저장한다 (포털 앱 엑셀/PDF 공통 정책).
const OUT_DIR = path.join(os.homedir(), 'Downloads');
const COMPANY_NAME = '수자원기술(주)';

// key: r[key] 값을 셀에 씀. photo:true인 컬럼은 r[key+'_URL']을 이미지로 임베드.
// width가 지정된 컬럼(하자내용/비고)은 고정폭+자동줄바꿈, 나머지는 실행 시 데이터 글자 길이로 자동 계산.
const COLUMNS = [
  { key: '날짜', header: '날짜' },
  { key: '터널명', header: '터널명' },
  { key: '업무담당', header: '관리' },
  { key: '공종', header: '공종' },
  { key: '위치', header: '위치' },
  { key: '하자내용', header: '하자내용', width: 53, wrap: true, align: 'left' },
  { key: '하자사진', header: '하자사진', photo: true, width: 18 },
  { key: '조치일', header: '조치일' },
  { key: '조치사진', header: '조치사진', photo: true, width: 18 },
  { key: '조치여부', header: '조치여부' },
  { key: '업체명', header: '업체명' },
  { key: '업체담당자', header: '담당자' },
  { key: '전화번호', header: '전화번호' },
  { key: '비고', header: '비고', width: 16, wrap: true, align: 'left' },
];

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function fmt2(n) { return n < 10 ? '0' + n : String(n); }

function shortDate(d) {
  if (!d) return '';
  return d.slice(0, 10);
}

function getPropText(p) {
  if (!p) return '';
  if (p.type === 'title') return (p.title || []).map(t => t.plain_text || '').join('');
  if (p.type === 'rich_text') return (p.rich_text || []).map(t => t.plain_text || '').join('');
  if (p.type === 'select') return (p.select && p.select.name) || '';
  if (p.type === 'multi_select') return (p.multi_select || []).map(s => s.name).join(', ');
  if (p.type === 'date') return (p.date && p.date.start) || '';
  if (p.type === 'phone_number') return p.phone_number || '';
  return '';
}

function getFileUrl(p) {
  if (!p) return '';
  if (p.type === 'files' && p.files && p.files.length) {
    const f = p.files[0];
    return (f.type === 'external' ? f.external && f.external.url : f.file && f.file.url) || '';
  }
  if (p.type === 'url') return p.url || '';
  return '';
}

function parsePage(page) {
  const p = page.properties || {};
  return {
    _pageId: page.id,
    날짜: shortDate(getPropText(p['날짜'])),
    터널명: getPropText(p['터널명']),
    업무담당: getPropText(p['관리']),
    공종: getPropText(p['공종']),
    위치: getPropText(p['위치']),
    하자내용: getPropText(p['하자내용']),
    조치일: shortDate(getPropText(p['조치일'])),
    조치여부: getPropText(p['조치여부']),
    업체명: getPropText(p['업체명']),
    업체담당자: getPropText(p['담당자']),
    전화번호: getPropText(p['전화번호']),
    비고: getPropText(p['비고']),
    하자사진_URL: getFileUrl(p['하자사진']),
    조치사진_URL: getFileUrl(p['조치사진']),
  };
}

async function fetchAllRows() {
  const rows = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${WORKER_URL}/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion 조회 실패: HTTP ${res.status}`);
    const data = await res.json();
    rows.push(...data.results.map(parsePage));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function main() {
  const args = parseArgs();
  console.log('Notion에서 하자보수DB 조회 중...');
  let rows = await fetchAllRows();
  console.log(`전체 ${rows.length}건 조회`);

  if (args.tunnel) rows = rows.filter(r => r.터널명 === args.tunnel);
  if (args.status) rows = rows.filter(r => r.조치여부 === args.status);
  if (args.manager) rows = rows.filter(r => r.업무담당 === args.manager);
  rows.sort((a, b) => (a.날짜 < b.날짜 ? 1 : a.날짜 > b.날짜 ? -1 : 0));

  console.log(`필터 적용 후 ${rows.length}건 (터널: ${args.tunnel || '전체'}, 관리: ${args.manager || '전체'}, 조치여부: ${args.status || '전체'})`);
  if (!rows.length) { console.log('내보낼 데이터가 없습니다.'); return; }

  console.log('사진 다운로드 중...');
  const buffer = await buildReportWorkbook({
    sheetName: '하자현황',
    title: '하자보수현황',
    columns: COLUMNS,
    rows,
    orientation: 'landscape',
    headerFooter: buildHeaderFooter({ companyName: COMPANY_NAME }),
    statusColorRules: [{ key: '조치여부', value: '완료', color: 'FFFF0000' }],
    fetchImage,
  });

  const now = new Date();
  const stamp = `${now.getFullYear()}${fmt2(now.getMonth() + 1)}${fmt2(now.getDate())}${fmt2(now.getHours())}${fmt2(now.getMinutes())}`;
  const outPath = args.out || path.join(OUT_DIR, `하자보수현황_${stamp}.xlsx`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  console.log('생성 완료:', outPath);
}

main().catch(e => { console.error('실패:', e); process.exit(1); });
