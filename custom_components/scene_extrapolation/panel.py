"""Sidebar panel registration."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from homeassistant.components.frontend import (
    DATA_PANELS,
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PANEL_URL_PATH

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend"
PANEL_VERSION = json.loads(
    (Path(__file__).parent / "manifest.json").read_text(encoding="utf-8")
).get("version", "0")
# Increment when panel.js changes without a manifest version bump.
PANEL_ASSET_REV = "90"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Serve the panel JS and add a sidebar entry."""
    # Versioned path so HA's frontend module cache picks up panel.js after a restart.
    # Bump manifest.json version for releases; increment PANEL_ASSET_REV for WIP frontend.
    static_url = f"/api/scene_extrapolation/assets/{PANEL_VERSION}-{PANEL_ASSET_REV}"
    try:
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    static_url,
                    str(FRONTEND_DIR),
                    cache_headers=False,
                )
            ]
        )
    except (ValueError, RuntimeError):
        _LOGGER.debug("Static panel path already registered")

    if PANEL_URL_PATH in hass.data.get(DATA_PANELS, {}):
        async_remove_panel(hass, PANEL_URL_PATH)

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Scene Extrapolation",
        sidebar_icon="mdi:auto-fix",
        frontend_url_path=PANEL_URL_PATH,
        require_admin=True,
        config={
            "_panel_custom": {
                "name": "scene-extrapolation-panel",
                "module_url": f"{static_url}/panel.js",
                # Native HA web components (ha-form, selectors) do not work in an iframe.
                "embed_iframe": False,
            }
        },
    )
    _LOGGER.debug("Registered %s sidebar panel", DOMAIN)


async def async_unload_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel."""
    try:
        async_remove_panel(hass, PANEL_URL_PATH)
    except (KeyError, ValueError):
        pass
