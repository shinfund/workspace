# lotto_update_weekly.ps1 — 매주 월요일 자동 실행

$SCRIPT_DIR = "C:\Users\shinf\workspace\scripts"
$LOG_FILE   = "$SCRIPT_DIR\lotto_update_log.txt"
$timestamp  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$result = & node "$SCRIPT_DIR\lotto_auto_update.mjs" 2>&1 | ConvertFrom-Json
Add-Content $LOG_FILE "[$timestamp] $($result | ConvertTo-Json -Compress)"

if ($result.status -eq 'success') {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
    $notionMsg = if ($result.notion -eq 'ok') { " | 노션 동기화 완료" } else { " | 노션 실패" }
    $icon.BalloonTipTitle = "Lotto $($result.round)회차 업데이트 완료"
    $icon.BalloonTipText  = "번호: $($result.nums -join ' ') + $($result.bonus)$notionMsg"
    $icon.Visible = $true
    $icon.ShowBalloonTip(10000)
    Start-Sleep -Seconds 2
    $icon.Dispose()
} elseif ($result.status -eq 'waiting') {
    Add-Content $LOG_FILE "[$timestamp] $($result.round)회차 아직 미등록"
}
