/**
 * project_elec_facility_cleanup.mjs — 전기시설점검DB 중복 날짜 정리
 *
 * 월별로 구분(자동제어/조명설비/방재설비/관리동설비)이 "터널진입차단설비"의
 * 방문 날짜에도 함께 찍혀 중복 생성된 문제를 정리한다.
 * 터널진입차단설비 레코드는 절대 건드리지 않는다.
 *
 * 실행: node scripts/project_elec_facility_cleanup.mjs           (dry-run, 계획만 출력)
 *       node scripts/project_elec_facility_cleanup.mjs --apply   (실제 archive 실행)
 */
import fs from 'fs';
import path from 'path';
import { notionRequest, sleep, log, initLog, TOKEN } from './notion_upload_lib.mjs';

const DB_ID = '23c03f3d396b46dc8737e0a6c7fdae70'; // 전기시설점검DB
const BARRIER = '터널진입차단설비';

const CHEONGHA = ['청하터널'];
const PAIR_WITH_ADMIN = ['흥해터널', '남정5터널'];
const PAIR_NO_ADMIN_WITH_BARRIER = ['남정4터널', '남정6터널'];
const PAIR_NO_BARRIER = ['남정1·2터널', '남정3터널', '남정7터널', '남정8터널', '남정9터널', '강구1터널', '강구2터널', '강구3터널'];

const OUT_DIR = path.join('C:\\Users\\shinf\\AppData\\Local\\Temp\\claude\\C--users-shinf-workspace\\2ef23ba3-0760-4dbd-bce1-66483a9b57e3\\scratchpad');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchAll() {
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
      records.push({ id: page.id, tunnel, gubun, content, date, month: date.slice(0, 7) });
    }
    hasMore = res.has_more;
    cursor = res.next_cursor;
    log(`  조회 누적 ${records.length}건 (has_more=${hasMore})`);
    if (hasMore) await sleep(300);
  }
  return records;
}

function classify(tunnel) {
  if (CHEONGHA.includes(tunnel)) return 'cheongha';
  if (PAIR_WITH_ADMIN.includes(tunnel)) return 'pair_admin';
  if (PAIR_NO_ADMIN_WITH_BARRIER.includes(tunnel)) return 'pair_no_admin';
  if (PAIR_NO_BARRIER.includes(tunnel)) return 'pair_no_barrier';
  return null; // 대상 아님
}

function buildKeepMap(type, candidateDates) {
  // candidateDates: 오름차순 정렬된 날짜 배열 (터널진입차단설비 날짜 제외)
  const map = {};
  const warnings = [];
  const need = (slotIdx, gubuns, slotLabel) => {
    const d = candidateDates[slotIdx];
    if (!d) {
      warnings.push(`${slotLabel} 날짜 없음(후보 ${candidateDates.length}개) → 해당 구분 삭제 보류`);
      return;
    }
    for (const g of gubuns) map[g] = d;
  };

  if (type === 'cheongha') {
    need(0, ['자동제어'], '1일째');
    need(1, ['조명설비'], '2일째');
    need(2, ['방재설비'], '3일째');
    need(3, ['관리동설비'], '4일째');
  } else if (type === 'pair_admin') {
    need(0, ['자동제어', '조명설비'], '1일째');
    need(1, ['방재설비', '관리동설비'], '2일째');
  } else { // pair_no_admin, pair_no_barrier
    need(0, ['자동제어', '조명설비'], '1일째');
    need(1, ['방재설비'], '2일째');
  }
  return { map, warnings };
}

async function main() {
  const apply = process.argv.includes('--apply');
  initLog(apply ? '전기시설점검DB 정리 [APPLY]' : '전기시설점검DB 정리 [DRY-RUN]');
  if (!TOKEN) { log('[오류] NOTION_TOKEN 없음'); process.exit(1); }

  log('[조회] 전체 레코드 수집 중...');
  const records = await fetchAll();
  log(`[조회] 총 ${records.length}건`);

  // 터널+월 그룹핑
  const groups = new Map(); // key: tunnel|month -> records[]
  for (const r of records) {
    const key = `${r.tunnel}|${r.month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const toDelete = [];
  const toKeep = [];
  const anomalies = [];
  const perTunnelSummary = {};

  for (const [key, recs] of groups) {
    const [tunnel, month] = key.split('|');
    const type = classify(tunnel);

    const barrierDates = [...new Set(recs.filter(r => r.gubun === BARRIER).map(r => r.date))].sort();
    // 터널진입차단설비 레코드는 항상 keep
    for (const r of recs.filter(r => r.gubun === BARRIER)) toKeep.push(r);

    if (!type) {
      // 대상 아님(분류 안 된 터널) — 전부 keep, 이상으로 기록
      for (const r of recs.filter(r => r.gubun !== BARRIER)) toKeep.push(r);
      if (recs.some(r => r.gubun !== BARRIER)) anomalies.push(`미분류 터널: ${tunnel} (${month})`);
      continue;
    }

    const relevantGubuns = type === 'cheongha'
      ? ['자동제어', '조명설비', '방재설비', '관리동설비']
      : type === 'pair_admin'
        ? ['자동제어', '조명설비', '방재설비', '관리동설비']
        : ['자동제어', '조명설비', '방재설비'];

    const relevant = recs.filter(r => relevantGubuns.includes(r.gubun));

    // 규칙: 터널진입차단막 날짜는 차단막 전용 — 그 날짜에 겹치는 다른 구분 레코드는 무조건 삭제
    const onBarrier = relevant.filter(r => barrierDates.includes(r.date));
    const offBarrier = relevant.filter(r => !barrierDates.includes(r.date));
    for (const r of onBarrier) toDelete.push(r);

    // day1/day2(/day3/day4) 선택은 차단막 날짜를 제외한 자체 날짜풀에서
    const candidateDates = [...new Set(offBarrier.map(r => r.date))].sort();

    const { map: keepMap, warnings } = buildKeepMap(type, candidateDates);
    if (warnings.length) {
      anomalies.push(`${tunnel} ${month}: ${warnings.join(', ')} (후보일=${candidateDates.join(',')})`);
    }

    for (const r of offBarrier) {
      const keepDate = keepMap[r.gubun];
      if (keepDate === undefined) {
        // 후보 날짜 자체가 없으면(차단막 아닌 독립 날짜가 없음) 안전하게 보류(삭제 안 함)
        toKeep.push(r);
      } else if (r.date === keepDate) {
        toKeep.push(r);
      } else {
        toDelete.push(r);
      }
    }
  }

  for (const r of toDelete) {
    perTunnelSummary[r.tunnel] = perTunnelSummary[r.tunnel] || { keep: 0, delete: 0 };
    perTunnelSummary[r.tunnel].delete++;
  }
  for (const r of toKeep) {
    perTunnelSummary[r.tunnel] = perTunnelSummary[r.tunnel] || { keep: 0, delete: 0 };
    perTunnelSummary[r.tunnel].keep++;
  }

  log('──────────────────────────────────');
  log('[요약] 터널별 유지/삭제 건수');
  for (const [tunnel, s] of Object.entries(perTunnelSummary).sort()) {
    log(`  ${tunnel}: 유지 ${s.keep}건, 삭제 ${s.delete}건`);
  }
  log(`[합계] 유지 ${toKeep.length}건, 삭제 ${toDelete.length}건, 전체 ${records.length}건`);

  if (anomalies.length) {
    log('──────────────────────────────────');
    log(`[이상 징후] ${anomalies.length}건 (해당 구분/월은 삭제 보류됨)`);
    for (const a of anomalies) log(`  - ${a}`);
  }

  const planPath = path.join(OUT_DIR, 'elec_facility_delete_plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    keepCount: toKeep.length,
    deleteCount: toDelete.length,
    perTunnelSummary,
    anomalies,
    toDelete: toDelete.map(r => ({ id: r.id, tunnel: r.tunnel, date: r.date, gubun: r.gubun, content: r.content })),
  }, null, 2), 'utf8');
  log(`[저장] 삭제 계획 → ${planPath}`);

  if (!apply) {
    log('[DRY-RUN] 실제 삭제는 수행하지 않았습니다. --apply 옵션으로 재실행 시 삭제됩니다.');
    return;
  }

  log('──────────────────────────────────');
  log(`[삭제 시작] ${toDelete.length}건 archive 처리...`);
  let done = 0, errors = 0;
  for (const r of toDelete) {
    try {
      await notionRequest('PATCH', `/v1/pages/${r.id}`, { archived: true });
      done++;
      if (done % 50 === 0) log(`  진행 ${done}/${toDelete.length}`);
      await sleep(120);
    } catch (e) {
      errors++;
      log(`  오류: ${r.id} (${r.tunnel} ${r.date} ${r.gubun}) → ${e.message}`);
    }
  }
  log(`[완료] 삭제 ${done}건, 오류 ${errors}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
