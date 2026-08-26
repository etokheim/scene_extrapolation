"""Read and persist one entity inside a native Home Assistant YAML scene."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN
from homeassistant.config import SCENE_CONFIG_PATH
from homeassistant.const import ATTR_STATE, CONF_ID, SERVICE_RELOAD
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.file import write_utf8_file_atomic
from homeassistant.util.yaml import dump, load_yaml

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

    cleaned = scene_entity_payload(entity_state)
    path = hass.config.path(SCENE_CONFIG_PATH)
    async with _WRITE_LOCK:
        current = await hass.async_add_executor_job(_read_scenes, path)
        updated = False
        for index, item in enumerate(current):
            if str(item.get(CONF_ID)) != str(config_key):
                continue
            entities = dict(item.get("entities") or {})
            entities[light_entity_id] = cleaned
            current[index] = {**item, "entities": entities}
            updated = True
            break
        if not updated:
            raise HomeAssistantError(
                f"Scene id {config_key} was not found in {SCENE_CONFIG_PATH}"
            )
        await hass.async_add_executor_job(_write_scenes, path, current)

    await hass.services.async_call(SCENE_DOMAIN, SERVICE_RELOAD, blocking=True)
    _LOGGER.debug(
        "Updated %s in native scene %s (%s)",
        light_entity_id,
        config_key,
        scene_entity_id,
    )
    return {"scene_entity_id": scene_entity_id, "entity_id": light_entity_id}


def _read_scenes(path: str) -> list[dict[str, Any]]:
    data = load_yaml(path)
    if data is None:
        return []
    if not isinstance(data, list):
        raise HomeAssistantError(f"{SCENE_CONFIG_PATH} must be a list of scenes")
    return data


def _write_scenes(path: str, data: list[dict[str, Any]]) -> None:
    write_utf8_file_atomic(path, dump(data))
