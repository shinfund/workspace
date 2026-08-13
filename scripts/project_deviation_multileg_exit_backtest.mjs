// 다단계 분할청산(Z기반 2단 익절 + 되돌림 전량청산 + 잔량 트레일링스탑) 백테스트 — 스킬: stock-deviation
// 사용법: node scripts/project_deviation_multileg_exit_backtest.mjs [--period N] [--max-hold N] [--sl N] [--trail-list 12,15] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입: EMA20 롤링250일 Z<=-2 & 위치<=10%ile 신호 발생일 종가 매수 (기존 신호 정의와 동일)
// 청산(사용자 지정 규칙):
//   - 손절: 진입가 대비 -SL%(기본15) 도달 시 그 시점 잔여 물량 전량 청산 (최우선 판정)
//   - 1차 익절: Z>=0 최초 도달 시 잔량의 50% 매도
//   - 2차 익절: 1차 이후 Z>=2 도달 시 "남은 잔량"의 50%(전체의 25%) 추가 매도
//   - 되돌림 전량청산: 1차 익절 이후(2차 도달 전) Z가 다시 <=0으로 이탈하면 남은 잔량 전량 청산
//   - 잔량 트레일링스탑: 2차 익절 이후 남은 25%는 매입가 대비 고점수익률 +20% 이상 찍힌 뒤부터 감시 시작,
//     이후 진입 후 고가(종가 기준) 대비 -trail% 하락 시 전량 청산 (아직 +20% 미도달이면 트레일링 미작동)
//   - 시간청산: 위 조건 없이 최대보유일(N거래일) 도달 시 남은 잔량 전량 청산
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
const TP1_Z = 0;      // 1차 익절 기준(Z모드)
const TP2_Z = 2;      // 2차 익절 기준(Z모드)
const REVERT_Z = 0;   // 되돌림(이탈) 기준(Z모드)
const TP1_PCT = 50;   // 1차 익절 기준(위치%ile모드) — Z=0에 대응(중앙값 회복)
const TP2_PCT = 97.7; // 2차 익절 기준(위치%ile모드) — 정규분포 가정 시 Z=2에 대응
const REVERT_PCT = 50; // 되돌림 기준(위치%ile모드)
const TRAIL_ARM_PCT = 20; // 트레일링스탑 감시 시작 임계값(매입가 대비 고점수익률 %)

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, period: 20, maxHold: 20, sl: 15, trailList: [12, 15], calendarDays: 1100, mode: 'z' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--trail-list') o.trailList = argv[++i].split(',').map(Number);
    if (argv[i] === '--mode') o.mode = argv[++i]; // 'z'(키움 실적용 가능) | 'pct'(정확한 위치%ile, 백테스트 참고용)
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

function rollingZPct(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  const m = mean(win), sd = stdev(win, m);
  const z = sd ? (seq[j].dev - m) / sd : 0;
  const pct = win.filter(d => d <= seq[j].dev).length / win.length * 100;
  // 종가 기준 평균·표준편차(m, sd)는 그대로 두고, 당일 고가로 계산한 괴리율을 같은 분포에 대입한 zHigh
  const zHigh = sd ? (seq[j].devHigh - m) / sd : 0;
  const pctHigh = win.filter(d => d <= seq[j].devHigh).length / win.length * 100;
  return { z, pct, zHigh, pctHigh };
}

// 이벤트 하나를 지정 trail%로 시뮬레이션 — 다리(leg)별 {weight, ret, reason} 배열 반환
function simulateTrade(seq, i0, opts, trailPct) {
  const entryClose = seq[i0].close;
  let runningPeak = entryClose;
  let openWeight = 1.0;
  let stage = 'INIT'; // INIT -> PARTIAL1 -> TRAIL
  let trailArmed = false; // 매입가 대비 고점수익률이 TRAIL_ARM_PCT% 이상 찍힌 뒤에만 트레일링 감시 시작
  const legs = [];
  let lastDay = null, lastDate = null;

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정(최근 신호)
    const close = seq[j].close;
    const ret = (close - entryClose) / entryClose * 100;
    if (close > runningPeak) runningPeak = close;
    lastDay = d; lastDate = seq[j].date;

    // 1) 손절 최우선 판정
    if (ret <= -opts.sl) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d, date: seq[j].date });
      openWeight = 0;
      break;
    }

    // 2) 단계별 전환(같은 날 캐스케이드 가능하도록 while로 재확인)
    const { z, zHigh, pct, pctHigh } = rollingZPct(seq, j);
    const tp1Hit = opts.mode === 'pct' ? (pct >= TP1_PCT || pctHigh >= TP1_PCT) : (z >= TP1_Z || zHigh >= TP1_Z);
    const tp2Hit = opts.mode === 'pct' ? (pct >= TP2_PCT) : (z >= TP2_Z);
    const revertHit = opts.mode === 'pct' ? (pct <= REVERT_PCT) : (z <= REVERT_Z);
    let cascading = true;
    while (cascading && openWeight > 0) {
      cascading = false;
      if (stage === 'INIT') {
        if (tp1Hit) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'TP1', day: d, date: seq[j].date });
          openWeight -= w;
          stage = 'PARTIAL1';
          cascading = true; // 같은 날 바로 2차 조건까지 확인
        }
      } else if (stage === 'PARTIAL1') {
        if (tp2Hit) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'TP2', day: d, date: seq[j].date });
          openWeight -= w;
          stage = 'TRAIL';
          cascading = true; // 같은 날 트레일링 스탑 조건까지 확인
        } else if (revertHit) {
          legs.push({ weight: openWeight, ret, reason: 'REVERT', day: d, date: seq[j].date });
          openWeight = 0;
        }
      } else if (stage === 'TRAIL') {
        const peakRet = (runningPeak - entryClose) / entryClose * 100;
        if (!trailArmed && peakRet >= TRAIL_ARM_PCT) trailArmed = true;
        if (trailArmed) {
          const trailFloor = runningPeak * (1 - trailPct / 100);
          if (close <= trailFloor) {
            legs.push({ weight: openWeight, ret, reason: 'TRAIL', day: d, date: seq[j].date });
            openWeight = 0;
          }
        }
      }
    }
    if (openWeight <= 0) break;

    // 3) 시간청산(최대보유일 도달)
    if (d === opts.maxHold && openWeight > 0) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null; // 루프 종료까지 못 닫힘(이론상 발생 안 함)

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalDay = legs[legs.length - 1].day;
  const finalDate = legs[legs.length - 1].date;
  const reachedTP1 = legs.some(l => l.reason === 'TP1');
  const reachedTP2 = legs.some(l => l.reason === 'TP2');
  return { legs, weightedRet, finalDay, finalDate, reachedTP1, reachedTP2, entryDate: seq[i0].date };
}

async function backtestStock(stock, opts, trailPct) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const highs = chart.high;
  const emas = buildEma(closes, opts.period);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || emas[i] == null) continue;
    const high = highs[i] != null ? highs[i] : closes[i];
    seq.push({
      date: dates[i], close: closes[i],
      dev: (closes[i] - emas[i]) / emas[i] * 100,
      devHigh: (high - emas[i]) / emas[i] * 100,
    });
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

  const trades = [];
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts, trailPct);
    if (t) trades.push({ name: stock.name, ...t });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.weightedRet);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.finalDay));
  const reasonCount = {};
  let reasonWeight = {};
  for (const t of trades) {
    for (const l of t.legs) {
      reasonCount[l.reason] = (reasonCount[l.reason] || 0) + 1;
      reasonWeight[l.reason] = (reasonWeight[l.reason] || 0) + l.weight;
    }
  }
  const noTp1 = trades.filter(t => !t.reachedTP1).length;
  const tp1OnlyThenRevertOrOther = trades.filter(t => t.reachedTP1 && !t.reachedTP2).length;
  const fullTp2 = trades.filter(t => t.reachedTP2).length;
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays,
    reasonCount, reasonWeight, noTp1, tp1OnlyThenRevertOrOther, fullTp2,
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[다단계 청산 백테스트] ${opts.stocks.length}종목 × EMA${opts.period}, 손절-${opts.sl}%/최대${opts.maxHold}거래일, 모드=${opts.mode}`);
  if (opts.mode === 'pct') {
    console.error(`청산규칙(위치%ile모드·백테스트 참고용, 키움 미구현): 1차익절 50%(위치>=${TP1_PCT}%ile) → 2차익절 잔량50%(위치>=${TP2_PCT}%ile) → 되돌림 전량(위치<=${REVERT_PCT}%ile) → 잔량 트레일링(고점수익 +${TRAIL_ARM_PCT}%↑ 도달 후 고가대비 -trail%)`);
  } else {
    console.error(`청산규칙(Z모드·키움 실적용 가능): 1차익절 50%(Z>=${TP1_Z}, 고가/종가 OR) → 2차익절 잔량50%(Z>=${TP2_Z}) → 되돌림 전량(Z<=${REVERT_Z}) → 잔량 트레일링(고점수익 +${TRAIL_ARM_PCT}%↑ 도달 후 고가대비 -trail%)`);
  }

  for (const trailPct of opts.trailList) {
    const results = await batchAll(opts.stocks, s => backtestStock(s, opts, trailPct));
    const pooled = [];
    for (const r of results) {
      if (r.error) continue;
      pooled.push(...r.trades);
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`━━━ 트레일링 -${trailPct}% 기준 결과 ━━━`);
    const s = summarizeTrades(pooled);
    if (!s) { console.log('유효 표본 없음'); continue; }

    console.log(`n=${s.n}  가중평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률(가중수익>0) ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균종결일 ${s.avgDays.toFixed(1)}거래일`);
    console.log(`\n[레그(leg)별 발생 빈도 / 가중치 합]`);
    for (const [reason, cnt] of Object.entries(s.reasonCount)) {
      console.log(`  ${reason.padEnd(6)}: ${cnt}건  (가중치 합 ${s.reasonWeight[reason].toFixed(2)})`);
    }
    console.log(`\n[진행 경로 분류]`);
    console.log(`  1차 익절(Z>=0)도 못 감(SL/시간청산으로 전량 종료): ${s.noTp1}건`);
    console.log(`  1차 익절만 하고 2차 못 감(되돌림 전량청산 등): ${s.tp1OnlyThenRevertOrOther}건`);
    console.log(`  2차 익절까지 도달(트레일링 단계 진입): ${s.fullTp2}건`);
  }
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ weightedRet = 각 레그(분할청산분) 수익률을 진입가 기준으로 계산 후 비중(가중치)만큼 가중합산한 트레이드 전체 수익률');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
