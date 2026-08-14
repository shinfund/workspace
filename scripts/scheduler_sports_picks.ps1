# scheduler_sports_picks.ps1
# KBO/NPB 스포츠픽 분석 자동 실행 (scheduler-only)
#
# 트리거: 매일 12:00, 15:00 (화~일, 월요일 제외 - KBO 경기 없음)
# 실행 시각 결정: 평일(비공휴일) 15:00 / 주말·공휴일 12:00
#   -> 두 트리거 모두 걸어두고, 실행 시점에 "지금이 목표 시각인지" 판정 후 아니면 skip

$logDir     = "C:\Users\shinf\Workspace\logs"
$logFile    = "$logDir\sports_picks.log"
$outputFile = "$logDir\sports_picks_output.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

$now   = Get-Date
$dow   = $now.DayOfWeek
$hour  = $now.Hour
$today = Get-Date -Format "yyyyMMdd"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# KBO 비경기일: 매주 월요일
if ($dow -eq 'Monday') {
    Add-Content $logFile "[$stamp] Monday - KBO 경기 없음, skip"
    exit 0
}

# KBO 공휴일 (2026, 2027 잠정 - 매년 말 재확인 필요)
$holidays = @(
    "20260101",
    "20260216","20260217","20260218",
    "20260302",
    "20260501",
    "20260505",
    "20260525",
    "20260603",
    "20260717",
    "20260817",
    "20260924","20260925",
    "20261005",
    "20261009",
    "20261225",
    "20270101",
    "20270206","20270207","20270208",
    "20270301",
    "20270505","20270513",
    "20270816",
    "20270914","20270915","20270916",
    "20271003","20271004",
    "20271009",
    "20271225"
)

$isWeekend  = ($dow -eq 'Saturday' -or $dow -eq 'Sunday')
$isHoliday  = $holidays -contains $today
$targetHour = if ($isWeekend -or $isHoliday) { 12 } else { 15 }

if ($hour -ne $targetHour) {
    Add-Content $logFile "[$stamp] 현재 ${hour}시 - 목표(${targetHour}시, 주말=$isWeekend 공휴일=$isHoliday) 아님, skip"
    exit 0
}

Add-Content $logFile "[$stamp] === 스포츠픽 분석 시작 (목표 ${targetHour}시, 주말=$isWeekend 공휴일=$isHoliday) ==="

$todayIso = Get-Date -Format "yyyy-MM-dd"
$prompt = @"
오늘 날짜는 $todayIso 입니다. /sports-picks 스킬로 오늘 KBO 경기를 분석하고, 이어서 오늘 NPB 경기를 분석해줘.
스킬 절차(일정수집→팀현황→선발투수→타선→불펜→상대전적→구장특성→날씨→부상자→자체검증)를 그대로 따르고,
클라리파잉 질문 없이 바로 진행해줘 (자동 스케줄 실행이므로 리그명/날짜는 이미 확정됨).

분석 완료 후 html-report-design 패턴(고정헤더+탭+KPI카드+반응형)으로 HTML 리포트를 만들어서
C:\Users\shinf\Workspace\data\analysis\ 폴더에 sports-picks_$( Get-Date -Format 'yyyyMMddHHmm' ).html 파일명으로 저장해줘.
탭 구성: KBO, NPB.
"@

$claudeExe = "C:\Users\shinf\AppData\Roaming\npm\claude.ps1"
& $claudeExe -p $prompt --allowedTools "Skill,WebSearch,WebFetch,Read,Write,Bash,PowerShell" --output-format text *>> $outputFile

$exitCode = $LASTEXITCODE
$stamp2   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "[$stamp2] === 스포츠픽 분석 종료 (exit $exitCode) ==="
