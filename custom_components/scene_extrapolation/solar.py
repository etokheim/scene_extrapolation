"""Solar events and elevation curve for scene activation and the panel."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from astral import LocationInfo
from astral.sun import elevation as sun_elevation
from astral.sun import sun
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

EVENT_META = (
    # mdi:horizon is not in HA's icon set, so dawn would render blank.
    ("dawn", "Dawn", "mdi:weather-sunset"),
    ("sunrise", "Sunrise", "mdi:weather-sunset-up"),
    ("noon", "Noon", "mdi:weather-sunny"),
    ("sunset", "Sunset", "mdi:weather-sunset-down"),
    ("dusk", "Dusk", "mdi:weather-night"),
)

EVENT_ORDER = ("dawn", "sunrise", "noon", "sunset", "dusk")
PREVIOUS_EVENTS = {
    "sunrise": "dawn",
    "noon": "sunrise",
    "sunset": "noon",
    "dusk": "sunset",
}

CURVE_STEP_MINUTES = 5
SECONDS_PER_DAY = 24 * 3600
# Earth's axial tilt; annual noon max is 90° inside the tropics.
AXIAL_TILT_DEG = 23.44

WINTER_FALLBACK = {
    "dawn": (8, 45),
    "sunrise": (10, 30),
    "noon": (12, 0),
    "sunset": (13, 0),
    "dusk": (22, 0),
}
SUMMER_FALLBACK = {
    "dawn": (2, 15),
    "sunrise": (4, 0),
    "noon": (13, 0),
    "sunset": (22, 0),
    "dusk": (23, 55),
}


def _seconds_since_midnight(value: datetime) -> int:
    midnight = value.replace(hour=0, minute=0, second=0, microsecond=0)
    return int((value - midnight).total_seconds())


def dusk_start_seconds(
    dusk_time: datetime,
    day_start: datetime,
    dusk_minimum: int | None,
) -> tuple[int, bool, int | None]:
    """Return dusk seconds since ``day_start``, applying earliest-dusk only that day.

    Earliest dusk delays a same-day solar dusk that falls before the floor.
    If solar dusk is already on the next calendar day (>= 24:00), keep end of
    day — do not pull back to the floor (that looked like “clamp to 22:00”).

    Returns ``(seconds, overridden, solar_seconds_if_overridden)``.
    ``seconds`` is in ``[0, SECONDS_PER_DAY]``.
    """
    dusk_aware = dusk_time
    if day_start.tzinfo is not None:
        if dusk_time.tzinfo is None:
            dusk_aware = dusk_time.replace(tzinfo=day_start.tzinfo)
        else:
            dusk_aware = dusk_time.astimezone(day_start.tzinfo)

    solar_seconds = int((dusk_aware - day_start).total_seconds())

    if solar_seconds >= SECONDS_PER_DAY:
        return SECONDS_PER_DAY, False, None

    solar_seconds = max(0, solar_seconds)
    if dusk_minimum is not None and int(dusk_minimum) > solar_seconds:
        return int(dusk_minimum), True, solar_seconds
    return solar_seconds, False, None


def _format_time(seconds: int) -> str:
    seconds = max(0, min(int(seconds), SECONDS_PER_DAY))
    hours, remainder = divmod(seconds, 3600)
    minutes = remainder // 60
    if hours == 24:
        return "24:00"
    return f"{hours:02d}:{minutes:02d}"


def _parse_target_date(
    time_zone: str, target_date: date | datetime | str | None
) -> datetime:
    tz = ZoneInfo(time_zone)
    if target_date is None:
        return datetime.now(tz)
    if isinstance(target_date, datetime):
        if target_date.tzinfo is None:
            return target_date.replace(tzinfo=tz)
        return target_date.astimezone(tz)
    if isinstance(target_date, str):
        parsed = date.fromisoformat(target_date)
        return datetime(parsed.year, parsed.month, parsed.day, tzinfo=tz)
    return datetime(target_date.year, target_date.month, target_date.day, tzinfo=tz)


def max_solar_elevation(latitude: float) -> float:
    """Highest solar elevation at this latitude (zenith inside the tropics)."""
    return 90.0 - max(0.0, abs(latitude) - AXIAL_TILT_DEG)


def _fallback_clock(latitude: float, month: int) -> dict[str, tuple[int, int]]:
    northern = latitude >= 0
    is_winter = (
        month in (10, 11, 12, 1, 2, 3) if northern else month in (4, 5, 6, 7, 8, 9)
    )
    return WINTER_FALLBACK if is_winter else SUMMER_FALLBACK


def resolve_solar_events(
    *,
    latitude: float,
    longitude: float,
    time_zone: str,
    target: datetime,
) -> tuple[dict[str, datetime], set[str]]:
    """Return dawn…dusk datetimes, using seasonal fallbacks when astral cannot.

    Same rules as scene activation (polar night / midnight sun / partial failure).
    """
    tz = ZoneInfo(time_zone)
    location = LocationInfo(timezone=time_zone, latitude=latitude, longitude=longitude)
    fallback_times = _fallback_clock(latitude, target.month)
    fallbacks: set[str] = set()

    try:
        raw = sun(location.observer, date=target.date())
        events: dict[str, datetime] = {}
        for name, event_time in raw.items():
            if event_time.tzinfo is None:
                events[name] = event_time.replace(tzinfo=tz)
            else:
                events[name] = event_time.astimezone(tz)
    except ValueError:
        _LOGGER.info(
            "Could not calculate solar events for %s (sun always below/above horizon). "
            "Using seasonal fallback times",
            target.date(),
        )
        events = {}

    for event_name in EVENT_ORDER:
        if event_name in events:
            continue
        hour, minute = fallback_times[event_name]
        seasonal = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
        fallback_time = seasonal
        prev_name = PREVIOUS_EVENTS.get(event_name)
        if prev_name and prev_name in events:
            previous_plus_offset = events[prev_name] + timedelta(minutes=30)
            fallback_time = max(previous_plus_offset, seasonal)
            if fallback_time == previous_plus_offset:
                _LOGGER.info(
                    "Could not calculate %s for %s. Using %s + 30min: %s",
                    event_name,
                    target.date(),
                    prev_name,
                    fallback_time.strftime("%H:%M"),
                )
            else:
                _LOGGER.info(
                    "Could not calculate %s for %s. Using seasonal fallback "
                    "(later than %s + 30min): %02d:%02d",
                    event_name,
                    target.date(),
                    prev_name,
                    hour,
                    minute,
                )
        else:
            _LOGGER.info(
                "Could not calculate %s for %s. Using seasonal fallback: %02d:%02d",
                event_name,
                target.date(),
                hour,
                minute,
            )
        events[event_name] = fallback_time
        fallbacks.add(event_name)

    return events, fallbacks


def build_sun_path(
    hass: HomeAssistant,
    dusk_minimum: int | None = None,
    target_date: date | datetime | str | None = None,
    location: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return solar events and elevation samples for a calendar day.

    `location` may supply latitude/longitude for a preview override. The clock
    and “today” stay on Home Assistant’s timezone — same as `turn_on`.
    """
    time_zone = hass.config.time_zone or "UTC"
    tz = ZoneInfo(time_zone)
    now = datetime.now(tz)
    target = _parse_target_date(time_zone, target_date)
    start = target.replace(hour=0, minute=0, second=0, microsecond=0)
    today = target.date() == now.date()
    latitude = float(location["latitude"]) if location else hass.config.latitude
    longitude = float(location["longitude"]) if location else hass.config.longitude
    place = LocationInfo(
        timezone=time_zone,
        latitude=latitude,
        longitude=longitude,
    )
    observer = place.observer

    events_by_name, fallbacks = resolve_solar_events(
        latitude=latitude,
        longitude=longitude,
        time_zone=time_zone,
        target=target,
    )

    events: list[dict[str, Any]] = []
    for event_id, label, icon in EVENT_META:
        event_time = events_by_name[event_id]
        overridden = False
        solar_time = None
        solar_seconds = None
        if event_id == "dusk":
            seconds, overridden, solar_raw = dusk_start_seconds(
                event_time, start, dusk_minimum
            )
            if overridden and solar_raw is not None:
                solar_time = _format_time(solar_raw)
                solar_seconds = int(solar_raw)
            event_time = start + timedelta(seconds=seconds)
        else:
            seconds = _seconds_since_midnight(event_time)
        events.append(
            {
                "id": event_id,
                "name": label,
                "icon": icon,
                "seconds": seconds,
                "time": _format_time(seconds),
                "elevation": round(float(sun_elevation(observer, event_time)), 2),
                "overridden": overridden,
                "fallback": event_id in fallbacks,
                "solar_time": solar_time,
                # True solar dusk when earliest-dusk delays the scene; UI marks
                # stay here while the interactive button uses `seconds`.
                "solar_seconds": solar_seconds,
            }
        )

    curve: list[list[float]] = []
    for minute in range(0, 24 * 60 + 1, CURVE_STEP_MINUTES):
        sample_at = start + timedelta(minutes=minute)
        seconds = minute * 60
        curve.append([seconds, round(float(sun_elevation(observer, sample_at)), 2)])

    now_seconds = _seconds_since_midnight(now)
    return {
        "date": target.date().isoformat(),
        "today": today,
        "now": {
            "seconds": now_seconds,
            "time": _format_time(now_seconds),
            "elevation": round(float(sun_elevation(observer, now)), 2),
        },
        "events": events,
        "curve": curve,
        "max_elevation": round(max_solar_elevation(latitude), 2),
    }
