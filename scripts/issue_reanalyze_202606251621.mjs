/**
 * issue_reanalyze_202606251621.mjs — 6/25 이슈DB 전체 재분석
 * 수정 사항: Buffer.concat 인코딩 버그 수정 + max_tokens 5000
 */

import https from 'https';

const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DB_TRADEAMT = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const DB_ISSUE    = '2136e8ea-20bf-4384-b883-3b15f923afc0';
const DATE        = '2026-06-25';
const DELAY       = 420;
const DRY         = process.argv.includes('--dry-run');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = msg => console.log(`${new Date().toTimeString().slice(0,8)} ${msg}`);

// ── Notion REST ───────────────────────────────────────────────
function notionReq(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: endpoint, method,
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          const d = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit 초과'));
            await sleep((parseInt(res.headers['retry-after'] || '2') * 1000) + 500);
            resolve(await notionReq(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message || ''}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Notion 파싱 오류`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Claude API (Buffer.concat 인코딩 수정) ───────────────────
function claudeReq(messages, system) {
  const body = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 5000, system, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error(`Claude ${res.statusCode}: ${json.error?.message}`));
          else resolve(json);
        } catch(e) { reject(new Error('Claude 파싱 오류')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(); reject(new Error('Claude 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── 네이버 뉴스 ──────────────────────────────────────────────
function fetchNews(code) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'finance.naver.com',
      path: `/item/news_news.naver?code=${code}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com/' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let html;
        try { html = new TextDecoder('euc-kr').decode(Buffer.concat(chunks)); }
        catch { html = Buffer.concat(chunks).toString('utf8'); }
        const titles = [];
        const re = /class="title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]{5,100})<\/a>/g;
        let m, firstUrl = '';
        while ((m = re.exec(html)) !== null && titles.length < 3) {
          const t = m[2].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
            .replace(/&hellip;/g,'…').replace(/&middot;/g,'·').trim();
          const url = 'https://finance.naver.com' + m[1].split('&sm=')[0];
          if (!firstUrl) firstUrl = url;
          titles.push(t);
        }
        resolve({ titles, url: firstUrl });
      });
    });
    req.on('error', () => resolve({ titles: [], url: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ titles: [], url: '' }); });
    req.end();
  });
}

// ── JSON 내 literal 줄바꿈 제거 ──────────────────────────────
function fixJsonNewlines(str) {
  let result = '', inString = false, escaped = false;
  for (const ch of str) {
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { result += ch; inString = !inString; continue; }
    if (inString && (ch === '\n' || ch === '\r')) { result += ' '; continue; }
    result += ch;
  }
  return result;
}

// ── 거래대금DB에서 날짜 TOP10 조회 ──────────────────────────
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
  "detail": "뉴스·시황을 바탕으로 거래 원인과 주요 이슈를 구체적으로 400자 이내 서술. 수치(거래대금 등)는 위 데이터 기준으로만 작성"
}

출력 규칙: JSON 배열만, compact 한 줄 형식. 마크다운 금지. 줄바꿈 금지.`;

  const res = await claudeReq(
    [{ role: 'user', content: prompt }],
    '당신은 한국 주식시장 전문 애널리스트입니다. 종목 데이터와 뉴스를 분석하여 투자자에게 유용한 인사이트를 제공합니다. 수치는 제공된 데이터만 사용하고 추측하지 마십시오.'
  );

  const raw = res.content?.[0]?.text || '';
  const stripped = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('[');
  const end   = stripped.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`JSON 배열 없음: ${raw.slice(0,200)}`);
  let jsonStr = fixJsonNewlines(stripped.slice(start, end + 1));
  jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
  const results = JSON.parse(jsonStr);

  const map = {};
  for (const a of results) map[a.종목코드] = a;
  return map;
}

// ── 이슈DB 1건 생성 ─────────────────────────────────────────
async function createIssue(s, analysis, news) {
  const dir = s.등락률 >= 5 ? '급등' : s.등락률 <= -5 ? '급락' : '보합';
  const detail = analysis.detail || (news.titles || []).join('. ');
  const props = {
    '종목명':   { title:        [{ text: { content: s.종목명 } }] },
    '날짜':     { date:         { start: DATE } },
    '종목코드': { rich_text:    [{ text: { content: s.종목코드 } }] },
    '종가':     { number:       s.현재가 },
    '등락률':   { number:       s.등락률 },
    '방향':     { select:       { name: dir } },
    '섹터':     { multi_select: (analysis.sectors || ['기타']).slice(0,3).map(n => ({ name: n })) },
    '이슈강도': { select:       { name: analysis.intensity || '⚪약함' } },
    '트리거':   { multi_select: [{ name: analysis.trigger || '기타' }] },
    '이슈요약': { rich_text:    [{ text: { content: (analysis.summary || '').slice(0, 100) } }] },
  };
  if (detail) props['이슈상세'] = { rich_text: [{ text: { content: detail.slice(0, 2000) } }] };
  if (news.url) props['출처'] = { url: news.url };
  return notionReq('POST', '/v1/pages', { parent: { database_id: DB_ISSUE }, properties: props });
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN)      { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }
  if (!ANTHROPIC_API_KEY) { log('[오류] ANTHROPIC_API_KEY 없음'); process.exit(1); }

  log(`=== ${DATE} 이슈DB 재분석${DRY ? ' [DRY-RUN]' : ''} ===`);

  // 1) 거래대금DB TOP10 조회
  const stocks = await getTradeTop10(DATE);
  log(`거래대금DB TOP${stocks.length}: ${stocks.map(s=>`${s.순위}위 ${s.종목명}(${s.등락률>0?'+':''}${s.등락률}%)`).join(', ')}`);

  // 2) 뉴스 수집
  log('뉴스 수집 중...');
  const newsMap = {};
  await Promise.all(stocks.map(async s => { newsMap[s.종목코드] = await fetchNews(s.종목코드); }));
  log('뉴스 수집 완료');

  // 3) Claude AI 분석
  log('Claude AI 분석 중 (max_tokens: 5000)...');
  const aiMap = await analyzeWithAI(DATE, stocks, newsMap);
  log(`AI 분석 완료 (${Object.keys(aiMap).length}건)`);

  if (DRY) {
    for (const s of stocks) {
      const a = aiMap[s.종목코드];
      if (a) log(`  ${s.순위}위 ${s.종목명}: [${a.intensity}] ${a.summary}`);
      else   log(`  ${s.순위}위 ${s.종목명}: ⚠️ AI 누락 (fallback)`);
    }
    return;
  }

  // 4) 기존 이슈DB 아카이브
  const existing = await notionReq('POST', `/v1/databases/${DB_ISSUE}/query`, {
    filter: { property: '날짜', date: { equals: DATE } }, page_size: 30
  });
  log(`기존 이슈 ${existing.results.length}건 아카이브 중...`);
  for (const p of existing.results) {
    try { await notionReq('PATCH', `/v1/pages/${p.id}`, { archived: true }); }
    catch(e) { log(`  아카이브 오류: ${e.message}`); }
    await sleep(DELAY);
  }
  log(`아카이브 완료`);

  // 5) 신규 생성
  let ok = 0;
  for (const s of stocks) {
    const a = aiMap[s.종목코드] || { intensity: '⚪약함', sectors: ['기타'], trigger: '수급', summary: `${s.등락률>0?'상승':'하락'} ${Math.abs(s.등락률).toFixed(1)}%`, detail: '' };
    const news = newsMap[s.종목코드] || { titles: [], url: '' };
    try {
      await createIssue(s, a, news);
      log(`  ✓ ${s.순위}위 ${s.종목명} [${a.intensity}] — ${a.summary}`);
      ok++;
    } catch(e) { log(`  ✗ ${s.종목명}: ${e.message}`); }
    await sleep(DELAY);
  }

  log(`\n=== 완료 — ${ok}건 업로드 ===`);
}

main().catch(e => { console.error('[오류]', e.message); process.exit(1); });
