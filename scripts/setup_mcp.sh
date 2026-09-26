#!/usr/bin/env bash
# MCP 서버 5종 설치·연결 검증 스크립트
#   perplexity / playwright / firecrawl / glif / chrome-devtools
#
# 사용법
#   bash scripts/setup_mcp.sh
#   PERPLEXITY_API_KEY=... FIRECRAWL_API_KEY=... bash scripts/setup_mcp.sh   # 비대화형
#
# 원칙
#   - 이미 등록된 서버는 손대지 않습니다(중복 등록·덮어쓰기 없음).
#   - API 키는 화면·로그에 출력하지 않습니다(입력 시 에코를 끕니다).
#   - 키가 없으면 그 서버만 건너뛰고 이유를 알려줍니다.

set -uo pipefail

ADDED=(); SKIPPED=(); FAILED=()
hr() { printf -- '------------------------------------------------------------\n'; }

# ------------------------------------------------------------ 1) 전제 조건 확인
hr; echo "1) 설치 여부 확인"; hr

for cmd in claude node npx; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "!! '$cmd' 명령을 찾을 수 없습니다."
    case "$cmd" in
      claude)   echo "   -> Claude Code 설치: https://docs.claude.com/en/docs/claude-code/setup" ;;
      node|npx) echo "   -> Node.js LTS(18 이상) 설치: https://nodejs.org" ;;
    esac
    exit 1
  fi
done

echo "claude : $(claude --version 2>&1 | head -1)"
echo "node   : $(node --version 2>&1)"
echo "npx    : $(npx --version 2>&1)"
echo
echo "현재 등록된 MCP 서버:"
EXISTING_RAW="$(claude mcp list 2>&1)"
printf '%s\n' "$EXISTING_RAW"
echo

EXISTING_NAMES="$(printf '%s\n' "$EXISTING_RAW" \
  | sed -n 's/^\([A-Za-z0-9_.-]\{1,\}\):[[:space:]].*/\1/p')"

has_server() { printf '%s\n' "$EXISTING_NAMES" | grep -Fxq "$1"; }

# ------------------------------------------------------------------- 2) 설치
hr; echo "2) 미설치 항목만 설치"; hr

# add_plain <이름> <claude mcp add에 넘길 인자...>
add_plain() {
  local name="$1"; shift
  if has_server "$name"; then
    echo "[skip] $name : 이미 등록되어 있어 그대로 둡니다."
    SKIPPED+=("$name(이미 등록)"); return 0
  fi
  echo "[add ] $name"
  if claude mcp add "$name" "$@" >/dev/null 2>&1; then
    ADDED+=("$name")
  else
    echo "       !! 등록 실패: $name"
    FAILED+=("$name")
  fi
}

# add_keyed <이름> <환경변수명> <키 발급 URL> -- <실행 명령...>
add_keyed() {
  local name="$1" envvar="$2" signup="$3"; shift 4   # 4번째는 '--'
  if has_server "$name"; then
    echo "[skip] $name : 이미 등록되어 있어 그대로 둡니다."
    SKIPPED+=("$name(이미 등록)"); return 0
  fi

  local key="${!envvar:-}"
  if [ -z "$key" ] && [ -t 0 ]; then
    echo
    echo "$name 에는 $envvar 가 필요합니다. (발급: $signup)"
    printf '  %s 입력 [Enter=건너뛰기, 입력값은 화면에 표시되지 않습니다]: ' "$envvar"
    read -rs key; echo
  fi

  if [ -z "$key" ]; then
    echo "[skip] $name : $envvar 가 없어 건너뜁니다. 키를 받은 뒤 다시 실행하세요."
    SKIPPED+=("$name(키 없음)"); return 0
  fi

  echo "[add ] $name"
  if claude mcp add "$name" --env "$envvar=$key" -- "$@" >/dev/null 2>&1; then
    ADDED+=("$name")
  else
    echo "       !! 등록 실패: $name"
    FAILED+=("$name")
  fi
  unset key
}

# 키가 필요 없는 3개
add_plain playwright      -- npx @playwright/mcp@latest
add_plain chrome-devtools  -- npx chrome-devtools-mcp@latest
add_plain glif --transport http "https://glif.app/api/mcp"

# 키가 필요한 2개
add_keyed perplexity PERPLEXITY_API_KEY "https://www.perplexity.ai/settings/api" \
  -- npx -y @perplexity-ai/mcp-server
add_keyed firecrawl  FIRECRAWL_API_KEY  "https://www.firecrawl.dev/app/api-keys" \
  -- npx -y firecrawl-mcp

# ------------------------------------------------------------------- 3) 검증
echo
hr; echo "3) 연결 검증 (claude mcp list)"; hr
VERIFY_RAW="$(claude mcp list 2>&1)"
printf '%s\n' "$VERIFY_RAW"
echo

SERVER_LINES="$(printf '%s\n' "$VERIFY_RAW" | grep -E '^[A-Za-z0-9_.-]+:' || true)"
# 인증/승인 대기는 '정상 진행 중'이므로 실패로 세지 않습니다.
PENDING="$(printf '%s\n' "$SERVER_LINES" \
  | grep -E 'Needs authentication|Pending approval|Authenticat' || true)"
BROKEN="$(printf '%s\n' "$SERVER_LINES" \
  | grep -v 'Connected' \
  | grep -vE 'Needs authentication|Pending approval|Authenticat' || true)"

# --------------------------------------------------------------------- 요약
hr; echo "요약"; hr
echo "새로 등록 : ${ADDED[*]:-(없음)}"
echo "건너뜀    : ${SKIPPED[*]:-(없음)}"
echo "등록 실패 : ${FAILED[*]:-(없음)}"
echo

if [ -n "$PENDING" ]; then
  echo "[할 일] 브라우저 로그인이 남은 항목 (오류가 아닙니다):"
  printf '%s\n' "$PENDING" | sed 's/^/  /'
  echo
  echo "  'claude' 실행 -> /mcp -> 해당 서버 선택 -> Authenticate 를 누르면"
  echo "  브라우저가 열립니다. 창이 안 열리면 터미널에 표시된 URL 을 직접 붙여넣으세요."
  echo "  (glif 는 이 단계가 정상 절차입니다.)"
  echo
fi

if [ -n "$BROKEN" ]; then
  echo "[오류] 연결하지 못한 항목:"
  printf '%s\n' "$BROKEN" | sed 's/^/  /'
  echo
  echo "자주 있는 원인"
  echo "  - 403 / ERR_PROXY_TUNNEL : 방화벽·프록시가 해당 도메인을 막고 있습니다."
  echo "                             glif.app / api.perplexity.ai / api.firecrawl.dev 허용 필요."
  echo "  - Failed to connect      : 'npx <패키지>' 를 직접 실행해 오류 메시지를 확인하세요."
  echo "  - Pending approval       : 'claude' 를 한 번 실행해 프로젝트 설정을 승인하세요."
  echo "  - 키 오류(401/403)       : claude mcp remove <이름> 후 올바른 키로 다시 추가하세요."
  exit 1
fi

if [ -n "$PENDING" ]; then
  echo "연결 실패는 없습니다. 위 항목만 브라우저에서 로그인하면 끝입니다."
else
  echo "등록된 MCP 서버가 모두 Connected 입니다."
fi
