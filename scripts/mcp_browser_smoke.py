#!/usr/bin/env python3
"""브라우저 계열 MCP 서버(playwright, chrome-devtools)가 '실제로' 동작하는지 확인합니다.

`claude mcp list` 의 Connected 는 손만 맞잡은 상태(핸드셰이크)라서,
브라우저 실행에 실패해도 Connected 로 보입니다. 이 스크립트는 한 걸음 더 나아가
로컬에 임시 웹페이지를 띄우고 MCP 서버에게 "이 페이지를 열어봐" 라고 시켜서,
페이지 제목을 되읽어 오는 것까지 확인합니다.

사용법:
    python3 scripts/mcp_browser_smoke.py

    # 크롬/크로미움 경로를 직접 지정하고 싶을 때(리눅스·서버·컨테이너 등)
    MCP_BROWSER_PATH=/path/to/chrome python3 scripts/mcp_browser_smoke.py

종료 코드: 0 = 모두 통과, 1 = 하나 이상 실패
"""

import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading

MARKER = "MCP_SMOKE_OK"
PAGE = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    f"<title>{MARKER}</title></head><body><h1>{MARKER}</h1></body></html>"
)


def find_browser():
    """사용자가 지정한 경로, 없으면 흔한 설치 위치를 찾아봅니다."""
    explicit = os.environ.get("MCP_BROWSER_PATH")
    if explicit:
        return explicit if os.path.exists(explicit) else None

    candidates = [
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        # Linux
        "/opt/google/chrome/chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ]
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES"),
                     os.environ.get("PROGRAMFILES(X86)"),
                     os.environ.get("LOCALAPPDATA")):
            if base:
                candidates.append(
                    os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
                candidates.append(
                    os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    pw = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if pw:
        candidates.insert(0, os.path.join(pw, "chromium"))
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory):
    handler = lambda *a, **k: QuietHandler(*a, directory=directory, **k)
    srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


class Server:
    """MCP 서버를 stdio(JSON-RPC)로 직접 몰아보는 최소 클라이언트."""

    def __init__(self, cmd):
        env = dict(os.environ, NO_PROXY="*", no_proxy="*")
        self.p = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env,
        )

    def send(self, obj):
        self.p.stdin.write(json.dumps(obj) + "\n")
        self.p.stdin.flush()

    def wait(self, want_id, timeout=180):
        box = {}

        def read():
            for line in self.p.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if msg.get("id") == want_id:
                    box["msg"] = msg
                    return

        t = threading.Thread(target=read, daemon=True)
        t.start()
        t.join(timeout)
        return box.get("msg")

    def close(self):
        self.p.kill()


def probe(label, cmd, url):
    print(f"[{label}]")
    print("  명령: " + " ".join(cmd))
    srv = Server(cmd)
    try:
        srv.send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "smoke", "version": "1"}}})
        if not srv.wait(1):
            print("  실패: 서버가 응답하지 않습니다(설치 또는 실행 오류).")
            return False
        srv.send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

        srv.send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        listed = srv.wait(2)
        names = [t["name"] for t in (listed or {}).get("result", {}).get("tools", [])]
        # chrome-devtools 의 navigate_page 는 기존 pageId 를 요구하므로 new_page 를 씁니다.
        tool = "new_page" if "new_page" in names else next(
            (n for n in names if "navigate" in n), None)
        if not tool:
            print(f"  실패: 페이지를 열 수 있는 툴이 없습니다(툴 {len(names)}개).")
            return False

        srv.send({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": tool, "arguments": {"url": url}}})
        got = srv.wait(3)
        blob = json.dumps(got, ensure_ascii=False) if got else ""
        ok = bool(got) and not got.get("error") \
            and not got.get("result", {}).get("isError") and MARKER in blob
        if ok:
            print("  통과: 브라우저가 열리고 페이지 제목까지 확인했습니다.")
            return True

        print("  실패: " + (blob[:400] if blob else "응답 없음"))
        if "is not found" in blob or "not installed" in blob:
            print("  -> 크롬이 없거나 버전이 안 맞습니다. MCP_BROWSER_PATH 로 경로를 지정하세요.")
        if "sandbox" in blob.lower():
            print("  -> 샌드박스 제한입니다. 컨테이너·서버라면 --no-sandbox 가 필요합니다.")
        return False
    finally:
        srv.close()


def main():
    browser = find_browser()
    if browser:
        print(f"사용할 브라우저: {browser}\n")
    else:
        print("브라우저 경로를 못 찾았습니다. 각 서버의 기본값(설치된 Chrome)에 맡깁니다.")
        print("실패하면 MCP_BROWSER_PATH 로 경로를 직접 지정하세요.\n")

    tmp = tempfile.mkdtemp()
    with open(os.path.join(tmp, "probe.html"), "w", encoding="utf-8") as f:
        f.write(PAGE)
    srv, port = serve(tmp)
    url = f"http://127.0.0.1:{port}/probe.html"

    # 윈도우의 npx 는 npx.cmd 라서 'cmd /c' 를 거쳐야 실행됩니다.
    npx = ["cmd", "/c", "npx"] if sys.platform == "win32" else ["npx"]

    pw = npx + ["@playwright/mcp@latest", "--headless", "--isolated", "--no-sandbox"]
    cd = npx + ["chrome-devtools-mcp@latest", "--isolated", "--headless",
                "--chromeArg=--no-sandbox"]
    if browser:
        pw += ["--executable-path", browser]
        cd += ["--executablePath", browser]

    results = {
        "playwright": probe("playwright", pw, url),
        "chrome-devtools": probe("chrome-devtools", cd, url),
    }
    srv.shutdown()

    print("\n결과")
    for name, ok in results.items():
        print(f"  {name:16s} {'통과' if ok else '실패'}")
    if not all(results.values()):
        print("\n실패한 서버는 브라우저를 열 수 없는 상태입니다.")
        print("Chrome 을 설치하거나 MCP_BROWSER_PATH 로 경로를 지정한 뒤 다시 실행하세요.")
        return 1
    print("\n두 서버 모두 실제로 브라우저를 엽니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
