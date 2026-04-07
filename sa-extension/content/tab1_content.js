// tab1_content.js v2.0 — 패널 표시만 담당 (로그인은 executeScript가 처리)
console.log('[SA Tab1] content script 로드:', location.href);

function injectPanel() {
  if (document.getElementById('sa-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'sa-panel';
  panel.style.cssText = `
    position:fixed;bottom:16px;left:16px;z-index:2147483647;
    background:#1a1a2e;color:#e0e0e0;border-radius:10px;
    padding:10px 14px;font-family:'Malgun Gothic',sans-serif;
    font-size:12px;min-width:200px;
    box-shadow:0 4px 20px rgba(0,0,0,.5);border:1px solid #2a2a4a;
  `;
  panel.innerHTML = `
    <div style="font-weight:bold;font-size:13px;color:#7eb8f7;margin-bottom:4px">🤖 SA — 탭1</div>
    <div id="sa-status" style="font-size:11px;color:#aaa">대기 중...</div>
  `;
  document.body.appendChild(panel);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectPanel);
} else {
  injectPanel();
}
