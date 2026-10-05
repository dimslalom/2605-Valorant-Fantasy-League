# Design GSM — VFL / OpVAL

**Graphic Standard Manual · Version 1.0 · 5 October 2026**

This manual records the visual language currently implemented in the repository. **VFL** is the main fantasy game. **OpVAL** (`apps/call`) shares its base palette and body type, then applies its own condensed display type and ruby action treatment. For implementation, the live CSS is authoritative: [`src/styles/tokens.css`](src/styles/tokens.css), [`src/index.css`](src/index.css), and [`apps/call/src/styles/app.css`](apps/call/src/styles/app.css). [`DESIGN.md`](DESIGN.md) contains the broader original design rationale.

## 1. Brand idea

**Broadcast overlay.** Build pages like a live esports HUD: dark graphite fields, dense score readouts, sharp hierarchy, deliberate color signals, and controls that feel immediate. The main game uses flat, mostly square surfaces and small cut corners on interactive elements. OpVAL keeps the same dark foundation while using rounder, more dimensional action chrome in its current UI.

Use color to convey meaning. Red calls attention to the current action; teal confirms a positive result; gold marks prestige or a reward; cyan identifies the opponent in head-to-head data. Keep prose and supporting data visually quieter than the active state.

## 2. Typography

### Font inventory

| Font | Role | Weights loaded | Where used | Fallback |
|---|---|---|---|---|
| **Familjen Grotesk** | Main game display and body; OpVAL body | 400, 500, 600, 700; italic 400 | Headlines, player names, descriptions, interface copy | `system-ui, sans-serif` |
| **Barlow Condensed** | OpVAL display only | 600, 700 | Scorelines, team names, large numerals, page titles | `Arial Narrow, sans-serif` |
| **System monospace** | Structural readouts in both products | Device dependent; generally 700 in the UI | Labels, counts, timestamps, status, metadata | `ui-monospace, Menlo, monospace` |

Fonts are loaded through Google Fonts in [`index.html`](index.html) and [`apps/call/index.html`](apps/call/index.html). There are no local font files in this repository. Do not specify Familjen at 800 or 900: only up to 700 is loaded. The OpVAL SVG wordmark is vector artwork, not a text setting in one of these families.

### Type scale

| Role | Size / line height | Family and weight | Use |
|---|---|---|---|
| Hero | `clamp(38px, 7vw, 84px)` / 1 | Familjen 700 | Main game page hero |
| Display | 40px / 1 | Familjen 700 | Main game key number or headline |
| Heading | 28px / 1.2 | Familjen 700 | Section title |
| Title | 22px / 1.2 | Familjen 700 | Card group or dialog title |
| Lead | 18px / 1.5 | Familjen 400–600 | Short introductory copy |
| Body | 15px / 1.5 | Familjen 400 | Paragraphs and explanatory copy |
| Annotation | 12px / 1.4 | Familjen 400 | Brief supporting note below a value |
| Label | 13px / 1 | System mono 700 | Fields, metadata, navigation hints |
| Micro | 11px / 1 | System mono 700 | Compact non-prose readouts |
| Nano | 10px / 1 | System mono 700 | Exceptional dense badges only; not a general text size |
| OpVAL display | Contextual, commonly 20–44px | Barlow Condensed 700 | OpVAL names, scores, headings |

Set structural mono labels in uppercase with `0.14em` tracking. Use `0.1em` for other uppercase control text and `-0.015em` for main-game display text. Keep prose and player names in their natural case. Use tabular numerals for scores, countdowns, rankings, and changing values. The exact OpVAL display size changes by component; preserve its condensed family and strong weight rather than forcing the main game's scale onto it.

## 3. Color palette

These are the **live shared CSS tokens**, including the current `--faint` value. Hex values are for opaque colors. Soft colors retain their alpha values and must be placed over a defined dark surface.

### Core and semantic colors

| Name | Token | Value | Use |
|---|---|---|---|
| Signal red | `--accent` | `#FF4655` | Main-game primary action, active navigation, live emphasis |
| Signal red tint | `--accent-soft` | `rgba(255, 70, 85, 0.13)` | Subtle selected or referenced areas |
| Accent ink | `--accent-ink` | `#FFFFFF` | Large/bold text or icons on red fills; see contrast rule |
| Confirm teal | `--win` | `#00C8A0` | Wins, success, positive change |
| Teal tint | `--win-soft` | `rgba(0, 200, 160, 0.14)` | Positive background tint |
| Teal ink | `--win-ink` | `#032019` | Text on solid teal |
| Champion gold | `--gold` | `#D8B34C` | Prestige, rating, reward, ENC treatment |
| Gold dim | `--gold-dim` | `#8A7330` | Quiet gold detail |
| Gold tint | `--gold-soft` | `rgba(216, 179, 76, 0.14)` | Subtle reward background |
| Gold ink | `--gold-ink` | `#211B06` | Text on solid gold |
| Opponent cyan | `--opponent` | `#00D2FF` | Opponent side of match comparisons only |
| OpVAL ruby | `--ruby` | `#BD3944` | OpVAL actions, selected controls, live glass treatment |

### Neutral foundation

| Name | Token | Value | Use |
|---|---|---|---|
| Void | `--bg` | `#0D0F17` | Main page background |
| Deep void | `--bg-deep` | `#0B0D14` | Rail, HUD, status strip |
| Sunken void | `--bg-sunken` | `#090D16` | Recessed wells |
| Slate surface | `--surface` | `#161B29` | Panel and data row |
| Raised slate | `--surface-hi` | `#1E2435` | Hover and emphasis |
| Flyout ink | `--surface-flyout` | `#10131D` | Tooltip and popover |
| Nested slate | `--surface-alt` | `#23293A` | Field, nested panel, secondary control |
| Structural line | `--line` | `#1C2233` | Real boundaries and table rules |
| Bracket line | `--line-bracket` | `#2B3145` | Connectors and stronger structure |
| Bone ink | `--ink` | `#ECE8E1` | Primary text |
| Muted steel | `--muted` | `#8A8F9E` | Secondary text |
| Faint steel | `--faint` | `#818899` | Tertiary text, placeholders |

**OpVAL local treatments.** The current OpVAL UI also uses local values such as `#FF8C9C` for focus and hover, `#3A4157` for dark glass, and `#151A27` for some panels. These are component treatments, not replacements for the shared palette. Team colors and event colors are data-driven identity colors; keep them scoped to the team or event they represent.

### Color pairing and accessibility

| Pair | Contrast | Guidance |
|---|---:|---|
| Bone ink on void | 15.66:1 | Primary copy |
| Muted steel on void | 5.92:1 | Secondary copy |
| Faint steel on void | 5.39:1 | Tertiary copy |
| White on signal red | 3.36:1 | Large text and icons only; avoid small body/label text |
| White on OpVAL ruby | 5.48:1 | Normal text permitted |
| Teal ink on teal | 7.98:1 | Solid success badge |
| Gold ink on gold | 8.56:1 | Solid prestige badge |

Ratios are calculated from the opaque hex colors above. For red controls with small text, use a darker fill such as OpVAL ruby or otherwise adjust the pairing and verify contrast in its actual state. Do not rely on color alone for win/loss or player/opponent: include words, symbols, or position.

## 4. Identity and logo

The currently supplied OpVAL assets are [`public/opval-logo.svg`](public/opval-logo.svg) (wordmark, `723 × 224` viewBox) and [`public/opval-icon.svg`](public/opval-icon.svg) (square icon, `224 × 224` viewBox). Use the SVG files directly. Preserve their proportions and internal shapes; scale uniformly. The supplied art is white and expects a dark field. Keep enough clear space that the mark does not merge with adjacent controls or copy; use at least the height of the mark's capital “O” as a practical minimum. Do not recolor individual letter paths or typeset a substitute wordmark. The main game's brand treatment is primarily typographic and UI based; this repository does not define a separate VFL master logo.

## 5. Graphic language

### Main game

- **Layout:** centered content up to `1080px`, with gutters beyond that width. Desktop rail is `56px`; below `680px` it becomes a `48px` top bar.
- **Spacing:** a 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, and 48px. Let whitespace and surface blocks define sections.
- **Shape:** structural panels are square. Interactive controls may use a small diagonal cut at the upper right and lower left. Reserve that cut for actionable chrome.
- **Lines:** use only for a functional boundary, table rule, or bracket connection. Avoid decorative outlines around every panel.
- **Depth:** resting printed objects can use a hard `5px 5px 0` shadow; lifted objects use `8px 8px 0`. Soft overlay shadow is reserved for true modals and flyouts. PlayerCard foil and movement are special material effects, not general panel styling.

### OpVAL extension

OpVAL currently uses rounded tiles (`10px`), sheets (`14px`), pill controls, and ruby glass-like treatments for important actions. Keep these within OpVAL surfaces. Its condensed score typography and dimensional action material are intentional product-level differences from the main game's flatter HUD treatment.

## 6. Component rules

| Component | Default | Active / focus | Key constraint |
|---|---|---|---|
| Main-game primary button | Signal red fill; high-emphasis type | Red action; visible focus ring | At least `44px` touch height; verify small white text pairing |
| Main-game secondary button | Nested slate + bone ink | Turns red on hover | Keep only one dominant action per view |
| Main-game navigation | Slate tile + muted text | Signal red active tile | Maintain readable icon and label at mobile sizes |
| Status strip | Deep void + mono label | Current count in bone ink | Treat as page structure, not decoration |
| PlayerCard | Data-rich physical card | Tilt/lift/reveal | Keep foil, glare, and soft altitude effects card-specific |
| OpVAL action | Ruby material + white type | Ruby/glass selection and clear focus | Use the darker ruby for ordinary-size white text |
| Result / status | Neutral base | Teal win, gold reward, cyan opponent | Include a non-color cue |

Default focus indication in the main game is a `2px` accent outline with `3px` offset; OpVAL has its own lighter pink focus outline. All primary controls should remain usable at a `44px` minimum target. Animation should communicate a state change; under reduced-motion settings, keep the state visible without spatial movement.

## 7. Usage checklist

1. Pick the surface level (`--bg`, `--surface`, or `--surface-alt`) before adding borders or shadows.
2. Choose type by meaning: Familjen for content, mono for readout, Barlow Condensed for OpVAL display.
3. Spend the action color on the active or primary state. Use teal, gold, and cyan for their defined meanings.
4. Check text contrast in the actual color pairing and size. Use the dark ink tokens on solid teal and gold.
5. Keep changing numbers tabular, interactive targets large enough to touch, and focus visible.
6. Reuse the supplied SVG mark and the live CSS tokens before adding a new visual value.

## 8. Source notes

This manual follows the implemented `--faint: #818899`; the older `DESIGN.md` front matter lists `#4C5160`. It also records the current OpVAL ruby, rounded shapes, and glass treatments, which extend the earlier main-game rules. When a value is changed in code, update this manual and the older design reference together.
