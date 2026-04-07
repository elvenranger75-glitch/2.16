// ============================================================
// background.js v2.15.0
// 핵심 변경: executeScript로 로그인 코드를 탭에 직접 주입
// content script 통신 타이밍 문제 완전 제거
// ============================================================

// 확장 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

let tabIds              = { tab1: null };
let isRunning           = false;
let isPaused            = false; // 일시정지 플래그
let loginLock           = false; // triggerTab1Login 중복 실행 방지
let automationStartTime = null;  // 자동화 시작 시각 (타이머용)

// 일시정지 중이면 재시작될 때까지 대기
async function waitIfPaused() {
  if (!isPaused) return;
  await notifyPopup('⏸ 일시정지 중... (재시작 버튼을 누르세요)', 'warn');
  while (isPaused && isRunning) await sleep(1000);
  if (isRunning) await notifyPopup('▶ 재시작됨', 'info');
}

function elapsedStr() {
  if (!automationStartTime) return '';
  const s = Math.floor((Date.now() - automationStartTime) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}시간 ${m}분 ${sec}초` : `${m}분 ${sec}초`;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

const LOGIN_URL         = 'https://accounts.commerce.naver.com/login?url=https%3A%2F%2Fsell.smartstore.naver.com%2F%23%2Flogin-callback';
const LOGOUT_URL        = 'https://nid.naver.com/nidlogin.logout?returl=https%3A%2F%2Fwww.naver.com%2F';
const SELL_URL          = 'https://sell.smartstore.naver.com/';
const PERCENTY_URL      = 'https://percenty.co.kr/';
const PERCENTY_LOGIN_URL = 'https://percenty.co.kr/login';

// ── GitHub 자동 업데이트 체크 URL ─────────────────────────────────
// 배포 후 아래 URL을 실제 GitHub raw URL로 교체하세요
// 예: https://raw.githubusercontent.com/yourname/sa-extension/main/version.json
const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/elvenranger75-glitch/sa-extension/main/version.json';

// ── 메시지 수신 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  switch (type) {
    case 'RUN_SHUFFLER_SCAN':
      runShufflerScan();
      sendResponse({ ok: true });
      break;

    case 'RUN_SHUFFLER_ONLY':
      (async () => {
        isRunning = true;
        await chrome.storage.local.set({ isRunning: true });
        await notifyPopup('셔플러 단독 테스트 시작', 'info');
        const { autoSettings = {} } = await chrome.storage.local.get('autoSettings');
        const settings = {
          dateFrom:  autoSettings.dateFrom  || todayStr(),
          dateTo:    autoSettings.dateTo    || todayStr(),
          pagesTab2: autoSettings.pagesTab2 || 2,
          pagesTab3: autoSettings.pagesTab3 || 2,
        };
        const success = await runShuffler({ settings });
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        await notifyPopup(success ? '셔플러 완료!' : '셔플러 실패', success ? 'success' : 'error');
      })();
      sendResponse({ ok: true });
      break;

    case 'RUN_TAB1_ONLY':
      (async () => {
        const { accounts: accs1, currentIndex: ci1 = 0, autoSettings: as1 = {} } = await chrome.storage.local.get(['accounts', 'currentIndex', 'autoSettings']);
        const account1 = accs1?.[ci1];
        if (!account1) { await notifyPopup('계정 없음 — 엑셀을 먼저 로드하세요', 'error'); return; }
        isRunning = true;
        automationStartTime = Date.now();
        await chrome.storage.local.set({ isRunning: true, automationStartTime });
        await notifyPopup(`탭1 단독: 스마트스토어 로그인 (${account1.smartstore.id})`, 'info');
        await triggerTab1Login({ account: account1, settings: as1, standalone: true });
      })();
      sendResponse({ ok: true });
      break;

    case 'RUN_TAB3_ONLY':
      (async () => {
        isRunning = true;
        await chrome.storage.local.set({ isRunning: true });
        await notifyPopup('탭3 단독 테스트 시작', 'info');
        const { accounts: accs3, currentIndex: ci3 = 0, autoSettings: as3 = {} } = await chrome.storage.local.get(['accounts', 'currentIndex', 'autoSettings']);
        const account3 = accs3?.[ci3];
        const settings3 = { pagesTab3: as3.pagesTab3 || 2 };
        const tabId3 = await getPercentyTabId();
        if (!tabId3) { await notifyPopup('퍼센티 탭 없음', 'error'); isRunning = false; await chrome.storage.local.set({ isRunning: false }); return; }
        await chrome.tabs.update(tabId3, { active: true });
        await navigatePercentySection(tabId3, '신규상품');
        const success3 = await runTab3({ account: account3, settings: settings3, numberOfPages: settings3.pagesTab3 });
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        await notifyPopup(success3 ? '탭3 완료!' : '탭3 실패', success3 ? 'success' : 'error');
      })();
      sendResponse({ ok: true });
      break;

    case 'RUN_TAB4_ONLY':
      (async () => {
        isRunning = true;
        await chrome.storage.local.set({ isRunning: true });
        await notifyPopup('탭4 단독 테스트 시작', 'info');
        const { accounts: accs4, currentIndex: ci4 = 0 } = await chrome.storage.local.get(['accounts', 'currentIndex']);
        const account4 = accs4?.[ci4];
        const tabId4 = await getPercentyTabId();
        if (!tabId4) { await notifyPopup('퍼센티 탭 없음', 'error'); isRunning = false; await chrome.storage.local.set({ isRunning: false }); return; }
        await chrome.tabs.update(tabId4, { active: true });
        await navigatePercentySection(tabId4, '신규상품');
        const success4 = await runTab4({ account: account4 });
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        await notifyPopup(success4 ? '탭4 완료!' : '탭4 실패', success4 ? 'success' : 'error');
      })();
      sendResponse({ ok: true });
      break;

    case 'START_AUTOMATION':
      handleStartAutomation().then(() => sendResponse({ ok: true }));
      return true;

    case 'STOP_AUTOMATION':
      isRunning = false;
      isPaused  = false;
      loginLock = false;
      chrome.storage.local.set({ isRunning: false, isPaused: false });
      notifyPopup('자동화 정지됨', 'warn');
      sendResponse({ ok: true });
      break;

    case 'PAUSE_AUTOMATION':
      isPaused = true;
      chrome.storage.local.set({ isPaused: true });
      notifyPopup('⏸ 일시정지됨 — 재시작 버튼으로 계속', 'warn');
      sendResponse({ ok: true });
      break;

    case 'RESUME_AUTOMATION':
      isPaused = false;
      chrome.storage.local.set({ isPaused: false });
      notifyPopup('▶ 재시작됨', 'info');
      sendResponse({ ok: true });
      break;

    case 'CHECK_UPDATE':
      checkForUpdates().then(sendResponse);
      return true;

    case 'GET_STATUS':
      getStatus().then(sendResponse);
      return true;

    case 'TAB1_LOGIN_SUCCESS': // legacy — background가 직접 URL 감지로 대체됨
      sendResponse({ ok: true });
      break;

    case 'TAB1_LOGIN_FAILED': // legacy
      sendResponse({ ok: true });
      break;

    case 'TAB2_SHUFFLER_DONE':
      if (isRunning) triggerTab3(payload);
      sendResponse({ ok: true });
      break;

    case 'TAB3_GROUP_MOVE_DONE':
      if (isRunning) triggerTab4(payload);
      sendResponse({ ok: true });
      break;

    case 'TAB4_UPLOAD_DONE':
      if (isRunning) handleNextAccount();
      sendResponse({ ok: true });
      break;
  }
});

// ── 자동화 시작 (탭1 스킵 — 탭2 직접) ───────────────────────
async function handleStartAutomation() {
  const { accounts, currentIndex = 0, autoSettings = {} } = await chrome.storage.local.get(['accounts', 'currentIndex', 'autoSettings']);
  if (!accounts?.length) {
    await notifyPopup('계정 없음 — 엑셀을 먼저 로드하세요', 'error');
    return;
  }
  const account = accounts[currentIndex];
  const workMode = autoSettings.workMode || 'today';
  const settings = {
    dateFrom:  workMode === 'today' ? todayStr() : (autoSettings.dateFrom || todayStr()),
    dateTo:    workMode === 'today' ? todayStr() : (autoSettings.dateTo   || todayStr()),
    pagesTab2: autoSettings.pagesTab2 || 2,
    pagesTab3: autoSettings.pagesTab3 || 2,
    pagesTab4: autoSettings.pagesTab4 || 0,
    workMode,
  };
  isRunning = true;
  automationStartTime = Date.now();
  await chrome.storage.local.set({ isRunning: true, currentSettings: settings, automationStartTime });
  await notifyPopup(`자동화 시작 | ${account?.smartstore?.id || '?'} | ${settings.dateFrom}~${settings.dateTo}`, 'info');
  if (account) triggerTab2({ account, settings });
}

// ── 탭1: executeScript로 로그인 코드 직접 주입 ───────────────
async function triggerTab1Login(payload = {}) {
  if (loginLock) { console.warn('[SA BG] triggerTab1Login 중복 호출 차단'); return; }
  loginLock = true;
  const { accounts, currentIndex = 0 } = await chrome.storage.local.get(['accounts', 'currentIndex']);
  const account = accounts?.[currentIndex];
  if (!account) { await handleAllDone(); return; }

  // settings를 storage에 저장해 TAB1_LOGIN_SUCCESS 핸들러에서 복원
  if (payload.settings) {
    await chrome.storage.local.set({ currentSettings: payload.settings });
  }

  await notifyPopup(`로그인: ${account.smartstore.id} (${currentIndex + 1}/${accounts.length})`, 'info');

  // 기존 로그인 탭 재사용 or 새 탭 생성 (퍼센티 탭 절대 덮어쓰지 않음)
  let tabId = tabIds.tab1;
  if (!tabId || !(await isTabAlive(tabId))) {
    const newTab = await chrome.tabs.create({ url: LOGIN_URL, active: true });
    tabId = newTab.id;
    tabIds.tab1 = tabId;
  } else {
    await chrome.tabs.update(tabId, { url: LOGIN_URL, active: true });
  }

  // 페이지 로드 완료 대기
  await waitForTabLoad(tabId);
  await sleep(2000); // SPA 렌더링 대기

  // executeScript로 로그인 코드 직접 주입 (클릭만, URL 감지는 background에서)
  await injectLoginScript(tabId, account);

  // ── background에서 직접 URL 변경 감지 + 인증 처리 ──────────
  await notifyPopup('로그인 대기 중...', 'info');
  const loginOk = await waitForLoginComplete(tabId, account);

  if (loginOk) {
    await notifyPopup('로그인 성공!', 'success');
    await sleep(1000);
    // 업로드 전 로그인 탭 닫기
    await chrome.tabs.remove(tabId).catch(() => {});
    tabIds.tab1 = null;
    await sleep(500);
    const { currentSettings = {} } = await chrome.storage.local.get('currentSettings');
    loginLock = false;
    if (isRunning) {
      if (payload.standalone) {
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        await notifyPopup('탭1 단독 완료!', 'success');
      } else {
        triggerTab4({ account, settings: currentSettings });
      }
    }
  } else {
    loginLock = false;
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
    await notifyPopup('로그인 실패 또는 타임아웃 — 자동화 중단', 'error');
  }
}

// ── 탭 URL이 특정 문자열을 포함할 때까지 대기 ────────────────
function waitForTabUrl(tabId, urlFragment, timeoutMs = 120000) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;

    function listener(id, changeInfo, tab) {
      if (id !== tabId) return;
      if (changeInfo.status === 'complete' && tab.url?.includes(urlFragment)) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
      if (Date.now() > deadline) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
  });
}

// ── 페이지 로드 완료 대기 ────────────────────────────────────
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // 타임아웃 10초
    setTimeout(resolve, 10000);
  });
}

// ── executeScript로 로그인 코드 주입 ─────────────────────────
async function injectLoginScript(tabId, account) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: loginFunc,
      args: [account, SELL_URL],
    });
    console.log('[SA BG] loginFunc 주입 완료');
  } catch (e) {
    console.error('[SA BG] executeScript 실패:', e.message);
    await notifyPopup('스크립트 주입 실패: ' + e.message, 'error');
  }
}

// ── 탭에 주입될 로그인 함수 (args로 account, sellUrl 전달) ───
async function loginFunc(account, sellUrl) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function setStatus(msg) {
    let panel = document.getElementById('sa-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sa-panel';
      panel.style.cssText = `
        position:fixed;bottom:16px;left:16px;z-index:2147483647;
        background:#1a1a2e;color:#e0e0e0;border-radius:10px;
        padding:10px 14px;font-family:sans-serif;font-size:12px;
        min-width:200px;box-shadow:0 4px 20px rgba(0,0,0,.5);
      `;
      document.body.appendChild(panel);
    }
    panel.innerHTML = `<b style="color:#7eb8f7">🤖 SA — 탭1</b><br><span style="font-size:11px">${msg}</span>`;
  }

  console.log('[SA inject] 로그인 시작:', account.smartstore.id);
  setStatus('입력란 대기 중...');

  // input[type=text] 나타날 때까지 대기
  let idEl = null;
  for (let i = 0; i < 30; i++) {
    idEl = document.querySelector('input[type="text"]');
    if (idEl) break;
    await sleep(500);
  }

  if (!idEl) {
    console.error('[SA inject] ID 입력란 없음');
    setStatus('❌ ID 입력란 없음');
    chrome.runtime.sendMessage({ type: 'TAB1_LOGIN_FAILED', payload: { account } });
    return;
  }

  // ID 입력
  console.log('[SA inject] ID 입력');
  setStatus('ID 입력 중...');
  idEl.focus();
  await sleep(300);
  idEl.value = account.smartstore.id;
  idEl.dispatchEvent(new Event('input',  { bubbles: true }));
  idEl.dispatchEvent(new Event('change', { bubbles: true }));
  idEl.dispatchEvent(new Event('blur',   { bubbles: true }));
  await sleep(800);

  // PW 입력
  const pwEl = document.querySelector('input[type="password"]');
  if (!pwEl) {
    console.error('[SA inject] PW 입력란 없음');
    setStatus('❌ PW 입력란 없음');
    chrome.runtime.sendMessage({ type: 'TAB1_LOGIN_FAILED', payload: { account } });
    return;
  }

  console.log('[SA inject] PW 입력');
  setStatus('PW 입력 중...');
  pwEl.focus();
  await sleep(300);
  pwEl.value = account.smartstore.pw;
  pwEl.dispatchEvent(new Event('input',  { bubbles: true }));
  pwEl.dispatchEvent(new Event('change', { bubbles: true }));
  pwEl.dispatchEvent(new Event('blur',   { bubbles: true }));
  await sleep(1500);

  // 로그인 버튼 클릭
  const btnEl = Array.from(document.querySelectorAll('button'))
                     .find(b => b.textContent.trim() === '로그인');
  if (!btnEl) {
    console.error('[SA inject] 로그인 버튼 없음');
    setStatus('❌ 로그인 버튼 없음');
    chrome.runtime.sendMessage({ type: 'TAB1_LOGIN_FAILED', payload: { account } });
    return;
  }

  console.log('[SA inject] 로그인 버튼 클릭');
  setStatus('로그인 중... (background가 완료 감지)');
  btnEl.click();
  // URL 감지는 background의 waitForTabUrl이 담당
}

// ── 퍼센티 탭 확보 + 로그인 ──────────────────────────────────
async function ensurePercentyTab(account) {
  let tabId = await getPercentyTabId();

  if (!tabId) {
    await notifyPopup('퍼센티 탭 없음 — 새 탭 열기', 'info');
    const tab = await chrome.tabs.create({ url: PERCENTY_URL, active: false });
    tabId = tab.id;
    await waitForTabLoad(tabId);
    await sleep(3000);
  }

  // 로그인 필요 여부 확인
  const url = (await chrome.tabs.get(tabId)).url || '';
  const needsLogin = url.includes('/login') || url.includes('/signin') || url === PERCENTY_URL;

  if (needsLogin && account?.percenty?.id && account?.percenty?.pw) {
    await notifyPopup('퍼센티 로그인 중...', 'info');
    if (!url.includes('/login')) {
      await chrome.tabs.update(tabId, { url: PERCENTY_LOGIN_URL });
      await waitForTabLoad(tabId);
      await sleep(2500);
    }
    await injectPercentyLogin(tabId, account.percenty);
    // 로그인 후 페이지 전환 대기
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const curUrl = (await chrome.tabs.get(tabId)).url || '';
      if (!curUrl.includes('/login')) { await sleep(2000); break; }
      await sleep(1000);
    }
  }

  return tabId;
}

async function injectPercentyLogin(tabId, percenty) {
  await execInPercenty(tabId, async (id, pw) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    const idEl = document.querySelector('input[type="email"]') ||
                 document.querySelector('input[type="text"]');
    if (idEl) {
      idEl.focus();
      setter.call(idEl, id);
      idEl.dispatchEvent(new Event('input',  { bubbles: true }));
      idEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
    }

    const pwEl = document.querySelector('input[type="password"]');
    if (pwEl) {
      pwEl.focus();
      setter.call(pwEl, pw);
      pwEl.dispatchEvent(new Event('input',  { bubbles: true }));
      pwEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
    }

    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText && (b.innerText.includes('로그인') || b.innerText.toLowerCase().includes('login')));
    if (btn) { await sleep(600); btn.click(); }
  }, [percenty.id, percenty.pw]);
}

// ── 현재 퍼센티 섹션을 DOM으로 감지 ─────────────────────────
async function detectPercentySection(tabId) {
  return await execInPercenty(tabId, () => {
    // 활성화된 메뉴 아이템으로 판단 (가장 신뢰도 높음)
    const selected = Array.from(document.querySelectorAll('.ant-menu-item-selected'));
    for (const el of selected) {
      const t = el.innerText?.trim().replace(/\s+/g, '');
      if (t?.includes('신규상품')) return '신규상품';
      if (t?.includes('등록상품')) return '등록상품';
    }
    // DOM 폴백
    if (document.querySelector('li.ant-list-item[id]'))           return '신규상품';
    if (document.querySelector('tr.ant-table-row[data-row-key]')) return '등록상품';
    return 'unknown';
  });
}

// ── 섹션 감지 디버그 ─────────────────────────────────────────
async function debugDetectSection(tabId) {
  return await execInPercenty(tabId, () => {
    return {
      url:       window.location.href,
      hash:      window.location.hash,
      hasTable:  !!document.querySelector('tr.ant-table-row[data-row-key]'),
      hasList:   !!document.querySelector('li.ant-list-item[id]'),
      headings:  Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.innerText?.trim()).filter(Boolean).slice(0, 5),
      menuItems: Array.from(document.querySelectorAll('.ant-menu-item')).map(e => e.innerText?.trim()).filter(Boolean),
    };
  });
}

// ── 퍼센티 메뉴 이동 (감지 없이 클릭 → 대기) ────────────────
async function navigatePercentySection(tabId, sectionKey) {
  // 실제 메뉴 텍스트 매핑 (공백 포함)
  const MENU_TEXT = {
    '신규상품': '신규 상품',
    '등록상품': '등록 상품',
  };
  const keyword = MENU_TEXT[sectionKey] || sectionKey;

  await notifyPopup(`메뉴 이동: ${sectionKey}`, 'info');

  const clicked = await execInPercenty(tabId, (kw) => {
    const all = Array.from(document.querySelectorAll('.ant-menu-item, .ant-menu-title-content'));
    const el = all.find(e => e.innerText?.trim().replace(/\s+/g, '').includes(kw.replace(/\s+/g, '')));
    if (el) { el.click(); return el.innerText?.trim(); }
    return null;
  }, [keyword]);

  if (!clicked) {
    await notifyPopup(`메뉴 없음: "${keyword}" — 현재 페이지에서 계속 진행`, 'warn');
  } else {
    await notifyPopup(`메뉴 클릭: "${clicked}"`, 'success');
  }

  await sleep(3000); // 페이지 전환 대기
  return true;        // 항상 진행
}

// ── 탭2 ──────────────────────────────────────────────────────
async function triggerTab2(payload) {
  await notifyPopup('탭2 시작: 퍼센티 로그인 + 셔플러 복사', 'info');
  const { accounts, currentIndex = 0 } = await chrome.storage.local.get(['accounts', 'currentIndex']);
  const account  = accounts?.[currentIndex];
  const settings = payload?.settings || {};
  const isFirstAccount = currentIndex === 0;

  const tabId = await ensurePercentyTab(account);
  if (!tabId) {
    await notifyPopup('퍼센티 탭 확보 실패', 'error');
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
    return;
  }

  // 퍼센티 탭을 앞으로 (사용자가 진행 상황 확인)
  await chrome.tabs.update(tabId, { active: true });

  // 등록상품 관리 페이지로 이동
  await navigatePercentySection(tabId, '등록상품');

  const success = await runShuffler({ ...payload, account, numberOfPages: settings.pagesTab2 || 2, isFirstAccount });
  if (success) {
    await notifyPopup('탭2 완료 → 탭3 진행', 'success');
    if (isRunning) triggerTab3({ ...payload, account, settings });
  } else {
    await notifyPopup('탭2 실패 — 자동화 중단', 'error');
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
  }
}

// ── 탭3 ──────────────────────────────────────────────────────
async function triggerTab3(payload) {
  await notifyPopup('탭3 시작: 신규상품 이동 + 숫자 지우기 + 그룹 이동', 'info');
  const settings = payload?.settings || {};

  const tabId = await getPercentyTabId();
  if (!tabId) {
    await notifyPopup('퍼센티 탭 없음 — 탭3 중단', 'error');
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
    return;
  }
  await chrome.tabs.update(tabId, { active: true });

  await navigatePercentySection(tabId, '신규상품');

  const success = await runTab3({ ...payload, numberOfPages: settings.pagesTab3 || 2 });
  if (success) {
    await notifyPopup('탭3 완료 → 스마트스토어 로그인 후 탭4 진행', 'success');
    if (isRunning) triggerTab1Login({ account: payload.account, settings });
  } else {
    await notifyPopup('탭3 실패 — 자동화 중단', 'error');
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
  }
}

async function triggerTab4(payload) {
  await notifyPopup('탭4 시작: 마켓 업로드', 'info');
  const tabId = await getPercentyTabId();
  if (tabId) {
    await chrome.tabs.update(tabId, { active: true });
    await navigatePercentySection(tabId, '신규상품');
  }
  const success = await runTab4(payload);
  if (success) {
    await notifyPopup('탭4 완료 → 다음 계정', 'success');
    if (isRunning) handleNextAccount();
  } else {
    await notifyPopup('탭4 실패 — 자동화 중단', 'error');
    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
  }
}

// ── 스마트스토어 로그아웃 ─────────────────────────────────────
// sell.smartstore.naver.com 대시보드 → ng-click="vm.logout()" 링크 클릭
async function logoutSmartstore() {
  await notifyPopup('스마트스토어 로그아웃 중...', 'info');

  const DASHBOARD_URL = 'https://sell.smartstore.naver.com/#/home/dashboard';
  let tabId = tabIds.tab1;
  if (!tabId || !(await isTabAlive(tabId))) {
    const newTab = await chrome.tabs.create({ url: DASHBOARD_URL, active: false });
    tabIds.tab1 = newTab.id;
    tabId = newTab.id;
  } else {
    await chrome.tabs.update(tabId, { url: DASHBOARD_URL });
  }
  await waitForTabLoad(tabId);
  await sleep(3000); // AngularJS 렌더링 대기

  // 로그아웃 링크 클릭 (ng-click="vm.logout()" → data-action-location-id="logout")
  const clicked = await execInTab(tabId, () => {
    const link = document.querySelector('[data-action-location-id="logout"]')
              || Array.from(document.querySelectorAll('a')).find(a => a.innerText?.trim() === '로그아웃');
    if (link) { link.click(); return true; }
    return false;
  }).catch(() => false);

  if (clicked) {
    // 로그인 페이지로 리다이렉트 될 때까지 대기 (최대 10초)
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) break;
      if (tab.url?.includes('accounts.commerce.naver.com') || tab.url?.includes('nid.naver.com')) break;
    }
  } else {
    // 링크 못 찾으면 Naver 세션 로그아웃 URL 폴백
    await chrome.tabs.update(tabId, { url: LOGOUT_URL });
    await waitForTabLoad(tabId);
    await sleep(1000);
  }

  await notifyPopup('로그아웃 완료', 'success');
}

// ── 다음 계정 ─────────────────────────────────────────────────
async function handleNextAccount() {
  // 수량 비교 로그
  const counts = await chrome.storage.local.get(['countTab2', 'countTab3names', 'countTab3moved', 'countTab4']);
  const c2 = counts.countTab2      || 0;
  const c3n = counts.countTab3names || 0;
  const c3m = counts.countTab3moved || 0;
  const c4 = counts.countTab4      || 0;
  await notifyPopup(`📊 수량 확인 | 복사:${c2} / 이름수정:${c3n} / 그룹이동:${c3m} / 업로드:${c4}`,
    (c2 === c3n && c3n === c4) ? 'success' : 'warn');
  if (c2 !== c3n) await notifyPopup(`  ⚠ 복사(${c2}) ≠ 이름수정(${c3n}) — Tab3 Phase1 누락 의심`, 'warn');
  if (c3n !== c4) await notifyPopup(`  ⚠ 이름수정(${c3n}) ≠ 업로드(${c4}) — Tab3 그룹이동 또는 Tab4 누락 의심`, 'warn');
  await chrome.storage.local.set({ countTab2: 0, countTab3names: 0, countTab3moved: 0, countTab4: 0 });

  const { accounts, currentIndex = 0 } = await chrome.storage.local.get(['accounts', 'currentIndex']);
  accounts[currentIndex].status  = 'done';
  accounts[currentIndex].lastRun = new Date().toISOString();
  const nextIndex = currentIndex + 1;
  if (nextIndex >= accounts.length) {
    await chrome.storage.local.set({ accounts, currentIndex: 0 });
    await handleAllDone(); return;
  }
  await chrome.storage.local.set({ accounts, currentIndex: nextIndex });
  await logoutSmartstore(); // 다음 계정 로그인 전 로그아웃
  await sleep(1000);
  const { currentSettings = {} } = await chrome.storage.local.get('currentSettings');
  // 지난날짜 모드: 2번째 계정부터 오늘 날짜로 전환
  if (currentSettings.workMode === 'past' && nextIndex > 0) {
    currentSettings.dateFrom = todayStr();
    currentSettings.dateTo   = todayStr();
    await chrome.storage.local.set({ currentSettings });
    await notifyPopup(`날짜 모드 전환: ${nextIndex+1}번째 계정부터 오늘(${todayStr()}) 기준`, 'info');
  }
  triggerTab2({ account: accounts[nextIndex], settings: currentSettings });
}

async function handleAllDone() {
  isRunning = false;
  loginLock = false;
  await chrome.storage.local.set({ isRunning: false });
  // 마지막 계정 로그아웃
  await logoutSmartstore();
  // 로그인 탭 닫기
  if (tabIds.tab1 && (await isTabAlive(tabIds.tab1))) {
    await chrome.tabs.remove(tabIds.tab1).catch(() => {});
    tabIds.tab1 = null;
  }
  await notifyPopup('🎉 모든 계정 처리 완료!', 'success');
}

// ── GitHub 자동 업데이트 체크 ─────────────────────────────────
function isNewerVersion(latest, current) {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  if (!GITHUB_VERSION_URL) return { checked: false };
  try {
    const resp = await fetch(GITHUB_VERSION_URL + '?t=' + Date.now());
    if (!resp.ok) return { checked: false };
    const data = await resp.json();
    const current = chrome.runtime.getManifest().version;
    if (isNewerVersion(data.version, current)) {
      await chrome.storage.local.set({
        updateAvailable: true,
        latestVersion:   data.version,
        downloadUrl:     data.download_url || '',
        changelog:       data.changelog    || '',
      });
      await notifyPopup(`🔔 새 버전 v${data.version} 업데이트 가능!`, 'warn');
      return { checked: true, update: true, version: data.version };
    } else {
      await chrome.storage.local.set({ updateAvailable: false });
      return { checked: true, update: false };
    }
  } catch (e) {
    return { checked: false };
  }
}

// ── chrome.alarms 리스너 (예약 실행 + 업데이트 체크) ──────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'scheduledRun') {
    await notifyPopup('⏰ 예약 실행 시작!', 'info');
    await handleStartAutomation();
  }
  if (alarm.name === 'updateCheck') {
    await checkForUpdates();
  }
});

// 서비스 워커 시작 시 업데이트 체크 알람 등록 (4시간마다)
chrome.alarms.create('updateCheck', { periodInMinutes: 240 });

// ── 유틸 ─────────────────────────────────────────────────────
async function isTabAlive(tabId) {
  try { await chrome.tabs.get(tabId); return true; }
  catch { return false; }
}

async function notifyPopup(message, type = 'info') {
  const log = { message, type, timestamp: Date.now() };
  const { statusLog = [] } = await chrome.storage.local.get('statusLog');
  statusLog.unshift(log);
  if (statusLog.length > 50) statusLog.length = 50;
  await chrome.storage.local.set({ statusLog, lastStatus: log });
}

async function getStatus() {
  const data = await chrome.storage.local.get(
    ['accounts', 'currentIndex', 'isRunning', 'isPaused', 'lastStatus', 'statusLog', 'automationStartTime']
  );
  const accounts = data.accounts || [];
  const startMs  = data.automationStartTime || null;
  let elapsed = '';
  if (startMs) {
    // 실행 중: 현재 시각 기준 / 완료 후: 마지막 계산값 유지 (startMs 있으면 항상 표시)
    const s = Math.floor((Date.now() - startMs) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    elapsed = h ? `${h}시간 ${m}분 ${sec}초` : `${m}분 ${sec}초`;
  }
  return {
    isRunning:    data.isRunning    || false,
    isPaused:     data.isPaused     || false,
    total:        accounts.length,
    done:         accounts.filter(a => a.status === 'done').length,
    error:        accounts.filter(a => a.status === 'error').length,
    pending:      accounts.filter(a => a.status === 'pending').length,
    currentIndex: data.currentIndex || 0,
    lastStatus:   data.lastStatus   || null,
    statusLog:    data.statusLog    || [],
    elapsed,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// 탭2 — 셔플러 직접 구현 (percenty DOM 조작)
// 셔플러 iframe 제어 불가 → 동일 로직을 우리가 직접 실행
// ============================================================

function getPercentyTabId() {
  return chrome.tabs.query({}).then(tabs => {
    const t = tabs.find(t => t.url && t.url.includes('percenty'));
    return t ? t.id : null;
  });
}

// percenty 탭에서 MAIN world로 스크립트 실행
function execInPercenty(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'MAIN',
  }).then(r => r?.[0]?.result);
}

// 상품명 셔플 (앞 1개 고정, 나머지 섞기)
function shuffleName(name, keywordCount = 1) {
  const words = name.split(' ');
  if (words.length <= keywordCount) return name;
  const fixed   = words.slice(0, keywordCount);
  const shuffle = words.slice(keywordCount);
  for (let i = shuffle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffle[i], shuffle[j]] = [shuffle[j], shuffle[i]];
  }
  return [...fixed, ...shuffle].join(' ');
}

// ── 스캔 (버튼 테스트용) ────────────────────────────────────
async function runShufflerScan() {
  const tabId = await getPercentyTabId();
  if (!tabId) { await notifyPopup('퍼센티 탭 없음', 'error'); return; }

  try {
    const result = await execInPercenty(tabId, () => {
      const rows = document.querySelectorAll('tr.ant-table-row');
      const page = document.querySelector('li.ant-pagination-item-active')?.title || '?';

      // ── 첫 번째 row의 모든 td 텍스트 구조 출력 ─────────────
      const firstRow = rows[0];
      const tdTexts = firstRow
        ? Array.from(firstRow.querySelectorAll('td')).map((td, i) => ({
            i,
            text: td.innerText?.trim()?.slice(0, 40),
            classes: td.className?.slice(0, 60),
          }))
        : [];

      // ── 첫 번째 row의 모든 리프 요소 중 텍스트 있는 것 ──────
      const leafTexts = firstRow
        ? Array.from(firstRow.querySelectorAll('*')).filter(e =>
            e.children.length === 0 && e.innerText?.trim().length > 5
          ).slice(0, 10).map(e => ({
            tag: e.tagName,
            cls: e.className?.slice(0, 50),
            text: e.innerText?.trim()?.slice(0, 40),
          }))
        : [];

      // ── 첫 번째 row에 '판매가' span이 있는지 확인 ───────────
      const hasPriceSpan = firstRow
        ? Array.from(firstRow.querySelectorAll('span')).some(s => s.innerText.trim() === '판매가')
        : false;

      return JSON.stringify({ page, total: rows.length, tdTexts, leafTexts, hasPriceSpan });
    });

    const d = JSON.parse(result || '{}');
    await notifyPopup(`페이지 ${d.page} | row ${d.total}개 | 판매가span: ${d.hasPriceSpan ? '✔' : '✘'}`, 'success');
    await notifyPopup('── td 구조 ──', 'info');
    for (const td of d.tdTexts || []) {
      await notifyPopup(`  td[${td.i}] "${td.text}" cls=${td.classes}`, 'info');
    }
    await notifyPopup('── 리프 요소 ──', 'info');
    for (const l of d.leafTexts || []) {
      await notifyPopup(`  <${l.tag} class="${l.cls}"> "${l.text}"`, 'info');
    }
  } catch (e) {
    await notifyPopup('스캔 오류: ' + e.message, 'error');
  }
}

// ── 달력 헤더에서 현재 표시 중인 연/월 읽기 ─────────────────
// ── React 내부 onClick 핸들러 직접 호출 ───────────────────────
// React 17+는 포털 내 이벤트가 네이티브 DOM 이벤트로 전달 안 됨
// __reactProps 또는 __reactFiber를 통해 직접 호출
function reactClickInPage(el) {
  if (!el) return null;
  // React 17+: __reactProps$XXXX
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
  if (propsKey) {
    const h = el[propsKey].onClick || el[propsKey].onMouseDown;
    if (h) { h({ target: el, preventDefault: () => {}, stopPropagation: () => {}, type: 'click' }); return 'r17'; }
  }
  // React 16: __reactInternalInstance$XXXX or __reactFiber$XXXX
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
  if (fiberKey) {
    let f = el[fiberKey];
    for (let i = 0; f && i < 20; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p?.onClick) { p.onClick({ target: el, preventDefault: () => {}, stopPropagation: () => {}, type: 'click' }); return 'r16'; }
    }
  }
  // 폴백: 네이티브 이벤트
  ['mousedown','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  return 'native';
}

// ── 달력을 대상 날짜의 월이 보일 때까지 이동 ─────────────────
async function navigateCalendarToDate(tabId, dateStr) {
  const [year, month] = dateStr.split('-').map(Number);

  for (let nav = 0; nav < 24; nav++) {
    const cur = await execInPercenty(tabId, () => {
      const h = document.querySelector('.ant-picker-dropdown .ant-picker-header-view') ||
                document.querySelector('.ant-picker-panel .ant-picker-header-view');
      if (!h) return null;
      const t = h.innerText.trim();
      const m1 = t.match(/(\d{4})년\s*(\d{1,2})월/);
      if (m1) return { year: +m1[1], month: +m1[2] };
      const m2 = t.match(/(\d{1,2})월\s*(\d{4})년/);
      if (m2) return { year: +m2[2], month: +m2[1] };
      const m3 = t.match(/(\d{4})[./](\d{1,2})/);
      if (m3) return { year: +m3[1], month: +m3[2] };
      return null;
    });
    if (!cur) break;
    if (cur.year === year && cur.month === month) return;

    const fwd = (year * 12 + month) > (cur.year * 12 + cur.month);
    // 헤더 버튼 클릭 — 네이티브 이벤트로 충분 (portal 바깥에서 렌더된 버튼)
    await execInPercenty(tabId, (forward) => {
      const panel = document.querySelector('.ant-picker-dropdown .ant-picker-panel') ||
                    document.querySelector('.ant-picker-panel');
      const btn = panel?.querySelector(forward ? '.ant-picker-header-next-btn' : '.ant-picker-header-prev-btn');
      if (btn) btn.click();
    }, [fwd]);
    await sleep(350);
  }
}

// ── 날짜 필터 적용 ────────────────────────────────────────────
async function applyDateFilter(tabId, dateFrom, dateTo) {
  await notifyPopup(`날짜 필터 적용: ${dateFrom} ~ ${dateTo}`, 'info');

  // ── 단축 버튼 우선 (오늘) ───────────────────────────────
  const today = todayStr();
  if (dateFrom === today && dateTo === today) {
    const btnOk = await execInPercenty(tabId, () => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText?.trim() === '오늘');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (btnOk) {
      await notifyPopup('날짜: "오늘" 버튼 클릭', 'info');
      await sleep(600);
      await execInPercenty(tabId, () => {
        Array.from(document.querySelectorAll('button'))
          .find(b => b.innerText?.trim() === '상품 검색')?.click();
      });
      await sleep(3000);
      return true;
    }
  }

  // ── 날짜 피커 기존 값 초기화 ─────────────────────────────
  const hasExistingDates = await execInPercenty(tabId, () => {
    const p = document.querySelectorAll('.ant-picker-input input');
    return !!(p[0]?.value?.trim() || p[1]?.value?.trim());
  });
  if (hasExistingDates) {
    await notifyPopup('기존 날짜 감지 → 전체기간으로 초기화', 'info');
    await execInPercenty(tabId, () => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText?.trim() === '전체기간');
      if (btn) btn.click();
    });
    await sleep(600);
  }

  // ── 달력 열기 ────────────────────────────────────────────
  // p[0].click()이 React 이벤트를 못 트리거할 수 있으므로 다양하게 시도
  const pickerOk = await execInPercenty(tabId, () => {
    const p = document.querySelectorAll('.ant-picker-input input');
    if (p.length < 2) return false;
    // 1) input focus
    p[0].focus();
    // 2) .ant-picker 컨테이너에 React 클릭
    const picker = p[0].closest('.ant-picker');
    if (picker) {
      const pk = Object.keys(picker).find(k => k.startsWith('__reactProps'));
      if (pk) {
        picker[pk].onClick?.({ target: picker, preventDefault: () => {}, stopPropagation: () => {} });
      } else {
        picker.click();
      }
    }
    p[0].click();
    return true;
  });
  if (!pickerOk) { await notifyPopup('날짜 피커 없음', 'warn'); return false; }
  await sleep(1000);

  // 달력 상태 로그 (open 여부와 무관하게 진행 — DOM에 셀이 있으면 OK)
  const calInfo = await execInPercenty(tabId, () => {
    const drop = document.querySelector('.ant-picker-dropdown');
    const h    = drop?.querySelector('.ant-picker-header-view');
    const hidden = !drop ||
      drop.classList.contains('ant-picker-dropdown-hidden') ||
      getComputedStyle(drop).display === 'none' ||
      getComputedStyle(drop).visibility === 'hidden';
    const cellCount = drop?.querySelectorAll('.ant-picker-cell').length || 0;
    return {
      open:      !hidden,
      header:    h?.innerText?.trim() || '(없음)',
      cellCount,
    };
  });
  await notifyPopup(`달력: ${calInfo.open ? '열림' : '닫힘'} | 헤더: ${calInfo.header} | 셀: ${calInfo.cellCount}개`, 'info');

  // 달력이 닫혀있으면 focus로 재시도
  if (!calInfo.open) {
    await execInPercenty(tabId, () => {
      const p = document.querySelectorAll('.ant-picker-input input');
      p[0]?.focus();
      p[0]?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      p[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    });
    await sleep(700);
    const calInfo2 = await execInPercenty(tabId, () => {
      const drop = document.querySelector('.ant-picker-dropdown');
      const hidden = !drop || drop.classList.contains('ant-picker-dropdown-hidden') || getComputedStyle(drop).display === 'none';
      return { open: !hidden, cellCount: drop?.querySelectorAll('.ant-picker-cell').length || 0 };
    });
    await notifyPopup(`달력 재시도: ${calInfo2.open ? '열림' : '닫힘'} | 셀: ${calInfo2.cellCount}개`, calInfo2.open ? 'success' : 'warn');
    if (!calInfo2.open && calInfo2.cellCount === 0) {
      await notifyPopup('달력 열기 완전 실패 — 중단', 'error');
      return false;
    }
  }

  // ── 날짜 셀 클릭 (React 직접 호출) ───────────────────────
  const clickCell = async (dateStr, label) => {
    const titleSlash = dateStr.replace(/-/g, '/');
    const dayNum     = String(parseInt(dateStr.split('-')[2], 10));

    const method = await execInPercenty(tabId, (d, ds, day, reactClickFn) => {
      const cell =
        document.querySelector(`.ant-picker-dropdown .ant-picker-cell[title="${d}"]`) ||
        document.querySelector(`.ant-picker-dropdown .ant-picker-cell[title="${ds}"]`) ||
        document.querySelector(`.ant-picker-cell[title="${d}"]`) ||
        document.querySelector(`.ant-picker-cell[title="${ds}"]`) ||
        (() => {
          const inView = Array.from(document.querySelectorAll('.ant-picker-cell.ant-picker-cell-in-view'));
          return inView.find(c => c.querySelector('.ant-picker-cell-inner')?.innerText.trim() === day);
        })();
      if (!cell) return null;

      const inner = cell.querySelector('.ant-picker-cell-inner') || cell;

      // React 17+: __reactProps
      const propsKey = Object.keys(inner).find(k => k.startsWith('__reactProps'));
      if (propsKey) {
        const h = inner[propsKey].onClick || inner[propsKey].onMouseDown;
        if (h) { h({ target: inner, preventDefault: () => {}, stopPropagation: () => {}, type: 'click' }); return 'r17-inner'; }
      }
      // td에서 찾기
      const tdPropsKey = Object.keys(cell).find(k => k.startsWith('__reactProps'));
      if (tdPropsKey) {
        const h = cell[tdPropsKey].onClick || cell[tdPropsKey].onMouseDown;
        if (h) { h({ target: cell, preventDefault: () => {}, stopPropagation: () => {}, type: 'click' }); return 'r17-td'; }
      }
      // React 16: __reactFiber
      const fiberKey = Object.keys(inner).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        let f = inner[fiberKey];
        for (let i = 0; f && i < 15; i++, f = f.return) {
          const p = f.memoizedProps;
          if (p?.onClick) { p.onClick({ target: inner, preventDefault: () => {}, stopPropagation: () => {}, type: 'click' }); return 'r16'; }
        }
      }
      // 마지막 폴백: 네이티브
      ['mousedown','mouseup','click'].forEach(t => inner.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
      return 'native';
    }, [dateStr, titleSlash, dayNum]);

    if (!method) { await notifyPopup(`${label} 셀 없음: ${dateStr}`, 'warn'); return false; }
    await notifyPopup(`${label} 클릭 (${method})`, 'info');
    return true;
  };

  // ── 시작일 ───────────────────────────────────────────────
  await navigateCalendarToDate(tabId, dateFrom);
  if (!await clickCell(dateFrom, '시작일')) return false;
  await sleep(600);

  const startVal = await execInPercenty(tabId, () => {
    const p = document.querySelectorAll('.ant-picker-input input');
    return p[0]?.value || '';
  });
  await notifyPopup(`시작일 input: "${startVal || '비어있음'}"`, startVal ? 'success' : 'warn');

  // ── 종료일 ───────────────────────────────────────────────
  await sleep(300);
  await navigateCalendarToDate(tabId, dateTo);
  if (!await clickCell(dateTo, '종료일')) return false;
  await sleep(800); // 달력 자동 닫힘 대기

  const endVal = await execInPercenty(tabId, () => {
    const p = document.querySelectorAll('.ant-picker-input input');
    return p[1]?.value || '';
  });
  await notifyPopup(`종료일 input: "${endVal || '비어있음'}"`, endVal ? 'success' : 'warn');
  await sleep(800); // 달력 자동 닫힘 대기

  // ── 날짜 확인 로그 (title 속성 = Ant Design 내부 확정값) ─
  const dateCheck = await execInPercenty(tabId, () => {
    const p = document.querySelectorAll('.ant-picker-input input');
    return JSON.stringify({
      from: p[0]?.getAttribute('title') || p[0]?.value || '',
      to:   p[1]?.getAttribute('title') || p[1]?.value || '',
    });
  });
  const dc = JSON.parse(dateCheck || '{}');
  await notifyPopup(`날짜 확인: ${dc.from || '?'} ~ ${dc.to || '?'}`, dc.from && dc.to ? 'success' : 'warn');

  // ── 검색 버튼 클릭 ──────────────────────────────────────
  const searchOk = await execInPercenty(tabId, () => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.trim() === '상품 검색');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!searchOk) await notifyPopup('검색 버튼 없음', 'warn');
  await sleep(3500);
  return true;
}

// ── 그룹 드롭다운 선택 (새로고침 오른편 "전체" 셀렉트) ─────────
async function selectGroupFilter(tabId, groupName) {
  if (!groupName) return true; // 그룹명 없으면 스킵

  await notifyPopup(`그룹 필터 선택: "${groupName}"`, 'info');

  // 1. 현재 그룹 드롭다운 값 확인 (페이지 로드 대기 포함, 최대 5회 재시도)
  // title="${gn}" > title="전체" > title="X번" 순으로 탐색 (이전 탭에서 남긴 값도 인식)
  let currentVal = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    currentVal = await execInPercenty(tabId, (gn) => {
      const el = document.querySelector(`span.ant-select-selection-item[title="${gn}"]`)
              || document.querySelector('span.ant-select-selection-item[title="전체"]')
              || Array.from(document.querySelectorAll('span.ant-select-selection-item'))
                 .find(e => /\d+번$/.test(e.getAttribute('title') || ''));
      return el ? el.getAttribute('title') : null;
    }, [groupName]);
    if (currentVal) break;
    await sleep(600);
  }

  await notifyPopup(`그룹 드롭다운 현재값: "${currentVal || '못찾음'}"`, 'info');

  if (currentVal === groupName) {
    await notifyPopup(`그룹 이미 "${groupName}" 선택됨 — 스킵`, 'info');
    return true;
  }
  if (!currentVal) {
    await notifyPopup('그룹 드롭다운 못찾음 — 스킵', 'warn');
    return true;
  }

  // 2. React props로 드롭다운 열기
  const opened = await execInPercenty(tabId, (gn) => {
    const item = document.querySelector(`span.ant-select-selection-item[title="${gn}"]`)
              || document.querySelector('span.ant-select-selection-item[title="전체"]')
              || Array.from(document.querySelectorAll('span.ant-select-selection-item'))
                 .find(e => /\d+번$/.test(e.getAttribute('title') || ''));
    if (!item) return false;
    const selector = item.closest('.ant-select')?.querySelector('.ant-select-selector');
    if (!selector) return false;
    // React props로 열기 시도
    const propsKey = Object.keys(selector).find(k => k.startsWith('__reactProps'));
    if (propsKey) {
      const h = selector[propsKey].onMouseDown || selector[propsKey].onClick;
      if (h) { h({ preventDefault: () => {}, stopPropagation: () => {} }); return true; }
    }
    selector.click();
    return true;
  }, [groupName]);

  if (!opened) {
    await notifyPopup('그룹 드롭다운 열기 실패 — 스킵', 'warn');
    return true;
  }

  // 3. 드롭다운 열릴 때까지 대기 (hidden 클래스 제거 확인)
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const isOpen = await execInPercenty(tabId, () => {
      const drop = document.querySelector('.ant-select-dropdown');
      return drop && !drop.classList.contains('ant-select-dropdown-hidden');
    });
    if (isOpen) break;
  }

  // 4. Select에 검색어 입력 → 필터링으로 원하는 항목 즉시 렌더 (최대 50 그룹 대응)
  await execInPercenty(tabId, (gn) => {
    // Ant Design Select의 숨겨진 검색 input에 직접 타이핑
    const searchInput = document.querySelector(
      '.ant-select-open input, .ant-select-dropdown:not(.ant-select-dropdown-hidden) input'
    );
    if (searchInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(searchInput, gn);
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: gn }));
    }
    // 가상 스크롤 초기화도 병행
    const holder = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .rc-virtual-list-holder');
    if (holder) { holder.scrollTop = 0; holder.dispatchEvent(new Event('scroll', { bubbles: true })); }
  }, [groupName]);
  await sleep(600);

  // 5. 옵션 클릭 — 못 찾으면 100px씩 아래로 스크롤하며 탐색 (가상 스크롤 대응)
  let selected = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    selected = await execInPercenty(tabId, (gn) => {
      const drop = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      if (!drop) return null;
      // title 속성으로 직접 찾기 (가상 스크롤에서 렌더된 항목)
      const opt = drop.querySelector(`[title="${gn}"].ant-select-item-option`)
               || drop.querySelector(`[title="${gn}"]`);
      if (opt) {
        // React props로 클릭
        const pk = Object.keys(opt).find(k => k.startsWith('__reactProps'));
        if (pk) {
          const h = opt[pk].onClick || opt[pk].onMouseDown;
          if (h) { h({ preventDefault: () => {}, stopPropagation: () => {} }); return { ok: true, found: gn }; }
        }
        opt.click();
        return { ok: true, found: gn };
      }
      // 못 찾으면 아래로 스크롤하여 더 많은 항목 렌더 유도
      const holder = drop.querySelector('.rc-virtual-list-holder');
      if (holder) {
        holder.scrollTop += 100;
        holder.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      const all = Array.from(drop.querySelectorAll('.ant-select-item-option')).map(o => o.getAttribute('title') || o.innerText?.trim());
      return { ok: false, options: all };
    }, [groupName]);
    if (selected?.ok) break;
    if (selected && !selected.ok) {
      await notifyPopup(`[시도${i+1}] 옵션 미렌더: [${(selected.options||[]).join(', ')}]`, 'info');
    }
  }

  if (!selected) {
    await notifyPopup('드롭다운 옵션 로딩 타임아웃', 'warn');
    await execInPercenty(tabId, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })));
    return true;
  }
  if (!selected.ok) {
    await notifyPopup(`그룹 "${groupName}" 없음. 옵션: ${(selected.options || []).join(', ')}`, 'warn');
    await execInPercenty(tabId, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })));
    return true;
  }

  await notifyPopup(`그룹 선택됨: "${selected.found}"`, 'success');
  await sleep(600);
  return true;
}

// ── v2.2.0: 테이블 셀 콘텐츠까지 렌더 완료 대기 ──────────────
async function waitForTableRows(tabId, maxMs = 15000) {
  let lastCount = -1;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const state = await execInPercenty(tabId, () => {
      const loading = !!document.querySelector(
        '.ant-spin-spinning, .ant-table-loading-layer, .ant-spin-blur'
      );
      const rows = document.querySelectorAll('tr.ant-table-row');
      // 첫 번째 행의 두 번째 td에 실제 텍스트가 있는지 확인 (셀 렌더 완료 판별)
      const contentCell = rows[0]?.querySelector('td.ant-table-cell:not(:first-child)');
      const cellsRendered = (contentCell?.innerText?.trim().length || 0) > 0;
      return { loading, count: rows.length, cellsRendered };
    });
    if (!state.loading && state.count > 0 && state.count === lastCount && state.cellsRendered) {
      await sleep(300);
      return state.count;
    }
    lastCount = state.count;
    await sleep(600);
  }
  return lastCount > 0 ? lastCount : 0;
}

// ── v2.2.0: 페이지 이동 헬퍼 ──────────────────────────────────
async function navigateToTablePage(tabId, pageNum) {
  const alreadyOn = await execInPercenty(tabId, (pn) => {
    const active = document.querySelector('li.ant-pagination-item-active');
    return active ? parseInt(active.title, 10) === pn : false;
  }, [pageNum]);
  if (alreadyOn) return;

  await execInPercenty(tabId, (pn) => {
    const btn = document.querySelector(`li[title="${pn}"] a`);
    if (btn) { btn.click(); return; }
    const inp = document.querySelector('.ant-pagination-options-quick-jumper input');
    if (inp) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, String(pn));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
  }, [pageNum]);
  await sleep(1500);
}

// ── 탭2 메인: 상품 복사(클로닝) — v2.2.0 두 단계 방식 ──────────
async function runShuffler(payload) {
  const tabId = await getPercentyTabId();
  if (!tabId) { await notifyPopup('퍼센티 탭 없음', 'error'); return false; }

  const settings       = payload?.settings || {};
  const dateFrom       = settings.dateFrom  || todayStr();
  const dateTo         = settings.dateTo    || todayStr();
  const numberOfPages  = payload?.numberOfPages || settings.pagesTab2 || 2;
  const groupName      = payload?.account?.groupName || '';
  const isFirstAccount = payload?.isFirstAccount ?? false;

  try {
    const filterOk = await applyDateFilter(tabId, dateFrom, dateTo);
    if (!filterOk) { await notifyPopup('날짜 필터 실패 — 중단', 'error'); return false; }

    await selectGroupFilter(tabId, groupName);
    if (groupName) await sleep(1500);

    const startPage = await execInPercenty(tabId, () => {
      const el = document.querySelector('li.ant-pagination-item-active');
      return el ? (parseInt(el.title, 10) || 1) : 1;
    });

    // 실제 마지막 페이지 감지 → 설정값과 비교해 작은 쪽 사용
    const actualLastPage = await execInPercenty(tabId, () => {
      const items = Array.from(document.querySelectorAll('li.ant-pagination-item'));
      if (!items.length) return 9999;
      const nums = items.map(el => parseInt(el.title || el.innerText, 10)).filter(n => n > 0);
      return nums.length ? Math.max(...nums) : 1;
    });
    const configuredEndPage = startPage + numberOfPages - 1;
    const endPage = Math.min(configuredEndPage, actualLastPage);
    if (actualLastPage < configuredEndPage) {
      await notifyPopup(`실제 페이지 ${actualLastPage}p — 설정(${configuredEndPage}p) 대신 실제 기준으로 작업`, 'warn');
    }

    // ── Phase 1: 전 페이지 스캔 (셀 렌더 확인 후 ID 수집) ──
    await notifyPopup(`탭2 스캔: ${startPage}~${endPage}페이지`, 'info');
    const allProducts = [];

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      if (!isRunning) break;
      await waitIfPaused();
      await navigateToTablePage(tabId, pageNum);
      const rowCount = await waitForTableRows(tabId);
      if (!rowCount) { await notifyPopup(`${pageNum}p 상품 없음, 스킵`, 'warn'); continue; }

      const products = await execInPercenty(tabId, () =>
        Array.from(document.querySelectorAll('tr.ant-table-row')).map(row => {
          const id = row.dataset.rowKey || row.getAttribute('data-row-key');
          if (!id) return null;
          const nameEl = row.querySelector('span[class*="kBZQvW"]') || row.querySelector('span[class*="sc-k"]');
          return { id, name: nameEl?.innerText?.trim() || '' };
        }).filter(Boolean)
      );

      allProducts.push(...products.map(p => ({ ...p, page: pageNum })));
      await notifyPopup(`${pageNum}p ${products.length}개 수집`, 'info');
    }

    if (!allProducts.length) { await notifyPopup('수집된 상품 없음', 'warn'); return true; }
    await notifyPopup(`총 ${allProducts.length}개 — 처리 시작`, 'info');
    await chrome.storage.local.set({ countTab2: allProducts.length });

    // ── Phase 2: 처리 (페이지 역순 → 행 역순) + 최대 3회 재시도 ──
    const reversed = [...allProducts].reverse();
    let currentPage = -1;

    for (const [i, product] of reversed.entries()) {
      if (!isRunning) break;
      await waitIfPaused();

      if (product.page !== currentPage) {
        await navigateToTablePage(tabId, product.page);
        await waitForTableRows(tabId);
        currentPage = product.page;
      }

      const preview = product.name ? product.name.slice(0, 22) : product.id.slice(0, 10);
      await notifyPopup(`(${i + 1}/${reversed.length}) ${preview}`, 'info');

      let result = null;
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) {
          await notifyPopup(`  재시도 ${retry}/2 (${result?.reason || '?'})`, 'warn');
          await sleep(2000);
          await execInPercenty(tabId, () => {
            const d = document.querySelector('div.ant-drawer.ant-drawer-open');
            if (d) {
              const cb = d.querySelector('button.ant-drawer-close') || d.querySelector('button[aria-label="Close"]');
              if (cb) cb.click();
              else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }
          });
          await sleep(500);
        }
        result = await processOneProduct(tabId, product.id, { isFirstAccount });
        if (result?.ok) break;
      }

      if (result?.ok) {
        await notifyPopup(`  ✔ ${(result.name || '').slice(0, 25)}`, 'success');
      } else {
        await notifyPopup(`  ⚠ 최종 실패(${result?.reason || '?'}): ${product.id.slice(0, 8)}`, 'warn');
      }
      await sleep(1500 + Math.random() * 500);
    }

    await notifyPopup('탭2 복사 완료 — 서버 처리 대기 중 (10초)...', 'info');
    await sleep(10000);
    await notifyPopup('탭2 완료!', 'success');
    return true;

  } catch (e) {
    await notifyPopup('탭2 오류: ' + e.message, 'error');
    return false;
  }
}

// ── 상품 1개 처리: 편집창 열기 → 이름 읽기 → 셔플 → 복사 → 닫기 ──
// v2.2.0: scrollIntoView+렌더대기 / 5가지 트리거 / 복사버튼 폴링
async function processOneProduct(tabId, rowKey, opts = {}) {
  try {
    // Step 1: 행 스크롤 → React 셀 렌더링 유도
    await execInPercenty(tabId, (rk) => {
      document.querySelector(`tr[data-row-key="${rk}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, [rowKey]);
    await sleep(400); // 셀 콘텐츠 렌더 완료 대기

    // Step 2: 드로어 열기 (5가지 방법)
    const openResult = await execInPercenty(tabId, (rk) => {
      const row = document.querySelector(`tr[data-row-key="${rk}"]`);
      if (!row) return 'NO_ROW';

      function fire(el) {
        ['mousedown', 'mouseup', 'click'].forEach(ev =>
          el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
        );
      }

      // 방법1: "판매가" 텍스트 span
      const priceSpan = Array.from(row.querySelectorAll('span'))
        .find(s => s.innerText.trim() === '판매가');
      if (priceSpan) { fire(priceSpan); return 'price'; }

      // 방법2: 상품명 span (CSS 모듈 클래스 partial match)
      const nameSpan = row.querySelector('span[class*="kBZQvW"]')
                    || row.querySelector('span[class*="sc-k"]');
      if (nameSpan?.innerText?.trim()) { fire(nameSpan); return 'name'; }

      // 방법3: 두 번째 td (상품 이미지/정보 영역)
      const cells = Array.from(row.querySelectorAll('td.ant-table-cell'));
      if (cells[1]) { fire(cells[1]); return 'cell2'; }

      // 방법4: 체크박스 아닌 첫 번째 텍스트 td
      const anyCell = cells.find(td =>
        !td.querySelector('input[type="checkbox"]') && td.innerText.trim()
      );
      if (anyCell) { fire(anyCell); return 'cell'; }

      // 방법5 (최후): 행 자체 클릭
      fire(row);
      return 'row';
    }, [rowKey]);

    if (openResult === 'NO_ROW') return { ok: false, reason: 'NO_ROW' };

    // Step 3: 드로어 대기 (15초)
    let drawerReady = false;
    for (let i = 0; i < 60; i++) {
      drawerReady = await execInPercenty(tabId, () => {
        const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
        return !!(drawer?.querySelector('input.ant-input[type="text"]'));
      });
      if (drawerReady) break;
      await sleep(250);
    }
    if (!drawerReady) return { ok: false, reason: `DRAWER_TIMEOUT(${openResult})` };

    await sleep(400);

    // Step 4: 상품명 읽기
    const originalName = await execInPercenty(tabId, () => {
      const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
      return drawer?.querySelector('input.ant-input[type="text"]')?.value?.trim() || '';
    });

    // Step 4-1: 추천 단어 검색 + 클릭 (50자 이내) — 첫 번째 계정만 실행
    if (originalName && opts.isFirstAccount) {
      await applyKeywordSearch(tabId, originalName);
      // Step 4-2: 카테고리 추천 클릭
      await clickCategoryRecommendation(tabId);
    }

    // Step 4-3: 업데이트된 이름 읽기 → 셔플
    const updatedName = await execInPercenty(tabId, () => {
      const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
      return drawer?.querySelector('input.ant-input[type="text"]')?.value?.trim() || '';
    });
    const nameToShuffle = updatedName || originalName;
    const shuffledName = nameToShuffle ? shuffleName(nameToShuffle) : '';

    if (shuffledName) {
      await execInPercenty(tabId, (newName) => {
        const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
        if (!drawer) return;
        const inp = drawer.querySelector('input.ant-input[type="text"]');
        if (!inp) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, newName);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }, [shuffledName]);
      await sleep(300);
    }

    // Step 5: 저장하기 (복사 전 1회)
    const saved = await execInPercenty(tabId, () => {
      const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
      if (!drawer) return false;
      const btn = Array.from(drawer.querySelectorAll('button.ant-btn'))
        .find(b => b.innerText?.trim().includes('저장하기') || b.innerText?.trim() === '저장');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    if (saved) {
      await notifyPopup('저장하기 클릭', 'info');
      await sleep(1500); // 저장 완료 대기
    } else {
      await notifyPopup('저장하기 버튼 없음 — 스킵', 'warn');
    }

    // Step 6: 복사 버튼 (최대 3초 폴링)
    let copied = false;
    for (let i = 0; i < 6; i++) {
      copied = await execInPercenty(tabId, () => {
        const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
        if (!drawer) return false;
        const btn = Array.from(drawer.querySelectorAll('button.ant-btn'))
          .find(b => b.innerText.includes('상품 복사') || b.querySelector('span[aria-label="copy"]'));
        if (!btn || btn.disabled || btn.classList.contains('ant-btn-loading')) return false;
        btn.click();
        return true;
      });
      if (copied) break;
      await sleep(500);
    }
    if (!copied) return { ok: false, reason: 'NO_COPY_BTN' };

    await sleep(2500);

    // Step 6: 드로어 닫기
    for (let i = 0; i < 30; i++) {
      const stillOpen = await execInPercenty(tabId, () => {
        const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
        if (!drawer) return false;
        const closeBtn =
          drawer.querySelector('button.ant-drawer-close') ||
          drawer.querySelector('button[aria-label="Close"]') ||
          drawer.querySelector('span[aria-label="close"]')?.closest('button');
        if (closeBtn) { closeBtn.click(); return true; }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        return true;
      });
      if (!stillOpen) break;
      await sleep(300);
    }
    await execInPercenty(tabId, () => {
      if (document.querySelector('div.ant-drawer.ant-drawer-open'))
        document.querySelector('.ant-drawer-mask')?.click();
    });
    await sleep(300);

    return { ok: true, name: originalName };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 10000);
  });
}

// ── 신규상품 관리 그룹 필터 클릭 ─────────────────────────────
async function filterByGroup(tabId, groupName) {
  // 1순위: Ant Design 탭 아이템 (div.ant-tabs-tab, li.ant-tabs-tab)
  // 2순위: 버튼, 라디오, span 등 텍스트 일치 요소
  // 3순위: 전체 리프노드 탐색
  const result = await execInPercenty(tabId, (name) => {
    const candidates = [];

    // Ant Design 탭
    document.querySelectorAll('.ant-tabs-tab, .ant-tabs-tab-btn').forEach(el => {
      if (el.innerText?.trim().includes(name)) candidates.push(el);
    });

    // 버튼/span/div 중 정확 일치
    if (!candidates.length) {
      const tags = ['button', 'span', 'div', 'li', 'a'];
      for (const tag of tags) {
        document.querySelectorAll(tag).forEach(el => {
          const t = el.innerText?.trim();
          if (t === name || t === `${name}`) candidates.push(el);
        });
        if (candidates.length) break;
      }
    }

    // 포함 일치 (리프노드)
    if (!candidates.length) {
      Array.from(document.querySelectorAll('*')).forEach(e => {
        if (e.children.length === 0 && e.offsetParent !== null && e.innerText?.trim().includes(name))
          candidates.push(e);
      });
    }

    if (!candidates.length) {
      // 디버그: 현재 보이는 탭 목록 반환
      const tabs = Array.from(document.querySelectorAll('.ant-tabs-tab, .ant-tabs-tab-btn'))
        .map(e => e.innerText?.trim()).filter(Boolean);
      return { ok: false, tabs };
    }

    // 가장 작은(리프에 가까운) 요소 클릭
    const target = candidates.reduce((a, b) =>
      a.querySelectorAll('*').length <= b.querySelectorAll('*').length ? a : b
    );
    target.click();
    return { ok: true, text: target.innerText?.trim() };
  }, [groupName]);

  if (!result?.ok) {
    const tabList = result?.tabs?.join(', ') || '없음';
    await notifyPopup(`그룹 탭 "${groupName}" 없음 | 현재 탭: ${tabList}`, 'warn');
    return false;
  }
  await notifyPopup(`그룹 필터 클릭: "${result.text}"`, 'info');
  return true;
}

// ============================================================
// 탭3 — 신규상품 관리: 숫자 지우기 + 그룹 이동
// ============================================================

async function runTab3(payload) {
  const tabId = await getPercentyTabId();
  if (!tabId) { await notifyPopup('퍼센티 탭 없음', 'error'); return false; }

  const account       = payload?.account;
  const sourceGroup   = account?.groupName  || '';
  const targetGroup   = account?.group2Name || '';
  const maxPages      = payload?.numberOfPages || 2;

  // 새로고침 버튼 클릭 헬퍼 (버튼 내 span이 여러 개일 수 있으므로 querySelectorAll 사용)
  const clickRefresh = () => execInPercenty(tabId, () => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      Array.from(b.querySelectorAll('span')).some(s => s.innerText?.trim() === '새로고침')
    );
    if (btn) btn.click();
    return !!btn;
  });

  // 스크롤로 가상 리스트 렌더링 유도 헬퍼
  const scrollToRender = async () => {
    for (let step = 1; step <= 5; step++) {
      await execInPercenty(tabId, (s) => {
        window.scrollTo({ top: document.body.scrollHeight / 5 * s, behavior: 'smooth' });
      }, [step]);
      await sleep(400);
    }
    await execInPercenty(tabId, () => window.scrollTo({ top: 0 }));
    await sleep(800);
  };

  try {
    // 0단계: 그룹1 필터 선택
    if (sourceGroup) {
      await selectGroupFilter(tabId, sourceGroup);
      await sleep(1500);
    }

    // ── Phase 1: 전체 상품 이름 수정 (숫자 제거 + 셔플) ──────────
    // processedIds: 이미 처리한 상품 ID 추적 (페이지 넘어가도 중복 없이)
    await notifyPopup('탭3 Phase 1: 전체 상품 이름 수정 시작', 'info');
    const processedIds = new Set();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (!isRunning) break;
      await waitIfPaused();

      await scrollToRender();

      // 현재 화면 상품 수집 (이미 처리된 ID 제외)
      const products = await execInPercenty(tabId, (doneIds) =>
        Array.from(document.querySelectorAll('li.ant-list-item[id]'))
          .map(el => ({
            id:   el.id,
            name: el.querySelector('span.sc-kWtpeL.kBZQvW')?.innerText?.trim() || '',
          }))
          .filter(p => p.name && !doneIds.includes(p.id)),
        [[...processedIds]]
      );

      if (!products?.length) {
        await notifyPopup(`Phase1 ${pageNum}p: 처리할 상품 없음`, 'info');
        break;
      }
      await notifyPopup(`Phase1 ${pageNum}/${maxPages}p: ${products.length}개 이름 수정 중`, 'info');

      let successCount = 0;
      for (const product of products) {
        if (!isRunning) break;
        await waitIfPaused();
        const stripped = product.name.replace(/\(\d+\)/g, '').trim();
        const newName  = shuffleName(stripped);
        const ok = await applyNewProductName(tabId, product.id, newName);
        if (ok) { successCount++; processedIds.add(product.id); }
        else await notifyPopup(`  ⚠ 실패: ${product.name.slice(0, 25)}`, 'warn');
        await sleep(300);
      }

      // 새로고침 후 누락 (숫자 패턴 남은 것) 재처리
      await clickRefresh();
      await sleep(2000);
      await scrollToRender();

      const remaining = await execInPercenty(tabId, () =>
        Array.from(document.querySelectorAll('li.ant-list-item[id]')).map(el => ({
          id:   el.id,
          name: el.querySelector('span.sc-kWtpeL.kBZQvW')?.innerText?.trim() || '',
        })).filter(p => p.name && /\(\d+\)/.test(p.name))
      );
      if (remaining?.length) {
        await notifyPopup(`누락 ${remaining.length}개 재처리`, 'warn');
        for (const product of remaining) {
          if (!isRunning) break;
          const stripped = product.name.replace(/\(\d+\)/g, '').trim();
          const newName  = shuffleName(stripped);
          const ok = await applyNewProductName(tabId, product.id, newName);
          if (ok) processedIds.add(product.id);
          await sleep(300);
        }
        await clickRefresh();
        await sleep(2000);
      }

      await notifyPopup(`Phase1 ${pageNum}p 완료: ${successCount}/${products.length}개`, 'info');

      // 다음 페이지가 있는지 확인 (페이지 버튼 감지)
      const hasNextPage = await execInPercenty(tabId, (cur) => {
        const items = Array.from(document.querySelectorAll('li.ant-pagination-item'));
        const nums = items.map(el => parseInt(el.title || el.innerText, 10)).filter(n => n > 0);
        return Math.max(...nums, 0) > cur;
      }, [pageNum]);

      if (!hasNextPage) {
        await notifyPopup(`Phase1: ${pageNum}p가 마지막 페이지`, 'info');
        break;
      }

      // 다음 페이지로 이동
      const nextClicked = await execInPercenty(tabId, (next) => {
        const items = Array.from(document.querySelectorAll('li.ant-pagination-item'));
        const target = items.find(el => parseInt(el.title || el.innerText, 10) === next);
        if (target) { target.click(); return true; }
        // next 버튼 fallback
        const nextBtn = document.querySelector('li.ant-pagination-next button');
        if (nextBtn && !nextBtn.disabled) { nextBtn.click(); return true; }
        return false;
      }, [pageNum + 1]);

      if (!nextClicked) {
        await notifyPopup(`${pageNum + 1}p 이동 실패 — Phase1 종료`, 'warn');
        break;
      }
      await sleep(2000);
    }

    await notifyPopup(`Phase1 완료 — 총 ${processedIds.size}개 이름 수정`, 'success');
    await chrome.storage.local.set({ countTab3names: processedIds.size });

    if (!isRunning) return true;
    await waitIfPaused();

    // ── Phase 2: 그룹 이동 (남은 상품 없을 때까지 반복) ──────────
    if (!targetGroup) {
      await notifyPopup('그룹2 미설정 — 그룹 이동 생략', 'warn');
      return true;
    }

    await notifyPopup(`Phase 2: 그룹 이동 → "${targetGroup}" 시작`, 'info');

    // 다시 1페이지 / 필터 초기화 (그룹1 필터 재적용)
    if (sourceGroup) {
      await selectGroupFilter(tabId, sourceGroup);
      await sleep(1500);
    }

    // ── Phase 2 그룹 이동 루프 ─────────────────────────────────
    // 핵심: 매 회차마다 반드시 1페이지에서 작업
    // (페이지2 이상에서 이동 후 새로고침하면 리스트가 보이지 않는 문제 방지)
    // maxPages 횟수만큼 정확히 반복 (페이지당 1회 이동)
    let totalMoved = 0;

    for (let moveIter = 1; moveIter <= maxPages; moveIter++) {
      if (!isRunning) break;
      await waitIfPaused();

      await notifyPopup(`Phase2 ${moveIter}/${maxPages}회차 — 1페이지로 초기화 중...`, 'info');

      // ① 필터 재적용 (1페이지부터 새 리스트 로드)
      if (sourceGroup) {
        await selectGroupFilter(tabId, sourceGroup);
        await sleep(2000);
      } else {
        await clickRefresh();
        await sleep(2000);
      }

      // ② 명시적으로 1페이지 클릭 (필터 재적용 후에도 페이지 번호가 유지될 수 있으므로)
      await execInPercenty(tabId, () => {
        const page1 = Array.from(document.querySelectorAll('li.ant-pagination-item'))
          .find(el => parseInt(el.title || el.innerText, 10) === 1);
        if (page1) { page1.click(); return true; }
        // 페이지네이션 없으면 이미 1페이지
        return false;
      });
      await sleep(1500);

      // ③ 스크롤로 렌더링 유도 후 상품 수집
      await scrollToRender();
      const products = await execInPercenty(tabId, () =>
        Array.from(document.querySelectorAll('li.ant-list-item[id]')).map(el => ({
          id: el.id,
          name: el.querySelector('span.sc-kWtpeL.kBZQvW')?.innerText?.trim() || '',
        })).filter(p => p.id)
      );

      if (!products?.length) {
        await notifyPopup(`Phase2 ${moveIter}/${maxPages}회차: 1페이지에 상품 없음 — 완료`, 'success');
        break;
      }
      await notifyPopup(`${moveIter}/${maxPages}회차: 1페이지 ${products.length}개 → "${targetGroup}" 이동`, 'info');

      // ④ 전체 선택
      const cbOk = await execInPercenty(tabId, () => {
        const cb = document.querySelectorAll('input.ant-checkbox-input')[0];
        if (cb && !cb.checked) { cb.click(); return true; }
        return !!cb?.checked;
      });
      if (!cbOk) { await notifyPopup('체크박스 없음', 'warn'); continue; }
      await sleep(1000);

      // ⑤ 그룹 지정 버튼
      const groupBtnOk = await execInPercenty(tabId, () => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.innerText?.trim().includes('그룹 지정'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!groupBtnOk) { await notifyPopup('그룹 지정 버튼 없음', 'error'); return false; }

      // ⑥ 모달 대기 (최대 6초)
      let modalReady = false;
      for (let i = 0; i < 12; i++) {
        await sleep(500);
        modalReady = await execInPercenty(tabId, () =>
          !!(document.querySelector('.ant-modal-content') || document.querySelector('.ant-modal')) &&
          document.querySelectorAll('input[type="radio"]').length > 0
        );
        if (modalReady) break;
      }
      if (!modalReady) { await notifyPopup('그룹 모달 열리지 않음', 'error'); return false; }

      // ⑦ 라디오 선택
      const radioOk = await execInPercenty(tabId, (group) => {
        const modal = document.querySelector('.ant-modal-content') || document.body;
        const labels = Array.from(modal.querySelectorAll('label.ant-radio-wrapper, label'));
        const target = labels.find(l => l.innerText?.trim() === group)
                    || labels.find(l => l.innerText?.trim().includes(group));
        if (!target) return { ok: false, list: labels.map(l => l.innerText?.trim()).join(', ') };
        const radio = target.querySelector('input[type="radio"]') || target;
        radio.click();
        return { ok: true, found: target.innerText?.trim() };
      }, [targetGroup]);

      if (!radioOk?.ok) {
        await notifyPopup(`그룹 없음: "${targetGroup}" | 존재: ${radioOk?.list || '없음'}`, 'error');
        return false;
      }
      await sleep(800);

      // ⑧ 확인 버튼
      const confirmOk = await execInPercenty(tabId, () => {
        const modal = document.querySelector('.ant-modal-content') || document.body;
        const btn = Array.from(modal.querySelectorAll('button'))
          .find(b => b.innerText?.trim() === '확인' || b.innerText?.trim().includes('확인'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!confirmOk) { await notifyPopup('확인 버튼 없음', 'error'); return false; }

      totalMoved += products.length;
      await notifyPopup(`이동 완료 (${moveIter}/${maxPages}회차, 누적 ${totalMoved}개) — 서버 대기...`, 'success');
      await sleep(4000);

      // ⑨ 새로고침 3회 (서버 반영 안정화) — 다음 회차에서 필터+1페이지로 다시 초기화
      for (let r = 1; r <= 3; r++) {
        const ok = await clickRefresh();
        await sleep(3000);
        await notifyPopup(`  새로고침 ${r}/3 ${ok ? '완료' : '버튼없음'}`, 'info');
      }
    }

    // 최종 새로고침 3회
    await notifyPopup('탭3 완료 — 새로고침 3회...', 'info');
    let finalCount = 0;
    for (let r = 0; r < 3; r++) {
      await clickRefresh();
      await sleep(2500);
    }
    // 최종 남은 수 확인 (0이어야 정상)
    finalCount = await execInPercenty(tabId, () =>
      document.querySelectorAll('li.ant-list-item[id]').length
    );
    await chrome.storage.local.set({ countTab3moved: totalMoved });
    if (finalCount > 0) {
      await notifyPopup(`⚠ 탭3 완료 후 ${finalCount}개 미이동 상품 남음 (누적이동: ${totalMoved}개)`, 'warn');
    } else {
      await notifyPopup(`✔ 탭3 완료 — 이름수정 ${processedIds.size}개, 그룹이동 ${totalMoved}개`, 'success');
    }

    return true;

  } catch (e) {
    await notifyPopup('탭3 오류: ' + e.message, 'error');
    return false;
  }
}

// 신규상품 이름 변경 (숫자 제거 후 적용, 중복 시 . 추가 재시도)
async function applyNewProductName(tabId, id, newName) {
  const tryApply = async (name) => {
    // 편집 버튼 클릭
    const clicked = await execInPercenty(tabId, (itemId) => {
      const el = document.getElementById(itemId);
      if (!el) return false;
      const editBtn = el.querySelector('button.sc-dlWCHZ.cSQmK');
      if (!editBtn) return false;
      editBtn.click();
      return true;
    }, [id]);
    if (!clicked) return { ok: false, err: 'NO_EDIT_BTN' };
    await sleep(500);

    // 입력란에 값 설정 + Enter
    const inputOk = await execInPercenty(tabId, (itemId, n) => {
      const el = document.getElementById(itemId);
      if (!el) return false;
      const input = el.querySelector('input.ant-input.css-1li46mu');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, n);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, [id, name]);
    if (!inputOk) return { ok: false, err: 'NO_INPUT' };
    await sleep(200);

    await execInPercenty(tabId, (itemId) => {
      const el = document.getElementById(itemId);
      const input = el?.querySelector('input.ant-input.css-1li46mu');
      if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }, [id]);
    await sleep(2000);

    // 결과 확인
    return await execInPercenty(tabId, (itemId) => {
      const el = document.getElementById(itemId);
      if (!el) return { ok: true }; // 사라졌으면 성공으로 간주
      const finalName = el.querySelector('span.sc-kWtpeL.kBZQvW')?.innerText?.trim() || '';
      if (/\(\d+\)\s*$/.test(finalName)) return { ok: false, err: 'AUTO_NUMBERED' };
      const errEl = document.querySelector('.ant-message-error');
      if (errEl?.innerText?.includes('이미 존재하는 상품명')) return { ok: false, err: 'DUPLICATE' };
      return { ok: true };
    }, [id]);
  };

  let result = await tryApply(newName);
  if (!result?.ok && (result?.err === 'AUTO_NUMBERED' || result?.err === 'DUPLICATE')) {
    result = await tryApply(newName + '.');
  }
  return result?.ok;
}

// ============================================================
// 탭4 — 신규상품 관리: 마켓 업로드
// ============================================================

async function runTab4(payload) {
  const tabId = await getPercentyTabId();
  if (!tabId) { await notifyPopup('퍼센티 탭 없음', 'error'); return false; }

  const account     = payload?.account;
  const uploadGroup = account?.group2Name || account?.groupName || '';
  const maxPages    = payload?.settings?.pagesTab4 || payload?.numberOfPages || 0; // 0=무제한

  try {
    // 그룹2 필터 선택
    if (uploadGroup) {
      await selectGroupFilter(tabId, uploadGroup);
      await sleep(1500);
    }

    // ── 페이지별 업로드 루프 ─────────────────────────────────
    let pageNum = 0;
    while (isRunning) {
      await waitIfPaused();
      pageNum++;
      if (maxPages > 0 && pageNum > maxPages) {
        await notifyPopup(`${maxPages}회 업로드 제한 도달 — 완료`, 'info');
        break;
      }

      // 루프마다 그룹 필터 재적용 (새로고침 후 드롭다운이 초기화되므로)
      if (uploadGroup) {
        await selectGroupFilter(tabId, uploadGroup);
        await sleep(1500);
      }

      // 상품 수 확인
      const itemCount = await execInPercenty(tabId, () =>
        document.querySelectorAll('li.ant-list-item[id]').length
      );
      if (!itemCount) { await notifyPopup('업로드할 상품 없음 — 완료', 'success'); break; }
      await notifyPopup(`${pageNum}회차 업로드 (${itemCount}개)`, 'info');
      // 이 회차의 업로드 예상 수량 저장 (완료 시 카운팅에 사용)
      const thisRoundCount = itemCount;

      // 전체 선택
      const cb = await execInPercenty(tabId, () => {
        const el = document.querySelectorAll('input.ant-checkbox-input')[0];
        if (el && !el.checked) { el.click(); return true; }
        return !!el?.checked;
      });
      if (!cb) { await notifyPopup('체크박스 없음', 'warn'); break; }
      await sleep(600);

      // ── 1단계: "업로드" 버튼 클릭 ────────────────────────────
      let uploadBtn = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        uploadBtn = await execInPercenty(tabId, () => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            !b.disabled &&
            Array.from(b.querySelectorAll('span')).some(s => s.innerText?.trim() === '업로드')
          );
          if (btn) { btn.click(); return true; }
          return null;
        });
        if (uploadBtn) break;
        await sleep(500);
      }
      if (!uploadBtn) { await notifyPopup('업로드 버튼 없음', 'error'); return false; }
      await notifyPopup('업로드 버튼 클릭 — 모달 대기', 'info');
      await sleep(2000);

      // ── 2단계: 모달 내 primary 버튼 클릭으로 업로드 시작 ────────
      // (Enter키는 페이지 포커스 없으면 무효 → 버튼 직접 클릭)
      let uploadStarted = false;
      for (let i = 0; i < 14; i++) {
        uploadStarted = await execInPercenty(tabId, () => {
          // 열린 모달 탐색
          const wrap = document.querySelector('.ant-modal-wrap:not([style*="display: none"])');
          if (!wrap) return false;
          const modal = wrap.querySelector('.ant-modal-content');
          if (!modal) return false;

          // 모달 내 primary 버튼 (업로드 시작 버튼)
          const buttons = Array.from(modal.querySelectorAll('button'));
          const primaryBtn = buttons.find(b => b.classList.contains('ant-btn-primary') && !b.disabled);
          if (primaryBtn) {
            const pk = Object.keys(primaryBtn).find(k => k.startsWith('__reactProps'));
            if (pk && primaryBtn[pk]?.onClick) {
              primaryBtn[pk].onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: {} });
              return 'react-primary';
            }
            primaryBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            primaryBtn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
            primaryBtn.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
            return 'click-primary';
          }
          // primary 없으면 모달 내 첫 번째 활성 버튼
          const anyBtn = buttons.find(b => !b.disabled);
          if (anyBtn) { anyBtn.click(); return 'click-any'; }
          return false;
        });
        if (uploadStarted) {
          await notifyPopup(`업로드 시작 (${uploadStarted})`, 'info');
          break;
        }
        await sleep(500);
      }
      if (!uploadStarted) { await notifyPopup('업로드 시작 버튼 없음', 'error'); return false; }
      await sleep(3000);

      // ── 3단계: 업로드 진행/완료 폴링 — 열린 모달 내부만 감지 ───
      // (body 전체 감지하면 이전 업로드 잔류 텍스트에서 오감지 발생)
      const deadline = Date.now() + 3600000;
      let uploadDone = false;
      let lastProg   = '';  // 마지막 진행 텍스트 (완료 시 수량 추출용)
      while (Date.now() < deadline) {
        if (!isRunning) return false;
        await sleep(5000);
        const s = await execInPercenty(tabId, () => {
          // 열린 모달만 탐색
          const wrap = document.querySelector('.ant-modal-wrap:not([style*="display: none"])');
          const text = wrap ? (wrap.innerText || '') : '';
          const allDone   = text.includes('모든 업로드가 완료됐습니다');
          const countDone = text.match(/(\d+)\/(\d+) 업로드 완료/)?.[0] || '';
          const prog      = text.match(/(\d+)\/(\d+) 업로드중/)?.[0] || '';
          const login     = document.body.innerText.includes('로그인이 필요합니다');
          return { done: allDone || !!countDone, doneText: allDone ? '모든 업로드 완료' : countDone, prog, login };
        });
        if (s.login) {
          await execInPercenty(tabId, () => {
            Array.from(document.querySelectorAll('button'))
              .find(b => b.innerText?.trim() === '확인')?.click();
          });
        }
        if (s.prog) {
          lastProg = s.prog;
          await notifyPopup(`업로드 중: ${s.prog}`, 'info');
        }
        if (s.done) {
          await notifyPopup(`업로드 완료: ${s.doneText || lastProg}`, 'success');
          // 수량 추출 순서: 완료 텍스트 N/M → 마지막 진행 N/M → itemCount(선택된 수량)
          const uploadedMatch = (s.doneText || lastProg || '').match(/(\d+)\/(\d+)/);
          const uploadedCount = uploadedMatch ? parseInt(uploadedMatch[2], 10) : thisRoundCount;
          const prev = (await chrome.storage.local.get('countTab4')).countTab4 || 0;
          await chrome.storage.local.set({ countTab4: prev + uploadedCount });
          uploadDone = true;
          break;
        }
      }
      if (!uploadDone) { await notifyPopup('업로드 타임아웃', 'error'); return false; }

      // ── 4단계: 모달 닫기 — 모달이 닫힐 때까지 감지 루프 ─────────
      // React props → MouseEvent → X버튼 → Escape 순으로 시도
      // 모달 DOM 사라짐으로 닫힘 최종 확인
      for (let i = 0; i < 15; i++) {
        const state = await execInPercenty(tabId, () => {
          const wrap = document.querySelector('.ant-modal-wrap:not([style*="display: none"])');
          if (!wrap) return 'closed'; // 이미 닫힘
          const modal = wrap.querySelector('.ant-modal-content');
          if (!modal) return 'closed';

          // 닫기 버튼 탐색
          const closeBtn = Array.from(modal.querySelectorAll('button')).find(b =>
            b.innerText?.trim() === '닫기' ||
            Array.from(b.querySelectorAll('span')).some(s => s.innerText?.trim() === '닫기')
          );
          if (closeBtn) {
            const pk = Object.keys(closeBtn).find(k => k.startsWith('__reactProps'));
            if (pk && closeBtn[pk]?.onClick) {
              closeBtn[pk].onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: {} });
              return 'react';
            }
            closeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            closeBtn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
            closeBtn.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
            return 'mouse';
          }
          // X 버튼
          const xBtn = wrap.querySelector('button.ant-modal-close');
          if (xBtn) {
            xBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return 'xbtn';
          }
          // Escape
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          return 'escape';
        });

        if (state === 'closed') { await notifyPopup('모달 닫힘 확인', 'info'); break; }
        await notifyPopup(`닫기 시도 (${state})`, 'info');
        await sleep(700);
      }
      await sleep(1500);

      // ── 5단계: 새로고침 3회 (리스트 재정비) ──────────────────
      await notifyPopup('새로고침 3회 (리스트 재정비)...', 'info');
      for (let r = 0; r < 3; r++) {
        const refreshed = await execInPercenty(tabId, () => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            Array.from(b.querySelectorAll('span')).some(s => s.innerText?.trim() === '새로고침')
          );
          if (btn) { btn.click(); return true; }
          return false;
        });
        await notifyPopup(`  새로고침 ${r + 1}/3 ${refreshed ? '완료' : '버튼 없음'}`, 'info');
        await sleep(2500);
      }
    }

    return true;

  } catch (e) {
    await notifyPopup('탭4 오류: ' + e.message, 'error');
    return false;
  }
}

// ============================================================
// 추천 단어 검색 + 카테고리 추천
// ============================================================

// execInPercenty 일반화 버전 (모든 탭에서 사용)
function execInTab(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'MAIN',
  }).then(r => r?.[0]?.result);
}

// 상품명 추천 단어 검색 + 클릭 (50자 이하 유지)
async function applyKeywordSearch(tabId, productName) {
  // 드로어 내 키워드 검색 입력란 찾기 (상품명 입력란과 다른 input)
  const searchFilled = await execInPercenty(tabId, (name) => {
    const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
    if (!drawer) return false;

    const mainInput = drawer.querySelector('input.ant-input[type="text"]');
    const allInputs = Array.from(drawer.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
    const searchInput = allInputs.find(inp =>
      inp !== mainInput && (
        inp.placeholder?.includes('검색') ||
        inp.placeholder?.includes('단어') ||
        inp.placeholder?.includes('키워드') ||
        inp.closest('[class*="keyword"]') ||
        inp.closest('[class*="search"]') ||
        inp.closest('.ant-input-search')
      )
    );
    if (!searchInput) return false;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(searchInput, name);
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.focus();
    return true;
  }, [productName]);

  if (!searchFilled) {
    await notifyPopup('키워드 검색 입력란 없음 — 스킵', 'warn');
    return;
  }
  await sleep(300);

  // 돋보기(검색) 버튼 클릭 또는 Enter 전송
  const searched = await execInPercenty(tabId, () => {
    const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
    if (!drawer) return false;
    const mainInput = drawer.querySelector('input.ant-input[type="text"]');

    // ant-input-search 그룹 내 버튼
    const searchGroup = drawer.querySelector('.ant-input-search');
    const searchBtn = searchGroup?.querySelector('button') ||
                      drawer.querySelector('button[aria-label="search"]') ||
                      Array.from(drawer.querySelectorAll('button')).find(b =>
                        b.closest('.ant-input-group-addon') ||
                        b.querySelector('[data-icon="search"]')
                      );
    if (searchBtn) { searchBtn.click(); return true; }

    // 폴백: 검색 input에서 Enter
    const allInputs = Array.from(drawer.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
    const kwInp = allInputs.find(inp => inp !== mainInput && inp.value);
    if (kwInp) {
      kwInp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      return true;
    }
    return false;
  });

  if (!searched) {
    await notifyPopup('키워드 검색 버튼 없음 — 스킵', 'warn');
    return;
  }
  await sleep(2000); // 추천 단어 로딩 대기

  // 현재 상품명 길이 + 추천 태그 목록 수집
  // ── 색상 판별 기준 ──────────────────────────────────────────
  // 검정색 텍스트 (avg < 80): 클릭 O
  // 회색 텍스트 (r≈g≈b, avg 100~200): 이미 사용된 단어 → 클릭 X
  // 빨간색 텍스트/배경: 브랜드·주의 단어 → 클릭 X
  const kwData = await execInPercenty(tabId, () => {
    const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
    if (!drawer) return null;
    const nameInput = drawer.querySelector('input.ant-input[type="text"]');
    const currentName = nameInput?.value || '';

    // RGB 파싱 헬퍼
    const parseRGB = (s) => {
      const m = s?.match(/\d+/g);
      return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
    };

    // 태그 색상 분류: 'black' | 'gray' | 'red' | 'unknown'
    const classifyTag = (el) => {
      const cs = window.getComputedStyle(el);
      const text = parseRGB(cs.color);
      const bg   = parseRGB(cs.backgroundColor);
      const bdr  = parseRGB(cs.borderColor || cs.borderTopColor);

      // 빨간색 감지 (텍스트 or 배경 or 테두리)
      if (text && text.r > 180 && text.g < 120) return 'red';           // 빨간 텍스트
      if (bg   && bg.r   > 240 && bg.g   < 220 && bg.b < 220) return 'red'; // 연분홍 배경(#fff1f0 등)
      if (bg   && bg.r   > 200 && bg.g   < 130 && bg.b < 130) return 'red'; // 진한 빨강 배경
      if (bdr  && bdr.r  > 180 && bdr.g  < 120) return 'red';           // 빨간 테두리

      if (!text) return 'unknown';

      const avg  = (text.r + text.g + text.b) / 3;
      const diff = Math.max(text.r, text.g, text.b) - Math.min(text.r, text.g, text.b);

      // 검정색: 매우 어두운 텍스트 (avg < 80)
      if (avg < 80) return 'black';

      // 회색: r≈g≈b이면서 중간 밝기 (이미 사용된 단어)
      if (diff < 40 && avg >= 80 && avg < 210) return 'gray';

      return 'unknown'; // 기타 (밝은 색 등) — 클릭 X
    };

    const tagEls = Array.from(drawer.querySelectorAll(
      '.ant-tag, [class*="keyword"] .ant-tag, [class*="recommend"] .ant-tag, ' +
      '[class*="tag"]:not(.ant-tag-close-icon), button[class*="tag"]'
    )).filter(el => {
      if (el.querySelector('button, .ant-tag-close-icon, span.anticon-close')) return false;
      const t = el.innerText?.trim();
      if (!t || t.length <= 1 || t.length > 15) return false; // 한 글자 제외
      if (classifyTag(el) !== 'black') return false; // 검정색만 수집

      // 영어(알파벳) 또는 숫자 포함 키워드 제외
      const text = el.innerText?.trim() || '';
      if (/[a-zA-Z0-9]/.test(text)) return false;

      return true;
    });

    return {
      currentLength: currentName.length,
      tags: tagEls.map(el => el.innerText?.trim()).filter(Boolean),
    };
  });

  if (!kwData?.tags?.length) {
    await notifyPopup('클릭 가능한 추천 키워드 없음 (모두 회색/빨간색) — 스킵', 'warn');
    return;
  }
  await notifyPopup(`추천 키워드 ${kwData.tags.length}개 발견 (검정색만)`, 'info');

  // 태그를 하나씩 클릭 (50자 초과 방지)
  let currentLength = kwData.currentLength;
  for (const tagText of kwData.tags) {
    const addLen = (currentLength > 0 ? 1 : 0) + tagText.length;
    if (currentLength + addLen > 50) continue;

    const clicked = await execInPercenty(tabId, (t) => {
      const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
      if (!drawer) return false;

      const parseRGB = (s) => {
        const m = s?.match(/\d+/g);
        return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
      };
      const isBlack = (el) => {
        const cs = window.getComputedStyle(el);
        const text = parseRGB(cs.color);
        const bg   = parseRGB(cs.backgroundColor);
        const bdr  = parseRGB(cs.borderColor || cs.borderTopColor);
        if (text && text.r > 180 && text.g < 120) return false;
        if (bg   && bg.r   > 240 && bg.g < 220 && bg.b < 220) return false;
        if (bg   && bg.r   > 200 && bg.g < 130 && bg.b < 130) return false;
        if (bdr  && bdr.r  > 180 && bdr.g < 120) return false;
        if (!text) return false;
        const avg = (text.r + text.g + text.b) / 3;
        return avg < 80; // 검정색만 true
      };

      const tagEls = Array.from(drawer.querySelectorAll(
        '.ant-tag, [class*="keyword"] .ant-tag, [class*="recommend"] .ant-tag, ' +
        '[class*="tag"]:not(.ant-tag-close-icon), button[class*="tag"]'
      )).filter(el => {
        if (el.querySelector('button, .ant-tag-close-icon, span.anticon-close')) return false;
        const text = el.innerText?.trim();
        return text === t && text.length > 1 && isBlack(el) && !/[a-zA-Z0-9]/.test(text); // 한 글자 제외
      });

      const tag = tagEls[0];
      if (!tag) return false;
      tag.click();
      return true;
    }, [tagText]);

    if (clicked) {
      currentLength += addLen;
      await sleep(400);
      const newLen = await execInPercenty(tabId, () => {
        const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
        return drawer?.querySelector('input.ant-input[type="text"]')?.value?.length || 0;
      });
      if (newLen > 0) currentLength = newLen;
    }
  }
  await notifyPopup('추천 단어 적용 완료', 'info');
}

// 카테고리 추천 클릭 + "새로운 추천 받기" 모달 확인
async function clickCategoryRecommendation(tabId) {
  // 1단계: "카테고리 추천 받기" 버튼 클릭
  const ok = await execInPercenty(tabId, () => {
    const drawer = document.querySelector('div.ant-drawer.ant-drawer-open');
    if (!drawer) return false;
    const btn = Array.from(drawer.querySelectorAll('button'))
      .find(b => b.innerText?.includes('카테고리 추천') || b.innerText?.includes('카테고리추천'));
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });

  if (!ok) {
    await notifyPopup('카테고리 추천 버튼 없음 — 스킵', 'warn');
    return;
  }
  await notifyPopup('카테고리 추천 버튼 클릭', 'info');
  await sleep(1500); // 모달 등장 대기

  // 2단계: "새로운 추천 받기" 버튼 클릭 — span 직접 확인 + React props (최대 6초 폴링)
  let modalClicked = false;
  for (let i = 0; i < 12; i++) {
    modalClicked = await execInPercenty(tabId, () => {
      // span 텍스트로 정확히 찾기 (ant-btn-primary 기준)
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        Array.from(b.querySelectorAll('span')).some(s =>
          s.innerText?.trim() === '새로운 추천 받기' || s.textContent?.trim() === '새로운 추천 받기'
        )
      );
      if (!btn) return false;
      // React props 클릭 시도
      const pk = Object.keys(btn).find(k => k.startsWith('__reactProps'));
      if (pk) {
        const h = btn[pk].onClick || btn[pk].onMouseDown;
        if (h) { h({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: {} }); return true; }
      }
      btn.click();
      return true;
    });
    if (modalClicked) break;
    await sleep(500);
  }

  if (modalClicked) {
    await sleep(2000); // 추천 적용 대기
    await notifyPopup('카테고리 새로운 추천 받기 완료', 'success');
  } else {
    await notifyPopup('새로운 추천 받기 버튼 없음 — 스킵', 'warn');
  }
}

// ============================================================
// 스마트스토어 로그인 완료 대기 + 이메일 인증 자동 처리
// ============================================================

// 로그인 완료 or 2FA 인증 처리 통합 대기
// 성공 기준: sell.smartstore.naver.com/#/home/dashboard 도달 + 대시보드 DOM 확인
async function waitForLoginComplete(tabId, account, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  let verificationAttempted = false;

  while (Date.now() < deadline) {
    if (!isRunning) return false;
    await sleep(2000);

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;

    // 로그인 성공: 대시보드 URL 도달 확인
    if (tab.url?.includes('sell.smartstore.naver.com')) {
      // 대시보드 DOM 확인 (AngularJS 렌더링 대기 포함)
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        const isDashboard = await execInTab(tabId, () => {
          const body = document.body?.innerText || '';
          // 대시보드 특징 요소: 로그아웃 링크 또는 판매 관련 텍스트 존재
          return !!document.querySelector('[data-action-location-id="logout"]') ||
                 body.includes('판매 현황') || body.includes('대시보드') ||
                 body.includes('스토어 관리') || body.includes('주문 현황');
        }).catch(() => false);
        if (isDashboard) {
          await notifyPopup('대시보드 확인 — 로그인 성공', 'success');
          return true;
        }
      }
      // DOM 확인 실패해도 URL 기준으로 성공 처리 (대시보드 URL 도달 = 성공)
      await notifyPopup('대시보드 URL 확인 — 로그인 성공', 'success');
      return true;
    }

    // 인증 페이지 여부 확인
    const pageState = await execInTab(tabId, () => {
      const body = document.body?.innerText || '';
      const hasVerification = (
        body.includes('2단계 인증') || body.includes('추가 인증') ||
        body.includes('이메일로 인증') || body.includes('인증 코드') ||
        body.includes('보안 코드') || body.includes('본인 확인') ||
        body.includes('기기 인증') || body.includes('인증번호') ||
        !!document.querySelector('[class*="verif"], [id*="verif"]')
      );
      return { hasVerification, url: window.location.href };
    }).catch(() => null);

    if (pageState?.hasVerification && !verificationAttempted) {
      verificationAttempted = true;
      await notifyPopup('인증 페이지 감지 — 이메일 인증 시도', 'warn');
      const handled = await handleNaverEmailVerification(tabId);
      if (!handled) {
        await notifyPopup('자동 처리 실패 — 수동으로 인증하면 자동 진행됩니다 (3분 대기)', 'warn');
        await sleep(180000);
      }
      verificationAttempted = false; // 다음 인증 시도 허용
    }
  }
  return false;
}

// 네이버 이메일 인증 자동 처리 (2단계 인증 화면)
// 흐름: 이메일 섹션 확인 → "인증" 버튼 클릭(코드 발송) → 코드 입력란 대기
//       → 네이버 메일에서 코드 읽기 → 입력 → 확인 버튼 클릭
async function handleNaverEmailVerification(tabId) {

  // ── Step 1: 이메일 인증 섹션 선택 (이미 선택된 경우 스킵) ────
  const sectionOk = await execInTab(tabId, () => {
    // "이메일로 인증" 섹션의 라디오/체크박스 또는 섹션 자체 클릭
    const section = Array.from(document.querySelectorAll(
      'li, div, label, section, [class*="method"], [class*="option"]'
    )).find(el =>
      el.innerText?.includes('이메일로 인증') || el.innerText?.includes('이메일') &&
      el.innerText?.includes('인증')
    );
    if (!section) return 'no-section';
    // 이미 선택된 상태면 건너뜀 (초록 체크 등)
    const radio = section.querySelector('input[type="radio"]');
    if (radio && !radio.checked) { radio.click(); return 'selected'; }
    return 'already-selected';
  });
  await notifyPopup(`이메일 인증 섹션: ${sectionOk}`, 'info');
  await sleep(500);

  // ── Step 2: "인증" 버튼 클릭 (코드 발송) ──────────────────────
  // 이메일 입력란 옆에 있는 초록 "인증" 버튼
  const sendBtnOk = await execInTab(tabId, () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    // 이메일 섹션 내부에서 텍스트가 정확히 "인증"인 버튼 우선
    const sendBtn =
      buttons.find(b => b.innerText?.trim() === '인증' && !b.disabled) ||
      buttons.find(b => b.innerText?.trim().includes('인증') && b.innerText?.trim().length <= 4 && !b.disabled);
    if (!sendBtn) return false;
    sendBtn.click();
    return true;
  });

  if (!sendBtnOk) {
    await notifyPopup('인증 발송 버튼을 찾지 못함', 'warn');
    return false;
  }
  await notifyPopup('인증 코드 발송 버튼 클릭 완료 — 메일 대기 중...', 'info');
  await sleep(3000); // 코드 발송 후 입력란 등장 대기

  // ── Step 3: 코드 입력란 등장 확인 (최대 10초) ────────────────
  let codeInputAppeared = false;
  for (let i = 0; i < 10; i++) {
    codeInputAppeared = await execInTab(tabId, () => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.some(inp =>
        inp.maxLength === 6 ||
        inp.placeholder?.includes('인증') ||
        inp.placeholder?.includes('코드') ||
        inp.name?.toLowerCase().includes('code') ||
        inp.id?.toLowerCase().includes('code') ||
        inp.type === 'number'
      );
    });
    if (codeInputAppeared) break;
    await sleep(1000);
  }

  if (!codeInputAppeared) {
    await notifyPopup('코드 입력란이 나타나지 않음', 'warn');
    // 그래도 메일에서 코드 읽기 시도
  }

  // ── Step 4: 네이버 메일에서 인증 코드 읽기 ───────────────────
  const code = await getNaverMailVerificationCode();
  if (!code) {
    await notifyPopup('인증 코드 메일 읽기 실패', 'warn');
    return false;
  }
  await notifyPopup(`인증 코드 획득: ${code}`, 'success');

  // ── Step 5: 코드 입력 ─────────────────────────────────────────
  const inputOk = await execInTab(tabId, (c) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const codeInput =
      inputs.find(inp => inp.maxLength === 6) ||
      inputs.find(inp => inp.placeholder?.includes('인증') || inp.placeholder?.includes('코드')) ||
      inputs.find(inp => inp.name?.toLowerCase().includes('code') || inp.id?.toLowerCase().includes('code')) ||
      inputs.find(inp => inp.type === 'number');
    if (!codeInput) return false;
    // React/Vue 친화적 값 설정
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(codeInput, c);
    codeInput.dispatchEvent(new Event('input',  { bubbles: true }));
    codeInput.dispatchEvent(new Event('change', { bubbles: true }));
    codeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    return true;
  }, [code]);

  if (!inputOk) { await notifyPopup('코드 입력란 없음', 'warn'); return false; }
  await notifyPopup(`코드 입력 완료: ${code}`, 'success');
  await sleep(800);

  // ── Step 6: 하단 "확인" 버튼 클릭 ────────────────────────────
  const confirmOk = await execInTab(tabId, () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    // 하단의 "확인" 버튼 (submit 또는 텍스트 일치)
    const confirmBtn =
      buttons.find(b => b.innerText?.trim() === '확인' && !b.disabled) ||
      buttons.find(b => b.type === 'submit' && !b.disabled) ||
      buttons.find(b => b.innerText?.trim() === '확인');
    if (!confirmBtn) return false;
    confirmBtn.click();
    return true;
  });

  if (!confirmOk) {
    await notifyPopup('확인 버튼 클릭 실패 (비활성 상태일 수 있음)', 'warn');
    // 비활성화된 경우 1초 후 재시도
    await sleep(1000);
    await execInTab(tabId, () => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText?.trim() === '확인');
      if (btn) btn.click();
    });
  }

  await sleep(2000);
  await notifyPopup('이메일 인증 완료', 'success');
  return true;
}

// 네이버 메일에서 인증 코드 추출 (최대 60초 대기)
async function getNaverMailVerificationCode() {
  await notifyPopup('네이버 메일 탭 열기...', 'info');

  const mailTab = await chrome.tabs.create({
    url: 'https://mail.naver.com/',
    active: false,
  });
  await waitForTabLoad(mailTab.id);
  await sleep(4000);

  let code = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    code = await execInTab(mailTab.id, () => {
      // 메일 목록 행 탐색
      const rows = document.querySelectorAll(
        '.mail_item, .mailListItem, tr[id^="mail"], [class*="mail-list"] li, [class*="mailList"] li, [class*="MailList"] li'
      );
      for (const row of rows) {
        const text = row.innerText || '';
        if (
          (text.includes('네이버') || text.includes('Naver')) &&
          (text.includes('인증') || text.includes('보안') || text.includes('로그인'))
        ) {
          const m = text.match(/\b(\d{6})\b/);
          if (m) return m[1];
        }
      }
      // 폴백: 페이지 전체에서 패턴 매칭
      const bodyText = document.body?.innerText || '';
      const patterns = [
        /인증\s*번호\s*[:\s]+(\d{6})/,
        /인증\s*코드\s*[:\s]+(\d{6})/,
        /보안\s*코드\s*[:\s]+(\d{6})/,
        /코드[:\s]+(\d{6})/,
      ];
      for (const pat of patterns) {
        const m = bodyText.match(pat);
        if (m) return m[1];
      }
      return null;
    }).catch(() => null);

    if (code) break;

    await sleep(5000);
    // 새로고침
    await execInTab(mailTab.id, () => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.title?.includes('새로고침') || b.ariaLabel?.includes('새로고침')
      );
      if (btn) btn.click();
      else location.reload();
    }).catch(() => {});
    await sleep(3000);
  }

  await chrome.tabs.remove(mailTab.id).catch(() => {});
  return code;
}
