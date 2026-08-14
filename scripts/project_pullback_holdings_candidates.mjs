// 눌림목 V3_RETEST(v11) — "예상종목"(정배열+되돌림밴드 근접 top6) · "보유종목"(Notion 보유종목DB 연동) 탭용 데이터 생성
// project_pullback_recent_signals.mjs와 project_holdings_deviation_stats.mjs의 로직을 눌림목 전략에 맞춰 결합.
// 사용법: node scripts/project_pullback_holdings_candidates.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

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

const MA_SHORT = 50, MA_LONG = 100, SLOPE_LOOKBACK = 10;
const ATR_PERIOD = 14, BAND_K = 0.4;
const SL = 8, TP_PCT = 10;
const CHART_DAYS = 70, CALENDAR_DAYS = 400;

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const o = new URL(url);
    const req = https.request({ hostname: o.hostname, port: 443, path: o.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}
function httpGetPage(url, headers) {
  return new Promise((res, rej) => {
    const o = new URL(url);
    const req = https.request({ hostname: o.hostname, port: 443, path: o.pathname, method: 'GET', headers }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.end();
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [], high: result.indicators?.quote?.[0]?.high || [], low: result.indicators?.quote?.[0]?.low || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([fetchYahooChart(`${code}.KS`, p1, p2), fetchYahooChart(`${code}.KQ`, p1, p2)]);
  const ksLen = ks?.ts?.length || 0, kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return null;
  return ksLen >= kqLen ? { chart: ks, market: 'KOSPI' } : { chart: kq, market: 'KOSDAQ' };
}
function tsToKst(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const filled = fillForward(closes); const k = 2 / (period + 1);
  const emas = new Array(filled.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < filled.length; i++) {
    const p = filled[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
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
    const v = tr[i]; if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function analyzeStock(code, marketHint) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const got = marketHint ? { chart: await fetchYahooChart(`${code}.${marketHint === 'KOSDAQ' ? 'KQ' : 'KS'}`, p1, p2), market: marketHint } : await fetchChartAutoMarket(code, p1, p2);
  if (!got || !got.chart || !got.chart.ts.length) return { error: '데이터 조회 실패' };
  const { chart, market } = got;
  const dates = chart.ts.map(tsToKst);
  const closes = fillForward(chart.close), highs = fillForward(chart.high), lows = fillForward(chart.low);
  const ema50s = buildEma(closes, MA_SHORT), ema100s = buildEma(closes, MA_LONG);
  const atrs = buildAtr(highs, lows, closes, ATR_PERIOD);

  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema50s[i] == null || ema100s[i] == null) continue;
    const atrPct = atrs[i] != null ? atrs[i] / closes[i] * 100 : null;
    rows.push({ date: dates[i], close: closes[i], ema50: ema50s[i], ema100: ema100s[i], atrPct });
  }
  if (rows.length < MA_LONG + SLOPE_LOOKBACK + 1) return { error: '데이터 부족' };

  const n = rows.length;
  const cur = rows[n - 1], prev = rows[n - 2];
  const trendUp = cur.ema50 > cur.ema100 && cur.ema50 > rows[n - 1 - SLOPE_LOOKBACK].ema50;

  let highS = -Infinity;
  for (let k = n - MA_SHORT; k <= n - 1; k++) { if (k >= 0 && rows[k].close > highS) highS = rows[k].close; }
  const pullbackPct = highS > 0 ? (highS - cur.close) / highS * 100 : null;
  const normDepth = (pullbackPct != null && cur.atrPct) ? pullbackPct / cur.atrPct : null;

  const chartRows = rows.slice(-CHART_DAYS);
  return { market, cur, prev, trendUp, highS, pullbackPct, normDepth, chartRows, rows };
}

function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function devClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

// 예상종목·보유종목 탭용 SVG/카드 HTML — project_deviation_holdings_candidates.mjs의
// buildChartSvg/candidateCardHtml/holdingCardHtml과 동일 패턴(EMA5/EMA20 대신 EMA50/EMA100만 사용)
function buildChartSvg(rows, opts) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema50, r.ema100));
  if (opts.avgPrice) allVals.push(opts.avgPrice, opts.slPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema100', 'amber', '6,3', 1.3) + poly('ema50', 'purple', '4,3', 1.4);
  if (opts.avgPrice) {
    svg += `<line x1="${x0}" y1="${yAt(opts.avgPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.avgPrice).toFixed(1)}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<line x1="${x0}" y1="${yAt(opts.slPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.slPrice).toFixed(1)}" stroke="var(--coral)" stroke-width="1.1" stroke-dasharray="1,3"/>`;
  }
  svg += poly('close', 'txt', null, 1.7);
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}
function candidateCardHtml(r) {
  const svg = buildChartSvg(r.chartRows, {});
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge bdg-sky">정배열</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> EMA50대비 <span class="${devClass(dev50)}">${fmt(dev50)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>최근 신고가 대비 눌림폭 <span>${r.pullbackPct.toFixed(2)}%</span> <span class="sep">|</span> 되돌림밴드(ATR&times;0.4) 대비 <span>${r.normDepth.toFixed(2)}배</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--purple)"></i>EMA50</span><span><i style="background:var(--amber)"></i>EMA100</span></div>
      </div>`;
}
function candidateRowHtml(r) {
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  return `<tr><td class="l">${esc(r.name)}</td><td class="c">${r.market}</td><td>${fmtV(r.close)}</td><td class="${devClass(dev50)}">${fmt(dev50)}</td><td>${r.pullbackPct.toFixed(2)}%</td><td>${r.normDepth.toFixed(2)}배</td><td class="c">${r.held ? '보유중' : '─'}</td></tr>`;
}
function holdingCardHtml(r) {
  const v = verdict(r);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const slPrice = r.avgPrice * (1 - SL / 100);
  const svg = buildChartSvg(r.chartRows, { avgPrice: r.avgPrice, slPrice });
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  const trendLbl = r.trendUp ? '정배열 유지' : '역배열/조정';
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badgeCls}">${v.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> 평단대비 <span class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA50대비 <span class="${devClass(dev50)}">${fmt(dev50)}</span> <span class="sep">|</span> 추세 <span>${trendLbl}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--${v.cls})"></i>판단 <span style="color:var(--${v.cls})">${v.label}</span></span><span><i style="background:var(--txt2)"></i>평단 <span>${fmtV(r.avgPrice)}</span></span><span><i style="background:var(--coral)"></i>손절선(-8%) <span>${fmtV(slPrice)}</span></span></div>
      </div>`;
}
function holdingRowHtml(r) {
  const v = verdict(r);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const dev50 = (r.close - r.ema50) / r.ema50 * 100;
  const trendLbl = r.trendUp ? '정배열 유지' : '역배열/조정';
  return `<tr><td class="l">${esc(r.name)}</td><td class="c">${r.market}</td><td class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</td><td class="${devClass(dev50)}">${fmt(dev50)}</td><td class="c">${trendLbl}</td><td class="c"><span class="badge ${badgeCls}">${v.label}</span></td></tr>`;
}

async function refetchPage(pageId) {
  try {
    const page = await httpGetPage(`https://api.notion.com/v1/pages/${pageId}`, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      name: (page?.properties?.['종목명']?.title?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      avgPrice: Number(page?.properties?.['매 입 가']?.number || 0),
    };
  } catch { return null; }
}
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음'); return []; }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) return [];
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate).map(p => ({
    pageId: p.id,
    code: (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
    name: (p.properties['종목명']?.title?.[0]?.plain_text || '').trim(),
    qty: Number(p.properties['보유수량']?.number || 0),
    avgPrice: Number(p.properties['매 입 가']?.number || 0),
  }));
  for (const h of rows) {
    if (!h.name || !h.code || h.qty <= 0 || !h.avgPrice) {
      const fixed = await refetchPage(h.pageId);
      if (fixed) {
        if (!h.name && fixed.name) h.name = fixed.name;
        if (!h.code && fixed.code) h.code = fixed.code;
        if (h.qty <= 0 && fixed.qty > 0) h.qty = fixed.qty;
        if (!h.avgPrice && fixed.avgPrice) h.avgPrice = fixed.avgPrice;
      }
    }
  }
  return rows.filter(h => h.code && h.qty > 0);
}

function verdict(r) {
  if (r.unrealizedRet != null && r.unrealizedRet <= -SL) return { label: '손절검토', cls: 'red' };
  if (r.breakdown50) return { label: '전량매도검토(50EMA이탈)', cls: 'red' };
  if (r.freshTp10) return { label: '1차익절검토(+10%)', cls: 'teal' };
  if (r.aboveEma50) return { label: '홀딩(50EMA위)', cls: 'teal' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -SL * 0.6) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

async function main() {
  console.error(`[조회] 후보 유니버스 ${DEFAULT_STOCKS.length}종목 분석 중...`);
  const universeResults = await batchAll(DEFAULT_STOCKS, async s => {
    const a = await analyzeStock(s.code, s.market);
    return a.error ? { ...s, error: a.error } : { ...s, ...a };
  });

  console.error('[조회] Notion 보유종목DB 조회 중...');
  const holdingsRaw = await fetchNotionHoldings();
  console.error(`[조회] 보유종목 ${holdingsRaw.length}개 분석 중... (${holdingsRaw.map(h => h.name).join(', ')})`);
  const holdCodes = new Set(holdingsRaw.map(h => h.code));

  // held 종목이 유니버스에 없으면(코스닥 소형주 등) 개별 조회
  const missingHoldCodes = holdingsRaw.filter(h => !DEFAULT_STOCKS.some(s => s.code === h.code));

  const holdingAnalysis = new Map();
  for (const s of universeResults) if (holdCodes.has(s.code)) holdingAnalysis.set(s.code, s);
  const extraResults = await batchAll(missingHoldCodes, async h => {
    const a = await analyzeStock(h.code, null);
    return { code: h.code, ...a };
  });
  for (const r of extraResults) if (!r.error) holdingAnalysis.set(r.code, r);

  const holdings = holdingsRaw.map(h => {
    const a = holdingAnalysis.get(h.code);
    if (!a || a.error) return { ...h, error: a?.error || '데이터 조회 실패' };
    const unrealizedRet = h.avgPrice ? (a.cur.close - h.avgPrice) / h.avgPrice * 100 : null;
    const aboveEma50 = a.cur.close >= a.cur.ema50;
    const prevUnrealizedRet = h.avgPrice && a.prev ? (a.prev.close - h.avgPrice) / h.avgPrice * 100 : null;
    const breakdown50 = !aboveEma50; // 상태 기준(현재 EMA50 아래) — 당일 신규이탈만 잡던 이전 로직은 며칠째 이탈 지속 중인 종목을 "관찰"로 방치하는 사각지대가 있어 2026-08-12 수정
    const freshTp10 = unrealizedRet != null && unrealizedRet >= TP_PCT && !(prevUnrealizedRet != null && prevUnrealizedRet >= TP_PCT);
    return { ...h, ...a, unrealizedRet, aboveEma50, breakdown50, freshTp10 };
  });

  // 예상종목: 정배열(EMA50>EMA100 상승기울기) 종목 중 되돌림밴드 근접도(normDepth) 오름차순 top6
  const validUniverse = universeResults.filter(r => !r.error);
  const candidates = validUniverse
    .filter(r => r.trendUp && r.normDepth != null && r.normDepth >= 0)
    .sort((a, b) => a.normDepth - b.normDepth)
    .slice(0, 6)
    .map(r => ({ ...r, held: holdCodes.has(r.code) }));

  const outCandidates = candidates.map(r => ({
    code: r.code, name: r.name, market: r.market, held: r.held,
    close: r.cur.close, ema50: r.cur.ema50, ema100: r.cur.ema100,
    pullbackPct: r.pullbackPct, normDepth: r.normDepth, atrPct: r.cur.atrPct,
    date: r.cur.date,
    chartRows: r.chartRows.map(x => ({ date: x.date, close: x.close, ema50: x.ema50, ema100: x.ema100 })),
  }));
  const outHoldings = holdings.map(h => h.error ? { code: h.code, name: h.name, error: h.error } : {
    code: h.code, name: h.name, market: h.market, avgPrice: h.avgPrice, qty: h.qty,
    close: h.cur.close, ema50: h.cur.ema50, ema100: h.cur.ema100,
    unrealizedRet: h.unrealizedRet, aboveEma50: h.aboveEma50, breakdown50: h.breakdown50, freshTp10: h.freshTp10,
    trendUp: h.trendUp, date: h.cur.date,
    chartRows: h.chartRows.map(x => ({ date: x.date, close: x.close, ema50: x.ema50, ema100: x.ema100 })),
  });
  const validHoldingsOut = outHoldings.filter(h => !h.error);

  const candidateRows = outCandidates.map(candidateRowHtml).join('\n          ');
  const candidateCards = outCandidates.map(candidateCardHtml).join('\n');
  const holdingRows = validHoldingsOut.map(holdingRowHtml).join('\n          ');
  const holdingCards = validHoldingsOut.map(holdingCardHtml).join('\n');
  const fs = await import('fs');
  fs.writeFileSync('candidates_table_rows.html', candidateRows, 'utf-8');
  fs.writeFileSync('candidates_cards.html', candidateCards, 'utf-8');
  fs.writeFileSync('holdings_table_rows.html', holdingRows, 'utf-8');
  fs.writeFileSync('holdings_cards.html', holdingCards, 'utf-8');
  console.error('[산출완료] candidates_table_rows.html, candidates_cards.html, holdings_table_rows.html, holdings_cards.html');

  const out = {
    generatedAt: new Date().toISOString(),
    universeTotal: DEFAULT_STOCKS.length,
    universeValid: validUniverse.length,
    trendUpCount: validUniverse.filter(r => r.trendUp).length,
    candidatesKpi: { total: outCandidates.length },
    holdingsKpi: {
      total: validHoldingsOut.length,
      trendUp: validHoldingsOut.filter(h => h.trendUp).length,
      avgUnrealizedRet: validHoldingsOut.length ? validHoldingsOut.reduce((a, h) => a + h.unrealizedRet, 0) / validHoldingsOut.length : null,
    },
    candidates: outCandidates,
    holdings: outHoldings,
  };
  console.log(JSON.stringify(out));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
