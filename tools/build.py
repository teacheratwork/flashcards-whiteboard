"""Assemble the self-contained app.

Reads src/ (template, styles, qr.js, app.js), the sliced cards in assets/cards/,
assets/markers.json and assets/vocab.json (words + grammar tags), then writes:

  dist/artifact.html  -- body-only page for publishing as a Claude Artifact
  dist/index.html     -- same, wrapped as a standalone file you can open locally
  catalog.json        -- the card catalogue, for reference
  upload/flashcards/  -- the login-protected PHP version (server/ + the app split
                         into inc/shell.php and inc/cards.php), to upload by FTP.
                         Not committed: upload/ is git-ignored.

Re-run after re-slicing cards or editing anything in src/.
"""
from __future__ import annotations

import base64
import json
import secrets
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"
CARDS = ROOT / "assets" / "cards"
DIST = ROOT / "dist"
SERVER = ROOT / "server"
UPLOAD = ROOT / "upload" / "flashcards"
SHELL_END = "BBF_SHELL_END"

CATS = [
    {"key": "proper-nouns", "label": "Proper nouns"},
    {"key": "common-nouns", "label": "Common nouns"},
    {"key": "verbs", "label": "Verbs"},
    {"key": "adjectives", "label": "Adjectives"},
    {"key": "numbers", "label": "Numbers"},
    {"key": "time", "label": "Time"},
    {"key": "markers", "label": "Markers"},
]

MARKERS = [
    {"id": "dot-red", "kind": "dot", "colorkey": "dot-red"},
    {"id": "dot-orange", "kind": "dot", "colorkey": "dot-orange", "ring": "#d40000"},
    {"id": "dot-green", "kind": "dot", "colorkey": "dot-green"},
    {"id": "dot-blue", "kind": "dot", "colorkey": "dot-blue"},
    {"id": "marker-s", "kind": "s"},
    {"id": "marker-plus", "kind": "plus", "colorkey": "plus"},
]


def data_uri(p: Path) -> str:
    return "data:image/webp;base64," + base64.b64encode(p.read_bytes()).decode("ascii")


def build_catalog() -> list[dict]:
    colours = {}
    mj = ROOT / "assets" / "markers.json"
    if mj.exists():
        colours = json.loads(mj.read_text(encoding="utf-8"))
    catalog: list[dict] = []
    for cat in CATS:
        if cat["key"] == "markers":
            continue
        folder = CARDS / cat["key"]
        if not folder.is_dir():
            print(f"  (no folder for {cat['key']})")
            continue
        for f in sorted(folder.glob("*.webp")):
            catalog.append({
                "id": f.stem, "cat": cat["key"], "type": "pic", "src": data_uri(f),
            })
    for m in MARKERS:
        entry = {"id": m["id"], "cat": "markers", "type": "marker", "kind": m["kind"]}
        if "colorkey" in m:
            entry["color"] = colours.get(m["colorkey"], "#888")
        if "ring" in m:
            entry["ring"] = m["ring"]
        catalog.append(entry)

    # words + grammar tags (assets/vocab.json) for speech and the sentence generator
    vocab = json.loads((ROOT / "assets" / "vocab.json").read_text(encoding="utf-8"))
    missing = []
    for c in catalog:
        v = vocab.get(c["id"])
        if not v:
            missing.append(c["id"])
            continue
        for k in ("w", "tag", "pl", "nopl", "prep", "words"):
            if k in v:
                c[k] = v[k]
    if missing:
        print(f"  WARNING no vocab entry for: {', '.join(missing)}")
    return catalog


def standalone(body: str) -> str:
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, "
        "maximum-scale=1, user-scalable=no\">\n</head>\n<body data-tool=\"move\">\n"
        + body + "\n</body>\n</html>\n"
    )


def php_nowdoc(text: str, label: str) -> str:
    """A PHP file that returns `text`, unreadable when requested directly."""
    if f"\n{label}" in text:
        raise SystemExit(f"text contains the nowdoc end marker {label}")
    return f"<?php defined('BBF') or exit;\nreturn <<<'{label}'\n{text}\n{label};\n"


def build_server(shell: str, catalog: list[dict]) -> None:
    """server/ + the app split in shell (no cards) and cards -> upload/flashcards/.
    config.php is created once (random setup code) and then kept as it is."""
    if "/*__DATA__*/" not in shell:
        raise SystemExit("template lost its /*__DATA__*/ placeholder")
    config = UPLOAD / "config.php"
    kept = config.read_text(encoding="utf-8") if config.exists() else None
    if UPLOAD.exists():
        shutil.rmtree(UPLOAD)
    shutil.copytree(SERVER, UPLOAD, ignore=shutil.ignore_patterns("config.sample.php"))
    (UPLOAD / "inc" / "shell.php").write_text(php_nowdoc(shell, SHELL_END), encoding="utf-8")
    cards = json.dumps({"cats": CATS, "catalog": catalog}, separators=(",", ":"))
    (UPLOAD / "inc" / "cards.php").write_text(php_nowdoc(cards, "BBF_CARDS_END"), encoding="utf-8")
    if kept is None:
        kept = (SERVER / "config.sample.php").read_text(encoding="utf-8").replace(
            "__SETUP_CODE__", secrets.token_urlsafe(9))
    config.write_text(kept, encoding="utf-8")


def main() -> int:
    catalog = build_catalog()
    (ROOT / "catalog.json").write_text(
        json.dumps([{k: v for k, v in c.items() if k != "src"} for c in catalog], indent=2),
        encoding="utf-8")

    template = (SRC / "index.template.html").read_text(encoding="utf-8")
    styles = (SRC / "styles.css").read_text(encoding="utf-8")
    qrjs = (SRC / "qr.js").read_text(encoding="utf-8")
    appjs = (SRC / "app.js").read_text(encoding="utf-8")

    data_js = (
        "window.CATS=" + json.dumps(CATS, separators=(",", ":")) + ";"
        "window.CATALOG=" + json.dumps(catalog, separators=(",", ":")) + ";"
    )

    # version shown next to the product name (VERSION file; see CHANGELOG.md)
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    now = datetime.now()
    built = now.strftime("%d/%m/%Y %H:%M")

    shell_body = (template
                  .replace("__VERSION__", version)
                  .replace("__BUILD_DAY__", now.strftime("%d/%m/%Y"))
                  .replace("__BUILD__", built)
                  .replace("/*__STYLES__*/", styles)
                  .replace("/*__QR__*/", qrjs)
                  .replace("/*__APP__*/", appjs))
    body = shell_body.replace("/*__DATA__*/", data_js)

    DIST.mkdir(exist_ok=True)
    (DIST / "artifact.html").write_text(body, encoding="utf-8")
    (DIST / "index.html").write_text(standalone(body), encoding="utf-8")

    build_server(standalone(shell_body), catalog)

    pics = sum(1 for c in catalog if c["type"] == "pic")
    kb = (DIST / "index.html").stat().st_size / 1024
    print(f"  version {version}, built {built}")
    print(f"  catalog: {pics} picture cards + {len(MARKERS)} markers = {len(catalog)} total")
    print(f"  dist/index.html    {kb:8.0f} KB")
    print(f"  dist/artifact.html {(DIST / 'artifact.html').stat().st_size / 1024:8.0f} KB")
    print(f"  upload/flashcards/ (PHP, for FTP)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
