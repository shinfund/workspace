/**
 * stock_daily_update.mjs — 장마감 후 주식 일간 자동 업데이트
 *
 * Phase 1 [병렬]: KIS 당일 + KRX 20거래일 데이터 수집
 * Phase 2:        거래대금DB 노션 업로드 (보통주 TOP10)
 * Phase 3:        이슈DB 업로드 (거래대금 TOP10 전체)
 *
 * 사용: node stock_daily_update.mjs [--date YYYY-MM-DD] [--dry-run]
 * 스케줄: 평일 15:40 자동 실행
 */

import { spawn, exec } from 'child_process';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 설정 ─────────────────────────────────────────────────────
const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const DB_TRADEAMT    = '36159c8c-9c0a-80fd-a656-daeb46ec25d5';
const DB_ISSUE       = '2136e8ea-20bf-4384-b883-3b15f923afc0';
const LOG_FILE       = 'C:\\Users\\shinf\\Workspace\\logs\\stock_daily_update.log';
const DELAY_MS       = 420;

// ── 인자 파싱 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const dateArgIdx = argv.indexOf('--date');
const todayStr = dateArgIdx >= 0 ? argv[dateArgIdx + 1] : (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
})();

// ── 유틸 ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `${new Date().toTimeString().slice(0,8)} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── Node 스크립트 실행 (stdout → JSON) ──────────────────────
function runScript(name, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, name), ...args], {
      env: { ...process.env }
    });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`${name} exit ${code}: ${err.slice(-400)}`));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error(`${name} JSON 파싱 오류: ${out.slice(0, 300)}`)); }
    });
  });
}

// ── Notion REST API ───────────────────────────────────────────
async function notionReq(method, endpoint, body, retry = 0) {
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
            if (retry >= 3) return reject(new Error('Notion rate limit 초과'));
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

// ── ETF/우선주 필터 ───────────────────────────────────────────
const ETF_RE = /KODEX|TIGER|KBSTAR|ARIRANG|TREX|KOSEF|HANARO|KINDEX|SOL|ACE|WON|IBK|PLUS|HANWHA/i;
function isOrdinary(name, code) {
  if (ETF_RE.test(name)) return false;
  if (/ETF|ETN/i.test(name)) return false;
  if (/우[BC]?$|우b$|우c$/i.test(name)) return false; // 우선주
  if (code && code.slice(-1) === '5') return false;    // 우선주 코드
  return true;
}

// ── 거래대금DB: 오늘 이미 업로드된 종목코드 → pageId 맵 ────
async function getUploadedPages() {
  const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, {
    filter: { property: '날짜', date: { equals: todayStr } },
    page_size: 100
  });
  const map = new Map();
  for (const p of res.results) {
    const code = p.properties['종목코드']?.rich_text?.[0]?.plain_text || '';
    if (code) map.set(code, p.id);
  }
  return map;
}

// ── 거래대금DB: 오늘 순위 11위+ 페이지 아카이브 ─────────────
async function archiveStalePages() {
  const res = await notionReq('POST', `/v1/databases/${DB_TRADEAMT}/query`, {
    filter: {
      and: [
        { property: '날짜', date:   { equals:       todayStr } },
        { property: '순위', number: { greater_than: 10       } }
      ]
    },
    page_size: 100
  });
  const stale = res.results;
  if (stale.length === 0) return 0;
  log(`[Phase 2] 순위 11위↑ 잔재 ${stale.length}건 아카이브...`);
  let archived = 0;
  for (const p of stale) {
    try {
      await notionReq('PATCH', `/v1/pages/${p.id}`, { archived: true });
      archived++;
    } catch(e) {
      log(`  아카이브 오류 ${p.id}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  return archived;
}

// ── 거래대금DB: 종목 1건 업로드 ─────────────────────────────
async function uploadTradeamt(s, rank) {
  const prev = s.등락률 !== 0
    ? Math.round(s.현재가 / (1 + s.등락률 / 100))
    : s.현재가;
  return notionReq('POST', '/v1/pages', {
    parent: { database_id: DB_TRADEAMT },
    properties: {
      '종목명':    { title:     [{ text: { content: s.종목명 } }] },
      '날짜':      { date:      { start: todayStr } },
      '순위':      { number:    rank },
      '종목코드':  { rich_text: [{ text: { content: s.종목코드 } }] },
      '시장':      { rich_text: [{ text: { content: s.시장 } }] },
      '상장주식수':{ number:    s.상장주식수 || 0 },
      '시가':      { number:    s.시가 || 0 },
      '고가':      { number:    s.고가 || 0 },
      '저가':      { number:    s.저가 || 0 },
      '종가':      { number:    s.현재가 },
      '전일종가':  { number:    prev },
      '전일대비':  { number:    s.현재가 - prev },
      '등락률':    { number:    s.등락률 },
      '변동폭':    { number:    (s.고가 || 0) - (s.저가 || 0) },
      '거래량':    { number:    s.거래량 || 0 },
      '거래대금':  { number:    s.거래대금 || 0 },
      '시가총액':  { number:    s.시가총액전일 || 0 },
      '회전율':    { number:    s.회전율 || 0 },
    }
  });
}

// ── 거래대금DB: 기존 레코드 수정 (PATCH) — KRX 우선, KIS fallback ──
async function updateTradeamt(pageId, s, rank, krx) {
  const 종가     = krx ? krx.종가    : s.현재가;
  const 전일종가  = krx ? krx.전일종가
                       : (s.등락률 !== 0 ? Math.round(s.현재가 / (1 + s.등락률 / 100)) : s.현재가);
  const 등락률   = krx ? krx.등락률   : s.등락률;
  const 시가     = krx ? krx.시가    : (s.시가 || 0);
  const 고가     = krx ? krx.고가    : (s.고가 || 0);
  const 저가     = krx ? krx.저가    : (s.저가 || 0);
  return notionReq('PATCH', `/v1/pages/${pageId}`, {
    properties: {
      '순위':      { number: rank },
      '상장주식수':{ number: krx ? krx.상장주식수  : (s.상장주식수 || 0) },
      '시가':      { number: 시가 },
      '고가':      { number: 고가 },
      '저가':      { number: 저가 },
      '종가':      { number: 종가 },
      '전일종가':  { number: 전일종가 },
      '전일대비':  { number: 종가 - 전일종가 },
      '등락률':    { number: 등락률 },
      '변동폭':    { number: 고가 - 저가 },
      '거래량':    { number: krx ? krx.거래량   : (s.거래량 || 0) },
      '거래대금':  { number: krx ? krx.거래대금  : (s.거래대금 || 0) },
      '시가총액':  { number: krx ? krx.시가총액  : (s.시가총액전일 || 0) },
      '회전율':    { number: krx ? krx.회전율   : (s.회전율 || 0) },
    }
  });
}

// ── 이슈 분석 (등락률 기반 규칙) ────────────────────────────
function analyzeIssuesBatch(stocks) {
  return stocks.map(s => {
    const chg = s.등락률 || 0;
    const abs = Math.abs(chg);
    const intensity = abs >= 15 ? '🔴핵심' : abs >= 10 ? '🟠강함' : abs >= 5 ? '🟡보통' : '⚪약함';
    const amt = Math.round((s.거래대금 || 0) / 1e8);
    const label = chg >= 5 ? '급등' : chg <= -5 ? '급락' : chg > 0 ? '상승' : chg < 0 ? '하락' : '보합';
    return {
      종목코드: s.종목코드,
      intensity,
      sectors:  ['기타'],
      trigger:  '수급',
      summary:  `${label} ${abs.toFixed(1)}%, 거래대금 ${amt}억`,
    };
  });
}

// ── 네이버 증권 뉴스 수집 ────────────────────────────────────
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
              .replace(/&hellip;/g, '…').replace(/&middot;/g, '·').replace(/&lsquo;/g, "'")
              .replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
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

// ── 이슈DB: 중복 확인 ─────────────────────────────────────
async function isIssueDup(code) {
  const res = await notionReq('POST', `/v1/databases/${DB_ISSUE}/query`, {
    filter: {
      and: [
        { property: '날짜',    date:      { equals: todayStr } },
        { property: '종목코드', rich_text: { equals: code } }
      ]
    }
  });
  return res.results.length > 0;
}

// ── 이슈DB: 종목 1건 업로드 ──────────────────────────────────
async function uploadIssue(s, analysis, news = { titles: [], url: '' }) {
  const dir = s.등락률 >= 5 ? '급등' : s.등락률 <= -5 ? '급락' : '보합';
  const detail = (news.titles || []).join('. ');
  const props = {
    '종목명':   { title:        [{ text: { content: s.종목명 } }] },
    '날짜':     { date:         { start: todayStr } },
    '종목코드': { rich_text:    [{ text: { content: s.종목코드 } }] },
    '종가':     { number:       s.현재가 },
    '등락률':   { number:       s.등락률 },
    '방향':     { select:       { name: dir } },
    '섹터':     { multi_select: (analysis.sectors || ['기타']).slice(0, 3).map(n => ({ name: n })) },
    '이슈강도': { select:       { name: analysis.intensity || '⚪약함' } },
    '트리거':   { multi_select: [{ name: analysis.trigger   || '기타' }] },
    '이슈요약': { rich_text:    [{ text: { content: (analysis.summary || '').slice(0, 100) } }] },
  };
  if (detail) props['이슈상세'] = { rich_text: [{ text: { content: detail.slice(0, 2000) } }] };
  if (news.url) props['출처'] = { url: news.url };
  return notionReq('POST', '/v1/pages', { parent: { database_id: DB_ISSUE }, properties: props });
}

// ── Windows 트레이 알림 ──────────────────────────────────────
function notifyWindows(title, msg) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$n=[System.Windows.Forms.NotifyIcon]::new();$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;$n.ShowBalloonTip(8000,'${title.replace(/['"]/g,'')}','${msg.replace(/['"]/g,'')}','Info');Start-Sleep -Seconds 9;$n.Dispose()`;
  exec(`powershell -WindowStyle Hidden -Command "${ps}"`, () => {});
}

// ── 메인 ────────────────────────────────────────────────────
async function main() {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  if (!NOTION_TOKEN) { log('[오류] NOTION_TOKEN 환경변수 없음'); process.exit(1); }

  log('');
  log(`====== 주식 일간 업데이트 시작 [${todayStr}]${DRY_RUN ? ' (DRY-RUN)' : ''} ======`);

  // ────── Phase 1: 데이터 수집 (병렬) ──────────────────────
  log('[Phase 1] KIS 당일 + KRX 당일 데이터 수집...');
  let kisRaw, krxDayRaw;
  try {
    [kisRaw, krxDayRaw] = await Promise.all([
      runScript('kis_api.mjs', ['--sort', 'trade', '--top', '30', '--market', 'all']),
      runScript('krx_api.mjs', ['--sort', 'trade', '--market', 'all', '--top', '30']).catch(() => [])
    ]);
  } catch(e) {
    log(`[Phase 1] 오류: ${e.message}`);
    notifyWindows('주식 업데이트 실패', `데이터 수집 오류: ${e.message.slice(0,80)}`);
    process.exit(1);
  }

  // KIS: 배열 정규화 + ETF/우선주 필터
  const kisAll = Array.isArray(kisRaw) ? kisRaw : [];
  const kisFiltered = kisAll.filter(s => isOrdinary(s.종목명, s.종목코드)).slice(0, 10);
  log(`[Phase 1] KIS ${kisAll.length}개 → 보통주 TOP10 ${kisFiltered.length}개`);

  // KRX 당일: 날짜 일치 시에만 사용 (T+1 래그 → 불일치면 빈 맵)
  const krxDayArr = Array.isArray(krxDayRaw) ? krxDayRaw : [];
  const krxDayMatch = krxDayArr.length > 0 && krxDayArr[0].날짜 === todayStr;
  const krxMap = new Map();
  if (krxDayMatch) {
    for (const item of krxDayArr) krxMap.set(item.종목코드, item);
    log(`[Phase 1] KRX 당일 데이터 사용 (${todayStr}, ${krxMap.size}종목)`);
  } else {
    log(`[Phase 1] KRX 당일 데이터 없음 — PATCH 시 KIS fallback`);
  }

  // ────── Phase 2: 거래대금DB 업로드 ───────────────────────
  log('[Phase 2] 거래대금DB 노션 업로드...');
  let tradeOk = 0, tradeUpd = 0, tradeErr = 0;
  if (!DRY_RUN) {
    try {
      const uploaded = await getUploadedPages();
      log(`[Phase 2] 기존 업로드 ${uploaded.size}건`);
      for (let i = 0; i < kisFiltered.length; i++) {
        const s = kisFiltered[i];
        const pageId = uploaded.get(s.종목코드);
        try {
          if (pageId) {
            await updateTradeamt(pageId, s, i + 1, krxMap.get(s.종목코드) || null);
            tradeUpd++;
          } else {
            await uploadTradeamt(s, i + 1);
            tradeOk++;
          }
        } catch(e) {
          log(`  오류 ${s.종목명}: ${e.message}`);
          tradeErr++;
        }
        await sleep(DELAY_MS);
      }
    } catch(e) {
      log(`[Phase 2] 조회 오류: ${e.message}`);
    }
  } else {
    log('[Phase 2] DRY-RUN — 실제 업로드 생략');
  }

  // 순위 11위+ 잔재 삭제
  let tradeArchived = 0;
  if (!DRY_RUN) {
    try {
      tradeArchived = await archiveStalePages();
    } catch(e) {
      log(`[Phase 2] 잔재 삭제 오류: ${e.message}`);
    }
  }
  log(`[Phase 2] 완료 — 신규:${tradeOk} 수정:${tradeUpd} 삭제:${tradeArchived} 오류:${tradeErr}`);

  // ────── Phase 3: 이슈DB 업로드 (거래대금 TOP10 전체) ──────
  log(`[Phase 3] 네이버 뉴스 수집 중 (${kisFiltered.length}종목)...`);
  const newsMap = {};
  await Promise.all(kisFiltered.map(async s => {
    newsMap[s.종목코드] = await fetchNaverNews(s.종목코드);
  }));
  log(`[Phase 3] 뉴스 수집 완료`);

  log(`[Phase 3] 이슈DB 업로드 대상: ${kisFiltered.length}개`);
  const analyses = analyzeIssuesBatch(kisFiltered);
  const aMap = {};
  for (const a of analyses) aMap[a.종목코드] = a;

  let issueOk = 0;
  if (!DRY_RUN) {
    for (const s of kisFiltered) {
      try {
        const dup = await isIssueDup(s.종목코드);
        if (dup) { log(`  이슈 스킵 ${s.종목명} (중복)`); continue; }
        const a = aMap[s.종목코드] || { intensity: '⚪약함', sectors: ['기타'], trigger: '기타', summary: '' };
        const news = newsMap[s.종목코드] || { titles: [], url: '' };
        await uploadIssue(s, a, news);
        log(`  이슈 업로드: ${s.종목명} [${a.intensity}] — ${a.summary} | 뉴스 ${news.titles.length}건`);
        issueOk++;
        await sleep(DELAY_MS);
      } catch(e) {
        log(`  이슈 오류 ${s.종목명}: ${e.message}`);
      }
    }
  } else {
    log('[Phase 3] DRY-RUN — 이슈DB 업로드 생략');
    issueOk = kisFiltered.length;
  }
  log(`[Phase 3] 이슈DB 완료 ${issueOk}건`);

  log(`====== 완료 — 거래대금DB:${tradeOk} 삭제:${tradeArchived} 이슈DB:${issueOk} ======`);
  notifyWindows(
    '주식 일간 업데이트 완료',
    `거래대금${tradeOk}건 | 삭제${tradeArchived}건 | 이슈${issueOk}건`
  );
}

main().catch(e => {
  log(`[치명 오류] ${e.message}\n${e.stack?.slice(0, 500)}`);
  notifyWindows('주식 업데이트 실패', e.message.slice(0, 100));
  process.exit(1);
});
