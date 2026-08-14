import fs from 'fs';
import path from 'path';

// 청하터널(주) 인근(포항 청하면) 과거 기상 데이터 조회 — Open-Meteo 무료 아카이브 API(키 불필요)
// 사용법: node scripts/project_voltage_weather_fetch.mjs
// 시작일은 고속도로 개통일(2025-11-07) 이후 데이터 안정화 시점(2025-12-12)로 고정, 종료일은 실행 시점(오늘)까지 자동 확장

const LAT = 36.371, LON = 129.445;
const START_DATE = '2025-12-12';
const OUT_DIR = 'C:/Users/shinf/Workspace/data/전압분석';

const today = new Date();
const endDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${START_DATE}&end_date=${endDate}&daily=cloud_cover_mean,sunshine_duration,precipitation_sum,temperature_2m_mean&hourly=cloud_cover,shortwave_radiation&timezone=Asia%2FSeoul`;

const res = await fetch(url);
if (!res.ok) throw new Error(`weather fetch failed: ${res.status} ${res.statusText}`);
const data = await res.json();

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'weather_raw.json'), JSON.stringify(data));
console.log('saved', path.join(OUT_DIR, 'weather_raw.json'), `(${START_DATE} ~ ${endDate})`);
