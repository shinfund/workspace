/**
 * project_holdings_investor_flow.mjs — 종목별 투자자(개인·외국인·기관) 순매수 추이
 *
 * Usage:
 *   node project_holdings_investor_flow.mjs                  → 보유종목(holdings.json) 전체
 *   node project_holdings_investor_flow.mjs 005930 삼성전자   → 종목코드/종목명 지정(개별종목, 복수 가능)
 *
 * 데이터 소스: KIS API 종목별 투자자매매동향(inquire-investor)
 *   ※ 당일(장중) 데이터는 장마감 후 정산되어 익일 확정 — 오늘자는 항상 공란으로 반환됨.
 *      따라서 최근 확정된 3거래일만 표시.
 *   ※ 종목명으로 지정 시 holdings.json에 없으면 KRX 전종목 유니버스(kis_api.mjs)에서 이름→코드 조회.
 *
 * 입력: data/holdings.json (인자 없을 때만)
 * 출력: 터미널 표(종목별 최근 3거래일 개인/외국인/기관 순매수 금액, 백만원) + 자동 특이사항
 */
import https from 'https';
import fs    from 'fs';
import { fetchKrxUniverse } from './kis_api.mjs';

const KIS_APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const KIS_APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const KIS_TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;

const DISPLAY_DAYS = 3;

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

function fetchInvestor(token, code) {
  const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  return new Promise(resolve => {
    const req = https.request({
      hostname: KIS_HOST, port: KIS_PORT,
      path: `/uapi/domestic-stock/v1/quotations/inquire-investor?${qs}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json', authorization: `Bearer ${token}`,
        appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET, tr_id: 'FHKST01010900', custtype: 'P',
      },
    }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.rt_cd !== '0') return resolve([]);
          resolve(j.output || []);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function fmtDate(s) { return s ? `${s.slice(4,6)}/${s.slice(6,8)}` : '─'; }
function fmtMM(v) {
  const n = Number(v);
  if (v === '' || v == null || Number.isNaN(n)) return '─';
  return `${n >= 0 ? '+' : ''}${n.toLocaleString('ko-KR')}`;
}

// 최근 DISPLAY_DAYS일 확정 데이터 기준 자동 특이사항 산출
function buildHighlights(days) {
  const notes = [];
  const types = [
    { key: 'prsn_ntby_tr_pbmn', label: '개인' },
    { key: 'frgn_ntby_tr_pbmn', label: '외국인' },
    { key: 'orgn_ntby_tr_pbmn', label: '기관' },
  ];

  // 3일 연속 동일방향(순매수/순매도) 스트릭
  for (const t of types) {
    const vals = days.map(d => Number(d[t.key]));
    if (vals.length === DISPLAY_DAYS && vals.every(v => v > 0)) {
      notes.push(`${t.label} ${DISPLAY_DAYS}일 연속 순매수`);
    } else if (vals.length === DISPLAY_DAYS && vals.every(v => v < 0)) {
      notes.push(`${t.label} ${DISPLAY_DAYS}일 연속 순매도`);
    }
  }

  // 최근일 주도 수급(가장 큰 절대금액 투자자가 전체 순매매 규모의 절반 이상)
  if (days[0]) {
    const latest = types.map(t => ({ label: t.label, v: Number(days[0][t.key]) })).filter(x => !Number.isNaN(x.v));
    const totalAbs = latest.reduce((a, x) => a + Math.abs(x.v), 0);
    const top = latest.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    if (top && totalAbs > 0 && Math.abs(top.v) / totalAbs >= 0.5) {
      notes.push(`최근일(${fmtDate(days[0].stck_bsop_date)}) ${top.label} 주도 수급(${fmtMM(top.v)}백만)`);
    }
  }

  return notes;
}

async function resolveTargets(tokens, holdings) {
  const targets = [];
  let krxMap = null;
  const getKrxMap = async () => {
    if (krxMap) return krxMap;
    const { kospi, kosdaq } = await fetchKrxUniverse();
    const all = [...kospi, ...kosdaq];
    krxMap = {
      byCode: new Map(all.map(s => [s.종목코드, s.종목명])),
      byName: new Map(all.map(s => [s.종목명, s.종목코드])),
    };
    return krxMap;
  };

  for (const tok of tokens) {
    if (/^\d{6}$/.test(tok)) {
      const h = holdings.find(x => x.종목코드 === tok);
      if (h) { targets.push({ 종목코드: tok, 종목명: h.종목명 }); continue; }
      const map = await getKrxMap();
      targets.push({ 종목코드: tok, 종목명: map.byCode.get(tok) || tok });
    } else {
      const h = holdings.find(x => x.종목명 === tok);
      if (h) { targets.push({ 종목코드: h.종목코드, 종목명: h.종목명 }); continue; }
      const map = await getKrxMap();
      const code = map.byName.get(tok);
      if (!code) { console.error(`[경고] 종목명 "${tok}" 매칭 실패 — 건너뜀`); continue; }
      targets.push({ 종목코드: code, 종목명: tok });
    }
  }
  return targets;
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const holdings = JSON.parse(fs.readFileSync('C:\\Users\\shinf\\workspace\\data\\holdings.json', 'utf8'));
  const targets = args.length ? await resolveTargets(args, holdings) : holdings.map(h => ({ 종목코드: h.종목코드, 종목명: h.종목명 }));

  if (!targets.length) { console.error('[오류] 조회할 종목이 없습니다.'); process.exit(1); }

  const token = await getKisToken();

  const results = [];
  for (const t of targets) {
    const rows = await fetchInvestor(token, t.종목코드);
    await new Promise(r => setTimeout(r, 150));
    const confirmed = rows.filter(r => r.prsn_ntby_qty !== '').slice(0, DISPLAY_DAYS);
    results.push({ ...t, days: confirmed });
  }

  const latestConfirmed = results.find(r => r.days.length)?.days[0]?.stck_bsop_date;

  console.log(args.length ? '\n종목별 투자자별 순매수 추이' : '\n보유종목 투자자별 순매수 추이');
  console.log('종목명\t일자\t종가\t개인(백만)\t외국인(백만)\t기관(백만)');
  for (const r of results) {
    if (!r.days.length) { console.log(`${r.종목명}\t데이터없음`); continue; }
    r.days.forEach((d, i) => {
      const 종목명표시 = i === 0 ? r.종목명 : '';
      console.log(`${종목명표시}\t${fmtDate(d.stck_bsop_date)}\t${Number(d.stck_clpr).toLocaleString('ko-KR')}\t${fmtMM(d.prsn_ntby_tr_pbmn)}\t${fmtMM(d.frgn_ntby_tr_pbmn)}\t${fmtMM(d.orgn_ntby_tr_pbmn)}`);
    });
  }

  console.log('\n[특이사항]');
  let any = false;
  for (const r of results) {
    if (r.days.length < DISPLAY_DAYS) continue;
    const notes = buildHighlights(r.days);
    if (notes.length) { any = true; console.log(`- ${r.종목명}: ${notes.join(' / ')}`); }
  }
  if (!any) console.log('- 특이 흐름 없음');

  console.log(`\n[데이터 소스] KIS API 종목별 투자자매매동향(inquire-investor), 최근 확정일 ${fmtDate(latestConfirmed)} 기준 (당일 장중 수급은 장마감 후 정산되어 미제공)`);
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
