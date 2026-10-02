# Vendored vlrggapi

Upstream: https://github.com/axsddlr/vlrggapi
Base commit: a6075fe
Vendored: 2026-10-02 (MIT, see LICENSE)

The working tree was copied including three uncommitted local patches
(patches/0000-local-uncommitted.diff): players.py agent table, stats.py 2026
column map, rate_limiter.py expensive tier 150/min. Do not pull upstream over
these. Later patches (match detail parser, events, iCal, pacing) land as their
own commits.
