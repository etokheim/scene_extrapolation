"""Persistent store for circadian scene configurations."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store

from .const import (
    AREA,
    CATEGORY,
    DEFAULT_SCENE_NAME,
    DESCRIPTION,
    DISPLAY_SCENES_COMBINED,
    DOMAIN,
    AUTOMATICALLY_UPDATE_LIGHTS,
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

# v2 (dev-only): continuous → follow_up. v3: → automatically_update_lights; hide default on.
STORAGE_VERSION = 3
DEFAULT_DUSK_MINIMUM_SECONDS = 22 * 3600
DEFAULT_SETTINGS = {
    "hide_managed_native_scenes": True,
    # Seconds; 0 disables. Same value is the light transition on auto-update ticks.
    "automatically_update_lights_interval": 300,
}

_PREF_ALIASES = ("continuous", "follow_up")
_INTERVAL_ALIASES = ("continuous_interval", "follow_up_interval")


def _migrate_preference_keys(item: dict[str, Any]) -> None:
    """Map legacy per-scene preference keys onto automatically_update_lights."""
    if AUTOMATICALLY_UPDATE_LIGHTS in item:
        for alias in _PREF_ALIASES:
            item.pop(alias, None)
        return
    for alias in _PREF_ALIASES:
        if alias in item:
            item[AUTOMATICALLY_UPDATE_LIGHTS] = bool(item.pop(alias))
            for leftover in _PREF_ALIASES:
                item.pop(leftover, None)
            return
    item[AUTOMATICALLY_UPDATE_LIGHTS] = True


def _migrate_interval_settings(settings: dict[str, Any]) -> None:
    """Map legacy interval keys onto automatically_update_lights_interval."""
    if "automatically_update_lights_interval" in settings:
        for alias in _INTERVAL_ALIASES:
            settings.pop(alias, None)
        return
    for alias in _INTERVAL_ALIASES:
        if alias in settings:
            settings["automatically_update_lights_interval"] = settings.pop(alias)
            for leftover in _INTERVAL_ALIASES:
                settings.pop(leftover, None)
            return


def _migrate_store(old_version: int, data: dict[str, Any]) -> dict[str, Any]:
    """Migrate persisted store payloads between STORAGE_VERSION values."""
    if data is None:
        return {
            "scenes": [],
            "settings": dict(DEFAULT_SETTINGS),
            "managed_native_scene_ids": [],
        }
    if old_version < 3:
        scenes = list(data.get("scenes") or [])
        for item in scenes:
            if isinstance(item, dict):
                _migrate_preference_keys(item)
        settings = dict(data.get("settings") or {})
        _migrate_interval_settings(settings)
        # Product default flipped to on in 3.0; migrate everyone to the new default.
        if old_version < 2:
            settings["hide_managed_native_scenes"] = True
        data = {
            **data,
            "scenes": scenes,
            "settings": settings,
        }
    return data


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
    name = (raw.get(SCENE_NAME) or DEFAULT_SCENE_NAME).strip()
    if not name:
        raise ValueError("Scene name is required")

    labels = raw.get(LABELS) or []
    if isinstance(labels, str):
        labels = [labels] if labels else []
    # Missing key → True so existing rooms follow without a storage migration.
    automatically_update_lights = raw.get(AUTOMATICALLY_UPDATE_LIGHTS, True)
    if not isinstance(automatically_update_lights, bool):
        automatically_update_lights = bool(automatically_update_lights)

    item: dict[str, Any] = {
        "id": scene_id or raw.get("id") or str(uuid.uuid4()),
        SCENE_NAME: name,
        DESCRIPTION: (raw.get(DESCRIPTION) or "").strip() or None,
        LABELS: [str(label) for label in labels if label],
        CATEGORY: raw.get(CATEGORY) or None,
        AREA: raw.get(AREA) or None,
        DISPLAY_SCENES_COMBINED: combined,
        AUTOMATICALLY_UPDATE_LIGHTS: automatically_update_lights,
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
        AUTOMATICALLY_UPDATE_LIGHTS: bool(item.get(AUTOMATICALLY_UPDATE_LIGHTS, True)),
    }
    if combined:
        data[SCENE_DAWN_SUNRISE_SUNSET] = item.get(SCENE_DAWN)
    else:
        data[SCENE_DAWN] = item.get(SCENE_DAWN)
        data[SCENE_SUNRISE] = item.get(SCENE_SUNRISE)
        data[SCENE_SUNSET] = item.get(SCENE_SUNSET)
    return data


class SceneExtrapolationStore:
    """Load and persist circadian scene configs."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store."""
        self.hass = hass
        self._store = Store(
            hass, STORAGE_VERSION, STORE_KEY, migrate_func=_migrate_store
        )
        self.scenes: dict[str, dict[str, Any]] = {}
        self.settings: dict[str, Any] = dict(DEFAULT_SETTINGS)
        # YAML scene CONF_ID values created by this integration.
        self.managed_native_scene_ids: list[str] = []
        # Set when v2 migration forced hide-on; setup applies registry sync once.
        self.pending_hide_sync = False

    async def async_load(self) -> None:
        """Load scenes from disk."""
        data = await self._store.async_load()
        raw = data or {}
        items = raw.get("scenes", [])
        self.scenes = {}
        for item in items:
            if "id" not in item:
                continue
            # Additive key: rooms saved before automatically_update_lights was added stay enabled.
            if AUTOMATICALLY_UPDATE_LIGHTS not in item:
                item[AUTOMATICALLY_UPDATE_LIGHTS] = True
            for alias in ("continuous", "follow_up"):
                item.pop(alias, None)
            self.scenes[item["id"]] = item
        settings = {
            **DEFAULT_SETTINGS,
            **(raw.get("settings") or {}),
        }
        for alias in ("continuous_interval", "follow_up_interval"):
            settings.pop(alias, None)
        self.settings = settings
        ids = raw.get("managed_native_scene_ids") or []
        self.managed_native_scene_ids = [str(item) for item in ids if item]
        # After migrate_func forces hide on, sync registry once at setup.
        if bool(self.settings.get("hide_managed_native_scenes")):
            self.pending_hide_sync = True

    async def async_save(self) -> None:
        """Write scenes to disk."""
        await self._store.async_save(
            {
                "scenes": list(self.scenes.values()),
                "settings": dict(self.settings),
                "managed_native_scene_ids": list(self.managed_native_scene_ids),
            }
        )

    def list(self) -> list[dict[str, Any]]:
        """Return all scene configs."""
        return list(self.scenes.values())

    def get(self, scene_id: str) -> dict[str, Any] | None:
        """Return one scene config."""
        return self.scenes.get(scene_id)

    async def async_upsert(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Create or update a scene config."""
        scene_id = raw.get("id")
        # Editor saves may omit automatically_update_lights; keep the play/pause preference.
        if scene_id and scene_id in self.scenes and AUTOMATICALLY_UPDATE_LIGHTS not in raw:
            raw = {
                **raw,
                AUTOMATICALLY_UPDATE_LIGHTS: self.scenes[scene_id].get(AUTOMATICALLY_UPDATE_LIGHTS, True),
            }
        item = normalize_scene_config(raw, scene_id=scene_id)
        self.scenes[item["id"]] = item
        await self.async_save()
        return item

    async def async_set_automatically_update_lights(
        self, scene_id: str, automatically_update_lights: bool
    ) -> dict[str, Any] | None:
        """Toggle per-scene automatic light-update preference without a full form save."""
        item = self.scenes.get(scene_id)
        if item is None:
            return None
        item[AUTOMATICALLY_UPDATE_LIGHTS] = bool(automatically_update_lights)
        await self.async_save()
        return item

    async def async_delete(self, scene_id: str) -> bool:
        """Delete a scene config."""
        if scene_id not in self.scenes:
            return False
        self.scenes.pop(scene_id)
        await self.async_save()
        return True

    async def async_update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        """Merge integration-wide settings and persist."""
        for key, value in patch.items():
            if key not in DEFAULT_SETTINGS:
                continue
            if key == "automatically_update_lights_interval":
                try:
                    value = int(value)
                except (TypeError, ValueError) as err:
                    raise HomeAssistantError(
                        "automatically_update_lights_interval must be an integer number of seconds"
                    ) from err
                # Panel offers 0–30 minutes; reject larger values so storage
                # cannot exceed what light.turn_on transitions support well.
                if value < 0 or value > 30 * 60:
                    raise HomeAssistantError(
                        "automatically_update_lights_interval must be between 0 and 1800 seconds"
                    )
            self.settings[key] = value
        await self.async_save()
        return dict(self.settings)

    async def async_register_managed_native_scene(self, config_id: str) -> None:
        """Remember a YAML scene id this integration created."""
        cid = str(config_id)
        if cid in self.managed_native_scene_ids:
            return
        self.managed_native_scene_ids.append(cid)
        await self.async_save()

    async def async_unregister_managed_native_scene(self, config_id: str) -> None:
        """Drop a managed YAML scene id after delete."""
        cid = str(config_id)
        if cid not in self.managed_native_scene_ids:
            return
        self.managed_native_scene_ids = [
            item for item in self.managed_native_scene_ids if item != cid
        ]
        await self.async_save()

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
