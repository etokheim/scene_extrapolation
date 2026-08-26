"""Preview payloads for the sidebar panel light bars."""

from __future__ import annotations

import copy
from math import log
from typing import Any

from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ColorMode,
)
from homeassistant.const import ATTR_STATE, STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant

from .const import (
    SCENE_DAWN,
    SCENE_DUSK,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
)
from .native_scene import scene_entity_payload
from .scene import (
    current_sun_event_index,
    extrapolate_brightness,
    extrapolate_hs,
    extrapolate_rgb,
    extrapolate_rgbw,
    extrapolate_rgbww,
    extrapolate_state,
    extrapolate_temp_kelvin,
    transition_progress_percent,
)
from .solar import CURVE_STEP_MINUTES, build_sun_path

SCENE_KEYS = {
    "dawn": SCENE_DAWN,
    "sunrise": SCENE_SUNRISE,
    "noon": SCENE_NOON,
    "sunset": SCENE_SUNSET,
    "dusk": SCENE_DUSK,
}

DEFAULT_RGB = (255, 214, 170)


def load_native_scenes(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    """Return native HA scenes keyed by entity_id."""
    scene_component = hass.data.get("scene")
    if not scene_component:
        return {}
    scenes: dict[str, dict[str, Any]] = {}
    for entity in scene_component.entities:
        if not isinstance(entity, HomeAssistantScene) or not hasattr(
            entity, "scene_config"
        ):
            continue
        scene_config = entity.scene_config
        entities_dict: dict[str, dict[str, Any]] = {}
        for entity_id, state in scene_config.states.items():
            entities_dict[entity_id] = {
                "state": state.state,
                **state.attributes,
            }
        scenes[entity.entity_id] = {
            "id": scene_config.id,
            "name": scene_config.name,
            "entity_id": entity.entity_id,
            "entities": entities_dict,
        }
    return scenes


def build_preview(
    hass: HomeAssistant,
    *,
    dusk_minimum: int | None,
    target_date: str | None,
    scene_ids: dict[str, str | None],
    overlay: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Sun path plus per-light brightness/color samples for the chosen date."""
    sun_path = build_sun_path(hass, dusk_minimum, target_date)
    lights, warnings = _light_series(
        hass, sun_path["events"], scene_ids, overlay
    )
    return {**sun_path, "lights": lights, "warnings": warnings}


def _overlay_native_scenes(
    native: dict[str, dict[str, Any]], overlay: dict[str, Any] | None
) -> dict[str, dict[str, Any]]:
    """Patch one light into a loaded native scene without writing YAML."""
    if not overlay:
        return native
    scene_id = overlay.get("scene_entity_id")
    entity_id = overlay.get("entity_id")
    entity_state = overlay.get("entity_state")
    if not scene_id or not entity_id or not isinstance(entity_state, dict):
        return native
    scene = native.get(scene_id)
    if not scene:
        return native
    patched = copy.deepcopy(scene)
    patched["entities"][entity_id] = scene_entity_payload(entity_state)
    return {**native, scene_id: patched}


def _light_series(
    hass: HomeAssistant,
    events: list[dict[str, Any]],
    scene_ids: dict[str, str | None],
    overlay: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    native = _overlay_native_scenes(load_native_scenes(hass), overlay)
    bound: list[dict[str, Any]] = []
    for event in events:
        entity_id = scene_ids.get(SCENE_KEYS[event["id"]])
        scene = native.get(entity_id) if entity_id else None
        if not scene:
            # Unassigned events are skipped so graphs fill in as scenes are picked.
            continue
        bound.append({**event, "scene": scene})
    if not bound:
        return [], []

    light_ids: set[str] = set()
    for item in bound:
        for entity_id in item["scene"]["entities"]:
            if entity_id.startswith("light."):
                light_ids.add(entity_id)

    warnings = _gap_warnings(bound, light_ids)
    warnings_by_light: dict[str, list[dict[str, Any]]] = {}
    for warning in warnings:
        warnings_by_light.setdefault(warning["entity_id"], []).append(warning)

    lights = []
    for entity_id in sorted(light_ids):
        state = hass.states.get(entity_id)
        samples = []
        for minute in range(0, 24 * 60 + 1, CURVE_STEP_MINUTES):
            seconds = minute * 60
            brightness_pct, rgb = _sample_light(bound, entity_id, seconds)
            samples.append([seconds, brightness_pct, rgb[0], rgb[1], rgb[2]])
        event_states = []
        for item in bound:
            stored = item["scene"]["entities"].get(entity_id)
            event_states.append(
                {
                    "event": item["id"],
                    "scene_entity_id": item["scene"]["entity_id"],
                    "scene_id": item["scene"]["id"],
                    "scene_name": item["scene"]["name"],
                    "present": stored is not None,
                    "state": scene_entity_payload(stored),
                }
            )
        lights.append(
            {
                "entity_id": entity_id,
                "name": state.name if state else entity_id,
                "samples": samples,
                "gaps": warnings_by_light.get(entity_id, []),
                "event_states": event_states,
            }
        )
    return lights, warnings


def _gap_warnings(
    bound: list[dict[str, Any]], light_ids: set[str]
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    count = len(bound)
    for index, current in enumerate(bound):
        nxt = bound[(index + 1) % count]
        current_ids = {
            entity_id
            for entity_id in current["scene"]["entities"]
            if entity_id in light_ids
        }
        next_ids = {
            entity_id
            for entity_id in nxt["scene"]["entities"]
            if entity_id in light_ids
        }
        for entity_id, present, missing in (
            *((eid, current, nxt) for eid in sorted(current_ids - next_ids)),
            *((eid, nxt, current) for eid in sorted(next_ids - current_ids)),
        ):
            key = (entity_id, missing["scene"]["entity_id"])
            if key in seen:
                continue
            seen.add(key)
            warnings.append(
                {
                    "entity_id": entity_id,
                    "present_in": present["id"],
                    "present_name": present["scene"]["name"],
                    "missing_in": missing["id"],
                    "missing_name": missing["scene"]["name"],
                }
            )
    return warnings


def _event_at(
    bound: list[dict[str, Any]], seconds: int, offset: int = 0
) -> dict[str, Any]:
    starts = [event["seconds"] for event in bound]
    index = current_sun_event_index(starts, seconds)
    return bound[(index + offset) % len(bound)]


def _sample_light(
    bound: list[dict[str, Any]], entity_id: str, seconds: int
) -> tuple[int, tuple[int, int, int]]:
    current = _event_at(bound, seconds, 0)
    nxt = _event_at(bound, seconds, 1)
    percent = transition_progress_percent(current["seconds"], nxt["seconds"], seconds)
    from_entity = copy.deepcopy(
        current["scene"]["entities"].get(entity_id, {ATTR_STATE: STATE_OFF})
    )
    to_entity = copy.deepcopy(
        nxt["scene"]["entities"].get(entity_id, {ATTR_STATE: STATE_OFF})
    )
    if (
        from_entity.get(ATTR_STATE) == STATE_UNAVAILABLE
        or to_entity.get(ATTR_STATE) == STATE_UNAVAILABLE
    ):
        return 0, DEFAULT_RGB

    final_entity: dict[str, Any] = {"entity_id": entity_id}
    if ATTR_STATE in from_entity and ATTR_STATE in to_entity:
        final_entity[ATTR_STATE] = extrapolate_state(
            from_entity, to_entity, final_entity, percent
        )
    else:
        final_entity[ATTR_STATE] = from_entity.get(
            ATTR_STATE, to_entity.get(ATTR_STATE, STATE_OFF)
        )

    if ATTR_COLOR_MODE not in from_entity and ATTR_COLOR_MODE in to_entity:
        from_entity[ATTR_COLOR_MODE] = to_entity[ATTR_COLOR_MODE]
    elif ATTR_COLOR_MODE not in to_entity and ATTR_COLOR_MODE in from_entity:
        to_entity[ATTR_COLOR_MODE] = from_entity[ATTR_COLOR_MODE]

    if percent >= 50:
        color_mode = to_entity.get(ATTR_COLOR_MODE) or _infer_color_mode(to_entity)
    else:
        color_mode = from_entity.get(ATTR_COLOR_MODE) or _infer_color_mode(from_entity)
    if not color_mode:
        color_mode = _infer_color_mode(from_entity) or _infer_color_mode(to_entity)

    brightness = 0
    if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
        brightness = extrapolate_brightness(
            from_entity, to_entity, final_entity, percent, 0
        )
        final_entity[ATTR_BRIGHTNESS] = brightness
    elif final_entity.get(ATTR_STATE) == STATE_ON:
        brightness = 255
        final_entity[ATTR_BRIGHTNESS] = brightness
    rgb = _display_rgb(from_entity, to_entity, final_entity, color_mode, percent)
    pct = max(0, min(100, round(brightness * 100 / 255)))
    if final_entity.get(ATTR_STATE) != STATE_ON and brightness <= 0:
        pct = 0
    return pct, rgb


def _display_rgb(
    from_entity: dict[str, Any],
    to_entity: dict[str, Any],
    final_entity: dict[str, Any],
    color_mode: str | None,
    percent: float,
) -> tuple[int, int, int]:
    try:
        if color_mode in (ColorMode.COLOR_TEMP, ATTR_COLOR_TEMP_KELVIN):
            kelvin = extrapolate_temp_kelvin(
                from_entity, to_entity, final_entity, percent
            )
            return kelvin_to_rgb(kelvin)
        if color_mode in (ColorMode.RGB, ATTR_RGB_COLOR):
            rgb = extrapolate_rgb(from_entity, to_entity, final_entity, percent)
            return _clamp_rgb(rgb[0], rgb[1], rgb[2])
        if color_mode in (ColorMode.HS, ATTR_HS_COLOR):
            hs = extrapolate_hs(from_entity, to_entity, final_entity, percent)
            return hs_to_rgb(hs[0], hs[1])
        if color_mode in (ColorMode.RGBW, ATTR_RGBW_COLOR):
            rgbw = extrapolate_rgbw(from_entity, to_entity, final_entity, percent)
            return rgbw_to_rgb(rgbw)
        if color_mode in (ColorMode.RGBWW, ATTR_RGBWW_COLOR):
            rgbww = extrapolate_rgbww(from_entity, to_entity, final_entity, percent)
            return rgbww_to_rgb(rgbww)
    except (KeyError, TypeError, ValueError, IndexError):
        pass
    return _entity_rgb(from_entity) or _entity_rgb(to_entity) or DEFAULT_RGB


def _infer_color_mode(entity: dict[str, Any]) -> str | None:
    if entity.get(ATTR_RGBWW_COLOR):
        return ColorMode.RGBWW
    if entity.get(ATTR_RGBW_COLOR):
        return ColorMode.RGBW
    if entity.get(ATTR_RGB_COLOR):
        return ColorMode.RGB
    if entity.get(ATTR_HS_COLOR):
        return ColorMode.HS
    if entity.get(ATTR_COLOR_TEMP_KELVIN):
        return ColorMode.COLOR_TEMP
    return None


def _entity_rgb(entity: dict[str, Any]) -> tuple[int, int, int] | None:
    if ATTR_RGB_COLOR in entity and entity[ATTR_RGB_COLOR]:
        rgb = entity[ATTR_RGB_COLOR]
        return _clamp_rgb(rgb[0], rgb[1], rgb[2])
    if ATTR_HS_COLOR in entity and entity[ATTR_HS_COLOR]:
        hs = entity[ATTR_HS_COLOR]
        return hs_to_rgb(hs[0], hs[1])
    if ATTR_COLOR_TEMP_KELVIN in entity and entity[ATTR_COLOR_TEMP_KELVIN]:
        return kelvin_to_rgb(entity[ATTR_COLOR_TEMP_KELVIN])
    if ATTR_RGBW_COLOR in entity and entity[ATTR_RGBW_COLOR]:
        return rgbw_to_rgb(entity[ATTR_RGBW_COLOR])
    if ATTR_RGBWW_COLOR in entity and entity[ATTR_RGBWW_COLOR]:
        return rgbww_to_rgb(entity[ATTR_RGBWW_COLOR])
    return None


def kelvin_to_rgb(kelvin: float) -> tuple[int, int, int]:
    """Approximate daylight RGB from color temperature (Tanner Helland)."""
    temp = max(1000.0, min(float(kelvin), 40000.0)) / 100.0
    if temp <= 66:
        red = 255.0
        green = 99.4708025861 * _safe_log(temp) - 161.1195681661
    else:
        red = 329.698727446 * ((temp - 60) ** -0.1332047592)
        green = 288.1221695283 * ((temp - 60) ** -0.0755148492)
    if temp >= 66:
        blue = 255.0
    elif temp <= 19:
        blue = 0.0
    else:
        blue = 138.5177312231 * _safe_log(temp - 10) - 305.0447927307
    return _clamp_rgb(red, green, blue)


def _safe_log(value: float) -> float:
    if value <= 0:
        return 0.0
    return log(value)


def hs_to_rgb(hue: float, saturation: float) -> tuple[int, int, int]:
    """Convert Home Assistant HS (hue 0-360, sat 0-100) to RGB."""
    heading = float(hue) % 360.0
    sat = max(0.0, min(float(saturation) / 100.0, 1.0))
    chroma = sat
    x = chroma * (1 - abs((heading / 60.0) % 2 - 1))
    m = 1.0 - chroma
    if heading < 60:
        red, green, blue = chroma, x, 0.0
    elif heading < 120:
        red, green, blue = x, chroma, 0.0
    elif heading < 180:
        red, green, blue = 0.0, chroma, x
    elif heading < 240:
        red, green, blue = 0.0, x, chroma
    elif heading < 300:
        red, green, blue = x, 0.0, chroma
    else:
        red, green, blue = chroma, 0.0, x
    return _clamp_rgb((red + m) * 255, (green + m) * 255, (blue + m) * 255)


def rgbw_to_rgb(rgbw: list | tuple) -> tuple[int, int, int]:
    r, g, b, white = (int(v) for v in rgbw[:4])
    return _clamp_rgb(r + white, g + white, b + white)


def rgbww_to_rgb(rgbww: list | tuple) -> tuple[int, int, int]:
    r, g, b, cold, warm = (int(v) for v in rgbww[:5])
    r = r + cold * 0.86 + warm
    g = g + cold * 0.90 + warm * 0.70
    b = b + cold + warm * 0.35
    return _clamp_rgb(r, g, b)


def _clamp_rgb(red: float, green: float, blue: float) -> tuple[int, int, int]:
    return (
        max(0, min(255, int(round(red)))),
        max(0, min(255, int(round(green)))),
        max(0, min(255, int(round(blue)))),
    )
