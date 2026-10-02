import asyncio
import time

from utils import http_client


def test_requests_are_spaced_by_min_interval(monkeypatch):
    monkeypatch.setattr(http_client, "MIN_INTERVAL_S", 0.05)
    monkeypatch.setattr(http_client, "_next_slot", 0.0)

    async def run():
        t0 = time.monotonic()
        await asyncio.gather(*[http_client._pace() for _ in range(4)])
        return time.monotonic() - t0

    assert asyncio.run(run()) >= 0.14  # 4 requests, 3 gaps of 50 ms
