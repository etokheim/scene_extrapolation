# Scene Extrapolation 2.0.0


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

