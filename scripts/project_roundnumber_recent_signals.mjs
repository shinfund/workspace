// 라운드넘버(피겨라운드) 전략 — 지금 시점 유니버스 워치 스캔 (2026-08-21)
// project_roundnumber_strategy_backtest.mjs와 동일한 진입 규칙(이탈→트랙레코드+밀집도 검증→재돌파)을
// "오늘" 기준으로 적용해, 종목별로 지금 감시해야 할 라운드 레벨(가장 가까운 "검증된" 레벨)을 산출한다.
// 사용법: node scripts/project_roundnumber_recent_signals.mjs [--stocks 코드:이름:시장,...]
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 코스피 TOP50 + 코스닥 TOP20 (project_roundnumber_strategy_backtest.mjs와 동일 유니버스 — 백테스트와 비교 가능하도록 고정)
const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
// 2026-08-24 코스피 전용 확정(project_roundnumber_strategy_backtest.mjs 상단 주석 참고 — 코스닥
// 승률56% vs 코스피63%, STOP버퍼 스윕으로도 해소 안 됨) — 코스닥 목록은 참조용으로만 보존.
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '086520', name: '에코프로', market: 'KOSDAQ' }, { code: '247540', name: '에코프로비엠', market: 'KOSDAQ' }, { code: '277810', name: '레인보우로보틱스', market: 'KOSDAQ' }, { code: '036930', name: '주성엔지니어링', market: 'KOSDAQ' }, { code: '028300', name: 'HLB', market: 'KOSDAQ' }, { code: '240810', name: '원익IPS', market: 'KOSDAQ' }, { code: '058470', name: '리노공업', market: 'KOSDAQ' }, { code: '039030', name: '이오테크닉스', market: 'KOSDAQ' }, { code: '087010', name: '펩트론', market: 'KOSDAQ' }, { code: '298380', name: '에이비엘바이오', market: 'KOSDAQ' }, { code: '000250', name: '삼천당제약', market: 'KOSDAQ' }, { code: '141080', name: '리가켐바이오', market: 'KOSDAQ' }, { code: '222800', name: '심텍', market: 'KOSDAQ' }, { code: '214450', name: '파마리서치', market: 'KOSDAQ' }, { code: '108490', name: '로보티즈', market: 'KOSDAQ' }, { code: '319660', name: '피에스케이', market: 'KOSDAQ' }, { code: '095340', name: 'ISC', market: 'KOSDAQ' }, { code: '403870', name: 'HPSP', market: 'KOSDAQ' }, { code: '440110', name: '파두', market: 'KOSDAQ' },
];
const DEFAULT_STOCKS = FALLBACK_KOSPI.map(s => ({ ...s, market: 'KOSPI' }));

// project_roundnumber_strategy_backtest.mjs 확정값과 동일(2026-08-21 스윕 결론)
const WINDOW_DAYS = 150, TARGET_TICKS = 30, RECENT_LOOKBACK = 20, PRIOR_ABOVE_DAYS = 5, MIN_TOUCHES = 3, STOP_BUFFER_PCT = 2;

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

async function scanStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - Math.round((WINDOW_DAYS + RECENT_LOOKBACK + 30) * 1.6) * 24 * 3600; // 거래일→달력일 여유 환산(주말·공휴일 포함)
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패' };

  const dates = chart.ts.map(tsToKstDate);
  const closes = [], highs = [], lows = [];
  for (let i = 0; i < dates.length; i++) {
    if (chart.close[i] == null) continue;
    closes.push(chart.close[i]);
    highs.push(chart.high[i] ?? chart.close[i]);
    lows.push(chart.low[i] ?? chart.close[i]);
  }
  const n = closes.length;
  if (n < WINDOW_DAYS + RECENT_LOOKBACK + 10) return { ...stock, error: '데이터 부족' };

  const i = n - 1;
  const price = closes[i];
  const step = computeStepAt(highs, lows, i, WINDOW_DAYS, TARGET_TICKS);
  if (!step) return { ...stock, error: 'step 계산 실패' };

  // 현재가 아래로 라운드를 하나씩 내려가며 "트랙레코드+밀집도 조건을 충족하는" 가장 가까운 레벨을 탐색
  const lo0 = Math.max(0, i - RECENT_LOOKBACK);
  let watchLevel = null;
  for (let L = Math.floor(price / step) * step; L > 0 && (price - L) / price < 0.3; L -= step) {
    let aboveCount = 0;
    for (let k = lo0; k < i; k++) if (closes[k] >= L) aboveCount++;
    const touch = touchCountBefore(highs, lows, i, L, WINDOW_DAYS);
    if (aboveCount >= PRIOR_ABOVE_DAYS && touch >= MIN_TOUCHES) { watchLevel = { level: L, aboveCount, touch }; break; }
  }
  if (!watchLevel) return { ...stock, price, step, watchLevel: null };

  const distPct = (price - watchLevel.level) / price * 100;
  const tp = watchLevel.level + step;
  const stop = watchLevel.level * (1 - STOP_BUFFER_PCT / 100);
  return { ...stock, price, step, watchLevel: watchLevel.level, distPct, aboveCount: watchLevel.aboveCount, touch: watchLevel.touch, tp, stop };
}

function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }

async function main() {
  const opts = parseArgs();
  console.error(`[라운드넘버 유니버스 워치 스캔] ${opts.stocks.length}종목, 기준: 윈도우${WINDOW_DAYS}일×눈금${TARGET_TICKS}개, 트랙레코드 최근${RECENT_LOOKBACK}일중${PRIOR_ABOVE_DAYS}일↑, 밀집도>=${MIN_TOUCHES}봉`);
  const results = await batchAll(opts.stocks, scanStock);

  const ok = results.filter(r => !r.error && r.watchLevel != null).sort((a, b) => a.distPct - b.distPct);
  const noLevel = results.filter(r => !r.error && r.watchLevel == null);
  const errors = results.filter(r => r.error);

  // 앱 표시 기준(2026-08-24 재조정): 거리 0.5%이내만 "예상종목"으로 표시(기존 1%컷도 방대하다는 피드백)
  const NEAR_THRESHOLD_PCT = 0.5;
  const near = ok.filter(r => r.distPct <= NEAR_THRESHOLD_PCT);
  const far = ok.filter(r => r.distPct > NEAR_THRESHOLD_PCT);

  console.log(`\n━━━ 감시 레벨과 가까운 순, 거리${NEAR_THRESHOLD_PCT}%이내(${near.length}/${ok.length}종목, 이탈 시 조건 충족 가능성 높은 순) ━━━`);
  console.log('종목명\t\t현재가\tstep\t감시레벨(지지)\t거리\t트랙레코드\t밀집도\tTP\tSTOP');
  for (const r of near) {
    console.log(`${r.name}\t${fmtWon(r.price)}\t${fmtWon(r.step)}\t${fmtWon(r.watchLevel)}\t${r.distPct.toFixed(1)}%\t${r.aboveCount}/${20}일\t${r.touch}봉\t${fmtWon(r.tp)}\t${fmtWon(r.stop)}`);
  }
  if (far.length) {
    console.log(`\n(거리 ${NEAR_THRESHOLD_PCT}% 초과 ${far.length}종목은 표시 생략)`);
  }

  if (noLevel.length) {
    console.log(`\n━━━ 아직 유효 감시레벨 없음(최근 급등락으로 트랙레코드 미충족, ${noLevel.length}종목) ━━━`);
    console.log(noLevel.map(r => r.name).join(', '));
  }
  if (errors.length) {
    console.log(`\n━━━ 조회 실패(${errors.length}종목) ━━━`);
    console.log(errors.map(r => `${r.name}(${r.error})`).join(', '));
  }
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
