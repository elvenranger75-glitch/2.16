# 스마트스토어 자동화 프로젝트 — claude.md

## 프로젝트 개요

스마트스토어 계정 전환 및 퍼센티에서 크롬 확장 프로그램을 이용하여 복사 업로드 자동화 프로그램.

---

## 구조 — 4개 탭 릴레이

| 탭 | 역할 |
|---|---|
| 탭1 | 스마트스토어 로그인/로그아웃 전용 |
| 탭2 | 퍼센티 등록상품 관리 (날짜 필터 + 상품 복사) |
| 탭3 | 퍼센티 신규상품 관리 (숫자 제거 + 그룹1→그룹2 이동) |
| 탭4 | 퍼센티 신규상품 관리 (그룹2 업로드 실행) |

### 핵심 원칙
1. 각 단계 완료를 **background에서 직접 감지**한 후에만 다음 단계 진행
2. 엑셀 파일에서 계정 정보를 읽어서 순환
3. `execInPercenty`는 동기 코드만 반환 가능 — **Promise 반환 금지**
4. 모든 비동기 대기는 background에서 `await sleep()` + 폴링으로 처리

---

## 기술 스택

- **Chrome Extension Manifest V3** (service worker)
- `chrome.scripting.executeScript` with `world:'MAIN'` — 퍼센티 DOM 조작
- `chrome.tabs.onUpdated` — background에서 URL 변경 감지 (로그인 완료 감지)
- `chrome.storage.local` — 계정 정보, 설정, 상태 공유
- `SheetJS (xlsx)` — 엑셀 계정 파일 파싱 (assets/xlsx.full.min.js, 실제 라이브러리)
- `loginLock` 플래그 — triggerTab1Login 중복 호출 방지

---

## 파일 구조

```
sa-extension/
├── manifest.json
├── background/
│   └── background.js          ← 오케스트레이터 (탭 관리, 릴레이, 모든 자동화 로직)
├── content/
│   ├── tab1_content.js        ← 탭1 패널 표시만 담당 (로그인은 executeScript가 처리)
│   └── percenty_content.js    ← 빈 스텁 (메시지 응답만, 실제 로직 없음)
├── popup/
│   ├── popup.html             ← 팝업 UI
│   └── popup.js               ← 팝업 로직 (엑셀 로드, 상태 폴링)
└── assets/
    ├── xlsx.full.min.js       ← SheetJS 0.20.3 (실제 라이브러리 951KB)
    ├── 계정양식.xlsx           ← 계정 입력 엑셀 템플릿
    └── icon16/48/128.png
```

---

## 엑셀 계정 파일 형식 (계정양식.xlsx)

| A열 | B열 | C열 | D열 | E열 | F열 | G열 |
|---|---|---|---|---|---|---|
| 스마트스토어_ID | 스마트스토어_PW | 퍼센티_ID | 퍼센티_PW | 스토어명(선택) | 그룹1 | 그룹2 |

- **1행**: 컬럼 제목
- **2행**: 예시 데이터
- **3행~**: 실제 계정 입력

> **그룹1 (F열)**: Tab2 복사 도착 그룹 / Tab3에서 필터링할 소스 그룹
> **그룹2 (G열)**: Tab3에서 이동할 목적 그룹 / Tab4 업로드 그룹
> **B열(PW) 비워두면** → 브라우저 자동로그인 모드

---

## 탭1 — 스마트스토어 로그인

### 로그인 URL
```
https://accounts.commerce.naver.com/login?url=https%3A%2F%2Fsell.smartstore.naver.com%2F%23%2Flogin-callback
```

### 핵심 구현
- `chrome.tabs.create({ url: LOGIN_URL })` — 항상 새 탭 생성 (퍼센티 탭 절대 덮어쓰지 않음)
- `executeScript`로 loginFunc 주입 → ID/PW 입력 + 로그인 버튼 클릭
- **로그인 완료 감지**: background의 `waitForTabUrl(tabId, 'sell.smartstore.naver.com', 120000)` — `chrome.tabs.onUpdated`로 URL 변경 감지
- loginFunc 내 메시지 전송 방식 폐기 (페이지 이동 후 컨텍스트 소멸 문제)

### 로그인 폼 선택자
```javascript
input[type="text"]      // 아이디 입력란 (type=email 아님!)
input[type="password"]  // 비밀번호 입력란
// 로그인 버튼: Array.from(buttons).find(b => b.textContent.trim() === '로그인')
```

### loginLock
- `triggerTab1Login` 진입 시 `loginLock = true` 설정
- 성공/실패/정지/완료 모든 경로에서 `loginLock = false`
- 중복 호출 시 즉시 return

---

## 탭2 — 등록상품 관리 (상품 복사)

### 흐름
1. `ensurePercentyTab(account)` → 퍼센티 탭 확보 + 로그인
2. `chrome.tabs.update(tabId, { active: true })` → 퍼센티 탭 앞으로
3. `navigatePercentySection(tabId, '등록상품')` → 등록상품 관리 이동
4. `applyDateFilter(tabId, dateFrom, dateTo)` → 날짜 필터 적용
5. 상품 수집 + 복사 (runShuffler)

### 날짜 필터 (applyDateFilter)

**단축 버튼 우선**: dateFrom == dateTo == 오늘이면 "오늘" 버튼 클릭 (피커 사용 안 함)

**피커 직접 입력 방식** (단축 버튼 없을 때):
- 날짜 형식: `YYYY-MM-DD` (하이픈, 점 아님)
- 시작일: `p[0].click()` → 달력 열기 → 글자 하나씩 타이핑 (130ms 간격) → Enter 확정
- 종료일: **`p[1].click()` 금지** (클릭하면 시작일 초기화됨) → `p[1].focus()`만 사용 → 글자 하나씩 타이핑 → **Enter 누르지 않음**
- 종료일 Enter 금지 이유: Enter가 달력을 닫으면서 입력값을 지움
- 검색 버튼 클릭이 달력 닫기 + 날짜 확정 역할 겸함

**타이핑 시뮬레이션** (typeChars):
```javascript
// 각 글자마다:
el.dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true }));
nativeSetter.call(el, el.value + c);  // value에 한 글자 추가
el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: c }));
el.dispatchEvent(new KeyboardEvent('keyup', { key: c, bubbles: true }));
// 130ms 대기
```

**퍼센티 등록상품 페이지 버튼 목록** (스캔 확인):
- `전체기간`, `오늘`, `1주일`, `1개월`, `3개월`, `검색 초기화`, `상품 검색`, `새로고침`

### 상품 수집 (runShuffler)
- 셀렉터: `tr.ant-table-row`
- **상품명 셀렉터**: `span.sc-kWtpeL.kBZQvW` ← 스캔으로 확인 (등록상품/신규상품 공통)
- 상품명은 테이블에서 수집 + 드로어(편집창)에서 재확인하여 셔플 (이중 보장)
- `processOneProduct`에서 드로어 input.ant-input[type="text"]의 value를 읽어 셔플

### 탭2 완성 상태
- [x] 날짜 필터 적용
- [x] 상품 수집 (span.sc-kWtpeL.kBZQvW)
- [x] 드로어에서 이름 읽기 + 셔플 + 복사
- [x] Tab2 완료 후 Tab3 스킵 → 다음 계정으로

---

## 탭3 — 신규상품 관리 (숫자 제거 + 그룹 이동)

### 흐름
1. `chrome.tabs.update(tabId, { active: true })` → 퍼센티 탭 앞으로
2. `navigatePercentySection(tabId, '신규상품')` → 신규상품 관리 이동
3. `filterByGroup(tabId, sourceGroup)` → 그룹1 필터 클릭
4. 각 상품 이름에서 `(숫자)` 제거 + shuffleName
5. 그룹 이동 다이얼로그: 전체선택 → 그룹지정 버튼 → 그룹2 라디오 선택 → 확인

### 상품 셀렉터 (신규상품)
- 리스트 아이템: `li.ant-list-item[id]`
- 상품명: `span.sc-kWtpeL.kBZQvW`
- 편집 버튼: `button.sc-dlWCHZ.cSQmK`
- 입력란: `input.ant-input.css-1li46mu`

### 그룹 이동 다이얼로그
- 전체선택 체크박스: `span.ant-checkbox.ant-wave-target.css-1li46mu input.ant-checkbox-input`
- 그룹지정 버튼: `button.ant-btn` 중 '그룹 지정' 포함
- 라디오: `label.ant-radio-wrapper` → 정확 일치 후 포함 일치 fallback
- 확인 버튼: `button.ant-btn-primary` 중 '확인' 포함

### filterByGroup 현재 구현
1순위: `.ant-tabs-tab, .ant-tabs-tab-btn` 중 그룹명 포함
2순위: button/span/div/li/a 중 정확 일치
3순위: 전체 리프노드 중 포함 일치
실패 시: 현재 탭 목록 로그 출력

---

## 탭4 — 신규상품 관리 (마켓 업로드)

### 흐름
1. `chrome.tabs.update(tabId, { active: true })` → 퍼센티 탭 앞으로
2. `filterByGroup(tabId, uploadGroup)` → 그룹2 필터 클릭
3. 전체 선택 → 업로드 버튼 → 네이버(ss)만 체크 → 일괄 업로드
4. 완료 폴링 (최대 1시간): `(\d+)/(\d+) 업로드 완료` 패턴 감지

---

## 릴레이 이벤트 흐름

```
▶ 시작 (팝업 START_AUTOMATION)
    ↓
[탭1] waitForTabUrl → 로그인 성공 → loginLock 해제
    ↓
[탭2] ensurePercentyTab → 날짜필터 → runShuffler 완료
    ↓
[탭3] navigateSection → filterByGroup → 숫자제거 → 그룹이동 완료
    ↓
[탭4] filterByGroup → 전체선택 → 업로드 완료
    ↓
다음 계정 순환 또는 전체 완료
```

---

## 핵심 유틸리티 함수

### execInPercenty
```javascript
function execInPercenty(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId }, func, args, world: 'MAIN'
  }).then(r => r?.[0]?.result);
}
// ※ world:'MAIN'에서 Promise 반환 불가 — 즉시 resolve(undefined)됨
// ※ 모든 비동기 대기는 background의 for + await sleep() 폴링으로 처리
```

### waitForTabUrl
```javascript
// chrome.tabs.onUpdated 리스너 + setTimeout 조합
// tabId 필터링 필수 (다른 탭 이벤트 무시)
// 타임아웃: 120초
```

### navigatePercentySection
- DOM 기반 페이지 감지: `tr.ant-table-row` 있으면 등록상품, `li.ant-list-item[id]` 있으면 신규상품
- 메뉴 클릭: 리프노드 텍스트 일치 요소 클릭
- 전환 확인: 최대 8초 폴링

---

## 설정 (autoSettings)

| 키 | 기본값 | 설명 |
|---|---|---|
| dateFrom | 오늘 | 시작 날짜 (YYYY-MM-DD) |
| dateTo | 오늘 | 종료 날짜 (YYYY-MM-DD) |
| pagesTab2 | 2 | 셔플러 처리 페이지 수 |
| pagesTab3 | 2 | 옵티마이저 처리 페이지 수 |
| pagesTab4 | 0 | 업로드 반복 횟수 (0=전체 완료까지) |

---

## manifest.json 권한

```json
"permissions": ["tabs", "scripting", "storage", "activeTab"],
"host_permissions": [
  "https://sell.smartstore.naver.com/*",
  "https://nid.naver.com/*",
  "https://accounts.commerce.naver.com/*",
  "https://percenty.co.kr/*",
  "https://www.percenty.co.kr/*"
]
```

---

## 퍼센티 페이지 DOM 구조 (스캔으로 확인된 내용)

### 등록상품 관리 페이지
- 테이블 row: `tr.ant-table-row` (data-row-key 속성으로 상품 ID 구분, 24자리 hex)
- 상품명 셀렉터: **미확정** (스캔 필요)
- 셀렉트박스: 상태 검색, 모든 수집처, 신규상품(그룹?), 50개씩 보기
- 기간 버튼: 전체기간, 오늘, 1주일, 1개월, 3개월
- 검색 버튼: `상품 검색`

### 신규상품 관리 페이지
- 리스트 아이템: `li.ant-list-item[id]`
- 상품명: `span.sc-kWtpeL.kBZQvW`

---

## 트러블슈팅 기록

### 1. Tampermonkey → Chrome Extension MV3 전환
- GM_setValue undefined, 사이트 차단 문제로 MV3으로 전환

### 2. content script 메시지 타이밍 문제
- **해결**: `executeScript`로 로그인 코드를 탭에 직접 주입

### 3. 로그인 입력란 선택자
- `input[type="email"]` → null (없는 선택자)
- **실제**: `input[type="text"]`

### 4. 로그인 버튼 클릭 안 됨
- `button[type="submit"]` → null
- **실제**: textContent.trim() === '로그인' 으로 찾기

### 5. 탭1이 퍼센티 탭을 덮어씀
- **원인**: `chrome.tabs.query({active:true})` 사용
- **해결**: `chrome.tabs.create({ url: LOGIN_URL })` 항상 새 탭 생성

### 6. TAB1_LOGIN_SUCCESS 메시지 전달 안 됨
- **원인**: 페이지 이동 후 주입된 스크립트 컨텍스트 소멸
- **해결**: background에서 `waitForTabUrl`로 직접 URL 변경 감지

### 7. Promise in MAIN world 즉시 resolve
- **원인**: `world:'MAIN'`에서 `new Promise(...)` 반환 → 즉시 undefined resolve
- **해결**: 모든 Promise 제거, background에서 `for + await sleep()` 폴링

### 8. 셔플러 외부 접근 차단
- chrome-extension:// URL 접근 불가
- **해결**: 셔플러 기능을 background.js에서 직접 구현

### 9. loginLock 중복 호출
- triggerTab1Login이 병렬로 2회 호출되는 race condition
- **해결**: `loginLock` 플래그로 중복 진입 차단

### 10. Ant Design RangePicker 날짜 입력
- native setter → Ant Design이 무시
- execCommand('insertText') 한 번에 → 무시
- **현재 방식**: 글자 하나씩 KeyboardEvent + InputEvent + nativeSetter 조합, 130ms 간격
- 종료일 `p[1].click()` → 시작일 초기화 버그 → `focus()`만 사용
- 종료일 Enter → 입력값 지워짐 → Enter 사용 안 함, 검색 버튼 클릭으로 확정

### 11. 상품명 셀렉터 문제
- `div.ant-flex span`, `td span[class]`, `td:nth-child(2) span` 모두 빈값
- **현재**: 스캔 진행 중 (td 구조 확인 필요)

---

## 현재 완성 상태

- [x] **탭1** — 스마트스토어 로그인 완성
- [x] **탭1** — 네이버 이메일 인증 자동 처리 (waitForLoginComplete → handleNaverEmailVerification → getNaverMailVerificationCode)
- [x] **팝업 UI** — 엑셀 로드, 시작/정지/리셋, 로그 표시
- [x] **엑셀 파서** — SheetJS 기반 계정 파일 파싱
- [x] **계정양식.xlsx** — 템플릿 파일 생성
- [x] **loginLock** — 중복 실행 방지
- [x] **탭 전환** — 각 탭 시작 시 퍼센티 탭 active로 전환
- [x] **날짜 단축버튼** — 오늘 == dateFrom == dateTo 이면 "오늘" 버튼 클릭
- [x] **탭2 추천 단어** — 상품 복사 전 키워드 검색 + 태그 클릭(50자 이하) + 카테고리 추천
- [x] **탭4 모달 제거** — 일괄 업로드 모달 없음 확인, 버튼 클릭 후 직접 폴링
- [x] **탭4 pagesTab4** — 업로드 반복 횟수 제한 (0=전체)
- [x] **20/50개 호환** — li.ant-list-item[id] 동적 카운트로 두 페이지 크기 모두 처리
- [ ] **추천 단어 선택자** — applyKeywordSearch의 tag 선택자 확정 (Percenty 실제 DOM 스캔 필요)
- [ ] **카테고리 추천 선택자** — "카테고리 추천" 버튼 텍스트 정확 확인 필요
