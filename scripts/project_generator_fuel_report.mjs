// 발전기 유류탱크 잔량 엑셀 리포트 생성
// 사용법: node scripts/project_generator_fuel_report.mjs [출력경로]
// 출력경로 생략 시 data/analysis/발전기유류탱크잔량_수자원_YYYYMMDDHHmm.xlsx 로 저장.
//
// 아래 TUNNELS·CHECK_DATE·GAUGE_PHOTO/PLATE_PHOTO만 그때그때 값을 바꿔서 실행하면 된다.
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_TITLE_FONT, DEFAULT_BODY_FONT, DEFAULT_HEADER_FILL_ARGB,
  PAGE_PRESETS, cm2in, gridBorder, autoWidth, buildHeaderFooter, parseDateCell,
} from './lib/xlsx_report_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// ── 여기만 매번 갱신 ──────────────────────────────────────────────
const CHECK_DATE = new Date().toISOString().slice(0, 10);
// 게이지식(2L-GSM, 총길이 1.5m)은 눈금·총길이를 넣으면 잔량이 수식으로 자동 계산된다.
// 육안확인(호스게이지 등)처럼 수식 근거가 없는 값은 눈금/총길이를 null로 두고 잔량직접에 입력.
const TUNNELS = [
  { 터널: '흥해', 탱크용량: 2000, 측정방식: '게이지(2L-GSM)', 눈금: 0.85, 총길이: 1.5, 잔량직접: null, 비고: '' },
  { 터널: '청하(주)', 탱크용량: 2000, 측정방식: '게이지(2L-GSM)', 눈금: 0.85, 총길이: 1.5, 잔량직접: null, 비고: '' },
  { 터널: '청하(부)', 탱크용량: 990, 측정방식: '호스게이지(육안)', 눈금: null, 총길이: null, 잔량직접: 800, 비고: '육안확인(직접입력)' },
  { 터널: '남정5', 탱크용량: 2000, 측정방식: '게이지(2L-GSM)', 눈금: 0.71, 총길이: 1.5, 잔량직접: null, 비고: '' },
];
// 참고사진 2장(레벨게이지/명판) — 없으면 자동으로 생략됨
const GAUGE_PHOTO = 'C:/Users/shinf/Downloads/유류탱크 레벨게이지_청하(주).jpg';
const PLATE_PHOTO = 'C:/Users/shinf/Downloads/게이지 명판.jpg';
const COMPANY_NAME = '수자원기술(주)';
const REPORT_TITLE = '포항영덕간 터널 발전기 유류탱크 잔량';
// ─────────────────────────────────────────────────────────────────

const rows = TUNNELS.map(t => ({ ...t, 체크일: CHECK_DATE }));
const colLetter = n => String.fromCharCode(64 + n); // 1->A, 2->B ...

const columns = [
  { key: '터널', header: '터널' },
  { key: '탱크용량', header: '탱크용량(L)', numFmt: '#,##0' },
  { key: '측정방식', header: '측정방식' },
  { key: '눈금', header: '게이지눈금(m)', numFmt: '0.00' },
  { key: '총길이', header: '총길이(m)', numFmt: '0.00' },
  { key: '잔량', header: '잔량(L)', numFmt: '#,##0' },
  { key: '잔량비율', header: '잔량비율', numFmt: '0%' },
  { key: '보충필요', header: '보충필요(L)', numFmt: '#,##0' },
  { key: '체크일', header: '체크일', dateCol: true },
  { key: '비고', header: '비고', align: 'left', width: 22 },
];
const B = colLetter(2), D = colLetter(4), E = colLetter(5), F = colLetter(6), H = colLetter(8);

const wb = new ExcelJS.Workbook();
const preset = PAGE_PRESETS.landscape;
const pageMargins = {
  top: cm2in(preset.margins.top), bottom: cm2in(preset.margins.bottom),
  left: cm2in(preset.margins.left), right: cm2in(preset.margins.right),
  header: cm2in(preset.margins.header), footer: cm2in(preset.margins.footer),
};
const ws = wb.addWorksheet('발전기유류탱크잔량', {
  views: [{ state: 'frozen', ySplit: 2, showGridLines: false, zoomScale: 90 }],
  pageSetup: {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true, verticalCentered: false, margins: pageMargins, printTitlesRow: '2:2',
  },
  headerFooter: buildHeaderFooter({ companyName: COMPANY_NAME }),
});

const previewStrings = row => [
  row.터널, String(row.탱크용량), row.측정방식, row.눈금 != null ? String(row.눈금) : '',
  row.총길이 != null ? String(row.총길이) : '', '00000', '000%', '00000', row.체크일, row.비고,
];
const colWidths = columns.map((col, i) => col.width || autoWidth([col.header, ...rows.map(r => previewStrings(r)[i])]));
ws.columns = colWidths.map(width => ({ width }));

const titleRow = ws.getRow(1);
titleRow.height = 60;
const titleCell = titleRow.getCell(1);
titleCell.value = REPORT_TITLE;
titleCell.font = DEFAULT_TITLE_FONT;
titleCell.alignment = { vertical: 'middle' };

const headerRow = ws.getRow(2);
headerRow.height = 30;
columns.forEach((col, i) => {
  const cell = headerRow.getCell(i + 1);
  cell.value = col.header;
  cell.font = DEFAULT_BODY_FONT;
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = gridBorder({ isHeader: true, colIndex: i, isLastCol: i === columns.length - 1 });
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DEFAULT_HEADER_FILL_ARGB } };
});

const FIRST_DATA_ROW = 3;
rows.forEach((r, i) => {
  const rn = FIRST_DATA_ROW + i;
  const row = ws.getRow(rn);
  row.height = 30;
  columns.forEach((col, ci) => {
    const cell = row.getCell(ci + 1);
    cell.font = DEFAULT_BODY_FONT;
    cell.border = gridBorder({ isHeader: false, isLastRow: false, colIndex: ci, isLastCol: ci === columns.length - 1 });
    cell.alignment = col.align === 'left'
      ? { vertical: 'middle', horizontal: 'left' }
      : { vertical: 'middle', horizontal: 'center' };
    if (col.key === '눈금') { cell.value = r.눈금; cell.numFmt = col.numFmt; }
    else if (col.key === '총길이') { cell.value = r.총길이; cell.numFmt = col.numFmt; }
    else if (col.key === '잔량') {
      cell.value = r.잔량직접 != null ? r.잔량직접 : { formula: `ROUNDDOWN(${D}${rn}/${E}${rn}*${B}${rn},0)` };
      cell.numFmt = col.numFmt;
    } else if (col.key === '잔량비율') {
      cell.value = { formula: `ROUNDDOWN(${F}${rn}/${B}${rn}*100,0)/100` };
      cell.numFmt = col.numFmt;
    } else if (col.key === '보충필요') {
      cell.value = { formula: `${B}${rn}-${F}${rn}` };
      cell.numFmt = col.numFmt;
    } else if (col.dateCol && r[col.key]) {
      const d = parseDateCell(r[col.key]);
      if (d) { cell.value = d; cell.numFmt = 'yyyy-mm-dd'; } else { cell.value = r[col.key]; }
    } else {
      cell.value = r[col.key];
      if (col.numFmt) cell.numFmt = col.numFmt;
    }
  });
  row.commit();
});

// 합계행
const totalRn = FIRST_DATA_ROW + rows.length;
const lastDataRn = totalRn - 1;
const totalRow = ws.getRow(totalRn);
totalRow.height = 30;
const totalValues = {
  터널: '합계',
  탱크용량: { formula: `SUM(${B}${FIRST_DATA_ROW}:${B}${lastDataRn})` },
  측정방식: '', 눈금: null, 총길이: null,
  잔량: { formula: `SUM(${F}${FIRST_DATA_ROW}:${F}${lastDataRn})` },
  잔량비율: null,
  보충필요: { formula: `SUM(${H}${FIRST_DATA_ROW}:${H}${lastDataRn})` },
  체크일: '', 비고: '',
};
columns.forEach((col, ci) => {
  const cell = totalRow.getCell(ci + 1);
  cell.font = { ...DEFAULT_BODY_FONT, bold: true };
  cell.border = gridBorder({ isHeader: false, isLastRow: true, colIndex: ci, isLastCol: ci === columns.length - 1 });
  cell.alignment = col.align === 'left'
    ? { vertical: 'middle', horizontal: 'left' }
    : { vertical: 'middle', horizontal: 'center' };
  const v = totalValues[col.key];
  if (v != null) {
    cell.value = v;
    if (col.numFmt) cell.numFmt = col.numFmt;
  }
});
totalRow.commit();

const noteRowNum = totalRn + 2; // 합계행 다음(빈 행 1개) 다음 행
const noteRow = ws.getRow(noteRowNum);
noteRow.height = 45;
ws.mergeCells(noteRowNum, 1, noteRowNum, columns.length);
const noteCell = noteRow.getCell(1);
noteCell.value =
  '※ 잔량 계산식 예시 — 게이지식(2L-GSM): 게이지눈금(m) ÷ 게이지 총길이 1.5m × 탱크용량(L) = 잔량(L)   예) 0.85m ÷ 1.5m × 2,000L ≈ 1,133L\n'
  + '호스게이지: 게이지눈금(cm) ÷ 게이지 총길이(cm) × 탱크용량(L) = 잔량(L)   예) 2.5cm ÷ 65cm × 990L ≈ 38L (육안확인 값은 직접입력)';
noteCell.font = DEFAULT_BODY_FONT;
noteCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
noteRow.commit();

// 사진 2열 배치 — 계산식 예시 행 다음 한 행 띄우고, 표 전체 컬럼 폭에 맞춰 좌/우 절반씩 배치.
// 사진 파일이 없으면(경로 변경/삭제 등) 조용히 생략한다.
if (fs.existsSync(GAUGE_PHOTO) && fs.existsSync(PLATE_PHOTO)) {
  const half = Math.ceil(columns.length / 2);
  const px = u => Math.round(u * 7 + 5); // Excel 열너비(문자단위) → 픽셀 근사 환산
  const leftPx = colWidths.slice(0, half).reduce((s, u) => s + px(u), 0);
  const rightPx = colWidths.slice(half).reduce((s, u) => s + px(u), 0);
  const IMG_ASPECT = 1050 / 1400; // 원본 사진 실측 비율(1400x1050) — 사진이 바뀌면 갱신 필요
  const blockHeightPt = Math.max(leftPx, rightPx) * IMG_ASPECT * 0.75; // px→pt(96→72dpi)

  const photoRowNum = noteRowNum + 2; // 계산식 예시 행 다음 한 행 띄우고
  const photoRow = ws.getRow(photoRowNum);
  photoRow.height = Math.min(blockHeightPt, 400);
  ws.mergeCells(photoRowNum, 1, photoRowNum, half);
  ws.mergeCells(photoRowNum, half + 1, photoRowNum, columns.length);
  const thinBox = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  photoRow.getCell(1).border = thinBox;
  photoRow.getCell(half + 1).border = thinBox;
  photoRow.commit();

  const multiCellAnchor = (colStart0, colEndExcl0, rowStart0, rowEndExcl0, insetPx = 4) => {
    const insetEMU = insetPx * 9525;
    return {
      tl: { nativeCol: colStart0, nativeColOff: insetEMU, nativeRow: rowStart0, nativeRowOff: insetEMU },
      br: { nativeCol: colEndExcl0, nativeColOff: -insetEMU, nativeRow: rowEndExcl0, nativeRowOff: -insetEMU },
      editAs: 'twoCell',
    };
  };

  const gaugeImgId = wb.addImage({ buffer: fs.readFileSync(GAUGE_PHOTO), extension: 'jpeg' });
  const plateImgId = wb.addImage({ buffer: fs.readFileSync(PLATE_PHOTO), extension: 'jpeg' });
  const rn0 = photoRowNum - 1;
  ws.addImage(gaugeImgId, multiCellAnchor(0, half, rn0, rn0 + 1));
  ws.addImage(plateImgId, multiCellAnchor(half, columns.length, rn0, rn0 + 1));
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
const defaultOut = path.join(WORKSPACE_ROOT, 'data', 'analysis', `발전기유류탱크잔량_수자원_${stamp}.xlsx`);
const outPath = process.argv[2] || defaultOut;
fs.writeFileSync(outPath, await wb.xlsx.writeBuffer());
console.log('written:', outPath);
