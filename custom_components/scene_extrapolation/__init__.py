"""The Scene Extrapolation integration."""

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector

from .const import (
    AREA,
    DATA_ADD_ENTITIES,
    DATA_CONFIG_ENTRY,
    DATA_ENTITIES,
    DATA_STORE,
    DOMAIN,
    SCENE_NAME,
)
from .panel import async_setup_panel, async_unload_panel
from .store import SceneExtrapolationStore
from .websocket_api import async_setup_websocket

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SCENE]

SERVICE_TURN_ON = "turn_on"
ATTR_BRIGHTNESS_MODIFIER = "brightness_modifier"
ATTR_TRANSITION = "transition"
ATTR_TRANSITION_MODIFIER = "transition_modifier"
ATTR_TARGET_DATE_TIME = "target_date_time"
ATTR_LOCATION = "location"


async def async_setup(hass, config):
    """Set up is called when Home Assistant is loading our component."""

    async def handle_turn_on(call):
        """Handle the turn_on service call."""
        entity_ids = call.data.get("entity_id", [])
        brightness_modifier = call.data.get(ATTR_BRIGHTNESS_MODIFIER, 0)
        transition = call.data.get(ATTR_TRANSITION, 0)
        transition_modifier = call.data.get(ATTR_TRANSITION_MODIFIER, 0)
        target_date_time = call.data.get(ATTR_TARGET_DATE_TIME)
        location = call.data.get(ATTR_LOCATION)

        if not -100 <= brightness_modifier <= 100:
            _LOGGER.error(
                "Brightness modifier must be between -100 and 100, got %s",
                brightness_modifier,
            )
            return

        if not 0 <= transition <= 6553:
            _LOGGER.error(
                "Transition must be between 0 and 6553 seconds, got %s",
                transition,
            )
            return

        if not -100 <= transition_modifier <= 100:
            _LOGGER.error(
                "Transition modifier must be between -100 and 100, got %s",
                transition_modifier,
            )
            return

        for entity_id in entity_ids:
            if not entity_id.startswith("scene."):
                continue
            scene_entity = hass.states.get(entity_id)
            if not scene_entity:
                _LOGGER.error("Scene entity %s not found in states", entity_id)
                continue
            scene_platform = hass.data.get("scene")
            if not scene_platform:
                _LOGGER.error("Scene platform not found")
                continue
            for scene in scene_platform.entities:
                if scene.entity_id == entity_id:
                    await scene.async_activate(
                        transition=transition,
                        brightness_modifier=brightness_modifier,
                        transition_modifier=transition_modifier,
                        target_date_time=target_date_time,
                        location=location,
                    )
                    break
            else:
                _LOGGER.error("Scene entity %s not found", entity_id)

    hass.services.async_register(
        DOMAIN,
        SERVICE_TURN_ON,
        handle_turn_on,
        schema=vol.Schema(
            {
                vol.Required("entity_id"): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="scene",
                        integration="scene_extrapolation",
                        multiple=True,
                    )
                ),
                vol.Optional(
                    ATTR_BRIGHTNESS_MODIFIER, default=0
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=-100,
                        max=100,
                        step=1,
                        unit_of_measurement="%",
                        mode="slider",
                    )
                ),
                vol.Optional(ATTR_TRANSITION, default=0): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=0,
                        max=6553,
                        step=1,
                        unit_of_measurement="s",
                        mode="slider",
                    )
                ),
                vol.Optional(
                    ATTR_TRANSITION_MODIFIER, default=0
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=-100,
                        max=100,
                        step=1,
                        unit_of_measurement="%",
                        mode="slider",
                    )
                ),
                vol.Optional(ATTR_TARGET_DATE_TIME): selector.DateTimeSelector(
                    selector.DateTimeSelectorConfig()
                ),
                vol.Optional(ATTR_LOCATION): selector.LocationSelector(),
            }
        ),
    )

    return True


async def async_migrate_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Keep older config entries loadable after the single-instance flow."""
    if config_entry.version < 2:
        hass.config_entries.async_update_entry(config_entry, version=2)
    return True


def _is_legacy_entry(entry: ConfigEntry) -> bool:
    return SCENE_NAME in entry.data or AREA in entry.data or "unique_id" in entry.data


async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Set up Scene Extrapolation from a config entry."""
    domain_data = hass.data.setdefault(
        DOMAIN,
        {
            DATA_STORE: SceneExtrapolationStore(hass),
            DATA_ENTITIES: {},
            DATA_ADD_ENTITIES: None,
            DATA_CONFIG_ENTRY: None,
            "websocket_setup": False,
            "panel_setup": False,
            "store_loaded": False,
        },
    )

    store: SceneExtrapolationStore = domain_data[DATA_STORE]
    if not domain_data["store_loaded"]:
        await store.async_load()
        domain_data["store_loaded"] = True

    if _is_legacy_entry(config_entry):
        await store.async_import_legacy(
            dict(config_entry.data), dict(config_entry.options)
        )

    if domain_data[DATA_CONFIG_ENTRY] is not None:
        hass.async_create_task(hass.config_entries.async_remove(config_entry.entry_id))
        return True

    domain_data[DATA_CONFIG_ENTRY] = config_entry
    hass.async_create_task(_async_normalize_primary_entry(hass, config_entry.entry_id))

    if not domain_data["websocket_setup"]:
        async_setup_websocket(hass)
        domain_data["websocket_setup"] = True

    if not domain_data["panel_setup"]:
        await async_setup_panel(hass)
        domain_data["panel_setup"] = True

    await hass.config_entries.async_forward_entry_setups(config_entry, PLATFORMS)
    return True


async def _async_normalize_primary_entry(hass: HomeAssistant, entry_id: str) -> None:
    """Collapse a migrated entry to the single-instance shape after setup."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None:
        return
    if entry.data or entry.options or entry.unique_id != DOMAIN:
        hass.config_entries.async_update_entry(
            entry,
            unique_id=DOMAIN,
            title="Scene Extrapolation",
            data={},
            options={},
        )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    domain_data = hass.data.get(DOMAIN)
    if not domain_data or domain_data.get(DATA_CONFIG_ENTRY) is not entry:
        return True

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        await async_unload_panel(hass)
        hass.data.pop(DOMAIN, None)
    return unload_ok
