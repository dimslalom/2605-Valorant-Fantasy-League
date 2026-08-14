"""Build changeable player heads and real-jersey kit plates.

Inputs are the already-normalised 400x412 cutouts in public/assets/players.
The expensive face parser is loaded alone (never alongside rembg), and every
output is resumable: an existing head or kit file is treated as a hand-made
override and is never overwritten.

Normal sync usage:
    python scripts/build_portraits.py \
      --manifest scripts/.cache/portraits/manifest.json

Local/review usage against the checked-in cards:
    python scripts/build_portraits.py --cards src/data/cards.json --limit 12
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 400, 412
SIZE = 512
SKIN, HAIR, NECK, CLOTH = 1, 13, 17, 18
HEAD_IDS = tuple(range(1, 16)) + (17,)
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
MODEL_URL = (
    "https://huggingface.co/jonathandinu/face-parsing/"
    "resolve/main/onnx/model.onnx"
)
MODEL_MIN_BYTES = 300 * 1024 * 1024

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
PLAYERS_DIR = ROOT / "public" / "assets" / "players"
HEADS_DIR = ROOT / "public" / "assets" / "heads"
HAIR_DIR = ROOT / "public" / "assets" / "hair"
KITS_DIR = ROOT / "public" / "assets" / "kits"
DATA_DIR = ROOT / "src" / "data"
CACHE_DIR = SCRIPT_DIR / ".cache" / "portraits"
MODEL_PATH = SCRIPT_DIR / ".cache" / "models" / "face-parsing.onnx"
PLACEHOLDER = "/assets/players/placeholder.png"
GREY_DONORS = ("derke", "zekken", "alfajer", "boaster", "chronicle")


def slug(value: str) -> str:
    out = "".join(ch for ch in str(value).lower() if ch.isalnum())
    return out or "unknown"


def asset_file(asset: str | None) -> Path | None:
    if not asset or not asset.startswith("/assets/"):
        return None
    return ROOT / "public" / asset.removeprefix("/")


def ensure_model(path: Path = MODEL_PATH) -> Path:
    if path.exists() and path.stat().st_size >= MODEL_MIN_BYTES:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    print(f"Downloading face parser ({MODEL_URL})...", flush=True)
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
            with partial.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        if partial.stat().st_size < MODEL_MIN_BYTES:
            raise RuntimeError(
                f"downloaded model is unexpectedly small "
                f"({partial.stat().st_size / 1024 / 1024:.1f} MB)"
            )
        partial.replace(path)
    finally:
        if partial.exists():
            partial.unlink()
    return path


class FaceParser:
    def __init__(self, model_path: Path):
        options = ort.SessionOptions()
        options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        self.session = ort.InferenceSession(
            str(model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def _infer(self, rgb: Image.Image) -> np.ndarray:
        image = rgb.resize((SIZE, SIZE), Image.Resampling.BICUBIC)
        tensor = np.asarray(image, np.float32) / 255.0
        tensor = ((tensor - MEAN) / STD).transpose(2, 0, 1)[None]
        logits = self.session.run(None, {self.input_name: tensor})[0][0]
        return logits.argmax(0).astype(np.uint8)

    def parse_head(self, photo: Image.Image, geom: dict) -> np.ndarray:
        x0, y0, x1, y1 = head_box(geom)
        flat = Image.new("RGBA", photo.size, (255, 255, 255, 255))
        flat.alpha_composite(photo)
        crop = flat.convert("RGB").crop((x0, y0, x1, y1))
        labels = self._infer(crop)
        side = x1 - x0
        labels_image = Image.fromarray(labels).resize(
            (side, side), Image.Resampling.NEAREST
        )
        full = Image.new("L", photo.size, 0)
        full.paste(labels_image, (x0, y0))
        return np.array(full)


def geometry_from_alpha(alpha: np.ndarray) -> dict | None:
    solid = alpha > 128
    rows = solid.sum(axis=1)
    ys = np.flatnonzero(rows)
    if not ys.size:
        return None
    top = int(ys[0])
    search_lo = top + int(0.30 * (H - top))
    search_hi = top + int(0.72 * (H - top))
    if search_hi <= search_lo:
        return None
    neck_y = int(search_lo + np.argmin(rows[search_lo:search_hi]))
    xs = np.flatnonzero(solid[neck_y])
    if not xs.size:
        return None
    below = rows[neck_y:]
    shoulder_y = int(neck_y + np.argmax(below))
    shoulder_w = int(rows[shoulder_y])
    neck_w = int(xs[-1] - xs[0] + 1)
    return {
        "top": top,
        "neckY": neck_y,
        "neckCx": round(float((xs[0] + xs[-1]) / 2), 1),
        "neckW": neck_w,
        "shoulderY": shoulder_y,
        "shoulderW": shoulder_w,
        "pinch": round(neck_w / max(shoulder_w, 1), 3),
    }


def photo_geometry(path: Path) -> dict | None:
    with Image.open(path) as image:
        return geometry_from_alpha(
            np.array(image.convert("RGBA").getchannel("A"))
        )


def head_box(geom: dict, pad_fraction: float = 0.28) -> tuple[int, ...]:
    top = int(geom["top"])
    neck_y = int(geom["neckY"])
    cx = float(geom["neckCx"])
    height = neck_y + 40 - top
    side = max(int(height * (1.0 + pad_fraction)), 64)
    cy = (top + neck_y + 40) // 2
    x0 = int(cx - side / 2)
    y0 = int(cy - side / 2)
    return x0, y0, x0 + side, y0 + side


def head_alpha(photo: Image.Image, labels: np.ndarray) -> Image.Image:
    parsed = np.isin(labels, HEAD_IDS).astype(np.uint8) * 255
    source = np.array(photo.getchannel("A"))
    return Image.fromarray(np.minimum(parsed, source))


def masked(photo: Image.Image, mask: Image.Image | np.ndarray) -> Image.Image:
    mask_array = np.array(mask)
    alpha = (
        np.array(photo.getchannel("A")).astype(np.int32)
        * mask_array.astype(np.int32)
        // 255
    )
    out = photo.copy()
    out.putalpha(Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8)))
    return out


def shift_image(image: Image.Image, delta: int) -> Image.Image:
    if not delta:
        return image
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(image, (0, -delta))
    return out


def shift_labels(labels: np.ndarray, delta: int) -> np.ndarray:
    if not delta:
        return labels
    out = np.zeros_like(labels)
    out[: H - delta] = labels[delta:]
    return out


def extend_neck(
    head_rgba: Image.Image, geom: dict, labels: np.ndarray
) -> Image.Image:
    """Extend only incoming-player skin down/out beneath the future collar."""
    rgba = np.array(head_rgba).copy()
    alpha = rgba[..., 3]
    solid = alpha > 128
    neck_y = int(geom["neckY"])
    cx = int(round(geom["neckCx"]))
    expected = max(int(geom["neckW"]), 1)
    runs: list[tuple[int, int, int]] = []

    for y in range(max(neck_y - 4, 0), min(neck_y + 86, H)):
        row = solid[y]
        seeds = np.flatnonzero(row[max(cx - 6, 0) : min(cx + 7, W)])
        if not row[cx] and not seeds.size:
            continue
        seed = cx if row[cx] else max(cx - 6, 0) + int(seeds[0])
        left = seed
        while left > 0 and row[left - 1]:
            left -= 1
        right = seed
        while right + 1 < W and row[right + 1]:
            right += 1
        width = right - left + 1
        semantic_skin = np.count_nonzero(
            np.isin(labels[y, left : right + 1], [SKIN, NECK])
        )
        if (
            expected * 0.42 <= width <= expected * 1.65
            and semantic_skin >= width * 0.35
        ):
            runs.append((y, left, right))

    if len(runs) < 3:
        return head_rgba

    tail = runs[-min(10, len(runs)) :]
    last = tail[-1][0]
    left = int(round(np.median([run[1] for run in tail])))
    right = int(round(np.median([run[2] for run in tail])))
    if right <= left:
        return head_rgba
    edge_inset = int(np.clip(round((right - left + 1) * 0.10), 3, 8))

    sample_y0 = neck_y
    sample_y1 = min(neck_y + 24, last + 1, H)
    profile = np.empty((right - left + 1, 3), np.uint8)
    for index, x in enumerate(range(left, right + 1)):
        sample_x = int(np.clip(x, left + edge_inset, right - edge_inset))
        pixels = np.empty((0, 3), np.uint8)
        for radius in range(13):
            candidates = (
                [sample_x]
                if radius == 0
                else [sample_x - radius, sample_x + radius]
            )
            for candidate in candidates:
                if not left + edge_inset <= candidate <= right - edge_inset:
                    continue
                valid = (
                    solid[sample_y0:sample_y1, candidate]
                    & np.isin(
                        labels[sample_y0:sample_y1, candidate], [SKIN, NECK]
                    )
                )
                pixels = rgba[
                    sample_y0:sample_y1, candidate, :3
                ][valid]
                if pixels.size:
                    break
            if pixels.size:
                break
        if pixels.size:
            profile[index] = np.median(pixels, axis=0).astype(np.uint8)
        else:
            profile[index] = rgba[last, int(np.clip(x, left, right)), :3]

    positions = np.arange(profile.shape[0], dtype=np.float32)
    luminance = profile.astype(np.float32) @ np.array(
        [0.2126, 0.7152, 0.0722], np.float32
    )
    lo, hi = np.percentile(luminance, [18, 82])
    fit = (luminance >= lo) & (luminance <= hi)
    if fit.sum() >= 8:
        smooth = np.empty_like(profile, dtype=np.float32)
        for channel in range(3):
            slope, intercept = np.polyfit(
                positions[fit], profile[fit, channel].astype(np.float32), 1
            )
            smooth[:, channel] = slope * positions + intercept
        profile = np.clip(smooth, 0, 255).astype(np.uint8)

    margin = int(np.clip(round(expected * 0.55), 20, 64))
    geom_left = int(round(cx - expected / 2))
    geom_right = geom_left + expected - 1
    full_x0 = max(min(left, geom_left) - margin, 0)
    full_x1 = min(max(right, geom_right) + margin, W - 1)
    extended = np.empty((full_x1 - full_x0 + 1, 3), np.uint8)
    for index, x in enumerate(range(full_x0, full_x1 + 1)):
        extended[index] = profile[
            int(np.clip(x - left, 0, len(profile) - 1))
        ]

    transition_y0 = max(neck_y, last - 18)
    transition_x0 = max(min(left, geom_left), 0)
    transition_x1 = min(max(right, geom_right), W - 1)
    target = extended[
        transition_x0 - full_x0 : transition_x1 - full_x0 + 1
    ].astype(np.float32)
    for y in range(transition_y0, last + 1):
        amount = (y - transition_y0) / max(last - transition_y0, 1)
        amount = amount * amount * (3.0 - 2.0 * amount)
        region = slice(transition_x0, transition_x1 + 1)
        skin = (rgba[y, region, 3] > 128) & np.isin(
            labels[y, region], [SKIN, NECK]
        )
        source = rgba[y, region, :3].astype(np.float32)
        mixed = source * (1.0 - amount) + target * amount
        rgba[y, region, :3][skin] = np.clip(
            mixed[skin], 0, 255
        ).astype(np.uint8)

    synthesized = np.zeros((H, W), bool)
    neck_region = np.zeros((H, W), bool)
    for y in range(neck_y, H):
        grow_t = min(max((y - neck_y - 16) / 32.0, 0.0), 1.0)
        grow = int(round(margin * grow_t))
        x0 = max(min(left, geom_left) - grow, 0)
        x1 = min(max(right, geom_right) + grow, W - 1)
        colours = extended[x0 - full_x0 : x1 - full_x0 + 1]
        region = slice(x0, x1 + 1)
        blank = rgba[y, region, 3] < 128
        rgba[y, region, :3][blank] = colours[blank]
        rgba[y, region, 3][blank] = 255
        synthesized[y, region][blank] = True
        if x1 > x0 + 3:
            rgba[y, x0, 3] = min(rgba[y, x0, 3], 96)
            rgba[y, x0 + 1, 3] = min(rgba[y, x0 + 1, 3], 192)
            rgba[y, x1 - 1, 3] = min(rgba[y, x1 - 1, 3], 192)
            rgba[y, x1, 3] = min(rgba[y, x1, 3], 96)
        neck_region[y, region] = True

    denominator = max(H - 1 - neck_y, 1)
    for y in range(neck_y, H):
        factor = 1.0 - 0.60 * ((y - neck_y) / denominator)
        shade = neck_region[y] & (
            np.isin(labels[y], [SKIN, NECK]) | synthesized[y]
        )
        rgba[y, shade, :3] = np.clip(
            rgba[y, shade, :3].astype(np.float32) * factor, 0, 255
        ).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def prepare_head(
    photo: Image.Image,
    geom: dict,
    labels: np.ndarray,
    alpha: Image.Image,
) -> tuple[Image.Image, Image.Image | None, dict]:
    """Normalise vertical runway, extend/shade neck, and split long hair."""
    delta = max(int(geom["neckY"]) - 250, 0)
    delta = min(delta, max(int(geom["top"]) - 8, 0))
    render_geom = dict(geom)
    if delta:
        render_geom["top"] -= delta
        render_geom["neckY"] -= delta
        render_geom["shoulderY"] -= delta

    head = photo.copy()
    head.putalpha(alpha)
    hair_mask = np.minimum(
        (labels == HAIR).astype(np.uint8) * 255, np.array(alpha)
    )
    hair = masked(photo, hair_mask)
    shifted_labels = shift_labels(labels, delta)
    head = shift_image(head, delta)
    hair = shift_image(hair, delta)
    head = extend_neck(head, render_geom, shifted_labels)

    below = np.array(hair.getchannel("A"))[
        min(int(render_geom["neckY"]) + 10, H) :
    ]
    hair_out = hair if np.count_nonzero(below > 96) >= 80 else None
    return head, hair_out, render_geom


def hair_flood_mask(
    photo: Image.Image, geom: dict, labels: np.ndarray
) -> np.ndarray:
    """Colour-continuity hair mask, independent of the semantic parse.

    Measured against a real donor (skuba, a mullet draping onto the shoulder):
    the pixels were INSIDE the parsed crop the whole way down, but the parser
    itself called much of the dark strand "cloth" rather than "hair" — an
    ambiguous, low-resolution texture right where the crop's detail is
    thinnest. A single bad label there is enough to bake a hair-shaped smudge
    straight into the jersey plate, and no amount of dilating a
    correctly-labelled region fixes a region that was never labelled hair to
    begin with.

    Region-grow from a scalp anchor — near the crown, where classification is
    reliable — through 8-connected pixels, ignoring the per-pixel label from
    there on: this only cares what the hair actually looks like, not what one
    uncertain patch downstream was called.

    Each step compares a candidate against the neighbour that is ADMITTING it,
    not just the original scalp colour — a single strand runs from lit crown
    to shadowed shoulder, and skuba's mullet measured a 48-unit drift end to
    end, past a fixed global threshold tight enough to reject a white jersey a
    few pixels away.

    Local-only tolerance was tried first and is NOT safe alone: fabric has its
    own soft shading gradient, and on skuba's white jersey the walk drifted
    step by step through it and erased almost the entire plate. Every step
    must also stay within a wider cap of the ORIGINAL seed colour — loose
    enough to cross a strand's natural lighting range, tight enough that a
    long smooth ramp across fabric still gets stopped partway rather than
    reaching solid cloth.
    """
    solid = np.array(photo.getchannel("A")) > 128
    rgb = np.array(photo.convert("RGB")).astype(np.int32)
    top, cx = int(geom["top"]), int(round(geom["neckCx"]))

    seed_band = labels[top + 10:top + 46, cx - 40:cx + 40] == HAIR
    if seed_band.sum() < 40:
        return np.zeros((H, W), bool)

    seeds = np.zeros((H, W), bool)
    seeds[top + 6:top + 50, cx - 45:cx + 45] = True
    hair_colour = np.median(rgb[top + 10:top + 46, cx - 40:cx + 40][seed_band], axis=0)
    seeds &= (np.sqrt(((rgb - hair_colour) ** 2).sum(axis=2)) < 42) & solid
    if not seeds.any():
        return np.zeros((H, W), bool)

    step_thresh_sq = 46 ** 2
    seed_cap_sq = 85 ** 2
    visited = seeds.copy()
    queue = deque(zip(*np.nonzero(seeds)))
    while queue:
        y, x = queue.popleft()
        base = rgb[y, x]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ny, nx = y + dy, x + dx
                if not (0 <= ny < H and 0 <= nx < W):
                    continue
                if visited[ny, nx] or not solid[ny, nx]:
                    continue
                candidate = rgb[ny, nx]
                if (
                    int(((candidate - base) ** 2).sum()) < step_thresh_sq
                    and int(((candidate - hair_colour) ** 2).sum()) < seed_cap_sq
                ):
                    visited[ny, nx] = True
                    queue.append((ny, nx))

    # Mop-up: a few of the darkest, most deeply-shadowed pixels at a strand's
    # frayed end can still sit just past seed_cap_sq — tightened specifically
    # to stop the walk from bleeding into the jersey's own shading gradient.
    # Within a small halo of pixels the walk DID confirm, proximity itself is
    # strong evidence, which a colour-only rule far from the seed can't use —
    # so allow a looser tolerance there without loosening it everywhere.
    halo = np.array(
        Image.fromarray((visited * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(31))
    ) > 0
    mopup = halo & solid & ~visited & (
        ((rgb - hair_colour) ** 2).sum(axis=2) < 130 ** 2
    )
    visited |= mopup
    return visited


def plate_keep_alpha(
    photo: Image.Image, geom: dict, labels: np.ndarray
) -> Image.Image:
    """Remove donor head/neck, growing jaw/hair but not neck sides."""
    body_alpha = np.array(photo.getchannel("A"))
    raw = np.isin(labels, HEAD_IDS) & (body_alpha > 0)
    raw = raw | hair_flood_mask(photo, geom, labels)
    yy = np.arange(H)[:, None]
    growable = raw & (
        (yy < int(geom["neckY"]) + 2)
        | ~np.isin(labels, [SKIN, NECK])
    )
    grown = np.array(
        Image.fromarray((growable * 255).astype(np.uint8)).filter(
            ImageFilter.MaxFilter(9)
        )
    ) > 0
    removal = raw | grown

    cx = int(round(geom["neckCx"]))
    half = max(int(round(geom["neckW"] * 0.78)), 16)
    xx = np.arange(W)[None, :]
    guard = (
        (yy >= int(geom["neckY"]))
        & (xx >= cx - half)
        & (xx <= cx + half)
    )
    removal[guard] = raw[guard]
    keep = (
        body_alpha.astype(np.int32)
        * (~removal).astype(np.int32)
    ).astype(np.uint8)
    return Image.fromarray(keep)


def collar_metrics(
    photo: Image.Image, geom: dict, labels: np.ndarray
) -> dict:
    source = np.array(photo.getchannel("A")) > 128
    exposed = np.isin(labels, [SKIN, NECK]) & source
    neck_y = int(geom["neckY"])
    widths: list[int] = []
    for row in exposed[neck_y:]:
        xs = np.flatnonzero(row)
        widths.append(int(xs[-1] - xs[0] + 1) if xs.size else 0)
    nonzero = np.flatnonzero(np.array(widths) > 0)
    depth = int(nonzero[-1] + 1) if nonzero.size else 0
    width = max(widths[: max(depth, 1)], default=0)
    return {
        "collarW": width,
        "collarDepth": depth,
        "collarScore": round(width / W + depth / H, 4),
    }


def silhouette_score(path: Path, geom: dict) -> dict | None:
    alpha = (
        np.array(Image.open(path).convert("RGBA").getchannel("A")) > 128
    )
    band = alpha[min(int(geom["neckY"]) + 20, H) :]
    if band.sum() < 2000:
        return None
    cx = float(geom["neckCx"])
    xs = np.arange(W)
    left, right, widths = [], [], []
    for row in band:
        indices = xs[row]
        if indices.size < 8:
            continue
        left.append(cx - indices[0])
        right.append(indices[-1] - cx)
        widths.append(indices.size)
    if len(widths) < 30:
        return None
    left, right, widths = map(np.asarray, (left, right, widths))
    asymmetry = float(
        np.mean(np.abs(left - right)) / max(np.mean(left + right), 1)
    )
    changes = np.diff(widths.astype(np.float32))
    bump = float(-changes[changes < 0].sum() / max(widths.max(), 1))
    lean = float(abs(cx - W / 2) / (W / 2))
    score = asymmetry * 2.4 + bump * 0.85 + lean * 0.8
    return {
        "asym": round(asymmetry, 4),
        "bump": round(bump, 4),
        "lean": round(lean, 4),
        "silhouetteScore": round(score, 4),
    }


def grey_head(alpha: Image.Image) -> Image.Image:
    a = np.array(alpha).astype(np.float32) / 255.0
    solid = a > 0.5
    ambient = np.array(
        Image.fromarray((solid * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(26)
        )
    ).astype(np.float32) / 255.0
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    top_light = np.clip(1.15 - y * 1.35, 0, 1)
    base = np.array([104, 111, 122], np.float32)
    rim = np.array([150, 158, 170], np.float32)
    shade = np.clip(0.55 + 0.60 * ambient, 0, 1.25)
    rgb = (
        base[None, None, :] * shade[..., None]
        + rim[None, None, :] * (top_light * ambient * 0.32)[..., None]
    )
    return Image.fromarray(
        np.dstack(
            [np.clip(rgb, 0, 255).astype(np.uint8), (a * 255).astype(np.uint8)]
        ),
        "RGBA",
    )


# One real donor, shared by every no-photo org — the exact same treatment as
# the grey heads: a real garment, desaturated, not a drawn shape. A previous
# version picked a DIFFERENT real donor per org and only stripped its colour,
# which still read as "that team's kit, recoloured." Reusing one fixed donor
# for everyone removes that: no org's neutral kit is any other org's actual
# jersey. GREY_DONORS already vets this exact photo as clean and reliable.
NEUTRAL_JERSEY_DONOR = GREY_DONORS[3]  # "boaster" — narrow, clean-pose plate


def grey_jersey_template(parser: "FaceParser") -> Image.Image:
    """boaster's real jersey, head and neck removed, colour stripped.

    Reuses the same plate-building path as a real per-org kit — geometry,
    semantic parse, hair-flood cleanup — so it inherits every fix that applies
    there. The only extra step is greying it out afterward, the same
    grayscale-and-colorize treatment grey_head() applies to a real head.
    """
    source = PLAYERS_DIR / f"{NEUTRAL_JERSEY_DONOR}.png"
    photo = Image.open(source).convert("RGBA")
    geom = photo_geometry(source)
    labels = parser.parse_head(photo, geom)
    kit = masked(photo, plate_keep_alpha(photo, geom, labels))

    alpha = kit.getchannel("A")
    grey = ImageOps.autocontrast(ImageOps.grayscale(kit.convert("RGB")), cutoff=2)
    neutral = ImageOps.colorize(
        grey, black=(38, 42, 49), mid=(92, 98, 108), white=(168, 174, 184)
    ).convert("RGBA")
    neutral.putalpha(alpha)

    # Suppress the donor's own sponsor print while keeping real folds and
    # light — a shared donor is still a real, printed jersey underneath, and a
    # grey Fnatic wordmark is still recognisably a Fnatic wordmark. Blur the
    # WHOLE garment (the kit's own alpha as the mask), not just a chest patch:
    # boaster's print reaches the collar and both sleeves, past where a
    # narrow central rectangle would ever reach. A blur this size erases fine
    # print detail while leaving the coarse, large-scale fold shading that
    # makes it read as real fabric rather than a flat fill — the same
    # principle grey_head() uses for a face.
    rgb = neutral.convert("RGB")
    blurred = rgb.filter(ImageFilter.GaussianBlur(22))
    mask = alpha
    rgb.paste(blurred, (0, 0), mask)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def stable_grey_index(player_id: str) -> int:
    digest = hashlib.sha1(str(player_id).encode("utf-8")).hexdigest()
    return int(digest, 16) % 5


def load_input(args: argparse.Namespace) -> list[dict]:
    if args.manifest:
        data = json.loads(Path(args.manifest).read_text())
        return data.get("players", data)
    cards = json.loads(Path(args.cards).read_text())
    players = []
    for card in cards:
        photo = card.get("photo")
        hand_art = bool(
            photo
            and any(
                token in photo
                for token in ("gold-img-", "silver-img-", "prestige-")
            )
        )
        players.append(
            {
                "playerId": card["id"],
                "slug": slug(card.get("player", card["id"])),
                "player": card.get("player", card["id"]),
                "org": card.get("org", ""),
                "orgLogo": card.get("org_logo", ""),
                "league": card.get("league", ""),
                "photo": photo,
                "noKitSwap": bool(card.get("noKitSwap") or hand_art),
            }
        )
    return players


def unique_output_slug(
    base: str, player_id: str, claimed: dict[str, str]
) -> str:
    if base not in claimed or claimed[base] == player_id:
        claimed[base] = player_id
        return base
    candidate = f"{base}-{slug(player_id)[-8:]}"
    claimed[candidate] = player_id
    return candidate


def font(size: int = 18) -> ImageFont.ImageFont:
    paths = (
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    for path in paths:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def contact_sheet(
    rows: list[tuple[str, Image.Image, str]], output: Path
) -> None:
    if not rows:
        return
    cell_w, cell_h, label_h, gap, columns = 200, 206, 42, 8, 5
    row_count = math.ceil(len(rows) / columns)
    sheet = Image.new(
        "RGB",
        (
            gap + columns * (cell_w + gap),
            gap + row_count * (cell_h + label_h + gap),
        ),
        (20, 23, 30),
    )
    draw = ImageDraw.Draw(sheet)
    title_font, meta_font = font(16), font(12)
    for index, (title, image, meta) in enumerate(rows):
        x = gap + (index % columns) * (cell_w + gap)
        y = gap + (index // columns) * (cell_h + label_h + gap)
        # Composite RGBA first. Converting directly to RGB preserves the hidden
        # donor pixels under alpha=0 and makes a correctly cut plate look whole.
        preview = Image.new("RGBA", image.size, (8, 10, 14, 255))
        preview.alpha_composite(image)
        thumb = preview.convert("RGB").resize(
            (cell_w, cell_h), Image.Resampling.LANCZOS
        )
        sheet.paste(thumb, (x, y + label_h))
        draw.text((x + 4, y + 3), title, fill=(245, 247, 250), font=title_font)
        draw.text((x + 4, y + 22), meta, fill=(155, 165, 180), font=meta_font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def build(args: argparse.Namespace) -> int:
    players = load_input(args)
    if args.limit:
        players = players[: args.limit]

    for directory in (
        HEADS_DIR,
        HAIR_DIR,
        KITS_DIR,
        DATA_DIR,
        CACHE_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    eligible = [
        player
        for player in players
        if not player.get("noKitSwap")
        and player.get("league") != "icon"
        and player.get("org")
    ]
    real = []
    for player in eligible:
        source = asset_file(player.get("photo"))
        if (
            player.get("photo") != PLACEHOLDER
            and source is not None
            and source.exists()
        ):
            real.append(player)
    print(
        f"Portrait build: {len(players)} cards, {len(real)} real sources, "
        f"{len(eligible) - len(real)} grey-head cards",
        flush=True,
    )

    parser = FaceParser(ensure_model(Path(args.model) if args.model else MODEL_PATH))
    old_heads = {}
    heads_path = DATA_DIR / "heads.json"
    if heads_path.exists():
        old_heads = json.loads(heads_path.read_text())
    old_kits = {}
    kits_path = DATA_DIR / "kits.json"
    if kits_path.exists():
        old_kits = json.loads(kits_path.read_text())

    head_records: dict[str, dict] = {}
    candidate_records: dict[str, dict] = {}
    player_cache: dict[str, tuple[Path, dict, dict]] = {}
    flagged: list[dict] = []
    claimed: dict[str, str] = {}

    for index, player in enumerate(real, 1):
        player_id = str(player["playerId"])
        source = asset_file(player["photo"])
        if source is None or not source.exists():
            continue
        out_slug = unique_output_slug(
            slug(player.get("slug") or player.get("player")), player_id, claimed
        )
        head_path = HEADS_DIR / f"{out_slug}.png"
        hair_path = HAIR_DIR / f"{out_slug}.png"
        previous = old_heads.get(player_id, {})
        geom = photo_geometry(source)
        if not geom:
            flagged.append(
                {"type": "head_geometry", "playerId": player_id, "source": str(source)}
            )
            continue

        if head_path.exists():
            render_geom = previous.get("headGeom")
            if not render_geom:
                render_geom = geometry_from_alpha(
                    np.array(Image.open(head_path).convert("RGBA").getchannel("A"))
                )
            if not render_geom:
                flagged.append(
                    {
                        "type": "existing_head_missing_geometry",
                        "playerId": player_id,
                        "head": str(head_path),
                    }
                )
                continue
            hair_asset = (
                f"/assets/hair/{out_slug}.png" if hair_path.exists() else None
            )
            head_records[player_id] = {
                "head": f"/assets/heads/{out_slug}.png",
                "hair": hair_asset,
                "headGeom": {
                    key: render_geom[key] for key in ("neckY", "neckCx", "neckW")
                },
                "hasRealHead": True,
            }
            # Existing heads are hand-made overrides, but the source portrait
            # is still eligible to donate its org's kit. Parse it for plate
            # scoring without touching the preserved head file.
            photo = Image.open(source).convert("RGBA")
            labels = parser.parse_head(photo, geom)
            silhouette = silhouette_score(source, geom) or {
                "silhouetteScore": 99.0,
                "asym": 1.0,
                "bump": 1.0,
                "lean": 1.0,
            }
            collar = collar_metrics(photo, geom, labels)
            candidate_records[player_id] = {
                **silhouette,
                **collar,
                "plateScore": round(
                    silhouette["silhouetteScore"]
                    + collar["collarScore"] * 1.2,
                    4,
                ),
            }
            player_cache[player_id] = (
                source,
                geom,
                candidate_records[player_id],
            )
            print(f"[{index}/{len(real)}] keep head {out_slug}", flush=True)
            continue

        photo = Image.open(source).convert("RGBA")
        labels = parser.parse_head(photo, geom)
        alpha = head_alpha(photo, labels)
        head, hair, render_geom = prepare_head(photo, geom, labels, alpha)
        head.save(head_path, optimize=True)
        if hair is not None:
            hair.save(hair_path, optimize=True)
        head_records[player_id] = {
            "head": f"/assets/heads/{out_slug}.png",
            "hair": f"/assets/hair/{out_slug}.png" if hair else None,
            "headGeom": {
                key: render_geom[key] for key in ("neckY", "neckCx", "neckW")
            },
            "hasRealHead": True,
        }

        silhouette = silhouette_score(source, geom) or {
            "silhouetteScore": 99.0,
            "asym": 1.0,
            "bump": 1.0,
            "lean": 1.0,
        }
        collar = collar_metrics(photo, geom, labels)
        total = silhouette["silhouetteScore"] + collar["collarScore"] * 1.2
        candidate_records[player_id] = {
            **silhouette,
            **collar,
            "plateScore": round(total, 4),
        }
        player_cache[player_id] = (source, geom, candidate_records[player_id])
        print(f"[{index}/{len(real)}] head {out_slug}", flush=True)

    # Five stable anonymous variants.
    grey_records: list[dict] = []
    for variant, donor in enumerate(GREY_DONORS):
        out = HEADS_DIR / f"grey-{variant}.png"
        previous = old_heads.get(f"grey-{variant}", {})
        if out.exists() and previous.get("headGeom"):
            record = previous
        else:
            source = PLAYERS_DIR / f"{donor}.png"
            geom = photo_geometry(source)
            if not geom:
                raise RuntimeError(f"grey-head donor has no geometry: {source}")
            photo = Image.open(source).convert("RGBA")
            labels = parser.parse_head(photo, geom)
            alpha = head_alpha(photo, labels)
            grey = grey_head(alpha)
            prepared, _hair, render_geom = prepare_head(
                grey, geom, labels, alpha
            )
            if not out.exists():
                prepared.save(out, optimize=True)
            record = {
                "head": f"/assets/heads/grey-{variant}.png",
                "hair": None,
                "headGeom": {
                    key: render_geom[key] for key in ("neckY", "neckCx", "neckW")
                },
                "hasRealHead": False,
            }
        head_records[f"grey-{variant}"] = record
        grey_records.append(record)

    for player in eligible:
        player_id = str(player["playerId"])
        if player_id in head_records:
            continue
        variant = stable_grey_index(player_id)
        head_records[player_id] = {
            **grey_records[variant],
            "greyVariant": variant,
        }

    groups: dict[str, list[dict]] = defaultdict(list)
    for player in real:
        groups[player["org"]].append(player)
    all_real_candidates = [
        player
        for player in real
        if str(player["playerId"]) in candidate_records
    ]
    plate_overrides = {}
    if args.manifest:
        manifest_data = json.loads(Path(args.manifest).read_text())
        plate_overrides = manifest_data.get("plateOverrides", {})
    for override in args.plate_override:
        if "=" not in override:
            raise ValueError(
                f"invalid --plate-override {override!r}; expected ORG=player"
            )
        org, player = override.split("=", 1)
        plate_overrides[org] = player

    kit_records: dict[str, dict] = {}
    review_rows: list[tuple[str, Image.Image, str]] = []
    selected_real_kits: list[tuple[str, Image.Image, dict]] = []

    for org in sorted({player["org"] for player in eligible}):
        kit_slug = slug(org)
        kit_path = KITS_DIR / f"{kit_slug}.png"
        previous = old_kits.get(org)
        # A neutral-tagged record isn't a resolved real kit — it's an org with
        # no photo wearing the shared placeholder. Always fall through so the
        # dedicated neutral-kit handling below can decide freshly whether that
        # placeholder itself needs regenerating, instead of this generic
        # shortcut freezing whatever was there (real donor OR stale
        # placeholder) as permanently "done."
        if kit_path.exists() and previous and not previous.get("neutral"):
            kit_records[org] = previous
            selected_real_kits.append(
                (org, Image.open(kit_path).convert("RGBA"), previous)
            )
            continue

        candidates = [
            player
            for player in groups.get(org, [])
            if str(player["playerId"]) in candidate_records
        ]
        override = str(plate_overrides.get(org, "")).lower()
        selected = next(
            (
                player
                for player in candidates
                if override
                and (
                    str(player["playerId"]) == override
                    or slug(player.get("player", "")) == slug(override)
                )
            ),
            None,
        )
        if selected is None and candidates:
            selected = min(
                candidates,
                key=lambda player: candidate_records[str(player["playerId"])][
                    "plateScore"
                ],
            )
        if selected is None:
            continue

        player_id = str(selected["playerId"])
        source = asset_file(selected["photo"])
        if source is None:
            continue
        geom = photo_geometry(source)
        photo = Image.open(source).convert("RGBA")
        labels = parser.parse_head(photo, geom)
        keep = plate_keep_alpha(photo, geom, labels)
        kit = masked(photo, keep)
        if not kit_path.exists():
            kit.save(kit_path, optimize=True)
        metrics = candidate_records[player_id]
        record = {
            "plate": f"/assets/kits/{kit_slug}.png",
            "collarY": int(geom["neckY"]),
            "neckY": int(geom["neckY"]),
            "neckCx": geom["neckCx"],
            "neckW": int(geom["neckW"]),
            "donor": selected.get("player"),
            "donorId": player_id,
        }
        kit_records[org] = record
        selected_real_kits.append((org, kit, record))
        review_rows.append(
            (
                org,
                kit,
                f"{selected.get('player')} score {metrics['plateScore']:.3f}",
            )
        )
        if (
            metrics["plateScore"] > 0.65
            or metrics["collarScore"] > 0.43
            or metrics["asym"] > 0.18
        ):
            flagged.append(
                {
                    "type": "plate_review",
                    "org": org,
                    "player": selected.get("player"),
                    "playerId": player_id,
                    **metrics,
                }
            )

    # Orgs with no source photo share ONE real jersey, greyed out — the same
    # treatment the grey heads get, not a drawn shape and not a per-org
    # borrowed kit. Every no-photo org points at the identical file.
    missing_orgs = sorted(
        {player["org"] for player in eligible} - set(kit_records)
    )
    if missing_orgs:
        neutral_path = KITS_DIR / "_neutral.png"
        previous_neutral = old_kits.get(missing_orgs[0])
        # Anything from the old per-org approach (a drawn shape, or a
        # desaturated real donor unique to that org) is stale and gets
        # replaced. A file with no matching record at all is left untouched,
        # same as every other output this script writes: an existing file
        # with nothing pointing at it as ours is a hand-made override.
        stale = bool(previous_neutral) and previous_neutral.get("plate") != f"/assets/kits/{neutral_path.name}"
        if not neutral_path.exists() or stale:
            grey_jersey_template(parser).save(neutral_path, optimize=True)
            for org in missing_orgs:
                stale_file = KITS_DIR / f"{slug(org)}.png"
                if stale_file != neutral_path and stale_file.exists():
                    stale_file.unlink()

        donor_geom = photo_geometry(PLAYERS_DIR / f"{NEUTRAL_JERSEY_DONOR}.png")
        neutral_record = {
            "collarY": int(donor_geom["neckY"]),
            "neckY": int(donor_geom["neckY"]),
            "neckCx": donor_geom["neckCx"],
            "neckW": int(donor_geom["neckW"]),
            "plate": f"/assets/kits/{neutral_path.name}",
            "neutral": True,
        }
        for org in missing_orgs:
            kit_records[org] = neutral_record
        review_rows.append(
            (missing_orgs[0], Image.open(neutral_path).convert("RGBA"),
             f"shared neutral kit ({len(missing_orgs)} orgs)")
        )

    heads_path.write_text(json.dumps(head_records, indent=2) + "\n")
    kits_path.write_text(json.dumps(kit_records, indent=2) + "\n")
    if args.cards:
        cards_path = Path(args.cards)
        cards = json.loads(cards_path.read_text())
        for card in cards:
            photo = card.get("photo") or ""
            if any(
                token in photo
                for token in ("gold-img-", "silver-img-", "prestige-")
            ):
                # The standalone build does not have VLR player IDs, so carry
                # the same hand-art protection inferred by load_input().
                card["noKitSwap"] = True
            record = head_records.get(str(card.get("id")))
            if not record:
                continue
            card["head"] = record["head"]
            card["headGeom"] = record["headGeom"]
            if record.get("hair"):
                card["hair"] = record["hair"]
            else:
                card.pop("hair", None)
        cards_path.write_text(json.dumps(cards, indent=2) + "\n")
    flagged_path = CACHE_DIR / "flagged.json"
    flagged_path.write_text(json.dumps(flagged, indent=2) + "\n")
    contact_sheet(review_rows, CACHE_DIR / "review-contact-sheet.png")
    print(
        f"Wrote {len(head_records)} head records, {len(kit_records)} kits, "
        f"{len(flagged)} flags",
        flush=True,
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest")
    source.add_argument("--cards")
    parser.add_argument("--model")
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--plate-override",
        action="append",
        default=[],
        metavar="ORG=PLAYER",
        help="review-time donor override; may be repeated",
    )
    return parser.parse_args()


if __name__ == "__main__":
    try:
        raise SystemExit(build(parse_args()))
    except KeyboardInterrupt:
        print("portrait build interrupted", file=sys.stderr)
        raise SystemExit(130)
