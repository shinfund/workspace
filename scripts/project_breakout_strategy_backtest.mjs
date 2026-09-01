// 돌파 매매전략(N일 신고가 돌파 + 거래량 필터) 1차 백테스트 (2026-09-01)
// 배경: 눌림목(상승추세 중 조정 후 재진입, 진입이 늦음)과 반대 철학 — 신고가 갱신 시점에 바로 진입하는
// 추세추종 전략 신규 후보. 장대양봉 돌파추격형 검증에서 "목표가를 멀리 잡으면(측정이동) 회전율이 죽어
// perDay가 반토막난다"는 교훈을 반영해, 고정 목표가 대신 트레일링스탑 위주로 청산 설계.
// ⚠️ 파라미터는 1차 추정치(그리드서치 안 됨) — 결과 확인 후 필요시 SL/TRAIL/lookback/거래량배수 재탐색 예정.
//
// 진입: ①종가가 breakoutLookback(60거래일) 내 최고종가를 처음 갱신(돌파 당일만, 연속 신고가일은 제외)
//   ②당일 거래량이 직전20일 평균거래량×volumeMultiplier(1.5) 이상 ③상승국면필터(종가>=EMA200)
// 청산: STOP=진입가×(1-SL%) 또는 TRAIL=보유중 최고종가×(1-TRAIL%) 중 더 높은(타이트한) 쪽 / TIME=maxHold거래일
// 사용법: node scripts/project_breakout_strategy_backtest.mjs [--lookback 60] [--vol-mult 1.5]
//   [--sl 8] [--trail 8] [--max-hold 40] [--no-require-uptrend]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));
const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    stocks: DEFAULT_STOCKS, calendarDays: 2555,
    lookback: 60, volMult: 1.5, volLookback: 20, sl: 8, trail: 8, maxHold: 40, requireUptrend: true,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--lookback') o.lookback = parseInt(argv[++i]);
    if (argv[i] === '--vol-mult') o.volMult = parseFloat(argv[++i]);
    if (argv[i] === '--vol-lookback') o.volLookback = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--trail') o.trail = parseFloat(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--require-uptrend') o.requireUptrend = true;
    if (argv[i] === '--no-require-uptrend') o.requireUptrend = false;
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
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], volume: q.volume || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
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

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
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

function detectAndSimulate(seq, opts) {
  const n = seq.length;
  const trades = [];
  const startIdx = Math.max(opts.lookback, opts.volLookback, BASE_PERIOD) + 1;
  for (let i = startIdx; i < n; i++) {
    const close = seq[i].close;
    const priorHigh = Math.max(...seq.slice(i - opts.lookback, i).map(s => s.close));
    const prevClose = seq[i - 1].close;
    const prevPriorHigh = Math.max(...seq.slice(i - 1 - opts.lookback, i - 1).map(s => s.close));
    const isBreakout = close > priorHigh;
    const wasAlreadyHigh = prevClose > prevPriorHigh;
    if (!isBreakout || wasAlreadyHigh) continue; // 돌파 당일만(연속 신고가일 제외)

    const avgVol = mean(seq.slice(i - opts.volLookback, i).map(s => s.volume).filter(v => v != null));
    if (!avgVol || seq[i].volume == null || seq[i].volume < avgVol * opts.volMult) continue;

    const ema200 = seq[i].ema200;
    const uptrend = ema200 != null ? close >= ema200 : null;
    if (opts.requireUptrend && uptrend !== true) continue;

    const entry = close;
    const entryIdx = i;
    let peak = entry;
    let result = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = entryIdx + d;
      if (j >= n) { result = null; break; }
      const c = seq[j].close;
      if (c > peak) peak = c;
      const slLevel = entry * (1 - opts.sl / 100);
      const trailLevel = peak * (1 - opts.trail / 100);
      const stopLevel = Math.max(slLevel, trailLevel);
      if (c <= stopLevel) {
        const reason = trailLevel > slLevel ? 'TRAIL' : 'SL';
        result = { ret: (c - entry) / entry * 100, day: d, reason, date: seq[j].date };
        break;
      }
      if (d === opts.maxHold) { result = { ret: (c - entry) / entry * 100, day: d, reason: 'TIME', date: seq[j].date }; break; }
    }
    if (!result) continue;
    trades.push({ name: seq[0].name, entryDate: seq[entryIdx].date, entry, uptrend, ...result });
  }
  return trades;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], volume: chart.volume[i] ?? null, ema200: ema200s[i] ?? null, name: stock.name });
  }
  const minLen = Math.max(opts.lookback, opts.volLookback, BASE_PERIOD) + opts.maxHold + 10;
  if (seq.length < minLen) return { ...stock, error: '데이터 부족' };

  const trades = detectAndSimulate(seq, opts);
  return { ...stock, trades };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  const avg = mean(rets);
  return { n: rets.length, avg, med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, perDay: avg / avgDays, reasonCount };
}

async function main() {
  const opts = parseArgs();
  console.error(`[돌파 매매전략 1차 백테스트] ${opts.stocks.length}종목, ${opts.lookback}거래일 신고가 돌파+거래량${opts.volMult}배↑, SL${opts.sl}%/TRAIL${opts.trail}%/최대${opts.maxHold}거래일, 상승국면필터=${opts.requireUptrend}`);
  console.error(`⚠️ 파라미터 1차 추정치(그리드서치 안 됨)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const allTrades = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    allTrades.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const s = summarize(allTrades);
  if (!s) { console.log('유효 표본 없음'); return; }

  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  평균 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균보유 ${s.avgDays.toFixed(1)}거래일  perDay ${s.perDay >= 0 ? '+' : ''}${s.perDay.toFixed(3)}%`);
  console.log(`청산사유: ${Object.entries(s.reasonCount).map(([r, c]) => `${r} ${c}건(${(c / s.n * 100).toFixed(0)}%)`).join(' / ')}`);

  const byStock = {};
  for (const t of allTrades) {
    if (!byStock[t.name]) byStock[t.name] = [];
    byStock[t.name].push(t);
  }
  const stockRows = Object.entries(byStock).map(([name, ts]) => ({ name, ...summarize(ts) })).sort((a, b) => b.n - a.n);
  console.log(`\n━━━ 종목별 신호수(상위 15) ━━━`);
  for (const row of stockRows.slice(0, 15)) {
    console.log(`  ${row.name.padEnd(12)} n=${row.n}건  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%  perDay ${row.perDay >= 0 ? '+' : ''}${row.perDay.toFixed(3)}%`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
