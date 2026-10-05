# Team logo audit — 2026-10-05

All 48 VCT teams from the 2026 regional Kickoff event lists now have local logo assets and an independent identity registry in `src/data/teams.json`. Each entry records its VLR source. The registry supplements collectible cards for match, bingo and roster lookups.

Added logos: Cloud9, Evil Geniuses, ENVY, Gen.G, GIANTX, Karmine Corp, Natus Vincere, PCIFIC Esports, Sentinels, Team Secret, ULF Esports, VARREL and ZETA DIVISION. La Masia's generic placeholder was replaced from https://www.vlr.gg/team/18025 (https://owcdn.net/img/67d238ec97f91.png).

Shared CSS presents 42 predominantly black monochrome marks in white, Vitality in yellow and Paper Rex in pink. Original image files remain intact; these presentation rules apply across both apps. Team color metadata includes the VCT registry and the requested Vitality/Paper Rex colors.

## Artwork still needed

These seven collectible-card teams still use the same generic VALORANT placeholder. Their VLR team searches were checked and the matching team pages still returned `/img/vlr/tmp/vlr.png`:

- X-CAST (`XC`)
- 555 (`555`)
- FULL BOX 200 (`200`)
- Axe (`AXE`)
- Melser Kindergarten (`MKG`)
- Seiiki (`SKI`)
- Team Spire (`Team Spire`)

User-supplied official artwork is needed to replace these placeholders. A separate unused `pim.png` also contains the generic placeholder.

## Validation

- All 48 registry entries reference existing local files.
- The logo lookup passes ESLint.
- Both application production builds pass.
