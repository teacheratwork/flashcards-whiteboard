"""Render every source PDF's pages to PNG so we can eyeball the card grid layout
before writing the real slicer. Output goes to tools/_debug/<deck>/page-NN.png.
"""
import sys
from pathlib import Path

import pymupdf  # PyMuPDF

SRC = Path.home() / "Desktop" / "flashcards"
OUT = Path(__file__).parent / "_debug"

DPI = 110


def main() -> int:
    if not SRC.is_dir():
        print(f"source folder not found: {SRC}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    zoom = DPI / 72
    mat = pymupdf.Matrix(zoom, zoom)
    for pdf in sorted(SRC.glob("*.pdf")):
        deck = OUT / pdf.stem
        deck.mkdir(parents=True, exist_ok=True)
        doc = pymupdf.open(pdf)
        print(f"{pdf.name}: {doc.page_count} page(s), "
              f"page size {doc[0].rect.width:.0f}x{doc[0].rect.height:.0f} pt")
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pix.save(deck / f"page-{i:02d}.png")
        doc.close()
    print(f"\nwrote debug renders to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
