// 여러 종목 EMA 괴리율 통계 비교
// ★매일·자주 실행하는 핵심 스크립트★ (2026-07-25 확정, 2026-08-07 진입조건 전면 개편) — 스킬: stock-deviation
// 사용법: node scripts/project_multi_stock_deviation_stats.mjs [--stocks 코드:이름,코드:이름,...] [--days N]
// 2026-08-07 확정 매수신호: EMA5·EMA20 각각 Z<=-2 & 위치<=3%ile 동시충족(AND) AND EMA50<EMA200(장기 하락추세) (위치임계값은 스윕 백테스트로 10→3 조임)
//   백테스트(project_deviation_dual_ema_exit_backtest.mjs, TOP50×7년) 결과: n=197, 가중평균+3.86%, 승률80%, SL비율3%
//   (기존 EMA20단독 신호 대비 신호수 -33%, 승률+5%p, SL비율 9%→3%로 대폭 개선 — 상세는 project_stock_deviation_stats 메모 참조)
// 기본값: 시가총액 TOP20, 최근 2년(730일) 통계window(Z/위치 계산 모집단) — 백테스트로 확정한 조합
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP20 (2026-07-25 기준)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '032830', name: '삼성생명' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '105560', name: 'KB금융' },
  { code: '000270', name: '기아' },
  { code: '028260', name: '삼성물산' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '012330', name: '현대모비스' },
  { code: '034730', name: 'SK' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '068270', name: '셀트리온' },
  { code: '006400', name: '삼성SDI' },
  { code: '086790', name: '하나금융지주' },
];

const FAST_PERIOD = 5;
const SLOW_PERIOD = 20;
const TREND_MID_PERIOD = 50;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, days: 730 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.days = parseInt(argv[++i]);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => {
        const [code, name, market] = s.split(':');
        return { code, name: name || code, market: market || 'KOSPI' };
      });
    }
  }
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
    req.setTimeout(15000, () => { req.destroy(); rej(new Error('timeout')); });
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

function stdev(arr, mean) {
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

async function batchAll(items, fn, concurrency = 6, delay = 100) {
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

async function analyzeStock(stock, days) {
  // EMA200 안정화를 위해 넉넉한 워밍업 확보(6배수 — trend_filter_backtest.mjs와 동일 사상)
  const WARMUP_DAYS = TREND_LONG_PERIOD * 6;
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (days + WARMUP_DAYS) * 24 * 3600;

  // 시장 라벨(KOSPI/KOSDAQ)에 맞는 심볼을 우선 조회하고, 데이터가 비정상적으로 적으면(라벨 오류 대비)
  // 반대 시장도 조회해 더 데이터가 많은 쪽을 채택 — 상장이력 짧은 종목도 실제 보유 이력만큼은 그대로 활용
  const primaryMarket = stock.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
  const altMarket = primaryMarket === 'KOSDAQ' ? 'KOSPI' : 'KOSDAQ';
  const suffixOf = m => (m === 'KOSDAQ' ? 'KQ' : 'KS');

  let chart = await fetchYahooChart(`${stock.code}.${suffixOf(primaryMarket)}`, p1, p2);
  if (!chart || chart.ts.length < SLOW_PERIOD) {
    const altChart = await fetchYahooChart(`${stock.code}.${suffixOf(altMarket)}`, p1, p2);
    if (altChart && altChart.ts.length > (chart?.ts.length || 0)) chart = altChart;
  }
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const statCutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    if (new Date(dates[i]) < statCutoff) continue;
    rows.push({
      date: dates[i], close: closes[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100,
      dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100,
      ema50: ema50s[i], ema200: ema200s[i],
    });
  }
  if (!rows.length) return { ...stock, error: '통계 대상 구간 데이터 없음' };

  const dev5s = rows.map(r => r.dev5);
  const dev20s = rows.map(r => r.dev20);
  const cur = rows[rows.length - 1];

  const s5 = zAndPct(dev5s, cur.dev5);
  const s20 = zAndPct(dev20s, cur.dev20);
  const downTrend = cur.ema50 != null && cur.ema200 != null ? cur.ema50 < cur.ema200 : null;

  return {
    ...stock, n: rows.length,
    cur5: cur.dev5, z5: s5.z, pct5: s5.pct,
    cur20: cur.dev20, z20: s20.z, pct20: s20.pct,
    downTrend,
  };
}

function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

// 매수 신호 판정 임계값 (2026-08-07 확정 기준)
const Z_SIGNAL_THRESHOLD = -2;
const PCT_SIGNAL_THRESHOLD = 3; // 2026-08-07 스윕 백테스트로 10→3 조임(Z<=-2 단독으로 이미 대부분 5%ile 근처까지 떨어져 10은 사실상 무의미했음)

function hitZP(z, pct) { return z != null && z <= Z_SIGNAL_THRESHOLD && pct <= PCT_SIGNAL_THRESHOLD; }

function finalSignal(r) {
  const hit5 = hitZP(r.z5, r.pct5);
  const hit20 = hitZP(r.z20, r.pct20);
  if (hit5 && hit20 && r.downTrend === true) return '매수';
  if (hit5 && hit20 && r.downTrend === false) return '보류(상승추세)';
  if (hit5 || hit20) return '관찰';
  return '─';
}

async function main() {
  const opts = parseArgs();
  console.error(`[조회] ${opts.stocks.length}개 종목 × 최근 ${opts.days}일 EMA5+EMA20 괴리율 통계 수집 중...`);

  const results = await batchAll(opts.stocks, s => analyzeStock(s, opts.days));

  console.log(`\n━━━ 종목별 5EMA+20EMA 괴리율 통계 비교 (최근 ${opts.days}일, 매수신호=Z+P AND 하락추세) ━━━\n`);
  console.log(
    '종목명'.padEnd(16) + 'EMA20괴리'.padStart(10) + 'Z20'.padStart(7) + '위치20'.padStart(9) +
    'EMA5괴리'.padStart(10) + 'Z5'.padStart(7) + '위치5'.padStart(8) +
    '추세'.padStart(8) + '신호'.padStart(14)
  );
  console.log('─'.repeat(105));
  for (const r of results) {
    if (r.error) { console.log(`${r.name.padEnd(16)}  ${r.error}`); continue; }
    console.log(
      r.name.padEnd(16) +
      fmt(r.cur20).padStart(10) +
      (r.z20 == null ? '─' : r.z20.toFixed(2)).padStart(7) +
      `${r.pct20.toFixed(0)}%ile`.padStart(9) +
      fmt(r.cur5).padStart(10) +
      (r.z5 == null ? '─' : r.z5.toFixed(2)).padStart(7) +
      `${r.pct5.toFixed(0)}%ile`.padStart(8) +
      (r.downTrend == null ? '─' : r.downTrend ? '하락' : '상승').padStart(8) +
      finalSignal(r).padStart(14)
    );
  }
  console.log('');
  console.log(`※ 매수신호 확정 조건(2026-08-07): EMA5·EMA20 각각 Z<=${Z_SIGNAL_THRESHOLD} & 위치<=${PCT_SIGNAL_THRESHOLD}%ile 동시충족 AND 추세=하락(EMA50<EMA200)`);
  console.log(`※ "보류(상승추세)": Z+P 조건은 충족했으나 장기추세가 상승이라 백테스트상 SL비율이 높아 매수 보류 권장`);
  console.log(`※ "관찰": EMA5·EMA20 중 하나만 신호 충족 — 참고용, 확정 매수신호 아님`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
