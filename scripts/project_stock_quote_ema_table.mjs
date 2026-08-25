/**
 * project_stock_quote_ema_table.mjs — 개별종목 시세표 (5/200 EMA 괴리율 + 라운드지지/라운드저항 + 판단)
 *
 * 데이터 소스:
 *   KIS API       → 당일 현재가 실시간
 *   Yahoo Finance → EMA·라운드넘버 계산용 과거 종가/고가/저가(마지막날은 KIS 당일가로 덮어쓰기)
 *
 * 입력: TARGETS (개별종목 감시 리스트, 하단 기본값) 또는 CLI 인자 "코드:종목명,코드:종목명,..."
 * 출력: 터미널 표 — 종목명,현재가,등락률,200EMA(괴리율 %),라운드지지,라운드저항,판단
 *   (2026-08-24: 20/50/100EMA 컬럼 삭제, 판단 컬럼 추가 — 보유종목 시세표 judgeRow 규칙을 종목 신호용으로 재구성)
 *   (2026-08-24: 5EMA 표시 컬럼 삭제 — 판단 컬럼 로직(눌림목 매수 관심 판정)에는 계속 사용, 화면 표시만 제외)
 *   (2026-08-24: 라운드지지/저항 그리드를 200일/10틱(HTS축표시용)→150일/30틱(매매성과 기준 확정그리드)로
 *    교체 — 화면 지지/저항이 실제 전략 신호(TP/STOP 레벨)와 항상 일치하도록, project_holdings_quote_table.mjs와 동일 결정)
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
const EMA_PERIODS = [5, 200];
const WARMUP_DAYS = Math.max(...EMA_PERIODS) * 6;

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
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
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

const ROUND_WINDOW_DAYS = 150;   // 2026-08-25 150일/30틱으로 재환원(화면 판단컬럼이 실제 전략 TP/STOP과 항상 일치하도록)
const ROUND_TARGET_TICKS = 30;
const NICE_FAMILY = [1, 2, 2.5, 5, 10];

function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) {
    const dist = Math.abs(Math.log(norm) - Math.log(f));
    if (dist < bestDist) { bestDist = dist; best = f; }
  }
  return best * mag;
}
function computeVisibleStep(highs, lows) {
  const n = highs.length;
  const lo = Math.max(0, n - ROUND_WINDOW_DAYS);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k < n; k++) {
    if (highs[k] != null && highs[k] > hi) hi = highs[k];
    if (lows[k] != null && lows[k] < low) low = lows[k];
  }
  if (hi === -Infinity || low === Infinity) return null;
  return niceStep((hi - low) / ROUND_TARGET_TICKS);
}
function touchCount(highs, lows, step, level) {
  const n = highs.length;
  const lo = Math.max(0, n - ROUND_WINDOW_DAYS);
  let count = 0;
  for (let k = lo; k < n; k++) {
    if (highs[k] == null || lows[k] == null) continue;
    if (lows[k] <= level && level <= highs[k]) count++;
  }
  return count;
}
function nearestRoundLevels(highs, lows, price) {
  if (!price) return null;
  const step = computeVisibleStep(highs, lows);
  if (!step) return null;
  const support = Math.floor(price / step) * step;
  const resistance = support + step;
  return {
    support, resistance, step,
    supportDistPct: (price - support) / price * 100,
    resistanceDistPct: (resistance - price) / price * 100,
    supportTouch: touchCount(highs, lows, step, support),
    resistanceTouch: touchCount(highs, lows, step, resistance),
  };
}

function fmtWon(n) { return n != null ? Number(Math.round(n)).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) {
  if (n == null) return '─';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function fmtRound(level, distPct, touch) { return level != null ? `${fmtWon(level)}(${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%,${touch}봉)` : '─'; }

// 판단 컬럼(2026-08-24 추가): 5EMA(단기)·200EMA(추세)·라운드지지/저항 신호를 규칙기반으로 종합
// 우선순위: 지지이탈 > 과매도+지지근접(하락추세 저점매수 관심) > 상승추세 눌림(눌림목 매수 관심) > 저항근접 > 추세방향(홀딩/관망)
function judgeRow(r) {
  if (!r.round || r.현재가 == null) return '─';
  const supportDist = r.round.supportDistPct;     // 양수=지지 위(정상), 음수=지지 이탈
  const resistanceDist = r.round.resistanceDistPct; // 양수=저항 아래(정상, 값이 작을수록 저항 근접)
  const dev5 = r.dev[5], dev200 = r.dev[200];

  if (supportDist < 0) return '지지 이탈·주의';
  if (dev200 != null && dev200 < 0 && supportDist <= 3) return '저점매수 관심';
  if (dev200 != null && dev200 > 0 && dev5 != null && dev5 <= 0) return '눌림목 매수 관심';
  if (resistanceDist <= 3) return '저항 근접·관찰';
  if (dev200 != null && dev200 > 0) return '홀딩(상승추세)';
  if (dev200 != null && dev200 < 0) return '관망(하락추세)';
  return '관망';
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
    const highs = chart ? fillForward(chart.high) : [];
    const lows = chart ? fillForward(chart.low) : [];
    // 마지막 종가를 KIS 당일가로 덮어쓰기(장중·Yahoo 지연 오차 방지)
    if (현재가 && closes.length) closes[closes.length - 1] = 현재가;
    const round = highs.length ? nearestRoundLevels(highs, lows, 현재가) : null;

    const devByPeriod = {};
    for (const period of EMA_PERIODS) {
      const ema = closes.length >= period ? buildEma(closes, period) : null;
      devByPeriod[period] = (ema && 현재가) ? (현재가 - ema) / ema * 100 : null;
    }

    rows.push({ 종목명: h.종목명, 현재가, 등락률: kis?.등락률, dev: devByPeriod, round });
  }

  console.log('\n종목명\t\t현재가\t등락률\t200EMA\t라운드지지\t라운드저항\t판단');
  for (const r of rows) {
    const col200 = fmtPct(r.dev[200]);
    const 지지 = r.round ? fmtRound(r.round.support, -r.round.supportDistPct, r.round.supportTouch) : '─';
    const 저항 = r.round ? fmtRound(r.round.resistance, r.round.resistanceDistPct, r.round.resistanceTouch) : '─';
    console.log(`${r.종목명}\t${fmtWon(r.현재가)}\t${fmtPct(r.등락률)}\t${col200}\t${지지}\t${저항}\t${judgeRow(r)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
