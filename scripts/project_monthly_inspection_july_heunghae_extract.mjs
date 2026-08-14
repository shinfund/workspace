import ExcelJS from 'exceljs';
import fs from 'node:fs';

const filePath = 'C:\\Users\\shinf\\Downloads\\26년 07월점검결과보고서_흥해터널.xlsx';
const TUNNEL = '흥해터널';
const YM = '2026년 7월'; // title prefix, matches uniform convention confirmed in existing 청하/남정5 July records

function cellText(cell) {
  let v = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
  }
  return v === null || v === undefined ? '' : v;
}
function excelSerialToISO(n) {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}
function cellDate(cell) {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerialToISO(v);
  if (v && v.result !== undefined) return typeof v.result === 'number' ? excelSerialToISO(v.result) : String(v.result).slice(0, 10);
  return '';
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const out = {};

// ===== 1. 월간점검 (REPORT_CHECKLIST_ORDER 카탈로그 매칭) =====
const REPORT_CHECKLIST_ORDER = [
  {구분:'특고압설비',설비명:'인입설비',점검내용:'특고 인입선로 및 단말처리상태'},
  {구분:'특고압설비',설비명:'인입설비',점검내용:'LA외관 균열 여부'},
  {구분:'특고압설비',설비명:'인입설비',점검내용:'LBS외관 및 PF 균열 여부'},
  {구분:'특고압설비',설비명:'VCB판넬',점검내용:'MOF 절연유 누유 및 몰드 변형여부'},
  {구분:'특고압설비',설비명:'VCB판넬',점검내용:'차단기 작동 상태(분기)'},
  {구분:'특고압설비',설비명:'VCB판넬',점검내용:'보호계전기 및 지시계기 계측 상태'},
  {구분:'특고압설비',설비명:'VCB판넬',점검내용:'진공탱크 균열 및 외관상태'},
  {구분:'특고압설비',설비명:'변압기',점검내용:'케이블헤드 외관상태'},
  {구분:'특고압설비',설비명:'변압기',점검내용:'몰드 외관 균열여부'},
  {구분:'특고압설비',설비명:'변압기',점검내용:'유량계 및 온도계 상태'},
  {구분:'특고압설비',설비명:'기타',점검내용:'절연저항 측정 (연차)'},
  {구분:'특고압설비',설비명:'기타',점검내용:'접지저항 측정 (연차)'},
  {구분:'특고압설비',설비명:'기타',점검내용:'절연내력 측정 (연차)'},
  {구분:'특고압설비',설비명:'기타',점검내용:'적외선 열화상 측정 (분기)'},
  {구분:'특고압설비',설비명:'기타',점검내용:'전원품질분석 (연차)'},
  {구분:'특고압설비',설비명:'기타',점검내용:'특고압반 기기별 열화 및 모선지지물 상태'},
  {구분:'특고압설비',설비명:'기타',점검내용:'냉각팬 및 히터 동작상태 (분기)'},
  {구분:'저압설비',설비명:'각종차단기',점검내용:'접점부 단자 소손여부 (분기)'},
  {구분:'저압설비',설비명:'각종차단기',점검내용:'ACB, ATS, CTTS 동작 상태 (분기)'},
  {구분:'저압설비',설비명:'각종차단기',점검내용:'정전시험 한전/발전 절체시험(실부하 운전)_(분기)'},
  {구분:'저압설비',설비명:'각종차단기',점검내용:'전자접촉기(M,G) 이상여부 (분기)'},
  {구분:'저압설비',설비명:'접속부',점검내용:'각종 모선 및 케이블 접속 상태 (분기)'},
  {구분:'저압설비',설비명:'접속부',점검내용:'각종 볼트 이완여부 (분기)'},
  {구분:'저압설비',설비명:'케이블상태',점검내용:'이상 소음 발생 여부'},
  {구분:'저압설비',설비명:'케이블상태',점검내용:'열화에 의한 피복 소손여부'},
  {구분:'저압설비',설비명:'케이블상태',점검내용:'트렌치내 케이블 상태 (분기)'},
  {구분:'저압설비',설비명:'진상콘덴서',점검내용:'절연유 누유 및 변형여부'},
  {구분:'저압설비',설비명:'기타',점검내용:'절연저항 측정 (연차)'},
  {구분:'저압설비',설비명:'기타',점검내용:'접지저항 측정 (분기)'},
  {구분:'저압설비',설비명:'기타',점검내용:'부하평형 여부 측정 (분기)'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'축전지 전해액 및 충전상태'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'입,출력부 전압 전류 상태'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'이상 소음 발생 여부'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'비상시 전원절체 동작여부'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'UPS 축전지 내부저항 및 전압측정(첨부양식 #2-1)_(분기)'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'전자접촉기, 휴즈 이상여부'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'축전지 단자 산화 및 접속상태'},
  {구분:'비상전원설비',설비명:'UPS',점검내용:'부하평형 여부측정 (분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'작동 무부하시험'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'작동 부하시험(부하평형 여부 확인)_(분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'엔진오일 오염 및 유량상태'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'각종 오일 누유 여부'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'냉각수 및 유류보충 상태'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'축전지 전해액 및 충전상태 (분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'배터리 내부저항 측정점검 (분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'전기결선상태 점검'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'자동·수동스위치 및 전력회로 점검'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'전력 배선 및 접속부 상태 (분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'엔진기기 조임상태'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'벨트상태 및 장력 (분기)'},
  {구분:'비상전원설비',설비명:'발전기',점검내용:'부대설비(급,배기시설) 상태 (분기)'},
  {구분:'기타',설비명:null,점검내용:'각종 공구 관리상태 및 자재비치 상태'},
  {구분:'태양광발전설비',설비명:null,점검내용:'패널 외관상태 및 발전량 확인'},
  {구분:'태양광발전설비',설비명:null,점검내용:'구조물 외관상태 및 볼트 체결상태'},
  {구분:'태양광발전설비',설비명:null,점검내용:'전선 및 접속부 이상 상태'},
  {구분:'태양광발전설비',설비명:null,점검내용:'인버터 외관상태 및 정상 작동상태'},
  {구분:'직무고시',설비명:'저압설비',점검내용:'절연저항 측정(연차)'},
  {구분:'직무고시',설비명:'저압설비',점검내용:'누설전류 측정(분기, 필요시)'},
  {구분:'직무고시',설비명:'저압설비',점검내용:'접지저항 측정(반기)'},
  {구분:'직무고시',설비명:'고압설비',점검내용:'절연저항 측정(연차)'},
  {구분:'직무고시',설비명:'고압설비',점검내용:'접지저항 측정(연차)'},
  {구분:'직무고시',설비명:'고압설비',점검내용:'절연내력 측정(연차)'},
  {구분:'직무고시',설비명:'변압기점검',점검내용:'절연저항 점검(연차)'},
  {구분:'직무고시',설비명:'변압기점검',점검내용:'절연내력, 산가도 측정(연차, 필요시)'},
  {구분:'직무고시',설비명:'예비발전설비',점검내용:'절연 및 접지저항 측정(반기)'},
  {구분:'직무고시',설비명:'예비발전설비',점검내용:'축전지 및 충전장치 점검(반기)'},
  {구분:'직무고시',설비명:'예비발전설비',점검내용:'발전기 무부하 또는 부하시험(분기)'}
];
const COMBINE_GUBUN = new Set(['기타', '태양광발전설비']);
function norm(s) { return String(s || '').replace(/^ㅇ\s*/, '').replace(/\s+/g, '').replace(/내역/g, '내력'); }
const catalogIndex = new Map();
REPORT_CHECKLIST_ORDER.forEach(item => {
  const key = norm(item.구분) + '|' + norm(COMBINE_GUBUN.has(item.구분) ? '' : (item.설비명 || '')) + '|' + norm(item.점검내용);
  catalogIndex.set(key, item);
});

{
  const matched = [], unmatched = [];
  for (const sheetName of ['월간점검표1', '월간점검표2', '월간점검표3']) {
    const ws = wb.getWorksheet(sheetName);
    for (let r = 6; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const 구분 = cellText(row.getCell(1));
      const 설비명raw = cellText(row.getCell(2));
      const 점검내용 = cellText(row.getCell(3));
      const 점검결과 = cellText(row.getCell(4));
      const 점검일자 = row.getCell(5).value;
      const 비고 = cellText(row.getCell(6));
      if (!구분 && !점검내용) continue;
      const key = norm(구분) + '|' + norm(COMBINE_GUBUN.has(구분) ? '' : (설비명raw || '')) + '|' + norm(점검내용);
      const cat = catalogIndex.get(key);
      if (!cat) { unmatched.push({ sheet: sheetName, row: r, 구분, 설비명: 설비명raw, 점검내용 }); continue; }
      if (!(점검일자 instanceof Date)) continue;
      matched.push({
        터널명: TUNNEL, 구분: cat.구분, 설비명: cat.설비명, 점검내용: cat.점검내용,
        점검결과: 점검결과 || '', 점검일자: 점검일자.toISOString().slice(0, 10), 비고: 비고 || '',
        제목: `${YM} 월간점검결과표`
      });
    }
  }
  out.monthly = { matched, unmatched };
  console.log(`[월간점검] 매칭 ${matched.length}건, 미매칭 ${unmatched.length}건`);
  unmatched.forEach(u => console.log(`  미매칭: [${u.sheet} r${u.row}] ${u.구분}/${u.설비명}/${u.점검내용}`));
}

// ===== 2. 전기설비기록 (elec1/2/3) =====
{
  const LOWVOLT_ORDER = ['인입구배선','배·분전반','배선용차단기','누전차단기','개폐기','배선','전동기','전열설비','용접기','콘덴서','조명설비','구내전선로','기타설비','발전기','차단장치','축전장치'];
  const HIGHVOLT_ORDER = ['가공전선로','지중전선로','수배전용개폐기','배선(모선)','피뢰기','변성기','전력퓨즈','변압기','수배전반','계전기류','차단기류','전력용콘덴서','보호설비','부하설비','접지시설','기타설비'];
  const ACB_ROWS = [
    {용도:'조명용',위상:'R'},{용도:'조명용',위상:'S'},{용도:'조명용',위상:'T'},
    {용도:'일반용',위상:'R'},{용도:'일반용',위상:'S'},{용도:'일반용',위상:'T'},
    {용도:'동력용',위상:'R'},{용도:'동력용',위상:'S'},{용도:'동력용',위상:'T'},
  ];
  const ws = wb.getWorksheet('전기설비기록표');
  const g = (r, c) => cellText(ws.getRow(r).getCell(c));

  const 수전 = g(7, 3), 발전 = g(7, 9), 태양광 = g(7, 16);
  const 점검일자raw = ws.getRow(8).getCell(3).value;
  let 점검일자;
  if (점검일자raw instanceof Date) 점검일자 = 점검일자raw.toISOString().slice(0, 10);
  else if (typeof 점검일자raw === 'number') 점검일자 = excelSerialToISO(점검일자raw);
  else if (점검일자raw && typeof 점검일자raw.result === 'number') 점검일자 = excelSerialToISO(점검일자raw.result);
  else 점검일자 = String(점검일자raw || '');
  const 점검종별 = g(8, 9), 점검횟수 = g(8, 16);

  const elec1 = {
    터널명: TUNNEL, '설비명(상호)': TUNNEL, 제목: `${YM} 전기설비점검결과기록표`,
    점검일자, 점검종별, 점검횟수, '수전전압/용량': 수전, '발전전압/용량': 발전, '태양광용량': 태양광
  };

  // 역률(%): 셀 numFmt가 "0%"라 0.87 형태(87%를 뜻함) -> *100 반올림
  const 역률raw = Number(g(26, 15)) || 0;
  const 역률 = Math.round(역률raw * 100);
  const 유효전력량 = g(27, 15);
  // 무효전력량: O28="지상"값, Q28="진상"값(수식) 두 개를 합쳐 "지상NNN / 진상NNN" 텍스트로 저장(기존 DB 실데이터 패턴과 동일)
  const 지상값 = Math.round(Number(g(28, 16)) || 0);
  const 진상raw = ws.getRow(28).getCell(18).value;
  const 진상값 = Math.round(typeof 진상raw === 'object' && 진상raw?.result !== undefined ? 진상raw.result : Number(g(28, 18)) || 0);
  const 무효전력량 = `지상${지상값.toLocaleString('en-US')} / 진상${진상값.toLocaleString('en-US')}`;
  const 최대전력 = g(29, 15);
  const 배율 = Number(g(29, 18)) || 0;

  const elec2 = ACB_ROWS.map((spec, i) => {
    const rn = 14 + i;
    return {
      용도: spec.용도, 위상: spec.위상, 점검일자,
      '전압(V)': g(rn, 16), '전류(A)': g(rn, 17), '누설전류(mA)': g(rn, 18),
      '역률(%)': 역률, '유효전력량(kWh)': 유효전력량, '무효전력량(kVar)': 무효전력량,
      '최대전력(kW)': 최대전력, 배율, 제목: `${YM} 측정값`
    };
  });

  const 점검확인자 = g(46, 14), 점검담당자 = g(47, 14);
  const 종합의견 = String(g(33, 1) || '').replace(/^\*\s*/, '');

  const elec3 = [];
  LOWVOLT_ORDER.forEach((item, i) => {
    const rn = 14 + i;
    elec3.push({
      터널명: TUNNEL, 점검일자, 설비구분: '저압설비', 설비항목: item,
      점검결과판정: g(rn, 3), '설비현황(증)': g(rn, 4), '설비현황(감)': g(rn, 5),
      부적합수량: g(rn, 6), 개수수량: g(rn, 7), 점검담당자, 점검확인자, 종합의견,
      제목: `${YM} 점검내역`
    });
  });
  HIGHVOLT_ORDER.forEach((item, i) => {
    const rn = 14 + i;
    elec3.push({
      터널명: TUNNEL, 점검일자, 설비구분: '특고(고압)설비', 설비항목: item,
      점검결과판정: g(rn, 9), '설비현황(증)': g(rn, 10), '설비현황(감)': g(rn, 11),
      부적합수량: g(rn, 12), 개수수량: g(rn, 13), 점검담당자, 점검확인자, 종합의견,
      제목: `${YM} 점검내역`
    });
  });

  out.elec = { elec1, elec2, elec3 };
  console.log(`[전기설비기록] elec1=1건, elec2=${elec2.length}건, elec3=${elec3.length}건`);
  console.log('  elec1:', JSON.stringify(elec1));
  console.log('  elec2 샘플:', JSON.stringify(elec2[0]));
}

// ===== 3. 변압기온도측정 =====
{
  const CAPACITY = { '흥해터널': { 조명용: '250 kVA', 일반용: '250 kVA', 동력용: '500 kVA' } };
  const TYPES = ['조명용', '일반용', '동력용'];
  const BLOCK_START = { 조명용: 16, 일반용: 27, 동력용: 38 };
  const ws = wb.getWorksheet('변압기온도측정');
  const 측정일자raw = ws.getRow(3).getCell(3).value;
  let 측정일자;
  if (측정일자raw instanceof Date) 측정일자 = 측정일자raw.toISOString().slice(0, 10);
  else if (측정일자raw && 측정일자raw.result instanceof Date) 측정일자 = 측정일자raw.result.toISOString().slice(0, 10);
  else if (측정일자raw && typeof 측정일자raw.result === 'number') 측정일자 = excelSerialToISO(측정일자raw.result);
  else 측정일자 = String(측정일자raw || '');
  const 점검자 = String(cellText(ws.getRow(4).getCell(3))).replace(/\s+/g, '');

  const records = [];
  for (const type of TYPES) {
    const headerRow = BLOCK_START[type];
    const dataStart = headerRow + 2;
    for (let i = 0; i < 8; i++) {
      const r = dataStart + i;
      const no = cellText(ws.getRow(r).getCell(1));
      if (no === '') continue;
      records.push({ type, no, 온도: cellText(ws.getRow(r).getCell(2)), 비고: cellText(ws.getRow(r).getCell(4)) });
    }
    for (let i = 0; i < 7; i++) {
      const r = dataStart + i;
      const no = cellText(ws.getRow(r).getCell(6));
      if (no === '') continue;
      records.push({ type, no, 온도: cellText(ws.getRow(r).getCell(7)), 비고: cellText(ws.getRow(r).getCell(9)) });
    }
  }
  const all = records.map(rec => ({
    터널명: TUNNEL, 측정일자, 점검자, 변압기종류: rec.type, 용량: CAPACITY[TUNNEL][rec.type],
    측정지점: `${rec.type} #${rec.no}`, 지점번호: Number(rec.no), '온도(℃)': Number(rec.온도), 비고: rec.비고,
    제목: `${YM} 변압기온도측정표`
  }));
  out.transformer = all;
  console.log(`[변압기온도] ${all.length}건`);
}

// ===== 4. 발전기점검 (gen1/2/3) =====
{
  const CHECKLIST_ORDER = {
    일반: ['연료량 확인','주연료 탱크 외관 확인','연료 공급 라인의 누유여부','오일 필터 상태','에어클리너 청결 상태',
      '냉각수 상태','냉각수 라인 누수 여부','냉각수 HEATER 작동상태','배터리 충전 상태','배터리 단자의 고정, 청결상태'],
    운전중: ['사일런서 상태','운전중 엔진의 동작상태','급기용 댐퍼 개방 상태','자동 컨트롤 패널의 작동상태','냉각수 온도 적정 여부',
      'AVR 자동전압조정기 동작상태','시간 기록계 기록','회전 기록계 기록','베어링 이상소음 발생여부','ACB 차단기 동작 상태']
  };
  const LABEL_FIX = { '에어 크리너 청결 상태': '에어클리너 청결 상태', '사이렌서 상태': '사일런서 상태' };
  const TANK_CAPACITY = { '흥해터널': 2000 };

  function normResult(s) {
    s = String(s || '').trim();
    if (s === '해당사항없음') return s;
    let m = /^(\d+(?:\.\d+)?)\(([^)]+)\)$/.exec(s);
    if (m) return `${m[1]} ${m[2]}`;
    m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/.exec(s); // 숫자+공백(0회 이상)+단위 모두 커버(청하는 붙여쓰기, 흥해는 띄어쓰기 확인됨)
    if (m) return `${m[1]} ${m[2]}`;
    return s.replace(/\s+/g, '');
  }
  function stripNo(s) { return String(s || '').replace(/^\d+\.\s*/, '').trim(); }

  const ws = wb.getWorksheet('발전기점검표');
  const 가동일자raw = ws.getRow(3).getCell(3).value;
  let 가동일자;
  if (가동일자raw instanceof Date) 가동일자 = 가동일자raw.toISOString().slice(0, 10);
  else if (가동일자raw && 가동일자raw.result instanceof Date) 가동일자 = 가동일자raw.result.toISOString().slice(0, 10);
  else if (가동일자raw && typeof 가동일자raw.result === 'number') 가동일자 = excelSerialToISO(가동일자raw.result);
  else 가동일자 = String(가동일자raw || '');
  const 점검자 = String(cellText(ws.getRow(4).getCell(3))).replace(/\s+/g, '');

  const gen1 = {
    터널명: TUNNEL, 가동일자, 제목: `${YM} 발전기운전`, 점검자,
    가동시간: String(cellText(ws.getRow(9).getCell(1))),
    '전압(V)': Number(cellText(ws.getRow(9).getCell(4))), '전류(A)': Number(cellText(ws.getRow(9).getCell(6))),
    '전력(kW)': Number(cellText(ws.getRow(9).getCell(8))), '주파수(Hz)': Number(cellText(ws.getRow(9).getCell(10))),
    '역률(%)': Number(cellText(ws.getRow(9).getCell(12))), '가동시간(min)': Number(cellText(ws.getRow(9).getCell(14))),
    비고: String(cellText(ws.getRow(9).getCell(16)))
  };
  const gen2 = {
    터널명: TUNNEL, 가동일자, 제목: `${YM} 유류사용량`, '용량(L)': TANK_CAPACITY[TUNNEL],
    종류: String(cellText(ws.getRow(13).getCell(4))).replace(/\s+/g, ''),
    '전일재고량(L)': Number(cellText(ws.getRow(13).getCell(6))), '입고량(L)': Number(cellText(ws.getRow(13).getCell(10))),
    '사용량(L)': Number(cellText(ws.getRow(13).getCell(13))), '금일재고량(L)': Number(cellText(ws.getRow(13).getCell(16)))
  };
  const gen3 = [];
  for (let i = 0; i < 10; i++) {
    const r = 16 + i; // 흥해 실측: 항목1이 row16부터 시작(청하 템플릿의 17과 다름, 실측 검증됨)
    const generalLabel = LABEL_FIX[stripNo(cellText(ws.getRow(r).getCell(1)))] || stripNo(cellText(ws.getRow(r).getCell(1)));
    const generalResult = normResult(cellText(ws.getRow(r).getCell(8)));
    gen3.push({ 터널명: TUNNEL, 가동일자, 제목: `${YM} 점검사항`, 점검구분: '일반점검사항', 점검내용: generalLabel, 결과: generalResult });
    const runLabel = LABEL_FIX[stripNo(cellText(ws.getRow(r).getCell(11)))] || stripNo(cellText(ws.getRow(r).getCell(11)));
    const runResult = normResult(cellText(ws.getRow(r).getCell(17)));
    gen3.push({ 터널명: TUNNEL, 가동일자, 제목: `${YM} 점검사항`, 점검구분: '운전중점검사항', 점검내용: runLabel, 결과: runResult });
  }
  const expect = [...CHECKLIST_ORDER.일반.map(t => ['일반점검사항', t]), ...CHECKLIST_ORDER.운전중.map(t => ['운전중점검사항', t])];
  const got = gen3.map(r => [r.점검구분, r.점검내용]);
  const gotSorted = [...got].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const expectSorted = [...expect].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const mismatch = gotSorted.filter((g, i) => g[0] !== expectSorted[i][0] || g[1] !== expectSorted[i][1]);
  if (mismatch.length) console.log(`[경고] 발전기점검 카탈로그 불일치 ${mismatch.length}건:`, JSON.stringify(mismatch));
  else console.log('[발전기점검] 카탈로그 20/20 일치 확인');

  out.generator = { gen1, gen2, gen3 };
  console.log(`[발전기점검] gen1=1건, gen2=1건, gen3=${gen3.length}건`);
}

// ===== 5. 전력사용량 =====
{
  const ws = wb.getWorksheet('전력사용량');
  const records = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const 날짜raw = ws.getRow(r).getCell(1).value;
    if (!(날짜raw instanceof Date)) continue;
    const main = cellText(ws.getRow(r).getCell(2));
    if (main === '') continue;
    const light = cellText(ws.getRow(r).getCell(3));
    const note = cellText(ws.getRow(r).getCell(4));
    records.push({ 터널명: TUNNEL, 일자: 날짜raw.toISOString().slice(0, 10), 제목: `${YM} 전력사용량`, 'MAIN(kWh)': Number(main), '조명용(kWh)': Number(light), 비고: note || '' });
  }
  out.power = records;
  console.log(`[전력사용량] ${records.length}건`);
}

// ===== 6. 업무처리사항 =====
{
  const ws = wb.getWorksheet('업무처리사항');
  const records = [];
  let lastDate = null;
  for (let r = 4; r <= ws.rowCount; r++) {
    const 날짜raw = ws.getRow(r).getCell(1).value;
    const 업무내용 = cellText(ws.getRow(r).getCell(2));
    if (!업무내용) continue;
    if (날짜raw instanceof Date) lastDate = 날짜raw.toISOString().slice(0, 10);
    else if (typeof 날짜raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(날짜raw)) lastDate = 날짜raw;
    const 조치사항 = cellText(ws.getRow(r).getCell(3));
    const 업체명 = cellText(ws.getRow(r).getCell(4));
    const 비고 = cellText(ws.getRow(r).getCell(5));
    records.push({ 터널명: TUNNEL, 날짜: lastDate, 제목: `${YM} 업무처리사항`, 업무내용, 조치사항, 업체명, 비고 });
  }
  out.task = records;
  console.log(`[업무처리] ${records.length}건`);
  records.forEach(r => console.log('  ', JSON.stringify(r)));
}

fs.writeFileSync('scripts/_tmp_heunghae_july_extracted.json', JSON.stringify(out, null, 2), 'utf8');
console.log('\n저장: scripts/_tmp_heunghae_july_extracted.json');
