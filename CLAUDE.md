# flashcards-whiteboard

Whiteboard app for building English sentences by dragging grammar flashcards, for
classroom use (teacher on the interactive whiteboard, students following along
independently on their own laptops/tablets via a shared URL).

Language note: this is a `dev/` subproject — code, comments and docs in English.
Conversation with the user stays Italian.

## What it is

A single self-contained `index.html` (vanilla HTML/CSS/JS, zero external requests),
published as a Claude Artifact and also openable from `file://`.

- Flashcards grouped by grammatical category, sourced from the teacher's PDF decks.
- Teacher picks a restricted working set → encoded in the URL → students open the
  same set. No backend; students are NOT synchronised (each works on their own board).
- Drawing layer: pen, highlighter, eraser (ink only).
- Union Jack flag in a corner: click toggles raised/lowered ("English only" cue).
  State is local to each device.

## Layout

```
tools/extract_cards.py   PDF decks -> per-card WebP in assets/cards/<category>/
tools/build.py           inline catalog + assets into a template -> dist/index.html
src/                     app source (template, css, js)
catalog.json             category / id / file / type (picture|marker)
assets/cards/            generated card images
dist/index.html          final self-contained artifact (this is what gets published)
```

## Source decks

`~/Desktop/flashcards/*.pdf` (outside the workspace). Picture decks are rasterised
and sliced from their grid; the marker cards (coloured dots, "s", "+") are redrawn
in CSS and appear once each but can be reused any number of times.

## Status

See `../../_context` conventions. Git: local only for now, remote to be proposed later.
