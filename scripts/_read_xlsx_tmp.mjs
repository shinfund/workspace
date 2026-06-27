import ExcelJS from '../node_modules/exceljs/dist/es5/index.nodejs.js';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('C:/Users/shinf/Downloads/거래대금_20260626.xlsx');
const ws = wb.worksheets[0];
console.log('시트명:', ws.name, '/ 행수:', ws.rowCount);
const h = ws.getRow(1).values.slice(1);
console.log('헤더:', JSON.stringify(h));
for(let r=2;r<=Math.min(6,ws.rowCount);r++){
  console.log(JSON.stringify(ws.getRow(r).values.slice(1)));
}
