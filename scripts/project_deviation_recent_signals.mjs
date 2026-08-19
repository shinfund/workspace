// 괴리율(역추세) 전략 — "최근신호" 탭용 라이브 데이터 생성 스크립트 (2026-08-12)
// project_deviation_tp20_exit_backtest.mjs(확정 진입·청산 로직)와 동일한 규칙을 사용하되, 각 진입 건의 "현재 상태"
// (청산완료: 최종 청산사유·경과일·가중수익률 / 보유중: 진행단계·경과일·현재 blended 수익률)를 산출해 JSON으로 출력한다.
// 진입: EMA5·EMA20 각각 롤링250일 Z<=-2 & 위치<=3%ile 동시충족(AND) + EMA50<EMA200(하락추세), rising edge
// 청산: ①-15%손절(최우선) ②+20%도달시 50%매도 ③이후 종가>=EMA20 시 잔량50%(전체25%)매도 ④이후 종가<EMA5 하향이탈 시 잔량전량매도 ⑤20거래일 시간청산
// 사용법: node scripts/project_deviation_recent_signals.mjs [--days 210]
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

const ROLL = 250, Z_THRESHOLD = -2, ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5, SLOW_PERIOD = 20, TREND_MID_PERIOD = 50, CHART_LONG_PERIOD = 100, TREND_LONG_PERIOD = 200;
const SL = 15, TP = 20, MAX_HOLD = 20;
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

async function loadStockSignals(stock, opts) {
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
    if (flags[i] && !flags[i - 1]) entries.push({ i, date: seq[i].date });
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

function tableRowHtml(row, seq) {
  const s = statusInfo(row);
  const statusCell = `<span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges ? ' ' + s.subBadges.trim() : ''}`;
  const noteCell = s.note ? s.note.trim() : '<span class="t-flat">&mdash;</span>';
  const curClose = seq[seq.length - 1].close;
  return `          <tr><td class="l">${row.date}</td><td class="l">${esc(row.name)}</td><td>${fmtV(curClose)}</td><td>${fmtV(row.entryClose)}</td><td class="l">${statusCell}</td><td class="c">D+${s.day}</td><td class="${retClass(row.ret)}">${fmt(row.ret)}</td><td class="l">${noteCell}</td></tr>`;
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
  let svg = poly('ema100', 'teal', '6,3', 1.3) + poly('ema50', 'amber', '6,3', 1.3) + poly('ema20', 'purple', '4,3', 1.4) + poly('ema5', 'sky', '2,2', 2.2);
  svg += poly('close', 'txt', null, 1.7);
  const entryIdx = rows.findIndex(r => r.isEntry);
  if (entryIdx >= 0) {
    const entryY = yAt(rows[entryIdx].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>`;
    svg += `<line x1="${xAt(entryIdx).toFixed(1)}" y1="${yTop}" x2="${xAt(entryIdx).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<circle cx="${xAt(entryIdx).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function chartCardHtml(row, seq, entryIdx) {
  const windowStart = Math.max(0, entryIdx - CHART_LEAD_DAYS);
  const chartRows = seq.slice(windowStart, seq.length).map((r, k) => ({ ...r, isEntry: windowStart + k === entryIdx }));
  const svg = buildChartSvg(chartRows);
  const s = statusInfo(row);
  const cur = seq[seq.length - 1];
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(row.name)}</span><span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges.trim()}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입일 ${row.date} <span class="sep">|</span> 진입가 <span>${fmtV(row.entryClose)}</span> <span class="sep">|</span> 현재가 <span>${fmtV(cur.close)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>D+${s.day} <span class="sep">|</span> 수익률 <span class="${retClass(row.ret)}">${fmt(row.ret)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--sky600)"></i>진입시점</span><span><i style="background:var(--${s.primary.cls === 'bdg-red' ? 'red' : s.primary.cls === 'bdg-purple' ? 'purple' : s.primary.cls === 'bdg-teal' ? 'teal' : 'gray600'})"></i>상태 <span>${s.primary.label}</span></span></div>
      </div>`;
}

async function main() {
  const opts = { ...parseArgs(), calendarDays: CALENDAR_DAYS, sl: SL, tp: TP, maxHold: MAX_HOLD };
  console.error(`[괴리율 최근신호 산출] recentDays=${opts.recentDays}`);

  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStockSignals(s, opts));
  const valid = loaded.filter(r => !r.error && r.entries.length);
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const cutoffMs = Date.now() - opts.recentDays * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  const rows = [];
  const rowMeta = [];
  for (const r of valid) {
    for (const e of r.entries) {
      if (e.date < cutoffDate) continue;
      const status = simulateLiveStatus(r.seq, e.i, opts);
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

  const tableHtml = rows.map((row, i) => tableRowHtml(row, sortedMeta[i].seq)).join('\n');
  const chartCardsHtml = rows.map((row, i) => chartCardHtml(row, sortedMeta[i].seq, sortedMeta[i].entryIdx)).join('\n');
  const fs = await import('fs');
  fs.writeFileSync('recent_signals_table.html', tableHtml, 'utf-8');
  fs.writeFileSync('recent_signals_charts.html', chartCardsHtml, 'utf-8');
  console.error(`[산출완료] table→recent_signals_table.html, charts→recent_signals_charts.html`);

  const out = {
    generatedAt: new Date().toISOString(),
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
