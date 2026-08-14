// EMA200 기준선 파동 전략(stock-baseline) — "최근신호"·"예상종목" 탭용 라이브 데이터 생성 스크립트 (2026-08-13)
// project_baseline_strategy_backtest.mjs(확정 진입·청산 로직)와 동일한 규칙을 실시간(오늘 기준)으로 적용해
// ①최근 365일 내 발생한 진입 신호의 현재 상태(보유중/청산완료)와 ②아직 신호는 안 났지만 조건①(20거래일↑
// 기준선 이탈)을 충족한 관찰(워치) 후보종목을 산출해 HTML 조각 + JSON으로 출력한다.
// 사용법: node scripts/project_baseline_recent_signals.mjs [--days 365] [--chart-cap 10] [--watch-cap 8]
import https from 'https';
import fs from 'fs';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 시가총액 TOP50 (project_baseline_strategy_backtest.mjs와 동일 유니버스, 2026-08-03 KIS 기준)
const DEFAULT_STOCKS = [
  { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' },
  { code: '402340', name: 'SK스퀘어' }, { code: '009150', name: '삼성전기' },
  { code: '005380', name: '현대차' }, { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' }, { code: '032830', name: '삼성생명' },
  { code: '105560', name: 'KB금융' }, { code: '028260', name: '삼성물산' },
  { code: '000270', name: '기아' }, { code: '329180', name: 'HD현대중공업' },
  { code: '055550', name: '신한지주' }, { code: '012450', name: '한화에어로스페이스' },
  { code: '068270', name: '셀트리온' }, { code: '012330', name: '현대모비스' },
  { code: '034020', name: '두산에너빌리티' }, { code: '034730', name: 'SK' },
  { code: '086790', name: '하나금융지주' }, { code: '035420', name: 'NAVER' },
  { code: '006400', name: '삼성SDI' }, { code: '000810', name: '삼성화재' },
  { code: '010120', name: 'LS ELECTRIC' }, { code: '009540', name: 'HD한국조선해양' },
  { code: '066570', name: 'LG전자' }, { code: '042660', name: '한화오션' },
  { code: '005490', name: 'POSCO홀딩스' }, { code: '267260', name: 'HD현대일렉트릭' },
  { code: '316140', name: '우리금융지주' }, { code: '298040', name: '효성중공업' },
  { code: '015760', name: '한국전력' }, { code: '010130', name: '고려아연' },
  { code: '042700', name: '한미반도체' }, { code: '011200', name: 'HMM' },
  { code: '096770', name: 'SK이노베이션' }, { code: '006800', name: '미래에셋증권' },
  { code: '033780', name: 'KT&G' }, { code: '000150', name: '두산' },
  { code: '010140', name: '삼성중공업' }, { code: '051910', name: 'LG화학' },
  { code: '017670', name: 'SK텔레콤' }, { code: '035720', name: '카카오' },
  { code: '196170', name: '알테오젠', market: 'KOSDAQ' }, { code: '024110', name: '기업은행' },
  { code: '018260', name: '삼성에스디에스' }, { code: '267250', name: 'HD현대' },
  { code: '079550', name: 'LIG디펜스앤에어로스페이스' }, { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' }, { code: '010950', name: 'S-Oil' },
];

const ROLL = 250, MIN_STREAK = 20, Z_THRESHOLD = -1.25;
const FAST_PERIOD = 5, BASE_PERIOD = 200;
const MAX_BUY_LEGS = 2, RECOVER_TIMEOUT = 120, POST_RECOVER_HOLD = 60;
const CALENDAR_DAYS = 2555; // ROLL(250) 워밍업 + minStreak + 7년치 확보(백테스트와 동일)
const CHART_LEAD_DAYS = 15;

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { recentDays: 365, chartCap: 10, watchCap: 8 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') o.recentDays = parseInt(argv[++i]);
    if (argv[i] === '--chart-cap') o.chartCap = parseInt(argv[++i]);
    if (argv[i] === '--watch-cap') o.watchCap = parseInt(argv[++i]);
  }
  return o;
}

function httpGetJson(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: YF_HEADERS }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) return rej(new Error(`HTTP ${r.statusCode}`));
        try { res(JSON.parse(d)); } catch (e) { rej(new Error('파싱실패')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(20000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function fetchYahooChart(symbol, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await httpGetJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      return { ts, close: q.close || [] };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

function tsToKstDate(ts) {
  const d = new Date((ts + 9 * 3600) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function buildEma(closes, period) {
  const k = 2 / (period + 1);
  const emas = new Array(closes.length).fill(null);
  let ema = null;
  const seedBuf = [];
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (price == null) continue;
    if (ema === null) {
      seedBuf.push(price);
      if (seedBuf.length < period) continue;
      ema = seedBuf.reduce((a, b) => a + b, 0) / seedBuf.length;
    } else {
      ema = price * k + ema * (1 - k);
    }
    emas[i] = ema;
  }
  return emas;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr, m) { return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); }

// 반등신호(2026-08-14 vlow로 전환, 2026-08-14 2차수정: 스트릭 minStreak 도달 시점에 최저점 추적 리셋
// — 스트릭 미달 구간에서 소진된 반등을 무효 취급하지 않도록) — backtest 스크립트와 동일 로직
function buildVLowSignal(seq, streak, minStreak) {
  const sig = new Array(seq.length).fill(false);
  let runningLow = null;
  let awaitingBounce = false;
  for (let i = 0; i < seq.length; i++) {
    const belowBase = seq[i].close < seq[i].ema200;
    if (!belowBase) { runningLow = null; awaitingBounce = false; continue; }
    const justEligible = streak[i] === minStreak && (i === 0 || streak[i - 1] === minStreak - 1);
    if (justEligible) { runningLow = null; awaitingBounce = false; }
    if (runningLow === null || seq[i].close < runningLow) {
      runningLow = seq[i].close;
      awaitingBounce = true;
    }
    const crossUp5 = i > 0 && seq[i - 1].close < seq[i - 1].ema5 && seq[i].close >= seq[i].ema5;
    if (crossUp5 && awaitingBounce) {
      sig[i] = true;
      awaitingBounce = false;
    }
  }
  return sig;
}

async function batchAll(items, fn, concurrency = 5, delay = 150) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      if (delay) await new Promise(r => setTimeout(r, delay));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function rollingZStats(seq, j) {
  const win = seq.slice(j - ROLL + 1, j + 1).map(r => r.dev200);
  const m = mean(win), sd = stdev(win, m);
  const v = seq[j].dev200;
  return { z: sd ? (v - m) / sd : 0, mean: m, sd };
}

// 백테스트(project_baseline_strategy_backtest.mjs simulateTrade)와 동일 규칙을 "오늘"까지 실행해
// 진행 중(OPEN, 아직 미종결)이면 현재 상태를, 종결됐으면(CLOSED) 최종 사유를 반환한다.
function simulateLiveStatus(seq, i0) {
  let buyCount = 1;
  let costSum = seq[i0].close;
  let openWeight = 1.0;
  let recovered = false;
  let inWaveUp = false;
  let waveCount = 0;
  let minRet = 0;
  let recoverDay = null;
  const legs = [];
  const buyLog = [{ day: 0, price: seq[i0].close }];
  const signalLog = [{ day: 0, price: seq[i0].close }]; // 2026-08-14: max-buy-legs 상한 무관, 조건①②③ 충족일 전부 기록
  const lastIdx = seq.length - 1;

  for (let d = 1; ; d++) {
    const j = i0 + d;
    if (j > lastIdx) {
      const cur = seq[lastIdx];
      const avgCost = costSum / buyCount;
      const curRet = (cur.close - avgCost) / avgCost * 100;
      const closedWeighted = legs.reduce((a, l) => a + l.weight * l.ret, 0);
      const weightedSoFar = closedWeighted + openWeight * curRet;
      return {
        status: 'OPEN', day: lastIdx - i0, ret: weightedSoFar, legs, buyCount, buyLog, signalLog,
        recovered, waveCount, inWaveUp, minRet, recoverDay, avgCost, curClose: cur.close,
      };
    }
    const close = seq[j].close;
    const ema5 = seq[j].ema5;
    const ema200 = seq[j].ema200;

    if (!recovered) {
      const conditionMet = seq[j].bounce && rollingZStats(seq, j).z <= Z_THRESHOLD;
      if (conditionMet) signalLog.push({ day: d, price: close });
      if (buyCount < MAX_BUY_LEGS && conditionMet) {
        buyCount += 1;
        costSum += close;
        buyLog.push({ day: d, price: close });
      }
    }

    const avgCost = costSum / buyCount;
    const ret = (close - avgCost) / avgCost * 100;
    if (ret < minRet) minRet = ret;

    if (!recovered) {
      if (close >= ema200) {
        recovered = true;
        recoverDay = d;
        waveCount = 1;
        inWaveUp = close >= ema5;
      } else if (d >= RECOVER_TIMEOUT) {
        legs.push({ weight: openWeight, ret, reason: 'RECOVER_TIMEOUT', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'RECOVER_TIMEOUT', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
    } else {
      if (close < ema200) {
        legs.push({ weight: openWeight, ret, reason: 'BASELINE_BREAK', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'BASELINE_BREAK', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
      if (inWaveUp && close < ema5) {
        inWaveUp = false;
        if (waveCount === 1) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE1', day: d, date: seq[j].date });
          openWeight -= w;
        } else if (waveCount === 2) {
          const w = openWeight * 0.5;
          legs.push({ weight: w, ret, reason: 'WAVE2', day: d, date: seq[j].date });
          openWeight -= w;
        } else {
          legs.push({ weight: openWeight, ret, reason: 'WAVE3', day: d, date: seq[j].date });
          openWeight = 0;
          return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'WAVE3', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
        }
      } else if (!inWaveUp && close >= ema5) {
        inWaveUp = true;
        waveCount += 1;
      }
      if (openWeight > 1e-9 && d - recoverDay >= POST_RECOVER_HOLD) {
        legs.push({ weight: openWeight, ret, reason: 'TIME', day: d, date: seq[j].date });
        openWeight = 0;
        return { status: 'CLOSED', ret: legs.reduce((a, l) => a + l.weight * l.ret, 0), legs, finalDay: d, finalReason: 'TIME', buyCount, buyLog, signalLog, recovered, waveCount, minRet, recoverDay, entryDate: seq[i0].date };
      }
    }
  }
}

async function loadStock(stock) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - CALENDAR_DAYS * 24 * 3600;
  const symbol = stock.market === 'KOSDAQ' ? `${stock.code}.KQ` : `${stock.code}.KS`;

  const chart = await fetchYahooChart(symbol, p1, p2);
  if (!chart || !chart.ts.length) return { ...stock, error: '데이터 조회 실패', seq: null };

  const dates = chart.ts.map(tsToKstDate);
  const closes = chart.close;
  const ema5s = buildEma(closes, FAST_PERIOD);
  const ema200s = buildEma(closes, BASE_PERIOD);

  const seq = [];
  for (let i = 0; i < dates.length; i++) {
    if (closes[i] == null || ema5s[i] == null || ema200s[i] == null) continue;
    seq.push({
      date: dates[i], close: closes[i], ema5: ema5s[i], ema200: ema200s[i],
      dev200: (closes[i] - ema200s[i]) / ema200s[i] * 100,
    });
  }
  if (seq.length < ROLL + MIN_STREAK + 1) return { ...stock, error: '데이터 부족', seq: null };

  const streak = new Array(seq.length).fill(0);
  for (let i = 0; i < seq.length; i++) {
    streak[i] = seq[i].close < seq[i].ema200 ? (i > 0 ? streak[i - 1] + 1 : 1) : 0;
  }

  const bounceSig = buildVLowSignal(seq, streak, MIN_STREAK);
  for (let i = 0; i < seq.length; i++) seq[i].bounce = bounceSig[i];

  const flags = new Array(seq.length).fill(false);
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (i === 0) continue;
    const streakOk = streak[i] >= MIN_STREAK;
    const z = rollingZStats(seq, i).z;
    flags[i] = streakOk && seq[i].bounce && z <= Z_THRESHOLD;
  }
  const entries = [];
  for (let i = ROLL - 1; i < seq.length; i++) {
    if (flags[i] && !flags[i - 1]) entries.push({ i, date: seq[i].date });
  }
  return { ...stock, seq, streak, entries };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtV(n) { return Math.round(n).toLocaleString('ko-KR'); }
function fmt(v) { return v == null ? '─' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function retClass(n) { return n <= -25 ? 't-neg-hi' : n < 0 ? 't-neg' : n > 0 ? 't-pos' : 't-flat'; }

const REASON_LABEL = {
  BASELINE_BREAK: { cls: 'bdg-red', label: '기준선이탈매도' },
  RECOVER_TIMEOUT: { cls: 'bdg-purple', label: '회복실패시간청산' },
  TIME: { cls: 'bdg-purple', label: '회복후시간청산' },
  WAVE3: { cls: 'bdg-gray', label: '3파완주매도' },
};

function statusInfo(row) {
  const legs = row.legs || [];
  const hasWave1 = legs.some(l => l.reason === 'WAVE1');
  const hasWave2 = legs.some(l => l.reason === 'WAVE2');
  let primary;
  if (row.status === 'OPEN') {
    primary = { cls: 'bdg-teal', label: '보유중' };
  } else {
    primary = REASON_LABEL[row.finalReason] || { cls: 'bdg-gray', label: row.finalReason };
  }
  const subBadges = (hasWave1 ? '<span class="badge bdg-sky">1파매도</span> ' : '') + (hasWave2 ? '<span class="badge bdg-amber">2파매도</span> ' : '');
  let note = '';
  if (row.status === 'OPEN') {
    if (!row.recovered) note = `<span style="color:var(--txt3);font-size:12.5px">(회복 전 · 매수${row.buyCount}/${MAX_BUY_LEGS}회)</span>`;
    else if (hasWave2) note = `<span style="color:var(--txt3);font-size:12.5px">(2파매도완료(잔량25%) · ${row.waveCount}파 진행중)</span>`;
    else if (hasWave1) note = `<span style="color:var(--txt3);font-size:12.5px">(1파매도완료(잔량50%) · ${row.waveCount}파 진행중)</span>`;
    else note = `<span style="color:var(--txt3);font-size:12.5px">(회복후 보유100% · 1파 진행중)</span>`;
  }
  const day = row.status === 'OPEN' ? row.day : row.finalDay;
  return { primary, subBadges, note, day };
}

// 2026-08-14: max-buy-legs(2회) 상한과 무관하게 조건①②③ 충족일 전체를 표시 — 실제 체결된 건(굵게)과
// 상한 초과로 신호만 발생하고 체결되지 않은 건(연하게 "신호만")을 구분 표기
function signalDatesLabel(signalDates) {
  if (!signalDates || signalDates.length < 1) return '';
  const legLabel = { 1: '1차', 2: '2차', 3: '3차', 4: '4차', 5: '5차', 6: '6차' };
  const parts = signalDates.map(b => {
    const tag = legLabel[b.leg] || `${b.leg}차`;
    return b.executed
      ? `${tag} ${b.date}(${fmtV(b.price)})`
      : `<span style="opacity:.65">${tag}(신호만) ${b.date}(${fmtV(b.price)})</span>`;
  });
  return `<div style="color:var(--txt3);font-size:12.5px;margin-top:3px">신호: ${parts.join(' &middot; ')}</div>`;
}

// 2026-08-14: "진행상황" 단일 컬럼에 상태·경과일·수익률·매수현황·신호일자가 다 뭉쳐 있어 컬럼 분리(사용자 요청)
function tableRowHtml(row) {
  const s = statusInfo(row);
  const statusCell = `<span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges ? ' ' + s.subBadges.trim() : ''}`;
  const noteCell = s.note ? s.note.replace(/^<span/, '<span').trim() : '<span class="t-flat">&mdash;</span>';
  const signalCell = row.signalDates && row.signalDates.length ? signalDatesLabel(row.signalDates).replace(/^<div[^>]*>|<\/div>$/g, '') : '<span class="t-flat">&mdash;</span>';
  return `          <tr><td class="l">${row.date}</td><td class="l">${esc(row.name)}</td><td>${fmtV(row.entryClose)}</td><td class="l">${statusCell}</td><td class="c">D+${s.day}</td><td class="${retClass(row.ret)}">${fmt(row.ret)}</td><td class="l">${noteCell}</td><td class="l">${signalCell}</td></tr>`;
}

function buildChartSvg(rows, markers) {
  const x0 = 6, x1 = 474, yTop = 12, yBot = 208;
  const n = rows.length;
  const xAt = i => x0 + (x1 - x0) * i / (n - 1);
  const allVals = [];
  rows.forEach(r => allVals.push(r.close, r.ema5, r.ema200));
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || hi * 0.02;
  const yLo = lo - pad, yHi = hi + pad;
  const yAt = v => yBot - (yBot - yTop) * (v - yLo) / (yHi - yLo);
  const poly = (key, color, dash, width) => `<polyline points="${rows.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--${color})" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  let svg = poly('ema200', 'amber', '6,3', 1.8) + poly('ema5', 'sky', '2,2', 1.8) + poly('close', 'txt', null, 1.7);
  if (markers?.entryIdx != null && markers.entryIdx >= 0) {
    const ei = markers.entryIdx;
    svg += `<line x1="${xAt(ei).toFixed(1)}" y1="${yTop}" x2="${xAt(ei).toFixed(1)}" y2="${yBot}" stroke="var(--txt2)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<circle cx="${xAt(ei).toFixed(1)}" cy="${yAt(rows[ei].close).toFixed(1)}" r="4" fill="var(--sky600)" stroke="var(--card)" stroke-width="1.2"/>`;
  }
  if (markers?.buyLog) {
    for (const b of markers.buyLog) {
      if (b.day === 0) continue; // 최초 매수는 entryIdx 점으로 이미 표시
      const idx = markers.entryIdx + b.day - markers.windowStart;
      if (idx >= 0 && idx < n) svg += `<circle cx="${xAt(idx).toFixed(1)}" cy="${yAt(rows[idx].close).toFixed(1)}" r="3.5" fill="var(--purple)" stroke="var(--card)" stroke-width="1"/>`;
    }
  }
  svg += `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(rows[n - 1].close).toFixed(1)}" r="4.5" fill="var(--red)" stroke="var(--card)" stroke-width="1.3"/>`;
  svg += `<text x="${x0}" y="214" font-size="13.5" fill="var(--txt)">${rows[0].date}</text><text x="${x1}" y="214" font-size="13.5" fill="var(--txt)" text-anchor="end">${rows[n - 1].date}</text>`;
  return `<svg viewBox="0 0 480 220" width="100%" height="220" style="display:block;max-width:100%">\n    ${svg}\n  </svg>`;
}

function signalChartCardHtml(row, seq, entryIdx) {
  const windowStart = Math.max(0, entryIdx - CHART_LEAD_DAYS);
  const chartRows = seq.slice(windowStart, seq.length);
  const localEntryIdx = entryIdx - windowStart;
  const svg = buildChartSvg(chartRows, { entryIdx: localEntryIdx, buyLog: row.buyLog, windowStart, entryIdxGlobal: entryIdx });
  const s = statusInfo(row);
  const cur = seq[seq.length - 1];
  const recovLabel = row.recovered ? `회복(D+${row.recoverDay})` : '회복전';
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(row.name)}</span><span class="badge ${s.primary.cls}">${s.primary.label}</span>${s.subBadges.trim()}</div>
        ${svg}
        <div class="chart-card-stats">
          <span>진입일 ${row.date} <span class="sep">|</span> 진입가 <span>${fmtV(row.entryClose)}</span> <span class="sep">|</span> 현재가 <span>${fmtV(cur.close)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>D+${s.day} <span class="sep">|</span> 수익률(가중) <span class="${retClass(row.ret)}">${fmt(row.ret)}</span> <span class="sep">|</span> 매수 ${row.buyCount}/${MAX_BUY_LEGS}회</span>
        </div>
        <div class="chart-card-stats">
          <span>${recovLabel}</span>
        </div>
        <div class="chart-card-stats">
          <span>신호일 ${(row.signalDates || []).map(b => b.executed ? `${b.leg}차 ${b.date}(${fmtV(b.price)})` : `<span style="opacity:.65">${b.leg}차(신호만) ${b.date}(${fmtV(b.price)})</span>`).join(' <span class="sep">|</span> ')}</span>
        </div>
        <div class="chart-card-legend"><span><i style="background:var(--sky600)"></i>진입/추가매수</span><span><i style="background:var(--${s.primary.cls === 'bdg-red' ? 'red' : s.primary.cls === 'bdg-purple' ? 'purple' : s.primary.cls === 'bdg-teal' ? 'teal' : 'gray600'})"></i>상태 <span>${s.primary.label}</span></span></div>
      </div>`;
}

function watchRowHtml(r) {
  const seq = r.seq;
  const last = seq.length - 1;
  const cur = seq[last];
  const zs = rollingZStats(seq, last);
  const zHit = zs.z <= Z_THRESHOLD;
  const badge = zHit ? '<span class="badge bdg-amber">Z충족&middot;돌파대기</span>' : '<span class="badge bdg-gray">관찰</span>';
  return `          <tr><td class="l">${esc(r.name)}</td><td>${fmtV(cur.close)}</td><td>${fmtV(cur.ema200)}</td><td class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</td><td>${zs.z.toFixed(2)}</td><td class="c">${r.curStreak}일</td><td class="c">${badge}</td></tr>`;
}

function watchChartCardHtml(r) {
  const seq = r.seq;
  const last = seq.length - 1;
  const cur = seq[last];
  const zs = rollingZStats(seq, last);
  const zHit = zs.z <= Z_THRESHOLD;
  const aboveEma5 = cur.close >= cur.ema5;
  const targetDev = Z_THRESHOLD * zs.sd + zs.mean;
  const targetPrice = cur.ema200 * (1 + targetDev / 100);
  const windowStart = Math.max(0, last - 250);
  const chartRows = seq.slice(windowStart, seq.length);
  const svg = buildChartSvg(chartRows, {});
  const badge = zHit ? { cls: 'bdg-amber', label: 'Z충족·돌파대기' } : { cls: 'bdg-gray', label: '관찰' };
  return `      <div class="chart-card">
        <div class="chart-card-head"><span class="chart-card-name">${esc(r.name)}</span><span class="badge ${badge.cls}">${badge.label}</span></div>
        ${svg}
        <div class="chart-card-stats">
          <span>현재가 <span>${fmtV(cur.close)}</span> <span class="sep">|</span> 기준선(EMA200) <span>${fmtV(cur.ema200)}</span> <span class="sep">|</span> 이탈 <b>${r.curStreak}거래일째</b></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA200괴리 <span class="${retClass(cur.dev200)}">${fmt(cur.dev200)}</span> <span class="sep">|</span> 롤링Z <span>${zs.z.toFixed(2)}</span> <span class="sep">|</span> Z≤${Z_THRESHOLD} 예상가 <span>${fmtV(targetPrice)}</span></span>
        </div>
        <div class="chart-card-stats">
          <span>EMA5 <span>${fmtV(cur.ema5)}</span> <span class="sep">|</span> 종가-EMA5 관계 <b>${aboveEma5 ? 'EMA5 위(상향돌파 완료 대기)' : 'EMA5 아래(상향돌파 대기)'}</b></span>
        </div>
        <div class="chart-card-legend"><span><i style="border-color:var(--txt)"></i>종가</span><span><i class="dash" style="border-color:var(--sky)"></i>EMA5</span><span><i class="dash" style="border-color:var(--amber)"></i>EMA200(기준선)</span></div>
      </div>`;
}

async function main() {
  const opts = parseArgs();
  console.error(`[기준선 전략 최근신호/예상종목 산출] recentDays=${opts.recentDays} chartCap=${opts.chartCap} watchCap=${opts.watchCap}`);

  const loaded = await batchAll(DEFAULT_STOCKS, s => loadStock(s));
  const valid = loaded.filter(r => !r.error);
  const errors = loaded.filter(r => r.error).map(r => `${r.name}: ${r.error}`);
  if (errors.length) console.error(`[조회실패] ${errors.join(', ')}`);

  const cutoffMs = Date.now() - opts.recentDays * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  // ── 최근신호 ──────────────────────────────────────────
  // 종목당 실제로는 동시에 1사이클만 보유 가능(재진입 없음)하므로, 같은 종목이 아직 보유중인 동안
  // 발생한 후속 rising-edge는 "새 진입"이 아니라 같은 사이클의 잡음(휩쏘)이다 — 시계열 순서대로
  // 걸으며 이전 사이클이 청산(CLOSED)되기 전까지 발생한 신규 신호는 건너뛴다(중복표시 방지).
  function primaryEntriesForStock(seq, entries) {
    const primary = [];
    let nextAllowedIdx = -Infinity;
    for (const e of entries) {
      if (e.i < nextAllowedIdx) continue;
      const status = simulateLiveStatus(seq, e.i);
      primary.push({ ...e, status });
      nextAllowedIdx = status.status === 'OPEN' ? Infinity : e.i + status.finalDay + 1;
    }
    return primary;
  }

  const rows = [];
  const rowMeta = [];
  for (const r of valid) {
    const primary = primaryEntriesForStock(r.seq, r.entries);
    for (const e of primary) {
      if (e.date < cutoffDate) continue;
      const buyDays = new Set(e.status.buyLog.map(b => b.day));
      const signalDates = (e.status.signalLog || e.status.buyLog).map((b, idx) => ({ leg: idx + 1, date: r.seq[e.i + b.day].date, price: b.price, executed: buyDays.has(b.day) }));
      const buyDates = e.status.buyLog.map((b, idx) => ({ leg: idx + 1, date: r.seq[e.i + b.day].date, price: b.price }));
      rows.push({ date: e.date, name: r.name, code: r.code, entryClose: r.seq[e.i].close, buyDates, signalDates, ...e.status });
      rowMeta.push({ seq: r.seq, entryIdx: e.i });
    }
  }
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date < rows[b].date ? 1 : rows[a].date > rows[b].date ? -1 : 0);
  const sortedRows = order.map(i => rows[i]);
  const sortedMeta = order.map(i => rowMeta[i]);

  const closed = sortedRows.filter(x => x.status === 'CLOSED');
  const open = sortedRows.filter(x => x.status === 'OPEN');
  const wins = closed.filter(x => x.ret > 0).length;

  const tableHtml = sortedRows.map(tableRowHtml).join('\n');
  const chartRowsForCards = sortedRows.slice(0, opts.chartCap);
  const chartMetaForCards = sortedMeta.slice(0, opts.chartCap);
  const chartCardsHtml = chartRowsForCards.map((row, i) => signalChartCardHtml(row, chartMetaForCards[i].seq, chartMetaForCards[i].entryIdx)).join('\n');

  // ── 예상종목(워치 후보) ────────────────────────────────
  // 오늘 이미 신규 신호가 뜬 종목(streak[last]는 회복 로직상 0이 될 수 있어 자연 제외됨)은
  // 최근신호에 이미 포함되므로 워치 리스트에서 자연히 배제된다.
  const openNames = new Set(open.map(r => r.name)); // 이미 이 전략으로 보유중인 종목은 워치 리스트에서 제외(중복 방지)
  const watchCandidates = [];
  for (const r of valid) {
    if (openNames.has(r.name)) continue;
    const seq = r.seq;
    const last = seq.length - 1;
    const curStreak = r.streak[last];
    if (curStreak < MIN_STREAK) continue;
    const zs = rollingZStats(seq, last);
    watchCandidates.push({ ...r, curStreak, curZ: zs.z });
  }
  watchCandidates.sort((a, b) => a.curZ - b.curZ);
  const watchTop = watchCandidates.slice(0, opts.watchCap);
  const watchChartsHtml = watchTop.map(watchChartCardHtml).join('\n');
  const watchTableHtml = watchTop.map(watchRowHtml).join('\n');
  const watchZHitCount = watchCandidates.filter(r => r.curZ <= Z_THRESHOLD).length;

  const fs2 = fs;
  fs2.writeFileSync('baseline_signals_table.html', tableHtml, 'utf-8');
  fs2.writeFileSync('baseline_signals_charts.html', chartCardsHtml, 'utf-8');
  fs2.writeFileSync('baseline_watch_charts.html', watchChartsHtml, 'utf-8');
  fs2.writeFileSync('baseline_watch_table.html', watchTableHtml, 'utf-8');
  console.error(`[산출완료] table→baseline_signals_table.html, charts→baseline_signals_charts.html, watch→baseline_watch_charts.html, watchTable→baseline_watch_table.html`);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), cutoffDate,
    signals: { total: sortedRows.length, openCount: open.length, closedCount: closed.length, closedWinRate: closed.length ? (wins / closed.length * 100) : null },
    watch: { total: watchCandidates.length, zHitCount: watchZHitCount, notYetCount: watchCandidates.length - watchZHitCount },
    watchNames: watchTop.map(r => ({ name: r.name, streak: r.curStreak, z: r.curZ })),
    signalNames: sortedRows.map(r => ({ date: r.date, name: r.name, status: r.status, ret: r.ret })),
  }, null, 2));
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
