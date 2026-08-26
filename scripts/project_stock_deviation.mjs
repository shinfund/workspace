// 괴리율 매매전략 종합 리포트(stock-deviation_*.html) 생성 — 현재 시세 기준 전체 재분석
// 스킬: stock-deviation. 매매전략 탭(백테스트 연구자료, 2026-08-07 확정)은 정적 템플릿 그대로 유지하고,
// 차트/요약/괴리율분석/보유종목 4개 탭의 실시간 데이터(시세·Z-score·판단)만 매번 새로 계산해 채워 넣는다.
// 사용법: node scripts/project_stock_deviation.mjs <top50_cache.json 경로>
import fs from 'fs';
import https from 'https';
import { getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9' };
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';
const FAST = 5, SLOW = 20, MID = 50, CHART_LONG = 100, TREND_LONG = 200;
const Z_TH = -2, PCT_TH = 3;
const STAT_DAYS = 730, CHART_DAYS = 70;
const TOP50_PATH = process.argv[2] || 'C:/Users/shinf/Workspace/data/괴리율/top50_cache.json';

function httpGetJson(url, headers) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
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
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const data = await httpGetJson(url, YF_HEADERS);
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp?.length) return null;
      return { ts: result.timestamp, close: result.indicators?.quote?.[0]?.close || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
async function fetchChartAutoMarket(code, market) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (STAT_DAYS + TREND_LONG * 6) * 24 * 3600;
  const primary = market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
  const suffix = m => m === 'KOSDAQ' ? 'KQ' : 'KS';
  const [a, b] = await Promise.all([
    fetchYahooChart(`${code}.${suffix(primary)}`, p1, p2),
    fetchYahooChart(`${code}.${suffix(primary === 'KOSDAQ' ? 'KOSPI' : 'KOSDAQ')}`, p1, p2),
  ]);
  const aLen = a?.ts?.length || 0, bLen = b?.ts?.length || 0;
  if (aLen === 0 && bLen === 0) return null;
  return aLen >= bLen ? { chart: a, market: primary } : { chart: b, market: primary === 'KOSDAQ' ? 'KOSPI' : 'KOSDAQ' };
}
function tsToKst(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function kstTodayDate() { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
// 장중/장마감 직후 Yahoo 당일 종가 지연 보정용 KIS 당일 현재가 일괄조회(stock-baseline과 동일 기법, [[feedback_price_cross_verify]])
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
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null);
  let ema = null; const seed = [];
  for (let i = 0; i < closes.length; i++) {
    const p = closes[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
function stdev(arr, mean) { return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1)); }
function devMeanSd(devs) { const mean = devs.reduce((a, b) => a + b, 0) / devs.length; return { mean, sd: stdev(devs, mean) }; }
function zAndPctFromMeanSd(mean, sd, cur, devs) { return { z: sd ? (cur - mean) / sd : null, pct: devs.filter(d => d <= cur).length / devs.length * 100 }; }
async function batchAll(items, fn, concurrency = 6, delay = 120) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function hitZP(z, pct) { return z != null && z <= Z_TH && pct <= PCT_TH; }
function finalSignal(r) {
  const hit5 = hitZP(r.z5, r.pct5), hit20 = hitZP(r.z20, r.pct20);
  if (hit5 && hit20 && r.downTrend === true) return '매수';
  if (hit5 && hit20 && r.downTrend === false) return '보류(상승추세)';
  if (hit5 || hit20) return '관찰';
  return '─';
}
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function devClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function analyzeCommon(code, market, kisMap, todayDate) {
  const got = await fetchChartAutoMarket(code, market);
  if (!got) return { error: '데이터 조회 실패' };
  const { chart, market: usedMarket } = got;
  const dates = chart.ts.map(tsToKst);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST), ema20s = buildEma(closes, SLOW), ema50s = buildEma(closes, MID), ema100s = buildEma(closes, CHART_LONG), ema200s = buildEma(closes, TREND_LONG);
  const statCutoff = new Date(Date.now() - STAT_DAYS * 24 * 3600 * 1000);
  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    if (new Date(dates[i]) < statCutoff) continue;
    rows.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema100: ema100s[i], ema200: ema200s[i], dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100 });
  }
  if (!rows.length) return { error: '통계 대상 구간 데이터 없음' };
  // 장중/장마감 직후 Yahoo 당일 종가가 지연 반영될 수 있어, 오늘 날짜 마지막 봉은 KIS 당일 현재가로 덮어쓴다
  const lastRow = rows[rows.length - 1];
  if (lastRow.date === todayDate && kisMap?.has(code)) {
    const live = kisMap.get(code);
    lastRow.close = live;
    lastRow.dev5 = (live - lastRow.ema5) / lastRow.ema5 * 100;
    lastRow.dev20 = (live - lastRow.ema20) / lastRow.ema20 * 100;
  }
  const dev5s = rows.map(r => r.dev5), dev20s = rows.map(r => r.dev20);
  const cur = rows[rows.length - 1], prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const ms5 = devMeanSd(dev5s), ms20 = devMeanSd(dev20s);
  const s5 = zAndPctFromMeanSd(ms5.mean, ms5.sd, cur.dev5, dev5s);
  const s20 = zAndPctFromMeanSd(ms20.mean, ms20.sd, cur.dev20, dev20s);
  const downTrend = cur.ema50 != null && cur.ema200 != null ? cur.ema50 < cur.ema200 : null;
  const chartRows = rows.slice(-CHART_DAYS).filter(r => r.ema100 != null);
  // Z=-2 도달가(선형근사): dev%(price,ema 기준)가 목표 Z에 대응하는 dev%가 되는 가격 역산
  const z20TargetDev = Z_TH * ms20.sd + ms20.mean;
  const z5TargetDev = Z_TH * ms5.sd + ms5.mean;
  const z20Price = cur.ema20 * (1 + z20TargetDev / 100);
  const z5Price = cur.ema5 * (1 + z5TargetDev / 100);
  return { market: usedMarket, cur, prev, z5: s5.z, pct5: s5.pct, z20: s20.z, pct20: s20.pct, downTrend, chartRows, z20Price, z5Price };
}

// Notion 검색 인덱스 동기화 지연으로 title 등 필드가 간헐적으로 빈 값/0으로 반환되는 경우가 있어
// (holdings_report.mjs·project_holdings_deviation_stats.mjs와 동일 이슈) 의심스러운 행은 페이지 단건 재조회로 보정한다.
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
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 없음'); return { rows: [], latestDate: null }; }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) return { rows: [], latestDate: null };
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
        console.error(`[Notion] 필드 보정: ${h.code || fixed.code} → ${h.name || fixed.name}`);
      }
    }
  }
  return { rows: rows.filter(h => h.code && h.qty > 0), latestDate };
}

function verdict(r) { // 2026-08-26 손절 -15%→-12% 재조정
  if (r.unrealizedRet != null && r.unrealizedRet <= -12) return { label: '손절검토', cls: 'red' };
  if (r.breakdown5) return { label: '전량매도검토(5EMA이탈)', cls: 'red' };
  if (r.freshLeg20) return { label: '2차익절검토(20EMA돌파)', cls: 'teal' };
  if (r.aboveEma20) return { label: '홀딩(20EMA위)', cls: 'teal' };
  if (r.freshTp20) return { label: '익절검토(+20%)', cls: 'teal' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -8) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

function buildChartSvg(rows, opts) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema20, r.ema50, r.ema100));
  if (opts.avgPrice) allVals.push(opts.avgPrice, opts.slPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema100', 'gray600', '6,3', 1.3) + poly('ema50', 'teal', '6,3', 1.3) + poly('ema20', 'purple', '4,3', 1.4) + poly('ema5', 'sky', '2,2', 2.2);
  if (opts.avgPrice) {
    svg += `<line x1="${x0}" y1="${yAt(opts.avgPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.avgPrice).toFixed(1)}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<line x1="${x0}" y1="${yAt(opts.slPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.slPrice).toFixed(1)}" stroke="var(--coral)" stroke-width="1.1" stroke-dasharray="1,3"/>`;
  }
  svg += poly('close', 'txt', null, 1.7);
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function holdingCardHtml(r) {
  const v = verdict(r);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const slPrice = r.avgPrice * 0.85;
  const zpPrice = Math.min(r.z20Price, r.z5Price);
  const svg = buildChartSvg(r.chartRows, { avgPrice: r.avgPrice, slPrice });
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badgeCls}">${v.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.cur.close)}</span> <span class="sep">|</span> 평단대비 <span class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</span> <span class="sep">|</span> Z+P 신호가 <span>${fmtV(zpPrice)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA20괴리 <span class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</span> <span class="sep">|</span> Z20 <span>${r.z20 == null ? '─' : r.z20.toFixed(2)}</span> <span class="sep">|</span> P20 <span>${r.pct20.toFixed(0)}%ile</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA5괴리 <span class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</span> <span class="sep">|</span> Z5 <span>${r.z5 == null ? '─' : r.z5.toFixed(2)}</span> <span class="sep">|</span> P5 <span>${r.pct5.toFixed(0)}%ile</span></span>
        </div>
        <div class="chart-card-stats">
          <span>Z20≤-2 예상가 <span>${fmtV(r.z20Price)}</span> <span class="sep">|</span> Z5≤-2 예상가 <span>${fmtV(r.z5Price)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--${v.cls})"></i>판단 <span style="color:var(--${v.cls})">${v.label}</span></span><span><i style="background:var(--txt2)"></i>평단 <span>${fmtV(r.avgPrice)}</span></span><span><i style="background:var(--coral)"></i>손절선 <span>${fmtV(slPrice)}</span></span></div>
      </div>`;
}

function candidateCardHtml(r) {
  const svg = buildChartSvg(r.chartRows, {});
  const sig = finalSignal(r);
  const badge = sig === '매수' ? { c: 'bdg-red', t: '매수' } : sig === '보류(상승추세)' ? { c: 'bdg-amber', t: '보류(상승추세)' } : sig === '관찰' ? { c: 'bdg-teal', t: '관찰' } : { c: 'bdg-gray', t: '근접' };
  const zpPrice = Math.min(r.z20Price, r.z5Price);
  const trendCls = r.downTrend ? 'blue' : 'red';
  const trendLbl = r.downTrend ? '하락' : '상승';
  const heldBadge = r.held ? '<span class="badge bdg-teal">보유중</span>' : '';
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badge.c}">${badge.t}</span>${heldBadge}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.cur.close)}</span> <span class="sep">|</span> Z+P 신호가 <span>${fmtV(zpPrice)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA20괴리 <span class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</span> <span class="sep">|</span> Z20 <span>${r.z20 == null ? '─' : r.z20.toFixed(2)}</span> <span class="sep">|</span> P20 <span>${r.pct20.toFixed(0)}%ile</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA5괴리 <span class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</span> <span class="sep">|</span> Z5 <span>${r.z5 == null ? '─' : r.z5.toFixed(2)}</span> <span class="sep">|</span> P5 <span>${r.pct5.toFixed(0)}%ile</span></span>
        </div>
        <div class="chart-card-stats">
          <span>Z20≤-2 예상가 <span>${fmtV(r.z20Price)}</span> <span class="sep">|</span> Z5≤-2 예상가 <span>${fmtV(r.z5Price)}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--${trendCls})"></i>추세 <span>${trendLbl}</span></span></div>
      </div>`;
}

async function main() {
  const top50Raw = JSON.parse(fs.readFileSync(TOP50_PATH, 'utf8'));
  const top50 = top50Raw.map(s => ({ code: s.종목코드, name: s.종목명, market: s.시장 }));

  console.error('[조회] Notion 보유종목DB 조회 중...');
  const { rows: holdingsRaw, latestDate: holdDate } = await fetchNotionHoldings();

  const todayDate = kstTodayDate();
  const allCodes = [...new Set([...top50.map(s => s.code), ...holdingsRaw.map(h => h.code)])];
  const kisMap = await fetchKisPriceMap(allCodes);

  console.error(`[조회] TOP50 ${top50.length}종목 분석 중...`);
  const top50Results = await batchAll(top50, async s => {
    const a = await analyzeCommon(s.code, s.market, kisMap, todayDate);
    return a.error ? { ...s, error: a.error } : { ...s, ...a };
  }, 6, 120);

  console.error(`[조회] 보유종목 ${holdingsRaw.length}개 분석 중... (${holdingsRaw.map(h => h.name).join(', ')})`);
  const holdingsResults = await batchAll(holdingsRaw, async h => {
    const a = await analyzeCommon(h.code, null, kisMap, todayDate);
    if (a.error) return { ...h, error: a.error };
    const r = { ...h, ...a };
    r.unrealizedRet = h.avgPrice ? (r.cur.close - h.avgPrice) / h.avgPrice * 100 : null;
    r.aboveEma5 = r.cur.close >= r.cur.ema5;
    r.aboveEma20 = r.cur.close >= r.cur.ema20;
    const prevAboveEma5 = r.prev ? r.prev.close >= r.prev.ema5 : false;
    const prevAboveEma20 = r.prev ? r.prev.close >= r.prev.ema20 : false;
    const prevUnrealizedRet = h.avgPrice && r.prev ? (r.prev.close - h.avgPrice) / h.avgPrice * 100 : null;
    r.freshTp20 = r.unrealizedRet != null && r.unrealizedRet >= 20 && !(prevUnrealizedRet != null && prevUnrealizedRet >= 20);
    r.freshLeg20 = r.aboveEma20 && !prevAboveEma20;
    r.breakdown5 = prevAboveEma5 && !r.aboveEma5;
    return r;
  }, 5, 150);

  const holdCodes = new Set(holdingsResults.filter(h => !h.error).map(h => h.code));
  const validTop50 = top50Results.filter(r => !r.error);
  const errTop50 = top50Results.filter(r => r.error);

  // ── 매수신호(오늘 Z+P+하락추세 확정) ──
  const buySignals = validTop50.filter(r => finalSignal(r) === '매수');
  const watchSignals = validTop50.filter(r => finalSignal(r) === '관찰' || finalSignal(r) === '보류(상승추세)');

  // ── 매수신호 근접/예상 종목: 보유종목도 조건 충족 시 포함, max(z20,z5) 오름차순(둘 다 -2에 가까운 순) 상위 6 ──
  const candidates = validTop50
    .filter(r => r.z20 != null && r.z5 != null)
    .sort((a, b) => Math.max(a.z20, a.z5) - Math.max(b.z20, b.z5))
    .slice(0, 6)
    .map(r => ({ ...r, held: holdCodes.has(r.code) }));

  // ── 괴리율분석 TOP50 테이블: EMA20 Z-score 오름차순(과매도 심한 순) ──
  const sortedTop50 = [...validTop50].sort((a, b) => a.z20 - b.z20);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  // ── 차트탭 ──
  const holdingCards = holdingsResults.filter(h => !h.error).map(holdingCardHtml).join('\n');
  const candidateCards = candidates.map(candidateCardHtml).join('\n');

  // ── 요약탭: 오늘 매수 타점 ──
  let buySection;
  if (buySignals.length) {
    const rows = buySignals.map(r => `<tr><td class="l">${esc(r.name)}</td><td>${fmtV(r.cur.close)}</td><td class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</td><td>${r.z20.toFixed(2)}</td><td class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</td><td>${r.z5.toFixed(2)}</td></tr>`).join('\n          ');
    buySection = `<div class="tbl-wrap"><table><thead><tr><th class="l">종목명</th><th>현재가</th><th>EMA20괴리</th><th>Z20</th><th>EMA5괴리</th><th>Z5</th></tr></thead><tbody>\n          ${rows}\n        </tbody></table></div>`;
  } else {
    buySection = `<div class="sc-note"><b>오늘은 확정 매수신호(매수)가 0건</b>입니다. TOP50 전 종목 무신호(─) 또는 개별 조건 미충족 상태입니다.</div>`;
  }

  const eventRows = holdingsResults.filter(h => !h.error && (h.freshTp20 || h.freshLeg20 || h.breakdown5));
  const eventBullets = eventRows.map(r => {
    const evs = [];
    if (r.freshTp20) evs.push('매입가대비+20%신규도달(익절 검토)');
    if (r.freshLeg20) evs.push('EMA20 신규돌파(2차익절 검토)');
    if (r.breakdown5) evs.push('EMA5 하향이탈(잔량 전량매도 검토)');
    const dot = r.breakdown5 ? 'red' : 'teal';
    return `      <div class="ai-item"><div class="ai-dot ai-dot-${dot}"></div><div><b>${esc(r.name)}</b>: ${evs.join(', ')}</div></div>`;
  }).join('\n');

  // ── 괴리율분석 TOP50 테이블 ──
  const top50Rows = sortedTop50.map(r => {
    const sig = finalSignal(r);
    const sigBadge = sig === '매수' ? '<span class="badge bdg-red">매수</span>' : sig === '보류(상승추세)' ? '<span class="badge bdg-amber">보류(상승추세)</span>' : sig === '관찰' ? '<span class="badge bdg-teal">관찰</span>' : '─';
    return `<tr><td class="l">${esc(r.name)}</td><td class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</td><td>${r.z20.toFixed(2)}</td><td>${r.pct20.toFixed(0)}%ile</td><td class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</td><td>${r.z5.toFixed(2)}</td><td>${r.pct5.toFixed(0)}%ile</td><td class="c">${r.downTrend ? '하락' : '상승'}</td><td class="c">${sigBadge}</td></tr>`;
  }).join('\n          ');
  const top50ErrNote = errTop50.length ? `<div class="sc-note">데이터 조회 실패: ${errTop50.map(r => esc(r.name)).join(', ')} (${errTop50.length}종목, 표에서 제외)</div>` : '';

  // ── 보유종목탭 ──
  const holdRows = holdingsResults.filter(h => !h.error).map(r => {
    const v = verdict(r);
    const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
    return `<tr><td class="l">${esc(r.name)}</td><td>${r.market}</td><td class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</td><td class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</td><td>${r.z20 == null ? '─' : r.z20.toFixed(2)}</td><td>${r.pct20.toFixed(0)}%ile</td><td class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</td><td>${r.z5 == null ? '─' : r.z5.toFixed(2)}</td><td>${r.pct5.toFixed(0)}%ile</td><td class="c">${r.downTrend ? '하락' : '상승'}</td><td class="c"><span class="badge ${badgeCls}">${v.label}</span></td></tr>`;
  }).join('\n          ');

  const kpiBuy = buySignals.length;
  const kpiWatch = watchSignals.length;

  const html = renderTemplate({ todayStr, holdingCards, candidateCards, buySection, eventBullets, top50Rows, top50ErrNote, holdRows, kpiBuy, kpiWatch, holdDate });
  const outPath = `C:/Users/shinf/Workspace/data/analysis/stock-deviation_${ts}.html`;
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log('저장 완료:', outPath);
}

function renderTemplate(d) {
return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>괴리율 매매전략</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root {
  --sky:#0366D6; --sky50:#E9F1FE; --sky100:#C7DCF6; --sky600:#005CC5; --sky800:#032F62;
  --teal:#1D9E75; --teal50:#E1F5EE; --teal100:#9FE1CB; --teal600:#0F6E56;
  --coral:#D85A30; --coral50:#FAECE7; --coral100:#F5C4B3;
  --amber:#BA7517; --amber50:#FAEEDA; --amber100:#FAC775;
  --purple:#534AB7; --purple50:#EEEDFE; --purple100:#CECBF6;
  --gray50:#F1EFE8; --gray100:#D3D1C7; --gray600:#5F5E5A;
  --bg:#FFFFFF; --card:#FFFFFF; --border:#E1E4E8; --border2:#F6F8FA;
  --txt:#24292E; --txt2:#3A4453; --txt3:#6A737D;
  --red:var(--coral); --red50:var(--coral50); --blue:var(--sky); --blue50:var(--sky50);
  --hdrbg:#0C447C; --hdr-text:#fff; --hdr-text-dim:rgba(255,255,255,.85);
  --hdr-btn-bg:rgba(255,255,255,.15); --hdr-btn-border:rgba(255,255,255,.35);
  --hdr-btn-hover-bg:rgba(255,255,255,.25); --hdr-btn-text:#fff;
  --hdr-shadow:0 2px 8px rgba(12,68,124,.3);
  --r6:6px; --r8:8px; --r10:10px; --r12:12px; --r14:14px; --r16:16px; --r20:20px;
  --shadow:none;
  --shadow-h:0 20px 60px rgba(0,0,0,.2);
}
html[data-theme="light"]{
  --hdrbg:#FFFFFF; --hdr-text:#032F62; --hdr-text-dim:#355E82;
  --hdr-btn-bg:#E6F1FB; --hdr-btn-border:#B7CEE8; --hdr-btn-hover-bg:#D3E7FA; --hdr-btn-text:#005CC5;
  --hdr-shadow:0 2px 8px rgba(12,68,124,.12);
}
html[data-theme="dark"]{
  --bg:#24292E; --card:#1C2024;
  --border:rgba(255,255,255,.13); --border2:rgba(255,255,255,.09);
  --txt:rgba(255,255,255,.92); --txt2:rgba(255,255,255,.75); --txt3:rgba(255,255,255,.5);
  --shadow:none; --shadow-h:0 20px 60px rgba(0,0,0,.5);
  --hdrbg:#24292E; --hdr-shadow:0 2px 10px rgba(0,0,0,.4);
  --sky:#2E8FFF; --sky50:rgba(46,143,255,.16); --sky100:rgba(46,143,255,.32); --sky600:#79B8FF; --sky800:#C8E1FF;
  --teal:#4FD8AC; --teal50:rgba(29,158,117,.16); --teal100:rgba(29,158,117,.32); --teal600:#4FD8AC;
  --coral:#F2896A; --coral50:rgba(216,90,48,.16); --coral100:rgba(216,90,48,.32);
  --amber:#E8A93D; --amber50:rgba(186,117,23,.22); --amber100:rgba(186,117,23,.38);
  --purple:#B4A6FF; --purple50:rgba(83,74,183,.26); --purple100:rgba(83,74,183,.4);
  --gray50:rgba(255,255,255,.10); --gray600:#C9C7BF;
  --red:var(--coral); --red50:var(--coral50); --blue:var(--sky); --blue50:var(--sky50);
}
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans KR','Pretendard',-apple-system,BlinkMacSystemFont,sans-serif;font-size:14.5px;background:var(--bg);color:var(--txt);word-break:keep-all}
.hdr-wrap{position:fixed;top:0;left:0;right:0;z-index:50;box-shadow:var(--hdr-shadow);transition:background .18s ease}
.header{background:var(--hdrbg);padding:max(12px,env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;justify-content:space-between;transition:background .18s ease}
.header-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0;overflow:hidden}
.logo-mark{width:34px;height:34px;background:linear-gradient(155deg,#7FB4FF 0%,#0366D6 55%,#032F62 100%);border-radius:var(--r8);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(3,102,214,.35)}
.logo-info{display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden}
.logo-title{font-size:17px;font-weight:800;color:var(--hdr-text);letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .18s ease}
.logo-sub{font-size:13px;color:var(--hdr-text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .18s ease}
.header-right{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:10px}
.hdr-date{font-size:13.5px;font-weight:700;color:var(--hdr-text);white-space:nowrap;transition:color .18s ease}
.hdr-btn{background:var(--hdr-btn-bg);border:1px solid var(--hdr-btn-border);color:var(--hdr-btn-text);font-size:13px;font-weight:700;padding:6px 12px;border-radius:16px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .12s}
.hdr-btn:hover{background:var(--hdr-btn-hover-bg)}
.top-nav{background:var(--card);border-bottom:1.5px solid var(--border);display:flex;padding:0 4px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.top-nav::-webkit-scrollbar{display:none}
.tab-btn{flex:1;flex-shrink:0;min-width:64px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--txt);font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;padding:13px 6px;touch-action:manipulation;transition:color .15s;position:relative;white-space:nowrap}
.tab-btn.on{color:var(--sky600)}
.tab-btn.on::after{content:'';position:absolute;bottom:0;left:8%;right:8%;height:2.5px;background:var(--sky);border-radius:2px 2px 0 0}
.nav-spacer{height:calc(104px + env(safe-area-inset-top,0px))}
.wrap{max-width:1100px;margin:0 auto}
.main{padding:0 16px max(20px,env(safe-area-inset-bottom))}
.panel{display:none}
.panel.on{display:block;animation:fade .22s}
@keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.kpi-row{display:flex;gap:9px;margin-bottom:14px;padding-top:10px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:100px;background:var(--card);border:1px solid var(--border);border-radius:var(--r12);padding:12px 10px;text-align:center;box-shadow:var(--shadow)}
.kpi-card .num{font-size:20px;font-weight:800;line-height:1.1}
.kpi-card .lbl{font-size:13.5px;margin-top:4px;font-weight:700;color:var(--txt)}
.kpi-sky .num,.kpi-sky .lbl{color:var(--sky600)}
.kpi-red .num,.kpi-red .lbl{color:var(--red)}
.kpi-teal .num,.kpi-teal .lbl{color:var(--teal600)}
.kpi-coral .num,.kpi-coral .lbl{color:var(--coral)}
.kpi-amber .num,.kpi-amber .lbl{color:var(--amber)}
.kpi-purple .num,.kpi-purple .lbl{color:var(--purple)}
.sc{background:var(--card);border-radius:var(--r12);border:1px solid var(--border);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.sc-title{font-size:14.5px;font-weight:800;color:var(--txt);margin-bottom:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.sc-title .sub{font-size:13.5px;font-weight:600;color:var(--txt2)}
.sc-note{font-size:14px;color:var(--txt2);margin-bottom:12px;line-height:1.6;padding:8px 10px;background:var(--bg);border-radius:var(--r8)}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r8);overscroll-behavior-x:contain;margin-bottom:8px}
table{min-width:100%;border-collapse:collapse;font-size:13.5px}
thead th{background:var(--sky50);color:var(--sky800);font-weight:800;font-size:13.5px;padding:9px 8px;text-align:right;white-space:nowrap}
thead th.l{text-align:left} thead th.c{text-align:center}
tbody td{padding:9px 8px;border-bottom:1px solid var(--border2);text-align:right;white-space:nowrap;color:var(--txt)}
tbody td.l{text-align:left} tbody td.c{text-align:center}
tbody tr:hover{background:var(--sky50)}
.stock-cards{display:none}
.stock-cards-target{display:block}
.stock-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:13px 14px;margin-bottom:10px}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:16px}
.chart-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:12px 14px 14px}
.chart-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px;flex-wrap:wrap}
.chart-card-name{font-size:15px;font-weight:800;color:var(--txt)}
.chart-card-stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:9px;font-size:14px;color:var(--txt)}
.chart-card-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;padding-top:7px;border-top:1px solid var(--border);font-size:13.5px;color:var(--txt)}
.chart-card-legend b{color:var(--txt);font-weight:800}
.chart-card-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
.chart-card-stats b{color:var(--txt);font-weight:800}
.chart-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:14px;color:var(--txt);margin-bottom:12px;padding:8px 10px;background:var(--bg);border-radius:var(--r8)}
.chart-legend span{display:inline-flex;align-items:center;gap:5px}
.chart-legend i{display:inline-block;width:16px;height:0;border-top:2px solid}
.chart-legend i.dash{border-top-style:dashed}
.sc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:4px}
.sc-name{font-size:15px;font-weight:800;color:var(--txt)}
.sc-ratio{font-size:16px;font-weight:900}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
.sc-item{display:flex;flex-direction:column;gap:1px}
.sc-item-l{font-size:13px;color:var(--txt2);font-weight:700}
.sc-item-v{font-size:14.5px;font-weight:700;color:var(--txt)}
.t-neg-hi{color:var(--blue);font-weight:800}
.t-neg{color:var(--blue);font-weight:700}
.t-pos{color:var(--red);font-weight:800}
.t-flat{color:var(--txt2);font-weight:600}
.badge{font-size:12.5px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap}
.bdg-red{background:var(--red50);color:var(--red)}
.bdg-blue{background:var(--blue50);color:var(--blue)}
.bdg-sky{background:var(--sky50);color:var(--sky600)}
.bdg-teal{background:var(--teal50);color:var(--teal600)}
.bdg-amber{background:var(--amber50);color:var(--amber)}
.bdg-coral{background:var(--coral50);color:var(--coral)}
.bdg-gray{background:var(--gray50);color:var(--gray600)}
.bdg-purple{background:var(--purple50);color:var(--purple)}
.ai-sc{background:linear-gradient(135deg,var(--sky50) 0%,var(--card) 100%);border:1px solid var(--sky100);border-left:4px solid var(--sky);border-radius:var(--r12);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.ai-title{font-size:14.5px;font-weight:800;color:var(--sky800);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.ai-badge{margin-left:auto}
.ai-list{display:flex;flex-direction:column;gap:7px}
.ai-item{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--txt);line-height:1.55}
.ai-dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:8px}
.ai-dot-red{background:var(--red)} .ai-dot-teal{background:var(--teal)} .ai-dot-sky{background:var(--sky)}
.ai-dot-amber{background:var(--amber)} .ai-dot-purple{background:var(--purple)}
.date-hdr{display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--border)}
.date-hdr .date-lbl{font-size:14px;font-weight:800;color:var(--sky800)}
.date-hdr .date-tag{font-size:12.5px;font-weight:700;padding:2px 9px;border-radius:9px;background:var(--sky50);color:var(--sky600)}
.date-hdr .date-tag.today{background:var(--sky);color:#fff}
.plist{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.plist li{display:flex;gap:8px;font-size:14.5px;line-height:1.6;color:var(--txt)}
.plist .pn{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--sky);color:#fff;font-size:12.5px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}
.rule-box{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:12px 14px;margin-bottom:10px}
.rule-box .rb-title{font-size:14.5px;font-weight:800;color:var(--sky800);margin-bottom:6px}
.rule-box .rb-body{font-size:14px;color:var(--txt2);line-height:1.6}
#settingsModal{display:none;position:fixed;inset:0;z-index:100}
#settingsModal.modal-open{display:block}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}
.modal-box{background:var(--card);border-radius:var(--r16);padding:20px;width:100%;max-width:320px;box-shadow:var(--shadow-h)}
.modal-title{font-size:16px;font-weight:800;color:var(--txt);margin-bottom:14px}
.modal-section{font-size:13.5px;font-weight:700;color:var(--txt2);margin-bottom:8px}
.theme-opts{display:flex;gap:10px}
.theme-opt{flex:1;cursor:pointer;text-align:center;padding:8px;border-radius:var(--r12);border:2px solid var(--border);position:relative;transition:border-color .12s}
.theme-opt.on{border-color:var(--sky)}
.theme-opt.on::after{content:'✓';position:absolute;top:5px;right:7px;width:16px;height:16px;background:var(--sky);color:#fff;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center}
.theme-swatch{width:100%;height:50px;border-radius:8px;border:1px solid var(--border2);margin-bottom:6px;position:relative;overflow:hidden}
.theme-swatch-dark{background:#24292E}
.theme-swatch-light{background:#FFFFFF}
.theme-swatch-dark .ts-side{background:#24292E;border-right:1px solid rgba(255,255,255,.08)}
.theme-swatch-light .ts-side{background:#FFFFFF;border-right:1px solid #DCE9F7}
.ts-side{position:absolute;left:0;top:0;bottom:0;width:30%}
.theme-opt-label{font-size:13px;font-weight:700;color:var(--txt)}
@media(max-width:374px){.logo-sub{display:none} .tab-btn{font-size:13px;padding:11px 2px;min-width:52px} .kpi-card .num{font-size:16px} .kpi-card .lbl{font-size:12px}}
@media(max-width:600px){
  .nav-spacer{height:calc(108px + env(safe-area-inset-top,0px))}
  .main{padding:0 10px max(20px,env(safe-area-inset-bottom))}
  .sc{padding:12px 12px} .tab-btn{font-size:13.5px;padding:12px 4px}
  .kpi-card .num{font-size:18px} .kpi-card .lbl{font-size:13px}
  table{font-size:13px} thead th,tbody td{padding:8px 5px}
  .stock-cards{display:block} .stock-cards-target{display:none}
  .hdr-date{display:none}
}
@media(min-width:769px){
  .nav-spacer{height:calc(106px + env(safe-area-inset-top,0px))}
  .main{padding:0 20px max(20px,env(safe-area-inset-bottom))}
  .sc{padding:18px 20px} .sc-title{font-size:15px}
  .kpi-card .num{font-size:22px} .kpi-card .lbl{font-size:14px}
  table{font-size:14px} thead th,tbody td{padding:10px 9px}
}
@media(min-width:1024px){.kpi-row{gap:12px} .kpi-card .num{font-size:24px}}
thead th{font-weight:400}
html[data-theme="dark"] thead th{color:#fff}
tbody td.t-pos,tbody td.t-neg,tbody td.t-neg-hi,tbody td.t-flat{font-weight:400}
.chart-card-stats .t-pos,.chart-card-stats .t-neg,.chart-card-stats .t-neg-hi,.chart-card-stats .t-flat{font-weight:400}
html[data-theme="dark"]{--txt2:#fff;--txt3:rgba(255,255,255,.92)}
html[data-theme="dark"] .tab-btn.on{color:#fff}
.chart-card-stats .sep{color:var(--gray600);font-weight:400;margin:0 1px}
.chart-legend i{width:22px;border-top-width:3px}
.chart-legend span:not(:last-child){border-right:1.5px solid var(--gray600);padding-right:12px}
</style>
</head>
<body>
<script>(function(){try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'dark');}catch(e){}})();</script>

<div id="settingsModal">
  <div class="modal-backdrop" onclick="closeSettingsModal()">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div class="modal-title">설정</div>
      <div class="modal-section">화면모드</div>
      <div class="theme-opts">
        <div class="theme-opt" id="theme-opt-dark" onclick="setTheme('dark')">
          <div class="theme-swatch theme-swatch-dark"><span class="ts-side"></span></div>
          <div class="theme-opt-label">다크</div>
        </div>
        <div class="theme-opt" id="theme-opt-light" onclick="setTheme('light')">
          <div class="theme-swatch theme-swatch-light"><span class="ts-side"></span></div>
          <div class="theme-opt-label">라이트</div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="hdr-wrap">
  <div class="header">
    <div class="header-left">
      <div class="logo-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8.3 12 15l-3-3-3.7 3.7"/></svg>
      </div>
      <div class="logo-info">
        <div class="logo-title">괴리율 매매전략</div>
        <div class="logo-sub">EMA5+EMA20 · 하락추세필터 · 시가총액TOP50</div>
      </div>
    </div>
    <div class="header-right">
      <div class="hdr-date">${d.todayStr}</div>
      <button class="hdr-btn" onclick="openSettingsModal()">⚙ 설정</button>
    </div>
  </div>
  <nav class="top-nav">
    <button class="tab-btn on" data-tab="0">차트</button>
    <button class="tab-btn" data-tab="1">매매전략</button>
    <button class="tab-btn" data-tab="2">요약</button>
    <button class="tab-btn" data-tab="3">괴리율분석</button>
    <button class="tab-btn" data-tab="4">보유종목</button>
  </nav>
</div>
<div class="nav-spacer"></div>

<div class="wrap"><div class="main">

<div class="panel on" id="p0">
  <div class="sc">
    <div class="sc-title">보유종목 ${d.holdingCards ? d.holdingCards.split('chart-card-head').length - 1 : 0}종목 — 매수/매도 전략 반영 차트 <span class="sub">최근 70거래일 · ${d.todayStr} 종가 기준(장중)</span></div>
    <div class="chart-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--purple)"></i>EMA20</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA50</span><span><i class="dash" style="border-color:var(--teal)"></i>EMA100</span><span><i class="dash" style="border-color:var(--txt2)"></i>평단</span><span><i class="dash" style="border-color:var(--coral)"></i>손절선(평단-15%)</span><span style="color:var(--txt)">판단(손절/전량매도/홀딩/익절·2차익절검토/주의/관찰)은 2026-08-10 확정 3단계 매도규칙(+20%익절→EMA20돌파→EMA5하향이탈) 기준, 정확한 가격은 카드 하단 참조</span></div>
    <div class="chart-grid">
${d.holdingCards}
    </div>
  </div>
  <div class="sc">
    <div class="sc-title">매수신호 근접/예상 종목 <span class="sub">보유종목 제외 TOP50 중 Z-score가 -2에 가장 가까운 상위 6종목</span></div>
    <div class="chart-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--purple)"></i>EMA20</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA50</span><span><i class="dash" style="border-color:var(--teal)"></i>EMA100</span><span style="color:var(--txt)">보유 포지션이 없어 평단·손절선은 표시하지 않음. "관찰"=EMA5·EMA20 중 하나만 신호 충족, "보류(상승추세)"=둘 다 충족했으나 장기추세가 상승, "근접"=아직 신호 미충족이나 Z-score가 -2에 가까운 종목</span></div>
    <div class="chart-grid">
${d.candidateCards}
    </div>
  </div>
</div>

<div class="panel" id="p1">
  <div class="sc">
    <div class="sc-title">매수/매도 전략 예시 <span class="sub">합성 예시 곡선(설명용) — 실선=종가, 점선(하늘)=EMA5, 점선(보라)=EMA20, 점선(청록)=EMA50, 점선(주황)=EMA200</span></div>
    <div class="chart-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--purple)"></i>EMA20</span><span><i class="dash" style="border-color:var(--teal)"></i>EMA50(장기)</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA200(장기)</span><span style="color:var(--txt)">①매수(Z+P신호: EMA5·EMA20 각각 Z≤-2&위치≤3%ile AND EMA50&lt;EMA200 하락추세) ②매입가 대비 +20%→50%매도(익절) ③EMA20 상향돌파→잔량50%(전체25%)매도 ④EMA5 하향이탈→잔량 전량매도</span></div>
    <svg viewBox="0 0 680 380" width="100%" height="380" style="display:block;max-width:100%">
    <polyline points="54.0,100.3 62.3,101.9 70.6,103.4 78.9,104.9 87.2,106.5 95.5,108.0 103.8,109.5 112.1,111.1 120.4,112.6 128.7,114.1 137.0,115.6 145.3,117.2 153.6,118.7 161.9,120.2 170.2,121.8 178.5,123.3 186.8,124.8 195.1,126.4 203.4,127.9 211.7,129.4 220.0,131.0 228.3,132.5 236.6,134.0 244.9,135.5 253.2,137.1 261.5,138.6 269.8,140.1 278.1,141.7 286.4,143.2 294.7,144.7 303.0,146.3 311.3,147.8 319.6,149.3 327.9,150.8 336.2,152.4 344.5,153.9 352.8,155.4 361.2,157.0 369.5,158.5 377.8,160.0 386.1,161.6 394.4,163.1 402.7,164.6 411.0,166.1 419.3,167.7 427.6,169.2 435.9,170.7 444.2,172.3 452.5,173.8 460.8,175.3 469.1,176.9 477.4,178.4 485.7,179.9 494.0,181.5 502.3,183.0 510.6,184.5 518.9,186.0 527.2,187.6 535.5,189.1 543.8,190.6 552.1,192.2 560.4,193.7 568.7,195.2 577.0,196.8 585.3,198.3 593.6,199.8 601.9,201.3 610.2,202.9 618.5,204.4 626.8,205.9 635.1,207.5 643.4,209.0 651.7,210.5 660.0,212.1" fill="none" stroke="var(--amber)" stroke-width="1.4" stroke-dasharray="7,4"/>
    <polyline points="54.0,122.6 62.3,124.3 70.6,125.9 78.9,127.6 87.2,129.3 95.5,131.0 103.8,132.6 112.1,134.3 120.4,136.0 128.7,137.6 137.0,139.3 145.3,141.0 153.6,142.6 161.9,144.3 170.2,146.0 178.5,147.6 186.8,149.3 195.1,151.0 203.4,152.7 211.7,154.3 220.0,156.0 228.3,157.7 236.6,159.3 244.9,161.0 253.2,162.7 261.5,164.3 269.8,166.0 278.1,167.7 286.4,169.3 294.7,171.0 303.0,172.7 311.3,174.4 319.6,176.0 327.9,177.7 336.2,179.4 344.5,181.0 352.8,182.7 361.2,184.4 369.5,186.0 377.8,187.7 386.1,189.4 394.4,191.1 402.7,192.7 411.0,194.4 419.3,196.1 427.6,197.7 435.9,199.4 444.2,201.1 452.5,202.7 460.8,204.4 469.1,206.1 477.4,207.7 485.7,209.4 494.0,211.1 502.3,212.8 510.6,214.4 518.9,216.1 527.2,217.8 535.5,219.4 543.8,221.1 552.1,222.8 560.4,224.4 568.7,226.1 577.0,227.8 585.3,229.4 593.6,231.1 601.9,232.8 610.2,234.5 618.5,236.1 626.8,237.8 635.1,239.5 643.4,241.1 651.7,242.8 660.0,244.5" fill="none" stroke="var(--teal)" stroke-width="1.4" stroke-dasharray="7,4"/>
    <polyline points="211.7,188.3 220.0,193.9 228.3,199.6 236.6,204.8 244.9,209.4 253.2,213.6 261.5,217.4 269.8,220.7 278.1,223.7 286.4,226.4 294.7,228.6 303.0,230.6 311.3,232.2 319.6,233.6 327.9,234.6 336.2,235.4 344.5,235.9 352.8,236.2 361.2,236.1 369.5,235.9 377.8,235.3 386.1,234.6 394.4,233.5 402.7,232.3 411.0,230.8 419.3,229.0 427.6,227.1 435.9,224.8 444.2,222.4 452.5,219.7 460.8,216.8 469.1,213.6 477.4,210.2 485.7,206.6 494.0,202.8 502.3,198.7 510.6,194.3 518.9,190.4 527.2,186.8 535.5,183.5 543.8,180.5 552.1,177.7 560.4,175.1 568.7,172.7 577.0,171.1 585.3,170.2 593.6,169.9 601.9,170.2 610.2,171.0 618.5,172.2 626.8,173.8 635.1,175.8 643.4,178.2 651.7,180.8 660.0,183.8" fill="none" stroke="var(--purple)" stroke-width="1.6" stroke-dasharray="5,3"/>
    <polyline points="87.2,147.6 95.5,153.2 103.8,158.8 112.1,164.3 120.4,169.9 128.7,175.5 137.0,181.0 145.3,186.6 153.6,192.2 161.9,197.7 170.2,201.4 178.5,206.0 186.8,211.2 195.1,216.9 203.4,222.7 211.7,228.8 220.0,234.9 228.3,241.2 236.6,245.3 244.9,248.1 253.2,249.9 261.5,251.0 269.8,251.5 278.1,251.7 286.4,251.6 294.7,251.2 303.0,250.5 311.3,249.6 319.6,248.6 327.9,247.3 336.2,245.8 344.5,244.1 352.8,242.2 361.2,240.1 369.5,237.8 377.8,235.3 386.1,232.6 394.4,229.7 402.7,226.5 411.0,223.2 419.3,219.6 427.6,215.8 435.9,211.8 444.2,207.6 452.5,203.1 460.8,198.4 469.1,193.5 477.4,188.4 485.7,183.0 494.0,177.4 502.3,171.5 510.6,165.4 518.9,161.3 527.2,158.4 535.5,156.3 543.8,154.7 552.1,153.5 560.4,152.5 568.7,151.8 577.0,153.2 585.3,156.0 593.6,159.7 601.9,164.0 610.2,168.8 618.5,173.8 626.8,179.0 635.1,184.3 643.4,189.7 651.7,195.2 660.0,200.7" fill="none" stroke="var(--sky)" stroke-width="2.2" stroke-dasharray="2,2"/>
    <polyline points="54.0,136.5 62.3,142.1 70.6,147.6 78.9,153.2 87.2,158.8 95.5,164.3 103.8,169.9 112.1,175.5 120.4,181.0 128.7,186.6 137.0,192.2 145.3,197.7 153.6,203.3 161.9,208.9 170.2,208.9 178.5,215.3 186.8,221.7 195.1,228.1 203.4,234.5 211.7,240.9 220.0,247.3 228.3,253.7 236.6,253.7 244.9,253.6 253.2,253.4 261.5,253.1 269.8,252.7 278.1,252.1 286.4,251.3 294.7,250.3 303.0,249.2 311.3,247.9 319.6,246.4 327.9,244.7 336.2,242.8 344.5,240.7 352.8,238.4 361.2,235.9 369.5,233.2 377.8,230.3 386.1,227.2 394.4,223.8 402.7,220.3 411.0,216.5 419.3,212.5 427.6,208.3 435.9,203.8 444.2,199.1 452.5,194.2 460.8,189.1 469.1,183.7 477.4,178.1 485.7,172.2 494.0,166.1 502.3,159.8 510.6,153.2 518.9,153.2 527.2,152.7 535.5,152.1 543.8,151.5 552.1,151.0 560.4,150.4 568.7,150.4 577.0,156.0 585.3,161.6 593.6,167.1 601.9,172.7 610.2,178.3 618.5,183.8 626.8,189.4 635.1,194.9 643.4,200.5 651.7,206.1 660.0,211.6" fill="none" stroke="var(--txt)" stroke-width="2.2"/>

    <line x1="228.3" y1="253.7" x2="228.3" y2="278.0" stroke="var(--teal)" stroke-width="1" stroke-dasharray="2,2"/>
    <circle cx="228.3" cy="253.7" r="6" fill="var(--teal)" stroke="var(--card)" stroke-width="1.5"/>
    <text x="228.3" y="304.0" font-size="13" font-weight="700" fill="var(--teal)" text-anchor="middle">①</text>
    <text x="228.3" y="320.0" font-size="12" fill="var(--txt2)" text-anchor="middle">매수(Z+P신호)</text>

    <line x1="286.4" y1="251.3" x2="286.4" y2="50.0" stroke="var(--red)" stroke-width="1" stroke-dasharray="2,2"/>
    <circle cx="286.4" cy="251.3" r="6" fill="var(--red)" stroke="var(--card)" stroke-width="1.5"/>
    <text x="286.4" y="40.0" font-size="13" font-weight="700" fill="var(--red)" text-anchor="middle">②</text>
    <text x="286.4" y="56.0" font-size="12" fill="var(--txt2)" text-anchor="middle">+20%익절(50%매도)</text>

    <line x1="361.2" y1="235.9" x2="361.2" y2="278.0" stroke="var(--red)" stroke-width="1" stroke-dasharray="2,2"/>
    <circle cx="361.2" cy="235.9" r="6" fill="var(--red)" stroke="var(--card)" stroke-width="1.5"/>
    <text x="361.2" y="304.0" font-size="13" font-weight="700" fill="var(--red)" text-anchor="middle">③</text>
    <text x="361.2" y="320.0" font-size="12" fill="var(--txt2)" text-anchor="middle">EMA20돌파(25%매도)</text>

    <line x1="577.0" y1="156.0" x2="577.0" y2="50.0" stroke="var(--coral)" stroke-width="1" stroke-dasharray="2,2"/>
    <circle cx="577.0" cy="156.0" r="6" fill="var(--coral)" stroke="var(--card)" stroke-width="1.5"/>
    <text x="577.0" y="40.0" font-size="13" font-weight="700" fill="var(--coral)" text-anchor="middle">④</text>
    <text x="577.0" y="56.0" font-size="12" fill="var(--txt2)" text-anchor="middle">EMA5이탈(잔량매도)</text>
  </svg>
    <div class="sc-note">진입은 EMA5·EMA20 각각 Z≤-2 & 위치≤3%ile 동시충족 AND 장기하락추세일 때(①), 청산은 반등 과정에서 더 민감한 EMA5를 먼저 넘으면 절반을 팔아 이익을 조기 확정하고(②), 이어서 더 완만한 EMA20까지 넘으면 잔량의 절반(전체 25%)을 추가로 팔아(③) 추세 지속 여부를 확인합니다. 남은 25%는 EMA5 아래로 다시 꺾이기 전까지 홀딩하다가, 하향 이탈하는 시점(④)에 전량 정리합니다. 손절(-15%)은 이 4단계와 무관하게 항상 최우선 적용됩니다.</div>
  </div>

  <div class="sc">
    <div class="sc-title">청산구조 비교: 3단계 vs 2단계 대안 <span class="sub">TOP50 · 3년(calendarDays 1100) · 하락추세 필터 적용 전 · 2026-08-07</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">구조</th><th>표본(n)</th><th>가중평균</th><th>승률</th><th>최저</th><th>SL건수</th></tr></thead>
        <tbody>
          <tr><td class="l"><b>3단계(EMA5→EMA20→EMA5하향이탈, 확정)</b></td><td><b>232</b></td><td class="t-pos"><b>+4.44%</b></td><td><b>74%</b></td><td class="t-neg">-21.78%</td><td><b>36건</b></td></tr>
          <tr><td class="l">2단계(EMA20돌파50%→EMA5하향이탈시 전량)</td><td>232</td><td class="t-pos">+3.79%</td><td>69%</td><td class="t-neg">-27.17%</td><td>36건</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sc-note"><b>핵심 발견</b>: 두 구조의 SL(-15%) 발생건수가 완전히 동일(36건)합니다. 손절 여부는 진입가 대비 가격 경로에만 좌우되고 청산 단계 구조와는 무관하다는 뜻입니다. 5EMA에서 조기에 50%를 팔아 이익을 미리 확정하는 3단계 구조가 평균수익률·승률·최대손실 모두 우세해 최종 채택했습니다. "SL비율을 낮추려면 청산 구조가 아니라 진입 필터를 강화해야 한다"는 결론이 아래 하락추세 필터 도입으로 이어졌습니다.</div>
  </div>

  <div class="sc">
    <div class="sc-title">장기추세 필터 검토 <span class="sub">TOP50 · 7년 · 5+20EMA 기저신호에 사후분류 · 2026-08-07</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">필터</th><th>표본(n)</th><th>전체대비</th><th>평균</th><th>승률</th><th>SL비율</th></tr></thead>
        <tbody>
          <tr><td class="l">필터 없음(기저)</td><td>586</td><td>100%</td><td class="t-pos">+3.49%</td><td>75%</td><td>9%</td></tr>
          <tr><td class="l">종가≥EMA50</td><td>8</td><td>1%</td><td class="t-neg">-3.20%</td><td>50%</td><td>38%</td></tr>
          <tr><td class="l">종가≥EMA200</td><td>189</td><td>32%</td><td class="t-pos">+2.74%</td><td>69%</td><td>19%</td></tr>
          <tr><td class="l">EMA50≥EMA200(상승추세)</td><td>392</td><td>67%</td><td class="t-pos">+3.28%</td><td>73%</td><td>13%</td></tr>
          <tr><td class="l">완전정배열(50≥100≥200)</td><td>338</td><td>58%</td><td class="t-pos">+3.22%</td><td>72%</td><td>13%</td></tr>
          <tr><td class="l"><b>EMA50&lt;EMA200(하락추세, 확정)</b></td><td><b>194</b></td><td><b>33%</b></td><td class="t-pos"><b>+3.90%</b></td><td><b>80%</b></td><td><b>3%</b></td></tr>
        </tbody>
      </table>
    </div>
    <div class="sc-note"><b>가설과 반대 방향</b>: "장기 상승추세일 때만 매수하면 좋을 것"이라는 최초 가설과 정반대로, 하락추세 구간의 신호가 승률·SL비율 모두 최우수였습니다. 해석: 이 전략은 단기 급락 후 반등을 노리는 역추세(평균회귀) 전략이라, 이미 장기 하락추세인 종목의 단기 극과매도는 흔한 데드캣바운스로 반등신뢰도가 높은 반면, 장기 상승추세 종목이 갑자기 단기 극과매도까지 빠지는 것은 추세를 깨는 이례적 악재(실적쇼크 등)일 가능성이 높아 오히려 손절로 이어지기 쉽습니다.</div>
    <div class="sc-note"><b>강건성 검증(연도별)</b>: 2021년(하락추세 n=14·승률86%·SL0% vs 상승추세 n=44·승률80%·SL5%), 2022년(n=100·69%·5% vs n=46·59%·9%), 2023년(n=23·91%·0% vs n=34·74%·9%), 2024년(n=27·93%·0% vs n=104·85%·6%), 2025년(n=22·95%·0% vs n=31·74%·3%), 2026년(n=8·88%·13% vs n=129·65%·<b>26%</b>) — 매년 하락추세 구간이 우세하며, 특히 2026년 폭락장에서 상승추세 구간 SL비율이 26%까지 급등해 격차가 더 벌어짐. <b>종목 편중 없음</b>: 하락추세 필터 신호 194건 중 상위10종목(LG화학·삼성SDI·SK 등) 합계 44%.</div>
  </div>

  <div class="sc">
    <div class="sc-title">최종 확정 백테스트 결과 <span class="sub">TOP50 · 7년(calendarDays 2555) · SL-15% · 익절+20% · 최대20거래일 · 2026-08-10 신규청산</span></div>
    <div class="kpi-row">
      <div class="kpi-card kpi-sky"><div class="num">177</div><div class="lbl">표본(n)</div></div>
      <div class="kpi-card kpi-teal"><div class="num">+6.27%</div><div class="lbl">가중평균</div></div>
      <div class="kpi-card kpi-purple"><div class="num">+5.45%</div><div class="lbl">중앙값</div></div>
      <div class="kpi-card kpi-red"><div class="num">73%</div><div class="lbl">승률</div></div>
      <div class="kpi-card kpi-amber"><div class="num">3%</div><div class="lbl">SL비율</div></div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">레그(leg)</th><th class="l">의미</th><th>건수</th></tr></thead>
        <tbody>
          <tr><td class="l">TP20</td><td class="l">진입가 대비 +20% 익절(1차 매도 50%)</td><td>30건</td></tr>
          <tr><td class="l">LEG20</td><td class="l">EMA20 돌파(2차 매도, 잔량25%)</td><td>30건</td></tr>
          <tr><td class="l">BREAKDOWN</td><td class="l">EMA5 하향이탈(잔량 전량매도)</td><td>20건</td></tr>
          <tr><td class="l">TIME</td><td class="l">시간청산(20거래일)</td><td>152건</td></tr>
          <tr><td class="l">SL</td><td class="l">손절(-15%)</td><td>5건</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sc-note"><b>구규칙(1차매도=EMA5돌파) 대비 변화</b>: 가중평균 +3.92%→+6.27%(개선), 승률 79%→73%(악화), 평균종결일 16.3→19.0거래일(길어짐). 원인: 신규 규칙의 +20% 익절 문턱을 못 넘는 트레이드가 83%(147/177)에 달해 대부분 20거래일 시간청산까지 감(구규칙은 TIME이 40%뿐, 대부분 EMA5는 금방 돌파해 조기 절반매도). SL 발생건수는 5건으로 구규칙(5~6건 수준)과 비슷해 "SL비율은 청산구조가 아닌 진입품질이 결정한다"는 기존 결론과 일치. 승률 하락과 시간청산 의존도 상승은 실전 적용 시 참고할 트레이드오프.</div>
  </div>

  <div class="sc">
    <div class="sc-title">포트폴리오 시뮬레이션 <span class="sub">2026-08-10 신규 청산규칙(+20%익절) · TOP50 · 7년(2019-09-09~2026-08-10)</span></div>
    <div class="kpi-row">
      <div class="kpi-card kpi-teal"><div class="num">209.66</div><div class="lbl">최종 포트폴리오 지수</div></div>
      <div class="kpi-card kpi-sky"><div class="num">+109.66%</div><div class="lbl">누적수익률</div></div>
      <div class="kpi-card kpi-coral"><div class="num">-5.89%</div><div class="lbl">최대낙폭(MDD)</div></div>
      <div class="kpi-card kpi-purple"><div class="num">132건</div><div class="lbl">청산완료(승률73%)</div></div>
    </div>
    <div class="sc-note">레그별: SL 5건 / TP20 23건 / LEG20 20건 / BREAKDOWN 14건 / TIME 113건. 미청산 4건, 매수포기 4건(클러스터혼잡1·현금부족3). 구규칙(2026-08-07, EMA5돌파 1차매도, 7년 기준) 대비: 지수 +109.66% vs +61.99%, MDD -5.89% vs -6.40% — 개별신호 백테스트와 마찬가지로 평균수익 개선이 지수 성과에도 반영됨. 단, 승률은 개별신호 기준 73%로 구규칙(79%)보다 낮아 계좌 변동성 체감은 커질 수 있습니다.</div>
  </div>

  <div class="sc">
    <div class="sc-title">포지션 사이징 규칙 상세</div>
    <div class="rule-box">
      <div class="rb-body">종목당 기본 자산의 <b>10%</b> 배분, 1주 가격이 이보다 비싸면 최대 <b>25%</b>까지 상향해 최소 1주 매수 보장. 같은 날 여러 신호가 겹치는 클러스터는 그 날 신규진입 총 배분이 자산의 <b>40%</b>를 넘지 않도록 비례 축소(축소 후 1주도 못 사면 "클러스터혼잡"으로 제외).</div>
    </div>
  </div>
</div>

<div class="panel" id="p2">
  <div class="kpi-row">
    <div class="kpi-card kpi-red"><div class="num">${d.kpiBuy}</div><div class="lbl">매수 타점(Z+P+하락추세)</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${d.kpiWatch}</div><div class="lbl">참고관찰</div></div>
    <div class="kpi-card kpi-teal"><div class="num">80%</div><div class="lbl">청산 승률(신규규칙·TOP50)</div></div>
    <div class="kpi-card kpi-sky"><div class="num">+3.86%</div><div class="lbl">청산 평균수익률</div></div>
    <div class="kpi-card kpi-purple"><div class="num">3%</div><div class="lbl">SL비율(필터전 15.5%→3%)</div></div>
  </div>

  <div class="sc">
    <div class="sc-title">확정 전략 한눈에 보기 <span class="sub">2026-08-07 진입·청산 전면 개편</span></div>
    <div class="rule-box">
      <div class="rb-title">매수(진입) — EMA5+EMA20 이중조건 + 장기하락추세 필터 (2026-08-07 개편)</div>
      <div class="rb-body">시가총액 <b>TOP50</b> × <b>EMA5·EMA20 각각</b> Z-score ≤ -2 AND 위치(percentile) ≤ <b>3%ile</b>(2026-08-07 스윕 백테스트로 10→3 조임) <b>둘 다 동시에</b> 충족 AND <b>EMA50 &lt; EMA200(장기 하락추세)</b>일 때만 신호 발생일 종가 매수. 통계 기준창은 롤링 250거래일. <span style="color:var(--txt)">※ 계기: 현대차가 6~7월에 EMA20단독 기준으로 매수신호가 과다발생하는 문제 검토. 장기추세 필터는 "상승추세일 때만 매수하면 좋을 것"이라는 최초 가설과 <b>정반대로</b> 하락추세 구간 신호가 승률·SL비율 모두 최우수(2021~2026년 매년 일관 재현)로 확인돼 이 방향으로 확정 — 괴리율(역추세) 전략은 하락추세에서, 눌림목(추세추종) 전략은 상승추세에서 유리하다는 원리로 해석.</span></div>
    </div>
    <div class="rule-box">
      <div class="rb-title">매도(청산) — 3단계 분할매도 (2026-08-10 개편)</div>
      <div class="rb-body">① <b>손절(전량)</b>: 매입단가 대비 <b>-15%</b> — 항상 최우선 적용 &nbsp;② <b>익절(수량50%)</b>: <b>매입단가 대비 +20%</b> 도달한 날 발생(구 "EMA5 돌파" 트리거 대체) &nbsp;③ <b>2차 매도(잔량50%=전체25%)</b>: ②이후 종가가 <b>EMA20을 돌파</b>(종가≥EMA20)한 날 발생 &nbsp;④ <b>지속 보유</b>: ③ 이후 종가가 <b>EMA5 아래로 하향 이탈</b>하기 전까지 잔량(25%) 계속 홀딩, 이탈 시 전량매도 &nbsp;⑤ <b>시간청산</b>: 최대보유 20거래일 도달 시 잔량 전량매도. <span style="color:var(--txt)">※ 2026-08-10 개편: 기존 "① 1차 매도(EMA5돌파)"가 반등만 나오면 곧바로 절반을 팔아 승률은 높지만(구규칙 79%) 상승폭을 다 못 먹는 문제가 있어, 절대수익률(+20%) 기준 확정 익절로 교체. TOP50×7년 백테스트로 검증: 가중평균 +3.92%→+6.27%(개선) vs 승률 79%→73%(악화), 트레이드의 83%가 +20%를 못 넘기고 시간청산까지 감. SL 발생건수는 구규칙과 동일한 수준(5건) — SL비율은 청산구조가 아닌 진입품질이 결정한다는 기존 결론 재확인.</span></div>
    </div>
    <div class="rule-box">
      <div class="rb-title">최종 백테스트 결과 (TOP50 × 7년, calendarDays 2555)</div>
      <div class="rb-body">n=177, 가중평균 <b class="t-pos">+6.27%</b>, 중앙값 <b class="t-pos">+5.45%</b>, 승률 <b>73%</b>, <b>SL비율 3%</b>(구규칙(EMA5돌파 1차매도) 대비 가중평균 +3.92%→+6.27% 개선, 승률 79%→73% 악화). 포트폴리오 시뮬레이션(7년): 최종지수 <b>209.66(+109.66%)</b>, MDD <b>-5.89%</b>, 청산완료 132건(승률73%). 자세한 결과와 강건성 검증은 매매전략 탭 참조.</div>
    </div>
    <div class="rule-box">
      <div class="rb-title">포지션 사이징</div>
      <div class="rb-body">기본 자산의 <b>10%</b>/종목, 1주 가격이 배분보다 비싸면 최대 <b>25%</b>까지 상향(최소 1주 보장). 같은 날 신호가 겹치면(클러스터) 그 날 신규진입 총합이 자산의 <b>40%</b>를 넘지 않도록 비례 축소.</div>
    </div>
  </div>

  <div class="sc">
    <div class="sc-title">오늘(${d.todayStr}) 매수 타점 <span class="sub">EMA5·EMA20 각각 Z≤-2 & 위치≤3%ile 동시충족 AND 하락추세 — 이것만 확정 신호 (시가총액TOP50)</span></div>
    ${d.buySection}
  </div>

  <div class="ai-sc">
    <div class="ai-title">종합 진단</div>
    <div class="ai-list">
      <div class="ai-item"><div class="ai-dot ai-dot-red"></div><div><b>진입 조건 전면 개편(2026-08-07)</b> — 현대차 신호과다 문제를 계기로 진입조건에 EMA5 이중조건과 장기하락추세(EMA50&lt;EMA200) 필터를 추가하고, 위치(%ile) 임계값도 10→3%ile로 조였습니다. 그 결과 TOP50×7년 백테스트 기준 SL비율이 15.5%→3%로 대폭 개선되고 승률도 74%→80%로 향상됐습니다.</div></div>
      <div class="ai-item"><div class="ai-dot ai-dot-teal"></div><div><b>청산 1차 매도 조건 교체(2026-08-10)</b> — 기존 "종가 EMA5 돌파" 트리거를 "매입단가 대비 +20% 도달"로 교체했습니다. TOP50×7년 백테스트 결과 가중평균 +3.92%→+6.27%로 개선됐지만 승률은 79%→73%로 낮아졌습니다(트레이드의 83%가 +20%를 못 넘기고 20거래일 시간청산까지 감). 포트폴리오 시뮬레이션도 최종지수 161.99→209.66으로 개선. SL 발생건수는 구규칙과 비슷한 수준으로 유지돼 "SL비율은 청산구조가 아닌 진입품질이 결정한다"는 기존 결론과 일치합니다.</div></div>
      <div class="ai-item"><div class="ai-dot ai-dot-purple"></div><div><b>장기추세 필터는 가설과 반대 방향으로 확정</b> — "상승추세일 때만 매수하면 좋을 것"이라는 예상과 달리, 장기 하락추세 구간의 신호가 오히려 승률·SL비율 모두 최우수했습니다(2021~2026년 매년 일관 재현, 특정 종목·시기 편중 없음 확인). 괴리율 전략은 역추세(평균회귀) 전략이라 이미 하락추세인 종목의 단기 극과매도가 흔한 데드캣바운스로 반등신뢰도가 높은 반면, 상승추세 종목의 급락은 추세를 깨는 이례적 악재일 가능성이 높다는 원리로 해석됩니다.</div></div>
      <div class="ai-item"><div class="ai-dot ai-dot-teal"></div><div><b>오늘은 확정 신호 ${d.kpiBuy}건${d.kpiBuy ? '' : ', TOP50 전반 뚜렷한 방향성 없음'}</b> — 조건이 한층 엄격해지며 신호 발생 자체가 드물어진 것은 설계된 결과입니다. 신호가 뜨는 날은 "이중 조건 + 추세 필터"를 모두 통과한 고신뢰 구간이라는 의미입니다.</div></div>
${d.eventBullets ? `      <div class="ai-item"><div class="ai-dot ai-dot-amber"></div><div><b>보유종목 신규 이벤트(레그 전환)</b></div></div>\n${d.eventBullets}` : ''}
      <div class="ai-item"><div class="ai-dot ai-dot-sky"></div><div><b>포트폴리오 시뮬레이션도 신규 청산규칙으로 재구축(2026-08-10)</b> — 기간 2019-09-09~2026-08-10(7년), 최종지수 <b>209.66(+109.66%)</b>, MDD <b>-5.89%</b>(구규칙 TOP50·7년 기준 161.99(+61.99%)/MDD-6.40% 대비 개선). 자세한 수치는 매매전략 탭 참조.</div></div>
      <div class="ai-item"><div class="ai-dot ai-dot-amber"></div><div><b>미해결 과제</b> — 거래비용(세금·수수료) 미반영, 클러스터 우선순위 규칙 부재, in/out-of-sample 미분리(과최적화 위험), 횡보장 전용 전략 미착수(괴리율=하락추세, 눌림목=상승추세 다음 조각)가 남아있는 한계입니다.</div></div>
    </div>
  </div>
</div>

<div class="panel" id="p3">
  <div class="sc">
    <div class="sc-title">종목별 EMA5+EMA20 괴리율 통계 비교 <span class="sub">시가총액 TOP50 · 최근 2년(730일) · ${d.todayStr} 기준</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">종목명</th><th>EMA20괴리</th><th>Z20</th><th>위치20</th><th>EMA5괴리</th><th>Z5</th><th>위치5</th><th class="c">추세</th><th class="c">신호</th></tr></thead>
        <tbody>
          ${d.top50Rows}
        </tbody>
      </table>
    </div>
    ${d.top50ErrNote}
    <div class="sc-note">신호: <b>매수</b>(EMA5·EMA20 둘 다 Z≤-2&amp;위치≤3%ile 충족 AND 하락추세) &gt; <b>보류(상승추세)</b>(조건은 충족했으나 장기추세가 상승) &gt; <b>관찰</b>(EMA5·EMA20 중 하나만 충족, 참고용).</div>
  </div>

  <div class="sc">
    <div class="sc-title">5EMA+20EMA 이중조건 + 장기하락추세 필터 백테스트 <span class="sub">TOP50 · 7년(calendarDays 2555) · 2026-08-07 신규</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">조합</th><th>표본(n)</th><th>가중평균</th><th>중앙값</th><th>승률</th><th>SL비율</th></tr></thead>
        <tbody>
          <tr><td class="l">EMA20단독(구규칙)</td><td>295</td><td class="t-pos">+3.72%</td><td class="t-pos">+5.40%</td><td>75%</td><td>-</td></tr>
          <tr><td class="l">EMA5+EMA20 이중(하락추세필터 전)</td><td>232</td><td class="t-pos">+4.44%</td><td class="t-pos">+5.06%</td><td>74%</td><td>15.5%</td></tr>
          <tr><td class="l"><b>EMA5+EMA20 이중 + 하락추세필터(확정)</b></td><td><b>197</b></td><td class="t-pos"><b>+3.86%</b></td><td class="t-pos"><b>+4.31%</b></td><td><b>80%</b></td><td><b>3%</b></td></tr>
        </tbody>
      </table>
    </div>
    <div class="sc-note">장기추세 필터 후보 비교(신호 발생 시점 사후분류, 필터 없음 대비): "종가≥EMA50" n=8·승률50%·SL38%(최악), "EMA50≥EMA200(상승추세)" n=392·승률73%·SL13%, <b>"EMA50&lt;EMA200(하락추세)" n=194·승률80%·SL3%(최우수)</b>. 강건성 검증: 2021~2026년 매년 일관되게 하락추세 구간이 우세, 상위10종목 비중 44%로 특정종목 편중 없음.</div>
  </div>

  <div class="sc">
    <div class="sc-title">위치(%ile) 임계값 스윕 <span class="sub">TOP50 · 7년 · Z≤-2 고정, AND 하락추세 · 2026-08-07 신규</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">임계값</th><th>표본(n)</th><th>가중평균</th><th>중앙값</th><th>승률</th><th>SL비율</th></tr></thead>
        <tbody>
          <tr><td class="l">≤10%ile(구)</td><td>197</td><td class="t-pos">+3.86%</td><td class="t-pos">+4.31%</td><td>80%</td><td>3%</td></tr>
          <tr><td class="l">≤5%ile</td><td>196</td><td class="t-pos">+3.83%</td><td class="t-pos">+4.30%</td><td>80%</td><td>3%</td></tr>
          <tr><td class="l"><b>≤3%ile(확정)</b></td><td><b>178</b></td><td class="t-pos"><b>+3.92%</b></td><td class="t-pos"><b>+4.62%</b></td><td><b>79%</b></td><td><b>3%</b></td></tr>
          <tr><td class="l">≤2%ile</td><td>149</td><td class="t-pos">+4.01%</td><td class="t-pos">+4.61%</td><td>79%</td><td>3%</td></tr>
          <tr><td class="l">≤1%ile</td><td>65</td><td class="t-pos">+3.94%</td><td class="t-pos">+4.64%</td><td>82%</td><td>3%</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sc-note">Z≤-2 조건 자체가 이미 위치를 5%ile 근처까지 끌어내려 10→5%ile 조임은 신호수에 거의 영향 없음(197→196). 3%ile까지 조이면 신호수 10% 감소하며 평균·중앙값 소폭 개선 — 신호량과 표본 크기의 절충점으로 <b>3%ile 채택</b>. SL비율은 임계값과 무관하게 3%로 고정(하락추세 필터가 이미 그 역할을 하고 있음을 시사).</div>
  </div>

  <div class="sc">
    <div class="sc-title">EMA 기간별 백테스트 비교 <span class="sub">TOP20 · Z≤-2 & 위치≤10%ile 신호 · 롤링250일 (2026-07-25 연구, 역사적 참고자료)</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">EMA기간</th><th>신호수</th><th>+5일(n/평균/승률)</th><th>+10일(n/평균/승률)</th><th>+20일(n/평균/승률)</th></tr></thead>
        <tbody>
          <tr><td class="l">10일</td><td>142</td><td>142/+2.1%/58%</td><td>142/+4.3%/61%</td><td>142/+6.8%/64%</td></tr>
          <tr><td class="l">20일(확정)</td><td>89</td><td>89/+3.4%/64%</td><td>89/+6.1%/68%</td><td>89/+9.2%/71%</td></tr>
          <tr><td class="l">60일</td><td>34</td><td>34/+2.9%/59%</td><td>34/+5.2%/62%</td><td>34/+7.1%/65%</td></tr>
          <tr><td class="l">120일</td><td>18</td><td>18/+2.2%/56%</td><td>18/+3.8%/58%</td><td>18/+5.4%/61%</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="panel" id="p4">
  <div class="sc">
    <div class="sc-title">노션 보유종목DB 연동 분석 <span class="sub">보유정보 기준일 ${d.holdDate || '─'} · 가격 ${d.todayStr} 기준(장중) · EMA5+EMA20 · 최근2년</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">종목명</th><th class="c">시장</th><th>평단대비(실손익)</th><th>EMA20괴리</th><th>Z20</th><th>위치20</th><th>EMA5괴리</th><th>Z5</th><th>위치5</th><th class="c">추세</th><th class="c">판단</th></tr></thead>
        <tbody>
          ${d.holdRows}
        </tbody>
      </table>
    </div>
    <div class="sc-note">평단대비: 보유 평균단가 대비 현재가 손익률(실제 계좌 수익률). 판단(2026-08-10 3단계 매도규칙): 손절검토(평단대비≤-15%, 최우선) &gt; 전량매도검토(종가 EMA5 하향이탈) &gt; 2차익절검토(종가 EMA20 신규돌파) &gt; 홀딩(EMA20 위 유지중) &gt; 익절검토(평단대비 +20%신규도달) &gt; 주의(평단대비 -8~-15%) &gt; 관찰. 매수일자·기존 이행레그가 노션 스키마에 없어 레그별 잔량(50%/25%)까지는 추적 불가 — 롤링 2일 값 비교 기반 스냅샷 판정임을 감안할 것.</div>
  </div>
</div>
</div></div>

<script>
function openSettingsModal(){ document.getElementById('settingsModal').classList.add('modal-open'); syncThemeOptUI(); }
function closeSettingsModal(){ document.getElementById('settingsModal').classList.remove('modal-open'); }
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('theme', t); }catch(e){}
  syncThemeOptUI();
}
function syncThemeOptUI(){
  const cur = document.documentElement.getAttribute('data-theme');
  document.getElementById('theme-opt-dark')?.classList.toggle('on', cur === 'dark');
  document.getElementById('theme-opt-light')?.classList.toggle('on', cur === 'light');
}
function showTab(i){
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('on',j===i));
  document.querySelectorAll('.tab-btn').forEach((t,j)=>t.classList.toggle('on',j===i));
}
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>showTab(parseInt(btn.dataset.tab)));
  btn.addEventListener('touchend',e=>{e.preventDefault();showTab(parseInt(btn.dataset.tab));});
});
</script>
</body>
</html>`;
}

main().catch(e => { console.error('오류:', e.stack); process.exit(1); });
