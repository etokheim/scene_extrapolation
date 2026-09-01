"""
Create a scene entity which when activated calculates the appropriate lighting by extrapolating between user configured scenes.
"""  # noqa: D200, D212

import asyncio
import logging
import numbers
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from astral import LocationInfo
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
)
from homeassistant.components.light import DOMAIN as LIGHT_DOMAIN
from homeassistant.components.light import ColorMode
from homeassistant.components.lock import LockState
from homeassistant.components.scene import DOMAIN as SCENE_DOMAIN
from homeassistant.components.scene import Scene
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_STATE,
    EVENT_CALL_SERVICE,
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
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .color_math import (
    blend_entity_rgb,
    infer_color_mode,
    normalize_color_mode,
    same_color_mode,
)
from .const import (
    AREA,
    CATEGORY,
    CONTINUOUS,
    DATA_ADD_ENTITIES,
    DATA_ENTITIES,
    DATA_STORE,
    DOMAIN,
    LABELS,
    NIGHTLIGHTS_BOOLEAN,
    NIGHTLIGHTS_SCENE,
    SCENE_DAWN,
    SCENE_DUSK,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
    SCENE_NAME,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
)
from .continuous import (
    classify_light_report,
    competing_scene_activated,
    context_is_ours,
    continuous_interval_seconds,
    entity_ids_from_service_event,
    last_activated_scene_id,
    should_arm_continuous,
    snapshot_from_command,
    snapshot_from_state,
)
from .native_scene import scenes_in_area
from .solar import EVENT_ORDER, dusk_start_seconds, resolve_solar_events

DAY_PERCENT_STEP = 100.0 / (len(EVENT_ORDER) - 1)

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


class SunEvent:
    """Creates a sun event."""

    def __init__(self, name, start_time, scene, key) -> None:
        """Initialize a SunEvent."""
        self.name = name
        self.key = key
        self.start_time = start_time
        self.scene = scene


def current_sun_event_index(start_times: list[float], seconds: float) -> int:
    """Index of the last solar event that has started at `seconds`.

    The next event is the first whose start is *strictly after* now, so standing
    exactly on an event belongs to that event (0% into the following transition).
    Before the first event of the day, that is the last event (wrap from yesterday).
    """
    for index, start in enumerate(start_times):
        if start > seconds:
            return index - 1 if index else len(start_times) - 1
    return len(start_times) - 1


def transition_progress_percent(
    current_start: float, next_start: float, seconds: float
) -> float:
    """How far we are from current_start toward next_start (0–100).

    Raises HomeAssistantError if the result is outside that range — that is a
    bug in event pairing or wrap math, not something to clamp away.
    """
    seconds = seconds % 86400
    crossing_midnight = current_start > next_start

    if crossing_midnight:
        span = 86400 - current_start + next_start
        # Inclusive next-event bound: at exactly next_start remaining is 0 (100%),
        # not 86400 (which made progress negative).
        if seconds <= next_start:
            remaining = next_start - seconds
        else:
            remaining = 86400 - seconds + next_start
    else:
        span = next_start - current_start
        remaining = next_start - seconds

    if span == 0:
        return 0.0

    progress = 100 * (span - remaining) / span
    if progress < 0 or progress > 100:
        raise HomeAssistantError(
            f"Invalid transition progress: {progress:.1f}% "
            f"(expected 0-100%). This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: current={current_start}s, next={next_start}s, "
            f"time={seconds}s"
        )
    return progress


def day_transition_percent(
    current_key: str, next_key: str, intra_progress: float
) -> float:
    """0–100 along dawn → sunrise → noon → sunset → dusk.

    Each named scene is an equal 25% step so a manual set is predictable
    (0 dawn, 25 sunrise, 50 noon, 75 sunset, 100 dusk). Intra-progress is
    0–100 of the clock transition between current and next. After dusk
    (wrapping toward dawn) this stays 100 — the day's last scene.
    """
    if current_key == "dusk" and next_key == "dawn":
        return 100.0
    try:
        index = EVENT_ORDER.index(current_key)
    except ValueError as err:
        raise HomeAssistantError(
            f"Unknown solar event {current_key!r} for day transition percent"
        ) from err
    percent = (index + intra_progress / 100.0) * DAY_PERCENT_STEP
    if percent < 0 or percent > 100:
        raise HomeAssistantError(
            f"Invalid day transition percent: {percent:.1f}% "
            f"(expected 0-100%). This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: current={current_key}, next={next_key}, "
            f"intra={intra_progress}"
        )
    return percent


def scene_keys_from_day_percent(percent: float) -> tuple[str, str, float]:
    """Map 0–100 onto an event pair and intra-pair progress (0–100).

    100% is dusk fully activated (0% into dusk → dawn).
    """
    if percent < 0 or percent > 100:
        raise HomeAssistantError(
            f"Invalid day transition percent: {percent:.1f}% (expected 0-100%). "
            f"This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: percent={percent}"
        )
    last = len(EVENT_ORDER) - 1
    t = percent / DAY_PERCENT_STEP
    if t >= last:
        return EVENT_ORDER[-1], EVENT_ORDER[0], 0.0
    index = int(t)
    frac = t - index
    return EVENT_ORDER[index], EVENT_ORDER[index + 1], frac * 100.0


class ExtrapolationScene(Scene):
    """Representation the ExtrapolationScene."""

    def __init__(
        self, hass: HomeAssistant, config_entry: ConfigEntry, scene_config: dict
    ):
        """Initialize an ExtrapolationScene."""
        name = scene_config.get(SCENE_NAME) or "Automatic Lighting"
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
        self._commanded: dict[str, dict[str, Any]] = {}
        self._pre_apply: dict[str, dict[str, Any] | None] = {}
        self._apply_context: Context | None = None
        self._apply_until = 0.0
        self._continuous_armed = False
        self._activating_follow_up = False
        self._follow_up_generation = 0
        self._internal_scene_call = False
        self._unsub_follow_up = None
        self._unsub_call_service = None
        self._unsub_light_listener = None

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

    def _continuous_enabled(self) -> bool:
        """Per-scene play/pause preference (default on)."""
        return bool(self._cfg(CONTINUOUS, True))

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
        self._stop_continuous(write_state=False)
        await super().async_will_remove_from_hass()

    async def _async_refresh_transition_percent(self, _now) -> None:
        """Rewrite state so auto transition_percent tracks the clock."""
        if self._transition_percent_manual:
            return
        self.async_write_ha_state()

    async def async_update_config(self, scene_config: dict) -> None:
        """Apply an updated store item."""
        self._scene_config = scene_config
        self._attr_name = scene_config.get(SCENE_NAME) or self._attr_name
        self._area_id = scene_config.get(AREA)
        await self._async_sync_registry()
        # Pause preference stops a running loop; play does not activate lights.
        if not self._continuous_enabled() and self._continuous_armed:
            self._stop_continuous()
        else:
            self.async_write_ha_state()

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
            "transition_percent": round(self._current_day_transition_percent(), 1),
            "transition_percent_manual": self._transition_percent_manual,
            "integration": self._attr_integration,
            "continuous": self._continuous_armed,
            "overridden_lights": sorted(self._overridden),
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

    def _cancel_follow_up(self) -> None:
        """Drop the pending follow-up timer and invalidate in-flight ticks."""
        self._follow_up_generation += 1
        if self._unsub_follow_up:
            self._unsub_follow_up()
            self._unsub_follow_up = None

    def _unsub_light_tracking(self) -> None:
        if self._unsub_light_listener:
            self._unsub_light_listener()
            self._unsub_light_listener = None

    def _stop_continuous(self, *, write_state: bool = True) -> None:
        """Stop follow-up ticks and forget override/command snapshots."""
        self._cancel_follow_up()
        self._unsub_light_tracking()
        self._continuous_armed = False
        self._overridden.clear()
        self._commanded = {}
        self._pre_apply = {}
        self._apply_context = None
        if write_state and self.hass and self.entity_id:
            self.async_write_ha_state()

    def async_on_continuous_settings_changed(self) -> None:
        """Re-arm or stop follow-up when the global interval setting changes."""
        if not self._continuous_armed:
            return
        interval = continuous_interval_seconds(self.hass)
        if not should_arm_continuous(
            interval,
            enabled=self._continuous_enabled(),
            brightness_modifier=self._brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        ):
            self._stop_continuous()
            return
        self._schedule_follow_up(interval)

    def _schedule_follow_up(self, interval: int) -> None:
        """Arm a follow-up tick `interval` seconds from now."""
        if self._unsub_follow_up:
            self._unsub_follow_up()
            self._unsub_follow_up = None
        self._continuous_armed = True
        generation = self._follow_up_generation

        async def _fire(_now) -> None:
            self._unsub_follow_up = None
            if generation != self._follow_up_generation:
                return
            await self._async_follow_up()

        self._unsub_follow_up = async_call_later(self.hass, interval, _fire)
        self._sync_light_listener()
        self.async_write_ha_state()

    async def _async_follow_up(self) -> None:
        """Re-apply the scene if it is still the last one activated in the area."""
        interval = continuous_interval_seconds(self.hass)
        if not should_arm_continuous(
            interval,
            enabled=self._continuous_enabled(),
            brightness_modifier=self._brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        ):
            self._stop_continuous()
            return
        if not self._is_last_activated_in_area():
            _LOGGER.debug(
                "%s is no longer the last activated scene in its area; stopping continuous",
                self.entity_id,
            )
            self._stop_continuous()
            return
        self._collect_new_overrides()
        self._activating_follow_up = True
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
            )
            if kind == "override":
                _LOGGER.info(
                    "%s: %s looks manually overridden; skipping on follow-up",
                    self.entity_id,
                    entity_id,
                )
                self._overridden.add(entity_id)

    def _sync_light_listener(self) -> None:
        self._unsub_light_tracking()
        if not self._continuous_armed or not self._commanded:
            return
        self._unsub_light_listener = async_track_state_change_event(
            self.hass, list(self._commanded), self._on_light_state_changed
        )

    @callback
    def _on_light_state_changed(self, event: Event) -> None:
        """Mark a lamp overridden when a user (or off-path jump) changes it."""
        if not self._continuous_armed:
            return
        entity_id = event.data.get("entity_id")
        if not entity_id or entity_id in self._overridden:
            return
        commanded = self._commanded.get(entity_id)
        if commanded is None:
            return
        new_state = event.data.get("new_state")
        actual = snapshot_from_state(new_state)
        ctx = event.context
        kind = classify_light_report(
            actual=actual,
            commanded=commanded,
            pre=self._pre_apply.get(entity_id),
            user_id=getattr(ctx, "user_id", None),
            from_our_context=context_is_ours(ctx, self._apply_context),
            mid_transition=time.time() < self._apply_until,
        )
        if kind != "override":
            return
        _LOGGER.info(
            "%s: %s marked as manually overridden",
            self.entity_id,
            entity_id,
        )
        self._overridden.add(entity_id)
        self.async_write_ha_state()

    @callback
    def _on_call_service(self, event: Event) -> None:
        """Stop follow-up as soon as another scene in the area is turned on."""
        if not self._continuous_armed or self._internal_scene_call:
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
        self._stop_continuous()

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
        follow_up = self._activating_follow_up
        self._activating_follow_up = False
        if not follow_up:
            self._overridden.clear()
            self._cancel_follow_up()
            self._unsub_light_tracking()
            self._continuous_armed = False
            # scene.turn_on already records via Scene._async_activate; this
            # covers scene_extrapolation.turn_on. Follow-up must not record or
            # we would steal "last activated" from another scene in the area.
            if hasattr(self, "_async_record_activation"):
                self._async_record_activation()
        generation = self._follow_up_generation

        # Store the brightness modifier and optional manual day percent
        self._brightness_modifier = brightness_modifier
        if transition_percent is None:
            self._transition_percent_manual = False
            self._manual_transition_percent = None
        else:
            self._transition_percent_manual = True
            self._manual_transition_percent = transition_percent

        interval = continuous_interval_seconds(self.hass)
        will_follow = should_arm_continuous(
            interval,
            enabled=self._continuous_enabled(),
            brightness_modifier=brightness_modifier,
            transition_percent_manual=self._transition_percent_manual,
        )
        # Blueprint-style: first activation keeps the caller's transition
        # (usually 0). Follow-up ticks pass transition=interval and target
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
        #             Handle nightlights             #
        ##############################################
        nightlights_boolean_id = self._cfg(NIGHTLIGHTS_BOOLEAN)
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

            nightlights_scene_id = self._cfg(NIGHTLIGHTS_SCENE)

            try:
                self._internal_scene_call = True
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
            finally:
                self._internal_scene_call = False

            # Nightlights replace circadian targets; ignore those writes as overrides.
            self._unsub_light_tracking()
            self._commanded = {}
            self._pre_apply = {}
            self._apply_context = None

            # Keep the timer so circadian resumes when nightlights turn off.
            if generation != self._follow_up_generation:
                return
            if will_follow:
                self._schedule_follow_up(interval)
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

        solar_events, _fallbacks = resolve_solar_events(
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
            skip_entity_ids=self._overridden,
        )
        light_changes = [
            item
            for item in entity_changes
            if str(item.get(ATTR_ENTITY_ID, "")).startswith("light.")
        ]
        self._pre_apply = {
            item[ATTR_ENTITY_ID]: snapshot_from_state(
                self.hass.states.get(item[ATTR_ENTITY_ID])
            )
            for item in light_changes
        }
        self._commanded = {
            item[ATTR_ENTITY_ID]: snapshot_from_command(item) for item in light_changes
        }
        self._apply_context = Context()
        self._apply_until = time.time() + float(apply_transition or 0)
        if entity_changes:
            await apply_entities_parallel(
                entity_changes,
                self.hass,
                apply_transition,
                context=self._apply_context,
            )
        if will_follow:
            self._sync_light_listener()

        if generation != self._follow_up_generation:
            return
        if will_follow:
            self._schedule_follow_up(interval)
        else:
            self._continuous_armed = False
            self.async_write_ha_state()

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
        solar_events, _fallbacks = resolve_solar_events(
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


async def apply_entities_parallel(
    entities, hass: HomeAssistant, transition_time=0, context=None
):
    """Apply multiple entity states in parallel for better performance."""
    _LOGGER.debug("Starting parallel processing of %d entities", len(entities))

    # Create tasks for all entities
    tasks = []
    for entity in entities:
        task = asyncio.create_task(
            apply_single_entity(entity, hass, transition_time, context=context)
        )
        tasks.append(task)

    # Wait for all entities to complete
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        _LOGGER.debug("Completed parallel processing of %d entities", len(entities))


async def apply_single_entity(
    entity, hass: HomeAssistant, transition_time=0, context=None
):
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
            domain=domain,
            service=service_type,
            service_data=entity_applied,
            context=context,
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
    hass: HomeAssistant,
    brightness_modifier=0,
    skip_entity_ids=None,
) -> list:
    """Takes in a from and to scene and returns a list of new entity states.

    The new states is the extrapolated state between the two scenes.
    Does not apply — the caller snapshots pre-apply state then applies.
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

        from_color_mode = from_entity.get(ATTR_COLOR_MODE) or infer_color_mode(
            from_entity
        )
        to_color_mode = to_entity.get(ATTR_COLOR_MODE) or infer_color_mode(to_entity)
        # Same mode: channel-native lerp. Different modes: RGB-lerp endpoints and
        # write rgb_color so live apply does not snap at the old 50% mode flip.
        cross_mode = bool(from_color_mode or to_color_mode) and not same_color_mode(
            from_color_mode, to_color_mode
        )
        final_color_mode = (
            None
            if cross_mode
            else normalize_color_mode(from_color_mode or to_color_mode)
        )

        if final_color_mode or from_color_mode or to_color_mode:
            _LOGGER.debug(
                "    Color mode: %s → %s → %s",
                from_color_mode or "?",
                "rgb-blend" if cross_mode else (final_color_mode or "?"),
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

        if cross_mode:
            rgb = blend_entity_rgb(
                from_entity, to_entity, scene_transition_progress_percent
            )
            final_entity[ATTR_RGB_COLOR] = list(rgb)
        elif final_color_mode in (ColorMode.COLOR_TEMP, ATTR_COLOR_TEMP_KELVIN):
            final_entity[ATTR_COLOR_TEMP_KELVIN] = extrapolate_temp_kelvin(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode in (ColorMode.RGB, ATTR_RGB_COLOR):
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
    skip = skip_entity_ids or set()
    tasks = []
    for from_entity_id in from_scene["entities"]:
        if from_entity_id in skip:
            continue
        task = asyncio.create_task(process_entity_extrapolation(from_entity_id))
        tasks.append(task)

    entity_changes = []
    # Wait for all extrapolation tasks to complete
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        entity_changes = [
            result
            for result in results
            if result is not None and not isinstance(result, BaseException)
        ]

    _LOGGER.debug(
        "Time extrapolating %d entities in parallel: %.3fs",
        len(entity_changes),
        time.time() - extrapolation_start_time,
    )

    return entity_changes


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
        final_entity.get(ATTR_BRIGHTNESS, "?"),
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
        final_entity.get(ATTR_BRIGHTNESS, "?"),
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
        final_entity.get(ATTR_BRIGHTNESS, "?"),
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
        final_entity.get(ATTR_BRIGHTNESS, "?"),
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
        final_entity.get(ATTR_BRIGHTNESS, "?"),
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
