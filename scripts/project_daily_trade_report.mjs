/**
 * project_daily_trade_report.mjs — 당일매매DB 일자별 결과표
 *
 * 데이터 소스: Notion 당일매매DB (database_id 3c859c8c-9c0a-80ea-8bee-f8c263fbbd7c)
 *
 * 사용법:
 *   node scripts/project_daily_trade_report.mjs            # 오늘(시스템 날짜) 결과
 *   node scripts/project_daily_trade_report.mjs 2026-08-25
 *   node scripts/project_daily_trade_report.mjs 20260825
 */

import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TRADE_DB_ID   = '3c859c8c-9c0a-80ea-8bee-f8c263fbbd7c';

function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname, port: 443, path: opts.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    }, resp => {
      resp.setEncoding('utf8');
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}

function parseDateArg(arg) {
  if (!arg) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
  const m = arg.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) throw new Error(`날짜 형식 인식 실패: ${arg} (예: 2026-08-25 또는 20260825)`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function num(prop) {
  const v = prop?.number;
  return (v === null || v === undefined) ? null : v;
}

function fmt(n) {
  return n === null ? '-' : n.toLocaleString('ko-KR');
}

function fmtPct(n) {
  return n === null ? '-' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function fmtSigned(n) {
  return n === null ? '-' : `${n >= 0 ? '+' : ''}${n.toLocaleString('ko-KR')}`;
}

async function fetchTradesForDate(date) {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN 환경변수 없음');
  const data = await httpPostJson(
    `https://api.notion.com/v1/databases/${TRADE_DB_ID}/query`,
    {
      filter: { property: '날짜', date: { equals: date } },
      sorts: [{ property: '손익금액', direction: 'descending' }],
      page_size: 100,
    },
    { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
  );
  if (!data?.results) throw new Error(data?.message || '조회 실패');
  return data.results.map(p => {
    const props = p.properties;
    const buyAvg  = num(props['금일매수평균가']);
    const buyQty  = num(props['금일매수수량']);
    const sellAvg = num(props['금일매도평균가']);
    const sellQty = num(props['금일매도수량']);
    let 구분;
    if (buyQty && sellQty) 구분 = '매수+매도';
    else if (buyQty) 구분 = '매수';
    else if (sellQty) 구분 = '매도';
    else 구분 = '-';
    const 수량 = buyQty && sellQty ? `${buyQty}/${sellQty}` : fmt(buyQty ?? sellQty);
    const 단가 = buyAvg && sellAvg ? `${fmt(buyAvg)}/${fmt(sellAvg)}` : fmt(buyAvg ?? sellAvg);
    return {
      종목명: props['종목명']?.title?.[0]?.plain_text || '',
      구분, 수량, 단가,
      손익금액: num(props['손익금액']),
      수익률:   num(props['수익률']),
    };
  });
}

async function main() {
  const date = parseDateArg(process.argv[2]);
  const rows = await fetchTradesForDate(date);
  console.log(`=== ${date} 당일매매 결과 ===`);
  if (!rows.length) { console.log('(해당 일자 매매 기록 없음)'); return; }
  console.log('종목명\t구분\t수량\t단가\t손익금액\t수익률');
  let total = 0;
  for (const r of rows) {
    console.log(`${r.종목명}\t${r.구분}\t${r.수량}\t${r.단가}\t${fmtSigned(r.손익금액)}\t${fmtPct(r.수익률)}`);
    if (r.손익금액 !== null) total += r.손익금액;
  }
  console.log(`합계\t\t\t\t${fmtSigned(total)}\t`);
}

main().catch(e => { console.error(`[오류] ${e.message}`); process.exit(1); });
