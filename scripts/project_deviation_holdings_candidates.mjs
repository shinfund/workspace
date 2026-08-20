// 괴리율(역추세) 전략 — "예상종목"(TOP50 Z-score 근접 top6) · "보유종목"(Notion 보유종목DB 연동) 탭용 라이브 데이터 생성
// project_stock_deviation.mjs(구 5탭 통합 생성기)의 analyzeCommon/verdict/buildChartSvg/카드 HTML 로직을 그대로 재사용하되,
// 2026-08-12 pullback 앱에서 발견된 것과 동일한 사각지대 버그를 수정: "전량매도검토(5EMA이탈)"가 당일 신규 이탈만 감지해
// 며칠 전 이미 이탈해 지속 중인 종목이 최하위 배지("관찰")로 방치되는 문제 — breakdown5를 "현재 상태" 기준으로 재정의.
// 사용법: node scripts/project_deviation_holdings_candidates.mjs
import https from 'https';
import { fetchKrxUniverse, getToken as getKisToken, fetchKisPrice } from './kis_api.mjs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

const KOSPI_SIZE = 50, KOSDAQ_SIZE = 20;

// KRX 조회 실패 시에만 사용하는 폴백 유니버스(2026-08-19, project_deviation_recent_signals.mjs와 동일)
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

const FAST = 5, SLOW = 20, MID = 50, CHART_LONG = 100, TREND_LONG = 200;
const Z_TH = -2, PCT_TH = 3;
const STAT_DAYS = 730, CHART_DAYS = 70;

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
      resp.setEncoding('utf8');
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
      resp.setEncoding('utf8');
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
    req.end();
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
// 장중/장마감 직후 Yahoo 당일 종가 지연 보정용 KIS 당일 현재가 일괄조회(stock-baseline·project_stock_deviation.mjs와 동일 기법, [[feedback_price_cross_verify]])
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
  const chartRows = rows.slice(-CHART_DAYS).filter(r => r.ema100 != null && r.ema200 != null);
  const z20TargetDev = Z_TH * ms20.sd + ms20.mean;
  const z5TargetDev = Z_TH * ms5.sd + ms5.mean;
  const z20Price = cur.ema20 * (1 + z20TargetDev / 100);
  const z5Price = cur.ema5 * (1 + z5TargetDev / 100);
  return { market: usedMarket, cur, prev, z5: s5.z, pct5: s5.pct, z20: s20.z, pct20: s20.pct, downTrend, chartRows, z20Price, z5Price };
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

// 2026-08-10 3단계 매도규칙. 2026-08-12 수정: breakdown5(전량매도검토)를 "당일 신규 이탈"이 아닌
// "현재 EMA5 아래 상태"(state) 기준으로 재정의 — pullback 앱 두산에너빌리티 사각지대 사례(commit 9fe8f30)와 동일 버그.
function verdict(r) {
  if (r.unrealizedRet != null && r.unrealizedRet <= -15) return { label: '손절검토', cls: 'red' };
  if (r.breakdown5) return { label: '전량매도검토(5EMA이탈)', cls: 'red' };
  if (r.freshLeg20) return { label: '2차익절검토(20EMA돌파)', cls: 'teal' };
  if (r.aboveEma20) return { label: '홀딩(20EMA위)', cls: 'teal' };
  if (r.freshTp20) return { label: '익절검토(+20%)', cls: 'teal' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -8) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

function buildChartSvg(rows, opts) {
  const longKey = opts.longKey || 'ema100';
  const longColor = opts.longColor || 'gray600';
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema20, r.ema50, r[longKey]));
  if (opts.avgPrice) allVals.push(opts.avgPrice, opts.slPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly(longKey, longColor, '6,3', 1.3) + poly('ema50', 'teal', '6,3', 1.3) + poly('ema20', 'purple', '4,3', 1.4) + poly('ema5', 'sky', '2,2', 2.2);
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
  const svg = buildChartSvg(r.chartRows, { avgPrice: r.avgPrice, slPrice, longKey: 'ema200', longColor: 'amber' });
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

// 2026-08-19: "초근접"(Z5·Z20 중 하나 이상 이미 진입조건(Z≤-2 & 위치≤3%ile) 충족)만 후보로 채택하므로
// finalSignal()이 '─'(둘 다 조건 미충족)로 나오는 경우는 애초에 후보 목록에 들어오지 않는다 — 방어적으로만 남김.
function candidateBadge(sig) {
  if (sig === '매수') return { c: 'bdg-red', t: '매수' };
  if (sig === '보류(상승추세)') return { c: 'bdg-amber', t: '보류(상승추세)' };
  if (sig === '관찰') return { c: 'bdg-teal', t: '관찰' };
  return { c: 'bdg-gray', t: sig };
}
function candidateRowHtml(r) {
  const sig = finalSignal(r);
  const badge = candidateBadge(sig);
  return `<tr><td class="l">${esc(r.name)}</td><td class="c">${r.market}</td><td>${fmtV(r.cur.close)}</td><td class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</td><td>${r.z20 == null ? '─' : r.z20.toFixed(2)}</td><td>${r.pct20.toFixed(0)}%ile</td><td class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</td><td>${r.z5 == null ? '─' : r.z5.toFixed(2)}</td><td>${r.pct5.toFixed(0)}%ile</td><td class="c">${r.downTrend ? '하락' : '상승'}</td><td class="c"><span class="badge ${badge.c}">${badge.t}</span>${r.held ? ' <span class="badge bdg-teal">보유중</span>' : ''}</td></tr>`;
}
function candidateCardHtml(r) {
  const svg = buildChartSvg(r.chartRows, { longKey: 'ema100', longColor: 'gray600' });
  const sig = finalSignal(r);
  const badge = candidateBadge(sig);
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

// 2026-08-19: 코스피/코스닥 시장 단위로 유니버스를 분석해 "초근접"(finalSignal !== '─') 후보만 반환.
// 기존엔 top50 통합 풀에서 근접도 상위 6개를 무조건 채워서 보여줬는데(초근접이 아닌 종목까지 포함),
// 이제는 임계값 필터만 적용하고 개수를 강제하지 않는다 — 초근접 후보가 없으면 빈 배열 그대로 반환.
async function analyzeMarketCandidates(universe, holdCodes, kisMap, todayDate) {
  const results = await batchAll(universe, async s => {
    const a = await analyzeCommon(s.code, s.market, kisMap, todayDate);
    return a.error ? { ...s, error: a.error } : { ...s, ...a };
  }, 6, 120);
  const valid = results.filter(r => !r.error);
  const errors = results.filter(r => r.error);
  if (errors.length) console.error(`[조회실패] ${errors.map(r => r.name).join(', ')}`);

  const candidates = valid
    .filter(r => r.z20 != null && r.z5 != null && finalSignal(r) !== '─')
    .sort((a, b) => Math.max(a.z20, a.z5) - Math.max(b.z20, b.z5))
    .map(r => ({ ...r, held: holdCodes.has(r.code) }));

  return {
    tableHtml: candidates.map(candidateRowHtml).join('\n          '),
    cardsHtml: candidates.map(candidateCardHtml).join('\n'),
    stats: {
      total: candidates.length,
      downTrend: candidates.filter(r => r.downTrend === true).length,
      upTrend: candidates.filter(r => r.downTrend === false).length,
      held: candidates.filter(r => r.held).length,
      names: candidates.map(r => ({ code: r.code, name: r.name, downTrend: r.downTrend, held: r.held, signal: finalSignal(r) })),
    },
  };
}

async function main() {
  const kospiUniverse = await buildKospiUniverse();
  const kosdaqUniverse = await buildKosdaqUniverse();
  console.error(`[예상종목] 코스피 ${kospiUniverse.length}종목 / 코스닥 ${kosdaqUniverse.length}종목 분석 중...`);

  console.error('[조회] Notion 보유종목DB 조회 중...');
  const { rows: holdingsRaw, latestDate: holdDate } = await fetchNotionHoldings();
  console.error(`[조회] 보유종목 ${holdingsRaw.length}개 분석 중... (${holdingsRaw.map(h => h.name).join(', ')})`);

  const todayDate = kstTodayDate();
  const allCodes = [...new Set([...kospiUniverse, ...kosdaqUniverse, ...holdingsRaw].map(s => s.code))];
  const kisMap = await fetchKisPriceMap(allCodes);

  const holdingsResults = await batchAll(holdingsRaw, async h => {
    const a = await analyzeCommon(h.code, null, kisMap, todayDate);
    if (a.error) return { ...h, error: a.error };
    const r = { ...h, ...a };
    r.unrealizedRet = h.avgPrice ? (r.cur.close - h.avgPrice) / h.avgPrice * 100 : null;
    r.aboveEma5 = r.cur.close >= r.cur.ema5;
    r.aboveEma20 = r.cur.close >= r.cur.ema20;
    const prevAboveEma20 = r.prev ? r.prev.close >= r.prev.ema20 : false;
    const prevUnrealizedRet = h.avgPrice && r.prev ? (r.prev.close - h.avgPrice) / h.avgPrice * 100 : null;
    r.freshTp20 = r.unrealizedRet != null && r.unrealizedRet >= 20 && !(prevUnrealizedRet != null && prevUnrealizedRet >= 20);
    r.freshLeg20 = r.aboveEma20 && !prevAboveEma20;
    r.breakdown5 = !r.aboveEma5; // 상태 기준(현재 EMA5 아래) — 사각지대 수정(2026-08-12)
    return r;
  }, 5, 150);

  const holdCodes = new Set(holdingsResults.filter(h => !h.error).map(h => h.code));
  const ks = await analyzeMarketCandidates(kospiUniverse, holdCodes, kisMap, todayDate);
  const kq = await analyzeMarketCandidates(kosdaqUniverse, holdCodes, kisMap, todayDate);

  const validHoldings = holdingsResults.filter(h => !h.error);
  const holdingCards = validHoldings.map(holdingCardHtml).join('\n');
  const holdRows = validHoldings.map(r => {
    const v = verdict(r);
    const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
    return `<tr><td class="l">${esc(r.name)}</td><td>${r.market}</td><td class="${devClass(r.unrealizedRet)}">${fmt(r.unrealizedRet)}</td><td class="${devClass(r.cur.dev20)}">${fmt(r.cur.dev20)}</td><td>${r.z20 == null ? '─' : r.z20.toFixed(2)}</td><td>${r.pct20.toFixed(0)}%ile</td><td class="${devClass(r.cur.dev5)}">${fmt(r.cur.dev5)}</td><td>${r.z5 == null ? '─' : r.z5.toFixed(2)}</td><td>${r.pct5.toFixed(0)}%ile</td><td class="c">${r.downTrend ? '하락' : '상승'}</td><td class="c"><span class="badge ${badgeCls}">${v.label}</span></td></tr>`;
  }).join('\n          ');

  const priceDate = validHoldings[0]?.cur?.date || null;

  const fs = await import('fs');
  fs.writeFileSync('candidates_table_ks.html', ks.tableHtml, 'utf-8');
  fs.writeFileSync('candidates_cards_ks.html', ks.cardsHtml, 'utf-8');
  fs.writeFileSync('candidates_table_kq.html', kq.tableHtml, 'utf-8');
  fs.writeFileSync('candidates_cards_kq.html', kq.cardsHtml, 'utf-8');
  fs.writeFileSync('holdings_cards.html', holdingCards, 'utf-8');
  fs.writeFileSync('holdings_table_rows.html', holdRows, 'utf-8');
  console.error('[산출완료] 예상종목 *_ks/kq.html(코스피/코스닥 분리) 4개 + holdings 2개');

  const out = {
    generatedAt: new Date().toISOString(),
    holdDate, priceDate,
    kospi: { candidates: ks.stats },
    kosdaq: { candidates: kq.stats },
    holdings: validHoldings.map(r => ({ code: r.code, name: r.name, unrealizedRet: r.unrealizedRet, verdict: verdict(r).label, breakdown5: r.breakdown5, freshLeg20: r.freshLeg20, freshTp20: r.freshTp20, aboveEma20: r.aboveEma20 })),
    holdingsErrors: holdingsResults.filter(h => h.error).map(h => `${h.name}: ${h.error}`),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
