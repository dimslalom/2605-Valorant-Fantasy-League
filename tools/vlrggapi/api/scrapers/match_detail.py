"""
Scraper for individual VLR.GG match detail pages.
Fetches the base match page plus performance and economy tabs concurrently.
"""
import asyncio
import logging
import re

from utils.cache_manager import cache_manager
from utils.constants import (
    CACHE_TTL_MATCH_DETAIL,
    CACHE_TTL_MATCH_DETAIL_LIVE,
    MATCH_DETAIL_TAB_FETCH_CONCURRENCY,
    MATCH_DETAIL_TAB_FETCH_TIMEOUT,
    VLR_BASE_URL,
)
from utils.error_handling import handle_scraper_errors, upstream_error_payload
from utils.html_parsers import (
    HTMLParser,
    build_full_url,
    extract_text_content,
    normalize_image_url,
    parse_href_id_slug,
    parse_html,
)
from utils.http_client import fetch_with_retries, get_http_client
from utils.id_mapper import id_mapper

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Header section parsers
# ---------------------------------------------------------------------------

def _parse_event_info(html: HTMLParser) -> dict:
    """Extract event name, series, and logo from the match header."""
    event_name = ""
    event_series = ""
    event_logo = ""

    super_elem = html.css_first(".match-header-super")
    if super_elem:
        # The first child div holds the event name link
        first_div = super_elem.css_first("div")
        if first_div:
            anchor = first_div.css_first("a")
            if anchor:
                event_name = extract_text_content(anchor)
            else:
                event_name = extract_text_content(first_div)

        series_elem = super_elem.css_first(".match-header-event-series")
        if series_elem:
            event_series = extract_text_content(series_elem)

    # Event logo lives in .match-header-event img
    logo_elem = html.css_first(".match-header-event img")
    if logo_elem:
        src = logo_elem.attributes.get("src", "")
        event_logo = normalize_image_url(src)

    return {"name": event_name, "series": event_series, "logo": event_logo}


def _parse_match_header(html: HTMLParser) -> dict:
    """Extract date, patch, and status from the match header."""
    date = ""
    patch = ""
    status = ""

    date_elem = html.css_first(".match-header-date")
    if date_elem:
        date = extract_text_content(date_elem)

    note_elem = html.css_first(".match-header-note")
    if note_elem:
        patch = extract_text_content(note_elem)

    vs_note_elem = html.css_first(".match-header-vs-note")
    if vs_note_elem:
        status = extract_text_content(vs_note_elem)

    # Machine-readable fields. The date is rendered in the viewer's timezone,
    # so read the UTC timestamp attribute instead of the text.
    start_utc = ""
    ts_elem = html.css_first(".match-header-date [data-utc-ts]")
    if ts_elem:
        start_utc = ts_elem.attributes.get("data-utc-ts", "") or ""

    best_of = None
    for note in html.css(".match-header-vs-note"):
        bo = re.fullmatch(r"Bo(\d+)", extract_text_content(note).strip(), re.IGNORECASE)
        if bo:
            best_of = int(bo.group(1))
            break

    event_id = None
    event_link = html.css_first('.match-header-super a.match-header-event[href^="/event/"]')
    if event_link:
        m = re.match(r"^/event/(\d+)", event_link.attributes.get("href", ""))
        if m:
            event_id = int(m.group(1))

    patch_text = ""
    date_block = html.css_first(".match-header-date")
    if date_block:
        pm = re.search(r"Patch\s+([\d.]+)", extract_text_content(date_block))
        patch_text = pm.group(1) if pm else ""

    return {
        "date": date,
        "map_vetos": patch,
        "status": status,
        "start_utc": start_utc,
        "best_of": best_of,
        "event_id": event_id,
        "patch": patch_text,
    }


def _is_live(html: HTMLParser) -> bool:
    """Return True if the match header indicates the match is currently LIVE."""
    vs_note_elem = html.css_first(".match-header-vs-note")
    if not vs_note_elem:
        return False
    return "LIVE" in extract_text_content(vs_note_elem).upper()


def _parse_teams(html: HTMLParser) -> list[dict]:
    """
    Extract both team entries from the match header.

    Returns a two-element list. Each entry contains name, tag, logo,
    score, and is_winner flag.
    """
    teams: list[dict] = []

    for mod in ("mod-1", "mod-2"):
        team_id = ""
        link_elem = html.css_first(f".match-header-link.{mod}")
        if link_elem:
            href = link_elem.attributes.get("href", "")
            team_id, _ = parse_href_id_slug(href)

        name_elem = html.css_first(f".match-header-link-name.{mod}")
        name = ""
        tag = ""
        if name_elem:
            # The full name block contains name + tag on separate lines
            full_text = name_elem.text()
            lines = [ln.strip() for ln in full_text.splitlines() if ln.strip()]
            if lines:
                name = lines[0]
            if len(lines) > 1:
                tag = lines[1]

        teams.append(
            {
                "id": team_id,
                "name": name,
                "tag": tag,
                "logo": "",
                "score": "",
                "is_winner": False,
            }
        )
        id_mapper.register_team(name, team_id)

    # Logos: two <img> elements inside .match-header-vs
    vs_elem = html.css_first(".match-header-vs")
    if vs_elem:
        logos = vs_elem.css("img")
        for idx, img in enumerate(logos[:2]):
            src = img.attributes.get("src", "")
            if src:
                teams[idx]["logo"] = normalize_image_url(src)

    # Scores
    score_elems = html.css(".match-header-vs-score span")
    winner_idx = -1

    # Determine which team index is the winner based on score positioning.
    # VLR renders winner/loser spans in DOM order: left team first, right team second.
    # Collect all score spans in order to figure out which side won.
    scored_spans = [
        (span.attributes.get("class") or "", span.text(strip=True))
        for span in score_elems
        if span.text(strip=True).isdigit()
    ]

    if len(scored_spans) >= 2:
        cls0, val0 = scored_spans[0]
        cls1, val1 = scored_spans[1]
        teams[0]["score"] = val0
        teams[1]["score"] = val1
        if "match-header-vs-score-winner" in cls0:
            winner_idx = 0
        elif "match-header-vs-score-winner" in cls1:
            winner_idx = 1

    if winner_idx >= 0:
        teams[winner_idx]["is_winner"] = True

    return teams


def _parse_streams_vods(html: HTMLParser) -> tuple[list[dict], list[dict]]:
    """Extract stream buttons and VOD links from the match page."""
    streams: list[dict] = []
    vods: list[dict] = []

    for btn in html.css(".match-streams-btn"):
        href = btn.attributes.get("href", "")
        name = extract_text_content(btn)
        if name or href:
            streams.append({"name": name, "url": build_full_url(href)})

    vods_container = html.css_first(".match-vods")
    if vods_container:
        for anchor in vods_container.css("a"):
            href = anchor.attributes.get("href", "")
            name = extract_text_content(anchor)
            if name or href:
                vods.append({"name": name, "url": href})

    return streams, vods


# ---------------------------------------------------------------------------
# Per-map game data parsers
# ---------------------------------------------------------------------------

def _parse_player_row(cells: list) -> dict:
    """
    Parse a single player table row into a stat dict.

    Actual VLR column layout (14 cells):
      [0]  mod-player   — player name
      [1]  mod-agents   — agent icon (img title)
      [2]  mod-stat     — rating
      [3]  mod-stat     — ACS
      [4]  mod-vlr-kills — kills
      [5]  mod-vlr-deaths — deaths
      [6]  mod-vlr-assists — assists
      [7]  mod-kd-diff  — K/D +/-
      [8]  mod-stat     — KAST
      [9]  mod-stat     — ADR
      [10] mod-stat     — HS%
      [11] mod-fb       — first kills
      [12] mod-fd       — first deaths
      [13] mod-fk-diff  — FK +/-

    Values are in .side.mod-both spans or direct text.
    """

    def cell_val(cell) -> str:
        """Extract the .side.mod-both span value, falling back to raw text."""
        if not cell:
            return ""
        both = cell.css_first(".side.mod-both")
        if both:
            return both.text(strip=True)
        return cell.text(strip=True)

    def safe_val(idx: int) -> str:
        return cell_val(cells[idx]) if idx < len(cells) else ""

    # Player name — [0] mod-player
    player_name = ""
    if cells:
        player_cell = cells[0]
        name_div = player_cell.css_first(".text-of")
        if name_div:
            player_name = name_div.text(strip=True)
        else:
            player_name = player_cell.text(strip=True)

    # Agent — [1] mod-agents, icon title
    agent = ""
    if len(cells) > 1:
        img = cells[1].css_first("img")
        if img:
            agent = img.attributes.get("title", "") or img.attributes.get("alt", "")

    return {
        "name": player_name,
        "agent": agent,
        "rating": safe_val(2),
        "acs": safe_val(3),
        "kills": safe_val(4),
        "deaths": safe_val(5),
        "assists": safe_val(6),
        "kd_diff": safe_val(7),
        "kast": safe_val(8),
        "adr": safe_val(9),
        "hs_pct": safe_val(10),
        "fk": safe_val(11),
        "fd": safe_val(12),
        "fk_diff": safe_val(13),
    }


# vlr.gg moved the match overview from <table class="wf-table-inset mod-overview">
# to div markup (.ovw-table / .ovw-row / .ovw-cell[data-col]) in 2026. Cells
# carry three values per stat: .side.mod-both, .mod-t (attack) and .mod-ct
# (defence). K/D/A data-col sits on span.ovw-kda-stat, not on the cell.
_OVW_COLS = {
    "rating2": "rating",
    "acs": "acs",
    "kills": "kills",
    "deaths": "deaths",
    "assists": "assists",
    "kd-diff": "kd_diff",
    "kast": "kast",
    "adr": "adr",
    "hsp": "hs_pct",
    "fb": "fk",
    "fd": "fd",
    "fk-diff": "fk_diff",
}


def _parse_ovw_row(row) -> dict | None:
    """Parse one div-based overview player row. Returns None for non-player rows."""
    link = row.css_first('.ovw-player a[href^="/player/"]')
    if link is None:
        return None
    m = re.match(r"^/player/(\d+)", link.attributes.get("href", ""))
    name_el = row.css_first(".ovw-player-name")
    tag_el = row.css_first(".ovw-player-tag")
    agent_img = row.css_first(".ovw-agents img")

    player = {
        "name": name_el.text(strip=True) if name_el else link.text(strip=True),
        "player_id": int(m.group(1)) if m else None,
        "team_tag": tag_el.text(strip=True) if tag_el else "",
        "agent": (agent_img.attributes.get("title", "") or agent_img.attributes.get("alt", "")) if agent_img else "",
    }
    sides: dict[str, dict] = {"t": {}, "ct": {}}
    # Row-scoped selector: the head row's .ovw-th cells also carry data-col.
    for el in row.css("[data-col]"):
        key = _OVW_COLS.get(el.attributes.get("data-col", ""))
        if key is None:
            continue
        both = el.css_first(".side.mod-both")
        player[key] = both.text(strip=True) if both else el.text(strip=True)
        for side in ("t", "ct"):
            side_el = el.css_first(f".side.mod-{side}")
            if side_el:
                sides[side][key] = side_el.text(strip=True)
    for key in _OVW_COLS.values():
        player.setdefault(key, "")
    player["sides"] = sides
    return player


def _parse_map_players(game_elem) -> dict:
    """
    Parse player stat blocks inside a single .vm-stats-game element.

    Current markup: two .ovw-table blocks (one per team), each holding a head
    row plus five .ovw-row players. Falls back to the legacy two-<table>
    layout when no .ovw-table is present.
    """
    team1_players: list[dict] = []
    team2_players: list[dict] = []

    ovw_tables = game_elem.css(".ovw-table")
    if ovw_tables:
        def parse_ovw(table) -> list[dict]:
            out = []
            for row in table.css(".ovw-row"):
                try:
                    parsed = _parse_ovw_row(row)
                except Exception as exc:
                    logger.debug("Skipping overview row due to parse error: %s", exc)
                    continue
                if parsed:
                    out.append(parsed)
            return out

        if len(ovw_tables) >= 1:
            team1_players = parse_ovw(ovw_tables[0])
        if len(ovw_tables) >= 2:
            team2_players = parse_ovw(ovw_tables[1])
        return {"team1": team1_players, "team2": team2_players}

    tables = game_elem.css("table.wf-table-inset.mod-overview")

    def parse_table_rows(table) -> list[dict]:
        players = []
        for row in table.css("tbody tr"):
            cells = row.css("td")
            if not cells:
                continue
            # Skip separator rows: they typically contain very few cells
            if len(cells) < 5:
                continue
            try:
                players.append(_parse_player_row(cells))
            except Exception as exc:
                logger.debug("Skipping player row due to parse error: %s", exc)
        return players

    if len(tables) >= 1:
        team1_players = parse_table_rows(tables[0])
    if len(tables) >= 2:
        team2_players = parse_table_rows(tables[1])

    return {"team1": team1_players, "team2": team2_players}


def _parse_map_scores(game_elem) -> dict:
    """
    Extract team scores and CT/T/OT splits from a single game header.

    The header has `.team` blocks each containing:
    - `.score` for the total round score
    - `.mod-ct` for CT-side rounds
    - `.mod-t` for T-side rounds
    - `.mod-ot` for overtime rounds (optional)
    """
    result = {
        "score": {"team1": "", "team2": ""},
        "score_ct": {"team1": "", "team2": ""},
        "score_t": {"team1": "", "team2": ""},
        "score_ot": {"team1": "", "team2": ""},
    }

    header = game_elem.css_first(".vm-stats-game-header")
    if not header:
        return result

    team_blocks = header.css(".team")
    keys = ["team1", "team2"]

    for idx, block in enumerate(team_blocks[:2]):
        key = keys[idx]

        score_el = block.css_first(".score")
        if score_el:
            val = score_el.text(strip=True)
            try:
                result["score"][key] = int(val)
            except (ValueError, TypeError):
                result["score"][key] = val

        ct_el = block.css_first(".mod-ct")
        if ct_el:
            result["score_ct"][key] = ct_el.text(strip=True)

        t_el = block.css_first(".mod-t")
        if t_el:
            result["score_t"][key] = t_el.text(strip=True)

        ot_el = block.css_first(".mod-ot")
        if ot_el:
            result["score_ot"][key] = ot_el.text(strip=True)

    return result


def _parse_rounds(game_elem) -> list[dict]:
    """
    Parse round-by-round outcomes from a .vlr-rounds container.

    Structure: each .vlr-rounds-row contains .vlr-rounds-row-col elements,
    one per round. Each column has two .rnd-sq spans — [0] = team1, [1] = team2.
    The span with `mod-win` indicates the winner. The side (mod-ct / mod-t)
    tells which side that team was on.

    There are two rows: row 0 covers the first half (+ overtime),
    row 1 covers the second half.
    """
    rounds: list[dict] = []
    rounds_container = game_elem.css_first(".vlr-rounds")
    if not rounds_container:
        return rounds

    round_num = 0
    for row in rounds_container.css(".vlr-rounds-row"):
        for col in row.css(".vlr-rounds-row-col"):
            cls = col.attributes.get("class", "")
            if "mod-spacing" in cls:
                continue

            sqs = col.css(".rnd-sq")
            if not sqs:
                continue

            round_num += 1

            # Determine winner from whichever sq has mod-win
            winner = ""
            winning_side = ""
            for idx, sq in enumerate(sqs):
                sq_cls = sq.attributes.get("class", "")
                if "mod-win" in sq_cls:
                    winner = "team1" if idx == 0 else "team2"
                    if "mod-ct" in sq_cls:
                        winning_side = "ct"
                    elif "mod-t" in sq_cls:
                        winning_side = "t"
                    break

            rounds.append({
                "round_num": round_num,
                "winner": winner,
                "side": winning_side,
            })

    return rounds


def _parse_maps(html: HTMLParser) -> list[dict]:
    """Parse all per-map game blocks from the base match page."""
    maps: list[dict] = []

    for game_elem in html.css("div.vm-stats-game"):
        game_id = game_elem.attributes.get("data-game-id", "")
        if game_id == "all":
            continue

        # Map name — the .map container has child spans for pick info and
        # duration that we need to exclude. Extract just the first text node.
        map_name = ""
        picked_by = ""
        picked_side = None
        map_container = game_elem.css_first(".vm-stats-game-header .map")
        if map_container:
            # Get the map name from the span that contains only the name,
            # excluding .picked and .map-duration children
            pick_elem = map_container.css_first(".picked") or map_container.css_first(".pick")
            dur_elem = map_container.css_first(".map-duration")
            if pick_elem:
                picked_by = pick_elem.text(strip=True)
                pick_cls = pick_elem.attributes.get("class", "")
                picked_side = 1 if "mod-1" in pick_cls else 2 if "mod-2" in pick_cls else None
            # Remove child text to isolate map name
            full_text = map_container.text(strip=True)
            subtract = ""
            if pick_elem:
                subtract += pick_elem.text(strip=True)
            if dur_elem:
                subtract += dur_elem.text(strip=True)
            map_name = re.sub(r"\s+", " ", full_text.replace(subtract, "")).strip()

        # Duration
        duration = ""
        dur_elem = game_elem.css_first(".map-duration")
        if dur_elem:
            duration = dur_elem.text(strip=True)

        scores = _parse_map_scores(game_elem)
        players = _parse_map_players(game_elem)
        rounds = _parse_rounds(game_elem)

        maps.append({
            "game_id": game_id,
            "map_name": map_name,
            "picked_by": picked_by,
            "picked_side": picked_side,
            "duration": duration,
            "score": scores["score"],
            "score_ct": scores["score_ct"],
            "score_t": scores["score_t"],
            "score_ot": scores["score_ot"],
            "players": players,
            "rounds": rounds,
        })

    return maps


# ---------------------------------------------------------------------------
# Head-to-head history parser
# ---------------------------------------------------------------------------

def _parse_head_to_head(html: HTMLParser) -> list[dict]:
    """Parse head-to-head match history entries."""
    h2h: list[dict] = []

    container = html.css_first(".match-h2h-matches")
    if not container:
        return h2h

    for row in container.css(".wf-module-item"):
        # Team entries: each has mod-win for the winning side
        team_elems = row.css(".match-h2h-matches-team")
        teams = []
        for te in team_elems:
            cls = te.attributes.get("class", "")
            is_winner = "mod-win" in cls
            teams.append({"name": extract_text_content(te), "is_winner": is_winner})

        score_elem = row.css_first(".match-h2h-matches-score")
        score = extract_text_content(score_elem) if score_elem else ""

        event_elem = row.css_first(".match-h2h-matches-event-name")
        event = extract_text_content(event_elem) if event_elem else ""

        date_elem = row.css_first(".match-h2h-matches-date")
        date = extract_text_content(date_elem) if date_elem else ""

        href = row.attributes.get("href", "")
        url = build_full_url(href)

        h2h.append({
            "event": event,
            "date": date,
            "teams": teams,
            "score": score,
            "url": url,
        })

    return h2h


# ---------------------------------------------------------------------------
# Game ID extraction
# ---------------------------------------------------------------------------

def _extract_game_ids(html: HTMLParser) -> list[str]:
    """Return all data-game-id values from the stats nav, excluding 'all'."""
    game_ids: list[str] = []
    for item in html.css(".vm-stats-gamesnav-item"):
        gid = item.attributes.get("data-game-id", "")
        # Unplayed maps stay in the nav with mod-disabled; fetching their tabs
        # wastes requests (a 2-0 Bo3 still lists map 3).
        if "mod-disabled" in item.attributes.get("class", ""):
            continue
        if gid and gid != "all":
            game_ids.append(gid)
    return game_ids


async def _fetch_game_tab_html(
    client,
    base_url: str,
    game_id: str,
    tab: str,
    timeout: int = MATCH_DETAIL_TAB_FETCH_TIMEOUT,
) -> tuple[str, str, HTMLParser | None]:
    """Fetch one game-tab page and return parsed HTML when available."""
    url = f"{base_url}/?game={game_id}&tab={tab}"
    try:
        resp = await fetch_with_retries(url, client=client, timeout=timeout)
        if resp.status_code >= 400:
            logger.warning(
                "Failed to fetch %s tab for game %s: upstream status %d",
                tab, game_id, resp.status_code,
            )
            return game_id, tab, None
        return game_id, tab, parse_html(resp.text)
    except Exception as exc:
        logger.warning("Failed to fetch %s tab for game %s: %s", tab, game_id, exc)
        return game_id, tab, None


# ---------------------------------------------------------------------------
# Performance tab parsers
# ---------------------------------------------------------------------------

def _game_scope(html, game_id: str | None):
    """The performance page holds a .vm-stats-game block for every game, whatever
    ?game= says, so css_first on the page always returned the 'all' block.
    Scope to one game when an id is given."""
    if game_id:
        game = html.css_first(f'div.vm-stats-game[data-game-id="{game_id}"]')
        if game is not None:
            return game
    return html


def _parse_kill_matrix(html: HTMLParser, game_id: str | None = None) -> list[dict]:
    """
    Parse the kill matrix table from the performance tab.

    Each row represents a player; each cell is the kill count versus
    a specific opponent.
    """
    matrix: list[dict] = []

    table = _game_scope(html, game_id).css_first("table.wf-table-inset.mod-matrix.mod-normal")
    if not table:
        return matrix

    # Header row holds opponent names
    header_row = table.css_first("thead tr")
    opponents: list[str] = []
    if header_row:
        for th in header_row.css("th"):
            opponents.append(extract_text_content(th))

    for row in table.css("tbody tr"):
        cells = row.css("td")
        if not cells:
            continue

        player_cell = cells[0]
        player_name = extract_text_content(player_cell)

        kills_vs: dict[str, str] = {}
        for idx, cell in enumerate(cells[1:], start=1):
            opponent = opponents[idx] if idx < len(opponents) else str(idx)
            kills_vs[opponent] = extract_text_content(cell)

        matrix.append({"player": player_name, "kills_vs": kills_vs})

    return matrix


def _perf_cell_value(cell) -> str:
    """A performance cell shows a count, or nothing for zero. Notable cells also
    hold a hover popup (round number, victims) that must not leak into the value."""
    sq = cell.css_first(".stats-sq")
    if sq is None:
        return extract_text_content(cell)
    for popup in sq.css(".wf-popable-contents"):
        popup.decompose()
    text = sq.text(strip=True)
    return text if text else "0"


def _parse_advanced_stats(html: HTMLParser, game_id: str | None = None) -> list[dict]:
    """
    Parse the advanced stats table from the performance tab for one game.

    Columns: 2K, 3K, 4K, 5K, 1v1, 1v2, 1v3, 1v4, 1v5, ECON, PL, DE.
    Rows carry the player name and team tag but no player link, so callers join
    by name within the match. The header is a <th> row inside <tbody>.
    """
    advanced: list[dict] = []

    table = _game_scope(html, game_id).css_first("table.wf-table-inset.mod-adv-stats")
    if not table:
        return advanced

    headers: list[str] = []
    for row in table.css("tr"):
        ths = row.css("th")
        if ths and not row.css("td"):
            headers = [extract_text_content(th) for th in ths]
            continue
        cells = row.css("td")
        if len(cells) < 3:
            continue

        name_el = cells[0].css_first(".team > div")
        tag_el = cells[0].css_first(".team-tag")
        tag = tag_el.text(strip=True) if tag_el else ""
        if name_el is not None:
            if tag_el is not None:
                tag_el.decompose()
            name = name_el.text(strip=True)
        else:
            name = extract_text_content(cells[0])

        agent_img = cells[1].css_first("img")
        agent = ""
        if agent_img:
            src = agent_img.attributes.get("src", "")
            agent = src.rsplit("/", 1)[-1].rsplit(".", 1)[0]

        stat_dict: dict[str, str] = {"player": name, "team_tag": tag, "agent": agent}
        for idx, cell in enumerate(cells[2:], start=2):
            label = headers[idx] if idx < len(headers) else str(idx)
            stat_dict[label] = _perf_cell_value(cell)
        advanced.append(stat_dict)

    return advanced


# ---------------------------------------------------------------------------
# Economy tab parser
# ---------------------------------------------------------------------------

def _parse_economy(html: HTMLParser) -> list[dict]:
    """
    Parse the economy table from the economy tab.

    Rows per team with pistol/eco/semi-buy/full-buy win rates.
    """
    economy: list[dict] = []

    table = html.css_first("table.wf-table-inset.mod-econ")
    if not table:
        return economy

    header_row = table.css_first("thead tr")
    headers: list[str] = []
    if header_row:
        for th in header_row.css("th"):
            headers.append(extract_text_content(th))

    for row in table.css("tbody tr"):
        cells = row.css("td")
        if not cells:
            continue

        row_dict: dict[str, str] = {}
        for idx, cell in enumerate(cells):
            label = headers[idx] if idx < len(headers) else str(idx)
            row_dict[label] = extract_text_content(cell)

        economy.append(row_dict)

    return economy


# ---------------------------------------------------------------------------
# Main scraper
# ---------------------------------------------------------------------------

@handle_scraper_errors
async def vlr_match_detail(match_id: str) -> dict:
    """
    Scrape a single VLR.GG match page and return structured match data.

    Fetches the base page, then concurrently fetches the performance and
    economy tabs for the first game. Cache TTL is 30 s for live matches
    and 300 s for completed matches.

    Args:
        match_id: Numeric VLR.GG match ID (e.g. "123456").

    Returns:
        Standard response dict with shape::

            {
                "data": {
                    "status": 200,
                    "segments": [{ ... match fields ... }]
                }
            }
    """
    base_url = f"{VLR_BASE_URL}/{match_id}"

    # Determine cache TTL after we know if the match is live.
    # We first check the live-TTL cache, then the completed-TTL cache.
    cached = cache_manager.get(CACHE_TTL_MATCH_DETAIL_LIVE, "match_detail", match_id)
    if cached is not None:
        return cached
    cached = cache_manager.get(CACHE_TTL_MATCH_DETAIL, "match_detail", match_id)
    if cached is not None:
        return cached

    async def build():
        cached_live = cache_manager.get(
            CACHE_TTL_MATCH_DETAIL_LIVE, "match_detail", match_id
        )
        if cached_live is not None:
            return cached_live

        cached_complete = cache_manager.get(
            CACHE_TTL_MATCH_DETAIL, "match_detail", match_id
        )
        if cached_complete is not None:
            return cached_complete

        client = get_http_client()

        base_resp = await fetch_with_retries(base_url, client=client)
        http_status = base_resp.status_code
        if http_status >= 400:
            return upstream_error_payload(http_status, f"match detail {match_id}")

        base_html = parse_html(base_resp.text)

        game_ids = _extract_game_ids(base_html)
        first_game_id = game_ids[0] if game_ids else None

        performance_by_game: dict[str, dict] = {}
        economy_by_game: dict[str, list[dict]] = {}

        if game_ids:
            tab_fetch_semaphore = asyncio.Semaphore(MATCH_DETAIL_TAB_FETCH_CONCURRENCY)

            async def fetch_tab(game_id: str, tab: str):
                async with tab_fetch_semaphore:
                    return await _fetch_game_tab_html(
                        client,
                        base_url,
                        game_id,
                        tab,
                        timeout=MATCH_DETAIL_TAB_FETCH_TIMEOUT,
                    )

            tab_results = await asyncio.gather(
                *[
                    fetch_tab(game_id, tab)
                    for game_id in game_ids
                    for tab in (("performance", "economy") if game_id == game_ids[0] else ("economy",))
                ]
            )

            for game_id, tab, tab_html in tab_results:
                if tab_html is None:
                    continue
                if tab == "performance":
                    # One page holds every game's block, so one fetch covers all maps.
                    for gid in game_ids:
                        performance_by_game[gid] = {
                            "kill_matrix": _parse_kill_matrix(tab_html, gid),
                            "advanced_stats": _parse_advanced_stats(tab_html, gid),
                        }
                elif tab == "economy":
                    economy_by_game[game_id] = _parse_economy(tab_html)

        event_info = _parse_event_info(base_html)
        header_info = _parse_match_header(base_html)
        teams = _parse_teams(base_html)
        streams, vods = _parse_streams_vods(base_html)
        maps = _parse_maps(base_html)
        h2h = _parse_head_to_head(base_html)

        for index, map_data in enumerate(maps):
            game_id = game_ids[index] if index < len(game_ids) else ""
            map_data["performance"] = performance_by_game.get(
                game_id, {"kill_matrix": [], "advanced_stats": []}
            )
            map_data["economy"] = economy_by_game.get(game_id, [])

        first_game_performance = performance_by_game.get(
            first_game_id or "", {"kill_matrix": [], "advanced_stats": []}
        )
        first_game_economy = economy_by_game.get(first_game_id or "", [])

        segment = {
            "match_id": match_id,
            "event": event_info,
            "date": header_info["date"],
            "map_vetos": header_info["map_vetos"],
            "status": header_info["status"],
            "start_utc": header_info["start_utc"],
            "best_of": header_info["best_of"],
            "event_id": header_info["event_id"],
            "patch": header_info["patch"],
            "teams": teams,
            "streams": streams,
            "vods": vods,
            "maps": maps,
            "head_to_head": h2h,
            "performance": {
                "kill_matrix": first_game_performance["kill_matrix"],
                "advanced_stats": first_game_performance["advanced_stats"],
                "by_map": [
                    {"game_id": game_id, **performance_by_game.get(game_id, {"kill_matrix": [], "advanced_stats": []})}
                    for game_id in game_ids
                ],
            },
            "economy": first_game_economy,
            "economy_by_map": [
                {"game_id": game_id, "rows": economy_by_game.get(game_id, [])}
                for game_id in game_ids
            ],
        }

        data = {"data": {"status": http_status, "segments": [segment]}}

        live = _is_live(base_html)
        ttl = CACHE_TTL_MATCH_DETAIL_LIVE if live else CACHE_TTL_MATCH_DETAIL
        cache_manager.set_if_cacheable(ttl, data, "match_detail", match_id)

        return data

    return await cache_manager.coalesce_async(f"match_detail:{match_id}", build)
