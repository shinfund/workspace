# backfill_krx_notion.ps1
# 노션 거래대금DB의 과거 날짜 전체에 KRX 확정 데이터 소급 패치
# Usage: .\backfill_krx_notion.ps1

$env:NOTION_TOKEN = [System.Environment]::GetEnvironmentVariable("NOTION_TOKEN", "User")

# 소급 대상 날짜 (YYYYMMDD) — 6/25는 이미 처리 완료
$DATES = @(
    "20260522",
    "20260526",
    "20260527",
    "20260528",
    "20260529",
    "20260619",
    "20260622",
    "20260623",
    "20260624"
)

$SCRIPT = "C:\Users\shinf\workspace\scripts\sync_krx_notion.mjs"
$total  = $DATES.Count
$idx    = 0

foreach ($date in $DATES) {
    $idx++
    $notionDate = "$($date.Substring(0,4))-$($date.Substring(4,2))-$($date.Substring(6,2))"
    Write-Host ""
    Write-Host "[$idx/$total] $notionDate 처리 중..." -ForegroundColor Cyan
    & node $SCRIPT --date $date
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [경고] $notionDate 오류 (exit $LASTEXITCODE)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "====== 소급 완료 ($total 날짜) ======" -ForegroundColor Green
