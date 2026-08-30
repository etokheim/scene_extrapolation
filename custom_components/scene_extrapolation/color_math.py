"""Shared light-color conversion and cross-mode blending."""

from __future__ import annotations

from math import log
from typing import Any

from homeassistant.components.light import (
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ColorMode,
)

DEFAULT_RGB = (255, 214, 170)

_COLOR_TEMP_ALIASES = frozenset(
    {
        ColorMode.COLOR_TEMP,
        ATTR_COLOR_TEMP_KELVIN,
        "color_temp",
    }
)
_RGB_ALIASES = frozenset({ColorMode.RGB, ATTR_RGB_COLOR, "rgb"})
_HS_ALIASES = frozenset({ColorMode.HS, ATTR_HS_COLOR, "hs"})
_RGBW_ALIASES = frozenset({ColorMode.RGBW, ATTR_RGBW_COLOR, "rgbw"})
_RGBWW_ALIASES = frozenset({ColorMode.RGBWW, ATTR_RGBWW_COLOR, "rgbww"})


def normalize_color_mode(mode: str | None) -> str | None:
    """Map HA / scene aliases onto a single ColorMode value."""
    if not mode:
        return None
    if mode in _COLOR_TEMP_ALIASES:
        return ColorMode.COLOR_TEMP
    if mode in _RGB_ALIASES:
        return ColorMode.RGB
    if mode in _HS_ALIASES:
        return ColorMode.HS
    if mode in _RGBW_ALIASES:
        return ColorMode.RGBW
    if mode in _RGBWW_ALIASES:
        return ColorMode.RGBWW
    return mode


def infer_color_mode(entity: dict[str, Any]) -> str | None:
    """Infer a color mode from whichever color attributes are present."""
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


def same_color_mode(left: str | None, right: str | None) -> bool:
    """True when both sides resolve to the same normalized mode."""
    a = normalize_color_mode(left)
    b = normalize_color_mode(right)
    return bool(a and b and a == b)


def clamp_rgb(red: float, green: float, blue: float) -> tuple[int, int, int]:
    return (
        max(0, min(255, int(round(red)))),
        max(0, min(255, int(round(green)))),
        max(0, min(255, int(round(blue)))),
    )


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
    return clamp_rgb(red, green, blue)


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
    return clamp_rgb((red + m) * 255, (green + m) * 255, (blue + m) * 255)


def rgbw_to_rgb(rgbw: list | tuple) -> tuple[int, int, int]:
    r, g, b, white = (int(v) for v in rgbw[:4])
    return clamp_rgb(r + white, g + white, b + white)


def rgbww_to_rgb(rgbww: list | tuple) -> tuple[int, int, int]:
    r, g, b, cold, warm = (int(v) for v in rgbww[:5])
    r = r + cold * 0.86 + warm
    g = g + cold * 0.90 + warm * 0.70
    b = b + cold + warm * 0.35
    return clamp_rgb(r, g, b)


def entity_rgb(entity: dict[str, Any]) -> tuple[int, int, int] | None:
    """Best-effort RGB for a stored scene entity / draft-like dict."""
    if ATTR_RGB_COLOR in entity and entity[ATTR_RGB_COLOR]:
        rgb = entity[ATTR_RGB_COLOR]
        return clamp_rgb(rgb[0], rgb[1], rgb[2])
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


def lerp_rgb(
    from_rgb: tuple[int, int, int],
    to_rgb: tuple[int, int, int],
    percent: float,
) -> tuple[int, int, int]:
    """Linear RGB blend; percent is 0–100 transition progress."""
    t = max(0.0, min(1.0, float(percent) / 100.0))
    return clamp_rgb(
        from_rgb[0] + (to_rgb[0] - from_rgb[0]) * t,
        from_rgb[1] + (to_rgb[1] - from_rgb[1]) * t,
        from_rgb[2] + (to_rgb[2] - from_rgb[2]) * t,
    )


def blend_entity_rgb(
    from_entity: dict[str, Any],
    to_entity: dict[str, Any],
    percent: float,
) -> tuple[int, int, int]:
    """Cross-mode (or fallback) blend: convert each endpoint to RGB, then lerp.

    Used when from/to color modes differ so dial preview and live apply do not
    snap at the old 50% mode switch.
    """
    from_rgb = entity_rgb(from_entity) or entity_rgb(to_entity) or DEFAULT_RGB
    to_rgb = entity_rgb(to_entity) or entity_rgb(from_entity) or DEFAULT_RGB
    return lerp_rgb(from_rgb, to_rgb, percent)
