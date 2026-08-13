// 매수 후 청산(매도) 전략 백테스트 — 스킬: stock-deviation
// 사용법: node scripts/project_deviation_exit_backtest.mjs [--period N] [--max-hold N] [--tp-fixed N] [--tp-pctile N] [--sl N] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입: EMA20 롤링250일 Z<=-2 & 위치<=10%ile 신호 발생일 종가 매수 (기존 신호 정의와 동일)
// 청산: 두 전략 비교 — [A] 위치(%ile)가 목표 백분위 이상으로 정상화되면 청산  vs  [B] 고정 목표수익률 도달 시 청산
//       둘 다 손절(-SL%) 또는 최대보유일(N거래일) 도달 시 강제청산 — 셋 중 가장 먼저 오는 조건 적용
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (2026-08-03 KIS 기준, 사용자 지시로 2026-08-03부터 백테스트 기본 유니버스도 TOP50로 통일 — 실전 라이브 관찰용과 동일 유니버스)
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
const ENTRY_PCT_THRESHOLD = 10;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, period: 20, maxHold: 20, tpFixed: 12, tpPctile: 50, tpZScore: 0, sl: 15, calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--tp-fixed') o.tpFixed = parseFloat(argv[++i]);
    if (argv[i] === '--tp-pctile') o.tpPctile = parseFloat(argv[++i]);
    if (argv[i] === '--tp-zscore') o.tpZScore = parseFloat(argv[++i]);
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

function rollingZPct(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  const m = mean(win), sd = stdev(win, m);
  const z = sd ? (seq[j].dev - m) / sd : 0;
  const pct = win.filter(d => d <= seq[j].dev).length / win.length * 100;
  return { z, pct };
}

async function backtestStock(stock, opts) {
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

  // 진입 신호 탐지 (기존과 동일: Z<=-2 & 위치<=10%ile, 발생일만)
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const { z, pct } = rollingZPct(seq, i);
    flags[i] = z <= Z_THRESHOLD && pct <= ENTRY_PCT_THRESHOLD;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  // 각 이벤트에 대해 청산 전략 A(위치 정상화)·B(고정목표)·C(Z-score 정상화) 시뮬레이션
  const tradesA = [], tradesB = [], tradesC = [];
  for (const i0 of events) {
    const entryClose = seq[i0].close;
    let doneA = false, doneB = false, doneC = false;
    let resA = null, resB = null, resC = null;
    for (let d = 1; d <= opts.maxHold; d++) {
      const j = i0 + d;
      if (j >= seq.length) break; // 아직 결과 미확정(최근 신호) — 이 이벤트는 미완료 처리
      const ret = (seq[j].close - entryClose) / entryClose * 100;
      const prevRet = d === 1 ? 0 : (seq[j - 1].close - entryClose) / entryClose * 100;
      const dayMove = (seq[j].close - seq[j - 1].close) / seq[j - 1].close * 100; // 그 날 하루치 등락률(전일종가 대비)

      if (!doneA) {
        if (ret <= -opts.sl) { resA = { exit: 'SL', ret, days: d, exitDate: seq[j].date, prevRet, dayMove }; doneA = true; }
        else {
          const { pct } = rollingZPct(seq, j);
          if (pct >= opts.tpPctile) { resA = { exit: 'TP', ret, days: d, exitDate: seq[j].date }; doneA = true; }
          else if (d === opts.maxHold) { resA = { exit: 'TIME', ret, days: d, exitDate: seq[j].date }; doneA = true; }
        }
      }
      if (!doneB) {
        if (ret <= -opts.sl) { resB = { exit: 'SL', ret, days: d, exitDate: seq[j].date, prevRet, dayMove }; doneB = true; }
        else if (ret >= opts.tpFixed) { resB = { exit: 'TP', ret, days: d, exitDate: seq[j].date }; doneB = true; }
        else if (d === opts.maxHold) { resB = { exit: 'TIME', ret, days: d, exitDate: seq[j].date }; doneB = true; }
      }
      if (!doneC) {
        if (ret <= -opts.sl) { resC = { exit: 'SL', ret, days: d, exitDate: seq[j].date, prevRet, dayMove }; doneC = true; }
        else {
          const { z } = rollingZPct(seq, j);
          if (z >= opts.tpZScore) { resC = { exit: 'TP', ret, days: d, exitDate: seq[j].date }; doneC = true; }
          else if (d === opts.maxHold) { resC = { exit: 'TIME', ret, days: d, exitDate: seq[j].date }; doneC = true; }
        }
      }
      if (doneA && doneB && doneC) break;
    }
    if (resA) tradesA.push({ date: seq[i0].date, name: stock.name, ...resA });
    if (resB) tradesB.push({ date: seq[i0].date, name: stock.name, ...resB });
    if (resC) tradesC.push({ date: seq[i0].date, name: stock.name, ...resC });
  }

  return { ...stock, tradesA, tradesB, tradesC, totalEvents: events.length };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const byReason = { SL: 0, TP: 0, TIME: 0 };
  for (const t of trades) byReason[t.exit]++;
  const avgDays = mean(trades.map(t => t.days));
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets),
    byReason, avgDays,
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[청산전략 백테스트] ${opts.stocks.length}종목 × EMA${opts.period}, 손절-${opts.sl}%/최대${opts.maxHold}거래일, TP-A=위치≥${opts.tpPctile}%ile vs TP-B=고정+${opts.tpFixed}% vs TP-C=Z-score≥${opts.tpZScore}`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));

  console.log(`\n━━━ 매수 후 청산 전략 백테스트 ━━━`);
  console.log(`진입: EMA${opts.period} 롤링${ROLL}일 Z<=${Z_THRESHOLD} & 위치<=${ENTRY_PCT_THRESHOLD}%ile 신호일 종가 매수`);
  console.log(`공통: 손절 -${opts.sl}% / 최대보유 ${opts.maxHold}거래일 (먼저 오는 조건 적용)\n`);

  const pooledA = [], pooledB = [], pooledC = [];
  for (const r of results) {
    if (r.error) { console.log(`[${r.name}] ${r.error}`); continue; }
    pooledA.push(...r.tradesA);
    pooledB.push(...r.tradesB);
    pooledC.push(...r.tradesC);
  }

  console.log(`━━━ 전략 A: 청산 = 위치(%ile) ≥ ${opts.tpPctile}%ile 정상화 (또는 손절/시간청산) ━━━`);
  const sA = summarize(pooledA);
  if (sA) {
    console.log(`n=${sA.n}  평균 ${sA.avg >= 0 ? '+' : ''}${sA.avg.toFixed(2)}%  중앙값 ${sA.med >= 0 ? '+' : ''}${sA.med.toFixed(2)}%  승률 ${sA.win.toFixed(0)}%  최고 +${sA.best.toFixed(2)}%  최저 ${sA.worst.toFixed(2)}%  평균보유 ${sA.avgDays.toFixed(1)}거래일`);
    console.log(`청산사유: TP(위치정상화) ${sA.byReason.TP}건 / SL(손절) ${sA.byReason.SL}건 / TIME(시간청산) ${sA.byReason.TIME}건`);
  } else console.log('유효 표본 없음');

  console.log(`\n━━━ 전략 B: 청산 = 고정 목표수익률 +${opts.tpFixed}% (또는 손절/시간청산) ━━━`);
  const sB = summarize(pooledB);
  if (sB) {
    console.log(`n=${sB.n}  평균 ${sB.avg >= 0 ? '+' : ''}${sB.avg.toFixed(2)}%  중앙값 ${sB.med >= 0 ? '+' : ''}${sB.med.toFixed(2)}%  승률 ${sB.win.toFixed(0)}%  최고 +${sB.best.toFixed(2)}%  최저 ${sB.worst.toFixed(2)}%  평균보유 ${sB.avgDays.toFixed(1)}거래일`);
    console.log(`청산사유: TP(목표달성) ${sB.byReason.TP}건 / SL(손절) ${sB.byReason.SL}건 / TIME(시간청산) ${sB.byReason.TIME}건`);
  } else console.log('유효 표본 없음');

  console.log(`\n━━━ 전략 C: 청산 = Z-score ≥ ${opts.tpZScore} 정상화 (또는 손절/시간청산) ━━━`);
  const sC = summarize(pooledC);
  if (sC) {
    console.log(`n=${sC.n}  평균 ${sC.avg >= 0 ? '+' : ''}${sC.avg.toFixed(2)}%  중앙값 ${sC.med >= 0 ? '+' : ''}${sC.med.toFixed(2)}%  승률 ${sC.win.toFixed(0)}%  최고 +${sC.best.toFixed(2)}%  최저 ${sC.worst.toFixed(2)}%  평균보유 ${sC.avgDays.toFixed(1)}거래일`);
    console.log(`청산사유: TP(Z정상화) ${sC.byReason.TP}건 / SL(손절) ${sC.byReason.SL}건 / TIME(시간청산) ${sC.byReason.TIME}건`);
  } else console.log('유효 표본 없음');

  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');

  // ── 손절(-SL%) 갭하락 상세 분석 ── (A/B 공통 — SL 판정 조건·순서가 동일해 발생일이 같음)
  const slTrades = pooledA.filter(t => t.exit === 'SL');
  console.log(`\n━━━ 손절(-${opts.sl}%) 갭하락 상세 (${slTrades.length}건) ━━━`);
  console.log(`직전일누적%: 손절 전날까지의 누적수익률 / 당일등락률: 손절 확정일 하루치 전일종가대비 등락률\n`);
  let gapCount = 0;
  for (const t of slTrades) {
    const overshoot = -opts.sl - t.ret; // 손절선(-SL%)보다 얼마나 더 빠졌는지(양수=더 빠짐)
    const isGap = t.dayMove <= -5; // 하루 등락률이 -5% 이하면 갭하락(급락)으로 간주
    if (isGap) gapCount++;
    console.log(`${t.date}→${t.exitDate}  ${t.name.padEnd(14)} 직전일누적 ${t.prevRet >= 0 ? '+' : ''}${t.prevRet.toFixed(2)}%  →  손절확정 ${t.ret.toFixed(2)}%  (당일등락률 ${t.dayMove >= 0 ? '+' : ''}${t.dayMove.toFixed(2)}%, 목표선 초과하락 ${overshoot.toFixed(2)}%p)${isGap ? '  ★갭하락' : ''}`);
  }
  console.log(`\n총 ${slTrades.length}건 중 하루 등락률 -5% 이하(갭하락으로 간주) ${gapCount}건`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
