# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [4.0.0] - 2026-09-01

### 🚨 Breaking changes

- 🚨 Renamed the product to **Circadian Scenes** (domain stayed `scene_extrapolation` in 4.0; search either name in HACS)
- 🚨 Continuous “follow-up” preferences are now **Automatically update lights** (store migrates `continuous` / `follow_up` keys for you)
- 🚨 Nightlights mode is gone — use a normal native scene + automation if you still need that pattern

### Summary:

Built-in sun-following updates, dial as the default editor, and a much calmer day/night look — plus a pile of editor fixes so Live edit, drafts, and the light rings behave.

### Added

- ⭐ Built-in **automatic light updates** (on by default): after you activate a circadian scene, lights keep adjusting on an interval with a matching transition — pause per room from the list, or set the global interval to 0
- Auto-setup creates one native scene per solar event, named after the event (`{area} Dawn` …); combined day slot is `{area} Dawn-Sunset`
- Empty list / created-scenes copy for Circadian Scenes, plus RGBWW color/white brightness graphs in the light editor

### Changed

- Dial view is the default for new users (explicit Table choice in localStorage still wins)
- Scene list is a single table with area groups and the auto-update control at the top; friendly names everywhere
- Chromatic color blends (HS/RGB) stay on the **wheel rim** instead of cutting through white; wheel path drawing matches
- Dial chrome: multi-color dusk horizon into the surface, theme-split night wedges, softer vignette, portrait toolbar that pushes the dial instead of covering it
- Create wizard “full automatic” fills all five solar events (not a combined switch)
- Hide-managed native scenes defaults to on for new installs (migrated stores flip with 3.0)

### Fixed

- Live edit no longer sends two Color descriptors to `light.turn_on` (hs + rgb) — HA rejected that exclusion group
- Refresh on `#new` restores the local draft instead of wiping post-wizard work
- Sun/handle drag hits no longer steal clicks from the light rings
- Draft/location banners shrink the dial so the light list still peeks; vignette lines up with the horizon wash under banners
- Panel boot / Store migration / auto-update stop control; dial overnight wrap and date morph; scrub-release refine flash; list flicker and unavailable lights; horizon fill with sidebar open; brightness-graph label collisions; and assorted dial layout/scroll/chrome glitches

## [2.2.0] - 2026-08-30

### Added
- Sidebar panel: add Circadian Scenes once; rooms are created and edited there (legacy per-room config entries import automatically)
- Solar dial view: concentric light rings, year scrub with client-side sun math, landscape timeline rail, soft ring glow, and dial chrome (ticks, event buttons, sticky scrub, enter animation)
- Create-scene wizard: Automatic (Bright/Dimmed/Low lights) or Manual with config-flow-style guidance, native scene pickers (empty = create automatically), brightness-ranked defaults; block areas with no lights
- List page: Extrapolation / Created scenes tabs (`ha-tab-group`), global settings sidebar (hide created scenes in the HA UI), row settings/delete on both lists, New FAB on both tabs
- Panel translations for English, Bokmål, Nynorsk, German, and Spanish (`frontend` + config)
- Table/list sun path chart with a solid day stroke, horizon color ramp, and dial-style event markers (inert on the list)
- Fast list sun chart via the lightweight `sun_path` API (full `preview` stays on the editor)
- Dial light list as HA-style cards with entity state icons; suggested area lights when a new scene has an area but no native scenes yet
- Light-edit sidebar: brightness graph + Huemane-style color wheel (no On/Brightness fields); legend/ring clicks open the same sidebar
- Unsaved editor drafts persist in the browser with a restore banner; leave prompts Discard / Keep editing
- Preview another location; year-long date scrub; Live edit; undo/redo

### Changed
- Configuration home is the sidebar panel; the options flow is gone on purpose
- New-scene Save FAB is always visible; existing scenes still show Save only while dirty (dialog on first create, immediate save after)
- Cross-mode color blends (e.g. color_temp ↔ HS/RGB) lerp in RGB instead of flipping mode at 50%
- Dial/table layout: light list under the face; fixed desktop chrome; portrait date/scrub overlay; landscape rail top inset; horizon/bloom can paint under the desktop sidebar
- Leaving with unsaved work prompts Discard / Keep editing while still buffering drafts for refresh/remount
- CI workflows target `master` (was `main`); lint runs on Python 3.14 so PyPI Home Assistant matches current APIs

### Fixed
- Create save no longer opens the Unsaved changes dialog when navigating to the new scene
- Settings hide toggle refreshes the list without closing the settings sidebar
- List sun path no longer races a full editor preview (slow / intermittent chart)
- Dial polish: ring selection flash, hover name placement, horizon glow peach↔sky blending, scrub corona trails, dusk clamp link during year scrub, sun outline during scrub, and related layout/clipping issues

## [2.1.0] - 2025-12-21


### Added

- Expose scenes the extrapolation scene consumes as attributes

### Changed

- Combine Dawn/sunrise/sunset instead of dawn/dusk and sunrise/sunset (makes more sense in real-life)

### Fixed

- Opening options flow with legacy data causes error that hinders fixing legacy data
- Remove none values from service calls. Eg. effect: none is not supported


## [2.0.0] - 2025-11-04

### 🚨 Breaking changes

Breaking changes are marked with an emergency light emoji: 🚨

### Summary: Improved UX and minimize the time to setup!

This release's focus is on improving the UX and minimize the time it takes to set up the integration - but there are also lots of other goodies!

### Added

- 🚨 Add noon scene option
- ⭐ Modify transition progress - ie. move the transition towards or further away from the noon scene (to increase/decrease the brightness)
- Improved extrapolation speed by running calculations in parallel
- Add support for extrapolating effects!
- Added testing tools in the service. Select:
  - **Time and date** - Test how the lighting would look at a specific time of day - or year (winter/summer)
  - **Location** - Test the lighting as if you are at a different place in the world
- Translations! Proper Norwegian (nynorsk) and Danish-Norwegian translations has been added alongside German
- Added handling for if the sun doesn't rise/set (Polar regions etc)

### Changed

- 🚨 Removed night rising and night setting options
- 🚨 Renamed sun setting and sun rising to sunset and sunrise
- 🚨 Renamed all entity variables, meaning the only user (me), has to reconfigure all the integration entries - wohoo!
- Simplify configuration by optionally combining dawn/dusk and sunrise/sunset scenes
- New default scene name: Extrapolation scene -> Automatic Lighting
- Updated integration name: Circadian Scenes -> Circadian Scenes (Circadian Rythm)
- Make the nightlights boolean and nightlights scene optional
- Mark required and optional fields
- Move nightlights configuration into its own config step to make the config less overwhelming
- No longer store area_id in the configuration. Instead just assign it to the scene entity and fetch it from there (to always keep it up to date).
- Hide scene name and area from the options/edit flow (this should be edited directly on the scene entity)

### Fixed

- Changes to `Earliest time for triggering the dusk scene` wasn't saved
- Updated issue and documentation URLs
- Stopped using the soon to be deprecated `color_temp` argument in `turn_on` service
- Inaccurate extrapolation calculation
- Transitions crossing midnight was wrongly calculated or outright failed

## [1.0.0] - 2025-10-17

### Added

- First official release of Circadian Scenes custom component
- No more direct file access of scenes.yaml
- New service! extrapolation_scene.turn_on: activates a extrapolation scene with a basic brightness modifier
- New attribute: brightness_modifier - keeps track of the applied brightness_modifier
- New attribute: integration=circadian_scenes - makes extrapolation scenes easily identifiable in Home Assistant's templates
- Add support for RGBW
- Add support for RGBWW

### Changed

- Improved two-step config flow for easier setup and changes
- Use fully featured Home Assistant dropdowns during setup (displays eg. the selected scene's icon, assigned area etc)
- Filter scene selectors during setup to only show scenes assigned to the selected area (if an area is selected and has scenes assigned to it)
- Only send one request with all changes to the lights. Faster, but not supported by eg. some older zigbee lights

### Fixed

- Integration is blocking the thread - must use async (minor issue)
- Remove deprecated constants

## [0.0.1] - 2024-01-01

### Added

- Initial implementation of Circadian Scenes
- Dynamic scenes with lighting is based on sun elevation
- Configuration flow for Home Assistant
- Support for multiple scenes
- HACS compatibility
- Support for transition time
