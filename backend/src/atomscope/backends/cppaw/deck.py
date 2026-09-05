"""CP-PAW "linked list" input syntax (the .cntl / .strc / .wcntl / .dcntl files).

Grammar as used by CP-PAW's LINKEDLIST reader and observed in the manual and decks:

    !BLOCKNAME key=value key2=v1 v2 v3 ... !END      blocks nest arbitrarily
    !EOB                                             end of buffer (top level)

- Keywords are case-insensitive (CP-PAW upper-cases them); we preserve the given case on
  write and compare upper-cased.
- Values: integers, reals (Fortran `1.D-3` accepted), logicals `T`/`F`, quoted strings
  `'SI'`, and vectors given as whitespace separated numbers after one `key=`.
- A key may carry a unit in brackets: `CHARGE[E]=`, `LUNIT[AA]=`, `DE[EV]=` — kept as part of
  the key name.
- Repeated blocks with the same name are allowed (e.g. many `!ATOM`); order is preserved.
- `!RDYN_X` style suffixes are how users disable a block (the name no longer matches).
- Anything after `!EOB` is ignored. Comments are not part of the format; CP-PAW simply
  reports unknown elements as "UNUSED".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

Scalar = int | float | bool | str
Value = Scalar | list[Scalar]

_TOKEN = re.compile(
    r"""
    '(?:[^']*)'            |   # single-quoted string
    "(?:[^"]*)"            |   # double-quoted string
    ![A-Za-z0-9_\-]+       |   # block open / !END / !EOB
    [^\s=]+=               |   # key=
    [^\s=]+                    # bare value token
    """,
    re.VERBOSE,
)
_NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$")
_INT = re.compile(r"^[+-]?\d+$")


@dataclass
class Block:
    """One `!NAME ... !END` block: ordered keys and ordered child blocks."""

    name: str
    keys: dict[str, Value] = field(default_factory=dict)
    children: list[Block] = field(default_factory=list)
    duplicate_keys: list[str] = field(default_factory=list, compare=False)

    # ---- queries -------------------------------------------------------------------------
    def child(self, name: str) -> Block | None:
        n = name.upper()
        for c in self.children:
            if c.name.upper() == n:
                return c
        return None

    def children_named(self, name: str) -> list[Block]:
        n = name.upper()
        return [c for c in self.children if c.name.upper() == n]

    def get(self, key: str, default: Value | None = None) -> Value | None:
        """Look up a key ignoring case and an optional unit bracket, e.g. ``get("CHARGE")``."""
        k = key.upper()
        for name, value in self.keys.items():
            base = name.upper().split("[")[0]
            if name.upper() == k or base == k:
                return value
        return default

    def set(self, key: str, value: Value) -> None:
        for name in list(self.keys):
            if name.upper() == key.upper():
                self.keys[name] = value
                return
        self.keys[key] = value

    def ensure_child(self, name: str) -> Block:
        c = self.child(name)
        if c is None:
            c = Block(name)
            self.children.append(c)
        return c

    def path(self, *names: str) -> Block | None:
        node: Block | None = self
        for n in names:
            if node is None:
                return None
            node = node.child(n)
        return node


class DeckSyntaxError(ValueError):
    pass


def _convert(token: str) -> Scalar:
    if len(token) >= 2 and token[0] in "'\"" and token[-1] == token[0]:
        return token[1:-1]
    if token.upper() in ("T", ".TRUE.", "TRUE"):
        return True
    if token.upper() in ("F", ".FALSE.", "FALSE"):
        return False
    if _INT.match(token):
        return int(token)
    if _NUMBER.match(token):
        return float(token.replace("D", "E").replace("d", "e"))
    return token


def parse_deck(text: str) -> Block:
    """Parse a deck and return a synthetic root whose children are the top-level blocks."""
    root = Block("__ROOT__")
    stack = [root]
    current_key: str | None = None
    pending: list[Scalar] = []

    def flush() -> None:
        nonlocal current_key, pending
        if current_key is not None:
            block = stack[-1]
            # CP-PAW recognizes only the FIRST occurrence of a repeated key (manual l.426-432).
            if any(k.upper() == current_key.upper() for k in block.keys):
                block.duplicate_keys.append(current_key)
            else:
                block.keys[current_key] = pending[0] if len(pending) == 1 else list(pending)
        current_key = None
        pending = []

    for tok in _TOKEN.findall(text):
        if tok.startswith("!"):
            flush()
            up = tok.upper()
            if up == "!EOB":
                break
            if up == "!END":
                if len(stack) == 1:
                    raise DeckSyntaxError("unmatched !END")
                stack.pop()
                continue
            blk = Block(tok[1:])
            stack[-1].children.append(blk)
            stack.append(blk)
        elif tok.endswith("="):
            flush()
            current_key = tok[:-1]
        else:
            if current_key is None:
                raise DeckSyntaxError(f"value {tok!r} without a key in block !{stack[-1].name}")
            pending.append(_convert(tok))
    flush()
    if len(stack) != 1:
        raise DeckSyntaxError(f"unterminated block !{stack[-1].name}")
    return root


def _fmt(v: Scalar) -> str:
    if isinstance(v, bool):
        return "T" if v else "F"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _fmt_float(v)
    return f"'{v}'"


def _fmt_float(v: float) -> str:
    """Fortran-friendly float: always a decimal point, uppercase exponent (``1e-05`` is rejected
    by CP-PAW's reader with 'CORRUPTED DATA FIELD ON INPUT')."""
    text = repr(float(v))
    if "e" in text:
        mantissa, exp = text.split("e")
        if "." not in mantissa:
            mantissa += ".0"
        return f"{mantissa}E{exp}"
    if "." not in text and text not in ("inf", "-inf", "nan"):
        text += ".0"
    return text


def _fmt_value(v: Value) -> str:
    if isinstance(v, list):
        return " ".join(_fmt(x) for x in v)
    return _fmt(v)


def format_deck(root: Block, *, indent: str = "  ") -> str:
    """Serialize deterministically. Top-level blocks are followed by ``!EOB``."""
    lines: list[str] = []

    def emit(block: Block, depth: int) -> None:
        pad = indent * depth
        head = f"{pad}!{block.name}"
        kv = " ".join(f"{k}={_fmt_value(v)}" for k, v in block.keys.items())
        if not block.children:
            lines.append(f"{head} {kv} !END".replace("  !END", " !END") if kv else f"{head} !END")
            return
        lines.append(f"{head} {kv}".rstrip())
        for c in block.children:
            emit(c, depth + 1)
        lines.append(f"{pad}!END")

    for top in root.children:
        emit(top, 0)
    lines.append("!EOB")
    return "\n".join(lines) + "\n"
