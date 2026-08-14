/**
 * project_elec_barrier_cleanup.mjs — 터널진입차단설비 확정 점검일자 외 삭제
 */
import { notionRequest, sleep, log, initLog, TOKEN } from './notion_upload_lib.mjs';

const DB_ID = '23c03f3d396b46dc8737e0a6c7fdae70';
const TARGET_TUNNELS = ['남정4터널', '남정5터널', '남정6터널', '흥해터널', '청하터널'];
const BARRIER = '터널진입차단설비';
const CONFIRMED = {
  '2026-01': ['2026-01-14'],
  '2026-02': ['2026-02-10'],
  '2026-03': ['2026-03-10', '2026-03-25'],
  '2026-04': ['2026-04-07', '2026-04-20'],
  '2026-05': ['2026-05-07', '2026-05-20'],
  '2026-06': ['2026-06-09', '2026-06-23'],
};

async function fetchBarrier() {
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
      if (gubun !== BARRIER) continue;
      records.push({ id: page.id, tunnel, content, date });
    }
    hasMore = res.has_more;
    cursor = res.next_cursor;
    if (hasMore) await sleep(300);
  }
  return records;
}

async function main() {
  const apply = process.argv.includes('--apply');
  initLog(apply ? '터널진입차단설비 정리 [APPLY]' : '터널진입차단설비 정리 [DRY-RUN]');
  if (!TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }

  log('[조회] 터널진입차단설비 전체 수집 중...');
  const all = await fetchBarrier();
  log(`[조회] ${all.length}건`);

  const toDelete = [];
  const toKeep = [];
  for (const r of all) {
    const month = r.date.slice(0, 7);
    const confirmedDates = CONFIRMED[month] || [];
    if (confirmedDates.includes(r.date)) toKeep.push(r);
    else toDelete.push(r);
  }

  const perTunnel = {};
  for (const r of toDelete) { perTunnel[r.tunnel] = perTunnel[r.tunnel] || { keep: 0, delete: 0 }; perTunnel[r.tunnel].delete++; }
  for (const r of toKeep) { perTunnel[r.tunnel] = perTunnel[r.tunnel] || { keep: 0, delete: 0 }; perTunnel[r.tunnel].keep++; }

  log('──────────────────────────────────');
  for (const [t, s] of Object.entries(perTunnel).sort()) {
    log(`  ${t}: 유지 ${s.keep}, 삭제 ${s.delete}`);
  }
  log(`[합계] 유지 ${toKeep.length}, 삭제 ${toDelete.length}`);

  if (!apply) {
    log('[DRY-RUN] --apply 로 재실행 시 삭제됩니다.');
    return;
  }

  log(`[삭제 시작] ${toDelete.length}건`);
  let done = 0, err = 0;
  for (const r of toDelete) {
    try {
      await notionRequest('PATCH', `/v1/pages/${r.id}`, { archived: true });
      done++;
      if (done % 50 === 0) log(`  진행 ${done}/${toDelete.length}`);
      await sleep(120);
    } catch (e) {
      err++;
      log(`  오류: ${r.id} → ${e.message}`);
    }
  }
  log(`[완료] 삭제 ${done}건, 오류 ${err}건`);
}
main().catch(e => { console.error(e); process.exit(1); });
