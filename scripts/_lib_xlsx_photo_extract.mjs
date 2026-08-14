// xlsx(OOXML) 내부 zip 구조를 직접 파싱해 특정 시트에 삽입된 이미지를 앵커 위치(row/col) 기준으로 추출한다.
// ExcelJS가 이 파일들의 drawing 구조를 파싱하다 크래시하는 문제를 우회하기 위한 저수준 대안.
import JSZip from 'jszip';
import fs from 'node:fs';

function parseAttrs(tag) {
  const attrs = {};
  const re = /(\w[\w:]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

async function loadZip(filePath) {
  const buf = fs.readFileSync(filePath);
  return JSZip.loadAsync(buf);
}

async function getSheetPathByName(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetTagRe = /<sheet\b[^>]*\/>/g;
  let sheetRid = null;
  let m;
  while ((m = sheetTagRe.exec(workbookXml))) {
    const attrs = parseAttrs(m[0]);
    if (attrs.name === sheetName) { sheetRid = attrs['r:id']; break; }
  }
  if (!sheetRid) return null;

  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relRe = /<Relationship\b[^>]*\/>/g;
  let target = null;
  while ((m = relRe.exec(relsXml))) {
    const attrs = parseAttrs(m[0]);
    if (attrs.Id === sheetRid) { target = attrs.Target; break; }
  }
  if (!target) return null;
  return 'xl/' + target.replace(/^\/?xl\//, '');
}

async function getDrawingPath(zip, sheetPath) {
  const sheetXml = await zip.file(sheetPath).async('string');
  const drawingM = /<drawing\b[^>]*\/>/.exec(sheetXml);
  if (!drawingM) return null;
  const attrs = parseAttrs(drawingM[0]);
  const rid = attrs['r:id'];

  const parts = sheetPath.split('/');
  const fname = parts.pop();
  const relsPath = [...parts, '_rels', fname + '.rels'].join('/');
  const relsFile = zip.file(relsPath);
  if (!relsFile) return null;
  const relsXml = await relsFile.async('string');
  const relRe = /<Relationship\b[^>]*\/>/g;
  let m, target = null;
  while ((m = relRe.exec(relsXml))) {
    const a = parseAttrs(m[0]);
    if (a.Id === rid) { target = a.Target; break; }
  }
  if (!target) return null;
  return 'xl/' + target.replace(/^\.\.\//, '').replace(/^\/?xl\//, '');
}

async function getDrawingAnchors(zip, drawingPath) {
  const xml = await zip.file(drawingPath).async('string');
  const anchorRe = /<(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/\1>/g;
  const results = [];
  let m;
  while ((m = anchorRe.exec(xml))) {
    const block = m[0];
    const fromM = /<from>[\s\S]*?<col>(\d+)<\/col>[\s\S]*?<row>(\d+)<\/row>[\s\S]*?<\/from>/.exec(block);
    const blipM = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(block);
    if (fromM && blipM) {
      results.push({ col: Number(fromM[1]), row: Number(fromM[2]), embedRid: blipM[1] });
    }
  }

  const parts = drawingPath.split('/');
  const fname = parts.pop();
  const relsPath = [...parts, '_rels', fname + '.rels'].join('/');
  const relsFile = zip.file(relsPath);
  const relsXml = relsFile ? await relsFile.async('string') : '';
  const relRe = /<Relationship\b[^>]*\/>/g;
  const ridToTarget = {};
  while ((m = relRe.exec(relsXml))) {
    const a = parseAttrs(m[0]);
    ridToTarget[a.Id] = a.Target;
  }

  for (const r of results) {
    const target = ridToTarget[r.embedRid];
    r.mediaPath = target ? 'xl/' + target.replace(/^\.\.\//, '').replace(/^\/?xl\//, '') : null;
  }
  return results;
}

// 사진1~7 시트 레이아웃 전용: row 3/18/33 부근에 이미지, col 0(좌)/5(우) 2열 x 3밴드 = 시트당 6장
function localSlotFromAnchor(row, col) {
  const bandStarts = [3, 18, 33];
  let band = 0, best = Infinity;
  bandStarts.forEach((b, i) => { const d = Math.abs(row - b); if (d < best) { best = d; band = i; } });
  const colBand = col < 3 ? 0 : 1;
  return band * 2 + colBand + 1; // 1~6
}

export async function extractPhotoSheetImages(filePath, sheetName, sheetIndex) {
  const zip = await loadZip(filePath);
  const sheetPath = await getSheetPathByName(zip, sheetName);
  if (!sheetPath) return [];
  const drawingPath = await getDrawingPath(zip, sheetPath);
  if (!drawingPath) return [];
  const anchors = await getDrawingAnchors(zip, drawingPath);

  const out = [];
  for (const a of anchors) {
    if (!a.mediaPath) continue;
    const mediaFile = zip.file(a.mediaPath);
    if (!mediaFile) continue;
    const buffer = await mediaFile.async('nodebuffer');
    const ext = a.mediaPath.split('.').pop().toLowerCase();
    const localSlot = localSlotFromAnchor(a.row, a.col);
    const globalNum = (sheetIndex - 1) * 6 + localSlot;
    out.push({ num: globalNum, buffer, ext });
  }
  return out;
}
