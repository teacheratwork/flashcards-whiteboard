"""Slice the picture decks in ~/Desktop/flashcards/*.pdf into one image per card.

Method: render each page, find horizontal card bands with a whitespace row
projection, then split each band into cards with a whitespace column projection
(real gutters -- so rows with 1, 2 or 3 cards all work), and tight-crop each card
to its ink bounding box. The coloured frame around each card is kept on purpose:
the colour encodes the part of speech.

Output: assets/cards/<category>/<category>-NN.webp  plus a contact sheet per deck
in tools/_debug/contact/<category>.png for visual QA.

The marker cards (coloured dots, "s", "+") are NOT extracted -- the app draws them
in CSS. This script only samples their fill colour into assets/markers.json.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from statistics import median

import pymupdf
from PIL import Image

SRC = Path.home() / "Desktop" / "flashcards"
ROOT = Path(__file__).parent.parent
OUT = ROOT / "assets" / "cards"
CONTACT = Path(__file__).parent / "_debug" / "contact"

RENDER_DPI = 220
MAX_EDGE = 380
WEBP_QUALITY = 82
INK = 245                    # grayscale < INK counts as ink
ROW_GAP_FRAC = 0.012        # empty-row run > this frac of page height -> band break
COL_GAP_FRAC = 0.085        # empty-col run > this frac of band height -> card break
MIN_INK_FRAC = 0.0025      # cell with less ink than this is blank
MIN_CARD_FRAC = 0.45       # segment narrower than this * median width -> merge
PAD_FRAC = 0.05

# deck stem -> category slug
PICTURE_DECKS = {
    "NOMI-PROPRI": "proper-nouns",
    "NOMI-COMUNI": "common-nouns",
    "VERBI": "verbs",
    "AGGETTIVI-1": "adjectives",
    "NUMERI": "numbers",
    "TEMPO": "time",
}

# marker stem -> key (dots + plus; the "s" is pure CSS, no colour to sample)
MARKER_DECKS = {
    "PALLINI-ROSSI": "dot-red",
    "PALLINI-arancioni-BORDO-ROSSO": "dot-orange",
    "PALLINI-VERDI": "dot-green",
    "PALLINI-BLU": "dot-blue",
    "PIù": "plus",
}


def render_page(page: pymupdf.Page) -> Image.Image:
    zoom = RENDER_DPI / 72
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def runs(counts: list[int], gap_min: int) -> list[tuple[int, int]]:
    """Split an index range into [start, end) segments, breaking on empty runs
    of length >= gap_min."""
    segs: list[tuple[int, int]] = []
    start = None
    gap = 0
    for i, c in enumerate(counts):
        if c > 0:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= gap_min:
                segs.append((start, i - gap + 1))
                start = None
                gap = 0
    if start is not None:
        segs.append((start, len(counts)))
    return segs


def row_ink(gray: Image.Image) -> list[int]:
    w, h = gray.size
    px = gray.load()
    return [sum(1 for x in range(0, w, 2) if px[x, y] < INK) for y in range(h)]


def col_ink(gray: Image.Image, y0: int, y1: int) -> list[int]:
    w, _ = gray.size
    px = gray.load()
    return [sum(1 for y in range(y0, y1, 2) if px[x, y] < INK) for x in range(w)]


def merge_thin(segs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge segments much narrower than the median into a neighbour (bridges
    accidental splits inside multi-picture cards)."""
    if len(segs) < 2:
        return segs
    widths = [b - a for a, b in segs]
    med = median(widths)
    out = list(segs)
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, (a, b) in enumerate(out):
            if (b - a) >= MIN_CARD_FRAC * med:
                continue
            # merge with nearer neighbour
            if i == 0:
                out[i + 1] = (a, out[i + 1][1])
                out.pop(i)
            elif i == len(out) - 1:
                out[i - 1] = (out[i - 1][0], b)
                out.pop(i)
            else:
                gl = a - out[i - 1][1]
                gr = out[i + 1][0] - b
                if gl <= gr:
                    out[i - 1] = (out[i - 1][0], b)
                else:
                    out[i + 1] = (a, out[i + 1][1])
                out.pop(i)
            changed = True
            break
    return out


def content_bbox(gray: Image.Image, box):
    l, t, r, b = box
    region = gray.crop(box)
    w, h = region.size
    px = region.load()
    ink = 0
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y] < INK:
                ink += 1
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    if maxx < 0 or ink / (w * h) < MIN_INK_FRAC:
        return None
    return (l + minx, t + miny, l + maxx + 1, t + maxy + 1)


def crop_card(img: Image.Image, gray: Image.Image, cell):
    bbox = content_bbox(gray, cell)
    if bbox is None:
        return None
    cw, ch = cell[2] - cell[0], cell[3] - cell[1]
    pad = int(min(cw, ch) * PAD_FRAC)
    l = max(cell[0], bbox[0] - pad)
    t = max(cell[1], bbox[1] - pad)
    r = min(cell[2], bbox[2] + pad)
    b = min(cell[3], bbox[3] + pad)
    card = img.crop((l, t, r, b))
    card.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    return card


def extract_deck(pdf: Path, slug: str) -> list[Path]:
    doc = pymupdf.open(pdf)
    dest = OUT / slug
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.webp"):
        old.unlink()
    saved: list[Path] = []
    idx = 0
    for page in doc:
        img = render_page(page)
        gray = img.convert("L")
        w, h = img.size
        row_gap = max(4, int(h * ROW_GAP_FRAC))
        for (y0, y1) in runs(row_ink(gray), row_gap):
            band_h = y1 - y0
            col_gap = max(6, int(band_h * COL_GAP_FRAC))
            segs = runs(col_ink(gray, y0, y1), col_gap)
            segs = [(a, b) for a, b in segs if (b - a) > band_h * 0.12]
            segs = merge_thin(segs)
            for (x0, x1) in segs:
                card = crop_card(img, gray, (x0, y0, x1, y1))
                if card is None:
                    continue
                idx += 1
                p = dest / f"{slug}-{idx:02d}.webp"
                card.save(p, "WEBP", quality=WEBP_QUALITY, method=6)
                saved.append(p)
    doc.close()
    return saved


def contact_sheet(slug: str, files: list[Path]) -> None:
    if not files:
        return
    CONTACT.mkdir(parents=True, exist_ok=True)
    cell, cols = 210, 6
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        th = Image.open(f).convert("RGB")
        th.thumbnail((cell - 16, cell - 34), Image.LANCZOS)
        ox = (i % cols) * cell + (cell - th.width) // 2
        oy = (i // cols) * cell + 6
        sheet.paste(th, (ox, oy))
        d.text(((i % cols) * cell + 6, (i // cols) * cell + cell - 18),
               f.stem, fill="red")
    sheet.save(CONTACT / f"{slug}.png")


def sample_marker_colours() -> dict:
    out = {}
    for stem, key in MARKER_DECKS.items():
        pdf = SRC / f"{stem}.pdf"
        if not pdf.exists():
            continue
        doc = pymupdf.open(pdf)
        img = render_page(doc[0]).convert("RGB")
        doc.close()
        px = img.load()
        w, h = img.size
        hist: Counter = Counter()
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                r, g, b = px[x, y]
                if min(r, g, b) > 240:            # white-ish
                    continue
                if max(r, g, b) - min(r, g, b) < 25 and max(r, g, b) < 90:
                    continue                       # near-black outline
                hist[(r // 12 * 12, g // 12 * 12, b // 12 * 12)] += 1
        if hist:
            r, g, b = hist.most_common(1)[0][0]
            out[key] = f"#{min(r+6,255):02x}{min(g+6,255):02x}{min(b+6,255):02x}"
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for stem, slug in PICTURE_DECKS.items():
        pdf = SRC / f"{stem}.pdf"
        if not pdf.exists():
            print(f"  SKIP {stem}: not found")
            continue
        files = extract_deck(pdf, slug)
        contact_sheet(slug, files)
        manifest[slug] = [f.name for f in files]
        kb = sum(f.stat().st_size for f in files) / 1024
        print(f"  {slug:14s} {len(files):3d} cards  {kb:7.0f} KB")

    markers = sample_marker_colours()
    (ROOT / "assets" / "markers.json").write_text(
        json.dumps(markers, indent=2), encoding="utf-8")
    print("  markers:", markers)
    (CONTACT / "_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\ncontact sheets in {CONTACT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
