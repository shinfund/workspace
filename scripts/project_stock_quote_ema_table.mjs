/**
 * project_stock_quote_ema_table.mjs — 개별종목 시세표 (5/20/50/100/200 EMA 괴리율)
 *
 * 데이터 소스:
 *   KIS API       → 당일 현재가 실시간
 *   Yahoo Finance → EMA 계산용 과거 종가(마지막날은 KIS 당일가로 덮어쓰기)
 *
 * 입력: TARGETS (개별종목 감시 리스트, 하단 기본값) 또는 CLI 인자 "코드:종목명,코드:종목명,..."
 * 출력: 터미널 표 — 종목명,현재가,등락률,5EMA,20EMA,50EMA,100EMA,200EMA(각 EMA는 괴리율 %)
 *
 * Usage: node project_stock_quote_ema_table.mjs [코드:이름,코드:이름,...]
 */
import https from 'https';
import fs    from 'fs';

const DEFAULT_TARGETS = [
  { 종목코드: '005930', 종목명: '삼성전자' },
  { 종목코드: '000660', 종목명: 'SK하이닉스' },
];

function parseTargetsArg(arg) {
  if (!arg) return DEFAULT_TARGETS;
  return arg.split(',').map(pair => {
    const [종목코드, 종목명] = pair.split(':');
    return { 종목코드, 종목명: 종목명 || 종목코드 };
  });
}

const TARGETS = parseTargetsArg(process.argv[2]);

const KIS_APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const KIS_APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const KIS_TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};
const EMA_PERIODS = [5, 20, 50, 100, 200];
const WARMUP_DAYS = Math.max(...EMA_PERIODS) * 6;

const USE_COLOR = process.stdout.isTTY || process.env.FORCE_COLOR === '1';
const UP    = USE_COLOR ? '\x1b[31m' : ''; // 상향돌파: 빨강
const DOWN  = USE_COLOR ? '\x1b[34m' : ''; // 하향돌파: 파랑
const RESET = USE_COLOR ? '\x1b[0m'  : '';

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
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp?.length) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([
    fetchYahooChart(`${code}.KS`, p1, p2),
    fetchYahooChart(`${code}.KQ`, p1, p2),
  ]);
  const ksLen = ks?.ts?.length || 0;
  const kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return null;
  return ksLen >= kqLen ? ks : kq;
}

function buildEma(closes, period) {
  const k = 2 / (period + 1);
  let ema = null;
  const seedBuf = [];
  for (const price of closes) {
    if (price == null) continue;
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) continue;
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
  }
  return ema;
}

function fillForward(closes) {
  let last = null;
  return closes.map(c => { if (c != null) last = c; return c == null ? last : c; });
}

function fmtWon(n) { return n != null ? Number(Math.round(n)).toLocaleString('ko-KR') : '─'; }
function fmtPct(n, cross) {
  if (n == null) return '─';
  const s = `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  if (cross === 'up')   return `${UP}▲ ${s}${RESET}`;
  if (cross === 'down') return `${DOWN}▼ ${s}${RESET}`;
  return s;
}

async function main() {
  const token = await getKisToken();
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - WARMUP_DAYS * 24 * 3600;

  const rows = [];
  for (const h of TARGETS) {
    const [kis, chart] = await Promise.all([
      fetchKisPrice(token, h.종목코드),
      fetchChartAutoMarket(h.종목코드, p1, p2),
    ]);
    await new Promise(r => setTimeout(r, 150));

    const 현재가 = kis ? kis.현재가 : null;
    let closes = chart ? fillForward(chart.close) : [];
    // 마지막 종가를 KIS 당일가로 덮어쓰기(장중·Yahoo 지연 오차 방지)
    if (현재가 && closes.length) closes[closes.length - 1] = 현재가;

    const yestCloses = closes.slice(0, -1);
    const yestClose = closes.length >= 2 ? closes[closes.length - 2] : null;

    const devByPeriod = {};
    const crossByPeriod = {};
    for (const period of EMA_PERIODS) {
      const ema = closes.length >= period ? buildEma(closes, period) : null;
      const dev = (ema && 현재가) ? (현재가 - ema) / ema * 100 : null;
      devByPeriod[period] = dev;

      let cross = null;
      if (dev != null && yestClose != null && yestCloses.length >= period) {
        const yestEma = buildEma(yestCloses, period);
        const yestDev = yestEma ? (yestClose - yestEma) / yestEma * 100 : null;
        if (yestDev != null) {
          if (yestDev <= 0 && dev > 0) cross = 'up';
          else if (yestDev >= 0 && dev < 0) cross = 'down';
        }
      }
      crossByPeriod[period] = cross;
    }

    rows.push({ 종목명: h.종목명, 현재가, 등락률: kis?.등락률, dev: devByPeriod, cross: crossByPeriod });
  }

  console.log('\n종목명\t\t현재가\t등락률\t5EMA\t20EMA\t50EMA\t100EMA\t200EMA');
  for (const r of rows) {
    const cols = EMA_PERIODS.map(p => fmtPct(r.dev[p], r.cross[p])).join('\t');
    console.log(`${r.종목명}\t${fmtWon(r.현재가)}\t${fmtPct(r.등락률)}\t${cols}`);
  }
  console.log(`\n${UP}■${RESET} 당일 상향돌파   ${DOWN}■${RESET} 당일 하향돌파`);
}

main().catch(e => { console.error(e); process.exit(1); });
