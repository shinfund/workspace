// EMA래더(5/20/50/100/200/400) 정배열 상태 스캔 — TOP50 라이브 진단 도구
// project_stock_emaladder.mjs로 확정된 매매전략(완전정배열 전환+시장국면필터, SL10/TRAIL12/EMA100이탈/TIME60,
// TP10%/50%매도)을 기반으로, 종목별 현재 EMA래더 상태·최근 전환일·시장국면·신호를 한 눈에 보여주는 진단 스크립트.
// 사용법: node scripts/project_multi_stock_emaladder.mjs [--calendar-days N] [--recent-days N]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
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

const EMA_PERIODS = [5, 20, 50, 100, 200, 400];
const PAIRS = [[5, 20], [20, 50], [50, 100], [100, 200], [200, 400]];
const KOSPI_SYMBOL = '%5EKS11';
const REGIME_MA = 100, REGIME_SLOPE_LOOKBACK = 10, REGIME_STREAK_MIN = 10;
const TREND_BREAK_EMA = 100;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { calendarDays: 2200, recentDays: 20 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--recent-days') o.recentDays = parseInt(argv[++i]);
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
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
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
    } else { ema = price * k + ema * (1 - k); }
    emas[i] = ema;
  }
  return emas;
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

async function fetchMarketRegime(p1, p2) {
  const chart = await fetchYahooChart(KOSPI_SYMBOL, p1, p2);
  if (!chart || !chart.ts.length) throw new Error('KOSPI지수 조회 실패');
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const ma = buildEma(closes, REGIME_MA);
  let curStreak = 0, lastUp = false, lastDate = null;
  for (let i = 0; i < dates.length; i++) {
    if (ma[i] == null || i < REGIME_MA + REGIME_SLOPE_LOOKBACK || closes[i] == null) continue;
    const up = closes[i] > ma[i] && ma[i] > ma[i - REGIME_SLOPE_LOOKBACK];
    curStreak = up ? curStreak + 1 : 0;
    lastUp = up; lastDate = dates[i];
  }
  return { up: lastUp, streak: curStreak, ok: lastUp && curStreak >= REGIME_STREAK_MIN, asOf: lastDate };
}

async function scanStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const emas = {};
  for (const p of EMA_PERIODS) emas[p] = buildEma(closes, p);
  const n = closes.length;
  if (n < 401) return { ...stock, error: '데이터 부족(EMA400 워밍업 미달)' };

  const alignCount = (i) => PAIRS.filter(([s, l]) => emas[s][i] != null && emas[l][i] != null && emas[s][i] > emas[l][i]).length;

  const last = n - 1;
  const cntNow = alignCount(last);
  const fullyAligned = cntNow === PAIRS.length;

  // 가장 최근 "완전정배열 전환일" 탐색(며칠 전인지)
  let daysSinceTransition = null;
  for (let i = last; i >= 401; i--) {
    if (alignCount(i) === PAIRS.length && (i === 401 || alignCount(i - 1) < PAIRS.length)) {
      daysSinceTransition = last - i;
      break;
    }
    if (!fullyAligned) break; // 현재 미정배열이면 "최근 전환"은 의미 없음(연속 유지중이 아니므로 과거 이력 스킵)
  }

  const price = closes[last];
  const ema100 = emas[100][last];
  const distToBreak = ema100 != null ? (price - ema100) / ema100 * 100 : null;

  return { ...stock, price, cntNow, fullyAligned, daysSinceTransition, distToBreak, asOf: dates[last] };
}

function signalLabel(r, regime, recentDays) {
  if (!r.fullyAligned) return r.cntNow >= 4 ? `관찰(${r.cntNow}/5)` : `-(${r.cntNow}/5)`;
  if (!regime.ok) return '대기(국면미충족)';
  if (r.daysSinceTransition != null && r.daysSinceTransition <= recentDays) return `매수신호(D-${r.daysSinceTransition})`;
  return '정배열유지중';
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA래더 정배열 스캔] ${DEFAULT_STOCKS.length}종목, EMA${EMA_PERIODS.join('/')}, 최근전환 기준 ${opts.recentDays}거래일 이내`);

  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const regime = await fetchMarketRegime(p1, p2);
  console.error(`[시장국면] KOSPI ${regime.up ? '상승' : '하락/횡보'}, 지속 ${regime.streak}거래일, 진입허용=${regime.ok ? 'O' : 'X'} (기준일 ${regime.asOf})\n`);

  const loaded = await batchAll(DEFAULT_STOCKS, s => scanStock(s, opts));
  const errors = loaded.filter(r => r.error);
  const valid = loaded.filter(r => !r.error);
  if (errors.length) console.error(`[조회실패] ${errors.map(r => `${r.name}: ${r.error}`).join(', ')}`);

  valid.sort((a, b) => b.cntNow - a.cntNow || (a.distToBreak ?? 0) - (b.distToBreak ?? 0));

  console.log(`\n종목`.padEnd(18) + '현재가'.padStart(10) + '정배열'.padStart(8) + 'EMA100대비'.padStart(12) + '전환D-'.padStart(8) + '신호'.padStart(16));
  console.log('─'.repeat(72));
  for (const r of valid) {
    const align = `${r.cntNow}/5${r.fullyAligned ? '★' : ''}`;
    const dist = r.distToBreak != null ? `${r.distToBreak >= 0 ? '+' : ''}${r.distToBreak.toFixed(1)}%` : '-';
    const dsince = r.daysSinceTransition != null ? `D-${r.daysSinceTransition}` : '-';
    console.log(
      r.name.padEnd(18) +
      r.price.toLocaleString().padStart(10) +
      align.padStart(8) +
      dist.padStart(12) +
      dsince.padStart(8) +
      signalLabel(r, regime, opts.recentDays).padStart(16)
    );
  }

  const buySignals = valid.filter(r => r.fullyAligned && regime.ok && r.daysSinceTransition != null && r.daysSinceTransition <= opts.recentDays);
  const holding = valid.filter(r => r.fullyAligned && !(r.daysSinceTransition != null && r.daysSinceTransition <= opts.recentDays));
  console.log(`\n[요약] 완전정배열 ${valid.filter(r => r.fullyAligned).length}종목 / 그중 최근${opts.recentDays}거래일내 신규전환(매수신호) ${buySignals.length}종목 / 기존 정배열 유지중 ${holding.length}종목`);
  if (buySignals.length) console.log(`매수신호 종목: ${buySignals.map(r => r.name).join(', ')}`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
