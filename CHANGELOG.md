# Changelog

Version history of BB1 flashcards, kept mainly to tell Open Minds (Claudia Adamo)
what changed since the last version she received.

**Version number.** The current version is in the `VERSION` file; `tools/build.py`
prints it in the bottom-right corner of the board («v1.2 · 21/10/2026», build date
and time on hover), in both the public page and the login-protected PHP version.
Comparing that label with this file tells which version a board is running.

**Rules.**
- Every change a teacher or a pupil would notice gets a line under the version being
  prepared (the top one).
- Before publishing new changes on top of a version already online, bump `VERSION` and
  open a new heading. Fixes made before publishing can stay in the same version.
  - normal change (new feature, generator rule, anything a teacher should be told
    about): next tenth, 1.2 → 1.3;
  - minimal change (a word, a typo, a small visual fix): next hundredth, 1.2 → 1.21 →
    1.22; the next normal change then goes to 1.3 (decided 2026-10-21).
- When a zip goes to Open Minds, write «sent to Open Minds on <date>» on its heading.

## 1.2 — 2026-10-21 (public page; not yet sent to Open Minds)

- Version label in the bottom-right corner of the board.

## 1.1 — 2026-10-21 (public page, no version label yet; not yet sent to Open Minds)

- Sentence generator: irregular plurals without -s (*fish*, *snowmen*) are no longer
  put in the plural, so the generator never shows «fish + s». They still appear as
  singular subjects.
- Sentence generator, level 6: with *let's* the place now goes after the verb
  («let's hop in the garden» instead of «in the garden let's hop»).

## 1.0 — 2026-10-13 (sent to Open Minds on 2026-10-17)

Login-protected zip `upload/bb1-flashcards-lavagna-protetta.zip` (commit `22e73a2`):
the baseline for this changelog.
