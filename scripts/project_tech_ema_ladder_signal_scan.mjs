// EMA 래더(5/20/50/100/200/400) 기반 기술적 분석 신호 백테스트 — 1차 탐색(신호 품질 스캔)
// 목적: 신규 "기술적 분석" 스킬을 (a)매매전략 or (b)진단 리포트 도구 중 어느 쪽으로 만들지 결정하기 위해,
//       EMA래더 정배열/크로스오버 신호들이 순수 +N거래일 forward return에 조금이라도 예측력이 있는지 스캔.
//       청산규칙은 아직 설계하지 않음(project_deviation_signal_backtest.mjs와 동일한 "신호 품질만 우선 확인" 방식).
// 유니버스: 시가총액 TOP50(project_stock_pullback.mjs DEFAULT_STOCKS 재사용, 2026-08-06/07 기준)
// 사용법: node scripts/project_tech_ema_ladder_signal_scan.mjs [--calendar-days N] [--horizons 10,20,40]
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

const EMA_PERIODS = [5, 20, 50, 100, 200, 400]; // 사용자 표준 이평체계
const PAIRS = [[5, 20], [20, 50], [50, 100], [100, 200], [200, 400]]; // 인접쌍(래더 순서)

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { calendarDays: 2200, horizons: [10, 20, 40] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--horizons') o.horizons = argv[++i].split(',').map(Number);
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
    } else {
      ema = price * k + ema * (1 - k);
    }
    emas[i] = ema;
  }
  return emas;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
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

async function loadStock(stock, opts) {
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
  const warmup = 400; // EMA400 시드 확보
  const events = { FULL_BULLISH: [], ALIGN4: [] };
  for (const [s, l] of PAIRS) events[`GOLDEN_${s}_${l}`] = [];

  const alignCount = (i) => PAIRS.filter(([s, l]) => emas[s][i] != null && emas[l][i] != null && emas[s][i] > emas[l][i]).length;

  for (let i = warmup + 1; i < n; i++) {
    if (closes[i] == null) continue;
    if (EMA_PERIODS.some(p => emas[p][i] == null || emas[p][i - 1] == null)) continue;

    // 정배열 카운트 상태전이
    const cntToday = alignCount(i), cntYest = alignCount(i - 1);
    if (cntToday === PAIRS.length && cntYest < PAIRS.length) events.FULL_BULLISH.push(i);
    if (cntToday >= 4 && cntYest < 4) events.ALIGN4.push(i);

    // 인접쌍 골든크로스
    for (const [s, l] of PAIRS) {
      const key = `GOLDEN_${s}_${l}`;
      const todayUp = emas[s][i] > emas[l][i];
      const yestUp = emas[s][i - 1] > emas[l][i - 1];
      if (todayUp && !yestUp) events[key].push(i);
    }
  }

  return { ...stock, dates, closes, n, events };
}

function forwardReturn(closes, i, horizon) {
  const j = i + horizon;
  if (j >= closes.length || closes[j] == null || closes[i] == null) return null;
  return (closes[j] - closes[i]) / closes[i] * 100;
}

function summarize(rets) {
  if (!rets.length) return null;
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}

function fmtRow(label, s) {
  if (!s) return `${label.padEnd(20)} 데이터 없음`;
  return label.padEnd(20) +
    String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) +
    `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA래더 신호 스캔] ${DEFAULT_STOCKS.length}종목, 최근${opts.calendarDays}일, EMA${EMA_PERIODS.join('/')}, horizon=+${opts.horizons.join('/+')}거래일`);

  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStock(s, opts));
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  const valid = loaded.filter(r => !r.error);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);
  console.error(`[로드완료] ${valid.length}종목\n`);

  const signalKeys = ['FULL_BULLISH', 'ALIGN4', ...PAIRS.map(([s, l]) => `GOLDEN_${s}_${l}`)];

  for (const horizon of opts.horizons) {
    console.log(`\n════════ +${horizon}거래일 forward return ════════`);
    console.log('신호'.padEnd(20) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
    console.log('─'.repeat(63));
    for (const key of signalKeys) {
      const rets = [];
      for (const r of valid) {
        for (const i of r.events[key]) {
          const ret = forwardReturn(r.closes, i, horizon);
          if (ret != null) rets.push(ret);
        }
      }
      console.log(fmtRow(key, summarize(rets)));
    }
  }

  // 참고: 무조건부 베이스라인(전체 구간 랜덤 시점 forward return) — 신호가 베이스라인 대비 우위인지 비교용
  console.log(`\n════════ 베이스라인(무신호, 매일 시점) ════════`);
  console.log('신호'.padEnd(20) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(63));
  for (const horizon of opts.horizons) {
    const rets = [];
    for (const r of valid) {
      for (let i = 400; i < r.n; i += 5) { // 5일 간격 샘플링(과다표본 방지)
        const ret = forwardReturn(r.closes, i, horizon);
        if (ret != null) rets.push(ret);
      }
    }
    console.log(fmtRow(`+${horizon}거래일`, summarize(rets)));
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
