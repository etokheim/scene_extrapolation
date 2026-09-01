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
- **Decision:** Serve `frontend/panel.js` from `/api/scene_extrapolation/assets/<manifest version>-<PANEL_ASSET_REV>/panel.js` with `cache_headers=False`. Bump `manifest.json` `version` on release; increment `PANEL_ASSET_REV` in `panel.py` for in-progress frontend changes. After `docker compose restart`, pick it up on the **already-open** HA tab with a **normal** reload (`location.reload()` / user refresh / soft navigate that reloads the document) — not a new Cursor browser tab and not a hard-reload (`ignoreCache`). Soft in-app hash navigation alone often keeps the previously registered `scene-extrapolation-panel` custom element. Before judging UI bugs, confirm the new build is live (e.g. shadow DOM lacks removed markers, or CSS matches the change).
- **Why:** HA caches custom panel modules by URL. Python restarts do not pick up JS if the path is unchanged. Custom elements do not re-define when only the hash route changes, so agents can chase “fixed” layout bugs against a stale class. A hard-reload (or a new tab used as one) can reload the whole Cursor window.
- **Do not reverse without user ask.**

## Panel frontend as ES modules without a bundler

- **Date:** 2026-09-01
- **Decision:** Keep `SceneExtrapolationPanel` in `frontend/panel.js` and split free helpers into sibling ES modules loaded with relative imports (`./color_ui.js`, `./dial_clock.js`, `./editor_session.js`, `./client_solar.js`). The static path registers the whole `frontend/` directory, so imports resolve next to `panel.js`. No bundler/build step.
- **Why:** `panel.js` was too large to navigate. HA already loads the panel as a module (`client_solar.js` proved relative imports work). Splitting by concern keeps behavior identical while making further extraction safer.
- **Do not reverse without user ask.**

## Sticky panel header with bottom border

- **Date:** 2026-08-26
- **Superseded:** 2026-08-26 — use `ha-top-app-bar-fixed` instead of a custom sticky header.
- **Decision:** The sidebar panel header stays pinned (`position: sticky`) and has a visible bottom border while the body scrolls.
- **Why:** Explicit UX request; matches HA’s own app header behavior.
- **Do not reverse without user ask.**

## Use HA’s top app bar; header stays outside the scroll container

- **Date:** 2026-08-26
- **Superseded in part:** 2026-09-01 — `:host` keeps `height: 100vh` as the zero-parent fallback but adds `max-height: 100%` so a definite panel outlet clips the host. Without that, the HA shell and `ha-top-app-bar-fixed` both show vertical scrollbars. Empty-state min-height uses the scrollport (`100%`), not another `100vh` stack. Dial uses `overflow-x: clip` (not `hidden`) with `overflow-y: visible` — `hidden`+`visible` computes Y to `auto` and the dial grew a second scrollbar beside the app bar.
- **Decision:** The sidebar panel uses `ha-top-app-bar-fixed`. Title goes in `slot="title"`. Page content (sun path + form) goes in the default slot, which is the component’s scroll container. List view slots `ha-menu-button`; the editor slots a back button that hash-routes home (do not use `back-button` / `goBack()` — this panel is not HA history). Size the panel `:host` to `100vh` with `max-height: 100%`, and stretch the app bar to `100%` of that host. Do not size the app bar with `100%` of `ha-panel-custom` alone — that host often computes to 0 height, which collapses the bar and clips the page.
- **Why:** A custom sticky header had the wrong bottom-border token and sat inside our own overflow, so it did not pin. HA keeps the bar outside the scrolling region and uses `--app-header-border-bottom`. `ha-top-app-bar-fixed` itself uses `100vh` for the same 0-height parent. Pure `100vh` on the custom element is taller than the panel outlet in some shells (embedded browser / definite parent height), which adds a second scrollbar beside the app bar’s. Separately, CSS’s overflow quirk on the dial (`overflow-x: hidden` forces `overflow-y: auto`) stacked a second vertical bar on the editor.
- **Do not reverse without user ask.**

## Standing on a solar event is 0% of the next transition

- **Date:** 2026-08-26
- **Decision:** Current event is the last whose start is *strictly after* now (`start > seconds`). Wrap-around remaining uses `seconds <= next_start` so an exact next-event time is 100%, not a leftover 86400s. Activation (`scene.py`) and preview share `current_sun_event_index` / `transition_progress_percent`. Out-of-range progress still raises; it is not clamped.
- **Why:** `start >= now` treated “exactly dawn” as still the dusk→dawn wrap. Remaining became 86400s, elapsed went negative, and preview samples on the 5-minute grid (dusk minimum 22:00, fallback dawn) raised “Extrapolation math error 2”.
- **Do not reverse without user ask.**

## Sun-path chart on create/edit

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-26 — no static vertical grid or event lines; hover shows a second cursor line and a fixed readout.
- **Superseded in part:** 2026-08-26 — Y scale is the location’s annual max elevation; the stroke is darker below the horizon.
- **Superseded in part:** 2026-08-30 — when earliest dusk clamps the scene, path dots / night wedges / chart markers stay at true solar dusk; only the interactive event button moves to the floor, with a smaller disabled ghost at solar and a dashed link between them. Top event cards strike through solar time and show the clamped time beside it. Preview events expose `solar_seconds` when overridden.
- **Decision:** The create/edit screen shows a full-width sun elevation curve for today, with dawn / sunrise / noon / sunset / dusk plotted (icons + times). True solar dusk stays visible when earliest-dusk delays the scene; the active control sits at the clamped time.
- **Why:** Makes the solar events the scenes interpolate between visible instead of abstract form fields. Showing both solar and clamp makes the override obvious without lying about when dusk actually is.
- **Do not reverse without user ask.**

## Sun-path Y scale is annual max; night stroke is darker

- **Date:** 2026-08-26
- **Decision:** The sun chart’s vertical domain is ± this location’s maximum solar elevation (`90° − max(0, |lat| − 23.44)`), expanded only if that day’s samples fall outside. Do not auto-fit to the day’s min/max. The polyline (and fill) uses the day amber above 0° and a darker amber below. Horizon stays drawn as the 0° dashed line.
- **Why:** Auto-fitting put a 5° winter noon at the top of the plot, so a sun that barely clears the horizon looked overhead. A day-relative scale also made June and December incomparable. Darker night stroke makes below-horizon the same curve, not a second series.
- **Do not reverse without user ask.**

## Hover inspects time and brightness in a fixed readout

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-26 — brightness % is appended to each light’s graph name; the readout has no lamp list or color swatch.
- **Superseded in part:** 2026-08-26 — today’s now indicator is one overlay through the sun and light plots (same span as the hover cursor), not a segment in each SVG.
- **Superseded in part:** 2026-08-29 — idle readout always shows wall-clock now + sun elevation on the selected preview date (never “Hover a graph…”); an open solar-event sidebar still pins the readout to that event.
- **Decision:** Sun and light graphs have no static vertical grid or event drop-lines. Today still draws the “now” line. Hovering any plot shows a second full-height cursor. Time and sun elevation update in a readout **above** the plots — not a tooltip that follows the pointer. Each light name on its graph shows the brightness at the cursor (or at now when not hovering).
- **Why:** Hour/event verticals competed with the now line. A follow-cursor tooltip covers the curves you are reading. Putting % on the name keeps the value next to the curve it belongs to.
- **Do not reverse without user ask.**

## Per-light brightness curves and date preview

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-27 — still one full-width row per light with the name on the plot, but Y is not brightness (see “Light brightness darkens the band”).
- **Superseded in part:** 2026-08-29 — a light missing from some assigned scenes is an “Add to …” button, not a static warning. Click writes a session draft for each missing native scene. The initial state is the typical on-state of the other lights already in that scene (median brightness; median kelvin, else circular-mean HS / median RGB), adapted to the lamp’s color modes. No peers → same circadian seeds as creating a native scene. Until added, preview still treats the gap as off.
- **Superseded in part:** 2026-08-29 — with an area selected, lights in that area that are in none of the assigned scenes appear as compact suggested rows (`Add to scenes`). Lights that are in the scenes but not in the area keep their graphs and use the warning color on the name. No area → no suggestions and no out-of-area mark. Preview `area` uses `lights_in_area` (entity area, else device).
- **Superseded in part:** 2026-08-29 — a toolbar toggle can wrap the same light samples into concentric 24-hour rings. See “Light graphs: stacked bands or a 24-hour clock”.
- **Superseded in part:** 2026-08-29 — an unassigned solar event is an off-knot in the preview: every lamp is off there (graphs go dark), not skipped so neighbors interpolate across it.
- **Decision:** Under the sun chart on create/edit, list each light as a full-width brightness polyline (one SVG path + x-gradient from sample colors), not a strip of `<rect>` bars. The entity name sits on the chart and opens more-info. Graphs stack with no gap. Polar / no-rise events use the same seasonal fallbacks as scene activation. An entity present in one scene but not the next is a warning, not an error (treated as off during that transition).
- **Why:** A single line matches the sun chart and stays readable. Skipping unassigned events hid that a scene was still needed; treating them as off makes the gap obvious.
- **Do not reverse without user ask.**

## Day transition percent is linear across the five scenes

- **Date:** 2026-08-26
- **Decision:** Replace `transition_modifier` (−100…100 clock shift toward noon/dawn/dusk) with `transition_percent` (0–100 along the day). Knots are equal 25% steps: dawn 0, sunrise 25, noon 50, sunset 75, dusk 100. Manual service values use that mapping directly (intra-segment blend is linear in percent, not in clock time). Auto follows the clock within each pair, then maps onto the same 0–100 scale. After dusk until the next dawn the attribute stays 100 (dusk is the last scene of the day); lights still interpolate dusk→dawn on the clock. A second attribute `transition_percent_manual` is true only when the last `scene_extrapolation.turn_on` included `transition_percent`. Omitting the field (or using native `scene.turn_on`) returns to auto.
- **Why:** A relative time shift was not a readable “where in the day” control. Equal percent steps make 50% always noon regardless of season.
- **Do not reverse without user ask.**

## Solar event row is the scene picker

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-26 — area is chosen before create and again on save; dusk minimum lives on the dusk event dialog; only nightlights stay on `ha-form`.
- **Superseded in part:** 2026-09-01 — nightlights `ha-form` sits under the light list in the sun-path body (dial: same 500px max-width as the legend; table: full plot width), not in the separate `.content` column.
- **Superseded:** 2026-09-01 — nightlights boolean/scene handling removed (UI, store fields, activate early-return). Prefer a user script/automation to choose an alternate scene.

## Editor and list titles use HA friendly_name

- **Date:** 2026-09-01
- **Decision:** Extrapolation list rows and the editor app-bar title (plus delete confirm) prefer `hass.states[entity_id].attributes.friendly_name`, falling back to stored `scene_name`. Do not show the raw store name when the entity already has a friendly name.
- **Why:** Rename / registry edits update the entity name; the store copy can lag and looked wrong in the header the same way the list used to.
- **Do not reverse without user ask.**
- **Superseded in part:** 2026-08-26 — event and light editors use the automation-style sidebar, not a centered `ha-dialog`.
- **Superseded in part:** 2026-08-26 — picker / dusk / link changes apply to the graphs immediately. Close keeps them; there is no Done. YAML is still only written on Save of the extrapolation scene.
- **Superseded in part:** 2026-08-26 — linked dawn/sunrise/sunset is only described in the event sidebar; the row does not outline linked events. Unassigned events use a warning treatment. Buttons cap width and space evenly.
- **Superseded in part:** 2026-08-29 — the event sidebar can create, rename, delete, and clear the native scene. See “Create native scenes from the event picker”.
- **Superseded in part:** 2026-08-29 — the open sidebar’s solar event is highlighted (`aria-current`); clicking that same event again closes the drawer. Still do not outline the linked dawn/sunrise/sunset group.
- **Decision:** Dawn / sunrise / noon / sunset / dusk above the chart are the scene inputs. Clicking one opens a dialog with a native scene picker. Dawn, sunrise, and sunset can share one scene via “Same scene for dawn, sunrise, and sunset”. Scene entity pickers and the combine boolean are not on `ha-form`.
- **Why:** The chart already lists those events. Duplicate pickers below the graph were the same decision twice. Linking lives on the event you are assigning, not a separate toggle.
- **Do not reverse without user ask.**

## Edit a light at a solar event; write the native scene

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-26 — the editor is an automation-style sidebar, not a centered modal.
- **Superseded in part:** 2026-08-26 — drafts update the graphs immediately; YAML is still written only on Save.
- **Superseded in part:** 2026-08-30 — wheel path / runtime / preview use the same rule: same color kind → channel lerp; different kinds → RGB-lerp endpoints (no 50% mode flip). Still no straight chord across the wheel for same-kind HS paths; hue is not wrapped.
- **Superseded in part:** 2026-09-01 — chromatic HS/RGB pairs use hue+sat rim lerp (see “Smooth cross-mode color blends”); temp / rgbw / rgbww still RGB-lerp across kinds.
- **Superseded in part:** 2026-08-29 — native create/rename/delete, light-edit changes, and removing a lamp from the graphs are session drafts. The extrapolation Save writes YAML. Undo/redo matches the automation editor (`UndoRedoController`: shallow full-session snapshots, 75 steps, commit before each discrete change, Ctrl/Cmd+Z / Shift+Z / Y). An X on each light row removes that lamp from every assigned native scene.
- **Superseded in part:** 2026-08-29 — creating a native scene writes `scenes.yaml` immediately so Home Assistant can resolve the entity in the picker. Rename / delete stay session drafts. See “Create native scenes from the event picker”.
- **Superseded in part:** 2026-08-29 — session drafts also persist in `localStorage` (per HA user + scene, including `#new`). Leaving the editor no longer discards them. Reloading that scene restores the draft and shows a banner; Discard returns to the last saved server copy. A draft whose stored baseline no longer matches the server is dropped, not applied (existing scenes only; `#new` restore rules in “Buffer unsaved edits in local storage”). Light-edit sidebar edits join the session immediately (no nested Save). See “Buffer unsaved edits in local storage”.
- **Superseded in part:** 2026-08-27 — pencils are small shadowed 5px dots on a 40px hit. Hover grows one circle (the action layer) from that center; do not scale the 5px disc (it stacked on `ha-icon-button` and drifted). The next row’s faded incoming edge does not capture pointers, or the first hover only hits the uncovered half of the 40px box. Click the opaque band (`.light-bar-hit`, below the feather) to edit the closest assigned scene; more-info is on the sidebar, not the name. The SVG is not a hit target (`pointer-events: none`) so the band click reaches the hit layer — not the first row through pass-through.
- **Superseded in part:** 2026-08-30 — the light-edit sidebar information button opens more-info **settings** (`view: "settings"`), not the default entity info view.
- **Superseded in part:** 2026-08-27 — the sidebar lists each unique native scene once (compact solar-event-style chips), not one row per solar event. Subtitle names the YAML scene. The save hint (info icon) sits in the footer so it stays put while the wheel scrolls. Close / back / hash change does not discard light edits (they are already session drafts). Opening the sidebar does not overlay the charts until the user edits.
- **Superseded in part:** 2026-08-27 — color and temperature use a Huemane-style wheel (teardrop pin = selected scene, dots = the others; click a dot to focus it). A polyline samples the same RGB / HS / kelvin lerp as runtime, in solar-event order including dusk→dawn. Do not draw a straight chord: RGB lerp bows through lower saturation. Hue is not wrapped (same as `extrapolate_hs`). Preset swatches stay on one row and scroll sideways; a right-edge fade shows when more colors sit off-screen. Switching unique scenes does not prompt. Edits write every touched native scene for that lamp into the editor session as you go; the extrapolation Save writes YAML.
- **Superseded in part:** 2026-09-01 — wheel path drawing is cosmetic denser sampling of the same lerp (default 72 steps; near-constant-sat HS uses ~2.5° chords; sat-varying HS under/mid strokes use Catmull-Rom cubics). Smoothness ≠ a different blend space; cross-mode still RGB-lerps (bows toward white). Hue still not wrapped.
- **Superseded in part:** 2026-09-01 — chromatic HS/RGB pairs (incl. mixed) lerp hue+sat on the rim; wheel chrome sits 16px below the disk (flex gap, not overlapping absolute). Temp↔color and rgbw/rgbww still RGB-lerp. Hue still not wrapped.
- **Superseded in part:** 2026-08-29 — above the wheel, a brightness graph shows one point per assigned solar event (X = event time, Y = brightness). Titled “Brightness” with “0–100% by solar event” subtext; plot is full-bleed (no side axis labels). Dragging a member point updates draft brightness; pointerup/cancel on `window` ends the drag even outside the SVG. Events where this lamp is not yet in the scene show a `+` at brightness 0; clicking `+` adds the lamp. Clicking a member point focuses that scene like a wheel dot.
- **Superseded in part:** 2026-08-30 — brightness graph keeps a fixed 120px height and fills the sidebar width by resizing the SVG viewBox (circles stay round; no `preserveAspectRatio: none` stretch). Scene chips list unique scenes by name only (no “Dawn · Sunrise · Sunset” join); same-scene graph points still move in tandem via the shared draft. Membership resolves from the assigned scene id with an event-row fallback. Footer copy says “light”, not “lamp”. Unavailable (orphaned) native scene entities are treated as unassigned so the dial/light sidebar do not show empty membership for a friendly name that is no longer loadable; overlay drafts can still materialize a stub scene when adding a light. The light-edit sidebar has no separate On/Brightness fields — brightness is edited only via the graph (and color via the wheel).
- **Superseded in part:** 2026-09-01 — brightness-graph event labels keep handle dots on true time; colliding names stagger onto a second row (then nudge horizontally) so dawn/sunrise and sunset/dusk stay readable in a narrow sidebar.
- **Superseded in part:** 2026-08-29 — Live edit is a header toggle (editor session), not a per-sidebar switch. While a light sidebar is open it applies/restores that lamp; closing the drawer still restores the open-time snapshot.
- **Decision:** Each light timeline has a pencil per solar event. The dialog edits that lamp’s **stored** state in the native YAML scene for that event, not the live entity. Sidebar edits commit to the editor session (preview overlay) as they happen; the extrapolation Save writes `scenes.yaml` once. Optional **Live edit** (header) applies the current scene’s draft to the lamp only while the dialog is open; closing restores the lamp to the snapshot taken on open.
- **Why:** Tuning a circadian scene by watching the interpolated chart is faster than opening five HA scene editors. A nested Save fought the global Save mental model. Live edit is opt-in so walking around the house is not required. Restoring on close avoids leaving the room stuck in a draft. Dawn/sunrise/sunset often share one YAML scene, so listing solar events twice was the same target twice.
- **Do not reverse without user ask.**

## Scene editors use the automation sidebar / bottom sheet

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-26 — desktop open/close is a 200ms transform-only slide (`cubic-bezier(0.2, 0, 0, 1)`). Do not transition `.page` max-width — that reflows the graphs every frame.
- **Superseded in part:** 2026-08-27 — opening the drawer pads `.page-shell` by the gutter (sidebar width + 16px, matching the drawer’s right inset — no extra gap) and moves the Save button with `--scene-sidebar-gutter`, same 200ms curve as the slide. The 1024px column recenters in the remaining space. Do not animate `max-width`. A second editor reuses the open drawer and fades body/footer; it does not close and re-slide. Draft + location-override banners share `.page-banners` with one `margin-inline: 12px` so dial view (zero page padding) stays inset without doubling against a gutter gap.
- **Decision:** Pencil (light at a solar event) and solar-event scene assignment open an automation-style editor: a right-hand outlined `ha-card` with `ha-dialog-header` on wide viewports (375px, 2px `--primary-color` border), and `ha-bottom-sheet` when `narrow` or `(max-width: 870px), (max-height: 500px)`. Reduced-motion uses 1ms. Do not use `ha-automation-sidebar` / `ha-automation-sidebar-card` / `ha-resizable-bottom-sheet` — those stay unregistered until the automation editor chunk loads. Save / Rename / area / delete stay centered `ha-dialog`s.
- **Why:** The chart should stay visible while tuning a lamp or assigning a scene, the same split as Settings → Automations. Custom panels cannot import the automation-only elements.
- **Do not reverse without user ask.**

## Page column is 1024px (table) / 1920px (dial)

- **Date:** 2026-08-26
- **Superseded:** 2026-08-27 — restore `--page-max-width: 1024px`. Matching `manual-automation-editor` (1540px) made the charts full-bleed on a typical laptop and put the overlay drawer on top of the graphs.
- **Superseded in part:** 2026-08-27 — the open drawer pads the editor shell so the 1024px column sits in the remaining space. Width stays 1024px when it still fits.
- **Superseded:** 2026-08-29 — widen to `--page-max-width: 1920px` so the dial can stay centered while the year timeline pins to the absolute right edge.
- **Superseded in part:** 2026-08-29 — dial view uses 1920px (`.page.dial-wide`); list and table view stay at 1024px.
- **Decision:** `.page` defaults to a centered 1024px column with 12px inline padding. Dial (clock) view adds `.dial-wide` for 1920px so the year timeline can pin to the absolute right without shifting the dial. Do not use `--ha-automation-editor-width`, and do not grow max-width when the drawer opens.
- **Why:** Stacked light bands stay readable at 1024px; the dial needs a wider canvas for a right-edge scrub without offsetting the face.
- **Do not reverse without user ask.**

## Legacy per-room entries migrate; this is not a breaking reconfigure

- **Date:** 2026-08-26
- **Decision:** Treat the sidebar/store move as a **minor** (2.2.x), not a major. On setup, each old config entry is imported into `scene_extrapolation.scenes` using its `unique_id`, extra entries are removed, and scene entities keep that unique id. Users do not re-pick rooms or native scenes. The options flow is gone; editing happens in the sidebar. Mark 🚨 / major only if unique ids, service fields, or stored keys become incompatible without a migrator.
- **Why:** The configuration home moved; the data did not. A major would force a fake reconfigure on the only production user and on anyone who upgrades through HACS.
- **Do not reverse without user ask.**

## Native HA date field for the preview day

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-29 — visible control is a day/month label above the year scrub (calendar icon affordance); click calls `ha-date-input._openDialog()` on the mounted `ha-selector` `{ date: {} }` (kept opacity-0 / non-interactive). Today / 21 Jun / 21 Dec chips sit on the same row as the date in table view (date first), and to the left of the date in dial view (stacked above the date in the landscape rail).
- **Decision:** The preview day control is HA’s `ha-selector` `{ date: {} }` (`ha-date-input` → `ha-dialog-date-picker`), presented as a day/month label. Do not use Activity’s `ha-date-range-picker` (that is a start–end range) or a raw `<input type="date">`.
- **Why:** Logbook’s widget is a range. The single-day native widget is `ha-date-input`. `ha-selector` already knows how to lazy-load that chunk from HA’s bundle; our `panel.js` cannot `import()` those files.
- **Do not reverse without user ask.**

## Year scrubber under the preview date

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-29 — on landscape devices in clock view the scrubber is a vertical rail absolutely positioned to the right of the clock face (30px gap; does not shift the centered face); collapsing the rail animates width with the sidebar dock; portrait and stacked/table view keep the horizontal strip under the date row; landscape + open scene sidebar collapses the scrubber.
- **Superseded in part:** 2026-08-29 — landscape clock rail pins to the absolute right of the stage (not beside the face); day/month label sits above the scrub in that rail (and above the horizontal scrub in portrait/table).
- **Superseded in part:** 2026-09-01 — portrait dial toolbar is in-flow (time/sun + date chips in a wrapping `.sun-toolbar-chrome`, year scrub below) so the timeline pushes the dial down instead of covering ticks; horizon glow still bleeds behind via full-host `_layoutClockHorizonBack`. Landscape rail only when `min-width: 900px` (narrow/square landscape kept the empty left gutter as a black bar).
- **Superseded in part:** 2026-08-29 — landscape dial uses a 3-column grid: matching left gutter + dial + timeline so the timeline takes layout width (dial shrinks) while the dial stays optically centered; event buttons/labels sit in a fixed-px chrome band around an inset dial core so they stay readable as the dial scales. The landscape rail pads its bottom when the Save FAB would cover the scrub track.
- **Superseded in part:** 2026-08-30 — landscape dial rail: date chips use `width: 100%` + `justify-content: flex-end` (nowrap) so the right edge stays in the rail and overflow grows left into the dial; do not use `width: max-content` + `margin-left: auto` (that left-aligns when chips are wider than the rail and spills off-screen). Day/month is 26px with no calendar icon.
- **Superseded in part:** 2026-08-30 — dial year scrub no longer waits on a per-day HA `preview` mid-drag. While dragging in dial view, the panel builds that day’s sun geometry in the browser (SunCalc + seasonal fallbacks, dusk minimum applied), resamples light rings from existing `event_states`, and patches the dial in place. On pointer-up, one authoritative `DOMAIN/preview` (executor) reconciles Astral times and exact samples. Scene activation stays on HA `solar.py` only — client math is scrub UX, not runtime. Table view still debounces preview while dragging.
- **Superseded in part:** 2026-09-01 — portrait dial toolbar is in-flow (time/sun + date chips share a wrapping `.sun-toolbar-chrome`; year scrub below) so the timeline pushes the dial down instead of covering ticks; horizon glow still bleeds behind via full-host `_layoutClockHorizonBack`. Landscape rail requires `min-width: 900px` so narrow/square landscape does not leave an empty left gutter as a black bar. Chrome readout uses higher-specificity static positioning (absolute dial readout was overlapping chips); reset sits in a fixed 32px slot. Mobile `overflow-x: clip` stays on page/dial-wide only — not stage/body/clock — so horizon-back cannot inflate scroll height below the light list; page pad under the list is 156px.
- **Decision:** Show a custom year timeline (month labels + draggable thumb) for the year of the selected preview day, with the selected day/month above it. Pointer drag/click maps to calendar days; keyboard arrows / Home / End work on the slider. Do not use `<input type="range">` — it cannot host month ticks. Keep the toolbar/scrub block as a stable sibling of the chart body so `replaceChildren` on preview redraw cannot drop pointer capture or focus. While dragging in dial view, update the thumb, day/month label, and dial from client sun math (no mid-drag websocket); on release, fetch HA preview once. Cache recent full payloads by chart key for idle redraws.
- **Why:** Jumping between solstices with chips is coarse; the calendar picker is precise but slow for seasonal comparison. A year strip is the missing middle. Re-inserting the scrubber on every preview cancelled the drag. A matching left gutter keeps the dial centered without overlaying the timeline on the face. Per-day HA preview mid-drag serialized updates to ~one frame per RTT; client geometry keeps the dial continuous through the year.
- **Do not reverse without user ask.**

## Preview location override is session-only and quiet until used

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-27 — the location dialog has a search field (Photon geocoder) above HA’s map picker. The map still commits lat/lng; search only jumps the pin.
- **Superseded in part:** 2026-08-29 — idle map-marker control lives in the app-bar action items (with the dial/table toggle), not on the date row.
- **Decision:** Create/edit can override the coordinates used for the sun path and light graphs. Idle state is a map-marker icon in the editor header. Once a place other than Home Assistant’s configured lat/lng is applied, a warning-styled banner shows the coordinates, with Change and reset. The override is panel session state (not stored on the scene). Clock, “today”, and the now line stay on Home Assistant’s timezone — same as `scene_extrapolation.turn_on`’s location field. Use HA’s `{ location: { radius: false } }` selector, not a custom map.
- **Why:** Polar / far-south sun times are the reason to preview another date; another latitude is the matching test. A always-visible map would crowd the date tools. Radius is unused for solar events. HA’s location selector has no search box of its own.
- **Do not reverse without user ask.**

## Opaque light-graph fills

- **Date:** 2026-08-26
- **Superseded:** 2026-08-27 — no area-under-curve; brightness darkens a full-height color band.
- **Decision:** The area under each light brightness polyline is fully opaque (`fill-opacity: 1`). Keep the stroke on top of the fill.
- **Why:** Semi-transparent fills made the curves look washed out against the card background.
- **Do not reverse without user ask.**

## Light-graph color wash is independent of brightness

- **Date:** 2026-08-26
- **Superseded:** 2026-08-27 — brightness *is* the darkening of the color band.
- **Decision:** Each light row paints the same horizontal color gradient as a full-height rect at `fill-opacity: 0.5`, then the brightness-shaped area at `fill-opacity: 1`. Y-axis stays brightness. The stroke stays on top.
- **Why:** A dim or off stretch still has a color. Clipping color to the brightness fill hid warm/cool shifts when the curve sat near the baseline.
- **Do not reverse without user ask.**

## Light brightness darkens the band; rows feather

- **Date:** 2026-08-27
- **Superseded in part:** 2026-08-27 — hovering the stack shortens the incoming-edge fade to 1px, but the opaque start stays at 36px. Tightening the fade from the top of the 108px bar revealed the overlap and made rows look taller. Last row keeps the full 108px bar so its visible band matches the others. Names, dots, and warnings sit on the visible band, not the faded overlap. Edit dots use `scale` on the 5px circle (parent hit box is centered with negative margin, not `translate(-50%, -50%)`).
- **Superseded in part:** 2026-08-29 — hover brightens the band; the open light-edit lamp gets a primary glow. Clicks use an opaque-only hit layer so lower bands no longer fall through to the first row.
- **Superseded in part:** 2026-08-29 — `--light-feather` / `--clock-feather` / `--ring-expand` / `--ring-border-w` are registered with `CSS.registerProperty` on the document (shadow `@property` does not enable transitions). `--ring-expand` / `--ring-border-w` use `inherits: true` so the hover/selected `::after` rim mask and the fill child see the same values (non-inherited registration left the rim at 0 width). Transition feather on `.sun-lights` / `.sun-light-clock-rings`; expand/border on each `.clock-ring`. Ring fill uses a masked child so hover/selected `::after` rim borders are not clipped by the fill mask; selected rings keep the sharp feather (`:has(.selected)`), not only hover.
- **Superseded in part:** 2026-08-30 — dial ring hover/selected use a stronger black `drop-shadow` (blur 28px / 12px, 2× prior) and a white `::after` rim at 6% opacity (no scale grow); rim width is a fixed `1px` (`--ring-rim-w`) painted just inside the band edges so the outermost ring is not clipped at 100%. Soft ↔ sharp feather/expand snaps with no transition (animating the ramp looked like a size morph). Sibling rings dim to 50% over a surface-colored disc (`--primary-background-color`) so they don’t mix with horizon/bloom (dim selector is `:not(.hovered):not(.selected)` so the active band stays fully opaque — a blanket `.clock-ring { opacity: 0.5 }` outranked the active `opacity: 1`). Only one band is highlighted at a time: while `.hovered` is set on another ring, `.selected:not(.hovered)` yields the rim/shadow and dims like siblings until the pointer leaves the planet. Switching the open light sets `_sidebarLightId` (ring `.selected`) **before** awaiting the sidebar pane swap so clearing hover cannot re-light the previous band. Clicking outside the rings (and outside legend/event/sidebar chrome) closes the light sidebar and clears selection. Soft mode keeps `--clock-feather` plus `--ring-soft-expand` (~1.35× feather) so opaque cores overlap and the surface never shows through seams; sharp mode (hover/selected host) zeros both so bands sit edge-to-edge. Hovering a ring shows its friendly name in a pill flush above the outer light ring (anchored to the rings inset in the core). Clicking the already-selected ring closes the light sidebar and clears selection. Touch/pen on the rings uses pointer capture + `touch-action: none` (and non-passive `touchmove` preventDefault) so scrubbing bands does not scroll the page.
- **Superseded in part:** 2026-08-30 — dial ring hover/selected use `scale(1.05)`, a black `drop-shadow`, and dim sibling rings to 50% opacity (no primary `::after` rim).
- **Superseded in part:** 2026-08-30 — dial ring hover/selected use a small radial grow (~0.45%) and the same sharp primary `::after` rim; no `drop-shadow` glow on the selected band.
- **Decision:** Each light is a full-height horizontal color band. Sample RGB is multiplied by brightness/100 (off is black). Middle and last rows are 108px; the first is 72px (no incoming overlap). Rows overlap by 36px. Only the incoming top is masked; the row underneath stays opaque so the dark card cannot show through the seam. First top stays opaque. No `filter: blur()`, no brightness polyline. Hover % on the name stays.
- **Why:** A Y-axis sparkline plus a separate color wash made stacked lamps read as separate charts. Darkening keeps hue and level on one surface. Fading both edges left two ~50% layers over the card, so blend zones went dark.
- **Do not reverse without user ask.**

## Panel FAB matches hass-subpage, not ha-fab

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-30 — editor Save FAB appears only while the session is dirty; fades/scales with `.is-hidden` (not UA `[hidden]` display:none) so show/hide matches HA fab motion. New scenes open the save dialog; existing scenes save immediately. Name / area / metadata edits go through overflow → Rename/settings.
- **Superseded in part:** 2026-08-30 — Save FAB is always shown on `#new` (create is unsaved until the first successful save, even when the post-wizard form matches the session baseline). Existing scenes still show Save only while dirty.
- **Decision:** List and editor use a corner overlay (`position: absolute` sibling of `ha-top-app-bar-fixed`, same offsets as hass-subpage `#fab`) with `ha-button size="l" variant="brand" appearance="accent"`. List label is “New extrapolation scene”; editor Save shows only when dirty. Do not use `ha-fab` — it is not registered in this frontend.
- **Why:** Automations create with that button in the `#fab` slot. `ha-top-app-bar-fixed` has no fab slot, so the overlay has to sit beside the app bar. Hiding a clean Save matches HA’s dirty-only create/save pattern.
- **Do not reverse without user ask.**

## Save/rename dialog; area stays on the form

- **Date:** 2026-08-26
- **Superseded:** 2026-08-26 — area is required in a dialog before create, then shown again on Save/Rename.
- **Superseded in part:** 2026-08-30 — first Save on a new scene opens the dialog (name/area/metadata); later Saves write immediately. Rename/settings still open the dialog from the overflow menu.
- **Decision:** Save (first create) and Rename open a `ha-dialog` patterned on `ha-dialog-automation-save`: required name, area, optional description / category / labels via assist chips. Name is not a form field. Persist description in the store; sync labels and the `scene` category through the entity registry.
- **Why:** HA scene/automation save prompts for identity metadata at create/rename time. Repeat Save should not re-ask. `ha-dialog-scene-save` is not loaded in a custom panel.
- **Do not reverse without user ask.**

## Prompt for area before a new scene; area also on Save

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-30 — area is still collected on first Save / Rename; subsequent Saves skip the dialog.
- **Superseded in part:** 2026-08-30 — create dialog is a wizard: area + Automatic / Manual cards; Manual adds a second step with solar-event scene pickers (linked dawn/sunrise/sunset on by default; empty slots = Automatic). Areas with no lights are rejected with an error. See “Create wizard sets up native scenes”.
- **Decision:** **New extrapolation scene** opens an area dialog first. Continue navigates to `#new` with that area already set (refresh of `#new` with no area prompts again; cancel returns to the list). First Save and Rename show the area selector, prefilled. Area is not on `ha-form`. Native scene pickers still filter by the working area.
- **Why:** Area is the room identity and the filter for native scenes. Asking once up front avoids an empty editor; Rename keeps a path to change it later without interrupting every Save.
- **Do not reverse without user ask.**

## Create wizard sets up native scenes

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — auto-created native scene names are `{area} {Event}` (Dawn, Sunrise, Noon, Sunset, Dusk). The combined dawn/sunrise/sunset slot is `{area} Dawn-Sunset` (not Bright / Dimmed / Low lights).
- **Decision:** New-scene wizard offers **Set up automatically** (one native scene per solar event) or **Use my existing scenes** (manual picks). Copy mirrors the old config-flow step descriptions (native scenes only; empty slot = create automatically). Manual step uses `ha-selector` entity pickers (not custom `<select>`), with field helpers from the old `data_description`s. Manual pre-fills from area native scenes by average light brightness: brightest → noon, second → linked day, lowest → dusk. Creates name `{area} {Event}`; combined day slot `{area} Dawn-Sunset` (sunset light profile). Batch create via `apply_area_setup` (one YAML reload).
- **Why:** Most rooms need a sensible first draft; power users want to wire existing HA scenes without leaving the flow. Event-named scenes match the dial; Bright/Dimmed/Low described brightness, not which solar event they belonged to.
- **Do not reverse without user ask.**

## Earliest dusk time lives on the dusk event dialog

- **Date:** 2026-08-26
- **Superseded in part:** 2026-08-29 — earliest dusk only delays a same-day solar dusk; if solar dusk is already past midnight of that calendar day, keep end-of-day (24:00) and do not pull back to the floor (shared `dusk_start_seconds` in preview and activation).
- **Decision:** `scene_dusk_minimum_time_of_day` is edited in the dusk solar-event dialog, next to that event’s scene picker. It is not on `ha-form`.
- **Why:** The override only applies to dusk. Putting it on the main form made it look like a global setting.
- **Do not reverse without user ask.**

## Create native scenes from the event picker

- **Date:** 2026-08-29
- **Superseded in part:** 2026-08-29 — create writes YAML and reloads immediately. A draft id (`scene.__se_draft_*`) is not a Home Assistant entity, so `ha-selector` errors. Rename / delete stay in the editor session until the extrapolation Save.
- **Superseded in part:** 2026-08-30 — clear uses the entity picker’s built-in clear (`ha-selector` `required: false`); an information button beside the picker opens that scene’s more-info **settings** view.
- **Superseded in part:** 2026-09-01 — auto-created names are `{area} {Event}`; combined dawn/sunrise/sunset is `{area} Dawn-Sunset` (still uses the sunset “Dimmed” light profile).
- **Decision:** The solar-event sidebar can create a native YAML scene for the working area, rename or delete the selected one, and clear the assignment via the native entity picker’s clear control (optional `ha-selector`). An `mdi:information-outline` button beside the picker opens `hass-more-info` with `view: "settings"` for the selected scene. Create is disabled without an area. Create walks every enabled light in that area (entity area, else device area) and writes on + brightness + color for the event: `color_temp_kelvin` when the lamp supports color temp (or rgbww / `min_color_temp_kelvin`), otherwise HS from the same kelvin. Linked dawn / sunrise / sunset uses the sunset light profile and the name “{area} Dawn-Sunset”. Other creates use “{area} {Event}”. Profiles: dawn 40%/2700K, sunrise 75%/3500K, noon 100%/4500K, sunset 70%/3000K, dusk 25%/2200K. Create writes `scenes.yaml`, reloads, and sets the new scene’s area before the picker binds. Rename / delete stay in the editor session (preview overlay); the extrapolation Save writes those later.
- **Why:** Building the native scenes in Home Assistant is the tedious part. The event you are assigning is the place to create the matching room scene. The native scene picker can only show entities Home Assistant already knows. Reusing the picker’s clear avoids a duplicate X control.
- **Do not reverse without user ask.**

## Editor undo/redo matches the automation editor

- **Date:** 2026-08-29
- **Superseded in part:** 2026-08-29 — leaving with a dirty session writes `localStorage` and does not prompt. See “Buffer unsaved edits in local storage”.
- **Decision:** Create/edit keeps an in-memory undo stack of full session snapshots (`form` + native drafts), limit 75, same as HA’s `UndoRedoController`. Commit the previous snapshot immediately before each discrete change (scene pick, create/rename/delete native, first light-edit in a sidebar open, remove-light, form fields). No debounce. Toolbar `mdi:undo` / `mdi:redo` on wide layouts; overflow items when `narrow`. Shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y. Skip when the focused node is an input / textarea / select / contenteditable. Undo closes the sidebar. Creating a native scene writes YAML immediately (undo only unassigns it). Other native drafts and the store write on the extrapolation Save.
- **Why:** Users already know this from Settings → Automations. Buffering rename / delete / light edits until Save is what makes those undoable. Create cannot stay a draft because the native picker needs a real entity.
- **Do not reverse without user ask.**

## Buffer unsaved edits in local storage

- **Date:** 2026-08-29
- **Superseded in part:** 2026-08-30 — leaving the editor with an unsaved new scene or a dirty existing session prompts Keep editing / Discard (same dialog as draft discard). Discard clears the local draft; Keep cancels navigation. `localStorage` buffering remains for refresh / remount.
- **Superseded in part:** 2026-09-01 — `#new` restore must not compare the stored baseline to the post-refresh empty form (there is no server entity). Reapply `session` and reinstall `baseline` from the buffer so Discard / dirty match the pre-refresh session; only drop when session ≡ baseline. Existing scenes still drop when the stored baseline no longer matches the loaded server form.
- **Decision:** Persist the dirty session (`form` + native drafts, plus the server baseline) in `localStorage` under `scene_extrapolation.draft.v1.<user>.<sceneId|new>`. Write on a short debounce and on hide/leave. Loading that scene reapplies the draft and shows a top-of-page banner; Discard restores the baseline and deletes the key. An X on the banner hides it for this visit only (in-memory; comes back after a full refresh / remount). Save and delete clear it. If the stored baseline no longer matches the server form, drop the draft (do not overlay it). Do not persist undo/redo stacks. Light-edit sidebar edits are session native drafts (same store), not a nested buffer. Isolate by `hass.user.id`.
- **Why:** Refresh, a closed tab, or going back to the list was dropping work that had not reached YAML yet. The banner makes the restore obvious and gives a way back to the saved scene. A stale baseline means someone already saved a newer copy.
- **Do not reverse without user ask.**

## Editor overflow menu for rename and delete

- **Date:** 2026-08-26
- **Superseded:** 2026-08-26 — reuse the native scene editor overflow on create and edit.
- **Decision:** Existing scenes get `ha-dropdown` in `slot="actionItems"` (dots trigger, `wa-select`, Rename + danger Delete). New unsaved scenes have no overflow. Inline Save/Delete buttons on the form are gone.
- **Why:** Same header overflow pattern as the automation editor. Delete is destructive, so it stays off the FAB.
- **Do not reverse without user ask.**

## Light graphs: stacked bands or a 24-hour clock

- **Date:** 2026-08-29
- **Superseded in part:** 2026-08-29 — the light-edit sidebar includes a horizontal brightness graph above the color wheel: one point per assigned solar event (Y = brightness, fill = that lamp’s color along the day). Non-members show `+` (click to add); members drag. Linked dawn/sunrise/sunset share a draft, so those points stay synced. See “Edit a light at a solar event; write the native scene”.
- **Superseded in part:** 2026-08-29 — clock glow is sky-from-elevation (not outer-ring conic); sun marker is a CSS disc+flare (not `mdi:weather-sunny`); hover scrubs sun position, sky glow, and the time/elevation readout while light rings stay the full-day preview.
- **Superseded in part:** 2026-08-29 — no dashed horizon circle on the clock; the outer ring edge remains the geometric horizon for the sun path.
- **Superseded in part:** 2026-08-29 — sun path strokes are 0.5px day / 0.25px night with `vector-effect: non-scaling-stroke` (viewBox units were scaling thicker than CSS px); hour labels sit outside the ticks at 8px.
- **Superseded in part:** 2026-08-29 — no now-hand or hover ray on the clock (the sun is the time indicator); hover intro eases the sun to the pointer (~320ms) then tracks live.
- **Superseded in part:** 2026-08-29 — sun hover motion lerps time-of-day along the elevation arc (exponential chase); no CSS left/top tween.
- **Superseded in part:** 2026-08-29 — with a solar event selected, hover/touch still updates the readout but does not move the sun (it stays on that event).
- **Superseded in part:** 2026-08-29 — sun marker follows the drawn path (no horizon pull); scale stays 2× for all elev<0 and at 0°, then eases to 1× as daytime elevation rises; sun-path stroke is min below the horizon, max at the horizon, tapering to min at daytime peak; daytime tint from `skyLookFromElevation` (night strokes stay neutral); round dashed stroke (`8 7`) at 50% opacity painted as continuous path runs; hour ticks sit just outside the planet rim; no area-fill under the linear sun curve; clock enter plays once per editor visit (reset when returning to the list; date/scene redraws skip it); adding a missing light commits undo before writing the draft.
- **Superseded in part:** 2026-08-29 — sun marker uses its own radial track, inset toward the core vs the dashed stroke (night goes deeper under the planet); below the horizon the disc keeps the horizon palette (glow still follows night).
- **Superseded in part:** 2026-08-29 — clock solar-event markers get a 0.5px dashed spoke to the horizon and upright name · time + scene labels immediately above the icon (screen-space, not radial); sunrise/sunset labels sit below the icon so they do not collide with dawn/dusk.
- **Superseded in part:** 2026-08-29 — view toggle is a single app-bar button labeled `Table view` / `Dial view` (destination); location pin shares the header.
- **Superseded in part:** 2026-08-30 — on narrow, location preview and Table/Dial view move into the overflow menu (with undo/redo); Live edit stays in the app bar. Wide layouts keep the header buttons.
- **Superseded in part:** 2026-08-29 — dial orientation: midnight at the bottom, noon at the top (`_clockAngleDeg` +180°; light rings `conic-gradient(from 180deg)`).
- **Superseded in part:** 2026-08-29 — horizon polish on the planet dial: elev=0 path sits **outside** the light rings (planet no longer occludes the sun); “below horizon” is the sunrise→sunset day wedge (SVG fill clip + dark-blue night disc); glow ramp along that sundown→sunrise shadow; face ~`min(100%, 100vh)` full-width; events at the container edge; **drag** the sun to scrub with sticky preview (no face hover scrub).
- **Superseded in part:** 2026-08-29 — horizon glow + solar-event shadow (wedges/rays/spokes) paint in a back layer that bleeds past the face (not clipped to the planet); night sun disc is **black**; sun is ~⅓ prior size with a center→tip hour handle gapping through it; dial hour labels 10px / 14px (≥871px); 15-minute ticks (2px majors at 6h, 1px otherwise); canvas allows touch pan — only sun/handle use `touch-action: none`.
- **Superseded in part:** 2026-08-30 — hour labels are HTML (fixed 10/14px, not SVG text); tick strokes stay CSS-px via `vector-effect: non-scaling-stroke`; labels every 2h; ticks every 7.5 minutes (still 2px only at 6h).
- **Superseded in part:** 2026-08-30 — sun rides the drawn path radius (no inset marker track); scale is 2× from sunset→sunrise then eases to 1× at zenith (grows again toward sunset); sunset→sunrise night wedges are darker.
- **Superseded in part:** 2026-08-30 — dial horizon backgrounds size to the full panel (under an open sidebar); in-flow dial still uses the sidebar gutter. Sticky scrub draws a gold rim arc from wall-clock now to the override with an inward gold glow.
- **Superseded in part:** 2026-09-01 — horizon reach is remeasured through the sidebar gutter padding transition (ResizeObserver only sees face size, not the left shift), so bloom/sky keep filling the panel under the open drawer.
- **Superseded in part:** 2026-08-30 — dial scrub is magnetic around solar events (animate-in snap, rubber-band pull-away, animate release to the cursor); click the sun or the readout restore button to clear sticky and return to now; night path floor stays outside the light-ring planet at max sun scale.
- **Superseded in part:** 2026-08-30 — sun is a solid white disc (black below horizon) with glow + large blur shadow under the handle; path is fixed-width solid by day and brighter dashed by night; solar-event dots sit on the path with spokes to them; night path keeps its elevation shape and is shifted outward so path and sun clear the planet.
- **Superseded in part:** 2026-08-30 — path uses smooth elev→radius (no night offset-blend warp) so the oval stays clean; 1px non-scaling stroke; sun fill is day-wedge clipped again (HTML outline + glow); 3px plain event dots; chrome ~56px so event buttons sit outside a smaller core; magnet rubber-band only resists (same direction) then eases to the cursor; wider horizon ramp plus a farther sky-color wash.
- **Superseded in part:** 2026-08-30 — sun path is a perfect circle midway between the light-ring planet and the dial-core edge; sticky override arc is white with a short, low-opacity white–gold inward ramp; sun fill + glow are solid white / day-wedge clipped (outline only below horizon); sky behind the dial uses `--card-background-color` instead of an elevation wash.
- **Superseded in part:** 2026-08-30 — circular path radius scales with the day's peak vs annual max (summer larger, winter smaller), clamped with padding between planet and face; snap windows at 60% of prior; ticks/labels white @ 60%; dial center hole filled; override stroke 1px with a slightly stronger gold wash.
- **Superseded in part:** 2026-08-30 — day sun stays pure white (HTML shadow only below horizon so it does not cover the SVG fill); path max radius 90% of the padded face limit; face ~86vh; chrome ~78px with event buttons slightly past the face edge.
- **Superseded in part:** 2026-08-30 — sticky scrub persists across date/location changes; event chrome scales down on small faces (buttons stay inside the face; spokes retarget to buttons); sky wash is an elevation radial again; ticks at every labeled hour with quieter opacity; SVG shadow under a day-clipped glow+fill group (glow 3.3× radius).
- **Superseded in part:** 2026-08-30 — programmatic sun moves (event pin / reset) ease along the path; dragging while an event sidebar is open keeps the drawer open until pointer-up.
- **Superseded in part:** 2026-08-30 — sky wash uses outer sky blues (not white mid/pathColor); sun shadow softened and kept inside a stronger warm glow halo.
- **Superseded in part:** 2026-08-30 — sun arc easing is quintic ease-out; sky palette follows Solar-face mockups (periwinkle day, muted peach horizon — no hot pink).
- **Superseded in part:** 2026-08-30 — dial scrub snaps only on pointer-up (no mid-drag magnet / rubber-band); capture window +30%; snap eases 1s with the same quintic ease-out as event pin; draft banner + portrait date tools stack above horizon bleed; dial sky glow restored to master spread (scale 1.35 / blur 81px / opacity ≤0.55); hourly ticks with master divider/secondary strokes; hour labels inside the marks at 16px / 32px (≥871px).
- **Superseded in part:** 2026-08-30 — sunset→sunrise night wedges use near-black shades with a slight blue tint (not deep navy).
- **Superseded in part:** 2026-08-30 — hour labels outside the ticks (white @ ~40%); hourly ticks 3px / 4px major (white @ ~28% / ~50%), slightly shorter; light-ring glow sits on the face (master blur/scale) with uncapped elevation opacity.
- **Superseded in part:** 2026-08-30 — dial chrome order (outer → inner): hour tick tips on the face edge with numbers just inside the tips (same tick lengths as before), then solar-event buttons, then the inset dial core (path/planet). Chrome inset grows if needed so event buttons stay outside the core.
- **Superseded in part:** 2026-08-30 — hour numbers clear the inward tick stroke (past major length + ~half glyph); solar-event buttons sit at sun-path radius + 10 core-viewBox units (fixed gap as the path scales); sticky override arc/glow maps to the outer tip of the face hour ticks (not a fixed core r=94); chrome inset is driven by ticks/labels only.
- **Superseded in part:** 2026-08-30 — desktop dial chrome is a fixed px inset (no lerp toward a min as the face shrinks); mobile (≤870px) keeps tick-only chrome with events on the sun path.
- **Superseded in part:** 2026-08-30 — dial light list layout is its own decision (under the face; never shrink `--dial-face-max`; left gutter stays empty).
- **Superseded in part:** 2026-08-30 — light-ring glow is core-sized (scale 1.75 / blur 96px / screen blend, opacity ≥0.85); no sky wash; no solid sunrise/sunset rays; dashed sun path only on night arcs; horizon rim band ~2.5h; event path dots 6px; snap capture +25% (~19.5 min).
- **Superseded in part:** 2026-08-30 — light-ring glow has no blur and no screen blend (hard disc, opacity ≥0.85) so the elevation tint is visible behind the rings.
- **Superseded in part:** 2026-08-30 — programmatic sun moves (event pin / reset / release snap) use doubled ease durations (760ms default, 840ms reset, 2s snap).
- **Superseded in part:** 2026-08-30 — light-ring glow is an annular halo sized to the rings (transparent center, bright rim, scale 1.45, no blur): a filled disc under opaque rings was invisible once blur was removed. Event label placement is positional collision handling (top above; bottom below; left/right topmost above, rest below), not hardcoded sunrise/sunset.
- **Superseded in part:** 2026-08-30 — light-ring glow is two staged dial clones (scales 2.76 + 1.38, each `blur(28px)`, opacity 0.815) in a face-level layer above the horizon wash; `translateZ(0)` compositor layers on bloom / rings / horizon / overlays so scrub does not re-rasterize static filters; planet shadow is `box-shadow` (not `filter: drop-shadow`); sun keeps the soft CSS-blur halo (`blur(2.5px)`) and shadow (`blur(6px)`), with halo stop opacities 20% less transparent than the prior ramp. Day sector (sunrise→sunset) fills with Apple Solar–style sky blue (`skyColor` from elevation); rim glow stays peach near the horizon and sky-blue by day. Landscape timeline rail is 104px with 16px stage right pad so the day/month label cannot widen the page. Interactive rings still stack above the hour handle. Clicking a dial legend light opens the same light-edit sidebar as a ring (closest assigned solar event to the scrubbed/now time). Event spokes match the night sun-path dash (`#d8e0ff`, `5 4`, 1px) at 50% opacity; night path is also 50%.
- **Superseded in part:** 2026-08-30 — sun halo/shadow softness is SVG radial gradients only (no CSS `filter: blur` on the moving discs). Blurring cx/cy-updated SVG circles left compositor trails (“thousand coronas”) while scrubbing and cleared on pointer-up.
- **Superseded in part:** 2026-08-30 — horizon rim peach↔sky and day-wedge alpha blend continuously with elevation (no binary nearHorizon / elev&lt;0 cuts that snapped the glow mid-scrub).
- **Superseded in part:** 2026-08-30 — year-scrub `_patchLightClock` repaints path/marks with `includeSun: false` so it does not replace `_clockSunEl` with a detached node (that skipped `_layoutClockEventSpokes` and dropped the dusk clamp dashed link mid-scrub).
- **Superseded in part:** 2026-09-01 — dial chrome uses a L/T/R surface vignette (`--primary-background-color` at ≤50% opacity) instead of a black top ramp; hour ticks/labels use primary-text color with a surface halo (not white-on-black); sunset→sunrise / dusk→dawn night wedges are light gray / mid gray (not near-black). Light theme: bloom clones at half opacity (0.4075); horizon rim uses `multiply` + warmer peach (dark keeps `screen`); sun path + event dots are black (dark keeps the prior light strokes).
- **Superseded in part:** 2026-09-01 — night wedges are theme-split (warm gray in light via CSS vars; near-black again in dark). Horizon rim / day wedge use an elevation aura: after sunset peach → pink → purple → dark blue → night; light daytime is crispy sky blue (`#4FB3FF`) with a dark night rim (not gray). Empty dial `.content` is `:empty { display: none }`; FAB clearance moves to `.page.dial-wide` padding-bottom 152px. Unavailable lights use grayscale + disabled text.
- **Superseded in part:** 2026-09-01 — L/T/R surface vignette uses longer multi-stop fades (~260/360px) for a softer blur. Horizon rim stretches ~5h with a multi-color spectrum that ends at `--primary-background-color` (normal blend); light-mode dusk stays soft (no near-black rim).
- **Superseded in part:** 2026-09-01 — dial vignette `::before` extends `right: calc(-1 * var(--scene-sidebar-gutter))` so it paints under the docked light sidebar like `.clock-horizon-back` (avoids a hard cut at the drawer). Scrub skips `_updateHorizonGlow` rebuilds when quantized elev (~0.25°) + sunrise/sunset/max elev are unchanged.
- **Superseded in part:** 2026-09-01 — vignette also extends `top: calc(-1 * var(--dial-banner-h))` (path top → host top) so draft/location banners do not leave a seam above the dial; face budget subtracts the below-header banner reach.
- **Superseded in part:** 2026-09-01 — horizon spectrum RGB stops lerp continuously by elevation (same stop count at every keyframe) so scrub never swaps palettes; dark keeps peach/pink/purple/blue with a slight gold Rayleigh core through civil twilight; light stays soft. At/after civil dusk (−6°, product “last light”) the rim is dark blue only — no pink/purple afterglow.
- **Decision:** On create/edit, a header toggle switches the light table between the stacked bands and concentric 24-hour rings. Midnight is at the bottom; hours are equal; noon is at the top. One ring per lamp (outer = first table row); rings fill to the center (no hole). The clock face is `min(100%, 86vh)` square on a full-width dial page; solar-event icons sit in a face-size-scaled chrome band (smaller chrome on narrow faces so the graphic stays large) and stay inside the face edge. Soft radial seams blend neighboring rings; hovering the rings — or having a selected ring — animates `--clock-feather` down to sharpen them. An elevation **halo** around the light rings (rings-sized disc, transparent center, bright rim, scale 1.45, no blur) sits on the face behind the core so color peeks past the opaque bands; a tight conic horizon ramp (~5h band) paints **behind** the planet spanning the **full panel width** (sidebar overlaps; the dial still shifts left via the gutter) — multi-stop peach→pink→purple→blue dissolving into the surface color; no separate sky-color wash and no solid sunrise/sunset border rays. UI chrome (draft banner, portrait date/scrub) stacks above that bleed. Night wedges: warm gray in light theme, near-black in dark (`--clock-night-outer` / `--clock-night-deep`). Day sector fill is crispy sky blue in light. Time wraps the rim on a **perfect circle** whose radius scales with today's peak elevation vs the location's annual max (summer outer at 90% of the padded face limit, winter inner), clamped with padding so path and sun clear the planet and the dial-core edge (day solid arcs / night dashed arcs only — no full-circle dashed underlay; 1px non-scaling). Hourly ticks and labels use `--primary-text-color` (muted) with a `--primary-background-color` halo so they stay readable in light and dark themes. Event button labels use positional collision placement: top of dial → above the button; bottom → below; left/right → topmost above, others below. The sun is an outlined disc with a soft SVG shadow under a day-wedge-clipped warm white glow + solid white fill (shadow stays inside the glow so the halo reads); below the horizon fill/glow are clipped away while the shadow remains; the hour handle paints above. Size is largest (2×) at sunrise/sunset and fixed through the night; it shrinks toward 1× at zenith and grows again toward sunset. Drag the sun (or handle) to scrub freely; on release, if within ~19.5 min of a solar event, ease to that event over 2s (quintic ease-out) — otherwise keep the release time. After release the time is sticky until reset (click the sun / restore control), an event is selected, or the user leaves the editor — date and location changes keep the sticky override. Opening/changing a solar-event pin eases the sun along the path with a strong ease-out (~760ms; no jump). Dragging while that sidebar is open leaves the drawer open until pointer-up, then closes it. While sticky, a 1px white stroke on the outer tick radius runs from wall-clock now to the scrubbed time with a short white–gold wash toward the center. Selecting a solar event pins the sun to that event. Idle without sticky/event is wall-clock now on the preview date. The linear sun chart is hidden in dial view. Solar-event icons open the event sidebar; dashed spokes run from each path dot (6px) to its button. Suggested lights stay in the legend. Remember the view in `localStorage` per HA user (`scene_extrapolation.lightView.v1.<user>`).
- **Why:** A ring makes the dusk→dawn wrap obvious. Equal clock hours match how people read “now”; solar events still land at their real times. Seasonal circle size shows how high the sun climbs without wobbling the path; elev still drives size and day/night clip. Snap-on-release keeps dragging predictable; a wider soft vignette keeps chrome readable over horizon bleed without a hard cut. Light-theme gray night wedges read as shadow without a muddy disc; dark theme keeps near-black so night is not washed out. A stretched multi-color rim that ends at the surface reads more like a real sunset than a single tint faded to transparent. Without blur, a filled glow under opaque rings vanishes — the halo must live outside the planet rim. Light-band bloom sits above the isolated horizon wash so dial colors read over the rim, not under it. Two staged per-clone blurs keep lg/md blooms distinct; compositor promotion + planet `box-shadow` still isolate static dial work from scrub. A 26px day/month in an 88px rail overflowed the stage and created a horizontal scrollbar — pad and size the rail instead of clipping the page.
- **Do not reverse without user ask.**

## Smooth cross-mode color blends

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — chromatic HS↔RGB / RGB↔RGB blends lerp on the hue wheel (keep saturation; no wrap) so red↔blue stays on the rim; wheel path matches runtime. Temp↔color and rgbw/rgbww still convert to RGB and channel-lerp (bow toward white / keep white channels). Prefer `hs_color` over `rgb_color` when both are present on a draft/entity.
- **Decision:** When from/to light color modes differ, interpolate by converting each endpoint to RGB and lerping (preview dial/bands, live apply via `rgb_color`, and the sidebar wheel path). Same-mode pairs still use kelvin / HS / channel lerp. Do not flip the active extrapolator at 50% progress.
- **Why:** The old halfway mode switch snapped white↔color (and wheel polylines) whenever day scenes were color_temp and evening scenes were HS/RGB. RGB-channel lerp of saturated complements also drew a path through white, which contradicted “through the color wheel” for chromatic pairs.
- **Do not reverse without user ask.**

## Preview lists area lights before native scenes are assigned

- **Date:** 2026-08-30
- **Decision:** `build_preview` / `_light_series` returns **suggested** area lights when no solar events have native scenes yet (new extrapolation scene). Do not early-return `[], []` solely because nothing is assigned — that left dial view as an empty page (clock build bailed on zero lights).
- **Why:** Create flow picks an area first; users need the dial/legend and “create scene” affordances before any native scene exists.
- **Do not reverse without user ask.**

## Dial light list stays under the face

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — `--dial-face-max` now reserves ~32px so the first light-list row peeks under the face (discoverability). List still flows under the face; do not move it into the landscape left gutter.
- **Superseded in part:** 2026-09-01 — draft/location `.page-banners` reduce `--dial-face-max` by their measured reach so the list still peeks above the fold; dial vignette `top` extends by `--dial-banner-h` (path→host) so it matches `.clock-horizon-back` under the banners.
- **Decision:** The dial light list always flows **under** the clock face (portrait and landscape), same width as the face. Do **not** move the list into the landscape left grid column; that column is only a matching gutter so the timeline rail can take width while the dial stays optically centered. Ring hover name sits flush above the outer light ring (`top` = rings inset inside the core), not above `--clock-chrome` / face chrome. Legend actions order: Add to …, then remove (X), then chevron.
- **Why:** Parking the list in the left gutter left-aligned/truncated names and broke parity with portrait. Under-face flow matches mobile. A small peek of the first row is enough to hint scroll without returning to the “shrink the dial for the whole legend” approach.
- **Do not reverse without user ask.**

## Dial defaults to clock; scrub uses event knots + Helland kelvin

- **Date:** 2026-09-01
- **Superseded in part:** 2026-09-01 — scrub knots include a midnight sample so dusk→dawn wraps overnight; date picker / chips walk intermediate calendar days on the dial (then Astral refine), and event lerp tracks solar_seconds so earliest-dusk ghosts do not jump.
- **Decision:** New users get dial (`clock`) view; an explicit `table` in localStorage is still honored. Mid-scrub ring paints use the five solar-event knots plus a midnight wrap stop (CSS conic-gradient ramps between them) and a coarse sun curve; pointer-up / settled preview restores full Astral resolution. Client `color_temp` display RGB uses Tanner Helland (`kelvinToRgb`, matching Python); HA picker `hueTempToRgb` stays for the temp wheel chrome only. Dial face max height fills below the header minus overhead and ~32px list peek; aspect-ratio stays 1.
- **Why:** Table-as-default hid the product’s primary visualization. Scrub used a different kelvin→RGB curve (white at 4200K / cool blue) than the settled preview, and dense 5-minute resampling every drag frame was heavier than needed when the ring only needs event stops mid-scrub. Knots without midnight left 0%→dawn as flat dawn. Crossfading two endpoint days skipped the year and made dusk clamp appear to teleport.
- **Do not reverse without user ask.**

## Editor overflow matches the native scene page

- **Date:** 2026-08-26
- **Decision:** Create and edit both show the native scene overflow (`ha-dropdown` + dots). Items: Activate, Information, Settings, Assign/Edit category, Rename, Duplicate, Delete. Actions that need a saved entity are disabled on `#new`. Skip Edit YAML — this panel has no YAML mode. Category opens our Save dialog with the category field visible so the store and registry stay in sync. Delete uses an `ha-dialog` with the native confirm strings, not `window.confirm`.
- **Why:** Users already know that menu from Settings → Scenes. A shorter custom menu hid Apply / info / duplicate.
- **Do not reverse without user ask.**

## List sun path uses the lightweight solar API

- **Date:** 2026-08-30
- **Decision:** The list page chart calls `scene_extrapolation/sun_path` (solar events + elevation only). The editor keeps `scene_extrapolation/preview` (lights + overlays). Leaving the editor clears dial preview state; the 30s redraw only paints when `_sunPathKey === _chartKey()` so a late preview cannot unhide a dial on the list.
- **Why:** Full preview is slow and raced with navigation, so the list chart felt intermittent or stuck.
- **Do not reverse without user ask.**

## List tabs: Extrapolation scenes vs Created scenes

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — Created scenes table groups rows by area (headers + name sort within group; area omitted from the row subtitle when grouped).
- **Decision:** The list has two tabs — **Extrapolation scenes** (default) and **Created scenes** (native HA scenes this integration created, tracked in store `managed_native_scene_ids`). Created-scene rows open that entity’s settings more-info; delete uses the existing confirm dialog. Only scenes registered at create time appear (no historical backfill of every YAML scene that looks related).
- **Why:** Mixing extrapolation configs with native scenes in one list was confusing; users still need a place to manage scenes the wizard/setup created. Grouping by area matches how HA lists devices once a home has several rooms.
- **Do not reverse without user ask.**

## Global setting: hide created scenes in HA UI

- **Date:** 2026-08-30
- **Decision:** Panel list settings sidebar exposes `hide_managed_native_scenes` (default **on** since 3.0 / Store v2+). When on, managed native scenes get `hidden_by=INTEGRATION` in the entity registry (and new creates honor it). Toggle off clears integration hides. Never override `hidden_by=USER`. Storage version bumps use a Store `migrate_func` (v3 maps preference/interval renames).
- **Why:** HA has no per-integration “hide my entities” config entry option that covers dynamically created YAML scenes; registry `hidden_by` is the supported UI hide. Default on keeps knot scenes out of the main HA scene list.
- **Do not reverse without user ask.**

## Panel copy uses HA backend translations (en/nb/nn/de/es)

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — nb/nn/de/es are a single pass in the `dev` → `master` release PR, not kept in lockstep on every feature commit. `en.json` stays current during development. Key trees must still match on `master` (`check_translations.py` on PRs to `master`).
- **Decision:** User-visible panel strings live under `translations/<lang>.json` → `frontend.*` (plus existing `config.*`). The panel loads them with `hass.loadBackendTranslation("frontend"|"config", DOMAIN)` and resolves via `_t("frontend…", englishFallback)`. English is the source of truth while working on `dev`; the other four languages are filled before a release PR. See `.cursor/skills/panel-translations/SKILL.md` and `.cursor/skills/prepare-release-pr/SKILL.md`.
- **Why:** Custom integrations cannot use Lokalise/`strings.json`; shipping full language files matches HA’s custom-integration i18n path and the user’s language set. Translating on every UI tweak duplicated work; one pass against the English diff is cheaper and still ships complete trees.
- **Do not reverse without user ask.**

## List tabs use ha-tab-group

- **Date:** 2026-08-30
- **Decision:** Scene list tabs are native `ha-tab-group` / `ha-tab-group-tab` (`tabOnly`, `wa-tab-show`), not custom buttons.
- **Why:** Matches HA chrome (automation traces, etc.) and stays consistent when the design system moves.
- **Do not reverse without user ask.**

## Table/list sun path: solid day stroke, horizon ramp, dial event buttons

- **Date:** 2026-08-30
- **Decision:** Linear sun chart (list + table view): daytime path is a single solid `primary-text-color` stroke; night stays dashed with a stronger muted text mix for readability over the horizon wash. Horizon is a top border plus a peach ramp fading downward. Solar events are dial-style `clock-event` buttons on the curve (interactive in the editor; `inert` on the list). Dial clock path styling is unchanged.
- **Why:** Colored/variable dashed day strokes and tiny dots read poorly; dial buttons unify event affordances across views.
- **Do not reverse without user ask.**

## List view does not re-render on every hass assignment

- **Date:** 2026-09-01
- **Decision:** The panel `hass` setter updates child `.hass` refs and loads translations once. It does not call `_renderList` on later hass ticks. Rebuild the list from `_loadList` / tab changes / explicit actions.
- **Why:** HA assigns `hass` on every state update. Rebuilding the list tore down the FAB (visible flicker) and closed the settings sidebar via `_closeSceneSidebar()`.
- **Do not reverse without user ask.**

## Unavailable lights stay in the list, not on the dial

- **Date:** 2026-09-01
- **Decision:** Clock rings omit unavailable (or missing) lights. The legend and table list still show them, sorted last, marked unavailable. Live `hass.states` is the source of truth.
- **Why:** An unavailable lamp cannot preview on the wheel; hiding it from the list would make membership edits impossible.
- **Do not reverse without user ask.**

## RGBWW/RGBW wheel uses chromatic pin, mixed band

- **Date:** 2026-09-01
- **Decision:** For rgbww/rgbw drafts, the color-wheel pin sits at hue/sat of the RGB channels (normalized, like HA more-info). Marker fill and light bands use the white-mixed display RGB (`rgbww_to_rgb` / `rgbw_to_rgb`). Picking a wheel color updates RGB channels and keeps whites. Color-brightness and white-brightness graphs edit those channels (0–255) beside overall brightness.
- **Why:** Using the raw RGB slice for the pin and band ignored white mix and color brightness, so the dial did not match HA’s entity picker.
- **Do not reverse without user ask.**

## Date and sun moves use 1.5s cubic ease-out

- **Date:** 2026-09-01
- **Decision:** Preview date changes morph sun path + light rings over 1.5s with cubic ease-out (`1-(1-u)³`). Solar-event sun moves use the same duration and curve. After year-scrub release, morph client rings to the HA preview (~0.8s) instead of swapping DOM/gradients in one frame. Quintic ease-out raced to the end then crawled; cubic decelerates across more of the span.
- **Superseded in part:** 2026-09-01 — scrub-release refine densifies 5-event knot samples onto a 5-minute grid before morphing to Astral (avoids CSS-conic→dense flash at the midnight wrap). Mid-morph skips bloom-clone gradient updates and horizon-rim rebuilds (in-place wedge `d` only); full bloom + rim paint once at the end — stacked translucent layers were doubling chroma under the dial during the transition.
- **Why:** Instant date jumps and the coarse→Astral ring swap read as flicker. A longer ease-out is the requested motion. Knot CSS ramps ≠ dense sample conics; destroying/recreating night wedges every frame flashed the bottom of the dial; updating two 0.815-opacity bloom clones every frame made mid-morph colors look stronger until settle.
- **Do not reverse without user ask.**

## Sandbox scenes.yaml is runtime, not source

- **Date:** 2026-09-01
- **Decision:** Gitignore `dev/config/scenes.yaml`. Do not commit the live file or a starter example — native scenes are sandbox-local and do not translate to other setups. First-time setup creates an empty list (`[]`) if the file is missing. Do not bind-mount a second scenes file into the container — `dev/config` is already `/config`.
- **Why:** The scene editor and this integration write HA’s native YAML back to `/config/scenes.yaml`. Tracking that file made every sandbox tweak a dirty tree and clobbered local scenes on branch switch.
- **Do not reverse without user ask.**

## CI lint uses current Home Assistant Requires-Python

- **Date:** 2026-08-30
- **Superseded in part:** 2026-09-01 — with Python 3.14, CI installs current HA, so `StaticPathConfig` stays a normal top-level import (lazy import tripped pylint `import-outside-toplevel`). Workflows use current `actions/checkout` / `actions/setup-python` majors.
- **Decision:** GitHub Actions lint/tests use Python **3.14** and install the latest PyPI `homeassistant`.
- **Why:** Unpinned `pip install homeassistant` on 3.11 resolves to ~2024.3, which lacks `StaticPathConfig` / `LockState` and breaks pytest collection via `panel.py`. Current HA requires Python ≥3.14.2; matching that keeps lint and unit tests on the same API surface as the sandbox.
- **Do not reverse without user ask.**

## Work on `dev`; a PR to `master` is a release

- **Date:** 2026-09-01
- **Decision:** Day-to-day work (and feature-branch PRs) target `dev`. Opening a PR to `master` is how a version ships: the prepare-release-pr skill syncs translations and Unreleased, then merge runs `.github/workflows/release.yml` (version bump, changelog move, GitHub release, merge back to `dev`). Do not bump `manifest.json` or move Unreleased in that PR. Do not maintain nb/nn/de/es or Unreleased during feature work on `dev`. `release:skip` (or empty Unreleased) lands on `master` without publishing.
- **Why:** Cutting the release in the agent duplicated (and fought) the GitHub workflows. Translating and changelog-editing on every change set was slower than one pass against the `master` diff. `master` stays the HACS/GitHub default so visitors see released code.
- **Do not reverse without user ask.**

## Continuous follow-up is built into the integration

- **Date:** 2026-09-01
- **Superseded in part:** 2026-09-01 — non-user `off` / `unavailable` during continuous is an *interrupt* (leave dark); when the lamp comes back, re-apply that light’s circadian target once. Available off-path jumps and HA-UI (`user_id`) changes stay overrides.
- **Superseded in part:** 2026-09-01 — public contract renamed from `continuous` / brief `follow_up` to `automatically_update_lights`, `automatically_update_lights_active`, and `automatically_update_lights_interval` (Store migrate v3). UI copy says “automatic light updates.”
- **Superseded in part:** 2026-09-01 — per-scene list play/stop removed. Master on/off is a setup-mode-style card at the top of the extrapolation list (hidden when empty) that sets `automatically_update_lights_interval` to 0 or restores the last interval; Settings still edits the minutes. Empty extrapolation list uses an HA Automations-style empty state (icon, title, body, Learn more → GitHub). Per-scene store flag is ignored (always enabled when interval &gt; 0).
- **Superseded in part:** 2026-09-01 — the list-top control includes a right-aligned `ha-switch` matching on/off (`.setup-mode-card.list-aul-card { flex-direction: row }` must follow `.setup-mode-card`’s column rule). Scene rows use a single bordered “table” surface (header + dividers) styled like HA’s config lists. Created scenes are grouped by area with sticky-style group headers. Do **not** embed `ha-data-table` / `hass-tabs-subpage-data-table` — those stay in lazy HA frontend chunks with Lit column templates and are unreliable from this custom panel (same class of problem as automation sidebar elements).
- **Decision:** After activation, circadian scenes re-apply on a global interval (`automatically_update_lights_interval`, default 300s; 0 = master off). The same value is the light transition on those ticks; targets use `now + transition` (existing offset math). First activation keeps the caller’s transition (usually 0); wait one interval, then auto-update ticks. Stop when another scene in the area is last-activated or when modifiers are set. Skip manually overridden lights; treat drift/unresponsive within tolerance (or still moving toward the command) as retryable. Do not stop merely because all lights are off (dawn). Do not ship this as a blueprint — blueprints cannot skip lamps inside apply or keep commanded vs reported state.
- **Why:** The user’s continuously-activate blueprint was a roundabout loop and blocked override/drift features. Built-in automatic updates match the product and keep override state on the scene entity. Power-cut restore must reclaim the lamp; a reading-light dim must not. “Update lights” names what changes; “update scene” would sound like editing the scene definition.
- **Do not reverse without user ask.**

## Prefer readable public keys for automatic light updates

- **Date:** 2026-09-01
- **Decision:** Use long store/entity/WS names `automatically_update_lights` (+ `_active`, `_interval`) rather than short jargon (`continuous`, `follow_up`). Length is acceptable when it removes ambiguity.
- **Why:** Users inspect attributes and settings; clarity beats HA-style brevity here.
- **Do not reverse without user ask.**

