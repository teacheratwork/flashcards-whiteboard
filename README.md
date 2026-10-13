# BB1 flashcards — classroom flashcard whiteboard

A single self-contained web page for building English sentences by dragging grammar
flashcards. Used by the teacher on the interactive whiteboard; students follow along
on their own laptops/tablets by opening a shared link (each works independently).

## Using it

- **Builder mode** (open the page with no `#s=` in the URL): the left palette shows
  every card grouped by category. Click cards to add them to the lesson set, then
  **Share to class** → show the QR (tablets) or copy the link into your class channel
  (laptops). Saved sets are remembered on that computer, and so is the current
  selection (it comes back at the next visit). **Deselect all** (tap twice) clears it.
- **Board mode** (open a shared link): the palette shows only the teacher's chosen
  cards, flat. Drag them onto the board.
- Cards never run out — dragging one from the palette leaves it there.
- **Tool menu** (first button, drop-down): Move / Pen / Marker / Eraser. Every session
  starts on Move; colours and line width appear only with Pen or Marker (the eraser
  uses 4× the last line width). The eraser only removes ink, not cards.
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
  **⚙️ Options** (teacher only) chooses which words each dot can stand for — in the
  generator and when tapping a dot — and where the generator may put an `s`; saved in
  the browser and sent with the share link. Sometimes a time phrase is added at the end (`every day` from level 3, `in winter` /
  `at Christmas` from level 6). All the rules and why: [docs/generator.md](docs/generator.md).
- **🔊 Read** speaks the board (rows top→bottom, left→right; an `s` on a card makes it
  plural / 3rd person). A selected card shows 🔊 to hear just that card; in board mode
  tapping a palette card speaks it. A selected dot shows its word under it (the → a,
  my → your…): tap the word to change it. British voice when the device has one.

## Login-protected version (PHP, uploaded by FTP)

`python tools/build.py` also writes `upload/flashcards/`: copy that folder by FTP into
any PHP (>= 7.4) site, e.g. `https://example.org/flashcards/`. Nothing else to set up:
no database, no changes to the rest of the site.

- **First visit**: asks for the setup code (in `upload/flashcards/config.php`, created
  once with a random value and then kept) and creates the first administrator.
- **`admin.php`** (administrators): create accounts (random or chosen password, shown
  once with a ready-to-send message), change password, edit name/role/expiry date,
  disable/enable, delete; last login, number of logins, student opens; monthly log.
- **`account.php`**: a teacher changes their password or logs out of other devices.
- **Teachers** get the full app. *Share to class* asks the server for a signed link
  `?t=<uid>~<expiry>~<cards>~<options>~<signature>` that works without an account
  until midnight (`student_link_hours` in `config.php` to change it) and serves only
  the lesson's cards. Disabling a teacher also stops their student links.
- **Segnala** (teachers): a form for bugs and change requests. The server saves it
  (shown on `admin.php`, «Segnalazioni») and mails it to `feedback_to` in `config.php`,
  Reply-To = the teacher. Saving comes first: PHP `mail()` on shared hosting may be
  filtered or disabled. 20 reports per teacher per day (`feedback_per_day`).
- Login = signed cookie limited to the folder, 30 days (`login_days`); changing the
  password logs out every other device. 5 wrong passwords lock the account 10 minutes.
- Data lives in `data/` on the server (`users.php`, `secret.php`, `log-YYYY-MM.php`):
  JSON behind `<?php exit; ?>`, so they show nothing even where `.htaccess` is ignored.
  **When re-uploading, never use an FTP "mirror/sync with deletion"**: it would delete
  `data/` and every account. `data_dir` in `config.php` can point outside the web root.

Local test: `python tools/serve_local.py` (needs PHP: `PHP` env variable, `php` on the
PATH, or `~/tools/php-8.3/php.exe`) → http://127.0.0.1:8080/. Test accounts go to
`local-data/` (git-ignored), never into `upload/`; `--reset` starts from scratch.

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
| `tools/build.py` | inlines catalog + assets → `dist/`, PHP site → `upload/flashcards/` |
| `server/` | PHP host: `index.php` (login, app, student links), `admin.php`, `account.php`, `inc/core.php` |
| `tools/serve_local.py` | local PHP test server |
| `catalog.json` | generated card list (defines the URL bitmask order) |
