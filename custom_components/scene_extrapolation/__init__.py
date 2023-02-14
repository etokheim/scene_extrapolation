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

def setup(hass, config):
    """Set up is called when Home Assistant is loading our component."""

    def apply_lighting(call):
        """Handle the service call."""

        _LOGGER.info("Received a new service call!")
        _LOGGER.info(call)

        #name = call.data.get(ATTR_NAME, DEFAULT_NAME)

        #hass.states.set("hello_service.hello", name)

        # TODO:
        # 1. Parse the scenes.yaml file
        # 2. Find the best way to get scenes selected in the config flow
        # 3. Extrapolate the light color and brightness
        # 4. Apply the extrapolated values

    hass.services.register(DOMAIN, "apply_lighting", apply_lighting)

    # Return boolean to indicate that initialization was successful.
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
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

    # Cannot be setup inside the event loop - is there an async version of this? Or do we have
    # to use the non-async setup method?
    # hass.services.register(DOMAIN, "hello", handle_hello)

    # await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
    #     hass.data[DOMAIN].pop(entry.entry_id)

    # return unload_ok
    return True