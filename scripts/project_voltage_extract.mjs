import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

// 청하터널(주) 한전 수전 전압 일보 xlsx → JSON 추출
// 사용법: node scripts/project_voltage_extract.mjs
// 원본 데이터 위치: Downloads/전력데이터_청하터널(주)/일보 (신규 일보 xlsx 추가 후 재실행)

const BASE = 'C:/Users/shinf/Downloads/전력데이터_청하터널(주)/일보';
const OUT_DIR = 'C:/Users/shinf/Workspace/data/전압분석';

// panel sheet map: P1=HV-104(주 인입), P5=LV-101(주 저압 대표), P12=HV-204(부 인입), P16=LV-201(부 저압 대표)
// 주전기실/부전기실은 완전히 별개의 한전 수전 계통 — 판넬명 '100'대=주전기실, '200'대=부전기실
const PANELS = {
  'HV104': 'P1',
  'LV101': 'P5',
  'HV204': 'P12',
  'LV201': 'P16',
};

const files = fs.readdirSync(BASE).filter(f => f.endsWith('.xlsx'));
const days = [];
let errCount = 0;

for (const f of files.sort()) {
  const m = f.match(/(\d{8})/);
  if (!m) continue;
  const dateStr = m[1];
  const date = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
  try {
    const wb = XLSX.readFile(path.join(BASE, f));
    const dayRec = { date, panels: {} };
    for (const [key, sheetName] of Object.entries(PANELS)) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      const rows = [];
      for (let i = 6; i <= 29; i++) {
        const row = data[i];
        if (!row || row[0] == null || typeof row[0] !== 'number') continue;
        const fracDay = row[0] % 1;
        const hour = Math.round(fracDay * 24);
        rows.push({
          h: hour,
          rs: row[2], st: row[3], tr: row[4],
          ir: row[5], is: row[6], it: row[7],
          kw: row[8], pf: row[9], hz: row[10],
        });
      }
      dayRec.panels[key] = rows;
    }
    days.push(dayRec);
  } catch (e) {
    errCount++;
    console.error('ERR', f, e.message);
  }
}

console.log('parsed days:', days.length, 'errors:', errCount);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'voltage_raw.json'), JSON.stringify(days));
console.log('saved', path.join(OUT_DIR, 'voltage_raw.json'));
