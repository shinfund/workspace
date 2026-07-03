/**
 * xlsx_report_lib.mjs — 인쇄/보고용 엑셀 리포트 공통 생성 라이브러리
 *
 * work-portal(하자보수현황) 앱의 브라우저 내 엑셀 생성이 반복적으로 손상되던 문제를
 * 해결하는 과정(2026-07-03)에서 확립된 패턴을 재사용 가능한 형태로 정리한 것.
 * 이 모듈은 항상 신규 워크북을 코드로 직접 구성한다 — 기존 xlsx 템플릿을 불러와서
 * 다시 저장(load→save round-trip)하는 방식은 쓰지 않는다.
 *
 * 자세한 배경(왜 템플릿을 안 쓰는지, 사진이 왜 찌그러졌는지 등)은
 * ~/.claude/skills/xlsx-report-export/SKILL.md 참고.
 */

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const EMU_PER_PX = 9525;
export const cm2in = cm => cm / 2.54;

// 'YYYY-MM-DD' 문자열 → Date 객체 (컬럼에 dateCol:true 지정 시 엑셀 날짜 타입으로 저장해
// 정렬/필터 가능하게 함). Date.UTC로 만들어야 함 — exceljs가 Date→엑셀 날짜 일련번호 변환 시
// UTC 기준으로 계산해서, 로컬시간으로 자정을 만들면 타임존만큼(KST=UTC+9) 하루 전 날짜로
// 저장되는 버그가 있었음(2026-07-03 브라우저 실사용 테스트로 발견, 동일 로직이라 Node도 적용).
export function parseDateCell(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// 용지 방향별 표준 프리셋. margins는 cm 단위(원본 스펙 그대로), 실제 적용 시 in으로 환산.
export const PAGE_PRESETS = {
  landscape: {
    orientation: 'landscape',
    margins: { top: 1, header: 1, left: 2, right: 1, bottom: 0.5, footer: 1 },
  },
  portrait: {
    orientation: 'portrait',
    margins: { top: 2, header: 1, left: 1, right: 1, bottom: 0.5, footer: 1 },
  },
};

export const DEFAULT_TITLE_FONT = { name: 'HY헤드라인M', size: 28 };
export const DEFAULT_BODY_FONT = { name: '맑은 고딕', size: 13 };
export const DEFAULT_HEADER_FILL_ARGB = 'FFDAE9F8';
// data: 사진이 없는 행의 기본 높이. dataWithPhoto: 그 행에 실제로 사진이 하나라도 있으면
// 이 값을 씀(방향 무관 — landscape/portrait 공통, 2026-07-03 확정).
export const DEFAULT_ROW_HEIGHTS = { title: 60, header: 30, data: 30, dataWithPhoto: 85 };
export const CELL_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

// Excel 열 너비는 반각 문자 기준 단위 — 한글/전각 문자는 2칸으로 계산해 실제 표시폭에 근사시킨다.
function charWeight(ch) {
  const code = ch.codePointAt(0);
  const cjk = (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x3130 && code <= 0x318f) || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xff00 && code <= 0xffef);
  return cjk ? 2 : 1;
}
function strWidth(s) {
  let w = 0;
  for (const ch of String(s || '')) w += charWeight(ch);
  return w;
}
export function autoWidth(strings, { min = 8, max = 40, padding = 5 } = {}) {
  let w = min;
  for (const s of strings) w = Math.max(w, strWidth(s) + padding);
  return Math.min(w, max);
}

// wrapText 컬럼의 실제 줄바꿈 줄 수를 열너비 기준으로 근사 추정 — exceljs는 렌더링을
//하지 않으므로 정확한 줄 수를 알 수 없다(열너비 자동계산과 같은 근본적 한계). 셀 좌우
// 여백을 감안해 열너비보다 살짝 작은 값으로 나눠 보수적으로(줄 수를 더 넉넉히) 추정한다.
function estimateWrappedLines(text, colWidthChars) {
  const w = strWidth(text);
  if (w === 0) return 1;
  return Math.max(1, Math.ceil(w / Math.max(1, colWidthChars - 2)));
}
// wrap 컬럼 중 가장 많은 줄이 필요한 컬럼 기준으로 행 높이를 계산해, 기본 높이(baseHeight)
// 보다 필요한 높이가 크면 그만큼 늘린다(줄바꿈된 내용이 잘려 보이지 않도록, 2026-07-03 확정).
export function wrapAwareRowHeight(row, columns, colWidths, fontSize, baseHeight) {
  let maxLines = 1;
  columns.forEach((col, i) => {
    if (!col.wrap) return;
    const lines = estimateWrappedLines(row[col.key], colWidths[i]);
    if (lines > maxLines) maxLines = lines;
  });
  const lineHeightPt = fontSize * 1.4;
  const neededHeight = maxLines * lineHeightPt + 6; // 상하 여백 근사치
  return Math.max(baseHeight, neededHeight);
}

/**
 * 머리글/바닥글 문자열 조립 헬퍼. 회사명 + 동적 출력일시(&D &T)를 우측에,
 * 페이지 번호(&P/&N)를 바닥글 가운데에 배치하는 표준 패턴.
 * companyName 생략 시 날짜만 표시.
 */
export function buildHeaderFooter({ companyName, fontName = '맑은 고딕', fontSize = 11 } = {}) {
  const company = companyName ? `${companyName}  ` : '';
  return {
    oddHeader: `&R&"${fontName},Regular"&${fontSize}${company}출력일: &D &T`,
    oddFooter: `&C&"${fontName}"&9&P / &N`,
  };
}

/**
 * 사진 셀 앵커 계산. 열/행 폭을 직접 계산하지 않고 "다음 열/행의 시작점에서
 * 인셋만큼 음수 오프셋으로 당겨" 지정한다 — Excel이 실제 렌더링 시점의 진짜 열너비를
 * 기준으로 계산해주므로 폰트/문자폭 근사식에 전혀 의존하지 않는다.
 *
 * ⚠ 시행착오 기록(다른 방법이 왜 실패했는지):
 * 1) fractional col/row (addImage({tl:{col:6.08,...}})) — exceljs가 "열너비*10000"을
 *    pseudo-EMU로 offset을 계산한 뒤, 그 값을 실제 EMU인 것처럼 그대로 XML에 써버리는
 *    버그가 있어 사진이 셀 왼쪽에 얇은 조각으로 찌그러짐.
 * 2) 열너비(문자수)를 픽셀로 직접 환산(MDW=7, Calibri 11 기준 표준 공식) — 워크북의
 *    실제 기본/Normal 스타일 폰트가 Calibri가 아니면(예: 맑은 고딕) 문자 폭이 달라
 *    계산이 틀어져 사진이 셀보다 작거나 크게 나옴.
 * → 최종 해법: nativeCol/nativeColOff(정수 EMU)를 직접 지정하되, "to" 앵커는
 *   photoCol+1(다음 열)에 음수 오프셋을 줘서 열너비 계산 자체를 생략한다.
 */
export function photoAnchor(col, rn0, insetPx = 3) {
  const insetEMU = insetPx * EMU_PER_PX;
  return {
    tl: { nativeCol: col, nativeColOff: insetEMU, nativeRow: rn0, nativeRowOff: insetEMU },
    br: { nativeCol: col + 1, nativeColOff: -insetEMU, nativeRow: rn0 + 1, nativeRowOff: -insetEMU },
    editAs: 'twoCell', // "위치와 크기 변함" — exceljs 기본값(oneCell="위치만 변함")을 덮어씀
  };
}

function guessImageExt(contentType, url) {
  const t = contentType || '';
  if (t.includes('png')) return 'png';
  if (t.includes('gif')) return 'gif';
  if (t.includes('jpeg')) return 'jpeg';
  const m = (url || '').toLowerCase().match(/\.(png|gif|jpe?g)(\?|$)/);
  if (m) return m[1] === 'jpg' ? 'jpeg' : m[1];
  return null;
}

/** URL에서 이미지를 받아 exceljs addImage()가 요구하는 {buffer, extension} 형태로 반환.
 *  exceljs는 jpeg/png/gif만 지원 — webp/heic 등은 null 반환(임베드 생략, 경고만 출력). */
export async function fetchImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const contentType = r.headers.get('content-type');
    const ext = guessImageExt(contentType, url);
    if (!ext) { console.warn('지원하지 않는 이미지 형식:', url, contentType); return null; }
    const buffer = Buffer.from(await r.arrayBuffer());
    return { buffer, extension: ext };
  } catch (e) {
    console.warn('사진 로드 실패:', url, e.message);
    return null;
  }
}

/**
 * exceljs는 삽입 이미지의 "가로 세로 비율 고정"(noChangeAspect)을 항상 1로 하드코딩해서
 * 쓰고 옵션으로 끌 방법을 제공하지 않는다. 저장된 xlsx의 drawing XML을 직접 열어 0으로
 * 바꿔준다. buildReportWorkbook()이 사진이 있을 때 자동으로 호출하므로 보통 직접 쓸 일 없음.
 */
export async function unlockImageAspectRatio(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const drawingFiles = Object.keys(zip.files).filter(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
  for (const f of drawingFiles) {
    const xml = await zip.file(f).async('string');
    zip.file(f, xml.replace(/noChangeAspect="1"/g, 'noChangeAspect="0"'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * 인쇄/보고용 엑셀 리포트 하나를 코드로 직접 구성해 Buffer로 반환한다.
 * 템플릿 파일을 전혀 쓰지 않는다 — 이유는 파일 상단 주석 참고.
 *
 * @param {object} opts
 * @param {string} opts.sheetName
 * @param {string} opts.title - 1행 제목(병합하지 않고 A1 좌측 정렬로 배치)
 * @param {Array<{key,header,width?,wrap?,align?,photo?}>} opts.columns
 *   - width 지정 시 고정폭, 미지정 시 데이터 글자 길이로 자동 계산(photo 컬럼은 header 기준)
 *   - align:'left' 컬럼은 좌측 정렬(들여쓰기 없음, 다른 컬럼과 동일한 기본 셀 여백만 사용)
 *   - photo:true 컬럼은 값 대신 이미지만 임베드
 * @param {Array<object>} opts.rows - r[col.key]로 값을 읽음. 사진 컬럼은 r[col.key+'_URL']
 * @param {'landscape'|'portrait'} [opts.orientation='landscape']
 * @param {object} [opts.margins] - cm 단위 {top,header,left,right,bottom,footer}, 생략 시 프리셋값
 * @param {object} [opts.headerFooter] - buildHeaderFooter() 결과 또는 {oddHeader,oddFooter} 직접 지정
 * @param {number} [opts.printTitlesRow=2] - 인쇄 시 반복할 헤더 행 번호
 * @param {number} [opts.zoomScale=90]
 * @param {Array<{key,value,color}>} [opts.statusColorRules] - 예: [{key:'조치여부',value:'완료',color:'FFFF0000'}]
 * @param {(url:string)=>Promise<{buffer,extension}|null>} [opts.fetchImage] - photo 컬럼 있을 때 필수
 * @param {number} [opts.photoInsetPx=3]
 * @returns {Promise<Buffer>}
 */
export async function buildReportWorkbook(opts) {
  const {
    sheetName,
    title,
    titleFont = DEFAULT_TITLE_FONT,
    bodyFont = DEFAULT_BODY_FONT,
    headerFillArgb = DEFAULT_HEADER_FILL_ARGB,
    rowHeights = DEFAULT_ROW_HEIGHTS,
    columns,
    rows,
    orientation = 'landscape',
    margins,
    headerFooter,
    printTitlesRow = 2,
    zoomScale = 90,
    statusColorRules = [],
    fetchImage,
    photoInsetPx = 3,
  } = opts;

  const preset = PAGE_PRESETS[orientation];
  if (!preset) throw new Error(`알 수 없는 orientation: ${orientation} (landscape|portrait만 지원)`);
  const m = margins || preset.margins;
  const pageMargins = {
    top: cm2in(m.top), bottom: cm2in(m.bottom), left: cm2in(m.left), right: cm2in(m.right),
    header: cm2in(m.header), footer: cm2in(m.footer),
  };

  const TITLE_ROW = 1;
  const HEADER_ROW = 2;
  const FIRST_DATA_ROW = 3;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false, zoomScale }],
    pageSetup: {
      paperSize: 9, // A4
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false, // "가로만" 가운데 정렬 — 세로는 하지 않음(2026-07-03 확정)
      margins: pageMargins,
      printTitlesRow: `${printTitlesRow}:${printTitlesRow}`,
    },
    headerFooter,
  });

  const colWidths = columns.map(col => {
    if (col.width) return col.width;
    const strings = col.photo ? [col.header] : [col.header, ...rows.map(r => r[col.key])];
    return autoWidth(strings);
  });
  ws.columns = colWidths.map(width => ({ width }));

  const titleRow = ws.getRow(TITLE_ROW);
  titleRow.height = rowHeights.title;
  const titleCell = titleRow.getCell(1);
  titleCell.value = title;
  titleCell.font = titleFont;
  titleCell.alignment = { vertical: 'middle' }; // 가로 정렬은 "일반"(horizontal 미지정) — 텍스트라 자동으로 좌측 표시됨

  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = rowHeights.header;
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = bodyFont;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = CELL_BORDER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFillArgb } };
  });

  const photoColumns = columns
    .map((col, i) => ({ col, i }))
    .filter(({ col }) => col.photo);

  // 사진 컬럼이 스키마에 하나라도 있으면 전체 데이터행을 큰 높이(dataWithPhoto)로 통일 —
  // 행마다 그 특정 행에 실제 사진이 있는지로 들쭉날쭉하게 바꾸지 않는다(인쇄 시 줄맞춤
  // 일관성을 위해 2026-07-03 확정). 사진 컬럼이 아예 없는 리포트는 기본 높이(data) 유지.
  const rowHeightForData = photoColumns.length ? rowHeights.dataWithPhoto : rowHeights.data;

  rows.forEach((r, i) => {
    const rn = FIRST_DATA_ROW + i;
    const row = ws.getRow(rn);
    row.height = wrapAwareRowHeight(r, columns, colWidths, bodyFont.size, rowHeightForData);
    columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      cell.font = bodyFont;
      cell.border = CELL_BORDER;
      cell.alignment = col.align === 'left'
        ? { vertical: 'middle', horizontal: 'left', wrapText: !!col.wrap }
        : { vertical: 'middle', horizontal: 'center', wrapText: !!col.wrap };
      if (col.photo) {
        // no-op — 이미지는 별도 addImage() 단계에서 채움
      } else if (col.dateCol && r[col.key]) {
        const d = parseDateCell(r[col.key]);
        if (d) { cell.value = d; cell.numFmt = 'yyyy-mm-dd'; } else { cell.value = r[col.key]; }
      } else {
        cell.value = r[col.key];
      }
    });
    statusColorRules.forEach(rule => {
      if (r[rule.key] !== rule.value) return;
      const ci = columns.findIndex(c => c.key === rule.key);
      if (ci < 0) return;
      row.getCell(ci + 1).font = { ...bodyFont, color: { argb: rule.color } };
    });
    row.commit();
  });

  if (photoColumns.length) {
    if (!fetchImage) throw new Error('photo 컬럼이 있으면 opts.fetchImage가 필요합니다.');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rn0 = FIRST_DATA_ROW - 1 + i;
      for (const { col, i: ci } of photoColumns) {
        const url = r[`${col.key}_URL`];
        if (!url) continue;
        const img = await fetchImage(url);
        if (!img) continue;
        const imgId = wb.addImage(img);
        ws.addImage(imgId, photoAnchor(ci, rn0, photoInsetPx));
      }
    }
  }

  let buffer = await wb.xlsx.writeBuffer();
  if (photoColumns.length) buffer = await unlockImageAspectRatio(buffer);
  return buffer;
}
