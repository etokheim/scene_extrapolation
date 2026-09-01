"""Apply extrapolated entity states to Home Assistant."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from homeassistant.components.fan import DOMAIN as FAN_DOMAIN
from homeassistant.components.light import ATTR_TRANSITION
from homeassistant.components.light import DOMAIN as LIGHT_DOMAIN
from homeassistant.components.lock import LockState
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_STATE,
    SERVICE_LOCK,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    SERVICE_UNLOCK,
    STATE_CLOSED,
    STATE_CLOSING,
    STATE_OFF,
    STATE_OPEN,
    STATE_OPENING,
    STATE_PROBLEM,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .continuous import snapshot_from_command, snapshot_from_state, states_match

_LOGGER = logging.getLogger(__name__)


async def apply_entities_parallel(
    entities,
    hass: HomeAssistant,
    transition_time=0,
    context=None,
    *,
    skip_noop: bool = False,
):
    """Apply multiple entity states in parallel for better performance.

    When skip_noop is True (follow-up ticks only), lights whose current state
    already matches the commanded target are not sent another service call.
    """
    _LOGGER.debug("Starting parallel processing of %d entities", len(entities))

    tasks = []
    for entity in entities:
        task = asyncio.create_task(
            apply_single_entity(
                entity,
                hass,
                transition_time,
                context=context,
                skip_noop=skip_noop,
            )
        )
        tasks.append(task)

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        _LOGGER.debug("Completed parallel processing of %d entities", len(entities))


def light_command_is_noop(hass: HomeAssistant, entity: dict[str, Any]) -> bool:
    """True when a light already matches the commanded on/off + color/brightness."""
    entity_id = entity.get(ATTR_ENTITY_ID)
    if not entity_id or not str(entity_id).startswith("light."):
        return False
    actual = snapshot_from_state(hass.states.get(entity_id))
    if actual is None:
        return False
    commanded = snapshot_from_command(entity)
    return states_match(actual, commanded)


async def apply_single_entity(
    entity,
    hass: HomeAssistant,
    transition_time=0,
    context=None,
    *,
    skip_noop: bool = False,
):
    """Apply a single entity state."""
    domain = entity[ATTR_ENTITY_ID].split(".")[0]
    state = entity["state"]

    if "state" not in entity:
        _LOGGER.error(
            "The entity provided is missing a state property. Can't apply entity state (skipping). Entity: %s",
            entity,
        )
        return None
    if state in (STATE_UNAVAILABLE, STATE_UNKNOWN, STATE_PROBLEM, LockState.JAMMED):
        _LOGGER.error("Entity state is %s", entity["state"])
        return None

    if skip_noop and domain == LIGHT_DOMAIN and light_command_is_noop(hass, entity):
        _LOGGER.debug("Skipping no-op follow-up for %s", entity[ATTR_ENTITY_ID])
        return False

    if domain == LIGHT_DOMAIN:
        entity[ATTR_TRANSITION] = transition_time

    if domain == FAN_DOMAIN:
        _LOGGER.warning(
            "Extrapolation of fans only support turning them on/off. Direction, speed etc will be ignored until it's implemented. Please open an issue or PR if this is something you want"
        )

    entity_applied = entity.copy()
    service_type = None
    if state == "on":
        service_type = SERVICE_TURN_ON
    elif state == "off":
        service_type = SERVICE_TURN_OFF
    elif state in (LockState.LOCKED, LockState.LOCKING):
        service_type = SERVICE_LOCK
    elif state in (LockState.UNLOCKED, LockState.UNLOCKING):
        service_type = SERVICE_UNLOCK
    elif state in (STATE_OPEN, STATE_OPENING):
        if domain == "cover":
            service_type = "open_cover"
        elif domain == "valve":
            service_type = "open_valve"
        else:
            service_type = SERVICE_TURN_ON
    elif state in (STATE_CLOSED, STATE_CLOSING):
        if domain == "cover":
            service_type = "close_cover"
        elif domain == "valve":
            service_type = "close_valve"
        else:
            service_type = SERVICE_TURN_OFF

    del entity_applied["state"]

    if domain == LIGHT_DOMAIN and service_type == SERVICE_TURN_OFF:
        entity_applied = {
            ATTR_ENTITY_ID: entity_applied[ATTR_ENTITY_ID],
            ATTR_TRANSITION: transition_time,
        }
    else:
        entity_applied = {
            key: value for key, value in entity_applied.items() if value is not None
        }

    _LOGGER.debug("%s.%s: %s", domain, service_type, entity_applied)

    try:
        await hass.services.async_call(
            domain=domain,
            service=service_type,
            service_data=entity_applied,
            context=context,
        )
    except Exception as error:  # noqa: BLE001
        _LOGGER.error("Service call to turn on light failed: %s", error)

    return True


def get_scene_by_uuid(scenes, uuid):
    """Searches through the supplied array after the supplied scene uuid. Then returns that."""
    if uuid is None:
        raise HomeAssistantError(
            "Developer goes: Ehhh... Something's wrong. I'm searching for an non-existant uuid... You've probably deleted one of the configured scenes. Please reconfigure the integration."
        )

    for scene in scenes:
        if scene["entity_id"] == uuid:
            return scene

    raise HomeAssistantError(
        "Hey - you have to configure the extension first! A scene field is missing a value (or have an incorrect one set)"
    )
