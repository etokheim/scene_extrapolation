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

# Avoid circular import of DOMAIN store at module load — resolve via hass.data.
from .const import DATA_STORE, DOMAIN

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
    """On + brightness + color matching the solar event (or shared dimmed day)."""
    if event_id not in EVENT_ORDER:
        raise HomeAssistantError(f"Unknown solar event {event_id}")
    # Linked dawn/sunrise/sunset share a softer "Dimmed" profile (not noon).
    profile = "sunset" if linked and event_id in _DAY_EVENTS else event_id
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


async def _async_register_and_maybe_hide(
    hass: HomeAssistant, config_id: str, entity_id: str
) -> None:
    """Track a created YAML scene and honor the hide-from-UI setting."""
    store = hass.data[DOMAIN][DATA_STORE]
    await store.async_register_managed_native_scene(config_id)
    if store.settings.get("hide_managed_native_scenes"):
        er.async_get(hass).async_update_entity(
            entity_id, hidden_by=er.RegistryEntryHider.INTEGRATION
        )


def apply_managed_native_scene_visibility(hass: HomeAssistant, *, hidden: bool) -> int:
    """Hide or unhide all managed native scenes in the entity registry."""
    store = hass.data[DOMAIN][DATA_STORE]
    entity_reg = er.async_get(hass)
    hide_value = er.RegistryEntryHider.INTEGRATION if hidden else None
    updated = 0
    for config_id in list(store.managed_native_scene_ids):
        entity_id = _native_scene_entity_id(hass, config_id)
        if not entity_id:
            continue
        entry = entity_reg.async_get(entity_id)
        if entry is None:
            continue
        # Never override a user-hidden entity.
        if entry.hidden_by == er.RegistryEntryHider.USER:
            continue
        if entry.hidden_by == hide_value:
            continue
        entity_reg.async_update_entity(entity_id, hidden_by=hide_value)
        updated += 1
    return updated


def list_managed_native_scenes(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return native scenes this integration created (still present)."""
    store = hass.data[DOMAIN][DATA_STORE]
    area_reg = ar.async_get(hass)
    entity_reg = er.async_get(hass)
    rows: list[dict[str, Any]] = []
    for config_id in list(store.managed_native_scene_ids):
        entity_id = _native_scene_entity_id(hass, config_id)
        if not entity_id:
            continue
        entry = entity_reg.async_get(entity_id)
        scene = native_scene_by_entity_id(hass, entity_id)
        area_id = entry.area_id if entry else None
        area_name = None
        if area_id and area_id in area_reg.areas:
            area_name = area_reg.areas[area_id].name
        rows.append(
            {
                "id": config_id,
                "entity_id": entity_id,
                "name": (scene or {}).get("name")
                or (entry.name if entry else None)
                or (entry.original_name if entry else None)
                or entity_id,
                "area_id": area_id,
                "area_name": area_name,
                "hidden": bool(entry.hidden_by) if entry else False,
            }
        )
    rows.sort(key=lambda row: str(row.get("name") or "").casefold())
    return rows


def _scene_base_name(area_name: str, event_id: str, *, linked: bool) -> str:
    """Name for a newly created native scene."""
    if linked and event_id in _DAY_EVENTS:
        return f"{area_name} Dimmed"
    if event_id == "noon":
        return f"{area_name} Bright"
    if event_id == "dusk":
        return f"{area_name} Low lights"
    return f"{area_name} {_EVENT_LABEL[event_id]}"


def _scene_icon(event_id: str, *, linked: bool) -> str:
    if linked and event_id in _DAY_EVENTS:
        return _EVENT_ICON["sunset"]
    return _EVENT_ICON[event_id]


def average_light_brightness(entities: dict[str, Any]) -> float:
    """Mean brightness of light entities in a native scene (off = 0)."""
    values: list[float] = []
    for entity_id, state in entities.items():
        if not str(entity_id).startswith("light."):
            continue
        if not isinstance(state, dict):
            continue
        if state.get(ATTR_STATE) == "off" or state.get("state") == "off":
            values.append(0.0)
            continue
        brightness = state.get("brightness")
        if isinstance(brightness, (int, float)):
            values.append(float(brightness))
        elif state.get(ATTR_STATE) == "on" or state.get("state") == "on":
            values.append(255.0)
    if not values:
        return 0.0
    return sum(values) / len(values)


def native_scenes_in_area(hass: HomeAssistant, area_id: str) -> list[dict[str, Any]]:
    """Native HA scenes in an area, brightest first."""
    entity_reg = er.async_get(hass)
    results: list[dict[str, Any]] = []
    for entry in entity_reg.entities.values():
        if entry.domain != SCENE_DOMAIN or entry.disabled:
            continue
        if entry.area_id != area_id:
            continue
        # YAML / homeassistant platform only — skip extrapolation entities.
        if entry.platform and entry.platform != "homeassistant":
            continue
        scene = native_scene_by_entity_id(hass, entry.entity_id)
        if scene is None:
            continue
        entities = scene.get("entities") or {}
        results.append(
            {
                "entity_id": entry.entity_id,
                "name": scene.get("name")
                or entry.name
                or entry.original_name
                or entry.entity_id,
                "avg_brightness": average_light_brightness(entities),
            }
        )
    results.sort(
        key=lambda row: (-row["avg_brightness"], str(row["name"]).lower())
    )
    return results


def suggest_setup_assignments(
    scenes: list[dict[str, Any]], *, linked: bool
) -> dict[str, str | None]:
    """Map setup slots to existing scenes by brightness rank."""
    ranked = list(scenes)
    brightest = ranked[0]["entity_id"] if ranked else None
    second = ranked[1]["entity_id"] if len(ranked) > 1 else None
    lowest = ranked[-1]["entity_id"] if ranked else None
    if linked:
        return {
            "noon": brightest,
            "linked": second if second and second != brightest else None,
            "dusk": lowest
            if lowest and lowest not in {brightest, second}
            else None,
        }
    # Unlinked: still seed noon / a mid day / dusk; leave others empty→Automatic.
    return {
        "dawn": second if second and second != brightest else None,
        "sunrise": None,
        "noon": brightest,
        "sunset": None,
        "dusk": lowest
        if lowest and lowest not in {brightest, second}
        else None,
    }


def area_setup_info(hass: HomeAssistant, area_id: str) -> dict[str, Any]:
    """Lights + ranked native scenes for the create-scene wizard."""
    area = ar.async_get(hass).async_get_area(area_id)
    if area is None:
        raise HomeAssistantError(f"Unknown area {area_id}")
    lights = lights_in_area(hass, area_id)
    scenes = native_scenes_in_area(hass, area_id)
    return {
        "area_id": area_id,
        "area_name": area.name,
        "light_count": len(lights),
        "scenes": scenes,
        "suggestions_linked": suggest_setup_assignments(scenes, linked=True),
        "suggestions_unlinked": suggest_setup_assignments(scenes, linked=False),
    }


async def async_plan_native_scene(
    hass: HomeAssistant, area_id: str, event_id: str, *, linked: bool = False
) -> dict[str, Any]:
    """Build a native scene for an area without writing YAML."""
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
    base_name = _scene_base_name(area.name, event_id, linked=linked)
    icon = _scene_icon(event_id, linked=linked)
    path = hass.config.path(SCENE_CONFIG_PATH)
    current = await hass.async_add_executor_job(_read_scenes, path)
    name = _unique_scene_name(current, base_name)
    stamp = str(int(time.time() * 1000))
    return {
        "entity_id": f"scene.__se_draft_{stamp}",
        "name": name,
        "icon": icon,
        "id": stamp,
        "entities": entities,
        "light_count": len(lights),
        "area_id": area_id,
    }


# Sentinel for create-wizard slots that should mint a new native scene.
SETUP_AUTOMATIC = "automatic"


async def async_apply_area_setup(
    hass: HomeAssistant,
    area_id: str,
    *,
    linked: bool,
    assignments: dict[str, str | None],
) -> dict[str, Any]:
    """Create Automatic native scenes and resolve wizard slot → entity ids.

    assignments keys:
      linked: noon, linked, dusk
      unlinked: dawn, sunrise, noon, sunset, dusk
    Values: entity id, \"automatic\", or null/omit (treated as automatic).
    """
    info = area_setup_info(hass, area_id)
    if info["light_count"] <= 0:
        raise HomeAssistantError(
            "This area has no lights. Add lights to the area in Home Assistant "
            "before creating an extrapolation scene."
        )

    if linked:
        slots = ("noon", "linked", "dusk")
    else:
        slots = ("dawn", "sunrise", "noon", "sunset", "dusk")

    resolved: dict[str, str | None] = {}
    to_create: list[tuple[str, str, bool]] = []
    # (slot, event_id, linked_flag)
    for slot in slots:
        raw = assignments.get(slot)
        if raw and raw != SETUP_AUTOMATIC:
            resolved[slot] = raw
            continue
        if slot == "linked":
            to_create.append((slot, "dawn", True))
        else:
            to_create.append((slot, slot, False))

    created_by_slot: dict[str, dict[str, Any]] = {}
    if to_create:
        path = hass.config.path(SCENE_CONFIG_PATH)
        async with _WRITE_LOCK:
            current = await hass.async_add_executor_job(_read_scenes, path)
            planned_rows: list[tuple[str, dict[str, Any]]] = []
            for slot, event_id, link_flag in to_create:
                planned = await async_plan_native_scene(
                    hass, area_id, event_id, linked=link_flag
                )
                # Uniquify against disk + scenes already queued in this batch.
                base = _scene_base_name(
                    info["area_name"], event_id, linked=link_flag
                )
                planned["name"] = _unique_scene_name(current, base)
                current.append(
                    {
                        CONF_ID: planned["id"],
                        "name": planned["name"],
                        "icon": planned["icon"],
                        "entities": planned["entities"],
                    }
                )
                planned_rows.append((slot, planned))
            await hass.async_add_executor_job(_write_scenes, path, current)

        await hass.services.async_call(
            SCENE_DOMAIN, SERVICE_RELOAD, blocking=True
        )
        entity_reg = er.async_get(hass)
        for slot, planned in planned_rows:
            entity_id = _native_scene_entity_id(hass, planned["id"])
            if not entity_id:
                raise HomeAssistantError(
                    f"Created scene {planned['name']!r} but Home Assistant "
                    "did not register it"
                )
            entity_reg.async_update_entity(entity_id, area_id=area_id)
            await _async_register_and_maybe_hide(hass, planned["id"], entity_id)
            created_by_slot[slot] = {
                "entity_id": entity_id,
                "name": planned["name"],
                "light_count": planned["light_count"],
            }
            resolved[slot] = entity_id

    return {
        "linked": linked,
        "assignments": resolved,
        "created": created_by_slot,
        "area_id": area_id,
        "area_name": info["area_name"],
        "light_count": info["light_count"],
    }


async def async_create_native_scene(
    hass: HomeAssistant,
    area_id: str,
    event_id: str,
    *,
    linked: bool = False,
    write: bool = True,
) -> dict[str, Any]:
    """Create a YAML scene for an area's lights at one solar event.

    write=False only plans (draft id). The picker needs a real entity, so
    the panel always writes immediately.
    """
    planned = await async_plan_native_scene(
        hass, area_id, event_id, linked=linked
    )
    if not write:
        return planned
    path = hass.config.path(SCENE_CONFIG_PATH)
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        name = _unique_scene_name(current, planned["name"])
        current.append(
            {
                CONF_ID: planned["id"],
                "name": name,
                "icon": planned["icon"],
                "entities": planned["entities"],
            }
        )
        await hass.async_add_executor_job(_write_scenes, path, current)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    entity_id = _native_scene_entity_id(hass, planned["id"])
    if not entity_id:
        raise HomeAssistantError(
            f"Created scene {name!r} but Home Assistant did not register it"
        )
    er.async_get(hass).async_update_entity(entity_id, area_id=area_id)
    await _async_register_and_maybe_hide(hass, planned["id"], entity_id)
    return {
        **planned,
        "entity_id": entity_id,
        "name": name,
    }


async def async_apply_native_drafts(
    hass: HomeAssistant, drafts: dict[str, Any]
) -> dict[str, Any]:
    """Write buffered create/rename/delete/entity edits in one YAML reload."""
    creates = list(drafts.get("creates") or [])
    renames = list(drafts.get("renames") or [])
    deletes = list(drafts.get("deletes") or [])
    updates = list(drafts.get("updates") or [])
    removes = list(drafts.get("removes") or [])
    if not (creates or renames or deletes or updates or removes):
        return {"created": {}}

    delete_keys: set[str] = set()
    rename_by_key: dict[str, str] = {}
    entity_ops: dict[str, list[tuple[str, dict[str, Any] | None]]] = {}

    def yaml_key(scene_entity_id: str) -> str:
        scene = native_scene_by_entity_id(hass, scene_entity_id)
        if scene is None or not scene.get("id"):
            raise HomeAssistantError(
                f"{scene_entity_id} is not a native Home Assistant scene"
            )
        return str(scene["id"])

    for scene_entity_id in deletes:
        delete_keys.add(yaml_key(scene_entity_id))
    for item in renames:
        key = yaml_key(item["scene_entity_id"])
        if key not in delete_keys:
            rename_by_key[key] = str(item["name"]).strip()
    for item in updates:
        key = yaml_key(item["scene_entity_id"])
        if key in delete_keys:
            continue
        entity_ops.setdefault(key, []).append(
            (item["entity_id"], scene_entity_payload(item["entity_state"]))
        )
    for item in removes:
        key = yaml_key(item["scene_entity_id"])
        if key in delete_keys:
            continue
        entity_ops.setdefault(key, []).append((item["entity_id"], None))

    path = hass.config.path(SCENE_CONFIG_PATH)
    created_ids: list[tuple[str, str, str]] = []
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        next_scenes: list[dict[str, Any]] = []
        for item in current:
            key = str(item.get(CONF_ID))
            if key in delete_keys:
                continue
            updated = dict(item)
            if key in rename_by_key:
                updated["name"] = rename_by_key[key]
            if key in entity_ops:
                entities = dict(updated.get("entities") or {})
                for entity_id, payload in entity_ops[key]:
                    if payload is None:
                        entities.pop(entity_id, None)
                    else:
                        entities[entity_id] = payload
                updated["entities"] = entities
            next_scenes.append(updated)
        for create in creates:
            name = _unique_scene_name(next_scenes, str(create["name"]).strip())
            config_id = str(create.get("id") or int(time.time() * 1000))
            entities = {
                entity_id: scene_entity_payload(state)
                for entity_id, state in (create.get("entities") or {}).items()
            }
            item = {
                CONF_ID: config_id,
                "name": name,
                "entities": entities,
            }
            if create.get("icon"):
                item["icon"] = create["icon"]
            next_scenes.append(item)
            created_ids.append(
                (str(create["draft_id"]), config_id, str(create.get("area_id") or ""))
            )
        await hass.async_add_executor_job(_write_scenes, path, next_scenes)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    created: dict[str, str] = {}
    entity_reg = er.async_get(hass)
    for draft_id, config_id, area_id in created_ids:
        entity_id = _native_scene_entity_id(hass, config_id)
        if not entity_id:
            raise HomeAssistantError(
                f"Created scene {draft_id} but Home Assistant did not register it"
            )
        if area_id:
            entity_reg.async_update_entity(entity_id, area_id=area_id)
        await _async_register_and_maybe_hide(hass, config_id, entity_id)
        created[draft_id] = entity_id
    return {"created": created}


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
    store = hass.data[DOMAIN][DATA_STORE]
    await store.async_unregister_managed_native_scene(str(config_key))
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
