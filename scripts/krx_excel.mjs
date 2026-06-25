/**
 * krx_excel.mjs — KRX 거래대금 TOP10 날짜별 개별 Excel 생성 (6월 서식 + 열 너비 자동)
 *
 * Usage:
 *   node krx_excel.mjs YYYY MM   ← 연도·월 필수
 *
 * 예시:
 *   node krx_excel.mjs 2026 5    → 2026년 5월 전 거래일
 *   node krx_excel.mjs 2026 4    → 2026년 4월 전 거래일
 *
 * 저장 경로 (우선순위):
 *   1순위: C:\Users\shinf\Workspace\data\거래대금\YYYY년\MM월\거래대금_YYYYMMDD.xlsx
 *          — 년·월 폴더 없으면 자동 생성 (신규 월 포함)
 *   2순위: C:\Users\shinf\Workspace\data\거래대금\  (년/월 생성 실패 시)
 *   3순위: C:\Users\shinf\Downloads\               (거래대금 폴더 자체 없을 시)
 */

import https    from 'https';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const ExcelJS   = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));

const API_KEY  = '1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8';
const HOST     = 'apis.data.go.kr';
const PATH_API = '/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NUM_ROWS = 2000;
const TOP_N    = 10;

const SAVE_DIR_PRIMARY  = 'C:\\Users\\shinf\\Workspace\\data\\거래대금';
const SAVE_DIR_FALLBACK = 'C:\\Users\\shinf\\Downloads';

/**
 * 저장 경로 우선순위 결정
 * 1순위: 거래대금\YYYY년\MM월\  — 년·월 폴더 모두 없으면 자동 생성 (신규 월 포함)
 * 2순위: 거래대금\              — 년/월 폴더 생성 실패 시 (권한 오류 등)
 * 3순위: Downloads\            — 거래대금 폴더 자체 없을 시
 */
function resolveSaveDir(year, month) {
  const yearDir  = path.join(SAVE_DIR_PRIMARY, String(year) + '년');
  const monthDir = path.join(yearDir, String(month).padStart(2, '0') + '월');

  if (fs.existsSync(SAVE_DIR_PRIMARY)) {
    try {
      const yearNew  = !fs.existsSync(yearDir);
      const monthNew = !fs.existsSync(monthDir);
      fs.mkdirSync(monthDir, { recursive: true });
      if (yearNew)  console.log(`[폴더 생성] ${String(year)}년`);
      if (monthNew) console.log(`[폴더 생성] ${String(year)}년 / ${String(month).padStart(2,'0')}월`);
      return { dir: monthDir, tier: 1 };
    } catch(e) {
      console.warn(`[경고] 년/월 폴더 생성 실패 (${e.message}) → 거래대금 루트 저장`);
      return { dir: SAVE_DIR_PRIMARY, tier: 2 };
    }
  }

  console.warn('[경고] 거래대금 폴더 없음 → Downloads 저장');
  return { dir: SAVE_DIR_FALLBACK, tier: 3 };
}

// IBK 제거: IBK계열 ETF(130730 등)는 코드 범위 필터(133000-139999)로 이미 차단됨
// IBK기업은행(024110) 오필터 방지
const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|KOSEF|ARIRANG|SOL |ACE |TIMEFOLIO|PLUS |WON |FOCUS|SMART|TREX|파워|KTOP|KCGI|마이다스|RISE|ETF|QV)/;
function isEtfCode(n) {
  return (n>=69500&&n<=69999)||(n>=102000&&n<=102999)||(n>=114000&&n<=114999)||
         (n>=133000&&n<=139999)||(n>=160000&&n<=299999);
}
const PREF_RE = /우[BCbc]?$/;


// 컬럼 정의 (순서·서식 6월 기준, 너비는 자동 계산으로 대체)
const COLUMNS = [
  { key: '날짜',      header: '날짜',      numFmt: 'yyyy-mm-dd'            },
  { key: '순위',      header: '순위',      numFmt: 'General'               },
  { key: '시장',      header: '시장',      numFmt: 'General'               },
  { key: '종목코드',  header: '종목코드',  numFmt: '@'                     },
  { key: '종목명',    header: '종목명',    numFmt: 'General'               },
  { key: '상장주식수',header: '상장주식수',numFmt: '#,##0'                 },
  { key: '시가',      header: '시가',      numFmt: '#,##0'                 },
  { key: '고가',      header: '고가',      numFmt: '#,##0'                 },
  { key: '저가',      header: '저가',      numFmt: '#,##0'                 },
  { key: '종가',      header: '종가',      numFmt: '#,##0'                 },
  { key: '전일종가',  header: '전일종가',  numFmt: '#,##0'                 },
  { key: '전일대비',  header: '전일대비',  numFmt: '\\+#,##0;\\-#,##0;0'  },
  { key: '등락률',    header: '등락률',    numFmt: '0.00'                  },
  { key: '변동폭',    header: '변동폭',    numFmt: '#,##0'                 },
  { key: '거래량',    header: '거래량',    numFmt: '#,##0'                 },
  { key: '거래대금',  header: '거래대금',  numFmt: '#,##0'                 },
  { key: '시가총액',  header: '시가총액',  numFmt: '#,##0'                 },
  { key: '회전율',    header: '회전율',    numFmt: '0.00'                  },
];

// ── 열 너비 자동 계산 헬퍼 ────────────────────────────────────
// 한글은 2, ASCII는 1 로 환산한 표시 너비
function dispLen(str) {
  if (str === null || str === undefined) return 0;
  let len = 0;
  for (const ch of String(str)) {
    len += /[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿豈-﫿]/.test(ch) ? 2 : 1;
  }
  return len;
}

// 서식 적용 후 표시될 문자열 예측
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

// 모든 데이터 기준 열 너비 계산 (패딩 2 추가)
function calcWidths(rows) {
  const widths = COLUMNS.map(c => dispLen(c.header));
  for (const row of rows) {
    COLUMNS.forEach((col, i) => {
      const v = row[col.key];
      widths[i] = Math.max(widths[i], dispLen(fmtDisplay(v, col.numFmt)));
    });
  }
  return widths.map(w => w + 2);
}

// ── API ──────────────────────────────────────────────────────
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(new Error(`파싱실패: ${d.slice(0,200)}`)); } });
    }).on('error', rej);
  });
}

async function fetchAll(basDt) {
  const first = await get(`https://${HOST}${PATH_API}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=1&resultType=json&basDt=${basDt}`);
  const body  = first?.response?.body;
  const total = Number(body?.totalCount || 0);
  if (!total) return [];
  let items = body?.items?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  for (let p = 2; p <= Math.ceil(total / NUM_ROWS); p++) {
    const r = await get(`https://${HOST}${PATH_API}?serviceKey=${API_KEY}&numOfRows=${NUM_ROWS}&pageNo=${p}&resultType=json&basDt=${basDt}`);
    items = items.concat(r?.response?.body?.items?.item || []);
  }
  return items;
}

function buildTop20(items) {
  const map = new Map();
  for (const item of items) {
    const code = (item.srtnCd || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    const prev = map.get(code);
    if (!prev || Number(item.mrktTotAmt||0) > Number(prev.mrktTotAmt||0)) map.set(code, item);
  }
  const stocks = [];
  for (const item of map.values()) {
    const name = (item.itmsNm || '').trim();
    const code = (item.srtnCd || '').trim();
    const mkt  = (item.mrktCtg || '').trim().toUpperCase();
    if (ETF_RE.test(name) || isEtfCode(Number(code))) continue;
    if (PREF_RE.test(name) || code.endsWith('5')) continue;
    const 거래대금  = Number(item.trPrc      || 0);
    const 시가총액  = Number(item.mrktTotAmt || 0);
    if (!거래대금 && !시가총액) continue;
    const 상장주식수 = Number(item.lstgStCnt || 0);
    const 거래량    = Number(item.trqu   || 0);
    const 종가     = Number(item.clpr   || 0);
    const 시가     = Number(item.mkp    || 0);
    const 고가     = Number(item.hipr   || 0);
    const 저가     = Number(item.lopr   || 0);
    const 전일대비  = Number(item.vs     || 0);
    const 등락률   = Number(item.fltRt  || 0);
    const 회전율   = 상장주식수 > 0 ? 거래량 / 상장주식수 * 100 : 0;
    stocks.push({ mkt, code, name, 상장주식수, 시가, 고가, 저가, 종가, 전일대비, 등락률, 거래량, 거래대금, 시가총액, 회전율 });
  }
  stocks.sort((a, b) => b.거래대금 - a.거래대금);
  return stocks.slice(0, TOP_N);
}

// ── Excel 저장 ────────────────────────────────────────────────
async function saveOneDayExcel(basDt, stocks, saveDir) {
  const sheetNm = `${basDt.slice(4,6)}${basDt.slice(6,8)}`;
  const dateObj = new Date(
    parseInt(basDt.slice(0,4)),
    parseInt(basDt.slice(4,6)) - 1,
    parseInt(basDt.slice(6,8))
  );

  // 행 데이터 미리 구성 (너비 계산용)
  const rowDataList = stocks.map((st, i) => ({
    날짜:      dateObj,
    순위:      i + 1,
    시장:      st.mkt,
    종목코드:  st.code,
    종목명:    st.name,
    상장주식수: st.상장주식수,
    시가:      st.시가,
    고가:      st.고가,
    저가:      st.저가,
    종가:      st.종가,
    전일종가:  st.종가 - st.전일대비,
    전일대비:  st.전일대비,
    등락률:    st.등락률,
    변동폭:    st.고가 - st.저가,
    거래량:    st.거래량,
    거래대금:  st.거래대금,
    시가총액:  st.시가총액,
    회전율:    parseFloat(st.회전율.toFixed(2)),
  }));

  // 열 너비 자동 계산
  const widths = calcWidths(rowDataList);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetNm);

  ws.columns = COLUMNS.map((c, i) => ({
    key:    c.key,
    header: c.header,
    width:  widths[i],
    style:  { numFmt: c.numFmt },
  }));

  for (const rowData of rowDataList) {
    ws.addRow(rowData);
  }

  const outPath = path.join(saveDir, `거래대금_${basDt}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

function getWeekdays(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push(`${d.getFullYear()}${mm}${dd}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

async function main() {
  const argv  = process.argv.slice(2);
  const year  = parseInt(argv[0]);
  const month = parseInt(argv[1]);

  if (!year || !month || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    console.error('\n[오류] 연도와 월을 입력하세요.');
    console.error('사용법: node krx_excel.mjs YYYY MM');
    console.error('예시:   node krx_excel.mjs 2026 5\n');
    process.exit(1);
  }

  const { dir: saveDir, tier } = resolveSaveDir(year, month);
  const tierLabel = tier === 1 ? '년/월 폴더' : tier === 2 ? '거래대금 폴더 (년/월 생성 실패)' : 'Downloads (거래대금 폴더 없음)';
  console.log(`\n[KRX] ${year}년 ${month}월 거래대금 TOP${TOP_N} — 열 너비 자동 + 6월 서식`);
  console.log(`[경로] ${saveDir}  [${tierLabel}]\n`);

  const weekdays = getWeekdays(year, month);
  const saved    = [];
  const skipped  = [];

  for (const basDt of weekdays) {
    process.stdout.write(`  ${basDt} 조회중... `);
    try {
      const items = await fetchAll(basDt);
      if (!items.length) {
        console.log('휴장일 — 스킵');
        skipped.push(basDt);
        continue;
      }
      const stocks = buildTop20(items);
      await saveOneDayExcel(basDt, stocks, saveDir);
      saved.push(basDt);
      console.log(`저장 완료 (TOP ${stocks.length})`);
    } catch (e) {
      console.log(`오류: ${e.message} — 스킵`);
      skipped.push(basDt);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n──────────────────────────────────');
  console.log(`저장 완료: ${saved.length}일`);
  console.log(`휴장(스킵): ${skipped.length}일`);
  if (saved.length) {
    console.log('\n저장 파일:');
    saved.forEach(d => console.log(`  거래대금_${d}.xlsx`));
  }
  console.log(`\n[경로] ${saveDir}\n`);
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
