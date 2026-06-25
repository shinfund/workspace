/**
 * issue_retrofix_202606251528.mjs
 * 2026-06-23, 2026-06-24 이슈DB를 Claude AI 분석으로 소급 업데이트
 *
 * 처리 순서 (날짜별):
 *   1) 거래대금DB에서 해당 날짜 TOP10 종목 조회
 *   2) 네이버 증권 뉴스 수집
 *   3) Claude Haiku AI 배치 분석
 *   4) 이슈DB 기존 항목 아카이브
 *   5) 새 항목 생성
 *
 * Usage: node scripts/issue_retrofix_202606251528.mjs [--dry-run]
 */

import https from 'https';

const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DB_TRADEAMT = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const DB_ISSUE    = '2136e8ea-20bf-4384-b883-3b15f923afc0';
const DELAY       = 420;
const DRY         = process.argv.includes('--dry-run');
const DATES       = ['2026-06-23', '2026-06-24'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = msg => console.log(`${new Date().toTimeString().slice(0,8)} ${msg}`);

// ── Notion REST ───────────────────────────────────────────────
function notionReq(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: endpoint,
      method,
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit 초과'));
            await sleep((parseInt(res.headers['retry-after'] || '2') * 1000) + 500);
            resolve(await notionReq(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message || d.slice(0,200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Notion 파싱 오류: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── JSON 문자열 내 literal 줄바꿈 제거 (state-machine) ────────
function fixJsonNewlines(str) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { result += ch; inString = !inString; continue; }
    if (inString && (ch === '\n' || ch === '\r')) { result += ' '; continue; }
    result += ch;
  }
  return result;
}

// ── Claude Haiku API ─────────────────────────────────────────
function claudeReq(messages, system, maxTokens = 5000) {
  const body = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, system, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode >= 400) {
            reject(new Error(`Claude ${res.statusCode}: ${json.error?.message || d.slice(0,200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Claude 파싱 오류: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── 거래대금DB에서 날짜별 TOP10 조회 ────────────────────────
async function getTradeTop10(dateStr) {
  const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, {
    filter: { property: '날짜', date: { equals: dateStr } },
    sorts:  [{ property: '순위', direction: 'ascending' }],
    page_size: 15,
  });
  return res.results.map(p => {
    const pr = p.properties;
    return {
      종목코드:  pr['종목코드']?.rich_text?.[0]?.plain_text || '',
      종목명:    pr['종목명']?.title?.[0]?.plain_text || '',
      등락률:    pr['등락률']?.number ?? 0,
      거래대금:  pr['거래대금']?.number ?? 0,
      현재가:    pr['종가']?.number ?? 0,
      순위:      pr['순위']?.number ?? 99,
    };
  }).filter(s => s.종목코드 && s.순위 <= 10);
}

// ── 이슈DB 기존 항목 조회 ────────────────────────────────────
async function getExistingIssues(dateStr) {
  const res = await notionReq('POST', `/v1/databases/${DB_ISSUE}/query`, {
    filter: { property: '날짜', date: { equals: dateStr } },
    page_size: 30,
  });
  return res.results;
}

// ── 네이버 증권 뉴스 ─────────────────────────────────────────
function fetchNaverNews(code, maxItems = 3) {
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
              .replace(/&hellip;/g,'…').replace(/&middot;/g,'·').replace(/&amp;/g,'&')
              .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
              .replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
            const url = 'https://finance.naver.com' + m[1].split('&sm=')[0];
            if (!firstUrl) firstUrl = url;
            titles.push(title);
          }
          resolve({ titles, url: firstUrl });
        } catch(e) { resolve({ titles: [], url: '' }); }
      });
    });
    req.on('error', () => resolve({ titles: [], url: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ titles: [], url: '' }); });
    req.end();
  });
}

// ── Claude AI 배치 분석 ──────────────────────────────────────
async function analyzeWithAI(dateStr, stocks, newsMap) {
  const stockList = stocks.map(s => ({
    종목코드:   s.종목코드,
    종목명:     s.종목명,
    등락률:     s.등락률,
    거래대금억: Math.round(s.거래대금 / 1e8),
    뉴스:       (newsMap[s.종목코드]?.titles || []).slice(0, 3),
  }));

  const prompt = `${dateStr} 한국 주식시장 거래대금 상위 종목입니다. 각 종목을 분석하여 JSON 배열만 반환하세요.

${JSON.stringify(stockList, null, 2)}

각 종목 형식:
{
  "종목코드": "그대로",
  "intensity": "🔴핵심|🟠강함|🟡보통|⚪약함 (등락률 절댓값: 15%↑=핵심, 10%↑=강함, 5%↑=보통, 미만=약함)",
  "sectors": ["섹터"] (반도체/IT/바이오/금융/에너지/소비재/통신/자동차/화학/건설/철강/기타 중 1~3개),
  "trigger": "실적|수급|테마|공시|외인|기관|재료|차익|기술적 중 하나",
  "summary": "핵심 이슈 80자 이내",
  "detail": "뉴스 제목과 시황을 바탕으로 거래 급증 원인, 주요 이슈를 구체적으로 400자 이내 서술"
}

출력 규칙: JSON 배열만, 한 줄 compact 형식. 예: [{"종목코드":"000660","intensity":"🔴핵심","sectors":["반도체"],"trigger":"실적","summary":"요약","detail":"상세"},...] 마크다운 금지. 줄바꿈 금지.`;

  const res = await claudeReq(
    [{ role: 'user', content: prompt }],
    '당신은 한국 주식시장 전문 애널리스트입니다. 종목 데이터와 뉴스를 분석하여 투자자에게 유용한 인사이트를 제공합니다.',
    5000
  );
  const raw = res.content?.[0]?.text || '';
  // 코드블록 마커 제거 후 JSON 배열 추출
  const stripped = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('[');
  const end   = stripped.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`JSON 배열 없음: ${raw.slice(0,300)}`);

  // state-machine으로 strings 내 literal 줄바꿈 제거 후 파싱
  let jsonStr = fixJsonNewlines(stripped.slice(start, end + 1));
  jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');

  let results;
  try {
    results = JSON.parse(jsonStr);
  } catch(e) {
    log(`  Claude 원본 응답 (디버그): ${raw.slice(0, 1000)}`);
    throw new Error(`JSON 파싱 실패: ${e.message}`);
  }
  const map = {};
  for (const a of results) map[a.종목코드] = a;
  return map;
}

// ── 이슈DB 1건 생성 ─────────────────────────────────────────
async function createIssue(dateStr, s, analysis, news) {
  const dir = s.등락률 >= 5 ? '급등' : s.등락률 <= -5 ? '급락' : '보합';
  const detail = analysis.detail || (news.titles || []).join('. ');
  const props = {
    '종목명':   { title:        [{ text: { content: s.종목명 } }] },
    '날짜':     { date:         { start: dateStr } },
    '종목코드': { rich_text:    [{ text: { content: s.종목코드 } }] },
    '종가':     { number:       s.현재가 },
    '등락률':   { number:       s.등락률 },
    '방향':     { select:       { name: dir } },
    '섹터':     { multi_select: (analysis.sectors || ['기타']).slice(0,3).map(n => ({ name: n })) },
    '이슈강도': { select:       { name: analysis.intensity || '⚪약함' } },
    '트리거':   { multi_select: [{ name: analysis.trigger || '기타' }] },
    '이슈요약': { rich_text:    [{ text: { content: (analysis.summary || '').slice(0,100) } }] },
  };
  if (detail) props['이슈상세'] = { rich_text: [{ text: { content: detail.slice(0, 2000) } }] };
  if (news.url) props['출처'] = { url: news.url };
  return notionReq('POST', '/v1/pages', { parent: { database_id: DB_ISSUE }, properties: props });
}

// ── 날짜 1건 처리 ────────────────────────────────────────────
async function processDate(dateStr) {
  log(`\n── ${dateStr} 처리 시작 ──`);

  // 1) 거래대금DB TOP10 조회
  const stocks = await getTradeTop10(dateStr);
  if (stocks.length === 0) {
    log(`  거래대금DB에 ${dateStr} 데이터 없음 — 스킵`);
    return { archived: 0, created: 0 };
  }
  log(`  거래대금DB TOP${stocks.length}: ${stocks.map(s => s.종목명).join(', ')}`);

  // 2) 뉴스 수집 (병렬)
  log(`  뉴스 수집 중...`);
  const newsMap = {};
  await Promise.all(stocks.map(async s => {
    newsMap[s.종목코드] = await fetchNaverNews(s.종목코드);
  }));
  log(`  뉴스 수집 완료`);

  // 3) Claude AI 분석
  log(`  Claude AI 분석 중 (claude-haiku-4-5)...`);
  const aiMap = await analyzeWithAI(dateStr, stocks, newsMap);
  log(`  AI 분석 완료 (${Object.keys(aiMap).length}건)`);

  if (DRY) {
    log(`  [DRY-RUN] 실제 Notion 처리 생략`);
    for (const s of stocks) {
      const a = aiMap[s.종목코드];
      if (a) log(`    ${s.순위}위 ${s.종목명}: [${a.intensity}] ${a.summary}`);
    }
    return { archived: 0, created: 0 };
  }

  // 4) 기존 이슈DB 항목 아카이브
  const existing = await getExistingIssues(dateStr);
  let archived = 0;
  if (existing.length > 0) {
    log(`  기존 이슈 ${existing.length}건 아카이브 중...`);
    for (const p of existing) {
      try {
        await notionReq('PATCH', `/v1/pages/${p.id}`, { archived: true });
        archived++;
      } catch(e) { log(`    아카이브 오류 ${p.id}: ${e.message}`); }
      await sleep(DELAY);
    }
    log(`  아카이브 완료 ${archived}건`);
  } else {
    log(`  기존 이슈 없음`);
  }

  // 5) 신규 생성
  let created = 0;
  for (const s of stocks) {
    const a = aiMap[s.종목코드] || { intensity: '⚪약함', sectors: ['기타'], trigger: '수급', summary: '' };
    const news = newsMap[s.종목코드] || { titles: [], url: '' };
    try {
      await createIssue(dateStr, s, a, news);
      log(`  ✓ ${s.순위}위 ${s.종목명} [${a.intensity}] — ${a.summary}`);
      created++;
    } catch(e) {
      log(`  ✗ ${s.종목명} 오류: ${e.message}`);
    }
    await sleep(DELAY);
  }

  return { archived, created };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }
  if (!ANTHROPIC_API_KEY) { log('[오류] ANTHROPIC_API_KEY 없음'); process.exit(1); }

  log(`=== 이슈DB 소급 업데이트${DRY ? ' [DRY-RUN]' : ''} ===`);
  log(`대상 날짜: ${DATES.join(', ')}`);

  let totalArchived = 0, totalCreated = 0;
  for (const d of DATES) {
    const { archived, created } = await processDate(d);
    totalArchived += archived;
    totalCreated  += created;
  }

  log(`\n=== 완료 — 아카이브:${totalArchived}건, 신규:${totalCreated}건 ===`);
}

main().catch(e => { console.error('[치명 오류]', e.message); process.exit(1); });
