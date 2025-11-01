"""The Scene Extrapolation integration."""

from __future__ import annotations

import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation, entity_platform, service, selector

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DOMAIN = "scene_extrapolation"

ATTR_NAME = "name"
DEFAULT_NAME = "World"

PLATFORMS: list[Platform] = [Platform.SCENE]

SERVICE_TURN_ON = "turn_on"
ATTR_BRIGHTNESS_MODIFIER = "brightness_modifier"
ATTR_TRANSITION = "transition"
ATTR_TRANSITION_MODIFIER = "transition_modifier"
ATTR_TARGET_DATE_TIME = "target_date_time"


async def async_setup(hass, config):
    """Set up is called when Home Assistant is loading our component."""

    async def handle_turn_on(call):
        """Handle the turn_on service call."""
        entity_ids = call.data.get("entity_id", [])
        brightness_modifier = call.data.get(ATTR_BRIGHTNESS_MODIFIER, 0)
        transition = call.data.get(ATTR_TRANSITION, 0)
        transition_modifier = call.data.get(ATTR_TRANSITION_MODIFIER, 0)
        target_date_time = call.data.get(ATTR_TARGET_DATE_TIME)

        # Validate brightness modifier range
        if not -100 <= brightness_modifier <= 100:
            _LOGGER.error(
                "Brightness modifier must be between -100 and 100, got %s",
                brightness_modifier,
            )
            return

        # Validate transition range
        if not 0 <= transition <= 6553:
            _LOGGER.error(
                "Transition must be between 0 and 6553 seconds, got %s",
                transition,
            )
            return

        # Validate transition modifier range
        if not -100 <= transition_modifier <= 100:
            _LOGGER.error(
                "Transition modifier must be between -100 and 100, got %s",
                transition_modifier,
            )
            return

        # Activate each extrapolation scene with brightness modifier and transition modifier
        for entity_id in entity_ids:
            if entity_id.startswith("scene."):
                _LOGGER.debug(
                    "Activating scene %s with brightness modifier %s, transition %s, and transition modifier %s",
                    entity_id,
                    brightness_modifier,
                    transition,
                    transition_modifier,
                )

                # Get the scene entity and call its async_activate method directly
                scene_entity = hass.states.get(entity_id)
                if scene_entity:
                    # Find the actual scene entity object in the scene platform
                    scene_platform = hass.data.get("scene")
                    if scene_platform:
                        for scene in scene_platform.entities:
                            if scene.entity_id == entity_id:
                                await scene.async_activate(
                                    transition=transition,
                                    brightness_modifier=brightness_modifier,
                                    transition_modifier=transition_modifier,
                                    target_date_time=target_date_time,
                                )
                                break
                        else:
                            _LOGGER.error("Scene entity %s not found", entity_id)
                    else:
                        _LOGGER.error("Scene platform not found")
                else:
                    _LOGGER.error("Scene entity %s not found in states", entity_id)

    # Register the service
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
            }
        ),
    )

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
    # if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
    #    hass.data[DOMAIN].pop(entry.entry_id)

    # return unload_ok
    return True
