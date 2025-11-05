"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""  # noqa: D200, D212

import asyncio
import logging
import numbers
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from astral import LocationInfo
from astral.sun import sun

from homeassistant.components.fan import DOMAIN as FAN_DOMAIN
from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_EFFECT,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ATTR_TRANSITION,
    DOMAIN as LIGHT_DOMAIN,
    ColorMode,
)
from homeassistant.util import dt as dt_util
from homeassistant.components.lock import LockState
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN, Scene
from homeassistant.config_entries import ConfigEntry

from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_STATE,
    CONF_UNIQUE_ID,
    SERVICE_LOCK,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    SERVICE_UNLOCK,
    STATE_CLOSED,
    STATE_CLOSING,
    STATE_OFF,
    STATE_OPEN,
    STATE_OPENING,
    STATE_PROBLEM,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import (
    NIGHTLIGHTS_BOOLEAN,
    NIGHTLIGHTS_SCENE,
    SCENE_DAWN,
    SCENE_DUSK,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
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
        or "Automatic Lighting"
    )

    async_add_entities([ExtrapolationScene(scene_name, hass, config_entry)])

    return True


class SunEvent:
    """Creates a sun event."""

    def __init__(self, name, start_time, scene) -> None:
        """Initialize a SunEvent."""
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
        self._attr_integration = "scene_extrapolation"
        self._brightness_modifier = 0
        self._transition_modifier = 0
        self._target_date_time = None

        # Get area_id from the scene entity itself (not stored in integration data)
        # The area_id is set during initial config flow and stored on the scene entity
        entity_registry_instance = er.async_get(self.hass)
        entity_entry = entity_registry_instance.async_get(self.entity_id)
        self._area_id = entity_entry.area_id if entity_entry else None

        # Used for calculating solar events when activating the scene
        self.latitude = self.hass.config.latitude
        self.longitude = self.hass.config.longitude
        self.time_zone = self.hass.config.time_zone
        self.city = LocationInfo(
            timezone=self.time_zone, latitude=self.latitude, longitude=self.longitude
        )

        # No caching needed - we'll access in-memory scene entities directly

        # Schedule registry update on the event loop to avoid thread-safety issues
        hass.async_create_task(self.async_update_registry())

    async def async_update_registry(self):
        """Update the registry."""
        # Wait a tick for the scene to be registered before updating
        await asyncio.sleep(0)

        # Note: area_id is now managed by the scene entity itself
        # and is set during the initial config flow
        # No need to update it here as it's not stored in integration data

    async def async_get_in_memory_scenes(self):
        """Get scenes from in-memory scene entities instead of reading YAML."""
        # Get the scene component from hass.data
        scene_component = self.hass.data.get("scene")
        if not scene_component:
            _LOGGER.error("Scene component not found")
            return []

        # Extract scene configurations from loaded scene entities
        scenes = []
        for entity in scene_component.entities:
            # Check if this is a HomeAssistantScene with scene_config
            if isinstance(entity, HomeAssistantScene) and hasattr(
                entity, "scene_config"
            ):
                scene_config = entity.scene_config
                # Convert scene_config.states to the format expected by the rest of the code
                entities_dict = {}
                for entity_id, state in scene_config.states.items():
                    entities_dict[entity_id] = {
                        "state": state.state,
                        **state.attributes,
                    }

                scene_data = {
                    "id": scene_config.id,
                    "name": scene_config.name,
                    "icon": scene_config.icon,
                    "entity_id": entity.entity_id,
                    "entities": entities_dict,
                }
                scenes.append(scene_data)

        _LOGGER.debug("Loaded %d scenes from in-memory entities", len(scenes))
        return scenes

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

    @property
    def extra_state_attributes(self):
        """Return the state attributes."""
        attrs = {
            "brightness_modifier": self._brightness_modifier,
            "transition_modifier": self._transition_modifier,
            "integration": self._attr_integration,
        }
        if self._target_date_time is not None:
            attrs["target_date_time"] = self._target_date_time.isoformat()

        # Expose scene entity_ids as attributes
        dawn_scene = self.config_entry.options.get(
            SCENE_DAWN
        ) or self.config_entry.data.get(SCENE_DAWN)
        if dawn_scene:
            attrs["dawn_scene"] = dawn_scene

        sunrise_scene = self.config_entry.options.get(
            SCENE_SUNRISE
        ) or self.config_entry.data.get(SCENE_SUNRISE)
        if sunrise_scene:
            attrs["sunrise_scene"] = sunrise_scene

        noon_scene = self.config_entry.options.get(
            SCENE_NOON
        ) or self.config_entry.data.get(SCENE_NOON)
        if noon_scene:
            attrs["noon_scene"] = noon_scene

        sunset_scene = self.config_entry.options.get(
            SCENE_SUNSET
        ) or self.config_entry.data.get(SCENE_SUNSET)
        if sunset_scene:
            attrs["sunset_scene"] = sunset_scene

        dusk_scene = self.config_entry.options.get(
            SCENE_DUSK
        ) or self.config_entry.data.get(SCENE_DUSK)
        if dusk_scene:
            attrs["dusk_scene"] = dusk_scene

        return attrs

    async def async_activate(
        self,
        transition=0,
        brightness_modifier=0,
        transition_modifier=0,
        target_date_time=None,
        location=None,
    ):
        """Activate the scene.

        Args:
            transition: Transition time in seconds
            brightness_modifier: Brightness modifier percentage (-100 to 100)
            transition_modifier: Transition modifier percentage (-100 to 100)
            target_date_time: Optional datetime to base extrapolation on (defaults to current time)
            location: Optional dict with 'latitude' and 'longitude' keys to override location
                     (defaults to Home Assistant's configured location)
        """
        # Store the brightness modifier and transition modifier as attributes
        self._brightness_modifier = brightness_modifier
        self._transition_modifier = transition_modifier

        # Use target_date_time if provided, otherwise use current time
        if target_date_time is None:
            target_date_time = datetime.now(tz=ZoneInfo(self.time_zone))
        elif isinstance(target_date_time, str):
            # Parse string to datetime if needed
            parsed_datetime = dt_util.parse_datetime(target_date_time)
            if parsed_datetime is None:
                raise ValueError(f"Invalid datetime string: {target_date_time}")
            target_date_time = parsed_datetime
            # Ensure target_date_time has timezone info if it doesn't
            if target_date_time.tzinfo is None:
                target_date_time = target_date_time.replace(
                    tzinfo=ZoneInfo(self.time_zone)
                )
        elif isinstance(target_date_time, datetime):
            # Ensure target_date_time has timezone info if it doesn't
            if target_date_time.tzinfo is None:
                target_date_time = target_date_time.replace(
                    tzinfo=ZoneInfo(self.time_zone)
                )

        # Store target_date_time for use in calculations
        self._target_date_time = target_date_time

        start_time = time.time()  # Used for performance monitoring

        # Trigger a state update to make the attributes visible immediately
        self.async_write_ha_state()

        if transition == 6553:
            _LOGGER.warning(
                "Home Assistant doesn't support transition times longer than 6553 (109 minutes). Anything above this value seems to be disregarded. The integration received a transition time of: %s",
                transition,
            )

        ##############################################
        #             Handle nightlights             #
        ##############################################
        nightlights_boolean_id = self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN)
        nightlights_boolean = False

        if nightlights_boolean_id:
            nightlights_state = self.hass.states.get(nightlights_boolean_id)
            if nightlights_state:
                nightlights_boolean = nightlights_state.state == "on"

        # Turn on night lights instead if the nightlights_boolean is on
        if nightlights_boolean:
            _LOGGER.debug(
                "nightlights_boolean is on. Turning on nightlights instead of default behavior"
            )

            nightlights_scene_id = self.config_entry.options.get(NIGHTLIGHTS_SCENE)

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

            except Exception as error:  # noqa: BLE001
                _LOGGER.error("Service call to turn on scene failed: %s", error)

            return

        ##############################################
        #                Load scenes                 #
        ##############################################
        # Get scenes from in-memory scene entities (no file I/O)
        scenes = await self.async_get_in_memory_scenes()

        _LOGGER.debug("Time getting native scenes: %.3fs", time.time() - start_time)

        ##############################################
        #          Calculate solar events            #
        ##############################################
        start_time_calculate_solar_events = time.time()

        # Use provided location if specified, otherwise use default from hass.config
        if location is not None:
            location_latitude = location.get("latitude", self.latitude)
            location_longitude = location.get("longitude", self.longitude)
        else:
            location_latitude = self.latitude
            location_longitude = self.longitude
        location_timezone = self.time_zone

        # Create a LocationInfo object for solar event calculations
        location_info = LocationInfo(
            timezone=location_timezone,
            latitude=location_latitude,
            longitude=location_longitude,
        )

        # TODO: Consider renaming the variable, as it's easy to mistake for the sun_events variable
        # Handle polar regions where individual solar events may fail
        # Determine hemisphere (Northern = positive latitude, Southern = negative)
        is_northern_hemisphere = location_latitude >= 0

        # Determine if it's winter or summer based on month and hemisphere
        month = target_date_time.month
        if is_northern_hemisphere:
            # Northern hemisphere: winter = Oct-Mar, summer = Apr-Sep
            is_winter = month in (10, 11, 12, 1, 2, 3)
        else:
            # Southern hemisphere: winter = Apr-Sep, summer = Oct-Mar (opposite)
            is_winter = month in (4, 5, 6, 7, 8, 9)

        # Define fallback times based on season
        if is_winter:
            fallback_times = {
                "dawn": (8, 45),
                "sunrise": (10, 30),
                "noon": (12, 0),
                "sunset": (13, 0),
                "dusk": (22, 0),
            }
        else:  # summer
            fallback_times = {
                "dawn": (2, 15),
                "sunrise": (4, 0),
                "noon": (13, 0),
                "sunset": (22, 0),
                "dusk": (23, 55),
            }

        # Define event order and their previous events
        event_order = ["dawn", "sunrise", "noon", "sunset", "dusk"]
        previous_events = {
            "sunrise": "dawn",
            "noon": "sunrise",
            "sunset": "noon",
            "dusk": "sunset",
        }

        # Try to calculate solar events, with individual fallbacks
        # Pass date object and ensure times are in local timezone
        try:
            solar_events_raw = sun(location_info.observer, date=target_date_time.date())
            # Ensure all returned times are in the local timezone
            solar_events = {}
            for event_name, event_time in solar_events_raw.items():
                # If the time is timezone-naive, assume it's in the location timezone
                if event_time.tzinfo is None:
                    solar_events[event_name] = event_time.replace(
                        tzinfo=ZoneInfo(location_timezone)
                    )
                else:
                    # Convert to local timezone if needed
                    solar_events[event_name] = event_time.astimezone(
                        ZoneInfo(location_timezone)
                    )
        except ValueError:
            _LOGGER.info(
                "Could not calculate solar events for %s (sun always below/above horizon). "
                "Using seasonal fallback times",
                target_date_time.date(),
            )
            solar_events = {}

        # Process each event in order, using previous event + offset if available
        for event_name in event_order:
            if event_name not in solar_events:
                # Get seasonal fallback time
                hour, minute = fallback_times[event_name]
                seasonal_fallback = target_date_time.replace(
                    hour=hour, minute=minute, second=0, microsecond=0
                )

                # Check if previous event exists
                fallback_time = seasonal_fallback
                if event_name in previous_events:
                    prev_event_name = previous_events[event_name]
                    if prev_event_name in solar_events:
                        prev_event_time = solar_events[prev_event_name]
                        # Use whichever is later: previous event + 30min or seasonal fallback
                        # This ensures chronological order is maintained
                        previous_plus_offset = prev_event_time + timedelta(minutes=30)
                        fallback_time = max(previous_plus_offset, seasonal_fallback)

                        if fallback_time == previous_plus_offset:
                            _LOGGER.info(
                                "Could not calculate %s for %s. Using %s + 30min: %s",
                                event_name,
                                target_date_time.date(),
                                prev_event_name,
                                fallback_time.strftime("%H:%M"),
                            )
                        else:
                            _LOGGER.info(
                                "Could not calculate %s for %s. Using seasonal fallback (later than %s + 30min): %02d:%02d",
                                event_name,
                                target_date_time.date(),
                                prev_event_name,
                                hour,
                                minute,
                            )
                    else:
                        # Previous event doesn't exist, use seasonal fallback
                        _LOGGER.info(
                            "Could not calculate %s for %s. Using seasonal fallback: %02d:%02d",
                            event_name,
                            target_date_time.date(),
                            hour,
                            minute,
                        )
                else:
                    # No previous event (e.g., dawn), use seasonal fallback
                    _LOGGER.info(
                        "Could not calculate %s for %s. Using seasonal fallback: %02d:%02d",
                        event_name,
                        target_date_time.date(),
                        hour,
                        minute,
                    )

                solar_events[event_name] = fallback_time

        scene_dusk_minimum_time_of_day = self.config_entry.options.get(
            SCENE_DUSK_MINIMUM_TIME_OF_DAY
        ) or self.config_entry.data.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)

        assert isinstance(scene_dusk_minimum_time_of_day, numbers.Number), (
            "scene_dusk_minimum_time_of_day is either not configured (or not a number)"
        )

        sun_events = {
            "dawn": SunEvent(
                name="Dawn",
                scene=get_scene_by_uuid(
                    scenes,
                    self.config_entry.options.get(SCENE_DAWN)
                    or self.config_entry.data.get(SCENE_DAWN),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["dawn"]
                ),
            ),
            "sunrise": SunEvent(
                name="Sunrise",
                scene=get_scene_by_uuid(
                    scenes,
                    self.config_entry.options.get(SCENE_SUNRISE)
                    or self.config_entry.data.get(SCENE_SUNRISE),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunrise"]
                ),
            ),
            "noon": SunEvent(
                name="Noon",
                scene=get_scene_by_uuid(
                    scenes,
                    self.config_entry.options.get(SCENE_NOON)
                    or self.config_entry.data.get(SCENE_NOON),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["noon"]
                ),
            ),
            "sunset": SunEvent(
                name="Sunset",
                scene=get_scene_by_uuid(
                    scenes,
                    self.config_entry.options.get(SCENE_SUNSET)
                    or self.config_entry.data.get(SCENE_SUNSET),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunset"]
                ),
            ),
            "dusk": SunEvent(
                name="Dusk",
                scene=get_scene_by_uuid(
                    scenes,
                    self.config_entry.options.get(SCENE_DUSK)
                    or self.config_entry.data.get(SCENE_DUSK),
                ),
                start_time=max(
                    self.datetime_to_seconds_since_midnight(solar_events["dusk"]),
                    scene_dusk_minimum_time_of_day,
                ),
            ),
        }

        # Check if dusk was overridden by minimum time
        dusk_calculated_time = self.datetime_to_seconds_since_midnight(
            solar_events["dusk"]
        )
        dusk_final_time = sun_events["dusk"].start_time
        dusk_was_overridden = dusk_final_time > dusk_calculated_time
        dusk_original_time = dusk_calculated_time if dusk_was_overridden else None

        # Calculate time shift based on transition modifier
        time_shift = self._calculate_time_shift_from_transition_modifier(
            transition_modifier, sun_events
        )

        current_seconds = self.seconds_since_midnight(0)
        final_time = self.seconds_since_midnight(transition + time_shift)

        # Only run logging code if log level is info or higher
        if _LOGGER.isEnabledFor(logging.INFO):
            # Format current time
            current_time_str = self._format_seconds_to_time(current_seconds)
            modified_time_str = self._format_seconds_to_time(final_time)

            # Calculate hours and minutes for time shift
            shift_hours = abs(time_shift) // 3600
            shift_minutes = (abs(time_shift) % 3600) // 60
            shift_direction = "+" if time_shift >= 0 else "-"

            # Log comprehensive scene activation info
            _LOGGER.info("=" * 60)
            _LOGGER.info("Scene Activation Details")
            _LOGGER.info("=" * 60)
            _LOGGER.info(
                "Brightness modifier %s, transition time %ss",
                brightness_modifier,
                transition,
            )
            _LOGGER.info("")
            if (
                hasattr(self, "_target_date_time")
                and self._target_date_time is not None
            ):
                target_datetime_str = self._target_date_time.strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                _LOGGER.info(
                    "Target datetime: %s (extrapolation based on this date/time)",
                    target_datetime_str,
                )
                _LOGGER.info("Base time:       %s", current_time_str)
            else:
                _LOGGER.info("Current time:    %s", current_time_str)
            if transition_modifier != 0:
                _LOGGER.info(
                    "Modified time:   %s (Transition modifier: %s%s%% | %s%s hours and %s minutes)",
                    modified_time_str,
                    "+" if transition_modifier > 0 else "",
                    transition_modifier,
                    shift_direction,
                    shift_hours,
                    shift_minutes,
                )
            else:
                _LOGGER.info(
                    "Modified time:   %s (No transition modifier)", modified_time_str
                )

            _LOGGER.info("")
            _LOGGER.info("Solar Events:")

            # Sort solar events by time and log them
            sorted_sun_events = sorted(sun_events.values(), key=lambda x: x.start_time)
            for sun_event in sorted_sun_events:
                event_time_str = self._format_seconds_to_time(sun_event.start_time)
                scene_entity_id = sun_event.scene.get("entity_id", "N/A")
                # For dusk, show if time was overridden by minimum
                if sun_event.name.lower() == "dusk" and dusk_was_overridden:
                    dusk_original_str = self._format_seconds_to_time(dusk_original_time)
                    event_time_str = (
                        f"{event_time_str} ({dusk_original_str} was overridden)"
                    )
                _LOGGER.info(
                    "  %s %s - %s",
                    (sun_event.name + ":").ljust(14),
                    event_time_str,
                    scene_entity_id,
                )

        current_sun_event = self.get_sun_event(
            offset=0,
            sun_events=sun_events,
            seconds_since_midnight=final_time,
        )

        next_sun_event = self.get_sun_event(
            offset=1,
            sun_events=sun_events,
            seconds_since_midnight=final_time,
        )

        scene_transition_progress_percent = self.get_scene_transition_progress_percent(
            current_sun_event, next_sun_event, final_time
        )

        _LOGGER.info("")
        _LOGGER.info(
            "Current state:   %s%% transitioned from %s to %s",
            round(scene_transition_progress_percent, 1),
            current_sun_event.name,
            next_sun_event.name,
        )
        _LOGGER.info("=" * 60)

        _LOGGER.debug(
            "Time calculating solar events: %.3fs",
            time.time() - start_time_calculate_solar_events,
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
            brightness_modifier,
        )

        _LOGGER.debug(
            "Time extrapolating: %.3fs",
            time.time() - start_time_extrapolation,
        )

        _LOGGER.debug("Time total applying scene: %.3fs", time.time() - start_time)

    def datetime_to_seconds_since_midnight(self, datetime_obj):
        """Convert a datetime object to seconds since midnight."""
        # Calculate midnight for the date of the datetime object, not today
        midnight = datetime_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        return (datetime_obj - midnight).total_seconds()

    def get_scene_transition_progress_percent(
        self, current_sun_event, next_sun_event, seconds_since_midnight
    ) -> int:
        """Get a percentage value for how far into the transitioning between the from and to scene we currently are."""

        # Account for passing midnight
        seconds_between_current_and_next_sun_events = None
        seconds_till_next_sun_event = None

        # Clamp to max 24 hours (to handle manipulation of seconds since midnight by transition modifier)
        seconds_since_midnight = seconds_since_midnight % 86400

        # Determine if we're crossing midnight between events
        # This happens when current event time > next event time (wrapping around midnight)
        crossing_midnight = current_sun_event.start_time > next_sun_event.start_time

        if crossing_midnight:
            # Wrapping around midnight: current event is before midnight, next is after
            # Calculate total time between events (wrapping around midnight)
            seconds_between_current_and_next_sun_events = (
                86400 - current_sun_event.start_time + next_sun_event.start_time
            )
            # Calculate time remaining until next event
            # If we're already past midnight (seconds_since_midnight < next_sun_event.start_time),
            # then we just need time from now to the next event today
            if seconds_since_midnight < next_sun_event.start_time:
                # We're after midnight but before the next event today
                seconds_till_next_sun_event = (
                    next_sun_event.start_time - seconds_since_midnight
                )
            else:
                # We're before midnight, so we need: time to midnight + time to next event
                seconds_till_next_sun_event = (
                    86400 - seconds_since_midnight + next_sun_event.start_time
                )
        else:
            # Normal case: events are on the same day and we're between them
            seconds_between_current_and_next_sun_events = (
                next_sun_event.start_time - current_sun_event.start_time
            )
            # Calculate time until next event (same day)
            seconds_till_next_sun_event = (
                next_sun_event.start_time - seconds_since_midnight
            )

        # Calculate transition progress percentage
        if seconds_between_current_and_next_sun_events == 0:
            # Edge case: current and next events are at the same time
            transition_progress = 0
        else:
            # Calculate how much of the transition has elapsed
            # elapsed = total_time - time_remaining
            elapsed_time = (
                seconds_between_current_and_next_sun_events
                - seconds_till_next_sun_event
            )
            transition_progress = (
                100 * elapsed_time / seconds_between_current_and_next_sun_events
            )

        # Validate that transition progress is within valid range [0, 100]
        if transition_progress < 0 or transition_progress > 100:
            raise HomeAssistantError(
                f"Invalid transition progress: {transition_progress:.1f}% "
                f"(expected 0-100%). This is a calculation error. "
                f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
                f"with the following details: Current event: {current_sun_event.name} "
                f"({current_sun_event.start_time}s), Next event: {next_sun_event.name} "
                f"({next_sun_event.start_time}s), Time: {seconds_since_midnight}s"
            )

        return transition_progress

    def seconds_since_midnight(self, offset_seconds: int) -> float:
        """Returns the number of seconds since midnight, can be adjusted with an offset."""
        # Use target_date_time if set (from async_activate), otherwise use current time
        if hasattr(self, "_target_date_time") and self._target_date_time is not None:
            target_time = self._target_date_time
        else:
            target_time = datetime.now(tz=ZoneInfo(self.hass.config.time_zone))

        seconds_since_midnight = (
            target_time - target_time.replace(hour=0, minute=0, second=0, microsecond=0)
        ).total_seconds()

        # Current time + the transition time - as we should calculate the lights as they should be when
        # the transition is finished.
        # 86400 is 24 hours in seconds. % so that if the time overshoots 24 hours, the surplus is
        # shaved off.
        seconds_since_midnight_adjusted_for_offset = (
            seconds_since_midnight + offset_seconds
        ) % 86400

        return seconds_since_midnight_adjusted_for_offset  # noqa: RET504

    def _format_seconds_to_time(self, seconds_since_midnight: float) -> str:
        """Format seconds since midnight to HH:MM format."""
        seconds = int(seconds_since_midnight) % 86400  # Ensure within 24 hours
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        return f"{hours:02d}:{minutes:02d}"

    def get_sun_event(self, sun_events, seconds_since_midnight, offset=0) -> SunEvent:
        """Returns the current sun event, according to the current time of day. Can be offset by ie. 1 to get the next sun event instead."""
        sorted_sun_events = sorted(sun_events.values(), key=lambda x: x.start_time)

        # Find the event closest, but still in the future
        closest_match_index = None
        for index, sun_event in enumerate(sorted_sun_events):
            # Find the next sun_event index
            if sun_event.start_time >= seconds_since_midnight:
                closest_match_index = index - 1  # -1 to get current sun_event index
                break

        # If we couldn't find a match for today, we're past the last event
        # Return the last event of the day (which will wrap to next day's events)
        if closest_match_index is None:
            # We're past all events today, so current event is the last one
            closest_match_index = len(sorted_sun_events) - 1

        offset_index = closest_match_index + offset

        # The % strips away any overshooting of the list length
        return sorted_sun_events[offset_index % len(sorted_sun_events)]

    def _calculate_time_shift_from_transition_modifier(
        self, transition_modifier, sun_events
    ):
        """Calculate time shift from transition modifier percentage.

        -100%: Shift time to dawn (before noon) or dusk (after noon) - full low-light scene
        +100%: Shift time to noon - full bright scene
        +50%: Shift time halfway between current time and noon
        """
        if transition_modifier == 0:
            return 0

        current_time = self.seconds_since_midnight(0)  # Current time without any shift

        # Get noon, dawn, and dusk from the sun_events dictionary
        noon_event = sun_events.get("noon")
        dawn_event = sun_events.get("dawn")
        dusk_event = sun_events.get("dusk")

        if not noon_event or not dawn_event or not dusk_event:
            _LOGGER.error(
                "Could not find required solar events in sun_events dictionary"
            )
            return 0

        noon_time = noon_event.start_time

        if transition_modifier > 0:
            # Positive modifier: shift towards noon (brighter)
            target_time = noon_time
        elif current_time < noon_time:
            # Negative modifier before noon: shift towards dawn
            target_time = dawn_event.start_time
        else:
            # Negative modifier after noon: shift towards dusk
            target_time = dusk_event.start_time

        # Calculate time difference (can be negative)
        # For positive modifiers after noon: time_difference is negative (going backwards to today's noon)
        # For positive modifiers before noon: time_difference is positive (going forwards to today's noon)
        # For negative modifiers: time_difference direction depends on current time vs target
        time_difference = target_time - current_time

        # transition_modifier is a percentage of this time difference
        # -100% means shift fully to dawn/dusk (time_difference * 100 / 100)
        # +100% means shift fully to noon (time_difference * 100 / 100)
        # +50% means shift halfway (time_difference * 50 / 100)
        # transition_modifier comes in as a float like -99.0, 75.0, etc.
        modifier_percent = abs(transition_modifier)
        return int(time_difference * modifier_percent / 100)


async def apply_entities_parallel(entities, hass: HomeAssistant, transition_time=0):
    """Apply multiple entity states in parallel for better performance."""
    _LOGGER.debug("Starting parallel processing of %d entities", len(entities))

    # Create tasks for all entities
    tasks = []
    for entity in entities:
        task = asyncio.create_task(apply_single_entity(entity, hass, transition_time))
        tasks.append(task)

    # Wait for all entities to complete
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        _LOGGER.debug("Completed parallel processing of %d entities", len(entities))


async def apply_single_entity(entity, hass: HomeAssistant, transition_time=0):
    """Apply a single entity state."""
    domain = entity[ATTR_ENTITY_ID].split(".")[0]
    state = entity["state"]

    if "state" not in entity:
        _LOGGER.error(
            "The entity provided is missing a state property. Can't apply entity state (skipping). Entity: %s",
            entity,
        )
        return None
    if state in (STATE_UNAVAILABLE, STATE_UNKNOWN, STATE_PROBLEM, LockState.JAMMED):
        _LOGGER.error("Entity state is %s", entity["state"])
        return None

    if domain == LIGHT_DOMAIN:
        entity[ATTR_TRANSITION] = transition_time

    if domain == FAN_DOMAIN:
        _LOGGER.warning(
            "Extrapolation of fans only support turning them on/off. Direction, speed etc will be ignored until it's implemented. Please open an issue or PR if this is something you want"
        )

    # Set the service type
    entity_applied = entity.copy()
    service_type = None
    if state == "on":
        service_type = SERVICE_TURN_ON
    elif state == "off":
        service_type = SERVICE_TURN_OFF
    elif state in (LockState.LOCKED, LockState.LOCKING):
        service_type = SERVICE_LOCK
    elif state in (LockState.UNLOCKED, LockState.UNLOCKING):
        service_type = SERVICE_UNLOCK
    elif state in (STATE_OPEN, STATE_OPENING):
        # Use domain-specific services for open/close where applicable
        if domain == "cover":
            service_type = "open_cover"
        elif domain == "valve":
            service_type = "open_valve"
        else:
            service_type = SERVICE_TURN_ON
    elif state in (STATE_CLOSED, STATE_CLOSING):
        if domain == "cover":
            service_type = "close_cover"
        elif domain == "valve":
            service_type = "close_valve"
        else:
            service_type = SERVICE_TURN_OFF

    del entity_applied["state"]

    # When turning off lights, create a simple object with only entity_id and transition
    # since turn_off doesn't accept lighting attributes
    if domain == LIGHT_DOMAIN and service_type == SERVICE_TURN_OFF:
        entity_applied = {
            ATTR_ENTITY_ID: entity_applied[ATTR_ENTITY_ID],
            ATTR_TRANSITION: transition_time,
        }
    else:
        # Filter out None values to avoid service call errors
        # Home Assistant doesn't accept None values for attributes like 'effect'
        entity_applied = {
            key: value for key, value in entity_applied.items() if value is not None
        }

    _LOGGER.debug("%s.%s: %s", domain, service_type, entity_applied)

    try:
        await hass.services.async_call(
            domain=domain, service=service_type, service_data=entity_applied
        )
    except Exception as error:  # noqa: BLE001
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
    from_scene,
    to_scene,
    scene_transition_progress_percent,
    transition_time,
    hass: HomeAssistant,
    brightness_modifier=0,
) -> list:
    """Takes in a from and to scene and returns a list of new entity states.

    The new states is the extrapolated state between the two scenes.
    """

    _LOGGER.debug(
        "Extrapolating: %s → %s (%.1f%%)",
        from_scene.get("name", from_scene.get("entity_id", "unknown")),
        to_scene.get("name", to_scene.get("entity_id", "unknown")),
        scene_transition_progress_percent,
    )

    # Add any entities that are present in to_scene, but is missing from from_scene to the from_scene list.
    # This is needed as we are only checking from_scene["entities"] for entities to extrapolate
    for to_entity_id in to_scene["entities"]:
        if to_entity_id not in from_scene["entities"]:
            _LOGGER.debug(
                "Couldn't find %s in the scene we are extrapolating from. Assuming it should be turned off",
                to_entity_id,
            )
            from_entity = {"state": STATE_OFF}

            from_scene["entities"][to_entity_id] = from_entity

    # Collect all entity changes first, then apply them in parallel
    entity_changes = []

    # Process entity extrapolation in parallel for better performance
    async def process_entity_extrapolation(from_entity_id):
        final_entity = {ATTR_ENTITY_ID: from_entity_id}
        from_entity = from_scene["entities"][from_entity_id]

        # Assign to_entity
        if from_entity_id in to_scene["entities"]:
            to_entity = to_scene["entities"][from_entity_id]
        else:
            _LOGGER.debug(
                "Couldn't find %s in the scene we are extrapolating to. Assuming it should be turned off",
                from_entity_id,
            )
            to_entity = {"state": STATE_OFF}

        _LOGGER.debug(
            "  %s: %s → %s",
            from_entity_id,
            from_entity.get("state", "?"),
            to_entity.get("state", "?"),
        )

        # Log a warning if the device is unavailable
        if ("state" in from_entity and from_entity["state"] == STATE_UNAVAILABLE) or (
            "state" in to_entity and to_entity["state"] == STATE_UNAVAILABLE
        ):
            _LOGGER.warning("%s is unavailable and therefor skipped", from_entity_id)
            return None

        # Handle state
        if "state" in from_entity and "state" in to_entity:
            final_entity[ATTR_STATE] = extrapolate_state(
                from_entity,
                to_entity,
                final_entity,
                scene_transition_progress_percent,
            )
        else:
            _LOGGER.error(
                "From or to entity does not have a state and is therefor skipped. from_entity: %s, to_entity: %s",
                from_entity,
                to_entity,
            )
            return None

        # Let's make sure that if one of from/to_entities has a color mode, the other one has got one too.
        # If from_entity or to_entity is missing a color mode, we'll set it to the other's color mode
        if ATTR_COLOR_MODE not in from_entity and ATTR_COLOR_MODE in to_entity:
            from_entity[ATTR_COLOR_MODE] = to_entity[ATTR_COLOR_MODE]
        elif ATTR_COLOR_MODE not in to_entity and ATTR_COLOR_MODE in from_entity:
            to_entity[ATTR_COLOR_MODE] = from_entity[ATTR_COLOR_MODE]

        # Set the color mode we're actually going to extrapolate
        final_color_mode = None
        from_color_mode = from_entity.get(ATTR_COLOR_MODE)
        to_color_mode = to_entity.get(ATTR_COLOR_MODE)
        if ATTR_COLOR_MODE in from_entity or ATTR_COLOR_MODE in to_entity:
            if scene_transition_progress_percent >= 50:
                final_color_mode = to_color_mode
            else:
                final_color_mode = from_color_mode

        if final_color_mode or from_color_mode or to_color_mode:
            _LOGGER.debug(
                "    Color mode: %s → %s → %s",
                from_color_mode or "?",
                final_color_mode or "?",
                to_color_mode or "?",
            )

        # Collect all changes first, then apply once
        if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
            final_entity[ATTR_BRIGHTNESS] = extrapolate_brightness(
                from_entity,
                to_entity,
                final_entity,
                scene_transition_progress_percent,
                brightness_modifier,
            )

        if final_color_mode in (ColorMode.COLOR_TEMP, ATTR_COLOR_TEMP_KELVIN):
            final_entity[ATTR_COLOR_TEMP_KELVIN] = extrapolate_temp_kelvin(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ATTR_RGB_COLOR:
            final_entity[ATTR_RGB_COLOR] = extrapolate_rgb(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.HS:
            final_entity[ATTR_HS_COLOR] = extrapolate_hs(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.RGBW:
            final_entity[ATTR_RGBW_COLOR] = extrapolate_rgbw(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.RGBWW:
            final_entity[ATTR_RGBWW_COLOR] = extrapolate_rgbww(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        # Handle effects
        if ATTR_EFFECT in from_entity or ATTR_EFFECT in to_entity:
            final_entity[ATTR_EFFECT] = extrapolate_effect(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        # Log summary for non-light entities (light details already logged above)
        if not final_entity[ATTR_ENTITY_ID].startswith("light."):
            attrs_summary = {
                k: v
                for k, v in final_entity.items()
                if k not in (ATTR_ENTITY_ID, "state")
            }
            if attrs_summary:
                _LOGGER.debug("    Attributes: %s", attrs_summary)

        return final_entity

    # Process all entities in parallel
    extrapolation_start_time = time.time()
    tasks = []
    for from_entity_id in from_scene["entities"]:
        task = asyncio.create_task(process_entity_extrapolation(from_entity_id))
        tasks.append(task)

    # Wait for all extrapolation tasks to complete
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        # Filter out None results (unavailable entities)
        entity_changes = [result for result in results if result is not None]

    _LOGGER.debug(
        "Time extrapolating %d entities in parallel: %.3fs",
        len(entity_changes),
        time.time() - extrapolation_start_time,
    )

    # Apply all entity changes in parallel for better performance
    if entity_changes:
        batch_start_time = time.time()
        await apply_entities_parallel(entity_changes, hass, transition_time)
        _LOGGER.debug(
            "Time applying %d entities in parallel: %.3fs",
            len(entity_changes),
            time.time() - batch_start_time,
        )

    return True


def extrapolate_value(from_value, to_value, scene_transition_progress_percent):
    """Extrapolate a value."""
    difference = to_value - from_value
    current_transition_difference = difference * scene_transition_progress_percent / 100
    return round(from_value + current_transition_difference)


def extrapolate_number(
    from_number, to_number, scene_transition_progress_percent
) -> int:
    """Takes the current transition percent plus a from and to number and returns what the new value should be."""
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
    from_entity,
    to_entity,
    final_entity,
    scene_transition_progress_percent,
    brightness_modifier=0,
):
    """Extrapolate brightness."""
    # There isn't always a brightness attribute in the to_entity (ie. if it's turned off or the like)
    from_brightness = from_entity.get(ATTR_BRIGHTNESS, 0)

    to_brightness = to_entity.get(ATTR_BRIGHTNESS, 0)

    final_brightness = extrapolate_number(
        from_brightness,
        to_brightness,
        scene_transition_progress_percent,
    )

    # Apply brightness modifier (-100 to +100)
    if brightness_modifier != 0:
        modifier_factor = 1 + (brightness_modifier / 100.0)
        final_brightness = int(final_brightness * modifier_factor)
        # Clamp to valid brightness range (0-255)
        final_brightness = max(0, min(255, final_brightness))

    return final_brightness


def extrapolate_state(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolates a state that can't be animated. Ie. a switch that instantaniously turns from the off state to on."""
    from_state = (
        from_entity[ATTR_STATE] if ATTR_STATE in from_entity else to_entity[ATTR_STATE]
    )

    to_state = (
        to_entity[ATTR_STATE] if ATTR_STATE in to_entity else from_entity[ATTR_STATE]
    )

    if scene_transition_progress_percent <= 50:
        final_state = from_state
    else:
        final_state = to_state

    _LOGGER.debug(
        "    From state %s → now: %s → to: %s", from_state, final_state, to_state
    )

    return final_state


def extrapolate_temp_kelvin(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate color temperature Kelvin."""
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

    if from_color_temp_kelvin is None:
        _LOGGER.debug(
            "    Color mode: %s → %s → %s (limited: missing color_temp in 'from', using 'to')",
            from_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
        )
        from_color_temp_kelvin = to_color_temp_kelvin
    elif to_color_temp_kelvin is None:
        _LOGGER.debug(
            "    Color mode: %s → %s → %s (limited: missing color_temp in 'to', using 'from')",
            from_entity[ATTR_COLOR_MODE],
            from_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
        )
        to_color_temp_kelvin = from_color_temp_kelvin

    final_color_temp_kelvin = extrapolate_number(
        from_color_temp_kelvin,
        to_color_temp_kelvin,
        scene_transition_progress_percent,
    )

    _LOGGER.debug(
        "    From color temp: %s → now: %s → to: %s K (from brightness: %s → now: %s → to: %s)",
        from_color_temp_kelvin,
        final_color_temp_kelvin,
        to_color_temp_kelvin,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity[ATTR_BRIGHTNESS],
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return final_color_temp_kelvin


def extrapolate_rgb(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGB."""
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
        "    From RGB: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgb,
        rgb_extrapolated,
        to_rgb,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity[ATTR_BRIGHTNESS],
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgb_extrapolated


def extrapolate_hs(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate HS."""
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
        "    Frmo HS: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_hs,
        final_hs,
        to_hs,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity[ATTR_BRIGHTNESS],
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return final_hs


def extrapolate_rgbw(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGBW."""
    from_rgbw = (
        from_entity[ATTR_RGBW_COLOR]
        if ATTR_RGBW_COLOR in from_entity
        else to_entity[ATTR_RGBW_COLOR]
    )

    to_rgbw = (
        to_entity[ATTR_RGBW_COLOR]
        if ATTR_RGBW_COLOR in to_entity
        else from_entity[ATTR_RGBW_COLOR]
    )

    rgbw_extrapolated = [
        extrapolate_value(from_rgbw[0], to_rgbw[0], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[1], to_rgbw[1], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[2], to_rgbw[2], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[3], to_rgbw[3], scene_transition_progress_percent),
    ]

    _LOGGER.debug(
        "    From RGBW: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgbw,
        rgbw_extrapolated,
        to_rgbw,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity[ATTR_BRIGHTNESS],
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgbw_extrapolated


def extrapolate_rgbww(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGBWW."""
    from_rgbww = (
        from_entity[ATTR_RGBWW_COLOR]
        if ATTR_RGBWW_COLOR in from_entity
        else to_entity[ATTR_RGBWW_COLOR]
    )

    to_rgbww = (
        to_entity[ATTR_RGBWW_COLOR]
        if ATTR_RGBWW_COLOR in to_entity
        else from_entity[ATTR_RGBWW_COLOR]
    )

    rgbww_extrapolated = [
        extrapolate_value(
            from_rgbww[0], to_rgbww[0], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[1], to_rgbww[1], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[2], to_rgbww[2], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[3], to_rgbww[3], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[4], to_rgbww[4], scene_transition_progress_percent
        ),
    ]

    _LOGGER.debug(
        "    From RGBWW: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgbww,
        rgbww_extrapolated,
        to_rgbww,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity[ATTR_BRIGHTNESS],
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgbww_extrapolated


def extrapolate_effect(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate light effects."""
    from_effect = (
        from_entity[ATTR_EFFECT]
        if ATTR_EFFECT in from_entity
        else to_entity[ATTR_EFFECT]
    )

    to_effect = (
        to_entity[ATTR_EFFECT] if ATTR_EFFECT in to_entity else from_entity[ATTR_EFFECT]
    )

    # Effects can't be smoothly interpolated like colors or brightness
    # Instead, we choose which effect to use based on the transition progress
    if scene_transition_progress_percent < 50:
        final_effect = from_effect
    else:
        final_effect = to_effect

    _LOGGER.debug(
        "    From effect: %s → now: %s → to: %s", from_effect, final_effect, to_effect
    )

    return final_effect
