// project_daily_trade_notion_upload.mjs
// 당일매매 엑셀(HTS export) → 노션 당일매매DB 업로드
// 사용: node scripts/project_daily_trade_notion_upload.mjs "C:/path/to/당일매매_YYYYMMDDHHmm.xlsx"

import ExcelJS from 'exceljs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = '3c859c8c-9c0a-80ea-8bee-f8c263fbbd7c';
const filePath = process.argv[2];

if (!filePath) {
  console.error('사용법: node scripts/project_daily_trade_notion_upload.mjs <xlsx경로>');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx <= 2) return; // 병합 헤더 2줄
    const v = row.values; // 1-indexed, v[0] undefined
    const dateRaw = v[1];
    const date = dateRaw instanceof Date
      ? dateRaw.toISOString().slice(0, 10)
      : String(dateRaw).slice(0, 10);
    rows.push({
      날짜: date,
      종목코드: String(v[2]),
      종목명: String(v[3]),
      금일매수평균가: v[4] ?? null,
      금일매수수량: v[5] ?? null,
      금일매입금액: v[6] ?? null,
      금일매도평균가: v[7] ?? null,
      금일매도수량: v[8] ?? null,
      금일매도금액: v[9] ?? null,
      수수료제세금: v[10] ?? null,
      손익금액: v[11] ?? null,
      수익률: v[12] ?? null,
      대출일: v[13] instanceof Date ? v[13].toISOString().slice(0, 10) : null,
      신용구분: v[14] || '현금잔고',
      이전매입가: v[15] ?? null,
    });
  });

  console.log(`[읽기] ${rows.length}건 (기준일: ${rows[0]?.날짜})`);

  const existing = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { property: '날짜', date: { equals: rows[0].날짜 } },
      page_size: 100,
    }),
  }).then(r => r.json());

  if (existing.results?.length > 0) {
    console.log(`[스킵] ${rows[0].날짜} 날짜 데이터 이미 ${existing.results.length}건 존재 — 업로드 중단`);
    return;
  }

  let ok = 0, fail = 0;
  for (const r of rows) {
    const props = {
      종목명: { title: [{ text: { content: r.종목명 } }] },
      종목코드: { rich_text: [{ text: { content: r.종목코드 } }] },
      날짜: { date: { start: r.날짜 } },
      금일매수평균가: { number: r.금일매수평균가 },
      금일매수수량: { number: r.금일매수수량 },
      금일매입금액: { number: r.금일매입금액 },
      금일매도평균가: { number: r.금일매도평균가 },
      금일매도수량: { number: r.금일매도수량 },
      금일매도금액: { number: r.금일매도금액 },
      수수료제세금: { number: r.수수료제세금 },
      손익금액: { number: r.손익금액 },
      수익률: { number: r.수익률 },
      신용구분: { select: { name: r.신용구분 } },
      이전매입가: { number: r.이전매입가 },
    };
    if (r.대출일) props.대출일 = { date: { start: r.대출일 } };

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
    }).then(r => r.json());

    if (res.id) { ok++; console.log(`[OK] ${r.종목명}(${r.종목코드}) 손익:${r.손익금액 ?? '-'} 수익률:${r.수익률 != null ? (r.수익률 * 100).toFixed(2) + '%' : '-'}`); }
    else { fail++; console.log(`[FAIL] ${r.종목명}: ${JSON.stringify(res).slice(0, 200)}`); }

    await sleep(350);
  }

  console.log(`\n완료 — 성공:${ok} 실패:${fail}`);
}

main();
