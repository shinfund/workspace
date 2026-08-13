// 손절선(-SL%) 최적화 백테스트 — 스킬: stock-deviation
// 사용법: node scripts/project_deviation_stoploss_optimize.mjs [--period N] [--max-hold N] [--tp-pctile N] [--sl-list 6,8,10,12,15,18,20,999] [--calendar-days N]
// 진입: EMA20 롤링250일 Z<=-2 & 위치<=10%ile 신호 발생일 종가 매수 (기존 신호 정의와 동일)
// 청산: 확정 전략 A만 사용 — 위치(%ile) >= tp-pctile 정상화 시 익절, 그 전에 손절(-SL%) 도달 시 손절, 둘 다 아니면 max-hold 거래일 시간청산
// 목적: 손절 폭(SL)을 6~20%(+무손절 999)까지 스윕하며 평균수익률·승률·효율(%/일)·리스크지표(worst/stdev)·후회율(SL 이후 반등 여부) 비교 → 현재 기본값(-12%) 최적성 검증
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

const ROLL = 250;
const Z_THRESHOLD = -2;
const ENTRY_PCT_THRESHOLD = 10;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, period: 20, maxHold: 20, tpPctile: 50, calendarDays: 1100, slList: [6, 8, 10, 12, 15, 18, 20, 999] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--tp-pctile') o.tpPctile = parseFloat(argv[++i]);
    if (argv[i] === '--sl-list') o.slList = argv[++i].split(',').map(Number);
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

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return arr.length > 1 ? Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)) : 0; }
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

function rollingZPct(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  const m = mean(win), sd = stdev(win, m);
  const z = sd ? (seq[j].dev - m) / sd : 0;
  const pct = win.filter(d => d <= seq[j].dev).length / win.length * 100;
  return { z, pct };
}

// 종목 하나에 대해 데이터 조회 + 진입이벤트 탐지까지만 수행(1회) — SL값별 재시뮬레이션은 순수 계산이라 재조회 불필요
async function loadStockSeq(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emas = buildEma(closes, opts.period);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emas[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], dev: (closes[i] - emas[i]) / emas[i] * 100 });
  }
  if (seq.length < ROLL + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const { z, pct } = rollingZPct(seq, i);
    flags[i] = z <= Z_THRESHOLD && pct <= ENTRY_PCT_THRESHOLD;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  return { ...stock, seq, events };
}

// 이벤트 하나를 특정 SL값으로 시뮬레이션 (전략 A: 익절=위치>=tpPctile 정상화)
function simulateEvent(seq, i0, name, entryDate, opts, sl) {
  const entryClose = seq[i0].close;
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정
    const ret = (seq[j].close - entryClose) / entryClose * 100;
    if (ret <= -sl) {
      // 손절 확정 시점의 "만약 손절 없이 끝까지 보유했다면"의 결과(후회율 계산용)도 함께 산출
      let heldRet = ret, heldDay = d;
      for (let d2 = d + 1; d2 <= opts.maxHold; d2++) {
        const j2 = i0 + d2;
        if (j2 >= seq.length) break;
        heldRet = (seq[j2].close - entryClose) / entryClose * 100;
        heldDay = d2;
      }
      return { name, date: entryDate, exit: 'SL', ret, days: d, exitDate: seq[j].date, heldRet, heldDay };
    }
    const { pct } = rollingZPct(seq, j);
    if (pct >= opts.tpPctile) return { name, date: entryDate, exit: 'TP', ret, days: d, exitDate: seq[j].date };
    if (d === opts.maxHold) return { name, date: entryDate, exit: 'TIME', ret, days: d, exitDate: seq[j].date };
  }
  return null;
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const m = mean(rets), sd = stdev(rets, m);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const byReason = { SL: 0, TP: 0, TIME: 0 };
  for (const t of trades) byReason[t.exit]++;
  const avgDays = mean(trades.map(t => t.days));
  const efficiency = avgDays ? m / avgDays : 0;
  const sharpeLike = sd ? m / sd : 0;
  return {
    n: rets.length, avg: m, med: median(rets), sd, win,
    best: Math.max(...rets), worst: Math.min(...rets),
    byReason, avgDays, efficiency, sharpeLike,
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[손절선 최적화 백테스트] ${opts.stocks.length}종목 × EMA${opts.period}, 익절=위치≥${opts.tpPctile}%ile / 최대${opts.maxHold}거래일, SL후보=${opts.slList.map(s => s >= 999 ? '무손절' : `-${s}%`).join(', ')}`);

  const loaded = await batchAll(opts.stocks, s => loadStockSeq(s, opts));
  const valid = loaded.filter(r => !r.error);
  const invalid = loaded.filter(r => r.error);
  for (const r of invalid) console.log(`[${r.name}] ${r.error}`);

  console.log(`\n━━━ 손절선(SL) 최적화 백테스트 ━━━`);
  console.log(`진입: EMA${opts.period} 롤링${ROLL}일 Z<=${Z_THRESHOLD} & 위치<=${ENTRY_PCT_THRESHOLD}%ile 신호일 종가 매수`);
  console.log(`청산(전략A): 익절=위치(%ile)≥${opts.tpPctile}%ile 정상화 / 시간청산=최대${opts.maxHold}거래일 / 손절=아래 SL값별 비교\n`);

  const rows = [];
  for (const sl of opts.slList) {
    const pooled = [];
    for (const r of valid) {
      for (const i0 of r.events) pooled.push(simulateEvent(r.seq, i0, r.name, r.seq[i0].date, opts, sl));
    }
    const trades = pooled.filter(Boolean);
    const s = summarize(trades);
    if (s) rows.push({ sl, ...s });
  }

  const label = sl => sl >= 999 ? '무손절' : `-${sl}%`;
  const colw = { sl: 8, n: 5, avg: 9, med: 9, win: 6, sd: 8, sharpe: 8, eff: 9, days: 7, sl_n: 6 };
  console.log(
    'SL'.padEnd(colw.sl) + 'n'.padStart(colw.n) + '평균%'.padStart(colw.avg) + '중앙값%'.padStart(colw.med) +
    '승률%'.padStart(colw.win) + '표준편차'.padStart(colw.sd) + '평균/표준편차'.padStart(colw.sharpe) +
    '효율%/일'.padStart(colw.eff) + '평균보유일'.padStart(colw.days) + 'SL건수'.padStart(colw.sl_n)
  );
  console.log('─'.repeat(colw.sl + colw.n + colw.avg + colw.med + colw.win + colw.sd + colw.sharpe + colw.eff + colw.days + colw.sl_n));
  for (const r of rows) {
    console.log(
      label(r.sl).padEnd(colw.sl) +
      String(r.n).padStart(colw.n) +
      `${r.avg >= 0 ? '+' : ''}${r.avg.toFixed(2)}`.padStart(colw.avg) +
      `${r.med >= 0 ? '+' : ''}${r.med.toFixed(2)}`.padStart(colw.med) +
      `${r.win.toFixed(0)}`.padStart(colw.win) +
      `${r.sd.toFixed(2)}`.padStart(colw.sd) +
      `${r.sharpeLike.toFixed(2)}`.padStart(colw.sharpe) +
      `${r.efficiency >= 0 ? '+' : ''}${r.efficiency.toFixed(3)}`.padStart(colw.eff) +
      `${r.avgDays.toFixed(1)}`.padStart(colw.days) +
      String(r.byReason.SL).padStart(colw.sl_n)
    );
  }

  const bestByAvg = [...rows].sort((a, b) => b.avg - a.avg)[0];
  const bestBySharpe = [...rows].sort((a, b) => b.sharpeLike - a.sharpeLike)[0];
  const bestByWorst = [...rows].sort((a, b) => b.worst - a.worst)[0];
  console.log(`\n평균수익률 최고: SL ${label(bestByAvg.sl)} (평균 ${bestByAvg.avg >= 0 ? '+' : ''}${bestByAvg.avg.toFixed(2)}%)`);
  console.log(`위험조정(평균/표준편차) 최고: SL ${label(bestBySharpe.sl)} (${bestBySharpe.sharpeLike.toFixed(2)})`);
  console.log(`최악손실 최소: SL ${label(bestByWorst.sl)} (${bestByWorst.worst.toFixed(2)}%)`);

  // ── 후회율 분석: 현재 기본값(-12%) 기준, 손절 확정 후 max-hold까지 보유했다면 결과가 어땠을지 ──
  const baseSl = opts.slList.includes(12) ? 12 : opts.slList[0];
  const basePooled = [];
  for (const r of valid) {
    for (const i0 of r.events) basePooled.push(simulateEvent(r.seq, i0, r.name, r.seq[i0].date, opts, baseSl));
  }
  const baseSlTrades = basePooled.filter(t => t && t.exit === 'SL');
  console.log(`\n━━━ 후회율 분석 (기준 SL ${label(baseSl)}, ${baseSlTrades.length}건 손절) ━━━`);
  console.log('손절 확정 시점 vs "손절 없이 최대보유일까지 버텼다면"의 결과 비교 — 손절이 손실을 줄였는지(방어) 아니면 이후 반등을 놓쳤는지(후회) 판별\n');
  let defended = 0, regretted = 0, regretGainSum = 0, defendLossSavedSum = 0;
  for (const t of baseSlTrades) {
    const diff = t.heldRet - t.ret; // 양수 = 계속 들고 있었으면 더 나았음(후회) / 음수 = 손절이 방어됨
    if (diff > 0) { regretted++; regretGainSum += diff; }
    else { defended++; defendLossSavedSum += -diff; }
    console.log(`${t.date}→${t.exitDate}  ${t.name.padEnd(14)} 손절확정 ${t.ret.toFixed(2)}%  →  최대보유(${opts.maxHold}일)까지 버텼다면 ${t.heldRet >= 0 ? '+' : ''}${t.heldRet.toFixed(2)}%(${t.heldDay}일차)  ${diff > 0 ? `[후회 +${diff.toFixed(2)}%p]` : `[방어 ${(-diff).toFixed(2)}%p]`}`);
  }
  console.log(`\n총 ${baseSlTrades.length}건 중 방어(손절이 더 나음) ${defended}건 / 후회(계속 보유가 더 나음) ${regretted}건`);
  if (defended) console.log(`방어 시 평균 절감 손실: ${(defendLossSavedSum / defended).toFixed(2)}%p`);
  if (regretted) console.log(`후회 시 평균 놓친 수익: ${(regretGainSum / regretted).toFixed(2)}%p`);

  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ 이 백테스트는 거래비용(세금+수수료) 미반영 — 별도 과제로 검토 예정');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
