# Scene Extrapolation 1.0.0


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

