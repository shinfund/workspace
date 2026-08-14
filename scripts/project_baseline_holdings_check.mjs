// EMA200 기준선 파동 전략(stock-baseline) — "보유종목" 탭용: 노션 보유종목DB 실제 보유종목을
// 기준선 전략 관점(스트릭·Z-score·회복여부·파동단계)으로 교차 점검한다.
// 주의: 보유종목이 반드시 "이 전략으로 매수한 포지션"이라는 뜻은 아니다 — 다른 전략/재량매매로
// 보유 중인 종목이라도 기준선 전략의 규칙을 오늘 시점에 대입하면 어떤 상태인지 참고용으로 보여준다.
// 스킬: stock-baseline(신규) / holdings-report(노션 연동 부분 공유)
// 사용법: node scripts/project_baseline_holdings_check.mjs
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

const ROLL = 250, MIN_STREAK = 20, Z_THRESHOLD = -1.25;
const FAST_PERIOD = 5, BASE_PERIOD = 200;
const CALENDAR_DAYS = 2555;

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
  return { ...h, market, close: cur.close, ema5: cur.ema5, ema200: cur.ema200, dev200: cur.dev200, z200: zs.z, curStreak, belowBaseline, aboveEma5, unrealizedRet, date: cur.date };
}

function verdict(r) {
  if (r.error) return { label: '─', cls: 'gray' };
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
  for (const r of results) {
    if (r.error) { console.log(`${r.name}: ${r.error}`); continue; }
    const v = verdict(r);
    console.log(`${r.name.padEnd(12)} 시장${(r.market||'─').padEnd(6)} 평단대비${fmt(r.unrealizedRet).padStart(9)}  EMA200괴리${fmt(r.dev200).padStart(9)}  Z${r.z200.toFixed(2).padStart(6)}  스트릭${String(r.curStreak).padStart(4)}일  판단: ${v.label}`);
  }
  console.log('\n' + JSON.stringify({ holdings: results.map(r => ({ ...r, verdict: verdict(r) })) }, null, 2));
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
