// 라운드넘버 stock-portal 앱 — 보유종목 탭(p2) 차트카드 섹션을 13종목(2026-08-24 장마감 최종 갱신, LS ELECTRIC·
// 셀트리온 신규 편입/SK텔레콤·원익IPS 매도) 기준으로 재생성해 apps/stock-portal/stock-roundnumber.html에 삽입한다.
// project_roundnumber_chart_cards.mjs의 buildRoundnumberChartSvg/holdingChartCardHtml 패턴을 재사용하되,
// 뱃지를 "수익/손실 %" 대신 표의 "판단"(지지임박/박스권홀드)과 일치시킨다.
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

const HTML_PATH = 'C:\\Users\\shinf\\workspace\\apps\\stock-portal\\stock-roundnumber.html';
const HOLDINGS_JSON = 'C:\\Users\\shinf\\workspace\\data\\holdings.json';
const CALENDAR_DAYS = 400;
const HOLDINGS_CHART_DAYS = 60;

// 표(p2)에 이미 반영한 라이브 값과 100% 동일해야 함(2026-08-26 장마감 갱신 — 2026-08-25 리밸런싱분 반영, 4종목)
const HOLDINGS = [
  { name: '두산로보틱스', price: 71800, avgPrice: 79706, ret: -9.92, support: 70000, supportDistPct: -2.51, resistance: 75000, resistanceDistPct: 4.46, verdict: '박스권 홀드', badge: 'bdg-gray', code: '454910', market: 'KOSPI' },
  { name: '삼성중공업', price: 20700, avgPrice: 21350, ret: -3.04, support: 20500, supportDistPct: -0.97, resistance: 21000, resistanceDistPct: 1.45, verdict: '지지 임박·이탈시 손절검토', badge: 'bdg-red', code: '010140', market: 'KOSPI' },
  { name: 'HD현대일렉트릭', price: 733000, avgPrice: 733000, ret: 0.00, support: 725000, supportDistPct: -1.09, resistance: 750000, resistanceDistPct: 2.32, verdict: '지지 임박·이탈시 손절검토', badge: 'bdg-red', code: '267260', market: 'KOSPI' },
  { name: '한미반도체', price: 219500, avgPrice: 217500, ret: 0.92, support: 210000, supportDistPct: -4.33, resistance: 220000, resistanceDistPct: 0.23, verdict: '저항 근접·돌파시 익절검토', badge: 'bdg-amber', code: '042700', market: 'KOSPI' },
];

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
async function fetchCloseSeqByCode(code, market) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = market === 'KOSDAQ' ? `${code}.KQ` : `${code}.KS`;
  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return null;
  const dates = chart.ts.map(tsToKstDate);
  const seq = [];
  for (let i = 0; i < dates.length; i++) if (chart.close[i] != null) seq.push({ date: dates[i], close: chart.close[i] });
  return seq;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtWon(n) { return n != null ? Math.round(n).toLocaleString('ko-KR') : '─'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '─'; }

function buildRoundnumberChartSvg(rows, refLines) {
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
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}
function holdingChartCardHtml(h) {
  const svg = buildRoundnumberChartSvg(h.chartRows, [
    { value: h.support, color: 'amber', dash: '6,3', width: 1.8 },
    { value: h.resistance, color: 'sky', dash: '6,3', width: 1.8 },
    { value: h.avgPrice, color: 'purple', dash: '4,2', width: 1.6 },
  ]);
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(h.name)}</span><span class="badge ${h.badge}">${esc(h.verdict)}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtWon(h.price)}</span> <span class="sep">|</span> 평단가 <span>${fmtWon(h.avgPrice)}</span> <span class="sep">|</span> 수익률 <span class="${h.ret >= 0 ? 't-pos' : 't-neg'}">${fmtPct(h.ret)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>라운드지지 <span>${fmtWon(h.support)}</span>(${h.supportDistPct.toFixed(1)}%) <span class="sep">|</span> 라운드저항 <span>${fmtWon(h.resistance)}</span>(+${h.resistanceDistPct.toFixed(1)}%)</span>
        </div>
        <div class="chart-card-legend"><span><i class="dash" style="border-color:var(--amber)"></i>라운드지지</span><span><i class="dash" style="border-color:var(--sky)"></i>라운드저항</span><span><i class="dash" style="border-color:var(--purple)"></i>평단가</span></div>
      </div>`;
}

async function main() {
  const holdingsJson = JSON.parse(fs.readFileSync(HOLDINGS_JSON, 'utf8'));
  const codeByName = new Map(holdingsJson.map(h => [h.종목명, { code: h.종목코드, market: h.시장 }]));

  const rows = [];
  for (const h of HOLDINGS) {
    const info = codeByName.get(h.name);
    if (!info) { console.error(`[누락] ${h.name} — holdings.json에 없음`); continue; }
    const seq = await fetchCloseSeqByCode(info.code, info.market);
    await new Promise(r => setTimeout(r, 150));
    if (!seq || seq.length < 2) { console.error(`[fetch실패] ${h.name}`); continue; }
    h.chartRows = seq.slice(Math.max(0, seq.length - HOLDINGS_CHART_DAYS), seq.length);
    rows.push(h);
  }
  console.error(`[완료] ${rows.length}/${HOLDINGS.length}종목 차트 fetch`);

  const cardsHtml = rows.map(holdingChartCardHtml).join('\n');
  const sectionHtml = `  <div class="sc">
    <div class="sc-title">보유종목 차트 <span class="sub">전체 ${rows.length}종목</span></div>
    <div class="chart-grid">
${cardsHtml}
    </div>
  </div>`;

  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const eol = html.includes('\r\n') ? '\r\n' : '\n'; // 파일이 CRLF/LF 어느 쪽이든 대응(2026-08-24 수정)
  const startNeedle = `  <div class="sc">${eol}    <div class="sc-title">보유종목 차트`;
  const startIdx = html.indexOf(startNeedle);
  if (startIdx < 0) throw new Error('보유종목 차트 섹션 시작 앵커를 찾지 못함');
  // 이 섹션은 p2 패널의 마지막 .sc 블록(뒤에 p3 패널 시작)이므로, 그 다음 종료 앵커 직전까지가 범위
  const endNeedle = `${eol}</div>${eol}${eol}<div class="panel" id="p3">`;
  const endIdx = html.indexOf(endNeedle, startIdx);
  if (endIdx < 0) throw new Error('보유종목 차트 섹션 종료 앵커를 찾지 못함');
  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx); // endNeedle 그대로 유지(패널 닫는 태그 포함)
  html = before + sectionHtml.replace(/\n/g, eol) + after;
  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.error(`[저장완료] ${HTML_PATH}`);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
