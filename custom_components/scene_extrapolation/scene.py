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

    async_add_entities([
        ExtrapolationScene("Extrapolation Scene")
    ])

    return True

class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(self, name):
        """Initialize an ExtrapolationScene."""
        self._scene_id = int(1675829059099)
        self._name = name

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

        # TODO:
        # 1. Parse the scenes.yaml file
        # 2. Find the best way to get scenes selected in the config flow
        # 3. Extrapolate the light color and brightness
        # 4. Apply the extrapolated values