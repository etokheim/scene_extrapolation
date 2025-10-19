# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚨 Breaking changes

Breaking changes are marked with an emergency light emoji: 🚨

### Summary: Improved UX and minimize the time to setup!

This release's focus is on improving the UX and minimize the time it takes to set up the integration - but there are also lots of other goodies!

### Added

- 🚨 Add noon scene option
- Add support for extrapolating effects!

### Changed

- 🚨 Removed night rising and night setting options
- 🚨 Renamed sun setting and sun rising to sunset and sunrise
- New default scene name: Extrapolation scene -> Automatic Lighting
- Updated integration name: Scene Extrapolation -> Scene Extrapolation (Circadian Rythm)
- Make the nightlights boolean and nightlights scene optional
- Mark required and optional fields
- Move nightlights configuration into its own config step to make the config less overwhelming

### Fixed

- Changes to `Earliest time for triggering the dusk scene` wasn't saved
- Updated issue and documentation URLs
- Stopped using the soon to be deprecated `color_temp` argument in `turn_on` service

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
