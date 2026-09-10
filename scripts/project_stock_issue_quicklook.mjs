/**
 * project_stock_issue_quicklook.mjs — 개별종목 이슈·특이사항 빠른 조회 (터미널 표 전용)
 *
 * project_stock_issue_pdf.mjs(PDF 산출물, WebSearch 수동 조사)와 달리
 * 매일 자주 쓰는 단건/소수 종목 조회용 — 네이버 증권 뉴스 스크래핑 + Claude Sonnet 자동 분석 +
 * KIS 실시간가를 한 번에 묶어 터미널 박스 표로 바로 출력. PDF/Notion 업로드 없음.
 *
 * 사용법:
 *   node scripts/project_stock_issue_quicklook.mjs "코드:종목명,코드:종목명,..."
 *   예) node scripts/project_stock_issue_quicklook.mjs "086790:하나금융지주"
 *
 * 데이터 소스:
 *   현재가·등락률·거래대금 → KIS API 실시간 (kis_api.mjs 재사용)
 *   뉴스 원문 제목          → 네이버 증권 뉴스 스크래핑 (scheduler_stock_daily_update.mjs 패턴 재사용)
 *   이슈 분석(강도/섹터/트리거/점수/요약/상세) → Claude Sonnet (MY_ANTHROPIC_API_KEY 필요)
 */
import https from 'https';
import { getToken, fetchKisPrice } from './kis_api.mjs';

const ANTHROPIC_API_KEY = process.env.MY_ANTHROPIC_API_KEY;

function parseTargetsArg(arg) {
  if (!arg) throw new Error('사용법: node project_stock_issue_quicklook.mjs "코드:종목명,코드:종목명,..."');
  return arg.split(',').map(pair => {
    const [종목코드, 종목명] = pair.split(':');
    return { 종목코드, 종목명: 종목명 || 종목코드 };
  });
}
const TARGETS = parseTargetsArg(process.argv[2]);

// ── 네이버 증권 뉴스 수집 (scheduler_stock_daily_update.mjs와 동일 패턴) ──
function fetchNaverNews(code, maxItems = 5) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'finance.naver.com',
      path: `/item/news_news.naver?code=${code}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    'https://finance.naver.com/',
        'Accept':     'text/html,application/xhtml+xml',
      }
    }, res => {
      if ([301, 302].includes(res.statusCode)) return resolve({ titles: [], url: '' });
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let html;
        try { html = new TextDecoder('euc-kr').decode(Buffer.concat(chunks)); }
        catch { html = Buffer.concat(chunks).toString('utf8'); }
        try {
          const titles = [], re = /class="title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]{5,100})<\/a>/g;
          let m, firstUrl = '';
          while ((m = re.exec(html)) !== null && titles.length < maxItems) {
            const title = m[2]
              .replace(/&hellip;/g, '…').replace(/&middot;/g, '·').replace(/&lsquo;/g, "'")
              .replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
            const url = 'https://finance.naver.com' + m[1].split('&sm=')[0];
            if (!firstUrl) firstUrl = url;
            titles.push(title);
          }
          resolve({ titles, url: firstUrl });
        } catch { resolve({ titles: [], url: '' }); }
      });
    });
    req.on('error', () => resolve({ titles: [], url: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ titles: [], url: '' }); });
    req.end();
  });
}

// ── Claude API (raw https) ──
function claudeReq(messages, system, maxTokens, model) {
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error(`Claude ${res.statusCode}: ${json.error?.message || d.slice(0,200)}`));
          else resolve(json);
        } catch { reject(new Error('Claude 파싱 오류')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude API 타임아웃')); });
    req.write(body); req.end();
  });
}

const ANALYST_SYSTEM = '당신은 한국 주식시장 전문 애널리스트입니다. 종목 데이터와 뉴스를 분석하여 투자자에게 유용한 인사이트를 제공합니다. 수치는 제공된 데이터만 사용하고 추측하지 마십시오.';

async function analyzeIssue(s, news) {
  if (!ANTHROPIC_API_KEY) {
    return { intensity: '⚪약함', sectors: ['기타'], trigger: '기타', 점수: 0,
      summary: '(ANTHROPIC_API_KEY 없음 — 뉴스 제목만 표시)', detail: '', model: '없음' };
  }
  const newsBlock = news.titles.length
    ? news.titles.map((t, i) => `${i+1}. ${t}`).join('\n')
    : '(관련 뉴스 없음)';
  const prompt = `종목: ${s.종목명}(${s.종목코드})
현재가: ${s.현재가?.toLocaleString() ?? '-'}원, 등락률: ${s.등락률 != null ? (s.등락률>=0?'+':'')+s.등락률+'%' : '-'}, 거래대금: ${s.거래대금 ? Math.round(s.거래대금/1e8)+'억' : '-'}

최근 뉴스 제목:
${newsBlock}

위 정보를 바탕으로 이 종목의 이슈·특이사항을 분석해 JSON 1개 객체만 반환하세요:
{
  "intensity": "🔴핵심|🟠강함|🟡보통|⚪약함 중 하나 (뉴스 임팩트·투자 관련성 기준)",
  "sectors": ["섹터명 1~2개"],
  "trigger": "실적|수급|테마|공시|외인|기관|재료|차익|기술적 중 하나",
  "점수": 0~100 정수 (이슈 중요도·투자 관련성 종합 판단),
  "summary": "핵심 이슈 80자 이내",
  "detail": "뉴스·시황 기반 이슈 상세 서술. 호재·리스크 요인 균형있게. 향후 모니터링 포인트 1~2가지 포함. 400자 이내."
}
출력 규칙: JSON 객체 1개만. 마크다운 금지. 줄바꿈 금지.`;
  try {
    const res = await claudeReq([{ role: 'user', content: prompt }], ANALYST_SYSTEM, 1500, 'claude-sonnet-4-6');
    const raw = res.content?.[0]?.text || '';
    const stripped = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    const obj = JSON.parse(stripped);
    return { ...obj, model: 'Sonnet' };
  } catch (e) {
    return { intensity: '⚪약함', sectors: ['기타'], trigger: '기타', 점수: 0,
      summary: `분석 실패: ${e.message}`, detail: '', model: '오류' };
  }
}

// ── 표시 유틸 (한글 2칸 폭 계산) ──
function vw(str) {
  let w = 0;
  for (const c of (str||'')) {
    const cp = c.codePointAt(0);
    w += (cp > 0x2E7F && cp < 0xFFFE) || cp > 0x1F000 ? 2 : 1;
  }
  return w;
}
function pr(str, width) { str = String(str||''); return str + ' '.repeat(Math.max(0, width - vw(str))); }
function wrap(text, maxW) {
  if (!text) return [];
  const lines = []; let line = '', lineW = 0;
  for (const ch of text) {
    const cw = vw(ch);
    if (lineW + cw > maxW) { lines.push(line); line = ch; lineW = cw; }
    else { line += ch; lineW += cw; }
  }
  if (line) lines.push(line);
  return lines;
}

async function main() {
  const token = await getToken();
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const W = 92;
  const HR = '─'.repeat(W), HR2 = '═'.repeat(W);
  const C = { no: 3, name: 26, int: 9, sec: 18, trg: 8, score: 5 };
  const BODY_PREFIX = '        ';
  const CONTENT_W = W - vw(BODY_PREFIX) - vw('     │ ') - 2;

  console.log('');
  console.log(HR2);
  console.log(`  개별종목 이슈·특이사항 (${timeStr} 기준)`);
  console.log(HR2);
  console.log(` ${pr('#', C.no)}${pr('종목명 (코드)', C.name)} │ ${pr('강도', C.int)} │ ${pr('섹터', C.sec)} │ ${pr('트리거', C.trg)} │ ${pr('점수', C.score)} │ 모델`);
  console.log(HR2);

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    const [price, news] = await Promise.all([fetchKisPrice(token, t.종목코드), fetchNaverNews(t.종목코드)]);
    const s = { 종목코드: t.종목코드, 종목명: t.종목명, ...(price || {}) };
    const a = await analyzeIssue(s, news);

    const sec = (a.sectors||[]).join('/') || '-';
    const score = typeof a.점수 === 'number' ? String(a.점수) : '-';
    const priceLine = price
      ? `${price.현재가.toLocaleString()}원 (${price.등락률>=0?'+':''}${price.등락률}%)`
      : '가격조회 실패';

    console.log(` ${pr(String(i+1), C.no)}${pr(`${t.종목명} (${t.종목코드})`, C.name)} │ ${pr(a.intensity||'-', C.int)} │ ${pr(sec, C.sec)} │ ${pr(a.trigger||'-', C.trg)} │ ${pr(score, C.score)} │ ${a.model||'-'}`);
    console.log(`${BODY_PREFIX}현재가 │ ${priceLine}`);

    const sumLines = wrap(a.summary||'', CONTENT_W);
    if (sumLines.length) {
      console.log(`${BODY_PREFIX}요약  │ ${sumLines[0]}`);
      for (let j = 1; j < sumLines.length; j++) console.log(`${BODY_PREFIX}     │ ${sumLines[j]}`);
    }
    const detLines = wrap(a.detail||'', CONTENT_W);
    if (detLines.length) {
      console.log(`${BODY_PREFIX}상세  │ ${detLines[0]}`);
      for (let j = 1; j < detLines.length; j++) console.log(`${BODY_PREFIX}     │ ${detLines[j]}`);
    }
    const newsText = (news.titles||[]).slice(0,3).join('  /  ');
    const newsLines = wrap(newsText, CONTENT_W);
    if (newsLines.length) {
      console.log(`${BODY_PREFIX}뉴스  │ ${newsLines[0]}`);
      for (let j = 1; j < newsLines.length; j++) console.log(`${BODY_PREFIX}     │ ${newsLines[j]}`);
    }

    console.log(i < TARGETS.length - 1 ? HR : HR2);
  }

  console.log('[데이터 소스] 현재가·등락률: KIS API 실시간 / 뉴스: 네이버 증권 종목뉴스 / 이슈분석: Claude Sonnet 자동 생성(참고용, 확정 공시 아님)\n');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
