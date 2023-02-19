"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging
import inspect
from datetime import datetime
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

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_NIGHT_RISING_NAME,
    SCENE_DAWN_NAME,
    SCENE_DAY_RISING_NAME,
    SCENE_DAY_SETTING_NAME,
    SCENE_DUSK_NAME,
    SCENE_NIGHT_SETTING_NAME,
    AREA
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
        # TODO: Figure out how to set the area of the scene
        # TODO: Get the ID of the area, not the name (hard coded ID for now)
        # Should probably store the ID in the config, instead of the name
        # then find the name when editing the config flow in the UI
        self._area = "office" or config_entry.options.get("area") or config_entry.data.get("area") or None

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

        # Read and parse the scenes.yaml file
        scenes = None

        try:
            with open("./config/scenes.yaml", "r") as file: # Open file in "r" (read mode)
                data = file.read()

                scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

        except Exception as exception:
            raise CannotReadScenesFile() from exception

        # TODO: Get the times for the next solar events
        sun_events = [
            SunEvent(
                name = SCENE_NIGHT_RISING_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_NIGHT_RISING_NAME)),
                time = 10800 # 03:00
            ),
            SunEvent(
                name = SCENE_DAWN_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_DAWN_NAME)),
                time = 25200 # 07:00
            ),
            SunEvent(
                name = SCENE_DAY_RISING_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_DAY_RISING_NAME)),
                time = 27000 # 07:30
            ),
            SunEvent(
                name = SCENE_DAY_SETTING_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_DAY_SETTING_NAME)),
                time = 48600 # 13:30
            ),
            SunEvent(
                name = SCENE_DUSK_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_DUSK_NAME)),
                time = 65700 # 18:15
            ),
            SunEvent(
                name = SCENE_NIGHT_SETTING_NAME,
                scene = get_scene_by_name(scenes, self.config_entry.options.get(SCENE_NIGHT_SETTING_NAME)),
                time = 68400 # 19:00
            ),
        ]

        current_sun_event = get_sun_event(offset = 0, sun_events = sun_events)
        next_sun_event = get_sun_event(offset = 1, sun_events = sun_events)

        scene_transition_progress_percent = 100 / next_sun_event.time * seconds_since_midnight()

        # Calculate current light states
        new_entity_states = extrapolate_entity_states(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent
        )

        # Apply the new light states
        for new_entity_state in new_entity_states:
            # TODO: Change to .debug
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

class SunEvent():
    """Creates a sun event"""
    def __init__(self, name, time, scene):
        self.name = name
        self.time = time
        self.scene = scene

def get_sun_event(sun_events, offset = 0) -> SunEvent:
    """Returns the current sun event, according to the current time of day. Can be offset by ie. 1 to get the next sun event instead"""
    current_time = seconds_since_midnight()

    # Find the event closest in time to now, but still in the future
    closest_match = None
    for sun_event in sun_events:
        if sun_event.time > current_time:
            if closest_match is None:
                closest_match = sun_event
            elif sun_event.time < closest_match.time:
                closest_match = sun_event

    # If we couldn't find a match for today, then we return the (next) day's first event
    if closest_match is None:
        # Find the days first event
        days_first_event = None
        for sun_event in sun_events:
            if days_first_event is None:
                days_first_event = sun_event
            elif sun_event.time < days_first_event.time:
                days_first_event = sun_event

    return closest_match or days_first_event

def seconds_since_midnight() -> int:
    """Returns the number of seconds since midnight"""
    now = datetime.now()
    return (now - now.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds()

class CannotReadScenesFile(HomeAssistantError):
    """Error to indicate we cannot read the file."""

def get_scene_by_name(scenes, name):
    """Searches through the supplied array after the supplied name. Then returns that."""
    for scene in scenes:
        if scene["name"] == name:
            return scene

    return False

def extrapolate_entity_states(from_scene, to_scene, scene_transition_progress_percent) -> list:
    """Takes in a from and to scene and returns an a list of new entity states.
    The new states is the extrapolated state between the two scenes."""
    # TODO: Handle switch lights, not just rbg

    entities_with_extrapolated_state = []

    for from_entity_name in from_scene["entities"]:
        from_entity = from_scene["entities"][from_entity_name]
        rgb_from = from_entity["rgb_color"]
        brightness_from = from_entity["brightness"]

        # Match the current entity to the same entity in the to_scene
        for to_entity_name in to_scene["entities"]:
            if from_entity_name == to_entity_name:
                # _LOGGER.info("Found " + from_entity_name + " in both the from and to scenes")
                break
            else:
                # TODO: turn into .debug at some point
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
        # The if statement checks whether the result tried to divide by zero, which throws an
        # error, if so, we know that the from and to values are the same, and we can fall back
        # to the from value
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