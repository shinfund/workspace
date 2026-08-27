// 라운드넘버 stock-portal 앱 — "최근신호"(p0-ks)·"예상종목"(p1-ks) 탭을 오늘 장마감 기준으로
// 완전히 재생성해 apps/stock-portal/stock-roundnumber.html에 스플라이스한다(2026-08-26).
// project_roundnumber_recent_trades.mjs/project_roundnumber_recent_signals.mjs는 콘솔 출력만 하고
// 파일을 쓰지 않아 두 탭이 갱신되지 않는 구조적 공백이 있었음 — 이 스크립트가 그 공백을 메운다.
// 스캔 로직(detectRoundSignals/simulateLive/watchLevel 탐색)은 두 스크립트와 100% 동일(확정 파라미터).
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const HTML_PATH = 'C:\\Users\\shinf\\workspace\\apps\\stock-portal\\stock-roundnumber.html';

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const WINDOW_DAYS = 150, TARGET_TICKS = 30, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5, MIN_TOUCHES = 3;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 3, MAX_HOLD = 60, CALENDAR_DAYS = 2555, MIN_ENTRY_POSITION_PCT = 20, MIN_BAND_WIDTH_PCT = 2.5;
const RECENT_DAYS = 45, TOP_CHART_N = 10, PRE_ENTRY_PADDING = 16, NEAR_THRESHOLD_PCT = 0.5;

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
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
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

// 베타(KOSPI상관) — project_portfolio3_entry_scan.mjs의 슬롯부족 타이브레이커와 동일한 계산식, 여기선 참고표시 전용.
function computeBetaVsSeries(closes, dates, kospiRetByDate) {
  const rets = [], kospiRets = [];
  for (let i = 1; i < dates.length; i++) {
    if (closes[i] == null || closes[i - 1] == null) continue;
    const kr = kospiRetByDate.get(dates[i]); if (kr == null) continue;
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100); kospiRets.push(kr);
  }
  if (rets.length < 30) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const mR = mean(rets), mK = mean(kospiRets);
  let cov = 0, varK = 0;
  for (let i = 0; i < rets.length; i++) { cov += (rets[i] - mR) * (kospiRets[i] - mK); varK += (kospiRets[i] - mK) ** 2; }
  return varK ? cov / varK : null;
}
async function fetchKospiRetMap(p1, p2) {
  const chart = await fetchYahooChart('^KS11', p1, p2);
  if (!chart || !chart.ts.length) return new Map();
  const dates = chart.ts.map(tsToKstDate);
  const map = new Map();
  for (let i = 1; i < dates.length; i++) {
    if (chart.close[i] == null || chart.close[i - 1] == null) continue;
    map.set(dates[i], (chart.close[i] - chart.close[i - 1]) / chart.close[i - 1] * 100);
  }
  return map;
}
function fmtBeta(b) { return b != null ? b.toFixed(2) : '─'; }

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
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) {
    if (highs[k] > hi) hi = highs[k];
    if (lows[k] < low) low = lows[k];
  }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}

function detectRoundSignals(seq, highs, lows) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, WINDOW_DAYS, TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    if (step / L * 100 < MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, i - 1 - RECENT_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (touch < MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RECLAIM_WINDOW); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        if (seq[f].close < L + step) {
          const entryPosition = (seq[f].close - L) / step * 100;
          if (entryPosition >= MIN_ENTRY_POSITION_PCT) events.push({ entryIdx: f, level: L, step, touchCount: touch, aboveCount, entryPosition });
        }
        break;
      }
    }
  }
  return events;
}
function simulateLive(seq, ev, latestIdx) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - STOP_BUFFER_PCT / 100);
  for (let d = 1; d <= MAX_HOLD; d++) {
    const j = i0 + d;
    if (j > latestIdx) {
      const cur = seq[latestIdx].close;
      return { status: 'OPEN', day: latestIdx - i0, ret: (cur - entry) / entry * 100, curClose: cur, curDate: seq[latestIdx].date };
    }
    const close = seq[j].close;
    if (close <= stop) return { status: 'STOP', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
    if (close >= target) return { status: 'TP', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
    if (d === MAX_HOLD) return { status: 'TIME', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
  }
  return null;
}

async function scanTradesStock(stock, cutoffDate, kospiRetByDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    seq.push({ date: dates[i], close: chart.close[i] });
    highs.push(chart.high[i] ?? chart.close[i]);
    lows.push(chart.low[i] ?? chart.close[i]);
  }
  const n = seq.length;
  if (n < WINDOW_DAYS + RECENT_LOOKBACK + 10) return { ...stock, error: '데이터 부족' };

  const beta = computeBetaVsSeries(seq.map(s => s.close), seq.map(s => s.date), kospiRetByDate);
  const events = detectRoundSignals(seq, highs, lows);
  const latestIdx = n - 1;
  const recentTrades = [];
  for (const ev of events) {
    if (seq[ev.entryIdx].date < cutoffDate) continue;
    const res = simulateLive(seq, ev, latestIdx);
    if (res) recentTrades.push({ name: stock.name, code: stock.code, beta, entryIdx: ev.entryIdx, entryDate: seq[ev.entryIdx].date, entryPrice: seq[ev.entryIdx].close, level: ev.level, step: ev.step, touchCount: ev.touchCount, aboveCount: ev.aboveCount, seq, latestIdx, ...res });
  }
  return { ...stock, recentTrades };
}

async function scanCandidateStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - Math.round((WINDOW_DAYS + RECENT_LOOKBACK + 30) * 1.6) * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const seq = [], closes = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    seq.push({ date: dates[i], close: chart.close[i] });
    closes.push(chart.close[i]);
    highs.push(chart.high[i] ?? chart.close[i]);
    lows.push(chart.low[i] ?? chart.close[i]);
  }
  const n = closes.length;
  if (n < WINDOW_DAYS + RECENT_LOOKBACK + 10) return { ...stock, error: '데이터 부족' };

  const i = n - 1;
  const price = closes[i];
  const step = computeStepAt(highs, lows, i, WINDOW_DAYS, TARGET_TICKS);
  if (!step) return { ...stock, error: 'step 계산 실패' };

  const lo0 = Math.max(0, i - RECENT_LOOKBACK);
  let watchLevel = null;
  for (let L = Math.floor(price / step) * step; L > 0 && (price - L) / price < 0.3; L -= step) {
    let aboveCount = 0;
    for (let k = lo0; k < i; k++) if (closes[k] >= L) aboveCount++;
    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (aboveCount >= PRIOR_ABOVE_DAYS && touch >= MIN_TOUCHES) { watchLevel = { level: L, aboveCount, touch }; break; }
  }
  if (!watchLevel) return { ...stock, price, step, watchLevel: null };

  const distPct = (price - watchLevel.level) / price * 100;
  const tp = watchLevel.level + step;
  const stop = watchLevel.level * (1 - STOP_BUFFER_PCT / 100);
  return { ...stock, price, step, watchLevel: watchLevel.level, distPct, aboveCount: watchLevel.aboveCount, touch: watchLevel.touch, tp, stop, seq: seq.slice(Math.max(0, n - WINDOW_DAYS), n) };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function retClass(n) { return n > 0 ? 't-pos' : n < 0 ? 't-neg' : 't-flat'; }

function buildTradeChartSvg(rows, entryLocalIdx, refLines, entryPriceVal) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [...rows.map(r => r.close), ...refLines.map(l => l.value), entryPriceVal];
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  let svg = '';
  for (const l of refLines) {
    svg += `<line x1="${x0}" y1="${yAt(l.value).toFixed(1)}" x2="${x1}" y2="${yAt(l.value).toFixed(1)}" stroke="var(--${l.color})" stroke-width="${l.width}" stroke-dasharray="${l.dash}"/>`;
  }
  svg += `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.close).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--txt)" stroke-width="1.7"/>`;
  svg += `<line x1="${x0}" y1="${yAt(entryPriceVal).toFixed(1)}" x2="${x1}" y2="${yAt(entryPriceVal).toFixed(1)}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
  const ex = xAt(Math.min(entryLocalIdx, n - 1)).toFixed(1);
  svg += `<line x1="${ex}" y1="12" x2="${ex}" y2="208" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
  svg += `<circle cx="${ex}" cy="${yAt(entryPriceVal).toFixed(1)}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}
function buildWatchChartSvg(rows, refLines) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [...rows.map(r => r.close), ...refLines.map(l => l.value)];
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  let svg = '';
  for (const l of refLines) {
    svg += `<line x1="${x0}" y1="${yAt(l.value).toFixed(1)}" x2="${x1}" y2="${yAt(l.value).toFixed(1)}" stroke="var(--${l.color})" stroke-width="${l.width}" stroke-dasharray="${l.dash}"/>`;
  }
  svg += `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.close).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--txt)" stroke-width="1.7"/>`;
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function statusBadge(t) {
  if (t.status === 'OPEN') return `<span class="badge bdg-teal">보유중 D+${t.day}</span>`;
  if (t.status === 'TP') return `<span class="badge bdg-sky">TP익절</span>`;
  if (t.status === 'STOP') return `<span class="badge bdg-red">STOP손절</span>`;
  return `<span class="badge bdg-purple">시간청산</span>`;
}
function tradeRowHtml(t) {
  const tp = t.level + t.step, stop = t.level * (1 - STOP_BUFFER_PCT / 100);
  const curPrice = t.curClose ?? t.entryPrice * (1 + t.ret / 100);
  return `<tr><td class="l">${t.entryDate}</td><td class="l">${esc(t.name)}</td><td>${fmtWon(curPrice)}</td><td>${fmtWon(t.entryPrice)}</td><td>${fmtWon(t.level)}</td><td>${fmtWon(tp)}</td><td>${fmtWon(stop)}</td><td class="c">${t.aboveCount}/20일</td><td class="c">${t.touchCount}봉</td><td class="c">${fmtBeta(t.beta)}</td><td class="l">${statusBadge(t)}</td><td class="${retClass(t.ret)}">${fmtPct(t.ret)}</td></tr>`;
}
function tradeChartCardHtml(t) {
  const tp = t.level + t.step, stop = t.level * (1 - STOP_BUFFER_PCT / 100);
  const startIdx = Math.max(0, t.entryIdx - PRE_ENTRY_PADDING);
  const rows = t.seq.slice(startIdx, t.latestIdx + 1);
  const entryLocalIdx = t.entryIdx - startIdx;
  const svg = buildTradeChartSvg(rows, entryLocalIdx, [
    { value: t.level, color: 'amber', dash: '6,3', width: 1.8 },
    { value: tp, color: 'sky', dash: '6,3', width: 1.8 },
    { value: stop, color: 'coral', dash: '2,2', width: 1.3 },
  ], t.entryPrice);
  const curPrice = t.curClose ?? t.entryPrice * (1 + t.ret / 100);
  const betaHtml = `<span class="badge bdg-purple">베타 ${fmtBeta(t.beta)}</span>`;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(t.name)}</span>${betaHtml}${statusBadge(t)}&nbsp;<span style="color:var(--txt3);font-size:12.5px">${t.entryDate}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입가 <span>${fmtWon(t.entryPrice)}</span> <span class="sep">|</span> 현재가 <span>${fmtWon(curPrice)}</span> <span class="sep">|</span> 수익률 <span class="${retClass(t.ret)}">${fmtPct(t.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>레벨(L) <span>${fmtWon(t.level)}</span> <span class="sep">|</span> TP <span>${fmtWon(tp)}</span> <span class="sep">|</span> STOP <span>${fmtWon(stop)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>지지일수 <span>${t.aboveCount}/20일</span> <span class="sep">|</span> 밀집도 <span>${t.touchCount}봉</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>레벨(L)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP</span><span><i class="dash" style="border-color:var(--coral)"></i>STOP</span><span><i style="background:var(--sky600)"></i>진입가</span></div>
      </div>`;
}
function watchRowHtml(r) {
  return `<tr><td class="l">${esc(r.name)}</td><td>${fmtWon(r.price)}</td><td>${fmtWon(r.step)}</td><td>${fmtWon(r.watchLevel)}</td><td class="t-pos">${r.distPct.toFixed(1)}%</td><td class="c">${r.aboveCount}/20일</td><td class="c">${r.touch}봉</td><td>${fmtWon(r.tp)}</td><td>${fmtWon(r.stop)}</td></tr>`;
}
function watchChartCardHtml(r) {
  const svg = buildWatchChartSvg(r.seq, [
    { value: r.watchLevel, color: 'amber', dash: '6,3', width: 1.8 },
    { value: r.tp, color: 'sky', dash: '6,3', width: 1.8 },
    { value: r.stop, color: 'coral', dash: '2,2', width: 1.3 },
  ]);
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge bdg-amber">감시레벨 ${r.distPct.toFixed(1)}%</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(r.price)}</span> <span class="sep">|</span> 감시레벨(지지) <span>${fmtWon(r.watchLevel)}</span> <span class="sep">|</span> 거리 <span class="t-pos">${r.distPct.toFixed(1)}%</span></span>
        </div>
        <div class="chart-card-stats">
          <span>TP(저항) <span>${fmtWon(r.tp)}</span> <span class="sep">|</span> STOP(예상) <span>${fmtWon(r.stop)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>트랙레코드 <span>${r.aboveCount}/20일</span> <span class="sep">|</span> 밀집도 <span>${r.touch}봉</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>감시레벨(지지)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP(저항)</span><span><i class="dash" style="border-color:var(--coral)"></i>STOP(예상)</span></div>
      </div>`;
}

// startAnchor·endAnchor 둘 다 결과물에 그대로 유지하고, 그 사이만 newMiddle로 교체한다.
function spliceMiddle(html, startAnchor, endAnchor, newMiddle) {
  const startIdx = html.indexOf(startAnchor);
  if (startIdx < 0) throw new Error(`시작 앵커를 찾지 못함: ${startAnchor.slice(0, 80)}`);
  const midStart = startIdx + startAnchor.length;
  const endIdx = html.indexOf(endAnchor, midStart);
  if (endIdx < 0) throw new Error(`종료 앵커를 찾지 못함: ${endAnchor.slice(0, 80)}`);
  return html.slice(0, midStart) + newMiddle + html.slice(endIdx);
}

async function main() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  console.error(`[라운드넘버 탭 갱신] 기준일 ${todayStr}`);

  // ── 최근신호(트레이드) 스캔 ──
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const kospiRetByDate = await fetchKospiRetMap(p1, p2);
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const tradeResults = await batchAll(DEFAULT_STOCKS, s => scanTradesStock(s, cutoffDate, kospiRetByDate));
  const all = [];
  for (const r of tradeResults) { if (!r.error) all.push(...r.recentTrades); }

  const order = all.map((t, i) => i).sort((a, b) => {
    const dateCmp = all[b].entryDate.localeCompare(all[a].entryDate);
    if (dateCmp !== 0) return dateCmp;
    const ba = all[a].beta ?? -Infinity, bb = all[b].beta ?? -Infinity;
    if (ba !== bb) return bb - ba;
    return a - b;
  });

  const openCount = all.filter(t => t.status === 'OPEN').length;
  const closedTrades = all.filter(t => t.status !== 'OPEN');
  const closedWinRate = closedTrades.length ? Math.round(closedTrades.filter(t => t.status === 'TP').length / closedTrades.length * 100) : 0;
  console.error(`[최근신호] 총 ${all.length}건(보유중 ${openCount}, 청산 ${closedTrades.length}, 청산승률 ${closedWinRate}%)`);

  const tradeTableRows = order.map(i => tradeRowHtml(all[i])).join('\n          ');
  const tradeChartCards = order.slice(0, TOP_CHART_N).map(i => tradeChartCardHtml(all[i])).join('\n');

  // ── 예상종목(감시레벨 근접) 스캔 ──
  const candResults = await batchAll(DEFAULT_STOCKS, scanCandidateStock);
  const ok = candResults.filter(r => !r.error && r.watchLevel != null).sort((a, b) => a.distPct - b.distPct);
  const near = ok.filter(r => r.distPct <= NEAR_THRESHOLD_PCT);
  console.error(`[예상종목] 분석 ${DEFAULT_STOCKS.length}종목 중 ${near.length}종목 근접(${NEAR_THRESHOLD_PCT}%이내)`);

  const watchTableRows = near.map(watchRowHtml).join('\n          ');
  const watchChartCards = near.map(watchChartCardHtml).join('\n');

  // ── HTML 스플라이스 ──
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const nl = s => s.replace(/\n/g, eol);

  // p0 KPI
  html = spliceMiddle(html,
    `<div class="panel on" id="p0-ks">${eol}  <div class="kpi-row">${eol}    <div class="kpi-card kpi-sky"><div class="num">`, `</div><div class="lbl">최근45일 신호수`,
    `${all.length}`);
  html = spliceMiddle(html,
    `최근45일 신호수</div></div>${eol}    <div class="kpi-card kpi-teal"><div class="num">`, `</div><div class="lbl">현재 보유중`,
    `${openCount}`);
  html = spliceMiddle(html,
    `현재 보유중</div></div>${eol}    <div class="kpi-card kpi-amber"><div class="num">`, `</div><div class="lbl">청산완료`,
    `${closedTrades.length}`);
  html = spliceMiddle(html,
    `청산완료</div></div>${eol}    <div class="kpi-card kpi-purple"><div class="num">`, `%</div><div class="lbl">청산 승률`,
    `${closedWinRate}`);

  // p0 sc-note 날짜 문구 정리(⑥⑦ 필터는 이미 상시 적용된 상태이므로 전환 문구 제거)
  html = html.replace(
    /<b>이 표와 아래 차트는 [^<]*?장마감 기준 스냅샷으로[\s\S]*?<\/b> &mdash; 다음 장마감 갱신 때[\s\S]*?교체됩니다\./,
    `<b>이 표와 아래 차트는 ${todayStr} 장마감 기준입니다.</b>`
  );

  // p0 테이블 tbody(문서상 첫 <tbody>)
  html = spliceMiddle(html, `<tbody>${eol}`, `${eol}        </tbody>`, nl(tradeTableRows));

  // p0 차트카드
  html = spliceMiddle(html,
    `<div class="sc-title">최근신호 차트 <span class="sub">최신 10건</span></div>${eol}    <div class="chart-grid">${eol}`,
    `    </div>${eol}  </div>${eol}</div>${eol}${eol}<div class="panel" id="p1-ks">`,
    nl(tradeChartCards) + eol
  );

  // p1 KPI
  html = spliceMiddle(html,
    `<div class="panel" id="p1-ks">${eol}  <div class="kpi-row">${eol}    <div class="kpi-card kpi-sky"><div class="num">`, `</div><div class="lbl">분석 유니버스`,
    `${DEFAULT_STOCKS.length}`);
  html = spliceMiddle(html,
    `분석 유니버스(코스피TOP50)</div></div>${eol}    <div class="kpi-card kpi-teal"><div class="num">`, `</div><div class="lbl">감시레벨`,
    `${near.length}`);

  // p1 sc-note 날짜/개수 갱신
  html = html.replace(
    /\(2026-08-\d{2} 장마감 기준 \d+종목만 근접[^)]*\)/,
    `(${todayStr} 장마감 기준 ${near.length}종목만 근접 — 장중 다수 종목이 랠리로 레벨을 통과해 감시대상에서 이탈함)`
  );

  // p1 테이블 tbody(문서상 두 번째 <tbody>)
  {
    const firstTbodyEnd = html.indexOf('</tbody>') + '</tbody>'.length;
    const secondTbodyStart = html.indexOf('<tbody>', firstTbodyEnd);
    const secondTbodyContentStart = secondTbodyStart + '<tbody>'.length + eol.length;
    const secondTbodyEnd = html.indexOf(`${eol}        </tbody>`, secondTbodyContentStart);
    html = html.slice(0, secondTbodyContentStart) + nl(watchTableRows) + html.slice(secondTbodyEnd);
  }

  // p1 차트카드 부제(전체 N건) + 카드그리드
  html = html.replace(/<div class="sc-title">예상종목 차트 <span class="sub">감시레벨 0\.5%이내 전체 \d+건\(근접순\)<\/span><\/div>/,
    `<div class="sc-title">예상종목 차트 <span class="sub">감시레벨 0.5%이내 전체 ${near.length}건(근접순)</span></div>`);
  html = spliceMiddle(html,
    `<div class="sc-title">예상종목 차트 <span class="sub">감시레벨 0.5%이내 전체 ${near.length}건(근접순)</span></div>${eol}    <div class="chart-grid">${eol}`,
    `    </div>${eol}  </div>${eol}</div>${eol}${eol}<div class="panel" id="p2">`,
    nl(watchChartCards) + eol
  );

  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.error(`[저장완료] ${HTML_PATH}`);

  const openTags = (html.match(/<div\b/g) || []).length;
  const closeTags = (html.match(/<\/div>/g) || []).length;
  console.error(`[div 밸런스] open=${openTags} close=${closeTags} ${openTags === closeTags ? 'OK' : 'MISMATCH'}`);
}

main().catch(e => { console.error('오류:', e.message, e.stack); process.exit(1); });
