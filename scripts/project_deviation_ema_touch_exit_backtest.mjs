// EMA20 터치/돌파 확인 매도규칙 백테스트 — 스킬: stock-deviation (2026-08-03 신규 익절규칙 검증용, 2026-08-06 SMA20 잠깐 시도 후 같은 날 EMA20으로 재확정)
// 사용법: node scripts/project_deviation_ema_touch_exit_backtest.mjs [--period N] [--max-hold N] [--sl N] [--calendar-days N] [--stocks 코드:이름:시장,...]
// 진입: EMA20 롤링250일 Z<=-2 & 위치<=10%ile 신호 발생일 종가 매수 (기존 신호 정의와 동일)
// 청산(2026-08-03 사용자 지정 규칙):
//   ① 손절(전량): 진입가 대비 -SL%(기본15) 도달 시 잔여 물량 전량 청산 — 항상 최우선 판정
//   ② 1차 익절(수량50%): 고가 또는 종가가 EMA20 터치·돌파(≥EMA20)한 날 발생
//   ③ 돌파 확인(잔량 판정): ②가 발생한 다음 거래일 종가로 판정 — 종가>EMA20이면 잔량 홀딩, 아니면 잔량 전량 청산
//   ④ 지속 보유: 확정 이후 종가가 EMA20 아래로 하향 이탈하면 그 시점에 잔량 전량 청산(그 전까지 계속 홀딩)
//   ⑤ 시간청산: 위 조건 없이 최대보유일(N거래일) 도달 시 잔량 전량 청산
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
  const o = { stocks: DEFAULT_STOCKS, period: 20, maxHold: 20, sl: 15, calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
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

function rollingZPct(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  const m = mean(win), sd = stdev(win, m);
  const z = sd ? (seq[j].dev - m) / sd : 0;
  const pct = win.filter(d => d <= seq[j].dev).length / win.length * 100;
  return { z, pct };
}

// 이벤트 하나를 시뮬레이션 — legs 배열([{weight, ret, reason, day, date}]) 반환
// stage: INIT(터치 전) -> AWAIT_CONFIRM(터치 다음날 확인 대기) -> HOLD(돌파확정, 하향이탈 감시)
function simulateTrade(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let openWeight = 1.0;
  let stage = 'INIT';
  const legs = [];
  let everTouched = false;

  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 아직 결과 미확정(최근 신호)
    const close = seq[j].close;
    const high = seq[j].high;
    const ema = seq[j].ema;
    const ret = (close - entryClose) / entryClose * 100;

    // ① 손절 최우선 판정 (매입가 대비 -SL%)
    if (ret <= -opts.sl) {
      legs.push({ weight: openWeight, ret, reason: 'SL', day: d, date: seq[j].date });
      openWeight = 0;
      break;
    }

    if (stage === 'INIT') {
      const touched = high >= ema || close >= ema;
      if (touched) {
        everTouched = true;
        const w = openWeight * 0.5;
        legs.push({ weight: w, ret, reason: 'TOUCH1', day: d, date: seq[j].date });
        openWeight -= w;
        stage = 'AWAIT_CONFIRM';
      }
    } else if (stage === 'AWAIT_CONFIRM') {
      if (close > ema) {
        stage = 'HOLD'; // 돌파 확정 — 잔량 홀딩 지속(이 날은 매도 없음)
      } else {
        legs.push({ weight: openWeight, ret, reason: 'FAIL_CONFIRM', day: d, date: seq[j].date });
        openWeight = 0;
        break;
      }
    } else if (stage === 'HOLD') {
      if (close < ema) {
        legs.push({ weight: openWeight, ret, reason: 'BREAKDOWN', day: d, date: seq[j].date });
        openWeight = 0;
        break;
      }
    }

    // ⑤ 시간청산(최대보유일 도달)
    if (d === opts.maxHold && openWeight > 0) {
      legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
      openWeight = 0;
    }
  }
  if (openWeight > 1e-9) return null;

  const weightedRet = legs.reduce((a, l) => a + l.weight * l.ret, 0);
  const finalDay = legs[legs.length - 1].day;
  return { legs, weightedRet, finalDay, entryDate: seq[i0].date, everTouched };
}

async function backtestStock(stock, opts) {
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
      date: dates[i], close: closes[i], high, ema: emas[i],
      dev: (closes[i] - emas[i]) / emas[i] * 100,
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
    const t = simulateTrade(seq, i0, opts);
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
  const neverTouched = trades.filter(t => !t.everTouched).length;
  const touchedButFailedConfirm = trades.filter(t => t.legs.some(l => l.reason === 'FAIL_CONFIRM')).length;
  const confirmedThenHeld = trades.filter(t => t.everTouched && !t.legs.some(l => l.reason === 'FAIL_CONFIRM')).length;
  return {
    n: rets.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays,
    reasonCount, reasonWeight, neverTouched, touchedButFailedConfirm, confirmedThenHeld,
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[EMA20 터치/돌파 확인 매도규칙 백테스트] ${opts.stocks.length}종목 × EMA${opts.period}, 손절-${opts.sl}%/최대${opts.maxHold}거래일`);
  console.error(`청산규칙: ①손절-${opts.sl}%(최우선) ②1차익절50%(고가·종가≥EMA20 터치) ③다음날 종가>EMA20이면 홀딩·아니면 잔량전량매도 ④확정후 종가<EMA20 하향이탈 시 잔량전량매도 ⑤시간청산(${opts.maxHold}거래일)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const pooled = [];
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
    pooled.push(...r.trades);
  }
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('유효 표본 없음'); return; }

  console.log(`\n━━━ 결과 ━━━`);
  console.log(`n=${s.n}  가중평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률(가중수익>0) ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균종결일 ${s.avgDays.toFixed(1)}거래일`);
  console.log(`\n[레그(leg)별 발생 빈도 / 가중치 합]`);
  for (const [reason, cnt] of Object.entries(s.reasonCount)) {
    console.log(`  ${reason.padEnd(14)}: ${cnt}건  (가중치 합 ${s.reasonWeight[reason].toFixed(2)})`);
  }
  console.log(`\n[진행 경로 분류]`);
  console.log(`  EMA20 한 번도 터치 못함(SL/시간청산으로 전량 종료): ${s.neverTouched}건`);
  console.log(`  터치는 했으나 다음날 돌파확정 실패(FAIL_CONFIRM): ${s.touchedButFailedConfirm}건`);
  console.log(`  돌파확정 후 홀딩 진입(이후 하향이탈 또는 시간청산): ${s.confirmedThenHeld}건`);
  console.log('\n※ 미완료 이벤트(최근 신호라 아직 최대보유일 데이터가 없는 경우)는 표본에서 제외됨');
  console.log('※ weightedRet = 각 레그(분할청산분) 수익률을 진입가 기준으로 계산 후 비중(가중치)만큼 가중합산한 트레이드 전체 수익률');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
