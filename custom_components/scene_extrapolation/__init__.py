"""The Scene Extrapolation integration."""
from __future__ import annotations

import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation, entity_platform, service

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DOMAIN = "scene_extrapolation"

ATTR_NAME = "name"
DEFAULT_NAME = "World"

PLATFORMS: list[Platform] = [Platform.SCENE]

async def async_setup(hass, config):
    """Set up is called when Home Assistant is loading our component."""

    # Return boolean to indicate that initialization was successful.
    return True

async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Set up Scene Extrapolation from a config entry."""

    # hass.data.setdefault(DOMAIN, {})

    # platform = entity_platform.async_get_current_platform()

    # # This will call Entity.set_sleep_timer(sleep_time=VALUE)
    # platform.async_register_entity_service(
    #     SERVICE_SET_TIMER,
    #     {
    #         vol.Required('sleep_time'): config_validation.time_period,
    #     },
    #     "set_sleep_timer",
    # )

    await hass.config_entries.async_forward_entry_setups(config_entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    #if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
    #    hass.data[DOMAIN].pop(entry.entry_id)

    #return unload_ok
    return True