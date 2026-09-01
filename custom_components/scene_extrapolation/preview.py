"""Preview payloads for the sidebar panel light bars."""

from __future__ import annotations

import copy
from typing import Any

from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ColorMode,
)
from homeassistant.const import ATTR_STATE, STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant

from .color_math import (
    DEFAULT_RGB,
    blend_entity_rgb,
    clamp_rgb,
    hs_to_rgb,
    infer_color_mode,
    kelvin_to_rgb,
    normalize_color_mode,
    rgbw_to_rgb,
    rgbww_to_rgb,
    same_color_mode,
)
from .const import (
    SCENE_DAWN,
    SCENE_DUSK,
    SCENE_NOON,
    SCENE_SUNRISE,
    SCENE_SUNSET,
)
from .extrapolation_math import (
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
from .native_scene import lights_in_area, scene_entity_payload
from .solar import CURVE_STEP_MINUTES, build_sun_path

SCENE_KEYS = {
    "dawn": SCENE_DAWN,
    "sunrise": SCENE_SUNRISE,
    "noon": SCENE_NOON,
    "sunset": SCENE_SUNSET,
    "dusk": SCENE_DUSK,
}


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
    overlay: dict[str, Any] | list[dict[str, Any]] | None = None,
    location: dict[str, Any] | None = None,
    area_id: str | None = None,
) -> dict[str, Any]:
    """Sun path plus per-light brightness/color samples for the chosen date."""
    sun_path = build_sun_path(hass, dusk_minimum, target_date, location)
    lights, warnings = _light_series(
        hass, sun_path["events"], scene_ids, overlay, area_id
    )
    return {**sun_path, "lights": lights, "warnings": warnings}


def _overlay_patches(
    overlay: dict[str, Any] | list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not overlay:
        return []
    if isinstance(overlay, list):
        return overlay
    return [overlay]


def _overlay_native_scenes(
    native: dict[str, dict[str, Any]],
    overlay: dict[str, Any] | list[dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    """Apply session drafts onto loaded native scenes without writing YAML."""
    patches = _overlay_patches(overlay)
    if not patches:
        return native
    result = native
    for patch in patches:
        scene_id = patch.get("scene_entity_id")
        if not scene_id:
            continue
        if patch.get("deleted"):
            result = {key: value for key, value in result.items() if key != scene_id}
            continue
        created = patch.get("create_scene")
        if isinstance(created, dict):
            entities = {
                entity_id: scene_entity_payload(state)
                for entity_id, state in (created.get("entities") or {}).items()
                if isinstance(state, dict)
            }
            result = {
                **result,
                scene_id: {
                    "id": created.get("id") or scene_id,
                    "name": created.get("name") or scene_id,
                    "entity_id": scene_id,
                    "entities": entities,
                },
            }
            continue
        scene = result.get(scene_id)
        entity_id = patch.get("entity_id")
        if entity_id and patch.get("remove"):
            if not scene:
                continue
            patched = copy.deepcopy(scene)
            patched["entities"].pop(entity_id, None)
            result = {**result, scene_id: patched}
            continue
        entity_state = patch.get("entity_state")
        if entity_id and isinstance(entity_state, dict):
            # Draft edits for a scene that is not loaded yet (orphan /
            # unavailable entity) — materialize a stub so membership works.
            if not scene:
                scene = {
                    "id": scene_id,
                    "name": scene_id,
                    "entity_id": scene_id,
                    "entities": {},
                }
            patched = copy.deepcopy(scene)
            patched["entities"][entity_id] = scene_entity_payload(entity_state)
            result = {**result, scene_id: patched}
            continue
        if not scene:
            continue
        if patch.get("name"):
            patched = copy.deepcopy(scene)
            patched["name"] = patch["name"]
            result = {**result, scene_id: patched}
    return result


def _light_series(
    hass: HomeAssistant,
    events: list[dict[str, Any]],
    scene_ids: dict[str, str | None],
    overlay: dict[str, Any] | list[dict[str, Any]] | None = None,
    area_id: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    native = _overlay_native_scenes(load_native_scenes(hass), overlay)
    bound: list[dict[str, Any]] = []
    for event in events:
        entity_id = scene_ids.get(SCENE_KEYS[event["id"]])
        scene = native.get(entity_id) if entity_id else None
        # Unassigned solar events are off-knots: every lamp is off at that
        # point so graphs go dark instead of interpolating across the gap.
        bound.append(
            {
                **event,
                "scene": scene
                or {
                    "id": None,
                    "name": None,
                    "entity_id": None,
                    "entities": {},
                },
            }
        )
    assigned = [item for item in bound if item["scene"].get("entity_id")]
    area_lights = set(lights_in_area(hass, area_id)) if area_id else None
    if not assigned:
        # New extrapolation scene: no native scenes yet — still list area
        # lights as suggested so dial/table/create-scene UI can render.
        if not area_lights:
            return [], []
        lights = []
        for entity_id in sorted(area_lights):
            state = hass.states.get(entity_id)
            lights.append(
                {
                    "entity_id": entity_id,
                    "name": state.name if state else entity_id,
                    "samples": [],
                    "gaps": [],
                    "event_states": _event_states_for_light(bound, entity_id),
                    "suggested": True,
                    "in_area": True,
                }
            )
        return lights, []

    light_ids: set[str] = set()
    for item in assigned:
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
        lights.append(
            {
                "entity_id": entity_id,
                "name": state.name if state else entity_id,
                "samples": samples,
                "gaps": warnings_by_light.get(entity_id, []),
                "event_states": _event_states_for_light(bound, entity_id),
                "suggested": False,
                "in_area": (
                    entity_id in area_lights if area_lights is not None else None
                ),
            }
        )
    if area_lights is not None:
        for entity_id in sorted(area_lights - light_ids):
            state = hass.states.get(entity_id)
            lights.append(
                {
                    "entity_id": entity_id,
                    "name": state.name if state else entity_id,
                    "samples": [],
                    "gaps": [],
                    "event_states": _event_states_for_light(bound, entity_id),
                    "suggested": True,
                    "in_area": True,
                }
            )
    return lights, warnings


def _event_states_for_light(
    bound: list[dict[str, Any]], entity_id: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in bound:
        scene = item["scene"]
        scene_entity_id = scene.get("entity_id")
        stored = scene["entities"].get(entity_id) if scene_entity_id else None
        rows.append(
            {
                "event": item["id"],
                "scene_entity_id": scene_entity_id,
                "scene_id": scene.get("id"),
                "scene_name": scene.get("name"),
                "present": stored is not None,
                "state": scene_entity_payload(stored),
            }
        )
    return rows


def _gap_warnings(
    bound: list[dict[str, Any]], light_ids: set[str]
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    count = len(bound)
    for index, current in enumerate(bound):
        nxt = bound[(index + 1) % count]
        # Unassigned events are off-knots, not native scenes — skip gap UI.
        if not current["scene"].get("entity_id") or not nxt["scene"].get("entity_id"):
            continue
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

    from_mode = from_entity.get(ATTR_COLOR_MODE) or infer_color_mode(from_entity)
    to_mode = to_entity.get(ATTR_COLOR_MODE) or infer_color_mode(to_entity)

    brightness = 0
    if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
        brightness = extrapolate_brightness(
            from_entity, to_entity, final_entity, percent, 0
        )
        final_entity[ATTR_BRIGHTNESS] = brightness
    elif final_entity.get(ATTR_STATE) == STATE_ON:
        brightness = 255
        final_entity[ATTR_BRIGHTNESS] = brightness
    rgb = _display_rgb(
        from_entity, to_entity, final_entity, from_mode, to_mode, percent
    )
    pct = max(0, min(100, round(brightness * 100 / 255)))
    if final_entity.get(ATTR_STATE) != STATE_ON and brightness <= 0:
        pct = 0
    return pct, rgb


def _display_rgb(
    from_entity: dict[str, Any],
    to_entity: dict[str, Any],
    final_entity: dict[str, Any],
    from_mode: str | None,
    to_mode: str | None,
    percent: float,
) -> tuple[int, int, int]:
    # Same mode: keep kelvin/HS/channel lerp (smoother whites than RGB-of-kelvin).
    # Different modes: RGB-lerp endpoints so preview does not snap at 50%.
    if same_color_mode(from_mode, to_mode):
        color_mode = normalize_color_mode(from_mode)
        try:
            if color_mode == ColorMode.COLOR_TEMP:
                kelvin = extrapolate_temp_kelvin(
                    from_entity, to_entity, final_entity, percent
                )
                return kelvin_to_rgb(kelvin)
            if color_mode == ColorMode.RGB:
                rgb = extrapolate_rgb(from_entity, to_entity, final_entity, percent)
                return clamp_rgb(rgb[0], rgb[1], rgb[2])
            if color_mode == ColorMode.HS:
                hs = extrapolate_hs(from_entity, to_entity, final_entity, percent)
                return hs_to_rgb(hs[0], hs[1])
            if color_mode == ColorMode.RGBW:
                rgbw = extrapolate_rgbw(from_entity, to_entity, final_entity, percent)
                return rgbw_to_rgb(rgbw)
            if color_mode == ColorMode.RGBWW:
                rgbww = extrapolate_rgbww(from_entity, to_entity, final_entity, percent)
                return rgbww_to_rgb(rgbww)
        except (KeyError, TypeError, ValueError, IndexError):
            pass
    return blend_entity_rgb(from_entity, to_entity, percent)
