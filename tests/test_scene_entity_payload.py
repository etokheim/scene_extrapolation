"""Native scene entity payloads keep exclusive color attrs + color_mode."""

from __future__ import annotations

from custom_components.circadian_scenes.native_scene import scene_entity_payload


def test_color_mode_color_temp_drops_derived_rgb():
    payload = scene_entity_payload(
        {
            "state": "on",
            "brightness": 200,
            "color_mode": "color_temp",
            "color_temp_kelvin": 2700,
            "hs_color": [30, 60],
            "rgb_color": [255, 166, 87],
        }
    )
    assert payload == {
        "state": "on",
        "brightness": 200,
        "color_mode": "color_temp",
        "color_temp_kelvin": 2700,
    }


def test_kelvin_only_draft_gets_color_mode():
    payload = scene_entity_payload(
        {
            "state": "on",
            "brightness": 128,
            "color_temp_kelvin": 3000,
        }
    )
    assert payload["color_mode"] == "color_temp"
    assert payload["color_temp_kelvin"] == 3000
    assert "rgb_color" not in payload
    assert "hs_color" not in payload


def test_hs_preferred_over_rgb_when_both_present_without_mode():
    payload = scene_entity_payload(
        {
            "state": "on",
            "hs_color": [240, 100],
            "rgb_color": [0, 0, 255],
            "color_temp_kelvin": 4000,
        }
    )
    assert payload["color_mode"] == "hs"
    assert payload["hs_color"] == [240, 100]
    assert "rgb_color" not in payload
    assert "color_temp_kelvin" not in payload


def test_off_state():
    assert scene_entity_payload(None) == {"state": "off"}


def test_non_light_keeps_generic_attrs():
    payload = scene_entity_payload(
        {
            "state": "open",
            "current_position": 40,
            "friendly_name": "Garage",
            "supported_features": 3,
        },
        entity_id="cover.garage",
    )
    assert payload == {"state": "open", "current_position": 40}
