"""Override vs drift classification and last-activated scene helpers."""

from __future__ import annotations

from types import SimpleNamespace

from homeassistant.const import STATE_UNAVAILABLE

from custom_components.scene_extrapolation.continuous import (
    classify_light_report,
    competing_scene_activated,
    entity_ids_from_service_event,
    last_activated_scene_id,
    moved_toward,
    parse_scene_activated,
    should_arm_continuous,
    snapshot_from_command,
    snapshot_from_state,
    states_match,
)


def _on(**attrs):
    return {"state": "on", **attrs}


def _off(**attrs):
    return {"state": "off", **attrs}


def test_should_arm_continuous():
    assert should_arm_continuous(
        300, enabled=True, brightness_modifier=0, transition_percent_manual=False
    )
    assert not should_arm_continuous(
        300, enabled=False, brightness_modifier=0, transition_percent_manual=False
    )
    assert not should_arm_continuous(
        0, enabled=True, brightness_modifier=0, transition_percent_manual=False
    )
    assert not should_arm_continuous(
        300, enabled=True, brightness_modifier=10, transition_percent_manual=False
    )
    assert not should_arm_continuous(
        300, enabled=True, brightness_modifier=0, transition_percent_manual=True
    )


def test_parse_and_last_activated():
    assert parse_scene_activated(None) is None
    assert parse_scene_activated("unknown") is None
    earlier = "2026-09-01T08:00:00+00:00"
    later = "2026-09-01T10:00:00+00:00"
    assert (
        last_activated_scene_id(
            {
                "scene.old": earlier,
                "scene.new": later,
                "scene.never": None,
            }
        )
        == "scene.new"
    )


def test_entity_ids_from_service_event():
    assert entity_ids_from_service_event(
        {"service_data": {"entity_id": "scene.a"}}
    ) == ["scene.a"]
    assert entity_ids_from_service_event(
        {"service_data": {"entity_id": ["scene.a", "scene.b"]}}
    ) == ["scene.a", "scene.b"]
    assert entity_ids_from_service_event(
        {"service_data": {"target": {"entity_id": "scene.c"}}}
    ) == ["scene.c"]


def test_competing_scene_activated():
    assert not competing_scene_activated(["scene.ours"], "scene.ours", None)
    assert competing_scene_activated(["scene.other"], "scene.ours", None)
    assert not competing_scene_activated(
        ["scene.other"], "scene.ours", {"scene.ours", "scene.room"}
    )
    assert competing_scene_activated(
        ["scene.room"], "scene.ours", {"scene.ours", "scene.room"}
    )


def test_states_match_brightness_and_kelvin():
    commanded = _on(brightness=180, color_temp_kelvin=3000)
    assert states_match(_on(brightness=175, color_temp_kelvin=3040), commanded)
    assert not states_match(_on(brightness=140, color_temp_kelvin=3000), commanded)
    assert states_match(_off(), _off())
    assert not states_match(_off(), commanded)


def test_snapshot_from_state_skips_unavailable():
    assert snapshot_from_state(None) is None
    unavailable = SimpleNamespace(state=STATE_UNAVAILABLE, attributes={})
    assert snapshot_from_state(unavailable) is None
    on_state = SimpleNamespace(
        state="on",
        attributes={"brightness": 200, "hs_color": [30, 40]},
    )
    snap = snapshot_from_state(on_state)
    assert snap == {
        "state": "on",
        "brightness": 200,
        "color_temp_kelvin": None,
        "hs_color": (30, 40),
        "rgb_color": None,
        "rgbw_color": None,
        "rgbww_color": None,
    }
    assert snapshot_from_command({"state": "on", "brightness": 10})["brightness"] == 10


def test_moved_toward_brightness():
    pre = _on(brightness=100)
    commanded = _on(brightness=180)
    assert moved_toward(pre, commanded, _on(brightness=140))
    assert not moved_toward(pre, commanded, _on(brightness=100))
    assert not moved_toward(pre, commanded, _on(brightness=220))


def test_classify_unavailable_is_ignore():
    assert (
        classify_light_report(
            actual=None,
            commanded=_on(brightness=200),
            pre=_on(brightness=180),
            user_id=None,
            from_our_context=False,
            mid_transition=False,
        )
        == "ignore"
    )


def test_classify_user_override():
    assert (
        classify_light_report(
            actual=_on(brightness=255),
            commanded=_on(brightness=180),
            pre=_on(brightness=180),
            user_id="user-1",
            from_our_context=False,
            mid_transition=True,
        )
        == "override"
    )


def test_classify_user_matching_command_is_sync():
    commanded = _on(brightness=180)
    assert (
        classify_light_report(
            actual=commanded,
            commanded=commanded,
            pre=_on(brightness=100),
            user_id="user-1",
            from_our_context=False,
            mid_transition=False,
        )
        == "sync"
    )


def test_classify_mid_transition_without_user_is_ignore():
    assert (
        classify_light_report(
            actual=_on(brightness=140),
            commanded=_on(brightness=180),
            pre=_on(brightness=100),
            user_id=None,
            from_our_context=False,
            mid_transition=True,
        )
        == "ignore"
    )


def test_classify_unresponsive_matches_pre_is_drift():
    pre = _on(brightness=80, color_temp_kelvin=2700)
    commanded = _on(brightness=200, color_temp_kelvin=4000)
    assert (
        classify_light_report(
            actual=pre,
            commanded=commanded,
            pre=pre,
            user_id=None,
            from_our_context=False,
            mid_transition=False,
        )
        == "drift"
    )


def test_classify_our_context_mismatch_is_drift():
    assert (
        classify_light_report(
            actual=_on(brightness=50),
            commanded=_on(brightness=200),
            pre=_on(brightness=80),
            user_id=None,
            from_our_context=True,
            mid_transition=False,
        )
        == "drift"
    )


def test_classify_late_transition_toward_command_is_drift():
    assert (
        classify_light_report(
            actual=_on(brightness=140),
            commanded=_on(brightness=180),
            pre=_on(brightness=100),
            user_id=None,
            from_our_context=False,
            mid_transition=False,
        )
        == "drift"
    )


def test_classify_reading_light_bump_is_override():
    assert (
        classify_light_report(
            actual=_on(brightness=255),
            commanded=_on(brightness=180),
            pre=_on(brightness=175),
            user_id=None,
            from_our_context=False,
            mid_transition=False,
        )
        == "override"
    )


def test_classify_user_turned_off_is_override():
    assert (
        classify_light_report(
            actual=_off(),
            commanded=_on(brightness=180),
            pre=_on(brightness=180),
            user_id=None,
            from_our_context=False,
            mid_transition=False,
        )
        == "override"
    )
