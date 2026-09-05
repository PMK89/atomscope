"""Update Status cells in docs/avogadro1-feature-parity.md.

Usage: .venv/bin/python scripts/parity_status.py AV-VIS-002=IMPLEMENTED AV-SEL-001=PARTIAL ...
Status must be one of NOT STARTED, PARTIAL, IMPLEMENTED, VERIFIED, BLOCKED. Optionally append
a note with ``ID=STATUS::note text``.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ALLOWED = {"NOT STARTED", "PARTIAL", "IMPLEMENTED", "VERIFIED", "BLOCKED"}
STATUS_COL = 9  # 0-based index among the table cells (ID is 0)
NOTES_COL = 10


def main(args: list[str]) -> int:
    path = Path(__file__).resolve().parent.parent / "docs" / "avogadro1-feature-parity.md"
    updates: dict[str, tuple[str, str | None]] = {}
    for arg in args:
        key, _, rest = arg.partition("=")
        status, _, note = rest.partition("::")
        if status not in ALLOWED:
            print(f"bad status {status!r} for {key}", file=sys.stderr)
            return 2
        updates[key] = (status, note or None)
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = 0
    for i, line in enumerate(lines):
        m = re.match(r"^\| (AV-[A-Z]+-\d+) \|", line)
        if not m or m.group(1) not in updates:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) <= NOTES_COL:
            continue
        status, note = updates[m.group(1)]
        cells[STATUS_COL] = status
        if note:
            cells[NOTES_COL] = (cells[NOTES_COL] + " " if cells[NOTES_COL] else "") + note
        lines[i] = "| " + " | ".join(cells) + " |"
        changed += 1
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"updated {changed} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
