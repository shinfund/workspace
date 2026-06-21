import https from 'https';
import fs from 'fs';

const APP_KEY = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';

const token = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')).access_token;

function req(options) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    r.on('error', reject);
    r.end();
  });
}

const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '034020' });
const res = await req({
  hostname: 'openapi.koreainvestment.com', port: 9443,
  path: `/uapi/domestic-stock/v1/quotations/inquire-price?${qs}`,
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    authorization: `Bearer ${token}`,
    appkey: APP_KEY, appsecret: APP_SECRET,
    tr_id: 'FHKST01010100', custtype: 'P'
  }
});
console.log('rt_cd:', res.rt_cd, '/ msg:', res.msg1);
console.log('stck_prpr(현재가):', res.output?.stck_prpr);
console.log('acml_tr_pbmn(거래대금):', res.output?.acml_tr_pbmn);
console.log('acml_vol(거래량):', res.output?.acml_vol);
