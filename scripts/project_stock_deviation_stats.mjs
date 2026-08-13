// 종목별 25일선(EMA25) 괴리율 통계 — 스킬: stock-deviation (매일·자주 사용)
// 사용법: node scripts/project_stock_deviation_stats.mjs [종목코드] [종목명] [--days N]
// 기본값: 005930(삼성전자), 최근 1년(365일) 통계 (EMA25 시드용 워밍업 구간 별도 확보)
// ※ 여러 종목 비교는 project_multi_stock_deviation_stats.mjs(기본 EMA20×TOP20×2년) 사용
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { code: '005930', name: '삼성전자', days: 365 };
  if (argv[0] && !argv[0].startsWith('--')) o.code = argv[0];
  if (argv[1] && !argv[1].startsWith('--')) o.name = argv[1];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.days = parseInt(argv[++i]);
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
  const data = await httpGetJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  return { ts, close: q.close || [] };
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// EMA(period) — SMA로 시드 후 표준 재귀식 (20ma_analysis.mjs buildEmaSeries와 동일 로직)
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

function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stdev(arr, mean) {
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

async function main() {
  const opts = parseArgs();
  const EMA_PERIOD = 25;
  const WARMUP_DAYS = 60; // EMA25 시드 안정화용 여유(달력일 기준)

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - (opts.days + WARMUP_DAYS) * 24 * 3600;
  const symbol = `${opts.code}.KS`;

  console.error(`[조회] ${opts.name}(${symbol}) Yahoo Finance 일봉 수집 중...`);
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) {
    console.error('데이터 조회 실패');
    process.exit(1);
  }

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emas = buildEma(closes, EMA_PERIOD);

  // 워밍업(EMA 시드 안정화) 이후, 최근 opts.days 달력일 구간만 통계 대상
  const statCutoff = new Date(Date.now() - opts.days * 24 * 3600 * 1000);
  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emas[i] == null) continue;
    if (new Date(dates[i]) < statCutoff) continue;
    const dev = (closes[i] - emas[i]) / emas[i] * 100;
    rows.push({ date: dates[i], close: closes[i], ema: emas[i], dev });
  }

  if (!rows.length) {
    console.error('통계 대상 구간에 데이터가 없습니다.');
    process.exit(1);
  }

  const devs = rows.map(r => r.dev);
  const sorted = [...devs].sort((a, b) => a - b);
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  const sd = stdev(devs, mean);
  const cur = rows[rows.length - 1];

  const thresholds = [-20, -15, -10, -5, 5, 10, 15, 20];
  const counts = thresholds.map(t => devs.filter(d => t < 0 ? d <= t : d >= t).length);

  console.log(`\n━━━ ${opts.name}(${opts.code}) 25일선(EMA25) 괴리율 통계 ━━━`);
  console.log(`분석기간: ${rows[0].date} ~ ${rows[rows.length - 1].date}  (거래일 ${rows.length}일)\n`);

  console.log(`[현재] 종가 ${cur.close.toLocaleString('ko-KR')} / EMA25 ${Math.round(cur.ema).toLocaleString('ko-KR')} / 괴리율 ${cur.dev >= 0 ? '+' : ''}${cur.dev.toFixed(2)}%\n`);

  console.log('[기술통계]');
  console.log(`  평균(mean)        : ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}%`);
  console.log(`  표준편차(std)     : ${sd.toFixed(2)}%p`);
  console.log(`  최댓값(max)       : +${sorted[sorted.length - 1].toFixed(2)}%  (${rows.find(r => r.dev === sorted[sorted.length - 1]).date})`);
  console.log(`  최솟값(min)       : ${sorted[0].toFixed(2)}%  (${rows.find(r => r.dev === sorted[0]).date})`);
  console.log(`  중앙값(median)    : ${percentile(sorted, 50) >= 0 ? '+' : ''}${percentile(sorted, 50).toFixed(2)}%`);
  console.log(`  ±1σ 구간          : ${(mean - sd).toFixed(2)}% ~ ${(mean + sd).toFixed(2)}%`);
  console.log(`  ±2σ 구간          : ${(mean - 2 * sd).toFixed(2)}% ~ ${(mean + 2 * sd).toFixed(2)}%\n`);

  console.log('[백분위수 (percentile)]');
  for (const p of [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
    const v = percentile(sorted, p);
    console.log(`  P${String(p).padStart(2, '0')} : ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
  }

  console.log('\n[구간별 도달일수 (누적)]');
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    const n = counts[i];
    const pct = (n / devs.length * 100).toFixed(1);
    console.log(`  괴리율 ${t < 0 ? '≤' : '≥'} ${t >= 0 ? '+' : ''}${t}%  : ${n}일 (${pct}%)`);
  }
  console.log('');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
