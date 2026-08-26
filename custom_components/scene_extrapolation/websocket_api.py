"""WebSocket API for the Scene Extrapolation panel."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er

from .const import (
    DATA_ADD_ENTITIES,
    DATA_CONFIG_ENTRY,
    DATA_ENTITIES,
    DATA_STORE,
    DOMAIN,
)
from .scene import async_create_or_update_entity, async_remove_entity
from .solar import build_sun_path
from .store import SceneExtrapolationStore, to_form_data

_LOGGER = logging.getLogger(__name__)


def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_delete)
    websocket_api.async_register_command(hass, ws_sun_path)


def _store(hass: HomeAssistant) -> SceneExtrapolationStore:
    return hass.data[DOMAIN][DATA_STORE]


def _list_payload(hass: HomeAssistant) -> list[dict[str, Any]]:
    area_reg = ar.async_get(hass)
    entity_reg = er.async_get(hass)
    payload = []
    for item in _store(hass).list():
        area_id = item.get("area")
        area_name = None
        if area_id and area_id in area_reg.areas:
            area_name = area_reg.areas[area_id].name
        entity_id = None
        for entry in entity_reg.entities.values():
            if entry.unique_id == item["id"] and entry.domain == "scene":
                entity_id = entry.entity_id
                break
        payload.append(
            {
                **item,
                "area_name": area_name,
                "entity_id": entity_id,
                "form": to_form_data(item),
            }
        )
    payload.sort(key=lambda item: (item.get("scene_name") or "").casefold())
    return payload


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list"})
@websocket_api.require_admin
@callback
def ws_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """List extrapolation scenes."""
    connection.send_result(msg["id"], _list_payload(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/get",
        vol.Required("scene_id"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Get one extrapolation scene."""
    item = _store(hass).get(msg["scene_id"])
    if item is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Scene not found")
        return
    connection.send_result(msg["id"], {**item, "form": to_form_data(item)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save",
        vol.Optional("scene_id"): str,
        vol.Required("data"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create or update an extrapolation scene."""
    raw = dict(msg["data"])
    if msg.get("scene_id"):
        raw["id"] = msg["scene_id"]
    try:
        item = await _store(hass).async_upsert(raw)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return

    if hass.data[DOMAIN].get(DATA_ADD_ENTITIES) is None:
        connection.send_error(
            msg["id"], "not_loaded", "Scene platform is not ready yet"
        )
        return

    await async_create_or_update_entity(
        hass,
        hass.data[DOMAIN][DATA_CONFIG_ENTRY],
        item,
        hass.data[DOMAIN][DATA_ADD_ENTITIES],
        hass.data[DOMAIN][DATA_ENTITIES],
    )
    connection.send_result(msg["id"], {**item, "form": to_form_data(item)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete",
        vol.Required("scene_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Delete an extrapolation scene."""
    scene_id = msg["scene_id"]
    deleted = await _store(hass).async_delete(scene_id)
    if not deleted:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Scene not found")
        return
    await async_remove_entity(hass.data[DOMAIN][DATA_ENTITIES], scene_id)
    connection.send_result(msg["id"], {"scene_id": scene_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/sun_path",
        vol.Optional("dusk_minimum"): int,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sun_path(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return today's solar events and elevation curve."""
    dusk_minimum = msg.get("dusk_minimum")
    payload = await hass.async_add_executor_job(build_sun_path, hass, dusk_minimum)
    connection.send_result(msg["id"], payload)
