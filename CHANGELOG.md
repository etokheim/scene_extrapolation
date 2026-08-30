# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- New-scene Save FAB is always visible; existing scenes still show Save only while dirty (dialog on first create, immediate save after)
- Cross-mode color blends (e.g. color_temp ↔ HS/RGB) lerp in RGB instead of flipping mode at 50%
- Dial/table layout: light list under the face; fixed desktop chrome; portrait date/scrub overlay; landscape rail top inset; horizon/bloom can paint under the desktop sidebar
- Leaving with unsaved work prompts Discard / Keep editing while still buffering drafts for refresh/remount
- CI workflows target `master` (was `main`)

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
- Updated integration name: Scene Extrapolation -> Scene Extrapolation (Circadian Rythm)
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

- First official release of Scene Extrapolation custom component
- No more direct file access of scenes.yaml
- New service! extrapolation_scene.turn_on: activates a extrapolation scene with a basic brightness modifier
- New attribute: brightness_modifier - keeps track of the applied brightness_modifier
- New attribute: integration=scene_extrapolation - makes extrapolation scenes easily identifiable in Home Assistant's templates
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

- Initial implementation of Scene Extrapolation
- Dynamic scenes with lighting is based on sun elevation
- Configuration flow for Home Assistant
- Support for multiple scenes
- HACS compatibility
- Support for transition time
