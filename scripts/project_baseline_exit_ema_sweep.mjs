// EMA200 기준선 전략 — 청산 트리거(회복 후 첫 눌림목) EMA 기간 스윕 (2026-08-18, 사용자 요청)
// 사용법: node scripts/project_baseline_exit_ema_sweep.mjs [--from 2] [--to 20]
//
// project_baseline_strategy_backtest.mjs의 기본 확정 전략(exitMode='full1', baselineBreak=true,
// minStreak=16, z=-1.25, maxBuyLegs=2, recoverTimeout=120, postRecoverHold=60, rebound='vlow')을
// 그대로 두고, "회복 후 첫 눌림목" 판정에 쓰는 EMA 기간만 2~20으로 바꿔가며 성과를 비교한다.
// 진입 신호(반등 판정)에 쓰는 EMA5는 기존과 동일하게 고정 — 청산 트리거 EMA만 분리해서 스윕
// (entry/exit EMA를 동시에 바꾸면 두 효과가 뒤섞여 "청산 EMA만의 효과"를 판별할 수 없기 때문).
// Yahoo fetch는 종목당 1회만 하고, 기간별 재계산은 로컬에서 반복(네트워크 재호출 없음).

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

const ROLL = 250;
const ENTRY_EMA = 5;   // 진입 반등신호용 — 고정
const BASE_PERIOD = 200;
const MIN_STREAK = 16;
const Z_THRESHOLD = -1.25;
const MAX_BUY_LEGS = 2;
const RECOVER_TIMEOUT = 120;
const POST_RECOVER_HOLD = 60;
const MAX_HOLD = 180;
const CALENDAR_DAYS = 2555;

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

function rollingZ(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j].dev200;
  return sd ? (v - m) / sd : 0;
}

// buildVLowSignal — project_baseline_strategy_backtest.mjs와 동일 로직(진입 EMA5 고정)
function buildVLowSignal(seq) {
  const sig = new Array(seq.length).fill(false);
  let runningLow = null;
  let awaitingBounce = false;
  for (let i = 0; i < seq.length; i++) {
    const belowBase = seq[i].close < seq[i].ema200;
    if (!belowBase) { runningLow = null; awaitingBounce = false; continue; }
    if (runningLow === null || seq[i].close < runningLow) {
      runningLow = seq[i].close;
      awaitingBounce = true;
    }
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].emaEntry && seq[i].close >= seq[i].emaEntry;
    if (crossUp5 && awaitingBounce) {
      sig[i] = true;
      awaitingBounce = false;
    }
  }
  return sig;
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

// 종목당 1회: fetch + 진입신호(entries) 계산까지만 수행(청산 EMA와 무관한 부분)
async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const emaEntrys = buildEma(closes, ENTRY_EMA);
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emaEntrys[i] == null || ema200s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], emaEntry: emaEntrys[i], ema200: ema200s[i],
      dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100,
    });
  }
  if (seq.length < ROLL + MIN_STREAK + MAX_HOLD + 1) return { ...stock, error: '데이터 부족' };

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }
  const bounceSig = buildVLowSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const streakOk = streak[i] >= MIN_STREAK;
    const z = rollingZ(seq, i);
    flags[i] = streakOk && seq[i].bounce && z <= Z_THRESHOLD;
  }
  const events = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }
  return { ...stock, closes, seq, events, error: null };
}

// 청산 EMA 기간(exitPeriod)만 바꿔 트레이드 시뮬레이션 — exitMode='full1', baselineBreak=true 고정
// (project_baseline_strategy_backtest.mjs simulateTrade의 exitEma 파라미터화 버전)
function simulateTradeExit(seq, emaExit, i0) {
  let buyCount = 1;
  let costSum = seq[i0].close;
  let openWeight = 1.0;
  let recovered = false;
  let inWaveUp = false;
  let recoverDay = null;

  for (let d = 1; d <= MAX_HOLD; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 미확정
    const close = seq[j].close;
    const ema200 = seq[j].ema200;
    const exitEma = emaExit[j];
    if (exitEma == null) return null; // 초반 구간(짧은 EMA 시드 미형성)은 표본 제외

    if (!recovered) {
      const conditionMet = seq[j].bounce && rollingZ(seq, j) <= Z_THRESHOLD;
      if (buyCount < MAX_BUY_LEGS && conditionMet) {
        buyCount += 1;
        costSum += close;
      }
    }
    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;

    if (!recovered) {
      if (close >= ema200) {
        recovered = true;
        recoverDay = d;
        inWaveUp = close >= exitEma;
      } else if (d >= RECOVER_TIMEOUT) {
        return { weightedRet: ret, finalDay: d, reason: 'RECOVER_TIMEOUT', recovered: false };
      }
    } else {
      if (close < ema200) {
        return { weightedRet: ret, finalDay: d, reason: 'BASELINE_BREAK', recovered: true };
      }
      if (inWaveUp && close < exitEma) {
        return { weightedRet: ret, finalDay: d, reason: 'WAVE1_FULL', recovered: true };
      } else if (!inWaveUp && close >= exitEma) {
        inWaveUp = true;
      }
      if (d - recoverDay >= POST_RECOVER_HOLD) {
        return { weightedRet: ret, finalDay: d, reason: 'TIME', recovered: true };
      }
    }
    if (d === MAX_HOLD) return { weightedRet: ret, finalDay: d, reason: 'TIME', recovered };
  }
  return null;
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avg = mean(rets);
  const s = [...rets].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const avgDays = mean(trades.map(t => t.finalDay));
  const recoveredRate = trades.filter(t => t.recovered).length / trades.length * 100;
  return { n: trades.length, avg, med, win, best: Math.max(...rets), worst: Math.min(...rets), avgDays, recoveredRate };
}

async function main() {
  const argv = process.argv.slice(2);
  let from = 2, to = 20;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = parseInt(argv[++i]);
    if (argv[i] === '--to') to = parseInt(argv[++i]);
  }

  console.error(`[청산 EMA 기간 스윕] ${DEFAULT_STOCKS.length}종목, 청산EMA ${from}~${to} (진입 EMA${ENTRY_EMA}·나머지 조건은 project_baseline_strategy_backtest.mjs 기본값과 동일)`);
  console.error('데이터 로딩 중...');
  const loaded = await batchAll(DEFAULT_STOCKS, loadStock);
  const ok = loaded.filter(r => r && !r.error);
  const failed = loaded.filter(r => r && r.error);
  console.error(`로딩 완료: ${ok.length}종목 성공, ${failed.length}종목 실패${failed.length ? ' (' + failed.map(f => f.name).join(',') + ')' : ''}`);

  const rows = [];
  for (let p = from; p <= to; p++) {
    let allTrades = [];
    for (const stock of ok) {
      const emaExit = buildEma(stock.closes, p);
      for (const i0 of stock.events) {
        const t = simulateTradeExit(stock.seq, emaExit, i0);
        if (t) allTrades.push(t);
      }
    }
    const s = summarize(allTrades);
    rows.push({ p, ...s });
    console.error(`EMA${p} 완료 (n=${s.n})`);
  }

  console.log('\n━━━ 청산 트리거 EMA 기간별 성과 비교 (진입EMA5 고정, exitMode=full1) ━━━');
  console.log('EMA기간'.padEnd(8) + 'n'.padEnd(6) + '가중평균'.padEnd(10) + '중앙값'.padEnd(10) + '승률'.padEnd(8) + '최고'.padEnd(10) + '최저'.padEnd(10) + '평균보유일'.padEnd(10) + '회복도달률');
  for (const r of rows) {
    console.log(
      `${String(r.p).padEnd(8)}${String(r.n).padEnd(6)}${(r.avg >= 0 ? '+' : '') + r.avg.toFixed(2) + '%'}`.padEnd(28) +
      `${(r.med >= 0 ? '+' : '') + r.med.toFixed(2) + '%'}`.padEnd(10) +
      `${r.win.toFixed(0)}%`.padEnd(8) +
      `${(r.best >= 0 ? '+' : '') + r.best.toFixed(2) + '%'}`.padEnd(10) +
      `${r.worst.toFixed(2)}%`.padEnd(10) +
      `${r.avgDays.toFixed(1)}일`.padEnd(10) +
      `${r.recoveredRate.toFixed(0)}%`
    );
  }

  const best = [...rows].sort((a, b) => b.avg - a.avg)[0];
  const bestWin = [...rows].sort((a, b) => b.win - a.win)[0];
  console.log(`\n가중평균수익률 최고: EMA${best.p} (${best.avg >= 0 ? '+' : ''}${best.avg.toFixed(2)}%, 승률${best.win.toFixed(0)}%, n=${best.n})`);
  console.log(`승률 최고: EMA${bestWin.p} (승률${bestWin.win.toFixed(0)}%, 가중평균 ${bestWin.avg >= 0 ? '+' : ''}${bestWin.avg.toFixed(2)}%, n=${bestWin.n})`);
  console.log(`(참고) 현재 프로덕션 기본값: EMA5`);
}

main().catch(e => { console.error(e); process.exit(1); });
