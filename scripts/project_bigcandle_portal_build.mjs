// 장대양봉(bigcandle) stock-portal 신규 앱(stock-bigcandle.html) 생성 (2026-09-02)
// stock-roundnumber.html의 CSS/JS 쉘·차트SVG 생성 방식(project_roundnumber_chart_cards.mjs의
// buildRoundnumberChartSvg)을 그대로 재사용해, 5개 탭(최근신호/예상종목/보유종목/매매전략/백테스트) 콘텐츠를
// 채운 완성 HTML을 조립한다. 최근신호·예상종목 표는 project_bigcandle_recent_signals.mjs·
// project_bigcandle_pending_setups.mjs와 동일 확정로직(2026-09-02 2차 가드수정 반영)을 이 파일 안에서
// 다시 계산해 표+차트 숫자를 100% 일치시킨다.
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
const BASE_PERIOD = 200;
const OPTS = { calendarDays: 2555, bodyPct: 5, retestWindow: 20, confirmWindow: 5, stopBufferPct: 0.5, maxHold: 15, requireUptrend: true };
const OUT_PATH = 'C:\\Users\\shinf\\Workspace\\apps\\stock-portal\\stock-bigcandle.html';

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
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
      return { ts: result.timestamp || [], open: q.open || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i]; if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else { ema = price * k + ema * (1 - k); }
    emas[i] = ema;
  }
  return emas;
}
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function num(s) { return typeof s === 'number' ? s : parseFloat(String(s).replace(/[,%]/g, '')); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// ── SVG 차트 (project_roundnumber_chart_cards.mjs의 buildRoundnumberChartSvg와 동일 산식) ──
function buildChartSvg(rows, refLines, markers) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [...rows.map(r => r.close), ...refLines.map(l => l.value)];
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  let svg = '';
  for (const l of refLines) svg += `<line x1="${x0}" y1="${yAt(l.value).toFixed(1)}" x2="${x1}" y2="${yAt(l.value).toFixed(1)}" stroke="var(--${l.color})" stroke-width="${l.width || 1.8}" stroke-dasharray="${l.dash}"/>`;
  svg += `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.close).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--txt)" stroke-width="1.7"/>`;
  if (markers?.entryIdx != null && markers.entryIdx >= 0 && markers.entryIdx < n) {
    const ei = markers.entryIdx;
    const entryY = yAt(rows[ei].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
    svg += `<line x1="${xAt(ei).toFixed(1)}" y1="${yTop}" x2="${xAt(ei).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<circle cx="${xAt(ei).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

// ── 확정로직(2026-09-02 2차 가드수정 반영) 재계산 ──
function detectRecentSignals(seq, opts) {
  const n = seq.length;
  const trades = [];
  for (let i = 0; i < n; i++) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;
    const mid = (o + c) / 2, candleLow = l, candleHigh = h;
    const stop = candleLow * (1 - opts.stopBufferPct / 100);
    let touchIdx = null;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) { if (seq[f].close < candleLow) break; if (seq[f].low <= mid) { touchIdx = f; break; } }
    if (touchIdx == null) continue;
    const touchHigh = seq[touchIdx].high;
    if (touchHigh >= candleHigh) continue;
    let entryIdx = null;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) { if (seq[c2].close < candleLow) break; if (seq[c2].close > touchHigh) { entryIdx = c2; break; } }
    if (entryIdx == null) continue;
    if (seq[entryIdx].close >= candleHigh) continue; // 2026-09-02 2차 가드
    const entryEma200 = seq[entryIdx].ema200;
    const uptrend = entryEma200 != null ? seq[entryIdx].close >= entryEma200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;
    const entryPrice = seq[entryIdx].close;
    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = { status: 'OPEN', day: d - 1, curClose: seq[n - 1].close }; break; }
      const close = seq[j].close;
      if (close <= stop) { result = { status: 'STOP', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
      if (close >= candleHigh) { result = { status: 'TP', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
      if (d === opts.maxHold) { result = { status: 'TIME', ret: (close - entryPrice) / entryPrice * 100, day: d, date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, candleDate: seq[i].date, touchDate: seq[touchIdx].date, entryDate: seq[entryIdx].date, entryIdx, entryPrice, candleHigh, candleLow, stop, ...result });
  }
  return trades;
}
function findPendingSetup(seq, opts) {
  const n = seq.length;
  let pending = null;
  for (let i = n - 1; i >= 0; i--) {
    const o = seq[i].open, c = seq[i].close, h = seq[i].high, l = seq[i].low;
    if (o == null || c == null || c <= o) continue;
    const bodyPct = (c - o) / o * 100;
    if (bodyPct < opts.bodyPct) continue;
    const mid = (o + c) / 2, candleLow = l, candleHigh = h;
    let touchIdx = null, brokenLow = false;
    for (let f = i + 1; f < Math.min(n, i + 1 + opts.retestWindow); f++) { if (seq[f].close < candleLow) { brokenLow = true; break; } if (seq[f].low <= mid) { touchIdx = f; break; } }
    const daysSinceCandle = n - 1 - i;
    if (touchIdx == null) {
      if (brokenLow) continue;
      if (daysSinceCandle > opts.retestWindow) continue;
      pending = { stage: 'AWAIT_TOUCH', candleIdx: i, candleDate: seq[i].date, candleHigh, candleLow, mid, daysWaiting: daysSinceCandle, windowLeft: opts.retestWindow - daysSinceCandle };
      break;
    }
    const touchHigh = seq[touchIdx].high;
    if (touchHigh >= candleHigh) continue;
    let entryIdx = null, brokenLow2 = false;
    for (let c2 = touchIdx; c2 < Math.min(n, touchIdx + opts.confirmWindow + 1); c2++) { if (seq[c2].close < candleLow) { brokenLow2 = true; break; } if (seq[c2].close > touchHigh) { entryIdx = c2; break; } }
    if (entryIdx != null) continue;
    if (brokenLow2) continue;
    const daysSinceTouch = n - 1 - touchIdx;
    if (daysSinceTouch > opts.confirmWindow) continue;
    pending = { stage: 'AWAIT_BREAKOUT', candleIdx: i, candleDate: seq[i].date, candleHigh, candleLow, touchIdx, touchDate: seq[touchIdx].date, touchHigh, daysWaiting: daysSinceTouch, windowLeft: opts.confirmWindow - daysSinceTouch };
    break;
  }
  return pending;
}

async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - OPTS.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || chart.open[i] == null) continue;
    seq.push({ date: dates[i], open: chart.open[i], close: closes[i], high: chart.high[i] ?? closes[i], low: chart.low[i] ?? closes[i], ema200: ema200s[i] ?? null, name: stock.name });
  }
  if (seq.length < BASE_PERIOD + 10) return { ...stock, error: '데이터 부족' };
  return { ...stock, seq };
}

function section(title, sub, note, tableHtml) {
  return `  <div class="sc">
    <div class="sc-title">${title} <span class="sub">${sub}</span></div>${note ? `\n    <div class="sc-note">${note}</div>` : ''}
    <div class="tbl-wrap">
${tableHtml}
    </div>
  </div>`;
}
function chartSection(title, sub, cardsHtml) {
  return `  <div class="sc">
    <div class="sc-title">${title} <span class="sub">${sub}</span></div>
    <div class="chart-grid">
${cardsHtml.join('\n')}
    </div>
  </div>`;
}

function signalCardHtml(t, chartRows) {
  const localEntryIdx = t.entryIdx - (t.chartStart);
  const svg = buildChartSvg(chartRows, [
    { value: t.candleHigh, color: 'sky', dash: '6,3', width: 1.8 },
    { value: t.stop, color: 'coral', dash: '2,2', width: 1.3 },
  ], { entryIdx: localEntryIdx });
  const cur = chartRows[chartRows.length - 1].close;
  const badgeClass = t.status === 'TP' ? 'bdg-sky' : t.status === 'STOP' ? 'bdg-red' : t.status === 'OPEN' ? 'bdg-teal' : 'bdg-amber';
  const statusLabel = t.status === 'OPEN' ? `OPEN(${t.day}일경과)` : `${t.status === 'TP' ? 'TP익절' : t.status === 'STOP' ? 'STOP손절' : 'TIME청산'}(${t.day}일)`;
  const retVal = t.status === 'OPEN' ? (cur - t.entryPrice) / t.entryPrice * 100 : t.ret;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(t.name)}</span><span class="badge ${badgeClass}">${statusLabel}</span>&nbsp;<span style="color:var(--txt3);font-size:12.5px">${t.entryDate}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입가 <span>${fmtWon(t.entryPrice)}</span> <span class="sep">|</span> 현재가 <span>${fmtWon(cur)}</span> <span class="sep">|</span> 수익률 <span class="${retVal >= 0 ? 't-pos' : 't-neg'}">${fmtPct(retVal)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>TP <span>${fmtWon(t.candleHigh)}</span> <span class="sep">|</span> STOP <span>${fmtWon(t.stop)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>장대양봉일 <span>${t.candleDate}</span> <span class="sep">|</span> 눌림터치일 <span>${t.touchDate}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--sky)"></i>TP(캔들고가)</span><span><i class="dash" style="border-color:var(--coral)"></i>STOP</span><span><i style="background:var(--sky600)"></i>진입가</span></div>
      </div>`;
}
function breakoutCardHtml(p, chartRows) {
  const svg = buildChartSvg(chartRows, [
    { value: p.touchHigh, color: 'amber', dash: '6,3', width: 1.8 },
    { value: p.candleHigh, color: 'sky', dash: '6,3', width: 1.8 },
  ], {});
  const cur = chartRows[chartRows.length - 1].close;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(p.name)}</span><span class="badge bdg-amber">재돌파대기 ${p.windowLeft}일</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(cur)}</span> <span class="sep">|</span> 돌파기준(터치일고가) <span>${fmtWon(p.touchHigh)}</span> <span class="sep">|</span> TP <span>${fmtWon(p.candleHigh)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>장대양봉일 <span>${p.candleDate}</span> <span class="sep">|</span> 눌림터치일 <span>${p.touchDate}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>돌파기준(터치일고가)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP(캔들고가)</span></div>
      </div>`;
}
function touchCardHtml(p, chartRows) {
  const svg = buildChartSvg(chartRows, [
    { value: p.mid, color: 'amber', dash: '6,3', width: 1.8 },
    { value: p.candleHigh, color: 'sky', dash: '6,3', width: 1.8 },
  ], {});
  const cur = chartRows[chartRows.length - 1].close;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(p.name)}</span><span class="badge bdg-gray">눌림대기 ${p.windowLeft}일</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(cur)}</span> <span class="sep">|</span> 중간값(눌림목표) <span>${fmtWon(p.mid)}</span> <span class="sep">|</span> TP <span>${fmtWon(p.candleHigh)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>장대양봉일 <span>${p.candleDate}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>중간값(눌림목표)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP(캔들고가)</span></div>
      </div>`;
}

async function main() {
  console.error(`[장대양봉 포털빌드] ${DEFAULT_STOCKS.length}종목 로딩...`);
  const loaded = await batchAll(DEFAULT_STOCKS, loadStock);
  const byName = new Map(loaded.filter(s => !s.error).map(s => [s.name, s]));
  console.error(`[로딩완료] ${byName.size}/${DEFAULT_STOCKS.length}`);

  // ── 최근신호(20거래일) ──
  const allSignals = [];
  for (const s of byName.values()) {
    const trades = detectRecentSignals(s.seq, OPTS);
    const lastIdx = s.seq.length - 1;
    for (const t of trades) if (lastIdx - t.entryIdx <= 20) allSignals.push({ ...t, uptrendCode: s.code, uptrendMarket: s.market, seq: s.seq });
  }
  allSignals.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  console.error(`[최근신호] ${allSignals.length}건`);

  // ── 예상종목(진행중 셋업) ──
  const pendingAll = [];
  for (const s of byName.values()) {
    const p = findPendingSetup(s.seq, OPTS);
    if (p) pendingAll.push({ ...p, name: s.name, seq: s.seq, curClose: s.seq[s.seq.length - 1].close });
  }
  const awaitBreakout = pendingAll.filter(p => p.stage === 'AWAIT_BREAKOUT').sort((a, b) => b.touchDate.localeCompare(a.touchDate));
  const awaitTouch = pendingAll.filter(p => p.stage === 'AWAIT_TOUCH').sort((a, b) => b.candleDate.localeCompare(a.candleDate));
  console.error(`[예상종목] 재돌파대기${awaitBreakout.length} 눌림대기${awaitTouch.length}`);

  // ── HTML 조립 ──
  const CHART_LEAD = 15;
  const openCount = allSignals.filter(t => t.status === 'OPEN').length;
  const closedCount = allSignals.length - openCount;
  const closedWin = allSignals.filter(t => t.status !== 'OPEN' && t.ret > 0).length;
  const winRate = closedCount ? Math.round(closedWin / closedCount * 100) : 0;

  const sigRows = allSignals.map(t => {
    const statusStr = t.status === 'OPEN' ? `OPEN(${t.day}일경과)` : `${t.status === 'TP' ? 'TP익절' : t.status === 'STOP' ? 'STOP손절' : 'TIME청산'}(${t.day}일)`;
    const badgeClass = t.status === 'TP' ? 'bdg-sky' : t.status === 'STOP' ? 'bdg-red' : t.status === 'OPEN' ? 'bdg-teal' : 'bdg-amber';
    const cur = t.seq[t.seq.length - 1].close;
    const retVal = t.status === 'OPEN' ? (cur - t.entryPrice) / t.entryPrice * 100 : t.ret;
    return `<tr><td class="l">${t.entryDate}</td><td class="l">${esc(t.name)}</td><td>${fmtWon(cur)}</td><td>${fmtWon(t.entryPrice)}</td><td>${fmtWon(t.candleHigh)}</td><td>${fmtWon(t.stop)}</td><td class="l">${t.candleDate}</td><td class="l">${t.touchDate}</td><td class="l"><span class="badge ${badgeClass}">${statusStr}</span></td><td class="${retVal >= 0 ? 't-pos' : 't-neg'}">${fmtPct(retVal)}</td></tr>`;
  }).join('\n');
  const sigTable = `      <table class="tbl-fixed">
        <thead><tr><th class="l" style="width:9%">진입일</th><th class="l" style="width:12%">종목</th><th style="width:8%">현재가</th><th style="width:8%">진입가</th><th style="width:8%">TP가</th><th style="width:8%">STOP가</th><th class="l" style="width:9%">장대양봉일</th><th class="l" style="width:9%">눌림터치일</th><th class="l" style="width:11%">상태</th><th style="width:8%">수익률</th></tr></thead>
        <tbody>
${sigRows}
        </tbody>
      </table>`;

  const sigCardData = allSignals.slice(0, 10).map(t => {
    const chartStart = Math.max(0, t.entryIdx - CHART_LEAD);
    const chartRows = t.seq.slice(chartStart, t.seq.length);
    return { html: signalCardHtml({ ...t, chartStart }, chartRows) };
  });

  const breakoutRows = awaitBreakout.map(p => `<tr><td class="l">${esc(p.name)}</td><td>${fmtWon(p.curClose)}</td><td>${fmtWon(p.touchHigh)}</td><td>${fmtWon(p.candleHigh)}</td><td class="l">${p.candleDate}</td><td class="l">${p.touchDate}</td><td class="c">${p.windowLeft}일</td></tr>`).join('\n');
  const breakoutTable = `      <table class="tbl-fixed">
        <thead><tr><th class="l" style="width:16%">종목명</th><th style="width:12%">현재가</th><th style="width:14%">돌파기준(터치일고가)</th><th style="width:12%">TP가</th><th class="l" style="width:14%">장대양봉일</th><th class="l" style="width:14%">눌림터치일</th><th class="c" style="width:10%">확인창잔여</th></tr></thead>
        <tbody>
${breakoutRows}
        </tbody>
      </table>`;
  const touchRows = awaitTouch.map(p => `<tr><td class="l">${esc(p.name)}</td><td>${fmtWon(p.curClose)}</td><td>${fmtWon(p.mid)}</td><td>${fmtWon(p.candleHigh)}</td><td class="l">${p.candleDate}</td><td class="c">${p.windowLeft}일</td></tr>`).join('\n');
  const touchTable = `      <table class="tbl-fixed">
        <thead><tr><th class="l" style="width:18%">종목명</th><th style="width:14%">현재가</th><th style="width:16%">중간값(눌림목표)</th><th style="width:14%">TP가</th><th class="l" style="width:16%">장대양봉일</th><th class="c" style="width:12%">대기창잔여</th></tr></thead>
        <tbody>
${touchRows}
        </tbody>
      </table>`;

  const breakoutCards = awaitBreakout.map(p => {
    const chartRows = p.seq.slice(Math.max(0, p.seq.length - 60), p.seq.length);
    return breakoutCardHtml(p, chartRows);
  });
  const touchCards = awaitTouch.map(p => {
    const chartRows = p.seq.slice(Math.max(0, p.seq.length - 60), p.seq.length);
    return touchCardHtml(p, chartRows);
  });

  fs.writeFileSync('C:\\Users\\shinf\\workspace\\scripts\\_bigcandle_portal_data.json', JSON.stringify({
    sigTable, sigCards: sigCardData.map(c => c.html), breakoutTable, breakoutCards, touchTable, touchCards,
    openCount, closedCount, winRate, signalCount: allSignals.length,
    breakoutCount: awaitBreakout.length, touchCount: awaitTouch.length,
  }, null, 0), 'utf8');
  console.error('[완료] _bigcandle_portal_data.json 생성');
}
main().catch(e => { console.error('오류:', e); process.exit(1); });
