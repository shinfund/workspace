// 눌림목 V3_RETEST(v11) — "최근신호" 탭용 라이브 데이터 생성 스크립트 (2026-08-12)
// project_stock_pullback.mjs와 동일한 진입/청산 로직을 사용하되, 각 진입 건의 "현재 상태"
// (청산완료: 사유·경과일·수익률 / 보유중: 경과일·현재수익률)를 최근 N일 구간에 대해 산출해 JSON으로 출력한다.
// 사용법: node scripts/project_pullback_recent_signals.mjs [--days 120]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' }, { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' }, { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' }, { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' }, { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' }, { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' }, { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const KOSPI_SYMBOL = '%5EKS11';
const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10;
const BREAKOUT_LOOKBACK = 6;
const ATR_PERIOD = 14, BAND_K = 0.4;
const SL = 8, TRAIL = 8, TP_PCT = 10, TP_FRAC = 0.5, MAX_HOLD = 40;
const REGIME_STREAK_MIN = 10;
const KOSPI_ATR_PERIOD = 14, VOL_CAP = 4;
const CALENDAR_DAYS = 1100;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { recentDays: 120 };
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [], volume: q.volume || [] };
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

function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
}

function buildEma(closes, period) {
  const filled = fillForward(closes);
  const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < filled.length; i++) {
    const price = filled[i];
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

function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i];
    if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
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

async function fetchMarketRegime(p1, p2) {
  const chart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  if (!chart || !chart.ts.length) throw new Error('KOSPI지수 조회 실패');
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const maLong = buildEma(closes, MA_LONG);
  const kospiAtr = buildAtr(chart.high, chart.low, closes, KOSPI_ATR_PERIOD);
  const regime = {}, streak = {}, volPct = {};
  let curStreak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (maLong[i] == null || i < MA_LONG + SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > maLong[i] && maLong[i] > maLong[i - SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    regime[dates[i]] = up;
    streak[dates[i]] = curStreak;
    volPct[dates[i]] = kospiAtr[i] != null ? kospiAtr[i] / closes[i] * 100 : null;
  }
  const lastIdx = dates.length - 1;
  return { regime, streak, volPct, lastDate: dates[lastIdx], lastClose: closes[lastIdx], lastMaLong: maLong[lastIdx], lastVol: volPct[dates[lastIdx]] };
}

// 청산완료 or 보유중 상태를 모두 반환(원본 simulatePartialTP는 미종결 포지션을 null 처리하지만, 여기서는 "보유중"으로 표기)
function simulateLiveStatus(seq, i0, entryClose, sl, trail, maxHold, tpPct, tpFrac) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  const lastIdx = seq.length - 1;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j > lastIdx) {
      // 데이터가 아직 여기까지 진행되지 않음 = 보유중
      const heldDays = lastIdx - i0;
      const curClose = seq[lastIdx].close;
      const curRet = (curClose - entryClose) / entryClose * 100;
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * curRet : curRet;
      return { status: 'OPEN', day: heldDays, ret: blended, tpTaken, reason: null };
    }
    const close = seq[j].close;
    const maShort = seq[j].maShort;
    const ret = (close - entryClose) / entryClose * 100;

    if (!tpTaken && ret >= tpPct) {
      tpTaken = true; tpReturn = ret;
      if (close > peak) peak = close;
      continue;
    }
    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { status: 'CLOSED', ret: blended, reason, day: d, tpTaken };
    };
    if (ret <= -sl) return finish('SL');
    if (close < maShort) return finish('TREND_BREAK');
    if (close > peak) peak = close;
    const trailRet = (close - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

async function loadStockSignals(stock, marketRegime, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null, entries: [] };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const highs = fillForward(chart.high);
  const lows = fillForward(chart.low);
  const maShort = buildEma(closes, MA_SHORT);
  const maLong = buildEma(closes, MA_LONG);
  const atr = buildAtr(highs, lows, closes, ATR_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || maShort[i] == null || maLong[i] == null) continue;
    const atrPct = atr[i] != null ? atr[i] / closes[i] * 100 : null;
    seq.push({ date: dates[i], close: closes[i], maShort: maShort[i], maLong: maLong[i], atrPct });
  }
  const minLen = MA_LONG + SLOPE_LOOKBACK + 1;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족', seq: null, entries: [] };

  const entries = [];
  for (let i = MA_LONG + SLOPE_LOOKBACK; i < seq.length; i++) {
    const s = seq[i];
    const prior = seq[i - SLOPE_LOOKBACK];
    const trendUp = s.close > s.maLong && s.maShort > s.maLong && s.maLong > prior.maLong;
    if (!trendUp || marketRegime.regime[s.date] !== true) continue;
    if ((marketRegime.streak[s.date] ?? 0) < REGIME_STREAK_MIN) continue;
    const kospiVol = marketRegime.volPct[s.date];
    if (kospiVol == null || kospiVol > VOL_CAP) continue;
    if (i < MA_SHORT || s.atrPct == null || s.atrPct <= 0) continue;

    let highS = -Infinity, highSIdx = -1;
    for (let k = i - (MA_SHORT - 1); k <= i - 1; k++) { if (seq[k].close > highS) { highS = seq[k].close; highSIdx = k; } }
    const recentBreakout = highSIdx >= i - BREAKOUT_LOOKBACK;
    if (!recentBreakout || s.close > highS || s.close <= s.maShort) continue;

    const pullbackPct = (highS - s.close) / highS * 100;
    const normDepth = pullbackPct / s.atrPct;
    if (normDepth > BAND_K) continue;

    entries.push({ i, date: s.date });
  }
  return { ...stock, seq, entries };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function retClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

// 상태(진행중/청산완료+사유)를 표·차트카드가 공유하는 배지·부연설명으로 변환
function statusInfo(row) {
  let primary;
  if (row.status === 'OPEN') {
    primary = { cls: 'bdg-teal', label: '보유중' };
  } else {
    primary = {
      SL: { cls: 'bdg-red', label: '손절' },
      TREND_BREAK: { cls: 'bdg-gray', label: 'EMA50이탈' },
      TRAIL: { cls: 'bdg-purple', label: '트레일링청산' },
      TIME: { cls: 'bdg-amber', label: '시간청산' },
    }[row.reason] || { cls: 'bdg-gray', label: row.reason };
  }
  const subBadges = row.tpTaken ? '<span class="badge bdg-sky">TP</span>' : '';
  let note = '';
  if (row.status === 'OPEN') {
    note = row.tpTaken
      ? '<span style="color:var(--txt3);font-size:12.5px">(1차익절완료(잔량50%))</span>'
      : '<span style="color:var(--txt3);font-size:12.5px">(익절대기(보유100%))</span>';
  }
  const day = row.day;
  return { primary, subBadges, note, day };
}

function tableRowHtml(row, seq) {
  const s = statusInfo(row);
  const statusCell = `<span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges ? ' ' + s.subBadges.trim() : ''}`;
  const noteCell = s.note ? s.note.trim() : '<span class="t-flat">&mdash;</span>';
  const cur = seq[seq.length - 1];
  const emaDisparity = (cur.close - cur.maShort) / cur.maShort * 100;
  return `          <tr><td class="l">${row.date}</td><td class="l">${esc(row.name)}</td><td>${fmtV(cur.close)}</td><td class="${retClass(emaDisparity)}">${fmt(emaDisparity)}</td><td>${fmtV(row.entryClose)}</td><td class="l">${statusCell}</td><td class="c">D+${s.day}</td><td class="${retClass(row.ret)}">${fmt(row.ret)}</td><td class="l">${noteCell}</td></tr>`;
}

function buildChartSvg(rows, markers) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.maShort, r.maLong));
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('maLong', 'amber', '6,3', 1.3) + poly('maShort', 'purple', '2,2', 1.8) + poly('close', 'txt', null, 1.7);
  if (markers?.entryIdx != null && markers.entryIdx >= 0) {
    const ei = markers.entryIdx;
    const entryY = yAt(rows[ei].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1.6" stroke-dasharray="5,3" opacity="0.85"/>`;
    svg += `<line x1="${xAt(ei).toFixed(1)}" y1="${yTop}" x2="${xAt(ei).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<circle cx="${xAt(ei).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function chartCardHtml(row, seq, entryIdx) {
  const CHART_LEAD_DAYS = 60;
  const windowStart = Math.max(0, entryIdx - CHART_LEAD_DAYS);
  const chartRows = seq.slice(windowStart, seq.length);
  const localEntryIdx = entryIdx - windowStart;
  const svg = buildChartSvg(chartRows, { entryIdx: localEntryIdx });
  const s = statusInfo(row);
  const cur = seq[seq.length - 1];
  const emaDisparity = (cur.close - cur.maShort) / cur.maShort * 100;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(row.name)}</span><span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges.trim()}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입일 ${row.date} <span class="sep">|</span> 진입가 <span>${fmtV(row.entryClose)}</span> <span class="sep">|</span> 현재가 <span>${fmtV(cur.close)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>D+${s.day} <span class="sep">|</span> 수익률 <span class="${retClass(row.ret)}">${fmt(row.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA50대비 <span class="${retClass(emaDisparity)}">${fmt(emaDisparity)}</span> <span class="sep">|</span> 기준선(EMA50) <span>${fmtV(cur.maShort)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--sky600)"></i>진입가</span><span><i style="background:var(--purple)"></i>기준선(EMA50)</span><span><i style="background:var(--amber)"></i>EMA100</span><span><i style="background:var(--${s.primary.cls === 'bdg-red' ? 'red' : s.primary.cls === 'bdg-purple' ? 'purple' : s.primary.cls === 'bdg-teal' ? 'teal' : s.primary.cls === 'bdg-amber' ? 'amber' : 'gray600'})"></i>상태 <span>${s.primary.label}</span></span></div>
      </div>`;
}

async function main() {
  const opts = parseArgs();
  const calendarDays = CALENDAR_DAYS;
  console.error(`[최근신호 산출] recentDays=${opts.recentDays}`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - calendarDays * 24 * 3600;
  const marketRegime = await fetchMarketRegime(p1, p2);

  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, marketRegime, { calendarDays }));
  const valid = loaded.filter(r => !r.error && r.entries.length);

  const cutoffMs = Date.now() - opts.recentDays * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  const rows = [];
  const rowMeta = [];
  for (const r of valid) {
    for (const e of r.entries) {
      if (e.date < cutoffDate) continue;
      const status = simulateLiveStatus(r.seq, e.i, r.seq[e.i].close, SL, TRAIL, MAX_HOLD, TP_PCT, TP_FRAC);
      if (!status) continue;
      rows.push({ date: e.date, name: r.name, code: r.code, entryClose: r.seq[e.i].close, ...status });
      rowMeta.push({ seq: r.seq, entryIdx: e.i });
    }
  }
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date < rows[b].date ? 1 : rows[a].date > rows[b].date ? -1 : 0);
  const sortedRows = order.map(i => rows[i]);
  const sortedMeta = order.map(i => rowMeta[i]);
  rows.length = 0; rows.push(...sortedRows);

  const closed = rows.filter(x => x.status === 'CLOSED');
  const open = rows.filter(x => x.status === 'OPEN');
  const wins = closed.filter(x => x.ret > 0).length;

  const CHART_COUNT = 10;
  const tableHtml = rows.map((row, i) => tableRowHtml(row, sortedMeta[i].seq)).join('\n');
  const chartCardsHtml = rows.slice(0, CHART_COUNT).map((row, i) => chartCardHtml(row, sortedMeta[i].seq, sortedMeta[i].entryIdx)).join('\n');
  const fs = await import('fs');
  fs.writeFileSync('pullback_signals_table.html', tableHtml, 'utf-8');
  fs.writeFileSync('pullback_signals_charts.html', chartCardsHtml, 'utf-8');
  console.error(`[산출완료] table→pullback_signals_table.html(전체 ${rows.length}건), charts→pullback_signals_charts.html(최신 ${Math.min(CHART_COUNT, rows.length)}건)`);

  const out = {
    generatedAt: new Date().toISOString(),
    kospi: { lastDate: marketRegime.lastDate, lastClose: marketRegime.lastClose, lastMaLong: marketRegime.lastMaLong, lastVol: marketRegime.lastVol },
    cutoffDate,
    total: rows.length,
    openCount: open.length,
    closedCount: closed.length,
    closedWinRate: closed.length ? (wins / closed.length * 100) : null,
    rows,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
