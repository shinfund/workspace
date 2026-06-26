# krx_monitor_daily.ps1
# Daily monitor: checks KRX previous trading day data, notifies once per date

$API_KEY    = "1f471918ea495531eb3d5a2b59c1c7323f9af53aa6c957ea3b47127d766f47f8"
$TASK_NAME  = "KRX_DailyMonitor"
$LOG_FILE   = "C:\Users\shinf\workspace\scripts\krx_monitor_log.txt"
$STATE_FILE = "C:\Users\shinf\workspace\scripts\krx_monitor_state.txt"
$timestamp  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Previous trading day (skip weekends; holidays not handled)
function Get-PrevTradingDay {
    $day = (Get-Date).Date.AddDays(-1)
    while ($day.DayOfWeek -eq 'Saturday' -or $day.DayOfWeek -eq 'Sunday') {
        $day = $day.AddDays(-1)
    }
    return $day.ToString("yyyyMMdd")
}

# Windows tray balloon notification
function Send-BalloonTip {
    param([string]$Title, [string]$Msg)
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $icon = New-Object System.Windows.Forms.NotifyIcon
        $icon.Icon = [System.Drawing.SystemIcons]::Information
        $icon.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
        $icon.BalloonTipTitle = $Title
        $icon.BalloonTipText  = $Msg
        $icon.Visible = $true
        $icon.ShowBalloonTip(15000)
        Start-Sleep -Seconds 3
        $icon.Dispose()
    } catch {
        Add-Content $LOG_FILE "[$timestamp] NOTIFY(fallback): $Title - $Msg"
    }
}

$TARGET_DATE = Get-PrevTradingDay

# Skip if already notified for this date (prevent duplicate alerts)
$lastNotified = if (Test-Path $STATE_FILE) { (Get-Content $STATE_FILE -Raw).Trim() } else { "" }
if ($lastNotified -eq $TARGET_DATE) { exit 0 }

try {
    $url = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/" +
           "getStockPriceInfo?serviceKey=$API_KEY&numOfRows=3&pageNo=1" +
           "&resultType=json&basDd=$TARGET_DATE&mrktCls=KOSPI"

    $resp   = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30
    $items  = $resp.response.body.items.item
    $latest = if ($items) { $items[0].basDt } else { "none" }

    if ($latest -eq $TARGET_DATE) {
        Add-Content $LOG_FILE "[$timestamp] SUCCESS: $TARGET_DATE data available"

        # KRX 확정 데이터로 노션 거래대금DB 자동 패치
        $notionDate = "$($TARGET_DATE.Substring(0,4))-$($TARGET_DATE.Substring(4,2))-$($TARGET_DATE.Substring(6,2))"
        Add-Content $LOG_FILE "[$timestamp] 노션 거래대금DB 패치 시작 ($notionDate)..."
        try {
            $syncOut = & node "C:\Users\shinf\workspace\scripts\sync_krx_notion.mjs" --date $TARGET_DATE 2>&1
            $syncOut | ForEach-Object { Add-Content $LOG_FILE "[$timestamp]   $_" }
            Add-Content $LOG_FILE "[$timestamp] 노션 패치 완료"
            $patchMsg = "거래대금DB $notionDate 패치 완료"
        } catch {
            Add-Content $LOG_FILE "[$timestamp] WARN: 노션 패치 오류: $_"
            $patchMsg = "거래대금DB 패치 실패"
        }

        Send-BalloonTip `
            -Title "KRX Data Ready: $TARGET_DATE" `
            -Msg "KRX $TARGET_DATE 확정. $patchMsg"

        # Save notified date to prevent duplicate alerts
        Set-Content $STATE_FILE $TARGET_DATE -NoNewline
        Add-Content $LOG_FILE "[$timestamp] State saved: $TARGET_DATE"

        # Disable self — Stock_DailyUpdate (15:40) will re-enable tomorrow
        try {
            Disable-ScheduledTask -TaskName $TASK_NAME -ErrorAction Stop | Out-Null
            Add-Content $LOG_FILE "[$timestamp] Task disabled (will re-enable at 15:40)"
        } catch {
            Add-Content $LOG_FILE "[$timestamp] WARN: Could not disable task: $_"
        }

    } else {
        Add-Content $LOG_FILE "[$timestamp] Waiting: target=$TARGET_DATE, latest=$latest"
    }

} catch {
    Add-Content $LOG_FILE "[$timestamp] ERROR: $_"
}
