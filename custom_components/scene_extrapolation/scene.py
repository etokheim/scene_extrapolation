"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.scene import Scene

_LOGGER = logging.getLogger(__name__)

# pylint: disable=unused-argument
async def async_setup_entry(
        hass: HomeAssistant, entry: ConfigEntry, async_add_entities: bool
) -> bool:
    """Configure the platform."""

    # Create our new scene entity
    # TODO: Let the user override the name (with a default value)
    async_add_entities([
        ExtrapolationScene("Extrapolation Scene", hass)
    ])

    return True

class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(self, name, hass):
        """Initialize an ExtrapolationScene."""
        self._scene_id = int(1675829059099)
        self._name = name
        self._hass = hass

    @property
    def name(self):
        """Return the display name of this device."""
        return self._name

    @property
    def scene_id(self):
        """Return the scene ID."""
        return self._scene_id

    async def async_activate(self):
        """Activate the scene."""
        _LOGGER.info("Received call to activate extrapolation scene!")

        # POC TODO:
        # 1. Manipulate an existing light
        hass = self._hass

        light = hass.states.get("light.left_desk_lamp")
        _LOGGER.info(light)
        _LOGGER.info(type(light))
        _LOGGER.info(light.state)
        _LOGGER.info(type(light.state))
        _LOGGER.info(light.attributes)
        _LOGGER.info(type(light.attributes))

        # Copy attributes to a new dict, without a reference to the old one
        new_attributes = dict(light.attributes)
        new_attributes["color_temp_kelvin"] = 6000

        hass.states.async_set("light.left_desk_lamp", light.state, new_attributes)
        # hass.states.async_set("light.left_desk_lamp", light_state, attributes, force_update, context)

        # TODO:
        # 1. Parse the scenes.yaml file
        # 2. Find the best way to get scenes selected in the config flow
        # 3. Extrapolate the light color and brightness
        # 4. Apply the extrapolated values