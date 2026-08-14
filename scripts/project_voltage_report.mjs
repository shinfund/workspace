import fs from 'fs';

// 청하터널(주) 한전 수전 전압 분석 리포트 생성
// 사용법: node scripts/project_voltage_extract.mjs && node scripts/project_voltage_weather_fetch.mjs && node scripts/project_voltage_report.mjs
const DIR = 'C:/Users/shinf/Workspace/data/전압분석';
const days = JSON.parse(fs.readFileSync(`${DIR}/voltage_raw.json`, 'utf8'));
const weather = JSON.parse(fs.readFileSync(`${DIR}/weather_raw.json`, 'utf8'));

const wDaily = {};
weather.daily.time.forEach((d, i) => {
  wDaily[d] = {
    cloud: weather.daily.cloud_cover_mean[i],
    sunshineSec: weather.daily.sunshine_duration[i],
    precip: weather.daily.precipitation_sum[i],
    temp: weather.daily.temperature_2m_mean[i],
  };
});
const wHourly = {};
weather.hourly.time.forEach((t, i) => {
  const [d, hm] = t.split('T');
  const h = parseInt(hm.slice(0, 2), 10);
  wHourly[d] = wHourly[d] || {};
  wHourly[d][h] = weather.hourly.cloud_cover[i];
});

const NOMINAL = 22900;
const LV_NOMINAL = 380;
const THRESH = { warn: 0.05, alarm: 0.10 };
function avg3(row) { return (row.rs + row.st + row.tr) / 3; }
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2);
}

// ---------------- HV(특고압) readings ----------------
const readings = [];
for (const d of days) {
  const date = d.date;
  const dow = new Date(date + 'T00:00:00').getDay();
  const month = date.slice(0, 7);
  const w = wDaily[date] || {};
  const wh = wHourly[date] || {};
  for (const panel of ['HV104', 'HV204']) {
    const rows = d.panels[panel] || [];
    for (const row of rows) {
      const v = avg3(row);
      if (!isFinite(v) || v <= 0) continue;
      const dev = (v - NOMINAL) / NOMINAL;
      readings.push({ date, h: row.h, panel, v, dev, dow, month, cloud: wh[row.h] ?? null, temp: w.temp ?? null });
    }
  }
}

// ---------------- LV(저압) readings ----------------
const lvReadings = [];
for (const d of days) {
  const date = d.date;
  const dow = new Date(date + 'T00:00:00').getDay();
  const month = date.slice(0, 7);
  for (const panel of ['LV101', 'LV201']) {
    const rows = d.panels[panel] || [];
    for (const row of rows) {
      const v = avg3(row);
      if (!isFinite(v) || v <= 0) continue;
      const dev = (v - LV_NOMINAL) / LV_NOMINAL;
      lvReadings.push({ date, h: row.h, panel, v, dev, dow, month });
    }
  }
}

function statsOf(rs) {
  const vs = rs.map(r => r.v);
  const devs = rs.map(r => r.dev);
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  return {
    n: rs.length, avg: mean, min: Math.min(...vs), max: Math.max(...vs),
    stdev: Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / vs.length),
    warnCount: devs.filter(d => d <= -THRESH.warn).length,
    alarmCount: devs.filter(d => d <= -THRESH.alarm).length,
    overVoltCount: devs.filter(d => d >= THRESH.warn).length,
  };
}
const overall = { HV104: statsOf(readings.filter(r => r.panel === 'HV104')), HV204: statsOf(readings.filter(r => r.panel === 'HV204')) };
const overallLv = { LV101: statsOf(lvReadings.filter(r => r.panel === 'LV101')), LV201: statsOf(lvReadings.filter(r => r.panel === 'LV201')) };

function hourPatternOf(rs) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const sub = rs.filter(r => r.h === h);
    const devs = sub.map(r => r.dev);
    out.push({
      h, avgDevPct: devs.reduce((a, b) => a + b, 0) / devs.length * 100,
      minDevPct: Math.min(...devs) * 100,
      warnCount: devs.filter(d => d <= -THRESH.warn).length,
    });
  }
  return out;
}
function monthPatternOf(rs) {
  const months = [...new Set(rs.map(r => r.month))].sort();
  return months.map(m => {
    const sub = rs.filter(r => r.month === m);
    const devs = sub.map(r => r.dev);
    return {
      month: m, avgDevPct: devs.reduce((a, b) => a + b, 0) / devs.length * 100,
      minDevPct: Math.min(...devs) * 100,
      warnCount: devs.filter(d => d <= -THRESH.warn).length,
      n: sub.length,
    };
  });
}

// 주전기실(100번대)·부전기실(200번대)은 한전 별도 수전 계통이므로 항상 분리 분석
const hv204ReadingsAll = readings.filter(r => r.panel === 'HV204');
const hourPatternHV104 = hourPatternOf(readings.filter(r => r.panel === 'HV104'));
const hourPatternHV204 = hourPatternOf(hv204ReadingsAll);
const summerReadings = readings.filter(r => ['2026-06', '2026-07', '2026-08'].includes(r.month));
const hourPatternHV104Summer = hourPatternOf(summerReadings.filter(r => r.panel === 'HV104'));
const hourPatternHV204Summer = hourPatternOf(summerReadings.filter(r => r.panel === 'HV204'));
const monthPatternHV104 = monthPatternOf(readings.filter(r => r.panel === 'HV104'));
const monthPatternHV204 = monthPatternOf(hv204ReadingsAll);

const lv201ReadingsAll = lvReadings.filter(r => r.panel === 'LV201');
const lvHourPatternLV101 = hourPatternOf(lvReadings.filter(r => r.panel === 'LV101'));
const lvHourPatternLV201 = hourPatternOf(lv201ReadingsAll);
const lvMonthPatternLV101 = monthPatternOf(lvReadings.filter(r => r.panel === 'LV101'));
const lvMonthPatternLV201 = monthPatternOf(lv201ReadingsAll);

// ---------------- HV → LV 추적률 (동일 시각 HV104 vs LV101 편차 차이) ----------------
const trackDiffs = [];
for (const d of days) {
  const hv = d.panels.HV104 || [], lv = d.panels.LV101 || [];
  for (let i = 0; i < hv.length; i++) {
    const hvV = avg3(hv[i]), lvV = avg3(lv[i]);
    if (!isFinite(hvV) || !isFinite(lvV) || hvV <= 0 || lvV <= 0) continue;
    const hvDev = (hvV - NOMINAL) / NOMINAL * 100, lvDev = (lvV - LV_NOMINAL) / LV_NOMINAL * 100;
    trackDiffs.push(lvDev - hvDev);
  }
}
const trackMean = trackDiffs.reduce((a, b) => a + b, 0) / trackDiffs.length;
const trackStdev = Math.sqrt(trackDiffs.reduce((a, b) => a + (b - trackMean) ** 2, 0) / trackDiffs.length);
const trackCorr = pearson(
  readings.filter(r => r.panel === 'HV104').map(r => r.dev * 100),
  (() => {
    // align by index (same order as hv104Readings built from same days/hours loop)
    const lv101 = [];
    for (const d of days) for (const row of (d.panels.LV101 || [])) {
      const v = avg3(row); if (!isFinite(v) || v <= 0) continue; lv101.push((v - LV_NOMINAL) / LV_NOMINAL * 100);
    }
    return lv101;
  })()
);

// 상관관계는 실제로 강하가 관측되는 HV-104(주전기실)만으로 계산 — HV-204를 섞으면 신호가 희석됨
const hv104Readings = readings.filter(r => r.panel === 'HV104');
const hv104Summer = hv104Readings.filter(r => ['2026-06', '2026-07', '2026-08'].includes(r.month));
const cloudReadings = hv104Readings.filter(r => r.cloud != null);
const daytimeReadings = cloudReadings.filter(r => r.h >= 9 && r.h <= 16);
const corrDaytimeAll = pearson(daytimeReadings.map(r => r.cloud), daytimeReadings.map(r => r.dev));
const summerDaytime = hv104Summer.filter(r => r.h >= 9 && r.h <= 16 && r.cloud != null);
const corrDaytimeSummer = pearson(summerDaytime.map(r => r.cloud), summerDaytime.map(r => r.dev));
const summerWithTemp = hv104Summer.filter(r => r.temp != null);
const corrTempSummer = pearson(summerWithTemp.map(r => r.temp), summerWithTemp.map(r => r.dev));
const allWithTemp = hv104Readings.filter(r => r.temp != null);
const corrTempAll = pearson(allWithTemp.map(r => r.temp), allWithTemp.map(r => r.dev));

const cloudBuckets = [
  { label: '맑음(구름량 0~30%)', min: 0, max: 30 },
  { label: '부분흐림(30~70%)', min: 30, max: 70 },
  { label: '흐림(70~100%)', min: 70, max: 101 },
];
function cloudTable(rs) {
  return cloudBuckets.map(b => {
    const sub = rs.filter(r => r.cloud >= b.min && r.cloud < b.max);
    const devs = sub.map(r => r.dev);
    return {
      label: b.label, n: sub.length,
      avgDevPct: devs.length ? devs.reduce((a, b2) => a + b2, 0) / devs.length * 100 : null,
      warnRatePct: devs.length ? devs.filter(d => d <= -THRESH.warn).length / devs.length * 100 : null,
    };
  });
}
const cloudPatternFull = cloudTable(daytimeReadings);
const cloudPatternSummer = cloudTable(summerDaytime);

// LV/HV 맑은날vs흐린날 (기존 태양광 가설 검증용)
function lvhvCompare(filterFn) {
  const rows = [];
  for (const d of days) {
    if (!filterFn(d.date)) continue;
    const hv = d.panels.HV104 || []; const lv = d.panels.LV101 || [];
    if (!hv.length || !lv.length) continue;
    const w = wDaily[d.date] || {};
    if (w.cloud == null) continue;
    const hvDevs = hv.map(r => (avg3(r) - NOMINAL) / NOMINAL * 100);
    const lvDevs = lv.map(r => (avg3(r) - LV_NOMINAL) / LV_NOMINAL * 100);
    rows.push({ date: d.date, cloud: w.cloud, hvMin: Math.min(...hvDevs), lvMin: Math.min(...lvDevs) });
  }
  const clear = rows.filter(x => x.cloud < 30), cloudy = rows.filter(x => x.cloud >= 70);
  const mean = (a, k) => a.length ? a.reduce((s, x) => s + x[k], 0) / a.length : null;
  return {
    clearN: clear.length, cloudyN: cloudy.length,
    clearHv: mean(clear, 'hvMin'), cloudyHv: mean(cloudy, 'hvMin'),
    clearLv: mean(clear, 'lvMin'), cloudyLv: mean(cloudy, 'lvMin'),
  };
}
const lvhvFull = lvhvCompare(() => true);
const lvhvSummer = lvhvCompare(d => ['2026-06', '2026-07', '2026-08'].includes(d.slice(0, 7)));

const worst = [...readings].filter(r => r.panel === 'HV104' || r.panel === 'HV204')
  .sort((a, b) => a.dev - b.dev).slice(0, 15)
  .map(r => ({ date: r.date, h: r.h, panel: r.panel, v: Math.round(r.v), devPct: r.dev * 100, cloud: r.cloud }));

// worst 이벤트에 대응하는 저압(LV) 값 함께 찾기
const lvByDateHourPanel = {};
for (const d of days) {
  for (const panel of ['LV101', 'LV201']) {
    for (const row of (d.panels[panel] || [])) {
      const v = avg3(row);
      if (!isFinite(v) || v <= 0) continue;
      lvByDateHourPanel[`${d.date}_${row.h}_${panel}`] = v;
    }
  }
}
const worstWithLv = worst.map(w => {
  const lvPanel = w.panel === 'HV104' ? 'LV101' : 'LV201';
  const lvV = lvByDateHourPanel[`${w.date}_${w.h}_${lvPanel}`];
  const lvDevPct = lvV != null ? (lvV - LV_NOMINAL) / LV_NOMINAL * 100 : null;
  return { ...w, lvV: lvV != null ? Math.round(lvV) : null, lvDevPct, lvPanel };
});

const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
function dowPatternOf(rs) {
  return dowNames.map((name, dw) => {
    const sub = rs.filter(r => r.dow === dw);
    const devs = sub.map(r => r.dev);
    return { name, avgDevPct: devs.reduce((a, b) => a + b, 0) / devs.length * 100, warnCount: devs.filter(d => d <= -THRESH.warn).length };
  });
}
const dowPatternHV104 = dowPatternOf(readings.filter(r => r.panel === 'HV104'));
const dowPatternHV204 = dowPatternOf(hv204ReadingsAll);

const warnEvents = readings.filter(r => r.dev <= -THRESH.warn);
const warnDates = [...new Set(warnEvents.map(r => r.date))].sort();
const lvWarnEvents = lvReadings.filter(r => r.dev <= -THRESH.warn);
const lvWarnDates = [...new Set(lvWarnEvents.map(r => r.date))].sort();

// 일별 경보(-5%↓)·위험(-10%↓) 상세 — 주전기실(HV-104) 기준, 해당 저압(LV-101) 동반값 포함
const dailyAlertDetail = warnDates.map(date => {
  const dayHv = readings.filter(r => r.date === date && r.panel === 'HV104');
  const dayLv = lvReadings.filter(r => r.date === date && r.panel === 'LV101');
  const warnHv = dayHv.filter(r => r.dev <= -THRESH.warn);
  const alarmHv = dayHv.filter(r => r.dev <= -THRESH.alarm);
  const worstHv = dayHv.reduce((a, b) => (b.dev < a.dev ? b : a));
  const matchLv = dayLv.find(r => r.h === worstHv.h);
  const w = wDaily[date] || {};
  return {
    date, dow: dowNames[new Date(date + 'T00:00:00').getDay()],
    warnCount: warnHv.length, alarmCount: alarmHv.length,
    warnHours: warnHv.map(r => String(r.h).padStart(2, '0') + '시'),
    worstH: worstHv.h, worstV: Math.round(worstHv.v), worstDevPct: worstHv.dev * 100,
    lvV: matchLv ? Math.round(matchLv.v) : null, lvDevPct: matchLv ? matchLv.dev * 100 : null,
    cloud: w.cloud ?? null, temp: w.temp ?? null,
  };
});

console.log('=== SUMMARY FOR REPORT ===');
console.log('overall HV', JSON.stringify(overall, null, 1));
console.log('overall LV', JSON.stringify(overallLv, null, 1));
console.log('HV->LV track diff mean:', trackMean.toFixed(4), 'stdev:', trackStdev.toFixed(4), 'corr:', trackCorr.toFixed(4));
console.log('corr daytime all-period:', corrDaytimeAll.toFixed(3));
console.log('corr daytime summer-only:', corrDaytimeSummer.toFixed(3));
console.log('corr temp summer:', corrTempSummer.toFixed(3), 'corr temp all:', corrTempAll.toFixed(3));
console.log('warnDates HV:', warnDates);
console.log('warnDates LV:', lvWarnDates);

// ---------------- Build HTML ----------------
const fmtV = n => Math.round(n).toLocaleString('ko-KR');
const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const devClass = n => n <= -3 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0.3 ? 't-pos' : 't-flat';

const now = new Date();
const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
const dateRangeStr = `${days[0].date} ~ ${days[days.length - 1].date}`;

// ---- SVG 2계열 선차트 (주전기실 vs 부전기실 비교용) ----
function svgLineChartMulti(series, opts = {}) {
  const { height = 190 } = opts;
  const W = 780, H = height;
  const padL = 36, padR = 12, padT = 14, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allYs = series.flatMap(s => s.points.map(p => p.y));
  let yMin = Math.min(0, ...allYs), yMax = Math.max(0, ...allYs);
  const span = Math.max(yMax - yMin, 0.6);
  const pad = span * 0.18;
  yMin -= pad; yMax += pad;
  const nPts = series[0].points.length;
  const xStep = nPts > 1 ? plotW / (nPts - 1) : 0;
  const xAt = i => padL + xStep * i;
  const yAt = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const zeroY = yAt(0);
  const thin = nPts > 16;
  const xLabels = series[0].points.map((p, i) => {
    if (thin && i % 2 !== 0 && i !== nPts - 1) return '';
    return `<text x="${xAt(i).toFixed(1)}" y="${H - 24}" font-size="12" text-anchor="middle" fill="var(--txt3)">${p.label}</text>`;
  }).join('');
  const seriesSvg = series.map(s => {
    const linePts = s.points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
    const dots = s.points.map((p, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="2.4" fill="${s.color}" stroke="var(--card)" stroke-width="1"><title>${s.name} ${p.label}: ${p.y >= 0 ? '+' : ''}${p.y.toFixed(2)}%</title></circle>`).join('');
    return `<polyline points="${linePts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join('');
  const legend = series.map(s => `<span class="lc-lg"><span class="lc-dot" style="background:${s.color}"></span>${s.name}</span>`).join('');
  return `<div class="lc-wrap">
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    <line x1="${padL}" x2="${W - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--chart-ref)" stroke-width="1.3" stroke-dasharray="4,4"/>
    ${seriesSvg}
    ${xLabels}
  </svg>
  <div class="lc-legend"><span class="lc-lg"><span class="lc-dash"></span>정격전압(0%)</span>${legend}</div>
</div>`;
}

const kpiRow1 = `
<div class="kpi-row">
  <div class="kpi-card kpi-sky"><div class="num">${days.length}</div><div class="lbl">분석 일수</div></div>
  <div class="kpi-card kpi-sky"><div class="num">${(overall.HV104.n + overall.HV204.n + overallLv.LV101.n + overallLv.LV201.n).toLocaleString('ko-KR')}</div><div class="lbl">전압 관측치(특고압+저압)</div></div>
  <div class="kpi-card kpi-coral"><div class="num">${overall.HV104.warnCount + overall.HV204.warnCount}</div><div class="lbl">경보(-5%↓) 이벤트</div></div>
  <div class="kpi-card kpi-teal"><div class="num">${overall.HV104.alarmCount + overall.HV204.alarmCount}</div><div class="lbl">위험(-10%↓) 이벤트</div></div>
  <div class="kpi-card kpi-amber"><div class="num">2026-07</div><div class="lbl">전압강하 본격화 시점</div></div>
</div>`;

const panelCompareTable = `
<div class="sc">
  <div class="sc-title">특고압(HV) 인입전압 비교 <span class="sub">기간 평균값, 22.9kV 기준(선간전압 3상 평균)</span></div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">구분</th><th>평균전압</th><th>최저전압</th><th>최고전압</th><th title="표준편차 σ = √(Σ(Vᵢ-V̄)²/n) — 기간 중 전압이 자체 평균에서 얼마나 흔들렸는지 나타내는 변동폭 지표">표준편차</th><th>경보(-5%↓)</th></tr></thead>
      <tbody>
        <tr><td class="l">주전기실 (HV-104)</td><td>${fmtV(overall.HV104.avg)}V</td><td class="t-neg">${fmtV(overall.HV104.min)}V</td><td>${fmtV(overall.HV104.max)}V</td><td>${overall.HV104.stdev.toFixed(0)}V</td><td class="t-neg-hi">${overall.HV104.warnCount}건</td></tr>
        <tr><td class="l">부전기실 (HV-204)</td><td>${fmtV(overall.HV204.avg)}V</td><td class="t-neg">${fmtV(overall.HV204.min)}V</td><td>${fmtV(overall.HV204.max)}V</td><td>${overall.HV204.stdev.toFixed(0)}V</td><td class="t-flat">${overall.HV204.warnCount}건</td></tr>
      </tbody>
    </table>
  </div>
  <div class="stock-cards">
    ${['HV104','HV204'].map(p => {
      const o = overall[p];
      const label = p === 'HV104' ? '주전기실 (HV-104)' : '부전기실 (HV-204)';
      return `<div class="stock-card"><div class="sc-head"><span class="sc-name">${label}</span><span class="sc-ratio ${o.warnCount>0?'t-neg-hi':'t-flat'}">${o.warnCount}건</span></div>
      <div class="sc-grid">
        <div class="sc-item"><span class="sc-item-l">평균전압</span><span class="sc-item-v">${fmtV(o.avg)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">최저전압</span><span class="sc-item-v">${fmtV(o.min)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">최고전압</span><span class="sc-item-v">${fmtV(o.max)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">표준편차</span><span class="sc-item-v">${o.stdev.toFixed(0)}V</span></div>
      </div></div>`;
    }).join('')}
  </div>
  <div class="sc-note"><b>주전기실과 부전기실은 한전으로부터 각각 별도로 수전</b>하는 독립 계통입니다(사용자 확인). 경보(-5%↓) 이벤트 10건은 전부 <b>주전기실(HV-104) 계통</b>에서만 발생했으며 부전기실(HV-204) 계통에서는 한 건도 발생하지 않았습니다. 두 인입점이 물리적으로 별개 선로이므로, 이는 지역 전체에 걸친 광역 전압강하라기보다 <b>주전기실 쪽 한전 배전선로(피더) 또는 그 선로에 물린 다른 수용가·부하 특성에 기인한 국지적 현상</b>일 가능성이 높습니다. 한전 민원 접수 시 "주전기실 인입선로"를 특정해 문의하시면 원인 파악에 도움이 됩니다.</div>
</div>
<div class="sc">
  <div class="sc-title">저압(LV) 전압 비교 <span class="sub">기간 평균값, 380V 기준(선간전압 3상 평균) · 상세는 [저압분석] 탭 참조</span></div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">구분</th><th>평균전압</th><th>최저전압</th><th>최고전압</th><th title="표준편차 σ = √(Σ(Vᵢ-V̄)²/n) — 기간 중 전압이 자체 평균에서 얼마나 흔들렸는지 나타내는 변동폭 지표">표준편차</th><th>경보(-5%↓)</th></tr></thead>
      <tbody>
        <tr><td class="l">주전기실 (LV-101)</td><td>${overallLv.LV101.avg.toFixed(1)}V</td><td class="t-neg">${overallLv.LV101.min.toFixed(1)}V</td><td>${overallLv.LV101.max.toFixed(1)}V</td><td>${overallLv.LV101.stdev.toFixed(1)}V</td><td class="t-neg-hi">${overallLv.LV101.warnCount}건</td></tr>
        <tr><td class="l">부전기실 (LV-201)</td><td>${overallLv.LV201.avg.toFixed(1)}V</td><td class="t-neg">${overallLv.LV201.min.toFixed(1)}V</td><td>${overallLv.LV201.max.toFixed(1)}V</td><td>${overallLv.LV201.stdev.toFixed(1)}V</td><td class="t-flat">${overallLv.LV201.warnCount}건</td></tr>
      </tbody>
    </table>
  </div>
  <div class="sc-note">저압측(LV-101)도 특고압측(HV-104)과 거의 동일하게 10건의 경보 이벤트가 발생했습니다 — 변압기를 통해 <b>특고압 편차가 거의 그대로(1:1 비율로) 저압단까지 전달</b>되기 때문입니다. 자세한 분석은 [저압분석] 탭을 참조하세요.</div>
</div>`;

const aiIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;
const aiHdr = t => `<div class="ai-title">${aiIcon} ${t}<span class="badge bdg-sky ai-badge" style="font-size:11px">AI 분석</span></div>`;
const ai = (dot, h) => `<div class="ai-item"><div class="ai-dot ai-dot-${dot}"></div><div>${h}</div></div>`;

const summaryAI = `<div class="ai-sc">
${aiHdr('종합 진단')}
<div class="ai-list">
${[
  ai('amber', `<b>전압강하는 2026년 7월부터 본격 시작</b> — 12월~6월(7개월)은 경보 이벤트가 0건이었으나, 7월 6건·8월(9일까지) 4건이 집중 발생했습니다. 무더위로 지역 전력수요가 급증하는 여름철 패턴과 정확히 일치합니다.`),
  ai('red', `<b>발생 지점은 주전기실 계통(HV-104·LV-101)에 국한</b> — 주전기실과 부전기실은 한전으로부터 각각 별도로 수전하는 독립 계통인데, 부전기실(HV-204·LV-201)은 동일 기간 경보 이벤트가 0건입니다. 두 계통이 물리적으로 분리돼 있으므로 광역 전압강하보다는 <b>주전기실 쪽 한전 배전선로(피더) 고유의 특성</b>일 가능성이 높습니다.`),
  ai('sky', `<b>특고압 편차는 저압측까지 거의 그대로(1:1) 전달</b> — 같은 시각 HV-104와 LV-101의 편차 차이는 평균 ${trackMean.toFixed(2)}%p(표준편차 ${trackStdev.toFixed(2)}%p)로 사실상 0에 수렴합니다. 저압측 자체의 별도 문제가 추가되는 것이 아니라, 변압기를 통해 특고압 쪽 편차가 그대로 전달되는 구조입니다.`),
  ai('sky', `<b>강하 폭은 경미한 수준</b> — 8개월간 특고압 11,568건 중 -5% 이하 10건(0.09%)뿐이며 -10%(위험 기준) 이하 사례는 전무합니다. 최저치도 특고압 21,570V(-5.81%)·저압 358V(-5.79%)로 순간적 편차이며 지속적 저전압 상태는 관측되지 않았습니다.`),
  ai('purple', `<b>흐린 날 자체보다 '더위(전력수요)'가 핵심 변수</b> — 전 기간 데이터에는 구름량-전압 상관관계(r≈-0.19)가 나타나지만, 여름철(6~8월)만 따로 보면 이 상관관계는 사실상 사라지고(r≈+0.03) 대신 기온-전압 상관관계가 뚜렷해집니다(r≈-0.51). 흐린 날 자가 태양광 미발전보다는, 무더위로 인한 지역 전체 냉방부하 증가가 더 직접적 원인으로 판단됩니다. 자세한 내용은 [기상 상관관계] 탭 참조.`),
].join('')}
</div>
</div>`;

const hourTab = `
<div class="sc">
  <div class="sc-title">시간대별 전압편차 패턴 (전체기간) <span class="sub">선그래프: 시간대 평균 전압편차(%), 점선=정격전압 · 주전기실(HV-104) vs 부전기실(HV-204)</span></div>
  ${svgLineChartMulti([
    { name: '주전기실(HV-104)', color: 'var(--coral)', points: hourPatternHV104.map(d => ({ label: d.h, y: d.avgDevPct })) },
    { name: '부전기실(HV-204)', color: 'var(--sky600)', points: hourPatternHV204.map(d => ({ label: d.h, y: d.avgDevPct })) },
  ])}
</div>
<div class="sc">
  <div class="sc-title">시간대별 전압편차 패턴 (여름철 6~8월만)</div>
  ${svgLineChartMulti([
    { name: '주전기실(HV-104)', color: 'var(--coral)', points: hourPatternHV104Summer.map(d => ({ label: d.h, y: d.avgDevPct })) },
    { name: '부전기실(HV-204)', color: 'var(--sky600)', points: hourPatternHV204Summer.map(d => ({ label: d.h, y: d.avgDevPct })) },
  ])}
</div>
<div class="sc">
  <div class="sc-title">시간대별 상세 수치 (전체기간, 주전기실 vs 부전기실)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="c">시간</th><th>주전기실 평균편차</th><th>주전기실 경보</th><th>부전기실 평균편차</th><th>부전기실 경보</th></tr></thead>
      <tbody>
        ${hourPatternHV104.map((h, i) => {
          const h2 = hourPatternHV204[i];
          return `<tr><td class="c">${String(h.h).padStart(2,'0')}시</td><td class="${devClass(h.avgDevPct)}">${fmtPct(h.avgDevPct)}</td><td class="c ${h.warnCount>0?'t-neg-hi':''}">${h.warnCount}</td><td class="${devClass(h2.avgDevPct)}">${fmtPct(h2.avgDevPct)}</td><td class="c ${h2.warnCount>0?'t-neg-hi':''}">${h2.warnCount}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
</div>
<div class="ai-sc">
${aiHdr('시간대 패턴 분석')}
<div class="ai-list">
${[
  ai('red', `<b>주전기실(HV-104)</b>만 놓고 보면 가장 취약한 시간대는 <b>08시(출근·설비 기동 시간대, 평균 -2.44%)</b>와 <b>18~19시(저녁 피크, 평균 -1.58~-1.63%)</b>입니다. 반면 <b>부전기실(HV-204)</b>은 같은 시간대에도 -0.7~-0.8% 수준으로 훨씬 완만해, 취약한 시간대 패턴 자체가 주전기실에서 뚜렷하게 두드러집니다.`),
  ai('sky', `<b>정오(12시) 전후</b>는 주전기실도 오히려 평균편차가 +0.57%(플러스)로 하루 중 가장 안정적입니다. 만약 흐린 날 태양광 미발전이 핵심 원인이라면 일사량이 가장 강한 정오 전후에 강하가 집중돼야 하는데, 실제로는 정반대 패턴입니다 — 이는 원인이 태양광보다 '아침·저녁 부하 피크'에 가깝다는 근거입니다.`),
  ai('amber', `22~23시(심야)에도 주전기실 편차가 소폭 확대되는데, 이는 여름철 심야 냉방 가동(열대야) 영향으로 추정됩니다.`),
].join('')}
</div>
</div>`;

const monthTab = `
<div class="sc">
  <div class="sc-title">월별 전압편차 추이 <span class="sub">2025-12 ~ 2026-08, 주전기실(HV-104) vs 부전기실(HV-204)</span></div>
  ${svgLineChartMulti([
    { name: '주전기실(HV-104)', color: 'var(--coral)', points: monthPatternHV104.map(m => ({ label: m.month.slice(5,7)+'월', y: m.avgDevPct })) },
    { name: '부전기실(HV-204)', color: 'var(--sky600)', points: monthPatternHV204.map(m => ({ label: m.month.slice(5,7)+'월', y: m.avgDevPct })) },
  ])}
</div>
<div class="sc">
  <div class="sc-title">월별 상세 수치 (주전기실 vs 부전기실)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">월</th><th>주전기실 평균편차</th><th>주전기실 경보</th><th>부전기실 평균편차</th><th>부전기실 경보</th></tr></thead>
      <tbody>
        ${monthPatternHV104.map((m, i) => {
          const m2 = monthPatternHV204[i];
          return `<tr><td class="l">${m.month}</td><td class="${devClass(m.avgDevPct)}">${fmtPct(m.avgDevPct)}</td><td class="c ${m.warnCount>0?'t-neg-hi':''}">${m.warnCount}</td><td class="${devClass(m2.avgDevPct)}">${fmtPct(m2.avgDevPct)}</td><td class="c ${m2.warnCount>0?'t-neg-hi':''}">${m2.warnCount}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div class="sc-note">⚠️ 참고: 고속도로 개통일(2025-11-07) 직후~초기 안정화 구간(2025-12월경)은 부하 패턴이 아직 정상 가동 상태와 다를 수 있어 절대비교보다는 <b>2026년 이후의 월별 우상향(악화) 추세</b>를 중심으로 해석하는 것을 권장합니다.</div>
</div>
<div class="ai-sc">
${aiHdr('월별 추이 분석')}
<div class="ai-list">
${[
  ai('amber', `<b>주전기실(HV-104)</b>은 2025-12 ~ 2026-06(7개월)에 월평균편차가 안정적이었으나, 2026-07 → 2026-08로 두 달 연속 뚜렷하게 악화되고 있습니다. 경보 이벤트도 이 두 달·이 계통에만 100% 집중됐습니다.`),
  ai('sky', `같은 기간 <b>부전기실(HV-204)</b>은 월평균편차가 뚜렷한 악화 추세 없이 훨씬 좁은 범위에서 유지되고 있습니다 — 두 계통을 나란히 보면 문제가 주전기실 쪽에 국한된다는 점이 더 명확해집니다.`),
  ai('purple', `주전기실의 7~8월 악화 시점은 정확히 전국적 폭염·장마 시즌과 겹칩니다. 계통 전체의 냉방부하 급증이 그 배전선로 말단(청하터널 주전기실 수전점)까지 전압강하로 나타난 것으로 해석하는 것이 가장 합리적입니다.`),
  ai('red', `9월 이후에도 무더위가 이어질 경우 유사하거나 더 심한 강하가 재발할 가능성이 있으므로, 8~9월 데이터를 지속 모니터링하는 것을 권장합니다.`),
].join('')}
</div>
</div>`;

const lvTab = `
<div class="sc">
  <div class="sc-title">저압(LV) 인입전압 비교 <span class="sub">기간 평균값, 380V 기준(선간전압 3상 평균)</span></div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">구분</th><th>평균전압</th><th>최저전압</th><th>최고전압</th><th title="표준편차 σ = √(Σ(Vᵢ-V̄)²/n) — 기간 중 전압이 자체 평균에서 얼마나 흔들렸는지 나타내는 변동폭 지표">표준편차</th><th>경보(-5%↓)</th></tr></thead>
      <tbody>
        <tr><td class="l">주전기실 (LV-101)</td><td>${overallLv.LV101.avg.toFixed(1)}V</td><td class="t-neg">${overallLv.LV101.min.toFixed(1)}V</td><td>${overallLv.LV101.max.toFixed(1)}V</td><td>${overallLv.LV101.stdev.toFixed(1)}V</td><td class="t-neg-hi">${overallLv.LV101.warnCount}건</td></tr>
        <tr><td class="l">부전기실 (LV-201)</td><td>${overallLv.LV201.avg.toFixed(1)}V</td><td class="t-neg">${overallLv.LV201.min.toFixed(1)}V</td><td>${overallLv.LV201.max.toFixed(1)}V</td><td>${overallLv.LV201.stdev.toFixed(1)}V</td><td class="t-flat">${overallLv.LV201.warnCount}건</td></tr>
      </tbody>
    </table>
  </div>
  <div class="stock-cards">
    ${['LV101','LV201'].map(p => {
      const o = overallLv[p];
      const label = p === 'LV101' ? '주전기실 (LV-101)' : '부전기실 (LV-201)';
      return `<div class="stock-card"><div class="sc-head"><span class="sc-name">${label}</span><span class="sc-ratio ${o.warnCount>0?'t-neg-hi':'t-flat'}">${o.warnCount}건</span></div>
      <div class="sc-grid">
        <div class="sc-item"><span class="sc-item-l">평균전압</span><span class="sc-item-v">${o.avg.toFixed(1)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">최저전압</span><span class="sc-item-v">${o.min.toFixed(1)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">최고전압</span><span class="sc-item-v">${o.max.toFixed(1)}V</span></div>
        <div class="sc-item"><span class="sc-item-l">표준편차</span><span class="sc-item-v">${o.stdev.toFixed(1)}V</span></div>
      </div></div>`;
    }).join('')}
  </div>
</div>
<div class="sc">
  <div class="sc-title">특고압(HV) → 저압(LV) 추적 관계 <span class="sub">주전기실 HV-104 vs LV-101, 동일 시각 기준</span></div>
  <div class="kpi-row">
    <div class="kpi-card kpi-sky"><div class="num">${trackMean.toFixed(2)}%p</div><div class="lbl">평균 차이(LV편차-HV편차)</div></div>
    <div class="kpi-card kpi-sky"><div class="num">${trackStdev.toFixed(2)}%p</div><div class="lbl">차이의 표준편차</div></div>
    <div class="kpi-card kpi-teal"><div class="num">${trackCorr.toFixed(3)}</div><div class="lbl">HV·LV 편차 상관계수</div></div>
  </div>
  <div class="sc-note">특고압(HV-104) 편차와 저압(LV-101) 편차의 차이는 평균 ${trackMean.toFixed(2)}%p, 표준편차 ${trackStdev.toFixed(2)}%p로 <b>거의 0에 수렴</b>하며, 상관계수도 ${trackCorr.toFixed(3)}로 사실상 1:1입니다. 즉 <b>저압측에서 별도로 추가되는 전압강하는 관측되지 않았고</b>, 변압기(특고압→저압 강압)를 거치며 상류(한전 인입) 쪽 편차가 비율 그대로 하류(저압반) 설비까지 전달되는 구조입니다. 실제 모터·조명·UPS 등 대부분의 설비는 저압단(220V/380V)에 연결되므로, [설비영향] 탭의 위험도 평가는 이 저압 실측치를 기준으로 봐도 무방합니다.</div>
</div>
<div class="sc">
  <div class="sc-title">저압 시간대별 전압편차 패턴 (전체기간) <span class="sub">주전기실(LV-101) vs 부전기실(LV-201)</span></div>
  ${svgLineChartMulti([
    { name: '주전기실(LV-101)', color: 'var(--coral)', points: lvHourPatternLV101.map(d => ({ label: d.h, y: d.avgDevPct })) },
    { name: '부전기실(LV-201)', color: 'var(--sky600)', points: lvHourPatternLV201.map(d => ({ label: d.h, y: d.avgDevPct })) },
  ])}
</div>
<div class="sc">
  <div class="sc-title">저압 월별 전압편차 추이</div>
  ${svgLineChartMulti([
    { name: '주전기실(LV-101)', color: 'var(--coral)', points: lvMonthPatternLV101.map(m => ({ label: m.month.slice(5,7)+'월', y: m.avgDevPct })) },
    { name: '부전기실(LV-201)', color: 'var(--sky600)', points: lvMonthPatternLV201.map(m => ({ label: m.month.slice(5,7)+'월', y: m.avgDevPct })) },
  ])}
  <div class="sc-note">경보(-5%↓) 발생일(저압 LV-101 기준): ${lvWarnDates.join(', ')} — 특고압(HV-104) 발생일과 정확히 동일합니다. 부전기실(LV-201)은 전 기간 경보 이벤트 0건입니다.</div>
</div>
<div class="ai-sc">
${aiHdr('저압(LV) 분석 인사이트')}
<div class="ai-list">
${[
  ai('sky', `저압측(LV-101)도 특고압측(HV-104)과 <b>동일한 10건</b>의 경보 이벤트, <b>동일한 날짜</b>에서 발생했습니다 — 별도의 저압 고유 문제가 아니라 상류 특고압 편차가 그대로 전달된 결과입니다.`),
  ai('teal', `부전기실 저압(LV-201)도 부전기실 특고압(HV-204)과 마찬가지로 경보 이벤트 0건으로, 안정적인 상태를 유지하고 있습니다.`),
  ai('amber', `저압단 실측 최저전압은 ${overallLv.LV101.min.toFixed(0)}V(정격 380V 대비 ${fmtPct((overallLv.LV101.min-LV_NOMINAL)/LV_NOMINAL*100)})로, 220V 단상 환산 시에도 유사한 비율의 편차가 예상됩니다. 저압 분전반에 연결된 개별 설비(조명·소형 모터 등) 점검 시 참고하시기 바랍니다.`),
].join('')}
</div>
</div>`;

const weatherTab = `
<div class="sc">
  <div class="sc-title">상관관계 요약 <span class="sub">피어슨 상관계수, 주전기실(HV-104) 기준, 구름량은 낮 시간대(9~16시)</span></div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">비교 변수</th><th class="l">분석 구간</th><th>상관계수(r)</th><th class="l">해석</th></tr></thead>
      <tbody>
        <tr><td class="l">구름량 ↔ 전압편차</td><td class="l">전체기간(12~8월)</td><td class="t-neg">${corrDaytimeAll.toFixed(2)}</td><td class="l">약한 음의 상관 (흐릴수록 소폭 저전압)</td></tr>
        <tr><td class="l">구름량 ↔ 전압편차</td><td class="l">여름철만(6~8월)</td><td class="t-flat">${corrDaytimeSummer.toFixed(2)}</td><td class="l">상관관계 거의 없음</td></tr>
        <tr><td class="l">기온 ↔ 전압편차</td><td class="l">전체기간(12~8월)</td><td class="t-neg">${corrTempAll.toFixed(2)}</td><td class="l">약한 음의 상관</td></tr>
        <tr><td class="l">기온 ↔ 전압편차</td><td class="l">여름철만(6~8월)</td><td class="t-neg-hi">${corrTempSummer.toFixed(2)}</td><td class="l"><b>뚜렷한 음의 상관 (더울수록 저전압)</b></td></tr>
      </tbody>
    </table>
  </div>
  <div class="sc-note">전체기간으로 보면 "흐린 날=저전압"처럼 보이지만, 이는 흐린 날이 여름철(장마·태풍)에 몰려있어 생기는 <b>계절 착시(교란변수)</b>입니다. 여름철만 따로 떼어 놓고 보면 구름량과 전압편차는 사실상 무관(r=${corrDaytimeSummer.toFixed(2)})해지고, 대신 기온과의 관계(r=${corrTempSummer.toFixed(2)})가 뚜렷해집니다.</div>
</div>
<div class="sc">
  <div class="sc-title">구름량 구간별 전압편차 (낮 9~16시)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">구간</th><th class="l">분석범위</th><th>평균편차</th><th>경보발생률</th></tr></thead>
      <tbody>
        ${cloudPatternFull.map(c => `<tr><td class="l">${c.label}</td><td class="l">전체기간</td><td class="${devClass(c.avgDevPct)}">${c.avgDevPct!=null?fmtPct(c.avgDevPct):'─'}</td><td>${c.warnRatePct!=null?c.warnRatePct.toFixed(2)+'%':'─'}</td></tr>`).join('')}
        ${cloudPatternSummer.map(c => `<tr><td class="l">${c.label}</td><td class="l">여름철만</td><td class="${devClass(c.avgDevPct)}">${c.avgDevPct!=null?fmtPct(c.avgDevPct):'─'}</td><td>${c.warnRatePct!=null?c.warnRatePct.toFixed(2)+'%':'─'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>
<div class="sc">
  <div class="sc-title">저압측(LV) 동반 변화 — "태양광 상쇄" 가설 검증</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">구간</th><th>맑은날 HV 최저편차</th><th>흐린날 HV 최저편차</th><th>맑은날 LV 최저편차</th><th>흐린날 LV 최저편차</th></tr></thead>
      <tbody>
        <tr><td class="l">전체기간 (맑음 ${lvhvFull.clearN}일 / 흐림 ${lvhvFull.cloudyN}일)</td><td class="t-neg">${fmtPct(lvhvFull.clearHv)}</td><td class="t-neg">${fmtPct(lvhvFull.cloudyHv)}</td><td class="t-neg">${fmtPct(lvhvFull.clearLv)}</td><td class="t-neg">${fmtPct(lvhvFull.cloudyLv)}</td></tr>
        <tr><td class="l">여름철만 (맑음 ${lvhvSummer.clearN}일 / 흐림 ${lvhvSummer.cloudyN}일)</td><td class="t-neg">${fmtPct(lvhvSummer.clearHv)}</td><td class="t-neg">${fmtPct(lvhvSummer.cloudyHv)}</td><td class="t-neg">${fmtPct(lvhvSummer.clearLv)}</td><td class="t-neg">${fmtPct(lvhvSummer.cloudyLv)}</td></tr>
      </tbody>
    </table>
  </div>
  <div class="sc-note">⚠️ <b>자가 태양광 발전량 데이터 확인 불가</b> — 전기실 계측 데이터의 태양광 접속반(GCP-101/102A/102B/102C, GCP-201/202A~202C) 기록을 확인한 결과, 분석기간(8개월) 내내 값이 전혀 변동 없이 고정되어 있었습니다. 즉 태양광 설비가 발전 중이더라도 <b>이 계측 시스템에는 발전량이 전혀 반영되지 않고 있습니다</b>. 이 때문에 "맑은 날 자가발전으로 저압측 전압이 상쇄되는지"는 이번 데이터만으로는 직접 검증할 수 없었습니다. 대신 저압측(LV) 전압은 맑은날/흐린날 관계없이 고압측(HV)과 거의 동일한 비율로 움직였습니다([저압분석] 탭 참조) — 이는 승압/강압 변압기를 통한 단순 비례 관계로, 자가 태양광에 의한 뚜렷한 상쇄 효과는 이번 데이터에서는 관측되지 않았습니다. <b>태양광 발전 감시 계측이 실제로 살아있는지 현장에서 별도 점검을 권장합니다.</b></div>
</div>
<div class="ai-sc">
${aiHdr('기상 상관관계 인사이트')}
<div class="ai-list">
${[
  ai('purple', `사용자께서 관찰하신 "흐린 날 전압강하 심화" 현상은 실제로 데이터에 나타나지만(r=${corrDaytimeAll.toFixed(2)}), 그 실제 원인은 흐림 자체가 아니라 <b>흐린 날이 대부분 무더운 장마철에 집중된 계절적 우연</b>일 가능성이 높습니다.`),
  ai('sky', `여름철(6~8월)만 놓고 보면 구름량과는 무관(r=${corrDaytimeSummer.toFixed(2)})하지만 기온과는 뚜렷한 상관(r=${corrTempSummer.toFixed(2)})을 보입니다 — 결국 <b>"흐려서"가 아니라 "더워서(냉방부하 증가)"</b>가 더 정확한 설명입니다.`),
  ai('amber', `자가 태양광 발전량이 계측되지 않고 있어 "맑은 날 상쇄 효과"는 이번 데이터로 확정할 수 없습니다. 태양광 발전 감시 시스템 정상 작동 여부를 현장에서 확인하시면 더 정밀한 분석이 가능합니다.`),
].join('')}
</div>
</div>`;

const eventTab = `
<div class="sc">
  <div class="sc-title">일별 경보·위험 상세 <span class="sub">경보(-5%↓) 발생 ${dailyAlertDetail.length}일 전체 목록, 주전기실(HV-104) 기준</span></div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">날짜</th><th class="c">경보(-5%↓) 횟수</th><th class="c">위험(-10%↓) 횟수</th><th class="l">경보 발생 시각</th><th>당일 최저전압(특고압)</th><th>최저편차</th><th>당일 최저전압(저압)</th><th>당시 기온</th><th>당시 구름량</th></tr></thead>
      <tbody>
        ${dailyAlertDetail.map(d => `<tr><td class="l">${d.date} (${d.dow})</td><td class="c t-neg-hi">${d.warnCount}</td><td class="c ${d.alarmCount>0?'t-neg-hi':'t-flat'}">${d.alarmCount}</td><td class="l">${d.warnHours.join(', ')}</td><td>${d.worstV.toLocaleString('ko-KR')}V</td><td class="t-neg-hi">${fmtPct(d.worstDevPct)}</td><td>${d.lvV!=null?d.lvV+'V':'─'}</td><td>${d.temp!=null?d.temp.toFixed(1)+'℃':'─'}</td><td>${d.cloud!=null?d.cloud+'%':'─'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="stock-cards">
    ${dailyAlertDetail.map(d => `<div class="stock-card"><div class="sc-head"><span class="sc-name">${d.date} (${d.dow})</span><span class="sc-ratio t-neg-hi">${fmtPct(d.worstDevPct)}</span></div>
    <div class="sc-grid">
      <div class="sc-item"><span class="sc-item-l">경보 횟수</span><span class="sc-item-v">${d.warnCount}회</span></div>
      <div class="sc-item"><span class="sc-item-l">위험 횟수</span><span class="sc-item-v">${d.alarmCount}회</span></div>
      <div class="sc-item"><span class="sc-item-l">발생 시각</span><span class="sc-item-v">${d.warnHours.join(', ')}</span></div>
      <div class="sc-item"><span class="sc-item-l">최저전압(특고압/저압)</span><span class="sc-item-v">${d.worstV.toLocaleString('ko-KR')}V / ${d.lvV!=null?d.lvV+'V':'─'}</span></div>
      <div class="sc-item"><span class="sc-item-l">당시 기온</span><span class="sc-item-v">${d.temp!=null?d.temp.toFixed(1)+'℃':'─'}</span></div>
      <div class="sc-item"><span class="sc-item-l">당시 구름량</span><span class="sc-item-v">${d.cloud!=null?d.cloud+'%':'─'}</span></div>
    </div></div>`).join('')}
  </div>
  <div class="sc-note">위험(-10%↓) 기준을 넘은 날은 0일입니다. 경보 발생일 6일 모두 최고기온이 높았던 날과 겹치는지 이 표의 "당시 기온" 열로 직접 확인하실 수 있습니다.</div>
</div>
<div class="sc">
  <div class="sc-title">요일별 패턴 (주전기실 vs 부전기실)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="c">요일</th><th>주전기실 평균편차</th><th>주전기실 경보</th><th>부전기실 평균편차</th><th>부전기실 경보</th></tr></thead>
      <tbody>
        ${dowPatternHV104.map((d, i) => {
          const d2 = dowPatternHV204[i];
          return `<tr><td class="c">${d.name}</td><td class="${devClass(d.avgDevPct)}">${fmtPct(d.avgDevPct)}</td><td class="c ${d.warnCount>0?'t-neg-hi':''}">${d.warnCount}</td><td class="${devClass(d2.avgDevPct)}">${fmtPct(d2.avgDevPct)}</td><td class="c ${d2.warnCount>0?'t-neg-hi':''}">${d2.warnCount}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div class="sc-note">주전기실은 평일(화·수·목·금)이 주말(토·일)보다 대체로 편차가 더 크게 나타나 산업/상업 부하 영향을 시사합니다. 부전기실은 요일 관계없이 편차가 전반적으로 작습니다. 다만 표본이 8개월 분량이라 통계적으로 확정하기보다는 참고 지표로 활용하시기 바랍니다.</div>
</div>
<div class="sc">
  <div class="sc-title">저전압 이벤트 상위 15건 (특고압 편차가 가장 큰 순, 저압 동반값 포함)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">날짜</th><th class="c">시각</th><th class="l">인입점</th><th>특고압 전압</th><th>특고압 편차</th><th>저압 전압</th><th>저압 편차</th><th>당시 구름량</th></tr></thead>
      <tbody>
        ${worstWithLv.map(w => `<tr><td class="l">${w.date} (${dowNames[new Date(w.date+'T00:00:00').getDay()]})</td><td class="c">${String(w.h).padStart(2,'0')}시</td><td class="l">${w.panel==='HV104'?'주전기실':'부전기실'}</td><td>${w.v.toLocaleString('ko-KR')}V</td><td class="t-neg-hi">${fmtPct(w.devPct)}</td><td>${w.lvV!=null?w.lvV+'V':'─'}</td><td class="t-neg-hi">${w.lvDevPct!=null?fmtPct(w.lvDevPct):'─'}</td><td>${w.cloud!=null?w.cloud+'%':'─'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="stock-cards">
    ${worstWithLv.map(w => `<div class="stock-card"><div class="sc-head"><span class="sc-name">${w.date} ${String(w.h).padStart(2,'0')}시</span><span class="sc-ratio t-neg-hi">${fmtPct(w.devPct)}</span></div>
    <div class="sc-grid">
      <div class="sc-item"><span class="sc-item-l">인입점</span><span class="sc-item-v">${w.panel==='HV104'?'주전기실':'부전기실'}</span></div>
      <div class="sc-item"><span class="sc-item-l">특고압 전압</span><span class="sc-item-v">${w.v.toLocaleString('ko-KR')}V</span></div>
      <div class="sc-item"><span class="sc-item-l">저압 전압</span><span class="sc-item-v">${w.lvV!=null?w.lvV+'V ('+fmtPct(w.lvDevPct)+')':'─'}</span></div>
      <div class="sc-item"><span class="sc-item-l">당시 구름량</span><span class="sc-item-v">${w.cloud!=null?w.cloud+'%':'─'}</span></div>
    </div></div>`).join('')}
  </div>
  <div class="sc-note">경보(-5%↓) 발생일: ${warnDates.join(', ')} — 총 ${warnDates.length}일, 모두 2026년 7~8월에 집중됐습니다. 표에서 보듯 저압측 편차는 특고압측과 거의 동일한 크기로 함께 나타납니다.</div>
</div>`;

const impactTab = `
<div class="sc">
  <div class="sc-title">이번 데이터 기준 심각도 판단</div>
  <div class="sc-note">
    국내에는 22.9kV 특고압 수전점의 소비자단 전압 허용오차를 명시한 법정 기준(전기사업법 시행규칙 별표3)이 저압(110/220/380V)처럼 별도로 존재하지 않습니다. 다만 업계에서는 IEC 60038 등 국제 규격과 한전 배전 운영관행을 참고해 통상 <b>공칭전압 대비 ±10%</b>를 설비 설계·보호계전기 정정의 기준선으로 삼는 경우가 많습니다. 이 리포트의 "경보(-5%)"·"위험(-10%)" 기준선도 이를 참고해 보수적으로 설정한 것이며, 법적 기준이 아닌 공학적 참고치임을 밝혀둡니다. 실제 설비는 대부분 저압단(220V/380V)에 연결되는데, [저압분석] 탭에서 확인했듯 저압측 편차도 특고압측과 거의 동일한 비율(1:1)로 나타나므로 아래 판단은 저압단 기준으로도 유효합니다.
  </div>
  <div class="kpi-row">
    <div class="kpi-card kpi-teal"><div class="num">0건</div><div class="lbl">-10%(위험) 이상 사례</div></div>
    <div class="kpi-card kpi-amber"><div class="num">10건</div><div class="lbl">-5%(경보) 순간 사례 / 11,568건 중</div></div>
    <div class="kpi-card kpi-sky"><div class="num">-5.81%</div><div class="lbl">특고압 최대 강하폭(순간)</div></div>
    <div class="kpi-card kpi-sky"><div class="num">-5.79%</div><div class="lbl">저압(LV-101) 최대 강하폭(순간)</div></div>
  </div>
</div>
<div class="sc">
  <div class="sc-title">저전압이 설비·장비에 미치는 영향 (일반 공학 기준)</div>
  <div class="tbl-wrap stock-cards-target">
    <table>
      <thead><tr><th class="l">설비</th><th class="l">저전압 시 예상 영향</th><th class="l">현재 데이터 기준 위험도</th></tr></thead>
      <tbody>
        <tr><td class="l">3상 유도전동기<br><span style="color:var(--txt3);font-size:12px">(배기팬·양수펌프 등)</span></td><td class="l">동일 부하 유지 시 전류 증가(발열↑) · 토크는 전압 제곱에 비례해 감소 → 기동전류가 큰 순간 기동 실패 위험 커짐</td><td class="l"><span class="badge bdg-teal">낮음</span> 순간 5%대 편차로는 정상 기동토크 범위 내</td></tr>
        <tr><td class="l">UPS / 정류기</td><td class="l">입력 저전압 시 배터리 방전(부스트) 모드 전환 빈도 증가 → 배터리 수명 단축</td><td class="l"><span class="badge bdg-amber">관찰 필요</span> 여름철 순간 이벤트가 반복되면 배터리 전환 빈도 누적 가능</td></tr>
        <tr><td class="l">조명(LED/형광등 안정기)</td><td class="l">밝기 저하, 구형 전자식 안정기는 깜빡임·오동작 가능</td><td class="l"><span class="badge bdg-teal">낮음</span></td></tr>
        <tr><td class="l">저전압 계전기(UVR) 탑재 보호계전 장치</td><td class="l">정정치(통상 -15~-20%) 이하로 떨어지면 트립 발생</td><td class="l"><span class="badge bdg-teal">매우 낮음</span> 관측 최대치(-5.8%대)는 일반 정정치의 1/3 수준</td></tr>
        <tr><td class="l">변압기</td><td class="l">순간적 전압변동 자체보다는 장기 과부하·불평형이 수명에 더 큰 영향</td><td class="l"><span class="badge bdg-sky">정보</span> 이번 분석 범위 밖(부하 데이터 별도 필요)</td></tr>
      </tbody>
    </table>
  </div>
</div>
<div class="ai-sc">
${aiHdr('종합 권고')}
<div class="ai-list">
${[
  ai('teal', `현재까지 관측된 전압강하는 순간적·경미한 수준(특고압·저압 모두 최대 -5.8%대, 위험기준 -10% 미도달)으로 <b>즉각적인 설비 손상 가능성은 낮게 평가</b>됩니다.`),
  ai('amber', `다만 2026년 7~8월부터 추세가 뚜렷하게 악화되고 있어, <b>9월까지 무더위가 이어질 경우 유사·심화된 이벤트가 재발할 가능성</b>이 있습니다. 08~10시·18~19시 시간대 위주로 계속 모니터링을 권장합니다.`),
  ai('red', `경보 이벤트가 주전기실 계통(HV-104·LV-101)에만 발생한 점은 계통 전체보다 <b>해당 인입선로·수전설비의 국지적 특성</b>일 가능성을 시사하므로, 한전 및 자체 전기안전관리자 점검 시 이 부분을 함께 확인하시길 권장합니다.`),
  ai('purple', `태양광 발전 계측값이 8개월간 전혀 갱신되지 않은 점은 전압강하와 별개로 <b>모니터링 시스템 자체의 이상 가능성</b>을 시사하므로 별도 점검이 필요합니다.`),
].join('')}
</div>
</div>`;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>청하터널 한전 인입전압 분석 — ${dateRangeStr}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans KR',-apple-system,sans-serif;font-size:14.5px;background:var(--bg);color:var(--txt);word-break:keep-all}
:root{
  --sky:#0366D6;--sky50:#E9F1FE;--sky100:#C7DCF6;--sky600:#005CC5;--sky800:#032F62;
  --teal:#1D9E75;--teal50:#E1F5EE;--teal100:#9FE1CB;--teal600:#0F6E56;
  --coral:#D85A30;--coral50:#FAECE7;--coral100:#F5C4B3;
  --amber:#BA7517;--amber50:#FAEEDA;--amber100:#FAC775;
  --purple:#534AB7;--purple50:#EEEDFE;--purple100:#CECBF6;
  --gray50:#F1EFE8;--gray100:#D3D1C7;--gray600:#5F5E5A;
  --bg:#FFFFFF;--card:#FFFFFF;--border:#E1E4E8;--border2:#F6F8FA;
  --txt:#24292E;--txt2:#3A4453;--txt3:#6A737D;
  --chart-ref:rgba(36,41,46,.35);
  --red:var(--coral);--red50:var(--coral50);--blue:var(--sky);--blue50:var(--sky50);
  --hdrbg:#0C447C;--hdr-text:#fff;--hdr-text-dim:rgba(255,255,255,.85);
  --hdr-btn-bg:rgba(255,255,255,.15);--hdr-btn-border:rgba(255,255,255,.35);
  --hdr-btn-hover-bg:rgba(255,255,255,.25);--hdr-btn-text:#fff;
  --hdr-shadow:0 2px 8px rgba(12,68,124,.3);
  --r6:6px;--r8:8px;--r10:10px;--r12:12px;--r14:14px;--r16:16px;--r20:20px;
  --shadow:none;--shadow-h:0 20px 60px rgba(0,0,0,.2);
}
html[data-theme="light"]{--hdrbg:#FFFFFF;--hdr-text:#032F62;--hdr-text-dim:#355E82;--hdr-btn-bg:#E6F1FB;--hdr-btn-border:#B7CEE8;--hdr-btn-hover-bg:#D3E7FA;--hdr-btn-text:#005CC5;--hdr-shadow:0 2px 8px rgba(12,68,124,.12);}
html[data-theme="dark"]{
  --bg:#24292E;--card:#1C2024;--border:rgba(255,255,255,.13);--border2:rgba(255,255,255,.09);
  --txt:rgba(255,255,255,.92);--txt2:rgba(255,255,255,.75);--txt3:rgba(255,255,255,.5);
  --chart-ref:rgba(255,255,255,.32);
  --shadow:none;--shadow-h:0 20px 60px rgba(0,0,0,.5);--hdrbg:#24292E;--hdr-shadow:0 2px 10px rgba(0,0,0,.4);
  --sky:#2E8FFF;--sky50:rgba(46,143,255,.16);--sky100:rgba(46,143,255,.32);--sky600:#79B8FF;--sky800:#C8E1FF;
  --teal:#4FD8AC;--teal50:rgba(29,158,117,.16);--teal100:rgba(29,158,117,.32);--teal600:#4FD8AC;
  --coral:#F2896A;--coral50:rgba(216,90,48,.16);--coral100:rgba(216,90,48,.32);
  --red:var(--coral);--red50:var(--coral50);--blue:var(--sky);--blue50:var(--sky50);
  --amber:#E8A93D;--amber50:rgba(186,117,23,.22);--amber100:rgba(186,117,23,.38);
  --purple:#B4A6FF;--purple50:rgba(83,74,183,.26);--purple100:rgba(83,74,183,.4);
  --gray50:rgba(255,255,255,.10);--gray600:#C9C7BF;
}
/* 가독성 개선(괴리율 리포트 기준 정렬): 테이블 헤더 굵기 보통화 + 다크모드 저채도 텍스트 흰색화 */
thead th{font-weight:400}
html[data-theme="dark"] thead th{color:#fff}
tbody td.t-pos,tbody td.t-neg,tbody td.t-neg-hi,tbody td.t-flat{font-weight:400}
html[data-theme="dark"]{--txt2:#fff;--txt3:rgba(255,255,255,.92)}
html[data-theme="dark"] .tab-btn.on{color:#fff}
.hdr-wrap{position:fixed;top:0;left:0;right:0;z-index:50;box-shadow:var(--hdr-shadow)}
.header{background:var(--hdrbg);padding:max(12px,env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;justify-content:space-between;max-width:1100px;margin:0 auto;transition:background .18s ease}
.top-nav{background:var(--card);border-bottom:1.5px solid var(--border);display:flex;padding:0 4px;max-width:1100px;margin:0 auto;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.top-nav::-webkit-scrollbar{display:none}
.tab-btn{flex:1;flex-shrink:0;min-width:64px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--txt);font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;padding:13px 6px;touch-action:manipulation;transition:color .15s;position:relative;white-space:nowrap}
.tab-btn.on{color:var(--sky600)}
.tab-btn.on::after{content:'';position:absolute;bottom:0;left:8%;right:8%;height:2.5px;background:var(--sky);border-radius:2px 2px 0 0}
.nav-spacer{height:calc(104px + env(safe-area-inset-top,0px))}
.header-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0;overflow:hidden}
.logo-mark{width:34px;height:34px;background:linear-gradient(155deg,#7FB4FF 0%,#0366D6 55%,#032F62 100%);border-radius:var(--r8);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(3,102,214,.35)}
.logo-info{display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden}
.logo-title{font-size:17px;font-weight:800;color:var(--hdr-text);letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .18s ease}
.logo-sub{font-size:13px;color:var(--hdr-text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .18s ease}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;margin-left:10px}
.hdr-date{font-size:13.5px;font-weight:700;color:var(--hdr-text);white-space:nowrap}
.hdr-meta{font-size:12.5px;color:var(--hdr-text-dim);white-space:nowrap}
.hdr-btn{background:var(--hdr-btn-bg);border:1px solid var(--hdr-btn-border);color:var(--hdr-btn-text);font-size:13px;font-weight:700;padding:6px 12px;border-radius:16px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .12s}
.hdr-btn:hover{background:var(--hdr-btn-hover-bg)}
.wrap{max-width:1100px;margin:0 auto}
.main{padding:0 20px max(20px,env(safe-area-inset-bottom))}
.panel{display:none}
.panel.on{display:block;animation:fade .22s}
@keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.kpi-row{display:flex;gap:9px;margin-bottom:14px;padding-top:10px;flex-wrap:wrap}
.kpi-card{flex:1;min-width:110px;background:var(--card);border:1px solid var(--border);border-radius:var(--r12);padding:12px 10px;text-align:center;box-shadow:var(--shadow)}
.kpi-card .num{font-size:20px;font-weight:800;line-height:1.1}
.kpi-card .lbl{font-size:13.5px;margin-top:4px;font-weight:700;color:var(--txt)}
.kpi-sky .num,.kpi-sky .lbl{color:var(--sky600)}
.kpi-red .num,.kpi-red .lbl{color:var(--red)}
.kpi-teal .num,.kpi-teal .lbl{color:var(--teal600)}
.kpi-coral .num,.kpi-coral .lbl{color:var(--coral)}
.kpi-amber .num,.kpi-amber .lbl{color:var(--amber)}
.kpi-purple .num,.kpi-purple .lbl{color:var(--purple)}
.sc{background:var(--card);border-radius:var(--r12);border:1px solid var(--border);padding:16px 18px;margin-bottom:14px;box-shadow:var(--shadow)}
.sc-title{font-size:14.5px;font-weight:800;color:var(--txt);margin-bottom:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.sc-title .sub{font-size:13.5px;font-weight:600;color:var(--txt2)}
.sc-note{font-size:14px;color:var(--txt2);margin-bottom:0;line-height:1.6;padding:8px 10px;background:var(--bg);border-radius:var(--r8);margin-top:12px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r8);overscroll-behavior-x:contain}
table{min-width:100%;border-collapse:collapse;font-size:13.5px}
thead th{background:var(--sky50);color:var(--sky800);font-size:13.5px;padding:9px 8px;text-align:right;white-space:nowrap}
thead th.l{text-align:left} thead th.c{text-align:center}
tbody td{padding:9px 8px;border-bottom:1px solid var(--border2);text-align:right;white-space:nowrap;color:var(--txt)}
tbody td.l{text-align:left} tbody td.c{text-align:center}
tbody tr:hover{background:var(--sky50)}
.stock-cards{display:none}
.stock-cards-target{display:block}
.stock-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r12);padding:13px 14px;margin-bottom:10px}
.sc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sc-name{font-size:15px;font-weight:800;color:var(--txt)}
.sc-ratio{font-size:16px;font-weight:900}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px}
.sc-item{display:flex;flex-direction:column;gap:1px}
.sc-item-l{font-size:13px;color:var(--txt2);font-weight:700}
.sc-item-v{font-size:14.5px;font-weight:700;color:var(--txt)}
.t-neg-hi{color:var(--red);font-weight:800}
.t-neg{color:var(--red);font-weight:700}
.t-pos{color:var(--teal600);font-weight:800}
.t-flat{color:var(--txt2);font-weight:600}
.badge{font-size:12.5px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;display:inline-block}
.bdg-red{background:var(--red50);color:var(--red)}
.bdg-sky{background:var(--sky50);color:var(--sky600)}
.bdg-teal{background:var(--teal50);color:var(--teal600)}
.bdg-amber{background:var(--amber50);color:var(--amber)}
.bdg-coral{background:var(--coral50);color:var(--coral)}
.bdg-gray{background:var(--gray50);color:var(--gray600)}
.ai-sc{background:linear-gradient(135deg,var(--sky50) 0%,var(--card) 100%);border:1px solid var(--sky100);border-left:4px solid var(--sky);border-radius:var(--r12);padding:16px 18px;margin-bottom:14px;box-shadow:var(--shadow)}
.ai-title{font-size:14.5px;font-weight:800;color:var(--sky800);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.ai-badge{margin-left:auto}
.ai-list{display:flex;flex-direction:column;gap:9px}
.ai-item{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--txt);line-height:1.6}
.ai-dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:8px}
.ai-dot-red{background:var(--red)} .ai-dot-teal{background:var(--teal)} .ai-dot-sky{background:var(--sky)} .ai-dot-amber{background:var(--amber)} .ai-dot-purple{background:var(--purple)}
.lc-wrap{width:100%}
.lc-wrap svg{display:block}
.lc-legend{display:flex;gap:16px;margin-top:2px;font-size:13px;color:var(--txt2);flex-wrap:wrap}
.lc-lg{display:flex;align-items:center;gap:5px}
.lc-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
#settingsModal{display:none;position:fixed;inset:0;z-index:100}
#settingsModal.modal-open{display:block}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}
.modal-box{background:var(--card);border-radius:var(--r16);padding:20px;max-width:340px;width:100%;box-shadow:var(--shadow-h)}
.modal-title{font-size:16px;font-weight:800;color:var(--txt);margin-bottom:14px}
.modal-section{font-size:13.5px;font-weight:700;color:var(--txt2);margin-bottom:8px}
.theme-opts{display:flex;gap:10px}
.theme-opt{flex:1;cursor:pointer;border-radius:var(--r12);border:2px solid var(--border);padding:8px;text-align:center;transition:border-color .12s}
.theme-opt.on{border-color:var(--sky)}
.theme-swatch{height:44px;border-radius:var(--r8);margin-bottom:6px;position:relative;overflow:hidden}
.theme-swatch-dark{background:#1C2024}
.theme-swatch-light{background:#F6F8FA}
.ts-side{position:absolute;left:0;top:0;bottom:0;width:30%}
.theme-swatch-dark .ts-side{background:#24292E}
.theme-swatch-light .ts-side{background:#FFFFFF;border-right:1px solid #E1E4E8}
.theme-opt-label{font-size:13.5px;font-weight:700;color:var(--txt)}
@media(max-width:374px){.logo-sub{display:none} .tab-btn{font-size:13px;padding:11px 2px;min-width:52px} .kpi-card .num{font-size:16px} .kpi-card .lbl{font-size:12px}}
@media(max-width:600px){
  .nav-spacer{height:calc(108px + env(safe-area-inset-top,0px))}
  .main{padding:0 10px max(20px,env(safe-area-inset-bottom))}
  .sc{padding:12px 12px} .tab-btn{font-size:13.5px;padding:12px 4px}
  .kpi-card .num{font-size:18px} .kpi-card .lbl{font-size:13px}
  table{font-size:13px} thead th,tbody td{padding:8px 5px}
  .stock-cards{display:block} .stock-cards-target{display:none}
  .hdr-date{display:none}
}
@media(min-width:769px){
  .nav-spacer{height:calc(106px + env(safe-area-inset-top,0px))}
  .main{padding:0 20px max(20px,env(safe-area-inset-bottom))}
  .sc{padding:18px 20px} .sc-title{font-size:15px}
  .kpi-card .num{font-size:22px} .kpi-card .lbl{font-size:14px}
  table{font-size:14px} thead th,tbody td{padding:10px 9px}
}
@media(min-width:1024px){.kpi-row{gap:12px} .kpi-card .num{font-size:24px}}
</style>
</head>
<body>
<div id="settingsModal">
  <div class="modal-backdrop" onclick="closeSettingsModal()">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div class="modal-title">설정</div>
      <div class="modal-section">화면모드</div>
      <div class="theme-opts">
        <div class="theme-opt" id="theme-opt-dark" onclick="setTheme('dark')">
          <div class="theme-swatch theme-swatch-dark"><span class="ts-side"></span></div>
          <div class="theme-opt-label">다크</div>
        </div>
        <div class="theme-opt" id="theme-opt-light" onclick="setTheme('light')">
          <div class="theme-swatch theme-swatch-light"><span class="ts-side"></span></div>
          <div class="theme-opt-label">라이트</div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="hdr-wrap"><div class="wrap">
  <div class="header">
    <div class="header-left">
      <div class="logo-mark"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg></div>
      <div class="logo-info">
        <div class="logo-title">청하터널 한전 인입전압 분석</div>
        <div class="logo-sub">특고압 HV-104/204 · 저압 LV-101/201</div>
      </div>
    </div>
    <div class="header-right" style="flex-direction:row;align-items:center;gap:8px">
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <div class="hdr-date">${dateRangeStr}</div>
        <div class="hdr-meta">전력데이터 일보 241건 + 기상 데이터</div>
      </div>
      <button class="hdr-btn" onclick="openSettingsModal()" aria-label="설정">⚙ 설정</button>
    </div>
  </div>
  <nav class="top-nav">
    <button class="tab-btn on" data-tab="0">요약</button>
    <button class="tab-btn" data-tab="1">일별</button>
    <button class="tab-btn" data-tab="2">시간대별</button>
    <button class="tab-btn" data-tab="3">월별</button>
    <button class="tab-btn" data-tab="4">저압분석</button>
    <button class="tab-btn" data-tab="5">기상상관관계</button>
    <button class="tab-btn" data-tab="6">설비영향</button>
  </nav>
</div></div>
<div class="nav-spacer"></div>
<div class="wrap"><div class="main">
  <div class="panel on" id="p0">
    ${kpiRow1}
    ${panelCompareTable}
    ${summaryAI}
    <div class="sc">
      <div class="sc-title">분석 방법 안내</div>
      <div class="sc-note">
        · 데이터: 전력데이터_청하터널(주) 일보 241건(2025-12-12~2026-08-09, 매시 1회 특고압 22.9kV·저압 380V 선간전압 3상 평균)<br>
        · 기상 데이터: 청하면(포항) 인근 좌표 기준 Open-Meteo 과거 기상 아카이브(구름량·기온, 시간단위)<br>
        · 공칭전압: 특고압 22,900V / 저압 380V, 경보기준 ±5%, 위험기준 ±10%(업계 참고치, §설비영향 탭 참조)<br>
        · 고속도로 개통일(2025-11-07) 직후~초기 구간은 부하 안정화 전이라 절대치보다 추세 해석 위주로 활용 권장(사용자 확인사항)<br>
        · <b>표준편차 계산식</b>: σ = √( Σ(Vᵢ − V̄)² ÷ n ) — Vᵢ=매 시간 실측전압, V̄=기간 평균전압, n=관측치 수(모집단 표준편차). 정격전압과의 괴리가 아니라 <b>전압 자체가 기간 내내 얼마나 흔들렸는지(변동성)</b>를 나타내는 지표이며, 값이 클수록 전압이 불안정하다는 의미입니다.
      </div>
    </div>
  </div>
  <div class="panel" id="p1">${eventTab}</div>
  <div class="panel" id="p2">${hourTab}</div>
  <div class="panel" id="p3">${monthTab}</div>
  <div class="panel" id="p4">${lvTab}</div>
  <div class="panel" id="p5">${weatherTab}</div>
  <div class="panel" id="p6">${impactTab}</div>
</div></div>
<script>
(function(){try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'dark');}catch(e){}})();
function openSettingsModal(){ document.getElementById('settingsModal').classList.add('modal-open'); syncThemeOptUI(); }
function closeSettingsModal(){ document.getElementById('settingsModal').classList.remove('modal-open'); }
function setTheme(t){ document.documentElement.setAttribute('data-theme', t); try{ localStorage.setItem('theme', t); }catch(e){} syncThemeOptUI(); }
function syncThemeOptUI(){ const cur = document.documentElement.getAttribute('data-theme'); document.getElementById('theme-opt-dark')?.classList.toggle('on', cur === 'dark'); document.getElementById('theme-opt-light')?.classList.toggle('on', cur === 'light'); }
syncThemeOptUI();
function showTab(i){document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('on',j===i));document.querySelectorAll('.tab-btn').forEach((t,j)=>t.classList.toggle('on',j===i));}
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>showTab(parseInt(btn.dataset.tab)));
  btn.addEventListener('touchend',e=>{e.preventDefault();showTab(parseInt(btn.dataset.tab));});
});
</script>
</body>
</html>`;

const savePath = `C:/Users/shinf/Workspace/data/analysis/청하터널-전압분석_${ts}.html`;
fs.writeFileSync(savePath, html, 'utf-8');
console.log('저장 완료:', savePath);
