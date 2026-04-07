// ============================================================
// percenty_content.js — 탭2,3,4 Content Script (퍼센티)
// 탭2: 셔플러 복사 / 탭3: 번호삭제+그룹이동 / 탭4: 업로드
// 추후 개발 예정
// ============================================================

console.log('[SA] 퍼센티 content script 로드됨');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;
  if (type === 'CMD_SHUFFLER')    { sendResponse({ ok: true }); }
  if (type === 'CMD_GROUP_MOVE')  { sendResponse({ ok: true }); }
  if (type === 'CMD_UPLOAD')      { sendResponse({ ok: true }); }
});
