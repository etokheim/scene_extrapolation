# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Sidebar panel to create and edit all extrapolation scenes from one integration instance
- Sun-path visualization on the create/edit screen (elevation curve + solar events)
- Per-light brightness/color preview on create/edit, with a date picker for winter/polar days
- Save/rename dialog for scene name, description, category, labels, and area
- Header overflow on create/edit matching the native scene editor (activate, info, settings, category, rename, duplicate, delete)
- New extrapolation scene prompts for an area before opening the editor
- Earliest dusk time is set in the dusk event dialog
- Click a solar event above the chart to assign its native scene (optional link for dawn / sunrise / sunset)
- Pencil on each light timeline to edit that lamp in the scene for that event, with optional live preview
- Year-long scrubber under the preview date to drag between days
- Hover a sun or light graph to inspect time and sun elevation in a fixed readout (cursor line; today’s “now” line stays)

### Changed
- One config entry for the whole integration; room configs live in a persistent store (legacy per-room entries are migrated)
- Panel uses Home Assistant’s `ha-top-app-bar-fixed` (header outside the scroll container)
- Light preview draws one brightness line per lamp (not a strip of bars); names sit on the chart and open more-info
- Create/save use a sticky native HA button (New extrapolation scene / Save) instead of inline form actions
- Preview day uses HA’s date selector instead of a raw browser date input
- Light graphs fill the area under the brightness line opaquely, with a 50% opacity color wash behind the whole row
- Scene light and event editors use Home Assistant’s automation-style right sidebar (bottom sheet on narrow screens)
- Desktop sidebar open/close uses the same 300ms ease-out slide as the mobile bottom sheet
- Editor graphs and form are capped at 1024px wide (the sidebar is outside that column)
- Solar-event scene buttons look like controls, warn when empty, and no longer outline linked events
- Scene pickers moved onto the solar event row; the form keeps nightlights
- Sun and light graphs no longer draw static vertical hour/event lines
- Sun-path height is scaled to the location’s annual max elevation; the curve is darker below the horizon
- Sidebar scene and light drafts update the graphs immediately; Cancel restores the last saved preview
- Hover brightness % is appended to each light name on its graph; the readout no longer lists lamps or color swatches

### Fixed
- Transition progress went negative at exact solar event times, which broke winter-date previews
- Dawn had no icon (`mdi:horizon` is not in Home Assistant’s icon set)
- Year scrubber dropped the drag when preview charts re-rendered; it now keeps the toolbar mounted, caches days, and only runs one preview request at a time
- Today’s now indicator is one line through the sun and light graphs instead of a segment per plot

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
