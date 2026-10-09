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
- **🎲 Sentence** puts a random sentence on the board (it replaces the previous
  generated one; hand-placed cards and ink stay). **Level 1–6** sets the grammar:
  1 `the/a + noun + verb-s` · 2 + plurals, possessives · 3 + adjective ·
  4 + green dot (`is`, `let's`) · 5 + numbers, `+` · 6 + blue preposition + place.
  Every sentence has exactly the chosen level's structure (easier features may appear
  inside it). **🤪 Silly** allows any noun as the subject and any verb. With a shared
  lesson set, only the set's cards are used — markers (dots, `s`, `+`) included; if
  they can't make a sentence of that level, a message suggests the levels that work.
  Sometimes a time phrase is added at the end (`every day` from level 3, `in winter` /
  `at Christmas` from level 6). All the rules and why: [docs/generator.md](docs/generator.md).
- **🔊 Read** speaks the board (rows top→bottom, left→right; an `s` on a card makes it
  plural / 3rd person). A selected card shows 🔊 to hear just that card; in board mode
  tapping a palette card speaks it. A selected dot shows its word under it (the → a,
  my → your…): tap the word to change it. British voice when the device has one.

## Words and grammar tags

`assets/vocab.json` holds the English word for every card and the tags the generator
uses (animate / place / thing nouns, verbs with or without an object, weather
adjectives). Entries marked `"check": true` came from an ambiguous picture. Edit the
file and re-run `python tools/build.py`.

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
| `src/app.js` | palette, board, ink layer, flag, share/QR, URL encoding, speech, sentence generator |
| `assets/vocab.json` | hand-edited words + grammar tags per card |
| `src/qr.js` | dependency-free QR generator (byte mode) |
| `tools/extract_cards.py` | PDF → per-card WebP slicer |
| `tools/build.py` | inlines catalog + assets → `dist/` |
| `catalog.json` | generated card list (defines the URL bitmask order) |
