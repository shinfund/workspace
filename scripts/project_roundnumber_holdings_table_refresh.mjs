// 라운드넘버 stock-portal 앱 — "보유종목" 탭(p2) 표+KPI+차트를 오늘 종가/현재가 기준으로 한 번에 갱신한다.
// project_baseline_holdings_check.mjs(기준선)의 Notion 직접조회+HTML splice 패턴을 라운드넘버 표에 맞게 재사용.
// 라운드지지/저항은 project_roundnumber_200w10t_check.mjs와 동일한 200일창/10틱 그리드 로직(niceStep) 사용.
// 200EMA괴리는 project_baseline_holdings_check.mjs와 동일한 EMA200 산식 재사용(같은 값이어야 정합).
// 사용법: node scripts/project_roundnumber_holdings_table_refresh.mjs
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';
const HTML_PATH = 'C:\\Users\\shinf\\workspace\\apps\\stock-portal\\stock-roundnumber.html';

const KIS_APP_KEY    = 'PSO0pNJJEdcjc5qizFifXHn0yXG42TRA0hUz';
const KIS_APP_SECRET = 'ag3QEJW9rPfVvvhuiJCZftESl2a0GSSXsbuLzZxVq008hTbqKrBScdZxz/NbVW9UBbdwF+Yd16eFrGB2Q6HLEKADkUCpTvUjXmdorsxF5KmNvVI/Q/fR/2uv9UjTYmzCusALcmkSOaeLQ1pByw8oVPE++lnBZg6aKxh33Tbfd/aNbGNKl2Y=';
const KIS_TOKEN_CACHE = 'C:\\Users\\shinf\\workspace\\scripts\\kis_token.json';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;

const WINDOW_DAYS = 200, TARGET_TICKS = 10; // 화면표시용 축 스케일(2026-08-21 실증 확정)
const NICE_FAMILY = [1, 2, 2.5, 5, 10];
const CALENDAR_DAYS = 2555; // EMA200 안정화를 위한 넉넉한 lookback(baseline 스크립트와 동일)
const HOLDINGS_CHART_DAYS = 60;
const PROXIMITY_PCT = 2; // 지지/저항 2% 이내 근접 판정 기준

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
      if (!result || !result.timestamp?.length) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { let last = null; return arr.map(v => { if (v != null) last = v; return v == null ? last : v; }); }

function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) { const dist = Math.abs(Math.log(norm) - Math.log(f)); if (dist < bestDist) { bestDist = dist; best = f; } }
  return best * mag;
}
function computeStep(highs, lows) {
  const n = highs.length;
  const lo = Math.max(0, n - WINDOW_DAYS);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k < n; k++) { if (highs[k] != null && highs[k] > hi) hi = highs[k]; if (lows[k] != null && lows[k] < low) low = lows[k]; }
  if (hi === -Infinity || low === Infinity) return null;
  return niceStep((hi - low) / TARGET_TICKS);
}
function touchCount(highs, lows, level) {
  const n = highs.length;
  const lo = Math.max(0, n - WINDOW_DAYS);
  let count = 0;
  for (let k = lo; k < n; k++) { if (highs[k] == null || lows[k] == null) continue; if (lows[k] <= level && level <= highs[k]) count++; }
  return count;
}
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
async function fetchNotionHoldings() {
  if (!NOTION_TOKEN) { console.error('[Notion] NOTION_TOKEN 환경변수 없음'); return []; }
  const data = await httpPostJson(`https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`, { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 }, { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' });
  if (!data?.results?.length) { console.error('[Notion] 결과 없음'); return []; }
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results.filter(p => p.properties['날짜']?.date?.start === latestDate).map(p => ({
    code: (p.properties['종목코드']?.rich_text?.[0]?.plain_text || '').trim(),
    name: (p.properties['종목명']?.title?.[0]?.plain_text || '').trim(),
    qty: Number(p.properties['보유수량']?.number || 0),
    avgPrice: Number(p.properties['매 입 가']?.number || 0),
    strategy: p.properties['전략']?.select?.name || null,
  }));
  // 이 앱은 라운드넘버 전략으로 실제 매수한 종목만 표시하는 것이 확정 컨벤션(다른 전략 보유종목은 각 전략 앱에서 표시)
  return rows.filter(h => h.code && h.qty > 0 && h.strategy === '라운드넘버');
}

async function getKisToken() {
  try {
    const c = JSON.parse(fs.readFileSync(KIS_TOKEN_CACHE, 'utf8'));
    if (new Date(c.access_token_token_expired) > new Date(Date.now() + 60000)) return c.access_token;
  } catch { /* cache miss */ }
  const body = JSON.stringify({ grant_type: 'client_credentials', appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { const res = JSON.parse(d); if (!res.access_token) return reject(new Error('KIS 토큰 실패')); fs.writeFileSync(KIS_TOKEN_CACHE, JSON.stringify(res)); resolve(res.access_token); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function fetchKisPrice(token, code) {
  const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  return new Promise(resolve => {
    const req = https.request({ hostname: KIS_HOST, port: KIS_PORT, path: `/uapi/domestic-stock/v1/quotations/inquire-price?${qs}`, method: 'GET', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}`, appkey: KIS_APP_KEY, appsecret: KIS_APP_SECRET, tr_id: 'FHKST01010100', custtype: 'P' } }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { const j = JSON.parse(d); if (j.rt_cd !== '0') return resolve(null); const o = j.output; resolve({ 현재가: Number(o.stck_prpr || 0), 등락률: Number(o.prdy_ctrt || 0) }); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }
function fmtPct1(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '─'; }
function retClass(n) { return n == null ? '' : n > 0 ? 't-pos' : n < 0 ? 't-neg' : 't-flat'; }

function verdict(supDistPct, resDistPct) {
  // supDistPct: 현재가가 지지 위 몇%인지(양수), resDistPct: 저항이 현재가 위 몇%인지(양수)
  if (supDistPct <= PROXIMITY_PCT) return { label: '지지 임박·이탈시 손절검토', cls: 'red' };
  if (resDistPct <= PROXIMITY_PCT) return { label: '저항 근접·돌파시 익절검토', cls: 'amber' };
  return { label: '박스권 홀드', cls: 'gray' };
}

function tableRowHtml(r) {
  return `          <tr><td class="l">${esc(r.name)}</td><td class="c">${fmtWon(r.price)}</td><td class="${retClass(r.dayChgPct)}">${fmtPct(r.dayChgPct)}</td><td>${fmtWon(r.avgPrice)}</td><td class="${retClass(r.ret)}">${fmtPct(r.ret)}</td><td class="${r.dev200 <= -15 ? 't-neg-hi' : retClass(r.dev200)}">${fmtPct(r.dev200)}</td><td class="l">${fmtWon(r.support)}(${fmtPct(-r.supDistPct)},${r.supTouch}봉)</td><td class="l">${fmtWon(r.resistance)}(${fmtPct(r.resDistPct)},${r.resTouch}봉)</td><td class="l"><span class="badge bdg-${r.v.cls}">${esc(r.v.label)}</span></td></tr>`;
}

function buildRoundnumberChartSvg(rows, refLines) {
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
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}
function holdingChartCardHtml(h) {
  const svg = buildRoundnumberChartSvg(h.chartRows, [
    { value: h.support, color: 'amber', dash: '6,3', width: 1.8 },
    { value: h.resistance, color: 'sky', dash: '6,3', width: 1.8 },
    { value: h.avgPrice, color: 'purple', dash: '4,2', width: 1.6 },
  ]);
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(h.name)}</span><span class="badge bdg-${h.v.cls}">${esc(h.v.label)}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(h.price)}</span> <span class="sep">|</span> 평단가 <span>${fmtWon(h.avgPrice)}</span> <span class="sep">|</span> 수익률 <span class="${retClass(h.ret)}">${fmtPct(h.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>라운드지지 <span>${fmtWon(h.support)}</span>(${fmtPct1(-h.supDistPct)}) <span class="sep">|</span> 라운드저항 <span>${fmtWon(h.resistance)}</span>(${fmtPct1(h.resDistPct)})</span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>라운드지지</span><span><i class="dash" style="border-color:var(--sky)"></i>라운드저항</span><span><i class="dash" style="border-color:var(--purple)"></i>평단가</span></div>
      </div>`;
}

async function analyzeHolding(h, token) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = h.market === 'KOSDAQ' ? `${h.code}.KQ` : `${h.code}.KS`;
  const [kis, chart] = await Promise.all([fetchKisPrice(token, h.code), fetchYahooChart(symbol, p1, p2)]);
  if (!chart) return { ...h, error: 'Yahoo 데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate);
  const highs = fillForward(chart.high), lows = fillForward(chart.low), closes = fillForward(chart.close);
  const ema200s = buildEma(chart.close, 200);
  const lastIdx = closes.length - 1;
  const price = kis ? kis.현재가 : closes[lastIdx];
  const dayChgPct = kis ? kis.등락률 : null;
  const ema200 = ema200s[lastIdx];
  const dev200 = ema200 != null ? (price - ema200) / ema200 * 100 : null;
  const step = computeStep(highs, lows);
  if (!step) return { ...h, error: 'step 계산 실패' };
  const support = Math.floor(price / step) * step;
  const resistance = support + step;
  const supDistPct = (price - support) / price * 100;
  const resDistPct = (resistance - price) / price * 100;
  const supTouch = touchCount(highs, lows, support);
  const resTouch = touchCount(highs, lows, resistance);
  const ret = (price - h.avgPrice) / h.avgPrice * 100;
  const v = verdict(supDistPct, resDistPct);
  const chartRows = [];
  for (let i = Math.max(0, dates.length - HOLDINGS_CHART_DAYS); i < dates.length; i++) if (closes[i] != null) chartRows.push({ date: dates[i], close: closes[i] });
  return { ...h, price, dayChgPct, dev200, support, resistance, supDistPct, resDistPct, supTouch, resTouch, ret, v, chartRows };
}

function spliceIntoHtml(rows, todayLabel) {
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const toEol = s => s.replace(/\n/g, eol);

  const n = rows.length;
  const plusCount = rows.filter(r => r.ret > 0).length;
  const avgRet = rows.reduce((s, r) => s + r.ret, 0) / n;

  html = html.replace(
    /(<div class="kpi-card kpi-sky"><div class="num">)\d+(<\/div><div class="lbl">보유종목 수<\/div>)/,
    `$1${n}$2`
  );
  html = html.replace(
    /(<div class="kpi-card kpi-teal"><div class="num">)[^<]+(<\/div><div class="lbl">플러스 수익 종목<\/div>)/,
    `$1${plusCount}/${n}$2`
  );
  html = html.replace(
    /(<div class="kpi-card kpi-amber"><div class="num )[^"]+?(">)[^<]+(<\/div><div class="lbl">평균수익률<\/div>)/,
    `$1${retClass(avgRet)}$2${fmtPct(avgRet)}$3`
  );

  // sc-title 서브 텍스트의 갱신일자 교체 — "장마감"을 단정하지 않음(장전 실행 시 등락률 0%가 실제 장마감 데이터처럼 보이는 문제 방지, 2026-08-27)
  html = html.replace(/Notion 보유종목DB 연동\([0-9-]{10}[^)]*\)/, `Notion 보유종목DB 연동(${todayLabel} 기준, KIS 현재가)`);

  const tableStartIdx = html.indexOf('보유종목 현황');
  if (tableStartIdx < 0) throw new Error('보유종목 현황 앵커를 찾지 못함');
  const tbodyOpenIdx = html.indexOf('<tbody>', tableStartIdx);
  const tbodyOpenEnd = tbodyOpenIdx + '<tbody>'.length;
  const tbodyCloseIdx = html.indexOf('</tbody>', tbodyOpenEnd);
  if (tbodyOpenIdx < 0 || tbodyCloseIdx < 0) throw new Error('보유종목 표 tbody 앵커를 찾지 못함');
  const newTableHtml = toEol(rows.map(tableRowHtml).join('\n'));
  html = html.slice(0, tbodyOpenEnd) + eol + newTableHtml + eol + html.slice(tbodyCloseIdx);

  // 보유종목 차트 섹션(.sc 블록 전체, project_roundnumber_holdings_chart_refresh.mjs와 동일 앵커 패턴)
  const cardsHtml = rows.map(holdingChartCardHtml).join('\n');
  const sectionHtml = `  <div class="sc">
    <div class="sc-title">보유종목 차트 <span class="sub">전체 ${n}종목</span></div>
    <div class="chart-grid">
${cardsHtml}
    </div>
  </div>`;
  const chartStartNeedle = `  <div class="sc">${eol}    <div class="sc-title">보유종목 차트`;
  const chartStartIdx = html.indexOf(chartStartNeedle);
  if (chartStartIdx < 0) throw new Error('보유종목 차트 섹션 시작 앵커를 찾지 못함');
  const chartEndNeedle = `${eol}</div>${eol}${eol}<div class="panel" id="p3">`;
  const chartEndIdx = html.indexOf(chartEndNeedle, chartStartIdx);
  if (chartEndIdx < 0) throw new Error('보유종목 차트 섹션 종료 앵커를 찾지 못함');
  html = html.slice(0, chartStartIdx) + toEol(sectionHtml) + html.slice(chartEndIdx);

  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.error(`[저장완료] ${HTML_PATH}`);
}

async function main() {
  const holdings = await fetchNotionHoldings();
  if (!holdings.length) { console.error('보유종목 없음/Notion 조회 실패'); return; }
  // Notion DB엔 시장 필드가 없으므로 KOSPI 우선 조회(현재 보유종목 전부 KOSPI, round number 전략은 코스피 전용 유니버스)
  for (const h of holdings) h.market = h.market || 'KOSPI';
  const token = await getKisToken();
  console.error(`[조회] 보유종목 ${holdings.length}개 × 라운드넘버 전략 상태 점검 중... (${holdings.map(h => h.name).join(', ')})`);

  const results = [];
  for (const h of holdings) {
    const r = await analyzeHolding(h, token);
    if (r.error) { console.error(`[실패] ${h.name}: ${r.error}`); continue; }
    results.push(r);
    await new Promise(res => setTimeout(res, 150));
  }
  results.sort((a, b) => b.ret - a.ret);

  console.log('\n━━━ 보유종목 × 라운드넘버 전략 상태 점검 ━━━\n');
  for (const r of results) {
    console.log(`${r.name.padEnd(12)} 현재가${fmtWon(r.price).padStart(10)}  수익률${fmtPct(r.ret).padStart(8)}  200EMA괴리${fmtPct(r.dev200).padStart(8)}  지지${fmtWon(r.support)}(${fmtPct1(-r.supDistPct)},${r.supTouch}봉)  저항${fmtWon(r.resistance)}(${fmtPct1(r.resDistPct)},${r.resTouch}봉)  판단: ${r.v.label}`);
  }

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  spliceIntoHtml(results, today);
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
