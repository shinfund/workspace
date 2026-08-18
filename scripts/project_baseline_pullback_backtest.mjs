// "기준선 눌림목" 매매전략 백테스트 — 신규 후보 전략, [[project_baseline_strategy_backtest]](기준선매매, streak>=16)의
// 보완 영역(streak 1~16, 하향이탈 초기 구간)을 담당. 2026-08-18 사용자 요청으로 신설, 아직 미확정(백테스트 검토 단계).
//
// 사용법: node scripts/project_baseline_pullback_backtest.mjs [--min-streak-lo 1] [--min-streak-hi 16]
//         [--max-hold 90] [--calendar-days 2555] [--stocks 코드:이름:시장,...]
//
// 컨셉(사용자 확정, 2026-08-18): EMA200을 하향이탈한 지 얼마 안 된(1~16거래일) 초기 구간에서
// 짧게 눌림목을 잡는다. 기준선매매(streak>=16, Z조건, vlow, 분할매수, 회복 후 파동청산)보다 훨씬
// 단순 — Z조건·분할매수·회복(재상향돌파) 대기 없이 EMA5 크로스만으로 진입/청산하는 단발 라운드트립.
//
// 진입: 종가<EMA200 연속 1~16거래일(streak 상한이 기준선매매 시작점 16과 맞닿아 서로 겹치지 않게 영역
//   분리) 구간에서, 새 최저점 갱신 후 첫 EMA5 상향돌파(buildVLowSignal, 기준선매매와 동일 로직 재사용
//   — raw cross는 기준선매매에서 이미 잦은 휩쏘로 폐기된 전례가 있어 처음부터 vlow로 채택, 사용자 확인).
//   100% 단일 진입(분할매수 없음) — 눌림목마다 짧게 회전하는 성격이라 기준선매매의 다회 분할매수와는
//   다른 포지션 사이징을 씀.
// 청산: 진입 후 첫 EMA5 하향돌파(종가<EMA5) 시 전량매도, 그 외 조건(기준선 재이탈·회복 대기 등) 없음
//   — 사용자 명시("매도청산은 5EMA 하향이탈시 전량매도"). 자동 손절 없음(수동 판단 영역, minRet만 참고 기록).
//   장기 미청산 대비 시간청산(TIME, maxHold 기본90거래일) 안전판만 둠.
//
// 백테스트 방법론은 기준선매매 스크립트와 동일하게 신호(이벤트) 단위 독립 시뮬레이션 — 동일 종목 내
// 트레이드가 시간상 겹쳐도 backtest 통계에서는 별도 표본으로 집계(포트폴리오 단위 동시보유 배제는
// live-status/앱 표시 단계에서만 적용, 기준선매매와 동일 컨벤션).

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

const FAST_PERIOD = 5;
const BASE_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, minStreakLo: 1, minStreakHi: 16, maxHold: 90, calendarDays: 2555 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-streak-lo') o.minStreakLo = parseInt(argv[++i]);
    if (argv[i] === '--min-streak-hi') o.minStreakHi = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
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
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[idx];
}

// project_baseline_strategy_backtest.mjs buildVLowSignal와 동일(리셋 없음, 종가기준 최저점 추적)
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
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
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

// 단일 100% 진입 → 첫 EMA5 하향돌파(전량매도) | 시간청산(TIME, maxHold)
function simulateTrade(seq, i0, opts) {
  const entryClose = seq[i0].close;
  let minRet = 0;
  for (let d = 1; d <= opts.maxHold; d++) {
    const j = i0 + d;
    if (j >= seq.length) return null; // 미확정(최근 신호)
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ret = (close - entryClose) / entryClose * 100;
    if (ret < minRet) minRet = ret;
    if (close < ema5) {
      return { ret, finalDay: d, reason: 'EMA5_BREAK', minRet, entryDate: seq[i0].date, exitDate: seq[j].date };
    }
    if (d === opts.maxHold) {
      return { ret, finalDay: d, reason: 'TIME', minRet, entryDate: seq[i0].date, exitDate: seq[j].date };
    }
  }
  return null;
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
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({ date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i] });
  }
  if (seq.length < opts.minStreakHi + opts.maxHold + 1) return { ...stock, error: '데이터 부족' };

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }
  const bounceSig = buildVLowSignal(seq);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = 1; i < seq.length; i++) {
    const streakOk = streak[i] >= opts.minStreakLo && streak[i] <= opts.minStreakHi;
    flags[i] = streakOk && seq[i].bounce;
  }
  const events = [];
  for (let i = 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) events.push(i);
  }

  const trades = [];
  for (const i0 of events) {
    const t = simulateTrade(seq, i0, opts);
    if (t) trades.push({ name: stock.name, entryStreak: streak[i0], ...t });
  }
  return { ...stock, trades, totalEvents: events.length };
}

function summarizeTrades(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const avgDays = mean(trades.map(t => t.finalDay));
  const reasonCount = {};
  for (const t of trades) reasonCount[t.reason] = (reasonCount[t.reason] || 0) + 1;
  const dd15 = trades.filter(t => t.minRet <= -15).length;
  const dd20 = trades.filter(t => t.minRet <= -20).length;
  const dd30 = trades.filter(t => t.minRet <= -30).length;
  return {
    n: trades.length, avg: mean(rets), med: median(rets), win,
    best: Math.max(...rets), worst: Math.min(...rets), avgDays, reasonCount,
    avgMinRet: mean(trades.map(t => t.minRet)), worstMinRet: Math.min(...trades.map(t => t.minRet)),
    dd15, dd20, dd30,
    daysP25: percentile(trades.map(t => t.finalDay), 25), daysP50: percentile(trades.map(t => t.finalDay), 50),
    daysP75: percentile(trades.map(t => t.finalDay), 75), daysP90: percentile(trades.map(t => t.finalDay), 90),
  };
}

async function main() {
  const opts = parseArgs();
  console.error(`[기준선 눌림목 전략 백테스트] ${opts.stocks.length}종목, streak ${opts.minStreakLo}~${opts.minStreakHi}거래일, maxHold${opts.maxHold}거래일`);
  console.error(`진입: 종가<EMA200 연속${opts.minStreakLo}~${opts.minStreakHi}거래일 구간에서 최저점갱신 후 첫 EMA5 상향돌파 시 100% 단일진입`);
  console.error(`청산: 첫 EMA5 하향돌파 시 전량매도(EMA5_BREAK) | ${opts.maxHold}거래일 시간청산(TIME) | 자동손절 없음(minRet만 참고기록)`);

  const results = await batchAll(opts.stocks, s => backtestStock(s, opts));
  const ok = results.filter(r => r && !r.error);
  const failed = results.filter(r => r && r.error);
  console.error(`데이터 로딩: ${ok.length}종목 성공, ${failed.length}종목 실패${failed.length ? ' (' + failed.map(f => f.name).join(',') + ')' : ''}`);

  const totalEvents = ok.reduce((a, r) => a + r.totalEvents, 0);
  const pooled = ok.flatMap(r => r.trades);
  console.log(`\n전체 신호(이벤트) 발생: ${totalEvents}건 (미확정 최근 신호 제외 유효표본: ${pooled.length}건)`);

  const s = summarizeTrades(pooled);
  if (!s) { console.log('유효 트레이드 없음'); return; }
  console.log(`\n━━━ 전체 결과 ━━━`);
  console.log(`n=${s.n}  평균수익률 ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%  중앙값 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%  승률(수익>0) ${s.win.toFixed(0)}%  최고 +${s.best.toFixed(2)}%  최저 ${s.worst.toFixed(2)}%  평균보유 ${s.avgDays.toFixed(1)}거래일`);
  console.log(`보유일수 분포: p25=${s.daysP25}일  중앙값=${s.daysP50}일  p75=${s.daysP75}일  p90=${s.daysP90}일`);

  console.log(`\n[청산 사유별 발생 빈도]`);
  for (const reason of Object.keys(s.reasonCount)) {
    console.log(`  ${reason.padEnd(14)}: ${s.reasonCount[reason]}건 (${(s.reasonCount[reason] / s.n * 100).toFixed(0)}%)`);
  }

  console.log(`\n[참고용 최대낙폭 — 손절 미적용, 실제 매도 트리거 아님]`);
  console.log(`  평균 최대낙폭 ${s.avgMinRet.toFixed(2)}%  최악 ${s.worstMinRet.toFixed(2)}%`);
  console.log(`  -15% 이상 낙폭 경험: ${s.dd15}건 (${(s.dd15 / s.n * 100).toFixed(0)}%)  -20%이상: ${s.dd20}건 (${(s.dd20 / s.n * 100).toFixed(0)}%)  -30%이상: ${s.dd30}건 (${(s.dd30 / s.n * 100).toFixed(0)}%)`);

  console.log(`\n━━━ 종목별 신호수(신호 5건 이상만) ━━━`);
  const byStock = ok.map(r => ({ name: r.name, totalEvents: r.totalEvents, ...summarizeTrades(r.trades) })).filter(r => r.n >= 5);
  byStock.sort((a, b) => b.n - a.n);
  for (const row of byStock) {
    console.log(`  ${row.name.padEnd(12)} 신호${row.totalEvents}건(유효${row.n}건)  평균 ${row.avg >= 0 ? '+' : ''}${row.avg.toFixed(2)}%  승률${row.win.toFixed(0)}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
