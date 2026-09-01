"""WebSocket API for the Scene Extrapolation panel."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er

from .const import (
    DATA_ADD_ENTITIES,
    DATA_CONFIG_ENTRY,
    DATA_ENTITIES,
    DATA_STORE,
    DOMAIN,
)
from .native_scene import (
    apply_managed_native_scene_visibility,
    area_setup_info,
    async_apply_area_setup,
    async_apply_native_drafts,
    async_create_native_scene,
    async_delete_native_scene,
    async_rename_native_scene,
    async_update_native_scene_entities,
    async_update_native_scene_entity,
    list_managed_native_scenes,
)
from .preview import build_preview
from .scene import async_create_or_update_entity, async_remove_entity
from .solar import EVENT_ORDER, build_sun_path
from .store import SceneExtrapolationStore, to_form_data

_LOGGER = logging.getLogger(__name__)


def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_delete)
    websocket_api.async_register_command(hass, ws_sun_path)
    websocket_api.async_register_command(hass, ws_preview)
    websocket_api.async_register_command(hass, ws_update_native_scene)
    websocket_api.async_register_command(hass, ws_update_native_scenes)
    websocket_api.async_register_command(hass, ws_create_native_scene)
    websocket_api.async_register_command(hass, ws_rename_native_scene)
    websocket_api.async_register_command(hass, ws_delete_native_scene)
    websocket_api.async_register_command(hass, ws_apply_native_drafts)
    websocket_api.async_register_command(hass, ws_area_setup_info)
    websocket_api.async_register_command(hass, ws_apply_area_setup)
    websocket_api.async_register_command(hass, ws_list_managed_native_scenes)
    websocket_api.async_register_command(hass, ws_get_settings)
    websocket_api.async_register_command(hass, ws_update_settings)
    websocket_api.async_register_command(hass, ws_set_automatically_update_lights)


def _store(hass: HomeAssistant) -> SceneExtrapolationStore:
    return hass.data[DOMAIN][DATA_STORE]


def _registry_entry(hass: HomeAssistant, scene_id: str):
    entity_reg = er.async_get(hass)
    for registry_entry in entity_reg.entities.values():
        if registry_entry.unique_id == scene_id and registry_entry.domain == "scene":
            return registry_entry
    return None


def _form_payload(item: dict[str, Any], entry=None) -> dict[str, Any]:
    form = to_form_data(item)
    if entry:
        form["labels"] = list(entry.labels)
        form["category"] = (entry.categories or {}).get("scene")
    return form


def _list_payload(hass: HomeAssistant) -> list[dict[str, Any]]:
    area_reg = ar.async_get(hass)
    payload = []
    for item in _store(hass).list():
        area_id = item.get("area")
        area_name = None
        if area_id and area_id in area_reg.areas:
            area_name = area_reg.areas[area_id].name
        entry = _registry_entry(hass, item["id"])
        form = _form_payload(item, entry)
        payload.append(
            {
                **item,
                "area_name": area_name,
                "entity_id": entry.entity_id if entry else None,
                "labels": form.get("labels") or [],
                "category": form.get("category"),
                "form": form,
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
    entry = _registry_entry(hass, item["id"])
    connection.send_result(
        msg["id"],
        {
            **item,
            "entity_id": entry.entity_id if entry else None,
            "form": _form_payload(item, entry),
        },
    )


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
    entry = _registry_entry(hass, item["id"])
    connection.send_result(msg["id"], {**item, "form": _form_payload(item, entry)})


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
        vol.Optional("date"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sun_path(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return solar events and elevation curve for a date."""
    dusk_minimum = msg.get("dusk_minimum")
    payload = await hass.async_add_executor_job(
        build_sun_path, hass, dusk_minimum, msg.get("date")
    )
    connection.send_result(msg["id"], payload)


_OVERLAY_PATCH = {
    vol.Required("scene_entity_id"): str,
    vol.Optional("entity_id"): str,
    vol.Optional("entity_state"): dict,
    vol.Optional("remove"): bool,
    vol.Optional("deleted"): bool,
    vol.Optional("name"): str,
    vol.Optional("create_scene"): dict,
}


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/preview",
        vol.Optional("dusk_minimum"): int,
        vol.Optional("date"): str,
        vol.Optional("scenes"): dict,
        vol.Optional("overlay"): vol.Any(_OVERLAY_PATCH, [_OVERLAY_PATCH]),
        vol.Optional("area"): str,
        vol.Optional("location"): {
            vol.Required("latitude"): vol.All(
                vol.Coerce(float), vol.Range(min=-90, max=90)
            ),
            vol.Required("longitude"): vol.All(
                vol.Coerce(float), vol.Range(min=-180, max=180)
            ),
        },
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return sun path plus per-light brightness/color samples."""
    scenes = msg.get("scenes") or {}
    # Executor: preview samples are CPU-heavy; keep the event loop responsive
    # (year scrub settles with one of these after a client-side drag).
    payload = await hass.async_add_executor_job(
        lambda: build_preview(
            hass,
            dusk_minimum=msg.get("dusk_minimum"),
            target_date=msg.get("date"),
            scene_ids=scenes,
            overlay=msg.get("overlay"),
            location=msg.get("location"),
            area_id=msg.get("area") or None,
        )
    )
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/update_native_scene",
        vol.Required("scene_entity_id"): str,
        vol.Required("entity_id"): str,
        vol.Required("entity_state"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_native_scene(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Write one light into a native YAML scene and reload scenes."""
    try:
        payload = await async_update_native_scene_entity(
            hass,
            msg["scene_entity_id"],
            msg["entity_id"],
            msg["entity_state"],
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "update_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/update_native_scenes",
        vol.Required("entity_id"): str,
        vol.Required("updates"): [
            {
                vol.Required("scene_entity_id"): str,
                vol.Required("entity_state"): dict,
            }
        ],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_native_scenes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Write one light into several native YAML scenes and reload once."""
    try:
        payload = await async_update_native_scene_entities(
            hass,
            msg["entity_id"],
            [
                (item["scene_entity_id"], item["entity_state"])
                for item in msg["updates"]
            ],
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "update_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/create_native_scene",
        vol.Required("area_id"): str,
        vol.Required("event"): vol.In(list(EVENT_ORDER)),
        vol.Optional("linked"): bool,
        vol.Optional("write"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_create_native_scene(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create a native YAML scene for an area at one solar event."""
    try:
        payload = await async_create_native_scene(
            hass,
            msg["area_id"],
            msg["event"],
            linked=bool(msg.get("linked")),
            write=bool(msg.get("write", True)),
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "create_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/rename_native_scene",
        vol.Required("scene_entity_id"): str,
        vol.Required("name"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_rename_native_scene(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Rename a native YAML scene."""
    try:
        payload = await async_rename_native_scene(
            hass, msg["scene_entity_id"], msg["name"]
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "rename_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete_native_scene",
        vol.Required("scene_entity_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_native_scene(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Delete a native YAML scene."""
    try:
        payload = await async_delete_native_scene(hass, msg["scene_entity_id"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/apply_native_drafts",
        vol.Optional("creates"): [
            {
                vol.Required("draft_id"): str,
                vol.Required("name"): str,
                vol.Optional("icon"): str,
                vol.Optional("area_id"): str,
                vol.Optional("id"): str,
                vol.Optional("entities"): dict,
            }
        ],
        vol.Optional("renames"): [
            {
                vol.Required("scene_entity_id"): str,
                vol.Required("name"): str,
            }
        ],
        vol.Optional("deletes"): [str],
        vol.Optional("updates"): [
            {
                vol.Required("scene_entity_id"): str,
                vol.Required("entity_id"): str,
                vol.Required("entity_state"): dict,
            }
        ],
        vol.Optional("removes"): [
            {
                vol.Required("scene_entity_id"): str,
                vol.Required("entity_id"): str,
            }
        ],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_apply_native_drafts(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Write buffered native scene drafts in one YAML reload."""
    try:
        payload = await async_apply_native_drafts(
            hass,
            {
                "creates": msg.get("creates") or [],
                "renames": msg.get("renames") or [],
                "deletes": msg.get("deletes") or [],
                "updates": msg.get("updates") or [],
                "removes": msg.get("removes") or [],
            },
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "apply_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/area_setup_info",
        vol.Required("area_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_area_setup_info(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Lights + ranked native scenes for the create-scene wizard."""
    try:
        payload = area_setup_info(hass, msg["area_id"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "area_setup_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/apply_area_setup",
        vol.Required("area_id"): str,
        vol.Required("linked"): bool,
        vol.Required("assignments"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_apply_area_setup(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create Automatic native scenes and return resolved slot assignments."""
    try:
        payload = await async_apply_area_setup(
            hass,
            msg["area_id"],
            linked=bool(msg["linked"]),
            assignments=dict(msg.get("assignments") or {}),
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "area_setup_failed", str(err))
        return
    connection.send_result(msg["id"], payload)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/list_managed_native_scenes"}
)
@websocket_api.require_admin
@callback
def ws_list_managed_native_scenes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """List native scenes created by this integration."""
    connection.send_result(msg["id"], list_managed_native_scenes(hass))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_settings"})
@websocket_api.require_admin
@callback
def ws_get_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return integration-wide settings."""
    connection.send_result(msg["id"], dict(_store(hass).settings))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/update_settings",
        vol.Required("settings"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update integration-wide settings and apply visibility side effects."""
    store = _store(hass)
    before_hide = bool(store.settings.get("hide_managed_native_scenes"))
    before_interval = int(
        store.settings.get("automatically_update_lights_interval") or 0
    )
    settings = await store.async_update_settings(dict(msg.get("settings") or {}))
    after_hide = bool(settings.get("hide_managed_native_scenes"))
    after_interval = int(settings.get("automatically_update_lights_interval") or 0)
    updated = 0
    if before_hide != after_hide:
        updated = apply_managed_native_scene_visibility(hass, hidden=after_hide)
    if before_interval != after_interval:
        for entity in hass.data[DOMAIN][DATA_ENTITIES].values():
            entity.async_on_automatically_update_lights_settings_changed()
    connection.send_result(
        msg["id"],
        {"settings": settings, "visibility_updated": updated},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_automatically_update_lights",
        vol.Required("scene_id"): str,
        vol.Required("automatically_update_lights"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_automatically_update_lights(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Toggle per-scene automatic light-update preference (list play/pause). Does not activate."""
    item = await _store(hass).async_set_automatically_update_lights(
        msg["scene_id"], bool(msg["automatically_update_lights"])
    )
    if item is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Scene not found")
        return
    entity = hass.data[DOMAIN][DATA_ENTITIES].get(msg["scene_id"])
    if entity is not None:
        await entity.async_update_config(item)
    entry = _registry_entry(hass, item["id"])
    connection.send_result(
        msg["id"],
        {
            **item,
            "entity_id": entry.entity_id if entry else None,
            "form": _form_payload(item, entry),
        },
    )
