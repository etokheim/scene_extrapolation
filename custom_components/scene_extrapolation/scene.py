"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging
import inspect
from datetime import datetime
import yaml
import time
import uuid

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.scene import Scene
from homeassistant.components.light import DOMAIN as LIGHT_DOMAIN
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo
import homeassistant.helpers.entity_registry as entity_registry

# TODO: Move this function to __init__ maybe? At least somewhere more fitting for reuse
from .config_flow import get_native_scenes

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
    CONF_UNIQUE_ID
)

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_NIGHT_RISING_NAME,
    SCENE_NIGHT_RISING_ID,
    SCENE_DAWN_NAME,
    SCENE_DAWN_ID,
    SCENE_DAY_RISING_NAME,
    SCENE_DAY_RISING_ID,
    SCENE_DAY_SETTING_NAME,
    SCENE_DAY_SETTING_ID,
    SCENE_DUSK_NAME,
    SCENE_DUSK_ID,
    SCENE_NIGHT_SETTING_NAME,
    SCENE_NIGHT_SETTING_ID,
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
        _LOGGER.error("---------")
        _LOGGER.error("Pre scene intialization. ID: %s, area_id: (not available yet), unique_id: %s", self.entity_id, self.unique_id)
        _LOGGER.error("---------")
        # TODO: Setting the entity_id to an already existing entity_id throws no errors. Instead a number is
        # appended to the expected entity_id. Ie. [entity_id]_2
        self.entity_id = "scene." + name.replace(" ", "_").casefold()
        self._scene_id = self.entity_id
        self.hass = hass
        self.config_entry = config_entry

        self._attr_icon = "mdi:auto-fix"
        self._attr_name = name
        self._attr_unique_id = config_entry.data.get(CONF_UNIQUE_ID)

        # TODO: Figure out how to set the area of the scene
        # TODO: Get the ID of the area, not the name (hard coded ID for now)
        # Should probably store the ID in the config, instead of the name
        # then find the name when editing the config flow in the UI
        self._area_id = config_entry.options.get(ATTR_AREA_ID) or config_entry.data.get(ATTR_AREA_ID) or None

        # When is the entity id set? It's obviously not set here. Check if its set when activatIng a scene
        _LOGGER.error("---------")
        _LOGGER.error("Scene intialization. ID: %s, area_id: %s, unique_id: %s", self.entity_id, self._area_id, self.unique_id)
        _LOGGER.error("---------")

        hass.async_add_executor_job(self.update_registry)


    def update_registry(self):
        # TODO: Find the proper way to do this hack (couldn't figure out how to add the scene to an area immediately)
        # Wait for the scene to be registered in the registry before we can update it
        time.sleep(0.1)

        entity_registry_instance = entity_registry.async_get(self.hass)

        entity_registry_instance.async_update_entity(
            self.entity_id,
            area_id=self._area_id, # TODO: Only set this once - as the user can't change the config, but can edit the scene's area directly. Always setting this overwrites any changes.
        )

    @property
    def name(self):
        """Return the display name of this device."""
        return self._attr_name

    @property
    def scene_id(self):
        """Return the scene ID."""
        return self._scene_id

    @property
    def unique_id(self):
        """Return the unique ID of this scene."""
        return self._attr_unique_id

    async def async_activate(self):
        """Activate the scene."""

        _LOGGER.error("---------")
        _LOGGER.error("Scene activation. ID: %s", self.entity_id)
        _LOGGER.error("---------")

        # Read and parse the scenes.yaml file
        scenes = await get_native_scenes(self.hass)

        # TODO: If the nightlights boolean is on, turn on the nightlights instead

        _LOGGER.info("Trying to get %s, %s", SCENE_NIGHT_RISING_ID, self.config_entry.options.get(SCENE_NIGHT_RISING_ID))
        _LOGGER.info("From %s", self.config_entry.options)

        # TODO: Get the times for the next solar events
        sun_events = [
            SunEvent(
                name = SCENE_NIGHT_RISING_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_NIGHT_RISING_ID)),
                time = 10800 # 03:00
            ),
            SunEvent(
                name = SCENE_DAWN_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_DAWN_ID)),
                time = 25200 # 07:00
            ),
            SunEvent(
                name = SCENE_DAY_RISING_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_DAY_RISING_ID)),
                time = 27000 # 07:30
            ),
            SunEvent(
                name = SCENE_DAY_SETTING_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_DAY_SETTING_ID)),
                time = 48600 # 13:30
            ),
            SunEvent(
                name = SCENE_DUSK_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_DUSK_ID)),
                time = 65700 # 18:15
            ),
            SunEvent(
                name = SCENE_NIGHT_SETTING_NAME,
                scene = get_scene_by_id(scenes, self.config_entry.options.get(SCENE_NIGHT_SETTING_ID)),
                time = 68400 # 19:00
            ),
        ]

        current_sun_event = get_sun_event(offset = 0, sun_events = sun_events)
        next_sun_event = get_sun_event(offset = 1, sun_events = sun_events)

        scene_transition_progress_percent = get_scene_transition_progress_percent(current_sun_event, next_sun_event)

        _LOGGER.info("Current sun event: %s, next: %s, transition progress: %s, seconds since midnight: %s", current_sun_event.name, next_sun_event.name, scene_transition_progress_percent, seconds_since_midnight())

        # Calculate current light states
        new_entity_states = get_extrapolated_entity_states(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent
        )

        await apply_entity_states(new_entity_states, self.hass)


async def apply_entity_states(entities, hass):
    """Applies the entities states"""
    for entity in entities:
        service_type = SERVICE_TURN_ON
        if "state" in entity:
            if entity["state"] == "off":
                service_type = SERVICE_TURN_OFF
            else:
                service_type = SERVICE_TURN_ON

            # TODO: Find a better way
            # entity.pop("state")

        _LOGGER.info(
            "%s: 'service_data': %s",
            service_type,
            entity
        )

        await hass.services.async_call(
            LIGHT_DOMAIN,
            service_type,
            entity
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

    # Find the event closest, but still in the future
    closest_match_index = None
    for index, sun_event in enumerate(sun_events):
        if sun_event.time <= current_time:
            if closest_match_index is None:
                closest_match_index = index
            elif sun_event.time > sun_events[closest_match_index].time:
                closest_match_index = index

    # If we couldn't find a match for today, then we return the (next) day's first event
    if closest_match_index is None:
        # Find the days first event
        for index, sun_event in enumerate(sun_events):
            if closest_match_index is None:
                closest_match_index = index
            elif sun_event.time < sun_events[closest_match_index].time:
                closest_match_index = index

    offset_index = closest_match_index + offset

    # The % strips away any overshooting of the list length
    return sun_events[offset_index % len(sun_events)]

def seconds_since_midnight() -> int:
    """Returns the number of seconds since midnight"""
    now = datetime.now()
    return 27000
    return (now - now.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds()

class MissingConfiguration(HomeAssistantError):
    """Error to indicate there is missing configuration."""

# Note: I wanted to match the ID, but problem is: the entity_id isn't available in scenes.yaml!? The only way to get it would be to
# look up scene entities, where I'd probably get both scene.id and scene.entity_id, then match the scene.id to the scene.id from
# the scenes.yaml file, AND THEN finally match ids and saturate the scenes.yaml data with entitiy ids. Which is too much work
# and probably compute as well for me to bother right now...
# All these IDs are very inconsistent and confusing: entity_id, unique_id and id? Really?
def get_scene_by_id(scenes, id):
    """Searches through the supplied array after the supplied name. Then returns that."""
    if id is None:
        raise HomeAssistantError("Developer goes: Ehhh... Something's wrong. I'm searching for an non-existant ID...")

    for scene in scenes:
        _LOGGER.info("Is %s == %s", scene["id"], id)
        _LOGGER.info(scene)
        if scene["entity_id"] == id:
            return scene

    raise MissingConfiguration("Hey - you have to configure the extension first! A scene field is missing a value (or have an incorrect one set)")

def get_scene_transition_progress_percent(current_sun_event, next_sun_event) -> int:
    """Get a percentage value for how far into the transitioning between the from and to scene
    we currently are."""
    # Account for passing midnight
    seconds_between_current_and_next_sun_events = None
    seconds_till_next_sun_event = None

    # If midnight is between the current and next sun events, do some special handling
    if current_sun_event.time > next_sun_event.time:
        # 86400 = 24 hours
        # Takes the time left of the day + the time to the first sun_event the next day to
        # calculate how many seconds it is between them.
        seconds_between_current_and_next_sun_events = 86400 - current_sun_event.time + next_sun_event.time
    else:
        seconds_between_current_and_next_sun_events = next_sun_event.time - current_sun_event.time

    if seconds_since_midnight() > next_sun_event.time:
        seconds_till_next_sun_event = 86400 - seconds_since_midnight() + next_sun_event.time
    else:
        seconds_till_next_sun_event = next_sun_event.time - seconds_since_midnight()

    return 100 / seconds_between_current_and_next_sun_events * (seconds_between_current_and_next_sun_events - seconds_till_next_sun_event)

def extrapolate_number(from_number, to_number, scene_transition_progress_percent) -> int:
    """Takes the current transition percent plus a from and to number and returns what the new value should be"""
    difference = from_number - to_number
    transition_value = difference * scene_transition_progress_percent / 100
    return round(from_number + transition_value)

# TODO: Check entity type and only extrapolate the supported ones
def get_extrapolated_entity_states(from_scene, to_scene, scene_transition_progress_percent) -> list:
    """Takes in a from and to scene and returns an a list of new entity states.
    The new states is the extrapolated state between the two scenes."""

    _LOGGER.warning("from_scene: %s, to_scene: %s, scene_transition_progress_percent: %s", from_scene, to_scene, scene_transition_progress_percent)

    entities_with_extrapolated_state = []

    for from_entity_name in from_scene["entities"]:
        from_entity = from_scene["entities"][from_entity_name]
        to_entity_name = None
        final_entity = None

        # Match the current entity to the same entity in the to_scene
        for potential_to_entity_name in to_scene["entities"]:
            if from_entity_name == potential_to_entity_name:
                # _LOGGER.info("Found " + from_entity_name + " in both the from and to scenes")
                to_entity_name = potential_to_entity_name
                break
            else:
                # TODO: turn into .debug at some point
                _LOGGER.debug("Couldn't find " + from_entity_name + " in the scene we are extrapolating to. Assuming it should be turned off.")
                to_entity_name = False

        if to_entity_name is not False:
            to_entity = to_scene["entities"][to_entity_name]

        # Set the starting point for the final entity to either the from or to entity so that
        # any values we don't explicitly handle are still set when updating the entity.
        if scene_transition_progress_percent < 50 or to_entity is False:
            final_entity = from_entity
        elif scene_transition_progress_percent >= 50:
            final_entity = to_entity

        _LOGGER.warn("from_entity: %s", from_entity)
        _LOGGER.error("to_entity: %s", to_entity)

        # Handle entities with brightness support
        if ATTR_BRIGHTNESS in from_entity:
            to_brightness = to_entity[ATTR_BRIGHTNESS] if to_entity else 0

            brightness_extrapolated = extrapolate_number(from_entity[ATTR_BRIGHTNESS], to_brightness, scene_transition_progress_percent)
            final_entity[ATTR_BRIGHTNESS] = brightness_extrapolated

        # Handle state, but only do it if the entity doesn't support brightness.
        # If not, the light can end up turning off prematurely. Ie. if the light is being dimmed from 100 -> 0 brightness, the final state will be off. Therefor the state musn't be set before the brightness is 0. Same with rgb etc.
        # Handle on/off lights
        elif "state" in from_entity:
            to_state = to_entity["state"] if to_entity else "off"

            if scene_transition_progress_percent >= 50 and from_entity["state"] == "on" and to_state:
                final_entity["state"] = "off"
            elif scene_transition_progress_percent >= 50 and from_entity["state"] == "off" and to_state:
                final_entity["state"] = "on"

        if ATTR_COLOR_TEMP in from_entity and to_entity:
            color_temp_extrapolated = extrapolate_number(from_entity[ATTR_COLOR_TEMP], to_entity[ATTR_COLOR_TEMP], scene_transition_progress_percent)
            final_entity[ATTR_COLOR_TEMP] = color_temp_extrapolated

        if ATTR_COLOR_TEMP_KELVIN in from_entity and to_entity:
            color_temp_kelvin_extrapolated = extrapolate_number(from_entity[ATTR_COLOR_TEMP_KELVIN], to_entity[ATTR_COLOR_TEMP_KELVIN], scene_transition_progress_percent)
            final_entity[ATTR_COLOR_TEMP_KELVIN] = color_temp_kelvin_extrapolated

        # Handle entities with RGB support
        if ATTR_RGB_COLOR in from_entity:
            rgb_from = from_entity[ATTR_RGB_COLOR]

            # If the current entity doesn't exist in the to_scene, then we assume it's new state
            # should be off
            if not to_entity_name:
                rgb_to = [0, 0, 0]
            else:
                rgb_to = to_entity[ATTR_RGB_COLOR]

            # Calculate what the current color should be
            # The if statement checks whether the result tried to divide by zero, which throws an
            # error, if so, we know that the from and to values are the same, and we can fall back
            # to the from value
            rgb_extrapolated = [
                int(rgb_from[0] - abs(rgb_from[0] - rgb_to[0]) * scene_transition_progress_percent / 100),
                int(rgb_from[1] - abs(rgb_from[1] - rgb_to[1]) * scene_transition_progress_percent / 100),
                int(rgb_from[2] - abs(rgb_from[2] - rgb_to[2]) * scene_transition_progress_percent / 100)
            ]

            #_LOGGER.info("From rgb: " + ", ".join(str(x) for x in rgb_from) + ", " + str(brightness_from) + ". To rgb: " + ", ".join(str(x) for x in rgb_to) + ", " + str(brightness_to))
            _LOGGER.info("From:  %s", rgb_from + [from_entity[ATTR_BRIGHTNESS]])
            _LOGGER.info("Final: %s", rgb_extrapolated + [final_entity[ATTR_BRIGHTNESS]])
            _LOGGER.info("To:    %s", rgb_to + [to_entity[ATTR_BRIGHTNESS]])
            final_entity[ATTR_RGB_COLOR] = rgb_extrapolated

        _LOGGER.warn("final_entity: %s", final_entity)

        entities_with_extrapolated_state.append(final_entity)

    return entities_with_extrapolated_state