"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging
from datetime import datetime
import time
from astral.sun import sun, time_at_elevation, midnight
from astral import LocationInfo, SunDirection
import pytz

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
    COLOR_MODE_ONOFF,
)

COLOR_MODE = "color_mode"

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
    CONF_UNIQUE_ID,
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
    scene_name = (
        config_entry.options.get("scene_name")
        or config_entry.data.get("scene_name")
        or "Extrapolation Scene"
    )

    async_add_entities([ExtrapolationScene(scene_name, hass, config_entry)])

    return True


class SunEvent:
    """Creates a sun event"""

    def __init__(self, name, start_time, scene) -> None:
        self.name = name
        self.start_time = start_time
        self.scene = scene


class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(self, name, hass: HomeAssistant, config_entry: ConfigEntry):
        """Initialize an ExtrapolationScene."""
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
        self._area_id = (
            config_entry.options.get(ATTR_AREA_ID)
            or config_entry.data.get(ATTR_AREA_ID)
            or None
        )

        latitude = self.hass.config.latitude
        longitude = self.hass.config.longitude
        time_zone = self.hass.config.time_zone

        city = LocationInfo(timezone=time_zone, latitude=latitude, longitude=longitude)
        self.solar_events = sun(
            city.observer, date=datetime.now(tz=pytz.timezone(time_zone))
        )

        self.solar_events["midnight"] = midnight(
            city.observer,
            date=datetime.now(tz=pytz.timezone(time_zone)),
        )

        time_at_10deg = time_at_elevation(
            city.observer,
            elevation=10,
            direction=SunDirection.RISING,
            date=datetime.now(tz=pytz.timezone(time_zone)),
        )

        hass.async_add_executor_job(self.update_registry)

    def update_registry(self):
        # TODO: Find the proper way to do this hack (couldn't figure out how to add the scene to an area immediately)
        # Wait for the scene to be registered in the registry before we can update it
        time.sleep(0.1)

        entity_registry_instance = entity_registry.async_get(self.hass)

        entity_registry_instance.async_update_entity(
            self.entity_id,
            area_id=self._area_id,  # TODO: Only set this once - as the user can't change the config, but can edit the scene's area directly. Always setting this overwrites any changes.
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

        # Read and parse the scenes.yaml file
        scenes = await get_native_scenes(self.hass)

        # TODO: If the nightlights boolean is on, turn on the nightlights instead

        # TODO: Automatically get the times for the next solar events

        sun_events = [
            SunEvent(
                name=SCENE_NIGHT_RISING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_NIGHT_RISING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    self.solar_events["midnight"]
                ),
            ),
            SunEvent(
                name=SCENE_DAWN_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAWN_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    self.solar_events["dawn"]
                ),
            ),
            SunEvent(
                name=SCENE_DAY_RISING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAY_RISING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    self.solar_events["sunrise"]
                ),
            ),
            SunEvent(
                name=SCENE_DAY_SETTING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAY_SETTING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    self.solar_events["sunset"]
                ),
            ),
            SunEvent(
                name=SCENE_DUSK_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DUSK_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    self.solar_events["dusk"]
                ),
            ),
            SunEvent(
                name=SCENE_NIGHT_SETTING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_NIGHT_SETTING_ID)
                ),
                start_time=86400,  # 00:00
            ),
        ]

        for sun_event in sun_events:
            _LOGGER.debug("%s: %s", sun_event.name, sun_event.start_time)

        _LOGGER.debug("Time since midnight: %s", self.seconds_since_midnight())
        _LOGGER.debug(
            "Time now: %s", datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        )

        current_sun_event = self.get_sun_event(offset=0, sun_events=sun_events)
        next_sun_event = self.get_sun_event(offset=1, sun_events=sun_events)

        scene_transition_progress_percent = self.get_scene_transition_progress_percent(
            current_sun_event, next_sun_event
        )

        _LOGGER.debug(
            "Current sun event: %s, next: %s, transition progress: %s, seconds since midnight: %s",
            current_sun_event.name,
            next_sun_event.name,
            scene_transition_progress_percent,
            self.seconds_since_midnight(),
        )

        # Calculate current light states
        new_entity_states = get_extrapolated_entity_states(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent,
        )

        await self.apply_entity_states(new_entity_states, self.hass)

    def datetime_to_seconds_since_midnight(self, datetime):
        now = datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return (datetime - midnight).seconds

    def get_scene_transition_progress_percent(
        self, current_sun_event, next_sun_event
    ) -> int:
        """Get a percentage value for how far into the transitioning between the from and to scene
        we currently are."""
        # Account for passing midnight
        seconds_between_current_and_next_sun_events = None
        seconds_till_next_sun_event = None

        # If midnight is between the current and next sun events, do some special handling
        if current_sun_event.start_time > next_sun_event.start_time:
            # 86400 = 24 hours
            # Takes the time left of the day + the time to the first sun_event the next day to
            # calculate how many seconds it is between them.
            seconds_between_current_and_next_sun_events = (
                86400 - current_sun_event.start_time + next_sun_event.start_time
            )
        else:
            seconds_between_current_and_next_sun_events = (
                next_sun_event.start_time - current_sun_event.start_time
            )

        if self.seconds_since_midnight() > next_sun_event.start_time:
            seconds_till_next_sun_event = (
                86400 - self.seconds_since_midnight() + next_sun_event.start_time
            )
        else:
            seconds_till_next_sun_event = (
                next_sun_event.start_time - self.seconds_since_midnight()
            )

        return (
            100
            / seconds_between_current_and_next_sun_events
            * (
                seconds_between_current_and_next_sun_events
                - seconds_till_next_sun_event
            )
        )

    def seconds_since_midnight(self) -> float:
        """Returns the number of seconds since midnight"""
        now = datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        return (
            now - now.replace(hour=0, minute=0, second=0, microsecond=0)
        ).total_seconds()

    def get_sun_event(self, sun_events, offset=0) -> SunEvent:
        """Returns the current sun event, according to the current time of day. Can be offset by ie. 1 to get the next sun event instead"""
        current_time = self.seconds_since_midnight()

        # Find the event closest, but still in the future
        closest_match_index = None
        for index, sun_event in enumerate(sun_events):
            if sun_event.start_time <= current_time:
                if closest_match_index is None:
                    closest_match_index = index
                elif sun_event.start_time > sun_events[closest_match_index].start_time:
                    closest_match_index = index

        # If we couldn't find a match for today, then we return the (next) day's first event
        if closest_match_index is None:
            # Find the days first event
            for index, sun_event in enumerate(sun_events):
                if closest_match_index is None:
                    closest_match_index = index
                elif sun_event.start_time < sun_events[closest_match_index].start_time:
                    closest_match_index = index

        offset_index = closest_match_index + offset

        # The % strips away any overshooting of the list length
        return sun_events[offset_index % len(sun_events)]

    async def apply_entity_states(self, entities, hass: HomeAssistant):
        """Applies the entities states"""
        for entity in entities:
            service_type = SERVICE_TURN_ON
            if "state" in entity:
                if entity["state"] == "off":
                    service_type = SERVICE_TURN_OFF
                else:
                    service_type = SERVICE_TURN_ON

                del entity["state"]

                # TODO: Find a better way
                # entity.pop("state")

            _LOGGER.debug("%s: 'service_data': %s", service_type, entity)

            await hass.services.async_call(
                domain=LIGHT_DOMAIN, service=service_type, service_data=entity
            )


class MissingConfiguration(HomeAssistantError):
    """Error to indicate there is missing configuration."""


def get_scene_by_uuid(scenes, uuid):
    """Searches through the supplied array after the supplied scene uuid. Then returns that."""
    if uuid is None:
        raise HomeAssistantError(
            "Developer goes: Ehhh... Something's wrong. I'm searching for an non-existant uuid..."
        )

    for scene in scenes:
        if scene["entity_id"] == uuid:
            return scene

    raise MissingConfiguration(
        "Hey - you have to configure the extension first! A scene field is missing a value (or have an incorrect one set)"
    )


def extrapolate_number(
    from_number, to_number, scene_transition_progress_percent
) -> int:
    """Takes the current transition percent plus a from and to number and returns what the new value should be"""
    difference = from_number - to_number
    transition_value = difference * scene_transition_progress_percent / 100
    return round(from_number + transition_value)


# TODO: Check entity type and only extrapolate the supported ones
def get_extrapolated_entity_states(
    from_scene, to_scene, scene_transition_progress_percent
) -> list:
    """Takes in a from and to scene and returns an a list of new entity states.
    The new states is the extrapolated state between the two scenes."""

    _LOGGER.debug(
        "from_scene: %s, to_scene: %s, scene_transition_progress_percent: %s",
        from_scene,
        to_scene,
        scene_transition_progress_percent,
    )

    entities_with_extrapolated_state = []

    for from_entity_id in from_scene["entities"]:
        from_entity = from_scene["entities"][from_entity_id]
        to_entity_id = None
        final_entity = {ATTR_ENTITY_ID: from_entity_id}

        # Match the current entity to the same entity in the to_scene
        for potentially_matching_to_entity_id in to_scene["entities"]:
            if from_entity_id == potentially_matching_to_entity_id:
                # _LOGGER.debug("Found " + from_entity_name + " in both the from and to scenes")
                to_entity_id = potentially_matching_to_entity_id
                break
            else:
                # TODO: turn into .debug at some point
                _LOGGER.debug(
                    "Couldn't find "
                    + from_entity_id
                    + " in the scene we are extrapolating to. Assuming it should be turned off."
                )
                to_entity_id = False

        if to_entity_id is not False:
            to_entity = to_scene["entities"][to_entity_id]

        # Set the starting point for the final entity to either the from or to entity so that
        # any values we don't explicitly handle are still set when updating the entity.
        # if scene_transition_progress_percent < 50 or to_entity is False:
        #     final_entity = from_entity
        # elif scene_transition_progress_percent >= 50:
        #     final_entity = to_entity

        _LOGGER.debug("from_entity: %s", from_entity)
        _LOGGER.debug("to_entity: %s", to_entity)

        # Handle entities with brightness support
        if ATTR_BRIGHTNESS in from_entity:
            to_brightness = to_entity[ATTR_BRIGHTNESS] if to_entity else 0

            brightness_extrapolated = extrapolate_number(
                from_entity[ATTR_BRIGHTNESS],
                to_brightness,
                scene_transition_progress_percent,
            )
            final_entity[ATTR_BRIGHTNESS] = brightness_extrapolated

        # Handle on/off lights
        if from_entity[COLOR_MODE] == COLOR_MODE_ONOFF:
            to_state = to_entity["state"] if to_entity else "off"

            if (
                scene_transition_progress_percent >= 50
                and from_entity["state"] == "on"
                and to_state
            ):
                final_entity["state"] = "off"
            elif (
                scene_transition_progress_percent >= 50
                and from_entity["state"] == "off"
                and to_state
            ):
                final_entity["state"] = "on"
            else:
                final_entity["state"] = from_entity["state"]

        if from_entity[COLOR_MODE] == ATTR_COLOR_TEMP and to_entity:
            color_temp_extrapolated = extrapolate_number(
                from_entity[ATTR_COLOR_TEMP],
                to_entity[ATTR_COLOR_TEMP],
                scene_transition_progress_percent,
            )
            final_entity[ATTR_COLOR_TEMP] = color_temp_extrapolated

        if from_entity[COLOR_MODE] == ATTR_COLOR_TEMP_KELVIN and to_entity:
            color_temp_kelvin_extrapolated = extrapolate_number(
                from_entity[ATTR_COLOR_TEMP_KELVIN],
                to_entity[ATTR_COLOR_TEMP_KELVIN],
                scene_transition_progress_percent,
            )
            final_entity[ATTR_COLOR_TEMP_KELVIN] = color_temp_kelvin_extrapolated

        # Handle entities with RGB support
        if from_entity[COLOR_MODE] == ATTR_RGB_COLOR:
            rgb_from = from_entity[ATTR_RGB_COLOR]

            # If the current entity doesn't exist in the to_scene, then we assume it's new state
            # should be off
            if not to_entity_id:
                rgb_to = [0, 0, 0]
            else:
                rgb_to = to_entity[ATTR_RGB_COLOR]

            # Calculate what the current color should be
            # The if statement checks whether the result tried to divide by zero, which throws an
            # error, if so, we know that the from and to values are the same, and we can fall back
            # to the from value
            rgb_extrapolated = [
                extrapolate_value(
                    rgb_from[0], rgb_to[0], scene_transition_progress_percent
                ),
                extrapolate_value(
                    rgb_from[1], rgb_to[1], scene_transition_progress_percent
                ),
                extrapolate_value(
                    rgb_from[2], rgb_to[2], scene_transition_progress_percent
                ),
            ]

            # _LOGGER.debug("From rgb: " + ", ".join(str(x) for x in rgb_from) + ", " + str(brightness_from) + ". To rgb: " + ", ".join(str(x) for x in rgb_to) + ", " + str(brightness_to))
            _LOGGER.debug("From:  %s", rgb_from + [from_entity[ATTR_BRIGHTNESS]])
            _LOGGER.debug(
                "Final: %s", rgb_extrapolated + [final_entity[ATTR_BRIGHTNESS]]
            )
            _LOGGER.debug("To:    %s", rgb_to + [to_entity[ATTR_BRIGHTNESS]])
            final_entity[ATTR_RGB_COLOR] = rgb_extrapolated

        # Handle entities in HS mode
        if from_entity[COLOR_MODE] == COLOR_MODE_HS:
            hs_from = from_entity[ATTR_HS_COLOR]

            # If the current entity doesn't exist in the to_scene, then we assume it's new state
            # should be off
            if not to_entity_id:
                hs_to = [0, 0]
            else:
                hs_to = to_entity[ATTR_HS_COLOR]

            # Calculate what the current color should be
            # The if statement checks whether the result tried to divide by zero, which throws an
            # error, if so, we know that the from and to values are the same, and we can fall back
            # to the from value
            hs_extrapolated = [
                extrapolate_value(
                    hs_from[0], hs_to[0], scene_transition_progress_percent
                ),
                extrapolate_value(
                    hs_from[1], hs_to[1], scene_transition_progress_percent
                ),
            ]

            _LOGGER.debug("From:  %s", hs_from + [from_entity[ATTR_BRIGHTNESS]])
            _LOGGER.debug(
                "Final: %s", hs_extrapolated + [final_entity[ATTR_BRIGHTNESS]]
            )
            _LOGGER.debug("To:    %s", hs_to + [to_entity[ATTR_BRIGHTNESS]])
            final_entity[ATTR_HS_COLOR] = hs_extrapolated

        _LOGGER.debug("final_entity: %s", final_entity)

        entities_with_extrapolated_state.append(final_entity)

    return entities_with_extrapolated_state


def extrapolate_value(from_value, to_value, scene_transition_progress_percent):
    # TODO: Should this abs be here? I just quick fixed an error with negative hs values
    return abs(
        from_value
        - abs(from_value - to_value) * scene_transition_progress_percent / 100
    )
