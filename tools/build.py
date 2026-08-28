"""Assemble the self-contained app.

Reads src/ (template, styles, qr.js, app.js), the sliced cards in assets/cards/,
and assets/markers.json, then writes:

  dist/artifact.html  -- body-only page for publishing as a Claude Artifact
  dist/index.html     -- same, wrapped as a standalone file you can open locally
  catalog.json        -- the card catalogue, for reference

Re-run after re-slicing cards or editing anything in src/.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"
CARDS = ROOT / "assets" / "cards"
DIST = ROOT / "dist"

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
    return catalog


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

    body = (template
            .replace("/*__STYLES__*/", styles)
            .replace("/*__DATA__*/", data_js)
            .replace("/*__QR__*/", qrjs)
            .replace("/*__APP__*/", appjs))

    DIST.mkdir(exist_ok=True)
    (DIST / "artifact.html").write_text(body, encoding="utf-8")

    standalone = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, "
        "maximum-scale=1, user-scalable=no\">\n</head>\n<body data-tool=\"move\">\n"
        + body + "\n</body>\n</html>\n"
    )
    (DIST / "index.html").write_text(standalone, encoding="utf-8")

    pics = sum(1 for c in catalog if c["type"] == "pic")
    kb = (DIST / "index.html").stat().st_size / 1024
    print(f"  catalog: {pics} picture cards + {len(MARKERS)} markers = {len(catalog)} total")
    print(f"  dist/index.html    {kb:8.0f} KB")
    print(f"  dist/artifact.html {(DIST / 'artifact.html').stat().st_size / 1024:8.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
