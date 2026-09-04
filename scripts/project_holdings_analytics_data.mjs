/**
 * project_holdings_analytics_data.mjs — 포트폴리오 앱(stock-portfolio.html) 보유종목 탭
 * "섹터별 요약·종목별 추세구조" 보강용 정적 데이터 생성.
 *
 * project_stock_watchlist_data.mjs의 loadHoldings()를 재사용해 종목별 섹터·EMA괴리율·추세구조만 뽑아낸다.
 * 가격/평가손익/전략 등 실시간성이 필요한 값은 포트폴리오 앱이 이미 Notion+KIS로 라이브 계산하므로
 * 여기서는 담지 않는다(중복·불일치 방지) — 이 스크립트는 EMA 계산에 필요한 종가 히스토리(Yahoo)만 담당.
 *
 * 출력: JSON 1개(stdout)
 * Usage: node project_holdings_analytics_data.mjs > holdings_analytics.json
 */
import { getToken } from './kis_api.mjs';
import { loadHoldings } from './project_stock_watchlist_data.mjs';

async function main() {
  const token = await getToken();
  const holdings = await loadHoldings(token);
  const round2 = v => v == null ? null : Math.round(v * 100) / 100;
  const rows = (holdings?.rows || []).map(r => ({
    code: r.code, sector: r.sector,
    ema: Object.fromEntries(Object.entries(r.ema || {}).map(([k, v]) => [k, round2(v)])),
    structure: r.structure,
  }));
  console.error(`[완료] 보유종목 분석데이터 ${rows.length}건`);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), rows }));
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
