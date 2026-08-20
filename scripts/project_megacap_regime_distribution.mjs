// 삼성전자·SK하이닉스 국면(상승/횡보/하락) 시간 분포 분석 — 멀티 매매전략 설계용
// 정의: EMA50 vs EMA200 교차 + EMA50 10일 기울기로 3구간 분류
//   상승: EMA50>EMA200 AND EMA50 10일전 대비 상승
//   하락: EMA50<EMA200 AND EMA50 10일전 대비 하락
//   횡보: 그 외(교차 전환기·기울기 불명확 구간)
import https from 'https';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};
const TARGETS = [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }];
const SLOPE_LB = 10;
const CALENDAR_DAYS = 2555; // 7년

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`)); try { res(JSON.parse(d)); } catch { rej(new Error('파싱실패')); } });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}
async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try { const data = await httpGetJson(url); const result = data?.chart?.result?.[0]; if (!result) return null;
      return { ts: result.timestamp || [], close: result.indicators?.quote?.[0]?.close || [] };
    } catch { if (a < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) { const d = new Date((ts + 9 * 3600) * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function fillForward(arr) { const out = arr.slice(); let last = null; for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; } return out; }
function buildEma(closes, period) {
  const k = 2 / (period + 1); const emas = new Array(closes.length).fill(null); let ema = null; const seed = [];
  for (let i = 0; i < closes.length; i++) { const p = closes[i]; if (p == null) continue;
    if (ema === null) { seed.push(p); if (seed.length < period) continue; ema = seed.reduce((a, b) => a + b, 0) / seed.length; }
    else ema = p * k + ema * (1 - k);
    emas[i] = ema;
  }
  return emas;
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - CALENDAR_DAYS * 86400;
  for (const t of TARGETS) {
    const chart = await fetchYahooChart(`${t.code}.KS`, p1, now);
    if (!chart) { console.log(`${t.name}: 조회 실패`); continue; }
    const close = fillForward(chart.close);
    const dates = chart.ts.map(tsToKstDate);
    const ema50 = buildEma(close, 50), ema200 = buildEma(close, 200);
    let up = 0, down = 0, side = 0, total = 0;
    let curRegime = null, streaks = []; let curLen = 0;
    const yearly = {};
    for (let i = 0; i < close.length; i++) {
      if (ema50[i] == null || ema200[i] == null || i < 200 + SLOPE_LB) continue;
      const rising = ema50[i] > ema50[i - SLOPE_LB];
      let regime;
      if (ema50[i] > ema200[i] && rising) regime = 'UP';
      else if (ema50[i] < ema200[i] && !rising) regime = 'DOWN';
      else regime = 'SIDE';
      total++;
      if (regime === 'UP') up++; else if (regime === 'DOWN') down++; else side++;
      const yr = dates[i].slice(0, 4);
      yearly[yr] = yearly[yr] || { UP: 0, DOWN: 0, SIDE: 0, total: 0 };
      yearly[yr][regime]++; yearly[yr].total++;
      if (regime !== curRegime) { if (curRegime) streaks.push({ regime: curRegime, len: curLen }); curRegime = regime; curLen = 1; } else curLen++;
    }
    if (curRegime) streaks.push({ regime: curRegime, len: curLen });

    console.log(`\n=== ${t.name} (${total}거래일, ${dates[dates.length - 200 - SLOPE_LB] || dates[0]} ~ ${dates[dates.length - 1]}) ===`);
    console.log(`상승: ${up}일(${(up / total * 100).toFixed(1)}%)  하락: ${down}일(${(down / total * 100).toFixed(1)}%)  횡보: ${side}일(${(side / total * 100).toFixed(1)}%)`);

    console.log('연도별 분포:');
    for (const yr of Object.keys(yearly).sort()) {
      const y = yearly[yr];
      console.log(`  ${yr}: 상승${(y.UP / y.total * 100).toFixed(0)}% 하락${(y.DOWN / y.total * 100).toFixed(0)}% 횡보${(y.SIDE / y.total * 100).toFixed(0)}% (${y.total}일)`);
    }

    const upStreaks = streaks.filter(s => s.regime === 'UP').map(s => s.len);
    const downStreaks = streaks.filter(s => s.regime === 'DOWN').map(s => s.len);
    const sideStreaks = streaks.filter(s => s.regime === 'SIDE').map(s => s.len);
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0) : 'N/A';
    console.log(`국면 지속기간(평균 거래일): 상승구간 ${upStreaks.length}회 평균${avg(upStreaks)}일 / 하락구간 ${downStreaks.length}회 평균${avg(downStreaks)}일 / 횡보구간 ${sideStreaks.length}회 평균${avg(sideStreaks)}일`);
  }
}
main().catch(e => { console.error('오류:', e.message); process.exit(1); });
