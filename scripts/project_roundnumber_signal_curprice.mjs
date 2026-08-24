// 라운드넘버 stock-portal 앱 — 최근신호(KS/KQ) 탭(p0-ks/p0-kq) 표에 "현재가" 컬럼을 "진입가" 컬럼
// 앞에 추가한다(2026-08-24). 기존 행(날짜/종목/진입가/레벨/TP/STOP/지지일수/밀집도/상태/수익률)은 전혀
// 건드리지 않고, 종목명 뒤에 현재가 <td>만 삽입한다 — 표에 이미 반영된 숫자를 재계산해 어긋나게 만들지
// 않기 위함(project_roundnumber_chart_cards.mjs와 동일 원칙).
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠' }, { code: '086520', name: '에코프로' }, { code: '247540', name: '에코프로비엠' }, { code: '277810', name: '레인보우로보틱스' }, { code: '036930', name: '주성엔지니어링' }, { code: '028300', name: 'HLB' }, { code: '240810', name: '원익IPS' }, { code: '058470', name: '리노공업' }, { code: '039030', name: '이오테크닉스' }, { code: '087010', name: '펩트론' }, { code: '298380', name: '에이비엘바이오' }, { code: '000250', name: '삼천당제약' }, { code: '141080', name: '리가켐바이오' }, { code: '222800', name: '심텍' }, { code: '214450', name: '파마리서치' }, { code: '108490', name: '로보티즈' }, { code: '319660', name: '피에스케이' }, { code: '095340', name: 'ISC' }, { code: '403870', name: 'HPSP' }, { code: '440110', name: '파두' },
];
const CODE_BY_NAME = new Map();
for (const s of FALLBACK_KOSPI) CODE_BY_NAME.set(s.name, { code: s.code, market: 'KOSPI' });
for (const s of FALLBACK_KOSDAQ) CODE_BY_NAME.set(s.name, { code: s.code, market: 'KOSDAQ' });

const HTML_PATH = 'C:\\Users\\shinf\\workspace\\apps\\stock-portal\\stock-roundnumber.html';

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchLatestClose(name) {
  const info = CODE_BY_NAME.get(name);
  if (!info) return null;
  const symbol = info.market === 'KOSDAQ' ? `${info.code}.KQ` : `${info.code}.KS`;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 20 * 24 * 3600;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null) return closes[i];
      return null;
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }

async function main() {
  let html = fs.readFileSync(HTML_PATH, 'utf8');

  // p0-ks/p0-kq 표에 등장하는 모든 종목명 수집(중복 제거)
  const rowRe = /<tr><td class="l">[^<]+<\/td><td class="l">([^<]+)<\/td><td>/g;
  const names = new Set();
  let mm;
  while ((mm = rowRe.exec(html))) names.add(mm[1]);
  console.error(`[대상 종목] ${names.size}개(최근신호 KS+KQ 표에 등장하는 전체 유니크 종목)`);

  const priceByName = new Map();
  let idx = 0;
  for (const name of names) {
    idx++;
    const close = await fetchLatestClose(name);
    priceByName.set(name, close);
    if (close == null) console.error(`[fetch실패] ${name}`);
    await new Promise(r => setTimeout(r, 150));
  }
  console.error(`[가격조회 완료] ${idx}건`);

  // 헤더에 "현재가" 컬럼 삽입(진입가 앞) — p0-ks/p0-kq 두 군데
  const headerOld = '<th class="l" style="width:9%">진입일</th><th class="l" style="width:13%">종목</th><th style="width:8%">진입가</th><th style="width:8%">레벨(L)</th><th style="width:8%">TP가</th><th style="width:8%">STOP가</th><th class="c" style="width:9%">지지일수</th><th class="c" style="width:7%">밀집도</th><th class="l" style="width:15%">상태</th><th style="width:9%">수익률</th>';
  const headerNew = '<th class="l" style="width:8%">진입일</th><th class="l" style="width:11%">종목</th><th style="width:8%">현재가</th><th style="width:7%">진입가</th><th style="width:7%">레벨(L)</th><th style="width:7%">TP가</th><th style="width:7%">STOP가</th><th class="c" style="width:8%">지지일수</th><th class="c" style="width:6%">밀집도</th><th class="l" style="width:13%">상태</th><th style="width:8%">수익률</th>';
  const headerCount = html.split(headerOld).length - 1;
  if (headerCount !== 2) throw new Error(`헤더 앵커 매치 개수 이상(${headerCount}, 2여야 함)`);
  html = html.split(headerOld).join(headerNew);

  // 각 행에 현재가 <td> 삽입
  let replaced = 0, missing = [];
  html = html.replace(/<tr><td class="l">([^<]+)<\/td><td class="l">([^<]+)<\/td><td>/g, (whole, date, name) => {
    const price = priceByName.get(name);
    if (price == null) missing.push(name);
    replaced++;
    return `<tr><td class="l">${date}</td><td class="l">${name}</td><td>${fmtWon(price)}</td><td>`;
  });
  console.error(`[행 갱신] ${replaced}건, 가격조회 실패로 '─' 처리된 행: ${missing.length}건${missing.length ? ' (' + [...new Set(missing)].join(', ') + ')' : ''}`);

  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.error(`[저장완료] ${HTML_PATH}`);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
