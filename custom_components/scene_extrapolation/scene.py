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
    ATTR_COLOR_MODE,
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
    ATTR_STATE,
    CONF_NAME,
    EVENT_CALL_SERVICE,
    EVENT_HOMEASSISTANT_STARTED,
    EVENT_STATE_CHANGED,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_ON,
    STATE_OFF,
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

    async def async_activate(self, transition=0):
        """Activate the scene."""
        start_time = time.time()

        # Read and parse the scenes.yaml file
        scenes = await get_native_scenes(self.hass)

        _LOGGER.debug(
            "Time getting native scenes: %sms", (time.time() - start_time) * 1000
        )

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

        start_time_sun_events = time.time()

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
            "Current sun event: %s (%s), next: %s (%s), transition progress: %s, seconds since midnight: %s",
            current_sun_event.name,
            current_sun_event.scene["name"],
            next_sun_event.name,
            next_sun_event.scene["name"],
            scene_transition_progress_percent,
            self.seconds_since_midnight(),
        )

        _LOGGER.debug(
            "Time getting sun events (precalculated): %sms",
            (time.time() - start_time_sun_events) * 1000,
        )

        start_time_extrapolation = time.time()

        # Calculate current light states
        new_entity_states = get_extrapolated_entity_states(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent,
        )

        _LOGGER.debug(
            "Time extrapolating: %sms",
            (time.time() - start_time_extrapolation) * 1000,
        )

        start_time_apply_states = time.time()

        await self.apply_entity_states(entities=new_entity_states, hass=self.hass, transition=transition)

        _LOGGER.debug(
            "Time applying states: %sms", (time.time() - start_time_apply_states) * 1000
        )
        _LOGGER.debug(
            "Time total applying scene: %sms", (time.time() - start_time) * 1000
        )

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

    async def apply_entity_states(self, entities, hass: HomeAssistant, transition=0):
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

            entity[ATTR_TRANSITION] = transition

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
    difference = to_number - from_number
    current_transition_difference = difference * scene_transition_progress_percent / 100
    final_transition_value = round(from_number + current_transition_difference)

    # If the extrapolated value is higher than both from and to_number, then something's wrong
    # TODO: Remove this if the error doesn't pop up in the near future. Was just a wrong -/+ value...
    if final_transition_value > from_number and final_transition_value > to_number:
        _LOGGER.warning(
            "Math is hard... From number: %s, to_number %s, extrapolated: %s, transition_percent: %s",
            from_number,
            to_number,
            final_transition_value,
            scene_transition_progress_percent,
        )
        raise HomeAssistantError("Extrapolation math error... Developer goes: Ugh...")

    # Same, but if both are lower
    if final_transition_value < from_number and final_transition_value < to_number:
        _LOGGER.warning(
            "Math is hard... From number: %s, to_number %s, extrapolated: %s, transition_percent: %s",
            from_number,
            to_number,
            final_transition_value,
            scene_transition_progress_percent,
        )
        raise HomeAssistantError("Extrapolation math error 2... Developer goes: Ugh...")

    return final_transition_value


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
        else:
            to_entity = (
                {}
            )  # Let's not do all the checking for wether to_entity is defined

        _LOGGER.debug("from_entity: %s", from_entity)
        _LOGGER.debug("to_entity: %s", to_entity)

        # Handle entities with brightness support
        if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
            # There isn't always a brightness attribute in the to_entity (ie. if it's turned off or the like)
            from_brightness = (
                from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else 0
            )

            to_brightness = (
                to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else 0
            )

            final_brightness = extrapolate_number(
                from_brightness,
                to_brightness,
                scene_transition_progress_percent,
            )

            final_entity[ATTR_BRIGHTNESS] = final_brightness

        # TODO: There must be a cleaner way to do this?
        # Quick fix to make sure there is a color mode on the from/to entities, so we don't have to keep checking for one
        if not ATTR_COLOR_MODE in from_entity:
            from_entity[COLOR_MODE] = ""

        if not ATTR_COLOR_MODE in to_entity:
            to_entity[COLOR_MODE] = ""

        # TODO: Is there a better way to do this?
        # Force the same color mode between from and to extrapolation.
        # We use from entity's color mode if the transition is less than half finished, else use the to_entity's color mode.
        if scene_transition_progress_percent >= 50:
            to_entity[COLOR_MODE] = from_entity[COLOR_MODE]
        else:
            from_entity[COLOR_MODE] = to_entity[COLOR_MODE]

        if (
            from_entity[COLOR_MODE] == COLOR_MODE_ONOFF
            or to_entity[COLOR_MODE] == COLOR_MODE_ONOFF
        ):
            from_state = (
                from_entity[ATTR_STATE]
                if ATTR_STATE in from_entity
                else to_entity[ATTR_STATE]
            )

            to_state = (
                to_entity[ATTR_STATE]
                if ATTR_STATE in to_entity
                else from_entity[ATTR_STATE]
            )

            if (
                scene_transition_progress_percent >= 50
                and from_state == STATE_ON
                and to_state
            ):
                final_state = STATE_OFF
            elif (
                scene_transition_progress_percent >= 50
                and from_state == STATE_OFF
                and to_state
            ):
                final_state = STATE_ON
            else:
                final_state = from_state

            final_entity[ATTR_STATE] = final_state

            _LOGGER.debug("From state:  %s", from_state)
            _LOGGER.debug("Final state: %s", final_state)
            _LOGGER.debug("To state:    %s", to_state)

        if (
            from_entity[COLOR_MODE] == ATTR_COLOR_TEMP
            or to_entity[COLOR_MODE] == ATTR_COLOR_TEMP
        ):
            from_color_temp = (
                from_entity[ATTR_COLOR_TEMP]
                if ATTR_COLOR_TEMP in from_entity
                else to_entity[
                    ATTR_COLOR_TEMP
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            to_color_temp = (
                to_entity[ATTR_COLOR_TEMP]
                if ATTR_COLOR_TEMP in to_entity
                else from_entity[
                    ATTR_COLOR_TEMP
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            final_color_temp = extrapolate_number(
                from_color_temp,
                to_color_temp,
                scene_transition_progress_percent,
            )

            _LOGGER.debug(
                "From color_temp:  %s / %s",
                from_color_temp,
                from_entity[ATTR_BRIGHTNESS],
            )
            _LOGGER.debug(
                "Final color_temp: %s / %s",
                final_color_temp,
                final_entity[ATTR_BRIGHTNESS],
            )
            _LOGGER.debug(
                "To color_temp:    %s / %s", to_color_temp, to_entity[ATTR_BRIGHTNESS]
            )

            final_entity[ATTR_COLOR_TEMP] = final_color_temp

        if (
            from_entity[COLOR_MODE] == ATTR_COLOR_TEMP_KELVIN
            or to_entity[COLOR_MODE] == ATTR_COLOR_TEMP_KELVIN
        ):
            from_color_temp_kelvin = (
                from_entity[ATTR_COLOR_TEMP_KELVIN]
                if ATTR_COLOR_TEMP_KELVIN in from_entity
                else to_entity[
                    ATTR_COLOR_TEMP_KELVIN
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            to_color_temp_kelvin = (
                to_entity[ATTR_COLOR_TEMP_KELVIN]
                if ATTR_COLOR_TEMP_KELVIN in to_entity
                else from_entity[
                    ATTR_COLOR_TEMP_KELVIN
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            final_color_temp_kelvin = extrapolate_number(
                from_color_temp_kelvin,
                to_color_temp_kelvin,
                scene_transition_progress_percent,
            )

            _LOGGER.debug(
                "From:  %s / %s",
                from_color_temp_kelvin,
                from_entity[ATTR_BRIGHTNESS],
            )
            _LOGGER.debug(
                "Final: %s / %s",
                final_color_temp_kelvin,
                final_entity[ATTR_BRIGHTNESS],
            )
            _LOGGER.debug(
                "To:    %s / %s",
                to_color_temp_kelvin,
                to_entity[ATTR_BRIGHTNESS],
            )

            final_entity[ATTR_COLOR_TEMP_KELVIN] = final_color_temp_kelvin

        if (
            from_entity[COLOR_MODE] == ATTR_RGB_COLOR
            or to_entity[COLOR_MODE] == ATTR_RGB_COLOR
        ):
            from_rgb = (
                from_entity[ATTR_RGB_COLOR]
                if ATTR_RGB_COLOR in from_entity
                else to_entity[
                    ATTR_RGB_COLOR
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            to_rgb = (
                to_entity[ATTR_RGB_COLOR]
                if ATTR_RGB_COLOR in to_entity
                else from_entity[
                    ATTR_RGB_COLOR
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            rgb_extrapolated = [
                extrapolate_value(
                    from_rgb[0], to_rgb[0], scene_transition_progress_percent
                ),
                extrapolate_value(
                    from_rgb[1], to_rgb[1], scene_transition_progress_percent
                ),
                extrapolate_value(
                    from_rgb[2], to_rgb[2], scene_transition_progress_percent
                ),
            ]

            _LOGGER.debug("From:  %s / %s", from_rgb, from_entity[ATTR_BRIGHTNESS])
            _LOGGER.debug(
                "Final: %s / %s", rgb_extrapolated, final_entity[ATTR_BRIGHTNESS]
            )
            _LOGGER.debug("To:    %s / %s", to_rgb, to_entity[ATTR_BRIGHTNESS])

            final_entity[ATTR_RGB_COLOR] = rgb_extrapolated

        if (
            from_entity[COLOR_MODE] == COLOR_MODE_HS
            or to_entity[COLOR_MODE] == COLOR_MODE_HS
        ):
            from_hs = (
                from_entity[ATTR_HS_COLOR]
                if ATTR_HS_COLOR in from_entity
                else to_entity[
                    ATTR_HS_COLOR
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            to_hs = (
                to_entity[ATTR_HS_COLOR]
                if ATTR_HS_COLOR in to_entity
                else from_entity[
                    ATTR_HS_COLOR
                ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
            )

            # Calculate what the current color should be
            # The if statement checks whether the result tried to divide by zero, which throws an
            # error, if so, we know that the from and to values are the same, and we can fall back
            # to the from value
            final_hs = [
                extrapolate_value(
                    from_hs[0], to_hs[0], scene_transition_progress_percent
                ),
                extrapolate_value(
                    from_hs[1], to_hs[1], scene_transition_progress_percent
                ),
            ]

            _LOGGER.debug("From HS:  %s / %s", from_hs, from_entity[ATTR_BRIGHTNESS])
            _LOGGER.debug("Final HS: %s / %s", final_hs, final_entity[ATTR_BRIGHTNESS])
            _LOGGER.debug("To HS:    %s / %s", to_hs, to_entity[ATTR_BRIGHTNESS])

            final_entity[ATTR_HS_COLOR] = final_hs

        _LOGGER.debug("final_entity: %s", final_entity)

        entities_with_extrapolated_state.append(final_entity)

    return entities_with_extrapolated_state


def extrapolate_value(from_value, to_value, scene_transition_progress_percent):
    # TODO: Should this abs be here? I just quick fixed an error with negative hs values
    return abs(
        from_value
        - abs(from_value - to_value) * scene_transition_progress_percent / 100
    )
