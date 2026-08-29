"""Read and persist one entity inside a native Home Assistant YAML scene."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN
from homeassistant.config import SCENE_CONFIG_PATH
from homeassistant.const import ATTR_STATE, CONF_ID, SERVICE_RELOAD
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util.color import color_temperature_to_hs
from homeassistant.util.file import write_utf8_file_atomic
from homeassistant.util.yaml import dump, load_yaml

from .solar import EVENT_META, EVENT_ORDER

_LOGGER = logging.getLogger(__name__)

# Same keys HA's scene editor writes. color_mode is live-only.
SCENE_ENTITY_KEYS = (
    ATTR_STATE,
    "brightness",
    "color_temp_kelvin",
    "hs_color",
    "rgb_color",
    "rgbw_color",
    "rgbww_color",
    "effect",
)

_WRITE_LOCK = asyncio.Lock()

# Same grouping as the panel LINKED_EVENTS: one daytime scene.
_DAY_EVENTS = frozenset({"dawn", "sunrise", "sunset"})
_EVENT_LABEL = {event_id: label for event_id, label, _icon in EVENT_META}
_EVENT_ICON = {event_id: icon for event_id, _label, icon in EVENT_META}
# Circadian starting points: cool/bright by day, warm/dim in the evening.
# Brightness is HA scene scale 0–255. Kelvin is the intent; HS-only lamps
# get the same temperature converted.
EVENT_LIGHT_DEFAULTS = {
    "dawn": (102, 2700),
    "sunrise": (191, 3500),
    "noon": (255, 4500),
    "sunset": (179, 3000),
    "dusk": (64, 2200),
}
_HS_MODES = frozenset({"hs", "xy", "rgb", "rgbw", "rgbww"})


def _jsonable(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


def scene_entity_payload(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Strip live-only attributes down to what a YAML scene stores."""
    if not raw:
        return {ATTR_STATE: "off"}
    payload: dict[str, Any] = {}
    state = raw.get(ATTR_STATE) or raw.get("state") or "off"
    payload[ATTR_STATE] = state
    for key in SCENE_ENTITY_KEYS:
        if key == ATTR_STATE:
            continue
        value = raw.get(key)
        if value is None or value == "none":
            continue
        payload[key] = _jsonable(value)
    return payload


def native_scene_by_entity_id(
    hass: HomeAssistant, scene_entity_id: str
) -> dict[str, Any] | None:
    """Return a native YAML scene's id, name, icon, and entities."""
    scene_component = hass.data.get("scene")
    if not scene_component:
        return None
    for entity in scene_component.entities:
        if entity.entity_id != scene_entity_id:
            continue
        if not isinstance(entity, HomeAssistantScene) or not hasattr(
            entity, "scene_config"
        ):
            return None
        scene_config = entity.scene_config
        entities: dict[str, dict[str, Any]] = {}
        for entity_id, state in scene_config.states.items():
            entities[entity_id] = scene_entity_payload(
                {"state": state.state, **state.attributes}
            )
        return {
            "id": scene_config.id,
            "name": scene_config.name,
            "icon": getattr(scene_config, "icon", None),
            "entity_id": entity.entity_id,
            "entities": entities,
        }
    return None


async def async_update_native_scene_entity(
    hass: HomeAssistant,
    scene_entity_id: str,
    light_entity_id: str,
    entity_state: dict[str, Any],
) -> dict[str, Any]:
    """Merge one light into a native scene and reload scenes.yaml."""
    result = await async_update_native_scene_entities(
        hass,
        light_entity_id,
        [(scene_entity_id, entity_state)],
    )
    return {
        "scene_entity_id": scene_entity_id,
        "entity_id": result["entity_id"],
    }


async def async_update_native_scene_entities(
    hass: HomeAssistant,
    light_entity_id: str,
    updates: list[tuple[str, dict[str, Any]]],
) -> dict[str, Any]:
    """Merge one light into several native scenes, then reload scenes.yaml once."""
    if not updates:
        raise HomeAssistantError("No scene updates to write")

    resolved: list[tuple[str, str, dict[str, Any]]] = []
    for scene_entity_id, entity_state in updates:
        scene = native_scene_by_entity_id(hass, scene_entity_id)
        if scene is None:
            raise HomeAssistantError(
                f"{scene_entity_id} is not a native Home Assistant scene"
            )
        config_key = scene.get("id")
        if not config_key:
            raise HomeAssistantError(
                f"{scene_entity_id} has no YAML id, so it cannot be edited here"
            )
        resolved.append(
            (str(config_key), scene_entity_id, scene_entity_payload(entity_state))
        )

    path = hass.config.path(SCENE_CONFIG_PATH)
    remaining = {key: (sid, payload) for key, sid, payload in resolved}
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        for index, item in enumerate(current):
            key = str(item.get(CONF_ID))
            if key not in remaining:
                continue
            _scene_entity_id, cleaned = remaining.pop(key)
            entities = dict(item.get("entities") or {})
            entities[light_entity_id] = cleaned
            current[index] = {**item, "entities": entities}
        if remaining:
            missing_id = next(iter(remaining.values()))[0]
            raise HomeAssistantError(
                f"Scene {missing_id} was not found in {SCENE_CONFIG_PATH}"
            )
        await hass.async_add_executor_job(_write_scenes, path, current)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    scene_entity_ids = [scene_entity_id for _, scene_entity_id, _ in resolved]
    _LOGGER.debug(
        "Updated %s in native scenes %s",
        light_entity_id,
        scene_entity_ids,
    )
    return {"entity_id": light_entity_id, "scene_entity_ids": scene_entity_ids}


def lights_in_area(hass: HomeAssistant, area_id: str) -> list[str]:
    """Return enabled light entity ids in an area (entity area, else device)."""
    entity_reg = er.async_get(hass)
    device_reg = dr.async_get(hass)
    device_ids = {
        device.id
        for device in device_reg.devices.values()
        if device.area_id == area_id
    }
    lights: list[str] = []
    for entry in entity_reg.entities.values():
        if entry.domain != "light" or entry.disabled or entry.hidden_by:
            continue
        if entry.entity_category is not None:
            continue
        if entry.area_id == area_id or (
            entry.area_id is None and entry.device_id in device_ids
        ):
            lights.append(entry.entity_id)
    return sorted(lights)


def light_state_for_event(
    hass: HomeAssistant, entity_id: str, event_id: str, *, linked: bool = False
) -> dict[str, Any]:
    """On + brightness + color matching the solar event (or shared day)."""
    if event_id not in EVENT_ORDER:
        raise HomeAssistantError(f"Unknown solar event {event_id}")
    profile = "noon" if linked and event_id in _DAY_EVENTS else event_id
    brightness, kelvin = EVENT_LIGHT_DEFAULTS[profile]
    state = hass.states.get(entity_id)
    attrs = state.attributes if state else {}
    modes = set(attrs.get("supported_color_modes") or [])
    payload: dict[str, Any] = {ATTR_STATE: "on"}
    if modes and modes <= {"onoff"}:
        return payload
    payload["brightness"] = brightness
    supports_temp = (
        "color_temp" in modes
        or "rgbww" in modes
        or attrs.get("min_color_temp_kelvin") is not None
    )
    if supports_temp:
        min_k = attrs.get("min_color_temp_kelvin")
        max_k = attrs.get("max_color_temp_kelvin")
        value = kelvin
        # Lamp range is a capability, not a clamp of our own math.
        if min_k is not None and value < min_k:
            value = min_k
        if max_k is not None and value > max_k:
            value = max_k
        payload["color_temp_kelvin"] = int(value)
        return payload
    if not modes or modes & _HS_MODES:
        hue, sat = color_temperature_to_hs(float(kelvin))
        payload["hs_color"] = [round(float(hue), 3), round(float(sat), 3)]
    return payload


def _unique_scene_name(current: list[dict[str, Any]], base: str) -> str:
    names = {str(item.get("name") or "") for item in current}
    if base not in names:
        return base
    index = 2
    while f"{base} {index}" in names:
        index += 1
    return f"{base} {index}"


def _native_scene_entity_id(hass: HomeAssistant, config_id: str) -> str | None:
    entity_reg = er.async_get(hass)
    entity_id = entity_reg.async_get_entity_id(
        SCENE_DOMAIN, "homeassistant", config_id
    )
    if entity_id:
        return entity_id
    scene_component = hass.data.get("scene")
    if not scene_component:
        return None
    for entity in scene_component.entities:
        if not isinstance(entity, HomeAssistantScene):
            continue
        unique_id = getattr(entity, "unique_id", None)
        if str(unique_id) == str(config_id):
            return entity.entity_id
    return None


async def async_create_native_scene(
    hass: HomeAssistant, area_id: str, event_id: str, *, linked: bool = False
) -> dict[str, Any]:
    """Create a YAML scene for an area's lights at one solar event."""
    if event_id not in EVENT_ORDER:
        raise HomeAssistantError(f"Unknown solar event {event_id}")
    area = ar.async_get(hass).async_get_area(area_id)
    if area is None:
        raise HomeAssistantError(f"Unknown area {area_id}")
    lights = lights_in_area(hass, area_id)
    entities = {
        entity_id: light_state_for_event(
            hass, entity_id, event_id, linked=linked
        )
        for entity_id in lights
    }
    if linked and event_id in _DAY_EVENTS:
        base_name = f"{area.name} Day"
        icon = _EVENT_ICON["noon"]
    else:
        base_name = f"{area.name} {_EVENT_LABEL[event_id]}"
        icon = _EVENT_ICON[event_id]
    config_id = str(int(time.time() * 1000))
    path = hass.config.path(SCENE_CONFIG_PATH)
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        name = _unique_scene_name(current, base_name)
        current.append(
            {
                CONF_ID: config_id,
                "name": name,
                "icon": icon,
                "entities": entities,
            }
        )
        await hass.async_add_executor_job(_write_scenes, path, current)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    entity_id = _native_scene_entity_id(hass, config_id)
    if not entity_id:
        raise HomeAssistantError(
            f"Created scene {name!r} but Home Assistant did not register it"
        )
    er.async_get(hass).async_update_entity(entity_id, area_id=area_id)
    _LOGGER.debug(
        "Created native scene %s (%s) with %s lights in %s",
        entity_id,
        name,
        len(lights),
        area_id,
    )
    return {
        "entity_id": entity_id,
        "name": name,
        "id": config_id,
        "light_count": len(lights),
    }


async def async_rename_native_scene(
    hass: HomeAssistant, scene_entity_id: str, name: str
) -> dict[str, Any]:
    """Rename a native YAML scene."""
    cleaned = name.strip()
    if not cleaned:
        raise HomeAssistantError("Scene name is required")
    scene = native_scene_by_entity_id(hass, scene_entity_id)
    if scene is None:
        raise HomeAssistantError(
            f"{scene_entity_id} is not a native Home Assistant scene"
        )
    config_key = scene.get("id")
    if not config_key:
        raise HomeAssistantError(
            f"{scene_entity_id} has no YAML id, so it cannot be renamed here"
        )
    path = hass.config.path(SCENE_CONFIG_PATH)
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        found = False
        for index, item in enumerate(current):
            if str(item.get(CONF_ID)) != str(config_key):
                continue
            current[index] = {**item, "name": cleaned}
            found = True
            break
        if not found:
            raise HomeAssistantError(
                f"Scene {config_key} was not found in {SCENE_CONFIG_PATH}"
            )
        await hass.async_add_executor_job(_write_scenes, path, current)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    entity_id = _native_scene_entity_id(hass, str(config_key)) or scene_entity_id
    return {"entity_id": entity_id, "name": cleaned}


async def async_delete_native_scene(
    hass: HomeAssistant, scene_entity_id: str
) -> dict[str, Any]:
    """Remove a native YAML scene."""
    scene = native_scene_by_entity_id(hass, scene_entity_id)
    if scene is None:
        raise HomeAssistantError(
            f"{scene_entity_id} is not a native Home Assistant scene"
        )
    config_key = scene.get("id")
    if not config_key:
        raise HomeAssistantError(
            f"{scene_entity_id} has no YAML id, so it cannot be deleted here"
        )
    path = hass.config.path(SCENE_CONFIG_PATH)
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        updated = [
            item for item in current if str(item.get(CONF_ID)) != str(config_key)
        ]
        if len(updated) == len(current):
            raise HomeAssistantError(
                f"Scene {config_key} was not found in {SCENE_CONFIG_PATH}"
            )
        await hass.async_add_executor_job(_write_scenes, path, updated)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    return {"scene_entity_id": scene_entity_id}


def _read_scenes(path: str) -> list[dict[str, Any]]:
    data = load_yaml(path)
    if data is None:
        return []
    if not isinstance(data, list):
        raise HomeAssistantError(f"{SCENE_CONFIG_PATH} must be a list of scenes")
    return data


def _write_scenes(path: str, data: list[dict[str, Any]]) -> None:
    write_utf8_file_atomic(path, dump(data))
