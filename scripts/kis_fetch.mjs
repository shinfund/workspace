import https from 'https';
import fs from 'fs';

const APP_KEY = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const BASE = 'openapi.koreainvestment.com';
const PORT = 9443;

const ETF_RE = /^(KODEX|TIGER|KBSTAR|HANARO|SOL|PLUS|ACE|ARIRANG|RISE|KOSEF|KINDEX|TIMEFOLIO|KTOP|KB ETF|WOORI ETF)/;
const PREF_RE = /[가-힣]우[BC]?$/;

function kstNow() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hm = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  const dow = kst.getUTCDay();
  return { date: `${y}-${m}-${d}`, hm, dow };
}

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`JSON파싱실패[${res.statusCode}]: ${d.slice(0, 300)}`)); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function getToken() {
  if (fs.existsSync(TOKEN_CACHE)) {
    try {
      const c = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      if (new Date(c.access_token_token_expired) > new Date(Date.now() + 60000)) {
        console.error('[토큰] 캐시 사용');
        return c.access_token;
      }
    } catch {}
  }
  console.error('[토큰] 신규 발급...');
  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET });
  const res = await req({
    hostname: BASE, port: PORT, path: '/oauth2/tokenP', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!res.access_token) throw new Error(`토큰 실패: ${JSON.stringify(res)}`);
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify(res));
  return res.access_token;
}

async function fetchRank(token, iscd) {
  const mkt = iscd === '0000' ? 'KOSPI' : 'KOSDAQ';
  console.error(`[${mkt}] 거래량 순위 조회...`);
  const qs = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '20171',
    FID_INPUT_ISCD: iscd,
    FID_DIV_CLS_CODE: '0',
    FID_BLNG_CLS_CODE: '0',
    FID_TRGT_CLS_CODE: '111111111',
    FID_TRGT_EXLS_CLS_CODE: '0000000000',
    FID_INPUT_PRICE_1: '',
    FID_INPUT_PRICE_2: '',
    FID_VOL_CNT: '80',
    FID_INPUT_DATE_1: ''
  });
  const res = await req({
    hostname: BASE, port: PORT,
    path: `/uapi/domestic-stock/v1/quotations/volume-rank?${qs}`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: 'FHPST01710000',
      custtype: 'P'
    }
  });
  if (res.rt_cd !== '0') throw new Error(`[${mkt}] API 오류: ${res.msg1}`);
  console.error(`[${mkt}] ${(res.output || []).length}건 수신`);
  return res.output || [];
}

async function main() {
  const { date, hm, dow } = kstNow();
  if (dow === 0 || dow === 6) console.error(`⚠️ 주말(${dow === 0 ? '일' : '토'})입니다. 전 거래일 데이터일 수 있음.`);
  else if (hm < 1530) console.error(`⚠️ 장 중(${hm})입니다. 확정 종가가 아닐 수 있음.`);

  const token = await getToken();
  const [kospi, kosdaq] = await Promise.all([fetchRank(token, '0000'), fetchRank(token, '1001')]);

  const map = new Map();
  for (const item of [...kospi, ...kosdaq]) {
    const code = item.mksc_shrn_iscd || '';
    const name = (item.hts_kor_isnm || '').trim();
    const vol = Number(item.acml_tr_pbmn || 0);
    if (!/^\d{6}$/.test(code)) continue;
    if (ETF_RE.test(name)) continue;
    if (PREF_RE.test(name)) continue;
    if (vol === 0) continue;
    if (!map.has(code) || vol > Number(map.get(code).acml_tr_pbmn || 0)) map.set(code, item);
  }

  const top50 = [...map.values()]
    .sort((a, b) => Number(b.acml_tr_pbmn) - Number(a.acml_tr_pbmn))
    .slice(0, 50)
    .map((item, i) => ({
      순위: i + 1,
      날짜: date,
      종목코드: item.mksc_shrn_iscd,
      종목명: (item.hts_kor_isnm || '').trim(),
      종가: Number(item.stck_prpr || 0),
      등락률: Number(item.prdy_ctrt || 0),
      거래량: Number(item.acml_vol || 0),
      거래대금: Number(item.acml_tr_pbmn || 0)
    }));

  console.error(`\n✅ 최종 ${top50.length}건 추출 완료 (${date})`);
  console.log(JSON.stringify(top50, null, 2));
}

main().catch(e => { console.error('[오류]', e.message || e); console.error(e.stack); process.exit(1); });
