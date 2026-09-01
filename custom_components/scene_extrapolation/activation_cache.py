"""In-process caches for automatic light-update activation (invalidated on scene.reload)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.homeassistant.scene import HomeAssistantScene
from homeassistant.const import EVENT_HOMEASSISTANT_START
from homeassistant.core import Event, HomeAssistant, callback

from .const import DOMAIN
from .solar import resolve_solar_events

DATA_ACTIVATION_CACHE = "activation_cache"


def _cache(hass: HomeAssistant) -> dict[str, Any]:
    domain = hass.data.setdefault(DOMAIN, {})
    return domain.setdefault(
        DATA_ACTIVATION_CACHE,
        {
            "scenes": None,
            "scenes_token": None,
            "solar": {},
            "listener": None,
        },
    )


def _scenes_token(hass: HomeAssistant) -> tuple | None:
    scene_component = hass.data.get("scene")
    if not scene_component:
        return None
    ids = []
    for entity in scene_component.entities:
        if isinstance(entity, HomeAssistantScene) and hasattr(entity, "scene_config"):
            cfg = entity.scene_config
            ids.append((entity.entity_id, cfg.id, cfg.name, len(cfg.states)))
    return tuple(sorted(ids))


def invalidate_activation_cache(hass: HomeAssistant) -> None:
    """Drop cached native scenes and solar events (after scene.reload)."""
    cache = _cache(hass)
    cache["scenes"] = None
    cache["scenes_token"] = None
    cache["solar"] = {}


@callback
def _on_call_service(event: Event) -> None:
    domain = event.data.get("domain")
    service = event.data.get("service")
    if domain == "scene" and service == "reload":
        invalidate_activation_cache(event.hass)


def ensure_activation_cache_listener(hass: HomeAssistant) -> None:
    """Listen once for scene.reload to invalidate caches."""
    cache = _cache(hass)
    if cache.get("listener"):
        return

    @callback
    def _attach(_event: Event | None = None) -> None:
        if cache.get("listener"):
            return
        cache["listener"] = hass.bus.async_listen("call_service", _on_call_service)

    if hass.is_running:
        _attach()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_START, _attach)


def cached_in_memory_scenes(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return native scene payloads, rebuilt when the scene platform changes."""
    ensure_activation_cache_listener(hass)
    cache = _cache(hass)
    token = _scenes_token(hass)
    if (
        token is not None
        and token == cache.get("scenes_token")
        and cache.get("scenes") is not None
    ):
        return cache["scenes"]

    scene_component = hass.data.get("scene")
    scenes: list[dict[str, Any]] = []
    if scene_component:
        for entity in scene_component.entities:
            if isinstance(entity, HomeAssistantScene) and hasattr(
                entity, "scene_config"
            ):
                scene_config = entity.scene_config
                entities_dict = {}
                for entity_id, state in scene_config.states.items():
                    entities_dict[entity_id] = {
                        "state": state.state,
                        **state.attributes,
                    }
                scenes.append(
                    {
                        "id": scene_config.id,
                        "name": scene_config.name,
                        "icon": scene_config.icon,
                        "entity_id": entity.entity_id,
                        "entities": entities_dict,
                    }
                )
    cache["scenes"] = scenes
    cache["scenes_token"] = token
    return scenes


def cached_solar_events(
    hass: HomeAssistant,
    *,
    latitude: float,
    longitude: float,
    time_zone: str,
    target: datetime,
) -> tuple[dict[str, datetime], set[str]]:
    """Day-scoped solar event datetimes for activation."""
    ensure_activation_cache_listener(hass)
    cache = _cache(hass)
    day_key = (
        round(latitude, 5),
        round(longitude, 5),
        time_zone,
        target.date().isoformat(),
    )
    solar = cache["solar"]
    if day_key in solar:
        return solar[day_key]
    result = resolve_solar_events(
        latitude=latitude,
        longitude=longitude,
        time_zone=time_zone,
        target=target,
    )
    if len(solar) > 8:
        solar.clear()
    solar[day_key] = result
    return result
