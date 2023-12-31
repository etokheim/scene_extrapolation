"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""
import logging
from datetime import datetime
import numbers
import time
from astral.sun import sun, time_at_elevation, midnight
from astral import LocationInfo, SunDirection
import pytz

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.scene import Scene
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN
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
    STATE_UNAVAILABLE,
    SUN_EVENT_SUNRISE,
    SUN_EVENT_SUNSET,
    CONF_UNIQUE_ID,
)

from .const import (
    DOMAIN,
    NIGHTLIGHTS_SCENE_ID,
    SCENE_DAWN_MINIMUM_TIME_OF_DAY,
    NIGHTLIGHTS_BOOLEAN_ID,
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

        # Used for calculating solar events when activating the scene
        self.latitude = self.hass.config.latitude
        self.longitude = self.hass.config.longitude
        self.time_zone = self.hass.config.time_zone
        self.city = LocationInfo(
            timezone=self.time_zone, latitude=self.latitude, longitude=self.longitude
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
        start_time = time.time()  # Used for performance monitoring

        if transition == 6553:
            _LOGGER.warning(
                "Home Assistant doesn't support transition times longer than 6553 (109 minutes). Anything above this value seems to be disregarded. The integration received a transition time of: %s",
                transition,
            )

        ##############################################
        #             Handle nightlights             #
        ##############################################
        nightlights_boolean_id = self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN_ID)
        nightlights_boolean = (
            True
            if self.hass.states.get(nightlights_boolean_id).state == "on"
            else False
        )

        # Turn on night lights instead if the nightlights_boolean is on
        if nightlights_boolean:
            _LOGGER.debug(
                "nightlights_boolean is on. Turning on nightlights instead of default behavior."
            )

            nightlights_scene_id = self.config_entry.options.get(NIGHTLIGHTS_SCENE_ID)

            try:
                await self.hass.services.async_call(
                    domain=SCENE_DOMAIN,
                    service=SERVICE_TURN_ON,
                    service_data={ATTR_ENTITY_ID: nightlights_scene_id},
                )

                _LOGGER.debug(
                    "Service call (%s.%s) has been sent successfully to turn on nightlights scene",
                    SCENE_DOMAIN,
                    SERVICE_TURN_ON,
                )

            except Exception as error:
                _LOGGER.error("Service call to turn on scene failed: %s", error)

            return

        ##############################################
        #                Load scenes                 #
        ##############################################
        # Read and parse the scenes.yaml file
        scenes = await get_native_scenes(self.hass)

        _LOGGER.debug(
            "Time getting native scenes: %sms", (time.time() - start_time) * 1000
        )

        ##############################################
        #          Calculate solar events            #
        ##############################################
        start_time_calculate_solar_events = time.time()

        # TODO: Consider renaming the variable, as it's easy to mistake for the sun_events variable
        solar_events = sun(
            self.city.observer, date=datetime.now(tz=pytz.timezone(self.time_zone))
        )

        # midnight event isn't part of the default events and is therefor appended:
        solar_events["midnight"] = midnight(
            self.city.observer,
            date=datetime.now(tz=pytz.timezone(self.time_zone)),
        )

        _LOGGER.debug(
            "Time calculating solar events: %sms",
            (time.time() - start_time_calculate_solar_events) * 1000,
        )

        # Crashes when the sun doesn't reach 10 degrees
        # time_at_10deg = time_at_elevation(
        #     city.observer,
        #     elevation=10,
        #     direction=SunDirection.RISING,
        #     date=datetime.now(tz=pytz.timezone(time_zone)),
        # )

        scene_dawn_minimum_time_of_day = self.config_entry.options.get(
            SCENE_DAWN_MINIMUM_TIME_OF_DAY
        )

        assert isinstance(
            scene_dawn_minimum_time_of_day, numbers.Number
        ), "scene_dusk_minimum_time_of_day is either not configured (or not a number)"

        # TODO: Consider adding noon as an event
        sun_events = [
            SunEvent(
                name=SCENE_NIGHT_RISING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_NIGHT_RISING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["midnight"]
                ),
            ),
            SunEvent(
                name=SCENE_DAWN_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAWN_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["dawn"]
                ),
            ),
            SunEvent(
                name=SCENE_DAY_RISING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAY_RISING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunrise"]
                ),
            ),
            SunEvent(
                name=SCENE_DAY_SETTING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DAY_SETTING_ID)
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunset"]
                ),
            ),
            SunEvent(
                name=SCENE_DUSK_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_DUSK_ID)
                ),
                start_time=max(
                    self.datetime_to_seconds_since_midnight(solar_events["dusk"]),
                    scene_dawn_minimum_time_of_day,
                ),
            ),
            SunEvent(
                name=SCENE_NIGHT_SETTING_NAME,
                scene=get_scene_by_uuid(
                    scenes, self.config_entry.options.get(SCENE_NIGHT_SETTING_ID)
                ),
                start_time=86400,  # 00:00 - TODO: Find a better way to do this, rather than hard coding the time
            ),
        ]

        start_time_sun_events = time.time()

        for sun_event in sun_events:
            _LOGGER.debug("%s: %s", sun_event.name, sun_event.start_time)

        _LOGGER.debug(
            "Time since midnight: %s", self.seconds_since_midnight(transition)
        )
        _LOGGER.debug(
            "Time now: %s", datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        )

        current_sun_event = self.get_sun_event(
            offset=0,
            sun_events=sun_events,
            seconds_since_midnight=self.seconds_since_midnight(transition),
        )

        next_sun_event = self.get_sun_event(
            offset=1,
            sun_events=sun_events,
            seconds_since_midnight=self.seconds_since_midnight(transition),
        )

        scene_transition_progress_percent = self.get_scene_transition_progress_percent(
            current_sun_event, next_sun_event, transition
        )

        _LOGGER.debug(
            "Current sun event: %s (%s), next: %s (%s), transition progress: %s, seconds since midnight: %s",
            current_sun_event.name,
            current_sun_event.scene["name"],
            next_sun_event.name,
            next_sun_event.scene["name"],
            scene_transition_progress_percent,
            self.seconds_since_midnight(transition),
        )

        _LOGGER.debug(
            "Time getting sun events (precalculated): %sms",
            (time.time() - start_time_sun_events) * 1000,
        )

        ##############################################
        #           Extrapolate entities             #
        ##############################################
        start_time_extrapolation = time.time()

        await extrapolate_entities(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent,
            transition,
            self.hass,
        )

        _LOGGER.debug(
            "Time extrapolating: %sms",
            (time.time() - start_time_extrapolation) * 1000,
        )

        _LOGGER.debug(
            "Time total applying scene: %sms", (time.time() - start_time) * 1000
        )

    def datetime_to_seconds_since_midnight(self, datetime):
        now = datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return (datetime - midnight).seconds

    def get_scene_transition_progress_percent(
        self, current_sun_event, next_sun_event, transition_time
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

        if self.seconds_since_midnight(transition_time) > next_sun_event.start_time:
            seconds_till_next_sun_event = (
                86400
                - self.seconds_since_midnight(transition_time)
                + next_sun_event.start_time
            )
        else:
            seconds_till_next_sun_event = (
                next_sun_event.start_time - self.seconds_since_midnight(transition_time)
            )

        return (
            100
            / seconds_between_current_and_next_sun_events
            * (
                seconds_between_current_and_next_sun_events
                - seconds_till_next_sun_event
            )
        )

    def seconds_since_midnight(self, transition_time) -> float:
        """Returns the number of seconds since midnight, adjusted for transition time"""
        now = datetime.now(tz=pytz.timezone(self.hass.config.time_zone))
        seconds_since_midnight = (
            now - now.replace(hour=0, minute=0, second=0, microsecond=0)
        ).total_seconds()

        # Current time + the transition time - as we should calculate the lights as they should be when
        # the transition is finished.
        # 86400 is 24 hours in seconds. % so that if the time overshoots 24 hours, the surplus is
        # shaved off.
        seconds_since_midnight_adjusted_for_transition = (
            seconds_since_midnight + transition_time
        ) % 86400

        return seconds_since_midnight_adjusted_for_transition

    def get_sun_event(self, sun_events, seconds_since_midnight, offset=0) -> SunEvent:
        """Returns the current sun event, according to the current time of day. Can be offset by ie. 1 to get the next sun event instead"""
        sorted_sun_events = sorted(sun_events, key=lambda x: x.start_time)

        # Find the event closest, but still in the future
        closest_match_index = None
        for index, sun_event in enumerate(sorted_sun_events):
            # Find the next sun_event index
            if sun_event.start_time >= seconds_since_midnight:
                closest_match_index = index - 1  # -1 to get current sun_event index
                break

        # If we couldn't find a match for today, then we either return the (next) day's first event
        # or the current day's last event (depending on whether the next day's first event is in the past.
        # ie. if the time is 300 past midnight, but the day's first event is 2300 seconds past midnight, we
        # need to return the previous day's event)
        if closest_match_index is None:
            if sorted_sun_events[0].start_time > seconds_since_midnight:
                closest_match_index = -1
            else:
                closest_match_index = 0

        offset_index = closest_match_index + offset

        # The % strips away any overshooting of the list length
        return sorted_sun_events[offset_index % len(sorted_sun_events)]


async def apply_entity_state(entity, hass: HomeAssistant, transition=0):
    """Applies the entities states"""
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

    _LOGGER.debug("%s.%s: %s", LIGHT_DOMAIN, service_type, entity)

    try:
        await hass.services.async_call(
            domain=LIGHT_DOMAIN, service=service_type, service_data=entity
        )
        _LOGGER.debug(
            "Service call (%s.%s) has been sent successfully",
            LIGHT_DOMAIN,
            service_type,
        )
    except Exception as error:
        _LOGGER.error("Service call to turn on light failed: %s", error)

    return True


def get_scene_by_uuid(scenes, uuid):
    """Searches through the supplied array after the supplied scene uuid. Then returns that."""
    if uuid is None:
        raise HomeAssistantError(
            "Developer goes: Ehhh... Something's wrong. I'm searching for an non-existant uuid... You've probably deleted one of the configured scenes. Please reconfigure the integration."
        )

    for scene in scenes:
        if scene["entity_id"] == uuid:
            return scene

    raise HomeAssistantError(
        "Hey - you have to configure the extension first! A scene field is missing a value (or have an incorrect one set)"
    )


async def extrapolate_entities(
    from_scene, to_scene, scene_transition_progress_percent, transition, hass
) -> list:
    """Takes in a from and to scene and returns a list of new entity states.
    The new states is the extrapolated state between the two scenes."""

    _LOGGER.debug("from_scene: %s", from_scene)
    _LOGGER.debug("to_scene: %s", to_scene)
    _LOGGER.debug(
        "scene_transition_progress_percent: %s", scene_transition_progress_percent
    )

    # Add any entities that are present in to_scene, but is missing from from_scene to the from_scene list.
    # This is needed as we are only checking from_scene["entities"] for entities to extrapolate
    for to_entity_id in to_scene["entities"]:
        if not to_entity_id in from_scene["entities"]:
            _LOGGER.debug(
                "Couldn't find "
                + to_entity_id
                + " in the scene we are extrapolating from. Assuming it should be turned off."
            )
            from_entity = {}

            from_scene["entities"][to_entity_id] = {}

    for from_entity_id in from_scene["entities"]:
        final_entity = {ATTR_ENTITY_ID: from_entity_id}
        from_entity = from_scene["entities"][from_entity_id]

        # Assign to_entity
        if from_entity_id in to_scene["entities"]:
            to_entity = to_scene["entities"][from_entity_id]
        else:
            _LOGGER.debug(
                "Couldn't find "
                + from_entity_id
                + " in the scene we are extrapolating to. Assuming it should be turned off."
            )
            to_entity = {}

        _LOGGER.debug("from_entity: %s", from_entity)
        _LOGGER.debug("to_entity: %s", to_entity)

        if (
            from_entity["state"] == STATE_UNAVAILABLE
            or to_entity["state"] == STATE_UNAVAILABLE
        ):
            _LOGGER.debug("%s is unavailable and therefor skipped", from_entity_id)
            continue

        # First, let's make sure there's always a color mode to extrapolate. If from_entity or to_entity is missing a
        # color mode, we'll set it to the other's color mode
        if not ATTR_COLOR_MODE in from_entity:
            # Raise an exception if none of the entities have a color mode (or is an on/off entity)
            if not ATTR_COLOR_MODE in to_entity:
                # Ie. some of the IKEA Wall Plugs doesn't always return a color_mode, so let's just hack it in
                if ATTR_STATE in to_entity or ATTR_STATE in from_entity:
                    to_entity[COLOR_MODE] = COLOR_MODE_ONOFF
                    from_entity[COLOR_MODE] = COLOR_MODE_ONOFF

                else:
                    raise HomeAssistantError(
                        "Both the from and to entities are missing a color mode (while not an on/off entity). I didn't think this could happen, but if it can, please report it and I'll add some handing."
                    )

            from_entity[COLOR_MODE] = to_entity[COLOR_MODE]

        elif not ATTR_COLOR_MODE in to_entity:
            to_entity[COLOR_MODE] = from_entity[COLOR_MODE]

        # Set the color mode we're actually going to extrapolate
        if scene_transition_progress_percent >= 50:
            final_color_mode = to_entity[COLOR_MODE]
        else:
            final_color_mode = from_entity[COLOR_MODE]

        _LOGGER.debug("final_color_mode: %s", final_color_mode)

        if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
            final_entity[ATTR_BRIGHTNESS] = extrapolate_brightness(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        if final_color_mode == COLOR_MODE_ONOFF:
            final_entity[ATTR_STATE] = extrapolate_onoff(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        elif final_color_mode == ATTR_COLOR_TEMP:
            final_entity[ATTR_COLOR_TEMP] = extrapolate_color_temp(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        elif final_color_mode == ATTR_COLOR_TEMP_KELVIN:
            final_entity[ATTR_COLOR_TEMP_KELVIN] = extrapolate_temp_kelvin(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        elif final_color_mode == ATTR_RGB_COLOR:
            final_entity[ATTR_RGB_COLOR] = extrapolate_rgb(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        elif final_color_mode == COLOR_MODE_HS:
            final_entity[ATTR_HS_COLOR] = extrapolate_hs(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )
            await apply_entity_state(final_entity, hass, transition)

        _LOGGER.debug("final_entity: %s", final_entity)

    return True


def extrapolate_value(from_value, to_value, scene_transition_progress_percent):
    # TODO: Should this abs be here? I just quick fixed an error with negative hs values
    return abs(
        from_value
        - abs(from_value - to_value) * scene_transition_progress_percent / 100
    )


def extrapolate_number(
    from_number, to_number, scene_transition_progress_percent
) -> int:
    """Takes the current transition percent plus a from and to number and returns what the new value should be"""
    # Make sure the input is as it should be
    # TODO: This should only be temporary - figure out why values sometimes are bad
    if not isinstance(from_number, numbers.Number):
        _LOGGER.error(
            "Trying to extrapolate a value that's not a number! %s", from_number
        )
        from_number = to_number
    elif not isinstance(to_number, numbers.Number):
        _LOGGER.error(
            "Trying to extrapolate a value that's not a number! %s", to_number
        )
        to_number = from_number

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


def extrapolate_brightness(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    # There isn't always a brightness attribute in the to_entity (ie. if it's turned off or the like)
    from_brightness = (
        from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else 0
    )

    to_brightness = to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else 0

    final_brightness = extrapolate_number(
        from_brightness,
        to_brightness,
        scene_transition_progress_percent,
    )

    return final_brightness


def extrapolate_onoff(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    from_state = (
        from_entity[ATTR_STATE] if ATTR_STATE in from_entity else to_entity[ATTR_STATE]
    )

    to_state = (
        to_entity[ATTR_STATE] if ATTR_STATE in to_entity else from_entity[ATTR_STATE]
    )

    if scene_transition_progress_percent >= 50 and from_state == STATE_ON and to_state:
        final_state = STATE_OFF
    elif (
        scene_transition_progress_percent >= 50 and from_state == STATE_OFF and to_state
    ):
        final_state = STATE_ON
    else:
        final_state = from_state

    _LOGGER.debug("From state:  %s", from_state)
    _LOGGER.debug("Final state: %s", final_state)
    _LOGGER.debug("To state:    %s", to_state)

    return final_state


def extrapolate_color_temp(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
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

    if from_color_temp is None:
        _LOGGER.warning(
            "Extrapolation between color modes have limited support. In this case we're falling back to the other entity's color mode. Set log level to debug for more information.",
        )

        _LOGGER.debug(
            "We only support extrapolating between color modes that already have a value in the scenes.yaml file. This entity didn't have any values present. Falling back to using the same color temp as we are extrapolating to. (Extrapolating from: %s, to: %s)",
            from_entity[ATTR_COLOR_MODE],
            to_entity[COLOR_MODE],
        )

        from_color_temp = to_color_temp
    elif to_color_temp is None:
        _LOGGER.warning(
            "Extrapolation between color modes have limited support. In this case we're falling back to the other entity's color mode. Set log level to debug for more information.",
        )

        _LOGGER.debug(
            "We only support extrapolating between color modes that already have a value in the scenes.yaml file. This entity didn't have any values present. Falling back to using the same color temp as we are extrapolating from. (Extrapolating from: %s, to: %s)",
            from_entity[ATTR_COLOR_MODE],
            to_entity[COLOR_MODE],
        )

        to_color_temp = from_color_temp

    final_color_temp = extrapolate_number(
        from_color_temp,
        to_color_temp,
        scene_transition_progress_percent,
    )

    _LOGGER.debug(
        "From color_temp:  %s / %s",
        from_color_temp,
        from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else None,
    )
    _LOGGER.debug(
        "Final color_temp: %s / %s",
        final_color_temp,
        final_entity[ATTR_BRIGHTNESS],
    )
    _LOGGER.debug(
        "To color_temp:    %s / %s",
        to_color_temp,
        to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else None,
    )

    return final_color_temp


def extrapolate_temp_kelvin(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
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
        from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else None,
    )
    _LOGGER.debug(
        "Final: %s / %s",
        final_color_temp_kelvin,
        final_entity[ATTR_BRIGHTNESS],
    )
    _LOGGER.debug(
        "To:    %s / %s",
        to_color_temp_kelvin,
        to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else None,
    )

    return final_color_temp_kelvin


def extrapolate_rgb(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
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
        extrapolate_value(from_rgb[0], to_rgb[0], scene_transition_progress_percent),
        extrapolate_value(from_rgb[1], to_rgb[1], scene_transition_progress_percent),
        extrapolate_value(from_rgb[2], to_rgb[2], scene_transition_progress_percent),
    ]

    _LOGGER.debug(
        "From:  %s / %s",
        from_rgb,
        from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else None,
    )
    _LOGGER.debug("Final: %s / %s", rgb_extrapolated, final_entity[ATTR_BRIGHTNESS])
    _LOGGER.debug(
        "To:    %s / %s",
        to_rgb,
        to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else None,
    )

    return rgb_extrapolated


def extrapolate_hs(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
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
        extrapolate_value(from_hs[0], to_hs[0], scene_transition_progress_percent),
        extrapolate_value(from_hs[1], to_hs[1], scene_transition_progress_percent),
    ]

    _LOGGER.debug(
        "From HS:  %s / %s",
        from_hs,
        from_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in from_entity else None,
    )
    _LOGGER.debug("Final HS: %s / %s", final_hs, final_entity[ATTR_BRIGHTNESS])
    _LOGGER.debug(
        "To HS:    %s / %s",
        to_hs,
        to_entity[ATTR_BRIGHTNESS] if ATTR_BRIGHTNESS in to_entity else None,
    )

    return final_hs
