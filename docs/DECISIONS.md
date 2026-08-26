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
- **Superseded:** 2026-08-26 — use `ha-top-app-bar-fixed` instead of a custom sticky header.
- **Decision:** The sidebar panel header stays pinned (`position: sticky`) and has a visible bottom border while the body scrolls.
- **Why:** Explicit UX request; matches HA’s own app header behavior.
- **Do not reverse without user ask.**

## Use HA’s top app bar; header stays outside the scroll container

- **Date:** 2026-08-26
- **Decision:** The sidebar panel uses `ha-top-app-bar-fixed`. Title goes in `slot="title"`. Page content (sun path + form) goes in the default slot, which is the component’s scroll container. List view slots `ha-menu-button`; the editor slots a back button that hash-routes home (do not use `back-button` / `goBack()` — this panel is not HA history). Size the panel `:host` to `100vh` and stretch the app bar to `100%` of that. Do not size the app bar with `100%` of `ha-panel-custom` — that host often computes to 0 height, which collapses the bar and clips the page.
- **Why:** A custom sticky header had the wrong bottom-border token and sat inside our own overflow, so it did not pin. HA keeps the bar outside the scrolling region and uses `--app-header-border-bottom`. `ha-top-app-bar-fixed` itself uses `100vh` for the same 0-height parent.
- **Do not reverse without user ask.**

## Standing on a solar event is 0% of the next transition

- **Date:** 2026-08-26
- **Decision:** Current event is the last whose start is *strictly after* now (`start > seconds`). Wrap-around remaining uses `seconds <= next_start` so an exact next-event time is 100%, not a leftover 86400s. Activation (`scene.py`) and preview share `current_sun_event_index` / `transition_progress_percent`. Out-of-range progress still raises; it is not clamped.
- **Why:** `start >= now` treated “exactly dawn” as still the dusk→dawn wrap. Remaining became 86400s, elapsed went negative, and preview samples on the 5-minute grid (dusk minimum 22:00, fallback dawn) raised “Extrapolation math error 2”.
- **Do not reverse without user ask.**

## Sun-path chart on create/edit

- **Date:** 2026-08-26
- **Decision:** The create/edit screen shows a full-width sun elevation curve for today, with dawn / sunrise / noon / sunset / dusk plotted (icons + times). Dusk on the chart respects the configured earliest-dusk override.
- **Why:** Makes the solar events the scenes interpolate between visible instead of abstract form fields.
- **Do not reverse without user ask.**

## Per-light brightness curves and date preview

- **Date:** 2026-08-26
- **Decision:** Under the sun chart on create/edit, list each light as a full-width brightness polyline (one SVG path + x-gradient from sample colors), not a strip of `<rect>` bars. The entity name sits on the chart and opens more-info. Graphs stack with no gap. Polar / no-rise events use the same seasonal fallbacks as scene activation. An entity present in one scene but not the next is a warning, not an error (treated as off during that transition).
- **Why:** A single line matches the sun chart and stays cheap to paint. Labels on the plot save vertical space; clicking through to the entity is the usual HA pattern. Missing entities are supported on purpose (e.g. a lamp that only exists in the evening scene).
- **Do not reverse without user ask.**

## Native HA date field for the preview day

- **Date:** 2026-08-26
- **Decision:** The preview day control is HA’s `ha-selector` `{ date: {} }` (`ha-date-input` → `ha-dialog-date-picker`), with prev/next day buttons and Today / 21 Jun / 21 Dec chips. Do not use Activity’s `ha-date-range-picker` (that is a start–end range) or a raw `<input type="date">`.
- **Why:** Logbook’s widget is a range. The single-day native widget is `ha-date-input`. `ha-selector` already knows how to lazy-load that chunk from HA’s bundle; our `panel.js` cannot `import()` those files.
- **Do not reverse without user ask.**

## Opaque light-graph fills

- **Date:** 2026-08-26
- **Decision:** The area under each light brightness polyline is fully opaque (`fill-opacity: 1`). Keep the stroke on top of the fill.
- **Why:** Semi-transparent fills made the curves look washed out against the card background.
- **Do not reverse without user ask.**

## Panel FAB matches hass-subpage, not ha-fab

- **Date:** 2026-08-26
- **Decision:** List and editor use a corner overlay (`position: absolute` sibling of `ha-top-app-bar-fixed`, same offsets as hass-subpage `#fab`) with `ha-button size="l" variant="brand" appearance="accent"`. List label is “New extrapolation scene”; editor is “Save”. Do not use `ha-fab` — it is not registered in this frontend.
- **Why:** Automations create with that button in the `#fab` slot. `ha-top-app-bar-fixed` has no fab slot, so the overlay has to sit beside the app bar.
- **Do not reverse without user ask.**

## Save/rename dialog; area stays on the form

- **Date:** 2026-08-26
- **Decision:** Save and Rename open a `ha-dialog` patterned on `ha-dialog-automation-save`: required name, optional description / category / labels via assist chips. Area is not in the dialog; it stays on the main `ha-form`. Name is no longer a form field. Persist description in the store; sync labels and the `scene` category through the entity registry.
- **Why:** HA scene/automation save prompts for identity metadata at save time. Area still filters scene pickers on the form, so it cannot move into the dialog. `ha-dialog-scene-save` is not loaded in a custom panel.
- **Do not reverse without user ask.**

## Editor overflow menu for rename and delete

- **Date:** 2026-08-26
- **Decision:** Existing scenes get `ha-dropdown` in `slot="actionItems"` (dots trigger, `wa-select`, Rename + danger Delete). New unsaved scenes have no overflow. Inline Save/Delete buttons on the form are gone.
- **Why:** Same header overflow pattern as the automation editor. Delete is destructive, so it stays off the FAB.
- **Do not reverse without user ask.**
