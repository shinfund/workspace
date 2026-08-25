/**
 * project_holdings_quote_table.mjs — 보유종목 시세 표 (수익률 desc 정렬 + 200EMA 괴리율 + 라운드넘버 지지/저항)
 *
 * 데이터 소스:
 *   KIS API       → 당일 현재가 실시간
 *   Yahoo Finance → EMA200·라운드넘버 계산용 과거 종가(마지막날은 KIS 당일가로 덮어쓰기)
 *
 * 라운드넘버(피겨라운드) 지지/저항(2026-08-21 추가, 같은 날 재검증 후 축 스케일 로직 교체):
 * 처음엔 "가격 자릿수"만으로 라운드 단위를 정했으나(예: 28만원대→10만원 단위), 삼성전자·SK하이닉스
 * 실제 키움 HTS 차트(project_roundnumber_scale_research.mjs로 검증)와 대조한 결과 실제 축 간격은
 * 자릿수가 아니라 "화면에 보이는 최근 구간의 가격범위"로 정해짐을 확인 — 처음엔 HTS축 시각 일치용으로
 * "최근 200거래일 고가~저가 범위 ÷ 목표눈금10개"를 1/2/2.5/5/10 계열의 "보기 좋은 수"(niceStep,
 * D3.js 축 눈금 알고리즘과 동일 계열)로 반올림해 사용했으나, 2026-08-24 그리드 통일 결정으로
 * project_roundnumber_strategy_backtest.mjs가 실제 매매성과 기준 스윕으로 확정한 "최근150거래일
 * 고가~저가 범위 ÷ 목표눈금30개" 그리드로 교체 — 화면에 보이는 지지/저항이 실제 전략 신호(TP/STOP
 * 레벨)와 항상 일치하도록(축 시각 일치보다 신호 일관성 우선, 백테스트 비교 결과 승률59%vs50%로도 우위).
 * "봉수"(터치카운트)도 종가 근접이 아니라 그날 저가~고가(캔들 실제 움직임)가 그 레벨을 통과했는지로
 * 계산(project_roundnumber_strategy_backtest.mjs와 동일 로직).
 *
 * 입력: data/holdings.json
 * 출력: 터미널 표(수익률 내림차순) — 종목명·현재가·등락률·수익률·200EMA·라운드지지·라운드저항 7컬럼(2026-08-24 확정, 평균단가·보유수량·매입금액·평가손익 컬럼 제외)
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
const WARMUP_DAYS = EMA_PERIOD * 6;

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

const ROUND_WINDOW_DAYS = 200;   // 2026-08-25 200일/10틱으로 재변경
const ROUND_TARGET_TICKS = 10;
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
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function fmtRound(level, distPct, touch) { return level != null ? `${fmtWon(level)}(${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%,${touch}봉)` : '─'; }

// 판단 컬럼(2026-08-24 추가): 사용자 확정 매매기준(SL8%/TP10%, EMA200 추세필터, 라운드넘버 지지/저항) 재사용한 규칙기반 1줄 판정
// 우선순위: 손절검토(손실≤-8%) > 지지이탈(현재가<지지) > 익절고려(수익≥+10%) > 지지근접(0~3%) > 200EMA추세(위/아래)
function judgeRow(r) {
  if (r.손익률 == null) return '─';
  if (r.손익률 <= -8) return '손절 검토';
  const supportDist = r.round ? -r.round.supportDistPct : null; // 음수=지지 위, 양수=지지 이탈(현재가<지지)
  if (supportDist != null && supportDist > 0) return '지지 이탈·주의';
  if (r.손익률 >= 10) return '익절 고려';
  if (supportDist != null && supportDist >= -3) return '지지 근접';
  if (r.dev200 != null && r.dev200 > 0) return '홀딩(상승추세)';
  return '관망(추세약함)';
}

async function main() {
  const holdings = JSON.parse(fs.readFileSync('C:\\Users\\shinf\\workspace\\data\\holdings.json', 'utf8'));
  const token = await getKisToken();
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - WARMUP_DAYS * 24 * 3600;

  const rows = [];
  for (const h of holdings) {
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
    const ema200 = closes.length >= EMA_PERIOD ? buildEma(closes, EMA_PERIOD) : null;
    const dev200 = (ema200 && 현재가) ? (현재가 - ema200) / ema200 * 100 : null;
    const round = highs.length ? nearestRoundLevels(highs, lows, 현재가) : null;

    const 평가금액 = 현재가 != null ? 현재가 * h.보유수량 : null;
    const 매입금액 = h.평균단가 * h.보유수량;
    const 손익 = 평가금액 != null ? 평가금액 - 매입금액 : null;
    const 손익률 = 평가금액 != null ? (손익 / 매입금액) * 100 : null;

    rows.push({ ...h, 현재가, 등락률: kis?.등락률, 평가금액, 매입금액, 손익, 손익률, dev200, round });
  }

  rows.sort((a, b) => (b.손익률 ?? -Infinity) - (a.손익률 ?? -Infinity));

  console.log('\n종목명\t\t현재가\t등락률\t수익률\t200EMA\t라운드지지\t라운드저항\t판단');
  let 총매입 = 0, 총평가 = 0;
  for (const r of rows) {
    총매입 += r.매입금액;
    if (r.평가금액 != null) 총평가 += r.평가금액;
    console.log(
      `${r.종목명}\t${fmtWon(r.현재가)}\t${fmtPct(r.등락률)}\t${fmtPct(r.손익률)}\t${fmtPct(r.dev200)}\t${r.round ? fmtRound(r.round.support, -r.round.supportDistPct, r.round.supportTouch) : '─'}\t${r.round ? fmtRound(r.round.resistance, r.round.resistanceDistPct, r.round.resistanceTouch) : '─'}\t${judgeRow(r)}`
    );
  }
  const 총손익 = 총평가 - 총매입;
  const 총손익률 = (총손익 / 총매입) * 100;
  console.log(`\n합계\t\t\t\t${fmtPct(총손익률)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
