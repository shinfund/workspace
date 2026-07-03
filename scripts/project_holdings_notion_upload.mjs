// project_holdings_notion_upload.mjs
// 보유종목 엑셀(HTS export) → 노션 보유종목DB 업로드
// 사용: node project_holdings_notion_upload.mjs "C:/path/to/보유종목_YYYYMMDDHHmm.xlsx"

import ExcelJS from 'exceljs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';
const filePath = process.argv[2];

if (!filePath) {
  console.error('사용법: node project_holdings_notion_upload.mjs <xlsx경로>');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return; // header
    const v = row.values; // 1-indexed, v[0] undefined
    const dateRaw = v[1];
    const date = dateRaw instanceof Date
      ? dateRaw.toISOString().slice(0, 10)
      : String(dateRaw).slice(0, 10);
    rows.push({
      날짜: date,
      종목코드: String(v[2]),
      종목명: String(v[3]),
      현재가: v[4], 평가손익: v[5], 수익률: v[6], 매입금액: v[7],
      매입가: v[8], 보유수량: v[9], 가능수량: v[10], 보유비중: v[11],
      전일: v[12], 금일: v[13], 평가금액: v[14], 수수료: v[15], 세금: v[16],
      신용구분: v[17] || '현금잔고', 신용금액: v[20], 신용이자: v[21], 대출수량: v[22],
      손익분기매입가: v[23],
    });
  });

  console.log(`[읽기] ${rows.length}건 (기준일: ${rows[0]?.날짜})`);

  // 중복 체크: 동일 날짜+종목코드 기존 페이지 조회
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
      현재가: { number: r.현재가 ?? null },
      평가손익: { number: r.평가손익 ?? null },
      수익률: { number: r.수익률 ?? null },
      매입금액: { number: r.매입금액 ?? null },
      '매 입 가': { number: r.매입가 ?? null },
      보유수량: { number: r.보유수량 ?? null },
      가능수량: { number: r.가능수량 ?? null },
      보유비중: { number: r.보유비중 ?? null },
      전일: { number: r.전일 ?? null },
      금일: { number: r.금일 ?? null },
      평가금액: { number: r.평가금액 ?? null },
      수수료: { number: r.수수료 ?? null },
      세금: { number: r.세금 ?? null },
      신용구분: { select: { name: r.신용구분 } },
      신용금액: { number: r.신용금액 ?? null },
      신용이자: { number: r.신용이자 ?? null },
      대출수량: { number: r.대출수량 ?? null },
      손익분기매입가: { number: r.손익분기매입가 ?? null },
    };

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
    }).then(r => r.json());

    if (res.id) { ok++; console.log(`[OK] ${r.종목명}(${r.종목코드})`); }
    else { fail++; console.log(`[FAIL] ${r.종목명}: ${JSON.stringify(res).slice(0, 200)}`); }

    await sleep(350);
  }

  console.log(`\n완료 — 성공:${ok} 실패:${fail}`);
}

main();
