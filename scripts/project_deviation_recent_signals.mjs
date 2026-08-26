// 괴리율(역추세) 전략 — "최근신호" 탭용 라이브 데이터 생성 스크립트 (2026-08-12)
// project_deviation_tp20_exit_backtest.mjs(확정 진입·청산 로직)와 동일한 규칙을 사용하되, 각 진입 건의 "현재 상태"
// (청산완료: 최종 청산사유·경과일·가중수익률 / 보유중: 진행단계·경과일·현재 blended 수익률)를 산출해 JSON으로 출력한다.
// 진입: EMA5·EMA20 각각 롤링250일 Z<=-2 & 위치<=3%ile 동시충족(AND) + EMA50<EMA200(하락추세), rising edge
// 청산(2026-08-26 손절 -15%→-12% 재조정): ①-12%손절(최우선) ②+20%도달시 50%매도 ③이후 종가>=EMA20 시 잔량50%(전체25%)매도 ④이후 종가<EMA5 하향이탈 시 잔량전량매도 ⑤20거래일 시간청산
// 사용법: node scripts/project_deviation_recent_signals.mjs [--days 210]
import https from 'https';
import { fetchKrxUniverse, getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const KOSPI_SIZE = 50, KOSDAQ_SIZE = 20;

// KRX 조회 실패 시에만 사용하는 폴백 유니버스(2026-08-19 KRX 기준 스냅샷, ETF·우선주 제외)
// 2026-08-19: 기준선 앱과 동일하게 "최근신호" 탭을 코스피(KS)/코스닥(KQ) 2개로 분리하면서 유니버스도
// 통합랭킹(DEFAULT_STOCKS, 코스닥 알테오젠 1종목만 섞여있던 구조) 대신 코스피 전용 TOP50 / 코스닥
// 전용 TOP20으로 나눴다(진단 결과 기존 파라미터 그대로도 코스닥 성과가 코스피와 비슷하거나 우위였음).
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];

async function buildKospiUniverse() {
  try {
    const { kospi, basDt } = await fetchKrxUniverse();
    const top = kospi.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSPI_SIZE).map(s => ({ code: s.종목코드, name: s.종목명 }));
    console.error(`[유니버스] 코스피 시총 TOP${KOSPI_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스피 폴백 스냅샷 사용`);
    return FALLBACK_KOSPI;
  }
}
async function buildKosdaqUniverse() {
  try {
    const { kosdaq, basDt } = await fetchKrxUniverse();
    const top = kosdaq.sort((a, b) => b._mktcap - a._mktcap).slice(0, KOSDAQ_SIZE).map(s => ({ code: s.종목코드, name: s.종목명, market: 'KOSDAQ' }));
    console.error(`[유니버스] 코스닥 시총 TOP${KOSDAQ_SIZE} 산출 완료(기준일 ${basDt})`);
    return top;
  } catch (e) {
    console.error(`[유니버스] KRX 조회 실패(${e.message}) → 코스닥 폴백 스냅샷 사용`);
    return FALLBACK_KOSDAQ;
  }
}

const ROLL = 250, Z_THRESHOLD = -2, ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5, SLOW_PERIOD = 20, TREND_MID_PERIOD = 50, CHART_LONG_PERIOD = 100, TREND_LONG_PERIOD = 200;
const SL = 12, TP = 20, MAX_HOLD = 20; // 2026-08-26 손절 15→12 재조정 확정
const CALENDAR_DAYS = 1100;
const CHART_LEAD_DAYS = 10;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { recentDays: 210 };
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--days') o.recentDays = parseInt(argv[++i]);
  return o;
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
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function buildEma(closes, period) {
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }

async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      if (delay) await new Promise(r => setTimeout(r, delay));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function rollingZPct(seq, j, devKey) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r[devKey]);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j][devKey];
  const z = sd ? (v - m) / sd : 0;
  const pct = win.filter(d => d <= v).length / win.length * 100;
  return { z, pct };
}

// 청산완료(legs 전부 종결) 또는 보유중(데이터가 아직 진행되지 않음)을 모두 반환
function simulateLiveStatus(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0;
  let stage = 'INIT';
  const legs = [];
  const lastIdx = seq.length - 1;

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j > lastIdx) {
      const curClose = seq[lastIdx].close;
      const curRet = (curClose - entryClose) / entryClose * 100;
      const weightedSoFar = legs.reduce((a, l) => a + l.weight * l.ret, 0) + openWeight * curRet;
      return { status: 'OPEN', day: lastIdx - i0, ret: weightedSoFar, stage, legs };
    }
    const close = seq[j].close;
    const ema20 = seq[j].ema20, ema5 = seq[j].ema5;
    const ret = (close - entryClose) / entryClose * 100;

    if (ret <= -opts.sl) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d });
      openWeight = 0;
      break;
    }
    if (stage === 'INIT' && ret >= opts.tp) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'TP20', day: d });
      openWeight -= w;
      stage = 'TP20_DONE';
    }
    if (stage === 'TP20_DONE' && close >= ema20) {
      const w = openWeight * 0.5;
      legs.push({ weight: w, ret, reason: 'LEG20', day: d });
      openWeight -= w;
      stage = 'HOLD';
    }
    if (stage === 'HOLD' && close < ema5) {
      legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN', day: d });
      openWeight = 0;
      break;
    }
    if (d === opts.maxHold && openWeight > 1e-9) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d });
      openWeight = 0;
    }
  }
  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalLeg = legs[legs.length - 1];
  return { status: 'CLOSED', ret: weightedRet, legs, finalDay: finalLeg.day, finalReason: finalLeg.reason };
}

function kstTodayDate() { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
// 장중/장마감 직후 Yahoo 당일 종가 지연 보정용 KIS 당일 현재가 일괄조회(stock-baseline·stock-pullback과 동일 기법, [[feedback_price_cross_verify]])
async function fetchKisPriceMap(codes) {
  let token;
  try { token = await getKisToken(); } catch (e) {
    console.error(`[KIS] 토큰 실패: ${e.message} → 당일 종가는 Yahoo 값 사용`);
    return new Map();
  }
  const map = new Map();
  const BATCH = 5, DELAY_KIS = 200;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(c => fetchKisPrice(token, c)));
    batch.forEach((c, j) => { if (res[j] && res[j].현재가 > 0) map.set(c, res[j].현재가); });
    if (i + BATCH < codes.length) await new Promise(r => setTimeout(r, DELAY_KIS));
  }
  console.error(`[KIS] 당일 현재가 ${map.size}/${codes.length}종목 확보`);
  return map;
}

async function loadStockSignals(stock, opts, kisMap, todayDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null, entries: [] };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD);
  const ema100s = buildEma(closes, CHART_LONG_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema100: ema100s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100,
      dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100,
    });
  }
  if (seq.length < ROLL + 1) return { ...stock, error: '데이터 부족', seq: null, entries: [] };

  // 장중/장마감 직후 Yahoo 당일 종가가 지연 반영될 수 있어, 오늘 날짜 마지막 봉은 KIS 당일 현재가로 덮어쓴다
  const lastIdx = seq.length - 1;
  if (seq[lastIdx].date === todayDate && kisMap?.has(stock.code)) {
    const live = kisMap.get(stock.code);
    seq[lastIdx].close = live;
    seq[lastIdx].dev5 = (live - seq[lastIdx].ema5) / seq[lastIdx].ema5 * 100;
    seq[lastIdx].dev20 = (live - seq[lastIdx].ema20) / seq[lastIdx].ema20 * 100;
  }

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5');
    const z20 = rollingZPct(seq, i, 'dev20');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const sig20 = z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    flags[i] = sig5 && sig20 && downTrend;
  }
  const entries = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) {
      const z5 = rollingZPct(seq, i, 'dev5'), z20 = rollingZPct(seq, i, 'dev20');
      entries.push({ i, date: seq[i].date, zSum: z5.z + z20.z, pctSum: z5.pct + z20.pct });
    }
  }
  return { ...stock, seq, entries };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function retClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

// 상태(진행중/청산완료+사유)를 표·차트카드가 공유하는 배지·부연설명으로 변환
function statusInfo(row) {
  const legs = row.legs || [];
  const hasTP20 = legs.some(l => l.reason === 'TP20');
  const hasLEG20 = legs.some(l => l.reason === 'LEG20');
  let primary;
  if (row.status === 'OPEN') {
    primary = { cls: 'bdg-teal', label: '보유중' };
  } else {
    primary = {
      SL: { cls: 'bdg-red', label: '손절' },
      TIME: { cls: 'bdg-purple', label: '시간청산' },
      BREAKDOWN: { cls: 'bdg-gray', label: '5EMA이탈' },
    }[row.finalReason] || { cls: 'bdg-gray', label: row.finalReason };
  }
  const subBadges = (hasTP20 ? '<span class="badge bdg-sky">TP</span> ' : '') + (hasLEG20 ? '<span class="badge bdg-amber">LEG20</span> ' : '');
  let note = '';
  if (row.status === 'OPEN') {
    if (hasLEG20) note = '<span style="color:var(--txt3);font-size:12.5px">(2차익절완료(잔량25%))</span>';
    else if (hasTP20) note = '<span style="color:var(--txt3);font-size:12.5px">(익절대기(잔량50%))</span>';
    else note = '<span style="color:var(--txt3);font-size:12.5px">(익절대기(보유100%))</span>';
  }
  const day = row.status === 'OPEN' ? row.day : row.finalDay;
  return { primary, subBadges, note, day };
}

// 동시신호 우선순위(2026-08-26 확장 적용, project_3strategy_combined_portfolio_backtest.mjs와 동일 기준):
// 같은 날 진입 신호가 CAP건을 넘으면 EMA5·20 Z-score합asc·백분위합asc(더 과매도일수록 우선)로 1~CAP순위만
// 부여, 초과분은 "N순위 초과" 배지로 표시. CAP건 미만인 날짜는 배지 없음(round-number와 동일 규칙).
const PRIORITY_CAP = 3;
function assignPriority(rows) {
  const byDate = {};
  rows.forEach((r, i) => { (byDate[r.date] ||= []).push(i); });
  const priorityOf = new Array(rows.length).fill(null);
  for (const date in byDate) {
    const idxs = byDate[date];
    if (idxs.length < PRIORITY_CAP) continue;
    const sorted = [...idxs].sort((a, b) => (rows[a].zSum - rows[b].zSum) || (rows[a].pctSum - rows[b].pctSum));
    sorted.forEach((idx, pos) => { priorityOf[idx] = pos + 1; });
  }
  return priorityOf;
}
function priorityBadge(p) {
  if (p == null) return '';
  return p <= PRIORITY_CAP
    ? `<span class="badge bdg-purple">${p}순위</span>`
    : `<span class="badge bdg-coral" title="동시신호 ${PRIORITY_CAP}건 초과 — Z-score·백분위 우선순위 하위, 스킵 권장">${p}순위 초과</span>`;
}

function tableRowHtml(row, seq, priority) {
  const s = statusInfo(row);
  const statusCell = `<span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges ? ' ' + s.subBadges.trim() : ''}`;
  const noteCell = s.note ? s.note.trim() : '<span class="t-flat">&mdash;</span>';
  const curClose = seq[seq.length - 1].close;
  const prioCell = priority == null ? '<span class="t-flat">&mdash;</span>' : priorityBadge(priority);
  return `          <tr><td class="l">${row.date}</td><td class="l">${esc(row.name)}</td><td>${fmtV(curClose)}</td><td>${fmtV(row.entryClose)}</td><td class="c">${prioCell}</td><td class="l">${statusCell}</td><td class="c">D+${s.day}</td><td class="${retClass(row.ret)}">${fmt(row.ret)}</td><td class="l">${noteCell}</td></tr>`;
}

function buildChartSvg(rows) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema20, r.ema50, r.ema100));
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema100', 'gray600', '6,3', 1.3) + poly('ema50', 'teal', '6,3', 1.3) + poly('ema20', 'purple', '6,3', 1.4) + poly('ema5', 'sky', '6,3', 1.8);
  svg += poly('close', 'txt', null, 1.7);
  const entryIdx = rows.findIndex(r => r.isEntry);
  if (entryIdx >= 0) {
    const entryY = yAt(rows[entryIdx].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
    svg += `<line x1="${xAt(entryIdx).toFixed(1)}" y1="${yTop}" x2="${xAt(entryIdx).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<circle cx="${xAt(entryIdx).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function chartCardHtml(row, seq, entryIdx, priority) {
  const windowStart = Math.max(0, entryIdx - CHART_LEAD_DAYS);
  const chartRows = seq.slice(windowStart, seq.length).map((r, k) => ({ ...r, isEntry: windowStart + k === entryIdx }));
  const svg = buildChartSvg(chartRows);
  const s = statusInfo(row);
  const cur = seq[seq.length - 1];
  const prioBadge = priority == null ? '' : priorityBadge(priority);
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(row.name)}</span>${prioBadge}<span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges.trim()}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입일 ${row.date} <span class="sep">|</span> 진입가 <span>${fmtV(row.entryClose)}</span> <span class="sep">|</span> 현재가 <span>${fmtV(cur.close)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>D+${s.day} <span class="sep">|</span> 수익률 <span class="${retClass(row.ret)}">${fmt(row.ret)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--purple)"></i>EMA20</span><span><i class="dash" style="border-color:var(--teal)"></i>EMA50</span><span><i class="dash" style="border-color:var(--gray600)"></i>EMA100</span><span><i style="background:var(--sky600)"></i>진입가</span><span><i style="background:var(--${s.primary.cls === 'bdg-red' ? 'red' : s.primary.cls === 'bdg-purple' ? 'purple' : s.primary.cls === 'bdg-teal' ? 'teal' : 'gray600'})"></i>상태 <span>${s.primary.label}</span></span></div>
      </div>`;
}

async function runMarket(universe, opts, cutoffDate, kisMap, todayDate) {
  const loaded = await batchAll(universe, s => loadStockSignals(s, opts, kisMap, todayDate));
  const valid = loaded.filter(r => !r.error && r.entries.length);
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const rows = [];
  const rowMeta = [];
  for (const r of valid) {
    for (const e of r.entries) {
      if (e.date < cutoffDate) continue;
      const status = simulateLiveStatus(r.seq, e.i, opts);
      rows.push({ date: e.date, name: r.name, code: r.code, entryClose: r.seq[e.i].close, zSum: e.zSum, pctSum: e.pctSum, ...status });
      rowMeta.push({ seq: r.seq, entryIdx: e.i });
    }
  }
  const priorityOf = assignPriority(rows);
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date < rows[b].date ? 1 : rows[a].date > rows[b].date ? -1 : 0);
  const sortedRows = order.map(i => rows[i]);
  const sortedMeta = order.map(i => rowMeta[i]);
  const sortedPriority = order.map(i => priorityOf[i]);

  const closed = sortedRows.filter(x => x.status === 'CLOSED');
  const open = sortedRows.filter(x => x.status === 'OPEN');
  const wins = closed.filter(x => x.ret > 0).length;

  const tableHtml = sortedRows.map((row, i) => tableRowHtml(row, sortedMeta[i].seq, sortedPriority[i])).join('\n');
  const chartCardsHtml = sortedRows.map((row, i) => chartCardHtml(row, sortedMeta[i].seq, sortedMeta[i].entryIdx, sortedPriority[i])).join('\n');

  return {
    tableHtml, chartCardsHtml,
    stats: { total: sortedRows.length, openCount: open.length, closedCount: closed.length, closedWinRate: closed.length ? (wins / closed.length * 100) : null, rows: sortedRows },
  };
}

async function main() {
  const opts = { ...parseArgs(), calendarDays: CALENDAR_DAYS, sl: SL, tp: TP, maxHold: MAX_HOLD };
  console.error(`[괴리율 최근신호 산출] recentDays=${opts.recentDays}`);

  const cutoffMs = Date.now() - opts.recentDays * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  const kospiUniverse = await buildKospiUniverse();
  const kosdaqUniverse = await buildKosdaqUniverse();
  console.error(`[괴리율] 코스피 ${kospiUniverse.length}종목 / 코스닥 ${kosdaqUniverse.length}종목 스캔 시작`);

  const todayDate = kstTodayDate();
  const allCodes = [...new Set([...kospiUniverse, ...kosdaqUniverse].map(s => s.code))];
  const kisMap = await fetchKisPriceMap(allCodes);

  const ks = await runMarket(kospiUniverse, opts, cutoffDate, kisMap, todayDate);
  const kq = await runMarket(kosdaqUniverse, opts, cutoffDate, kisMap, todayDate);

  const fs = await import('fs');
  fs.writeFileSync('recent_signals_table_ks.html', ks.tableHtml, 'utf-8');
  fs.writeFileSync('recent_signals_charts_ks.html', ks.chartCardsHtml, 'utf-8');
  fs.writeFileSync('recent_signals_table_kq.html', kq.tableHtml, 'utf-8');
  fs.writeFileSync('recent_signals_charts_kq.html', kq.chartCardsHtml, 'utf-8');
  console.error(`[산출완료] *_ks.html(코스피)·*_kq.html(코스닥) 각 2개, 총 4개 fragment 생성`);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), cutoffDate,
    kospi: ks.stats, kosdaq: kq.stats,
  }, null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
