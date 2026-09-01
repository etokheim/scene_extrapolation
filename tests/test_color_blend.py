"""Cross-mode color blending stays continuous (no mid-transition snap)."""

from __future__ import annotations

from custom_components.scene_extrapolation.color_math import (
    blend_entity_rgb,
    entity_rgb,
    kelvin_to_rgb,
    rgbww_to_rgb,
    same_color_mode,
)
from custom_components.scene_extrapolation.preview import _display_rgb


def test_same_color_mode_aliases():
    assert same_color_mode("color_temp", "color_temp_kelvin")
    assert same_color_mode("hs", "hs")
    assert not same_color_mode("color_temp", "hs")


def test_blend_temp_to_hs_is_continuous_through_midpoint():
    """color_temp → hs used to flip extrapolators at 50% and jump."""
    from_entity = {
        "state": "on",
        "color_mode": "color_temp",
        "color_temp_kelvin": 4500,
        "brightness": 255,
    }
    to_entity = {
        "state": "on",
        "color_mode": "hs",
        "hs_color": [30, 80],
        "brightness": 200,
    }
    start = blend_entity_rgb(from_entity, to_entity, 0)
    mid = blend_entity_rgb(from_entity, to_entity, 50)
    end = blend_entity_rgb(from_entity, to_entity, 100)
    assert start == entity_rgb(from_entity)
    assert end == entity_rgb(to_entity)
    # Midpoint is between endpoints in each channel (inclusive).
    for i in range(3):
        lo, hi = sorted((start[i], end[i]))
        assert lo <= mid[i] <= hi


def test_display_rgb_cross_mode_matches_blend():
    from_entity = {
        "state": "on",
        "color_mode": "color_temp",
        "color_temp_kelvin": 2700,
    }
    to_entity = {
        "state": "on",
        "color_mode": "rgb",
        "rgb_color": [10, 20, 255],
    }
    final = {"entity_id": "light.test"}
    for percent in (0, 25, 49, 50, 51, 75, 100):
        display = _display_rgb(
            from_entity, to_entity, final, "color_temp", "rgb", percent
        )
        assert display == blend_entity_rgb(from_entity, to_entity, percent)


def test_display_rgb_same_temp_uses_kelvin_path():
    from_entity = {
        "state": "on",
        "color_mode": "color_temp",
        "color_temp_kelvin": 2000,
    }
    to_entity = {
        "state": "on",
        "color_mode": "color_temp",
        "color_temp_kelvin": 4000,
    }
    final = {"entity_id": "light.test"}
    rgb = _display_rgb(from_entity, to_entity, final, "color_temp", "color_temp", 50)
    assert rgb == kelvin_to_rgb(3000)


def test_rgbww_entity_rgb_mixes_white_not_rgb_slice():
    entity = {
        "state": "on",
        "color_mode": "rgbww",
        "rgbww_color": [10, 0, 0, 0, 200],
    }
    mixed = entity_rgb(entity)
    sliced = (10, 0, 0)
    assert mixed == rgbww_to_rgb([10, 0, 0, 0, 200])
    assert mixed != sliced
    assert mixed[1] > sliced[1]
