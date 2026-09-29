# MCP 서버 5종 설치·연결 검증 스크립트 (윈도우 PowerShell 전용)
#   perplexity / playwright / firecrawl / glif / chrome-devtools
#
# 사용법 (PowerShell 에서)
#   powershell -ExecutionPolicy Bypass -File scripts\setup_mcp.ps1
#
# 원칙
#   - 이미 등록된 서버는 손대지 않습니다(중복 등록·덮어쓰기 없음).
#   - API 키는 화면·로그에 출력하지 않습니다(입력 시 가려집니다).
#   - 키가 없으면 그 서버만 건너뛰고 이유를 알려줍니다.

$ErrorActionPreference = 'Continue'
$Added = @(); $Skipped = @(); $Failed = @()

function Write-Hr { Write-Host ('-' * 60) }

# ------------------------------------------------------------ 1) 전제 조건 확인
Write-Hr; Write-Host '1) 설치 여부 확인'; Write-Hr

$missing = $false
foreach ($cmd in @('claude', 'node', 'npx')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "!! '$cmd' 명령을 찾을 수 없습니다."
    switch ($cmd) {
      'claude' { Write-Host '   -> Claude Code 설치: https://docs.claude.com/en/docs/claude-code/setup' }
      default  { Write-Host '   -> Node.js LTS(18 이상) 설치: https://nodejs.org' }
    }
    $missing = $true
  }
}
if ($missing) {
  Write-Host ''
  Write-Host '설치한 뒤 PowerShell 창을 새로 열고 다시 실행하세요. (PATH 갱신 필요)'
  exit 1
}

Write-Host ("claude : " + ((claude --version 2>&1) -join ' '))
Write-Host ("node   : " + ((node --version   2>&1) -join ' '))
Write-Host ("npx    : " + ((npx --version    2>&1) -join ' '))
Write-Host ''
Write-Host '현재 등록된 MCP 서버:'
$existingRaw = (claude mcp list 2>&1 | Out-String)
Write-Host $existingRaw

$existingNames = @()
foreach ($line in ($existingRaw -split "`r?`n")) {
  if ($line -match '^([A-Za-z0-9_.-]+):\s') { $existingNames += $Matches[1] }
}

function Test-Server([string]$Name) { return $existingNames -contains $Name }

# ------------------------------------------------------------------- 2) 설치
Write-Hr; Write-Host '2) 미설치 항목만 설치'; Write-Hr

# 윈도우에서 npx 로 뜨는 MCP 서버는 'cmd /c' 를 앞에 붙여야 정상 기동합니다.
$NpxPrefix = @('cmd', '/c', 'npx')

function Add-Plain([string]$Name, [string[]]$AddArgs) {
  if (Test-Server $Name) {
    Write-Host "[skip] $Name : 이미 등록되어 있어 그대로 둡니다."
    $script:Skipped += "$Name(이미 등록)"; return
  }
  Write-Host "[add ] $Name"
  claude mcp add $Name @AddArgs 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $script:Added += $Name }
  else { Write-Host "       !! 등록 실패: $Name"; $script:Failed += $Name }
}

function Add-Keyed([string]$Name, [string]$EnvVar, [string]$Signup, [string[]]$CmdArgs) {
  if (Test-Server $Name) {
    Write-Host "[skip] $Name : 이미 등록되어 있어 그대로 둡니다."
    $script:Skipped += "$Name(이미 등록)"; return
  }

  $key = [Environment]::GetEnvironmentVariable($EnvVar)
  # 키가 환경변수에 없으면 물어봅니다. 단, 입력을 받을 수 없는 상황
  # (파이프·예약 실행 등)에서는 멈추지 않고 건너뜁니다.
  if ([string]::IsNullOrWhiteSpace($key) -and -not [Console]::IsInputRedirected) {
    Write-Host ''
    Write-Host "$Name 에는 $EnvVar 가 필요합니다. (발급: $Signup)"
    Write-Host '  입력값은 화면에 표시되지 않습니다. 그냥 Enter 를 누르면 건너뜁니다.'
    try {
      $secure = Read-Host -Prompt "  $EnvVar" -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try   { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    } catch {
      Write-Host '  (입력을 받을 수 없어 건너뜁니다.)'
    }
  }

  if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "[skip] $Name : $EnvVar 가 없어 건너뜁니다. 키를 받은 뒤 다시 실행하세요."
    $script:Skipped += "$Name(키 없음)"; return
  }

  Write-Host "[add ] $Name"
  claude mcp add $Name --env "$EnvVar=$key" -- @CmdArgs 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $script:Added += $Name }
  else { Write-Host "       !! 등록 실패: $Name"; $script:Failed += $Name }
  $key = $null
}

# 브라우저 계열 서버는 기본값으로 '설치된 Google Chrome' 을 찾습니다.
# 크롬이 다른 경로에 있으면 환경변수 MCP_BROWSER_PATH 로 지정하세요.
$pwArgs = $NpxPrefix + @('@playwright/mcp@latest')
$cdArgs = $NpxPrefix + @('chrome-devtools-mcp@latest')

$browserPath = [Environment]::GetEnvironmentVariable('MCP_BROWSER_PATH')
if (-not [string]::IsNullOrWhiteSpace($browserPath)) {
  if (-not (Test-Path $browserPath)) {
    Write-Host "!! MCP_BROWSER_PATH 경로가 없습니다: $browserPath"
    exit 1
  }
  Write-Host "브라우저 경로 지정: $browserPath"
  $pwArgs += @('--executable-path', $browserPath, '--headless', '--isolated')
  $cdArgs += @('--executablePath', $browserPath, '--isolated', '--headless')
  Write-Host ''
}

# 키가 필요 없는 3개
Add-Plain 'playwright'      (@('--') + $pwArgs)
Add-Plain 'chrome-devtools' (@('--') + $cdArgs)
Add-Plain 'glif'            @('--transport', 'http', 'https://glif.app/api/mcp')

# 키가 필요한 2개
Add-Keyed 'perplexity' 'PERPLEXITY_API_KEY' 'https://www.perplexity.ai/settings/api' `
  ($NpxPrefix + @('-y', '@perplexity-ai/mcp-server'))
Add-Keyed 'firecrawl'  'FIRECRAWL_API_KEY'  'https://www.firecrawl.dev/app/api-keys' `
  ($NpxPrefix + @('-y', 'firecrawl-mcp'))

# ------------------------------------------------------------------- 3) 검증
Write-Host ''
Write-Hr; Write-Host '3) 연결 검증 (claude mcp list)'; Write-Hr
$verifyRaw = (claude mcp list 2>&1 | Out-String)
Write-Host $verifyRaw

$serverLines = @()
foreach ($line in ($verifyRaw -split "`r?`n")) {
  if ($line -match '^[A-Za-z0-9_.-]+:\s') { $serverLines += $line }
}
# 인증/승인 대기는 '정상 진행 중'이므로 실패로 세지 않습니다.
$pendingPattern = 'Needs authentication|Pending approval|Authenticat'
$pending = @($serverLines | Where-Object { $_ -match $pendingPattern })
$broken  = @($serverLines | Where-Object { $_ -notmatch 'Connected' -and $_ -notmatch $pendingPattern })

# --------------------------------------------------------------------- 요약
Write-Hr; Write-Host '요약'; Write-Hr
function Join-Or([string[]]$Items) { if ($Items.Count) { $Items -join ' ' } else { '(없음)' } }
Write-Host ("새로 등록 : " + (Join-Or $Added))
Write-Host ("건너뜀    : " + (Join-Or $Skipped))
Write-Host ("등록 실패 : " + (Join-Or $Failed))
Write-Host ''

if ($pending.Count) {
  Write-Host '[할 일] 브라우저 로그인이 남은 항목 (오류가 아닙니다):'
  $pending | ForEach-Object { Write-Host "  $_" }
  Write-Host ''
  Write-Host "  'claude' 실행 -> /mcp -> 해당 서버 선택 -> Authenticate 를 누르면"
  Write-Host '  브라우저가 열립니다. 창이 안 열리면 터미널에 표시된 URL 을 직접 붙여넣으세요.'
  Write-Host '  (glif 는 이 단계가 정상 절차입니다.)'
  Write-Host ''
}

if ($broken.Count) {
  Write-Host '[오류] 연결하지 못한 항목:'
  $broken | ForEach-Object { Write-Host "  $_" }
  Write-Host ''
  Write-Host '자주 있는 원인'
  Write-Host '  - 403 / ERR_PROXY_TUNNEL : 방화벽·프록시가 해당 도메인을 막고 있습니다.'
  Write-Host '                             glif.app / api.perplexity.ai / api.firecrawl.dev 허용 필요.'
  Write-Host '  - Failed to connect      : PowerShell 에서 npx <패키지> 를 직접 실행해 오류를 확인하세요.'
  Write-Host '  - Pending approval       : claude 를 한 번 실행해 프로젝트 설정을 승인하세요.'
  Write-Host '  - 키 오류(401/403)       : claude mcp remove <이름> 후 올바른 키로 다시 추가하세요.'
  exit 1
}

if ($pending.Count) {
  Write-Host '연결 실패는 없습니다. 위 항목만 브라우저에서 로그인하면 끝입니다.'
} else {
  Write-Host '등록된 MCP 서버가 모두 Connected 입니다.'
}

Write-Host ''
Write-Host "참고: Connected 는 '연결됐다'는 뜻일 뿐, 브라우저가 실제로 열리는지까지는"
Write-Host '      보장하지 않습니다. playwright / chrome-devtools 를 등록했다면 아래로'
Write-Host '      실제 동작을 확인하세요.'
Write-Host '        python scripts\mcp_browser_smoke.py'
