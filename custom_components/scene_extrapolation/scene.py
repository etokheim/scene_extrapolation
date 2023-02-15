"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.scene import Scene
from homeassistant.components.light import DOMAIN as LIGHT_DOMAIN

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_BRIGHTNESS_PCT,
    ATTR_BRIGHTNESS_STEP,
    ATTR_BRIGHTNESS_STEP_PCT,
    ATTR_COLOR_NAME,
    ATTR_COLOR_TEMP,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_KELVIN,
    ATTR_RGB_COLOR,
    ATTR_SUPPORTED_COLOR_MODES,
    ATTR_TRANSITION,
    ATTR_XY_COLOR,
    COLOR_MODE_BRIGHTNESS,
    COLOR_MODE_COLOR_TEMP,
    COLOR_MODE_HS,
    COLOR_MODE_RGB,
    COLOR_MODE_RGBW,
    COLOR_MODE_XY,
)

from homeassistant.const import (
    ATTR_AREA_ID,
    ATTR_DOMAIN,
    ATTR_ENTITY_ID,
    ATTR_SERVICE,
    ATTR_SERVICE_DATA,
    ATTR_SUPPORTED_FEATURES,
    CONF_NAME,
    EVENT_CALL_SERVICE,
    EVENT_HOMEASSISTANT_STARTED,
    EVENT_STATE_CHANGED,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_OFF,
    STATE_ON,
    SUN_EVENT_SUNRISE,
    SUN_EVENT_SUNSET,
)

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

        hass = self._hass

        light = hass.states.get("light.left_desk_lamp")

        _LOGGER.info(light)
        _LOGGER.info(light.entity_id)

        data = {
            ATTR_ENTITY_ID: light.entity_id,
            ATTR_RGB_COLOR: (255, 0, 0),
            ATTR_BRIGHTNESS: 255
        }

        _LOGGER.info(
            "%s: SERVICE_TURN_ON: 'service_data': %s",
            self._name,
            data
        )

        await self.hass.services.async_call(
            LIGHT_DOMAIN,
            SERVICE_TURN_ON,
            data
        )

        # Copy attributes to a new dict, without a reference to the old one
        #new_attributes = dict(light.attributes)
        #new_attributes["color_temp_kelvin"] = 6000

        #hass.states.async_set("light.left_desk_lamp", light.state, new_attributes)
        # hass.states.async_set("light.left_desk_lamp", light_state, attributes, force_update, context)

        # TODO:
        # 1. Parse the scenes.yaml file
        # 2. Find the best way to get scenes selected in the config flow
        # 3. Extrapolate the light color and brightness
        # 4. Apply the extrapolated values