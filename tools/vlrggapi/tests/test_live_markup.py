"""Offline parser tests against saved vlr.gg HTML. They fail when vlr changes
the markup we depend on, or when our parsing changes."""
from pathlib import Path

from api.scrapers.match_detail import _extract_game_ids, _parse_maps
from utils.html_parsers import parse_html

FIX = Path(__file__).parent / "fixtures"


def _match():
    return parse_html((FIX / "match-753462.html").read_text())


def test_each_played_map_has_ten_players_with_ids():
    maps = _parse_maps(_match())
    assert len(maps) == 2
    for m in maps:
        for team in ("team1", "team2"):
            players = m["players"][team]
            assert len(players) == 5
            for p in players:
                assert isinstance(p["player_id"], int)
                assert p["team_tag"]
                assert p["agent"]


def test_lysoar_first_map_stats_and_sides():
    first = _parse_maps(_match())[0]["players"]["team1"][0]
    assert first["name"] == "Lysoar"
    assert first["player_id"] == 37489
    assert first["team_tag"] == "XLG"
    assert first["agent"] == "Omen"
    assert (first["rating"], first["acs"], first["kills"], first["deaths"], first["assists"]) == ("1.37", "262", "22", "17", "11")
    assert first["kast"] == "71%" and first["fk"] == "2" and first["fd"] == "2"
    assert first["sides"]["t"]["rating"] == "1.81"
    assert first["sides"]["ct"]["kills"] == "7"


def test_disabled_maps_are_not_fetched():
    ids = _extract_game_ids(_match())
    assert "283207" not in ids
    assert len(ids) == 2


def test_performance_tab_is_scoped_per_game_and_clean():
    from api.scrapers.match_detail import _parse_advanced_stats

    perf = parse_html((FIX / "match-753462-performance.html").read_text())
    g1 = _parse_advanced_stats(perf, "283205")
    g2 = _parse_advanced_stats(perf, "283206")
    assert len(g1) == 10 and len(g2) == 10
    assert g1 != g2  # the old css_first returned the 'all' block for every map
    noman = next(p for p in g1 if p["player"] == "NoMan")
    assert noman["team_tag"] == "XLG"
    assert noman["3K"] == "1"  # not "1Round6IvyRbDambi"
    assert noman["2K"] == "0"
    assert all(p["5K"].isdigit() for p in g1)


def test_match_header_is_machine_readable():
    from api.scrapers.match_detail import _parse_match_header

    h = _parse_match_header(_match())
    assert h["start_utc"] == "2026-10-01 08:05:00"
    assert h["best_of"] == 3
    assert h["event_id"] == 2766
    assert h["status"].strip().lower() == "final"
    assert h["patch"] == "13.05"


def test_event_matches_listing_has_stats_ready_flag(monkeypatch):
    import asyncio

    from api.scrapers import events
    from utils.cache_manager import cache_manager

    html = (FIX / "event-matches-2766.html").read_text()
    seen = {}

    class R:
        status_code = 200
        text = html

    async def fake_fetch(url, **kw):
        seen["url"] = url
        return R()

    cache_manager.clear_all()
    monkeypatch.setattr(events, "fetch_with_retries", fake_fetch)
    monkeypatch.setattr(events, "get_http_client", lambda: object())
    data = asyncio.run(events.vlr_event_matches("2766"))
    rows = data["data"]["segments"]
    assert "series_id=all" in seen["url"]
    assert len(rows) == 34
    assert rows[0]["stats_ready"] is True
    assert any(not r["stats_ready"] for r in rows)  # TBD playoff slots
    # Upcoming rows carry a countdown and the status word, which the feed job uses to pick matches.
    assert any(r["status"] == "Upcoming" and r["eta"] for r in rows)
    assert any(r["status"] == "LIVE" for r in rows)
    assert all(r["match_id"] for r in rows)
    cache_manager.clear_all()


def test_ical_schedule_has_utc_starts_and_match_ids():
    from api.scrapers.event_ical import parse_ical

    rows = parse_ical((FIX / "event-2766.ics").read_text())
    assert rows
    first = rows[0]
    assert first["match_id"] == "753452"
    assert first["start_utc"] == "2026-10-02 09:00:00"
    assert "Global Esports" in first["summary"]
    assert all(r["match_id"].isdigit() and r["start_utc"] for r in rows)
