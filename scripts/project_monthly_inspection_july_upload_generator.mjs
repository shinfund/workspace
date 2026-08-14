import fs from 'node:fs';
import https from 'node:https';

const TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const DB_GEN1 = 'c778d924-49a9-4c44-b444-681ebeb166e1';
const DB_GEN2 = '3a359c8c-9c0a-804f-8857-f1c2cbdeb4af';
const DB_GEN3 = '19f4f433-846e-4b99-a993-7eeb7c4b1fa8';
const DELAY_MS = 350;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notionRequest(method, endpoint, body, retry = 0) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.notion.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
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
          } else if (res.statusCode >= 400) {
            reject(new Error(`Notion ${res.statusCode}: ${json.message}`));
          } else {
            resolve(json);
          }
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

const data = JSON.parse(fs.readFileSync('scripts/_tmp_generator_july_extracted.json', 'utf8'));

let saved = 0, errors = 0;

for (const tunnel of Object.keys(data)) {
  const { gen1, gen2, gen3 } = data[tunnel];

  // gen1(부모)
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
      '비고': { select: { name: gen1['비고'] } },
    };
    const res = await createPage(DB_GEN1, props1);
    parentId = res.id;
    saved++;
    console.log(`완료: ${tunnel} gen1(부모)`);
  } catch (e) {
    errors++;
    console.log(`오류: ${tunnel} gen1 → ${e.message}`);
    continue;
  }
  await sleep(DELAY_MS);

  // gen2(유류현황, 1건)
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
    await createPage(DB_GEN2, props2);
    saved++;
    console.log(`완료: ${tunnel} gen2(유류현황)`);
  } catch (e) {
    errors++;
    console.log(`오류: ${tunnel} gen2 → ${e.message}`);
  }
  await sleep(DELAY_MS);

  // gen3(체크리스트 20건)
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
      await createPage(DB_GEN3, props3);
      saved++;
      console.log(`완료: ${tunnel} gen3 ${item['점검구분']}/${item['점검내용']}`);
    } catch (e) {
      errors++;
      console.log(`오류: ${tunnel} gen3 ${item['점검내용']} → ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
}

console.log(`\n완료: ${saved}건, 오류: ${errors}건`);
