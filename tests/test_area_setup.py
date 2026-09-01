"""Area create-wizard helpers: naming, ranking, suggestions."""

from __future__ import annotations

from custom_components.scene_extrapolation.native_scene import (
    _scene_base_name,
    average_light_brightness,
    suggest_setup_assignments,
)


def test_scene_base_names_linked_and_event():
    assert _scene_base_name("Stue", "dawn", linked=True) == "Stue Dawn-Sunset"
    assert _scene_base_name("Stue", "noon", linked=False) == "Stue Noon"
    assert _scene_base_name("Stue", "dusk", linked=False) == "Stue Dusk"
    assert _scene_base_name("Stue", "sunrise", linked=False) == "Stue Sunrise"
    assert _scene_base_name("Stue", "sunset", linked=False) == "Stue Sunset"


def test_average_light_brightness():
    assert (
        average_light_brightness(
            {
                "light.a": {"state": "on", "brightness": 200},
                "light.b": {"state": "off"},
                "switch.x": {"state": "on"},
            }
        )
        == 100.0
    )


def test_suggest_setup_assignments_linked():
    scenes = [
        {"entity_id": "scene.bright", "name": "B", "avg_brightness": 200},
        {"entity_id": "scene.mid", "name": "M", "avg_brightness": 100},
        {"entity_id": "scene.dim", "name": "D", "avg_brightness": 20},
    ]
    assert suggest_setup_assignments(scenes, linked=True) == {
        "noon": "scene.bright",
        "linked": "scene.mid",
        "dusk": "scene.dim",
    }


def test_suggest_setup_assignments_two_scenes():
    scenes = [
        {"entity_id": "scene.bright", "name": "B", "avg_brightness": 200},
        {"entity_id": "scene.dim", "name": "D", "avg_brightness": 20},
    ]
    assert suggest_setup_assignments(scenes, linked=True) == {
        "noon": "scene.bright",
        "linked": "scene.dim",
        "dusk": None,
    }
