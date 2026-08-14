/**
 * project_elec_facility_reconcile.mjs — 전기시설점검DB 남정4·5·6·흥해·청하터널 정합화
 * 원본 엑셀에서 생성한 target_records.json(정답) 대 노션 라이브 데이터를 비교해
 * 없는 항목은 생성, 불필요한 항목은 archive, 이미 일치하는 항목은 그대로 둔다.
 * 터널진입차단설비 레코드는 절대 건드리지 않는다(조회·비교 대상에서 아예 제외).
 *
 * 실행: node scripts/project_elec_facility_reconcile.mjs           (dry-run)
 *       node scripts/project_elec_facility_reconcile.mjs --apply   (실제 반영)
 */
import fs from 'fs';
import path from 'path';
import { notionRequest, sleep, log, initLog, TOKEN } from './notion_upload_lib.mjs';

const DB_ID = '23c03f3d396b46dc8737e0a6c7fdae70';
const DATA_SOURCE_ID = '2f559c8c-9c0a-80ef-aefd-000b54cc9608'; // (unused placeholder, real one below)
const TARGET_TUNNELS = ['남정4터널', '남정5터널', '남정6터널', '흥해터널', '청하터널'];
const BARRIER = '터널진입차단설비';
const OUT_DIR = 'C:\\Users\\shinf\\AppData\\Local\\Temp\\claude\\C--users-shinf-workspace\\2ef23ba3-0760-4dbd-bce1-66483a9b57e3\\scratchpad';

function keyOf(r) {
  return `${r.tunnel}|${r.date}|${r.gubun}|${r.content}`;
}

async function fetchLive() {
  const records = [];
  let hasMore = true, cursor;
  while (hasMore) {
    const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results) {
      const p = page.properties;
      const tunnel = p['터널명']?.select?.name ?? null;
      const gubun = p['구분']?.select?.name ?? null;
      const content = p['점검내용']?.rich_text?.[0]?.plain_text ?? '';
      const date = p['날짜']?.date?.start ?? null;
      if (!tunnel || !gubun || !date) continue;
      if (!TARGET_TUNNELS.includes(tunnel)) continue;
      if (gubun === BARRIER) continue;
      records.push({ id: page.id, tunnel, gubun, content, date });
    }
    hasMore = res.has_more;
    cursor = res.next_cursor;
    if (hasMore) await sleep(300);
  }
  return records;
}

async function main() {
  const apply = process.argv.includes('--apply');
  initLog(apply ? '전기시설점검DB 정합화 [APPLY]' : '전기시설점검DB 정합화 [DRY-RUN]');
  if (!TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }

  const target = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'target_records.json'), 'utf8'));
  log(`[목표] 엑셀 기준 정답 ${target.length}건`);

  log('[조회] 노션 라이브 데이터 수집 중...');
  const live = await fetchLive();
  log(`[조회] 라이브 ${live.length}건 (5개 터널, 터널진입차단설비 제외)`);

  const targetKeys = new Map(); // key -> count needed
  for (const r of target) {
    const k = keyOf(r);
    targetKeys.set(k, (targetKeys.get(k) || 0) + 1);
  }
  const liveByKey = new Map(); // key -> [records]
  for (const r of live) {
    const k = keyOf(r);
    if (!liveByKey.has(k)) liveByKey.set(k, []);
    liveByKey.get(k).push(r);
  }

  const toDelete = [];
  const toCreate = [];
  const untouched = [];

  // 1) live 레코드 중 target에 없는(또는 초과분) 것 -> 삭제
  for (const [k, recs] of liveByKey) {
    const need = targetKeys.get(k) || 0;
    const keep = recs.slice(0, need);
    const extra = recs.slice(need);
    untouched.push(...keep);
    toDelete.push(...extra);
  }

  // 2) target에는 있는데 live에 없는(부족분) -> 생성
  for (const [k, need] of targetKeys) {
    const have = (liveByKey.get(k) || []).length;
    if (have < need) {
      const [tunnel, date, gubun, ...contentParts] = k.split('|');
      const content = contentParts.join('|');
      for (let i = 0; i < need - have; i++) {
        toCreate.push({ tunnel, date, gubun, content });
      }
    }
  }

  const perTunnel = {};
  for (const r of toDelete) { perTunnel[r.tunnel] = perTunnel[r.tunnel] || { delete: 0, create: 0, keep: 0 }; perTunnel[r.tunnel].delete++; }
  for (const r of toCreate) { perTunnel[r.tunnel] = perTunnel[r.tunnel] || { delete: 0, create: 0, keep: 0 }; perTunnel[r.tunnel].create++; }
  for (const r of untouched) { perTunnel[r.tunnel] = perTunnel[r.tunnel] || { delete: 0, create: 0, keep: 0 }; perTunnel[r.tunnel].keep++; }

  log('──────────────────────────────────');
  log('[요약] 터널별 유지/생성/삭제');
  for (const [t, s] of Object.entries(perTunnel).sort()) {
    log(`  ${t}: 유지 ${s.keep}, 생성 ${s.create}, 삭제 ${s.delete}`);
  }
  log(`[합계] 유지 ${untouched.length}, 생성 ${toCreate.length}, 삭제 ${toDelete.length}`);

  const planPath = path.join(OUT_DIR, 'elec_facility_reconcile_plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    perTunnel,
    toDelete: toDelete.map(r => ({ id: r.id, tunnel: r.tunnel, date: r.date, gubun: r.gubun, content: r.content })),
    toCreate,
  }, null, 2), 'utf8');
  log(`[저장] 계획 → ${planPath}`);

  if (!apply) {
    log('[DRY-RUN] 실제 반영은 수행하지 않았습니다. --apply 로 재실행 시 반영됩니다.');
    return;
  }

  // 관계형(터널명 select, 구분 select)이라 create시 select 값만 넣으면 됨
  log('──────────────────────────────────');
  log(`[삭제 시작] ${toDelete.length}건`);
  let delDone = 0, delErr = 0;
  for (const r of toDelete) {
    try {
      await notionRequest('PATCH', `/v1/pages/${r.id}`, { archived: true });
      delDone++;
      if (delDone % 50 === 0) log(`  삭제 진행 ${delDone}/${toDelete.length}`);
      await sleep(120);
    } catch (e) {
      delErr++;
      log(`  삭제 오류: ${r.id} → ${e.message}`);
    }
  }
  log(`[삭제 완료] ${delDone}건, 오류 ${delErr}건`);

  log(`[생성 시작] ${toCreate.length}건`);
  let createDone = 0, createErr = 0;
  for (const r of toCreate) {
    try {
      const monthNum = parseInt(r.date.slice(5, 7), 10);
      const reportTitle = `2026년 ${monthNum}월 터널전기시설점검표`;
      const props = {
        '제목': { title: [{ text: { content: reportTitle } }] },
        '터널명': { select: { name: r.tunnel } },
        '구분': { select: { name: r.gubun } },
        '점검내용': { rich_text: [{ text: { content: r.content } }] },
        '날짜': { date: { start: r.date } },
        '점검결과': { select: { name: '양호' } },
      };
      await notionRequest('POST', '/v1/pages', { parent: { database_id: DB_ID }, properties: props });
      createDone++;
      if (createDone % 50 === 0) log(`  생성 진행 ${createDone}/${toCreate.length}`);
      await sleep(120);
    } catch (e) {
      createErr++;
      log(`  생성 오류: ${r.tunnel} ${r.date} ${r.gubun} ${r.content} → ${e.message}`);
    }
  }
  log(`[생성 완료] ${createDone}건, 오류 ${createErr}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
