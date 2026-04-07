// ============================================================
// tab2_shuffler.js — 셔플러 자동화 모듈
// chrome.debugger API로 셔플러 팝업에 직접 JS 주입
// ============================================================

const SHUFFLER_URL = 'chrome-extension://mefebfjfhonemhjkbogojfkeahnepagh/popup.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 셔플러 실행 메인 함수 ────────────────────────────────────
async function runShuffler(payload, notifyPopup) {
  let shufflerTabId = null;

  try {
    await notifyPopup('셔플러 탭 열기...', 'info');

    // 1. 셔플러를 새 탭으로 열기
    const tab = await chrome.tabs.create({
      url: SHUFFLER_URL,
      active: true,
    });
    shufflerTabId = tab.id;

    // 2. 탭 로드 완료 대기
    await waitForTabComplete(shufflerTabId);
    await sleep(1500); // 렌더링 대기

    // 3. debugger 연결
    await chrome.debugger.attach({ tabId: shufflerTabId }, '1.3');
    await notifyPopup('셔플러 디버거 연결 완료', 'info');
    await sleep(500);

    // 4. 셔플러 내부 구조 확인 및 설정
    await setupShuffler(shufflerTabId, notifyPopup);

    // 5. "상품 정보 수집 시작" 버튼 클릭
    await clickStartButton(shufflerTabId, notifyPopup);

    // 6. 완료 대기 (버튼 텍스트 변화 감지)
    const success = await waitForShufflerComplete(shufflerTabId, notifyPopup);

    // 7. debugger 해제
    await chrome.debugger.detach({ tabId: shufflerTabId });

    // 8. 셔플러 탭 닫기
    await sleep(1000);
    await chrome.tabs.remove(shufflerTabId);

    return success;

  } catch (e) {
    console.error('[SA Tab2] 셔플러 오류:', e);
    await notifyPopup('셔플러 오류: ' + e.message, 'error');

    // 정리
    try {
      if (shufflerTabId) {
        await chrome.debugger.detach({ tabId: shufflerTabId }).catch(() => {});
        await chrome.tabs.remove(shufflerTabId).catch(() => {});
      }
    } catch {}

    return false;
  }
}

// ── 셔플러 옵션 설정 ──────────────────────────────────────────
async function setupShuffler(tabId, notifyPopup) {
  await notifyPopup('셔플러 옵션 설정 중...', 'info');

  // 셔플러 내부 전체 버튼/라디오 구조 스캔
  const scanResult = await evaluate(tabId, `
    (() => {
      const result = {
        buttons: [],
        radios: [],
        checkboxes: [],
      };

      document.querySelectorAll('button').forEach((b, i) => {
        result.buttons.push({
          i, 
          text: b.textContent.trim(), 
          id: b.id, 
          className: b.className,
          disabled: b.disabled
        });
      });

      document.querySelectorAll('input[type="radio"]').forEach((r, i) => {
        const label = document.querySelector('label[for="' + r.id + '"]');
        result.radios.push({
          i,
          id: r.id,
          name: r.name,
          value: r.value,
          checked: r.checked,
          label: label?.textContent?.trim() || ''
        });
      });

      document.querySelectorAll('input[type="checkbox"]').forEach((c, i) => {
        const label = document.querySelector('label[for="' + c.id + '"]');
        result.checkboxes.push({
          i,
          id: c.id,
          checked: c.checked,
          label: label?.textContent?.trim() || ''
        });
      });

      return JSON.stringify(result);
    })()
  `);

  console.log('[SA Tab2] 셔플러 구조:', scanResult);

  // "상품 복사(클로닝)" 라디오 선택
  await evaluate(tabId, `
    (() => {
      // 라디오 버튼에서 "복사" 또는 "클로닝" 텍스트 찾기
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const radio of radios) {
        const label = document.querySelector('label[for="' + radio.id + '"]');
        const text = label?.textContent?.trim() || '';
        if (text.includes('복사') || text.includes('클로닝') || text.includes('클론')) {
          radio.click();
          console.log('[SA] 클로닝 라디오 선택:', text);
          return '선택됨: ' + text;
        }
      }

      // label 없는 경우: 라디오 순서로 찾기 (캡처 기준 2번째)
      const allRadios = document.querySelectorAll('input[type="radio"]');
      if (allRadios[1]) {
        allRadios[1].click();
        return '2번째 라디오 선택';
      }
      return '라디오 없음';
    })()
  `);

  await sleep(500);
}

// ── "상품 정보 수집 시작" 버튼 클릭 ──────────────────────────
async function clickStartButton(tabId, notifyPopup) {
  await notifyPopup('셔플러 시작 버튼 클릭...', 'info');

  const result = await evaluate(tabId, `
    (() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text.includes('수집 시작') || text.includes('정보 수집') || text.includes('시작')) {
          btn.click();
          return '클릭됨: ' + text;
        }
      }
      // 마지막 버튼 클릭 (보통 실행 버튼이 마지막)
      const last = buttons[buttons.length - 1];
      if (last) {
        last.click();
        return '마지막 버튼 클릭: ' + last.textContent.trim();
      }
      return '버튼 없음';
    })()
  `);

  console.log('[SA Tab2] 시작 버튼:', result);
  await sleep(1000);
}

// ── 완료 대기 (버튼 텍스트 변화 감지) ───────────────────────
async function waitForShufflerComplete(tabId, notifyPopup) {
  await notifyPopup('셔플러 실행 중 — 완료 대기...', 'info');

  const deadline = Date.now() + 300000; // 최대 5분
  let lastText   = '';

  while (Date.now() < deadline) {
    const result = await evaluate(tabId, `
      (() => {
        const buttons = document.querySelectorAll('button');
        const texts   = Array.from(buttons).map(b => b.textContent.trim());
        const progress = document.querySelector('[class*="progress"], [class*="Progress"], [class*="status"], [class*="Status"]');
        return JSON.stringify({
          buttons: texts,
          progress: progress?.textContent?.trim() || '',
        });
      })()
    `);

    if (result) {
      const data = JSON.parse(result);
      const btnText = data.buttons.join(' | ');

      // 텍스트 변화 로깅
      if (btnText !== lastText) {
        console.log('[SA Tab2] 버튼 상태:', btnText);
        await notifyPopup('셔플러: ' + btnText.substring(0, 30), 'info');
        lastText = btnText;
      }

      // 완료 감지: 버튼 텍스트가 "시작"에서 다른 텍스트로 바뀐 경우
      const isDone = data.buttons.some(t =>
        t.includes('완료') || t.includes('다시') || t.includes('재시작') ||
        t.includes('종료') || t.includes('닫기') || t.includes('확인')
      );

      // 또는 "수집 시작" 버튼이 다시 활성화된 경우 (작업 완료)
      const isReady = data.buttons.some(t => t.includes('수집 시작') || t.includes('정보 수집'));
      const hasProgress = data.progress.includes('%') || data.progress.includes('완료');

      if (isDone || hasProgress) {
        console.log('[SA Tab2] 완료 감지!', data);
        await notifyPopup('셔플러 완료!', 'success');
        return true;
      }

      // "수집 시작" 버튼이 처음 상태로 돌아왔으면 완료
      if (isReady && lastText && lastText !== btnText) {
        console.log('[SA Tab2] 버튼 초기화 감지 → 완료');
        await notifyPopup('셔플러 완료!', 'success');
        return true;
      }
    }

    await sleep(1000);
  }

  await notifyPopup('셔플러 타임아웃 (5분)', 'error');
  return false;
}

// ── debugger evaluate 헬퍼 ────────────────────────────────────
function evaluate(tabId, expression) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      { expression, returnByValue: true },
      (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (result?.result?.type === 'string') {
          resolve(result.result.value);
        } else {
          resolve(result?.result?.value ?? null);
        }
      }
    );
  });
}

// ── 탭 로드 완료 대기 ────────────────────────────────────────
function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 10000);
  });
}

// ── 외부 공개 ────────────────────────────────────────────────
// background.js에서 import해서 사용
if (typeof module !== 'undefined') {
  module.exports = { runShuffler };
}
