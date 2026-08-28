# Sentence Cards — classroom flashcard whiteboard

A single self-contained web page for building English sentences by dragging grammar
flashcards. Used by the teacher on the interactive whiteboard; students follow along
on their own laptops/tablets by opening a shared link (each works independently).

## Using it

- **Builder mode** (open the page with no `#s=` in the URL): the left palette shows
  every card grouped by category. Click cards to add them to the lesson set, then
  **Share to class** → show the QR (tablets) or copy the link into your class channel
  (laptops). Saved sets are remembered on that computer.
- **Board mode** (open a shared link): the palette shows only the teacher's chosen
  cards, flat. Drag them onto the board.
- Cards never run out — dragging one from the palette leaves it there.
- **Pen / Marker / Eraser** in the toolbar. The eraser only removes ink, not cards.
  `Undo` (Ctrl+Z), `Clear ink`, `Clear board`. Keys: `v` move, `p` pen, `h`
  highlighter, `e` eraser.
- **Union Jack** in the top-right corner: click to raise/lower it. Raised = English only.
- Delete a card: select it and press Delete, or tap the red ×, or double-click it.

## Rebuilding from the source decks

The card images are sliced from the teacher's PDFs (`~/Desktop/flashcards/`).

```
pip install pymupdf pillow
python tools/extract_cards.py     # PDFs -> assets/cards/<category>/*.webp  (+ contact sheets for QA)
python tools/build.py             # -> dist/index.html (standalone) and dist/artifact.html
```

`dist/index.html` opens directly in a browser. `dist/artifact.html` is the body-only
version used when publishing as a Claude Artifact.

To add a category later: drop a new deck in the PDF folder, add it to `PICTURE_DECKS`
in `tools/extract_cards.py` and to `CATS` in `tools/build.py`, re-run both scripts.

## Layout

| path | what |
|---|---|
| `src/index.template.html` | page markup + placeholders |
| `src/styles.css` | all styling |
| `src/app.js` | palette, board, ink layer, flag, share/QR, URL encoding |
| `src/qr.js` | dependency-free QR generator (byte mode) |
| `tools/extract_cards.py` | PDF → per-card WebP slicer |
| `tools/build.py` | inlines catalog + assets → `dist/` |
| `catalog.json` | generated card list (defines the URL bitmask order) |
