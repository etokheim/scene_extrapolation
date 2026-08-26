"""Persistent store for extrapolation scene configurations."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    AREA,
    CATEGORY,
    DESCRIPTION,
    DISPLAY_SCENES_COMBINED,
    DOMAIN,
    LABELS,
    NIGHTLIGHTS_BOOLEAN,
    NIGHTLIGHTS_SCENE,
    SCENE_DAWN,
    SCENE_DAWN_SUNRISE_SUNSET,
    SCENE_DUSK,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
    SCENE_KEYS,
    SCENE_NAME,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
    STORE_KEY,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
DEFAULT_DUSK_MINIMUM_SECONDS = 22 * 3600


def time_to_seconds(value: Any) -> int:
    """Convert a time string or seconds value to seconds since midnight."""
    if value is None or value == "":
        return DEFAULT_DUSK_MINIMUM_SECONDS
    if isinstance(value, (int, float)):
        return int(value)
    parts = str(value).split(":")
    hours = int(parts[0])
    minutes = int(parts[1]) if len(parts) > 1 else 0
    seconds = int(parts[2]) if len(parts) > 2 else 0
    return hours * 3600 + minutes * 60 + seconds


def seconds_to_time(value: Any) -> str:
    """Convert seconds since midnight to HH:MM:SS."""
    if value is None or value == "":
        return "22:00:00"
    if isinstance(value, str) and ":" in value:
        parts = value.split(":")
        if len(parts) == 2:
            return f"{parts[0]}:{parts[1]}:00"
        return value
    seconds = int(value)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def normalize_scene_config(
    raw: dict[str, Any], scene_id: str | None = None
) -> dict[str, Any]:
    """Normalize UI/legacy input into a stored scene config."""
    combined = bool(raw.get(DISPLAY_SCENES_COMBINED, False))
    name = (raw.get(SCENE_NAME) or "Automatic Lighting").strip()
    if not name:
        raise ValueError("Scene name is required")

    labels = raw.get(LABELS) or []
    if isinstance(labels, str):
        labels = [labels] if labels else []
    item: dict[str, Any] = {
        "id": scene_id or raw.get("id") or str(uuid.uuid4()),
        SCENE_NAME: name,
        DESCRIPTION: (raw.get(DESCRIPTION) or "").strip() or None,
        LABELS: [str(label) for label in labels if label],
        CATEGORY: raw.get(CATEGORY) or None,
        AREA: raw.get(AREA) or None,
        DISPLAY_SCENES_COMBINED: combined,
        NIGHTLIGHTS_BOOLEAN: raw.get(NIGHTLIGHTS_BOOLEAN) or None,
        NIGHTLIGHTS_SCENE: raw.get(NIGHTLIGHTS_SCENE) or None,
        SCENE_DUSK_MINIMUM_TIME_OF_DAY: time_to_seconds(
            raw.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
        ),
    }

    if combined:
        shared = raw.get(SCENE_DAWN_SUNRISE_SUNSET) or raw.get(SCENE_DAWN)
        item[SCENE_DAWN] = shared
        item[SCENE_SUNRISE] = shared
        item[SCENE_SUNSET] = shared
        item[SCENE_NOON] = raw.get(SCENE_NOON)
        item[SCENE_DUSK] = raw.get(SCENE_DUSK)
    else:
        for key in SCENE_KEYS:
            item[key] = raw.get(key)

    missing = [key for key in SCENE_KEYS if not item.get(key)]
    if missing:
        raise ValueError(f"Missing required scenes: {', '.join(missing)}")

    if item[NIGHTLIGHTS_BOOLEAN] and not item[NIGHTLIGHTS_SCENE]:
        raise ValueError(
            "Nightlights scene is required when a nightlights boolean is configured"
        )

    return item


def legacy_entry_to_config(
    entry_data: dict[str, Any], options: dict[str, Any]
) -> dict[str, Any]:
    """Convert an old per-room config entry into a store item."""
    merged = {**entry_data, **options}
    return normalize_scene_config(
        {
            **merged,
            DISPLAY_SCENES_COMBINED: merged.get(SCENE_DAWN)
            and merged.get(SCENE_DAWN)
            == merged.get(SCENE_SUNRISE)
            == merged.get(SCENE_SUNSET),
        },
        scene_id=merged.get("unique_id"),
    )


def to_form_data(item: dict[str, Any]) -> dict[str, Any]:
    """Shape a stored item for ha-form."""
    combined = bool(item.get(DISPLAY_SCENES_COMBINED))
    data = {
        "id": item.get("id"),
        SCENE_NAME: item.get(SCENE_NAME),
        DESCRIPTION: item.get(DESCRIPTION) or "",
        LABELS: list(item.get(LABELS) or []),
        CATEGORY: item.get(CATEGORY),
        AREA: item.get(AREA),
        DISPLAY_SCENES_COMBINED: combined,
        SCENE_NOON: item.get(SCENE_NOON),
        SCENE_DUSK: item.get(SCENE_DUSK),
        SCENE_DUSK_MINIMUM_TIME_OF_DAY: seconds_to_time(
            item.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
        ),
        NIGHTLIGHTS_BOOLEAN: item.get(NIGHTLIGHTS_BOOLEAN),
        NIGHTLIGHTS_SCENE: item.get(NIGHTLIGHTS_SCENE),
    }
    if combined:
        data[SCENE_DAWN_SUNRISE_SUNSET] = item.get(SCENE_DAWN)
    else:
        data[SCENE_DAWN] = item.get(SCENE_DAWN)
        data[SCENE_SUNRISE] = item.get(SCENE_SUNRISE)
        data[SCENE_SUNSET] = item.get(SCENE_SUNSET)
    return data


class SceneExtrapolationStore:
    """Load and persist extrapolation scene configs."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store."""
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORE_KEY)
        self.scenes: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Load scenes from disk."""
        data = await self._store.async_load()
        items = (data or {}).get("scenes", [])
        self.scenes = {item["id"]: item for item in items if "id" in item}

    async def async_save(self) -> None:
        """Write scenes to disk."""
        await self._store.async_save({"scenes": list(self.scenes.values())})

    def list(self) -> list[dict[str, Any]]:
        """Return all scene configs."""
        return list(self.scenes.values())

    def get(self, scene_id: str) -> dict[str, Any] | None:
        """Return one scene config."""
        return self.scenes.get(scene_id)

    async def async_upsert(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Create or update a scene config."""
        scene_id = raw.get("id")
        item = normalize_scene_config(raw, scene_id=scene_id)
        self.scenes[item["id"]] = item
        await self.async_save()
        return item

    async def async_delete(self, scene_id: str) -> bool:
        """Delete a scene config."""
        if scene_id not in self.scenes:
            return False
        self.scenes.pop(scene_id)
        await self.async_save()
        return True

    async def async_import_legacy(
        self, entry_data: dict[str, Any], options: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Import a legacy config entry if it is not already stored."""
        if SCENE_NAME not in entry_data and SCENE_DAWN not in entry_data:
            return None
        try:
            item = legacy_entry_to_config(entry_data, options)
        except ValueError:
            _LOGGER.exception("Could not migrate legacy %s entry", DOMAIN)
            return None
        if item["id"] not in self.scenes:
            self.scenes[item["id"]] = item
            await self.async_save()
        return item
