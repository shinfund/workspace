// 삼성전자·SK하이닉스 "지지·저항선" 매매전략 가능성 검증 (1차 feasibility 테스트, 눌림목과 별개 실험)
// 지지/저항 정의: 스윙 고점/저점 피벗(좌우 10거래일 국소최소/최대) — 눌림목(EMA기반)과 무관한 독립 방식
// 사용법: node scripts/project_megacap_support_resistance_backtest.mjs [--stocks 코드:이름,...] [--window N] [--band K]
//
// 진입: 활성(미붕괴) 지지선에 ATR%×BAND_K 이내로 근접 + 전일대비 반등(종가>전일종가)
// 청산: 지지붕괴(종가<지지선) / SL -12%(백업) / 트레일 -8%(고점대비) / 저항선 터치 시 50%익절(잔량 트레일 유지) / 시간청산 40거래일
// 눌림목과 동일한 SL/TRAIL/시간청산 규모를 사용해 Sharpe·승률을 비교 가능하게 함
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
];

const ATR_PERIOD = 14;
const SL = 12, TRAIL = 8, TIME_EXIT = 40, TP_FRAC = 0.5;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { stocks: DEFAULT_STOCKS, window: 10, band: 0.5, calendarDays: 1100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window') o.window = parseInt(argv[++i]);
    if (argv[i] === '--band') o.band = parseFloat(argv[++i]);
    if (argv[i] === '--calendar-days') o.calendarDays = parseInt(argv[++i]);
    if (argv[i] === '--stocks') {
      o.stocks = argv[++i].split(',').map(s => { const [code, name] = s.split(':'); return { code, name: name || code }; });
    }
  }
  return o;
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [], high: q.high || [], low: q.low || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function fillForward(arr) {
  const out = arr.slice(); let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
}

function buildAtr(high, low, close, period) {
  const h = fillForward(high), l = fillForward(low), c = fillForward(close);
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (h[i] == null || l[i] == null) continue;
    if (i === 0) { tr[i] = h[i] - l[i]; continue; }
    const pc = c[i - 1];
    tr[i] = pc == null ? (h[i] - l[i]) : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  }
  const smas = new Array(tr.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < tr.length; i++) {
    const v = tr[i];
    if (v != null) { sum += v; cnt++; }
    if (i >= period) { const old = tr[i - period]; if (old != null) { sum -= old; cnt--; } }
    if (cnt === period) smas[i] = sum / period;
  }
  return smas;
}

// 스윙 피벗: i가 [i-window, i+window] 구간에서 국소최소/최대일 때 확정. 확정 시점은 i+window일(선견 편향 방지).
function detectSwingPivots(close, window) {
  const n = close.length;
  const isLow = new Array(n).fill(false), isHigh = new Array(n).fill(false);
  for (let i = window; i < n - window; i++) {
    if (close[i] == null) continue;
    let lo = true, hi = true;
    for (let k = i - window; k <= i + window; k++) {
      if (k === i || close[k] == null) continue;
      if (close[k] < close[i]) lo = false;
      if (close[k] > close[i]) hi = false;
    }
    isLow[i] = lo; isHigh[i] = hi;
  }
  return { isLow, isHigh };
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function stdev(arr) { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x - m) ** 2))); }

function simulateSRTrade(close, i0, entryClose, supportAtEntry, resistanceAtEntry, sl, trail, tpFrac, maxHold) {
  let peak = entryClose;
  let tpTaken = false, tpReturn = null;
  for (let d = 1; d <= maxHold; d++) {
    const j = i0 + d;
    if (j >= close.length) return null;
    const c = close[j];
    const ret = (c - entryClose) / entryClose * 100;

    if (!tpTaken && resistanceAtEntry != null && c >= resistanceAtEntry) {
      tpTaken = true; tpReturn = ret;
      if (c > peak) peak = c;
      continue;
    }

    const finish = (reason) => {
      const blended = tpTaken ? tpFrac * tpReturn + (1 - tpFrac) * ret : ret;
      return { ret: blended, reason, day: d, tpTaken };
    };

    if (c < supportAtEntry) return finish('SUPPORT_BREAK');
    if (ret <= -sl) return finish('SL');
    if (c > peak) peak = c;
    const trailRet = (c - peak) / peak * 100;
    if (trailRet <= -trail) return finish('TRAIL');
    if (d === maxHold) return finish('TIME');
  }
  return null;
}

async function backtestStock(stock, opts) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - opts.calendarDays * 24 * 3600;
  const symbol = `${stock.code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', trades: [] };

  const dates = chart.ts.map(tsToKstDate);
  const close = fillForward(chart.close);
  const high = fillForward(chart.high);
  const low = fillForward(chart.low);
  const atr = buildAtr(high, low, close, ATR_PERIOD);
  const { isLow, isHigh } = detectSwingPivots(close, opts.window);

  const trades = [];
  // 활성 지지/저항 레벨 추적: { price, formedIdx }
  let activeSupports = [];
  let activeResistances = [];

  for (let i = 0; i < close.length; i++) {
    // 이 시점 i에 새로 "확정"되는 피벗 반영 (형성일 = i - window)
    const confirmIdx = i - opts.window;
    if (confirmIdx >= 0) {
      if (isLow[confirmIdx]) activeSupports.push({ price: close[confirmIdx], idx: confirmIdx });
      if (isHigh[confirmIdx]) activeResistances.push({ price: close[confirmIdx], idx: confirmIdx });
    }
    if (close[i] == null || atr[i] == null || atr[i] <= 0) continue;
    const atrPct = atr[i] / close[i] * 100;

    // 붕괴된 지지선 제거(종가가 그 아래로 마감한 적 있으면 무효화)
    activeSupports = activeSupports.filter(s => close[i] >= s.price || s.idx === confirmIdx);
    // 돌파된 저항선 제거(종가가 그 위로 마감한 적 있으면 무효화 — 저항 소멸)
    activeResistances = activeResistances.filter(r => close[i] <= r.price || r.idx === confirmIdx);

    if (i < 1) continue;
    // 현재가 아래 가장 가까운 활성 지지선
    const below = activeSupports.filter(s => s.price < close[i]);
    if (!below.length) continue;
    const support = below.reduce((a, b) => (b.price > a.price ? b : a));
    const proximity = (close[i] - support.price) / support.price * 100;
    if (proximity > atrPct * opts.band) continue; // 지지선에서 너무 멀면 skip
    const bounceDay = close[i] > close[i - 1];
    if (!bounceDay) continue;

    const above = activeResistances.filter(r => r.price > close[i]);
    const resistance = above.length ? above.reduce((a, b) => (b.price < a.price ? b : a)) : null;

    const result = simulateSRTrade(close, i, close[i], support.price, resistance?.price ?? null, SL, TRAIL, TP_FRAC, opts.maxHold ?? TIME_EXIT);
    if (result) trades.push({ date: dates[i], name: stock.name, entry: close[i], support: support.price, resistance: resistance?.price ?? null, ...result });
  }

  return { ...stock, trades };
}

function summarize(trades) {
  if (!trades.length) return null;
  const rets = trades.map(t => t.ret);
  const win = rets.filter(r => r > 0).length / rets.length * 100;
  const sd = stdev(rets);
  return { n: rets.length, avg: mean(rets), med: median(rets), win, best: Math.max(...rets), worst: Math.min(...rets), sd, sharpe: sd > 0 ? mean(rets) / sd : 0 };
}

function fmtRow(label, s) {
  if (!s) return `${label.padEnd(26)} 데이터 없음`;
  return label.padEnd(26) + String(s.n).padStart(6) +
    `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`.padStart(10) +
    `${s.med >= 0 ? '+' : ''}${s.med.toFixed(2)}%`.padStart(10) +
    `${s.win.toFixed(0)}%`.padStart(8) + `${s.sharpe.toFixed(3)}`.padStart(9);
}

async function main() {
  const opts = parseArgs();
  console.error(`[지지저항 S/R 피벗 백테스트] ${opts.stocks.length}종목, 스윙윈도우=${opts.window}일, 근접밴드=ATR%×${opts.band}, SL${SL}%/TRAIL${TRAIL}%/시간청산${TIME_EXIT}일`);

  const results = [];
  for (const s of opts.stocks) {
    const r = await backtestStock(s, opts);
    if (r.error) { console.error(`[실패] ${r.name}: ${r.error}`); continue; }
    results.push(r);
    await new Promise(res => setTimeout(res, 300));
  }

  const allTrades = results.flatMap(r => r.trades);
  console.log(`\n════════ 지지·저항선(스윙피벗) 전략 — 1차 feasibility 결과 ════════`);
  console.log(`진입: 활성 지지선 ATR%×${opts.band} 이내 근접 + 반등일(종가>전일종가) / 청산: 지지붕괴·SL${SL}%·TRAIL${TRAIL}%·저항터치50%익절·시간${TIME_EXIT}일\n`);
  console.log('전략'.padEnd(26) + 'n'.padStart(6) + '평균'.padStart(10) + '중앙값'.padStart(10) + '승률'.padStart(8) + 'Sharpe'.padStart(9));
  console.log('─'.repeat(69));
  console.log(fmtRow('전체(2종목 합산)', summarize(allTrades)));
  for (const r of results) console.log(fmtRow(r.name, summarize(r.trades)));

  // 청산 사유 분포
  const reasons = {};
  for (const t of allTrades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  console.log('\n청산 사유 분포:', JSON.stringify(reasons));

  // 저항 목표 도달(부분익절) 비율
  const tpCount = allTrades.filter(t => t.tpTaken).length;
  console.log(`저항선 터치(부분익절 발동) 비율: ${tpCount}/${allTrades.length} (${(tpCount / allTrades.length * 100).toFixed(0)}%)`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
