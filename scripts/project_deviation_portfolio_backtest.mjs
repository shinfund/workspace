// 포트폴리오 레벨 백테스트 — 진입(Z+P 신호) + 청산(위치정상화/손절/시간청산) + 포지션 사이징(단일10%·고가종목상향·클러스터40%) 통합
// 스킬: stock-deviation
// 사용법: node scripts/project_deviation_portfolio_backtest.mjs [--per-position 0.10] [--max-per-position 0.25] [--cluster-cap 0.40] [--sl 15] [--tp-pctile 50] [--max-hold 20] [--period 20] [--calendar-days 1100]
// 규칙: 정수 주 단위로 신호일 종가 매수(내부적으로 임의 원금 기준 시뮬레이션, 결과는 지수화·% 위주로 보고 — 특정 원금 금액은 출력하지 않음)
//       청산은 위치≥TP_PCTILE%ile 정상화 / 손절-SL% / 최대MAX_HOLD거래일 중 먼저 오는 조건
//       포지션당 기본 PER_POSITION 비율, 단 1주 가격이 기본배분보다 비싸면 MAX_PER_POSITION 비율까지 상향해 최소 1주 매수 보장
//       같은 날 여러 신호가 겹치면(클러스터) 그 날 신규진입 총 배분이 CLUSTER_CAP 비율을 넘지 않도록 비례 축소(축소로 1주 가격 미만이 되면 그 종목은 이번 클러스터에서 제외)
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
  const o = {
    stocks: DEFAULT_STOCKS, period: 20, maxHold: 20, tpPctile: 50, sl: 15,
    calendarDays: 1100, seed: 10_000_000, perPosition: 0.10, maxPerPosition: 0.25, clusterCap: 0.40,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--period') o.period = parseInt(argv[++i]);
    if (argv[i] === '--max-hold') o.maxHold = parseInt(argv[++i]);
    if (argv[i] === '--tp-pctile') o.tpPctile = parseFloat(argv[++i]);
    if (argv[i] === '--sl') o.sl = parseFloat(argv[++i]);
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

function rollingPct(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  return win.filter(d => d <= seq[j].dev).length / win.length * 100;
}
function rollingZ(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev);
  const m = mean(win), sd = stdev(win, m);
  return sd ? (seq[j].dev - m) / sd : 0;
}

async function loadStock(stock, opts) {
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
  if (seq.length < ROLL + 1) return { ...stock, error: '데이터 부족' };

  const dateIndex = new Map();
  seq.forEach((r, i) => dateIndex.set(r.date, i));

  // 신호 발생일(onset) 집합
  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    const z = rollingZ(seq, i), pct = rollingPct(seq, i);
    flags[i] = z <= Z_THRESHOLD && pct <= ENTRY_PCT_THRESHOLD;
  }
  const eventIndices = new Set();
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) eventIndices.add(i);
  }

  return { ...stock, seq, dateIndex, eventIndices };
}

async function main() {
  const opts = parseArgs();
  console.error(`[포트폴리오 백테스트] 종목당 기본 ${(opts.perPosition * 100).toFixed(0)}%(고가종목 최대 ${(opts.maxPerPosition * 100).toFixed(0)}%), 클러스터 상한 ${(opts.clusterCap * 100).toFixed(0)}%, 손절-${opts.sl}%, TP=위치≥${opts.tpPctile}%ile, 최대보유 ${opts.maxHold}거래일`);

  const stocksData = await batchAll(opts.stocks, s => loadStock(s, opts));
  const validStocks = stocksData.filter(s => !s.error);
  for (const s of stocksData) if (s.error) console.error(`[${s.name}] ${s.error}`);

  // 전체 거래일 유니언 (오름차순)
  const allDatesSet = new Set();
  for (const s of validStocks) for (const r of s.seq) allDatesSet.add(r.date);
  const timeline = [...allDatesSet].sort();

  let cash = opts.seed;
  const positions = new Map(); // code -> {name, shares, entryClose, entryDate, entryIndex}
  const trades = [];
  const skipped = [];
  const equityCurve = [];

  function markToMarket(dateStr) {
    let mv = 0;
    for (const [code, pos] of positions) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(dateStr);
      const close = idx != null ? st.seq[idx].close : pos.entryClose; // 해당일 데이터 없으면 직전가 유지
      mv += pos.shares * close;
    }
    return mv;
  }

  for (const d of timeline) {
    // 1) 청산 체크 (기존 보유 포지션)
    for (const [code, pos] of [...positions]) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(d);
      if (idx == null) continue; // 그 종목은 이 날짜에 데이터 없음(비정상 케이스) — 유지
      const daysHeld = idx - pos.entryIndex;
      if (daysHeld <= 0) continue; // 매수 당일은 청산 체크 안 함
      const close = st.seq[idx].close;
      const ret = (close - pos.entryClose) / pos.entryClose * 100;
      let exitReason = null;
      if (ret <= -opts.sl) exitReason = 'SL';
      else {
        const pct = rollingPct(st.seq, idx);
        if (pct >= opts.tpPctile) exitReason = 'TP';
        else if (daysHeld >= opts.maxHold) exitReason = 'TIME';
      }
      if (exitReason) {
        const proceeds = pos.shares * close;
        cash += proceeds;
        trades.push({
          code, name: pos.name, entryDate: pos.entryDate, exitDate: d, exit: exitReason,
          entryClose: pos.entryClose, exitClose: close, shares: pos.shares,
          ret, pnl: proceeds - pos.shares * pos.entryClose, daysHeld,
        });
        positions.delete(code);
      }
    }

    // 2) 신규 진입 체크 (오늘이 event onset이면서 현재 미보유인 종목들)
    const newSignals = [];
    for (const st of validStocks) {
      if (positions.has(st.code)) continue; // 이미 보유 중이면 중복진입 안 함
      const idx = st.dateIndex.get(d);
      if (idx == null) continue;
      if (st.eventIndices.has(idx)) newSignals.push({ st, idx });
    }

    if (newSignals.length) {
      const equityNow = cash + markToMarket(d);
      const perCap = equityNow * opts.perPosition;
      const maxPerCap = equityNow * opts.maxPerPosition;
      const clusterCapAmt = equityNow * opts.clusterCap;

      // 종목별 목표배분: 기본 perCap, 단 1주 가격이 그보다 비싸면 maxPerCap까지 상향(최소 1주 보장)
      const targets = newSignals.map(({ st, idx }) => {
        const close = st.seq[idx].close;
        const target = Math.min(Math.max(perCap, close), maxPerCap);
        return { st, idx, close, target };
      });

      // 클러스터 총합이 상한을 넘으면 비례 축소
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
          positions.set(t.st.code, { name: t.st.name, shares, entryClose: t.close, entryDate: d, entryIndex: t.idx });
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

  console.log(`\n━━━ 포트폴리오 백테스트 결과 (지수화, 시작=100) ━━━`);
  console.log(`기간: ${timeline[0]} ~ ${timeline[timeline.length - 1]}`);
  console.log(`포지션 사이징: 기본 ${(opts.perPosition * 100).toFixed(0)}% / 고가종목 최대 ${(opts.maxPerPosition * 100).toFixed(0)}%까지 상향(최소 1주 보장) / 클러스터 상한 ${(opts.clusterCap * 100).toFixed(0)}%`);
  console.log(`최종 포트폴리오 지수: ${equityIndex.toFixed(2)}  (수익률 ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%)`);
  console.log(`최대 낙폭(MDD): ${maxDD.toFixed(2)}%  (${maxDDDate} 기준)`);
  console.log(`청산완료 거래: ${trades.length}건, 미청산(현재 보유): ${positions.size}건, 매수 포기: ${skipped.length}건\n`);

  if (trades.length) {
    const rets = trades.map(t => t.ret);
    const win = rets.filter(r => r > 0).length / rets.length * 100;
    const byReason = { SL: 0, TP: 0, TIME: 0 };
    for (const t of trades) byReason[t.exit]++;
    console.log(`[청산 거래 통계] n=${trades.length}  평균수익률 ${mean(rets) >= 0 ? '+' : ''}${mean(rets).toFixed(2)}%  중앙값 ${median(rets) >= 0 ? '+' : ''}${median(rets).toFixed(2)}%  승률 ${win.toFixed(0)}%`);
    console.log(`청산사유: TP ${byReason.TP}건 / SL ${byReason.SL}건 / TIME ${byReason.TIME}건\n`);
  }

  if (positions.size) {
    console.log('[현재 보유 중(미청산) 포지션]');
    const lastDate = timeline[timeline.length - 1];
    for (const [code, pos] of positions) {
      const st = validStocks.find(s => s.code === code);
      const idx = st.dateIndex.get(lastDate);
      const close = st.seq[idx].close;
      const ret = (close - pos.entryClose) / pos.entryClose * 100;
      console.log(`  ${pos.name}  ${pos.entryDate} 매수(${pos.shares}주 @${pos.entryClose.toLocaleString('ko-KR')}) → 현재 ${close.toLocaleString('ko-KR')}  평가손익 ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`);
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

  console.log('[청산 거래 상세]');
  for (const t of trades) {
    console.log(`  ${t.entryDate}→${t.exitDate}  ${t.name.padEnd(14)} ${t.shares}주 @${t.entryClose.toLocaleString('ko-KR')}→${t.exitClose.toLocaleString('ko-KR')}  ${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(2)}%  (${t.exit}, ${t.daysHeld}일보유)`);
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
