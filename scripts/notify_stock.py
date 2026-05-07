import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

NTFY_TOPIC = (os.environ.get("NTFY_TOPIC") or "").strip()
NTFY_SERVER = (os.environ.get("NTFY_SERVER") or "https://ntfy.sh").rstrip("/")
SKIP_HOLIDAYS = (os.environ.get("SKIP_HOLIDAYS") or "true").lower() != "false"
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"

PRIORITY_MAP = {"min": 1, "low": 2, "default": 3, "high": 4, "max": 5}
KST = ZoneInfo("Asia/Seoul")


def parse_codes() -> list[str]:
    raw = (
        os.environ.get("STOCK_CODES")
        or os.environ.get("STOCK_CODE")
        or "008060"
    )
    return [c.strip() for c in raw.split(",") if c.strip()]


def market_closed_reason(today) -> str:
    weekday_kr = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]
    if today.weekday() >= 5:
        return f"주말 ({weekday_kr})"

    try:
        import holidays
    except ImportError:
        return ""

    kr = holidays.country_holidays("KR", years=today.year)
    if today in kr:
        return f"공휴일: {kr.get(today)}"

    if (today.month, today.day) == (5, 1):
        return "근로자의 날 (KRX 휴장)"
    if (today.month, today.day) == (12, 31):
        return "연말 휴장"
    return ""


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


def format_message(code: str, data: dict) -> tuple[str, str]:
    name = data.get("stockName") or data.get("itemName") or "종목"
    close = data.get("closePrice") or "?"
    change = str(data.get("compareToPreviousClosePrice") or "0")
    rate = str(data.get("fluctuationsRatio") or "0")

    try:
        change_num = float(change.replace(",", ""))
    except ValueError:
        change_num = 0.0

    sign = "+" if change_num > 0 else ""
    rate_sign = "+" if change_num > 0 else ""

    title = f"{name} ({code})"
    body = f"{close}원  {sign}{change} ({rate_sign}{rate}%)"
    return title, body


def main() -> int:
    if not NTFY_TOPIC:
        print("NTFY_TOPIC env var is required", file=sys.stderr)
        return 2

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", NTFY_TOPIC):
        print(
            f"NTFY_TOPIC has invalid characters (allowed: A-Z a-z 0-9 _ -; max 64). "
            f"Got len={len(NTFY_TOPIC)} repr={NTFY_TOPIC!r}",
            file=sys.stderr,
        )
        return 2

    today = datetime.now(KST).date()
    if SKIP_HOLIDAYS:
        reason = market_closed_reason(today)
        if reason:
            print(f"market closed today ({today.isoformat()}): {reason} — skipping all pushes")
            return 0

    codes = parse_codes()
    print(f"using ntfy server={NTFY_SERVER} topic_len={len(NTFY_TOPIC)} codes={codes}")

    failures: list[str] = []
    for code in codes:
        try:
            data = fetch_stock(code)
            title, body = format_message(code, data)
            push_ntfy(NTFY_TOPIC, title, body)
            print(f"sent [{code}]: {title} | {body}")
        except Exception as exc:
            failures.append(f"{code}: {exc}")
            print(f"failed [{code}]: {exc}", file=sys.stderr)
            try:
                push_ntfy(
                    NTFY_TOPIC,
                    f"{code} 조회 실패",
                    f"{type(exc).__name__}: {exc}",
                    priority="low",
                )
            except Exception as push_exc:
                print(f"failure-notify also failed [{code}]: {push_exc}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
