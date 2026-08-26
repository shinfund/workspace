// EMA200 기준선 파동 전략(stock-baseline) — "보유종목" 탭용: 노션 보유종목DB 실제 보유종목을
// 기준선 전략 관점(스트릭·Z-score·회복여부·파동단계)으로 교차 점검한다.
// 주의: 보유종목이 반드시 "이 전략으로 매수한 포지션"이라는 뜻은 아니다 — 다른 전략/재량매매로
// 보유 중인 종목이라도 기준선 전략의 규칙을 오늘 시점에 대입하면 어떤 상태인지 참고용으로 보여준다.
// 스킬: stock-baseline(신규) / holdings-report(노션 연동 부분 공유)
// 사용법: node scripts/project_baseline_holdings_check.mjs
// 2026-08-18: 보유종목 탭 차트(SVG) HTML도 함께 생성하도록 확장(holdings_table_rows.html/holdings_chart_cards.html) —
// 기존엔 콘솔 요약만 출력해 앱 표는 매번 수기 반영했는데, 표만 갱신하고 차트를 갱신 못 해 매도 완료된 종목이
// 차트에 남아있는 등 불일치가 생기는 문제가 있어 표+차트를 한 번에 생성하도록 보강.
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

const ROLL = 250, MIN_STREAK = 16, Z_THRESHOLD = -1.25;
const FAST_PERIOD = 5, BASE_PERIOD = 200;
const CALENDAR_DAYS = 2555;
const SL_PCT = 25; // 2026-08-26 확정: 평단가 대비 -25% 손절(최우선 안전장치). project_baseline_strategy_backtest.mjs와 동일값

// ─── 200EMA 상향돌파 확률(2026-08-20 추가) ──────────────────────────────────
// 종목 자신의 과거 이력 중 "200EMA 하회 상태였던 모든 날"을 표본 삼아, 이후 N거래일 안에
// 재상향돌파한 비율을 실증 계산한다(이미 위에서 불러온 seq를 그대로 재사용, 추가 API 호출 없음).
// 같은 괴리율 구간(동구간)이었던 날만 필터링한 조건부 확률도 함께 계산 — 여러 워치 후보 중
// 우선순위를 매길 때 참고용(표본 n이 적으면 노이즈가 큼, feedback_stock_deviation 계열과 동일 취지).
const DEV_BUCKETS = [
  { lo: -5,        hi: 0,   label: '0%~-5%' },
  { lo: -10,       hi: -5,  label: '-5%~-10%' },
  { lo: -15,       hi: -10, label: '-10%~-15%' },
  { lo: -20,       hi: -15, label: '-15%~-20%' },
  { lo: -Infinity, hi: -20, label: '-20% 이하' },
];
const BREAKOUT_HORIZONS = [20, 60, 120];

function bucketOf(dev) { return DEV_BUCKETS.find(b => dev > b.lo && dev <= b.hi) || DEV_BUCKETS[DEV_BUCKETS.length - 1]; }

function computeDaysToCross(seq) {
  const n = seq.length;
  const nextAboveIdx = new Array(n).fill(null);
  let nearest = null;
  for (let i = n - 1; i >= 0; i--) {
    if (seq[i].close >= seq[i].ema200) nearest = i;
    nextAboveIdx[i] = nearest;
  }
  return seq.map((r, i) => {
    if (r.close >= r.ema200) return null;
    const j = i + 1 < n ? nextAboveIdx[i + 1] : null;
    return j != null ? j - i : Infinity;
  });
}

function probAtHorizon(samples, h) {
  let success = 0, denom = 0;
  for (const s of samples) {
    if (s.daysToCross <= h) { success++; denom++; }
    else if (s.remain >= h) { denom++; }
  }
  return { p: denom ? success / denom * 100 : null, n: denom };
}

function breakoutProbability(seq) {
  const n = seq.length;
  const daysToCross = computeDaysToCross(seq);
  const belowSamples = [];
  for (let i = 0; i < n; i++) {
    if (seq[i].close >= seq[i].ema200) continue;
    belowSamples.push({ dev: seq[i].dev200, daysToCross: daysToCross[i], remain: n - 1 - i });
  }
  const cur = seq[n - 1];
  const curBelow = cur.close < cur.ema200;
  const curBucket = curBelow ? bucketOf(cur.dev200) : null;
  const sameBucketSamples = curBucket ? belowSamples.filter(s => s.dev > curBucket.lo && s.dev <= curBucket.hi) : [];
  const overall = {}, byBucket = {};
  for (const h of BREAKOUT_HORIZONS) { overall[h] = probAtHorizon(belowSamples, h); byBucket[h] = probAtHorizon(sameBucketSamples, h); }
  return { curBucket, overall, byBucket };
}
function fmtProb(p) { return p.p != null ? `${p.p.toFixed(0)}%(n=${p.n})` : '─'; }

function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const opts = new URL(url);
    const req = https.request({ hostname: opts.hostname, port: 443, path: opts.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.write(bodyStr); req.end();
  });
}
function notionGetJson(url, headers) {
  return new Promise((res, rej) => {
    const opts = new URL(url);
    const req = https.request({ hostname: opts.hostname, port: 443, path: opts.pathname, method: 'GET', headers }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.end();
  });
}
async function refetchPage(pageId) {
  try {
    const page = await notionGetJson(`https://api.notion.com/v1/pages/${pageId}`, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
    return {
      code: (page?.properties?.['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
      name: (page?.properties?.['종목명']?.title?.[0]?.plain_text || '').trim(),
      qty: Number(page?.properties?.['보유수량']?.number || 0),
      avgPrice: Number(page?.properties?.['매 입 가']?.number || 0),
    };
  } catch (e) { return null; }
}
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 환경변수 없음'); return []; }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) { console.error('[Notion] 결과 없음'); return []; }
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

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
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
  const [ks, kq] = await Promise.all([fetchYahooChart(`${code}.KS`, p1, p2), fetchYahooChart(`${code}.KQ`, p1, p2)]);
  const ksLen = ks?.ts?.length || 0, kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return { chart: null, market: null };
  return ksLen >= kqLen ? { chart: ks, market: 'KOSPI' } : { chart: kq, market: 'KOSDAQ' };
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else ema = price * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function rollingZStats(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  return { z: sd ? (seq[j].dev200 - m) / sd : 0, mean: m, sd };
}

async function analyzeHolding(h) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const { chart, market } = await fetchChartAutoMarket(h.code, p1, p2);
  if (!chart) return { ...h, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema200s = buildEma(closes, BASE_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i], dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100 });
  }
  if (seq.length < ROLL + MIN_STREAK + 1) return { ...h, error: '데이터 부족' };
  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  const last = seq.length - 1;
  const cur = seq[last];
  const zs = rollingZStats(seq, last);
  const curStreak = streak[last];
  const belowBaseline = cur.close < cur.ema200;
  const unrealizedRet = h.avgPrice ? (cur.close - h.avgPrice) / h.avgPrice * 100 : null;
  const aboveEma5 = cur.close >= cur.ema5;
  const breakout = breakoutProbability(seq);
  return { ...h, market, close: cur.close, ema5: cur.ema5, ema200: cur.ema200, dev200: cur.dev200, z200: zs.z, curStreak, belowBaseline, aboveEma5, unrealizedRet, breakout, date: cur.date, seq: seq.slice(-CHART_POINTS) };
}
const CHART_POINTS = 260;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtV(v) { return v == null ? '─' : Math.round(v).toLocaleString('ko-KR'); }
function retClass(v) { if (v == null) return ''; if (v <= -20) return 't-neg-hi'; return v < 0 ? 't-neg' : 't-pos'; }

function breakoutCellHtml(r) {
  if (!r.belowBaseline || !r.breakout?.curBucket) return '<span class="t-flat">&mdash;</span>';
  const b60 = r.breakout.byBucket[60];
  return b60.p != null
    ? `<span title="괴리율구간 ${esc(r.breakout.curBucket.label)}, 표본 n=${b60.n}">${b60.p.toFixed(0)}%</span>`
    : '<span class="t-flat">표본부족</span>';
}

function tableRowHtml(r, v) {
  return `          <tr><td class="l">${esc(r.name)}</td><td class="c">${fmtV(r.close)}</td><td class="${retClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</td><td class="${retClass(r.dev200)}">${fmt(r.dev200)}</td><td>${r.z200.toFixed(2)}</td><td class="c">${r.curStreak}일</td><td class="c">${breakoutCellHtml(r)}</td><td class="c"><span class="badge bdg-${v.cls}">${esc(v.label)}</span></td></tr>`;
}

function buildChartSvg(rows, avgPrice) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema200));
  if (avgPrice) allVals.push(avgPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema200', 'amber', '6,3', 1.8) + poly('ema5', 'sky', '2,2', 1.8) + poly('close', 'txt', null, 1.7);
  if (avgPrice) {
    const ay = yAt(avgPrice).toFixed(1);
    svg += `<line x1="${x0}" y1="${ay}" x2="${x1}" y2="${ay}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function chartCardHtml(r, v) {
  const svg = buildChartSvg(r.seq, r.avgPrice);
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge bdg-${v.cls}">${esc(v.label)}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> 평단대비 <span class="${retClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA200(기준선)대비 <span class="${retClass(r.dev200)}">${fmt(r.dev200)}</span> <span class="sep">|</span> 롤링Z <span>${r.z200.toFixed(2)}</span> <span class="sep">|</span> 이탈 <b>${r.curStreak}거래일째</b></span>
        </div>
        ${r.belowBaseline && r.breakout?.curBucket ? `<div class="chart-card-stats">
          <span>200EMA 상향돌파확률(동구간 ${esc(r.breakout.curBucket.label)}) 20D <b>${fmtProb(r.breakout.byBucket[20])}</b> <span class="sep">|</span> 60D <b>${fmtProb(r.breakout.byBucket[60])}</b> <span class="sep">|</span> 120D <b>${fmtProb(r.breakout.byBucket[120])}</b></span>
        </div>` : ''}
        <div class="chart-card-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA200(기준선)</span><span><i style="background:var(--txt2)"></i>평단 <span>${fmtV(r.avgPrice)}</span></span></div>
      </div>`;
}

function verdict(r) {
  if (r.error) return { label: '─', cls: 'gray' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -SL_PCT) return { label: `손절검토(-${SL_PCT}%, 2026-08-26 확정)`, cls: 'red' };
  if (!r.belowBaseline) return { label: '기준선 위(전략 관찰대상 아님)', cls: 'gray' };
  if (r.curStreak < MIN_STREAK) return { label: `스트릭 부족(${r.curStreak}/${MIN_STREAK}일, 관찰전)`, cls: 'gray' };
  if (r.z200 <= Z_THRESHOLD && !r.aboveEma5) return { label: 'Z조건충족·EMA5돌파대기', cls: 'amber' };
  if (r.z200 <= Z_THRESHOLD && r.aboveEma5) return { label: '매수조건 근접(돌파 직후 재확인 필요)', cls: 'amber' };
  return { label: '워치 후보(Z조건 미충족)', cls: 'gray' };
}
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

async function main() {
  const holdings = await fetchNotionHoldings();
  if (!holdings.length) { console.log(JSON.stringify({ error: 'NO_HOLDINGS_OR_TOKEN', holdings: [] })); return; }
  console.error(`[조회] 보유종목 ${holdings.length}개 × 기준선 전략 상태 점검 중... (${holdings.map(h => h.name).join(', ')})`);
  const results = await batchAll(holdings, analyzeHolding);

  console.log(`\n━━━ 보유종목 × 기준선(EMA200) 전략 상태 점검 ━━━\n`);
  const okResults = [];
  for (const r of results) {
    if (r.error) { console.log(`${r.name}: ${r.error}`); continue; }
    const v = verdict(r);
    const bo = r.belowBaseline && r.breakout?.curBucket
      ? `  돌파확률(동구간)20D/60D/120D ${fmtProb(r.breakout.byBucket[20])}/${fmtProb(r.breakout.byBucket[60])}/${fmtProb(r.breakout.byBucket[120])}`
      : '';
    console.log(`${r.name.padEnd(12)} 시장${(r.market||'─').padEnd(6)} 평단대비${fmt(r.unrealizedRet).padStart(9)}  EMA200괴리${fmt(r.dev200).padStart(9)}  Z${r.z200.toFixed(2).padStart(6)}  스트릭${String(r.curStreak).padStart(4)}일  판단: ${v.label}${bo}`);
    okResults.push({ r, v });
  }
  okResults.sort((a, b) => (b.r.unrealizedRet ?? -Infinity) - (a.r.unrealizedRet ?? -Infinity));

  const tableHtml = okResults.map(({ r, v }) => tableRowHtml(r, v)).join('\n');
  const chartHtml = okResults.map(({ r, v }) => chartCardHtml(r, v)).join('\n');
  fs.writeFileSync('holdings_table_rows2.html', tableHtml, 'utf-8');
  fs.writeFileSync('holdings_chart_cards2.html', chartHtml, 'utf-8');
  console.error(`[산출완료] table→holdings_table_rows2.html, charts→holdings_chart_cards2.html`);

  console.log('\n' + JSON.stringify({ holdings: results.map(({ seq, ...r }) => ({ ...r, verdict: verdict(r) })) }, null, 2));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
