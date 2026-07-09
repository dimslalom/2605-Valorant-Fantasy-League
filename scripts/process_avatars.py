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

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = SCRIPT_DIR / ".cache" / "avatars"
OUT_DIR = SCRIPT_DIR.parent / "public" / "assets" / "players"


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

    manifest: dict[str, str] = json.loads(manifest_path.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # One shared session so the U2-Net model loads once for the whole batch
    session = new_session("u2net")

    done = skipped = failed = 0
    for player_id, out_name in manifest.items():
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
                cutout = remove(img.convert("RGBA"), session=session)

            bbox = cutout.getbbox()
            if not bbox:
                print(f"  ! empty cutout for {out_name}")
                failed += 1
                continue
            cutout = cutout.crop(bbox)

            scale = min(CANVAS_W / cutout.width, CANVAS_H / cutout.height)
            new_size = (round(cutout.width * scale), round(cutout.height * scale))
            cutout = cutout.resize(new_size, Image.LANCZOS)

            canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
            canvas.paste(cutout, ((CANVAS_W - cutout.width) // 2, CANVAS_H - cutout.height))
            canvas.save(out)
            done += 1
            print(f"  + {out_name}")
        except Exception as err:  # noqa: BLE001 — one bad image must not kill the batch
            print(f"  ! {out_name}: {err}")
            failed += 1

    print(f"processed {done}, skipped {skipped} existing, failed {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
