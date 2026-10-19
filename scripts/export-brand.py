"""Rasterize the bear and the PWA icons.

The SVG in public/brand/bear.svg is the source. Run with
`python3 scripts/export-brand.py` after drawing changes. The PNGs and WebPs
are committed so the app does not need Cairo at build time.
"""

from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "public" / "brand" / "bear.svg"
BRAND = ROOT / "public" / "brand"
BURGUNDY = (110, 34, 54, 255)


def raster(size: int) -> Image.Image:
    png = cairosvg.svg2png(
        url=str(SVG),
        output_width=size,
        output_height=size,
    )
    return Image.open(__import__("io").BytesIO(png)).convert("RGBA")


def save_webp(image: Image.Image, path: Path) -> None:
    image.save(path, "WEBP", quality=82, method=6)


def icon(size: int, bear: Image.Image, pad_ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BURGUNDY)
    inner = int(size * (1 - pad_ratio * 2))
    scaled = bear.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(scaled, (offset, offset), scaled)
    return canvas.convert("RGB")


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    master = raster(512)
    master.save(BRAND / "bear-512.png", optimize=True)
    save_webp(master, BRAND / "bear-512.webp")
    for size in (256, 128, 64):
        scaled = master.resize((size, size), Image.Resampling.LANCZOS)
        scaled.save(BRAND / f"bear-{size}.png", optimize=True)
        save_webp(scaled, BRAND / f"bear-{size}.webp")

    full = raster(512)
    icons = {
        ROOT / "public" / "icons" / "icon-512.png": icon(512, full, 0.16),
        ROOT / "public" / "icons" / "icon-192.png": icon(192, full, 0.14),
        ROOT / "public" / "icons" / "apple-touch-icon.png": icon(180, full, 0.12),
        ROOT / "src" / "app" / "apple-icon.png": icon(180, full, 0.12),
        ROOT / "src" / "app" / "icon.png": icon(32, full, 0.08),
    }
    for path, image in icons.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, optimize=True)
        print(path.relative_to(ROOT), image.size)


if __name__ == "__main__":
    main()
