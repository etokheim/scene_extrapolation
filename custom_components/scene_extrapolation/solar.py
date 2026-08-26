"""Solar events and elevation curve for the panel visualization."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from astral import LocationInfo
from astral.sun import elevation as sun_elevation
from astral.sun import sun
from homeassistant.core import HomeAssistant

EVENT_META = (
    ("dawn", "Dawn", "mdi:horizon"),
    ("sunrise", "Sunrise", "mdi:weather-sunset-up"),
    ("noon", "Noon", "mdi:weather-sunny"),
    ("sunset", "Sunset", "mdi:weather-sunset-down"),
    ("dusk", "Dusk", "mdi:weather-night"),
)

CURVE_STEP_MINUTES = 5
SECONDS_PER_DAY = 24 * 3600


def _seconds_since_midnight(value: datetime) -> int:
    midnight = value.replace(hour=0, minute=0, second=0, microsecond=0)
    return int((value - midnight).total_seconds())


def _format_time(seconds: int) -> str:
    seconds = max(0, min(int(seconds), SECONDS_PER_DAY))
    hours, remainder = divmod(seconds, 3600)
    minutes = remainder // 60
    if hours == 24:
        return "24:00"
    return f"{hours:02d}:{minutes:02d}"


def build_sun_path(
    hass: HomeAssistant, dusk_minimum: int | None = None
) -> dict[str, Any]:
    """Return today's solar events and elevation samples for the chart."""
    time_zone = hass.config.time_zone or "UTC"
    tz = ZoneInfo(time_zone)
    now = datetime.now(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    location = LocationInfo(
        timezone=time_zone,
        latitude=hass.config.latitude,
        longitude=hass.config.longitude,
    )
    observer = location.observer

    events_by_name: dict[str, datetime] = {}
    try:
        raw = sun(observer, date=now.date())
        for name, event_time in raw.items():
            if event_time.tzinfo is None:
                event_time = event_time.replace(tzinfo=tz)
            else:
                event_time = event_time.astimezone(tz)
            events_by_name[name] = event_time
    except ValueError:
        events_by_name = {}

    events: list[dict[str, Any]] = []
    for event_id, label, icon in EVENT_META:
        event_time = events_by_name.get(event_id)
        if event_time is None:
            continue
        seconds = _seconds_since_midnight(event_time)
        overridden = False
        solar_time = None
        if event_id == "dusk" and dusk_minimum is not None and dusk_minimum > seconds:
            solar_time = _format_time(seconds)
            seconds = int(dusk_minimum)
            overridden = True
            event_time = start + timedelta(seconds=seconds)
        events.append(
            {
                "id": event_id,
                "name": label,
                "icon": icon,
                "seconds": seconds,
                "time": _format_time(seconds),
                "elevation": round(float(sun_elevation(observer, event_time)), 2),
                "overridden": overridden,
                "solar_time": solar_time,
            }
        )

    curve: list[list[float]] = []
    for minute in range(0, 24 * 60 + 1, CURVE_STEP_MINUTES):
        sample_at = start + timedelta(minutes=minute)
        seconds = minute * 60
        curve.append([seconds, round(float(sun_elevation(observer, sample_at)), 2)])

    now_seconds = _seconds_since_midnight(now)
    return {
        "now": {
            "seconds": now_seconds,
            "time": _format_time(now_seconds),
            "elevation": round(float(sun_elevation(observer, now)), 2),
        },
        "events": events,
        "curve": curve,
    }
