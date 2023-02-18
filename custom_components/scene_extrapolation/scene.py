"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging
import inspect
import yaml

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.scene import Scene
from homeassistant.components.light import DOMAIN as LIGHT_DOMAIN
from homeassistant.exceptions import HomeAssistantError

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
        hass: HomeAssistant, config_entry: ConfigEntry, async_add_entities: bool
) -> bool:
    """Configure the platform."""

    # Create our new scene entity
    scene_name = config_entry.options.get("scene_name") or config_entry.data.get("scene_name") or "Extrapolation Scene"

    async_add_entities([
        ExtrapolationScene(scene_name, hass, config_entry)
    ])

    return True

class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(self, name, hass: HomeAssistant, config_entry: ConfigEntry):
        """Initialize an ExtrapolationScene."""
        self._scene_id = int(1675829059999)
        self._name = name
        self.hass = hass
        self.config_entry = config_entry
        self._area = "office"
        # self._area = config_entry.options.get("area")

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

        # Read and parse the scenes.yaml file
        scenes = None

        try:
            with open("./config/scenes.yaml", "r") as file: # Open file in "r" (read mode)
                data = file.read()

                scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

            _LOGGER.info("Successfully found and opened the scenes.yaml file")
            _LOGGER.info(scenes)

        except Exception as exception:
            raise CannotReadScenesFile() from exception

        # TODO: Get the configured data from the options flow
        scene_day_name = self.config_entry.options.get("scene_day")
        scene_sundown_name = self.config_entry.options.get("scene_sundown")

        scene_day = get_scene_by_name(scenes, scene_day_name)
        _LOGGER.info("scene_day_name")
        _LOGGER.info(scene_day_name)
        _LOGGER.info(scene_day)

        scene_sundown = get_scene_by_name(scenes, scene_sundown_name)
        _LOGGER.info("scene_sundown_name")
        _LOGGER.info(scene_sundown_name)
        _LOGGER.info(scene_sundown)



        # TODO: Get the time of the previous and next solar event
        # TODO: Calculate the current scene change progress based on how far we've come between
        # the previous event and the next one
        scene_transition_progress_percent = 50

        # Calculate current light states
        new_entity_states = extrapolate_entity_states(scene_day, scene_sundown, scene_transition_progress_percent)
        _LOGGER.info("new_entity_states")
        _LOGGER.info(new_entity_states)

        for new_entity_state in new_entity_states:
            _LOGGER.info(
                "%s: SERVICE_TURN_ON: 'service_data': %s",
                self.name,
                new_entity_state
            )

            await self.hass.services.async_call(
                LIGHT_DOMAIN,
                SERVICE_TURN_ON,
                new_entity_state
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

class CannotReadScenesFile(HomeAssistantError):
    """Error to indicate we cannot read the file."""

def get_scene_by_name(scenes, name):
    _LOGGER.info("Looking for " + name)
    for scene in scenes:
        if scene["name"] == name:
            _LOGGER.info("Found " + name)
            return scene

        _LOGGER.info(scene["name"] + " !== " + name)

    return False

def extrapolate_entity_states(from_scene, to_scene, scene_transition_progress_percent):
    # TODO: Handle switch lights, not just rbg

    entities_with_extrapolated_state = []

    for from_entity_name in from_scene["entities"]:
        from_entity = from_scene["entities"][from_entity_name]
        rgb_from = from_entity["rgb_color"]
        brightness_from = from_entity["brightness"]

        # Match the current entity to the same entity in the to_scene
        for to_entity_name in to_scene["entities"]:
            if from_entity_name == to_entity_name:
                _LOGGER.info("Found " + from_entity_name + " in both the from and to scenes")
                break
            else:
                _LOGGER.warning("Couldn't find " + from_entity_name + " in the scene we are extrapolating to. Assuming it should be turned off.")
                to_entity_name = False

        # If the current entity doesn't exist in the to_scene, then we assume it's new state
        # should be off
        if not to_entity_name:
            rgb_to = [0, 0, 0]
            brightness_to = 0
        else:
            to_entity = to_scene["entities"][to_entity_name]
            rgb_to = to_entity["rgb_color"]
            brightness_to = to_entity["brightness"]

        # Calculate what the current color should be
        # The if statement checks whether the result tried to divide by zero, which throws an error,
        # if so, we know that the from and to values are the same, and we can fall back to the from value
        rgb_extrapolated = [
            int(rgb_from[0] - abs(rgb_from[0] - rgb_to[0]) * scene_transition_progress_percent / 100),
            int(rgb_from[1] - abs(rgb_from[1] - rgb_to[1]) * scene_transition_progress_percent / 100),
            int(rgb_from[2] - abs(rgb_from[2] - rgb_to[2]) * scene_transition_progress_percent / 100)
        ]

        _LOGGER.info("From rgb: " + ", ".join(str(x) for x in rgb_from) + ", " + str(brightness_from) + ". To rgb: " + ", ".join(str(x) for x in rgb_to) + ", " + str(brightness_to))

        # Calculate what the current brightness should be
        brightness_extrapolated = int(100 / abs(brightness_from - brightness_to) * scene_transition_progress_percent) if abs(brightness_from - brightness_to) else brightness_from

        entities_with_extrapolated_state.append({
            ATTR_ENTITY_ID: from_entity_name,
            ATTR_RGB_COLOR: rgb_extrapolated,
            ATTR_BRIGHTNESS: brightness_extrapolated
        })

    return entities_with_extrapolated_state