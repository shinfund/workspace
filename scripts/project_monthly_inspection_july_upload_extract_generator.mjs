import ExcelJS from 'exceljs';
import fs from 'node:fs';

const filePath = 'C:\\Users\\shinf\\Downloads\\7월점검결과보고서_안전관리자_청하_2026_07.xlsx';

// apps/work-portal/monthly-inspection.html GENERATOR_CHECKLIST 순서/텍스트와 동일(2026-07-20 노션 실데이터 확인 기준)
const CHECKLIST_ORDER = {
  일반: ['연료량 확인', '주연료 탱크 외관 확인', '연료 공급 라인의 누유여부', '오일 필터 상태', '에어클리너 청결 상태',
    '냉각수 상태', '냉각수 라인 누수 여부', '냉각수 HEATER 작동상태', '배터리 충전 상태', '배터리 단자의 고정, 청결상태'],
  운전중: ['사일런서 상태', '운전중 엔진의 동작상태', '급기용 댐퍼 개방 상태', '자동 컨트롤 패널의 작동상태', '냉각수 온도 적정 여부',
    'AVR 자동전압조정기 동작상태', '시간 기록계 기록', '회전 기록계 기록', '베어링 이상소음 발생여부', 'ACB 차단기 동작 상태']
};
// 시트 원문 라벨 → 카탈로그 정식 텍스트로 교정(2개 항목만 표기 차이 있음, 나머지는 번호만 제거하면 그대로 일치)
const LABEL_FIX = { '에어 크리너 청결 상태': '에어클리너 청결 상태', '사이렌서 상태': '사일런서 상태' };

const TANK_CAPACITY = { '청하터널(주)': 2000, '청하터널(부)': 990 };

function cellText(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}

function normResult(s) {
  s = String(s || '').trim();
  if (s === '해당사항없음') return s;
  let m = /^(\d+(?:\.\d+)?)\(([^)]+)\)$/.exec(s);
  if (m) return `${m[1]} ${m[2]}`;
  m = /^(\d+(?:\.\d+)?)([a-zA-Z]+)$/.exec(s);
  if (m) return `${m[1]} ${m[2]}`;
  return s.replace(/\s+/g, ''); // "양 호" -> "양호"
}

function stripNo(s) {
  return String(s || '').replace(/^\d+\.\s*/, '').trim();
}

function extractTunnel(ws, tunnel) {
  const 가동일자raw = ws.getRow(4).getCell(3).value;
  const 가동일자 = 가동일자raw instanceof Date ? 가동일자raw.toISOString().slice(0, 10) : String(가동일자raw);
  const 점검자 = String(cellText(ws.getRow(5).getCell(3))).replace(/\s+/g, '');

  const gen1 = {
    터널명: tunnel,
    가동일자,
    제목: `${tunnel} 발전기운전`,
    점검자,
    가동시간: String(cellText(ws.getRow(9).getCell(1))),
    '전압(V)': Number(cellText(ws.getRow(9).getCell(4))),
    '전류(A)': Number(cellText(ws.getRow(9).getCell(6))),
    '전력(kW)': Number(cellText(ws.getRow(9).getCell(8))),
    '주파수(Hz)': Number(cellText(ws.getRow(9).getCell(10))),
    '역률(%)': Number(cellText(ws.getRow(9).getCell(12))),
    '가동시간(min)': Number(cellText(ws.getRow(9).getCell(14))),
    비고: String(cellText(ws.getRow(9).getCell(16)))
  };

  const gen2 = {
    터널명: tunnel,
    가동일자,
    제목: `${tunnel} 유류사용량`,
    '용량(L)': TANK_CAPACITY[tunnel],
    종류: String(cellText(ws.getRow(13).getCell(4))).replace(/\s+/g, ''),
    '전일재고량(L)': Number(cellText(ws.getRow(13).getCell(6))),
    '입고량(L)': Number(cellText(ws.getRow(13).getCell(10))),
    '사용량(L)': Number(cellText(ws.getRow(13).getCell(13))),
    '금일재고량(L)': Number(cellText(ws.getRow(13).getCell(16)))
  };

  const gen3 = [];
  for (let i = 0; i < 10; i++) {
    const r = 17 + i;
    const rawGeneral = stripNo(cellText(ws.getRow(r).getCell(1)));
    const generalLabel = LABEL_FIX[rawGeneral] || rawGeneral;
    const generalResult = normResult(cellText(ws.getRow(r).getCell(8)));
    gen3.push({ 터널명: tunnel, 가동일자, 제목: `${tunnel} 점검사항`, 점검구분: '일반점검사항', 점검내용: generalLabel, 결과: generalResult, 특이사항: null });

    const rawRun = stripNo(cellText(ws.getRow(r).getCell(11)));
    const runLabel = LABEL_FIX[rawRun] || rawRun;
    const runResult = normResult(cellText(ws.getRow(r).getCell(17)));
    gen3.push({ 터널명: tunnel, 가동일자, 제목: `${tunnel} 점검사항`, 점검구분: '운전중점검사항', 점검내용: runLabel, 결과: runResult, 특이사항: null });
  }

  // 카탈로그 순서/텍스트 정합성 검증(20개 전부 일치해야 함)
  const expect = [...CHECKLIST_ORDER.일반.map(t => ['일반점검사항', t]), ...CHECKLIST_ORDER.운전중.map(t => ['운전중점검사항', t])];
  const got = gen3.map(r => [r.점검구분, r.점검내용]);
  const gotSorted = [...got].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const expectSorted = [...expect].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const mismatch = gotSorted.filter((g, i) => g[0] !== expectSorted[i][0] || g[1] !== expectSorted[i][1]);
  if (mismatch.length) {
    console.log(`[경고] ${tunnel} 카탈로그 불일치 ${mismatch.length}건:`, JSON.stringify(mismatch));
  }

  return { gen1, gen2, gen3 };
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);

const results = {};
for (const [sheetName, tunnel] of [['발전기점검표(주)', '청하터널(주)'], ['발전기점검표(부)', '청하터널(부)']]) {
  const ws = wb.getWorksheet(sheetName);
  results[tunnel] = extractTunnel(ws, tunnel);
}

for (const tunnel of Object.keys(results)) {
  console.log(`\n=== ${tunnel} ===`);
  console.log('gen1:', JSON.stringify(results[tunnel].gen1));
  console.log('gen2:', JSON.stringify(results[tunnel].gen2));
  console.log(`gen3: ${results[tunnel].gen3.length}건`);
}

fs.writeFileSync('scripts/_tmp_generator_july_extracted.json', JSON.stringify(results, null, 2), 'utf8');
console.log('\n저장: scripts/_tmp_generator_july_extracted.json');
