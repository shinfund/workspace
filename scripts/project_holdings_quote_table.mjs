/**
 * project_holdings_quote_table.mjs — 보유종목 현황표 (수익률 desc 정렬)
 *
 * 데이터 소스:
 *   KIS API       → 당일 현재가 실시간
 *   Yahoo Finance → EMA 계산용 과거 종가(마지막날은 KIS 당일가로 덮어쓰기)
 *
 * 입력: data/holdings.json
 * 출력: 터미널 표(수익률 내림차순) — 종목명·현재가·등락률·평가손익·수익률·매입금액·매입가·보유수량·보유비중 9컬럼(2026-08-26,
 *   EMA 괴리율 컬럼 전부 삭제, 평가손익을 등락률 바로 뒤로 이동, 손익금→평가손익·매입금→매입금액 컬럼명 변경, 매입가·보유수량·보유비중 신설.
 *   보유비중=평가금액/총평가금액)
 */
import https from 'https';
import fs    from 'fs';

const KIS_APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const KIS_APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const KIS_TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;

async function getKisToken() {
  try {
    const c = JSON.parse(fs.readFileSync(KIS_TOKEN_CACHE, 'utf8'));
    if (new Date(c.access_token_token_expired) > new Date(Date.now() + 60000)) return c.access_token;
  } catch { /* cache miss */ }
  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const res = JSON.parse(d);
          if (!res.access_token) return reject(new Error('KIS 토큰 실패'));
          fs.writeFileSync(KIS_TOKEN_CACHE, JSON.stringify(res));
          resolve(res.access_token);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function fetchKisPrice(token, code) {
  const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  return new Promise(resolve => {
    const req = https.request({
      hostname: KIS_HOST, port: KIS_PORT,
      path: `/uapi/domestic-stock/v1/quotations/inquire-price?${qs}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json', authorization: `Bearer ${token}`,
        appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET, tr_id: 'FHKST01010100', custtype: 'P',
      },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.rt_cd !== '0') return resolve(null);
          const o = j.output;
          resolve({ 현재가: Number(o.stck_prpr || 0), 등락률: Number(o.prdy_ctrt || 0) });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function kstTimeStr() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtWon(n) { return n != null ? Number(Math.round(n)).toLocaleString('ko-KR') : '─'; }
function fmtWonSigned(n) { return n != null ? `${n >= 0 ? '+' : ''}${Number(Math.round(n)).toLocaleString('ko-KR')}` : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function fmtPctPlain(n) { return n != null ? `${n.toFixed(2)}%` : '─'; }

async function main() {
  const holdings = JSON.parse(fs.readFileSync('C:\\Users\\shinf\\workspace\\data\\holdings.json', 'utf8'));
  const token = await getKisToken();

  const rows = [];
  for (const h of holdings) {
    const kis = await fetchKisPrice(token, h.종목코드);
    await new Promise(r => setTimeout(r, 150));

    const 현재가 = kis ? kis.현재가 : null;
    const 평가금액 = 현재가 != null ? 현재가 * h.보유수량 : null;
    const 매입금액 = h.평균단가 * h.보유수량;
    const 손익 = 평가금액 != null ? 평가금액 - 매입금액 : null;
    const 손익률 = 평가금액 != null ? (손익 / 매입금액) * 100 : null;

    rows.push({ ...h, 현재가, 등락률: kis?.등락률, 평가금액, 매입금액, 손익, 손익률 });
  }

  rows.sort((a, b) => (b.손익률 ?? -Infinity) - (a.손익률 ?? -Infinity));

  let 총매입 = 0, 총평가 = 0;
  for (const r of rows) {
    총매입 += r.매입금액;
    if (r.평가금액 != null) 총평가 += r.평가금액;
  }

  console.log('\n보유종목 현황표');
  console.log(`종목명\t\t현재가\t등락률\t평가손익\t수익률\t매입금액\t매입가\t보유수량\t보유비중`);
  for (const r of rows) {
    const 비중 = (r.평가금액 != null && 총평가 > 0) ? (r.평가금액 / 총평가) * 100 : null;
    console.log(`${r.종목명}\t${fmtWon(r.현재가)}\t${fmtPct(r.등락률)}\t${fmtWonSigned(r.손익)}\t${fmtPct(r.손익률)}\t${fmtWon(r.매입금액)}\t${fmtWon(r.평균단가)}\t${fmtWon(r.보유수량)}\t${fmtPctPlain(비중)}`);
  }
  const 총손익 = 총평가 - 총매입;
  const 총손익률 = (총손익 / 총매입) * 100;
  console.log(`\n합계\t\t\t${fmtWonSigned(총손익)}\t${fmtPct(총손익률)}\t${fmtWon(총매입)}\t\t\t${fmtPctPlain(총평가 > 0 ? 100 : null)}`);

  console.log(`\n[데이터 소스] 현재가·등락률: KIS API 실시간(${kstTimeStr()} 기준) / 평가손익·수익률·보유비중은 현재가 기준 즉시 계산, 매입가·보유수량은 holdings.json 스냅샷`);
}

main().catch(e => { console.error(e); process.exit(1); });
