"""
Upcoming-match schedule for an event from vlr.gg's iCal feed.

The feed (/event/ical/{id}) is the cheapest, most machine-oriented schedule
source: UTC DTSTART per match and the vlr match id in the URL. It lists
upcoming matches only.
"""
import re
from datetime import datetime, timezone

from utils.cache_manager import cache_manager
from utils.constants import VLR_BASE_URL
from utils.error_handling import handle_scraper_errors, upstream_error_payload
from utils.http_client import fetch_with_retries, get_http_client

CACHE_TTL_ICAL = 300


def parse_ical(text: str) -> list[dict]:
    """Parse VEVENTs into {match_id, start_utc, end_utc, summary, url}."""
    # RFC 5545 line folding: a line starting with space/tab continues the last.
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)

    events: list[dict] = []
    current: dict | None = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT" and current is not None:
            url = current.get("URL", "")
            m = re.search(r"vlr\.gg/(\d+)/", url)
            start = _utc(current.get("DTSTART", ""))
            if m and start:
                events.append({
                    "match_id": m.group(1),
                    "start_utc": start,
                    "end_utc": _utc(current.get("DTEND", "")),
                    "summary": current.get("SUMMARY", ""),
                    "url": url,
                })
            current = None
        elif current is not None and ":" in line:
            key, _, value = line.partition(":")
            current[key.split(";")[0]] = value
    return events


def _utc(value: str) -> str:
    try:
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


@handle_scraper_errors
async def vlr_event_ical(event_id: str):
    async def build():
        resp = await fetch_with_retries(
            f"{VLR_BASE_URL}/event/ical/{event_id}", client=get_http_client()
        )
        if resp.status_code >= 400:
            return upstream_error_payload(resp.status_code, f"event ical {event_id}")
        return {"data": {"status": resp.status_code, "segments": parse_ical(resp.text)}}

    return await cache_manager.get_or_create_async(
        CACHE_TTL_ICAL, build, "event_ical", event_id
    )
