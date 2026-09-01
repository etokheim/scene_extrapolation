"""Solar progress and entity blend math for circadian scenes."""

from __future__ import annotations

import asyncio
import logging
import numbers
import time

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_EFFECT,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
)
from homeassistant.components.light import ColorMode
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_STATE,
    STATE_OFF,
    STATE_UNAVAILABLE,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .color_math import (
    blend_entity_rgb,
    hs_to_rgb,
    infer_color_mode,
    lerp_hs,
    normalize_color_mode,
    rgb_to_hs,
    same_color_mode,
)
from .solar import EVENT_ORDER

DAY_PERCENT_STEP = 100.0 / (len(EVENT_ORDER) - 1)

_LOGGER = logging.getLogger(__name__)

class SunEvent:
    """Creates a sun event."""

    def __init__(self, name, start_time, scene, key) -> None:
        """Initialize a SunEvent."""
        self.name = name
        self.key = key
        self.start_time = start_time
        self.scene = scene


def current_sun_event_index(start_times: list[float], seconds: float) -> int:
    """Index of the last solar event that has started at `seconds`.

    The next event is the first whose start is *strictly after* now, so standing
    exactly on an event belongs to that event (0% into the following transition).
    Before the first event of the day, that is the last event (wrap from yesterday).
    """
    for index, start in enumerate(start_times):
        if start > seconds:
            return index - 1 if index else len(start_times) - 1
    return len(start_times) - 1


def transition_progress_percent(
    current_start: float, next_start: float, seconds: float
) -> float:
    """How far we are from current_start toward next_start (0–100).

    Raises HomeAssistantError if the result is outside that range — that is a
    bug in event pairing or wrap math, not something to clamp away.
    """
    seconds = seconds % 86400
    crossing_midnight = current_start > next_start

    if crossing_midnight:
        span = 86400 - current_start + next_start
        # Inclusive next-event bound: at exactly next_start remaining is 0 (100%),
        # not 86400 (which made progress negative).
        if seconds <= next_start:
            remaining = next_start - seconds
        else:
            remaining = 86400 - seconds + next_start
    else:
        span = next_start - current_start
        remaining = next_start - seconds

    if span == 0:
        return 0.0

    progress = 100 * (span - remaining) / span
    if progress < 0 or progress > 100:
        raise HomeAssistantError(
            f"Invalid transition progress: {progress:.1f}% "
            f"(expected 0-100%). This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: current={current_start}s, next={next_start}s, "
            f"time={seconds}s"
        )
    return progress


def day_transition_percent(
    current_key: str, next_key: str, intra_progress: float
) -> float:
    """0–100 along dawn → sunrise → noon → sunset → dusk.

    Each named scene is an equal 25% step so a manual set is predictable
    (0 dawn, 25 sunrise, 50 noon, 75 sunset, 100 dusk). Intra-progress is
    0–100 of the clock transition between current and next. After dusk
    (wrapping toward dawn) this stays 100 — the day's last scene.
    """
    if current_key == "dusk" and next_key == "dawn":
        return 100.0
    try:
        index = EVENT_ORDER.index(current_key)
    except ValueError as err:
        raise HomeAssistantError(
            f"Unknown solar event {current_key!r} for day transition percent"
        ) from err
    percent = (index + intra_progress / 100.0) * DAY_PERCENT_STEP
    if percent < 0 or percent > 100:
        raise HomeAssistantError(
            f"Invalid day transition percent: {percent:.1f}% "
            f"(expected 0-100%). This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: current={current_key}, next={next_key}, "
            f"intra={intra_progress}"
        )
    return percent


def scene_keys_from_day_percent(percent: float) -> tuple[str, str, float]:
    """Map 0–100 onto an event pair and intra-pair progress (0–100).

    100% is dusk fully activated (0% into dusk → dawn).
    """
    if percent < 0 or percent > 100:
        raise HomeAssistantError(
            f"Invalid day transition percent: {percent:.1f}% (expected 0-100%). "
            f"This is a calculation error. "
            f"Please open an issue at https://github.com/etokheim/scene_extrapolation/issues "
            f"with the following details: percent={percent}"
        )
    last = len(EVENT_ORDER) - 1
    t = percent / DAY_PERCENT_STEP
    if t >= last:
        return EVENT_ORDER[-1], EVENT_ORDER[0], 0.0
    index = int(t)
    frac = t - index
    return EVENT_ORDER[index], EVENT_ORDER[index + 1], frac * 100.0



async def extrapolate_entities(
    from_scene,
    to_scene,
    scene_transition_progress_percent,
    hass: HomeAssistant,
    brightness_modifier=0,
    skip_entity_ids=None,
) -> list:
    """Takes in a from and to scene and returns a list of new entity states.

    The new states is the extrapolated state between the two scenes.
    Does not apply — the caller snapshots pre-apply state then applies.
    """

    _LOGGER.debug(
        "Extrapolating: %s → %s (%.1f%%)",
        from_scene.get("name", from_scene.get("entity_id", "unknown")),
        to_scene.get("name", to_scene.get("entity_id", "unknown")),
        scene_transition_progress_percent,
    )

    # Add any entities that are present in to_scene, but is missing from from_scene to the from_scene list.
    # This is needed as we are only checking from_scene["entities"] for entities to extrapolate
    for to_entity_id in to_scene["entities"]:
        if to_entity_id not in from_scene["entities"]:
            _LOGGER.debug(
                "Couldn't find %s in the scene we are extrapolating from. Assuming it should be turned off",
                to_entity_id,
            )
            from_entity = {"state": STATE_OFF}

            from_scene["entities"][to_entity_id] = from_entity

    # Collect all entity changes first, then apply them in parallel
    entity_changes = []

    # Process entity extrapolation in parallel for better performance
    async def process_entity_extrapolation(from_entity_id):
        final_entity = {ATTR_ENTITY_ID: from_entity_id}
        from_entity = from_scene["entities"][from_entity_id]

        # Assign to_entity
        if from_entity_id in to_scene["entities"]:
            to_entity = to_scene["entities"][from_entity_id]
        else:
            _LOGGER.debug(
                "Couldn't find %s in the scene we are extrapolating to. Assuming it should be turned off",
                from_entity_id,
            )
            to_entity = {"state": STATE_OFF}

        _LOGGER.debug(
            "  %s: %s → %s",
            from_entity_id,
            from_entity.get("state", "?"),
            to_entity.get("state", "?"),
        )

        # Log a warning if the device is unavailable
        if ("state" in from_entity and from_entity["state"] == STATE_UNAVAILABLE) or (
            "state" in to_entity and to_entity["state"] == STATE_UNAVAILABLE
        ):
            _LOGGER.warning("%s is unavailable and therefor skipped", from_entity_id)
            return None

        # Handle state
        if "state" in from_entity and "state" in to_entity:
            final_entity[ATTR_STATE] = extrapolate_state(
                from_entity,
                to_entity,
                final_entity,
                scene_transition_progress_percent,
            )
        else:
            _LOGGER.error(
                "From or to entity does not have a state and is therefor skipped. from_entity: %s, to_entity: %s",
                from_entity,
                to_entity,
            )
            return None

        # Let's make sure that if one of from/to_entities has a color mode, the other one has got one too.
        # If from_entity or to_entity is missing a color mode, we'll set it to the other's color mode
        if ATTR_COLOR_MODE not in from_entity and ATTR_COLOR_MODE in to_entity:
            from_entity[ATTR_COLOR_MODE] = to_entity[ATTR_COLOR_MODE]
        elif ATTR_COLOR_MODE not in to_entity and ATTR_COLOR_MODE in from_entity:
            to_entity[ATTR_COLOR_MODE] = from_entity[ATTR_COLOR_MODE]

        from_color_mode = from_entity.get(ATTR_COLOR_MODE) or infer_color_mode(
            from_entity
        )
        to_color_mode = to_entity.get(ATTR_COLOR_MODE) or infer_color_mode(to_entity)
        # Same mode: channel-native lerp. Different modes: RGB-lerp endpoints and
        # write rgb_color so live apply does not snap at the old 50% mode flip.
        cross_mode = bool(from_color_mode or to_color_mode) and not same_color_mode(
            from_color_mode, to_color_mode
        )
        final_color_mode = (
            None
            if cross_mode
            else normalize_color_mode(from_color_mode or to_color_mode)
        )

        if final_color_mode or from_color_mode or to_color_mode:
            _LOGGER.debug(
                "    Color mode: %s → %s → %s",
                from_color_mode or "?",
                "rgb-blend" if cross_mode else (final_color_mode or "?"),
                to_color_mode or "?",
            )

        # Collect all changes first, then apply once
        if ATTR_BRIGHTNESS in from_entity or ATTR_BRIGHTNESS in to_entity:
            final_entity[ATTR_BRIGHTNESS] = extrapolate_brightness(
                from_entity,
                to_entity,
                final_entity,
                scene_transition_progress_percent,
                brightness_modifier,
            )

        if cross_mode:
            rgb = blend_entity_rgb(
                from_entity, to_entity, scene_transition_progress_percent
            )
            final_entity[ATTR_RGB_COLOR] = list(rgb)
        elif final_color_mode in (ColorMode.COLOR_TEMP, ATTR_COLOR_TEMP_KELVIN):
            final_entity[ATTR_COLOR_TEMP_KELVIN] = extrapolate_temp_kelvin(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode in (ColorMode.RGB, ATTR_RGB_COLOR):
            final_entity[ATTR_RGB_COLOR] = extrapolate_rgb(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.HS:
            final_entity[ATTR_HS_COLOR] = extrapolate_hs(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.RGBW:
            final_entity[ATTR_RGBW_COLOR] = extrapolate_rgbw(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        elif final_color_mode == ColorMode.RGBWW:
            final_entity[ATTR_RGBWW_COLOR] = extrapolate_rgbww(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        # Handle effects
        if ATTR_EFFECT in from_entity or ATTR_EFFECT in to_entity:
            final_entity[ATTR_EFFECT] = extrapolate_effect(
                from_entity, to_entity, final_entity, scene_transition_progress_percent
            )

        # Log summary for non-light entities (light details already logged above)
        if not final_entity[ATTR_ENTITY_ID].startswith("light."):
            attrs_summary = {
                k: v
                for k, v in final_entity.items()
                if k not in (ATTR_ENTITY_ID, "state")
            }
            if attrs_summary:
                _LOGGER.debug("    Attributes: %s", attrs_summary)

        return final_entity

    # Process all entities in parallel
    extrapolation_start_time = time.time()
    skip = skip_entity_ids or set()
    tasks = []
    for from_entity_id in from_scene["entities"]:
        if from_entity_id in skip:
            continue
        task = asyncio.create_task(process_entity_extrapolation(from_entity_id))
        tasks.append(task)

    entity_changes = []
    # Wait for all extrapolation tasks to complete
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        entity_changes = [
            result
            for result in results
            if result is not None and not isinstance(result, BaseException)
        ]

    _LOGGER.debug(
        "Time extrapolating %d entities in parallel: %.3fs",
        len(entity_changes),
        time.time() - extrapolation_start_time,
    )

    return entity_changes


def extrapolate_value(from_value, to_value, scene_transition_progress_percent):
    """Extrapolate a value."""
    difference = to_value - from_value
    current_transition_difference = difference * scene_transition_progress_percent / 100
    return round(from_value + current_transition_difference)


def extrapolate_number(
    from_number, to_number, scene_transition_progress_percent
) -> int:
    """Takes the current transition percent plus a from and to number and returns what the new value should be."""
    # Make sure the input is as it should be
    # TODO: This should only be temporary - figure out why values sometimes are bad
    if not isinstance(from_number, numbers.Number):
        _LOGGER.error(
            "Trying to extrapolate a value that's not a number! %s", from_number
        )
        from_number = to_number
    elif not isinstance(to_number, numbers.Number):
        _LOGGER.error(
            "Trying to extrapolate a value that's not a number! %s", to_number
        )
        to_number = from_number

    difference = to_number - from_number
    current_transition_difference = difference * scene_transition_progress_percent / 100
    final_transition_value = round(from_number + current_transition_difference)

    # If the extrapolated value is higher than both from and to_number, then something's wrong
    # TODO: Remove this if the error doesn't pop up in the near future. Was just a wrong -/+ value...
    if final_transition_value > from_number and final_transition_value > to_number:
        _LOGGER.warning(
            "Math is hard... From number: %s, to_number %s, extrapolated: %s, transition_percent: %s",
            from_number,
            to_number,
            final_transition_value,
            scene_transition_progress_percent,
        )
        raise HomeAssistantError("Extrapolation math error... Developer goes: Ugh...")

    # Same, but if both are lower
    if final_transition_value < from_number and final_transition_value < to_number:
        _LOGGER.warning(
            "Math is hard... From number: %s, to_number %s, extrapolated: %s, transition_percent: %s",
            from_number,
            to_number,
            final_transition_value,
            scene_transition_progress_percent,
        )
        raise HomeAssistantError("Extrapolation math error 2... Developer goes: Ugh...")

    return final_transition_value


def extrapolate_brightness(
    from_entity,
    to_entity,
    final_entity,
    scene_transition_progress_percent,
    brightness_modifier=0,
):
    """Extrapolate brightness."""
    # There isn't always a brightness attribute in the to_entity (ie. if it's turned off or the like)
    from_brightness = from_entity.get(ATTR_BRIGHTNESS, 0)

    to_brightness = to_entity.get(ATTR_BRIGHTNESS, 0)

    final_brightness = extrapolate_number(
        from_brightness,
        to_brightness,
        scene_transition_progress_percent,
    )

    # Apply brightness modifier (-100 to +100)
    if brightness_modifier != 0:
        modifier_factor = 1 + (brightness_modifier / 100.0)
        final_brightness = int(final_brightness * modifier_factor)
        # Clamp to valid brightness range (0-255)
        final_brightness = max(0, min(255, final_brightness))

    return final_brightness


def extrapolate_state(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolates a state that can't be animated. Ie. a switch that instantaniously turns from the off state to on."""
    from_state = (
        from_entity[ATTR_STATE] if ATTR_STATE in from_entity else to_entity[ATTR_STATE]
    )

    to_state = (
        to_entity[ATTR_STATE] if ATTR_STATE in to_entity else from_entity[ATTR_STATE]
    )

    if scene_transition_progress_percent <= 50:
        final_state = from_state
    else:
        final_state = to_state

    _LOGGER.debug(
        "    From state %s → now: %s → to: %s", from_state, final_state, to_state
    )

    return final_state


def extrapolate_temp_kelvin(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate color temperature Kelvin."""
    from_color_temp_kelvin = (
        from_entity[ATTR_COLOR_TEMP_KELVIN]
        if ATTR_COLOR_TEMP_KELVIN in from_entity
        else to_entity[
            ATTR_COLOR_TEMP_KELVIN
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    to_color_temp_kelvin = (
        to_entity[ATTR_COLOR_TEMP_KELVIN]
        if ATTR_COLOR_TEMP_KELVIN in to_entity
        else from_entity[
            ATTR_COLOR_TEMP_KELVIN
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    if from_color_temp_kelvin is None:
        _LOGGER.debug(
            "    Color mode: %s → %s → %s (limited: missing color_temp in 'from', using 'to')",
            from_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
        )
        from_color_temp_kelvin = to_color_temp_kelvin
    elif to_color_temp_kelvin is None:
        _LOGGER.debug(
            "    Color mode: %s → %s → %s (limited: missing color_temp in 'to', using 'from')",
            from_entity[ATTR_COLOR_MODE],
            from_entity[ATTR_COLOR_MODE],
            to_entity[ATTR_COLOR_MODE],
        )
        to_color_temp_kelvin = from_color_temp_kelvin

    final_color_temp_kelvin = extrapolate_number(
        from_color_temp_kelvin,
        to_color_temp_kelvin,
        scene_transition_progress_percent,
    )

    _LOGGER.debug(
        "    From color temp: %s → now: %s → to: %s K (from brightness: %s → now: %s → to: %s)",
        from_color_temp_kelvin,
        final_color_temp_kelvin,
        to_color_temp_kelvin,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity.get(ATTR_BRIGHTNESS, "?"),
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return final_color_temp_kelvin


def extrapolate_rgb(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGB via HS on the wheel rim (not RGB-channel through white)."""
    from_rgb = (
        from_entity[ATTR_RGB_COLOR]
        if ATTR_RGB_COLOR in from_entity
        else to_entity[
            ATTR_RGB_COLOR
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    to_rgb = (
        to_entity[ATTR_RGB_COLOR]
        if ATTR_RGB_COLOR in to_entity
        else from_entity[
            ATTR_RGB_COLOR
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    from_hs = rgb_to_hs(from_rgb[0], from_rgb[1], from_rgb[2])
    to_hs = rgb_to_hs(to_rgb[0], to_rgb[1], to_rgb[2])
    hue, sat = lerp_hs(from_hs, to_hs, scene_transition_progress_percent)
    rgb_extrapolated = list(hs_to_rgb(hue, sat))

    _LOGGER.debug(
        "    From RGB: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgb,
        rgb_extrapolated,
        to_rgb,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity.get(ATTR_BRIGHTNESS, "?"),
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgb_extrapolated


def extrapolate_hs(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate HS."""
    from_hs = (
        from_entity[ATTR_HS_COLOR]
        if ATTR_HS_COLOR in from_entity
        else to_entity[
            ATTR_HS_COLOR
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    to_hs = (
        to_entity[ATTR_HS_COLOR]
        if ATTR_HS_COLOR in to_entity
        else from_entity[
            ATTR_HS_COLOR
        ]  # If there's no new color temp, we'll just keep the current one. Brightness extrapolation will likely turn it off in that case.
    )

    # Calculate what the current color should be
    # The if statement checks whether the result tried to divide by zero, which throws an
    # error, if so, we know that the from and to values are the same, and we can fall back
    # to the from value
    final_hs = [
        extrapolate_value(from_hs[0], to_hs[0], scene_transition_progress_percent),
        extrapolate_value(from_hs[1], to_hs[1], scene_transition_progress_percent),
    ]

    _LOGGER.debug(
        "    Frmo HS: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_hs,
        final_hs,
        to_hs,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity.get(ATTR_BRIGHTNESS, "?"),
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return final_hs


def extrapolate_rgbw(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGBW."""
    from_rgbw = (
        from_entity[ATTR_RGBW_COLOR]
        if ATTR_RGBW_COLOR in from_entity
        else to_entity[ATTR_RGBW_COLOR]
    )

    to_rgbw = (
        to_entity[ATTR_RGBW_COLOR]
        if ATTR_RGBW_COLOR in to_entity
        else from_entity[ATTR_RGBW_COLOR]
    )

    rgbw_extrapolated = [
        extrapolate_value(from_rgbw[0], to_rgbw[0], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[1], to_rgbw[1], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[2], to_rgbw[2], scene_transition_progress_percent),
        extrapolate_value(from_rgbw[3], to_rgbw[3], scene_transition_progress_percent),
    ]

    _LOGGER.debug(
        "    From RGBW: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgbw,
        rgbw_extrapolated,
        to_rgbw,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity.get(ATTR_BRIGHTNESS, "?"),
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgbw_extrapolated


def extrapolate_rgbww(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate RGBWW."""
    from_rgbww = (
        from_entity[ATTR_RGBWW_COLOR]
        if ATTR_RGBWW_COLOR in from_entity
        else to_entity[ATTR_RGBWW_COLOR]
    )

    to_rgbww = (
        to_entity[ATTR_RGBWW_COLOR]
        if ATTR_RGBWW_COLOR in to_entity
        else from_entity[ATTR_RGBWW_COLOR]
    )

    rgbww_extrapolated = [
        extrapolate_value(
            from_rgbww[0], to_rgbww[0], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[1], to_rgbww[1], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[2], to_rgbww[2], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[3], to_rgbww[3], scene_transition_progress_percent
        ),
        extrapolate_value(
            from_rgbww[4], to_rgbww[4], scene_transition_progress_percent
        ),
    ]

    _LOGGER.debug(
        "    From RGBWW: %s → now: %s → to: %s (from brightness: %s → now: %s → to: %s)",
        from_rgbww,
        rgbww_extrapolated,
        to_rgbww,
        from_entity.get(ATTR_BRIGHTNESS, "?"),
        final_entity.get(ATTR_BRIGHTNESS, "?"),
        to_entity.get(ATTR_BRIGHTNESS, "?"),
    )

    return rgbww_extrapolated


def extrapolate_effect(
    from_entity, to_entity, final_entity, scene_transition_progress_percent
):
    """Extrapolate light effects."""
    from_effect = (
        from_entity[ATTR_EFFECT]
        if ATTR_EFFECT in from_entity
        else to_entity[ATTR_EFFECT]
    )

    to_effect = (
        to_entity[ATTR_EFFECT] if ATTR_EFFECT in to_entity else from_entity[ATTR_EFFECT]
    )

    # Effects can't be smoothly interpolated like colors or brightness
    # Instead, we choose which effect to use based on the transition progress
    if scene_transition_progress_percent < 50:
        final_effect = from_effect
    else:
        final_effect = to_effect

    _LOGGER.debug(
        "    From effect: %s → now: %s → to: %s", from_effect, final_effect, to_effect
    )

    return final_effect
