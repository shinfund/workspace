// 노션 "보유종목"DB 연동 — 실제 보유종목 EMA5+EMA20 괴리율 통계(Z-score·위치) + 평균단가 대비 수익률
// (2026-08-07 진입·청산 조건 전면 개편 — 상세는 project_stock_deviation_stats 메모 참조)
// 스킬: stock-deviation / holdings-report(노션 연동 부분 공유)
// 사용법: node scripts/project_holdings_deviation_stats.mjs [--days 730]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const HOLDINGS_DB_ID = '9f666aeb-832a-4aa2-9e52-e37515b75e56';

const FAST_PERIOD = 5;
const SLOW_PERIOD = 20;
const TREND_MID_PERIOD = 50;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { days: 730 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.days = parseInt(argv[++i]);
  }
  return o;
}

function httpPostJson(url, body, headers) {
  return new Promise((res, rej) => {
    const bodyStr = JSON.stringify(body);
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname, port: 443, path: opts.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    }, resp => {
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

// Notion 검색 인덱스 동기화 지연으로 title 등 필드가 간헐적으로 빈 값/0으로 반환되는 경우가 있어
// (holdings_report.mjs와 동일 이슈, 매번 랜덤한 필드에서 발생) 의심스러운 행은 페이지 단건 재조회로 보정한다.
async function refetchPage(pageId) {
  try {
    const page = await notionGetJson(
      `https://api.notion.com/v1/pages/${pageId}`,
      { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
    );
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
  const data = await httpPostJson(
    `https://api.notion.com/v1/databases/${HOLDINGS_DB_ID}/query`,
    { sorts: [{ property: '날짜', direction: 'descending' }], page_size: 200 },
    { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
  );
  if (!data?.results?.length) { console.error('[Notion] 결과 없음'); return []; }
  const allDates = [...new Set(data.results.map(p => p.properties['날짜']?.date?.start).filter(Boolean))].sort();
  const latestDate = allDates[allDates.length - 1];
  console.error(`[Notion] 보유종목DB 기준일: ${latestDate}`);
  const rows = data.results
    .filter(p => p.properties['날짜']?.date?.start === latestDate)
    .map(p => ({
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
  return rows.filter(h => h.code && h.qty > 0);
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
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

// KOSPI(.KS)/KOSDAQ(.KQ) 둘 다 조회해 데이터가 더 많은 쪽을 채택
// (첫 응답이 truthy라는 이유만으로 채택하면, Yahoo가 반환하는 소량의 비정상 데이터셋에 오탐되는 사례가 있었음 — 2026-07-27 확인)
async function fetchChartAutoMarket(code, p1, p2) {
  const [ks, kq] = await Promise.all([
    fetchYahooChart(`${code}.KS`, p1, p2),
    fetchYahooChart(`${code}.KQ`, p1, p2),
  ]);
  const ksLen = ks?.ts?.length || 0;
  const kqLen = kq?.ts?.length || 0;
  if (ksLen === 0 && kqLen === 0) return { chart: null, market: null };
  return ksLen >= kqLen ? { chart: ks, market: 'KOSPI' } : { chart: kq, market: 'KOSDAQ' };
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

function stdev(arr, mean) {
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
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

function zAndPct(devs, curDev) {
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  const sd = stdev(devs, mean);
  const z = sd ? (curDev - mean) / sd : null;
  const pct = devs.filter(d => d <= curDev).length / devs.length * 100;
  return { mean, sd, z, pct };
}

async function analyzeHolding(h, opts) {
  const WARMUP_DAYS = TREND_LONG_PERIOD * 6; // EMA200 안정화(project_multi_stock_deviation_stats.mjs와 동일 사상)
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (opts.days + WARMUP_DAYS) * 24 * 3600;

  const { chart, market } = await fetchChartAutoMarket(h.code, p1, p2);
  if (!chart) return { ...h, error: '데이터 조회 실패(KOSPI/KOSDAQ 모두 실패)' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const statCutoff = new Date(Date.now() - opts.days * 24 * 3600 * 1000);
  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    if (new Date(dates[i]) < statCutoff) continue;
    rows.push({
      date: dates[i], close: closes[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, ema5: ema5s[i],
      dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100, ema20: ema20s[i],
      ema50: ema50s[i], ema200: ema200s[i],
    });
  }
  if (!rows.length) return { ...h, error: '통계 대상 구간 데이터 없음' };

  const dev5s = rows.map(r => r.dev5);
  const dev20s = rows.map(r => r.dev20);
  const cur = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;

  const s5 = zAndPct(dev5s, cur.dev5);
  const s20 = zAndPct(dev20s, cur.dev20);
  const downTrend = cur.ema50 != null && cur.ema200 != null ? cur.ema50 < cur.ema200 : null;
  const unrealizedRet = h.avgPrice ? (cur.close - h.avgPrice) / h.avgPrice * 100 : null;

  // 2026-08-10 청산규칙 개편(3단계, ①손절 ②익절(+20%) ③EMA20돌파 ④EMA5하향이탈): ①손절-15%(최우선) ②매입단가 대비 +20% 도달 시 1차익절(50%, 구 EMA5돌파 트리거 대체)
  // ③이후 종가≥EMA20 돌파 시 2차익절(잔량50%=전체25%) ④이후 종가<EMA5 하향이탈 시 잔량 전량매도. 매수일자·기존 이행레그가 노션 스키마에 없어 "레그별 잔량"까지는 추적 불가하고
  // 롤링 2일(어제·오늘) 값 비교로 어느 단계에 새로 진입했는지만 매일 재판정한다.
  const aboveEma5 = cur.close >= cur.ema5;
  const aboveEma20 = cur.close >= cur.ema20;
  const prevAboveEma5 = prev ? prev.close >= prev.ema5 : false;
  const prevAboveEma20 = prev ? prev.close >= prev.ema20 : false;
  const prevUnrealizedRet = h.avgPrice && prev ? (prev.close - h.avgPrice) / h.avgPrice * 100 : null;
  const freshTp20 = unrealizedRet != null && unrealizedRet >= 20 && !(prevUnrealizedRet != null && prevUnrealizedRet >= 20);
  const freshLeg20 = aboveEma20 && !prevAboveEma20;
  const breakdown5 = prevAboveEma5 && !aboveEma5;

  return {
    ...h, market, currentClose: cur.close,
    dev5: cur.dev5, z5: s5.z, pct5: s5.pct,
    dev20: cur.dev20, z20: s20.z, pct20: s20.pct,
    downTrend, unrealizedRet,
    aboveEma5, aboveEma20, freshTp20, freshLeg20, breakdown5,
    close: cur.close, ema5: cur.ema5, ema20: cur.ema20, date: cur.date,
    prevClose: prev?.close, prevEma5: prev?.ema5, prevEma20: prev?.ema20, prevDate: prev?.date, prevUnrealizedRet,
  };
}

const Z_SIGNAL_THRESHOLD = -2;
const PCT_SIGNAL_THRESHOLD = 3; // 2026-08-07 스윕 백테스트로 10→3 조임
function hitZP(z, pct) { return z != null && z <= Z_SIGNAL_THRESHOLD && pct <= PCT_SIGNAL_THRESHOLD; }
function signalLabel(r) {
  const hit5 = hitZP(r.z5, r.pct5);
  const hit20 = hitZP(r.z20, r.pct20);
  if (hit5 && hit20 && r.downTrend === true) return '매수';
  if (hit5 && hit20 && r.downTrend === false) return '보류(상승추세)';
  if (hit5 || hit20) return '관찰';
  return '─';
}
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

// 2026-08-10 매도(청산) 규칙: 손절-15%(최우선) > 하향이탈(전량) > 2차익절검토(EMA20 신규돌파) > 홀딩(EMA20 위 유지중) > 익절검토(+20%, 신규) > 주의 > 관찰
function verdict(r) {
  if (r.unrealizedRet != null && r.unrealizedRet <= -15) return { label: '손절검토', cls: 'red' };
  if (r.breakdown5) return { label: '전량매도검토(5EMA이탈)', cls: 'red' };
  if (r.freshLeg20) return { label: '2차익절검토(20EMA돌파)', cls: 'teal' };
  if (r.aboveEma20) return { label: '홀딩(20EMA위)', cls: 'teal' };
  if (r.freshTp20) return { label: '익절검토(+20%)', cls: 'teal' };
  if (r.unrealizedRet != null && r.unrealizedRet <= -8) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

async function main() {
  const opts = parseArgs();
  const holdings = await fetchNotionHoldings();
  if (!holdings.length) { console.error('보유종목 없음'); return; }
  console.error(`[조회] 보유종목 ${holdings.length}개 × EMA5+EMA20 괴리율 통계 수집 중... (${holdings.map(h => h.name).join(', ')})`);

  const results = await batchAll(holdings, h => analyzeHolding(h, opts));

  console.log(`\n━━━ 보유종목 EMA5+EMA20 괴리율 통계 (최근 ${opts.days}일) ━━━\n`);
  console.log(
    '종목명'.padEnd(14) + '시장'.padStart(7) + '평단대비'.padStart(9) +
    'EMA20괴리'.padStart(10) + 'Z20'.padStart(7) + '위치20'.padStart(9) +
    'EMA5괴리'.padStart(10) + 'Z5'.padStart(7) + '위치5'.padStart(8) +
    '추세'.padStart(7) + '신호'.padStart(14) + '판단'.padStart(22)
  );
  console.log('─'.repeat(14 + 7 + 9 + 10 + 7 + 9 + 10 + 7 + 8 + 7 + 14 + 22));
  for (const r of results) {
    if (r.error) { console.log(`${r.name.padEnd(14)}  ${r.error}`); continue; }
    console.log(
      r.name.padEnd(14) +
      (r.market || '─').padStart(7) +
      fmt(r.unrealizedRet).padStart(9) +
      fmt(r.dev20).padStart(10) +
      (r.z20 == null ? '─' : r.z20.toFixed(2)).padStart(7) +
      `${r.pct20.toFixed(0)}%ile`.padStart(9) +
      fmt(r.dev5).padStart(10) +
      (r.z5 == null ? '─' : r.z5.toFixed(2)).padStart(7) +
      `${r.pct5.toFixed(0)}%ile`.padStart(8) +
      (r.downTrend == null ? '─' : r.downTrend ? '하락' : '상승').padStart(7) +
      signalLabel(r).padStart(14) +
      verdict(r).label.padStart(22)
    );
  }
  const eventRows = results.filter(r => !r.error && (r.freshTp20 || r.freshLeg20 || r.breakdown5));
  if (eventRows.length) {
    console.log('\n━━━ 오늘 신규 발생 이벤트(레그 전환) 상세 ━━━\n');
    for (const r of eventRows) {
      const evs = [];
      if (r.freshTp20) evs.push('매입가대비+20%신규도달(익절 검토)');
      if (r.freshLeg20) evs.push('EMA20 신규돌파(2차익절 검토)');
      if (r.breakdown5) evs.push('EMA5 하향이탈(잔량 전량매도 검토)');
      console.log(`${r.name}: 어제(${r.prevDate}) 평단대비${fmt(r.prevUnrealizedRet)} → 오늘(${r.date}) ${evs.join(', ')}`);
    }
  }
  console.log('');
  console.log(`※ 평단대비: 보유 평균단가 대비 현재가 손익률(실제 계좌 수익률) / EMA20·EMA5괴리율: 각 이평 대비 괴리율`);
  console.log(`※ 신호(2026-08-07 확정): EMA5·EMA20 각각 Z≤${Z_SIGNAL_THRESHOLD} & 위치≤${PCT_SIGNAL_THRESHOLD}%ile 동시충족 AND 추세=하락(EMA50<EMA200) 시 "매수"`);
  console.log(`※ 판단(2026-08-10 3단계 청산규칙): 손절검토(평단대비≤-15%, 최우선) > 전량매도검토(종가 EMA5 하향이탈) > 2차익절검토(종가 EMA20 신규돌파) > 홀딩(EMA20 위 유지중) > 익절검토(평단대비 +20%신규도달) > 주의(평단대비 -8~-15%) > 관찰`);
  console.log(`※ 매수일자·기존 이행레그가 노션 스키마에 없어 레그별 잔량(50%/25%)까지는 추적 불가 — 롤링 2일(어제·오늘) 값 비교로 매일 재판정하는 스냅샷임을 감안할 것`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
