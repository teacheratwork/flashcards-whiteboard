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
server/                  PHP host: login, accounts (admin.php), signed student links
tools/serve_local.py     run the PHP version locally (http://127.0.0.1:8080, test data in local-data/)
upload/flashcards/       built PHP site to upload by FTP (git-ignored: config.php has the setup code)
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

### Login-protected version (from 2026-10-13, not yet online)

For Open Minds: `upload/flashcards/` (built by `tools/build.py`) goes by FTP into a
folder of the publisher's own site. Plain PHP >= 7.4, no database, no WordPress
integration. Accounts are managed by the publisher on `admin.php` (email + password,
random or chosen, optional expiry, enable/disable, log). Teachers' «Segnala» reports are
saved there and mailed to `feedback_to` (the user's address; untested until on a real host). Teachers log in; the share
button asks the server for a signed student link (`?t=`) valid until midnight that
serves only the lesson's cards, no account needed. Data in `data/` on the server
(JSON behind `<?php exit; ?>`): never sync-delete it when re-uploading. Details and
the student-link format: README "Login-protected version". Tested locally with PHP
7.4 lint + 8.3 (portable zip in `~/tools/php-8.3/`). The GitHub repo/Pages are still
public: the user decides with the publisher.

## Git

Two remotes: `origin` = `forgejo:samuele/flashcards-whiteboard.git` (backup, private)
and `github` = `https://github.com/teacheratwork/flashcards-whiteboard.git` (publishing).
Push to both: `git push origin main` and `git push github main`. Commit messages in English.
