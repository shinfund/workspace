// 라운드넘버(피겨라운드) 전략 — 최근 발생 신호(진입 이벤트) 샘플 조회 (2026-08-21)
// project_roundnumber_strategy_backtest.mjs와 동일 규칙(확정 파라미터)으로 최근 --days(기본45)일
// 이내에 실제 진입(재돌파)이 발생한 트레이드를 나열한다 — 백테스트의 pooled 통계용 시뮬레이션은
// 미확정(청산 전) 트레이드를 표본에서 제외하지만, 이 스크립트는 반대로 "지금 보유중(OPEN)"인
// 트레이드도 그대로 보여준다(실제 차트 대조 확인용).
// 사용법: node scripts/project_roundnumber_recent_trades.mjs [--days 45] [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
// 2026-08-24 코스피 전용 확정(project_roundnumber_strategy_backtest.mjs 상단 주석 참고 — 코스닥
// 승률56% vs 코스피63%, STOP버퍼 스윕으로도 해소 안 됨) — 코스닥 목록은 참조용으로만 보존.
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

const WINDOW_DAYS = 150, TARGET_TICKS = 30, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5, MIN_TOUCHES = 3;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 2, MAX_HOLD = 60, CALENDAR_DAYS = 2555;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, days: 45 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.days = parseInt(argv[++i]);
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
      const q = result.indicators?.quote?.[0] || {};
      return { ts: result.timestamp || [], close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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

const NICE_FAMILY = [1, 2, 2.5, 5, 10];
function niceStep(rawStep) {
  if (!(rawStep > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let best = NICE_FAMILY[0], bestDist = Infinity;
  for (const f of NICE_FAMILY) {
    const dist = Math.abs(Math.log(norm) - Math.log(f));
    if (dist < bestDist) { bestDist = dist; best = f; }
  }
  return best * mag;
}
function computeStepAt(highs, lows, idx, windowDays, targetTicks) {
  const lo = Math.max(0, idx - windowDays + 1);
  let hi = -Infinity, low = Infinity;
  for (let k = lo; k <= idx; k++) {
    if (highs[k] > hi) hi = highs[k];
    if (lows[k] < low) low = lows[k];
  }
  return niceStep((hi - low) / targetTicks);
}
function touchCountBefore(highs, lows, idx, level, windowDays) {
  const lo = Math.max(0, idx - windowDays);
  let count = 0;
  for (let k = lo; k < idx; k++) if (lows[k] <= level && level <= highs[k]) count++;
  return count;
}

function detectRoundSignals(seq, highs, lows) {
  const n = seq.length;
  const events = [];
  for (let i = 1; i < n; i++) {
    const prev = seq[i - 1].close, cur = seq[i].close;
    const step = computeStepAt(highs, lows, i, WINDOW_DAYS, TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    const breached = prev >= L && cur < L;
    if (!breached || L <= 0) continue;
    const lo = Math.max(0, i - 1 - RECENT_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < i - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (touch < MIN_TOUCHES) continue;
    for (let f = i; f < Math.min(n, i + RECLAIM_WINDOW); f++) {
      if (seq[f].close < L - step) break;
      if (seq[f].close >= L) {
        // 2026-08-24 오버슈트 필터: 재돌파일 종가가 갭업으로 TP가(L+step)까지 이미 넘겨버리면
        // 리스크(STOP까지)만 남고 리워드는 사실상 소진된 셋업 — 백테스트로 확인된 저품질(승률55%,
        // 중앙값+0.28%) 케이스라 신호에서 제외(project_roundnumber_entry_overshoot_backtest.mjs 참고)
        if (seq[f].close < L + step) events.push({ entryIdx: f, level: L, step, touchCount: touch, aboveCount });
        break;
      }
    }
  }
  return events;
}

// 백테스트(project_roundnumber_strategy_backtest.mjs)와 달리, 최대보유일 내 미확정 트레이드를
// 표본에서 버리지 않고 "OPEN(보유중)"으로 그대로 보여준다(실제 차트 대조 확인이 목적이라 지금
// 진행 중인 신호도 봐야 함).
function simulateLive(seq, ev, latestIdx) {
  const i0 = ev.entryIdx;
  const entry = seq[i0].close;
  const target = ev.level + ev.step;
  const stop = ev.level * (1 - STOP_BUFFER_PCT / 100);
  for (let d = 1; d <= MAX_HOLD; d++) {
    const j = i0 + d;
    if (j > latestIdx) {
      const cur = seq[latestIdx].close;
      return { status: 'OPEN', day: latestIdx - i0, ret: (cur - entry) / entry * 100, curClose: cur, curDate: seq[latestIdx].date };
    }
    const close = seq[j].close;
    if (close <= stop) return { status: 'STOP', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
    if (close >= target) return { status: 'TP', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
    if (d === MAX_HOLD) return { status: 'TIME', day: d, ret: (close - entry) / entry * 100, date: seq[j].date };
  }
  return null;
}

async function scanStock(stock, cutoffDate) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const seq = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    seq.push({ date: dates[i], close: chart.close[i] });
    highs.push(chart.high[i] ?? chart.close[i]);
    lows.push(chart.low[i] ?? chart.close[i]);
  }
  const n = seq.length;
  if (n < WINDOW_DAYS + RECENT_LOOKBACK + 10) return { ...stock, error: '데이터 부족' };

  const events = detectRoundSignals(seq, highs, lows);
  const latestIdx = n - 1;
  const recentTrades = [];
  for (const ev of events) {
    if (seq[ev.entryIdx].date < cutoffDate) continue;
    const res = simulateLive(seq, ev, latestIdx);
    if (res) recentTrades.push({ name: stock.name, entryDate: seq[ev.entryIdx].date, entryPrice: seq[ev.entryIdx].close, level: ev.level, step: ev.step, touchCount: ev.touchCount, aboveCount: ev.aboveCount, ...res });
  }
  return { ...stock, recentTrades };
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

async function main() {
  const opts = parseArgs();
  const cutoff = new Date(Date.now() - opts.days * 24 * 3600 * 1000);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  console.error(`[라운드넘버 최근신호 조회] ${opts.stocks.length}종목, 최근 ${opts.days}일(기준일 ${cutoffDate} 이후) 진입 이벤트`);

  const results = await batchAll(opts.stocks, s => scanStock(s, cutoffDate));
  const all = [];
  for (const r of results) { if (!r.error) all.push(...r.recentTrades); }
  all.sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  // 동시신호 우선순위: 트레이드당10%·총노출상한30%(=3건) 규칙 — 같은 진입일 3건 이상 몰릴 때만
  // 밀집도(touchCount) desc, 지지일수(aboveCount) desc 순으로 순위 부여. 1~3순위=상한 이내, 4순위+=초과(스킵 권장).
  const byDate = {};
  all.forEach((t, i) => { (byDate[t.entryDate] ||= []).push(i); });
  const priorityOf = new Array(all.length).fill(null);
  for (const date in byDate) {
    const idxs = byDate[date];
    if (idxs.length < 3) continue;
    const sorted = [...idxs].sort((a, b) => {
      if (all[b].touchCount !== all[a].touchCount) return all[b].touchCount - all[a].touchCount;
      if (all[b].aboveCount !== all[a].aboveCount) return all[b].aboveCount - all[a].aboveCount;
      return a - b;
    });
    sorted.forEach((idx, pos) => { priorityOf[idx] = pos + 1; });
  }

  // 표시 순서: 진입일 최신순, 같은 날짜 내에서는 우선순위(1→2→3→초과) 순
  const order = all.map((t, i) => i).sort((a, b) => {
    const dateCmp = all[b].entryDate.localeCompare(all[a].entryDate);
    if (dateCmp !== 0) return dateCmp;
    const ra = priorityOf[a] == null ? Infinity : priorityOf[a];
    const rb = priorityOf[b] == null ? Infinity : priorityOf[b];
    if (ra !== rb) return ra - rb;
    return a - b;
  });

  console.log(`\n총 ${all.length}건 (최근 ${opts.days}일 이내 진입)\n`);
  console.log('종목명\t\t진입일\t\t현재가\t진입가\t레벨(L)\tTP가\tSTOP가\t지지일수\t밀집도\t우선순위\t상태\t현재수익률');
  order.forEach(i => {
    const t = all[i];
    const tp = t.level + t.step, stop = t.level * (1 - STOP_BUFFER_PCT / 100);
    const statusLabel = t.status === 'OPEN' ? `보유중(D+${t.day})` : t.status;
    const p = priorityOf[i];
    const prioLabel = p == null ? '-' : (p <= 3 ? `${p}순위` : `${p}순위 초과`);
    // curClose는 OPEN 상태에서만 채워짐(오늘 종가) — 청산완료(TP/STOP/TIME) 건은 청산 트리거 당일 종가를 진입가×(1+수익률)로 역산
    const curPrice = t.curClose ?? t.entryPrice * (1 + t.ret / 100);
    console.log(`${t.name}\t${t.entryDate}\t${fmtWon(curPrice)}\t${fmtWon(t.entryPrice)}\t${fmtWon(t.level)}\t${fmtWon(tp)}\t${fmtWon(stop)}\t${t.aboveCount}/20일\t${t.touchCount}봉\t${prioLabel}\t${statusLabel}\t${fmtPct(t.ret)}`);
  });
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
