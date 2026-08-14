// 눌림목 포털 HTML 탭 구조 개편: 최근신호-예상종목-보유종목-매매전략-백테스트결과-요약
// project_pullback_holdings_candidates.mjs가 만든 JSON을 읽어 "예상종목"·"보유종목" 패널 HTML을 새로 만들고
// 기존 5탭(차트/매매전략/요약/백테스트결과/최근신호)을 목표 순서로 재배치한다.
// 사용법: node scripts/project_pullback_tab_restructure.mjs <data.json> <target.html>
import fs from 'fs';

const DATA_PATH = process.argv[2];
const HTML_PATH = process.argv[3];

const SL = 8, TP_PCT = 10;

function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function devClass(n) { return n == null ? 't-flat' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

function buildChartSvg(rows, opts) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema50, r.ema100));
  if (opts.avgPrice) allVals.push(opts.avgPrice, opts.slPrice);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema100', 'amber', '6,3', 1.3) + poly('ema50', 'purple', '4,3', 1.4);
  if (opts.avgPrice) {
    svg += `<line x1="${x0}" y1="${yAt(opts.avgPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.avgPrice).toFixed(1)}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<line x1="${x0}" y1="${yAt(opts.slPrice).toFixed(1)}" x2="${x1}" y2="${yAt(opts.slPrice).toFixed(1)}" stroke="var(--coral)" stroke-width="1.1" stroke-dasharray="1,3"/>`;
  }
  svg += poly('close', 'txt', null, 1.7);
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function candidateCardHtml(r) {
  const svg = buildChartSvg(r.chartRows, {});
  const heldBadge = r.held ? '<span class="badge bdg-teal">보유중</span>' : '<span class="badge bdg-sky">정배열</span>';
  const ema50Dev = (r.close - r.ema50) / r.ema50 * 100;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span>${heldBadge}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(r.close)}</span> <span class="sep">|</span> EMA50대비 <span class="${devClass(ema50Dev)}">${fmt(ema50Dev)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>최근 신고가 대비 눌림폭 <span>${r.pullbackPct.toFixed(2)}%</span> <span class="sep">|</span> 되돌림밴드(ATR×0.4) 대비 <span>${r.normDepth.toFixed(2)}배</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--purple)"></i>EMA50</span><span><i style="background:var(--amber)"></i>EMA100</span></div>
      </div>`;
}

function holdingVerdict(h) {
  if (h.unrealizedRet != null && h.unrealizedRet <= -SL) return { label: '손절검토', cls: 'red' };
  if (!h.aboveEma50) return { label: '전량매도검토(50EMA이탈)', cls: 'red' };
  if (h.freshTp10) return { label: '1차익절검토(+10%)', cls: 'teal' };
  if (h.aboveEma50) return { label: '홀딩(50EMA위)', cls: 'teal' };
  if (h.unrealizedRet != null && h.unrealizedRet <= -SL * 0.6) return { label: '주의', cls: 'amber' };
  return { label: '관찰', cls: 'gray' };
}

const CLS_TOKEN = { red: 'red', teal: 'teal', amber: 'amber', gray: 'gray600' };

function holdingCardHtml(h) {
  const v = holdingVerdict(h);
  const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
  const tok = CLS_TOKEN[v.cls];
  const slPrice = h.avgPrice * (1 - SL / 100);
  const svg = buildChartSvg(h.chartRows, { avgPrice: h.avgPrice, slPrice });
  const ema50Dev = (h.close - h.ema50) / h.ema50 * 100;
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(h.name)}</span><span class="badge ${badgeCls}">${v.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(h.close)}</span> <span class="sep">|</span> 평단대비 <span class="${devClass(h.unrealizedRet)}">${fmt(h.unrealizedRet)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA50대비 <span class="${devClass(ema50Dev)}">${fmt(ema50Dev)}</span> <span class="sep">|</span> 추세 <span>${h.trendUp ? '정배열(상승)' : '역배열/조정'}</span></span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--${tok})"></i>판단 <span style="color:var(--${tok})">${v.label}</span></span><span><i style="background:var(--txt2)"></i>평단 <span>${fmtV(h.avgPrice)}</span></span><span><i style="background:var(--coral)"></i>손절선(-8%) <span>${fmtV(slPrice)}</span></span></div>
      </div>`;
}

function buildCandidatesPanel(d) {
  const rows = d.candidates.map(c => {
    const ema50Dev = (c.close - c.ema50) / c.ema50 * 100;
    return `<tr><td class="l">${esc(c.name)}</td><td class="c">${c.market}</td><td>${fmtV(c.close)}</td><td class="${devClass(ema50Dev)}">${fmt(ema50Dev)}</td><td>${c.pullbackPct.toFixed(2)}%</td><td>${c.normDepth.toFixed(2)}배</td><td class="c">${c.held ? '<span class="badge bdg-teal">보유중</span>' : '─'}</td></tr>`;
  }).join('\n          ');
  const cards = d.candidates.map(candidateCardHtml).join('\n');
  return `<div class="panel" id="p1">
  <div class="kpi-row">
    <div class="kpi-card kpi-sky"><div class="num">${d.universeValid}</div><div class="lbl">분석 유니버스(TOP50)</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${d.trendUpCount}</div><div class="lbl">정배열(EMA50&gt;EMA100) 종목</div></div>
    <div class="kpi-card kpi-amber"><div class="num">${d.candidates.length}</div><div class="lbl">예상종목(근접 top6)</div></div>
  </div>

  <div class="sc">
    <div class="sc-title">예상종목 리스트 <span class="sub">정배열(EMA50&gt;EMA100 상승기울기) 종목 중 되돌림밴드(ATR%×0.4) 근접도 순 상위 6종목</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">종목명</th><th class="c">시장</th><th>현재가</th><th>EMA50대비</th><th>눌림폭</th><th>밴드대비</th><th class="c">보유</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>

  <div class="sc">
    <div class="sc-title">예상종목 차트</div>
    <div class="chart-grid">
${cards}
    </div>
    <div class="sc-note">정배열(EMA50&gt;EMA100, EMA50 상승기울기)이 유지되는 종목 중, 최근 50일 신고가 대비 눌림폭을 해당 종목 변동성(ATR%×0.4)으로 정규화해 "되돌림밴드에 가장 가까운" 순으로 6종목을 선정했습니다. 밴드대비 1.00배 이하로 좁혀지고 6거래일 내 신고가 갱신 이력이 더해지면 V3_RETEST 매수신호가 발생합니다 — 아직 신호 발생 종목은 아니며 근접도 기준 참고용입니다.</div>
  </div>
</div>`;
}

function buildHoldingsPanel(d) {
  const ok = d.holdings.filter(h => !h.error);
  const err = d.holdings.filter(h => h.error);
  const trendUpCnt = ok.filter(h => h.trendUp).length;
  const avgRet = ok.length ? ok.reduce((a, h) => a + (h.unrealizedRet || 0), 0) / ok.length : null;
  const rows = ok.map(h => {
    const v = holdingVerdict(h);
    const badgeCls = { red: 'bdg-red', teal: 'bdg-teal', amber: 'bdg-amber', gray: 'bdg-gray' }[v.cls];
    const ema50Dev = (h.close - h.ema50) / h.ema50 * 100;
    return `<tr><td class="l">${esc(h.name)}</td><td class="c">${h.market}</td><td class="${devClass(h.unrealizedRet)}">${fmt(h.unrealizedRet)}</td><td class="${devClass(ema50Dev)}">${fmt(ema50Dev)}</td><td class="c">${h.trendUp ? '정배열' : '역배열/조정'}</td><td class="c"><span class="badge ${badgeCls}">${v.label}</span></td></tr>`;
  }).join('\n          ');
  const errNote = err.length ? `<div class="sc-note">데이터 조회 실패: ${err.map(h => esc(h.name)).join(', ')} (${err.length}종목, 표에서 제외)</div>` : '';
  const cards = ok.map(holdingCardHtml).join('\n');
  return `<div class="panel" id="p2">
  <div class="kpi-row">
    <div class="kpi-card kpi-sky"><div class="num">${ok.length}</div><div class="lbl">보유종목 수</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${trendUpCnt}</div><div class="lbl">정배열 유지</div></div>
    <div class="kpi-card ${avgRet != null && avgRet >= 0 ? 'kpi-coral' : 'kpi-sky'}"><div class="num">${fmt(avgRet)}</div><div class="lbl">평단대비 평균수익률</div></div>
  </div>

  <div class="sc">
    <div class="sc-title">보유종목 현황 <span class="sub">Notion 보유종목DB 연동 · 눌림목(EMA50/100) 기준 재판정</span></div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th class="l">종목명</th><th class="c">시장</th><th>평단대비(실손익)</th><th>EMA50대비</th><th class="c">추세</th><th class="c">판단</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${errNote}
  </div>

  <div class="sc">
    <div class="sc-title">보유종목 차트</div>
    <div class="chart-grid">
${cards}
    </div>
    <div class="sc-note">눌림목 전략은 진입 시점의 매수일자·이행레그가 노션 스키마에 없어(괴리율 보유종목탭과 동일한 한계), 평단가 기준 손절(-8%)·EMA50 이탈 여부·매입가 대비 +10% 신규도달만 매일 스냅샷으로 재판정합니다. 정배열이 아닌 보유종목은 눌림목 전략의 신규 매수 조건 밖에서 진입된 종목(다른 전략·재량매매)일 수 있습니다.</div>
  </div>
</div>`;
}

function main() {
  const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let html = fs.readFileSync(HTML_PATH, 'utf8');

  // 1) 기존 5개 패널 추출 (p0=차트→폐기, p1=매매전략, p2=요약, p3=백테스트결과, p4=최근신호)
  function extractPanel(id) {
    const startTag = `<div class="panel`; // "panel" or "panel on"
    const idMarker = `id="${id}">`;
    const idPos = html.indexOf(idMarker);
    if (idPos === -1) throw new Error(`panel ${id} not found`);
    const openPos = html.lastIndexOf(startTag, idPos);
    // find matching closing </div> by depth counting from openPos's tag end
    const tagEnd = html.indexOf('>', idPos) + 1;
    let depth = 1, i = tagEnd;
    while (depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) throw new Error('unbalanced div');
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
      else { depth--; i = nextClose + 6; }
    }
    return { text: html.slice(openPos, i), start: openPos, end: i };
  }

  const p1 = extractPanel('p1'); // 매매전략
  const p2 = extractPanel('p2'); // 요약
  const p3 = extractPanel('p3'); // 백테스트결과
  const p4 = extractPanel('p4'); // 최근신호
  const p0 = extractPanel('p0'); // 차트 (폐기 대상, 범위만 사용)

  // 새 최근신호 패널(p0 자리에 들어갈 내용) — 기존 p4 내용에서 id만 변경, "on" 클래스 부여
  const newP0 = p4.text.replace('id="p4"', 'id="p0"').replace('class="panel"', 'class="panel on"');
  const newP1 = buildCandidatesPanel(d); // 예상종목
  const newP2 = buildHoldingsPanel(d);   // 보유종목
  const newP3 = p1.text.replace('id="p1"', 'id="p3"'); // 매매전략
  const newP4 = p3.text.replace('id="p3"', 'id="p4"'); // 백테스트결과
  const newP5 = p2.text.replace('id="p2"', 'id="p5"'); // 요약

  // 2) 5개 패널 블록을 통째로 새 6개 패널로 교체 (p0 시작 ~ p4 끝 구간을 한 번에 치환)
  const blockStart = p0.start;
  const blockEnd = p4.end;
  const newBlock = [newP0, newP1, newP2, newP3, newP4, newP5].join('\n\n');
  html = html.slice(0, blockStart) + newBlock + html.slice(blockEnd);

  // 3) 탭 버튼 재구성 (기존 5버튼 블록을 6버튼으로 교체)
  const oldTabsBlock = `    <button class="tab-btn on" data-tab="0">차트</button>
    <button class="tab-btn" data-tab="1">매매전략</button>
    <button class="tab-btn" data-tab="2">요약</button>
    <button class="tab-btn" data-tab="3">백테스트결과</button>
    <button class="tab-btn" data-tab="4">최근신호</button>`;
  const newTabsBlock = `    <button class="tab-btn on" data-tab="0">최근신호</button>
    <button class="tab-btn" data-tab="1">예상종목</button>
    <button class="tab-btn" data-tab="2">보유종목</button>
    <button class="tab-btn" data-tab="3">매매전략</button>
    <button class="tab-btn" data-tab="4">백테스트결과</button>
    <button class="tab-btn" data-tab="5">요약</button>`;
  if (!html.includes(oldTabsBlock)) throw new Error('tab block not found for replacement');
  html = html.replace(oldTabsBlock, newTabsBlock);

  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  console.log('완료:', HTML_PATH);
}

main();
