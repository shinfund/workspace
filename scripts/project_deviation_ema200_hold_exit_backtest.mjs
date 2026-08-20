// EMA5·EMA200 단 두 개 이평선만으로 진입·청산을 판정하는 괴리율 전략 백테스트
// 스킬: stock-deviation (2026-08-19 EMA5·200 단순화 버전 — project_deviation_tp20_exit_backtest.mjs 기반, EMA20/EMA50 및 Z-score 이중조건·장기추세 필터 전부 삭제)
// 사용법: node scripts/project_deviation_ema200_hold_exit_backtest.mjs [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입: 종가 < EMA200(장기 이평선 아래=조정국면) AND EMA5 괴리율(dev5) 롤링250일 Z<=-2 & 위치<=3%ile(과매도)
// 청산(2026-08-19, 손절은 수동 판단이라 자동화 대상 아님):
//   - 진입 후 종가가 EMA200을 상향돌파(종가>=EMA200)하기 전까지는 무조건 홀딩(자동 청산 트리거 없음)
//   - EMA200 상향돌파 시점부터 감시 시작. 이후 아래 둘 중 먼저 발생하는 조건에 전량 청산
//     · 종가가 EMA5 아래로 하향이탈
//     · 종가가 EMA200 아래로 재하향이탈(돌파 후 반납)
//   - 데이터 종료 시점까지 돌파도 청산도 없으면 미확정(표본 제외)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (project_deviation_tp20_exit_backtest.mjs와 동일 유니버스)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' },
  { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' },
  { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' },
  { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' },
  { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' },
  { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' },
  { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' },
  { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' },
  { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' },
  { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' },
  { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' },
  { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' },
  { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' },
  { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' },
  { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' },
  { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' },
  { code: '010950', name: 'S-Oil' },
];

const ROLL = 250;
const Z_THRESHOLD = -2;
const ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, calendarDays: 2555, sl: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
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
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [], high: q.high || [] };
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }
function median(arr) {
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

function rollingZPct(seq, j, devKey) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r[devKey]);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j][devKey];
  const z = sd ? (v - m) / sd : 0;
  const pct = win.filter(d => d <= v).length / win.length * 100;
  return { z, pct };
}

// 진입 후 EMA200 상향돌파 전까지 무조건 홀딩(단, 손절 SL은 항상 최우선) → 돌파 시점부터 EMA5 하향이탈 또는 EMA200 재하향이탈 중 먼저 발생 시 전량청산
function simulateTrade(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let armed = false;
  let armedDay = null, armedDate = null;

  for (let j = i0 + 1; j < seq.length; j++) {
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema200 = seq[j].ema200;
    if (ema200 == null || ema5 == null) continue;
    const day = j - i0;
    const ret = (close - entryClose) / entryClose * 100;

    // 손절(항상 최우선, 돌파 전/후 무관)
    if (opts.sl != null && ret <= -opts.sl) {
      return { ret, reason: 'SL', day, date: seq[j].date, entryDate: seq[i0].date, armed, armedDay, armedDate };
    }

    if (!armed) {
      if (close >= ema200) { armed = true; armedDay = day; armedDate = seq[j].date; }
      continue; // 돌파 전에는 손절 외 어떤 조건에도 청산하지 않음
    }

    const brokeEma5 = close < ema5;
    const brokeEma200 = close < ema200;
    if (brokeEma5 || brokeEma200) {
      const reason = brokeEma5 && brokeEma200 ? 'BOTH' : (brokeEma5 ? 'EMA5_BREAK' : 'EMA200_BREAK');
      return {
        ret, reason, day, date: seq[j].date,
        entryDate: seq[i0].date, armed: true, armedDay, armedDate,
      };
    }
  }
  return null; // 데이터 종료까지 미확정(돌파 전 대기중이거나 돌파 후 청산 트리거 미도달)
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100,
    });
  }
  if (seq.length < ROLL + 1) return { ...stock, error: '데이터 부족' };

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const belowEma200 = seq[i].close < seq[i].ema200;
    flags[i] = sig5 && belowEma200; // 2026-08-19: EMA5·EMA200만 사용
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const trades = [];
  let neverArmed = 0, unresolvedAfterArm = 0;
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts);
    if (t) { trades.push({ name: stock.name, ...t }); continue; }
    // 미확정 표본 분류(참고용): 데이터 끝까지 EMA200을 못 넘었는지, 넘었지만 아직 청산 트리거 전인지
    let armedSomewhere = false;
    for (let j = i0 + 1; j < seq.length; j++) {
      if (seq[j].ema200 != null && seq[j].close >= seq[j].ema200) { armedSomewhere = true; break; }
    }
    if (armedSomewhere) unresolvedAfterArm++; else neverArmed++;
  }
  return { ...stock, trades, totalEvents: events.length, neverArmed, unresolvedAfterArm };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.day));
  const armedDays = trades.map(t => t.armedDay).filter(d => d != null);
  const avgArmedDays = armedDays.length ? mean(armedDays) : null;
  const slBeforeArm = trades.filter(t => t.reason === 'SL' && !t.armed).length;
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays, avgArmedDays, reasonCount, slBeforeArm,
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA5·EMA200만 사용하는 괴리율 진입 + EMA200 돌파대기 홀드 청산 백테스트] ${opts.stocks.length}종목, 기간 ${opts.calendarDays}일, SL=${opts.sl != null ? `-${opts.sl}%` : '없음'}`);
  console.error(`진입: 종가<EMA200 AND EMA5 괴리율 Z<=${Z_THRESHOLD} & 위치<=${ENTRY_PCT_THRESHOLD}%ile`);
  console.error(`청산(신규): ${opts.sl != null ? `손절 -${opts.sl}%(항상 최우선) → ` : ''}EMA200 상향돌파 전까지 무조건 홀딩(손절 외 트리거 없음) → 돌파 시점부터 EMA5 하향이탈 또는 EMA200 재하향이탈 중 먼저 발생 시 전량청산`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  let totalNeverArmed = 0, totalUnresolvedAfterArm = 0;
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
    totalNeverArmed += r.neverArmed;
    totalUnresolvedAfterArm += r.unresolvedAfterArm;
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const totalEvents = results.reduce((a, r) => a + (r.totalEvents || 0), 0);
  console.log(`\n전체 신호(이벤트) 발생: ${totalEvents}건`);
  console.log(`  청산 확정(표본): ${pooled.length}건`);
  console.log(`  미확정 - EMA200 돌파 자체를 데이터 끝까지 못함: ${totalNeverArmed}건`);
  console.log(`  미확정 - EMA200 돌파는 했으나 청산 트리거(EMA5/EMA200 재이탈) 전(현재 보유중 추정): ${totalUnresolvedAfterArm}건`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('\n유효 표본 없음'); return; }

  console.log(`\n━━━ 전체 결과(신규 청산규칙, SL=${opts.sl != null ? `-${opts.sl}%` : '없음'}) ━━━`);
  console.log(`n=${s.n}  평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률 ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%`);
  console.log(`평균 청산일 ${s.avgDays.toFixed(1)}거래일 (그중 EMA200 돌파까지 도달한 트레이드의 평균 돌파소요일 ${s.avgArmedDays != null ? s.avgArmedDays.toFixed(1) : '─'}거래일)`);
  console.log(`\n[청산 사유별 빈도]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(14)}: ${cnt}건`);
  }
  if (opts.sl != null) console.log(`\nSL 중 EMA200 돌파 전에 손절된 건수: ${s.slBeforeArm}건 (전체 SL ${s.reasonCount.SL || 0}건 중)`);

  console.log(`\n━━━ 종목별 신호수 ━━━`);
  const byStock = results.filter(r => !r.error && r.trades?.length).map(r => ({ name: r.name, totalEvents: r.totalEvents, ...summarizeTrades(r.trades) })).sort((a, b) => b.n - a.n);
  for (const row of byStock) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(청산확정${row.n}건)  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
  console.log('\n※ 손절은 수동 판단 영역이라 이 백테스트에는 자동 손절/시간청산 트리거가 없습니다. "미확정" 표본은 실거래라면 여전히 보유 중인 포지션에 해당합니다.');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
