import json
import os
import sys
import urllib.error
import urllib.request

CODE = os.environ.get("STOCK_CODE", "008060")
NTFY_TOPIC = (os.environ.get("NTFY_TOPIC") or "").strip()
NTFY_SERVER = (os.environ.get("NTFY_SERVER") or "https://ntfy.sh").rstrip("/")
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"

PRIORITY_MAP = {"min": 1, "low": 2, "default": 3, "high": 4, "max": 5}


def _get_json(url: str, referer: str | None = None) -> dict:
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_stock(code: str) -> dict:
    errors: list[str] = []

    try:
        d = _get_json(f"https://m.stock.naver.com/api/stock/{code}/basic")
        if d.get("closePrice"):
            return {
                "stockName": d.get("stockName") or d.get("itemName"),
                "closePrice": d.get("closePrice"),
                "compareToPreviousClosePrice": d.get("compareToPreviousClosePrice"),
                "fluctuationsRatio": d.get("fluctuationsRatio"),
            }
    except Exception as exc:
        errors.append(f"m.stock: {exc}")

    try:
        d = _get_json(
            f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}",
            referer="https://finance.naver.com/",
        )
        datas = (d.get("datas") or [{}])[0]
        if datas.get("closePrice"):
            return {
                "stockName": datas.get("stockName") or datas.get("name"),
                "closePrice": datas.get("closePrice"),
                "compareToPreviousClosePrice": datas.get("compareToPreviousPrice"),
                "fluctuationsRatio": datas.get("fluctuationsRatio"),
            }
    except Exception as exc:
        errors.append(f"polling: {exc}")

    raise RuntimeError("; ".join(errors) or "no data")


def push_ntfy(topic: str, title: str, message: str, priority: str = "default") -> None:
    payload = json.dumps(
        {
            "topic": topic,
            "title": title,
            "message": message,
            "priority": PRIORITY_MAP.get(priority, 3),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        NTFY_SERVER + "/",
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "stock-notify/1.0 (+github actions)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status >= 300:
                raise RuntimeError(f"ntfy push failed: {resp.status}")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(
            f"ntfy push HTTP {exc.code}: {body[:300]} | topic={topic!r} server={NTFY_SERVER!r}"
        ) from exc


def format_message(data: dict) -> tuple[str, str]:
    name = data.get("stockName") or data.get("itemName") or "종목"
    close = data.get("closePrice") or "?"
    change = str(data.get("compareToPreviousClosePrice") or "0")
    rate = str(data.get("fluctuationsRatio") or "0")

    try:
        change_num = float(change.replace(",", ""))
    except ValueError:
        change_num = 0.0

    if change_num > 0:
        sign = "+"
    elif change_num < 0:
        sign = ""
    else:
        sign = ""

    title = f"{name} ({CODE})"
    body = f"{close}원  {sign}{change} ({sign if change_num > 0 else ''}{rate}%)"
    return title, body


def main() -> int:
    if not NTFY_TOPIC:
        print("NTFY_TOPIC env var is required", file=sys.stderr)
        return 2

    import re
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", NTFY_TOPIC):
        print(
            f"NTFY_TOPIC has invalid characters (allowed: A-Z a-z 0-9 _ -; max 64). "
            f"Got len={len(NTFY_TOPIC)} repr={NTFY_TOPIC!r}",
            file=sys.stderr,
        )
        return 2

    print(f"using ntfy server={NTFY_SERVER} topic_len={len(NTFY_TOPIC)}")

    try:
        data = fetch_stock(CODE)
    except Exception as exc:
        try:
            push_ntfy(NTFY_TOPIC, f"{CODE} 조회 실패", f"{type(exc).__name__}: {exc}", priority="low")
        except Exception:
            pass
        print(f"fetch failed: {exc}", file=sys.stderr)
        return 1

    title, body = format_message(data)
    push_ntfy(NTFY_TOPIC, title, body)
    print(f"sent: {title} | {body}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
