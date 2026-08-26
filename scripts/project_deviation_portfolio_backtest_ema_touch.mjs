// 포트폴리오 레벨 백테스트 — 진입(5EMA+20EMA 이중 Z+P + 장기하락추세 필터, 2026-08-07 확정) + 청산(3단계 분할매도, 2026-08-10 개편) + 포지션 사이징(단일10%·고가종목상향·클러스터40%) 통합
// 스킬: stock-deviation — project_deviation_portfolio_backtest.mjs(구 단일청산·전략A)의 신규 매도규칙 버전
// 사용법: node scripts/project_deviation_portfolio_backtest_ema_touch.mjs [--per-position 0.10] [--max-per-position 0.25] [--cluster-cap 0.40] [--sl 12] [--tp 20] [--max-hold 20] [--calendar-days 2555]
// 규칙: 정수 주 단위로 신호일 종가 매수(내부적으로 임의 원금 기준 시뮬레이션, 결과는 지수화·% 위주로 보고 — 특정 원금 금액은 출력하지 않음)
//       진입(2026-08-07 확정, 위치임계값은 스윕 백테스트로 10→3%ile 조임): EMA5·EMA20 각각 Z<=-2 & 위치<=3%ile 동시충족(AND) AND EMA50<EMA200(장기 하락추세)
//       청산(2026-08-10 개편 3단계): ①손절-SL%(최우선, 잔량 전량) ②진입가 대비 +TP%(기본20) 도달 시 보유수량 절반(정수 내림) 매도 ③이후 종가≥EMA20 돌파 시 잔량 절반(전체25%) 매도 ④이후 종가<EMA5 하향이탈 시 잔량 전량매도 ⑤최대MAX_HOLD거래일 도달 시 잔량 전량매도
//       ※ 구 규칙(②를 "종가≥EMA5 돌파"로 트리거)은 project_deviation_dual_ema_exit_backtest.mjs 참조. 신규 규칙 검증은 project_deviation_tp20_exit_backtest.mjs(2026-08-10)로 선행 확인함
//       포지션당 기본 PER_POSITION 비율, 단 1주 가격이 기본배분보다 비싸면 MAX_PER_POSITION 비율까지 상향해 최소 1주 매수 보장
//       같은 날 여러 신호가 겹치면(클러스터) 그 날 신규진입 총 배분이 CLUSTER_CAP 비율을 넘지 않도록 비례 축소(축소로 1주 가격 미만이 되면 그 종목은 이번 클러스터에서 제외)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (2026-08-03 KIS 기준, 백테스트 유니버스 TOP50 통일 — 실전 라이브 관찰용과 동일)
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
const ENTRY_PCT_THRESHOLD = 3; // 2026-08-07 스윕 백테스트로 10→3 조임
const FAST_PERIOD = 5;
const SLOW_PERIOD = 20;
const TREND_MID_PERIOD = 50;
const TREND_LONG_PERIOD = 200;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = {
    stocks: DEFAULT_STOCKS, maxHold: 20, sl: 12, tp: 20, // 2026-08-26 손절 15→12 재조정 확정
    calendarDays: 2555, seed: 10_000_000, perPosition: 0.10, maxPerPosition: 0.25, clusterCap: 0.40,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
    if (argv[i] === '--tp') o.tp = parseFloat(argv[++i]);
    if (argv[i] === '--per-position') o.perPosition = parseFloat(argv[++i]);
    if (argv[i] === '--max-per-position') o.maxPerPosition = parseFloat(argv[++i]);
    if (argv[i] === '--cluster-cap') o.clusterCap = parseFloat(argv[++i]);
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
  let ema = null; const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) { seedBuf.push(price); if (seedBuf.length < period) continue; ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length; }
    else ema = price * k + ema * (1 - k);
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

async function loadStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema20s = buildEma(closes, SLOW_PERIOD);
  const ema50s = buildEma(closes, TREND_MID_PERIOD);
  const ema200s = buildEma(closes, TREND_LONG_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema20s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema20: ema20s[i],
      ema50: ema50s[i], ema200: ema200s[i],
      dev5: (closes[i] - ema5s[i]) / ema5s[i] * 100,
      dev20: (closes[i] - ema20s[i]) / ema20s[i] * 100,
    });
  }
  if (seq.length < ROLL + 1) return { ...stock, error: '데이터 부족' };

  const dateIndex = new Map();
  seq.forEach((r, i) => dateIndex.set(r.date, i));

  // 신호 발생일(onset) 집합: EMA5·EMA20 각각 Z+P 동시충족 AND 장기하락추세(EMA50<EMA200)
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z5 = rollingZPct(seq, i, 'dev5');
    const z20 = rollingZPct(seq, i, 'dev20');
    const sig5 = z5.z <= Z_THRESHOLD && z5.pct <= ENTRY_PCT_THRESHOLD;
    const sig20 = z20.z <= Z_THRESHOLD && z20.pct <= ENTRY_PCT_THRESHOLD;
    const downTrend = seq[i].ema50 != null && seq[i].ema200 != null && seq[i].ema50 < seq[i].ema200;
    flags[i] = sig5 && sig20 && downTrend;
  }
  const eventIndices = new Set();
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) eventIndices.add(i);
  }

  return { ...stock, seq, dateIndex, eventIndices };
}

async function main() {
  const opts = parseArgs();
  console.error(`[포트폴리오 백테스트·2026-08-10 신규청산규칙] 종목당 기본 ${(opts.perPosition * 100).toFixed(0)}%(고가종목 최대 ${(opts.maxPerPosition * 100).toFixed(0)}%), 클러스터 상한 ${(opts.clusterCap * 100).toFixed(0)}%, 손절-${opts.sl}%, 익절+${opts.tp}%, 진입=5+20EMA AND 하락추세, 청산=+${opts.tp}%익절→20돌파→5하향이탈 3단계, 최대보유 ${opts.maxHold}거래일`);

  const stocksData = await batchAll(opts.stocks, s => loadStock(s, opts));
  const validStocks = stocksData.filter(s => !s.error);
  for (const s of stocksData) if (s.error) console.error(`[${s.name}] ${s.error}`);

  // 전체 거래일 유니언 (오름차순)
  const allDatesSet = new Set();
  for (const s of validStocks) for (const r of s.seq) allDatesSet.add(r.date);
  const timeline = [...allDatesSet].sort();

  let cash = opts.seed;
  // code -> {name, initialShares, shares, entryClose, entryDate, entryIndex, stage, legs: [{reason,shares,exitClose,exitDate,ret,daysHeld}]}
  const positions = new Map();
  const completedTrades = []; // 포지션 전체 종결(잔량 0)될 때마다 1건, weightedRet 포함
  const skipped = [];
  const equityCurve = [];

  function markToMarket(dateStr) {
    let mv = 0;
    for (const [code, pos] of positions) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(dateStr);
      const close = idx != null ? st.seq[idx].close : pos.entryClose;
      mv += pos.shares * close;
    }
    return mv;
  }

  function closeLeg(pos, code, shares, close, d, reason, idx, entryIndex) {
    const proceeds = shares * close;
    cash += proceeds;
    const ret = (close - pos.entryClose) / pos.entryClose * 100;
    pos.legs.push({ reason, shares, exitClose: close, exitDate: d, ret, daysHeld: idx - entryIndex });
    pos.shares -= shares;
  }

  function finalizePosition(pos, code) {
    const weightedRet = pos.legs.reduce((a, l) => a + (l.shares / pos.initialShares) * l.ret, 0);
    const lastLeg = pos.legs[pos.legs.length - 1];
    completedTrades.push({
      code, name: pos.name, entryDate: pos.entryDate, exitDate: lastLeg.exitDate,
      initialShares: pos.initialShares, legs: pos.legs, weightedRet, daysHeld: lastLeg.daysHeld,
    });
    positions.delete(code);
  }

  for (const d of timeline) {
    // 1) 청산 체크 (기존 보유 포지션) — 손절 최우선 → 상태머신(INIT/TP20_DONE/HOLD) → 시간청산
    for (const [code, pos] of [...positions]) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(d);
      if (idx == null) continue;
      const daysHeld = idx - pos.entryIndex;
      if (daysHeld <= 0) continue; // 매수 당일은 청산 체크 안 함
      const row = st.seq[idx];
      const close = row.close, ema5 = row.ema5, ema20 = row.ema20;
      const ret = (close - pos.entryClose) / pos.entryClose * 100;

      // ① 손절 최우선(잔량 전량)
      if (ret <= -opts.sl) {
        closeLeg(pos, code, pos.shares, close, d, 'SL', idx, pos.entryIndex);
        finalizePosition(pos, code);
        continue;
      }

      // ② 익절(신규, 2026-08-10): 진입가 대비 +TP% 도달 — 구 "종가 EMA5 돌파" 트리거 대체
      if (pos.stage === 'INIT' && ret >= opts.tp) {
        const sellShares = Math.floor(pos.initialShares / 2);
        if (sellShares >= 1) {
          closeLeg(pos, code, sellShares, close, d, 'TP20', idx, pos.entryIndex);
        }
        pos.stage = 'TP20_DONE';
      }

      // ③ 2차 매도: ②이후 종가가 EMA20 돌파(②와 같은 날도 가능)
      if (pos.stage === 'TP20_DONE' && close >= ema20) {
        const sellShares = Math.floor(pos.shares / 2);
        if (sellShares >= 1) {
          closeLeg(pos, code, sellShares, close, d, 'LEG20', idx, pos.entryIndex);
        }
        pos.stage = 'HOLD';
      }

      // ④ HOLD 중 EMA5 하향 이탈 시 잔량 전량 청산
      if (pos.stage === 'HOLD' && close < ema5 && pos.shares > 0) {
        closeLeg(pos, code, pos.shares, close, d, 'BREAKDOWN', idx, pos.entryIndex);
        finalizePosition(pos, code);
        continue;
      }

      // ⑤ 시간청산(최대보유일 도달, 아직 잔량 남아있으면)
      if (daysHeld >= opts.maxHold && pos.shares > 0) {
        closeLeg(pos, code, pos.shares, close, d, 'TIME', idx, pos.entryIndex);
        finalizePosition(pos, code);
      }
    }

    // 2) 신규 진입 체크 (오늘이 event onset이면서 현재 미보유인 종목들)
    const newSignals = [];
    for (const st of validStocks) {
      if (positions.has(st.code)) continue;
      const idx = st.dateIndex.get(d);
      if (idx == null) continue;
      if (st.eventIndices.has(idx)) newSignals.push({ st, idx });
    }

    if (newSignals.length) {
      const equityNow = cash + markToMarket(d);
      const perCap = equityNow * opts.perPosition;
      const maxPerCap = equityNow * opts.maxPerPosition;
      const clusterCapAmt = equityNow * opts.clusterCap;

      const targets = newSignals.map(({ st, idx }) => {
        const close = st.seq[idx].close;
        const target = Math.min(Math.max(perCap, close), maxPerCap);
        return { st, idx, close, target };
      });

      const sumTarget = targets.reduce((a, t) => a + t.target, 0);
      const scale = sumTarget > clusterCapAmt ? clusterCapAmt / sumTarget : 1;

      for (const t of targets) {
        const scaledTarget = t.target * scale;
        if (scaledTarget < t.close) {
          skipped.push({ date: d, name: t.st.name, price: t.close, allocation: scaledTarget, reason: '클러스터혼잡' });
          continue;
        }
        const allocation = Math.min(scaledTarget, cash);
        const shares = Math.floor(allocation / t.close);
        if (shares >= 1) {
          const cost = shares * t.close;
          cash -= cost;
          positions.set(t.st.code, {
            name: t.st.name, initialShares: shares, shares, entryClose: t.close, entryDate: d, entryIndex: t.idx,
            stage: 'INIT', legs: [],
          });
        } else {
          skipped.push({ date: d, name: t.st.name, price: t.close, allocation, reason: '현금부족' });
        }
      }
    }

    const equity = cash + markToMarket(d);
    equityCurve.push({ date: d, equity });
  }

  // ── 결과 집계 ──
  const finalEquity = equityCurve[equityCurve.length - 1].equity;
  const totalReturn = (finalEquity - opts.seed) / opts.seed * 100;

  let peak = -Infinity, maxDD = 0, maxDDDate = null;
  for (const e of equityCurve) {
    if (e.equity > peak) peak = e.equity;
    const dd = (e.equity - peak) / peak * 100;
    if (dd < maxDD) { maxDD = dd; maxDDDate = e.date; }
  }

  const equityIndex = finalEquity / opts.seed * 100;

  console.log(`\n━━━ 포트폴리오 백테스트 결과 (신규 매도규칙, 지수화·시작=100) ━━━`);
  console.log(`기간: ${timeline[0]} ~ ${timeline[timeline.length - 1]}`);
  console.log(`포지션 사이징: 기본 ${(opts.perPosition * 100).toFixed(0)}% / 고가종목 최대 ${(opts.maxPerPosition * 100).toFixed(0)}%까지 상향(최소 1주 보장) / 클러스터 상한 ${(opts.clusterCap * 100).toFixed(0)}%`);
  console.log(`최종 포트폴리오 지수: ${equityIndex.toFixed(2)}  (수익률 ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%)`);
  console.log(`최대 낙폭(MDD): ${maxDD.toFixed(2)}%  (${maxDDDate} 기준)`);
  console.log(`청산완료 포지션: ${completedTrades.length}건, 미청산(현재 보유): ${positions.size}건, 매수 포기: ${skipped.length}건\n`);

  if (completedTrades.length) {
    const rets = completedTrades.map(t => t.weightedRet);
    const win = rets.filter(r => r > 0).length / rets.length * 100;
    const byReason = { SL: 0, TP20: 0, LEG20: 0, BREAKDOWN: 0, TIME: 0 };
    for (const t of completedTrades) for (const l of t.legs) byReason[l.reason] = (byReason[l.reason] || 0) + 1;
    console.log(`[청산완료 포지션 통계] n=${completedTrades.length}  가중평균수익률 ${mean(rets) >= 0 ? '+' : ''}${mean(rets).toFixed(2)}%  중앙값 ${median(rets) >= 0 ? '+' : ''}${median(rets).toFixed(2)}%  승률 ${win.toFixed(0)}%`);
    console.log(`레그별 발생: ${Object.entries(byReason).map(([r, c]) => `${r} ${c}건`).join(' / ')}\n`);
  }

  if (positions.size) {
    console.log('[현재 보유 중(미청산) 포지션]');
    const lastDate = timeline[timeline.length - 1];
    for (const [code, pos] of positions) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(lastDate);
      const close = st.seq[idx].close;
      const ret = (close - pos.entryClose) / pos.entryClose * 100;
      console.log(`  ${pos.name}  ${pos.entryDate} 매수(${pos.initialShares}주 @${pos.entryClose.toLocaleString('ko-KR')}) → 현재 ${close.toLocaleString('ko-KR')} 잔량${pos.shares}주(단계:${pos.stage})  평가손익 ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`);
    }
    console.log('');
  }

  if (skipped.length) {
    const byReason = {};
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    const byName = {};
    for (const s of skipped) byName[s.name] = (byName[s.name] || 0) + 1;
    console.log(`[매수 포기 신호] 총 ${skipped.length}건 (${Object.entries(byReason).map(([r, c]) => `${r} ${c}건`).join(', ')})`);
    console.log(`  종목별: ${Object.entries(byName).map(([n, c]) => `${n} ${c}회`).join(', ')}\n`);
  }

  console.log('[청산완료 포지션 상세]');
  for (const t of completedTrades) {
    const legStr = t.legs.map(l => `${l.reason}:${l.shares}주@${l.exitClose.toLocaleString('ko-KR')}(${l.ret >= 0 ? '+' : ''}${l.ret.toFixed(1)}%)`).join(' → ');
    console.log(`  ${t.entryDate}→${t.exitDate}  ${t.name.padEnd(14)} 가중수익 ${t.weightedRet >= 0 ? '+' : ''}${t.weightedRet.toFixed(2)}%  [${legStr}]`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
