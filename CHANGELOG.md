# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- Portrait dial date/scrub overlay the dial graphics instead of sitting above them
- Dial legend overlays the face so it is not clipped by dial overflow
- Keep the sun outline moving with path radius during year timeline scrub
- Dial view clips horizon/bloom flush under the app bar (no top margin gap)
- Keep dusk clamp dashed link (and solar ghost) updating during year timeline scrub
- Sun halo uses SVG gradients only (no CSS blur) so scrub no longer leaves corona trails

### Added
- Dial glow is dual blurred clones of the light rings (stacked above the horizon wash, behind the planet) so bloom matches dial colors; Save FAB shows only while dirty (dialog on first create, immediate save after); landscape date chips stay right-packed and grow left into the dial; event spokes and clamp arcs match the night sun path at 50% opacity; legend/form stack above the dial bleed
- Dial compositing: staged per-clone bloom blurs, `translateZ(0)` layers, `box-shadow` planet shadow; sun keeps CSS-blur halo/shadow (halo 20% less transparent)
- Landscape dial timeline has right padding and a wider rail so the day/month label no longer widens the page; daytime horizon fills with Apple-like sky blue
- Dial legend lights open the light-edit sidebar on click (same closest-event targeting as ring clicks)
- Dial ring hover/selected: 2× drop-shadow blur, 1px white rim at 6% opacity (no scale grow; soft↔sharp feather snaps with no ramp/size animation); sibling rings at 50% over a surface disc; hover yields selected highlight; click outside deselects
- Dial ring hover shows the light’s friendly name in a pill above the dial; touch/pen can scrub bands (page scroll blocked over the rings)
- Light sidebar ignores unavailable (orphaned) native scene assignments so dawn/sunrise/sunset no longer look populated when the YAML scene is gone
- Light-edit sidebar drops On/Brightness fields (brightness graph + wheel only)
- Dial year scrub computes sun geometry on the client and patches the dial in place; HA preview reconciles on release
- Dial event labels use a soft text shadow; scene name line is primary text at 70% opacity (not secondary gray)
- Year-scrub month labels hug the track; dial top gets a 50% black readability ramp; scrub thumb is 16px
- On mobile (≤870px), dial hides hour numbers, places event buttons on the sun path, overflows ~24px L/R (clipped past `.page.dial-wide`’s visible overflow), and shrinks chrome so the graphic can grow
- On narrow layouts, location preview and Table/Dial view live in the overflow menu (with undo/redo); Live edit stays in the app bar
- Touch/pen ring scrub matches mouse hover (sharp + highlight); releasing on a ring opens it
- Dial chrome: hour ticks + numbers outermost (numbers inside the tick tips, clear of the stroke), solar-event buttons at a fixed gap from the sun path, sticky override arc on the outer tick tips, then the dial core
- When earliest dusk clamps the scene, dial/chart keep true-solar marks and show a ghost button plus dashed link to the clamped control; top event cards strike through solar time and show the override
- Sidebar panel to create and edit all extrapolation scenes from one integration instance
- Sun-path visualization on the create/edit screen (elevation curve + solar events)
- Per-light brightness/color preview on create/edit, with a date picker for winter/polar days
- Save/rename dialog for scene name, description, category, labels, and area
- Header overflow on create/edit matching the native scene editor (activate, info, settings, category, rename, duplicate, delete)
- New extrapolation scene prompts for an area before opening the editor
- Earliest dusk time is set in the dusk event dialog
- Click a solar event above the chart to assign its native scene (optional link for dawn / sunrise / sunset)
- Dots on each light timeline expand to a native icon button on hover; click the row to edit the closest assigned scene
- Light-edit sidebar lists each unique native scene as a compact chip (not one row per solar event)
- Light-edit sidebar uses a Huemane-style hue/temperature wheel: pin for the selected scene, dots for the others, and a sampled line for the extrapolation path between them
- Search in the preview-location dialog jumps the map pin
- Year-long scrubber under the preview date to drag between days
- On landscape dial view the year scrubber is a vertical rail pinned to the absolute right of the stage (portrait/table keep it under the chips); day/month above the scrub opens the date picker; opening a sidebar collapses the rail with a width animation matched to the dock; the rail pads its bottom so the Save FAB does not cover the scrub
- Hover a sun or light graph to inspect time and sun elevation in a fixed readout (cursor line; today’s “now” line stays)
- Preview another latitude/longitude on create/edit (quiet map pin until active, then a banner)
- Create / rename / delete a native scene from the solar-event picker; an X clears the assignment. Create fills the area’s lights with brightness and color for that event
- X on each light row removes that lamp from every assigned native scene
- Undo / redo in the editor toolbar (Ctrl/Cmd+Z, Shift+Z, Y), matching the automation editor
- Unsaved editor changes persist in this browser; returning to the scene restores them with a banner (Discard, plus an X that hides it until refresh)
- A light missing from some scenes is an Add button; it copies the typical brightness and color of the other lights already in that scene
- Suggested rows for area lights that are not in any assigned scene; scene lights outside the selected area use the warning color
- Toggle the light graphs between stacked bands and concentric 24-hour clock rings from a single header button (`Table view` / `Dial view`); location pin is in the header too; midnight at the bottom on the dial (noon at the top), with clickable solar-event icons on the rim
- Clock face fills the editor width up to 80vh, soft ring seams sharpen on hover, and the open light-edit lamp is highlighted
- Clock ring seams overlap more when blurred so gaps stay lit instead of dark
- Soft glow behind the light clock: blurred sky disc from solar elevation (not lamp conics)
- Hovered/selected clock light rings grow slightly with a sharp primary rim (no soft glow; borders paint outside the fill mask)
- Clock view wraps sun elevation around the rim (dashed above and below the horizon; day path at 50% opacity; no dashed horizon circle); the linear sun chart is hidden in that mode
- Clock sun path stroke is minimum below the horizon, maximum at the horizon, and tapers toward noon; daytime tint follows the sky palette; round dashes at 50% opacity on continuous path runs
- Clock hour labels sit outside the tick marks at 8px
- Editor page max-width is 1024px in table view and 1920px in dial view; landscape dial uses a centered grid with an in-flow timeline (matching left gutter) so the dial shrinks without leaving true center; event chips sit in a fixed-px chrome band around the dial core; the sun marker scales with the dial core; sky glow is not clipped; dial view drops horizontal page padding; day/month above the timeline opens the date picker; suggestion chips share the date row in table view (date first) and sit to the left of the date in dial view; dial time/elevation readout is absolute top-left; Live edit, location, and Table/Dial view live in the header
- Clock has no now-hand or hover ray; hover eases the sun along the path arc then tracks it
- Clock sun stays at max scale (2×) below and at the horizon, then shrinks toward 1× as daytime elevation rises; marker follows its own inset track (deeper under the planet at night than the dashed stroke); below the horizon the disc keeps the horizon palette (glow still follows night)
- Clock enter (once per editor visit): face fades 750ms and scales 1.5s; overlay rotates 12° over 1.5s; event buttons + sun sweep finish at 2.25s; list → edit plays it again (date redraws still skip)
- Sun path / clock container is transparent with no card border
- Adding a missing light to a scene is an undoable session edit
- Clock view hides the top solar-event chips (rim icons replace them); each rim icon has a dashed spoke to the horizon plus name · time and scene label (sunrise/sunset labels sit below the icon so they do not overlap dawn/dusk)
- Light-edit sidebar brightness graph above the color wheel (titled, full-bleed, 0–100% in the subtext): drag a solar-event point to change brightness; release works outside the graph; missing-lamp events show `+` to add

### Changed
- Dial view: ~86vh dial with face-scaled chrome and in-bounds event buttons; sun path circle scales with day's peak; solid white day sun with soft SVG shadow+glow+fill sharing the day wedge clip (no hard night shadow toggle); no sky wash; narrower horizon rim glow; sticky scrub persists across date/location; event pin / reset / release snap use longer ease-out; drag with event sidebar open closes on release; snap to solar events only on pointer-up (~19.5 min window); draft banner and portrait date/scrub stack above bleed; light-ring glow is an unblurred annular halo outside the opaque bands; hourly ticks 3px/4px white with labels outside at 16px/32px; event labels placed by dial quadrant to avoid collisions; night wedges near-black with a slight blue tint; dashed path only below horizon; 6px event path dots; landscape rail chips right-aligned above a larger day/month (no calendar icon)
- Event scene picker uses the native entity clear control; an information button opens that scene’s settings. Light-edit information opens the lamp’s settings view
- Light-edit brightness graph fills sidebar width at a fixed 120px height; scene chips show scene names only; footer says “light”
- One config entry for the whole integration; room configs live in a persistent store (legacy per-room entries are migrated)
- Unassigned solar events are off-knots in the light preview (graphs go dark there) instead of being skipped
- Feather sharpen-on-hover animates via document-registered `--light-feather` / `--clock-feather` (shadow `@property` did not transition)
- Stacked light bands brighten on hover and glow when selected; each band’s opaque strip is its own click target
- Light graph view mode is read from localStorage before the first paint so refresh keeps the matching layout
- Panel uses Home Assistant’s `ha-top-app-bar-fixed` (header outside the scroll container)
- Light preview draws one color band per lamp (not a strip of bars); names sit on the chart
- Create/save use a sticky native HA button (New extrapolation scene / Save) instead of inline form actions
- Preview day uses HA’s date selector instead of a raw browser date input
- Light graphs encode brightness by darkening each lamp’s color band; adjacent rows overlap and the incoming edge feathers over an opaque neighbor
- Scene light and event editors use Home Assistant’s automation-style right sidebar (bottom sheet on narrow screens)
- Desktop sidebar open/close is a 200ms slide; the editor column and Save button move aside (padding / right, not max-width); gutter is sidebar width + 16px (drawer right inset only); draft-restore banner uses 12px inline margin
- Opening a second sidebar reuses the open drawer and fades its body instead of closing and re-sliding
- The solar-event row highlights the event whose sidebar is open; clicking that event again closes the drawer
- Leaving the editor keeps session drafts in this browser instead of prompting to discard them
- Light-row hover sharpens the feathered seam with an animated mask; visible band height stays the same
- Light-row names, dots, and warnings sit on the visible band; edit dots stay 5px with a 40px hit and expand from center
- Editor graphs and form use a 1024px column (12px padding) instead of Home Assistant’s 1540px automation-editor canvas
- Light-edit sidebar edits apply to the related native scene in the editor session immediately (no nested Save / Cancel); the extrapolation Save writes YAML
- Light-edit save hint sits in the footer (info icon + text)
- Native scene rename / delete, light-edit changes, and removing a lamp stay in the editor session until the extrapolation Save
- Creating a native scene from the event picker writes it immediately so Home Assistant’s scene selector can resolve it
- Color-wheel presets stay on one row and scroll sideways; a right-edge fade marks leftover swatches
- Solar-event scene buttons look like controls, warn when empty, and no longer outline linked events
- Scene pickers moved onto the solar event row; the form keeps nightlights
- Sun and light graphs no longer draw static vertical hour/event lines
- Sun-path height is scaled to the location’s annual max elevation; the curve is darker below the horizon
- Event scene picks apply immediately; the sidebar has Close (no Done). Light-edit closes without a nested Save; Live edit still restores the lamp
- Light graphs interpolate through unassigned solar events as off (not across the gap)
- Hover brightness % is appended to each light name on its graph; the readout no longer lists lamps or color swatches
- 🚨 `scene_extrapolation.turn_on` replaces `transition_modifier` (−100…100 time shift) with `transition_percent` (0–100 along the day: dawn 0, sunrise 25, noon 50, sunset 75, dusk 100). Scene entities expose `transition_percent` and `transition_percent_manual` instead of `transition_modifier`

### Fixed
- Earliest dusk no longer snaps back to the floor when solar dusk is after midnight; it stays at end of day
- Idle graph readout always shows current clock time and sun elevation on the selected date (not “Hover a graph…”)
- Stacked light band clicks always opened the first lamp (pass-through hit the top row); opaque hit layers fix it
- After refresh, the light view toggle showed clock while the stacked table still rendered
- Clicking a light row did not open the closest scene (SVG painted-hit testing ate the click; 44px dot hitboxes covered the band)
- First hover on a light-edit dot used a smaller hit than later ones (the next row’s overlap sat on the lower half)
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
