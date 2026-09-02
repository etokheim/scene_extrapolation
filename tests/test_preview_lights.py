"""Preview light series for new and populated extrapolation scenes."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from custom_components.scene_extrapolation.preview import _light_series


def _events():
    return [
        {"id": "dawn", "name": "Dawn", "time": "05:00", "seconds": 5 * 3600},
        {"id": "sunrise", "name": "Sunrise", "time": "06:00", "seconds": 6 * 3600},
        {"id": "noon", "name": "Noon", "time": "12:00", "seconds": 12 * 3600},
        {"id": "sunset", "name": "Sunset", "time": "18:00", "seconds": 18 * 3600},
        {"id": "dusk", "name": "Dusk", "time": "20:00", "seconds": 20 * 3600},
    ]


def _hass_with_names(names: dict[str, str]) -> MagicMock:
    hass = MagicMock()

    def get_state(entity_id: str):
        if entity_id not in names:
            return None
        return SimpleNamespace(name=names[entity_id])

    hass.states.get.side_effect = get_state
    return hass


@patch("custom_components.scene_extrapolation.preview.load_native_scenes")
@patch("custom_components.scene_extrapolation.preview.lights_in_area")
def test_unassigned_area_returns_suggested_lights(mock_lights, mock_native):
    """New scene with an area but no native scenes still lists area lights."""
    mock_native.return_value = {}
    mock_lights.return_value = ["light.ceiling", "light.lamp"]
    hass = _hass_with_names({"light.ceiling": "Ceiling", "light.lamp": "Lamp"})

    lights, warnings, _split = _light_series(
        hass,
        _events(),
        scene_ids={},
        overlay=None,
        area_id="stue",
    )

    assert warnings == []
    assert [row["entity_id"] for row in lights] == [
        "light.ceiling",
        "light.lamp",
    ]
    assert all(row["suggested"] for row in lights)
    assert all(row["in_area"] for row in lights)
    assert all(row["samples"] == [] for row in lights)
    assert all(len(row["event_states"]) == 5 for row in lights)
    mock_lights.assert_called_once_with(hass, "stue")


@patch("custom_components.scene_extrapolation.preview.load_native_scenes")
@patch("custom_components.scene_extrapolation.preview.lights_in_area")
def test_unassigned_without_area_returns_empty(mock_lights, mock_native):
    mock_native.return_value = {}
    hass = MagicMock()

    lights, warnings, _split = _light_series(
        hass,
        _events(),
        scene_ids={},
        overlay=None,
        area_id=None,
    )

    assert lights == []
    assert warnings == []
    mock_lights.assert_not_called()


@patch("custom_components.scene_extrapolation.preview.load_native_scenes")
@patch("custom_components.scene_extrapolation.preview.lights_in_area")
def test_assigned_scenes_include_suggested_area_lights(mock_lights, mock_native):
    mock_native.return_value = {
        "scene.day": {
            "id": "day",
            "name": "Day",
            "entity_id": "scene.day",
            "entities": {
                "light.ceiling": {"state": "on", "brightness": 255},
            },
        }
    }
    mock_lights.return_value = ["light.ceiling", "light.extra"]
    hass = _hass_with_names({"light.ceiling": "Ceiling", "light.extra": "Extra"})

    lights, _warnings, _split = _light_series(
        hass,
        _events(),
        scene_ids={
            "scene_dawn": None,
            "scene_sunrise": None,
            "scene_noon": "scene.day",
            "scene_sunset": None,
            "scene_dusk": None,
        },
        overlay=None,
        area_id="stue",
    )

    by_id = {row["entity_id"]: row for row in lights}
    assert set(by_id) == {"light.ceiling", "light.extra"}
    assert by_id["light.ceiling"]["suggested"] is False
    # Event endpoints + 5 intermediates × 5 segments + midnight ≈ 31 samples.
    assert len(by_id["light.ceiling"]["samples"]) >= 9
    assert len(by_id["light.ceiling"]["event_states"]) == 5
    assert by_id["light.extra"]["suggested"] is True
    assert by_id["light.extra"]["samples"] == []


@patch("custom_components.scene_extrapolation.preview.load_native_scenes")
@patch("custom_components.scene_extrapolation.preview.lights_in_area")
def test_rgb_segment_samples_follow_hs_rim(mock_lights, mock_native):
    """Settled mid-segment RGB↔RGB samples stay on the hue rim (not RGB chord)."""
    mock_native.return_value = {
        "scene.red": {
            "id": "red",
            "name": "Red",
            "entity_id": "scene.red",
            "entities": {
                "light.ceiling": {
                    "state": "on",
                    "brightness": 255,
                    "color_mode": "rgb",
                    "rgb_color": [255, 0, 0],
                },
            },
        },
        "scene.blue": {
            "id": "blue",
            "name": "Blue",
            "entity_id": "scene.blue",
            "entities": {
                "light.ceiling": {
                    "state": "on",
                    "brightness": 255,
                    "color_mode": "rgb",
                    "rgb_color": [0, 0, 255],
                },
            },
        },
    }
    mock_lights.return_value = ["light.ceiling"]
    hass = _hass_with_names({"light.ceiling": "Ceiling"})

    lights, _warnings, _split = _light_series(
        hass,
        _events(),
        scene_ids={
            "scene_dawn": "scene.red",
            "scene_sunrise": "scene.blue",
            "scene_noon": "scene.blue",
            "scene_sunset": "scene.blue",
            "scene_dusk": "scene.blue",
        },
        overlay=None,
        area_id="stue",
    )

    samples = lights[0]["samples"]
    dawn = 5 * 3600
    sunrise = 6 * 3600
    mids = [row for row in samples if dawn < row[0] < sunrise]
    assert len(mids) == 5
    # Straight RGB chord mid is ~[128,0,128]. Without hue wrap, HS-rim mid is
    # green (hue 120°) at full saturation — matches runtime extrapolate_rgb.
    mid = mids[len(mids) // 2]
    assert mid[3] > 200  # green high on the rim
    assert mid[2] < 40 and mid[4] < 40  # red+blue low (not purple chord)