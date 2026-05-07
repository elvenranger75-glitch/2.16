import json
import os
import sys
import urllib.error
import urllib.request

CODE = os.environ.get("STOCK_CODE", "008060")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC")
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh")
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"


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
    url = f"{NTFY_SERVER}/{topic}"
    req = urllib.request.Request(
        url,
        data=message.encode("utf-8"),
        headers={
            "Title": title.encode("utf-8").decode("latin-1", errors="replace"),
            "Priority": priority,
            "Content-Type": "text/plain; charset=utf-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"ntfy push failed: {resp.status}")


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

    try:
        data = fetch_stock(CODE)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
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
