#!/usr/bin/env python3
"""Fail if translation key trees or ICU placeholders drift from en.json."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRANS = ROOT / "custom_components/scene_extrapolation/translations"
LANGS = ("nb", "nn", "de", "es")
PLACEHOLDER_RE = re.compile(r"\{[^{}]+\}")


def walk(node: object, prefix: str = "") -> dict[str, str]:
    if not isinstance(node, dict):
        raise SystemExit(f"Expected object at {prefix or '<root>'}")
    out: dict[str, str] = {}
    for key, value in node.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            out.update(walk(value, path))
        elif isinstance(value, str):
            out[path] = value
        else:
            raise SystemExit(f"{path}: values must be strings or objects")
    return out


def main() -> int:
    en_path = TRANS / "en.json"
    en = walk(json.loads(en_path.read_text(encoding="utf-8")))
    errors: list[str] = []
    for lang in LANGS:
        path = TRANS / f"{lang}.json"
        other = walk(json.loads(path.read_text(encoding="utf-8")))
        missing = sorted(set(en) - set(other))
        extra = sorted(set(other) - set(en))
        if missing:
            errors.append(f"{lang}.json missing keys: {', '.join(missing)}")
        if extra:
            errors.append(f"{lang}.json extra keys: {', '.join(extra)}")
        for key in sorted(set(en) & set(other)):
            expected = sorted(PLACEHOLDER_RE.findall(en[key]))
            found = sorted(PLACEHOLDER_RE.findall(other[key]))
            if expected != found:
                errors.append(
                    f"{lang}.json {key}: placeholders {found} != English {expected}"
                )
    if errors:
        print("Translation check failed:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"Translation key trees match en.json ({len(en)} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
