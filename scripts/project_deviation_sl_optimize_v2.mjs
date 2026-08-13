// 손절선(SL) 재최적화 백테스트 — 2026-08-07 신규 진입·청산 규칙(5+20EMA AND 하락추세, 3단계 매도) 기준
// 스킬: stock-deviation
// 사용법: node scripts/project_deviation_sl_optimize_v2.mjs [--sl-list 6,8,10,12,15,18,20,25,999] [--max-hold N] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입: EMA5·EMA20 각각 Z<=-2 & 위치<=3%ile 동시충족(AND) AND EMA50<EMA200(장기 하락추세) — project_deviation_dual_ema_exit_backtest.mjs와 동일
// 청산: SL후보%(최우선) → EMA5돌파50%매도 → EMA20돌파 잔량50%(전체25%)매도 → EMA5하향이탈 잔량전량매도 → 시간청산(기본20거래일)
// 데이터는 종목당 1회만 조회하고, SL 후보값별로 재계산(재조회 없음) — project_deviation_pct_threshold_sweep.mjs와 동일 방식
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' },
  { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' }, { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' }, { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' }, { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '006400', name: '삼성SDI' },
  { code: '000810', name: '삼성화재' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' }, { code: '005490', name: 'POSCO홀딩스' },
  { code: '267260', name: 'HD현대일렉트릭' }, { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' }, { code: '042700', name: '한미반도체' },
  { code: '011200', name: 'HMM' }, { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' }, { code: '010140', name: '삼성중공업' },
  { code: '051910', name: 'LG화학' }, { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' }, { code: '018260', name: '삼성에스디에스' },
  { code: '267250', name: 'HD현대' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const ROLL = 250, Z_THRESHOLD = -2, ENTRY_PCT_THRESHOLD = 3;
const FAST_PERIOD = 5, SLOW_PERIOD = 20, TREND_MID_PERIOD = 50, TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, maxHold: 20, calendarDays: 2555, slList: [6, 8, 10, 12, 15, 18, 20, 25, 999] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl-list') o.slList = argv[++i].split(',').map(Number);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => { const [code, name, market] = s.split(':'); return { code, name: name || code, market: market || 'KOSPI' }; });
    }
  }
  return o;
}
function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej); req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < closes.length; i++) {
    const p = closes[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; } else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function stdev(a, m) { return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function median(a) { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null); let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); if (delay) await new Promise(r => setTimeout(r, delay)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
function rollingZPct(seq, j, devKey) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r[devKey]);
  const m = mean(win), sd = stdev(win, m), v = seq[j][devKey];
  return { z: sd ? (v - m) / sd : 0, pct: win.filter(d => d <= v).length / win.length * 100 };
}

// 3단계 매도 시뮬레이션 (SL 값만 파라미터화, 나머지는 확정 규칙과 동일)
function simulateTrade(seq, i0, sl, maxHold) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0, stage = 'INIT';
  const legs = [];
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null;
    const close = seq[j].close, ema5 = seq[j].ema5, ema20 = seq[j].ema20;
    const ret = (close - entryClose) / entryClose * 100;
    if (ret <= -sl) { legs.push({ weight: openWeight, ret, reason: 'SL' }); openWeight = 0; break; }
    if (stage === 'INIT' && close >= ema5) { const w = openWeight * 0.5; legs.push({ weight: w, ret, reason: 'LEG5' }); openWeight -= w; stage = 'LEG5_DONE'; }
    if (stage === 'LEG5_DONE' && close >= ema20) { const w = openWeight * 0.5; legs.push({ weight: w, ret, reason: 'LEG20' }); openWeight -= w; stage = 'HOLD'; }
    if (stage === 'HOLD' && close < ema5) { legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN' }); openWeight = 0; break; }
    if (d === maxHold && openWeight > 1e-9) { legs.push({ weight: openWeight, ret, reason: 'TIME' }); openWeight = 0; }
  }
  if (openWeight > 1e-9) return null;
  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const hasSL = legs.some(l => l.reason === 'SL');
  const worstLegRet = Math.min(...legs.map(l => l.ret));
  return { weightedRet, hasSL, worstLegRet };
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };
  const dates = chart.ts.map(tsToKstDate), closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD), ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD), ema200s = buildEma(closes, TREND_LONG_PERIOD);
  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i], ema50: ema50s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100, dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100 });
  }
  if (seq.length < ROLL + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5'), z20 = rollingZPct(seq, i, 'dev20');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const sig20 = z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    flags[i] = sig5 && sig20 && downTrend;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) if (flags[i] && !flags[i - 1]) events.push(i);

  const bySl = {};
  for (const sl of opts.slList) {
    const trades = [];
    for (const i0 of events) { const t = simulateTrade(seq, i0, sl, opts.maxHold); if (t) trades.push(t); }
    bySl[sl] = trades;
  }
  return { ...stock, bySl, totalEvents: events.length };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const slRate = trades.filter(t => t.hasSL).length / trades.length * 100;
  const sd = stdev(rets, mean(rets));
  return { n: rets.length, avg: mean(rets), med: median(rets), win, slRate, sd, riskAdj: sd ? mean(rets) / sd : null, worst: Math.min(...rets) };
}

async function main() {
  const opts = parseArgs();
  console.error(`[손절선 재최적화] ${opts.stocks.length}종목 × SL후보 [${opts.slList.join(', ')}]%, 진입=5+20EMA AND 하락추세(위치≤${ENTRY_PCT_THRESHOLD}%ile), 청산=3단계매도, 최대${opts.maxHold}거래일`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const errors = results.filter(r => r.error);
  if (errors.length) console.error(`[조회실패] ${errors.map(r => r.name).join(', ')}`);

  console.log(`\n━━━ 손절선(SL)별 비교 (진입·청산조건 동일, SL값만 교체) ━━━\n`);
  console.log('SL'.padEnd(8) + 'n'.padStart(6) + '가중평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'SL비율'.padStart(8) + '위험조정'.padStart(10) + '최저'.padStart(10));
  console.log('─'.repeat(70));
  for (const sl of opts.slList) {
    const pooled = [];
    for (const r of results) if (!r.error) pooled.push(...r.bySl[sl]);
    const s = summarize(pooled);
    const label = sl >= 999 ? '무손절' : `-${sl}%`;
    if (!s) { console.log(`${label.padEnd(8)}표본없음`); continue; }
    console.log(
      label.padEnd(8) + String(s.n).padStart(6) +
      `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
      `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
      `${s.win.toFixed(0)}%`.padStart(8) +
      `${s.slRate.toFixed(0)}%`.padStart(8) +
      `${s.riskAdj == null ? '─' : s.riskAdj.toFixed(2)}`.padStart(10) +
      `${s.worst.toFixed(1)}%`.padStart(10)
    );
  }

  // 후회율 분석: 기준 SL(-15%)로 손절 확정된 거래마다 "손절 없이 최대보유일까지 버텼다면" 비교
  const baseSl = 15;
  const noStopTrades999 = new Map(); // stock name -> events map for lookup 필요 없음, 아래서 직접 재계산
  console.log(`\n━━━ 후회율 분석 (기준 SL -${baseSl}% 대비 무손절이었다면) ━━━\n`);
  let defendCount = 0, regretCount = 0, defendSum = 0, regretSum = 0;
  for (const r of results) {
    if (r.error) continue;
    const slTrades = r.bySl[baseSl], noStopTrades = r.bySl[999];
    if (!slTrades || !noStopTrades || slTrades.length !== noStopTrades.length) continue;
    for (let i = 0; i < slTrades.length; i++) {
      if (slTrades[i].hasSL) {
        const diff = noStopTrades[i].weightedRet - slTrades[i].weightedRet;
        if (diff > 0) { regretCount++; regretSum += diff; } else { defendCount++; defendSum += -diff; }
      }
    }
  }
  const totalSlCases = defendCount + regretCount;
  if (totalSlCases) {
    console.log(`SL(-${baseSl}%) 확정 거래 ${totalSlCases}건 중: 방어(손절이 나음) ${defendCount}건(평균 방어폭 +${(defendSum / (defendCount || 1)).toFixed(2)}%p) / 후회(보유가 나음) ${regretCount}건(평균 후회폭 +${(regretSum / (regretCount || 1)).toFixed(2)}%p)`);
  } else {
    console.log('SL(-15%) 확정 거래 없음 — 후회율 분석 대상 없음');
  }

  console.log('\n※ SL비율=해당 SL값에서 손절로 종료된 거래 비중 / 위험조정=평균÷표준편차(높을수록 안정적) / 진입조건은 모든 SL후보에서 동일(신호 자체는 SL과 무관)');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
