# MCP 서버 5종 설치 가이드

클로드 코드에 "손과 눈"을 달아주는 도구 5개를 붙이는 방법입니다.
`scripts/setup_mcp.sh` 한 번 실행으로 끝납니다.

## 5개가 각각 해 주는 일

| 서버 | 한 줄 설명 | 이렇게 씁니다 |
| --- | --- | --- |
| **perplexity** | 클로드가 모르는 **최신 정보를 대신 검색**해 출처까지 가져옵니다. | "이번 달 쿠팡 수수료 정책 찾아서 정리해줘" |
| **playwright** | 클로드가 **브라우저를 직접 조작**합니다(클릭·입력·스크린샷). 자동 테스트에 강합니다. | "쇼핑몰 주문 페이지 끝까지 눌러보고 막히는 데 알려줘" |
| **firecrawl** | 웹페이지·사이트 전체를 **읽기 좋은 텍스트로 긁어옵니다**. | "경쟁사 상품 상세페이지 20개 긁어서 표로 만들어줘" |
| **glif** | **이미지·짧은 영상 생성** 등 AI 미니앱을 불러 씁니다(썸네일용). | "이 제목으로 유튜브 썸네일 시안 3개 뽑아줘" |
| **chrome-devtools** | 크롬 개발자도구에 붙어 **느린 원인·에러 로그**를 봅니다. | "우리 사이트 왜 느린지 성능 측정해서 알려줘" |

> 역할 구분: **firecrawl은 읽기**(대량 수집), **playwright는 조작**(클릭·테스트),
> **chrome-devtools는 진단**(성능·에러)입니다.

## 준비물

1. **Node.js 18 이상** — https://nodejs.org 에서 LTS 설치
2. **Claude Code** — https://docs.claude.com/en/docs/claude-code/setup
3. **API 키 2개** (선택이지만 perplexity·firecrawl에는 필수)
   - Perplexity: https://www.perplexity.ai/settings/api
   - Firecrawl: https://www.firecrawl.dev/app/api-keys

## 설치

프로젝트 폴더에서 아래 한 줄을 실행합니다.

```bash
bash scripts/setup_mcp.sh
```

스크립트가 알아서 이렇게 합니다.

- `claude --version`, `node --version` 확인
- 이미 등록된 서버는 **건드리지 않고 건너뜀** (중복 등록·덮어쓰기 없음)
- 없는 것만 등록
- API 키는 **화면에 표시하지 않고** 물어봅니다. Enter만 누르면 그 서버는 건너뜁니다.
- 마지막에 `claude mcp list` 결과와 요약을 보여줍니다

키를 미리 환경변수로 넘기면 질문 없이 진행됩니다.

```bash
PERPLEXITY_API_KEY='...' FIRECRAWL_API_KEY='...' bash scripts/setup_mcp.sh
```

## 스크립트가 실행하는 명령 (직접 하고 싶을 때)

```bash
claude mcp add playwright      -- npx @playwright/mcp@latest
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
claude mcp add --transport http glif "https://glif.app/api/mcp"
claude mcp add perplexity --env PERPLEXITY_API_KEY="<키>" -- npx -y @perplexity-ai/mcp-server
claude mcp add firecrawl  --env FIRECRAWL_API_KEY="<키>"  -- npx -y firecrawl-mcp
```

## 확인 방법 — 2단계입니다

**1단계. 연결 확인**

```bash
claude mcp list
```

각 줄 끝에 `✓ Connected` 가 보이면 등록·연결은 된 것입니다.

**2단계. 브라우저가 진짜 열리는지 확인** ← 빠뜨리기 쉬운 부분

`Connected` 는 **손만 맞잡은 상태**입니다. 브라우저 실행에 실패해도 `Connected` 로
보이기 때문에, playwright·chrome-devtools 는 한 단계 더 확인해야 합니다.

```bash
python3 scripts/mcp_browser_smoke.py
```

임시 웹페이지를 로컬에 띄우고 MCP 서버에게 열게 시켜서, 페이지 제목을 되읽어
오는 것까지 확인합니다. `통과` 두 개가 나오면 정말로 쓸 수 있는 상태입니다.

크롬이 기본 위치에 없으면 경로를 직접 알려주세요.

```bash
MCP_BROWSER_PATH=/path/to/chrome python3 scripts/mcp_browser_smoke.py
MCP_BROWSER_PATH=/path/to/chrome bash scripts/setup_mcp.sh   # 등록할 때도 동일
```

## 잘 안 될 때

| 표시 | 원인과 해결 |
| --- | --- |
| `⏸ Needs authentication` (glif) | **정상입니다.** `claude` 실행 → `/mcp` → `glif` 선택 → Authenticate → 브라우저에서 glif.app 로그인·승인. 창이 안 열리면 터미널에 찍힌 URL을 직접 붙여넣으세요. |
| `⏸ Pending approval` | `.mcp.json`(프로젝트 공용 설정)에 등록된 경우입니다. `claude` 를 한 번 실행해 신뢰 여부를 승인하세요. |
| `✗ Failed to connect` | `npx @playwright/mcp@latest` 처럼 명령을 직접 실행해 에러 메시지를 확인하세요. 대개 Node 버전이 낮거나 패키지 다운로드가 막힌 경우입니다. |
| `Connected` 인데 브라우저가 안 열림 | **가장 흔한 함정입니다.** 두 서버는 기본적으로 설치된 **Google Chrome** 을 찾습니다. 크롬이 없으면 `Chromium distribution 'chrome' is not found` / `Could not find Google Chrome executable` 오류가 납니다. 크롬을 설치하거나 `MCP_BROWSER_PATH` 로 경로를 지정하세요. |
| `Chromium sandboxing failed!` | 서버·컨테이너 환경입니다. `MCP_BROWSER_PATH` 를 지정하면 스크립트가 `--no-sandbox` 를 자동으로 붙입니다. |
| `ERR_PROXY_TUNNEL: 403` | 회사 방화벽·프록시가 도메인을 막고 있습니다. `glif.app`, `api.perplexity.ai`, `api.firecrawl.dev` 를 허용 목록에 넣어야 합니다. |
| 키 관련 401/403 | `claude mcp remove <이름>` 후 올바른 키로 다시 등록하세요. |

## 보안 주의

- API 키를 채팅창이나 커밋에 붙여넣지 마세요. 키는 이 스크립트나 셸 환경변수로만 전달합니다.
- `.env` 파일을 만들었다면 반드시 `.gitignore` 에 넣으세요.
