// 라운드넘버(피겨라운드) 전략 — 지금 시점 "진행 중인 이탈→재돌파" 상태 스캔 (2026-09-01 재설계)
// project_roundnumber_strategy_backtest.mjs / project_portfolio3_entry_scan.mjs의 진입조건(이탈→트랙레코드+밀집도
// 검증→5거래일 내 재돌파, 진입위치>=20%)을 그대로 따라가되, "오늘 신규진입(조건 충족 완료)"이 아니라
// 아직 조건 미충족인 두 단계를 예비신호로 보여준다.
//   1) 이탈 후 재돌파 대기 중 — 레벨 아래로 이미 이탈했고, 재돌파 윈도우(5거래일) 내에서 아직 레벨을 못 넘음
//   2) 재돌파했지만 진입위치 20% 미만 — 레벨을 다시 넘었지만 (종가-L)/step 위치가 20%에 못 미쳐 신호 미성립
// (2026-08-21 최초버전은 "이탈 전, 레벨과의 거리"만 보여줬는데 실제 신호 발생 여부와 무관해 예비신호로 부적절
//  하다는 피드백으로 폐기 — feedback_roundnumber_watch_state_redesign 참고)
// 사용법: node scripts/project_roundnumber_recent_signals.mjs [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 백테스트와 비교 가능하도록 고정)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// project_portfolio3_entry_scan.mjs의 checkRoundnumberEntry(RN_*)와 100% 동일한 확정값
const WINDOW_DAYS = 150, TARGET_TICKS = 30, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5, MIN_TOUCHES = 3;
const RECLAIM_WINDOW = 5, STOP_BUFFER_PCT = 3, MIN_ENTRY_POSITION_PCT = 20, MIN_BAND_WIDTH_PCT = 2.5; // v15(2026-08-26): STOP 2→3

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS };
  for (let i = 0; i < argv.length; i++) {
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

// 가장 최근(오늘 기준 RECLAIM_WINDOW 거래일 이내) 유효 이탈 이벤트를 찾아 오늘 상태를 판정한다.
// entry_scan의 checkRoundnumberEntry와 동일한 검증(트랙레코드/밀집도/밴드폭)을 통과한 레벨만 대상으로 한다.
function computeLiveState(seq, highs, lows) {
  const i = seq.length - 1;
  for (let bIdx = i; bIdx >= Math.max(1, i - RECLAIM_WINDOW + 1); bIdx--) {
    const prev = seq[bIdx - 1].close, cur = seq[bIdx].close;
    const step = computeStepAt(highs, lows, bIdx, WINDOW_DAYS, TARGET_TICKS);
    if (!step) continue;
    const L = Math.floor(prev / step) * step;
    if (!(prev >= L && cur < L) || L <= 0) continue;
    if (step / L * 100 < MIN_BAND_WIDTH_PCT) continue;
    const lo = Math.max(0, bIdx - 1 - RECENT_LOOKBACK);
    let aboveCount = 0;
    for (let k = lo; k < bIdx - 1; k++) if (seq[k].close >= L) aboveCount++;
    if (aboveCount < PRIOR_ABOVE_DAYS) continue;
    const touch = touchCountBefore(highs, lows, bIdx, L, WINDOW_DAYS);
    if (touch < MIN_TOUCHES) continue;

    // 유효한 최근 이탈 발견 — bIdx부터 오늘까지 하루씩 진행 상황을 확인
    for (let f = bIdx; f <= i; f++) {
      const c = seq[f].close;
      if (c < L - step) return null; // STOP 구간까지 밀려 무효화
      if (c >= L) {
        const pos = (c - L) / step * 100;
        if (pos >= MIN_ENTRY_POSITION_PCT) return null; // 이미 조건 충족(과거든 오늘이든) — 신규진입 스캔에서 다룸
        if (f === i) {
          return { state: 'weak_reclaim', level: L, step, entryPosition: pos, price: c, aboveCount, touch, breachDate: seq[bIdx].date };
        }
        // 과거 어느 날 약하게 재돌파했지만 20% 미달 — 계속 지켜봄(다음날 이후 흐름 계속 확인)
      }
    }
    // 오늘까지 재돌파 못 함 — 이탈 후 대기 중
    const distPct = (L - seq[i].close) / seq[i].close * 100;
    return { state: 'pending', level: L, step, distPct, price: seq[i].close, aboveCount, touch, breachDate: seq[bIdx].date, daysSinceBreach: i - bIdx };
  }
  return null;
}

async function scanStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - Math.round((WINDOW_DAYS + RECENT_LOOKBACK + 30) * 1.6) * 24 * 3600; // 거래일→달력일 여유 환산(주말·공휴일 포함)
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

  const live = computeLiveState(seq, highs, lows);
  if (!live) return { ...stock, live: null };
  return { ...stock, live };
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }

async function main() {
  const opts = parseArgs();
  console.error(`[라운드넘버 진행상태 스캔] ${opts.stocks.length}종목, 기준: 재돌파윈도우${RECLAIM_WINDOW}거래일, 진입위치컷${MIN_ENTRY_POSITION_PCT}%, 트랙레코드 최근${RECENT_LOOKBACK}일중${PRIOR_ABOVE_DAYS}일↑, 밀집도>=${MIN_TOUCHES}봉`);
  const results = await batchAll(opts.stocks, scanStock);

  const errors = results.filter(r => r.error);
  const withLive = results.filter(r => !r.error && r.live);

  const pending = withLive.filter(r => r.live.state === 'pending').sort((a, b) => a.live.distPct - b.live.distPct);
  const weak = withLive.filter(r => r.live.state === 'weak_reclaim').sort((a, b) => b.live.entryPosition - a.live.entryPosition);

  console.log(`\n━━━ ① 이탈 후 재돌파 대기 중 (${pending.length}종목, 레벨 재근접순) ━━━`);
  if (!pending.length) {
    console.log('해당 종목 없음');
  } else {
    console.log('종목명\t\t현재가\t레벨(L)\t이격(레벨위)\t경과\t트랙레코드\t밀집도\tTP\tSTOP');
    for (const r of pending) {
      const l = r.live;
      const tp = l.level + l.step, stop = l.level * (1 - STOP_BUFFER_PCT / 100);
      console.log(`${r.name}\t${fmtWon(l.price)}\t${fmtWon(l.level)}\t${l.distPct.toFixed(1)}%\t${l.daysSinceBreach + 1}/${RECLAIM_WINDOW}일\t${l.aboveCount}/${RECENT_LOOKBACK}일\t${l.touch}봉\t${fmtWon(tp)}\t${fmtWon(stop)}`);
    }
  }

  console.log(`\n━━━ ② 재돌파했지만 진입위치 ${MIN_ENTRY_POSITION_PCT}% 미만 (${weak.length}종목, 위치 높은순) ━━━`);
  if (!weak.length) {
    console.log('해당 종목 없음');
  } else {
    console.log('종목명\t\t현재가\t레벨(L)\t진입위치\t트랙레코드\t밀집도\tTP\tSTOP');
    for (const r of weak) {
      const l = r.live;
      const tp = l.level + l.step, stop = l.level * (1 - STOP_BUFFER_PCT / 100);
      console.log(`${r.name}\t${fmtWon(l.price)}\t${fmtWon(l.level)}\t${l.entryPosition.toFixed(0)}%\t${l.aboveCount}/${RECENT_LOOKBACK}일\t${l.touch}봉\t${fmtWon(tp)}\t${fmtWon(stop)}`);
    }
  }

  if (errors.length) console.error(`\n[조회실패] ${errors.map(r => r.name).join(', ')}`);
}

main().catch(e => { console.error('오류:', e.message, e.stack); process.exit(1); });
