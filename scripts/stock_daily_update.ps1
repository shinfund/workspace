# stock_daily_update.ps1
# KRX trading day 15:40 scheduler launcher

$env:NOTION_TOKEN      = [System.Environment]::GetEnvironmentVariable("NOTION_TOKEN",      "User")
$env:MY_ANTHROPIC_API_KEY = [System.Environment]::GetEnvironmentVariable("MY_ANTHROPIC_API_KEY", "User")

$logDir  = "C:\Users\shinf\Workspace\logs"
$logFile = "$logDir\stock_daily_update.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

$stamp = Get-Date -Format "HH:mm:ss"
$today = Get-Date -Format "yyyyMMdd"
$dow   = (Get-Date).DayOfWeek

# KRX non-trading days (2026 confirmed / 2027 tentative - re-verify Dec 2026)
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

if ($dow -eq 'Saturday' -or $dow -eq 'Sunday') {
    Add-Content $logFile "[$stamp] Weekend ($dow) - skip"
    exit 0
}
if ($holidays -contains $today) {
    Add-Content $logFile "[$stamp] Holiday ($today) - skip"
    exit 0
}

Add-Content $logFile "[$stamp] === Launcher start ==="

node "C:\Users\shinf\workspace\scripts\stock_daily_update.mjs"

$exitCode = $LASTEXITCODE
$stamp2   = Get-Date -Format "HH:mm:ss"
Add-Content $logFile "[$stamp2] === Launcher end (exit $exitCode) ==="

# Re-enable KRX_DailyMonitor for next morning data check
try {
    Enable-ScheduledTask -TaskName "KRX_DailyMonitor" -ErrorAction Stop | Out-Null
    Add-Content $logFile "[$stamp2] KRX_DailyMonitor re-enabled"
} catch {
    Add-Content $logFile "[$stamp2] WARN: Could not re-enable KRX_DailyMonitor: $_"
}
