# Decisions

Durable product and architecture choices for Scene Extrapolation.
Agents: do not reverse these without an explicit user request. Supersede entries in the same change set when intentionally changing course.

## One config entry; rooms live in a store and sidebar panel

- **Date:** 2026-08-26
- **Decision:** Add Scene Extrapolation once. Extrapolation scenes (rooms) are created and edited in a custom sidebar panel. Config lives in `homeassistant.helpers.storage` (`scene_extrapolation.scenes`), not one config entry per room. Legacy per-room entries are imported into the store, then extra entries are removed.
- **Why:** HA config/options flows cannot be a list-and-detail manager. Repeating “add integration” per room was the tedious setup. Scene entities stay `scene.*`; only the configuration home moved.
- **Do not reverse without user ask.**

## Custom panel uses native HA widgets, not an iframe

- **Date:** 2026-08-26
- **Decision:** Register a built-in custom sidebar panel (`embed_iframe: False`) and build list/create/edit with HA web components (`ha-form`, area/entity selectors).
- **Why:** An iframe cannot host those components. Reinventing pickers would look and behave unlike the rest of HA.
- **Do not reverse without user ask.**

## Panel JS cache-bust via versioned static URL

- **Date:** 2026-08-26
- **Decision:** Serve `frontend/panel.js` from `/api/scene_extrapolation/assets/<manifest version>-<PANEL_ASSET_REV>/panel.js` with `cache_headers=False`. Bump `manifest.json` `version` on release; increment `PANEL_ASSET_REV` in `panel.py` for in-progress frontend changes.
- **Why:** HA caches custom panel modules by URL. Python restarts do not pick up JS if the path is unchanged.
- **Do not reverse without user ask.**

## Sticky panel header with bottom border

- **Date:** 2026-08-26
- **Decision:** The sidebar panel header stays pinned (`position: sticky`) and has a visible bottom border while the body scrolls.
- **Why:** Explicit UX request; matches HA’s own app header behavior.
- **Do not reverse without user ask.**

## Sun-path chart on create/edit

- **Date:** 2026-08-26
- **Decision:** The create/edit screen shows a full-width sun elevation curve for today, with dawn / sunrise / noon / sunset / dusk plotted (icons + times). Dusk on the chart respects the configured earliest-dusk override.
- **Why:** Makes the solar events the scenes interpolate between visible instead of abstract form fields.
- **Do not reverse without user ask.**

## Per-light brightness bars and date preview

- **Date:** 2026-08-26
- **Decision:** Under the sun chart on create/edit, list each light with a full-width bar: height is brightness %, fill color is the interpolated light color. A date picker (with Today / 21 Jun / 21 Dec) drives both the sun curve and the bars. Polar / no-rise events use the same seasonal fallbacks as scene activation. An entity present in one scene but not the next is a warning, not an error (treated as off during that transition).
- **Why:** Lets you see the day at a glance, including winter/polar handling, without activating the scene. Missing entities are supported on purpose (e.g. a lamp that only exists in the evening scene).
- **Do not reverse without user ask.**
