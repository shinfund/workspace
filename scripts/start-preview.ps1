# HTML 듀얼 프리뷰어 실행 스크립트
# 사용법: .\scripts\start-preview.ps1 [파일경로 또는 URL]
# 예시:
#   .\scripts\start-preview.ps1
#   .\scripts\start-preview.ps1 apps\stock-issue-analysis_202606261018.html
#   .\scripts\start-preview.ps1 "C:\users\shinf\workspace\apps\foo.html"

param(
  [string]$Target = ""
)

$Port          = 9127
$WorkspaceRoot = "C:\users\shinf\workspace"
$ViewerFile    = "apps/html-preview-viewer_202606282124.html"

# ── 1. Python 서버 상태 확인 ──
$portInUse = $false
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect('localhost', $Port)
  $portInUse = $true
  $tcp.Close()
} catch {}

if (-not $portInUse) {
  Write-Host "HTTP 서버 시작 중 (port $Port)..." -ForegroundColor Cyan
  Start-Process python -ArgumentList "-m http.server $Port" `
    -WorkingDirectory $WorkspaceRoot -WindowStyle Hidden
  Start-Sleep -Milliseconds 900

  # 기동 확인
  $ok = $false
  for ($i = 0; $i -lt 5; $i++) {
    try {
      $tcp2 = New-Object System.Net.Sockets.TcpClient
      $tcp2.Connect('localhost', $Port)
      $tcp2.Close()
      $ok = $true; break
    } catch { Start-Sleep -Milliseconds 300 }
  }

  if ($ok) { Write-Host "서버 시작됨: http://localhost:$Port" -ForegroundColor Green }
  else      { Write-Host "서버 시작 실패. Python 설치 여부를 확인하세요." -ForegroundColor Red; exit 1 }
} else {
  Write-Host "서버 이미 실행 중: http://localhost:$Port" -ForegroundColor Green
}

# ── 2. 로드 URL 결정 ──
function ConvertTo-ServerURL ([string]$input) {
  $s = $input.Trim()
  if ($s -match '^https?://') { return $s }

  # Windows 절대경로 → 상대경로
  if ($s -match '^[A-Za-z]:[\\\/]') {
    $rel = $s.Replace('\', '/') -replace [regex]::Escape($WorkspaceRoot.Replace('\', '/')), '' -replace '^/', ''
    return "http://localhost:$Port/$rel"
  }

  # 상대경로 (백슬래시 허용)
  $rel = $s.Replace('\', '/').TrimStart('/')
  return "http://localhost:$Port/$rel"
}

$ViewerURL = "http://localhost:$Port/$ViewerFile"

if ($Target) {
  $loadURL  = ConvertTo-ServerURL $Target
  $encoded  = [System.Uri]::EscapeDataString($loadURL)
  $ViewerURL = "${ViewerURL}?load=${encoded}"
  Write-Host "파일 로드: $loadURL" -ForegroundColor Yellow
}

# ── 3. Chrome 열기 ──
Write-Host "뷰어 열기: $ViewerURL" -ForegroundColor Cyan

$chromePaths = @(
  "chrome",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$launched = $false
foreach ($p in $chromePaths) {
  try {
    if ($p -eq "chrome") {
      Start-Process chrome -ArgumentList $ViewerURL -ErrorAction Stop
    } else {
      if (Test-Path $p) { Start-Process $p -ArgumentList $ViewerURL }
      else { continue }
    }
    $launched = $true; break
  } catch {}
}

if (-not $launched) {
  Write-Host "Chrome을 찾지 못했습니다. 브라우저에서 직접 여세요:" -ForegroundColor Red
  Write-Host $ViewerURL -ForegroundColor White
}
