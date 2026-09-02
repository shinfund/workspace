/**
 * project_stock_issue_pdf.mjs — 종목 이슈·공시 정리 PDF 생성
 *
 * Usage:
 *   node project_stock_issue_pdf.mjs <input.json> [outSlug]
 *
 * 입력(JSON) 구조: see scripts/_stock_issue_pdf_example.json
 *   {
 *     "title": "방산·중공업 6종목 이슈·공시 정리",
 *     "subtitle": "한화에어로스페이스 · LIG디펜스앤에어로스페이스 · ...",
 *     "asOfDate": "2026-09-02",
 *     "summary": "공통 관전 포인트 문단(선택)",
 *     "holdingsTable": [ { "종목명":"삼성중공업","종목코드":"010140","보유수량":"95주","평균단가":"20,623원" }, ... ]  (선택)
 *     "stocks": [
 *       {
 *         "name": "한화에어로스페이스", "code": "012450", "market": "KOSPI",
 *         "priceNote": "시총 53.7조 (코스피 12위) | PER 25.94배 (업종 32.63배)",  (선택, 가격 외 보조 지표만 — HTML 허용)
 *         "blocks": [
 *           { "type": "issue", "label": "호재", "text": "..." },
 *           { "type": "risk",  "label": "리스크", "text": "..." },
 *           { "type": "note",  "label": "참고", "text": "..." }
 *         ]
 *       }, ...
 *     ],
 *     "sourceNote": "[데이터 소스] 웹 검색(뉴스·시황 기사) 기반 정리, ... 기준. 실시간 확정 공시 정보가 아니며 오차·지연 가능"
 *   }
 *
 * "이슈"(뉴스·시황)·"공시" 데이터는 매번 WebSearch로 직접 조사해 이 JSON에 채워 넣는 방식(공식 결정, 2026-09-02).
 * **단, 현재가·전일대비 등락률·거래대금(가격 라인)은 WebSearch 금지 — 뉴스 기사 속 가격은 기사
 * 작성 시점 스냅샷이라 부정확함(사용자 확인, 2026-09-02: NAVER 리포트에서 뉴스 220,500원/-1.34%
 * vs KIS 실시간 209,000원/-2.79% 오차 실측).** `code`가 있는 종목은 스크립트가 KIS API
 * (kis_api.mjs의 fetchKisPrice, 기존 표준 시세 소스)로 자동 조회해 가격 라인을 만든다 — JSON에
 * 가격을 직접 쓰지 말 것. PER·시총순위 등 가격이 아닌 보조 지표만 `priceNote`에 리서치로 채운다.
 *
 * 출력: data/analysis/stock-issue-pdf/<outSlug>_<YYYYMMDDHHmm>.pdf (PDF만 남김, 2026-09-02 확정)
 *       HTML은 변환용으로 os.tmpdir()에 임시 생성 후 즉시 삭제 — data/analysis에 HTML 사본을
 *       남기지 않는다(사용자가 "html 파일 생성 불필요" 명시).
 *       PDF는 headless Chrome(--print-to-pdf)으로 변환, 격리된 프로필 디렉터리 사용
 *       (일반 Chrome 실행 중에도 충돌 없이 동작)
 *
 * 가독성 기준(2026-09-02 최종 확정, feedback_html_design 메모리 참고): 본문 14.5px/#0d0d0d,
 * 라벨·메타 13px 이상+weight 700, 섹션 제목 17px/800, 배지 12px/800, 각주 11.5px/600.
 * PDF는 HTML/Artifact 기준보다 한 단계 더 진하고 크게 — 색상 대비만으로는 재발 확인됨.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { getToken, fetchKisPrice } from './kis_api.mjs';

const OUT_DIR = 'C:\\Users\\shinf\\workspace\\data\\analysis\\stock-issue-pdf';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('Chrome 실행파일을 찾을 수 없습니다: ' + CHROME_CANDIDATES.join(', '));
}

function pad(n) { return String(n).padStart(2, '0'); }
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const LABEL_CLASS = { issue: 'label-issue', risk: 'label-risk', note: 'label-note' };
const LABEL_DEFAULT = { issue: '호재', risk: '리스크', note: '참고' };

function esc(s) {
  // blocks/priceLine 등은 의도적으로 raw HTML(강조 span) 허용 — text 값만 최소 escape
  return String(s ?? '');
}

function renderHoldingsTable(rows) {
  if (!rows || !rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const body = rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('\n');
  return `<table class="holdings">\n  <tr>${head}</tr>\n${body}\n</table>`;
}

function fmtWon(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
function fmtEok(n) { return (Number(n) / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '억원'; }

// KIS API(inquire-price) 실시간 시세로 가격 라인을 만든다 — WebSearch 뉴스 기사 속 가격은
// 기사 작성 시점 스냅샷이라 부정확할 수 있어 사용 금지(2026-09-02 확정, NAVER 리포트에서 실측
// 오차 확인: 뉴스 220,500원/-1.34% vs KIS 실시간 209,000원/-2.79%).
async function fetchAutoPriceLine(token, code) {
  const p = await fetchKisPrice(token, code);
  if (!p || !p.현재가) return null;
  const sign = p.등락률 >= 0 ? 'up' : 'down';
  const pct = (p.등락률 >= 0 ? '+' : '') + p.등락률.toFixed(2) + '%';
  return `현재가 ${fmtWon(p.현재가)}, 전일 대비 <span class="${sign}">${pct}</span> &nbsp;|&nbsp; 거래대금 ${fmtEok(p.거래대금)}`;
}

function renderStock(s) {
  const codeMarket = [s.code, s.market].filter(Boolean).join(' · ');
  const priceParts = [s._autoPriceLine, s.priceNote].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const priceLine = priceParts ? `<div class="price-line">${priceParts}</div>` : '';
  const blocks = (s.blocks || []).map(b => {
    const cls = LABEL_CLASS[b.type] || 'label-note';
    const label = b.label || LABEL_DEFAULT[b.type] || '참고';
    return `  <div class="block"><span class="block-label ${cls}">${esc(label)}</span>${b.text}</div>`;
  }).join('\n');
  return `<div class="stock-section">
  <div class="stock-title">${esc(s.name)} <span class="code">${esc(codeMarket)}</span></div>
  ${priceLine}
${blocks}
</div>`;
}

function buildHtml(data) {
  const summary = data.summary
    ? `<div class="summary-box"><b>공통 관전 포인트</b> — ${data.summary}</div>`
    : '';
  const holdingsTable = renderHoldingsTable(data.holdingsTable);
  const stocksHtml = (data.stocks || []).map(renderStock).join('\n\n');
  const sourceNote = data.sourceNote || '[데이터 소스] 웹 검색(뉴스·시황 기사) 기반 정리. 실시간 확정 공시 정보가 아니며 오차·지연 가능';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(data.title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Malgun Gothic", "Segoe UI", sans-serif;
    color: #0d0d0d;
    background: #ffffff;
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.75;
  }
  .header { border-bottom: 3px solid #1a3a6b; padding-bottom: 12px; margin-bottom: 18px; }
  .header h1 { font-size: 23px; margin: 0 0 6px 0; color: #0a1830; }
  .header .meta { font-size: 13px; color: #101010; font-weight: 700; }
  .stock-section { border: 1px solid #c3cbd4; border-radius: 6px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .stock-title { font-size: 17px; font-weight: 800; color: #0a1830; margin: 0 0 5px 0; display: flex; justify-content: space-between; align-items: baseline; }
  .stock-title .code { font-size: 13px; color: #1c2027; font-weight: 700; }
  .price-line { font-size: 13.5px; color: #0d0d0d; font-weight: 700; margin-bottom: 9px; padding-bottom: 9px; border-bottom: 1px dashed #9aa5b1; }
  .price-line .up { color: #c81e1e; font-weight: 800; }
  .price-line .down { color: #1450c8; font-weight: 800; }
  .block { margin-bottom: 7px; font-size: 13.5px; }
  .block-label { display: inline-block; font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 3px; margin-right: 6px; color: #fff; }
  .label-issue { background: #16305c; }
  .label-risk { background: #9e1f18; }
  .label-note { background: #363c44; }
  .summary-box { background: #eef3fa; border: 1px solid #c3cbd4; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; font-size: 13.5px; color: #0d0d0d; }
  .summary-box b { color: #0a1830; }
  table.holdings { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  table.holdings th, table.holdings td { border: 1px solid #c3cbd4; padding: 7px 9px; text-align: right; color: #0d0d0d; font-weight: 600; }
  table.holdings th { background: #0a1830; color: #fff; text-align: center; font-weight: 700; }
  table.holdings td:first-child, table.holdings th:first-child { text-align: left; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #c3cbd4; font-size: 11.5px; color: #1a1a1a; font-weight: 600; }
  .disclaimer { font-size: 11.5px; color: #333333; margin-top: 4px; font-weight: 600; }
</style>
</head>
<body>

<div class="header">
  <h1>${esc(data.title)}</h1>
  <div class="meta">${esc(data.subtitle || '')}${data.subtitle ? ' &nbsp;|&nbsp; ' : ''}작성 기준일: ${esc(data.asOfDate || '')}</div>
</div>

${summary}
${holdingsTable}

${stocksHtml}

<div class="footer">
  <div>${esc(sourceNote)}</div>
  <div class="disclaimer">본 자료는 투자 판단을 위한 참고용 정리 자료이며 투자 권유 또는 매매 추천이 아닙니다.</div>
</div>

</body>
</html>
`;
}

async function main() {
  const [inputPath, outSlugArg] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: node project_stock_issue_pdf.mjs <input.json> [outSlug]');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const outSlug = outSlugArg || data.slug || 'stock_issue';
  const ts = timestamp();

  if ((data.stocks || []).some(s => s.code)) {
    const token = await getToken();
    for (const s of data.stocks) {
      if (!s.code) continue;
      s._autoPriceLine = await fetchAutoPriceLine(token, s.code);
      if (!s._autoPriceLine) console.error(`[경고] ${s.name}(${s.code}) KIS 시세 조회 실패 — 가격 라인 생략`);
      await new Promise(r => setTimeout(r, 120));
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(os.tmpdir(), `${outSlug}_${ts}.html`); // 변환용 임시 파일 — PDF만 산출물로 남김
  const pdfPath = path.join(OUT_DIR, `${outSlug}_${ts}.pdf`);

  fs.writeFileSync(htmlPath, buildHtml(data), 'utf8');

  const chrome = findChrome();
  const profileDir = path.join(os.tmpdir(), 'claude_chrome_pdf_profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

  execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ], { stdio: 'pipe' });

  fs.unlinkSync(htmlPath); // PDF만 산출물로 남기고 변환용 임시 HTML은 정리

  console.log(`[생성완료] ${pdfPath}`);
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
