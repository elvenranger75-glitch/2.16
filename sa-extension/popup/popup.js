// popup.js — SheetJS CDN 없이 순수 JS로 xlsx 파싱
// MV3에서는 popup에서 외부 CDN 로드가 제한되므로
// xlsx.js를 로컬에 번들해서 사용

// ── SheetJS 로드 (로컬 파일) ──────────────────────────────────
// assets/xlsx.full.min.js 를 popup.html에서 먼저 로드해야 함
// → popup.html의 <head>에 추가:
//   <script src="../assets/xlsx.full.min.js"></script>

// ── 상태 폴링 ─────────────────────────────────────────────────
let pollTimer = null;

async function pollStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (!status) return;

  // 상태 박스
  const box = document.getElementById('status-box');
  if (status.lastStatus) {
    box.textContent = status.lastStatus.message;
    box.className   = `status-box ${status.lastStatus.type}`;
  }

  // 통계
  document.getElementById('stat-total').textContent   = status.total;
  document.getElementById('stat-done').textContent    = status.done;
  document.getElementById('stat-error').textContent   = status.error;
  document.getElementById('stat-current').textContent = status.currentIndex + 1;

  // 현재 계정
  const { accounts, currentIndex } = await chrome.storage.local.get(['accounts','currentIndex']);
  const cur = accounts?.[currentIndex || 0];
  const accEl = document.getElementById('current-account');
  if (cur) {
    const meta = [cur.storeName, cur.groupName ? `그룹: ${cur.groupName}` : ''].filter(Boolean).join(' / ');
    accEl.innerHTML = `
      <div class="acc-id">${cur.smartstore.id}</div>
      ${meta ? `<div class="acc-meta">${meta}</div>` : ''}
      <div class="acc-status">상태: ${cur.status}</div>
    `;
  } else {
    accEl.innerHTML = '<span style="color:#2a3045">없음</span>';
  }

  // 로그
  const logList = document.getElementById('log-list');
  if (status.statusLog?.length) {
    logList.innerHTML = status.statusLog.slice(0, 20).map(l => `
      <div class="log-item ${l.type}">
        <span class="log-time">${new Date(l.timestamp).toLocaleTimeString()}</span>${l.message}
      </div>
    `).join('');
  }

  // 경과 시간 — 실행 중/완료 후 모두 표시, elapsed 없을 때만 숨김
  const elapsedBar = document.getElementById('elapsed-bar');
  if (status.elapsed) {
    elapsedBar.style.display = 'flex';
    document.getElementById('elapsed-time').textContent = status.elapsed;
  } else {
    elapsedBar.style.display = 'none';
  }

  // 버튼 상태
  const btnStart  = document.getElementById('btn-start');
  const btnPause  = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');

  btnStart.disabled = status.isRunning;
  btnStart.textContent = status.isRunning ? '⏳ 실행 중...' : '▶ 시작';
  btnStart.classList.toggle('running', status.isRunning);

  document.getElementById('btn-stop').disabled = !status.isRunning;

  // 단계별 버튼 — 실행 중이면 비활성화
  ['btn-step-1','btn-step-2','btn-step-3','btn-step-4'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.disabled) el.disabled = status.isRunning;
    else if (el && el.disabled && !status.isRunning) {
      // 계정이 로드된 상태인지만 확인
      chrome.storage.local.get('accounts').then(({ accounts }) => {
        if (accounts?.length) el.disabled = false;
      });
    }
  });

  // 일시정지/재시작 버튼 — 실행 중일 때만 활성
  btnPause.disabled  = !status.isRunning || status.isPaused;
  btnResume.disabled = !status.isRunning || !status.isPaused;

  // 업데이트 알림 배너
  const { updateAvailable, latestVersion, changelog } = await chrome.storage.local.get(['updateAvailable', 'latestVersion', 'changelog']);
  const banner = document.getElementById('update-banner');
  if (updateAvailable) {
    banner.classList.add('visible');
    document.getElementById('update-text').textContent = `새 버전 v${latestVersion} 사용 가능 — ${changelog || ''}`;
  } else {
    banner.classList.remove('visible');
  }
}

// ── 엑셀 파싱 ─────────────────────────────────────────────────
function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const accounts = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!String(r[0]).trim()) continue;
    accounts.push({
      index:      i - 1,
      smartstore: { id: String(r[0]).trim(), pw: String(r[1]).trim() },
      percenty:   { id: String(r[2]).trim(), pw: String(r[3]).trim() },
      storeName:   String(r[4] || '').trim(),
      groupName:   String(r[5] || '').trim(),  // F열: 그룹1 (복사 후 도착 그룹, Tab3 필터)
      group2Name:  String(r[6] || '').trim(),  // G열: 그룹2 (숫자제거 후 이동 대상, Tab4 업로드)
      status:     'pending',
      lastRun:    null,
    });
  }
  return accounts;
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────
// 오늘 날짜 YYYY-MM-DD
function today() {
  return new Date().toISOString().slice(0, 10);
}

// 설정 저장
function saveSettings() {
  const s = {
    dateFrom:  document.getElementById('date-from').value,
    dateTo:    document.getElementById('date-to').value,
    pagesTab2: parseInt(document.getElementById('pages-tab2').value) || 2,
    pagesTab3: parseInt(document.getElementById('pages-tab3').value) || 2,
    workMode:  document.querySelector('input[name="work-mode"]:checked')?.value || 'today',
  };
  // 오늘 모드면 날짜 입력 비활성화
  const isPast = s.workMode === 'past';
  document.getElementById('date-from').disabled = !isPast;
  document.getElementById('date-to').disabled   = !isPast;
  chrome.storage.local.set({ autoSettings: s });
  return s;
}

// 설정 로드
async function loadSettings() {
  const { autoSettings } = await chrome.storage.local.get('autoSettings');
  const s = autoSettings || {};
  document.getElementById('date-from').value  = s.dateFrom  || today();
  document.getElementById('date-to').value    = s.dateTo    || today();
  document.getElementById('pages-tab2').value = s.pagesTab2 || 2;
  document.getElementById('pages-tab3').value = s.pagesTab3 || 2;
  const mode = s.workMode || 'today';
  document.getElementById(mode === 'past' ? 'mode-past' : 'mode-today').checked = true;
  document.getElementById('date-from').disabled = mode !== 'past';
  document.getElementById('date-to').disabled   = mode !== 'past';
}

function updateScheduleStatus(timeStr) {
  const el = document.getElementById('schedule-status');
  const d = new Date(timeStr);
  el.textContent = `⏰ 예약: ${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  el.className = 'schedule-status active';
}

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();

  // 설정 변경 시 자동 저장
  ['date-from','date-to','pages-tab2','pages-tab3'].forEach(id =>
    document.getElementById(id).addEventListener('change', saveSettings)
  );
  document.querySelectorAll('input[name="work-mode"]').forEach(r =>
    r.addEventListener('change', saveSettings)
  );

  // 엑셀 파일 선택
  document.getElementById('excel-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('file-name').textContent = file.name;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const accounts = parseExcelBuffer(ev.target.result);
        if (!accounts.length) {
          alert('계정 데이터가 없습니다. 엑셀 형식을 확인하세요.');
          return;
        }

        await chrome.storage.local.set({ accounts, currentIndex: 0 });

        document.getElementById('btn-start').disabled = false;
        ['btn-step-1','btn-step-2','btn-step-3','btn-step-4'].forEach(id =>
          document.getElementById(id).disabled = false
        );
        document.getElementById('status-box').textContent = `✔ ${accounts.length}개 계정 로드 완료`;
        document.getElementById('status-box').className = 'status-box success';

        await pollStatus();
      } catch (err) {
        alert('엑셀 파싱 오류: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // 시작
  document.getElementById('btn-start').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'START_AUTOMATION' });
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled  = false;
  });

  // 정지
  document.getElementById('btn-stop').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_AUTOMATION' });
    document.getElementById('btn-start').disabled  = false;
    document.getElementById('btn-stop').disabled   = true;
    document.getElementById('btn-pause').disabled  = true;
    document.getElementById('btn-resume').disabled = true;
  });

  // 일시정지
  document.getElementById('btn-pause').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'PAUSE_AUTOMATION' });
  });

  // 재시작
  document.getElementById('btn-resume').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RESUME_AUTOMATION' });
  });

  // 단계별 실행
  document.getElementById('btn-step-1').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RUN_TAB1_ONLY' });
  });
  document.getElementById('btn-step-2').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RUN_SHUFFLER_ONLY' });
  });
  document.getElementById('btn-step-3').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RUN_TAB3_ONLY' });
  });
  document.getElementById('btn-step-4').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RUN_TAB4_ONLY' });
  });

  // 리셋
  document.getElementById('btn-reset').addEventListener('click', async () => {
    const { accounts } = await chrome.storage.local.get('accounts');
    if (accounts) {
      const reset = accounts.map(a => ({ ...a, status: 'pending', lastRun: null }));
      await chrome.storage.local.set({ accounts: reset, currentIndex: 0 });
    }
    await chrome.storage.local.set({ statusLog: [], lastStatus: null, isRunning: false });
    await pollStatus();
  });

  // 예약 설정
  document.getElementById('btn-schedule-set').addEventListener('click', async () => {
    const timeInput = document.getElementById('schedule-time').value;
    if (!timeInput) { alert('예약 시간을 선택하세요.'); return; }
    const when = new Date(timeInput).getTime();
    if (when <= Date.now()) { alert('미래 시간을 선택하세요.'); return; }
    await chrome.alarms.create('scheduledRun', { when });
    await chrome.storage.local.set({ scheduledTime: timeInput });
    updateScheduleStatus(timeInput);
    document.getElementById('btn-schedule-cancel').disabled = false;
  });

  // 예약 취소
  document.getElementById('btn-schedule-cancel').addEventListener('click', async () => {
    await chrome.alarms.clear('scheduledRun');
    await chrome.storage.local.remove('scheduledTime');
    document.getElementById('schedule-status').textContent = '예약 없음';
    document.getElementById('schedule-status').className = 'schedule-status';
    document.getElementById('btn-schedule-cancel').disabled = true;
  });

  // 업데이트 다운로드 버튼
  document.getElementById('btn-update').addEventListener('click', async () => {
    const { downloadUrl } = await chrome.storage.local.get('downloadUrl');
    if (downloadUrl) chrome.tabs.create({ url: downloadUrl });
  });

  // 저장된 예약 시간 복원
  const { scheduledTime } = await chrome.storage.local.get('scheduledTime');
  if (scheduledTime) {
    document.getElementById('schedule-time').value = scheduledTime;
    updateScheduleStatus(scheduledTime);
    document.getElementById('btn-schedule-cancel').disabled = false;
  }

  // 로그 복사
  document.getElementById('btn-copy-log').addEventListener('click', async () => {
    const { statusLog = [] } = await chrome.storage.local.get('statusLog');
    const text = statusLog.slice().reverse().map(l =>
      `${new Date(l.timestamp).toLocaleTimeString()} [${l.type}] ${l.message}`
    ).join('\n');
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('btn-copy-log');
    btn.textContent = '✓ 복사됨';
    setTimeout(() => { btn.textContent = '📋 복사'; }, 1500);
  });

  pollTimer = setInterval(pollStatus, 1000);
});

// 팝업 닫힐 때 폴링 정리
window.addEventListener('unload', () => {
  if (pollTimer) clearInterval(pollTimer);
});

// ── automation 스캔 (popup에서 직접 실행) ────────────────────
async function logToPopup(msg, type = 'info') {
  const { statusLog = [] } = await chrome.storage.local.get('statusLog');
  statusLog.unshift({ message: msg, type, timestamp: Date.now() });
  if (statusLog.length > 50) statusLog.length = 50;
  await chrome.storage.local.set({ statusLog, lastStatus: { message: msg, type, timestamp: Date.now() } });
}

function getPercentyTab() {
  return chrome.tabs.query({}).then(tabs => tabs.find(t => t.url && t.url.includes('percenty')));
}

function getTree(tabId) {
  return new Promise((resolve, reject) => {
    if (typeof chrome.automation === 'undefined') {
      reject(new Error('chrome.automation 없음 — 팝업에서도 사용 불가'));
      return;
    }
    chrome.automation.getTree({ tabId }, root => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(root);
    });
  });
}

function findAllNodes(root, pred) {
  const results = [];
  function t(n) { if (pred(n)) results.push(n); let c = n.firstChild; while (c) { t(c); c = c.nextSibling; } }
  t(root);
  return results;
}

async function runAutomationScan() {
  await logToPopup('postMessage 프로브 시작...', 'info');

  const tab = await getPercentyTab();
  if (!tab) { await logToPopup('퍼센티 탭 없음', 'error'); return; }

  // 1. 퍼센티 페이지에 리스너 설치 + 셔플러로 메시지 전송
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const iframe = document.querySelector('#product-name-shuffler-iframe');
      if (!iframe) return { error: 'shuffler iframe 없음' };

      const received = [];

      // 셔플러 → 퍼센티 메시지 수신 리스너
      const listener = (e) => {
        if (e.source === iframe.contentWindow) {
          received.push({ from: 'shuffler', data: JSON.stringify(e.data).slice(0, 200) });
        }
      };
      window.addEventListener('message', listener);

      // 테스트 메시지 전송
      const testMsgs = [
        { type: 'ping' },
        { type: 'status' },
        { action: 'ping' },
        { cmd: 'status' },
        'ping',
      ];
      for (const msg of testMsgs) {
        iframe.contentWindow.postMessage(msg, '*');
      }

      // 500ms 대기 후 수신 결과 반환
      return new Promise(resolve => {
        setTimeout(() => {
          window.removeEventListener('message', listener);
          // iframe 정보도 같이 반환
          const rect = iframe.getBoundingClientRect();
          resolve({
            received,
            iframeRect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
          });
        }, 500);
      });
    },
  });

  if (result?.error) { await logToPopup('오류: ' + result.error, 'error'); return; }

  await logToPopup(`iframe 크기: ${result.iframeRect.w}×${result.iframeRect.h} @ (${result.iframeRect.left}, ${result.iframeRect.top})`, 'info');

  if (result.received.length > 0) {
    await logToPopup(`셔플러로부터 메시지 수신! (${result.received.length}개)`, 'success');
    for (const m of result.received) await logToPopup(`  ${m.data}`, 'success');
  } else {
    await logToPopup('postMessage 응답 없음 — 셔플러가 postMessage를 사용하지 않는 것 같아요', 'warn');
  }

  await logToPopup('프로브 완료', 'info');
}
