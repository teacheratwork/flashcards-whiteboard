"""Run the login-protected PHP version locally, for testing.

Rebuilds upload/flashcards/ (tools/build.py), then serves it with PHP's built-in
server on http://127.0.0.1:8080/. Test accounts and logs go to local-data/
(git-ignored), never into upload/, so they can't end up on the real site.

  python tools/serve_local.py [--port 8080] [--no-build] [--reset]

PHP: the PHP environment variable, else `php` on the PATH, else
~/tools/php-8.3/php.exe (portable zip from windows.php.net).
--reset deletes the test accounts (the first page asks for the setup code again).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
WEB = ROOT / "upload" / "flashcards"
DATA = ROOT / "local-data"


def find_php() -> str:
    for cand in (os.environ.get("PHP"), shutil.which("php"),
                 str(Path.home() / "tools" / "php-8.3" / "php.exe")):
        if cand and Path(cand).exists():
            return cand
    raise SystemExit("PHP not found: set the PHP environment variable to php.exe")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    php = find_php()
    if not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=True)
    if args.reset and DATA.exists():
        shutil.rmtree(DATA)
    DATA.mkdir(exist_ok=True)

    code = re.search(r"'setup_code'\s*=>\s*'([^']*)'", (WEB / "config.php").read_text(encoding="utf-8"))
    print(f"\n  http://127.0.0.1:{args.port}/   (Ctrl+C to stop)")
    print(f"  admin page: http://127.0.0.1:{args.port}/admin.php")
    print(f"  setup code (first run only): {code.group(1) if code else '?'}")
    print(f"  test data: {DATA}\n")
    env = dict(os.environ, BBF_DATA_DIR=str(DATA))
    try:
        return subprocess.call([php, "-S", f"127.0.0.1:{args.port}", "-t", str(WEB)], env=env)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
