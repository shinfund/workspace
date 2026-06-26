/**
 * issue_retrofix_202606260926.mjs
 * 2026-06-01 ~ 2026-06-25 이슈DB 소급 업데이트 (개선된 분석)
 *
 * 처리 순서 (날짜별):
 *   1) 거래대금DB TOP10 조회
 *   2) 네이버 증권 뉴스 수집 (병렬)
 *   3) Haiku 배치 1차 분석 → 핵심/강함 Sonnet 심층 분석
 *   4) 기존 이슈 아카이브
 *   5) 신규 이슈 생성 (분석모델 컬럼 포함)
 *
 * Usage: node scripts/issue_retrofix_202606260926.mjs [--dry-run] [--from YYYY-MM-DD]
 */

import https from 'https';

const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const ANTHROPIC_API_KEY = process.env.MY_ANTHROPIC_API_KEY;
const DB_TRADEAMT = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const DB_ISSUE    = '2136e8ea-20bf-4384-b883-3b15f923afc0';
const DELAY       = 420;
const DRY         = process.argv.includes('--dry-run');

// 거래대금DB 데이터 확인된 6월 거래일 (18일)
const ALL_DATES = [
  '2026-06-01', '2026-06-02', '2026-06-04', '2026-06-05',
  '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12',
  '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
  '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25',
];

// --from 옵션으로 시작 날짜 지정 가능 (재시작 용)
const fromArg = (() => {
  const i = process.argv.indexOf('--from');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const DATES = fromArg ? ALL_DATES.filter(d => d >= fromArg) : ALL_DATES;

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
            reject(new Error(`Notion ${res.statusCode}: ${json.message || d.slice(0,200)}`));
          } else resolve(json);
        } catch(e) { reject(new Error(`Notion 파싱 오류: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── JSON strings 내 literal 줄바꿈 제거 ──────────────────────
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

function parseClaudeJsonArray(raw) {
  const stripped = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('[');
  const end   = stripped.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('JSON 배열 없음');
  let jsonStr = fixJsonNewlines(stripped.slice(start, end + 1));
  jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
  return JSON.parse(jsonStr);
}

// ── Claude API ────────────────────────────────────────────────
function claudeReq(messages, system, maxTokens = 5000, model = 'claude-haiku-4-5') {
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages });
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
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

const ANALYST_SYSTEM = '당신은 한국 주식시장 전문 애널리스트입니다. 종목 데이터와 뉴스를 분석하여 투자자에게 유용한 인사이트를 제공합니다. 수치는 제공된 데이터만 사용하고 추측하지 마십시오.';

// ── 규칙 기반 fallback ────────────────────────────────────────
function ruleBasedAnalysis(stocks) {
  return stocks.map(s => {
    const chg = s.등락률 || 0, abs = Math.abs(chg);
    const intensity = abs >= 15 ? '🔴핵심' : abs >= 10 ? '🟠강함' : abs >= 5 ? '🟡보통' : '⚪약함';
    const label = chg >= 5 ? '급등' : chg <= -5 ? '급락' : chg > 0 ? '상승' : chg < 0 ? '하락' : '보합';
    return {
      종목코드: s.종목코드, intensity, sectors: ['기타'], trigger: '수급',
      summary: `${label} ${abs.toFixed(1)}%, 거래대금 ${Math.round((s.거래대금||0)/1e8)}억`,
      detail: '', model: '규칙기반',
    };
  });
}

// ── Claude 분석 (Haiku 배치 → 핵심/강함 Sonnet) ──────────────
async function analyzeIssues(dateStr, stocks, newsMap) {
  if (!ANTHROPIC_API_KEY) return ruleBasedAnalysis(stocks);

  const stockList = stocks.map(s => ({
    종목코드: s.종목코드, 종목명: s.종목명,
    등락률: s.등락률 || 0,
    거래대금억: Math.round((s.거래대금 || 0) / 1e8),
    뉴스: (newsMap[s.종목코드]?.titles || []).slice(0, 3),
  }));

  // Step 1: Haiku 배치
  const batchPrompt = `${dateStr} 한국 주식시장 거래대금 상위 종목입니다. 각 종목을 분석하여 JSON 배열만 반환하세요.

${JSON.stringify(stockList, null, 2)}

각 종목 객체 형식:
{
  "종목코드": "그대로",
  "intensity": "🔴핵심|🟠강함|🟡보통|⚪약함 (등락률 절댓값: 15%↑=핵심, 10%↑=강함, 5%↑=보통, 미만=약함)",
  "sectors": ["섹터"] (반도체/IT/바이오/금융/에너지/소비재/통신/자동차/화학/건설/철강/기타 중 1~3개),
  "trigger": "실적|수급|테마|공시|외인|기관|재료|차익|기술적 중 하나",
  "summary": "핵심 이슈 80자 이내",
  "detail": "해당 종목만 분석. 첫 문장에 반드시 '등락률 +X.XX%, 거래대금 X,XXX억원' 수치 표기. 뉴스·시황 기반 거래 원인과 주요 이슈 서술. 400자 이내."
}

출력 규칙: JSON 배열만, compact 한 줄. 마크다운 금지. 줄바꿈 금지.`;

  let aiMap = {};
  try {
    const res = await claudeReq([{ role: 'user', content: batchPrompt }], ANALYST_SYSTEM, 5000, 'claude-haiku-4-5');
    const arr = parseClaudeJsonArray(res.content?.[0]?.text || '');
    for (const a of arr) aiMap[a.종목코드] = { ...a, model: 'Haiku' };
    log(`  Haiku 배치 완료 (${arr.length}건)`);
  } catch(e) {
    log(`  Haiku 오류: ${e.message} → 규칙 기반 대체`);
    return ruleBasedAnalysis(stocks);
  }

  // Step 2: 핵심/강함 → Sonnet 심층
  const highTier = stocks.filter(s => {
    const r = aiMap[s.종목코드];
    return r && (r.intensity === '🔴핵심' || r.intensity === '🟠강함');
  });

  if (highTier.length > 0) {
    log(`  Sonnet 심층 분석: ${highTier.map(s => s.종목명).join(', ')}`);
    for (const s of highTier) {
      const news = newsMap[s.종목코드] || { titles: [] };
      const prev = aiMap[s.종목코드];
      const deepPrompt = `다음 종목을 심층 분석해주세요. (기준일: ${dateStr})

종목: ${s.종목명} (${s.종목코드}) | 등락률: ${s.등락률 >= 0 ? '+' : ''}${s.등락률}% | 거래대금: ${Math.round((s.거래대금||0)/1e8).toLocaleString()}억원
섹터: ${(prev.sectors||[]).join(', ')} | 트리거: ${prev.trigger || ''} | 강도: ${prev.intensity || ''}
뉴스: ${news.titles.slice(0,3).join(' / ') || '없음'}

JSON 1개 객체만 반환하세요:
{
  "종목코드": "${s.종목코드}",
  "intensity": "${prev.intensity}",
  "sectors": ${JSON.stringify(prev.sectors || [])},
  "trigger": "실적|수급|테마|공시|외인|기관|재료|차익|기술적 중 하나",
  "summary": "핵심 이슈 80자 이내",
  "detail": "첫 문장에 반드시 '등락률 +X.XX%, 거래대금 X,XXX억원' 수치 표기. 뉴스·시황 기반 거래 원인과 주요 이슈 상세 서술. 향후 모니터링 포인트 1~2가지 포함. 800자 이내."
}

출력 규칙: JSON 객체 1개만. 마크다운 금지. 줄바꿈 금지.`;
      try {
        const res = await claudeReq([{ role: 'user', content: deepPrompt }], ANALYST_SYSTEM, 2000, 'claude-sonnet-4-6');
        const raw = res.content?.[0]?.text || '';
        const stripped = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
        const start = stripped.indexOf('{'), end = stripped.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          const obj = JSON.parse(fixJsonNewlines(stripped.slice(start, end + 1)));
          aiMap[s.종목코드] = { ...obj, model: 'Sonnet' };
          log(`    [Sonnet] ${s.종목명} 완료`);
        }
      } catch(e) {
        log(`    [Sonnet] ${s.종목명} 실패: ${e.message}`);
      }
      await sleep(500);
    }
  }

  return stocks.map(s => aiMap[s.종목코드] || ruleBasedAnalysis([s])[0]);
}

// ── 네이버 뉴스 ──────────────────────────────────────────────
function fetchNaverNews(code) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'finance.naver.com',
      path: `/item/news_news.naver?code=${code}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://finance.naver.com/' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let html;
        try { html = new TextDecoder('euc-kr').decode(Buffer.concat(chunks)); }
        catch { html = Buffer.concat(chunks).toString('utf8'); }
        const titles = [], re = /class="title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]{5,100})<\/a>/g;
        let m, firstUrl = '';
        while ((m = re.exec(html)) !== null && titles.length < 3) {
          const t = m[2]
            .replace(/&hellip;/g,'…').replace(/&middot;/g,'·').replace(/&amp;/g,'&')
            .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
            .replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
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

// ── 거래대금DB TOP10 조회 ────────────────────────────────────
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

// ── 이슈 1건 생성 ─────────────────────────────────────────────
async function createIssue(dateStr, s, analysis, news) {
  const dir = s.등락률 >= 5 ? '급등' : s.등락률 <= -5 ? '급락' : '보합';
  const detail = analysis.detail || (news.titles || []).join('. ');
  const modelName = analysis.model === 'Sonnet' ? 'Sonnet' : analysis.model === '규칙기반' ? '규칙기반' : 'Haiku';
  const props = {
    '종목명':   { title:        [{ text: { content: s.종목명 } }] },
    '날짜':     { date:         { start: dateStr } },
    '종목코드': { rich_text:    [{ text: { content: s.종목코드 } }] },
    '종가':     { number:       s.현재가 },
    '등락률':   { number:       s.등락률 },
    '방향':     { select:       { name: dir } },
    '섹터':     { multi_select: (analysis.sectors || ['기타']).slice(0, 3).map(n => ({ name: n })) },
    '이슈강도': { select:       { name: analysis.intensity || '⚪약함' } },
    '트리거':   { multi_select: [{ name: analysis.trigger || '기타' }] },
    '이슈요약': { rich_text:    [{ text: { content: (analysis.summary || '').slice(0, 100) } }] },
    '분석모델': { select:       { name: modelName } },
  };
  if (detail) props['이슈상세'] = { rich_text: [{ text: { content: detail.slice(0, 2000) } }] };
  if (news.url) props['출처'] = { url: news.url };
  return notionReq('POST', '/v1/pages', { parent: { database_id: DB_ISSUE }, properties: props });
}

// ── 날짜 1건 처리 ─────────────────────────────────────────────
async function processDate(dateStr, idx, total) {
  log(`\n── [${idx}/${total}] ${dateStr} 처리 시작 ──`);

  const stocks = await getTradeTop10(dateStr);
  if (stocks.length === 0) {
    log(`  거래대금DB 데이터 없음 — 스킵`);
    return { archived: 0, created: 0 };
  }
  log(`  TOP${stocks.length}: ${stocks.map(s => `${s.순위}위 ${s.종목명}(${s.등락률 > 0 ? '+' : ''}${s.등락률}%)`).join(', ')}`);

  // 뉴스 수집 (병렬)
  const newsMap = {};
  await Promise.all(stocks.map(async s => { newsMap[s.종목코드] = await fetchNaverNews(s.종목코드); }));
  log(`  뉴스 수집 완료 (${stocks.filter(s => newsMap[s.종목코드]?.titles?.length > 0).length}종목)`);

  // AI 분석
  const analyses = await analyzeIssues(dateStr, stocks, newsMap);
  const aMap = {};
  for (const a of analyses) aMap[a.종목코드] = a;

  if (DRY) {
    log(`  [DRY-RUN] 생략`);
    for (const s of stocks) {
      const a = aMap[s.종목코드];
      if (a) log(`    ${s.순위}위 ${s.종목명}: [${a.intensity}/${a.model}] ${a.summary}`);
    }
    return { archived: 0, created: 0 };
  }

  // 기존 이슈 아카이브
  const existing = await getExistingIssues(dateStr);
  let archived = 0;
  if (existing.length > 0) {
    log(`  기존 이슈 ${existing.length}건 아카이브...`);
    for (const p of existing) {
      try { await notionReq('PATCH', `/v1/pages/${p.id}`, { archived: true }); archived++; }
      catch(e) { log(`    아카이브 오류: ${e.message}`); }
      await sleep(DELAY);
    }
  }

  // 신규 생성
  let created = 0;
  for (const s of stocks) {
    const a = aMap[s.종목코드] || { intensity: '⚪약함', sectors: ['기타'], trigger: '수급', summary: '', model: '규칙기반' };
    const news = newsMap[s.종목코드] || { titles: [], url: '' };
    try {
      await createIssue(dateStr, s, a, news);
      log(`  ✓ ${s.순위}위 ${s.종목명} [${a.intensity}/${a.model}] — ${a.summary}`);
      created++;
    } catch(e) {
      log(`  ✗ ${s.종목명}: ${e.message}`);
    }
    await sleep(DELAY);
  }

  return { archived, created };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!NOTION_TOKEN)      { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }
  if (!ANTHROPIC_API_KEY) { log('[오류] MY_ANTHROPIC_API_KEY 없음'); process.exit(1); }

  log(`=== 이슈DB 소급 업데이트${DRY ? ' [DRY-RUN]' : ''} ===`);
  log(`대상: ${DATES.length}일 (${DATES[0]} ~ ${DATES[DATES.length - 1]})`);
  if (fromArg) log(`(--from ${fromArg} 이후만 처리)`);

  let totalArchived = 0, totalCreated = 0;
  for (let i = 0; i < DATES.length; i++) {
    try {
      const { archived, created } = await processDate(DATES[i], i + 1, DATES.length);
      totalArchived += archived;
      totalCreated  += created;
    } catch(e) {
      log(`  [오류] ${DATES[i]}: ${e.message} — 다음 날짜로 진행`);
    }
  }

  log(`\n=== 완료 — 아카이브: ${totalArchived}건, 신규: ${totalCreated}건 ===`);
}

main().catch(e => { console.error('[치명 오류]', e.message); process.exit(1); });
