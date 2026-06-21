param([int]$StartIndex = -1)

$downloadPath = "C:\Users\shinf\Downloads"
$logDir       = "C:\Users\shinf\workspace\data"
$logFile      = Join-Path $logDir ("krx_rename_" + (Get-Date -Format "yyyyMMdd") + ".log")
$processed    = @{}
$renamedCount = 0

function Write-Log($msg) {
    Write-Output $msg
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" -Encoding UTF8
}

# 2026 KRX holidays (confirmed - calendar skill)
$h2026 = @(
    "20260101",
    "20260216","20260217","20260218",
    "20260301","20260302",
    "20260501","20260505","20260524","20260525",
    "20260603","20260606",
    "20260717",
    "20260815","20260817",
    "20260924","20260925","20260926",
    "20261003","20261005","20261009",
    "20261225"
)

# 2027 KRX holidays (tentative - verify Dec 2026 via calendar skill)
# NOTE: 제헌절(7/17) 2027 포함 여부 미확정 -> 확정 후 추가
# NOTE: 설날(2/7 일요일) 대체공휴일 여부 -> 2/9 추가 필요할 수 있음
$h2027 = @(
    "20270101",
    "20270206","20270207","20270208",
    "20270301",
    "20270505","20270513",
    "20270816",
    "20270914","20270915","20270916",
    "20271003","20271004","20271009",
    "20271225"
)

$holidays = $h2026 + $h2027

# Trading days: 2026-01-01 ~ 2027-12-31
$tradingDays = @()
$d   = [datetime]"2026-01-01"
$end = [datetime]"2027-12-31"
while ($d -le $end) {
    $dow = $d.DayOfWeek.ToString()
    $ds  = $d.ToString("yyyyMMdd")
    if ($dow -ne "Saturday" -and $dow -ne "Sunday" -and $holidays -notcontains $ds) {
        $tradingDays += $ds
    }
    $d = $d.AddDays(1)
}

$prefix = "거래대금"

# Auto-resume
$index = 0
if ($StartIndex -ge 0) {
    $index = $StartIndex
    Write-Log "[RESUME] Manual start index=$index ($($tradingDays[$index]))"
} else {
    $existingDates = @(
        Get-ChildItem $downloadPath -Filter "*.xlsx" -ErrorAction SilentlyContinue |
        ForEach-Object { if ($_.Name -match "_(\d{8})\.xlsx$") { $matches[1] } } |
        Where-Object { $tradingDays -contains $_ } |
        Sort-Object
    )
    if ($existingDates.Count -gt 0) {
        $lastDate = $existingDates[-1]
        $lastIdx  = [array]::IndexOf($tradingDays, $lastDate)
        $index    = $lastIdx + 1
        Write-Log "[RESUME] Existing: $($existingDates.Count) files | Last: $lastDate -> next: $($tradingDays[$index])"
    } else {
        Write-Log "[NEW] Starting fresh from $($tradingDays[0])"
    }
}

$cnt2026 = ($tradingDays | Where-Object { $_ -like "2026*" }).Count
$cnt2027 = ($tradingDays | Where-Object { $_ -like "2027*" }).Count

Write-Log "[START] KRX rename watcher"
Write-Log "[INFO]  Folder : $downloadPath"
Write-Log "[INFO]  Range  : $($tradingDays[0]) ~ $($tradingDays[-1]) ($($tradingDays.Count) days)"
Write-Log "[INFO]  2026: ${cnt2026}d (confirmed) | 2027: ${cnt2027}d (tentative)"
Write-Log "[WARN]  2027 holidays are tentative - verify in Dec 2026"
Write-Log "[INFO]  Log    : $logFile"
Write-Log "--------------------------------------------"

try {
    while ($true) {
        $candidates = Get-ChildItem $downloadPath -Filter "*.xlsx" -ErrorAction SilentlyContinue
        foreach ($f in ($candidates | Sort-Object CreationTime)) {
            if ($f.Name -notmatch "^data_\d+_\d{8}\.xlsx$") { continue }
            if ($processed.ContainsKey($f.Name)) { continue }
            if ($index -ge $tradingDays.Count) {
                Write-Log "[ERROR] Trading day list exhausted - update script"
                break
            }
            $td      = $tradingDays[$index]
            $newName = "${prefix}_${td}.xlsx"
            $dest    = Join-Path $downloadPath $newName

            if (Test-Path $dest) {
                Write-Log "[SKIP]  $newName already exists - skipping $($f.Name)"
                $processed[$f.Name] = $true
                $index++
                continue
            }

            $ok = $false
            try {
                Rename-Item -Path $f.FullName -NewName $newName -ErrorAction Stop
                $ok = $true
            } catch { $ok = $false }

            if ($ok) {
                $renamedCount++
                Write-Log "[OK]    #$($index+1) $($f.Name) -> $newName"
                $processed[$f.Name] = $true
                $index++
            }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Log "--------------------------------------------"
    Write-Log "[DONE]  Renamed: ${renamedCount} files | Next index: $index"
    if ($index -gt 0) { Write-Log "[DONE]  Last processed: $($tradingDays[$index-1])" }
}