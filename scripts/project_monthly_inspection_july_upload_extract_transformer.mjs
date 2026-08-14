import ExcelJS from 'exceljs';
import fs from 'node:fs';

const filePath = 'C:\\Users\\shinf\\Downloads\\7월점검결과보고서_안전관리자_청하_2026_07.xlsx';

// apps/work-portal/monthly-inspection.html TUNNEL_TRANSFORMER_CAPACITY 상수와 동일(원본 엑셀 헤더 "조명용 (200 kVA)" 등으로 교차검증 완료)
const CAPACITY = {
  '청하터널(주)': { 조명용: '200 kVA', 일반용: '200 kVA', 동력용: '400 kVA' },
  '청하터널(부)': { 조명용: '150 kVA', 일반용: '150 kVA', 동력용: '400 kVA' }
};

const TYPES = ['조명용', '일반용', '동력용'];
const BLOCK_START = { 조명용: 16, 일반용: 27, 동력용: 38 }; // header row; data starts header+2

function cellText(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}

function extractTunnel(ws, tunnel) {
  const 측정일자raw = ws.getRow(3).getCell(3).value;
  const 측정일자 = 측정일자raw instanceof Date ? 측정일자raw.toISOString().slice(0, 10) : String(측정일자raw);
  const 점검자 = String(cellText(ws.getRow(4).getCell(3))).replace(/\s+/g, '');

  const records = [];
  for (const type of TYPES) {
    const headerRow = BLOCK_START[type];
    const dataStart = headerRow + 2;
    for (let i = 0; i < 8; i++) {
      const r = dataStart + i;
      const no = cellText(ws.getRow(r).getCell(1));
      if (no === '') continue;
      const 온도 = cellText(ws.getRow(r).getCell(2));
      const 비고 = cellText(ws.getRow(r).getCell(4));
      records.push({ no, 온도, 비고 });
    }
    for (let i = 0; i < 7; i++) {
      const r = dataStart + i;
      const no = cellText(ws.getRow(r).getCell(6));
      if (no === '') continue;
      const 온도 = cellText(ws.getRow(r).getCell(7));
      const 비고 = cellText(ws.getRow(r).getCell(9));
      records.push({ no, 온도, 비고 });
    }
  }

  // records currently flat across types in order 조명용(15) 일반용(15) 동력용(15) — re-split by type using push order
  const perType = { 조명용: [], 일반용: [], 동력용: [] };
  let idx = 0;
  for (const type of TYPES) {
    for (let i = 0; i < 15; i++) {
      perType[type].push(records[idx]);
      idx++;
    }
  }

  const out = [];
  for (const type of TYPES) {
    for (const rec of perType[type]) {
      out.push({
        터널명: tunnel,
        측정일자,
        점검자,
        변압기종류: type,
        용량: CAPACITY[tunnel][type],
        측정지점: `${type} #${rec.no}`,
        지점번호: Number(rec.no),
        '온도(℃)': Number(rec.온도),
        비고: rec.비고
      });
    }
  }
  return out;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);

const all = [];
for (const [sheetName, tunnel] of [['변압기온도측정(주)', '청하터널(주)'], ['변압기온도측정(부)', '청하터널(부)']]) {
  const ws = wb.getWorksheet(sheetName);
  all.push(...extractTunnel(ws, tunnel));
}

console.log(`총 ${all.length}건 추출`);
console.log('샘플 5건:');
all.slice(0, 5).forEach(r => console.log(JSON.stringify(r)));
console.log('마지막 5건:');
all.slice(-5).forEach(r => console.log(JSON.stringify(r)));

fs.writeFileSync('scripts/_tmp_transformer_july_extracted.json', JSON.stringify(all, null, 2), 'utf8');
console.log('저장: scripts/_tmp_transformer_july_extracted.json');
