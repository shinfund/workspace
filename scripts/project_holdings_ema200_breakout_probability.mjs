/**
 * project_holdings_ema200_breakout_probability.mjs — 보유종목 200EMA 상향돌파 확률 분석
 *
 * 질문: "현재 200EMA 아래인 보유종목이, 앞으로 20/60/120/250거래일 안에 200EMA를 다시
 *       상향돌파할 확률이 얼마나 되는가?" 를 각 종목 자신의 과거 이력으로 실증 추정한다.
 *
 * 방법(종목별 개별 과거 분석 — 종목 간 특성이 달라 풀링하지 않음):
 *   1. 종목별 최대 가용 과거 종가로 200EMA·괴리율(dev200)·기준선 하회 여부 계산
 *   2. 과거 모든 "기준선 하회" 거래일 각각을 표본으로 삼아, 그 시점 이후 최초로
 *      종가가 200EMA 이상이 되는 날까지의 거래일수(daysToCross)를 계산
 *   3. 표본을 두 그룹으로 집계:
 *      A) 전체 하회구간 기준 — 괴리율 크기와 무관하게 하회 상태였던 모든 날
 *      B) 현재 괴리율구간 기준 — 오늘 dev200이 속한 구간(0~-5/-5~-10/-10~-15/-15~-20/-20↓)과
 *         같은 구간이었던 날만 (표본이 적으면 참고용으로만 표시)
 *   4. 각 그룹에서 수평선 h(20/60/120/250거래일) 안에 돌파했는지 여부로 확률 = 성공/표본
 *      (수평선만큼 데이터가 남지 않은 최근 표본은 우측절단 처리하여 표본에서 제외)
 *
 * 입력: data/holdings.json
 * 출력: 터미널 표(종목별 현재 상태 + 확률표)
 * Usage: node scripts/project_holdings_ema200_breakout_probability.mjs
 */
import https from 'https';
import fs    from 'fs';

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

const EMA_PERIOD = 200;
const CALENDAR_DAYS = 4400; // 최대 가용 과거(약 12년, 상장일 짧은 종목은 자동으로 줄어듦)
const HORIZONS = [20, 60, 120, 250];
const DEV_BUCKETS = [
  { lo: -5,        hi: 0,        label: '0%~-5%' },
  { lo: -10,       hi: -5,       label: '-5%~-10%' },
  { lo: -15,       hi: -10,      label: '-10%~-15%' },
  { lo: -20,       hi: -15,      label: '-15%~-20%' },
  { lo: -Infinity, hi: -20,      label: '-20% 이하' },
];

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
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
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

function buildEmaSeries(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) continue;
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
    emas[i] = ema;
  }
  return emas;
}

function fillForward(closes) {
  let last = null;
  return closes.map(c => { if (c != null) last = c; return c == null ? last : c; });
}

function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function bucketOf(dev) { return DEV_BUCKETS.find(b => dev > b.lo && dev <= b.hi) || DEV_BUCKETS[DEV_BUCKETS.length - 1]; }

// 하회일 인덱스 i에 대해, i 이후 최초로 종가>=EMA200이 되는 거래일까지의 거리(daysToCross)를
// O(n)에 계산: 뒤에서부터 "가장 가까운 상회일 인덱스"를 유지
function computeDaysToCross(seq) {
  const n = seq.length;
  const nextAboveIdx = new Array(n).fill(null);
  let nearest = null;
  for (let i = n - 1; i >= 0; i--) {
    if (seq[i].close >= seq[i].ema200) nearest = i;
    nextAboveIdx[i] = nearest;
  }
  return seq.map((r, i) => {
    if (!r.below) return null;
    const j = i + 1 < n ? nextAboveIdx[i + 1] : null;
    return j != null ? j - i : Infinity; // Infinity = 데이터 끝까지 미돌파
  });
}

// samples: [{dev, daysToCross}], horizon h → { p, n, success }
function probAtHorizon(samples, h, lastIdxOfEach, n) {
  let success = 0, denom = 0;
  for (const s of samples) {
    if (s.daysToCross <= h) { success++; denom++; }
    else if (s.remain >= h) { denom++; } // 성공 못했지만 관측창은 충분 → 실패로 카운트
    // else: 관측창 부족(우측절단) → 표본 제외
  }
  return { p: denom ? success / denom * 100 : null, n: denom, success };
}

async function analyzeStock(h) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;

  const token = await getKisToken();
  const [kis, chart] = await Promise.all([
    fetchKisPrice(token, h.종목코드),
    fetchChartAutoMarket(h.종목코드, p1, p2),
  ]);
  if (!chart || !chart.ts.length) return { ...h, error: '데이터 조회 실패' };

  let closes = fillForward(chart.close);
  const 현재가 = kis ? kis.현재가 : null;
  if (현재가 && closes.length) closes[closes.length - 1] = 현재가;

  const ema200s = buildEmaSeries(closes, EMA_PERIOD);
  const seq = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null || ema200s[i] == null) continue;
    const dev = (closes[i] - ema200s[i]) / ema200s[i] * 100;
    seq.push({ close: closes[i], ema200: ema200s[i], dev, below: closes[i] < ema200s[i] });
  }
  if (seq.length < EMA_PERIOD + 30) return { ...h, error: '데이터 부족' };

  const daysToCross = computeDaysToCross(seq);
  const n = seq.length;
  const belowSamples = [];
  for (let i = 0; i < n; i++) {
    if (!seq[i].below) continue;
    belowSamples.push({ dev: seq[i].dev, daysToCross: daysToCross[i], remain: n - 1 - i });
  }

  // 현재 상태
  let curStreak = 0;
  for (let i = n - 1; i >= 0 && seq[i].below; i--) curStreak++;
  const cur = seq[n - 1];
  const curBucket = cur.below ? bucketOf(cur.dev) : null;
  const sameBucketSamples = curBucket ? belowSamples.filter(s => s.dev > curBucket.lo && s.dev <= curBucket.hi) : [];

  const overall = {}, byBucket = {};
  for (const hz of HORIZONS) overall[hz] = probAtHorizon(belowSamples, hz);
  for (const hz of HORIZONS) byBucket[hz] = probAtHorizon(sameBucketSamples, hz);

  return {
    ...h, 현재가, dev200: cur.dev, below: cur.below, curStreak, curBucket,
    totalBelowDays: belowSamples.length, overall, byBucket, sampleYears: (n / 245).toFixed(1),
  };
}

async function main() {
  const holdings = JSON.parse(fs.readFileSync('C:\\Users\\shinf\\workspace\\data\\holdings.json', 'utf8'));
  console.error(`[분석] 보유종목 ${holdings.length}개 × 200EMA 상향돌파 확률(자기 과거이력 기반)...`);

  const results = [];
  for (const h of holdings) {
    results.push(await analyzeStock(h));
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n━━━ 보유종목 200EMA 상향돌파 확률 분석 ━━━');
  console.log('(각 종목 자신의 과거 이력 중 "200EMA 하회 상태였던 모든 날"을 표본으로, 이후 N거래일 안에 재상향돌파한 비율)\n');

  for (const r of results) {
    if (r.error) { console.log(`${r.종목명}: ${r.error}\n`); continue; }
    console.log(`■ ${r.종목명}  현재가 ${r.현재가?.toLocaleString('ko-KR')}원  200EMA괴리율 ${fmtPct(r.dev200)}  ${r.below ? `연속 하회 ${r.curStreak}거래일째` : '현재 상회 중'}  (표본기간 약 ${r.sampleYears}년, 하회일 총 ${r.totalBelowDays}일)`);
    if (!r.below) { console.log('  이미 200EMA 위에 있어 "상향돌파 확률" 대상 아님\n'); continue; }
    console.log(`  현재 괴리율구간: ${r.curBucket.label} (같은 구간 하회일 표본 ${probAtHorizon ? '' : ''}${r.byBucket[HORIZONS[0]].n}일 등)`);
    console.log('  수평선      전체하회구간기준(표본n)      현재구간기준(표본n)');
    for (const hz of HORIZONS) {
      const o = r.overall[hz], b = r.byBucket[hz];
      const oStr = o.p != null ? `${o.p.toFixed(0)}%(n=${o.n})` : '표본부족';
      const bStr = b.p != null ? `${b.p.toFixed(0)}%(n=${b.n})` : '표본부족';
      console.log(`  ${String(hz).padStart(3)}거래일    ${oStr.padEnd(24)}${bStr}`);
    }
    console.log('');
  }
  console.log('※ "현재구간기준"은 표본(n)이 적으면(대략 10일 미만) 참고용으로만 볼 것. 우측절단(최근 표본 중 수평선만큼 미래 데이터가 없는 경우)은 표본에서 제외.');
}

main().catch(e => { console.error(e); process.exit(1); });
