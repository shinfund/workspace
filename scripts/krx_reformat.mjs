import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

const BASE_DIR = 'C:\\Users\\shinf\\Workspace\\data\\거래대금';

const COLUMNS = [
  { key: '날짜',       header: '날짜',       numFmt: 'yyyy-mm-dd'           },
  { key: '순위',       header: '순위',       numFmt: 'General'              },
  { key: '시장',       header: '시장',       numFmt: 'General'              },
  { key: '종목코드',   header: '종목코드',   numFmt: '@'                    },
  { key: '종목명',     header: '종목명',     numFmt: 'General'              },
  { key: '상장주식수', header: '상장주식수', numFmt: '#,##0'                },
  { key: '시가',       header: '시가',       numFmt: '#,##0'                },
  { key: '고가',       header: '고가',       numFmt: '#,##0'                },
  { key: '저가',       header: '저가',       numFmt: '#,##0'                },
  { key: '종가',       header: '종가',       numFmt: '#,##0'                },
  { key: '전일종가',   header: '전일종가',   numFmt: '#,##0'                },
  { key: '전일대비',   header: '전일대비',   numFmt: '\\+#,##0;\\-#,##0;0' },
  { key: '등락률',     header: '등락률',     numFmt: '0.00'                 },
  { key: '변동폭',     header: '변동폭',     numFmt: '#,##0'                },
  { key: '거래량',     header: '거래량',     numFmt: '#,##0'                },
  { key: '거래대금',   header: '거래대금',   numFmt: '#,##0'                },
  { key: '시가총액',   header: '시가총액',   numFmt: '#,##0'                },
  { key: '회전율',     header: '회전율',     numFmt: '0.00'                 },
];

function dispLen(str) {
  if (str === null || str === undefined) return 0;
  let len = 0;
  for (const ch of String(str)) {
    len += /[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿豈-﫿]/.test(ch) ? 2 : 1;
  }
  return len;
}

function fmtDisplay(value, numFmt) {
  if (value === null || value === undefined) return '';
  if (numFmt === '@') return String(value);
  if (numFmt === 'General') return String(value);
  if (numFmt === 'yyyy-mm-dd') {
    const d = value instanceof Date ? value : new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if (numFmt === '0.00') return Number(value).toFixed(2);
  if (numFmt.includes('#,##0')) {
    const n = Number(value);
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    if (numFmt.includes('\\+')) return (n >= 0 ? '+' : '-') + abs;
    return abs;
  }
  return String(value);
}

function calcWidths(rows) {
  const widths = COLUMNS.map(c => dispLen(c.header));
  for (const row of rows) {
    COLUMNS.forEach((col, i) => {
      widths[i] = Math.max(widths[i], dispLen(fmtDisplay(row[col.key], col.numFmt)));
    });
  }
  return widths.map(w => w + 2);
}

function getAllXlsx(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getAllXlsx(full));
    else if (entry.name.endsWith('.xlsx')) results.push(full);
  }
  return results.sort();
}

// RichText 등 복합 값 → 단순 값 변환
function rawValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  return v;
}

async function reformatFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.worksheets[0];
  if (!ws) return false;

  const sheetName = ws.name;
  const dataRows = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rowData = {};
    COLUMNS.forEach((col, i) => {
      let v = rawValue(row.getCell(i + 1).value);
      // 종목코드: 숫자로 읽혔을 경우 6자리 문자열 복원
      if (col.key === '종목코드' && typeof v === 'number') {
        v = String(Math.round(v)).padStart(6, '0');
      }
      rowData[col.key] = v;
    });
    dataRows.push(rowData);
  });

  if (!dataRows.length) return false;

  const widths = calcWidths(dataRows);

  const newWb = new ExcelJS.Workbook();
  const newWs = newWb.addWorksheet(sheetName);

  newWs.columns = COLUMNS.map((c, i) => ({
    key:    c.key,
    header: c.header,
    width:  widths[i],
    style:  { numFmt: c.numFmt },
  }));

  for (const rowData of dataRows) {
    newWs.addRow(rowData);
  }

  await newWb.xlsx.writeFile(filePath);
  return true;
}

// ── main ──────────────────────────────────────────────────────
const files = getAllXlsx(BASE_DIR);
console.log(`총 ${files.length}개 파일 처리 시작\n`);

let ok = 0, skip = 0, err = 0;
for (const f of files) {
  const name = path.basename(f);
  try {
    await reformatFile(f);
    ok++;
    if (ok % 100 === 0) process.stdout.write(`  [${ok}/${files.length}] 처리중...\n`);
  } catch (e) {
    if (e.code === 'EBUSY') {
      console.warn(`  [스킵] ${name} — 파일 열려있음`);
      skip++;
    } else {
      console.error(`  [오류] ${name} — ${e.message}`);
      err++;
    }
  }
}
console.log(`\n완료: ${ok}개 / 스킵: ${skip}개 / 오류: ${err}개`);
