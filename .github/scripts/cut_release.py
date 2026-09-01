#!/usr/bin/env python3
"""Move CHANGELOG Unreleased into a version, bump manifest, reset PANEL_ASSET_REV.

Used by .github/workflows/release.yml after a PR is merged to master.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHANGELOG = ROOT / "CHANGELOG.md"
MANIFEST = ROOT / "custom_components/scene_extrapolation/manifest.json"
PANEL = ROOT / "custom_components/scene_extrapolation/panel.py"
NOTES = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "scene_extrapolation_release_notes.md"

UNRELEASED_RE = re.compile(
    r"^## \[Unreleased\]\s*\n(?P<body>.*?)(?=^## \[)",
    re.MULTILINE | re.DOTALL,
)
ITEM_RE = re.compile(r"^\s*[-*]\s+\S", re.MULTILINE)
PLACEHOLDER_ITEM_RE = re.compile(r"^\s*[-*]\s*$")
PANEL_REV_RE = re.compile(r"^PANEL_ASSET_REV = \".*\"$", re.MULTILINE)
EMPTY_SECTION_RE = re.compile(
    r"^### [^\n]+\n(?:[ \t]*\n)*(?=^### |\Z)",
    re.MULTILINE,
)

EMPTY_UNRELEASED = """## [Unreleased]

### Added

### Changed

### Fixed
"""


def parse_unreleased(text: str) -> str:
    match = UNRELEASED_RE.search(text)
    if not match:
        raise SystemExit("CHANGELOG.md has no ## [Unreleased] section")
    return match.group("body")


def unreleased_items(body: str) -> list[str]:
    items: list[str] = []
    for line in body.splitlines():
        if PLACEHOLDER_ITEM_RE.match(line):
            continue
        if ITEM_RE.match(line):
            items.append(line.strip())
    return items


def infer_bump(body: str) -> str:
    if "🚨" in body:
        return "major"
    added = section_items(body, "Added")
    if added:
        return "minor"
    if unreleased_items(body):
        return "patch"
    return "none"


def section_items(body: str, heading: str) -> list[str]:
    pattern = re.compile(
        rf"^### {re.escape(heading)}\s*\n(?P<body>.*?)(?=^### |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(body)
    if not match:
        return []
    return unreleased_items(match.group("body"))


def bump_version(current: str, bump: str) -> str:
    major, minor, patch = (int(part) for part in current.split("."))
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit(f"Unknown bump type: {bump}")


def clean_unreleased_body(body: str) -> str:
    """Drop placeholder bullets and empty ### sections; keep extra headings."""
    lines = [
        line for line in body.splitlines() if not PLACEHOLDER_ITEM_RE.match(line)
    ]
    text = EMPTY_SECTION_RE.sub("", "\n".join(lines))
    return text.strip() + "\n"


def apply_changelog(text: str, version: str, date: str, body: str) -> str:
    header = text[: text.index("## [Unreleased]")]
    rest_match = re.search(r"^## \[\d+\.\d+\.\d+\]", text, re.MULTILINE)
    rest = text[rest_match.start() :] if rest_match else ""
    version_body = clean_unreleased_body(body)
    return (
        f"{header}{EMPTY_UNRELEASED}\n"
        f"## [{version}] - {date}\n\n"
        f"{version_body}\n"
        f"{rest}"
    )


def write_github_output(values: dict[str, str]) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    line = "\n".join(f"{key}={value}" for key, value in values.items())
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bump",
        default="auto",
        choices=("auto", "patch", "minor", "major"),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write manifest, changelog, panel rev, and release_notes.md",
    )
    args = parser.parse_args()

    changelog = CHANGELOG.read_text(encoding="utf-8")
    body = parse_unreleased(changelog)
    inferred = infer_bump(body)
    bump = inferred if args.bump == "auto" else args.bump

    if inferred == "none":
        write_github_output(
            {"skipped": "true", "reason": "CHANGELOG Unreleased has no entries"}
        )
        return 0

    if bump == "none":
        write_github_output({"skipped": "true", "reason": "bump is none"})
        return 0

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    current = manifest["version"]
    version = bump_version(current, bump)
    date = dt.date.today().isoformat()

    outputs = {
        "skipped": "false",
        "bump": bump,
        "version": version,
        "tag": f"v{version}",
        "notes_file": str(NOTES),
    }

    if not args.apply:
        write_github_output(outputs)
        return 0

    CHANGELOG.write_text(
        apply_changelog(changelog, version, date, body), encoding="utf-8"
    )
    manifest["version"] = version
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    panel = PANEL.read_text(encoding="utf-8")
    if not PANEL_REV_RE.search(panel):
        raise SystemExit("PANEL_ASSET_REV assignment not found in panel.py")
    PANEL.write_text(
        PANEL_REV_RE.sub('PANEL_ASSET_REV = "1"', panel, count=1), encoding="utf-8"
    )

    notes_body = clean_unreleased_body(body)
    NOTES.write_text(
        f"# Scene Extrapolation {version}\n\n{notes_body}", encoding="utf-8"
    )
    write_github_output(outputs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
