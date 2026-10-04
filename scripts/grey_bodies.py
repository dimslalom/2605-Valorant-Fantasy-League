"""Pre-composite the 5 grey placeholder heads onto the neutral grey jersey.

Small list rows show one flat image per player (thumbnailSrc in src/lib/utils.js), so the
head + jersey layering PlayerPortrait does for full cards is baked here instead. Same maths as
PlayerPortrait.jsx: scale the head toward the kit's neck width (clamped), line the necks up,
then draw the kit again over the neck from the collar down.

    python3 scripts/grey_bodies.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SCALE_MIN, SCALE_MAX = 0.88, 1.12  # keep in step with PlayerPortrait.jsx and build_portraits.py

kits = json.loads((ROOT / "src/data/kits.json").read_text())
cards = json.loads((ROOT / "src/data/cards.json").read_text())
kit = next(v for v in kits.values() if v.get("neutral"))
plate = Image.open(PUBLIC / kit["plate"].lstrip("/")).convert("RGBA")
heads = {c["head"]: c["headGeom"] for c in cards if c.get("head") and "/grey-" in c["head"]}

for src, geom in sorted(heads.items()):
    head = Image.open(PUBLIC / src.lstrip("/")).convert("RGBA")
    scale = min(max(kit["neckW"] / max(geom["neckW"], 1), SCALE_MIN), SCALE_MAX)
    w, h = round(head.width * scale), round(head.height * scale)
    dx = round(kit["neckCx"] - geom["neckCx"] * scale)
    dy = round(kit["neckY"] - geom["neckY"] * scale)

    out = Image.new("RGBA", plate.size)
    out.alpha_composite(plate)
    layer = Image.new("RGBA", plate.size)
    layer.alpha_composite(head.resize((w, h), Image.LANCZOS), (dx, dy)) if dx >= 0 and dy >= 0 else \
        layer.paste(head.resize((w, h), Image.LANCZOS), (dx, dy))
    out.alpha_composite(layer)
    front = plate.copy()
    front.paste((0, 0, 0, 0), (0, 0, plate.width, kit["collarY"]))
    out.alpha_composite(front)

    dest = PUBLIC / src.lstrip("/").replace(".png", "-body.png")
    out.save(dest, optimize=True)
    print(dest.relative_to(ROOT))
