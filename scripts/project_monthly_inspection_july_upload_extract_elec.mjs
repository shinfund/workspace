import ExcelJS from 'exceljs';
import fs from 'node:fs';

const filePath = 'C:\\Users\\shinf\\Downloads\\7월점검결과보고서_안전관리자_청하_2026_07.xlsx';

function excelSerialToISO(n){
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.toISOString().slice(0,10);
}

function cellText(cell){
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0,10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t=>t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}

// ELEC_REPORT_LOWVOLT / ELEC_REPORT_HIGHVOLT order, reconstructed from the sheet dump
// (rows 14-29 in the original template = 16 저압설비 items with "발전\n설비" group for last 3)
const LOWVOLT_ORDER = ['인입구배선','배·분전반','배선용차단기','누전차단기','개폐기','배선','전동기','전열설비','용접기','콘덴서','조명설비','구내전선로','기타설비','발전기','차단장치','축전장치'];
const HIGHVOLT_ORDER = ['가공전선로','지중전선로','수배전용개폐기','배선(모선)','피뢰기','변성기','전력퓨즈','변압기','수배전반','계전기류','차단기류','전력용콘덴서','보호설비','부하설비','접지시설','기타설비'];
const ACB_ROWS = [ // (측정개소 4-row groups: 조명용/일반용/동력용) x (R-S/S-T/T-R/N)
  {용도:'조명용', 위상:'R'}, {용도:'조명용', 위상:'S'}, {용도:'조명용', 위상:'T'},
  {용도:'일반용', 위상:'R'}, {용도:'일반용', 위상:'S'}, {용도:'일반용', 위상:'T'},
  {용도:'동력용', 위상:'R'}, {용도:'동력용', 위상:'S'}, {용도:'동력용', 위상:'T'},
];

function stripLabel(s){ return String(s||'').replace(/\s+/g,''); }

function extractElecSheet(ws, tunnel){
  // Row offsets in original template: 4=제목행, 7=기본사항값1, 8=기본사항값2, 11-13=헤더, 14-29=데이터, 33=종합의견, 46=확인자, 47=담당자
  const g = (r,c) => cellText(ws.getRow(r).getCell(c));

  const 수전 = g(7,3), 발전 = g(7,9), 태양광 = g(7,16);
  const 점검일자raw = ws.getRow(8).getCell(3).value;
  let 점검일자;
  if (점검일자raw instanceof Date) 점검일자 = 점검일자raw.toISOString().slice(0,10);
  else if (typeof 점검일자raw === 'number') 점검일자 = excelSerialToISO(점검일자raw);
  else 점검일자 = String(점검일자raw||'');
  const 점검종별 = g(8,9), 점검횟수 = g(8,16);

  const elec1 = {
    터널명: tunnel, '설비명(상호)': tunnel,
    제목: `${tunnel} 전기설비점검결과기록표`,
    점검일자, 점검종별, 점검횟수,
    '수전전압/용량': 수전, '발전전압/용량': 발전, '태양광용량': 태양광
  };

  // ACB summary rows 26-29
  const 역률 = g(26,15); // O26 (merged O:R)
  const 유효전력량 = g(27,15);
  const 무효전력량 = g(28,15);
  const 최대전력 = g(29,15);
  const 배율raw = g(29,17); // Q29 label "배율", R29 value
  const 배율 = g(29,18);

  const elec2 = ACB_ROWS.map((spec, i) => {
    const rn = 14 + i;
    return {
      용도: spec.용도, 위상: spec.위상, 점검일자,
      '전압(V)': g(rn,16), '전류(A)': g(rn,17), '누설전류(mA)': g(rn,18),
      '역률(%)': 역률, '유효전력량(kWh)': 유효전력량, '무효전력량(kVar)': 무효전력량,
      '최대전력(kW)': 최대전력, 배율,
      제목: `${tunnel} 측정값`
    };
  });

  const 점검확인자 = g(46,14), 점검담당자 = g(47,14);
  const 종합의견raw = g(33,1);
  const 종합의견 = String(종합의견raw||'').replace(/^\*\s*/, '');

  const elec3 = [];
  LOWVOLT_ORDER.forEach((item, i) => {
    const rn = 14 + i;
    elec3.push({
      터널명: tunnel, 점검일자, 설비구분: '저압설비', 설비항목: item,
      점검결과판정: g(rn,3), '설비현황(증)': g(rn,4), '설비현황(감)': g(rn,5),
      부적합수량: g(rn,6), 개수수량: g(rn,7),
      점검담당자, 점검확인자, 종합의견,
      제목: `${tunnel} ${item}`
    });
  });
  HIGHVOLT_ORDER.forEach((item, i) => {
    const rn = 14 + i;
    elec3.push({
      터널명: tunnel, 점검일자, 설비구분: '특고(고압)설비', 설비항목: item,
      점검결과판정: g(rn,9), '설비현황(증)': g(rn,10), '설비현황(감)': g(rn,11),
      부적합수량: g(rn,12), 개수수량: g(rn,13),
      점검담당자, 점검확인자, 종합의견,
      제목: `${tunnel} ${item}`
    });
  });

  return {elec1, elec2, elec3};
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);

const results = {};
for (const [sheetName, tunnel] of [['전기설비기록표(주)','청하터널(주)'], ['전기설비기록표(부)','청하터널(부)']]) {
  const ws = wb.getWorksheet(sheetName);
  results[tunnel] = extractElecSheet(ws, tunnel);
}

for (const tunnel of Object.keys(results)) {
  const {elec1, elec2, elec3} = results[tunnel];
  console.log(`\n=== ${tunnel} ===`);
  console.log('elec1:', JSON.stringify(elec1));
  console.log(`elec2: ${elec2.length}건, 샘플 2건:`);
  elec2.slice(0,2).forEach(r=>console.log('  ', JSON.stringify(r)));
  console.log(`elec3: ${elec3.length}건, 샘플 2건 (저압/특고압 각 1):`);
  console.log('  ', JSON.stringify(elec3[0]));
  console.log('  ', JSON.stringify(elec3[16]));
}

fs.writeFileSync('scripts/_tmp_elec_july_extracted.json', JSON.stringify(results, null, 2), 'utf8');
console.log('\n전체 저장: scripts/_tmp_elec_july_extracted.json');
