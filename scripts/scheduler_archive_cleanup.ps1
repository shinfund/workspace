# scheduler_archive_cleanup.ps1
# 1) 메인 폴더(archive 서브폴더를 가진 폴더): 슬러그별 최신 3개만 남기고 나머지는 archive 서브폴더로 이동
# 2) archive 폴더(파일 버전관리용) 정리 - 슬러그(파일명 접두사)별 최신 3개 버전만 남기고 나머지 삭제
# 매일 자동 실행 (scheduler-only)
#
# 대상: C:\Users\shinf\Workspace 하위의 이름이 "archive"인 모든 폴더 (node_modules 제외) + 그 부모 폴더
# 파일명 규칙: {slug}_YYYYMMDDHHmm.{ext}  (글로벌 CLAUDE.md 버전관리 규칙)

param(
    [switch]$DryRun
)

$root    = "C:\Users\shinf\Workspace"
$logDir  = "C:\Users\shinf\Workspace\logs"
$logFile = "$logDir\archive_cleanup.log"
$keep    = 3

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$mode  = if ($DryRun) { " (DRY-RUN)" } else { "" }
Add-Content $logFile "[$stamp] === Archive cleanup start$mode ==="

$archiveDirs = Get-ChildItem -Path $root -Directory -Recurse -Filter "archive" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' }

$totalMoved = 0

foreach ($dir in $archiveDirs) {
    $mainDir = $dir.Parent.FullName

    $mainFiles = Get-ChildItem -Path $mainDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match '^(.+)_(\d{12})$' }

    if (-not $mainFiles) { continue }

    $mainGroups = $mainFiles | ForEach-Object {
        $null = $_.BaseName -match '^(.+)_(\d{12})$'
        [PSCustomObject]@{
            Slug      = $matches[1]
            Timestamp = $matches[2]
            File      = $_
        }
    } | Group-Object Slug

    foreach ($g in $mainGroups) {
        $sorted = $g.Group | Sort-Object Timestamp -Descending
        if ($sorted.Count -le $keep) { continue }

        $toMove = $sorted | Select-Object -Skip $keep
        foreach ($item in $toMove) {
            $srcPath = $item.File.FullName
            $dstPath = Join-Path $dir.FullName $item.File.Name
            $relSrc  = $srcPath.Replace($root, "")
            if ($DryRun) {
                Add-Content $logFile "[$stamp] [DRY-RUN] would move to archive: $relSrc"
            } else {
                Move-Item -Path $srcPath -Destination $dstPath -Force -ErrorAction SilentlyContinue
                Add-Content $logFile "[$stamp] moved to archive: $relSrc"
            }
            $totalMoved++
        }
    }
}

$totalDeleted = 0

foreach ($dir in $archiveDirs) {
    $files = Get-ChildItem -Path $dir.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match '^(.+)_(\d{12})$' }

    if (-not $files) { continue }

    $groups = $files | ForEach-Object {
        $null = $_.BaseName -match '^(.+)_(\d{12})$'
        [PSCustomObject]@{
            Slug      = $matches[1]
            Timestamp = $matches[2]
            File      = $_
        }
    } | Group-Object Slug

    foreach ($g in $groups) {
        $sorted = $g.Group | Sort-Object Timestamp -Descending
        if ($sorted.Count -le $keep) { continue }

        $toDelete = $sorted | Select-Object -Skip $keep
        foreach ($item in $toDelete) {
            $relPath = $item.File.FullName.Replace($root, "")
            if ($DryRun) {
                Add-Content $logFile "[$stamp] [DRY-RUN] would delete: $relPath"
            } else {
                Remove-Item -Path $item.File.FullName -Force -ErrorAction SilentlyContinue
                Add-Content $logFile "[$stamp] deleted: $relPath"
            }
            $totalDeleted++
        }
    }
}

$stamp2 = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "[$stamp2] === Archive cleanup end$mode - $totalMoved file(s) moved, $totalDeleted file(s) removed ==="
