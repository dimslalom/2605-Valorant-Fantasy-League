"""Turn raw vlr.gg avatars into 400x412 transparent card cutouts.

Reads scripts/.cache/avatars/manifest.json ({playerId: outputFilename})
written by vlr-to-json.js, removes the background with rembg, trims the
transparent border, and places the cutout bottom-anchored and horizontally
centered on a 400x412 transparent canvas — matching the hand-made card art.

Outputs go to public/assets/players/. Existing files are never overwritten,
so manual art is safe.

Usage:
    python3 scripts/process_avatars.py            (or via npm run sync-vlr)

Requires:
    pip3 install -r scripts/requirements.txt
"""

import json
import sys
from pathlib import Path

CANVAS_W, CANVAS_H = 400, 412
SUBJECT_DROP_PX = 100  # push the bottom-anchored cutout down, clipping at 412px

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = SCRIPT_DIR / ".cache" / "avatars"
OUT_DIR = SCRIPT_DIR.parent / "public" / "assets" / "players"


def _looks_like_placeholder(cutout) -> bool:
    """vlr.gg sometimes serves a generic grey silhouette as a player's
    "photo" instead of a real one, under a normal-looking owcdn.net URL —
    so it isn't caught by the /base/ph/ URL filter. A real photo has
    meaningfully varied color across skin/hair/jersey; a flat silhouette
    doesn't, so sample the opaque region and check the spread."""
    px = cutout.load()
    w, h = cutout.size
    step = max(1, min(w, h) // 40)
    samples = [
        px[x, y][:3]
        for y in range(0, h, step)
        for x in range(0, w, step)
        if px[x, y][3] > 128
    ]
    if len(samples) < 20:
        return True
    n = len(samples)
    mean = [sum(s[c] for s in samples) / n for c in range(3)]
    variance = sum(sum((s[c] - mean[c]) ** 2 for c in range(3)) for s in samples) / n
    return variance ** 0.5 < 12


def golden_duotone(cutout):
    """Icon-tier portrait treatment: grayscale mapped onto a gold ramp
    (near-black shadows, warm golden highlights), alpha preserved."""
    from PIL import ImageOps
    alpha = cutout.getchannel("A")
    gray = ImageOps.autocontrast(cutout.convert("L"), cutoff=1)
    duo = ImageOps.colorize(
        gray,
        black=(20, 16, 10),
        mid=(122, 96, 52),
        white=(232, 202, 124),
    )
    duo = duo.convert("RGBA")
    duo.putalpha(alpha)
    return duo


def main() -> int:
    try:
        from PIL import Image
        from rembg import remove, new_session
    except ImportError as err:
        print(f"missing dependency: {err.name} — run: pip3 install -r scripts/requirements.txt")
        return 1

    manifest_path = CACHE_DIR / "manifest.json"
    if not manifest_path.exists():
        print(f"no manifest at {manifest_path} — run `npm run sync-vlr` first")
        return 1

    # values are either "file.png" or {"file": "...", "style": "icon"}
    manifest: dict = json.loads(manifest_path.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # One shared session so the U2-Net model loads once for the whole batch
    session = new_session("u2net")

    done = skipped = failed = placeholder = 0
    for player_id, entry in manifest.items():
        if isinstance(entry, str):
            out_name, style = entry, None
        else:
            out_name, style = entry["file"], entry.get("style")
        raw = CACHE_DIR / f"{player_id}.png"
        out = OUT_DIR / out_name
        if out.exists():
            skipped += 1
            continue
        if not raw.exists():
            print(f"  ! missing raw avatar for {player_id} ({out_name})")
            failed += 1
            continue

        try:
            with Image.open(raw) as img:
                img = img.convert("RGBA")
                # Some vlr.gg avatars already carry an alpha channel whose
                # fully/partially-transparent pixels hold leftover chroma-key
                # color (e.g. bright blue) instead of being zeroed out.
                # rembg reads raw RGB regardless of input alpha, so that
                # leftover color bleeds into the segmentation and produces a
                # tinted cutout with holes. Flattening onto opaque white
                # first removes the contamination before rembg ever sees it.
                flat = Image.new("RGBA", img.size, (255, 255, 255, 255))
                flat.alpha_composite(img)
                cutout = remove(flat.convert("RGB"), session=session)

            bbox = cutout.getbbox()
            if not bbox:
                print(f"  ! empty cutout for {out_name}")
                failed += 1
                continue
            cutout = cutout.crop(bbox)

            if _looks_like_placeholder(cutout):
                print(f"  ! {out_name}: source avatar looks like a generic silhouette placeholder, skipping")
                placeholder += 1
                continue

            if style == "icon":
                cutout = golden_duotone(cutout)

            scale = min(CANVAS_W / cutout.width, CANVAS_H / cutout.height)
            new_size = (round(cutout.width * scale), round(cutout.height * scale))
            cutout = cutout.resize(new_size, Image.LANCZOS)

            # Bottom-anchor, then push down by SUBJECT_DROP_PX so the card
            # frames the subject the same way the hand-made art does — the
            # feet/torso that fall below the canvas are simply clipped by
            # paste() rather than shrinking the whole cutout to fit.
            canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
            x = (CANVAS_W - cutout.width) // 2
            y = CANVAS_H - cutout.height + SUBJECT_DROP_PX
            canvas.paste(cutout, (x, y))
            canvas.save(out)
            done += 1
            print(f"  + {out_name}")
        except Exception as err:  # noqa: BLE001 — one bad image must not kill the batch
            print(f"  ! {out_name}: {err}")
            failed += 1

    print(f"processed {done}, skipped {skipped} existing, {placeholder} placeholder-like, failed {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
