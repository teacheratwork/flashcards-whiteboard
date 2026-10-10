# flashcards-whiteboard

Whiteboard app for building English sentences by dragging grammar flashcards, for
classroom use (teacher on the interactive whiteboard, students following along
independently on their own laptops/tablets via a shared URL).

Language note: this is a `dev/` subproject — code, comments and docs in English.
Conversation with the user stays Italian.

## What it is

Product name: **BB1 flashcards** (year 1); later years BB2, BB3… flashcards. Never "Sentence Cards".

A single self-contained `index.html` (vanilla HTML/CSS/JS, zero external requests),
published as a Claude Artifact and also openable from `file://`.

- Flashcards grouped by grammatical category, sourced from the teacher's PDF decks.
- Teacher picks a restricted working set → encoded in the URL → students open the
  same set. No backend; students are NOT synchronised (each works on their own board).
- Drawing layer: pen, highlighter, eraser (ink only).
- Random sentence generator (grammar levels 1–6, optional "silly" mode) and speech
  (browser speechSynthesis, en-GB voice) for single cards and the whole board.
- Union Jack flag in a corner: click toggles raised/lowered ("English only" cue).
  State is local to each device.

## Layout

```
tools/extract_cards.py   PDF decks -> per-card WebP in assets/cards/<category>/
tools/build.py           inline catalog + assets into a template -> dist/index.html
docs/generator.md        sentence generator rules + design choices (keep in sync with app.js)
src/                     app source (template, css, js)
assets/vocab.json        hand-edited English word + grammar tag per card (speech, generator)
catalog.json             category / id / file / type (picture|marker) + vocab fields
assets/cards/            generated card images
dist/index.html          final self-contained artifact (this is what gets published)
```

## Source decks

`~/Desktop/flashcards/*.pdf` (outside the workspace). Picture decks are rasterised
and sliced from their grid; the marker cards (coloured dots, "s", "+") are redrawn
in CSS and appear once each but can be reused any number of times.

## Hosting

**GitHub Pages** (chosen 2026-10-08, replacing the teacher's own website), GitHub
account `teacheratwork`: repo `teacheratwork/flashcards-whiteboard` (public), remote
`github`. `.github/workflows/pages.yml` publishes `dist/` at every push to `main`
(Settings → Pages → Source: "GitHub Actions").
URL: `https://teacheratwork.github.io/flashcards-whiteboard/`.
To update: edit `src/` or `assets/vocab.json`, run `python tools/build.py`, commit
(including `dist/`), push to both remotes.

## Git

Two remotes: `origin` = `forgejo:samuele/flashcards-whiteboard.git` (backup, private)
and `github` = `https://github.com/teacheratwork/flashcards-whiteboard.git` (publishing).
Push to both: `git push origin main` and `git push github main`. Commit messages in English.
