"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""  # noqa: D200, D212

import logging
import numbers
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from astral import LocationInfo
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN
from homeassistant.components.scene import Scene
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    EVENT_CALL_SERVICE,
    SERVICE_TURN_ON,
    STATE_OFF,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .activation_cache import cached_in_memory_scenes, cached_solar_events
from .apply_entities import (
    apply_entities_parallel,
    get_scene_by_uuid,
)
from .const import (
    AREA,
    CATEGORY,
    DATA_ADD_ENTITIES,
    DATA_ENTITIES,
    DATA_STORE,
    DEFAULT_SCENE_NAME,
    DOMAIN,
    LABELS,
    SCENE_DAWN,
    SCENE_DUSK,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
    SCENE_NAME,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
)
from .continuous import (
    automatically_update_lights_interval_seconds,
    classify_light_report,
    competing_scene_activated,
    context_is_ours,
    entity_ids_from_service_event,
    last_activated_scene_id,
    should_arm_automatically_update_lights,
    snapshot_from_command,
    snapshot_from_state,
)
from .extrapolation_math import (
    SunEvent,
    current_sun_event_index,
    day_transition_percent,
    extrapolate_entities,
    scene_keys_from_day_percent,
    transition_progress_percent,
)
from .native_scene import scenes_in_area
from .solar import EVENT_ORDER, dusk_start_seconds

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> bool:
    """Configure the platform from stored scene configs."""
    store = hass.data[DOMAIN][DATA_STORE]
    entities = hass.data[DOMAIN][DATA_ENTITIES]
    hass.data[DOMAIN][DATA_ADD_ENTITIES] = async_add_entities

    to_add = []
    for item in store.list():
        entity = ExtrapolationScene(hass, config_entry, item)
        entities[item["id"]] = entity
        to_add.append(entity)
    if to_add:
        async_add_entities(to_add)
    return True


async def async_create_or_update_entity(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    item: dict,
    async_add_entities: AddEntitiesCallback,
    entities: dict,
) -> ExtrapolationScene:
    """Create or update a scene entity for a stored config."""
    existing = entities.get(item["id"])
    if existing:
        await existing.async_update_config(item)
        return existing
    entity = ExtrapolationScene(hass, config_entry, item)
    entities[item["id"]] = entity
    async_add_entities([entity])
    return entity


async def async_remove_entity(entities: dict, scene_id: str) -> None:
    """Remove a scene entity."""
    entity = entities.pop(scene_id, None)
    if entity is not None:
        await entity.async_remove(force_remove=True)


class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(
        self, hass: HomeAssistant, config_entry: ConfigEntry, scene_config: dict
    ):
        """Initialize an ExtrapolationScene."""
        name = scene_config.get(SCENE_NAME) or DEFAULT_SCENE_NAME
        # Setting the entity_id to an already existing entity_id throws no errors. Instead a number is
        # appended to the expected entity_id. Ie. [entity_id]_2
        self.entity_id = "scene." + name.replace(" ", "_").casefold()
        self._scene_id = self.entity_id
        self.hass = hass
        self.config_entry = config_entry
        self._scene_config = scene_config

        self._attr_icon = "mdi:auto-fix"
        self._attr_name = name
        self._attr_unique_id = scene_config["id"]
        self._attr_integration = "scene_extrapolation"
        self._brightness_modifier = 0
        self._transition_percent_manual = False
        self._manual_transition_percent = None
        self._unsub_interval = None
        self._target_date_time = None
        self._area_id = scene_config.get(AREA)
        self._overridden: set[str] = set()
        self._interrupted: set[str] = set()
        self._commanded: dict[str, dict[str, Any]] = {}
        self._pre_apply: dict[str, dict[str, Any] | None] = {}
        self._apply_context: Context | None = None
        self._apply_until = 0.0
        self._automatically_update_lights_armed = False
        self._activating_automatically_update_lights = False
        self._only_entity_ids: set[str] | None = None
        self._automatically_update_lights_generation = 0
        self._internal_scene_call = False
        self._unsub_automatically_update_lights = None
        self._unsub_call_service = None
        self._unsub_light_listener = None
        self._last_attr_state_key = None

        # Used for calculating solar events when activating the scene
        self.latitude = self.hass.config.latitude
        self.longitude = self.hass.config.longitude
        self.time_zone = self.hass.config.time_zone
        self.city = LocationInfo(
            timezone=self.time_zone, latitude=self.latitude, longitude=self.longitude
        )

    def _cfg(self, key, default=None):
        """Read a value from the stored scene config."""
        value = self._scene_config.get(key)
        if value in (None, ""):
            return default
        return value

    def _automatically_update_lights_enabled(self) -> bool:
        """Always on per scene — master switch is the global interval (0 = off)."""
        return True

    async def async_added_to_hass(self) -> None:
        """Assign the configured area once the entity is registered."""
        await super().async_added_to_hass()
        await self._async_sync_registry()
        self._unsub_interval = async_track_time_interval(
            self.hass, self._async_refresh_transition_percent, timedelta(minutes=1)
        )
        self._unsub_call_service = self.hass.bus.async_listen(
            EVENT_CALL_SERVICE, self._on_call_service
        )

    async def async_will_remove_from_hass(self) -> None:
        """Stop timers and listeners when the entity is removed."""
        if self._unsub_interval:
            self._unsub_interval()
            self._unsub_interval = None
        if self._unsub_call_service:
            self._unsub_call_service()
            self._unsub_call_service = None
        self._stop_automatically_update_lights(write_state=False)
        await super().async_will_remove_from_hass()

    async def _async_refresh_transition_percent(self, _now) -> None:
        """Rewrite state so auto transition_percent tracks the clock."""
        if self._transition_percent_manual:
            return
        self._write_ha_state_if_attrs_changed()

    def _attr_state_key(self) -> tuple:
        """Comparable slice of attributes that drive recorder traffic."""
        return (
            round(self._current_day_transition_percent(), 1),
            self._transition_percent_manual,
            self._brightness_modifier,
            self._automatically_update_lights_enabled(),
            self._automatically_update_lights_armed,
            tuple(sorted(self._overridden)),
            tuple(sorted(self._interrupted)),
        )

    def _write_ha_state_if_attrs_changed(self) -> None:
        """Skip async_write_ha_state when rounded attrs are unchanged."""
        key = self._attr_state_key()
        if key == self._last_attr_state_key:
            return
        self._last_attr_state_key = key
        self.async_write_ha_state()

    async def async_update_config(self, scene_config: dict) -> None:
        """Apply an updated store item."""
        self._scene_config = scene_config
        self._attr_name = scene_config.get(SCENE_NAME) or self._attr_name
        self._area_id = scene_config.get(AREA)
        await self._async_sync_registry()
        # Global interval 0 (or disabled) stops a running loop.
        if (
            not self._automatically_update_lights_enabled()
            and self._automatically_update_lights_armed
        ):
            self._stop_automatically_update_lights()
        else:
            self._write_ha_state_if_attrs_changed()

    async def _async_sync_registry(self) -> None:
        """Keep entity registry area, labels, and category in sync."""
        entity_reg = er.async_get(self.hass)
        entry = entity_reg.async_get(self.entity_id)
        if not entry:
            return
        updates: dict[str, Any] = {"area_id": self._area_id}
        labels = self._scene_config.get(LABELS)
        if labels is not None:
            updates["labels"] = set(labels)
        # Always write categories so clearing the scene category is not a no-op.
        categories = dict(entry.categories or {})
        category = self._scene_config.get(CATEGORY)
        if category:
            categories["scene"] = category
        else:
            categories.pop("scene", None)
        updates["categories"] = categories
        entity_reg.async_update_entity(self.entity_id, **updates)

    async def async_get_in_memory_scenes(self):
        """Get scenes from in-memory scene entities instead of reading YAML."""
        scenes = cached_in_memory_scenes(self.hass)
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
            "transition_percent": round(self._current_day_transition_percent(), 1),
            "transition_percent_manual": self._transition_percent_manual,
            "integration": self._attr_integration,
            "automatically_update_lights": self._automatically_update_lights_enabled(),
            "automatically_update_lights_active": self._automatically_update_lights_armed,
            "overridden_lights": sorted(self._overridden),
            "interrupted_lights": sorted(self._interrupted),
        }
        if self._target_date_time is not None:
            attrs["target_date_time"] = self._target_date_time.isoformat()

        # Expose scene entity_ids as attributes
        for attr_name, key in (
            ("dawn_scene", SCENE_DAWN),
            ("sunrise_scene", SCENE_SUNRISE),
            ("noon_scene", SCENE_NOON),
            ("sunset_scene", SCENE_SUNSET),
            ("dusk_scene", SCENE_DUSK),
        ):
            value = self._cfg(key)
            if value:
                attrs[attr_name] = value

        return attrs

    def _cancel_automatically_update_lights(self) -> None:
        """Drop the pending automatic light update timer and invalidate in-flight ticks."""
        self._automatically_update_lights_generation += 1
        if self._unsub_automatically_update_lights:
            self._unsub_automatically_update_lights()
            self._unsub_automatically_update_lights = None

    def _unsub_light_tracking(self) -> None:
        if self._unsub_light_listener:
            self._unsub_light_listener()
            self._unsub_light_listener = None

    def _stop_automatically_update_lights(self, *, write_state: bool = True) -> None:
        """Stop automatic light update ticks and forget override/command snapshots."""
        self._cancel_automatically_update_lights()
        self._unsub_light_tracking()
        self._automatically_update_lights_armed = False
        self._overridden.clear()
        self._interrupted.clear()
        self._commanded = {}
        self._pre_apply = {}
        self._apply_context = None
        self._only_entity_ids = None
        if write_state and self.hass and self.entity_id:
            self._write_ha_state_if_attrs_changed()

    def async_on_automatically_update_lights_settings_changed(self) -> None:
        """Re-arm or stop automatic light update when the global interval setting changes."""
        if not self._automatically_update_lights_armed:
            return
        interval = automatically_update_lights_interval_seconds(self.hass)
        if not should_arm_automatically_update_lights(
            interval,
            enabled=self._automatically_update_lights_enabled(),
            brightness_modifier=self._brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        ):
            self._stop_automatically_update_lights()
            return
        self._schedule_automatically_update_lights(interval)

    def _schedule_automatically_update_lights(self, interval: int) -> None:
        """Arm a automatic light update tick `interval` seconds from now."""
        if self._unsub_automatically_update_lights:
            self._unsub_automatically_update_lights()
            self._unsub_automatically_update_lights = None
        self._automatically_update_lights_armed = True
        generation = self._automatically_update_lights_generation

        async def _fire(_now) -> None:
            self._unsub_automatically_update_lights = None
            if generation != self._automatically_update_lights_generation:
                return
            await self._async_automatically_update_lights()

        self._unsub_automatically_update_lights = async_call_later(
            self.hass, interval, _fire
        )
        self._sync_light_listener()
        self._write_ha_state_if_attrs_changed()

    async def _async_automatically_update_lights(self) -> None:
        """Re-apply the scene if it is still the last one activated in the area."""
        interval = automatically_update_lights_interval_seconds(self.hass)
        if not should_arm_automatically_update_lights(
            interval,
            enabled=self._automatically_update_lights_enabled(),
            brightness_modifier=self._brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        ):
            self._stop_automatically_update_lights()
            return
        if not self._is_last_activated_in_area():
            _LOGGER.debug(
                "%s is no longer the last activated scene in its area; stopping continuous",
                self.entity_id,
            )
            self._stop_automatically_update_lights()
            return
        self._collect_new_overrides()
        self._activating_automatically_update_lights = True
        await self.async_activate(transition=interval)

    def _is_last_activated_in_area(self) -> bool:
        """True when no other scene in this area has a newer last-activated time."""
        area_id = self._area_id
        if not area_id:
            return True
        scene_ids = scenes_in_area(self.hass, area_id)
        states = {
            entity_id: (
                state.state if (state := self.hass.states.get(entity_id)) else None
            )
            for entity_id in scene_ids
        }
        if self.entity_id not in states:
            own = self.hass.states.get(self.entity_id)
            states[self.entity_id] = own.state if own else None
        latest = last_activated_scene_id(states)
        return latest is None or latest == self.entity_id

    def _collect_new_overrides(self) -> None:
        """Mark lights that jumped off the commanded path after the transition."""
        mid = time.time() < self._apply_until
        for entity_id, commanded in self._commanded.items():
            if entity_id in self._overridden:
                continue
            actual = snapshot_from_state(self.hass.states.get(entity_id))
            kind = classify_light_report(
                actual=actual,
                commanded=commanded,
                pre=self._pre_apply.get(entity_id),
                user_id=None,
                from_our_context=False,
                mid_transition=mid,
                previous_was_down=False,
                was_interrupted=entity_id in self._interrupted,
            )
            if kind == "interrupt":
                self._interrupted.add(entity_id)
            elif kind == "override":
                _LOGGER.info(
                    "%s: %s looks manually overridden; skipping on automatic light update",
                    self.entity_id,
                    entity_id,
                )
                self._interrupted.discard(entity_id)
                self._overridden.add(entity_id)
            elif kind in ("sync", "drift", "recover"):
                self._interrupted.discard(entity_id)

    def _sync_light_listener(self) -> None:
        self._unsub_light_tracking()
        watch = set(self._commanded) | self._interrupted
        if not self._automatically_update_lights_armed or not watch:
            return
        self._unsub_light_listener = async_track_state_change_event(
            self.hass, list(watch), self._on_light_state_changed
        )

    @callback
    def _on_light_state_changed(self, event: Event) -> None:
        """Track overrides, power interrupts, and restore reclaim."""
        if not self._automatically_update_lights_armed:
            return
        entity_id = event.data.get("entity_id")
        if not entity_id or entity_id in self._overridden:
            return
        commanded = self._commanded.get(entity_id)
        if commanded is None:
            return
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        actual = snapshot_from_state(new_state)
        previous_was_down = old_state is None or old_state.state in (
            STATE_UNAVAILABLE,
            STATE_UNKNOWN,
            STATE_OFF,
        )
        ctx = event.context
        kind = classify_light_report(
            actual=actual,
            commanded=commanded,
            pre=self._pre_apply.get(entity_id),
            user_id=getattr(ctx, "user_id", None),
            from_our_context=context_is_ours(ctx, self._apply_context),
            mid_transition=time.time() < self._apply_until,
            previous_was_down=previous_was_down,
            was_interrupted=entity_id in self._interrupted,
        )
        if kind == "interrupt":
            if entity_id not in self._interrupted:
                _LOGGER.debug(
                    "%s: %s interrupted (power loss / off); will reclaim on restore",
                    self.entity_id,
                    entity_id,
                )
                self._interrupted.add(entity_id)
                self._write_ha_state_if_attrs_changed()
            return
        if kind == "recover":
            _LOGGER.info(
                "%s: %s restored after interrupt; re-applying circadian target",
                self.entity_id,
                entity_id,
            )
            self._interrupted.discard(entity_id)
            self._write_ha_state_if_attrs_changed()
            self.hass.async_create_task(self._async_reapply_one_light(entity_id))
            return
        if kind != "override":
            return
        _LOGGER.info(
            "%s: %s marked as manually overridden",
            self.entity_id,
            entity_id,
        )
        self._interrupted.discard(entity_id)
        self._overridden.add(entity_id)
        self._write_ha_state_if_attrs_changed()

    async def _async_reapply_one_light(self, entity_id: str) -> None:
        """Re-apply the current circadian target to one restored light."""
        if not self._automatically_update_lights_armed or entity_id in self._overridden:
            return
        if not self._is_last_activated_in_area():
            return
        self._only_entity_ids = {entity_id}
        self._activating_automatically_update_lights = True
        try:
            # Short transition — reclaim without a full-interval fade.
            await self.async_activate(transition=1)
        finally:
            self._only_entity_ids = None

    @callback
    def _on_call_service(self, event: Event) -> None:
        """Stop automatic light update as soon as another scene in the area is turned on."""
        if not self._automatically_update_lights_armed or self._internal_scene_call:
            return
        data = event.data or {}
        domain = data.get("domain")
        if data.get("service") != SERVICE_TURN_ON:
            return
        if domain not in (SCENE_DOMAIN, DOMAIN):
            return
        activated = entity_ids_from_service_event(data)
        area_ids = (
            set(scenes_in_area(self.hass, self._area_id)) if self._area_id else None
        )
        if not competing_scene_activated(activated, self.entity_id, area_ids):
            return
        _LOGGER.debug(
            "%s: another scene in the area was activated (%s); stopping continuous",
            self.entity_id,
            activated,
        )
        self._stop_automatically_update_lights()

    async def async_activate(
        self,
        transition=0,
        brightness_modifier=0,
        transition_percent=None,
        target_date_time=None,
        location=None,
    ):
        """Activate the scene.

        Args:
            transition: Transition time in seconds
            brightness_modifier: Brightness modifier percentage (-100 to 100)
            transition_percent: Absolute 0–100 position along the day (dawn 0,
                sunrise 25, noon 50, sunset 75, dusk 100). None uses the clock.
            target_date_time: Optional datetime to base extrapolation on (defaults to current time)
            location: Optional dict with 'latitude' and 'longitude' keys to override location
                     (defaults to Home Assistant's configured location)
        """
        is_auto_update_tick = self._activating_automatically_update_lights
        self._activating_automatically_update_lights = False
        only_ids = self._only_entity_ids
        if not is_auto_update_tick:
            self._overridden.clear()
            self._interrupted.clear()
            self._cancel_automatically_update_lights()
            self._unsub_light_tracking()
            self._automatically_update_lights_armed = False
            # scene.turn_on already records via Scene._async_activate; this
            # covers scene_extrapolation.turn_on. Auto-update ticks must not
            # record or we would steal "last activated" from another scene.
            if hasattr(self, "_async_record_activation"):
                self._async_record_activation()
        generation = self._automatically_update_lights_generation

        # Store the brightness modifier and optional manual day percent
        self._brightness_modifier = brightness_modifier
        if transition_percent is None:
            self._transition_percent_manual = False
            self._manual_transition_percent = None
        else:
            self._transition_percent_manual = True
            self._manual_transition_percent = transition_percent

        interval = automatically_update_lights_interval_seconds(self.hass)
        will_follow = should_arm_automatically_update_lights(
            interval,
            enabled=self._automatically_update_lights_enabled(),
            brightness_modifier=brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        )
        # Blueprint-style: first activation keeps the caller's transition
        # (usually 0). Auto-update ticks pass transition=interval and target
        # how the room should look at now+interval.
        apply_transition = transition

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

        if apply_transition == 6553:
            _LOGGER.warning(
                "Home Assistant doesn't support transition times longer than 6553 (109 minutes). Anything above this value seems to be disregarded. The integration received a transition time of: %s",
                apply_transition,
            )

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

        solar_events, _fallbacks = cached_solar_events(
            self.hass,
            latitude=location_latitude,
            longitude=location_longitude,
            time_zone=location_timezone,
            target=target_date_time,
        )

        scene_dusk_minimum_time_of_day = self._cfg(SCENE_DUSK_MINIMUM_TIME_OF_DAY)

        assert isinstance(
            scene_dusk_minimum_time_of_day, numbers.Number
        ), "scene_dusk_minimum_time_of_day is either not configured (or not a number)"

        day_start = target_date_time.replace(hour=0, minute=0, second=0, microsecond=0)
        dusk_seconds, dusk_was_overridden, dusk_solar_seconds = dusk_start_seconds(
            solar_events["dusk"],
            day_start,
            scene_dusk_minimum_time_of_day,
        )
        dusk_original_time = dusk_solar_seconds if dusk_was_overridden else None

        sun_events = {
            "dawn": SunEvent(
                name="Dawn",
                key="dawn",
                scene=get_scene_by_uuid(
                    scenes,
                    self._cfg(SCENE_DAWN),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["dawn"]
                ),
            ),
            "sunrise": SunEvent(
                name="Sunrise",
                key="sunrise",
                scene=get_scene_by_uuid(
                    scenes,
                    self._cfg(SCENE_SUNRISE),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunrise"]
                ),
            ),
            "noon": SunEvent(
                name="Noon",
                key="noon",
                scene=get_scene_by_uuid(
                    scenes,
                    self._cfg(SCENE_NOON),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["noon"]
                ),
            ),
            "sunset": SunEvent(
                name="Sunset",
                key="sunset",
                scene=get_scene_by_uuid(
                    scenes,
                    self._cfg(SCENE_SUNSET),
                ),
                start_time=self.datetime_to_seconds_since_midnight(
                    solar_events["sunset"]
                ),
            ),
            "dusk": SunEvent(
                name="Dusk",
                key="dusk",
                scene=get_scene_by_uuid(
                    scenes,
                    self._cfg(SCENE_DUSK),
                ),
                start_time=dusk_seconds,
            ),
        }

        current_seconds = self.seconds_since_midnight(0)
        final_time = self.seconds_since_midnight(apply_transition)

        if self._transition_percent_manual:
            current_key, next_key, scene_transition_progress_percent = (
                scene_keys_from_day_percent(self._manual_transition_percent)
            )
            current_sun_event = sun_events[current_key]
            next_sun_event = sun_events[next_key]
            day_percent = self._manual_transition_percent
        else:
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
            scene_transition_progress_percent = (
                self.get_scene_transition_progress_percent(
                    current_sun_event, next_sun_event, final_time
                )
            )
            day_percent = day_transition_percent(
                current_sun_event.key,
                next_sun_event.key,
                scene_transition_progress_percent,
            )

        # Only run logging code if log level is info or higher
        if _LOGGER.isEnabledFor(logging.INFO):
            current_time_str = self._format_seconds_to_time(current_seconds)
            final_time_str = self._format_seconds_to_time(final_time)

            _LOGGER.info("=" * 60)
            _LOGGER.info("Scene Activation Details")
            _LOGGER.info("=" * 60)
            _LOGGER.info(
                "Brightness modifier %s, transition time %ss",
                brightness_modifier,
                apply_transition,
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
            _LOGGER.info("Apply as of:     %s", final_time_str)
            _LOGGER.info(
                "Day transition:  %s%% (%s)",
                round(day_percent, 1),
                "manual" if self._transition_percent_manual else "auto",
            )

            _LOGGER.info("")
            _LOGGER.info("Solar Events:")

            sorted_sun_events = sorted(sun_events.values(), key=lambda x: x.start_time)
            for sun_event in sorted_sun_events:
                event_time_str = self._format_seconds_to_time(sun_event.start_time)
                scene_entity_id = sun_event.scene.get("entity_id", "N/A")
                if sun_event.key == "dusk" and dusk_was_overridden:
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

        entity_changes = await extrapolate_entities(
            current_sun_event.scene,
            next_sun_event.scene,
            scene_transition_progress_percent,
            self.hass,
            brightness_modifier,
            skip_entity_ids=self._overridden | self._interrupted,
        )
        if only_ids is not None:
            entity_changes = [
                item for item in entity_changes if item.get(ATTR_ENTITY_ID) in only_ids
            ]
        light_changes = [
            item
            for item in entity_changes
            if str(item.get(ATTR_ENTITY_ID, "")).startswith("light.")
        ]
        if is_auto_update_tick:
            # Keep snapshots for interrupted/overridden lamps we are not touching.
            for item in light_changes:
                eid = item[ATTR_ENTITY_ID]
                self._pre_apply[eid] = snapshot_from_state(self.hass.states.get(eid))
                self._commanded[eid] = snapshot_from_command(item)
        else:
            self._pre_apply = {
                item[ATTR_ENTITY_ID]: snapshot_from_state(
                    self.hass.states.get(item[ATTR_ENTITY_ID])
                )
                for item in light_changes
            }
            self._commanded = {
                item[ATTR_ENTITY_ID]: snapshot_from_command(item)
                for item in light_changes
            }
        self._apply_context = Context()
        self._apply_until = time.time() + float(apply_transition or 0)
        if entity_changes:
            await apply_entities_parallel(
                entity_changes,
                self.hass,
                apply_transition,
                context=self._apply_context,
                skip_noop=is_auto_update_tick,
            )
        if will_follow:
            self._sync_light_listener()

        if generation != self._automatically_update_lights_generation:
            return
        # Single-light recover must not reset the interval timer.
        if will_follow and only_ids is None:
            self._schedule_automatically_update_lights(interval)
        elif will_follow:
            self._automatically_update_lights_armed = True
            self._write_ha_state_if_attrs_changed()
        else:
            self._automatically_update_lights_armed = False
            self._write_ha_state_if_attrs_changed()

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
        return transition_progress_percent(
            current_sun_event.start_time,
            next_sun_event.start_time,
            seconds_since_midnight,
        )

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
        starts = [event.start_time for event in sorted_sun_events]
        closest_match_index = current_sun_event_index(
            starts, seconds_since_midnight % 86400
        )
        offset_index = closest_match_index + offset
        return sorted_sun_events[offset_index % len(sorted_sun_events)]

    def _current_day_transition_percent(self) -> float:
        """Day position for the state attribute: stored if manual, else from the clock."""
        if self._transition_percent_manual:
            return self._manual_transition_percent
        target = (
            self._target_date_time
            if self._target_date_time is not None
            else datetime.now(tz=ZoneInfo(self.time_zone))
        )
        solar_events, _fallbacks = cached_solar_events(
            self.hass,
            latitude=self.latitude,
            longitude=self.longitude,
            time_zone=self.time_zone,
            target=target,
        )
        dusk_minimum = self._cfg(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
        assert isinstance(
            dusk_minimum, numbers.Number
        ), "scene_dusk_minimum_time_of_day is either not configured (or not a number)"
        day_start = target.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = {
            key: self.datetime_to_seconds_since_midnight(solar_events[key])
            for key in EVENT_ORDER
            if key != "dusk"
        }
        starts["dusk"], _overridden, _solar = dusk_start_seconds(
            solar_events["dusk"],
            day_start,
            dusk_minimum,
        )
        seconds = self.seconds_since_midnight(0)
        ordered = sorted(EVENT_ORDER, key=lambda key: starts[key])
        times = [starts[key] for key in ordered]
        index = current_sun_event_index(times, seconds % 86400)
        current_key = ordered[index]
        next_key = ordered[(index + 1) % len(ordered)]
        intra = transition_progress_percent(
            starts[current_key], starts[next_key], seconds
        )
        return day_transition_percent(current_key, next_key, intra)
