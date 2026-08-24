// 라운드넘버 stock-portal 앱 — 최근신호(KS/KQ)·예상종목(KS/KQ)·보유종목 탭에 "차트카드" 섹션을 생성해
// apps/stock-portal/stock-roundnumber.html에 직접 삽입한다 (2026-08-24).
// stock-baseline.html의 차트카드 패턴(scripts/project_baseline_recent_signals.mjs의 buildChartSvg)을
// 그대로 재사용하되, EMA5/EMA200 대신 라운드넘버 전략의 레벨(L)/TP/STOP(또는 보유종목의 라운드지지/저항/평단)
// 수평 기준선을 그리는 buildRoundnumberChartSvg로 일반화했다.
//
// 중요(2026-08-24 재설계): 처음엔 detectRoundSignals를 다시 돌려 "최신 데이터"로 카드를 만들었으나,
// 이 앱의 표(최근신호·예상종목)는 특정 시점 스냅샷이라 이 스크립트를 나중에 실행하면 장중 가격 변동으로
// 표 숫자와 카드 숫자가 어긋나는 문제가 있었다(예: 표엔 "보유중 D+0"가 2건인데 재계산하면 9건으로 늘어남,
// 장중 랠리로 신규 재돌파가 실제로 더 발생했기 때문). 그래서 최근신호·예상종목·보유종목 표는 이미 렌더링된
// HTML을 그대로 파싱해 재사용하고(레벨·TP·STOP·상태·수익률 등 숫자가 표와 100% 일치하도록 보장),
// 오직 차트의 종가 폴리라인을 그리기 위한 과거 시세만 새로 fetch한다.
//
// 사용법: node scripts/project_roundnumber_chart_cards.mjs
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const FALLBACK_KOSPI = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' }, { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' }, { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' }, { code: '028260', name: '삼성물산' }, { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '000270', name: '기아' }, { code: '034020', name: '두산에너빌리티' }, { code: '329180', name: 'HD현대중공업' }, { code: '055550', name: '신한지주' }, { code: '012330', name: '현대모비스' }, { code: '068270', name: '셀트리온' }, { code: '034730', name: 'SK' }, { code: '006400', name: '삼성SDI' }, { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' }, { code: '066570', name: 'LG전자' }, { code: '010120', name: 'LS ELECTRIC' }, { code: '042660', name: '한화오션' }, { code: '267260', name: 'HD현대일렉트릭' }, { code: '000810', name: '삼성화재' }, { code: '298040', name: '효성중공업' }, { code: '009540', name: 'HD한국조선해양' }, { code: '005490', name: 'POSCO홀딩스' }, { code: '010130', name: '고려아연' }, { code: '316140', name: '우리금융지주' }, { code: '096770', name: 'SK이노베이션' }, { code: '042700', name: '한미반도체' }, { code: '017670', name: 'SK텔레콤' }, { code: '011200', name: 'HMM' }, { code: '015760', name: '한국전력' }, { code: '006800', name: '미래에셋증권' }, { code: '000150', name: '두산' }, { code: '051910', name: 'LG화학' }, { code: '010140', name: '삼성중공업' }, { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' }, { code: '033780', name: 'KT&G' }, { code: '003550', name: 'LG' }, { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '035720', name: '카카오' }, { code: '010950', name: 'S-Oil' }, { code: '024110', name: '기업은행' }, { code: '064350', name: '현대로템' }, { code: '086280', name: '현대글로비스' },
];
const FALLBACK_KOSDAQ = [
  { code: '196170', name: '알테오젠' }, { code: '086520', name: '에코프로' }, { code: '247540', name: '에코프로비엠' }, { code: '277810', name: '레인보우로보틱스' }, { code: '036930', name: '주성엔지니어링' }, { code: '028300', name: 'HLB' }, { code: '240810', name: '원익IPS' }, { code: '058470', name: '리노공업' }, { code: '039030', name: '이오테크닉스' }, { code: '087010', name: '펩트론' }, { code: '298380', name: '에이비엘바이오' }, { code: '000250', name: '삼천당제약' }, { code: '141080', name: '리가켐바이오' }, { code: '222800', name: '심텍' }, { code: '214450', name: '파마리서치' }, { code: '108490', name: '로보티즈' }, { code: '319660', name: '피에스케이' }, { code: '095340', name: 'ISC' }, { code: '403870', name: 'HPSP' }, { code: '440110', name: '파두' },
];
const CODE_BY_NAME = new Map();
for (const s of FALLBACK_KOSPI) CODE_BY_NAME.set(s.name, { code: s.code, market: 'KOSPI' });
for (const s of FALLBACK_KOSDAQ) CODE_BY_NAME.set(s.name, { code: s.code, market: 'KOSDAQ' });

const HTML_PATH = 'C:\\Users\\shinf\\workspace\\apps\\stock-portal\\stock-roundnumber.html';
const HOLDINGS_JSON = 'C:\\Users\\shinf\\workspace\\data\\holdings.json';
const CALENDAR_DAYS = 400; // 차트 폴리라인용(150거래일 윈도우+여유)
const CHART_LEAD_DAYS = 15;
const WATCH_CHART_DAYS = 150;
const HOLDINGS_CHART_DAYS = 60;
const TOP_N = 10;

// ── 공통 유틸 ──────────────────────────────────────────────
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
      return { ts: result.timestamp || [], close: q.close || [] };
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
async function fetchCloseSeqBySymbol(symbol) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const seq = [];
  for (let i = 0; i < dates.length; i++) if (chart.close[i] != null) seq.push({ date: dates[i], close: chart.close[i] });
  return seq;
}
async function fetchCloseSeq(name) {
  const info = CODE_BY_NAME.get(name);
  if (!info) return null;
  return fetchCloseSeqBySymbol(info.market === 'KOSDAQ' ? `${info.code}.KQ` : `${info.code}.KS`);
}
// 보유종목은 유니버스(코스피50+코스닥20) 밖의 종목도 있을 수 있어 holdings.json 자체의 종목코드·시장을 쓴다
// (2026-08-24: 두산로보틱스가 유니버스 목록에 없어 이름 매핑으로는 누락되던 문제 수정).
async function fetchCloseSeqByCode(code, market) {
  return fetchCloseSeqBySymbol(market === 'KOSDAQ' ? `${code}.KQ` : `${code}.KS`);
}
function num(s) { return parseFloat(String(s).replace(/[,%]/g, '')); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

// ── SVG 차트 생성(baseline buildChartSvg 일반화: EMA 대신 임의의 고정 기준선 배열) ─
function buildRoundnumberChartSvg(rows, refLines, markers) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [...rows.map(r => r.close), ...refLines.map(l => l.value)];
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  let svg = '';
  for (const l of refLines) {
    svg += `<line x1="${x0}" y1="${yAt(l.value).toFixed(1)}" x2="${x1}" y2="${yAt(l.value).toFixed(1)}" stroke="var(--${l.color})" stroke-width="${l.width || 1.8}" stroke-dasharray="${l.dash}"/>`;
  }
  svg += `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.close).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--txt)" stroke-width="1.7"/>`;
  if (markers?.entryIdx != null && markers.entryIdx >= 0 && markers.entryIdx < n) {
    const ei = markers.entryIdx;
    const entryY = yAt(rows[ei].close).toFixed(1);
    svg += `<line x1="${x0}" y1="${entryY}" x2="${x1}" y2="${entryY}" stroke="var(--sky600)" stroke-width="1" stroke-dasharray="2,2" opacity="0.85"/>`;
    svg += `<line x1="${xAt(ei).toFixed(1)}" y1="${yTop}" x2="${xAt(ei).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,2"/>`;
    svg += `<circle cx="${xAt(ei).toFixed(1)}" cy="${entryY}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

// ── 표 파싱(이미 렌더링된 HTML에서 그대로 추출 — 표 숫자와 카드 숫자 100% 일치 보장) ─
function parsePanel(html, panelId) {
  const m = html.match(new RegExp(`<div class="panel[^"]*" id="${panelId}">([\\s\\S]*?)<div class="panel`));
  if (m) return m[1];
  const m2 = html.match(new RegExp(`<div class="panel[^"]*" id="${panelId}">([\\s\\S]*)$`));
  return m2 ? m2[1] : '';
}
function parseSignalRows(panelHtml) {
  const rowRe = /<tr><td class="l">([^<]+)<\/td><td class="l">([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td class="c">([^<]+)<\/td><td class="c">([^<]+)<\/td><td class="l"><span class="badge (bdg-\w+)">([^<]+)<\/span><\/td><td class="([^"]+)">([^<]+)<\/td><\/tr>/g;
  const rows = [];
  let mm;
  while ((mm = rowRe.exec(panelHtml))) {
    rows.push({
      entryDate: mm[1], name: mm[2], entryPrice: num(mm[3]), level: num(mm[4]), tp: num(mm[5]), stop: num(mm[6]),
      aboveCount: mm[7], touchCount: mm[8], badgeClass: mm[9], statusLabel: mm[10], ret: num(mm[12]),
    });
  }
  return rows;
}
function parseWatchRows(panelHtml) {
  const rowRe = /<tr><td class="l">([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td class="[^"]+">([^<]+)<\/td><td class="c">([^<]+)<\/td><td class="c">([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g;
  const rows = [];
  let mm;
  while ((mm = rowRe.exec(panelHtml))) {
    rows.push({
      name: mm[1], price: num(mm[2]), step: num(mm[3]), level: num(mm[4]), distPct: num(mm[5]),
      aboveCount: mm[6], touch: mm[7], tp: num(mm[8]), stop: num(mm[9]),
    });
  }
  return rows;
}
function parseHoldingRows(panelHtml) {
  const rowRe = /<tr><td class="l">([^<]+)<\/td><td class="c">([^<]+)<\/td><td class="[^"]+">([^<]+)<\/td><td>([^<]+)<\/td><td class="[^"]+">([^<]+)<\/td><td class="[^"]+">([^<]+)<\/td><td class="l">([^<]+)<\/td><td class="l">([^<]+)<\/td><\/tr>/g;
  const rows = [];
  let mm;
  while ((mm = rowRe.exec(panelHtml))) {
    const supM = mm[7].match(/^([\d,]+)\(([-+][\d.]+)%,(\d+)봉\)$/);
    const resM = mm[8].match(/^([\d,]+)\(([-+][\d.]+)%,(\d+)봉\)$/);
    rows.push({
      name: mm[1], price: num(mm[2]), changePct: num(mm[3]), avgPrice: num(mm[4]), ret: num(mm[5]), dev200: num(mm[6]),
      support: supM ? num(supM[1]) : null, supportDistPct: supM ? parseFloat(supM[2]) : null, supportTouch: supM ? supM[3] : null,
      resistance: resM ? num(resM[1]) : null, resistanceDistPct: resM ? parseFloat(resM[2]) : null, resistanceTouch: resM ? resM[3] : null,
    });
  }
  return rows;
}

const STATUS_BADGE_CLASS = { 'bdg-teal': 'bdg-teal', 'bdg-sky': 'bdg-sky', 'bdg-red': 'bdg-red', 'bdg-amber': 'bdg-amber' };

function signalChartCardHtml(t) {
  const svg = buildRoundnumberChartSvg(t.chartRows, [
    { value: t.level, color: 'amber', dash: '6,3', width: 1.8 },
    { value: t.tp, color: 'sky', dash: '6,3', width: 1.8 },
    { value: t.stop, color: 'coral', dash: '2,2', width: 1.3 },
  ], { entryIdx: t.localEntryIdx });
  const cur = t.chartRows[t.chartRows.length - 1].close;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(t.name)}</span><span class="badge ${t.badgeClass}">${esc(t.statusLabel)}</span>&nbsp;<span style="color:var(--txt3);font-size:12.5px">${t.entryDate}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입가 <span>${fmtWon(t.entryPrice)}</span> <span class="sep">|</span> 현재가 <span>${fmtWon(cur)}</span> <span class="sep">|</span> 수익률 <span class="${t.ret >= 0 ? 't-pos' : 't-neg'}">${fmtPct(t.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>레벨(L) <span>${fmtWon(t.level)}</span> <span class="sep">|</span> TP <span>${fmtWon(t.tp)}</span> <span class="sep">|</span> STOP <span>${fmtWon(t.stop)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>지지일수 <span>${t.aboveCount}</span> <span class="sep">|</span> 밀집도 <span>${t.touchCount}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>레벨(L)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP</span><span><i class="dash" style="border-color:var(--coral)"></i>STOP</span><span><i style="background:var(--sky600)"></i>진입가</span></div>
      </div>`;
}
function watchChartCardHtml(w) {
  const svg = buildRoundnumberChartSvg(w.chartRows, [
    { value: w.level, color: 'amber', dash: '6,3', width: 1.8 },
    { value: w.tp, color: 'sky', dash: '6,3', width: 1.8 },
    { value: w.stop, color: 'coral', dash: '2,2', width: 1.3 },
  ], {});
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(w.name)}</span><span class="badge bdg-amber">감시레벨 ${w.distPct.toFixed(1)}%</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(w.price)}</span> <span class="sep">|</span> 감시레벨(지지) <span>${fmtWon(w.level)}</span> <span class="sep">|</span> 거리 <span class="t-pos">${w.distPct.toFixed(1)}%</span></span>
        </div>
        <div class="chart-card-stats">
          <span>TP(저항) <span>${fmtWon(w.tp)}</span> <span class="sep">|</span> STOP(예상) <span>${fmtWon(w.stop)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>트랙레코드 <span>${w.aboveCount}</span> <span class="sep">|</span> 밀집도 <span>${w.touch}</span></span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>감시레벨(지지)</span><span><i class="dash" style="border-color:var(--sky)"></i>TP(저항)</span><span><i class="dash" style="border-color:var(--coral)"></i>STOP(예상)</span></div>
      </div>`;
}
function holdingChartCardHtml(h) {
  const svg = buildRoundnumberChartSvg(h.chartRows, [
    { value: h.support, color: 'amber', dash: '6,3', width: 1.8 },
    { value: h.resistance, color: 'sky', dash: '6,3', width: 1.8 },
    { value: h.avgPrice, color: 'purple', dash: '4,2', width: 1.6 },
  ], {});
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(h.name)}</span><span class="badge ${h.ret >= 0 ? 'bdg-teal' : 'bdg-red'}">${h.ret >= 0 ? '수익' : '손실'} ${fmtPct(h.ret)}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(h.price)}</span> <span class="sep">|</span> 평단가 <span>${fmtWon(h.avgPrice)}</span> <span class="sep">|</span> 수익률 <span class="${h.ret >= 0 ? 't-pos' : 't-neg'}">${fmtPct(h.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>라운드지지 <span>${fmtWon(h.support)}</span>(${h.supportDistPct >= 0 ? '+' : ''}${h.supportDistPct.toFixed(1)}%) <span class="sep">|</span> 라운드저항 <span>${fmtWon(h.resistance)}</span>(+${h.resistanceDistPct.toFixed(1)}%)</span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>라운드지지</span><span><i class="dash" style="border-color:var(--sky)"></i>라운드저항</span><span><i class="dash" style="border-color:var(--purple)"></i>평단가</span></div>
      </div>`;
}
function section(title, sub, cardsHtml) {
  return `  <div class="sc">
    <div class="sc-title">${title} <span class="sub">${sub}</span></div>
    <div class="chart-grid">
${cardsHtml.join('\n')}
    </div>
  </div>`;
}

async function main() {
  const html0 = fs.readFileSync(HTML_PATH, 'utf8');

  const ksSignalRows = parseSignalRows(parsePanel(html0, 'p0-ks')).slice(0, TOP_N);
  const kqSignalRows = parseSignalRows(parsePanel(html0, 'p0-kq')).slice(0, TOP_N);
  const ksWatchRows = parseWatchRows(parsePanel(html0, 'p1-ks')).slice(0, TOP_N);
  const kqWatchRows = parseWatchRows(parsePanel(html0, 'p1-kq')).slice(0, TOP_N);
  const holdRowsRaw = parseHoldingRows(parsePanel(html0, 'p2'));
  console.error(`[표 파싱] 최근신호 KS${ksSignalRows.length}/KQ${kqSignalRows.length} · 예상종목 KS${ksWatchRows.length}/KQ${kqWatchRows.length} · 보유종목${holdRowsRaw.length}`);
  if (!ksSignalRows.length || !ksWatchRows.length || !holdRowsRaw.length) throw new Error('표 파싱 실패 — 정규식이 실제 HTML과 맞지 않음');

  // ── 최근신호: 종가 이력 fetch, 진입일 위치를 날짜로 찾아 마커 표시 ──
  for (const t of [...ksSignalRows, ...kqSignalRows]) {
    const seq = await fetchCloseSeq(t.name);
    if (!seq) { t.chartRows = null; continue; }
    let entryGlobalIdx = seq.findIndex(r => r.date === t.entryDate);
    if (entryGlobalIdx < 0) entryGlobalIdx = seq.length - 1; // 폴백: 못 찾으면 마지막 근처로
    const windowStart = Math.max(0, entryGlobalIdx - CHART_LEAD_DAYS);
    t.chartRows = seq.slice(windowStart, seq.length);
    t.localEntryIdx = entryGlobalIdx - windowStart;
  }
  // ── 예상종목: 최근 150거래일 종가 ──
  for (const w of [...ksWatchRows, ...kqWatchRows]) {
    const seq = await fetchCloseSeq(w.name);
    if (!seq) { w.chartRows = null; continue; }
    w.chartRows = seq.slice(Math.max(0, seq.length - WATCH_CHART_DAYS), seq.length);
  }
  // ── 보유종목: 최근 60거래일 종가(holdings.json 자체 종목코드·시장 사용 — 유니버스 밖 종목 대응) ──
  const holdingsJson = JSON.parse(fs.readFileSync(HOLDINGS_JSON, 'utf8'));
  const holdingCodeByName = new Map(holdingsJson.map(h => [h.종목명, { code: h.종목코드, market: h.시장 }]));
  for (const h of holdRowsRaw) {
    const info = holdingCodeByName.get(h.name);
    const seq = info ? await fetchCloseSeqByCode(info.code, info.market) : null;
    if (!seq) { h.chartRows = null; continue; }
    h.chartRows = seq.slice(Math.max(0, seq.length - HOLDINGS_CHART_DAYS), seq.length);
  }

  const ok = arr => arr.filter(x => x.chartRows && x.chartRows.length >= 2);
  const ksSig = ok(ksSignalRows), kqSig = ok(kqSignalRows);
  const ksW = ok(ksWatchRows), kqW = ok(kqWatchRows);
  const holdOk = ok(holdRowsRaw);
  console.error(`[차트fetch완료] 최근신호 KS${ksSig.length}/KQ${kqSig.length} · 예상종목 KS${ksW.length}/KQ${kqW.length} · 보유종목${holdOk.length}`);

  const sec0ks = section('최근신호 차트', '최신 10건', ksSig.map(signalChartCardHtml));
  const sec0kq = section('최근신호 차트', '최신 10건', kqSig.map(signalChartCardHtml));
  const sec1ks = section('예상종목 차트', '최신 10건(감시레벨 근접순)', ksW.map(watchChartCardHtml));
  const sec1kq = section('예상종목 차트', '최신 10건(감시레벨 근접순)', kqW.map(watchChartCardHtml));
  const sec2 = section('보유종목 차트', `전체 ${holdOk.length}종목`, holdOk.map(holdingChartCardHtml));

  let html = html0;
  const insertInsidePanelBefore = (nextMarker, sectionHtml) => {
    const needle = `  </div>\r\n</div>\r\n\r\n<div class="panel" id="${nextMarker}">`;
    if (!html.includes(needle)) throw new Error(`앵커를 찾지 못함(panel=${nextMarker})`);
    const crlf = sectionHtml.replace(/\n/g, '\r\n');
    html = html.replace(needle, `  </div>\r\n${crlf}\r\n</div>\r\n\r\n<div class="panel" id="${nextMarker}">`);
  };
  insertInsidePanelBefore('p0-kq', sec0ks);
  insertInsidePanelBefore('p1-ks', sec0kq);
  insertInsidePanelBefore('p1-kq', sec1ks);
  insertInsidePanelBefore('p2', sec1kq);
  insertInsidePanelBefore('p3', sec2);

  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.error(`[완료] ${HTML_PATH} 갱신 — 표 숫자와 카드 숫자 일치(표는 그대로, 차트 종가만 신규 fetch)`);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
