---
name: VFL — Valorant Fantasy League
description: A broadcast-overlay HUD for drafting and running fantasy Valorant rosters.
colors:
  bg: "#0d0f17"
  bg-deep: "#0b0d14"
  bg-sunken: "#090d16"
  surface: "#161b29"
  surface-hi: "#1e2435"
  surface-flyout: "#10131d"
  surface-alt: "#23293a"
  line: "#1c2233"
  line-bracket: "#2b3145"
  ink: "#ece8e1"
  muted: "#8a8f9e"
  faint: "#4c5160"
  accent: "#ff4655"
  accent-soft: "rgba(255, 70, 85, 0.13)"
  accent-ink: "#ffffff"
  win: "#00c8a0"
  win-soft: "rgba(0, 200, 160, 0.14)"
  win-ink: "#032019"
  gold: "#d8b34c"
  gold-dim: "#8a7330"
  gold-soft: "rgba(216, 179, 76, 0.14)"
  gold-ink: "#211b06"
  opponent: "#00d2ff"
typography:
  hero:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "clamp(38px, 7vw, 84px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
  display:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
  micro:
    fontFamily: "ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  none: "0px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.none}"
    padding: "15px 24px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  button-secondary:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "15px 24px"
  button-secondary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  nav-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    size: "44px"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
---

# Design System: VFL — Valorant Fantasy League

## Overview

**Creative North Star: "The Broadcast Overlay"**

VFL reads like the on-screen HUD of a Valorant broadcast, not like a consumer app skinned in red and black: status strips, bracket connectors, and stenciled mono labels sit directly on a near-black ground, and every surface behaves like a data readout rather than a decorative card. The system is deliberately cold and blunt — controls feel like hardware switches, not soft affordances. There is one accent color, and it is spent on the single most important thing on any given screen: the active nav item, the primary CTA, a live score.

The visual grammar is inherited from playvalorant.com and applied globally: sharp corners (mostly true right angles, with a small family of notched/cut corners reserved for interactive chrome), solid flat color fills, uppercase tabular-numeral type, and zero gradients or glows. Separation between regions comes from whitespace and filled surface blocks, never from decorative hairlines — a hairline only appears where it does real structural work (a strip's bottom edge, a table rule).

Depth is cut-and-layered, not lit: elements stack as flat, notched silhouettes on top of one another, and where a shadow does appear it is a hard offset print (5px/5px, zero blur), never a soft ambient glow. Nothing in this system floats on light — it sits, printed, on the surface below it.

**Key Characteristics:**
- One accent (`--accent`, #ff4655), spent sparingly on active/primary state only
- Flat fills over gradients; hard offset shadows over soft blur
- Small family of clip-path "cut corner" notches on interactive chrome; everything else is a true right angle
- Uppercase mono labels with wide tracking for anything structural (crumbs, counts, nav tips, stat labels)
- Tabular numerals wherever a number can change, so digits don't reflow
- Density and layout obey a strict 4pt spacing grid and an Apple HIG 44pt/28pt control-size floor

## Colors

The palette is near-monochrome ink-on-graphite with one hot accent and one cool "win" signal; gold is reserved for a single sub-brand (the Esports Nations Cup) rather than general decoration.

### Primary
- **Signal Red** (`#ff4655`, `--accent`): the one accent. Active nav state, primary buttons, hover state on secondary controls, live/selected indicators. Never used decoratively — its presence always means "this is the active or primary thing."
- **Signal Red Soft** (`rgba(255, 70, 85, 0.13)`, `--accent-soft`): accent-tinted fill for rows/badges that reference the accent without competing with it.

### Secondary
- **Champion Gold** (`#d8b34c`, `--gold`): reserved for Esports Nations Cup chrome, rating/OVR badges, and the specialties/booster iconography on PlayerCard — a deliberately separate hue so prestige and event surfaces read as a distinct register, not a re-skin.
- **Gold Dim** (`#8a7330`, `--gold-dim`) / **Gold Soft** (`rgba(216, 179, 76, 0.14)`, `--gold-soft`): gold's muted and tint steps, same usage discipline as the red pair.
- **Gold Ink** (`#211b06`, `--gold-ink`): the dark text color used on a `--gold` fill (badges, ENC hover states) — gold is light enough that white text fails contrast on it.

### Tertiary
- **Confirm Teal** (`#00c8a0`, `--win`): status-only. Marks a win, an online roster indicator, a positive delta. Not used as a UI accent.
- **Win Soft** (`rgba(0, 200, 160, 0.14)`, `--win-soft`) / **Win Ink** (`#032019`, `--win-ink`): teal's tint step and its on-fill dark text, same pairing discipline as gold.
- **Opponent Cyan** (`#00d2ff`, `--opponent`): match-log color coding only. The player's own numbers/rows are always `--accent`; the opponent's equivalent numbers/rows are always this cyan. Never used outside a player-vs-opponent comparison (stat bars, zone-control meters, match log rows).

### Neutral
- **Void** (`#0d0f17`, `--bg`): page ground.
- **Deep Void** (`#0b0d14`, `--bg-deep`) / **Sunken Void** (`#090d16`, `--bg-sunken`): recessed chrome — rails, status strips, wells the page content sits inside.
- **Slate Surface** (`#161b29`, `--surface`): the resting surface for data rows and panels.
- **Slate Surface Hi** (`#1e2435`, `--surface-hi`): hover/emphasis step above `--surface`.
- **Flyout Ink** (`#10131d`, `--surface-flyout`): tooltips and popovers.
- **Nested Slate** (`#23293a`, `--surface-alt`): a surface nested inside `--surface` (form fields, secondary buttons, toggle tracks).
- **Structural Line** (`#1c2233`, `--line`): strips, rails, table rules.
- **Bracket Line** (`#2b3145`, `--line-bracket`): tournament bracket connectors, where the line itself carries data.
- **Bone Ink** (`#ece8e1`, `--ink`): primary text.
- **Muted Steel** (`#8a8f9e`, `--muted`): secondary text, labels, inactive nav.
- **Faint Steel** (`#4c5160`, `--faint`): tertiary text, disabled/placeholder.

### Named Rules
**The One Accent Rule.** `--accent` marks exactly one thing per screen as primary or active. If two elements both want it, one of them is wrong.

**The No-Glow Rule.** No `box-shadow` blur radius beyond what a hard offset needs, no radial-gradient decoration, no `filter: drop-shadow` for ambiance. The one intentional exception is the PlayerCard glare layer, which simulates a physical foil card under light — a single, purpose-built effect, not a general pattern.

## Typography

**Display Font:** Familjen Grotesk (with system-ui, sans-serif fallback)
**Label/Mono Font:** ui-monospace (with Menlo, monospace fallback)

**Character:** One grotesque carries every weight of the interface — headline and body are the same family at different weights, so voice never shifts between "marketing" and "UI." The monospace family is reserved for anything structural: it signals "this is a readout," not prose.

### Hierarchy
- **Hero** (700, `clamp(38px, 7vw, 84px)`, line-height 1): full-bleed page titles (room headers, standings).
- **Display** (700, 40px, line-height 1): section-level numerals and headlines.
- **Heading** (700, 28px, line-height 1.2): panel and card-group titles.
- **Title** (700, 22px, line-height 1.2): sub-panel and modal titles.
- **Body** (400, 15px, line-height 1.5): running text, descriptions, rule copy.
- **Label** (700, 13px, mono, 0.14em tracking, uppercase): field labels, kickers, roster row metadata.
- **Micro** (700, 11px, mono, 0.14em tracking, uppercase): the smallest step — non-interactive crumbs and tabular chip labels only, never body copy.

All numeric data (scores, stats, counts, ratings) uses `font-variant-numeric: tabular-nums` so digits never cause layout shift as they update.

### Named Rules
**The Uppercase-Structural Rule.** Uppercase + mono + wide tracking marks structural chrome (crumbs, kickers, nav tips, stat labels). Body copy and player names are never uppercased — that would flatten the one hierarchy signal the mono family provides.

## Layout

The shared content column is `--content-max: 1080px`, centered, with gutters added on top of (not inside) that max-width. A left rail (`--rail-size`, 56px desktop) reserves horizontal space via `--frame-inset`; on mobile the rail becomes a 48px top bar and `--frame-inset` drops to 0, so bleed-to-edge elements must branch their width calc on the same breakpoint.

Spacing follows a strict 4pt scale (`--sp-1` 4px through `--sp-12` 48px) — no arbitrary pixel gaps. The primary responsive breakpoint is 680px (rail → top bar, multi-column grids collapse to one column); a secondary breakpoint at 420px drops visible nav labels to sr-only text once three labelled tiles stop fitting a touch-width screen.

Every control respects the Apple HIG size floor: 44px (`--tap-min`) for primary controls, 28px (`--tap-min-secondary`) for controls that sit inside an already-large target (e.g. an inspect button inside a full data row).

## Elevation & Depth

Cut-and-layered, not lit. The system has no ambient light source: surfaces don't glow, and nothing casts a soft shadow implying a light above the screen. Depth instead comes from (a) flat color layering — a lighter surface stacked on a darker one reads as "in front" — and (b) a small hard-offset shadow family that reads as print, not light.

### Shadow Vocabulary
- **Card** (`5px 5px 0 rgba(0, 0, 0, 0.4)`, `--shadow-card`): resting state for stamped/printed elements (booster chips, panels that need to read as physically offset).
- **Card Lifted** (`8px 8px 0 rgba(0, 0, 0, 0.5)`, `--shadow-card-lifted`): hover/press state for the same elements — the offset grows, it never blurs.
- **Overlay** (`0 12px 40px rgba(0, 0, 0, 0.6)`, `--shadow-overlay`): the one soft shadow in the system, reserved for true overlay surfaces (modals, flyouts) that need to visually separate from the entire page behind them, not from a neighboring surface.

### Named Rules
**The Print-Not-Light Rule.** A shadow's offset is fixed at 5px/5px (or its 8px/8px lifted step); blur only appears on `--shadow-overlay`, which is the sole soft-shadow token in the system and exists to separate a full overlay from the page, not to imply directional light on a component.

## Shapes

Two coexisting corner languages, used by role rather than by taste. Structural containers (strips, panels, page-level rows) are true right angles — zero radius. Interactive chrome — nav items, primary/secondary buttons, the load-more control, PlayerCard's specialty and booster chips, tooltip flyouts — carries a small notched corner cut with `clip-path: polygon(...)`, typically an 8–13px diagonal cut on the top-right and bottom-left corners. The notch is the system's one signature geometric flourish; it never appears on passive containers, only on things you can act on.

## Components

### Buttons
- **Shape:** true rectangle for legacy/in-flow CTAs still mid-migration; canonical buttons use the 8–9px notched-corner cut (`clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px))`).
- **Primary:** `--accent` fill, white text, 15px/24px padding, 700 weight, 0.1em uppercase tracking, no border.
- **Secondary:** `--surface-alt` fill, `--ink` text, same shape and padding as primary.
- **Hover / Focus:** primary and secondary both resolve to `--accent` fill + white text on hover (secondary "becomes" primary on hover rather than getting a separate hover treatment). All buttons get `translateY(1px) scale(0.985)` on `:active` from the global interactive base, and a single `:focus-visible` outline (`--focus-ring` 2px solid `--accent`, or white via `--focus-color` when the control is already accent-filled).
- **Disabled:** opacity 0.4, `cursor: not-allowed`, no shadow.

### Nav (ModeRail)
- **Style:** vertical icon rail on desktop (56px, `--bg-deep` ground, right hairline in `--line`), horizontal top bar on mobile with visible labels instead of a hover flyout.
- **Item:** 44×44px notched tile, `--surface` at rest → `--surface-hi` on hover, `--accent` fill with `accent-ink` text when active.
- **Label:** shown as a `--surface-flyout` tooltip flyout on desktop hover/focus; inlined next to the icon on mobile; collapsed to sr-only text below 420px where three labelled tiles no longer fit.

### Status Strip
- **Style:** sticky breadcrumb row, `--bg-deep` ground, bottom hairline in `--line`, min-height `--strip-h` (44px desktop / 40px mobile).
- **Crumb:** renders as the page's real `<h1>` — mono, uppercase, `--muted`, wide tracking.
- **Count:** same type treatment, `--ink` color, tabular numerals.

### PlayerCard (signature component)
The hero object of the app: a tilting, flippable trading card (3D perspective tilt driven by pointer position, a separate slower flip transition for front/back, and a screen-blend glare layer that simulates foil under light — the system's one deliberate departure from the No-Glow Rule). Specialty and booster chips sit on cut-corner notched tiles in `--gold`, spilling half off the card edge, with hover tooltips in the same notched-flyout language as the rest of the system. Respects `prefers-reduced-motion` by disabling tilt/flip/glare transitions outright.

### SquadDock + SquadSheet (persistent roster control)
Replaces the earlier card-fan-in-a-drawer pattern, which opened from cursor position — a mode that could be triggered or lost by accident. The dock (`SquadDock`) is a permanent row of notched 52px chips (44px on mobile) in the bottom `SquadBar`: portrait crop, rating, an IGL tag, a fatigue/boost dot — always legible, no open/close state to get wrong. Hovering a chip lifts one real `PlayerCard` above it (mouse only, suppressed under `prefers-reduced-motion` and `(hover: none)`); clicking a chip opens the single-card `CardFocusOverlay`.

The full team scoreboard (`SquadSheet`) is a bottom sheet, not a centered modal — it rises from the dock's own edge and stops short of the top of the screen, so a page that pins it open still shows its own hero and context above the dim (no `backdrop-filter` blur, for the same reason). It opens three ways: held **Tab** (`usePeekKey`, released to close — the VALORANT/CS scoreboard gesture), the dock's `SQUAD` button (mouse/touch), or a phase pinning it open when a card needs picking (`action: { prompt, onPick, isEligible?, dismissible, skip? }` — clicking an eligible card fires the pick directly, no per-card button). Mandatory picks (naming an IGL) hold against Esc; optional ones (a pack swap, a shop target) close on Esc and remain reachable again via peek.

**Tab-key tradeoff:** Tab is taken for the peek gesture on every screen the dock is visible, except inside a text input/textarea/contenteditable (`isTypingTarget`). Shift+Tab is left alone, so keyboard-only users can still traverse backward; the `SQUAD` button is always a mouse/touch-reachable door into the same sheet.

## Do's and Don'ts

### Do:
- **Do** spend `--accent` on exactly one primary/active element per view (The One Accent Rule).
- **Do** use the notched `clip-path` cut on interactive chrome only — nav items, buttons, chips, tooltips.
- **Do** set `font-variant-numeric: tabular-nums` on any number that can change at runtime.
- **Do** honor the 44px/28px control-size floor (`--tap-min` / `--tap-min-secondary`) for every new interactive element.
- **Do** keep body copy and player names in normal case; reserve uppercase for structural/mono labels.

### Don't:
- **Don't** add a soft blurred `box-shadow` or `radial-gradient` glow outside the two named exceptions (`--shadow-overlay`, PlayerCard's glare layer).
- **Don't** round a structural container's corners — true right angles only; the notch cut is reserved for interactive chrome.
- **Don't** introduce a second accent color. Gold and teal are status/sub-brand signals, not alternate accents.
- **Don't** use a decorative hairline; a border only appears where it does real structural work (a strip edge, a table rule, a bracket connector).
