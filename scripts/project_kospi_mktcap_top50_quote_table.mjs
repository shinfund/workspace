/**
 * project_kospi_mktcap_top50_quote_table.mjs — 코스피 시가총액 TOP50 시세표 (+EMA5/20/50/100/200)
 *
 * 데이터 소스:
 *   KRX API       → 전일 시가총액 유니버스·순위 (kis_api.mjs의 fetchKrxUniverse 재사용)
 *   KIS API       → 당일 현재가·등락률 실시간 (kis_api.mjs의 getToken/fetchKisPrice 재사용)
 *   Yahoo Finance → EMA 계산용 과거 종가(마지막날은 KIS 당일가로 대체 — Yahoo 당일 캔들은 지연 스냅샷이라 오차 발생, 2026-09-01 확인)
 *
 * 출력: 터미널 표(순위·종목명·현재가·등락률·시총·EMA5/20/50/100/200) + JSON(stdout)
 *
 * Usage: node project_kospi_mktcap_top50_quote_table.mjs [--top N]  (기본 50)
 */
import https from 'https';
import { getToken, fetchKrxUniverse, fetchKisPrice } from './kis_api.mjs';

const EMA_PERIODS = [5, 20, 50, 100, 200];
const BATCH = 5, DELAY = 200;

// 섹터 분류(수동 매핑, 2026-09-02 도입) — KRX/KIS API에 업종 데이터가 없어 종목코드 기준 하드코딩
const SECTOR_MAP = {
  '005930': '반도체/IT부품', '000660': '반도체/IT부품', '009150': '반도체/IT부품', '042700': '반도체/IT부품',
  '402340': '지주회사', '028260': '지주회사', '034730': '지주회사', '000150': '지주회사', '003550': '지주회사', '267250': '지주회사',
  '105560': '금융(은행/지주)', '055550': '금융(은행/지주)', '086790': '금융(은행/지주)', '316140': '금융(은행/지주)', '024110': '금융(은행/지주)',
  '005380': '자동차/부품', '000270': '자동차/부품', '012330': '자동차/부품',
  '373220': '2차전지', '006400': '2차전지', '003670': '2차전지',
  '329180': '조선', '042660': '조선', '009540': '조선', '010140': '조선',
  '207940': '바이오/제약', '068270': '바이오/제약',
  '096770': '에너지/화학', '051910': '에너지/화학', '010950': '에너지/화학',
  '034020': '원전',
  '032830': '금융(보험/증권)', '000810': '금융(보험/증권)', '006800': '금융(보험/증권)',
  '010120': '전력기기/유틸리티', '267260': '전력기기/유틸리티', '298040': '전력기기/유틸리티', '015760': '전력기기/유틸리티',
  '012450': '방산/항공우주', '079550': '방산/항공우주', '064350': '방산/항공우주',
  '035420': 'IT/인터넷/서비스', '035720': 'IT/인터넷/서비스', '018260': 'IT/인터넷/서비스',
  '010130': '철강/비철금속', '005490': '철강/비철금속',
  '033780': '소비재/화장품', '278470': '소비재/화장품',
  '066570': '전자/가전',
  '017670': '통신',
  '011200': '해운',
  '086280': '물류',
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { top: 50 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--top') o.top = parseInt(argv[++i]);
  }
  return o;
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    timeStr: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

async function batchKis(token, codes) {
  const map = {};
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(c => fetchKisPrice(token, c)));
    batch.forEach((c, j) => { if (results[j]) map[c] = results[j]; });
    if (i + BATCH < codes.length) await new Promise(r => setTimeout(r, DELAY));
  }
  const missing = codes.filter(c => !map[c]);
  if (missing.length) {
    console.error(`[KIS] 누락 ${missing.length}건 재시도...`);
    for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
      await new Promise(r => setTimeout(r, 300));
      for (const c of [...missing]) {
        const p = await fetchKisPrice(token, c);
        if (p) { map[c] = p; missing.splice(missing.indexOf(c), 1); }
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }
  return map;
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}
function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fillForward(arr) {
  const out = arr.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = last; else last = out[i]; }
  return out;
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
    } else { ema = price * k + ema * (1 - k); }
    emas[i] = ema;
  }
  return emas;
}
async function batchAll(items, fn, concurrency = 6, delay = 120) {
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

async function loadEma(stock, today) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 900 * 24 * 3600; // ~2.5년, EMA200 워밍업 충분
  const chart = await fetchYahooChart(`${stock.종목코드}.KS`, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, emaError: '조회실패' };
  const dates = chart.ts.map(tsToKstDate);
  const closes = fillForward(chart.close);
  const n = closes.length;
  if (n < 201) return { ...stock, emaError: '데이터부족' };

  // 오늘 캔들이 있으면 KIS 실시간 현재가로 교체, 없으면 추가(Yahoo 당일 캔들은 지연 스냅샷)
  if (dates[n - 1] === today) closes[n - 1] = stock.현재가;
  else { closes.push(stock.현재가); }

  const out = { ...stock };
  for (const p of EMA_PERIODS) {
    const e = buildEma(closes, p);
    out[`ema${p}`] = e[closes.length - 1];
  }
  return out;
}

function fmtEmaDev(price, ema) {
  if (ema == null || !price) return '-';
  const dev = (price - ema) / ema * 100;
  return `${dev >= 0 ? '+' : ''}${dev.toFixed(2)}%`;
}
function mktcapStr(v) { return (v / 1e12).toFixed(1) + '조'; }

function buildSectorSummary(rows, sectorMap) {
  const bySector = {};
  for (const r of rows) {
    const name = sectorMap[r.종목코드] || '기타';
    if (!bySector[name]) bySector[name] = { name, stocks: [], mktcap: 0, chgSum: 0 };
    bySector[name].stocks.push(r);
    bySector[name].mktcap += r.시가총액전일;
    bySector[name].chgSum += r.등락률;
  }
  const sectors = Object.values(bySector).map(s => ({ ...s, avgChg: s.chgSum / s.stocks.length }));
  sectors.sort((a, b) => b.avgChg - a.avgChg);
  return sectors;
}

async function main() {
  const opts = parseArgs();
  const { date, timeStr } = kstNow();

  const { kospi, basDt } = await fetchKrxUniverse();
  const basDtLabel = `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
  const universe = kospi.slice(0, opts.top);

  const token = await getToken();
  console.error(`[KIS] ${universe.length}종목 현재가 조회 중...`);
  const priceMap = await batchKis(token, universe.map(s => s.종목코드));

  const stocks = universe.map((s, i) => {
    const p = priceMap[s.종목코드];
    return {
      순위: i + 1, 종목코드: s.종목코드, 종목명: s.종목명,
      현재가: p?.현재가 ?? 0, 등락률: p?.등락률 ?? 0, 시가총액전일: s._mktcap,
    };
  }).filter(s => s.현재가 > 0);

  console.error(`[Yahoo] ${stocks.length}종목 EMA 계산 중...`);
  const loaded = await batchAll(stocks, s => loadEma(s, date));
  const errors = loaded.filter(r => r.emaError);
  if (errors.length) console.error(`[EMA 조회실패] ${errors.map(r => r.종목명).join(', ')}`);

  const hdr = ' #'.padStart(3) + '종목명'.padEnd(16) + '현재가'.padStart(10) + '등락률'.padStart(8) + '시총'.padStart(9)
    + 'EMA5'.padStart(10) + 'EMA20'.padStart(10) + 'EMA50'.padStart(10) + 'EMA100'.padStart(10) + 'EMA200'.padStart(10);
  console.log(`\n━━━ 코스피 시가총액 TOP${opts.top} 시세표  [KRX기준: ${basDtLabel} / KIS기준: ${date} ${timeStr}] ━━━`);
  console.log(hdr);
  console.log('─'.repeat(hdr.length));
  for (const r of loaded) {
    const chgStr = (r.등락률 >= 0 ? '+' : '') + r.등락률.toFixed(2) + '%';
    console.log(
      String(r.순위).padStart(3) +
      r.종목명.padEnd(16) +
      r.현재가.toLocaleString().padStart(10) +
      chgStr.padStart(8) +
      mktcapStr(r.시가총액전일).padStart(9) +
      fmtEmaDev(r.현재가, r.ema5).padStart(10) +
      fmtEmaDev(r.현재가, r.ema20).padStart(10) +
      fmtEmaDev(r.현재가, r.ema50).padStart(10) +
      fmtEmaDev(r.현재가, r.ema100).padStart(10) +
      fmtEmaDev(r.현재가, r.ema200).padStart(10)
    );
  }

  console.log(`\n[데이터 소스] 현재가·등락률: KIS API 실시간(${date} ${timeStr} 기준) / 시가총액: 전일(${basDtLabel}) KRX 확정 기준 / EMA5~200괴리: Yahoo Finance 일봉 종가 기준 EMA 대비 현재가 괴리율(오늘 종가는 KIS 실시간가로 대체해 계산)`);

  const sectors = buildSectorSummary(loaded, SECTOR_MAP);
  const secHdr = '섹터'.padEnd(14) + '종목명'.padEnd(16) + '현재가'.padStart(10) + '등락률'.padStart(8) + 'EMA200'.padStart(9) + '시총'.padStart(9);
  console.log(`\n━━━ 섹터별 시세표 (섹터 평균등락률 내림차순) ━━━`);
  console.log(secHdr);
  console.log('─'.repeat(secHdr.length));
  for (const sec of sectors) {
    sec.stocks.forEach((r, i) => {
      const chgStr = (r.등락률 >= 0 ? '+' : '') + r.등락률.toFixed(2) + '%';
      console.log(
        (i === 0 ? sec.name : '﹡').padEnd(14) +
        r.종목명.padEnd(16) +
        r.현재가.toLocaleString().padStart(10) +
        chgStr.padStart(8) +
        fmtEmaDev(r.현재가, r.ema200).padStart(9) +
        mktcapStr(r.시가총액전일).padStart(9)
      );
    });
  }

  const sumHdr = '섹터'.padEnd(14) + '종목수'.padStart(6) + '시총합계'.padStart(10) + '평균등락률'.padStart(10);
  console.log(`\n━━━ 섹터별 요약 (평균등락률 내림차순) ━━━`);
  console.log(sumHdr);
  console.log('─'.repeat(sumHdr.length));
  for (const sec of sectors) {
    const avgStr = (sec.avgChg >= 0 ? '+' : '') + sec.avgChg.toFixed(2) + '%';
    console.log(sec.name.padEnd(14) + String(sec.stocks.length).padStart(6) + mktcapStr(sec.mktcap).padStart(10) + avgStr.padStart(10));
  }
  console.log(`\n[섹터 분류] 스크립트 데이터가 아닌 일반 업종 기준 수동 매핑(SECTOR_MAP) / ﹡ = 위와 동일 섹터`);

  console.log('\n' + JSON.stringify(loaded.map(r => ({
    순위: r.순위, 종목코드: r.종목코드, 종목명: r.종목명, 현재가: r.현재가, 등락률: r.등락률,
    시가총액전일: r.시가총액전일, ema5: r.ema5, ema20: r.ema20, ema50: r.ema50, ema100: r.ema100, ema200: r.ema200,
  })), null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
