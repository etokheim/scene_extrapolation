#!/usr/bin/env python3
"""Assign devices/entities to areas from area_map.yaml. Stop HA first."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

CONFIG = Path(__file__).resolve().parent
STORAGE = CONFIG / ".storage"
MAP_FILE = CONFIG / "area_map.yaml"


def load_map() -> dict:
    return yaml.safe_load(MAP_FILE.read_text())


def patch_devices(mapping: dict) -> int:
    path = STORAGE / "core.device_registry"
    data = json.loads(path.read_text())
    by_name = mapping.get("devices") or {}
    updated = 0
    for device in data["data"]["devices"]:
        spec = by_name.get(device.get("name"))
        if not spec:
            continue
        device["area_id"] = spec["area"]
        if spec.get("name"):
            device["name_by_user"] = spec["name"]
        updated += 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return updated


def patch_entities(mapping: dict) -> int:
    path = STORAGE / "core.entity_registry"
    data = json.loads(path.read_text())
    by_id = mapping.get("entities") or {}
    updated = 0
    for entity in data["data"]["entities"]:
        area = by_id.get(entity.get("entity_id"))
        if not area:
            continue
        entity["area_id"] = area
        updated += 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return updated


def main() -> int:
    if not MAP_FILE.exists():
        print(f"missing {MAP_FILE}", file=sys.stderr)
        return 1
    mapping = load_map()
    devices = patch_devices(mapping)
    entities = patch_entities(mapping)
    print(f"updated {devices} devices, {entities} entities")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
