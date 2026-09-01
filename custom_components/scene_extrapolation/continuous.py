"""Continuous follow-up activation: last-scene checks and override vs drift."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from homeassistant.components.light import (
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
)
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Context, HomeAssistant, State

from .color_math import entity_rgb
from .const import DATA_STORE, DOMAIN
from .store import DEFAULT_SETTINGS

# 0–255 brightness, kelvin, HS (hue 0–360 / sat 0–100), RGB channels.
BRIGHTNESS_TOLERANCE = 12
KELVIN_TOLERANCE = 80
HUE_TOLERANCE = 8
SAT_TOLERANCE = 12
RGB_TOLERANCE = 12
# Movement that still counts as "toward the command" (not a user bump).
TOWARD_MIN_DELTA = 4

# Color attrs used when comparing commanded vs reported light state.
_COLOR_ATTRS = (
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
)

ReportKind = Literal["sync", "drift", "override", "ignore"]


def continuous_interval_seconds(hass: HomeAssistant) -> int:
    """Follow-up delay and transition length (seconds). 0 disables follow-up."""
    domain_data = hass.data.get(DOMAIN) or {}
    store = domain_data.get(DATA_STORE)
    default = DEFAULT_SETTINGS["continuous_interval"]
    if store is None:
        return int(default)
    value = store.settings.get("continuous_interval", default)
    return int(value)


def should_arm_continuous(
    interval: int,
    *,
    enabled: bool,
    brightness_modifier: float,
    transition_percent_manual: bool,
) -> bool:
    """Follow-up only while preferred, clock-driven, and with no brightness offset."""
    return (
        enabled
        and interval > 0
        and not transition_percent_manual
        and brightness_modifier == 0
    )


def parse_scene_activated(state: str | None) -> datetime | None:
    """Parse a scene entity state (last-activated ISO time)."""
    if not state or state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
        return None
    text = state.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def last_activated_scene_id(states: dict[str, str | None]) -> str | None:
    """Entity id with the latest last-activated timestamp, or None if none."""
    best_id: str | None = None
    best_ts: datetime | None = None
    for entity_id, raw in states.items():
        ts = parse_scene_activated(raw)
        if ts is None:
            continue
        if best_ts is None or ts > best_ts:
            best_ts = ts
            best_id = entity_id
    return best_id


def entity_ids_from_service_event(data: dict[str, Any]) -> list[str]:
    """entity_id list from a call_service event (service_data or target)."""
    service_data = data.get("service_data") or {}
    raw = service_data.get("entity_id")
    if raw is None:
        target = service_data.get("target")
        if isinstance(target, dict):
            raw = target.get("entity_id")
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    return [str(item) for item in raw]


def competing_scene_activated(
    activated_ids: list[str],
    our_entity_id: str,
    area_scene_ids: set[str] | None,
) -> bool:
    """True when another scene (optionally limited to this area) was turned on."""
    others = [eid for eid in activated_ids if eid != our_entity_id]
    if not others:
        return False
    if area_scene_ids is None:
        return True
    return bool(area_scene_ids.intersection(others))


def context_is_ours(
    event_context: Context | None, apply_context: Context | None
) -> bool:
    """True when a state_changed event was caused by our light service call."""
    if apply_context is None or event_context is None:
        return False
    apply_id = apply_context.id
    return apply_id in (event_context.id, event_context.parent_id)


def _tuple_or_none(value: Any) -> tuple | None:
    if value is None:
        return None
    return tuple(value)


def snapshot_from_state(state: State | None) -> dict[str, Any] | None:
    """Comparable light fields from a HA state, or None if missing/unavailable."""
    if state is None:
        return None
    if state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
        return None
    attrs = state.attributes or {}
    return {
        "state": state.state,
        "brightness": attrs.get("brightness"),
        "color_temp_kelvin": attrs.get("color_temp_kelvin"),
        "hs_color": _tuple_or_none(attrs.get("hs_color")),
        "rgb_color": _tuple_or_none(attrs.get("rgb_color")),
        "rgbw_color": _tuple_or_none(attrs.get("rgbw_color")),
        "rgbww_color": _tuple_or_none(attrs.get("rgbww_color")),
    }


def snapshot_from_command(entity: dict[str, Any]) -> dict[str, Any]:
    """Comparable light fields from an extrapolated command payload."""
    return {
        "state": entity.get("state"),
        "brightness": entity.get("brightness"),
        "color_temp_kelvin": entity.get("color_temp_kelvin"),
        "hs_color": _tuple_or_none(entity.get("hs_color")),
        "rgb_color": _tuple_or_none(entity.get("rgb_color")),
        "rgbw_color": _tuple_or_none(entity.get("rgbw_color")),
        "rgbww_color": _tuple_or_none(entity.get("rgbww_color")),
    }


def _close(left: float | None, right: float | None, tolerance: float) -> bool:
    if left is None or right is None:
        return True
    return abs(left - right) <= tolerance


def _hue_close(left: float, right: float) -> bool:
    delta = abs(left - right) % 360
    return min(delta, 360 - delta) <= HUE_TOLERANCE


def _seq_close(left: tuple | None, right: tuple | None, tolerance: float) -> bool:
    if left is None or right is None:
        return True
    if len(left) != len(right):
        return False
    return all(abs(a - b) <= tolerance for a, b in zip(left, right, strict=True))


def _color_close(actual: dict[str, Any], commanded: dict[str, Any]) -> bool:
    """Compare overlapping color attrs; fall back to RGB when modes differ."""
    act_k = actual.get("color_temp_kelvin")
    cmd_k = commanded.get("color_temp_kelvin")
    if (
        act_k is not None
        and cmd_k is not None
        and not _close(act_k, cmd_k, KELVIN_TOLERANCE)
    ):
        return False

    act_hs = actual.get("hs_color")
    cmd_hs = commanded.get("hs_color")
    if act_hs is not None and cmd_hs is not None:
        if not _hue_close(act_hs[0], cmd_hs[0]):
            return False
        if abs(act_hs[1] - cmd_hs[1]) > SAT_TOLERANCE:
            return False

    for key in ("rgb_color", "rgbw_color", "rgbww_color"):
        if not _seq_close(actual.get(key), commanded.get(key), RGB_TOLERANCE):
            return False

    # Commanded kelvin, reported HS (or the reverse): compare mixed RGB.
    cmd_has_color = any(commanded.get(key) is not None for key in _COLOR_ATTRS)
    act_has_color = any(actual.get(key) is not None for key in _COLOR_ATTRS)
    overlapping_native = (
        (act_k is not None and cmd_k is not None)
        or (act_hs is not None and cmd_hs is not None)
        or (
            actual.get("rgb_color") is not None
            and commanded.get("rgb_color") is not None
        )
        or (
            actual.get("rgbw_color") is not None
            and commanded.get("rgbw_color") is not None
        )
        or (
            actual.get("rgbww_color") is not None
            and commanded.get("rgbww_color") is not None
        )
    )
    if cmd_has_color and act_has_color and not overlapping_native:
        act_rgb = entity_rgb(actual)
        cmd_rgb = entity_rgb(commanded)
        if act_rgb is None or cmd_rgb is None:
            return True
        if any(
            abs(a - b) > RGB_TOLERANCE for a, b in zip(act_rgb, cmd_rgb, strict=True)
        ):
            return False
    return True


def states_match(actual: dict[str, Any], commanded: dict[str, Any]) -> bool:
    """True when the reported light is within tolerance of what we commanded."""
    if actual.get("state") != commanded.get("state"):
        return False
    if commanded.get("state") != "on":
        return True
    if not _close(
        actual.get("brightness"), commanded.get("brightness"), BRIGHTNESS_TOLERANCE
    ):
        return False
    return _color_close(actual, commanded)


def moved_toward(
    pre: dict[str, Any],
    commanded: dict[str, Any],
    actual: dict[str, Any],
) -> bool:
    """True when brightness moved from pre toward the command, not past it."""
    if commanded.get("state") != "on" or actual.get("state") != "on":
        return False
    pre_b = pre.get("brightness") if pre.get("state") == "on" else 0
    cmd_b = commanded.get("brightness")
    act_b = actual.get("brightness")
    if pre_b is None or cmd_b is None or act_b is None:
        return False
    need = cmd_b - pre_b
    got = act_b - pre_b
    if abs(need) < 1:
        return False
    if need > 0:
        if got <= TOWARD_MIN_DELTA:
            return False
        return act_b <= cmd_b + BRIGHTNESS_TOLERANCE
    if got >= -TOWARD_MIN_DELTA:
        return False
    return act_b >= cmd_b - BRIGHTNESS_TOLERANCE


def classify_light_report(
    *,
    actual: dict[str, Any] | None,
    commanded: dict[str, Any],
    pre: dict[str, Any] | None,
    user_id: str | None,
    from_our_context: bool,
    mid_transition: bool,
) -> ReportKind:
    """Classify a light report as in-sync, drift/unresponsive, or user override.

    Unavailable/unknown reports are ignored (retry later, do not mark manual).
    Mid-transition reports are ignored unless a logged-in user changed the lamp.
    After the transition, a lamp that never left its pre-command state (or is
    still moving toward the command) is drift — keep retrying. A lamp that
    jumped somewhere else is an override.
    """
    if actual is None:
        return "ignore"
    if actual.get("state") in (STATE_UNAVAILABLE, STATE_UNKNOWN):
        return "ignore"

    if user_id:
        if states_match(actual, commanded):
            return "sync"
        return "override"

    if mid_transition:
        return "ignore"

    if states_match(actual, commanded):
        return "sync"
    if from_our_context:
        return "drift"
    if pre is not None and states_match(actual, pre):
        return "drift"
    if pre is not None and moved_toward(pre, commanded, actual):
        return "drift"
    return "override"
