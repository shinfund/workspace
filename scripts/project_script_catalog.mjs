/**
 * project_script_catalog.mjs — 주식 스크립트 목록표 (관리용 카탈로그)
 *
 * scripts/ 폴더에 시세표·현황표·결과표류 스크립트가 계속 늘어나(2026-08-27 기준 150개 이상,
 * 대부분은 전략 개발용 _backtest/_sweep/_grid) 뭐가 뭔지 헷갈린다는 요청으로 신설.
 * 실제로 "수시 조회·관리"하는 스크립트만 카테고리별로 큐레이션해 보여준다(전체 자동 스캔 아님).
 *
 * 관리 방법: 새 시세표/현황표/결과표 스크립트를 만들면 하단 CATALOG 배열에 항목을 직접 추가한다.
 *
 * Usage: node project_script_catalog.mjs
 */

const CATALOG = [
  {
    category: '1. 시세표 (지수·개별종목, 수시 조회용)',
    items: [
      { script: 'project_index_quote_table.mjs', desc: '지수 시세표 — 코스피·코스닥·S&P500·나스닥·다우·필라델피아반도체·VIX·원달러, EMA5/20/50/100/200' },
      { script: 'project_stock_quote_ema_table.mjs', desc: '개별종목 시세표 — EMA5/20/50/100/200 괴리율, 돌파▲▼' },
      { script: 'kis_api.mjs', desc: '거래대금·시총·등락률 등 순위표 (일반 프롬프트 기본 실행 스크립트)' },
    ],
  },
  {
    category: '2. 보유종목 현황표',
    items: [
      { script: 'project_holdings_quote_table.mjs', desc: '보유종목 현황표 — 손익률 내림차순, data/holdings.json 기반' },
      { script: 'holdings_report.mjs', desc: '보유종목 포트폴리오 분석 HTML 리포트(25일선 엔벨로프 4탭)' },
      { script: 'project_baseline_holdings_check.mjs', desc: '기준선(EMA200) 전략 관점 보유종목 점검 (stock-portal 반영용)' },
      { script: 'project_roundnumber_holdings_table_refresh.mjs', desc: '라운드넘버 보유종목 탭 표+차트 갱신 (stock-portal 반영용)' },
      { script: 'project_pullback_holdings_candidates.mjs', desc: '눌림목 예상종목+보유종목 탭 데이터 (stock-portal 반영용)' },
      { script: 'project_deviation_holdings_candidates.mjs', desc: '괴리율 예상종목+보유종목 탭 데이터 (stock-portal 반영용)' },
    ],
  },
  {
    category: '3. 당일매매·최근신호 결과표',
    items: [
      { script: 'project_daily_trade_report.mjs', desc: '당일매매DB 일자별 결과표 ("week" 인자로 주간요약도 가능)' },
      { script: 'project_portfolio3_entry_scan.mjs', desc: '3전략(눌림목+괴리율+라운드넘버) 통합 — 오늘 진입신호 스캔' },
      { script: 'project_portfolio3_exit_check.mjs', desc: '3전략 통합 — 보유종목 강제청산 체크' },
      { script: 'project_pullback_recent_signals.mjs', desc: '눌림목 최근신호 (stock-portal 반영용)' },
      { script: 'project_deviation_recent_signals.mjs', desc: '괴리율 최근신호 (stock-portal 반영용)' },
      { script: 'project_roundnumber_recent_signals.mjs', desc: '라운드넘버 지금 감시할 레벨 스캔' },
      { script: 'project_roundnumber_recent_trades.mjs', desc: '라운드넘버 최근 진입 트레이드 목록' },
      { script: 'project_baseline_recent_signals.mjs', desc: '기준선 최근신호+예상종목 (stock-portal 반영용)' },
    ],
  },
  {
    category: '4. stock-portal 앱 반영 전용 파이프라인 (직접 조회용 아님, HTML 스플라이스)',
    items: [
      { script: 'project_roundnumber_tabs_refresh.mjs', desc: '라운드넘버 최근신호·예상종목 탭 통째 재생성' },
      { script: 'project_roundnumber_holdings_chart_refresh.mjs', desc: '라운드넘버 보유종목 차트카드 갱신' },
      { script: 'project_roundnumber_chart_cards.mjs', desc: '라운드넘버 3탭 차트카드 SVG 생성' },
      { script: 'project_roundnumber_signal_curprice.mjs', desc: '최근신호 탭에 현재가 컬럼만 추가' },
    ],
  },
  {
    category: '5. 통계·분석 (표는 아니지만 매일·자주 사용)',
    items: [
      { script: 'project_multi_stock_deviation_stats.mjs', desc: '★매일 사용★ 다종목 EMA 괴리율 통계 비교' },
      { script: 'project_stock_deviation_stats.mjs', desc: '단일종목 EMA25 괴리율 통계' },
      { script: '20ma_analysis.mjs', desc: '거래대금 TOP10 25일선 괴리율 분석 (HTML 출력)' },
    ],
  },
];

function main() {
  const total = CATALOG.reduce((a, g) => a + g.items.length, 0);
  const nameWidth = Math.max(...CATALOG.flatMap(g => g.items.map(i => i.script.length))) + 2;

  console.log(`\n스크립트 목록표 (관리용 카탈로그, 총 ${total}개)`);
  for (const group of CATALOG) {
    console.log(`\n=== ${group.category} ===`);
    for (const item of group.items) {
      console.log(`  ${item.script.padEnd(nameWidth)}${item.desc}`);
    }
  }
  console.log(`\n※ 이 목록은 수동 큐레이션입니다 — 새 시세표/현황표/결과표 스크립트 추가 시 이 파일의 CATALOG 배열도 함께 갱신하세요.`);
  console.log(`※ 전략 개발용 백테스트/스윕/그리드서치 스크립트(_backtest, _sweep, _grid 등)는 목록에서 제외했습니다.\n`);
}

main();
