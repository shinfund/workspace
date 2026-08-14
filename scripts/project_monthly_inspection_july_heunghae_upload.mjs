import fs from 'node:fs';
import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DELAY_MS = 350;
const ONLY = process.argv[2]; // 선택 실행: monthly | elec | transformer | generator | power | task (미지정시 전체)

const DB = {
  monthly: 'a011d12d-ea9e-4cbc-84bf-a8c30621dd69',
  elec1: '8c447abd-4a95-4b07-ba6c-1bdf7c53872f',
  elec2: '1adf636e-efc7-429f-a4b0-fbfa531a5a41',
  elec3: '48bed518-8009-4b24-ad4c-28e30ac12d80',
  transformer: '998fab1e-2d5c-4cae-a6aa-55a131931546',
  gen1: 'c778d924-49a9-4c44-b444-681ebeb166e1',
  gen2: '3a359c8c-9c0a-804f-8857-f1c2cbdeb4af',
  gen3: '19f4f433-846e-4b99-a993-7eeb7c4b1fa8',
  power: '10bfd710-9afb-4b06-b6c2-7943da777956',
  task: '125ebd28-64c9-4a9a-b265-e0ab6ed4f21f',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com', path: endpoint, method,
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(d);
          if (res.statusCode === 429) {
            if (retry >= 3) return reject(new Error('Rate limit exceeded'));
            await sleep(parseInt(res.headers['retry-after'] || '2') * 1000);
            resolve(await notionRequest(method, endpoint, body, retry + 1));
          } else if (res.statusCode >= 400) reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          else resolve(json);
        } catch (e) { reject(new Error(`Parse error: ${d.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function createPage(dbId, props) {
  return notionRequest('POST', '/v1/pages', { parent: { database_id: dbId }, properties: props });
}

const data = JSON.parse(fs.readFileSync('scripts/_tmp_heunghae_july_extracted.json', 'utf8'));
let saved = 0, errors = 0;

async function uploadMonthly() {
  for (const r of data.monthly.matched) {
    const props = {
      '터널명': { select: { name: r['터널명'] } },
      '구분': { select: { name: r['구분'] } },
      '점검내용': { rich_text: [{ text: { content: r['점검내용'] } }] },
      '점검결과': { select: { name: r['점검결과'] } },
      '점검일자': { date: { start: r['점검일자'] } },
      '제목': { title: [{ text: { content: r['제목'] } }] },
    };
    if (r['설비명']) props['설비명'] = { select: { name: r['설비명'] } };
    if (r['비고']) props['비고'] = { rich_text: [{ text: { content: r['비고'] } }] };
    try {
      await createPage(DB.monthly, props);
      saved++; console.log(`완료(월간점검 ${saved}): ${r['구분']}/${r['설비명']}/${r['점검내용']}`);
    } catch (e) { errors++; console.log(`오류(월간점검): ${r['점검내용']} → ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

async function uploadElec() {
  const { elec1, elec2, elec3 } = data.elec;
  const props1 = {
    '터널명': { select: { name: elec1['터널명'] } },
    '설비명(상호)': { select: { name: elec1['설비명(상호)'] } },
    '제목': { title: [{ text: { content: elec1['제목'] } }] },
    '점검일자': { date: { start: elec1['점검일자'] } },
    '점검종별': { select: { name: elec1['점검종별'] } },
    '점검횟수': { rich_text: [{ text: { content: elec1['점검횟수'] } }] },
    '수전전압/용량': { rich_text: [{ text: { content: elec1['수전전압/용량'] } }] },
    '발전전압/용량': { rich_text: [{ text: { content: elec1['발전전압/용량'] } }] },
    '태양광용량': { rich_text: [{ text: { content: elec1['태양광용량'] } }] },
  };
  let parentId;
  try {
    const res = await createPage(DB.elec1, props1);
    parentId = res.id; saved++; console.log('완료(elec1 부모)');
  } catch (e) { errors++; console.log(`오류(elec1): ${e.message}`); return; }
  await sleep(DELAY_MS);

  for (const r of elec2) {
    const props2 = {
      '용도': { select: { name: r['용도'] } },
      '위상': { select: { name: `${r['위상']} (${r['위상']}-${r['위상'] === 'R' ? 'S' : r['위상'] === 'S' ? 'T' : 'R'})` } },
      '점검일자': { date: { start: r['점검일자'] } },
      '역률(%)': { number: r['역률(%)'] },
      '유효전력량(kWh)': { number: r['유효전력량(kWh)'] },
      '무효전력량(kVar)': { rich_text: [{ text: { content: r['무효전력량(kVar)'] } }] },
      '최대전력(kW)': { number: r['최대전력(kW)'] },
      '배율': { number: r['배율'] },
      '제목': { title: [{ text: { content: r['제목'] } }] },
      '전기설비기록1DB': { relation: [{ id: parentId }] },
    };
    if (r['전압(V)'] !== '') props2['전압(V)'] = { number: Number(r['전압(V)']) };
    if (r['전류(A)'] !== '') props2['전류(A)'] = { number: Number(r['전류(A)']) };
    if (r['누설전류(mA)'] !== '') props2['누설전류(mA)'] = { number: Number(r['누설전류(mA)']) };
    try {
      await createPage(DB.elec2, props2);
      saved++; console.log(`완료(elec2 ${r['용도']}/${r['위상']})`);
    } catch (e) { errors++; console.log(`오류(elec2 ${r['용도']}/${r['위상']}): ${e.message}`); }
    await sleep(DELAY_MS);
  }

  for (const r of elec3) {
    const props3 = {
      '터널명': { select: { name: r['터널명'] } },
      '점검일자': { date: { start: r['점검일자'] } },
      '설비구분': { select: { name: r['설비구분'] } },
      '설비항목': { rich_text: [{ text: { content: r['설비항목'] } }] },
      '점검결과판정': { select: { name: r['점검결과판정'] } },
      '점검담당자': { rich_text: [{ text: { content: r['점검담당자'] } }] },
      '점검확인자': { rich_text: [{ text: { content: r['점검확인자'] } }] },
      '종합의견': { rich_text: [{ text: { content: r['종합의견'] } }] },
      '제목': { title: [{ text: { content: r['제목'] } }] },
      '전기설비기록1DB': { relation: [{ id: parentId }] },
    };
    if (r['설비현황(증)'] !== '') props3['설비현황(증)'] = { number: Number(r['설비현황(증)']) };
    if (r['설비현황(감)'] !== '') props3['설비현황(감)'] = { number: Number(r['설비현황(감)']) };
    if (r['부적합수량'] !== '') props3['부적합수량'] = { number: Number(r['부적합수량']) };
    if (r['개수수량'] !== '') props3['개수수량'] = { number: Number(r['개수수량']) };
    try {
      await createPage(DB.elec3, props3);
      saved++; console.log(`완료(elec3 ${r['설비항목']})`);
    } catch (e) { errors++; console.log(`오류(elec3 ${r['설비항목']}): ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

async function uploadTransformer() {
  for (const r of data.transformer) {
    const props = {
      '터널명': { select: { name: r['터널명'] } },
      '측정일자': { date: { start: r['측정일자'] } },
      '점검자': { select: { name: r['점검자'] } },
      '변압기종류': { select: { name: r['변압기종류'] } },
      '용량': { rich_text: [{ text: { content: r['용량'] } }] },
      '측정지점': { rich_text: [{ text: { content: r['측정지점'] } }] },
      '지점번호': { number: r['지점번호'] },
      '온도(℃)': { number: r['온도(℃)'] },
      '비고': { select: { name: r['비고'] } },
      '제목': { title: [{ text: { content: r['제목'] } }] },
    };
    try {
      await createPage(DB.transformer, props);
      saved++; console.log(`완료(변압기온도 ${saved}): ${r['측정지점']}`);
    } catch (e) { errors++; console.log(`오류(변압기온도): ${r['측정지점']} → ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

async function uploadGenerator() {
  const { gen1, gen2, gen3 } = data.generator;
  // gen1.비고는 select 고정옵션(무부하 시운전/부하 시운전/부하운전/감축시험) — 엑셀 원문 표기를 의미상 가장 가까운 옵션으로 매핑
  const REMARK_FIX = { '작동 무부하 시험': '무부하 시운전', '작동 부하 시험': '부하 시운전' };
  const gen1비고 = REMARK_FIX[gen1['비고']] || gen1['비고'];
  let parentId;
  try {
    const props1 = {
      '터널명': { select: { name: gen1['터널명'] } },
      '가동일자': { date: { start: gen1['가동일자'] } },
      '제목': { title: [{ text: { content: gen1['제목'] } }] },
      '점검자': { rich_text: [{ text: { content: gen1['점검자'] } }] },
      '가동시간': { rich_text: [{ text: { content: gen1['가동시간'] } }] },
      '전압(V)': { number: gen1['전압(V)'] },
      '전류(A)': { number: gen1['전류(A)'] },
      '전력(kW)': { number: gen1['전력(kW)'] },
      '주파수(Hz)': { number: gen1['주파수(Hz)'] },
      '역률(%)': { number: gen1['역률(%)'] },
      '가동시간(min)': { number: gen1['가동시간(min)'] },
      '비고': { select: { name: gen1비고 } },
    };
    const res = await createPage(DB.gen1, props1);
    parentId = res.id; saved++; console.log('완료(gen1 부모)');
  } catch (e) { errors++; console.log(`오류(gen1): ${e.message}`); return; }
  await sleep(DELAY_MS);

  try {
    const props2 = {
      '터널명': { select: { name: gen2['터널명'] } },
      '가동일자': { date: { start: gen2['가동일자'] } },
      '제목': { title: [{ text: { content: gen2['제목'] } }] },
      '용량(L)': { number: gen2['용량(L)'] },
      '종류': { rich_text: [{ text: { content: gen2['종류'] } }] },
      '전일재고량(L)': { number: gen2['전일재고량(L)'] },
      '입고량(L)': { number: gen2['입고량(L)'] },
      '사용량(L)': { number: gen2['사용량(L)'] },
      '금일재고량(L)': { number: gen2['금일재고량(L)'] },
      '발전기점검1DB': { relation: [{ id: parentId }] },
    };
    await createPage(DB.gen2, props2);
    saved++; console.log('완료(gen2 유류현황)');
  } catch (e) { errors++; console.log(`오류(gen2): ${e.message}`); }
  await sleep(DELAY_MS);

  for (const item of gen3) {
    try {
      const props3 = {
        '터널명': { select: { name: item['터널명'] } },
        '가동일자': { date: { start: item['가동일자'] } },
        '제목': { title: [{ text: { content: item['제목'] } }] },
        '점검구분': { select: { name: item['점검구분'] } },
        '점검내용': { rich_text: [{ text: { content: item['점검내용'] } }] },
        '결과': { rich_text: [{ text: { content: item['결과'] } }] },
        '발전기점검1DB': { relation: [{ id: parentId }] },
      };
      await createPage(DB.gen3, props3);
      saved++; console.log(`완료(gen3 ${item['점검구분']}/${item['점검내용']})`);
    } catch (e) { errors++; console.log(`오류(gen3 ${item['점검내용']}): ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

async function uploadPower() {
  for (const r of data.power) {
    const props = {
      '터널명': { select: { name: r['터널명'] } },
      '일자': { date: { start: r['일자'] } },
      '제목': { title: [{ text: { content: r['제목'] } }] },
      'MAIN(kWh)': { number: r['MAIN(kWh)'] },
      '조명용(kWh)': { number: r['조명용(kWh)'] },
    };
    if (r['비고']) props['비고'] = { rich_text: [{ text: { content: r['비고'] } }] };
    try {
      await createPage(DB.power, props);
      saved++; console.log(`완료(전력사용량 ${saved}): ${r['일자']}`);
    } catch (e) { errors++; console.log(`오류(전력사용량): ${r['일자']} → ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

async function uploadTask() {
  for (const r of data.task) {
    const props = {
      '터널명': { select: { name: r['터널명'] } },
      '날짜': { date: { start: r['날짜'] } },
      '제목': { title: [{ text: { content: r['제목'] } }] },
      '업무내용': { rich_text: [{ text: { content: r['업무내용'] } }] },
    };
    if (r['조치사항']) props['조치사항'] = { rich_text: [{ text: { content: r['조치사항'] } }] };
    if (r['업체명']) props['업체명'] = { rich_text: [{ text: { content: r['업체명'] } }] };
    if (r['비고']) props['비고'] = { rich_text: [{ text: { content: r['비고'] } }] };
    try {
      await createPage(DB.task, props);
      saved++; console.log(`완료(업무처리 ${saved}): ${r['날짜']} ${r['업무내용']}`);
    } catch (e) { errors++; console.log(`오류(업무처리): ${r['날짜']} ${r['업무내용']} → ${e.message}`); }
    await sleep(DELAY_MS);
  }
}

const STEPS = { monthly: uploadMonthly, elec: uploadElec, transformer: uploadTransformer, generator: uploadGenerator, power: uploadPower, task: uploadTask };
const toRun = ONLY ? [ONLY] : Object.keys(STEPS);
for (const key of toRun) {
  console.log(`\n===== ${key} 업로드 시작 =====`);
  await STEPS[key]();
}
console.log(`\n전체 완료: ${saved}건, 오류: ${errors}건`);
