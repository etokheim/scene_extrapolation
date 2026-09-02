import {
  buildClientSunDay,
  resampleLightsForEvents,
} from "./client_solar.js";
import {
  draftRgb,
  draftWheelMode,
  rgb2hsv,
  hueTempToRgb,
  colorBrightnessFromDraft,
  whiteBrightnessFromDraft,
  setColorBrightnessOnDraft,
  setWhiteBrightnessOnDraft,
  createLightBrightnessGraph,
  createSceneColorWheel,
  medianNumber,
  circularMeanHue,
  lightDraftFingerprint,
} from "./color_ui.js";
import {
  isoYear,
  daysInYear,
  dayOfYear,
  isoFromDayOfYear,
  todayIso,
  formatPreviewDayMonth,
  shiftIsoDate,
  diffIsoDays,
  emptyFormData,
  timeToSeconds,
  nowSecondsSinceMidnight,
  formatClock,
} from "./editor_session.js";
import {
  sunStrokePathRuns,
  interpolateElevation,
  skyLookFromElevation,
  darkenedRgb,
  conicGradientFromSamples,
  interpolateLightSample,
  easeOutCubic,
  lerpSunPath,
} from "./dial_clock.js";

const DOMAIN = "scene_extrapolation";
const SECONDS_PER_DAY = 24 * 3600;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 200;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 168;
const PLOT_LEFT = 16;
const PLOT_RIGHT = 984;
const SUN_LINE_DAY = "#ffb74d";
const SUN_LINE_NIGHT = "#5a2e0a";
/* Clock overlay viewBox is 200×200. Planet (rings) sits inside a circular
   sun path whose radius scales with the day's peak elevation. */
const CLOCK_VIEW = 200;
const CLOCK_CX = 100;
const CLOCK_CY = 100;
const CLOCK_RINGS_OUTER = 52;
/* Path stays a perfect circle between planet + pad and face − pad. */
const CLOCK_SUN_PATH_PAD = 3;
const CLOCK_SUN_PATH_WIDTH_PX = 1;
/* Magnetic scrub: snap only on pointer-up if within this window (no mid-drag magnet). */
const CLOCK_SNAP_CAPTURE_SEC = Math.round(12 * 60 * 1.3 * 1.25);
const CLOCK_DRAG_CLICK_PX = 7;
/* Event spokes aim near the face edge; buttons sit in chrome outside the core. */
const CLOCK_EVENT_ICON_R = 92;
/* Fixed px band around the dial for event buttons + labels (do not scale).
   Actual chrome is set per layout from face size (shrinks on small screens). */
const CLOCK_CHROME_PX = 67;
const CLOCK_EVENT_BTN_PX = 32;
const CLOCK_SCRUB_RAIL_PX = 104;
/* Inset the landscape timeline from the panel edge (also stops the large
   day/month label from overflowing the rail and widening the page). */
const CLOCK_SCRUB_RAIL_PAD_PX = 16;
/* Landscape rail needs room for empty left gutter + dial + rail; below this
   width keep the portrait toolbar (avoids empty “black bar” side columns). */
const CLOCK_LANDSCAPE_SCRUB_MIN_WIDTH_PX = 900;
/** Leave this much of the first light-list row visible under the dial face. */
const DIAL_LIST_PEEK_PX = 32;
/* Rings host inset so CSS outer edge matches CLOCK_RINGS_OUTER in viewBox. */
const CLOCK_RINGS_INSET_PCT = 50 - CLOCK_RINGS_OUTER / 2;
/* Wedges/rays cover the square including corners; back layer is slightly
   larger than the face so they land just outside the container. */
const CLOCK_SKY_R = (CLOCK_VIEW / 2) * Math.SQRT2;
/* Night wedges: light theme = warm gray; dark theme = near-black (CSS vars). */
const CLOCK_NIGHT_OUTER_LIGHT = "#e4d8cc";
const CLOCK_NIGHT_DEEP_LIGHT = "#bba89a";
const CLOCK_NIGHT_OUTER_DARK = "#101218";
const CLOCK_NIGHT_DEEP_DARK = "#06070b";
/* Crispy day sky (light mode day wedge / daytime horizon glow). */
const CLOCK_DAY_SKY_LIGHT = "rgb(79, 179, 255)";
/* Outline diameter ≈ 3.47% of dial core (1/3 of the prior 10.4%). */
const CLOCK_SUN_SIZE_PCT = 10.4 / 3;
const CLOCK_SUN_R_VIEW = (CLOCK_VIEW * (CLOCK_SUN_SIZE_PCT / 100)) / 2;
/* Scale: 1 at daytime zenith (smallest); CLOCK_SUN_SCALE_MAX at
   sunrise/sunset and fixed through the night until sunrise. */
const CLOCK_SUN_SCALE_MAX = 2;
/* Handle tip radius in the dial-core viewBox (path-adjacent). Face chrome
   carries the hour ticks + numbers; solar-event buttons track the sun path. */
const CLOCK_TICK_OUTER = 94;
const CLOCK_TICK_MAJOR_LEN = 5;
const CLOCK_TICK_MINOR_LEN = 3;
/* Core-viewBox gap from sun-path radius to event-button center (constant as
   the path scales seasonally). */
const CLOCK_EVENT_GAP_FROM_PATH = 10;
/* Fallback override radius until layout maps face tick tips into core space. */
const CLOCK_OVERRIDE_R = CLOCK_TICK_OUTER;
const CLOCK_SUN_STROKE_MIN_PX = 0.2;
const CLOCK_SUN_STROKE_MAX_PX = 10;
const SIDEBAR_ANIMATION_MS = 200;
const SIDEBAR_SWAP_MS = 160;
/* Cubic ease-out: decelerates across more of the span than quintic. */
const CLOCK_SUN_MOVE_MS = 1500;
const DATE_MORPH_MS = 1500;
const PREVIEW_REFINE_MS = 800;
const LIGHT_BAR_HEIGHT = 108;
const LIGHT_FEATHER_PX = 36;
const LIGHT_BAR_EDGE_HEIGHT = LIGHT_BAR_HEIGHT - LIGHT_FEATHER_PX;
const LIGHT_EDIT_HIT_PX = 40;
const LIGHT_EDIT_DOT_PX = 5;
const LIGHT_EDIT_ACTION_PX = 40;
const UNDO_STACK_LIMIT = 75;
const DRAFT_STORAGE_VERSION = 1;
const DRAFT_PERSIST_MS = 200;
const LIGHT_VIEW_STORAGE_VERSION = 1;
const CLOCK_FEATHER_PCT = 5.5;
const LINKED_EVENTS = ["dawn", "sunrise", "sunset"];
const SETUP_AUTOMATIC = "automatic";
// Same circadian seeds as native_scene.EVENT_LIGHT_DEFAULTS (0–255, kelvin).
const EVENT_LIGHT_DEFAULTS = {
  dawn: [102, 2700],
  sunrise: [191, 3500],
  noon: [255, 4500],
  sunset: [179, 3000],
  dusk: [64, 2200],
};
const EVENT_SCENE_KEYS = {
  dawn: "scene_dawn",
  sunrise: "scene_sunrise",
  noon: "scene_noon",
  sunset: "scene_sunset",
  dusk: "scene_dusk",
};

/* @property in the shadow stylesheet does not register for animation;
   CSS.registerProperty on the document does. Call once per page load. */
function registerFeatherProperties() {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    return;
  }
  for (const spec of [
    {
      name: "--light-feather",
      syntax: "<length>",
      inherits: true,
      initialValue: `${LIGHT_FEATHER_PX}px`,
    },
    {
      name: "--clock-feather",
      syntax: "<percentage>",
      inherits: true,
      initialValue: `${CLOCK_FEATHER_PCT}%`,
    },
    {
      name: "--ring-expand",
      // Must inherit: the sharp hover/selected rim is a ::after mask that
      // reads these on the pseudo, and the fill mask lives on a child.
      syntax: "<percentage>",
      inherits: true,
      initialValue: "0%",
    },
    {
      name: "--ring-rim-w",
      // Length (not %): hover rim stays 1px across dial sizes; soft mode is 0px.
      syntax: "<length>",
      inherits: true,
      initialValue: "0px",
    },
  ]) {
    try {
      CSS.registerProperty(spec);
    } catch (_err) {
      /* already registered */
    }
  }
}
registerFeatherProperties();

const LABELS = {
  scene_name: "Scene name",
  area: "Area",
  display_scenes_combined: "Combine dawn / sunrise / sunset scenes?",
  scene_dawn: "Dawn scene",
  scene_sunrise: "Sunrise scene",
  scene_noon: "Noon scene",
  scene_sunset: "Sunset scene",
  scene_dusk: "Dusk scene",
  scene_dawn_sunrise_sunset: "Dawn, sunrise, and sunset scene",
  scene_dusk_minimum_time_of_day: "Earliest time for the dusk scene",
};

const HELPERS = {
  scene_name: "Name for the extrapolation scene entity",
  area: "Used to filter native Home Assistant scenes and to assign the new scene",
  display_scenes_combined: "If on, configure 3 scenes in the next step. If off, configure 5",
  scene_dawn: "First light (sun 6° below the horizon)",
  scene_sunrise: "When the sun rises",
  scene_noon: "When the sun is at its highest point",
  scene_sunset: "When the sun sets",
  scene_dusk: "Last light (sun 6° below the horizon)",
  scene_dawn_sunrise_sunset: "First light, sunrise, and sunset",
  scene_dusk_minimum_time_of_day: "To avoid lights dimming too much, too early",
  setup_empty_means_auto:
    "Leave empty to create a native scene automatically for this event",
};

class SceneExtrapolationPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = undefined;
    this._narrow = false;
    this._view = "list";
    this._editId = null;
    this._items = [];
    this._managedScenes = [];
    this._settings = {
      hide_managed_native_scenes: true,
      automatically_update_lights_interval: 300,
    };
    this._listTab = "extrapolation";
    this._translationsReady = false;
    this._leaveConfirmDone = false;
    this._formData = emptyFormData();
    this._entityId = null;
    this._pendingNewForm = null;
    this._areaPromptOpen = false;
    this._error = null;
    this._saving = false;
    this._built = false;
    this._sunPath = null;
    this._sunPathKey = undefined;
    this._previewDate = todayIso();
    this._previewLocation = null;
    this._previewCache = new Map();
    this._previewOverlay = null;
    this._nativeDrafts = {};
    this._undoStack = [];
    this._redoStack = [];
    this._sessionBaseline = null;
    this._draftRestore = null;
    this._draftBannerDismissed = false;
    this._persistTimer = undefined;
    this._previewInFlight = false;
    this._previewQueued = false;
    this._yearScrubbing = false;
    this._sidebarEventId = null;
    this._sidebarLightId = null;
    this._clockStickySeconds = undefined;
    this._aulResumeInterval = 300;
    this._hashConfirming = false;
    this._lightView = "dial";
    this._liveEdit = false;
    this._liveEditSidebarHandler = null;
    this._onHashChange = () => this._syncHash();
    this._onEditorKeydown = (ev) => this._handleEditorShortcut(ev);
    this._onPageHide = (ev) => {
      if (ev?.type === "visibilitychange" && document.visibilityState === "visible") {
        return;
      }
      this._flushPersistedDraft();
    };
    this._onLandscapeChange = () => this._syncYearScrubLayout();
    this._onWindowResize = () => {
      if (this._resizeRaf) {
        return;
      }
      this._resizeRaf = window.requestAnimationFrame(() => {
        this._resizeRaf = undefined;
        this._syncYearScrubLayout();
      });
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._syncDarkModeAttr();
    if (this._menuButtonEl) {
      this._menuButtonEl.hass = hass;
    }
    if (this._datePicker) {
      this._datePicker.hass = hass;
    }
    // HA assigns hass on every state update — do not rebuild the list (that
    // flickers the FAB and closes the settings sidebar). Translate once.
    const needsTranslationPaint = !this._translationsReady;
    void this._ensureTranslations().then(() => {
      if (needsTranslationPaint && this._built && this._view === "list") {
        this._renderList();
      }
    });
    // Registry/friendly_name can change while the editor is open — keep the
    // app-bar title in sync (same source as the list rows).
    if (this._built && this._view === "edit" && this._editId && this._headerEl) {
      this._headerEl.textContent = this._editorSceneTitle();
    }
    if (!this._built && this.isConnected) {
      this._build();
    }
  }

  set narrow(value) {
    this._narrow = value;
    if (this._appBar) {
      this._appBar.narrow = Boolean(value);
    }
    if (this._menuButtonEl) {
      this._menuButtonEl.narrow = Boolean(value);
    }
    if (this._built && this._view === "edit") {
      this._setEditorActions();
    }
  }

  set route(_route) {}

  set panel(_panel) {}

  /** Drive light/dark dial CSS (`:host([data-dark-mode])`) from HA’s theme. */
  _syncDarkModeAttr() {
    this.toggleAttribute(
      "data-dark-mode",
      Boolean(this._hass?.themes?.darkMode)
    );
  }

  connectedCallback() {
    window.addEventListener("hashchange", this._onHashChange);
    window.addEventListener("keydown", this._onEditorKeydown);
    window.addEventListener("pagehide", this._onPageHide);
    window.addEventListener("resize", this._onWindowResize);
    document.addEventListener("visibilitychange", this._onPageHide);
    if (!this._landscapeMq) {
      this._landscapeMq = window.matchMedia("(orientation: landscape)");
      if (this._landscapeMq.addEventListener) {
        this._landscapeMq.addEventListener("change", this._onLandscapeChange);
      } else {
        this._landscapeMq.addListener(this._onLandscapeChange);
      }
    }
    if (this._hass && !this._built) {
      this._build();
    }
    if (!this._sunTimer) {
      this._sunTimer = window.setInterval(() => {
        if (this._yearScrubbing) {
          return;
        }
        const active = this.shadowRoot?.activeElement;
        if (
          active &&
          (this._datePicker?.contains(active) ||
            this._yearScrub === active ||
            this._yearScrub?.contains(active))
        ) {
          return;
        }
        // Keep the sticky-scrub arc’s “now” tip moving without a full redraw.
        if (this._clockStickySeconds != null) {
          this._updateOverrideArc(this._clockStickySeconds);
        }
        // Only redraw when cached payload matches this view (avoids unhiding
        // a stale dial chart on the list after leaving the editor).
        if (this._sunPath && this._sunPathKey === this._chartKey()) {
          this._drawSunPath();
        }
      }, 30000);
    }
  }

  disconnectedCallback() {
    this._flushPersistedDraft();
    this._closeSceneSidebar();
    window.removeEventListener("hashchange", this._onHashChange);
    window.removeEventListener("keydown", this._onEditorKeydown);
    window.removeEventListener("pagehide", this._onPageHide);
    window.removeEventListener("resize", this._onWindowResize);
    document.removeEventListener("visibilitychange", this._onPageHide);
    if (this._resizeRaf) {
      window.cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = undefined;
    }
    if (this._landscapeMq) {
      if (this._landscapeMq.removeEventListener) {
        this._landscapeMq.removeEventListener("change", this._onLandscapeChange);
      } else {
        this._landscapeMq.removeListener(this._onLandscapeChange);
      }
      this._landscapeMq = undefined;
    }
    if (this._persistTimer) {
      window.clearTimeout(this._persistTimer);
      this._persistTimer = undefined;
    }
    if (this._previewTimer) {
      window.clearTimeout(this._previewTimer);
      this._previewTimer = undefined;
    }
    if (this._sunTimer) {
      window.clearInterval(this._sunTimer);
      this._sunTimer = undefined;
    }
    if (this._scrubRaf) {
      window.cancelAnimationFrame(this._scrubRaf);
      this._scrubRaf = undefined;
    }
    if (this._hoverRaf) {
      window.cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = undefined;
    }
  }

  async _build() {
    this._built = true;
    if (customElements.get("ha-top-app-bar-fixed") === undefined) {
      await customElements.whenDefined("ha-top-app-bar-fixed");
    }
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          /* 100vh fills when ha-panel-custom reports 0 height; max-height
             caps to the panel outlet when that height is definite — otherwise
             host > parent and HA’s shell scrolls beside ha-top-app-bar. */
          height: 100vh;
          max-height: 100%;
          overflow: hidden;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          --scene-sidebar-gutter: 0px;
          /* Night wedges: warm gray in light; near-black in dark. */
          --clock-night-outer: ${CLOCK_NIGHT_OUTER_LIGHT};
          --clock-night-deep: ${CLOCK_NIGHT_DEEP_LIGHT};
        }
        :host([data-dark-mode]) {
          --clock-night-outer: ${CLOCK_NIGHT_OUTER_DARK};
          --clock-night-deep: ${CLOCK_NIGHT_DEEP_DARK};
        }
        /* ha-panel-custom often computes to 0 height, so 100% on the app bar
           collapses. Fill the viewport, then stretch the bar to this host. */
        ha-top-app-bar-fixed {
          height: 100% !important;
        }
        .sun-path {
          /* No HA card chrome — clock/plots sit on the panel surface. */
          background: transparent;
          border: none;
          border-radius: 0;
          margin-top: var(--ha-space-3);
          overflow: visible;
          position: relative;
        }
        /* Surface vignette on L/T/R (max 50% opacity) so date chips, Now
           readout, and event labels read over horizon bleed in light + dark.
           Long multi-stops ≈ soft blur (hard 88/160 edges read as a hard cut).
           Extend under --scene-sidebar-gutter like .clock-horizon-back so the
           right fade does not hard-cut at the drawer. */
        .sun-path.dial-view::before {
          content: "";
          position: absolute;
          inset: 0;
          /* Reach the same top as .clock-horizon-back (host), including under
             draft/location banners — measured as --dial-banner-h. */
          top: calc(-1 * var(--dial-banner-h, 0px));
          right: calc(-1 * var(--scene-sidebar-gutter));
          z-index: 2;
          pointer-events: none;
          background:
            linear-gradient(
              to right,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 28%, transparent) 72px,
              color-mix(in srgb, var(--primary-background-color) 10%, transparent) 160px,
              transparent 260px
            ),
            linear-gradient(
              to left,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 28%, transparent) 72px,
              color-mix(in srgb, var(--primary-background-color) 10%, transparent) 160px,
              transparent 260px
            ),
            linear-gradient(
              to bottom,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 28%, transparent) 100px,
              color-mix(in srgb, var(--primary-background-color) 10%, transparent) 220px,
              transparent 360px
            );
        }
        .sun-path[hidden] {
          display: none;
        }
        .sun-path-stage {
          display: block;
        }
        /* Landscape clock: timeline in the right column; matching empty left
           column keeps the dial optically centered in the full stage while
           the rail still reduces the width available for the dial. */
        .sun-path-stage.landscape-clock-scrub {
          --scrub-rail-width: ${CLOCK_SCRUB_RAIL_PX}px;
          display: grid;
          grid-template-columns:
            var(--scrub-rail-width)
            minmax(0, 1fr)
            var(--scrub-rail-width);
          align-items: start;
          width: 100%;
          box-sizing: border-box;
          /* Right pad so the timeline is not flush to the panel edge; the
             matching left column still optically centers the dial. */
          padding-right: ${CLOCK_SCRUB_RAIL_PAD_PX}px;
          overflow: visible;
          transition: grid-template-columns ${SIDEBAR_ANIMATION_MS}ms
            cubic-bezier(0.2, 0, 0, 1);
        }
        .sun-path-stage.landscape-clock-scrub.scrub-collapsed {
          --scrub-rail-width: 0px;
        }
        .sun-path-stage.landscape-clock-scrub .sun-path-body {
          grid-column: 2;
          width: 100%;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .sun-year-scrub-rail {
          display: none;
          grid-column: 3;
          position: relative;
          width: 100%;
          min-width: 0;
          /* Visible so date chips can grow left into the dial column. */
          overflow: visible;
          opacity: 1;
          box-sizing: border-box;
          z-index: 3;
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
          transition: opacity ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .sun-path-stage.landscape-clock-scrub .sun-year-scrub-rail {
          display: flex;
          /* Match portrait toolbar top inset under the app bar. */
          padding-top: 12px;
        }
        .sun-path-stage.landscape-clock-scrub.scrub-collapsed .sun-year-scrub-rail {
          opacity: 0;
          pointer-events: none;
        }
        .sun-scrub-block {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          width: 100%;
        }
        .sun-year-scrub-rail .sun-scrub-block {
          flex: 1 1 auto;
          min-height: 0;
          height: 100%;
        }
        .sun-date-tools {
          display: flex;
          /* Table: date first (row-reverse of chips→date DOM). */
          flex-direction: row-reverse;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          justify-content: flex-end;
        }
        /* Dial portrait: chips left of day/month.
           Above horizon bleed (sky/glow can extend past the face). */
        .sun-path.dial-view .sun-date-tools {
          position: relative;
          z-index: 3;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
        }
        .sun-year-scrub-rail .sun-date-tools {
          /* Chips above date; pack to the rail’s right edge. */
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          max-width: 100%;
          overflow: visible;
          gap: 4px;
          box-sizing: border-box;
          padding-inline-end: 2px;
        }
        .sun-chip-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .sun-year-scrub-rail .sun-chip-row {
          /* width:100% + flex-end: right edge stays in the rail; overflow grows
             left into the dial. (max-content + margin-left:auto left-aligns when
             chips are wider than the 88px rail and spills off-screen.) */
          flex-direction: row;
          flex-wrap: nowrap;
          justify-content: flex-end;
          align-items: center;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          gap: 4px;
          overflow: visible;
        }
        .sun-year-scrub-rail .sun-chip {
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .sun-scrub-date {
          position: relative;
          appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin: 0;
          padding: 2px 4px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--primary-text-color);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
          cursor: pointer;
        }
        .sun-year-scrub-rail .sun-scrub-date {
          align-self: stretch;
          justify-content: flex-end;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          font-size: 26px;
          line-height: 1.15;
          padding: 2px 0;
        }
        .sun-scrub-date:hover {
          background: color-mix(
            in srgb,
            var(--primary-color) 12%,
            transparent
          );
        }
        .sun-scrub-date:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        /* Visually hidden but mounted — opened via ha-date-input._openDialog.
           Keep it laid out (not display:none) so the selector finishes upgrading.
           clip-path + contain so the upgraded control cannot widen scrollWidth. */
        .sun-date-picker-host {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: 0;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          contain: strict;
          opacity: 0;
          pointer-events: none;
        }
        .sun-toolbar {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          padding: 12px 16px 0;
          position: relative;
          z-index: 3;
        }
        /* Portrait dial: toolbar is in-flow so the year scrub pushes the dial
           down (ticks stay clear). Horizon glow still bleeds behind it
           (_layoutClockHorizonBack covers the host). */
        .sun-path.dial-view .sun-toolbar:not(.toolbar-rail-only) {
          position: relative;
          z-index: 6;
          box-sizing: border-box;
          pointer-events: none;
          background: transparent;
        }
        .sun-path.dial-view .sun-toolbar:not(.toolbar-rail-only) > * {
          pointer-events: auto;
        }
        /* Time/sun + date chips share one full-width wrapping row. */
        .sun-toolbar-chrome {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-start;
          gap: 8px 12px;
          width: 100%;
          box-sizing: border-box;
        }
        /* Must beat .sun-path.dial-view .sun-hover-readout position:absolute
           (same specificity, later in the sheet) or time sits on top of chips. */
        .sun-path.dial-view .sun-toolbar-chrome .sun-hover-readout {
          position: static;
          top: auto;
          left: auto;
          z-index: auto;
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: 8px 16px;
          flex: 0 1 auto;
          max-width: none;
          min-width: 0;
          /* Match chip / reset row height so time+deg stay put when reset appears. */
          min-height: 32px;
          margin: 0;
          padding: 0;
          pointer-events: none;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        .sun-path.dial-view .sun-toolbar-chrome .sun-hover-time {
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .sun-path.dial-view .sun-toolbar-chrome .sun-hover-reset-slot {
          flex: 0 0 32px;
          width: 32px;
          height: 32px;
          display: inline-grid;
          place-items: center;
          pointer-events: none;
        }
        .sun-path.dial-view .sun-toolbar-chrome .sun-hover-reset {
          pointer-events: auto;
        }
        .sun-toolbar-chrome .sun-chip-row {
          flex: 0 1 auto;
          margin-left: auto;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        /* Scrub/date live in the right rail — do not leave empty toolbar padding
           above the dial (would push the face down). */
        .sun-toolbar.toolbar-rail-only {
          padding: 0;
          gap: 0;
          min-height: 0;
        }
        .sun-toolbar.toolbar-rail-only .sun-toolbar-chrome {
          display: none;
        }
        .sun-toolbar-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .sun-year-scrub {
          position: relative;
          width: 100%;
          margin: 4px 0 8px;
          touch-action: none;
          user-select: none;
          outline: none;
          cursor: pointer;
        }
        /* Keyboard only — pointerdown must not paint a focus ring (do not
           call .focus() from the scrub pointer handler). */
        .sun-year-scrub:focus {
          outline: none;
          box-shadow: none;
        }
        .sun-year-scrub:focus-visible {
          box-shadow: 0 0 0 2px var(--primary-color);
          border-radius: 8px;
        }
        .sun-year-months {
          position: relative;
          height: 16px;
          margin-bottom: 2px;
        }
        .sun-year-months span {
          position: absolute;
          top: 0;
          font-size: 11px;
          line-height: 16px;
          color: var(--secondary-text-color);
          pointer-events: none;
          white-space: nowrap;
        }
        .sun-year-track {
          position: relative;
          height: 20px;
        }
        .sun-year-bar,
        .sun-year-fill {
          position: absolute;
          left: 0;
          top: 8px;
          height: 4px;
          border-radius: 2px;
        }
        .sun-year-bar {
          right: 0;
          background: var(--divider-color);
        }
        .sun-year-fill {
          background: var(--primary-color);
          opacity: 0.35;
        }
        .sun-year-today {
          position: absolute;
          top: 4px;
          width: 2px;
          height: 12px;
          margin-left: -1px;
          background: var(--secondary-text-color);
          pointer-events: none;
        }
        .sun-year-today[hidden] {
          display: none;
        }
        .sun-year-thumb {
          position: absolute;
          top: 4px;
          width: 16px;
          height: 16px;
          margin-left: -8px;
          border-radius: 50%;
          background: var(--primary-color);
          box-shadow: 0 0 0 2px var(--card-background-color);
          pointer-events: none;
        }
        /* Portrait / table: horizontal under the date row (default above).
           Landscape + clock: vertical rail to the right of the face. */
        .sun-year-scrub.vertical {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          flex: 1 1 auto;
          width: 100%;
          min-height: 0;
          height: auto;
          margin: 0;
          padding: 2px 0;
          box-sizing: border-box;
        }
        .sun-year-scrub.vertical .sun-year-months {
          flex: 1 1 auto;
          width: auto;
          height: auto;
          margin: 0 2px 0 0;
          align-self: stretch;
        }
        .sun-year-scrub.vertical .sun-year-months span {
          left: auto;
          right: 0;
          top: 0;
          font-size: 10px;
          line-height: 1.1;
          text-align: right;
        }
        .sun-year-scrub.vertical .sun-year-track {
          flex: 0 0 20px;
          width: 20px;
          height: auto;
          align-self: stretch;
        }
        .sun-year-scrub.vertical .sun-year-bar {
          left: 8px;
          right: auto;
          top: 0;
          bottom: 0;
          width: 4px;
          height: auto;
        }
        .sun-year-scrub.vertical .sun-year-fill {
          left: 8px;
          right: auto;
          top: 0;
          width: 4px;
          height: 0;
        }
        .sun-year-scrub.vertical .sun-year-thumb {
          left: 2px;
          top: 0;
          margin-left: 0;
          margin-top: -8px;
        }
        .sun-year-scrub.vertical .sun-year-today {
          left: 4px;
          top: 0;
          width: 12px;
          height: 2px;
          margin-left: 0;
        }
        .sun-chip {
          background: transparent;
          color: var(--primary-color);
          border: 1px solid var(--divider-color);
          border-radius: 16px;
          padding: 4px 10px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .sun-chip[selected] {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
        }
        .sun-location-btn {
          color: var(--secondary-text-color);
        }
        .sun-location-btn[hidden] {
          display: none;
        }
        .light-view-toggle-btn {
          --ha-button-height: 40px;
          color: var(--primary-text-color);
        }
        .sun-path.dial-view {
          --dial-timeline-h: 0px;
          /* Flush under the app bar so horizon/bloom/ramp share one top edge
             (margin left a strip where only some bleed painted). */
          margin-top: 0;
          /* Clip horizon bleed on X only. Do not use overflow-x: hidden with
             overflow-y: visible — CSS computes that Y to auto and the dial
             grows a second vertical scrollbar beside ha-top-app-bar. */
          overflow-x: clip;
          overflow-y: visible;
          /* Fallback until _syncDialHeightBudget measures: fill below the
             header, keep event-label pad + gap, leave ~32px of the first
             light row peeking. */
          --dial-face-max: calc(
            100vh - var(--header-height, 64px) - 40px - 16px -
              ${DIAL_LIST_PEEK_PX}px
          );
        }
        .sun-light-clock {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          width: 100%;
          /* No horizontal padding — use the full stage column for the dial.
             Extra top pad leaves room for event labels above the face. */
          padding: 40px 0 16px;
          box-sizing: border-box;
          overflow: visible;
        }
        .sun-path.dial-view .sun-light-clock {
          position: relative;
          /* Do not cap height to the viewport — face size comes from
             --dial-face-max; the legend stacks under and scrolls into view. */
          min-height: 0;
          gap: 16px;
          padding-bottom: 16px;
        }
        .sun-path.dial-view .sun-light-clock-legend {
          position: relative;
          z-index: 5;
          width: min(100%, 500px);
          max-width: 500px;
          /* Match the 8px gap between legend rows. */
          padding-inline: 8px;
          box-sizing: border-box;
          flex: 0 0 auto;
          pointer-events: auto;
        }
        /* Same column width as the dial light list (under the face). */
        .sun-light-clock-empty-hint {
          margin: 0;
          padding: 0 12px;
          max-width: min(100%, 86vh, var(--dial-face-max, 86vh));
          text-align: center;
          color: var(--secondary-text-color);
          font-size: 14px;
          line-height: 1.4;
          position: relative;
          z-index: 5;
        }
        .sun-light-clock-face {
          position: relative;
          /* Leave headroom for the app bar + event labels around the dial. */
          width: min(100%, 86vh, var(--dial-face-max, 86vh));
          max-width: min(100%, 86vh, var(--dial-face-max, 86vh));
          aspect-ratio: 1;
          flex: 0 0 auto;
          /* Allow page scroll over the dial; only the sun/handle capture. */
          touch-action: pan-y;
          cursor: default;
          /* Visible so horizon glow/rays can bleed past the face. */
          overflow: visible;
          transform-origin: center center;
          --clock-chrome: ${CLOCK_CHROME_PX}px;
        }
        /* Mobile: drop hour numbers; grow the face past the column (clipped
           later — see overflow-x under .page.dial-wide) so ticks can bleed. */
        @media (max-width: 870px) {
          .sun-light-clock-face {
            width: min(
              calc(100% + 48px),
              96vh,
              var(--dial-face-max, 96vh)
            );
            max-width: min(96vh, var(--dial-face-max, 96vh));
            margin-inline: -24px;
          }
          .clock-hour-label {
            display: none;
          }
        }
        /* Sunrise/sunset shadow + glow sit behind the planet (back-most).
           Sized in JS to cover the full panel (under the sidebar).
           Isolate so screen-blend horizon wash does not composite over the
           light-band bloom that stacks above this layer. translate3d keeps
           scrub-driven background updates on their own compositor layer. */
        .clock-horizon-back {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate3d(-50%, -50%, 0);
          pointer-events: none;
          z-index: 0;
          overflow: visible;
          isolation: isolate;
          backface-visibility: hidden;
        }
        /* Light-band bloom between horizon wash and planet (same chrome inset
           as the core so clones stay aligned with the rings). Promoted so sun
           scrub does not re-rasterize the static bloom clones. */
        .sun-light-clock-glow-layer {
          position: absolute;
          inset: var(--clock-chrome);
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          overflow: visible;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        /* Planet / path live in the inset core; event chips stay on the face
           so their px size does not shrink with the dial. */
        .sun-light-clock-core {
          position: absolute;
          inset: var(--clock-chrome);
          border-radius: 50%;
          pointer-events: none;
          z-index: 2;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .sun-light-clock-core .sun-light-clock-rings {
          pointer-events: auto;
        }
        .sun-light-clock-face.clock-face-enter {
          animation:
            clock-face-fade 750ms cubic-bezier(0.2, 0, 0, 1) both,
            clock-face-scale 1500ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        .sun-light-clock-face.clock-face-enter .sun-light-clock-overlay {
          transform-origin: center center;
          animation: clock-overlay-spin 1500ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        /* Cancel overlay spin on the sun fill/glow so it stays locked to the
           HTML outline (both follow the JS enter arc only). */
        .sun-light-clock-face.clock-face-enter .clock-sun-day-group {
          transform-box: view-box;
          transform-origin: center;
          animation: clock-sun-counter-spin 1500ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        /* Buttons live on the face (outside the SVG overlay). Spin this layer
           around the dial center so they orbit with the path, not in place.
           Anchors counter-rotate so the icon + label stay screen-level. */
        .sun-light-clock-face.clock-face-enter .clock-event-layer {
          transform-origin: center center;
          animation: clock-overlay-spin 1500ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        .sun-light-clock-face.clock-face-enter .clock-event-anchor {
          animation: clock-event-counter-spin 1500ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        @keyframes clock-face-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes clock-face-scale {
          from {
            transform: scale(0.9);
          }
          to {
            transform: scale(1);
          }
        }
        @keyframes clock-overlay-spin {
          from {
            transform: translateZ(0) rotate(-12deg);
          }
          to {
            transform: translateZ(0) rotate(0deg);
          }
        }
        @keyframes clock-sun-counter-spin {
          from {
            transform: rotate(12deg);
          }
          to {
            transform: rotate(0deg);
          }
        }
        @keyframes clock-event-counter-spin {
          from {
            transform: translate(-50%, -50%) rotate(12deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(0deg);
          }
        }
        /* Registered via CSS.registerProperty (document), not @property here —
           shadow-root @property does not enable transitions. */
        /* Soft bloom from simple dial clones (same ring colors as the planet).
           Each scale is its own blurred stage (lg then md) above the horizon. */
        .sun-light-clock-glow {
          position: absolute;
          inset: ${CLOCK_RINGS_INSET_PCT}%;
          border-radius: 50%;
          pointer-events: none;
          transform-origin: center center;
          filter: blur(28px);
          /* Was 0.63; 50% less transparent → opacity 0.815 */
          opacity: 0.815;
          overflow: visible;
          /* Match soft-mode bleed so the bloom still overlaps between bands. */
          --clock-feather: ${CLOCK_FEATHER_PCT}%;
          --ring-soft-expand: ${(CLOCK_FEATHER_PCT * 1.35).toFixed(2)}%;
          backface-visibility: hidden;
        }
        /* Light theme: half the bloom so rings do not wash the pale sky. */
        :host(:not([data-dark-mode])) .sun-light-clock-glow {
          opacity: 0.4075;
        }
        .sun-light-clock-glow.glow-lg {
          transform: translateZ(0) scale(2.76);
          /* Outermost bloom: half of the shared glow opacity. */
          opacity: 0.4075;
        }
        :host(:not([data-dark-mode])) .sun-light-clock-glow.glow-lg {
          opacity: 0.20375;
        }
        .sun-light-clock-glow.glow-md {
          transform: translateZ(0) scale(1.38);
        }
        .sun-light-clock-glow .clock-ring {
          --ring-expand: var(--ring-soft-expand);
          --ring-rim-w: 0px;
          transition: none;
          filter: none;
          opacity: 1;
          transform: none;
        }
        .sun-light-clock-glow .clock-ring::after {
          content: none;
          display: none;
        }
        /* Sunrise/sunset wash — not clipped to the planet rim. Paints a
           multi-stop spectrum that ends at the surface color (normal blend). */
        .clock-horizon-glow {
          position: absolute;
          inset: 0;
          pointer-events: none;
          mix-blend-mode: normal;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .clock-horizon-sky {
          position: absolute;
          inset: 0;
          overflow: visible;
          pointer-events: none;
        }
        .sun-light-clock-rings {
          position: absolute;
          inset: ${CLOCK_RINGS_INSET_PCT}%;
          border-radius: 50%;
          /* Above the hour handle so the planet occludes it; path/sun stay higher. */
          z-index: 7;
          overflow: visible;
          --clock-feather: ${CLOCK_FEATHER_PCT}%;
          /* Soft mode: expand bands into neighbors so opaque cores overlap —
             feather alone only overlaps fades and the surface disc shows through. */
          --ring-soft-expand: ${(CLOCK_FEATHER_PCT * 1.35).toFixed(2)}%;
          /* Sharp ↔ soft snaps instantly — animating feather/expand reads as a
             size/ramp morph on every hover. */
          cursor: pointer;
          /* Finger scrub over bands must not scroll the page. */
          touch-action: none;
          /* Filled circular planet: box-shadow matches the old drop-shadow look
             without filter-rasterizing masked conics every frame. */
          box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        /* Surface disc under the bands so 50% rings mix with the panel color,
           not the horizon/bloom graphics behind the planet. */
        .sun-light-clock-rings::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: var(--primary-background-color);
          z-index: 0;
          pointer-events: none;
        }
        /* Soft → sharp: no feather / soft-expand so bands sit edge-to-edge.
           Include :has(.hovered) so touch scrub (no :hover) matches mouse. */
        .sun-light-clock-rings:hover,
        .sun-light-clock-rings:has(.clock-ring.selected),
        .sun-light-clock-rings:has(.clock-ring.hovered) {
          --clock-feather: 0%;
          --ring-soft-expand: 0%;
        }
        .clock-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          /* Masked rings still fill the square for hit-testing; open via
             radial pick on the host instead of per-ring clicks. */
          pointer-events: none;
          z-index: 1;
          --ring-expand: var(--ring-soft-expand);
          --ring-rim-w: 0px;
          transform-origin: center center;
          /* Opacity/filter only — expand/rim-w follow sharp/soft with no tween. */
          transition:
            opacity 180ms cubic-bezier(0.2, 0, 0, 1),
            filter 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        /* Fill lives on a child so the ring mask does not clip ::after borders. */
        .clock-ring-fill {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
        }
        /* Inner + outer rim strokes just inside the band edges (not straddling
           100%, which clipped the outer half of the outermost ring). Width is
           a fixed length so it stays 1px across dial sizes. */
        .clock-ring::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          /* Hover rim: was 0.1; 40% more transparent → 0.06 */
          background: rgba(255, 255, 255, 0.06);
          opacity: 0;
          transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
          -webkit-mask-image: radial-gradient(
            farthest-side,
            transparent calc(var(--ring-inner) - var(--ring-expand)),
            #000 calc(var(--ring-inner) - var(--ring-expand)),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-rim-w)
              ),
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-rim-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-rim-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-rim-w)
              ),
            #000 calc(var(--ring-outer) + var(--ring-expand)),
            transparent calc(var(--ring-outer) + var(--ring-expand))
          );
          mask-image: radial-gradient(
            farthest-side,
            transparent calc(var(--ring-inner) - var(--ring-expand)),
            #000 calc(var(--ring-inner) - var(--ring-expand)),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-rim-w)
              ),
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-rim-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-rim-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-rim-w)
              ),
            #000 calc(var(--ring-outer) + var(--ring-expand)),
            transparent calc(var(--ring-outer) + var(--ring-expand))
          );
        }
        /* Dim only siblings — :is/:has dimming outranked .hovered/.selected
           opacity:1 when applied to every .clock-ring. */
        .sun-light-clock-rings:is(
            :hover,
            :has(.clock-ring.selected),
            :has(.clock-ring.hovered)
          )
          .clock-ring:not(.hovered):not(.selected) {
          opacity: 0.5;
        }
        /* Hover/selected: stronger black shadow (2× blur), soft white rim.
           Keep rules separate — comma-grouped selectors failed to apply
           registered --ring-* props in the past. */
        .clock-ring.hovered {
          --ring-expand: 0%;
          --ring-rim-w: 1px;
          opacity: 1;
          filter:
            drop-shadow(0 4px 28px rgba(0, 0, 0, 0.75))
            drop-shadow(0 0 12px rgba(0, 0, 0, 0.45));
          z-index: 5;
        }
        .clock-ring.hovered::after {
          opacity: 1;
        }
        .clock-ring.selected {
          --ring-expand: 0%;
          --ring-rim-w: 1px;
          opacity: 1;
          filter:
            drop-shadow(0 4px 28px rgba(0, 0, 0, 0.75))
            drop-shadow(0 0 12px rgba(0, 0, 0, 0.45));
          z-index: 6;
        }
        .clock-ring.selected::after {
          opacity: 1;
        }
        /* Only one band highlighted: while hovering another ring, the
           selected ring yields (still .selected for sidebar sync). */
        .sun-light-clock-rings:has(.clock-ring.hovered)
          .clock-ring.selected:not(.hovered) {
          --ring-expand: 0%;
          --ring-rim-w: 0px;
          opacity: 0.5;
          filter: none;
          z-index: 1;
        }
        .sun-light-clock-rings:has(.clock-ring.hovered)
          .clock-ring.selected:not(.hovered)::after {
          opacity: 0;
        }
        .clock-ring.selected.hovered {
          z-index: 7;
        }
        /* Friendly name flush above the outer light-ring edge (rings are inset
           inside the core; do not anchor to --clock-chrome / face chrome). */
        .clock-ring-hover-name {
          position: absolute;
          left: 50%;
          top: ${CLOCK_RINGS_INSET_PCT}%;
          transform: translate(-50%, -100%);
          z-index: 10;
          pointer-events: none;
          max-width: min(80%, 14rem);
          padding: 6px 12px;
          border-radius: 999px;
          background: color-mix(
            in srgb,
            var(--card-background-color) 88%,
            transparent
          );
          color: var(--primary-text-color);
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--divider-color) 70%, transparent),
            0 4px 14px rgba(0, 0, 0, 0.28);
          font-size: 14px;
          font-weight: 600;
          line-height: 1.2;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .clock-ring-hover-name[hidden] {
          display: none;
        }
        .sun-light-clock-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 4;
          /* Own layer so sun/path moves do not dirty the static bloom/rings. */
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .sun-light-clock-handle-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 6;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .clock-horizon-sky .clock-sky-day {
          /* Fill set in JS from skyLook (Apple-like day sky blue). */
          fill: transparent;
        }
        .clock-horizon-sky .clock-sky-night {
          /* Sunset→sunrise shadow (outer night). */
          fill: color-mix(in srgb, var(--clock-night-outer) 72%, transparent);
        }
        .clock-horizon-sky .clock-sky-deep {
          /* Dusk→dawn wrap (deeper band). */
          fill: color-mix(in srgb, var(--clock-night-deep) 78%, transparent);
        }
        .sun-light-clock-overlay .clock-sun-day {
          fill: none;
          stroke: #000;
          stroke-width: 1px;
          vector-effect: non-scaling-stroke;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.9;
        }
        .sun-light-clock-overlay .clock-sun-path-night {
          fill: none;
          stroke: #000;
          stroke-width: 1px;
          vector-effect: non-scaling-stroke;
          stroke-dasharray: 5 4;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.5;
        }
        .sun-light-clock-overlay .clock-event-dot {
          fill: #000;
          stroke: none;
        }
        /* Match night sun-path dash + opacity. */
        .sun-light-clock-overlay .clock-event-ray,
        .sun-light-clock-overlay .clock-event-clamp-link {
          fill: none;
          stroke: #000;
          stroke-width: 1px;
          vector-effect: non-scaling-stroke;
          stroke-dasharray: 5 4;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.5;
        }
        :host([data-dark-mode]) .sun-light-clock-overlay .clock-sun-day {
          stroke: #e8eef8;
        }
        :host([data-dark-mode]) .sun-light-clock-overlay .clock-sun-path-night,
        :host([data-dark-mode]) .sun-light-clock-overlay .clock-event-ray,
        :host([data-dark-mode]) .sun-light-clock-overlay .clock-event-clamp-link {
          stroke: #d8e0ff;
        }
        :host([data-dark-mode]) .sun-light-clock-overlay .clock-event-dot {
          fill: var(--primary-text-color);
        }
        .sun-light-clock-overlay .clock-handle,
        .sun-light-clock-handle-overlay .clock-handle {
          stroke: var(--primary-text-color);
          stroke-width: 1.5px;
          vector-effect: non-scaling-stroke;
          stroke-linecap: round;
          opacity: 0.85;
        }
        .sun-light-clock-overlay .clock-override-arc {
          fill: none;
          stroke: #fff;
          stroke-width: 1px;
          vector-effect: non-scaling-stroke;
          stroke-linecap: round;
          opacity: 0.88;
        }
        .sun-light-clock-overlay .clock-override-glow {
          pointer-events: none;
        }
        .clock-handle-hit {
          position: absolute;
          left: 50%;
          bottom: 50%;
          width: 22px;
          /* Tip only (planet rim → tick tips). A full center→rim spoke sat
             above the light rings and ate dial clicks along the sun angle. */
          height: ${((CLOCK_TICK_OUTER - CLOCK_RINGS_OUTER) / CLOCK_VIEW) * 100}%;
          margin-bottom: ${(CLOCK_RINGS_OUTER / CLOCK_VIEW) * 100}%;
          transform-origin: center bottom;
          transform: translateX(-50%) rotate(var(--handle-deg, 0deg));
          /* Below .sun-light-clock-rings (7) so the planet keeps ring picks. */
          z-index: 6;
          cursor: grab;
          pointer-events: auto;
          touch-action: none;
        }
        .clock-handle-hit:active,
        .clock-sun-hit:active {
          cursor: grabbing;
        }
        /* Visual sun under the handle; hit on top. SVG white fill + glow are
           day-wedge clipped (outline-only below the horizon). */
        .clock-sun {
          position: absolute;
          width: ${CLOCK_SUN_SIZE_PCT}%;
          height: ${CLOCK_SUN_SIZE_PCT}%;
          transform: translate(-50%, -50%) scale(var(--sun-scale, 1));
          pointer-events: none;
          z-index: 5;
          --sun-scale: 1;
        }
        .clock-sun > span {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .clock-sun-shadow {
          /* Shadow is SVG behind the fill so it never covers the white disc. */
          display: none;
        }
        .clock-sun-ring {
          inset: 0;
          border: 1.5px solid #fff;
          background: transparent;
          box-sizing: border-box;
          z-index: 2;
        }
        .sun-light-clock-overlay .clock-sun-fill {
          fill: #fff;
          pointer-events: none;
        }
        .sun-light-clock-overlay .clock-sun-glow-disc {
          pointer-events: none;
          /* Softness is in the SVG radial gradient — CSS filter:blur on a
             cx/cy-moved circle trails under Chromium while scrubbing. */
        }
        .sun-light-clock-overlay .clock-sun-shadow-disc {
          pointer-events: none;
        }
        .clock-sun-hit {
          position: absolute;
          width: ${CLOCK_SUN_SIZE_PCT}%;
          height: ${CLOCK_SUN_SIZE_PCT}%;
          transform: translate(-50%, -50%) scale(var(--sun-scale, 1));
          border-radius: 50%;
          pointer-events: auto;
          cursor: grab;
          touch-action: none;
          /* Below rings so an oversized night sun does not steal planet clicks. */
          z-index: 6;
        }
        /* Hourly ticks on the face (with hour numbers); majors every 6h.
           Text-colored (not white) so light-mode sky wash stays readable;
           surface halo replaces the old black shadow. */
        .clock-face-ticks {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 5;
          filter:
            drop-shadow(
              0 0 8px
                color-mix(in srgb, var(--primary-background-color) 25%, transparent)
            )
            drop-shadow(
              0 1px 6px
                color-mix(in srgb, var(--primary-background-color) 25%, transparent)
            );
        }
        .clock-face-ticks .clock-tick {
          stroke: color-mix(in srgb, var(--primary-text-color) 28%, transparent);
          stroke-width: 4.5px;
          vector-effect: non-scaling-stroke;
          stroke-linecap: round;
        }
        .clock-face-ticks .clock-tick.major {
          stroke: color-mix(in srgb, var(--primary-text-color) 42%, transparent);
          stroke-width: 6px;
        }
        /* HTML hour labels on the face, just inside the tick tips. */
        .clock-hour-label {
          position: absolute;
          transform: translate(-50%, -50%);
          font-size: 16px;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          color: color-mix(in srgb, var(--primary-text-color) 48%, transparent);
          pointer-events: none;
          z-index: 7;
          text-shadow:
            0 0 8px
              color-mix(in srgb, var(--primary-background-color) 25%, transparent),
            0 1px 6px
              color-mix(in srgb, var(--primary-background-color) 25%, transparent);
        }
        @media (min-width: 871px) {
          .clock-hour-label {
            font-size: 32px;
          }
        }
        .clock-event-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 6;
        }
        .clock-event-anchor {
          position: absolute;
          width: 32px;
          height: 32px;
          transform: translate(-50%, -50%);
          z-index: 6;
          pointer-events: none;
        }
        .clock-event-meta {
          position: absolute;
          left: 50%;
          bottom: calc(100% + 4px);
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          max-width: min(7.5rem, calc(var(--clock-chrome) * 2 - 8px));
          padding: 0 2px;
          text-align: center;
          pointer-events: none;
          white-space: nowrap;
          /* Surface halo — half strength so labels stay readable without a glow blob. */
          text-shadow:
            0 0 4px
              color-mix(in srgb, var(--primary-background-color) 50%, transparent),
            0 1px 2px
              color-mix(in srgb, var(--primary-background-color) 50%, transparent);
        }
        /* Collision placement: below the button (see _layoutClockEventMetas). */
        .clock-event-meta.below {
          bottom: auto;
          top: calc(100% + 4px);
        }
        .clock-event-meta .clock-event-heading {
          font-size: 10px;
          font-weight: 600;
          line-height: 1.15;
          color: var(--primary-text-color);
        }
        .clock-event-meta .clock-event-scene {
          font-size: 9px;
          line-height: 1.15;
          /* Same hue as the heading at 70% — blends better than secondary gray. */
          color: color-mix(in srgb, var(--primary-text-color) 70%, transparent);
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: min(7.5rem, calc(var(--clock-chrome) * 2 - 8px));
        }
        .clock-event-meta .clock-event-scene.empty {
          color: var(--warning-color, var(--error-color));
          font-weight: 600;
        }
        .clock-event {
          position: absolute;
          inset: 0;
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
          pointer-events: auto;
          cursor: pointer;
          padding: 0;
          font: inherit;
          transform-origin: center center;
          transition:
            transform 160ms cubic-bezier(0.2, 0, 0, 1),
            box-shadow 160ms cubic-bezier(0.2, 0, 0, 1),
            border-color 160ms cubic-bezier(0.2, 0, 0, 1),
            background 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .clock-event:hover,
        .clock-event:focus-visible,
        .clock-event:active,
        .clock-event.selected {
          transform: scale(1.12);
          z-index: 1;
        }
        .clock-event:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .clock-event:hover:not(.selected):not(.missing),
        .clock-event:focus-visible:not(.selected):not(.missing) {
          border-color: var(--primary-color);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
        }
        .clock-event ha-icon {
          --mdc-icon-size: 18px;
        }
        /* True-solar stand-in when earliest-dusk moves the active button. */
        .clock-event-anchor.ghost {
          width: 22px;
          height: 22px;
          z-index: 5;
        }
        .clock-event.ghost {
          width: 22px;
          height: 22px;
          opacity: 0.48;
          cursor: default;
          pointer-events: none;
          box-shadow: none;
          border-style: dashed;
          background: color-mix(
            in srgb,
            var(--card-background-color) 70%,
            transparent
          );
          transform: none;
        }
        .clock-event.ghost:hover,
        .clock-event.ghost:focus-visible,
        .clock-event.ghost:active,
        .clock-event.ghost.selected {
          transform: none;
        }
        .clock-event.ghost ha-icon {
          --mdc-icon-size: 13px;
        }
        /* Missing — icon only; scene cue lives in the meta above. */
        .clock-event.missing {
          color: var(--warning-color, var(--error-color));
          border: 2px solid var(--warning-color, var(--error-color));
          background: color-mix(
            in srgb,
            var(--warning-color, var(--primary-color)) 18%,
            var(--card-background-color)
          );
          box-shadow:
            0 0 0 3px
              color-mix(
                in srgb,
                var(--warning-color, var(--primary-color)) 28%,
                transparent
              ),
            0 2px 8px rgba(0, 0, 0, 0.22);
        }
        .clock-event.selected {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 2px var(--primary-color);
        }
        .clock-event.missing.selected {
          border-color: var(--primary-color);
          box-shadow:
            0 0 0 2px var(--primary-color),
            0 0 0 5px
              color-mix(
                in srgb,
                var(--warning-color, var(--primary-color)) 28%,
                transparent
              ),
            0 2px 8px rgba(0, 0, 0, 0.22);
        }
        .sun-light-clock-legend {
          width: min(100%, 500px);
          max-width: 500px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          z-index: 5;
          pointer-events: auto;
        }
        .clock-legend-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 56px;
          padding: 10px 12px 10px 10px;
          border-radius: var(--ha-border-radius-lg, 12px);
          box-sizing: border-box;
          background: var(--card-background-color, var(--ha-card-background, #1c1c1c));
          box-shadow: var(--ha-card-box-shadow, none);
        }
        .clock-legend-row.interactive {
          cursor: pointer;
        }
        .clock-legend-row.interactive:hover {
          background: color-mix(
            in srgb,
            var(--primary-color) 10%,
            var(--card-background-color, #1c1c1c)
          );
        }
        .clock-legend-row.selected {
          outline: 2px solid
            color-mix(in srgb, var(--primary-color) 55%, transparent);
          outline-offset: -2px;
        }
        .clock-legend-row.interactive.selected:hover {
          background: color-mix(
            in srgb,
            var(--primary-color) 14%,
            var(--card-background-color, #1c1c1c)
          );
        }
        .clock-legend-row.out-of-area .clock-legend-title {
          color: var(--warning-color, var(--error-color));
        }
        .clock-legend-row.suggested {
          opacity: 0.92;
        }
        .clock-legend-row.unavailable {
          opacity: 0.55;
          filter: grayscale(1);
          pointer-events: none;
        }
        .clock-legend-row.unavailable .clock-legend-icon-wrap {
          background: color-mix(
            in srgb,
            var(--disabled-text-color, var(--secondary-text-color)) 18%,
            transparent
          );
          color: var(--disabled-text-color, var(--secondary-text-color));
        }
        .clock-legend-row.unavailable .clock-legend-title,
        .clock-legend-row.unavailable .clock-legend-sub,
        .light-row.unavailable .light-name {
          color: var(--disabled-text-color, var(--secondary-text-color));
        }
        .light-row.unavailable {
          opacity: 0.55;
          filter: grayscale(1);
          pointer-events: none;
        }
        .light-row.unavailable .light-bar {
          filter: grayscale(1);
        }
        .clock-legend-icon-wrap {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(
            in srgb,
            var(--clock-legend-accent, var(--state-light-color, #ff9800)) 22%,
            transparent
          );
          color: var(--clock-legend-accent, var(--state-light-color, #ff9800));
        }
        .clock-legend-icon-wrap .clock-legend-icon,
        .clock-legend-icon-wrap ha-state-icon,
        .clock-legend-icon-wrap ha-icon {
          --mdc-icon-size: 22px;
          --icon-primary-color: currentColor;
          width: 22px;
          height: 22px;
          color: inherit !important;
        }
        .clock-legend-meta {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .clock-legend-title {
          font-size: 15px;
          font-weight: 500;
          line-height: 1.25;
          color: var(--primary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clock-legend-sub {
          font-size: 13px;
          font-weight: 400;
          line-height: 1.25;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clock-legend-row .light-warn {
          position: static;
          transform: none;
          flex-shrink: 0;
          text-shadow: none;
        }
        .clock-legend-row .light-remove {
          position: static;
          transform: none;
          flex-shrink: 0;
          margin: 0;
          --mdc-icon-button-size: 36px;
        }
        .clock-legend-chevron {
          flex-shrink: 0;
          --mdc-icon-size: 20px;
          width: 20px;
          height: 20px;
          color: var(--secondary-text-color);
          opacity: 0.7;
        }
        .sun-location-override {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          padding: 10px 12px;
          border-radius: var(--ha-border-radius-lg, 12px);
          border: 1px solid var(--warning-color, var(--primary-color));
          background: color-mix(
            in srgb,
            var(--warning-color, var(--primary-color)) 18%,
            var(--card-background-color)
          );
        }
        .sun-location-override[hidden] {
          display: none;
        }
        .sun-location-override ha-icon {
          --mdc-icon-size: 22px;
          color: var(--warning-color, var(--primary-color));
          flex-shrink: 0;
        }
        .sun-location-copy {
          flex: 1 1 auto;
          min-width: 0;
        }
        .sun-location-copy .title {
          font-size: 13px;
          font-weight: 600;
        }
        .sun-location-copy .coords {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--secondary-text-color);
        }
        .location-dialog {
          --mdc-dialog-min-width: min(560px, 95vw);
        }
        .location-dialog ha-selector {
          display: block;
          margin-top: 8px;
        }
        .location-dialog p {
          margin: 0 0 8px;
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        .location-search {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          margin: 8px 0;
        }
        .location-search ha-textfield,
        .location-search ha-selector,
        .location-search input {
          flex: 1;
          min-width: 0;
        }
        .location-search-results {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0 0 8px;
        }
        .location-search-results button {
          margin: 0;
          padding: 8px 12px;
          border: 1px solid var(--divider-color);
          border-radius: var(--ha-border-radius-lg, 12px);
          background: var(--secondary-background-color, var(--card-background-color));
          color: inherit;
          font: inherit;
          font-size: 13px;
          text-align: start;
          cursor: pointer;
        }
        .location-search-results button:hover {
          border-color: var(--primary-color);
        }
        .location-dialog .error {
          margin: 0 0 8px;
        }
        .sun-fallback-note {
          margin: 8px 16px 0;
          font-size: 13px;
          color: var(--secondary-text-color);
        }
        .sun-lights {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding: 0;
          --light-feather: ${LIGHT_FEATHER_PX}px;
          /* Transition on the element that changes the variable (not the svg).
             --light-feather is registered via CSS.registerProperty. */
          transition: --light-feather 220ms cubic-bezier(0.2, 0, 0, 1);
        }
        .light-row {
          position: relative;
          z-index: 0;
          margin-top: -${LIGHT_FEATHER_PX}px;
          pointer-events: none;
        }
        .light-row:first-child {
          margin-top: 0;
        }
        /* Hovered / selected row paints above the next row’s fade. */
        .light-row:hover {
          z-index: 2;
        }
        .light-row.selected {
          z-index: 3;
        }
        .light-bar {
          position: relative;
          height: ${LIGHT_BAR_HEIGHT}px;
          cursor: pointer;
          /* Bar itself does not capture: the feathered top must stay
             pass-through so the previous row’s pencil hit stays usable.
             .light-bar-hit covers only the opaque strip. */
          pointer-events: none;
          transition: filter 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        .light-bar-hit {
          position: absolute;
          left: 0;
          right: 0;
          top: ${LIGHT_FEATHER_PX}px;
          bottom: 0;
          z-index: 1;
          pointer-events: auto;
          cursor: pointer;
        }
        /* First row has no incoming overlap to hide, so it is one feather
           shorter. Last row stays full height so its visible band matches
           the others. */
        .light-row:first-child .light-bar {
          height: ${LIGHT_BAR_EDGE_HEIGHT}px;
        }
        .light-row:first-child .light-bar-hit,
        .light-row:only-child .light-bar-hit {
          top: 0;
        }
        .light-row:only-child .light-bar {
          height: ${LIGHT_BAR_HEIGHT}px;
        }
        .light-row:not(.suggested):hover .light-bar {
          filter: brightness(1.12);
        }
        .light-row.selected:not(.suggested) .light-bar {
          filter: brightness(1.06)
            drop-shadow(0 0 2px var(--primary-color))
            drop-shadow(
              0 0 8px color-mix(in srgb, var(--primary-color) 55%, transparent)
            );
        }
        .light-row.selected:not(.suggested):hover .light-bar {
          filter: brightness(1.12)
            drop-shadow(0 0 2px var(--primary-color))
            drop-shadow(
              0 0 8px color-mix(in srgb, var(--primary-color) 55%, transparent)
            );
        }
        .light-bar svg {
          display: block;
          width: 100%;
          height: 100%;
          /* SVG default pointer-events is visiblePainted, so the masked
             incoming edge and unpainted gutters ate row clicks. The hit
             layer is the band target. */
          pointer-events: none;
          /* Fade only the incoming top over an opaque previous row. Hover
             shortens the fade; the opaque start stays at 36px so the
             visible band does not grow into the overlap. */
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            transparent calc(${LIGHT_FEATHER_PX}px - var(--light-feather)),
            #000 ${LIGHT_FEATHER_PX}px,
            #000 100%
          );
          mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            transparent calc(${LIGHT_FEATHER_PX}px - var(--light-feather)),
            #000 ${LIGHT_FEATHER_PX}px,
            #000 100%
          );
        }
        .light-row:first-child .light-bar svg,
        .light-row:only-child .light-bar svg {
          -webkit-mask-image: none;
          mask-image: none;
        }
        .sun-lights:hover {
          --light-feather: 1px;
        }
        .light-name {
          position: absolute;
          left: 16px;
          top: calc(${LIGHT_FEATHER_PX}px + (100% - ${LIGHT_FEATHER_PX}px) / 2);
          z-index: 1;
          margin: 0;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
          pointer-events: none;
          transform: translateY(-50%);
          text-shadow: 0 0 6px var(--card-background-color);
        }
        .light-row:first-child .light-name,
        .light-row:only-child .light-name {
          top: 50%;
        }
        .light-name .light-brightness {
          font-weight: 400;
          font-variant-numeric: tabular-nums;
        }
        .light-row.out-of-area .light-name {
          color: var(--warning-color, var(--error-color));
        }
        .light-row.suggested {
          margin-top: 4px;
        }
        .light-row.suggested:first-child {
          margin-top: 0;
        }
        .light-row:not(.suggested) + .light-row.suggested {
          margin-top: 8px;
        }
        .light-row.suggested .light-bar {
          height: 40px;
          cursor: default;
          pointer-events: auto;
          background: color-mix(
            in srgb,
            var(--secondary-text-color) 10%,
            var(--card-background-color)
          );
        }
        .light-row.suggested .light-bar-hit {
          display: none;
        }
        .light-row.suggested .light-name {
          top: 50%;
          color: var(--secondary-text-color);
        }
        .light-row.suggested .light-warn {
          top: 50%;
          right: 12px;
        }
        .light-edits {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(${LIGHT_FEATHER_PX}px + (100% - ${LIGHT_FEATHER_PX}px) / 2);
          height: 0;
          pointer-events: none;
          z-index: 2;
        }
        .light-row:first-child .light-edits,
        .light-row:only-child .light-edits {
          top: 50%;
        }
        .light-edit {
          position: absolute;
          top: 0;
          width: ${LIGHT_EDIT_HIT_PX}px;
          height: ${LIGHT_EDIT_HIT_PX}px;
          /* Hit is 40px; the idle disc stays 5px. Do not scale the disc:
             that stacked a second circle on ha-icon-button and drifted. */
          margin: -${LIGHT_EDIT_HIT_PX / 2}px 0 0 -${LIGHT_EDIT_HIT_PX / 2}px;
          padding: 0;
          overflow: visible;
          pointer-events: auto;
          cursor: pointer;
        }
        .light-edit-dot {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${LIGHT_EDIT_DOT_PX}px;
          height: ${LIGHT_EDIT_DOT_PX}px;
          border-radius: 50%;
          background: var(--primary-text-color);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
          pointer-events: none;
          transform: translate(-50%, -50%);
          transition: opacity 140ms cubic-bezier(0.2, 0, 0, 1);
        }
        .light-edit-action {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${LIGHT_EDIT_ACTION_PX}px;
          height: ${LIGHT_EDIT_ACTION_PX}px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: var(--primary-text-color);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          pointer-events: none;
          opacity: 0;
          transform: translate(-50%, -50%) scale(${LIGHT_EDIT_DOT_PX / LIGHT_EDIT_ACTION_PX});
          transform-origin: center center;
          transition:
            transform 140ms cubic-bezier(0.2, 0, 0, 1),
            opacity 140ms cubic-bezier(0.2, 0, 0, 1);
        }
        .light-edit-action ha-icon {
          --mdc-icon-size: 20px;
          color: var(--card-background-color);
        }
        .light-edit.expanded {
          z-index: 5;
        }
        .light-edit-dot.expanded {
          opacity: 0;
        }
        .light-edit-action.expanded {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
        .light-scene-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 0 0 12px;
        }
        .light-scene-list .sun-event {
          flex: 1 1 calc(50% - 6px);
          min-width: 5.5rem;
          max-width: none;
          padding: 6px 8px;
          gap: 1px;
        }
        .light-scene-list .sun-event ha-icon {
          --mdc-icon-size: 16px;
        }
        .light-scene-list .sun-event .name {
          font-size: 11px;
          white-space: normal;
        }
        .light-scene-list .sun-event .time {
          font-size: 10px;
          white-space: normal;
        }
        .light-scene-list .sun-event[aria-current="true"] {
          border-color: var(--primary-color);
          background: color-mix(
            in srgb,
            var(--primary-color) 14%,
            var(--card-background-color)
          );
        }
        .sidebar-note {
          margin: 0 0 8px;
          font-size: 13px;
          line-height: 1.4;
          color: var(--secondary-text-color);
        }
        .scene-sidebar-footer .sidebar-note {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin: 0;
        }
        .scene-sidebar-footer .sidebar-note ha-icon {
          --mdc-icon-size: 18px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .scene-sidebar-actions {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
        }
        .hue-wheel-stage {
          position: relative;
          margin: 8px -8px 0;
          padding: 28px 8px 16px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          /* Clear air between the disk and mode/preset chrome. */
          gap: 16px;
        }
        .hue-wheel-canvas {
          position: relative;
          width: 100%;
          max-width: 320px;
          margin: 0 auto;
          overflow: visible;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        .hue-wheel-glow,
        .hue-wheel-bg {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 50%;
        }
        .hue-wheel-glow {
          position: absolute;
          left: 0;
          top: 0;
          pointer-events: none;
          z-index: 0;
          transform: scale(1.1);
          transform-origin: center center;
          filter: blur(54px) saturate(1.45);
          opacity: 0.55;
        }
        .hue-wheel-bg {
          position: relative;
          z-index: 1;
          box-shadow: 0 2px 3px rgba(0, 0, 0, 0.4);
        }
        .hue-wheel-svg {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
          z-index: 2;
          color: white;
        }
        .hue-wheel-paths {
          pointer-events: none;
        }
        .hue-wheel-svg .hue-path-under {
          fill: none;
          stroke: rgba(0, 0, 0, 0.65);
          stroke-width: 6;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .hue-wheel-svg .hue-path-mid {
          fill: none;
          stroke: rgba(255, 255, 255, 0.92);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .hue-wheel-svg .hue-path-seg {
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .hue-wheel-svg .gm {
          cursor: pointer;
        }
        .hue-wheel-svg .marker-outline {
          fill: white;
          filter: url(#se-dot-shadow);
          transform: translate(-2px, -2px);
        }
        .hue-wheel-svg .marker {
          fill: currentColor;
        }
        .hue-wheel-svg .icon.text {
          font-size: 20px;
          font-weight: bold;
          paint-order: stroke fill;
        }
        .hue-wheel-svg .gm.off-mode {
          opacity: 0.7;
        }
        .hue-wheel-svg .gm.off-mode .marker-outline {
          display: none;
        }
        .hue-wheel-svg .gm.off-mode .marker {
          filter: url(#se-dot-shadow);
        }
        .hue-wheel-svg .gm.active .marker-outline,
        .hue-wheel-svg .gm.preview .marker-outline {
          display: none;
        }
        .hue-wheel-svg .gm.active .marker,
        .hue-wheel-svg .gm.preview .marker {
          filter: url(#se-active-shadow);
        }
        .hue-wheel-svg .gm:not(.active) .icon {
          display: none;
        }
        .hue-wheel-svg .gm.active.drag {
          scale: 1.1;
        }
        .hue-wheel-svg .gm.boing {
          animation: hue-marker-boing 150ms ease-in-out;
        }
        .hue-wheel-svg .gm.glide {
          transition: transform 0.4s ease-out, color 0.4s ease-out;
        }
        @keyframes hue-marker-boing {
          0% { scale: 0.7; }
          50% { scale: 1.05; translate: 0 -5px; }
          100% { scale: 1; }
        }
        .hue-wheel-chrome {
          position: relative;
          display: flex;
          flex-wrap: nowrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: 8px;
          pointer-events: none;
          z-index: 3;
        }
        .hue-mode-pill[hidden] {
          display: none !important;
        }
        .hue-wheel-chrome > * {
          pointer-events: auto;
        }
        .hue-mode-pill,
        .hue-presets {
          box-sizing: border-box;
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          min-height: 40px;
          padding: 8px;
          gap: 8px;
          margin-left: auto;
          min-width: 0;
          border-radius: 20px;
          box-shadow: 0 2px 3px rgba(0, 0, 0, 0.4);
          background: var(--secondary-background-color, #242022);
        }
        .hue-mode-pill {
          justify-content: flex-start;
          flex: 0 0 auto;
        }
        .hue-presets {
          position: relative;
          justify-content: flex-start;
          flex: 1 1 auto;
          overflow: hidden;
        }
        .hue-presets-track {
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: 8px;
          min-width: 0;
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .hue-presets::after {
          content: "";
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 32px;
          pointer-events: none;
          opacity: 0;
          border-radius: 0 20px 20px 0;
          background: linear-gradient(
            to right,
            transparent,
            var(--secondary-background-color, #242022)
          );
          box-shadow: inset -10px 0 12px -8px rgba(0, 0, 0, 0.45);
          transition: opacity 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .hue-presets.can-scroll-end::after {
          opacity: 1;
        }
        .hue-mode-btn,
        .hue-preset {
          box-sizing: border-box;
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          margin: 0;
          padding: 2px;
          border-radius: 50%;
          border: 2px solid transparent;
          background: transparent;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }
        .hue-mode-btn:hover,
        .hue-preset:hover {
          border-color: rgba(255, 255, 255, 0.45);
        }
        .hue-mode-btn.active,
        .hue-preset.active {
          border-color: #fff;
        }
        .hue-mode-swatch {
          display: block;
          width: 24px;
          height: 24px;
          border-radius: 50%;
        }
        .hue-mode-swatch.color {
          background: conic-gradient(
            #ff3b30,
            #ffcc00,
            #34c759,
            #5ac8fa,
            #007aff,
            #af52de,
            #ff3b30
          );
        }
        .hue-mode-swatch.temp {
          background: linear-gradient(#ffda95, #ffffff, #cbe4f3);
        }
        .hue-preset {
          background-clip: content-box;
          background-origin: content-box;
        }
        .light-brightness-graph {
          position: relative;
          width: 100%;
          margin: 0 0 12px;
          user-select: none;
          touch-action: none;
        }
        .light-brightness-graph-heading {
          display: flex;
          flex-direction: column;
          gap: 1px;
          margin: 0 0 6px;
        }
        .light-brightness-graph-title {
          font-size: 14px;
          font-weight: 500;
          line-height: 1.25;
          color: var(--primary-text-color);
        }
        .light-brightness-graph-sub {
          font-size: 12px;
          line-height: 1.25;
          color: var(--secondary-text-color);
        }
        .light-brightness-graph svg {
          display: block;
          width: 100%;
          height: 120px;
          overflow: visible;
        }
        .light-brightness-graph .bg-frame {
          fill: color-mix(
            in srgb,
            var(--secondary-text-color) 10%,
            var(--card-background-color)
          );
          stroke: var(--divider-color);
          stroke-width: 1;
        }
        .light-brightness-graph .fill-area {
          stroke: none;
        }
        .light-brightness-graph .curve {
          fill: none;
          stroke: var(--primary-text-color);
          stroke-width: 1.5;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.55;
        }
        .light-brightness-graph .handle {
          cursor: ns-resize;
        }
        .light-brightness-graph .handle.add {
          cursor: pointer;
        }
        .light-brightness-graph .handle-hit {
          fill: transparent;
          stroke: none;
        }
        .light-brightness-graph .handle-dot {
          fill: var(--card-background-color);
          stroke: var(--primary-text-color);
          stroke-width: 2;
        }
        .light-brightness-graph .handle.active .handle-dot {
          stroke: var(--primary-color);
          stroke-width: 2.5;
        }
        .light-brightness-graph .handle.add .handle-dot {
          stroke: var(--primary-color);
          stroke-dasharray: 3 2;
        }
        .light-brightness-graph .handle-fill {
          stroke: none;
        }
        .light-brightness-graph .handle-plus {
          fill: var(--primary-color);
          font-size: 14px;
          font-weight: 600;
          text-anchor: middle;
          dominant-baseline: central;
          pointer-events: none;
        }
        .light-brightness-graph .handle-label {
          fill: var(--secondary-text-color);
          font-size: 10px;
          text-anchor: middle;
        }
        .light-dialog ha-selector,
        .light-dialog ha-switch,
        .event-dialog ha-selector,
        .event-dialog ha-switch,
        .scene-sidebar-body ha-selector,
        .scene-sidebar-body ha-switch {
          display: block;
          margin-top: 16px;
        }
        .scene-sidebar.desktop {
          --ha-card-border-radius: var(
            --ha-dialog-border-radius,
            var(--ha-border-radius-2xl, 28px)
          );
          position: absolute;
          z-index: 7;
          top: calc(var(--header-height, 64px) + 16px);
          right: calc(16px + var(--safe-area-inset-right, 0px));
          width: var(--scene-sidebar-width, 375px);
          height: calc(
            100% - var(--header-height, 64px) - 32px -
              var(--safe-area-inset-bottom, 0px)
          );
          outline: none;
          pointer-events: none;
          transform: translateX(100%);
          opacity: 0;
          transition: transform ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .scene-sidebar.desktop.open {
          pointer-events: auto;
          transform: translateX(0);
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .scene-sidebar.desktop {
            transition-duration: 1ms;
          }
          .page-shell,
          .fab {
            transition-duration: 1ms;
          }
          .light-bar svg,
          .sun-lights,
          .sun-light-clock-rings,
          .light-edit-dot,
          .light-edit-action,
          .scene-sidebar-body,
          .scene-sidebar-footer,
          .hue-presets::after {
            transition-duration: 1ms;
          }
        }
        .scene-sidebar-body,
        .scene-sidebar-footer {
          transition: opacity ${SIDEBAR_SWAP_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .scene-sidebar-body.sidebar-pane-leave,
        .scene-sidebar-footer.sidebar-pane-leave,
        .scene-sidebar-body.sidebar-pane-enter,
        .scene-sidebar-footer.sidebar-pane-enter {
          opacity: 0;
        }
        .scene-sidebar.mobile {
          --ha-bottom-sheet-surface-background: var(--card-background-color);
          --ha-card-border-radius: var(
            --ha-dialog-border-radius,
            var(--ha-border-radius-2xl, 28px)
          );
        }
        .scene-sidebar-card {
          height: 100%;
          width: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-color: var(--primary-color);
          border-width: 2px;
          --ha-card-border-width: 2px;
          --ha-card-border-color: var(--primary-color);
        }
        .scene-sidebar-card ha-dialog-header {
          border-radius: var(--ha-card-border-radius);
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
        }
        .scene-sidebar-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          padding: 0 24px 16px;
        }
        .scene-sidebar-footer {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          padding: 12px 16px 16px;
          flex-shrink: 0;
        }
        .scene-sidebar-footer:has(.sidebar-note) {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          border-top: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }
        .live-edit-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          padding: 0 4px;
          color: var(--primary-text-color);
          font: inherit;
          font-size: 14px;
          cursor: pointer;
          user-select: none;
        }
        .live-edit-toggle ha-switch {
          --mdc-switch-track-width: 36px;
        }
        .dialog-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 16px;
        }
        .event-scene-field {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          margin-top: 16px;
        }
        .event-scene-field ha-selector {
          flex: 1;
          min-width: 0;
          margin-top: 0;
        }
        .event-scene-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .event-scene-hint,
        .event-scene-error {
          margin: 8px 0 0;
          font-size: 14px;
          line-height: 20px;
        }
        .event-scene-hint {
          color: var(--secondary-text-color);
        }
        .event-scene-error {
          color: var(--error-color);
        }
        .light-warn {
          position: absolute;
          right: 48px;
          top: calc(${LIGHT_FEATHER_PX}px + (100% - ${LIGHT_FEATHER_PX}px) / 2);
          z-index: 2;
          pointer-events: auto;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 4px;
          margin: 0;
          padding: 2px 6px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          font: inherit;
          font-size: 12px;
          color: var(--warning-color, var(--error-color));
          text-shadow: 0 0 6px var(--card-background-color);
          cursor: pointer;
        }
        .light-warn:hover {
          background: color-mix(
            in srgb,
            var(--warning-color, var(--error-color)) 18%,
            transparent
          );
        }
        .light-warn:focus-visible {
          outline: 2px solid var(--warning-color, var(--error-color));
          outline-offset: 2px;
        }
        .light-row:first-child .light-warn,
        .light-row:only-child .light-warn {
          top: 50%;
        }
        .light-remove {
          position: absolute;
          right: 4px;
          top: calc(${LIGHT_FEATHER_PX}px + (100% - ${LIGHT_FEATHER_PX}px) / 2);
          z-index: 2;
          transform: translateY(-50%);
          pointer-events: auto;
          --mdc-icon-button-size: 36px;
          color: var(--primary-text-color);
        }
        .light-row:first-child .light-remove,
        .light-row:only-child .light-remove {
          top: 50%;
        }
        .light-warn ha-icon {
          --mdc-icon-size: 14px;
        }
        .sun-events {
          display: flex;
          justify-content: space-evenly;
          align-items: stretch;
          gap: 8px;
          padding: 12px 16px 8px;
        }
        .sun-event {
          flex: 1 1 0;
          min-width: 0;
          max-width: 10.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 2px;
          margin: 0;
          padding: 10px 8px;
          border: 1px solid transparent;
          border-radius: var(--ha-border-radius-lg, 12px);
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: default;
        }
        .sun-event.clickable {
          cursor: pointer;
          background: var(--secondary-background-color, var(--card-background-color));
          border-color: var(--divider-color);
          box-shadow: var(--ha-box-shadow-s, 0 1px 2px rgba(0, 0, 0, 0.18));
          transform-origin: center center;
          transition:
            transform 160ms cubic-bezier(0.2, 0, 0, 1),
            border-color 160ms cubic-bezier(0.2, 0, 0, 1),
            background 160ms cubic-bezier(0.2, 0, 0, 1),
            box-shadow 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .sun-event.clickable:hover,
        .sun-event.clickable:focus-visible,
        .sun-event.clickable:active,
        .sun-event.clickable.selected {
          transform: scale(1.04);
        }
        .sun-event.clickable:hover {
          border-color: var(--primary-color);
          background: var(--card-background-color);
        }
        .sun-event.clickable:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .sun-event.clickable.missing {
          border: 2px solid var(--warning-color, var(--accent-color, var(--primary-color)));
          background: color-mix(
            in srgb,
            var(--warning-color, var(--primary-color)) 16%,
            var(--card-background-color)
          );
          box-shadow: none;
        }
        .sun-event.clickable.missing:hover {
          background: color-mix(
            in srgb,
            var(--warning-color, var(--primary-color)) 24%,
            var(--card-background-color)
          );
        }
        .sun-event.clickable.selected {
          border-color: var(--primary-color);
          border-width: 2px;
          background: color-mix(
            in srgb,
            var(--primary-color) 14%,
            var(--card-background-color)
          );
        }
        .sun-event.clickable.missing.selected {
          border-color: var(--primary-color);
        }
        .sun-event ha-icon {
          --mdc-icon-size: 22px;
          color: var(--primary-text-color);
        }
        .sun-event .name {
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
        }
        .sun-event .time {
          font-size: 12px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }
        .sun-event .time .solar-struck {
          text-decoration: line-through;
          opacity: 0.65;
          margin-right: 0.35em;
        }
        .sun-event .time .clamp-time {
          color: var(--primary-text-color);
          font-weight: 600;
        }
        .sun-event .scene {
          font-size: 11px;
          color: var(--primary-color);
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sun-event .scene.empty {
          color: var(--warning-color, var(--accent-color, var(--primary-color)));
          font-weight: 600;
        }
        .sun-chart {
          position: relative;
          height: ${CHART_HEIGHT}px;
        }
        /* Same L/T/R surface vignette as dial (table view elevation chart). */
        .sun-chart::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          background:
            linear-gradient(
              to right,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 22%, transparent) 36px,
              transparent 96px
            ),
            linear-gradient(
              to left,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 22%, transparent) 36px,
              transparent 96px
            ),
            linear-gradient(
              to bottom,
              color-mix(in srgb, var(--primary-background-color) 50%, transparent) 0%,
              color-mix(in srgb, var(--primary-background-color) 22%, transparent) 40px,
              transparent 110px
            );
        }
        .sun-chart svg {
          display: block;
          width: 100%;
          height: ${CHART_HEIGHT}px;
        }
        /* Dial-style event buttons anchored on the elevation curve. */
        .sun-chart .clock-event {
          position: absolute;
          inset: auto;
          left: 0;
          top: 0;
          width: 32px;
          height: 32px;
          margin: 0;
          transform: translate(-50%, -50%);
          z-index: 2;
        }
        .sun-chart .clock-event:hover,
        .sun-chart .clock-event:focus-visible,
        .sun-chart .clock-event:active,
        .sun-chart .clock-event.selected {
          transform: translate(-50%, -50%) scale(1.12);
        }
        .sun-chart .clock-event.ghost {
          width: 22px;
          height: 22px;
        }
        .sun-chart .clock-event.ghost:hover,
        .sun-chart .clock-event.ghost:focus-visible,
        .sun-chart .clock-event.ghost:active,
        .sun-chart .clock-event.ghost.selected {
          transform: translate(-50%, -50%);
        }
        /* List chart: same look, not interactive. */
        .sun-chart .clock-event.inert {
          cursor: default;
          pointer-events: none;
          box-shadow: none;
          border-color: color-mix(
            in srgb,
            var(--divider-color) 70%,
            var(--primary-text-color) 30%
          );
          background: color-mix(
            in srgb,
            var(--card-background-color) 88%,
            var(--primary-text-color) 12%
          );
        }
        .sun-chart .clock-event.inert:hover,
        .sun-chart .clock-event.inert:focus-visible,
        .sun-chart .clock-event.inert:active,
        .sun-chart .clock-event.inert.selected {
          transform: translate(-50%, -50%);
        }
        .sun-chart .clock-event.inert.missing {
          box-shadow: none;
        }
        .sun-hours {
          display: flex;
          justify-content: space-between;
          padding: 0 1.6% 10px;
          color: var(--secondary-text-color);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .sun-hover-readout {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 16px;
          min-height: 36px;
          padding: 4px 16px 8px;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          color: var(--secondary-text-color);
        }
        .sun-hover-readout[data-active] {
          color: var(--primary-text-color);
        }
        /* Dial: float over the face so the readout does not push the clock down. */
        .sun-path.dial-view .sun-path-body {
          position: relative;
        }
        .sun-path.dial-view .sun-hover-readout {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 4;
          min-height: 0;
          margin: 0;
          padding: 8px 16px;
          pointer-events: none;
          color: var(--primary-text-color);
        }
        .sun-hover-time {
          font-weight: 500;
        }
        .sun-hover-reset {
          pointer-events: auto;
          display: inline-grid;
          place-items: center;
          width: 32px;
          height: 32px;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: color-mix(
            in srgb,
            var(--primary-color) 14%,
            var(--card-background-color)
          );
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
        }
        .sun-hover-reset:hover {
          background: color-mix(
            in srgb,
            var(--primary-color) 24%,
            var(--card-background-color)
          );
        }
        .sun-hover-reset ha-icon {
          --mdc-icon-size: 18px;
        }
        .sun-plots {
          position: relative;
          cursor: crosshair;
        }
        .sun-now-line,
        .sun-hover-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          margin-left: -1px;
          pointer-events: none;
        }
        .sun-now-line {
          background: var(--primary-color);
          z-index: 2;
        }
        .sun-hover-line {
          background: var(--primary-text-color);
          opacity: 0.55;
          z-index: 3;
          display: none;
        }
        .sun-plots[data-hovering] .sun-hover-line {
          display: block;
        }
        .sun-now {
          position: absolute;
          width: 10px;
          height: 10px;
          margin-left: -5px;
          margin-top: -5px;
          border-radius: 50%;
          background: var(--primary-color);
          border: 2px solid var(--card-background-color);
          box-sizing: border-box;
          pointer-events: none;
        }
        .sun-dot {
          position: absolute;
          width: 9px;
          height: 9px;
          margin-left: -4.5px;
          margin-top: -4.5px;
          border-radius: 50%;
          background: transparent;
          border: 2px solid var(--secondary-text-color);
          box-sizing: border-box;
          pointer-events: none;
          opacity: 0.55;
        }
        .sun-dot.clamp-tick {
          width: 6px;
          height: 6px;
          margin-left: -3px;
          margin-top: -3px;
          border-width: 1.5px;
          border-style: dashed;
          border-color: var(--secondary-text-color);
          background: transparent;
          opacity: 0.75;
        }
        .sun-clamp-link {
          position: absolute;
          height: 0;
          border: none;
          border-top: 1px dashed var(--secondary-text-color);
          opacity: 0.55;
          pointer-events: none;
          transform-origin: left center;
        }
        .page-shell {
          box-sizing: border-box;
          width: 100%;
          padding-right: var(--scene-sidebar-gutter);
          overflow: visible;
          transition: padding-right ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .page {
          --page-max-width: 1024px;
          max-width: var(--page-max-width);
          width: 100%;
          margin-inline: auto;
          padding-inline: 12px;
          box-sizing: border-box;
        }
        .page.dial-wide {
          --page-max-width: none;
          max-width: none;
          padding-inline: 0;
          /* Extend under the sidebar gutter; in-flow content keeps padding so
             the dial still shifts left while horizon backgrounds span full width. */
          margin-right: calc(-1 * var(--scene-sidebar-gutter));
          width: calc(100% + var(--scene-sidebar-gutter));
          padding-right: var(--scene-sidebar-gutter);
          /* FAB clearance under the light list (~156px). */
          padding-bottom: 156px;
          box-sizing: border-box;
          position: relative;
          /* Event chips sit near the face edge — do not clip them. */
          overflow: visible;
          transition:
            margin-right ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1),
            width ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1),
            padding-right ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        /* Must follow .page.dial-wide { overflow: visible } — that shorthand
           was overriding an earlier mobile overflow-x and letting
           .clock-horizon-back widen ha-top-app-bar’s .ha-scrollbar.
           Only clip the page shell / dial-wide — not stage/body/clock, or
           overflow-x:clip promotes overflow-y to a scrollport and the huge
           absolute horizon-back inflates scroll height below the light list. */
        @media (max-width: 870px) {
          .page-shell,
          .page.dial-wide,
          .sun-path.dial-view {
            overflow-x: clip;
          }
        }
        /* Sidebar open: let horizon/bloom paint under the drawer (desktop). */
        :host([data-sidebar-docked]) .page-shell,
        :host([data-sidebar-docked]) .page.dial-wide,
        :host([data-sidebar-docked]) .sun-path.dial-view,
        :host([data-sidebar-docked]) .sun-path-stage,
        :host([data-sidebar-docked]) .sun-path-body,
        :host([data-sidebar-docked]) .sun-light-clock {
          overflow: visible;
        }
        /* Shared inset for draft + location banners (dial zeroes .page padding). */
        .page-banners {
          position: relative;
          z-index: 5;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: var(--ha-space-3);
          margin-inline: 12px;
        }
        .page-banners[hidden] {
          display: none;
        }
        .draft-restore {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          padding: 10px 12px;
          border-radius: var(--ha-border-radius-lg, 12px);
          border: 1px solid var(--info-color, var(--primary-color));
          background: color-mix(
            in srgb,
            var(--info-color, var(--primary-color)) 14%,
            var(--card-background-color)
          );
        }
        .draft-restore[hidden] {
          display: none;
        }
        .draft-restore ha-icon {
          --mdc-icon-size: 22px;
          color: var(--info-color, var(--primary-color));
          flex-shrink: 0;
        }
        .draft-restore-copy {
          flex: 1 1 auto;
          min-width: 0;
        }
        .draft-restore-copy .title {
          font-size: 13px;
          font-weight: 600;
        }
        .draft-restore-copy .detail {
          font-size: 12px;
          line-height: 1.35;
          color: var(--secondary-text-color);
        }
        .draft-restore-dismiss {
          flex-shrink: 0;
          margin-inline-end: -4px;
        }
        .content {
          position: relative;
          z-index: 5;
          padding: var(--ha-space-3) 0 88px;
        }
        /* Dial editor leaves content empty — do not reserve FAB pad twice. */
        .content:empty {
          display: none;
          padding: 0;
        }
        .content.wide {
          width: 100%;
          box-sizing: border-box;
        }
        .card-content {
          padding: 16px;
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .list-tab-group {
          display: block;
          margin: 0 0 12px;
          --ha-tab-indicator-color: var(--primary-color);
        }
        .row.created-scene {
          cursor: pointer;
        }
        .list-settings-dialog .setup-link-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 0;
        }
        .list-settings-dialog .setup-link-row ha-switch {
          flex-shrink: 0;
          margin-top: 2px;
        }
        .list-settings-dialog .automatically-update-lights-interval-row {
          flex-direction: column;
          align-items: stretch;
        }
        .list-settings-dialog .automatically-update-lights-interval-row ha-selector {
          width: 100%;
          margin-top: 8px;
        }
        .row .row-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .row .row-actions ha-icon-button {
          --mdc-icon-button-size: 40px;
          color: var(--secondary-text-color);
        }
        /* Shared with create-wizard mode cards; list uses the same chrome. */
        .setup-mode-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          width: 100%;
          text-align: left;
          padding: 14px 16px;
          border-radius: var(--ha-border-radius-lg, 12px);
          border: 2px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          cursor: pointer;
          box-sizing: border-box;
        }
        /* After .setup-mode-card so row layout wins (same specificity otherwise
           leaves the switch under the copy). */
        .setup-mode-card.list-aul-card {
          margin-bottom: 12px;
          flex-direction: row;
          align-items: center;
          gap: 12px;
        }
        .list-aul-card .aul-copy {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .list-aul-card .mode-detail {
          padding-left: 30px;
        }
        .list-aul-card ha-switch {
          flex-shrink: 0;
          pointer-events: auto;
        }
        .setup-mode-card:hover {
          border-color: color-mix(in srgb, var(--primary-color) 45%, var(--divider-color));
        }
        .setup-mode-card.selected {
          border-color: var(--primary-color);
          background: color-mix(
            in srgb,
            var(--primary-color) 10%,
            var(--card-background-color)
          );
        }
        .setup-mode-card .mode-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 600;
        }
        .setup-mode-card .mode-title ha-icon {
          --mdc-icon-size: 22px;
          color: var(--primary-color);
        }
        .setup-mode-card .mode-detail {
          font-size: 13px;
          line-height: 1.35;
          color: var(--secondary-text-color);
          padding-left: 30px;
        }
        /* Scene list: HA data-table-like surface (custom panels cannot load
           ha-data-table reliably — lazy chunk, Lit column templates). */
        .list.scene-table {
          gap: 0;
          border: 1px solid var(--divider-color);
          border-radius: var(--ha-card-border-radius, 12px);
          overflow: hidden;
          background: var(--card-background-color);
        }
        .list.scene-table .scene-table-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 16px;
          height: 48px;
          box-sizing: border-box;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          border-bottom: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }
        .list.scene-table .scene-table-group {
          display: flex;
          align-items: center;
          padding: 8px 16px;
          box-sizing: border-box;
          font-size: 14px;
          font-weight: 500;
          color: var(--secondary-text-color);
          background: var(--primary-background-color);
          border-bottom: 1px solid var(--divider-color);
        }
        .list.scene-table .scene-table-header .meta {
          flex: 1;
          min-width: 0;
        }
        .list.scene-table .scene-table-header .row-actions {
          width: 88px;
          flex-shrink: 0;
        }
        .list.scene-table .row {
          border: none;
          border-radius: 0;
          border-bottom: 1px solid var(--divider-color);
          background: transparent;
        }
        .list.scene-table .row:last-child {
          border-bottom: none;
        }
        .list.scene-table .row:hover {
          background: color-mix(
            in srgb,
            var(--primary-text-color) 6%,
            var(--card-background-color)
          );
        }
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          box-sizing: border-box;
          width: 100%;
          max-width: 480px;
          margin-inline: auto;
          padding: 48px 24px 112px;
          /* Prefer the scrollport height over 100vh so empty states do not
             force a second scrollbar outside ha-top-app-bar. */
          min-height: calc(100% - 96px);
        }
        .empty-state > ha-icon {
          --mdc-icon-size: 80px;
          color: var(--primary-text-color);
          margin-bottom: 16px;
        }
        .empty-state h1 {
          margin: 0 0 16px;
          font-size: 1.5rem;
          font-weight: 400;
          line-height: 1.3;
          color: var(--primary-text-color);
        }
        .empty-state p {
          margin: 0 0 12px;
          font-size: 14px;
          line-height: 1.5;
          color: var(--secondary-text-color);
        }
        .empty-state a.learn-more {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-top: 8px;
          color: var(--primary-color);
          text-decoration: none;
          font-size: 14px;
        }
        .empty-state a.learn-more:hover {
          text-decoration: underline;
        }
        .empty-state a.learn-more ha-icon {
          --mdc-icon-size: 16px;
        }
        .empty {
          text-align: center;
          padding: 48px 16px;
          color: var(--secondary-text-color);
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          cursor: pointer;
          border: 1px solid var(--divider-color);
        }
        .row:hover {
          background: var(--secondary-background-color);
        }
        .row ha-icon,
        .row ha-state-icon {
          color: var(--secondary-text-color);
          --mdc-icon-size: 24px;
        }
        .row .meta {
          flex: 1;
          min-width: 0;
        }
        .row .name {
          font-weight: 500;
        }
        .row .sub {
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        /* Corner overlay matching hass-subpage #fab. ha-top-app-bar-fixed has
           no fab slot, so this sits as a sibling of the app bar. */
        .fab {
          position: absolute;
          right: calc(
            16px + var(--safe-area-inset-right, 0px) +
              var(--scene-sidebar-gutter)
          );
          bottom: calc(16px + var(--safe-area-inset-bottom, 0px));
          z-index: 6;
          --ha-button-box-shadow: var(--ha-box-shadow-l);
          transform-origin: bottom right;
          transition:
            right ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1),
            opacity 180ms cubic-bezier(0.2, 0, 0, 1),
            transform 180ms cubic-bezier(0.2, 0, 0, 1),
            visibility 180ms;
        }
        /* Prefer class over [hidden] so opacity/scale can animate (UA hidden is display:none). */
        .fab.is-hidden {
          opacity: 0;
          transform: scale(0.85);
          visibility: hidden;
          pointer-events: none;
        }
        .save-dialog ha-input,
        .save-dialog ha-textarea,
        .save-dialog ha-labels-picker,
        .save-dialog ha-category-picker,
        .save-dialog ha-selector,
        .area-dialog ha-selector,
        .confirm-dialog p {
          display: block;
          margin-top: 16px;
        }
        .area-dialog {
          --mdc-dialog-min-width: min(440px, 95vw);
        }
        .area-dialog .setup-step {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 8px;
        }
        .area-dialog .setup-step[hidden] {
          display: none;
        }
        .area-dialog .setup-mode-cards {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .area-dialog .setup-error {
          margin: 0;
          color: var(--error-color);
          font-size: 13px;
          line-height: 1.35;
        }
        .area-dialog .setup-intro {
          margin: 0;
          color: var(--primary-text-color);
          font-size: 14px;
          line-height: 1.45;
        }
        .area-dialog .setup-intro .muted {
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .area-dialog .setup-slot {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .area-dialog .setup-slot ha-selector {
          display: block;
          margin-top: 0;
        }
        .area-dialog .setup-link-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 4px 0 8px;
        }
        .area-dialog .setup-link-row span {
          font-size: 14px;
          line-height: 1.3;
        }
        .area-dialog .setup-link-helper {
          margin: -4px 0 8px;
          font-size: 12px;
          line-height: 1.35;
          color: var(--secondary-text-color);
        }
        .save-dialog ha-chip-set {
          margin-top: 16px;
        }
        .error {
          color: var(--error-color);
          margin: 0 0 16px;
        }
        button.fallback {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border: 0;
          border-radius: 8px;
          padding: 8px 16px;
          cursor: pointer;
        }
        button.fallback.danger {
          background: var(--error-color);
        }
        button.fallback.ghost {
          background: transparent;
          color: var(--primary-color);
        }
        ha-icon-button {
          --mdc-icon-button-size: 40px;
          color: inherit;
        }
      </style>
      <ha-top-app-bar-fixed>
        <div slot="title"></div>
        <div class="page-shell">
        <div class="page">
          <div class="page-banners" hidden>
            <div class="sun-location-override" hidden>
              <ha-icon icon="mdi:map-marker"></ha-icon>
              <div class="sun-location-copy">
                <div class="title">Previewing another location</div>
                <div class="coords"></div>
              </div>
              <ha-button class="sun-location-change" appearance="plain">Change</ha-button>
              <ha-icon-button class="sun-location-reset" label="Use home location">
                <ha-icon icon="mdi:close"></ha-icon>
              </ha-icon-button>
            </div>
            <div class="draft-restore" hidden>
              <ha-icon icon="mdi:history"></ha-icon>
              <div class="draft-restore-copy">
                <div class="title"></div>
                <div class="detail"></div>
              </div>
              <ha-button class="draft-restore-discard" appearance="plain">Discard</ha-button>
              <ha-icon-button class="draft-restore-dismiss" label="Dismiss">
                <ha-icon icon="mdi:close"></ha-icon>
              </ha-icon-button>
            </div>
          </div>
          <div class="sun-path" hidden>
            <div class="sun-path-stage">
              <div class="sun-path-body"></div>
              <div class="sun-year-scrub-rail" hidden></div>
            </div>
          </div>
          <div class="content"></div>
        </div>
        </div>
      </ha-top-app-bar-fixed>
      <div class="fab" hidden></div>
    `;
    this._appBar = this.shadowRoot.querySelector("ha-top-app-bar-fixed");
    this._appBar.narrow = Boolean(this._narrow);
    this._headerEl = this.shadowRoot.querySelector("[slot='title']");
    this._sunPathEl = this.shadowRoot.querySelector(".sun-path");
    this._sunPathStage = this.shadowRoot.querySelector(".sun-path-stage");
    this._sunPathBodyEl = this.shadowRoot.querySelector(".sun-path-body");
    this._clockScrubRail = this.shadowRoot.querySelector(".sun-year-scrub-rail");
    this._contentEl = this.shadowRoot.querySelector(".content");
    this._fabEl = this.shadowRoot.querySelector(".fab");
    this._draftBanner = this.shadowRoot.querySelector(".draft-restore");
    this._draftBanner
      ?.querySelector(".draft-restore-discard")
      ?.addEventListener("click", () => this._discardRestoredDraft());
    this._draftBanner
      ?.querySelector(".draft-restore-dismiss")
      ?.addEventListener("click", () => {
        this._draftBannerDismissed = true;
        this._syncDraftBanner();
      });
    // Location banner lives with draft under .page-banners (shared inset).
    this._locationBanner = this.shadowRoot.querySelector(
      ".sun-location-override",
    );
    this._locationCoords = this._locationBanner?.querySelector(".coords");
    this._locationBanner
      ?.querySelector(".sun-location-change")
      ?.addEventListener("click", () => this._openLocationDialog());
    this._locationBanner
      ?.querySelector(".sun-location-reset")
      ?.addEventListener("click", () => this._setPreviewLocation(null));
    this._syncDarkModeAttr();
    this._syncHash();
  }

  _currentHash() {
    if (this._view === "edit") {
      return this._editId ? `edit/${this._editId}` : "new";
    }
    return "";
  }

  _hashHref(hash) {
    const suffix = hash ? `#${hash}` : "";
    return `${window.location.pathname}${window.location.search}${suffix}`;
  }

  async _go(hash) {
    if (!(await this._confirmLeaveEditor())) {
      return;
    }
    this._forceCloseSceneSidebar();
    window.location.hash = hash;
  }

  async _syncHash() {
    if (this._hashConfirming) {
      return;
    }
    const hash = (window.location.hash || "#").replace(/^#/, "");
    const current = this._currentHash();
    if (
      hash !== current &&
      (this._lightEditIsDirty() || this._needsLeaveConfirm())
    ) {
      this._hashConfirming = true;
      history.replaceState(null, "", this._hashHref(current));
      const leave = await this._confirmLeaveEditor();
      this._hashConfirming = false;
      if (!leave) {
        return;
      }
      this._forceCloseSceneSidebar();
      window.location.hash = hash;
      return;
    }
    if (this._view === "edit" && hash !== current) {
      this._flushPersistedDraft();
    }
    this._leaveConfirmDone = false;
    if (hash === "new") {
      const pending = this._pendingNewForm;
      this._pendingNewForm = null;
      this._view = "edit";
      this._editId = null;
      this._entityId = null;
      this._formData = pending
        ? { ...emptyFormData(), ...pending }
        : emptyFormData();
      this._error = null;
      this._resetSession();
      this._draftRestore = pending ? null : this._restorePersistedDraft();
      this._draftBannerDismissed = false;
      this._render();
      if (!this._formData.area) {
        this._openAreaDialog({ context: "new" });
      }
      return;
    }
    const match = hash.match(/^edit\/(.+)$/);
    if (match) {
      this._view = "edit";
      this._editId = match[1];
      this._error = null;
      this._loadItem(this._editId);
      return;
    }
    this._view = "list";
    this._editId = null;
    this._entityId = null;
    this._loadList();
  }

  async _loadList() {
    try {
      const [items, managed, settings] = await Promise.all([
        this._hass.callWS({ type: `${DOMAIN}/list` }),
        this._hass.callWS({ type: `${DOMAIN}/list_managed_native_scenes` }),
        this._hass.callWS({ type: `${DOMAIN}/get_settings` }),
      ]);
      this._items = items;
      this._managedScenes = managed || [];
      this._settings = {
        hide_managed_native_scenes: true,
        automatically_update_lights_interval: 300,
        ...(settings || {}),
      };
      this._error = null;
    } catch (err) {
      this._error = err.message || String(err);
      this._items = [];
      this._managedScenes = [];
    }
    this._render();
  }

  async _loadItem(sceneId) {
    try {
      const item = await this._hass.callWS({
        type: `${DOMAIN}/get`,
        scene_id: sceneId,
      });
      this._entityId = item.entity_id || null;
      this._formData = { ...emptyFormData(), ...(item.form || item) };
    } catch (err) {
      this._error = err.message || String(err);
      this._entityId = null;
      this._formData = emptyFormData();
    }
    this._resetSession();
    this._draftRestore = this._restorePersistedDraft();
    this._draftBannerDismissed = false;
    this._render();
  }

  _loc(key, fallback, vars) {
    const localize = this._hass?.localize;
    if (typeof localize !== "function") {
      return fallback;
    }
    const value = vars ? localize(key, vars) : localize(key);
    if (!value || value === key) {
      return fallback;
    }
    return value;
  }

  /** Panel/integration string from translations/<lang>.json (frontend.* / config.*). */
  _t(path, fallback, vars) {
    return this._loc(`component.${DOMAIN}.${path}`, fallback, vars);
  }

  _fieldLabel(name) {
    return this._t(
      `frontend.fields.${name}.label`,
      LABELS[name] || name
    );
  }

  _fieldHelper(name) {
    return this._t(
      `frontend.fields.${name}.helper`,
      HELPERS[name] || ""
    );
  }

  async _ensureTranslations() {
    if (!this._hass || this._translationsReady) {
      return;
    }
    this._translationsReady = true;
    try {
      await Promise.all([
        this._hass.loadBackendTranslation("frontend", DOMAIN),
        this._hass.loadBackendTranslation("config", DOMAIN),
      ]);
    } catch (_err) {
      // Fallback English constants remain in _t / LABELS.
    }
  }

  _render() {
    if (!this._built) {
      return;
    }
    if (this._view === "edit") {
      this._renderEditor();
    } else {
      this._draftRestore = null;
      this._renderList();
    }
    this._ensureSunPath();
    this._syncDraftBanner();
  }

  _renderList({ keepSidebar = false } = {}) {
    if (!keepSidebar) {
      this._closeSceneSidebar();
    }
    // Allow clock enter again the next time an editor opens.
    this._clockEnterPlayed = false;
    this._clockStickySeconds = undefined;
    this._liveEdit = false;
    this._liveEditSidebarHandler = null;
    this._cancelClockSunArc();
    this._cancelSunPathMorph();
    this._forgetClockDom();
    this._form = undefined;
    // Drop dial preview state so the list chart uses the light sun_path API.
    if (this._sunPathKey && !String(this._sunPathKey).startsWith("list-sun:")) {
      this._sunPath = null;
      this._sunPathKey = undefined;
    }
    this._headerEl.textContent = this._t(
      "frontend.title",
      "Circadian Scenes"
    );
    this._setNavigationIcon(this._menuButton());
    this._contentEl.classList.remove("wide");
    this._syncEditorChrome();

    if (this._error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = this._error;
      this._contentEl.replaceChildren(error);
      this._setActionItems(this._listSettingsButton());
      this._setFab(this._addButton());
      return;
    }

    const page = document.createElement("div");
    const tabs = document.createElement("ha-tab-group");
    tabs.className = "list-tab-group";
    tabs.tabOnly = true;
    tabs.active = this._listTab;
    const tabMeta = [
      {
        id: "extrapolation",
        label: this._t("frontend.tabs.extrapolation", "Extrapolation scenes"),
      },
      {
        id: "created",
        label: this._t("frontend.tabs.created", "Created scenes"),
      },
    ];
    for (const tab of tabMeta) {
      const item = document.createElement("ha-tab-group-tab");
      item.slot = "nav";
      item.panel = tab.id;
      item.textContent = tab.label;
      if (this._listTab === tab.id) {
        item.active = true;
      }
      tabs.appendChild(item);
    }
    tabs.addEventListener("wa-tab-show", (ev) => {
      const next = ev.detail?.name;
      if (!next || next === this._listTab) {
        return;
      }
      this._listTab = next;
      this._renderList();
    });
    page.appendChild(tabs);

    if (this._listTab === "created") {
      if (!this._managedScenes.length) {
        page.appendChild(
          this._buildEmptyState({
            icon: "mdi:palette-swatch-outline",
            title: this._t(
              "frontend.empty.created_title",
              "No created scenes yet"
            ),
            paragraphs: [
              this._t(
                "frontend.empty.created_body",
                "Native Home Assistant scenes created by Circadian Scenes show up here — from Automatic setup or Create new scene on a solar event."
              ),
            ],
            learnMore: false,
          })
        );
      } else {
        const wrap = document.createElement("div");
        wrap.className = "list scene-table";
        const header = document.createElement("div");
        header.className = "scene-table-header";
        const headerIcon = document.createElement("div");
        headerIcon.style.width = "24px";
        headerIcon.style.flexShrink = "0";
        const headerMeta = document.createElement("div");
        headerMeta.className = "meta";
        headerMeta.textContent = this._t("frontend.list.column_name", "Name");
        const headerActions = document.createElement("div");
        headerActions.className = "row-actions";
        header.append(headerIcon, headerMeta, headerActions);
        wrap.appendChild(header);
        for (const group of this._groupScenesByArea(this._managedScenes, "name")) {
          const groupEl = document.createElement("div");
          groupEl.className = "scene-table-group";
          groupEl.textContent = group.label;
          wrap.appendChild(groupEl);
          for (const item of group.items) {
            wrap.appendChild(this._managedSceneRow(item, { grouped: true }));
          }
        }
        page.appendChild(wrap);
      }
    } else if (!this._items.length) {
      page.appendChild(
        this._buildEmptyState({
          icon: "mdi:white-balance-sunny",
          title: this._t(
            "frontend.empty.extrapolation_title",
            "Start lighting with the sun"
          ),
          paragraphs: [
            this._t(
              "frontend.empty.extrapolation_body",
              "Circadian Scenes blend your room’s lights between solar events — dawn, sunrise, noon, sunset, and dusk — so brightness and color follow the day."
            ),
            this._t(
              "frontend.empty.extrapolation_example",
              "Create a scene for a room, assign native scenes to each solar event, then activate it. Optional automatic updates keep adjusting the lights on an interval after that."
            ),
          ],
          learnMore: true,
        })
      );
    } else {
      page.appendChild(this._buildAutomaticallyUpdateLightsCard());
      const wrap = document.createElement("div");
      wrap.className = "list scene-table";
      const header = document.createElement("div");
      header.className = "scene-table-header";
      const headerIcon = document.createElement("div");
      headerIcon.style.width = "24px";
      headerIcon.style.flexShrink = "0";
      const headerMeta = document.createElement("div");
      headerMeta.className = "meta";
      headerMeta.textContent = this._t("frontend.list.column_name", "Name");
      const headerActions = document.createElement("div");
      headerActions.className = "row-actions";
      header.append(headerIcon, headerMeta, headerActions);
      wrap.appendChild(header);
      for (const item of this._items) {
        wrap.appendChild(this._listRow(item));
      }
      page.appendChild(wrap);
    }
    this._contentEl.replaceChildren(page);
    this._setActionItems(this._listSettingsButton());
    this._setFab(this._addButton());
  }

  _buildEmptyState({ icon, title, paragraphs, learnMore = false }) {
    const el = document.createElement("div");
    el.className = "empty-state";
    const iconEl = document.createElement("ha-icon");
    iconEl.setAttribute("icon", icon);
    el.appendChild(iconEl);
    const heading = document.createElement("h1");
    heading.textContent = title;
    el.appendChild(heading);
    for (const text of paragraphs) {
      const p = document.createElement("p");
      p.textContent = text;
      el.appendChild(p);
    }
    if (learnMore) {
      const link = document.createElement("a");
      link.className = "learn-more";
      link.href = "https://github.com/etokheim/scene_extrapolation";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = this._t("frontend.empty.learn_more", "Learn more");
      const openIcon = document.createElement("ha-icon");
      openIcon.setAttribute("icon", "mdi:open-in-new");
      link.appendChild(openIcon);
      el.appendChild(link);
    }
    return el;
  }

  _automaticallyUpdateLightsIntervalSeconds() {
    return Number(this._settings?.automatically_update_lights_interval ?? 300);
  }

  _buildAutomaticallyUpdateLightsCard() {
    const interval = this._automaticallyUpdateLightsIntervalSeconds();
    const on = interval > 0;
    if (on) {
      this._aulResumeInterval = interval;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `setup-mode-card list-aul-card${on ? " selected" : ""}`;
    btn.setAttribute("aria-pressed", on ? "true" : "false");

    const copy = document.createElement("div");
    copy.className = "aul-copy";
    const titleRow = document.createElement("div");
    titleRow.className = "mode-title";
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:brightness-auto");
    const title = document.createElement("span");
    title.textContent = this._t(
      "frontend.settings.automatically_update_lights",
      "Automatically update lights"
    );
    titleRow.append(icon, title);
    const detail = document.createElement("div");
    detail.className = "mode-detail";
    detail.textContent = on
      ? this._t(
          "frontend.settings.automatically_update_lights_on_helper",
          "After you activate a scene, lights keep adjusting on the interval from Settings so the room follows the sun. Tap to turn this off for every room."
        )
      : this._t(
          "frontend.settings.automatically_update_lights_off_helper",
          "Automatic updates are off. Activating a scene applies lights once. Tap to turn updates back on for every room."
        );
    copy.append(titleRow, detail);

    const toggle = document.createElement("ha-switch");
    toggle.checked = on;
    toggle.setAttribute(
      "aria-label",
      this._t(
        "frontend.settings.automatically_update_lights",
        "Automatically update lights"
      )
    );

    const apply = async (nextOn) => {
      const current = this._automaticallyUpdateLightsIntervalSeconds();
      const currentlyOn = current > 0;
      if (nextOn === currentlyOn) {
        toggle.checked = currentlyOn;
        return;
      }
      const resume =
        this._aulResumeInterval > 0 ? this._aulResumeInterval : 300;
      const nextSeconds = nextOn ? resume : 0;
      btn.disabled = true;
      toggle.disabled = true;
      try {
        if (currentlyOn && current > 0) {
          this._aulResumeInterval = current;
        }
        const result = await this._hass.callWS({
          type: `${DOMAIN}/update_settings`,
          settings: { automatically_update_lights_interval: nextSeconds },
        });
        this._settings = {
          hide_managed_native_scenes: true,
          automatically_update_lights_interval: 300,
          ...(result?.settings || {}),
        };
        if (this._view === "list") {
          this._renderList({ keepSidebar: true });
        }
      } catch (err) {
        toggle.checked = currentlyOn;
        window.alert(err.message || String(err));
      } finally {
        btn.disabled = false;
        toggle.disabled = false;
      }
    };

    // Switch handles its own pointer; don't also fire the card click.
    toggle.addEventListener("click", (ev) => ev.stopPropagation());
    toggle.addEventListener("change", () => {
      void apply(Boolean(toggle.checked));
    });
    btn.addEventListener("click", () => {
      void apply(!toggle.checked);
    });

    btn.append(copy, toggle);
    return btn;
  }

  _groupScenesByArea(items, nameKey) {
    const noArea = this._t("frontend.common.no_area", "No area");
    const groups = new Map();
    for (const item of items) {
      const key = item.area_id || "";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: item.area_name || noArea,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }
    const sorted = [...groups.values()];
    sorted.sort((a, b) => {
      if (!a.key && b.key) {
        return 1;
      }
      if (a.key && !b.key) {
        return -1;
      }
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    for (const group of sorted) {
      group.items.sort((a, b) => {
        const an =
          this._entityFriendlyName(a.entity_id, a[nameKey]) || a[nameKey] || "";
        const bn =
          this._entityFriendlyName(b.entity_id, b[nameKey]) || b[nameKey] || "";
        return an.localeCompare(bn, undefined, { sensitivity: "base" });
      });
    }
    return sorted;
  }

  _listSettingsButton() {
    const btn = document.createElement("ha-icon-button");
    btn.label = this._t("frontend.settings.title", "Settings");
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:cog");
    btn.appendChild(icon);
    btn.addEventListener("click", () => this._openListSettingsSidebar());
    return btn;
  }

  _listRow(item) {
    const row = document.createElement("div");
    row.className = "row";
    row.addEventListener("click", () => this._go(`edit/${item.id}`));

    row.appendChild(
      this._entityStateIcon(item.entity_id, "mdi:auto-fix")
    );

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent =
      this._entityFriendlyName(item.entity_id, item.scene_name) ||
      this._t("frontend.common.untitled", "Untitled");
    const sub = document.createElement("div");
    sub.className = "sub";
    const objectId = this._entityObjectId(item.entity_id);
    const subBits = [];
    if (item.area_name) {
      subBits.push(item.area_name);
    }
    if (objectId) {
      subBits.push(objectId);
    }
    sub.textContent =
      subBits.join(" · ") ||
      this._t("frontend.common.no_area", "No area");
    meta.append(name, sub);
    row.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const settingsBtn = document.createElement("ha-icon-button");
    settingsBtn.label = this._t(
      "frontend.settings.scene_settings",
      "Scene settings"
    );
    const settingsIcon = document.createElement("ha-icon");
    settingsIcon.setAttribute("icon", "mdi:cog-outline");
    settingsBtn.appendChild(settingsIcon);
    settingsBtn.disabled = !item.entity_id;
    settingsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!item.entity_id) {
        return;
      }
      this._showEntityMoreInfo(item.entity_id, "settings");
    });
    const deleteBtn = document.createElement("ha-icon-button");
    deleteBtn.label = this._loc("ui.common.delete", "Delete");
    const deleteIcon = document.createElement("ha-icon");
    deleteIcon.setAttribute("icon", "mdi:delete-outline");
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const confirmed = await this._confirmExtrapolationDelete(
        this._entityFriendlyName(item.entity_id, item.scene_name) ||
          item.entity_id ||
          item.id
      );
      if (!confirmed) {
        return;
      }
      try {
        await this._hass.callWS({
          type: `${DOMAIN}/delete`,
          scene_id: item.id,
        });
        this._clearPersistedDraft(item.id);
        await this._loadList();
      } catch (err) {
        this._error = err.message || String(err);
        this._renderList();
      }
    });
    actions.append(settingsBtn, deleteBtn);
    row.appendChild(actions);
    return row;
  }

  _managedSceneRow(item, { grouped = false } = {}) {
    const row = document.createElement("div");
    row.className = "row created-scene";
    row.addEventListener("click", () => {
      this._showEntityMoreInfo(item.entity_id, "settings");
    });

    row.appendChild(
      this._entityStateIcon(item.entity_id, "mdi:palette")
    );

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent =
      this._entityFriendlyName(item.entity_id, item.name) ||
      this._t("frontend.common.untitled", "Untitled");
    const sub = document.createElement("div");
    sub.className = "sub";
    const bits = [];
    // Area is the group header when grouped — keep object id / hidden only.
    if (!grouped && item.area_name) {
      bits.push(item.area_name);
    }
    const objectId = this._entityObjectId(item.entity_id);
    if (objectId) {
      bits.push(objectId);
    }
    if (item.hidden) {
      bits.push(
        this._t("frontend.settings.hidden_in_ha", "Hidden in Home Assistant")
      );
    }
    sub.textContent = bits.join(" · ") || objectId || "";
    meta.append(name, sub);
    row.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const settingsBtn = document.createElement("ha-icon-button");
    settingsBtn.label = this._t(
      "frontend.settings.scene_settings",
      "Scene settings"
    );
    const settingsIcon = document.createElement("ha-icon");
    settingsIcon.setAttribute("icon", "mdi:cog-outline");
    settingsBtn.appendChild(settingsIcon);
    settingsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._showEntityMoreInfo(item.entity_id, "settings");
    });
    const deleteBtn = document.createElement("ha-icon-button");
    deleteBtn.label = `Delete ${item.name || "scene"}`;
    const deleteIcon = document.createElement("ha-icon");
    deleteIcon.setAttribute("icon", "mdi:delete-outline");
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const confirmed = await this._confirmNativeSceneDelete(
        this._entityFriendlyName(item.entity_id, item.name) || item.entity_id
      );
      if (!confirmed) {
        return;
      }
      try {
        await this._hass.callWS({
          type: `${DOMAIN}/delete_native_scene`,
          scene_entity_id: item.entity_id,
        });
        await this._loadList();
      } catch (err) {
        this._error = err.message || String(err);
        this._renderList();
      }
    });
    actions.append(settingsBtn, deleteBtn);
    row.appendChild(actions);
    return row;
  }

  async _openListSettingsSidebar() {
    const existing = this.shadowRoot?.querySelector(
      ".scene-sidebar.list-settings-dialog"
    );
    if (existing && !existing._closing) {
      await this._requestCloseSceneSidebar(existing);
      return;
    }
    const opened = await this._openSceneSidebar({
      title: this._t("frontend.settings.title", "Settings"),
      className: "list-settings-dialog",
    });
    if (!opened) {
      return;
    }
    const { body } = opened;
    const note = document.createElement("p");
    note.className = "sidebar-note";
    note.textContent = this._t(
      "frontend.settings.intro",
      "These settings apply to every room. Changes take effect immediately."
    );
    body.appendChild(note);

    const row = document.createElement("div");
    row.className = "setup-link-row";
    const labelWrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "name";
    label.textContent = this._t(
      "frontend.settings.hide_created",
      "Hide created scenes in Home Assistant"
    );
    const helper = document.createElement("div");
    helper.className = "sidebar-note";
    helper.style.margin = "4px 0 0";
    helper.textContent = this._t(
      "frontend.settings.hide_created_helper",
      "Marks native scenes created by this integration as hidden in the HA UI (entity registry). You can still manage them here."
    );
    labelWrap.append(label, helper);
    const toggle = document.createElement("ha-switch");
    toggle.checked = Boolean(this._settings?.hide_managed_native_scenes);
    toggle.addEventListener("change", async () => {
      const next = Boolean(toggle.checked);
      toggle.disabled = true;
      try {
        const result = await this._hass.callWS({
          type: `${DOMAIN}/update_settings`,
          settings: { hide_managed_native_scenes: next },
        });
        this._settings = {
          hide_managed_native_scenes: true,
          automatically_update_lights_interval: 300,
          ...(result?.settings || {}),
        };
        this._managedScenes = await this._hass.callWS({
          type: `${DOMAIN}/list_managed_native_scenes`,
        });
        // Refresh list badges without dismissing this settings sidebar.
        if (this._view === "list") {
          this._renderList({ keepSidebar: true });
        }
      } catch (err) {
        toggle.checked = !next;
        window.alert(err.message || String(err));
      } finally {
        toggle.disabled = false;
      }
    });
    row.append(labelWrap, toggle);
    body.appendChild(row);

    const intervalRow = document.createElement("div");
    intervalRow.className = "setup-link-row automatically-update-lights-interval-row";
    const intervalLabelWrap = document.createElement("div");
    const intervalLabel = document.createElement("div");
    intervalLabel.className = "name";
    intervalLabel.textContent = this._t(
      "frontend.settings.automatically_update_lights_interval",
      "Automatically update lights interval"
    );
    const intervalHelper = document.createElement("div");
    intervalHelper.className = "sidebar-note";
    intervalHelper.style.margin = "4px 0 0";
    intervalHelper.textContent = this._t(
      "frontend.settings.automatically_update_lights_interval_helper",
      "After a scene is activated, keep updating the lights this often with the same transition length (target = how the room should look at the end of the transition). 0 turns automatic updates off for every room — same as the control at the top of the list."
    );
    intervalLabelWrap.append(intervalLabel, intervalHelper);
    const intervalField = document.createElement("ha-selector");
    intervalField.hass = this._hass;
    intervalField.label = this._t(
      "frontend.settings.automatically_update_lights_interval_minutes",
      "Minutes"
    );
    const currentSeconds = Number(this._settings?.automatically_update_lights_interval ?? 300);
    intervalField.value = Math.round(currentSeconds / 60);
    intervalField.selector = {
      number: { min: 0, max: 30, step: 1, mode: "box", unit_of_measurement: "min" },
    };
    let intervalSaveTimer;
    const saveInterval = async () => {
      const minutes = Number(intervalField.value);
      const seconds = Number.isFinite(minutes)
        ? Math.max(0, Math.min(30, Math.round(minutes))) * 60
        : 300;
      try {
        const result = await this._hass.callWS({
          type: `${DOMAIN}/update_settings`,
          settings: { automatically_update_lights_interval: seconds },
        });
        this._settings = {
          hide_managed_native_scenes: true,
          automatically_update_lights_interval: 300,
          ...(result?.settings || {}),
        };
        const saved = Number(
          this._settings.automatically_update_lights_interval || 0
        );
        if (saved > 0) {
          this._aulResumeInterval = saved;
        }
        intervalField.value = Math.round(saved / 60);
        if (this._view === "list") {
          this._renderList({ keepSidebar: true });
        }
      } catch (err) {
        intervalField.value = Math.round(currentSeconds / 60);
        window.alert(err.message || String(err));
      }
    };
    intervalField.addEventListener("value-changed", (ev) => {
      window.clearTimeout(intervalSaveTimer);
      intervalSaveTimer = window.setTimeout(saveInterval, 400);
      ev.stopPropagation();
    });
    intervalRow.append(intervalLabelWrap, intervalField);
    body.appendChild(intervalRow);
  }

  _addButton() {
    return this._fabButton("New extrapolation scene", "mdi:plus", () => {
      if (this._hasPersistedDraft("new")) {
        this._go("new");
        return;
      }
      this._openAreaDialog({ context: "list" });
    });
  }

  _setFab(node) {
    if (!this._fabEl) {
      return;
    }
    if (this._fabHideTimer) {
      window.clearTimeout(this._fabHideTimer);
      this._fabHideTimer = undefined;
    }
    if (!node) {
      this._fabEl.classList.add("is-hidden");
      this._fabHideTimer = window.setTimeout(() => {
        this._fabHideTimer = undefined;
        if (this._fabEl?.classList.contains("is-hidden")) {
          this._fabEl.replaceChildren();
          this._fabEl.setAttribute("hidden", "");
        }
      }, 200);
      return;
    }
    this._fabEl.removeAttribute("hidden");
    this._fabEl.replaceChildren(node);
    this._fabEl.classList.add("is-hidden");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._fabEl?.classList.remove("is-hidden");
      });
    });
  }

  /** Editor Save FAB: always on #new; only while dirty for existing scenes. */
  _syncSaveFab() {
    if (this._view !== "edit") {
      return;
    }
    // New scenes are unsaved until the first successful save — keep Save visible
    // even when the post-wizard form still matches the session baseline.
    const show = !this._editId || this._sessionIsDirty();
    if (!show) {
      if (this._saveFabVisible || this._fabEl?.childElementCount) {
        this._setFab(null);
      }
      this._saveFabVisible = false;
      return;
    }
    if (
      this._saveFabVisible &&
      this._fabEl &&
      !this._fabEl.classList.contains("is-hidden") &&
      this._fabEl.childElementCount
    ) {
      return;
    }
    this._saveFabVisible = true;
    this._setFab(
      this._fabButton(
        this._t("frontend.common.save", "Save"),
        "mdi:content-save",
        () => {
          if (!this._editId) {
            this._openSaveDialog();
            return;
          }
          this._save();
        }
      )
    );
  }

  _fabButton(label, icon, onClick) {
    const button = document.createElement("ha-button");
    button.size = "l";
    button.variant = "brand";
    button.appearance = "accent";
    const haIcon = document.createElement("ha-icon");
    haIcon.setAttribute("icon", icon);
    haIcon.slot = "start";
    button.append(haIcon, document.createTextNode(label));
    button.addEventListener("click", onClick);
    return button;
  }

  _setActionItems(...nodes) {
    for (const child of [...this._appBar.children]) {
      if (child.getAttribute("slot") === "actionItems") {
        child.remove();
      }
    }
    for (const node of nodes) {
      if (!node) {
        continue;
      }
      node.slot = "actionItems";
      this._appBar.appendChild(node);
    }
  }

  _setEditorActions() {
    this._lightView = this._readLightView();
    const liveToggle = document.createElement("label");
    liveToggle.className = "live-edit-toggle";
    const liveLabel = document.createElement("span");
    liveLabel.textContent = this._t("frontend.actions.live_edit", "Live edit");
    const liveSwitch = document.createElement("ha-switch");
    liveSwitch.checked = Boolean(this._liveEdit);
    liveSwitch.addEventListener("change", () => {
      this._setLiveEdit(Boolean(liveSwitch.checked));
    });
    liveToggle.append(liveLabel, liveSwitch);
    this._liveEditSwitch = liveSwitch;

    if (this._narrow) {
      // Location + view live in the overflow menu on narrow (with undo/redo).
      this._locationBtn = null;
      this._lightViewToggleBtn = null;
      this._setActionItems(liveToggle, this._overflowMenu());
      this._syncLocationToolbar();
      return;
    }

    const locationBtn = document.createElement("ha-icon-button");
    locationBtn.className = "sun-location-btn";
    locationBtn.label = "Preview another location";
    const locationIcon = document.createElement("ha-icon");
    locationIcon.setAttribute("icon", "mdi:map-marker-outline");
    locationBtn.appendChild(locationIcon);
    locationBtn.addEventListener("click", () => this._openLocationDialog());
    this._locationBtn = locationBtn;

    const viewBtn = document.createElement("ha-button");
    viewBtn.className = "light-view-toggle-btn";
    viewBtn.appearance = "plain";
    viewBtn.addEventListener("click", () => {
      this._setLightView(this._lightView === "dial" ? "table" : "dial");
    });
    this._lightViewToggleBtn = viewBtn;
    this._syncLightViewButtons();

    const undo = this._undoRedoButton("undo");
    const redo = this._undoRedoButton("redo");
    this._undoBtn = undo;
    this._redoBtn = redo;
    this._setActionItems(
      liveToggle,
      locationBtn,
      viewBtn,
      undo,
      redo,
      this._overflowMenu()
    );
    this._syncUndoButtons();
    this._syncLocationToolbar();
  }

  _syncLiveEditControl() {
    if (this._liveEditSwitch) {
      this._liveEditSwitch.checked = Boolean(this._liveEdit);
    }
  }

  async _setLiveEdit(on) {
    const next = Boolean(on);
    if (this._liveEdit === next) {
      this._syncLiveEditControl();
      return;
    }
    this._liveEdit = next;
    this._syncLiveEditControl();
    if (typeof this._liveEditSidebarHandler === "function") {
      await this._liveEditSidebarHandler(next);
    }
  }

  _undoRedoButton(kind) {
    const undo = kind === "undo";
    const button = document.createElement("ha-icon-button");
    button.id = undo ? "button-undo" : "button-redo";
    button.label = undo
      ? this._loc("ui.common.undo", "Undo")
      : this._loc("ui.common.redo", "Redo");
    button.disabled = undo ? !this._undoStack.length : !this._redoStack.length;
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", undo ? "mdi:undo" : "mdi:redo");
    button.appendChild(icon);
    button.addEventListener("click", () => {
      if (undo) {
        this._undo();
      } else {
        this._redo();
      }
    });
    if (customElements.get("ha-tooltip")) {
      const tip = document.createElement("ha-tooltip");
      tip.setAttribute("for", button.id);
      tip.placement = "bottom";
      const label = document.createElement("span");
      label.textContent = `${button.label} `;
      const shortcut = document.createElement("span");
      shortcut.className = "shortcut";
      shortcut.textContent = this._shortcutLabel(undo ? "undo" : "redo");
      tip.append(label, shortcut);
      button.appendChild(tip);
    }
    return button;
  }

  _shortcutLabel(kind) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    if (kind === "undo") {
      return mac ? "⌘Z" : "Ctrl+Z";
    }
    return mac ? "⌘⇧Z" : "Ctrl+Y";
  }

  _resetSession() {
    this._nativeDrafts = {};
    this._undoStack = [];
    this._redoStack = [];
    this._previewOverlay = null;
    this._sessionBaseline = this._snapshotSession();
    this._syncUndoButtons();
    this._syncSaveFab();
  }

  _snapshotSession() {
    return {
      form: structuredClone(this._formData),
      nativeDrafts: structuredClone(this._nativeDrafts),
    };
  }

  _sessionEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  _sessionIsDirty() {
    if (!this._sessionBaseline) {
      return Object.keys(this._nativeDrafts).length > 0;
    }
    return !this._sessionEqual(this._snapshotSession(), this._sessionBaseline);
  }

  _editorIsDirty() {
    return this._lightEditIsDirty() || this._sessionIsDirty();
  }

  _needsLeaveConfirm() {
    // _go and hashchange both call confirm — skip the second pass.
    if (this._leaveConfirmDone) {
      return false;
    }
    if (this._view !== "edit") {
      return false;
    }
    // Never persisted to HA yet.
    if (!this._editId) {
      return true;
    }
    return this._sessionIsDirty();
  }

  async _confirmLeaveEditor() {
    if (this._lightEditIsDirty() && !(await this._confirmLeaveLightEdit())) {
      return false;
    }
    if (this._needsLeaveConfirm()) {
      const discard = await this._confirmDiscard({
        title: this._t(
          "frontend.dialogs.unsaved_title",
          "Unsaved changes"
        ),
        text: this._t(
          "frontend.dialogs.unsaved_text",
          "You have unsaved changes. Discard them?"
        ),
      });
      if (!discard) {
        return false;
      }
      this._clearPersistedDraft();
      if (!this._editId) {
        this._clearPersistedDraft("new");
      }
      this._leaveConfirmDone = true;
      return true;
    }
    this._flushPersistedDraft();
    return true;
  }

  _draftStorageKey(sceneKey = this._editId || "new") {
    const user = this._hass?.user?.id || "anon";
    return `scene_extrapolation.draft.v1.${user}.${sceneKey}`;
  }

  _lightViewStorageKey() {
    const user = this._hass?.user?.id || "anon";
    return `scene_extrapolation.lightView.v${LIGHT_VIEW_STORAGE_VERSION}.${user}`;
  }

  _readLightView() {
    try {
      const raw = window.localStorage.getItem(this._lightViewStorageKey());
      // Explicit table stays table; migrate legacy "clock" → dial.
      if (raw === "table") {
        return "table";
      }
      return "dial";
    } catch (_err) {
      return "dial";
    }
  }

  _setLightView(view) {
    const next = view === "dial" || view === "clock" ? "dial" : "table";
    if (this._lightView === next) {
      this._syncLightViewButtons();
      this._syncEditorChrome();
      return;
    }
    this._lightView = next;
    try {
      window.localStorage.setItem(this._lightViewStorageKey(), next);
    } catch (_err) {
      /* ignore quota / private mode */
    }
    this._syncLightViewButtons();
    this._syncEditorChrome();
    // Narrow: view label lives in the overflow menu — rebuild so it updates.
    if (this._narrow && this._view === "edit") {
      this._setEditorActions();
    }
    if (this._sunPath) {
      this._drawSunPath();
    } else {
      this._syncYearScrubLayout();
    }
  }

  _syncEditorChrome() {
    const dial =
      this._view === "edit" && this._lightView === "dial";
    this.shadowRoot?.querySelector(".page")?.classList.toggle("dial-wide", dial);
    this._sunPathEl?.classList.toggle("dial-view", dial);
  }

  _syncLightViewButtons() {
    if (!this._lightViewToggleBtn) {
      return;
    }
    // Label is the destination view (single toggle in the app bar).
    this._lightViewToggleBtn.textContent =
      this._lightView === "dial"
        ? this._t("frontend.actions.table_view", "Table view")
        : this._t("frontend.actions.dial_view", "Dial view");
    this._lightViewToggleBtn.setAttribute(
      "aria-label",
      this._lightView === "dial" ? "Switch to table view" : "Switch to dial view"
    );
  }

  _readPersistedDraft(sceneKey) {
    try {
      const raw = window.localStorage.getItem(this._draftStorageKey(sceneKey));
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw);
      if (
        payload?.v !== DRAFT_STORAGE_VERSION ||
        !payload.session ||
        !payload.baseline
      ) {
        return null;
      }
      return payload;
    } catch (_err) {
      return null;
    }
  }

  _hasPersistedDraft(sceneKey) {
    const payload = this._readPersistedDraft(sceneKey);
    if (!payload) {
      return false;
    }
    return !this._sessionEqual(payload.session, payload.baseline);
  }

  _restorePersistedDraft() {
    const payload = this._readPersistedDraft(this._editId || "new");
    if (!payload) {
      return null;
    }
    // Existing scenes: drop the draft if HA's form moved on since we buffered.
    // #new has no server entity — after refresh we always reset to emptyFormData(),
    // so comparing baseline to that "server" would wipe every post-wizard draft.
    if (this._editId) {
      const server = this._snapshotSession();
      if (!this._sessionEqual(payload.baseline, server)) {
        this._clearPersistedDraft();
        return null;
      }
      if (this._sessionEqual(payload.session, server)) {
        this._clearPersistedDraft();
        return null;
      }
    } else if (this._sessionEqual(payload.session, payload.baseline)) {
      this._clearPersistedDraft();
      return null;
    }
    this._formData = structuredClone(payload.session.form);
    this._nativeDrafts = structuredClone(payload.session.nativeDrafts);
    // Keep the buffered baseline so dirty/discard match the pre-refresh session.
    this._sessionBaseline = structuredClone(payload.baseline);
    this._syncPreviewOverlay();
    this._clearPreviewCache();
    return { savedAt: payload.savedAt };
  }

  _persistDraftSoon() {
    if (this._persistTimer) {
      window.clearTimeout(this._persistTimer);
    }
    this._persistTimer = window.setTimeout(() => {
      this._persistTimer = undefined;
      this._flushPersistedDraft();
    }, DRAFT_PERSIST_MS);
  }

  _flushPersistedDraft() {
    if (this._persistTimer) {
      window.clearTimeout(this._persistTimer);
      this._persistTimer = undefined;
    }
    if (this._view !== "edit") {
      return;
    }
    if (!this._sessionIsDirty() || !this._sessionBaseline) {
      this._clearPersistedDraft();
      if (this._draftRestore) {
        this._draftRestore = null;
        this._syncDraftBanner();
      }
      return;
    }
    const payload = {
      v: DRAFT_STORAGE_VERSION,
      savedAt: Date.now(),
      baseline: this._sessionBaseline,
      session: this._snapshotSession(),
    };
    try {
      window.localStorage.setItem(this._draftStorageKey(), JSON.stringify(payload));
    } catch (_err) {
      // Private mode / quota: keep the in-memory session only.
    }
  }

  _clearPersistedDraft(sceneKey) {
    try {
      window.localStorage.removeItem(this._draftStorageKey(sceneKey));
    } catch (_err) {
      // Ignore storage failures.
    }
  }

  _formatDraftAge(savedAt) {
    const ms = Date.now() - savedAt;
    if (!Number.isFinite(ms) || ms < 0) {
      return "a moment ago";
    }
    const sec = Math.round(ms / 1000);
    if (sec < 45) {
      return "a moment ago";
    }
    const min = Math.round(sec / 60);
    if (min === 1) {
      return "a minute ago";
    }
    if (min < 45) {
      return `${min} minutes ago`;
    }
    const hr = Math.round(min / 60);
    if (hr === 1) {
      return "an hour ago";
    }
    if (hr < 22) {
      return `${hr} hours ago`;
    }
    const day = Math.round(hr / 24);
    if (day === 1) {
      return "yesterday";
    }
    if (day < 7) {
      return `${day} days ago`;
    }
    try {
      return new Date(savedAt).toLocaleDateString();
    } catch (_err) {
      return "earlier";
    }
  }

  _syncDraftBanner() {
    const el = this._draftBanner;
    if (!el) {
      return;
    }
    const show =
      this._view === "edit" &&
      Boolean(this._draftRestore) &&
      this._sessionIsDirty() &&
      !this._draftBannerDismissed;
    el.hidden = !show;
    this._syncPageBannersVisibility();
    if (!show) {
      return;
    }
    const age = this._formatDraftAge(this._draftRestore.savedAt);
    el.querySelector(".title").textContent = "Picked up where you left off";
    el.querySelector(".detail").textContent =
      `Unsaved edits from ${age}. This browser only — save the scene to keep them.`;
  }

  _syncPageBannersVisibility() {
    const stack = this.shadowRoot?.querySelector(".page-banners");
    if (!stack) {
      return;
    }
    const anyVisible = [...stack.children].some((child) => !child.hidden);
    stack.hidden = !anyVisible;
    // Banner show/hide changes the dial height budget and vignette reach.
    if (this._sunPathEl?.classList.contains("dial-view")) {
      requestAnimationFrame(() => this._syncDialHeightBudget());
    }
  }

  async _discardRestoredDraft() {
    if (
      !(await this._confirmDiscard({
        title: "Discard local edits?",
        text: "This returns the scene to the last saved version and forgets the copy on this browser.",
      }))
    ) {
      return;
    }
    this._applySession(this._sessionBaseline);
    this._undoStack = [];
    this._redoStack = [];
    this._syncUndoButtons();
    this._clearPersistedDraft();
    this._draftRestore = null;
    this._render();
    if (!this._editId && !this._formData.area) {
      this._openAreaDialog({ context: "new" });
    }
  }

  _commitUndo() {
    this._undoStack.push(this._snapshotSession());
    if (this._undoStack.length > UNDO_STACK_LIMIT) {
      this._undoStack.shift();
    }
    this._redoStack = [];
    this._syncUndoButtons();
    queueMicrotask(() => {
      this._persistDraftSoon();
      this._syncSaveFab();
    });
  }

  _applySession(snapshot) {
    this._forceCloseSceneSidebar();
    this._formData = structuredClone(snapshot.form);
    this._nativeDrafts = structuredClone(snapshot.nativeDrafts);
    this._syncEditorSceneTitle();
    this._syncPreviewOverlay();
    this._sunPath = null;
    this._clearPreviewCache();
    this._syncUndoButtons();
    this._persistDraftSoon();
    this._syncSaveFab();
    this._ensureSunPath();
  }

  _undo() {
    if (!this._undoStack.length) {
      return;
    }
    this._redoStack.push(this._snapshotSession());
    this._applySession(this._undoStack.pop());
  }

  _redo() {
    if (!this._redoStack.length) {
      return;
    }
    this._undoStack.push(this._snapshotSession());
    this._applySession(this._redoStack.pop());
  }

  _syncUndoButtons() {
    if (this._undoBtn) {
      this._undoBtn.disabled = !this._undoStack.length;
    }
    if (this._redoBtn) {
      this._redoBtn.disabled = !this._redoStack.length;
    }
  }

  _handleEditorShortcut(ev) {
    if (this._view !== "edit" || !this.isConnected) {
      return;
    }
    if (!ev.ctrlKey && !ev.metaKey) {
      return;
    }
    if (ev.altKey) {
      return;
    }
    const path = ev.composedPath();
    if (
      path.some((node) => {
        const tag = node.tagName;
        return (
          node.isContentEditable ||
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT"
        );
      })
    ) {
      return;
    }
    const key = ev.key.toLowerCase();
    if (key === "z" && ev.shiftKey) {
      ev.preventDefault();
      this._redo();
      return;
    }
    if (key === "z") {
      ev.preventDefault();
      this._undo();
      return;
    }
    if (key === "y") {
      ev.preventDefault();
      this._redo();
    }
  }

  _ensureNativeDraft(sceneId) {
    if (!this._nativeDrafts[sceneId]) {
      this._nativeDrafts[sceneId] = { entities: {} };
    }
    if (!this._nativeDrafts[sceneId].entities) {
      this._nativeDrafts[sceneId].entities = {};
    }
    return this._nativeDrafts[sceneId];
  }

  async _waitForEntity(entityId, timeoutMs = 4000) {
    if (!entityId) {
      return;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this._hass?.states?.[entityId]) {
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  _overlayFromDrafts(extra = []) {
    const overlay = [];
    for (const [sceneId, draft] of Object.entries(this._nativeDrafts)) {
      if (draft.deleted) {
        overlay.push({ scene_entity_id: sceneId, deleted: true });
        continue;
      }
      if (draft.created) {
        const entities = {};
        for (const [entityId, state] of Object.entries(draft.entities || {})) {
          if (state != null) {
            entities[entityId] = state;
          }
        }
        overlay.push({
          scene_entity_id: sceneId,
          create_scene: {
            name: draft.name,
            icon: draft.icon,
            entities,
          },
        });
        continue;
      }
      if (draft.name) {
        overlay.push({ scene_entity_id: sceneId, name: draft.name });
      }
      for (const [entityId, state] of Object.entries(draft.entities || {})) {
        if (state == null) {
          overlay.push({
            scene_entity_id: sceneId,
            entity_id: entityId,
            remove: true,
          });
        } else {
          overlay.push({
            scene_entity_id: sceneId,
            entity_id: entityId,
            entity_state: state,
          });
        }
      }
    }
    overlay.push(...extra);
    return overlay.length ? overlay : null;
  }

  _syncPreviewOverlay(extra) {
    this._previewOverlay = this._overlayFromDrafts(extra);
  }

  _assignedSceneIds() {
    const ids = new Set();
    for (const key of Object.values(EVENT_SCENE_KEYS)) {
      if (this._formData[key]) {
        ids.add(this._formData[key]);
      }
    }
    if (this._formData.scene_dawn_sunrise_sunset) {
      ids.add(this._formData.scene_dawn_sunrise_sunset);
    }
    return [...ids].filter((id) => !this._nativeDrafts[id]?.deleted);
  }

  _removeLightFromAssignedScenes(entityId) {
    const scenes = this._assignedSceneIds();
    if (!scenes.length) {
      return;
    }
    this._commitUndo();
    for (const sceneId of scenes) {
      this._ensureNativeDraft(sceneId).entities[entityId] = null;
    }
    this._syncPreviewOverlay();
    this._sunPathKey = undefined;
    this._ensureSunPath();
  }

  _missingSceneRows(light) {
    const missing = [];
    const seen = new Set();
    for (const row of light.event_states || []) {
      if (!row.scene_entity_id || seen.has(row.scene_entity_id)) {
        continue;
      }
      if (this._nativeDrafts[row.scene_entity_id]?.deleted) {
        continue;
      }
      const draftEntity =
        this._nativeDrafts[row.scene_entity_id]?.entities?.[light.entity_id];
      // Truthy draft = added in session; null = removed; else use row.present.
      if (draftEntity) {
        continue;
      }
      const isMissing = draftEntity === null ? true : !row.present;
      if (!isMissing) {
        continue;
      }
      seen.add(row.scene_entity_id);
      missing.push(row);
    }
    return missing;
  }

  _peerStatesInScene(sceneId, exceptEntityId) {
    const peers = [];
    for (const light of this._sunPath?.lights || []) {
      if (light.entity_id === exceptEntityId) {
        continue;
      }
      const row = (light.event_states || []).find(
        (item) => item.scene_entity_id === sceneId && item.present
      );
      if (row?.state) {
        peers.push(row.state);
      }
    }
    return peers;
  }

  _typicalStateFromPeers(sceneId, exceptEntityId) {
    const peers = this._peerStatesInScene(sceneId, exceptEntityId);
    if (!peers.length) {
      return null;
    }
    const on = peers.filter((state) => state.state === "on");
    if (!on.length) {
      return { state: "off" };
    }
    const typical = { state: "on" };
    const brightness = medianNumber(on.map((state) => state.brightness));
    if (brightness != null) {
      typical.brightness = Math.round(brightness);
    }
    const kelvin = medianNumber(on.map((state) => state.color_temp_kelvin));
    if (kelvin != null) {
      typical.color_temp_kelvin = Math.round(kelvin);
      return typical;
    }
    const hues = [];
    const sats = [];
    for (const state of on) {
      if (Array.isArray(state.hs_color) && state.hs_color.length >= 2) {
        hues.push(state.hs_color[0]);
        sats.push(state.hs_color[1]);
      }
    }
    if (hues.length) {
      typical.hs_color = [circularMeanHue(hues), medianNumber(sats)];
      return typical;
    }
    const reds = [];
    const greens = [];
    const blues = [];
    for (const state of on) {
      if (Array.isArray(state.rgb_color) && state.rgb_color.length >= 3) {
        reds.push(state.rgb_color[0]);
        greens.push(state.rgb_color[1]);
        blues.push(state.rgb_color[2]);
      }
    }
    if (reds.length) {
      typical.rgb_color = [
        Math.round(medianNumber(reds)),
        Math.round(medianNumber(greens)),
        Math.round(medianNumber(blues)),
      ];
    }
    return typical;
  }

  _eventDefaultLightState(entityId, eventId) {
    const profile =
      LINKED_EVENTS.includes(eventId) && this._formData.display_scenes_combined
        ? "noon"
        : eventId;
    const seed = EVENT_LIGHT_DEFAULTS[profile] || EVENT_LIGHT_DEFAULTS.noon;
    return { state: "on", brightness: seed[0], color_temp_kelvin: seed[1] };
  }

  _adaptStateToLight(entityId, typical, eventId) {
    if (!typical || typical.state === "off") {
      return { state: "off" };
    }
    const attrs = this._hass.states[entityId]?.attributes || {};
    const modes = new Set(attrs.supported_color_modes || []);
    const payload = { state: "on" };
    if (modes.size && [...modes].every((mode) => mode === "onoff")) {
      return payload;
    }
    if (typical.brightness != null) {
      payload.brightness = typical.brightness;
    }
    const hasTemp =
      modes.has("color_temp") ||
      modes.has("rgbww") ||
      attrs.min_color_temp_kelvin != null;
    const hasColor = [...modes].some((mode) =>
      ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode)
    );
    if (hasTemp && typical.color_temp_kelvin != null) {
      let kelvin = typical.color_temp_kelvin;
      const minK = attrs.min_color_temp_kelvin;
      const maxK = attrs.max_color_temp_kelvin;
      if (minK != null && kelvin < minK) {
        kelvin = minK;
      }
      if (maxK != null && kelvin > maxK) {
        kelvin = maxK;
      }
      payload.color_temp_kelvin = Math.round(kelvin);
      return payload;
    }
    if (hasColor || !modes.size) {
      if (Array.isArray(typical.hs_color)) {
        payload.hs_color = typical.hs_color;
        return payload;
      }
      if (Array.isArray(typical.rgb_color)) {
        payload.rgb_color = typical.rgb_color;
        return payload;
      }
      if (typical.color_temp_kelvin != null) {
        const rgb = hueTempToRgb(typical.color_temp_kelvin);
        const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
        payload.hs_color = [hsv[0], Math.round(hsv[1] * 100)];
        return payload;
      }
    }
    if (hasTemp && payload.color_temp_kelvin == null) {
      const fallback = this._eventDefaultLightState(entityId, eventId);
      if (fallback.color_temp_kelvin != null) {
        let kelvin = fallback.color_temp_kelvin;
        const minK = attrs.min_color_temp_kelvin;
        const maxK = attrs.max_color_temp_kelvin;
        if (minK != null && kelvin < minK) {
          kelvin = minK;
        }
        if (maxK != null && kelvin > maxK) {
          kelvin = maxK;
        }
        payload.color_temp_kelvin = Math.round(kelvin);
      }
    }
    return payload;
  }

  _addLightToMissingScenes(light) {
    const missing = this._missingSceneRows(light);
    if (!missing.length) {
      return;
    }
    this._commitUndo();
    for (const row of missing) {
      const typical =
        this._typicalStateFromPeers(row.scene_entity_id, light.entity_id) ||
        this._eventDefaultLightState(light.entity_id, row.event);
      this._ensureNativeDraft(row.scene_entity_id).entities[light.entity_id] =
        this._adaptStateToLight(light.entity_id, typical, row.event);
    }
    this._syncPreviewOverlay();
    this._sunPathKey = undefined;
    this._ensureSunPath();
  }

  async _flushNativeDrafts() {
    const creates = [];
    const renames = [];
    const deletes = [];
    const updates = [];
    const removes = [];
    for (const [sceneId, draft] of Object.entries(this._nativeDrafts)) {
      if (draft.created) {
        if (draft.deleted) {
          continue;
        }
        const entities = {};
        for (const [entityId, state] of Object.entries(draft.entities || {})) {
          if (state != null) {
            entities[entityId] = state;
          }
        }
        creates.push({
          draft_id: sceneId,
          name: draft.name,
          icon: draft.icon,
          area_id: draft.area_id,
          id: draft.yamlId,
          entities,
        });
        continue;
      }
      if (draft.deleted) {
        deletes.push(sceneId);
        continue;
      }
      if (draft.name) {
        renames.push({ scene_entity_id: sceneId, name: draft.name });
      }
      for (const [entityId, state] of Object.entries(draft.entities || {})) {
        if (state == null) {
          removes.push({ scene_entity_id: sceneId, entity_id: entityId });
        } else {
          updates.push({
            scene_entity_id: sceneId,
            entity_id: entityId,
            entity_state: state,
          });
        }
      }
    }
    if (!creates.length && !renames.length && !deletes.length && !updates.length && !removes.length) {
      return;
    }
    const result = await this._hass.callWS({
      type: `${DOMAIN}/apply_native_drafts`,
      creates,
      renames,
      deletes,
      updates,
      removes,
    });
    const created = result.created || {};
    for (const [draftId, entityId] of Object.entries(created)) {
      this._remapSceneId(draftId, entityId);
    }
    this._nativeDrafts = {};
    this._previewOverlay = null;
  }

  _remapSceneId(fromId, toId) {
    if (!fromId || fromId === toId) {
      return;
    }
    for (const key of Object.values(EVENT_SCENE_KEYS)) {
      if (this._formData[key] === fromId) {
        this._formData[key] = toId;
      }
    }
    if (this._formData.scene_dawn_sunrise_sunset === fromId) {
      this._formData.scene_dawn_sunrise_sunset = toId;
    }
  }

  _overflowMenu() {
    const hasScene = Boolean(this._editId);
    const hasEntity = Boolean(this._entityId);
    const menu = document.createElement("ha-dropdown");
    menu.activatable = true;
    const trigger = document.createElement("ha-icon-button");
    trigger.slot = "trigger";
    trigger.label = this._loc("ui.common.menu", "Menu");
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:dots-vertical");
    trigger.appendChild(icon);
    menu.appendChild(trigger);

    const addItem = (value, label, iconName, { disabled = false, danger = false } = {}) => {
      const item = document.createElement("ha-dropdown-item");
      item.value = value;
      item.disabled = disabled;
      if (danger) {
        item.variant = "danger";
      }
      const itemIcon = document.createElement("ha-icon");
      itemIcon.setAttribute("icon", iconName);
      itemIcon.slot = "icon";
      item.append(itemIcon, document.createTextNode(label));
      menu.appendChild(item);
    };

    if (this._narrow) {
      addItem(
        "undo",
        this._loc("ui.common.undo", "Undo"),
        "mdi:undo",
        { disabled: !this._undoStack.length }
      );
      addItem(
        "redo",
        this._loc("ui.common.redo", "Redo"),
        "mdi:redo",
        { disabled: !this._redoStack.length }
      );
      addItem(
        "preview-location",
        "Preview location",
        "mdi:map-marker-outline",
        // Banner Change covers this while an override is active.
        { disabled: Boolean(this._previewLocation) }
      );
      addItem(
        "toggle-view",
        this._lightView === "dial" ? "Table view" : "Dial view",
        this._lightView === "dial" ? "mdi:table" : "mdi:clock-outline"
      );
    }
    addItem(
      "apply",
      this._loc("ui.panel.config.scene.picker.apply", "Activate"),
      "mdi:play",
      { disabled: !hasEntity }
    );
    addItem(
      "show-info",
      this._loc("ui.panel.config.scene.picker.show_info", "Information"),
      "mdi:information-outline",
      { disabled: !hasEntity }
    );
    addItem(
      "show-settings",
      this._loc("ui.panel.config.automation.picker.show_settings", "Settings"),
      "mdi:cog",
      { disabled: !hasEntity }
    );
    addItem(
      "edit-category",
      this._formData.category
        ? this._loc("ui.panel.config.scene.picker.edit_category", "Edit category")
        : this._loc(
            "ui.panel.config.scene.picker.assign_category",
            "Assign category"
          ),
      "mdi:tag",
      { disabled: !hasScene }
    );
    addItem(
      "rename",
      this._loc("ui.panel.config.scene.editor.rename", "Rename"),
      "mdi:pencil",
      { disabled: !hasScene }
    );
    if (customElements.get("wa-divider")) {
      menu.appendChild(document.createElement("wa-divider"));
    }
    addItem(
      "duplicate",
      this._loc("ui.panel.config.scene.picker.duplicate_scene", "Duplicate"),
      "mdi:content-duplicate",
      { disabled: !hasScene }
    );
    addItem(
      "delete",
      this._loc("ui.panel.config.scene.picker.delete_scene", "Delete"),
      "mdi:delete",
      { disabled: !hasScene, danger: true }
    );
    menu.addEventListener("wa-select", (ev) => {
      this._handleOverflow(ev.detail?.item?.value);
    });
    return menu;
  }

  _handleOverflow(action) {
    if (!action) {
      return;
    }
    if (action === "undo") {
      this._undo();
      return;
    }
    if (action === "redo") {
      this._redo();
      return;
    }
    if (action === "preview-location") {
      this._openLocationDialog();
      return;
    }
    if (action === "toggle-view") {
      this._setLightView(this._lightView === "dial" ? "table" : "dial");
      return;
    }
    if (action === "apply") {
      if (!this._entityId) {
        return;
      }
      this._hass.callService("scene", "turn_on", { entity_id: this._entityId });
      return;
    }
    if (action === "show-info") {
      this._showMoreInfo();
      return;
    }
    if (action === "show-settings") {
      this._showMoreInfo("settings");
      return;
    }
    if (action === "edit-category") {
      this._openSaveDialog({ rename: true, focus: "category" });
      return;
    }
    if (action === "rename") {
      this._openSaveDialog({ rename: true });
      return;
    }
    if (action === "duplicate") {
      this._duplicate();
      return;
    }
    if (action === "delete") {
      this._confirmDelete();
    }
  }

  _showMoreInfo(view) {
    this._showEntityMoreInfo(this._entityId, view);
  }

  _showEntityMoreInfo(entityId, view) {
    if (!entityId) {
      return;
    }
    const detail = { entityId };
    if (view) {
      detail.view = view;
    }
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail,
      })
    );
  }

  _duplicate() {
    if (!this._editId) {
      return;
    }
    const suffix = this._loc(
      "ui.panel.config.scene.picker.duplicate",
      "duplicate"
    );
    this._pendingNewForm = {
      ...this._formData,
      labels: [...(this._formData.labels || [])],
      scene_name: `${this._formData.scene_name || "Circadian"} (${suffix})`,
    };
    this._go("new");
  }

  _isEditorNarrow() {
    return (
      Boolean(this._narrow) ||
      window.matchMedia("(max-width: 870px), (max-height: 500px)").matches
    );
  }

  _lightEditIsDirty() {
    const el = this.shadowRoot?.querySelector(".scene-sidebar.light-dialog");
    return Boolean(el && !el._closing && el._isDirty?.());
  }

  async _confirmLeaveLightEdit() {
    const el = this.shadowRoot?.querySelector(".scene-sidebar.light-dialog");
    if (!el?._isDirty?.()) {
      return true;
    }
    return el._confirmIfDirty();
  }

  _forceCloseSceneSidebar() {
    const el = this.shadowRoot?.querySelector(".scene-sidebar");
    if (el) {
      el._isDirty = () => false;
    }
    this._closeSceneSidebar();
  }

  _setSidebarDocked(docked) {
    // Width + drawer’s right inset only — no extra “left margin” gap; banners
    // and page content keep their own inline spacing.
    const on = Boolean(docked && !this._isEditorNarrow());
    const gutter = on
      ? "calc(var(--scene-sidebar-width, 375px) + 16px)"
      : "0px";
    this.style.setProperty("--scene-sidebar-gutter", gutter);
    this.toggleAttribute("data-sidebar-docked", on);
    this._syncYearScrubLayout();
    // Face translates with the gutter padding transition; ResizeObserver only
    // sees size changes, so remeasure horizon reach through the slide.
    this._scheduleClockHorizonRelayout();
  }

  _scheduleClockHorizonRelayout() {
    if (this._horizonRelayoutRaf != null) {
      cancelAnimationFrame(this._horizonRelayoutRaf);
      this._horizonRelayoutRaf = undefined;
    }
    if (this._horizonRelayoutTimer != null) {
      clearTimeout(this._horizonRelayoutTimer);
      this._horizonRelayoutTimer = undefined;
    }
    const started = performance.now();
    const tick = (now) => {
      this._layoutClockHorizonBack();
      if (now - started < SIDEBAR_ANIMATION_MS + 32) {
        this._horizonRelayoutRaf = requestAnimationFrame(tick);
        return;
      }
      this._horizonRelayoutRaf = undefined;
      // One more pass after transition settles (subpixel / late layout).
      this._horizonRelayoutTimer = window.setTimeout(() => {
        this._horizonRelayoutTimer = undefined;
        this._layoutClockHorizonBack();
      }, 48);
    };
    this._horizonRelayoutRaf = requestAnimationFrame(tick);
  }

  _fillSidebarHeader(header, { title, subtitle, actionItems, host }) {
    header.replaceChildren();
    const closeBtn = document.createElement("ha-icon-button");
    closeBtn.slot = "navigationIcon";
    closeBtn.label = this._loc("ui.dialogs.generic.close", "Close");
    const closeIcon = document.createElement("ha-icon");
    closeIcon.setAttribute("icon", "mdi:close");
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener("click", () => this._requestCloseSceneSidebar(host));
    const titleEl = document.createElement("span");
    titleEl.slot = "title";
    titleEl.textContent = title;
    header.append(closeBtn, titleEl);
    if (subtitle) {
      const sub = document.createElement("span");
      sub.slot = "subtitle";
      sub.textContent = subtitle;
      header.appendChild(sub);
    }
    for (const item of actionItems || []) {
      item.slot = "actionItems";
      header.appendChild(item);
    }
  }

  async _swapSidebarPanes(host) {
    const oldBody = host.querySelector(".scene-sidebar-body");
    const oldFooter = host.querySelector(".scene-sidebar-footer");
    const body = document.createElement("div");
    body.className = "scene-sidebar-body";
    const footer = document.createElement("div");
    footer.className = "scene-sidebar-footer";
    oldBody?.classList.add("sidebar-pane-leave");
    oldFooter?.classList.add("sidebar-pane-leave");
    await new Promise((resolve) => window.setTimeout(resolve, SIDEBAR_SWAP_MS));
    oldBody?.replaceWith(body);
    oldFooter?.replaceWith(footer);
    body.classList.add("sidebar-pane-enter");
    footer.classList.add("sidebar-pane-enter");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        body.classList.remove("sidebar-pane-enter");
        footer.classList.remove("sidebar-pane-enter");
      });
    });
    return { body, footer };
  }

  _setSidebarEvent(eventId) {
    this._sidebarEventId = eventId || null;
    if (eventId) {
      this._clockStickySeconds = undefined;
    }
    const host = this.shadowRoot?.querySelector(".scene-sidebar");
    if (host) {
      host._eventId = this._sidebarEventId;
    }
    this._syncEventSelection();
    // Selected solar event pins the sun (drag sticky yields to the pin).
    if (this._clockSunEl) {
      this._clockSunLive = false;
      this._moveClockSunTo(this._clockSunIdleSeconds());
      if (this._hoverSeconds == null) {
        this._fillHoverReadout(this._idleReadoutSeconds(), { hovering: false });
      }
    }
  }

  _setSidebarLight(entityId) {
    this._sidebarLightId = entityId || null;
    this._syncClockLightSelection();
  }

  /** Drop ring hover highlight (touch scrub / mouse leave). */
  _clearClockRingHover() {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }
    for (const ring of root.querySelectorAll(".clock-ring.hovered")) {
      ring.classList.remove("hovered");
    }
    const name = root.querySelector(".clock-ring-hover-name");
    if (name) {
      name.textContent = "";
      name.hidden = true;
    }
  }

  _syncClockLightSelection() {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }
    const selected = this._sidebarLightId;
    for (const ring of root.querySelectorAll(".clock-ring[data-entity-id]")) {
      const on = ring.dataset.entityId === selected;
      ring.classList.toggle("selected", on);
      if (on) {
        ring.setAttribute("aria-current", "true");
      } else {
        ring.removeAttribute("aria-current");
      }
    }
    for (const row of root.querySelectorAll(
      ".clock-legend-row[data-entity-id]"
    )) {
      const on = row.dataset.entityId === selected;
      row.classList.toggle("selected", on);
      if (on) {
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("aria-current");
      }
    }
    for (const row of root.querySelectorAll(".light-row[data-entity-id]")) {
      const on = row.dataset.entityId === selected;
      row.classList.toggle("selected", on);
      if (on) {
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("aria-current");
      }
    }
  }

  _syncEventSelection() {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }
    const selected = this._sidebarEventId;
    for (const item of root.querySelectorAll(
      ".sun-event[data-event-id], .clock-event[data-event-id]"
    )) {
      const on = item.dataset.eventId === selected;
      item.classList.toggle("selected", on);
      if (on) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }

  _closeSceneSidebar({ animate = false } = {}) {
    this._setSidebarEvent(null);
    this._setSidebarLight(null);
    this._clearClockRingHover();
    const el = this.shadowRoot?.querySelector(".scene-sidebar");
    if (!el) {
      this._setSidebarDocked(false);
      return;
    }
    if (
      animate &&
      el.classList.contains("desktop") &&
      el.classList.contains("open")
    ) {
      this._animateDesktopSidebarClose(el);
      return;
    }
    this._setSidebarDocked(false);
    el.dispatchEvent(new Event("closed"));
    el.remove();
  }

  _animateDesktopSidebarClose(el) {
    if (el._closing) {
      return;
    }
    this._setSidebarEvent(null);
    this._setSidebarLight(null);
    this._clearClockRingHover();
    el._closing = true;
    el.classList.remove("open");
    this._setSidebarDocked(false);
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      el.removeEventListener("transitionend", onEnd);
      el.dispatchEvent(new Event("closed"));
      el.remove();
    };
    const onEnd = (ev) => {
      if (ev.target !== el) {
        return;
      }
      finish();
    };
    el.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, SIDEBAR_ANIMATION_MS + 50);
  }

  _commitSceneSidebar(el) {
    if (el) {
      el._committed = true;
      el._isDirty = () => false;
    }
    this._requestCloseSceneSidebar(el);
  }

  async _requestCloseSceneSidebar(el) {
    const target = el || this.shadowRoot?.querySelector(".scene-sidebar");
    if (target?._isDirty?.() && !(await target._confirmIfDirty())) {
      return;
    }
    if (target) {
      target._isDirty = () => false;
    }
    this._setSidebarEvent(null);
    if (target?.localName === "ha-bottom-sheet") {
      target.open = false;
      this._setSidebarLight(null);
      this._clearClockRingHover();
      return;
    }
    this._closeSceneSidebar({ animate: true });
  }

  async _openSceneSidebar({ title, subtitle, className, onDismiss, actionItems }) {
    const existing = this.shadowRoot?.querySelector(".scene-sidebar");
    const useSheet =
      this._isEditorNarrow() &&
      customElements.get("ha-bottom-sheet") !== undefined;
    const canReuse =
      existing &&
      !existing._closing &&
      existing.classList.contains(useSheet ? "mobile" : "desktop");
    if (canReuse) {
      if (existing._isDirty?.() && !(await existing._confirmIfDirty())) {
        return null;
      }
      if (!existing._committed) {
        existing._onDismiss?.();
      }
      existing._committed = false;
      existing._isDirty = undefined;
      existing._confirmIfDirty = undefined;
      existing._switchLightEvent = undefined;
      existing._lightEntityId = undefined;
      existing._onDismiss = onDismiss;
      existing.className = `scene-sidebar ${className} ${
        useSheet ? "mobile" : "desktop open"
      }`;
      if (!useSheet) {
        this._setSidebarDocked(true);
      }
      const header = existing.querySelector("ha-dialog-header");
      this._fillSidebarHeader(header, {
        title,
        subtitle,
        actionItems,
        host: existing,
      });
      const panes = await this._swapSidebarPanes(existing);
      return { host: existing, header, ...panes };
    }
    if (existing && !existing._closing && existing._isDirty?.()) {
      if (!(await existing._confirmIfDirty())) {
        return null;
      }
    }
    this._closeSceneSidebar();
    const host = useSheet
      ? document.createElement("ha-bottom-sheet")
      : document.createElement("div");
    host.className = `scene-sidebar ${className} ${useSheet ? "mobile" : "desktop"}`;
    host.tabIndex = -1;
    host._onDismiss = onDismiss;

    const header = document.createElement("ha-dialog-header");
    this._fillSidebarHeader(header, { title, subtitle, actionItems, host });

    const body = document.createElement("div");
    body.className = "scene-sidebar-body";
    const footer = document.createElement("div");
    footer.className = "scene-sidebar-footer";

    if (useSheet) {
      host.flexContent = true;
      header.slot = "header";
      footer.slot = "footer";
      host.append(header, body, footer);
    } else {
      const card = document.createElement("ha-card");
      card.className = "scene-sidebar-card";
      card.outlined = true;
      card.append(header, body, footer);
      host.appendChild(card);
      host.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          this._requestCloseSceneSidebar(host);
        }
      });
    }

    host.addEventListener("closed", () => {
      host.remove();
      this._setSidebarDocked(false);
      // Only clear if this host still owns the highlight. A delayed desktop
      // close must not wipe the event selected by a newly opened sidebar.
      if (this._sidebarEventId && this._sidebarEventId === host._eventId) {
        this._setSidebarEvent(null);
      }
      // Mobile bottom-sheet swipe/backdrop dismiss fires closed without always
      // going through _requestCloseSceneSidebar — clear the ring selection too.
      if (
        host._lightEntityId &&
        this._sidebarLightId === host._lightEntityId
      ) {
        this._setSidebarLight(null);
      }
      this._clearClockRingHover();
      if (!host._committed && this.isConnected) {
        host._onDismiss?.();
      }
      this._syncYearScrubLayout();
    });
    this.shadowRoot.appendChild(host);
    if (useSheet) {
      host.open = true;
      this._syncYearScrubLayout();
    } else {
      host.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          host.classList.add("open");
          this._setSidebarDocked(true);
        });
      });
    }
    return { host, header, body, footer };
  }

  _renderEditor() {
    this._syncEditorSceneTitle();
    this._setNavigationIcon(this._backButton());
    this._setEditorActions();
    this._syncEditorChrome();
    this._syncSaveFab();
    this._contentEl.classList.add("wide");

    if (this._error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = this._error;
      this._contentEl.replaceChildren(error);
    } else {
      this._contentEl.replaceChildren();
    }
    // List chart lives in .sun-path, not .content. Rebuild the dial from the
    // in-memory curve now so a detached clock from the last visit cannot be
    // patched while the linear graph stays on screen.
    if (this._sunPath?.curve?.length) {
      this._forgetClockDom();
      this._drawSunPath();
    }
  }

  /** App-bar / dialogs: prefer HA friendly_name over stored scene_name. */
  _editorSceneTitle() {
    if (!this._editId) {
      return this._t("frontend.common.new_scene", "New scene");
    }
    return (
      this._entityFriendlyName(this._entityId, this._formData.scene_name) ||
      this._t("frontend.common.edit_scene", "Edit scene")
    );
  }

  _syncEditorSceneTitle() {
    if (!this._headerEl || this._view !== "edit") {
      return;
    }
    this._headerEl.textContent = this._editorSceneTitle();
  }

  _setNavigationIcon(node) {
    for (const child of [...this._appBar.children]) {
      if (child.getAttribute("slot") === "navigationIcon") {
        child.remove();
      }
    }
    if (!node) {
      this._menuButtonEl = undefined;
      return;
    }
    node.slot = "navigationIcon";
    this._appBar.insertBefore(node, this._appBar.firstChild);
    this._menuButtonEl =
      node.tagName === "HA-MENU-BUTTON" ? node : undefined;
  }

  _menuButton() {
    const button = document.createElement("ha-menu-button");
    button.hass = this._hass;
    button.narrow = Boolean(this._narrow);
    return button;
  }

  _backButton() {
    if (customElements.get("ha-icon-button-arrow-prev")) {
      const button = document.createElement("ha-icon-button-arrow-prev");
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._go("");
      });
      return button;
    }
    if (customElements.get("ha-icon-button")) {
      const button = document.createElement("ha-icon-button");
      button.label = "Back";
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:arrow-left");
      button.appendChild(icon);
      button.addEventListener("click", () => this._go(""));
      return button;
    }
    const button = document.createElement("button");
    button.className = "fallback ghost";
    button.textContent = "Back";
    button.addEventListener("click", () => this._go(""));
    return button;
  }

  _button(label, onClick, options = {}) {
    if (customElements.get("ha-button")) {
      const button = document.createElement("ha-button");
      button.textContent = label;
      if (options.danger) {
        button.variant = "danger";
      } else if (options.ghost) {
        button.appearance = "plain";
      } else {
        button.variant = "brand";
      }
      button.addEventListener("click", onClick);
      return button;
    }
    const button = document.createElement("button");
    button.className = `fallback${options.danger ? " danger" : ""}${
      options.ghost ? " ghost" : ""
    }`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  _resolvableSceneId(sceneId) {
    if (!sceneId) {
      return null;
    }
    if (this._nativeDrafts[sceneId]?.deleted) {
      return null;
    }
    // Pending creates are resolvable via overlay before the entity exists.
    if (this._nativeDrafts[sceneId]?.created) {
      return sceneId;
    }
    // Orphan / deleted YAML scenes stay in hass.states as unavailable and
    // still have a friendly name — treat them as unassigned so the dial and
    // light sidebar do not pretend membership exists.
    const state = this._hass?.states?.[sceneId];
    if (!state || state.state === "unavailable") {
      return null;
    }
    return sceneId;
  }

  _eventSceneId(eventId) {
    const sceneId =
      LINKED_EVENTS.includes(eventId) && this._formData.display_scenes_combined
        ? this._formData.scene_dawn_sunrise_sunset || null
        : this._formData[EVENT_SCENE_KEYS[eventId]] || null;
    return this._resolvableSceneId(sceneId);
  }

  _sceneName(entityId) {
    if (!entityId) {
      return "";
    }
    const draft = this._nativeDrafts[entityId];
    if (draft?.name) {
      return draft.name;
    }
    if (draft?.deleted) {
      return "";
    }
    return this._entityFriendlyName(entityId, entityId.replace(/^scene\./, ""));
  }

  _entityObjectId(entityId) {
    if (!entityId) {
      return "";
    }
    const dot = entityId.indexOf(".");
    return dot >= 0 ? entityId.slice(dot + 1) : entityId;
  }

  _entityFriendlyName(entityId, fallback) {
    if (!entityId) {
      return fallback || "";
    }
    const state = this._hass?.states?.[entityId];
    const friendly = state?.attributes?.friendly_name;
    if (friendly) {
      return friendly;
    }
    return fallback || this._entityObjectId(entityId);
  }

  _entityStateIcon(entityId, fallbackIcon) {
    const state = this._hass?.states?.[entityId];
    if (customElements.get("ha-state-icon") && (state || entityId)) {
      const icon = document.createElement("ha-state-icon");
      icon.hass = this._hass;
      if (state) {
        icon.stateObj = state;
      }
      if (entityId) {
        icon.entityId = entityId;
      }
      return icon;
    }
    const icon = document.createElement("ha-icon");
    const entry = this._hass?.entities?.[entityId];
    const named =
      entry?.icon || state?.attributes?.icon || fallbackIcon || "mdi:palette";
    icon.setAttribute(
      "icon",
      typeof named === "string" && named.startsWith("mdi:")
        ? named
        : fallbackIcon || "mdi:palette"
    );
    return icon;
  }

  _lightIsUnavailable(entityId) {
    const state = this._hass?.states?.[entityId];
    return !state || state.state === "unavailable";
  }

  _clockRingLights(lights) {
    return (lights || []).filter(
      (light) => !light.suggested && !this._lightIsUnavailable(light.entity_id)
    );
  }

  _legendLights(lights) {
    const rows = [...(lights || [])];
    const rank = (light) =>
      this._lightIsUnavailable(light.entity_id) ? 2 : light.suggested ? 1 : 0;
    rows.sort((a, b) => rank(a) - rank(b));
    return rows;
  }

  _uniqueAssignedScenes(events) {
    const seen = new Map();
    for (const event of events || []) {
      const sceneId = this._eventSceneId(event.id);
      if (!sceneId) {
        continue;
      }
      if (!seen.has(sceneId)) {
        seen.set(sceneId, { sceneId, event, events: [] });
      }
      seen.get(sceneId).events.push(event);
    }
    return [...seen.values()];
  }

  _setEventScene(eventId, sceneId, linked) {
    if (LINKED_EVENTS.includes(eventId)) {
      if (linked) {
        this._formData.display_scenes_combined = true;
        this._formData.scene_dawn_sunrise_sunset = sceneId;
        this._formData.scene_dawn = sceneId;
        this._formData.scene_sunrise = sceneId;
        this._formData.scene_sunset = sceneId;
      } else {
        const shared = this._formData.scene_dawn_sunrise_sunset;
        this._formData.display_scenes_combined = false;
        this._formData.scene_dawn_sunrise_sunset = null;
        this._formData.scene_dawn = this._formData.scene_dawn || shared;
        this._formData.scene_sunrise = this._formData.scene_sunrise || shared;
        this._formData.scene_sunset = this._formData.scene_sunset || shared;
        this._formData[EVENT_SCENE_KEYS[eventId]] = sceneId;
      }
    } else {
      this._formData[EVENT_SCENE_KEYS[eventId]] = sceneId;
    }
    this._sunPathKey = undefined;
    this._ensureSunPath();
  }

  async _toggleEventSceneDialog(event) {
    const existing = this.shadowRoot?.querySelector(".scene-sidebar");
    if (
      existing &&
      !existing._closing &&
      this._sidebarEventId === event.id
    ) {
      await this._requestCloseSceneSidebar(existing);
      return;
    }
    await this._openEventSceneDialog(event);
  }

  async _openEventSceneDialog(event) {
    const canLink = LINKED_EVENTS.includes(event.id);
    const data = {
      scene: this._eventSceneId(event.id),
      linked: Boolean(canLink && this._formData.display_scenes_combined),
      duskMinimum: this._formData.scene_dusk_minimum_time_of_day,
    };
    const applyDraft = ({ history = true } = {}) => {
      if (history) {
        this._commitUndo();
      }
      if (event.id === "dusk") {
        this._formData.scene_dusk_minimum_time_of_day = data.duskMinimum;
      }
      this._setEventScene(event.id, data.scene, canLink ? data.linked : false);
    };
    const opened = await this._openSceneSidebar({
      title: event.name,
      className: "event-dialog",
    });
    if (!opened) {
      return;
    }
    this._setSidebarEvent(event.id);
    this._setSidebarLight(null);
    const { host, body, footer } = opened;

    const note = document.createElement("p");
    note.className = "sidebar-note";
    note.textContent =
      "This assigns a native Home Assistant scene to this solar event. Graphs update immediately. Save the extrapolation scene to keep the assignment.";
    body.appendChild(note);

    const field = document.createElement("div");
    field.className = "event-scene-field";
    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = "Scene";
    picker.value = data.scene;
    // Optional → ha-entity-picker shows its built-in clear control.
    picker.required = false;
    const bindPicker = () => {
      picker.hass = this._hass;
      picker.selector = entitySelector(
        this._hass,
        "scene",
        this._formData.area || null,
        true,
        [
          data.scene,
          ...Object.keys(this._nativeDrafts).filter(
            (id) => !this._nativeDrafts[id].deleted
          ),
        ].filter(Boolean)
      );
      picker.value = data.scene;
    };
    bindPicker();
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      data.scene = ev.detail?.value || null;
      applyDraft();
      syncActions();
    });
    const infoBtn = document.createElement("ha-icon-button");
    infoBtn.label = this._loc(
      "ui.panel.config.automation.picker.show_settings",
      "Settings"
    );
    const infoIcon = document.createElement("ha-icon");
    infoIcon.setAttribute("icon", "mdi:information-outline");
    infoBtn.appendChild(infoIcon);
    infoBtn.addEventListener("click", () => {
      if (!data.scene) {
        return;
      }
      this._showEntityMoreInfo(data.scene, "settings");
    });
    field.append(picker, infoBtn);
    body.appendChild(field);

    const actions = document.createElement("div");
    actions.className = "event-scene-actions";
    const createBtn = this._button("Create new scene", async () => {
      setBusy(true);
      setError("");
      try {
        const created = await this._hass.callWS({
          type: `${DOMAIN}/create_native_scene`,
          area_id: this._formData.area,
          event: event.id,
          linked: Boolean(canLink && data.linked),
          write: true,
        });
        this._commitUndo();
        data.scene = created.entity_id;
        // ha-selector errors on unknown entity ids; wait until HA has the
        // reloaded scene before binding the native picker.
        await this._waitForEntity(created.entity_id);
        this._syncPreviewOverlay();
        bindPicker();
        applyDraft({ history: false });
        if (!created.light_count) {
          setHint("Created an empty scene — this area has no lights.");
        } else {
          setHint("");
        }
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setBusy(false);
        syncActions();
      }
    });
    const renameBtn = this._button("Rename", async () => {
      if (!data.scene) {
        return;
      }
      const next = await this._promptText({
        title: "Rename scene",
        label: "Name",
        value: this._sceneName(data.scene),
        confirmLabel: "Rename",
      });
      if (!next) {
        return;
      }
      this._commitUndo();
      this._ensureNativeDraft(data.scene).name = next;
      bindPicker();
      this._sunPathKey = undefined;
      this._ensureSunPath();
      syncActions();
    }, { ghost: true });
    const deleteBtn = this._button(
      "Delete",
      async () => {
        if (!data.scene) {
          return;
        }
        const sceneName = this._sceneName(data.scene);
        const confirmed = await this._confirmNativeSceneDelete(sceneName);
        if (!confirmed) {
          return;
        }
        this._commitUndo();
        const entityId = data.scene;
        this._ensureNativeDraft(entityId).deleted = true;
        this._clearNativeSceneRefs(entityId);
        data.scene = null;
        this._syncPreviewOverlay();
        bindPicker();
        applyDraft({ history: false });
        syncActions();
      },
      { danger: true }
    );
    actions.append(createBtn, renameBtn, deleteBtn);
    body.appendChild(actions);

    const hint = document.createElement("p");
    hint.className = "event-scene-hint";
    const error = document.createElement("p");
    error.className = "event-scene-error";
    body.append(hint, error);

    const setHint = (text) => {
      hint.textContent = text || "";
      hint.hidden = !text;
    };
    const setError = (text) => {
      error.textContent = text || "";
      error.hidden = !text;
    };
    const setBusy = (busy) => {
      createBtn.disabled = busy;
      renameBtn.disabled = busy;
      deleteBtn.disabled = busy;
      infoBtn.disabled = busy || !data.scene;
      picker.disabled = busy;
    };
    const syncActions = () => {
      const hasArea = Boolean(this._formData.area);
      const hasScene = Boolean(data.scene);
      createBtn.disabled = !hasArea;
      renameBtn.disabled = !hasScene;
      deleteBtn.disabled = !hasScene;
      infoBtn.disabled = !hasScene;
      if (!hasArea) {
        setHint(
          "Select an area first. Create fills that room’s lights for this solar event."
        );
      }
    };
    setHint("");
    setError("");
    syncActions();

    if (event.id === "dusk") {
      const timePicker = document.createElement("ha-selector");
      timePicker.hass = this._hass;
      timePicker.label = this._fieldLabel("scene_dusk_minimum_time_of_day");
      timePicker.helper = this._fieldHelper("scene_dusk_minimum_time_of_day");
      timePicker.value = data.duskMinimum;
      timePicker.selector = { time: {} };
      timePicker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        data.duskMinimum = ev.detail?.value;
        applyDraft();
      });
      body.appendChild(timePicker);
    }

    if (canLink) {
      const row = document.createElement("label");
      row.className = "dialog-row";
      const text = document.createElement("span");
      text.textContent = "Same scene for dawn, sunrise, and sunset";
      const toggle = document.createElement("ha-switch");
      toggle.checked = data.linked;
      toggle.addEventListener("change", () => {
        data.linked = Boolean(toggle.checked);
        applyDraft();
      });
      row.append(text, toggle);
      body.appendChild(row);
    }

    const close = document.createElement("ha-button");
    close.appearance = "plain";
    close.textContent = "Close";
    close.addEventListener("click", () => this._requestCloseSceneSidebar(host));
    footer.append(close);
  }

  _clearNativeSceneRefs(entityId) {
    if (!entityId) {
      return;
    }
    for (const key of Object.values(EVENT_SCENE_KEYS)) {
      if (this._formData[key] === entityId) {
        this._formData[key] = null;
      }
    }
    if (this._formData.scene_dawn_sunrise_sunset === entityId) {
      this._formData.scene_dawn_sunrise_sunset = null;
    }
  }

  _promptText({ title, label, value, confirmLabel }) {
    return new Promise((resolve) => {
      this.shadowRoot.querySelector("ha-dialog.text-prompt")?.remove();
      const data = { value: value || "" };
      const dialog = document.createElement("ha-dialog");
      dialog.className = "text-prompt";
      dialog.setAttribute("header-title", title);
      dialog.open = true;
      const field = customElements.get("ha-input")
        ? document.createElement("ha-input")
        : document.createElement("ha-selector");
      field.label = label;
      field.required = true;
      field.value = data.value;
      if (field.localName === "ha-selector") {
        field.hass = this._hass;
        field.selector = { text: {} };
      }
      field.setAttribute("autofocus", "");
      field.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        data.value = ev.detail?.value ?? "";
      });
      field.addEventListener("input", () => {
        data.value = field.value ?? "";
      });
      dialog.appendChild(field);
      const footer = customElements.get("ha-dialog-footer")
        ? document.createElement("ha-dialog-footer")
        : document.createElement("div");
      footer.slot = "footer";
      const cancel = document.createElement("ha-button");
      cancel.slot = "secondaryAction";
      cancel.appearance = "plain";
      cancel.textContent = this._loc("ui.common.cancel", "Cancel");
      const confirm = document.createElement("ha-button");
      confirm.slot = "primaryAction";
      confirm.variant = "brand";
      confirm.textContent = confirmLabel || "Save";
      let settled = false;
      const settle = (next) => {
        if (settled) {
          return;
        }
        settled = true;
        dialog.open = false;
        resolve(next);
      };
      cancel.addEventListener("click", () => settle(null));
      confirm.addEventListener("click", () => {
        const next = String(field.value ?? data.value ?? "").trim();
        if (!next) {
          field.reportValidity?.();
          return;
        }
        settle(next);
      });
      footer.append(cancel, confirm);
      dialog.appendChild(footer);
      dialog.addEventListener("closed", () => {
        dialog.remove();
        settle(null);
      });
      this.shadowRoot.appendChild(dialog);
    });
  }

  _confirmExtrapolationDelete(name) {
    return new Promise((resolve) => {
      this.shadowRoot
        .querySelector("ha-dialog.extrapolation-scene-delete")
        ?.remove();
      const dialog = document.createElement("ha-dialog");
      dialog.className = "extrapolation-scene-delete confirm-dialog";
      dialog.setAttribute(
        "header-title",
        this._loc(
          "ui.panel.config.scene.picker.delete_confirm_title",
          "Delete scene?"
        )
      );
      dialog.open = true;
      const text = document.createElement("p");
      text.textContent = this._loc(
        "ui.panel.config.scene.picker.delete_confirm_text",
        `Are you sure you want to delete ${name}?`,
        { name }
      );
      dialog.appendChild(text);
      const footer = customElements.get("ha-dialog-footer")
        ? document.createElement("ha-dialog-footer")
        : document.createElement("div");
      footer.slot = "footer";
      const cancel = document.createElement("ha-button");
      cancel.slot = "secondaryAction";
      cancel.appearance = "plain";
      cancel.textContent = this._loc("ui.common.cancel", "Cancel");
      const confirm = document.createElement("ha-button");
      confirm.slot = "primaryAction";
      confirm.variant = "danger";
      confirm.textContent = this._loc("ui.common.delete", "Delete");
      let settled = false;
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        dialog.open = false;
        resolve(value);
      };
      cancel.addEventListener("click", () => settle(false));
      confirm.addEventListener("click", () => settle(true));
      footer.append(cancel, confirm);
      dialog.appendChild(footer);
      dialog.addEventListener("closed", () => {
        dialog.remove();
        settle(false);
      });
      this.shadowRoot.appendChild(dialog);
    });
  }

  _confirmNativeSceneDelete(name) {
    return new Promise((resolve) => {
      this.shadowRoot.querySelector("ha-dialog.native-scene-delete")?.remove();
      const dialog = document.createElement("ha-dialog");
      dialog.className = "native-scene-delete confirm-dialog";
      dialog.setAttribute("header-title", "Delete scene?");
      dialog.open = true;
      const text = document.createElement("p");
      text.textContent = `Are you sure you want to delete ${name}? This removes the native Home Assistant scene.`;
      dialog.appendChild(text);
      const footer = customElements.get("ha-dialog-footer")
        ? document.createElement("ha-dialog-footer")
        : document.createElement("div");
      footer.slot = "footer";
      const cancel = document.createElement("ha-button");
      cancel.slot = "secondaryAction";
      cancel.appearance = "plain";
      cancel.textContent = this._loc("ui.common.cancel", "Cancel");
      const confirm = document.createElement("ha-button");
      confirm.slot = "primaryAction";
      confirm.variant = "danger";
      confirm.textContent = this._loc("ui.common.delete", "Delete");
      let settled = false;
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        dialog.open = false;
        resolve(value);
      };
      cancel.addEventListener("click", () => settle(false));
      confirm.addEventListener("click", () => settle(true));
      footer.append(cancel, confirm);
      dialog.appendChild(footer);
      dialog.addEventListener("closed", () => {
        dialog.remove();
        settle(false);
      });
      this.shadowRoot.appendChild(dialog);
    });
  }

  _lightServicePayload(entityId, stored) {
    if (!stored || stored.state === "off") {
      return { service: "turn_off", data: { entity_id: entityId } };
    }
    const data = { entity_id: entityId };
    if (stored.brightness != null) {
      data.brightness = stored.brightness;
    }
    if (stored.effect != null && stored.effect !== "none") {
      data.effect = stored.effect;
    }
    // HA rejects two+ members of the Color descriptors exclusion group
    // (e.g. hs_color + rgb_color). Drafts often store both; live entity
    // snapshots do too — send exactly one.
    if (stored.rgbww_color != null) {
      data.rgbww_color = stored.rgbww_color;
    } else if (stored.rgbw_color != null) {
      data.rgbw_color = stored.rgbw_color;
    } else if (stored.hs_color != null) {
      data.hs_color = stored.hs_color;
    } else if (stored.rgb_color != null) {
      data.rgb_color = stored.rgb_color;
    } else if (stored.color_temp_kelvin != null) {
      data.color_temp_kelvin = stored.color_temp_kelvin;
    }
    return { service: "turn_on", data };
  }

  async _applyLightState(entityId, stored) {
    const payload = this._lightServicePayload(entityId, stored);
    await this._hass.callService("light", payload.service, payload.data);
  }

  _snapshotLight(entityId) {
    const state = this._hass.states[entityId];
    if (!state) {
      return { state: "off" };
    }
    const attrs = state.attributes || {};
    return {
      state: state.state,
      brightness: attrs.brightness,
      color_temp_kelvin: attrs.color_temp_kelvin,
      hs_color: attrs.hs_color,
      rgb_color: attrs.rgb_color,
      rgbw_color: attrs.rgbw_color,
      rgbww_color: attrs.rgbww_color,
      effect: attrs.effect,
    };
  }

  _closestEvent(events, seconds) {
    if (!events?.length) {
      return null;
    }
    let best = events[0];
    let bestDist = Infinity;
    for (const event of events) {
      const dist = Math.abs(event.seconds - seconds);
      if (dist < bestDist) {
        best = event;
        bestDist = dist;
      }
    }
    return best;
  }

  _secondsFromElementPointer(ev, el) {
    const rect = el.getBoundingClientRect();
    const viewX = rect.width
      ? ((ev.clientX - rect.left) / rect.width) * CHART_WIDTH
      : PLOT_LEFT;
    const t = (viewX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
    return Math.max(0, Math.min(SECONDS_PER_DAY, t * SECONDS_PER_DAY));
  }

  async _openLightEditDialog(light, event) {
    if (!this._eventSceneId(event.id)) {
      this._openEventSceneDialog(event);
      return;
    }
    const existing = this.shadowRoot?.querySelector(".scene-sidebar.light-dialog");
    if (
      existing &&
      !existing._closing &&
      existing._lightEntityId === light.entity_id &&
      existing._switchLightEvent
    ) {
      existing._switchLightEvent(event);
      return;
    }

    // Highlight before any await (sidebar swap is ~160ms). Otherwise clearing
    // ring hover (touch pointerup / leave) re-lights the previous .selected
    // band for a frame and reads as a flash.
    const previousLightId = this._sidebarLightId;
    this._setSidebarLight(light.entity_id);
    this._clearClockRingHover();

    const snapshot = this._snapshotLight(light.entity_id);
    const attrs = this._hass.states[light.entity_id]?.attributes || {};
    const supported = attrs.supported_color_modes || [];
    const hasColor = supported.some((mode) =>
      ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode)
    );
    // rgbww exposes white channels, not always `color_temp` in supported_color_modes.
    const hasTemp =
      supported.includes("color_temp") ||
      supported.includes("rgbww") ||
      attrs.min_color_temp_kelvin != null;
    const events = this._sunPath?.events || [];
    const uniqueScenes = this._uniqueAssignedScenes(events);
    const drafts = new Map();
    for (const item of uniqueScenes) {
      const draftEntity =
        this._nativeDrafts[item.sceneId]?.entities?.[light.entity_id];
      let present;
      let stored;
      if (draftEntity === null) {
        // Session removed this lamp from the scene.
        present = false;
        stored = null;
      } else if (draftEntity) {
        present = true;
        stored = { ...draftEntity };
      } else {
        // Prefer the assigned scene id; fall back to this solar event's row so a
        // reassigned/shared scene still resolves membership.
        const byScene = (light.event_states || []).find(
          (row) => row.scene_entity_id === item.sceneId && row.present
        );
        const byEvent =
          byScene ||
          (light.event_states || []).find(
            (row) =>
              item.events.some((ev) => ev.id === row.event) && row.present
          );
        present = Boolean(byEvent);
        stored = byEvent
          ? byEvent.state ||
            (light.event_states || []).find(
              (row) => row.event === item.event.id
            )?.state ||
            { state: "off" }
          : null;
      }
      drafts.set(item.sceneId, {
        draft: present ? { ...stored } : null,
        // "absent" until the user adds this lamp via the brightness graph +.
        saved: present ? lightDraftFingerprint(stored) : "absent",
        member: present,
        event: item.event,
        index: drafts.size + 1,
      });
    }
    let currentEvent = event;
    let liveApplied = false;
    let wheelCtl = null;
    let brightnessGraphCtl = null;
    let colorBriGraphCtl = null;
    let whiteBriGraphCtl = null;
    const whiteKind = supported.includes("rgbww")
      ? "rgbww"
      : supported.includes("rgbw")
        ? "rgbw"
        : null;

    const sceneEntityId = () => this._eventSceneId(currentEvent.id);
    const currentEntry = () => drafts.get(sceneEntityId());
    const currentDraft = () => currentEntry()?.draft;
    const dirtyEntries = () =>
      [...drafts.entries()].filter(([, entry]) => {
        if (!entry.member || !entry.draft) {
          return false;
        }
        if (entry.saved === "absent") {
          return true;
        }
        return lightDraftFingerprint(entry.draft) !== entry.saved;
      });
    // One undo point for the first edit in this sidebar open; later ticks
    // (drag, wheel) update the same session drafts until close.
    let undoCommitted = false;
    const applyToSession = () => {
      const dirty = dirtyEntries();
      if (!dirty.length) {
        return;
      }
      if (!undoCommitted) {
        this._commitUndo();
        undoCommitted = true;
      }
      for (const [sceneId, entry] of dirty) {
        this._ensureNativeDraft(sceneId).entities[light.entity_id] = {
          ...entry.draft,
        };
        entry.saved = lightDraftFingerprint(entry.draft);
      }
      this._syncPreviewOverlay();
      this._schedulePreview();
    };
    const restoreLive = async () => {
      if (liveApplied) {
        await this._applyLightState(light.entity_id, snapshot);
        liveApplied = false;
      }
    };
    const applyLive = async () => {
      if (!this._liveEdit) {
        return;
      }
      liveApplied = true;
      await this._applyLightState(light.entity_id, currentDraft());
    };

    const infoBtn = document.createElement("ha-icon-button");
    infoBtn.label = this._loc(
      "ui.panel.config.automation.picker.show_settings",
      "Settings"
    );
    const infoIcon = document.createElement("ha-icon");
    infoIcon.setAttribute("icon", "mdi:information-outline");
    infoBtn.appendChild(infoIcon);
    infoBtn.addEventListener("click", () =>
      this._showEntityMoreInfo(light.entity_id, "settings")
    );

    const onLiveEditChange = async (on) => {
      if (on) {
        await applyLive();
      } else if (liveApplied) {
        await this._applyLightState(light.entity_id, snapshot);
        liveApplied = false;
      }
    };

    const opened = await this._openSceneSidebar({
      title: light.name,
      subtitle: this._sceneName(sceneEntityId()),
      className: "light-dialog",
      actionItems: [infoBtn],
      onDismiss: () => {
        if (this._liveEditSidebarHandler === onLiveEditChange) {
          this._liveEditSidebarHandler = null;
        }
        this._syncPreviewOverlay();
        this._sunPathKey = undefined;
        this._ensureSunPath();
        restoreLive();
        brightnessGraphCtl?.disconnect();
        colorBriGraphCtl?.disconnect();
        whiteBriGraphCtl?.disconnect();
        wheelCtl?.disconnect();
      },
    });
    if (!opened) {
      this._setSidebarLight(previousLightId);
      return;
    }
    this._liveEditSidebarHandler = onLiveEditChange;
    this._setSidebarEvent(event.id);
    const { host, header, body, footer } = opened;
    host._lightEntityId = light.entity_id;
    const subtitleEl = header.querySelector("[slot='subtitle']");
    const chipsHost = document.createElement("div");
    const brightnessGraphMount = document.createElement("div");
    const colorBriMount = document.createElement("div");
    const whiteBriMount = document.createElement("div");
    const wheelMount = document.createElement("div");
    body.append(
      chipsHost,
      brightnessGraphMount,
      colorBriMount,
      whiteBriMount,
      wheelMount
    );

    const selectScene = async (next, { fromWheel = false } = {}) => {
      const nextId = this._eventSceneId(next.id);
      if (!nextId) {
        this._openEventSceneDialog(next);
        return;
      }
      const entry = drafts.get(nextId);
      if (!entry?.member || !entry.draft) {
        return;
      }
      currentEvent = next;
      this._setSidebarEvent(next.id);
      if (subtitleEl) {
        subtitleEl.textContent = this._sceneName(nextId);
      }
      paintChips();
      brightnessGraphCtl?.sync();
      colorBriGraphCtl?.sync();
      whiteBriGraphCtl?.sync();
      if (!fromWheel) {
        const mode = draftWheelMode(currentDraft(), hasColor, hasTemp);
        wheelCtl?.setMode(mode, { convertDraft: false });
      }
      wheelCtl?.sync();
      if (this._liveEdit) {
        await applyLive();
      }
    };

    const paintChips = () => {
      chipsHost.replaceChildren();
      const memberScenes = uniqueScenes.filter(
        (item) => drafts.get(item.sceneId)?.member
      );
      if (!memberScenes.length) {
        return;
      }
      const list = document.createElement("div");
      list.className = "light-scene-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Scene");
      const currentId = sceneEntityId();
      for (const item of memberScenes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sun-event clickable";
        btn.setAttribute("role", "option");
        if (item.sceneId === currentId) {
          btn.setAttribute("aria-current", "true");
        }
        const icon = document.createElement("ha-icon");
        const entity = this._hass?.states?.[item.sceneId];
        icon.setAttribute("icon", entity?.attributes?.icon || "mdi:palette");
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = this._sceneName(item.sceneId);
        btn.append(icon, name);
        btn.addEventListener("click", () => {
          if (item.sceneId !== sceneEntityId()) {
            host._switchLightEvent(item.event);
          }
        });
        list.appendChild(btn);
      }
      chipsHost.appendChild(list);
    };

    const onWheelChange = async () => {
      applyToSession();
      wheelCtl?.syncPresets();
      brightnessGraphCtl?.sync();
      colorBriGraphCtl?.sync();
      whiteBriGraphCtl?.sync();
      await applyLive();
    };

    brightnessGraphCtl = createLightBrightnessGraph({
      title: this._t("frontend.lights.brightness", "Brightness"),
      subtitle: this._t("frontend.lights.graph_sub", "0–100% by solar event"),
      getPoints: () => {
        const activeId = sceneEntityId();
        return events
          .map((item) => {
            const sceneId = this._eventSceneId(item.id);
            if (!sceneId) {
              return null;
            }
            let entry = drafts.get(sceneId);
            if (!entry) {
              // Scene assigned after sidebar open — resolve membership from
              // preview rows / session drafts (do not stub as non-member).
              const draftEntity =
                this._nativeDrafts[sceneId]?.entities?.[light.entity_id];
              let present;
              let stored;
              if (draftEntity === null) {
                present = false;
                stored = null;
              } else if (draftEntity) {
                present = true;
                stored = { ...draftEntity };
              } else {
                const row = (light.event_states || []).find(
                  (itemRow) =>
                    itemRow.scene_entity_id === sceneId && itemRow.present
                );
                present = Boolean(row);
                stored = row?.state || { state: "off" };
              }
              entry = {
                draft: present ? { ...stored } : null,
                saved: present ? lightDraftFingerprint(stored) : "absent",
                member: present,
                event: item,
                index: drafts.size + 1,
              };
              drafts.set(sceneId, entry);
              if (!uniqueScenes.some((row) => row.sceneId === sceneId)) {
                uniqueScenes.push({
                  sceneId,
                  event: item,
                  events: [item],
                });
              }
            }
            const member = Boolean(entry.member && entry.draft);
            const draft = entry.draft;
            const brightness = member
              ? draft.state === "off"
                ? 0
                : Number(draft.brightness) || 0
              : 0;
            return {
              eventId: item.id,
              sceneId,
              seconds: item.seconds,
              name: item.name,
              icon: item.icon,
              member,
              brightness,
              rgb: member ? draftRgb(draft) : [128, 128, 128],
              active: member && sceneId === activeId,
            };
          })
          .filter(Boolean);
      },
      onSelect: (eventId) => {
        const next = events.find((item) => item.id === eventId);
        if (next) {
          selectScene(next);
        }
      },
      onAdd: async (sceneId, eventId) => {
        const next = events.find((item) => item.id === eventId);
        if (!next) {
          return;
        }
        let entry = drafts.get(sceneId);
        if (!entry) {
          entry = {
            draft: null,
            saved: "absent",
            member: false,
            event: next,
            index: drafts.size + 1,
          };
          drafts.set(sceneId, entry);
        }
        if (entry.member && entry.draft) {
          await selectScene(next);
          return;
        }
        if (!undoCommitted) {
          this._commitUndo();
          undoCommitted = true;
        }
        const typical =
          this._typicalStateFromPeers(sceneId, light.entity_id) ||
          this._eventDefaultLightState(light.entity_id, eventId);
        entry.draft = this._adaptStateToLight(
          light.entity_id,
          typical,
          eventId
        );
        entry.member = true;
        entry.event = next;
        this._ensureNativeDraft(sceneId).entities[light.entity_id] = {
          ...entry.draft,
        };
        entry.saved = lightDraftFingerprint(entry.draft);
        if (!uniqueScenes.some((row) => row.sceneId === sceneId)) {
          uniqueScenes.push({ sceneId, event: next, events: [next] });
        }
        this._syncPreviewOverlay();
        this._schedulePreview();
        await selectScene(next);
        brightnessGraphCtl?.sync();
        colorBriGraphCtl?.sync();
        whiteBriGraphCtl?.sync();
        wheelCtl?.sync();
        await applyLive();
      },
      onBrightness: async (sceneId, brightness) => {
        const entry = drafts.get(sceneId);
        if (!entry?.member || !entry.draft) {
          return;
        }
        entry.draft.brightness = brightness;
        if (brightness > 0) {
          entry.draft.state = "on";
        }
        applyToSession();
        brightnessGraphCtl?.sync();
        colorBriGraphCtl?.sync();
        whiteBriGraphCtl?.sync();
        await applyLive();
      },
      onDragEnd: () => {
        wheelCtl?.sync();
      },
    });
    brightnessGraphMount.appendChild(brightnessGraphCtl.el);

    if (whiteKind) {
      const extraPoints = (valueOf) => () => {
        const activeId = sceneEntityId();
        return events
          .map((item) => {
            const sceneId = this._eventSceneId(item.id);
            if (!sceneId) {
              return null;
            }
            const entry = drafts.get(sceneId);
            const member = Boolean(entry?.member && entry.draft);
            const draft = entry?.draft;
            return {
              eventId: item.id,
              sceneId,
              seconds: item.seconds,
              name: item.name,
              icon: item.icon,
              member,
              brightness: member ? valueOf(draft) : 0,
              rgb: member ? draftRgb(draft) : [128, 128, 128],
              active: member && sceneId === activeId,
            };
          })
          .filter(Boolean);
      };
      colorBriGraphCtl = createLightBrightnessGraph({
        title: this._t("frontend.lights.color_brightness", "Color brightness"),
        subtitle: this._t("frontend.lights.graph_sub", "0–100% by solar event"),
        getPoints: extraPoints(colorBrightnessFromDraft),
        onSelect: (eventId) => {
          const next = events.find((item) => item.id === eventId);
          if (next) {
            selectScene(next);
          }
        },
        onAdd: async (_sceneId, eventId) => {
          const next = events.find((item) => item.id === eventId);
          if (next) {
            await selectScene(next);
          }
        },
        onBrightness: async (sceneId, brightness) => {
          const entry = drafts.get(sceneId);
          if (!entry?.member || !entry.draft) {
            return;
          }
          setColorBrightnessOnDraft(entry.draft, brightness, whiteKind);
          applyToSession();
          brightnessGraphCtl?.sync();
          colorBriGraphCtl?.sync();
          whiteBriGraphCtl?.sync();
          wheelCtl?.sync();
          await applyLive();
        },
        onDragEnd: () => {
          wheelCtl?.sync();
        },
      });
      whiteBriGraphCtl = createLightBrightnessGraph({
        title: this._t("frontend.lights.white_brightness", "White brightness"),
        subtitle: this._t("frontend.lights.graph_sub", "0–100% by solar event"),
        getPoints: extraPoints(whiteBrightnessFromDraft),
        onSelect: (eventId) => {
          const next = events.find((item) => item.id === eventId);
          if (next) {
            selectScene(next);
          }
        },
        onAdd: async (_sceneId, eventId) => {
          const next = events.find((item) => item.id === eventId);
          if (next) {
            await selectScene(next);
          }
        },
        onBrightness: async (sceneId, brightness) => {
          const entry = drafts.get(sceneId);
          if (!entry?.member || !entry.draft) {
            return;
          }
          setWhiteBrightnessOnDraft(entry.draft, brightness, whiteKind);
          applyToSession();
          brightnessGraphCtl?.sync();
          colorBriGraphCtl?.sync();
          whiteBriGraphCtl?.sync();
          wheelCtl?.sync();
          await applyLive();
        },
        onDragEnd: () => {
          wheelCtl?.sync();
        },
      });
      colorBriMount.appendChild(colorBriGraphCtl.el);
      whiteBriMount.appendChild(whiteBriGraphCtl.el);
    }

    if (hasColor || hasTemp) {
      wheelCtl = createSceneColorWheel({
        hasColor,
        hasTemp,
        tempMin: attrs.min_color_temp_kelvin || 2000,
        tempMax: attrs.max_color_temp_kelvin || 6500,
        getState: () => ({
          scenes: uniqueScenes
            .filter((item) => drafts.get(item.sceneId)?.member)
            .map((item) => {
              const entry = drafts.get(item.sceneId);
              return {
                id: item.sceneId,
                index: entry.index,
                draft: entry.draft,
                event: item.event,
              };
            }),
          sequence: events
            .map((item) => this._eventSceneId(item.id))
            .filter((id) => id && drafts.get(id)?.member),
          activeId: sceneEntityId(),
        }),
        onSelect: (sceneId) => {
          const entry = drafts.get(sceneId);
          if (entry) {
            selectScene(entry.event, { fromWheel: true });
          }
        },
        onChange: onWheelChange,
      });
      wheelMount.appendChild(wheelCtl.el);
      wheelCtl.setMode(draftWheelMode(currentDraft(), hasColor, hasTemp), {
        convertDraft: false,
      });
    }

    const note = document.createElement("p");
    note.className = "sidebar-note";
    const noteIcon = document.createElement("ha-icon");
    noteIcon.setAttribute("icon", "mdi:information-outline");
    const noteText = document.createElement("span");
    noteText.textContent =
      "Edits here change this light in the related native scene. Graphs update immediately. Save the extrapolation scene to keep the changes.";
    note.append(noteIcon, noteText);
    footer.appendChild(note);

    host._switchLightEvent = async (next) => {
      await selectScene(next);
    };

    paintChips();
    brightnessGraphCtl?.sync();
    wheelCtl?.sync();
    if (this._liveEdit) {
      await applyLive();
    }
  }

  async _openSaveDialog({ rename = false, focus } = {}) {
    this.shadowRoot.querySelector("ha-dialog.save-dialog")?.remove();
    const data = {
      scene_name: this._formData.scene_name || "Circadian",
      area: this._formData.area || null,
      description: this._formData.description || "",
      labels: [...(this._formData.labels || [])],
      category: this._formData.category || "",
    };
    const chipsAvailable = Boolean(customElements.get("ha-assist-chip"));
    const visible = new Set();
    if (focus === "category") {
      visible.add("category");
    }
    if (!chipsAvailable || data.description) {
      visible.add("description");
    }
    if (!chipsAvailable || data.category) {
      visible.add("category");
    }
    if (!chipsAvailable || data.labels.length) {
      visible.add("labels");
    }

    let categories = [];
    try {
      categories = await this._hass.callWS({
        type: "config/category_registry/list",
        scope: "scene",
      });
    } catch (_err) {
      categories = [];
    }

    const dialog = document.createElement("ha-dialog");
    dialog.className = "save-dialog";
    dialog.setAttribute("header-title", rename ? "Rename" : "Save");
    dialog.open = true;

    const bindValue = (el, onValue) => {
      el.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        onValue(ev.detail?.value);
      });
      el.addEventListener("input", () => onValue(el.value));
    };

    const nameInput = customElements.get("ha-input")
      ? document.createElement("ha-input")
      : document.createElement("ha-selector");
    nameInput.label = "Name";
    nameInput.required = true;
    nameInput.value = data.scene_name;
    if (nameInput.localName === "ha-selector") {
      nameInput.hass = this._hass;
      nameInput.selector = { text: {} };
    }
    nameInput.setAttribute("autofocus", "");
    bindValue(nameInput, (value) => {
      data.scene_name = value ?? "";
    });
    dialog.appendChild(nameInput);

    const areaPicker = document.createElement("ha-selector");
    areaPicker.hass = this._hass;
    areaPicker.label = this._fieldLabel("area");
    areaPicker.helper = this._fieldHelper("area");
    areaPicker.required = true;
    areaPicker.value = data.area;
    areaPicker.selector = { area: {} };
    bindValue(areaPicker, (value) => {
      data.area = value || null;
    });
    dialog.appendChild(areaPicker);

    const optional = document.createElement("div");
    const chips = document.createElement(
      customElements.get("ha-chip-set") ? "ha-chip-set" : "div"
    );
    const addChip = (id, label, build) => {
      if (visible.has(id)) {
        optional.appendChild(build());
        return;
      }
      const chip = document.createElement("ha-assist-chip");
      chip.id = id;
      chip.label = label;
      const plus = document.createElement("ha-icon");
      plus.setAttribute("icon", "mdi:plus");
      plus.slot = "icon";
      chip.appendChild(plus);
      chip.addEventListener("click", () => {
        chip.remove();
        visible.add(id);
        optional.appendChild(build());
      });
      chips.appendChild(chip);
    };

    addChip("description", "Add description", () => {
      const field = customElements.get("ha-textarea")
        ? document.createElement("ha-textarea")
        : document.createElement("ha-selector");
      field.label = "Description";
      field.value = data.description;
      if (field.localName === "ha-selector") {
        field.hass = this._hass;
        field.selector = { text: { multiline: true } };
      }
      bindValue(field, (value) => {
        data.description = value ?? "";
      });
      return field;
    });
    addChip("category", "Add category", () => {
      if (customElements.get("ha-category-picker")) {
        const picker = document.createElement("ha-category-picker");
        picker.hass = this._hass;
        picker.scope = "scene";
        picker.label = "Category";
        picker.value = data.category || "";
        bindValue(picker, (value) => {
          data.category = value || "";
        });
        return picker;
      }
      const picker = document.createElement("ha-selector");
      picker.hass = this._hass;
      picker.label = "Category";
      picker.value = data.category || "";
      picker.selector = {
        select: {
          mode: "dropdown",
          options: categories.map((item) => ({
            value: item.category_id,
            label: item.name,
          })),
        },
      };
      bindValue(picker, (value) => {
        data.category = value || "";
      });
      return picker;
    });
    addChip("labels", "Add labels", () => {
      const picker = customElements.get("ha-labels-picker")
        ? document.createElement("ha-labels-picker")
        : document.createElement("ha-selector");
      picker.hass = this._hass;
      picker.value = data.labels;
      if (picker.localName === "ha-selector") {
        picker.label = "Labels";
        picker.selector = { label: { multiple: true } };
      }
      bindValue(picker, (value) => {
        data.labels = value || [];
      });
      return picker;
    });
    dialog.append(optional, chips);

    const footer = customElements.get("ha-dialog-footer")
      ? document.createElement("ha-dialog-footer")
      : document.createElement("div");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = "Cancel";
    cancel.setAttribute("data-dialog", "close");
    cancel.addEventListener("click", () => {
      dialog.open = false;
    });
    const save = document.createElement("ha-button");
    save.slot = "primaryAction";
    save.variant = "brand";
    save.textContent = rename ? "Rename" : "Save";
    save.addEventListener("click", async () => {
      const name = (data.scene_name || "").trim();
      if (!name) {
        nameInput.reportValidity?.();
        return;
      }
      if (!data.area) {
        areaPicker.reportValidity?.();
        return;
      }
      this._formData.scene_name = name;
      this._formData.area = data.area;
      this._formData.description = data.description;
      this._formData.labels = data.labels;
      this._formData.category = data.category || null;
      this._syncEditorSceneTitle();
      dialog.open = false;
      await this._save();
    });
    footer.append(cancel, save);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => dialog.remove());
    this.shadowRoot.appendChild(dialog);
  }

  async _save() {
    this._saving = true;
    this._error = null;
    try {
      await this._flushNativeDrafts();
      const saved = await this._hass.callWS({
        type: `${DOMAIN}/save`,
        scene_id: this._editId || undefined,
        data: this._formData,
      });
      this._resetSession();
      this._draftRestore = null;
      this._clearPersistedDraft();
      this._clearPersistedDraft("new");
      this._clearPreviewCache();
      // Saving creates the entity — do not treat #new → #edit/id as discard.
      this._leaveConfirmDone = true;
      this._editId = saved.id;
      this._go(`edit/${saved.id}`);
    } catch (err) {
      this._error = err.message || String(err);
      this._renderEditor();
    } finally {
      this._saving = false;
    }
  }

  async _delete() {
    if (!this._editId) {
      return;
    }
    try {
      await this._hass.callWS({
        type: `${DOMAIN}/delete`,
        scene_id: this._editId,
      });
      this._clearPersistedDraft();
      this._draftRestore = null;
      this._go("");
    } catch (err) {
      this._error = err.message || String(err);
      this._renderEditor();
    }
  }

  _confirmDiscard({ title, text }) {
    return new Promise((resolve) => {
      this.shadowRoot.querySelector("ha-dialog.discard-dialog")?.remove();
      const dialog = document.createElement("ha-dialog");
      dialog.className = "discard-dialog confirm-dialog";
      dialog.setAttribute("header-title", title);
      dialog.open = true;
      const body = document.createElement("p");
      body.textContent = text;
      dialog.appendChild(body);
      const footer = customElements.get("ha-dialog-footer")
        ? document.createElement("ha-dialog-footer")
        : document.createElement("div");
      footer.slot = "footer";
      const keep = document.createElement("ha-button");
      keep.slot = "secondaryAction";
      keep.appearance = "plain";
      keep.textContent = this._t(
        "frontend.common.keep_editing",
        "Keep editing"
      );
      const discard = document.createElement("ha-button");
      discard.slot = "primaryAction";
      discard.variant = "danger";
      discard.textContent = this._t("frontend.common.discard", "Discard");
      let settled = false;
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        dialog.open = false;
        resolve(value);
      };
      keep.addEventListener("click", () => settle(false));
      discard.addEventListener("click", () => settle(true));
      footer.append(keep, discard);
      dialog.appendChild(footer);
      dialog.addEventListener("closed", () => {
        dialog.remove();
        settle(false);
      });
      this.shadowRoot.appendChild(dialog);
    });
  }

  _confirmDelete() {
    if (!this._editId) {
      return;
    }
    this.shadowRoot.querySelector("ha-dialog.confirm-dialog")?.remove();
    const dialog = document.createElement("ha-dialog");
    dialog.className = "confirm-dialog";
    dialog.setAttribute(
      "header-title",
      this._loc(
        "ui.panel.config.scene.picker.delete_confirm_title",
        "Delete scene?"
      )
    );
    dialog.open = true;
    const text = document.createElement("p");
    const displayName = this._editorSceneTitle();
    text.textContent = this._loc(
      "ui.panel.config.scene.picker.delete_confirm_text",
      `Are you sure you want to delete ${displayName}?`,
      { name: displayName }
    );
    dialog.appendChild(text);
    const footer = customElements.get("ha-dialog-footer")
      ? document.createElement("ha-dialog-footer")
      : document.createElement("div");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = this._loc("ui.common.cancel", "Cancel");
    cancel.addEventListener("click", () => {
      dialog.open = false;
    });
    const confirm = document.createElement("ha-button");
    confirm.slot = "primaryAction";
    confirm.variant = "danger";
    confirm.textContent = this._loc("ui.common.delete", "Delete");
    confirm.addEventListener("click", () => {
      dialog.open = false;
      this._delete();
    });
    footer.append(cancel, confirm);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => dialog.remove());
    this.shadowRoot.appendChild(dialog);
  }

  _openAreaDialog({ context = "list" } = {}) {
    if (this._areaPromptOpen) {
      return;
    }
    this._areaPromptOpen = true;
    let committed = false;
    this.shadowRoot.querySelector("ha-dialog.area-dialog")?.remove();

    const state = {
      area: this._formData.area || null,
      mode: "automatic",
      step: 1,
      linked: true,
      assignments: {
        noon: null,
        linked: null,
        dusk: null,
        dawn: null,
        sunrise: null,
        sunset: null,
      },
      info: null,
      busy: false,
      error: "",
    };

    const dialog = document.createElement("ha-dialog");
    dialog.className = "area-dialog";
    dialog.setAttribute("header-title", "1/2 New extrapolation scene");
    dialog.open = true;

    const step1 = document.createElement("div");
    step1.className = "setup-step";
    const step1Intro = document.createElement("p");
    step1Intro.className = "setup-intro";
    step1Intro.innerHTML =
      "Creates a scene which, when activated, lights your room based on the sun. Automatic light updates are built in: it keeps adjusting lights on an interval (toggle from the scene list).<br><br>" +
      "<span class=\"muted\">Only <strong>native Home Assistant scenes</strong> are supported (not Hue/integration scenes). All settings can be changed later.</span>";
    step1.appendChild(step1Intro);

    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = this._fieldLabel("area");
    picker.helper = this._fieldHelper("area");
    picker.required = true;
    picker.value = state.area;
    picker.selector = { area: {} };
    step1.appendChild(picker);

    const cards = document.createElement("div");
    cards.className = "setup-mode-cards";
    const modeMeta = [
      {
        id: "automatic",
        icon: "mdi:auto-fix",
        title: "Set up automatically",
        detail:
          "Finds lights in the area and creates a native scene for each solar event (dawn, sunrise, noon, sunset, dusk).",
      },
      {
        id: "manual",
        icon: "mdi:playlist-edit",
        title: "Use my existing scenes",
        detail:
          "Match solar events to scenes you already have. Empty fields create new scenes automatically.",
      },
    ];
    const modeButtons = {};
    for (const item of modeMeta) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "setup-mode-card";
      btn.dataset.mode = item.id;
      const title = document.createElement("div");
      title.className = "mode-title";
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", item.icon);
      const titleText = document.createElement("span");
      titleText.textContent = item.title;
      title.append(icon, titleText);
      const detail = document.createElement("div");
      detail.className = "mode-detail";
      detail.textContent = item.detail;
      btn.append(title, detail);
      btn.addEventListener("click", () => {
        state.mode = item.id;
        state.error = "";
        syncModeCards();
        syncFooter();
      });
      modeButtons[item.id] = btn;
      cards.appendChild(btn);
    }
    step1.appendChild(cards);

    const step2 = document.createElement("div");
    step2.className = "setup-step";
    step2.hidden = true;
    const step2Intro = document.createElement("p");
    step2Intro.className = "setup-intro";
    step2Intro.innerHTML =
      "Match solar events with a scene. At each event that scene is fully active, then the lights transition toward the next.<br><br>" +
      "<span class=\"muted\">Selectors only show <strong>native Home Assistant scenes</strong> in this area. Leave a field empty to create one automatically.</span>";
    const linkRow = document.createElement("div");
    linkRow.className = "setup-link-row";
    const linkLabel = document.createElement("span");
    linkLabel.textContent = this._fieldLabel("display_scenes_combined");
    const linkSwitch = document.createElement("ha-switch");
    linkSwitch.checked = state.linked;
    linkSwitch.addEventListener("change", () => {
      state.linked = Boolean(linkSwitch.checked);
      applySuggestions();
      paintSlots();
    });
    linkRow.append(linkLabel, linkSwitch);
    const linkHelper = document.createElement("p");
    linkHelper.className = "setup-link-helper";
    linkHelper.textContent = this._fieldHelper("display_scenes_combined");
    const slotsHost = document.createElement("div");
    slotsHost.className = "setup-step";
    step2.append(step2Intro, linkRow, linkHelper, slotsHost);

    const errorEl = document.createElement("p");
    errorEl.className = "setup-error";
    errorEl.hidden = true;

    dialog.append(step1, step2, errorEl);

    const footer = customElements.get("ha-dialog-footer")
      ? document.createElement("ha-dialog-footer")
      : document.createElement("div");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = this._loc("ui.common.cancel", "Cancel");
    cancel.addEventListener("click", () => {
      dialog.open = false;
    });
    const backBtn = document.createElement("ha-button");
    backBtn.slot = "secondaryAction";
    backBtn.appearance = "plain";
    backBtn.textContent = this._loc("ui.common.back", "Back");
    backBtn.hidden = true;
    backBtn.addEventListener("click", () => {
      state.step = 1;
      state.error = "";
      syncSteps();
      syncFooter();
    });
    const nextBtn = document.createElement("ha-button");
    nextBtn.slot = "primaryAction";
    nextBtn.variant = "brand";
    nextBtn.textContent = this._loc("ui.common.continue", "Next");
    footer.append(cancel, backBtn, nextBtn);
    dialog.appendChild(footer);

    const setError = (message) => {
      state.error = message || "";
      errorEl.textContent = state.error;
      errorEl.hidden = !state.error;
    };
    const syncModeCards = () => {
      for (const [id, btn] of Object.entries(modeButtons)) {
        btn.classList.toggle("selected", state.mode === id);
      }
    };
    const syncSteps = () => {
      step1.hidden = state.step !== 1;
      step2.hidden = state.step !== 2;
      dialog.setAttribute(
        "header-title",
        state.step === 1
          ? "1/2 New extrapolation scene"
          : "2/2 Scenes configuration"
      );
    };
    const syncFooter = () => {
      backBtn.hidden = state.step !== 2;
      cancel.hidden = state.step === 2;
      nextBtn.disabled = state.busy || !state.area;
      nextBtn.textContent = this._loc("ui.common.continue", "Next");
    };
    const slotDefs = () => {
      if (state.linked) {
        return [
          {
            key: "noon",
            label: this._fieldLabel("scene_noon"),
            helper: `${this._fieldHelper("scene_noon")}. ${this._fieldHelper("setup_empty_means_auto")}`,
          },
          {
            key: "linked",
            label: this._fieldLabel("scene_dawn_sunrise_sunset"),
            helper: `${this._fieldHelper("scene_dawn_sunrise_sunset")}. ${this._fieldHelper("setup_empty_means_auto")}`,
          },
          {
            key: "dusk",
            label: this._fieldLabel("scene_dusk"),
            helper: `${this._fieldHelper("scene_dusk")}. ${this._fieldHelper("setup_empty_means_auto")}`,
          },
        ];
      }
      return [
        {
          key: "dawn",
          label: this._fieldLabel("scene_dawn"),
          helper: `${this._fieldHelper("scene_dawn")}. ${this._fieldHelper("setup_empty_means_auto")}`,
        },
        {
          key: "sunrise",
          label: this._fieldLabel("scene_sunrise"),
          helper: `${this._fieldHelper("scene_sunrise")}. ${this._fieldHelper("setup_empty_means_auto")}`,
        },
        {
          key: "noon",
          label: this._fieldLabel("scene_noon"),
          helper: `${this._fieldHelper("scene_noon")}. ${this._fieldHelper("setup_empty_means_auto")}`,
        },
        {
          key: "sunset",
          label: this._fieldLabel("scene_sunset"),
          helper: `${this._fieldHelper("scene_sunset")}. ${this._fieldHelper("setup_empty_means_auto")}`,
        },
        {
          key: "dusk",
          label: this._fieldLabel("scene_dusk"),
          helper: `${this._fieldHelper("scene_dusk")}. ${this._fieldHelper("setup_empty_means_auto")}`,
        },
      ];
    };
    const applySuggestions = () => {
      const suggestions = state.linked
        ? state.info?.suggestions_linked || {}
        : state.info?.suggestions_unlinked || {};
      for (const { key } of slotDefs()) {
        state.assignments[key] = suggestions[key] || null;
      }
    };
    const paintSlots = () => {
      slotsHost.replaceChildren();
      for (const { key, label, helper } of slotDefs()) {
        const row = document.createElement("div");
        row.className = "setup-slot";
        const scenePicker = document.createElement("ha-selector");
        scenePicker.hass = this._hass;
        scenePicker.label = label;
        scenePicker.helper = helper;
        scenePicker.required = false;
        scenePicker.selector = entitySelector(
          this._hass,
          "scene",
          state.area,
          true,
          [state.assignments[key]].filter(Boolean)
        );
        scenePicker.value = state.assignments[key] || null;
        scenePicker.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          state.assignments[key] = ev.detail?.value || null;
        });
        row.appendChild(scenePicker);
        slotsHost.appendChild(row);
      }
    };

    const buildAssignmentsPayload = () => {
      const payload = {};
      for (const { key } of slotDefs()) {
        payload[key] = state.assignments[key] || SETUP_AUTOMATIC;
      }
      return payload;
    };

    const finish = async () => {
      state.busy = true;
      syncFooter();
      setError("");
      try {
        const linked =
          state.mode === "automatic" ? false : Boolean(state.linked);
        const assignments =
          state.mode === "automatic"
            ? {
                dawn: SETUP_AUTOMATIC,
                sunrise: SETUP_AUTOMATIC,
                noon: SETUP_AUTOMATIC,
                sunset: SETUP_AUTOMATIC,
                dusk: SETUP_AUTOMATIC,
              }
            : buildAssignmentsPayload();
        const result = await this._hass.callWS({
          type: `${DOMAIN}/apply_area_setup`,
          area_id: state.area,
          linked,
          assignments,
        });
        for (const entityId of Object.values(result.assignments || {})) {
          if (entityId) {
            await this._waitForEntity(entityId);
          }
        }
        const form = {
          ...emptyFormData(),
          area: state.area,
          scene_name: `${result.area_name} Lighting`,
          display_scenes_combined: linked,
        };
        if (linked) {
          const shared = result.assignments.linked || null;
          form.scene_noon = result.assignments.noon || null;
          form.scene_dawn_sunrise_sunset = shared;
          form.scene_dawn = shared;
          form.scene_sunrise = shared;
          form.scene_sunset = shared;
          form.scene_dusk = result.assignments.dusk || null;
        } else {
          for (const eventId of ["dawn", "sunrise", "noon", "sunset", "dusk"]) {
            form[`scene_${eventId}`] = result.assignments[eventId] || null;
          }
        }
        committed = true;
        if (context === "list") {
          this._pendingNewForm = form;
          this._go("new");
        } else {
          this._formData = { ...form };
          this._nativeDrafts = {};
          this._clearPreviewCache();
          this._render();
        }
        dialog.open = false;
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        state.busy = false;
        syncFooter();
      }
    };

    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      state.area = ev.detail?.value || null;
      state.info = null;
      setError("");
      syncFooter();
    });

    nextBtn.addEventListener("click", async () => {
      if (!state.area) {
        picker.reportValidity?.();
        return;
      }
      if (state.busy) {
        return;
      }
      state.busy = true;
      syncFooter();
      setError("");
      try {
        if (!state.info || state.info.area_id !== state.area) {
          state.info = await this._hass.callWS({
            type: `${DOMAIN}/area_setup_info`,
            area_id: state.area,
          });
        }
        if (!state.info.light_count) {
          setError(
            "This area has no lights. Add lights to the area in Home Assistant before creating an extrapolation scene."
          );
          return;
        }
        if (state.mode === "automatic" || state.step === 2) {
          await finish();
          return;
        }
        state.step = 2;
        applySuggestions();
        paintSlots();
        syncSteps();
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        state.busy = false;
        syncFooter();
      }
    });

    dialog.addEventListener("closed", () => {
      this._areaPromptOpen = false;
      dialog.remove();
      if (!committed && context === "new" && !this._formData.area) {
        this._go("");
      }
    });

    syncModeCards();
    syncSteps();
    syncFooter();
    this.shadowRoot.appendChild(dialog);
  }



  _duskMinimumSeconds() {
    if (this._view !== "edit") {
      return undefined;
    }
    return timeToSeconds(this._formData.scene_dusk_minimum_time_of_day);
  }

  _sceneIdsFromForm() {
    const resolve = (id) => this._resolvableSceneId(id);
    if (this._formData.display_scenes_combined) {
      const shared = resolve(this._formData.scene_dawn_sunrise_sunset || null);
      return {
        scene_dawn: shared,
        scene_sunrise: shared,
        scene_sunset: shared,
        scene_noon: resolve(this._formData.scene_noon || null),
        scene_dusk: resolve(this._formData.scene_dusk || null),
      };
    }
    return {
      scene_dawn: resolve(this._formData.scene_dawn || null),
      scene_sunrise: resolve(this._formData.scene_sunrise || null),
      scene_noon: resolve(this._formData.scene_noon || null),
      scene_sunset: resolve(this._formData.scene_sunset || null),
      scene_dusk: resolve(this._formData.scene_dusk || null),
    };
  }

  _chartKey() {
    if (this._view !== "edit") {
      // List chart is solar-only and always “today” — not the editor date scrub.
      return `list-sun:${todayIso()}`;
    }
    return JSON.stringify({
      date: this._previewDate,
      dusk: this._duskMinimumSeconds(),
      scenes: this._sceneIdsFromForm(),
      overlay: this._previewOverlay,
      location: this._previewLocation,
      area: this._formData.area || null,
    });
  }

  _schedulePreview() {
    if (this._previewTimer) {
      window.clearTimeout(this._previewTimer);
    }
    this._previewTimer = window.setTimeout(() => {
      this._previewTimer = undefined;
      this._ensureSunPath();
    }, 80);
  }

  _rememberPreview(key, payload) {
    this._previewCache.set(key, payload);
    if (this._previewCache.size <= 64) {
      return;
    }
    this._previewCache.delete(this._previewCache.keys().next().value);
  }

  _clearPreviewCache() {
    this._previewCache.clear();
    this._sunPathKey = undefined;
  }

  _takePathMorphMs(from, to) {
    const ms = this._pathMorphMs || 0;
    this._pathMorphMs = 0;
    if (
      !ms ||
      !from?.curve?.length ||
      !to?.curve?.length ||
      this._view !== "edit" ||
      this._lightView !== "dial" ||
      !this._clockRingsHost
    ) {
      return 0;
    }
    return ms;
  }

  _commitSunPath(payload, key) {
    const from = this._displayedSunPath || this._sunPath;
    const morphMs = this._takePathMorphMs(from, payload);
    this._sunPath = payload;
    this._sunPathKey = key;
    if (morphMs && from && from !== payload) {
      this._morphSunPath(from, payload, morphMs);
      return;
    }
    this._drawSunPath();
  }

  _cancelSunPathMorph() {
    if (this._sunPathMorphRaf) {
      window.cancelAnimationFrame(this._sunPathMorphRaf);
      this._sunPathMorphRaf = undefined;
    }
  }

  _morphSunPath(from, to, durationMs) {
    this._cancelSunPathMorph();
    // Scrub uses 5-event knots (CSS ramps between stops). Morphing that straight
    // into Astral's dense samples flashes — especially the midnight wrap at the
    // bottom of the dial. Densify the "from" lights onto a 5-minute grid first
    // so frame 0 already matches how we paint rings during the morph.
    const fromDense = this._withDenseScrubLights(from);
    this._sunPath = fromDense;
    this._displayedSunPath = fromDense;
    if (this._lightView === "dial" && this._clockRingsHost) {
      this._patchLightClock(fromDense, { morphing: true });
    }
    const started = performance.now();
    const tick = (now) => {
      const u = Math.min(1, (now - started) / durationMs);
      const eased = easeOutCubic(u);
      const frame = lerpSunPath(fromDense, to, eased);
      this._sunPath = frame;
      this._displayedSunPath = frame;
      const patched =
        this._lightView === "dial" &&
        this._patchLightClock(frame, { morphing: true });
      if (!patched) {
        this._drawSunPath();
        this._cancelSunPathMorph();
        this._sunPath = to;
        this._displayedSunPath = to;
        return;
      }
      if (u < 1) {
        this._sunPathMorphRaf = window.requestAnimationFrame(tick);
        return;
      }
      this._sunPathMorphRaf = undefined;
      this._sunPath = to;
      this._displayedSunPath = to;
      // Full paint once: bloom + horizon wedges (skipped mid-morph to avoid
      // stacked translucent flashes under the dial).
      this._patchLightClock(to, { morphing: false });
    };
    this._sunPathMorphRaf = window.requestAnimationFrame(tick);
  }

  /**
   * Expand knot-only scrub lights to a dense sample grid before refine morph.
   * Leaves already-dense Astral payloads unchanged.
   */
  _withDenseScrubLights(payload) {
    const lights = payload?.lights;
    if (!lights?.length || !payload?.events?.length) {
      return payload;
    }
    const sparse = lights.some(
      (light) =>
        !light.suggested &&
        (light.samples?.length || 0) > 0 &&
        (light.samples?.length || 0) <= 8
    );
    if (!sparse) {
      return payload;
    }
    return {
      ...payload,
      lights: resampleLightsForEvents(lights, payload.events, draftRgb, {
        stepMinutes: 5,
      }),
    };
  }

  async _ensureSunPath() {
    if (!this._hass || !this._sunPathEl) {
      return;
    }
    if (this._previewInFlight) {
      this._previewQueued = true;
      return;
    }
    this._previewInFlight = true;
    try {
      do {
        this._previewQueued = false;
        const key = this._chartKey();
        const listView = this._view !== "edit";
        if (this._sunPath && this._sunPathKey === key) {
          this._drawSunPath();
          continue;
        }
        const cached = this._previewCache.get(key);
        if (cached) {
          if (listView || !this._previewOverlay) {
            this._rememberPreview(key, cached);
          }
          this._commitSunPath(cached, key);
          continue;
        }
        try {
          let payload;
          if (listView) {
            // Lightweight solar-only chart — full DOMAIN/preview is too heavy
            // for the list and used to race in after leaving the editor.
            payload = await this._hass.callWS({
              type: `${DOMAIN}/sun_path`,
              date: todayIso(),
            });
          } else {
            const msg = {
              type: `${DOMAIN}/preview`,
              date: this._previewDate,
              scenes: this._sceneIdsFromForm(),
            };
            if (this._formData.area) {
              msg.area = this._formData.area;
            }
            const dusk = this._duskMinimumSeconds();
            if (dusk != null) {
              msg.dusk_minimum = dusk;
            }
            if (this._previewOverlay) {
              msg.overlay = this._previewOverlay;
            }
            if (this._previewLocation) {
              msg.location = this._previewLocation;
            }
            payload = await this._hass.callWS(msg);
          }
          if (this._chartKey() !== key || (listView !== (this._view !== "edit"))) {
            this._previewQueued = true;
            continue;
          }
          if (listView || !this._previewOverlay) {
            this._rememberPreview(key, payload);
          }
          this._commitSunPath(payload, key);
        } catch (err) {
          if (this._chartKey() !== key) {
            this._previewQueued = true;
            continue;
          }
          this._sunPath = null;
          this._sunPathKey = undefined;
          this._sunPathEl.hidden = false;
          const error = document.createElement("p");
          error.className = "error";
          error.style.padding = "16px";
          error.textContent = err.message || String(err);
          this._sunPathBodyEl.replaceChildren(error);
        }
      } while (this._previewQueued);
    } finally {
      this._previewInFlight = false;
    }
    if (this._previewQueued) {
      this._ensureSunPath();
    }
  }

  _shiftPreviewDate(days) {
    this._setPreviewDate(shiftIsoDate(this._previewDate, days));
  }

  _setPreviewDate(iso, { debounce = false } = {}) {
    if (!iso) {
      return;
    }
    const changed = iso !== this._previewDate;
    this._previewDate = iso;
    if (this._yearScrubbing) {
      this._syncYearScrub();
      this._syncScrubDateLabel();
    } else {
      this._syncDateToolbar();
    }
    if (!changed) {
      return;
    }
    // Dial year scrub: client sun + in-place patch (no mid-drag HA preview).
    if (this._yearScrubbing && this._lightView === "dial") {
      this._applyClientScrubDay(iso);
      return;
    }
    // Date picker / chips: walk intermediate calendar days on the dial so the
    // year does not crossfade in one fade (dusk clamp would also jump).
    const fromIso = this._displayedSunPath?.date || this._sunPath?.date;
    if (
      this._view === "edit" &&
      this._lightView === "dial" &&
      fromIso &&
      fromIso !== iso &&
      this._sunPath?.lights
    ) {
      this._morphAcrossDates(fromIso, iso);
      return;
    }
    if (!this._yearScrubbing) {
      this._pathMorphMs = DATE_MORPH_MS;
    }
    // Keep sticky scrub time across date changes (curve updates underneath).
    this._sunPathKey = undefined;
    if (debounce) {
      this._schedulePreview();
    } else {
      this._ensureSunPath();
    }
  }

  /**
   * Animate the dial through each calendar day from→to, then refine with HA.
   */
  _morphAcrossDates(fromIso, toIso) {
    this._cancelSunPathMorph();
    const span = diffIsoDays(fromIso, toIso);
    if (!span) {
      this._sunPathKey = undefined;
      this._pathMorphMs = DATE_MORPH_MS;
      this._ensureSunPath();
      return;
    }
    const absSpan = Math.abs(span);
    const sign = span > 0 ? 1 : -1;
    const started = performance.now();
    let lastIso = null;
    const tick = (now) => {
      const u = Math.min(1, (now - started) / DATE_MORPH_MS);
      const eased = easeOutCubic(u);
      const dayOffset = Math.round(eased * absSpan) * sign;
      const iso = shiftIsoDate(fromIso, dayOffset);
      if (iso !== lastIso) {
        lastIso = iso;
        this._previewDate = iso;
        this._syncDateToolbar();
        this._applyClientScrubDay(iso, { keepMorph: true });
      }
      if (u < 1) {
        this._sunPathMorphRaf = window.requestAnimationFrame(tick);
        return;
      }
      this._sunPathMorphRaf = undefined;
      this._previewDate = toIso;
      this._syncDateToolbar();
      this._sunPathKey = undefined;
      this._pathMorphMs = PREVIEW_REFINE_MS;
      this._ensureSunPath();
    };
    this._sunPathMorphRaf = window.requestAnimationFrame(tick);
  }

  /**
   * Mid-drag year scrub: local sun geometry + 5-event ring knots (CSS ramps
   * between them). HA Astral preview reconciles on pointer-up via _ensureSunPath.
   */
  _applyClientScrubDay(iso, { keepMorph = false } = {}) {
    const loc = this._previewLocation || this._homeLocation();
    if (!loc || !this._sunPath?.lights) {
      return;
    }
    const timeZone = this._hass?.config?.time_zone || "UTC";
    const sunDay = buildClientSunDay({
      isoDate: iso,
      latitude: loc.latitude,
      longitude: loc.longitude,
      timeZone,
      duskMinimum: this._duskMinimumSeconds() ?? null,
      // Coarse elevation curve while dragging; release uses Astral.
      curveStepMinutes: 30,
    });
    const lights = resampleLightsForEvents(
      this._sunPath.lights,
      sunDay.events,
      draftRgb,
      { knotsOnly: true }
    );
    if (!keepMorph) {
      this._cancelSunPathMorph();
    }
    this._sunPath = {
      ...sunDay,
      lights,
      warnings: this._sunPath.warnings || [],
    };
    if (!this._patchLightClock(this._sunPath)) {
      // Face not built yet — thumb still moves; full draw on release.
      return;
    }
    this._displayedSunPath = this._sunPath;
  }

  _buildDateToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "sun-toolbar";

    const year = new Date().getFullYear();
    const presets = [
      ["Today", todayIso()],
      ["21 Jun", `${year}-06-21`],
      ["21 Dec", `${year}-12-21`],
    ];
    const chipRow = document.createElement("div");
    chipRow.className = "sun-chip-row";
    for (const [name, value] of presets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sun-chip";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        this._setPreviewDate(value);
      });
      chipRow.appendChild(chip);
    }

    // Visually hidden HA date field — opened from the day/month label click.
    const pickerHost = document.createElement("div");
    pickerHost.className = "sun-date-picker-host";
    pickerHost.setAttribute("aria-hidden", "true");
    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = "Date";
    picker.required = true;
    picker.selector = { date: {} };
    picker.value = this._previewDate;
    picker.addEventListener("value-changed", (ev) => {
      const value = ev.detail?.value;
      if (!value || value === this._previewDate) {
        return;
      }
      this._setPreviewDate(value);
    });
    pickerHost.appendChild(picker);

    const dateBtn = document.createElement("div");
    dateBtn.className = "sun-scrub-date";
    dateBtn.setAttribute("role", "button");
    dateBtn.setAttribute("aria-label", "Choose preview date");
    dateBtn.tabIndex = 0;
    const dateLabel = document.createElement("span");
    dateLabel.className = "sun-scrub-date-label";
    dateBtn.append(dateLabel, pickerHost);
    dateBtn.addEventListener("click", () => this._openPreviewDatePicker());
    dateBtn.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") {
        return;
      }
      ev.preventDefault();
      this._openPreviewDatePicker();
    });

    const dateTools = document.createElement("div");
    dateTools.className = "sun-date-tools";
    // Chips first: left of the date in portrait/table row; above the date in
    // the landscape rail (column + align-end).
    dateTools.append(chipRow, dateBtn);

    const scrubBlock = document.createElement("div");
    scrubBlock.className = "sun-scrub-block";
    scrubBlock.append(dateTools, this._buildYearScrub());

    this._datePicker = picker;
    this._dateChips = chipRow.querySelectorAll(".sun-chip");
    this._scrubDateBtn = dateBtn;
    this._scrubDateLabel = dateLabel;
    this._dateTools = dateTools;
    this._chipRow = chipRow;
    this._scrubBlock = scrubBlock;
    // Location banner is in .page-banners (wired in first render), not toolbar.
    toolbar.append(scrubBlock);
    this._syncLocationToolbar();
    this._syncScrubDateLabel();
    return toolbar;
  }

  _syncScrubDateLabel() {
    if (!this._scrubDateLabel) {
      return;
    }
    this._scrubDateLabel.textContent = formatPreviewDayMonth(this._previewDate);
    if (this._scrubDateBtn) {
      this._scrubDateBtn.title = this._previewDate;
    }
  }

  _openPreviewDatePicker() {
    const picker = this._datePicker;
    if (!picker) {
      return;
    }
    const openFrom = (el) => {
      if (!el) {
        return false;
      }
      // HA’s date input opens ha-dialog-date-picker from this private helper.
      if (typeof el._openDialog === "function") {
        el._openDialog();
        return true;
      }
      el.click?.();
      return true;
    };
    const findDateInput = () =>
      picker.shadowRoot
        ?.querySelector("ha-selector-date")
        ?.shadowRoot?.querySelector("ha-date-input") ||
      picker.shadowRoot?.querySelector("ha-date-input");
    const run = () => {
      const dateInput = findDateInput();
      if (openFrom(dateInput)) {
        return;
      }
      // Selector may still be upgrading — click through known hosts.
      const selDate = picker.shadowRoot?.querySelector("ha-selector-date");
      if (openFrom(selDate) || openFrom(picker)) {
        return;
      }
    };
    if (!picker.shadowRoot?.querySelector("ha-selector-date")) {
      customElements.whenDefined("ha-selector").then(() => {
        requestAnimationFrame(run);
      });
      return;
    }
    run();
  }

  _homeLocation() {
    const cfg = this._hass?.config;
    if (cfg?.latitude == null || cfg?.longitude == null) {
      return null;
    }
    return {
      latitude: Number(cfg.latitude),
      longitude: Number(cfg.longitude),
    };
  }

  _setPreviewLocation(location) {
    const home = this._homeLocation();
    const next =
      location && !sameLocation(location, home)
        ? {
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
          }
        : null;
    const changed = !sameLocation(next, this._previewLocation);
    this._previewLocation = next;
    this._syncLocationToolbar();
    // Narrow overflow disables “Preview location” while the banner is up.
    if (changed && this._narrow && this._view === "edit") {
      this._setEditorActions();
    }
    if (!changed) {
      return;
    }
    this._sunPathKey = undefined;
    this._ensureSunPath();
  }

  _syncLocationToolbar() {
    const active = Boolean(this._previewLocation);
    if (this._locationBtn) {
      this._locationBtn.hidden = active;
    }
    if (this._locationBanner) {
      this._locationBanner.hidden = !active;
    }
    this._syncPageBannersVisibility();
    if (this._locationCoords && this._previewLocation) {
      this._locationCoords.textContent = formatLatLng(
        this._previewLocation.latitude,
        this._previewLocation.longitude
      );
    }
    const homeName = this._hass?.config?.location_name || "home";
    if (this._locationBanner) {
      const reset = this._locationBanner.querySelector("ha-icon-button");
      if (reset) {
        reset.label = `Use ${homeName} location`;
      }
    }
  }

  _openLocationDialog() {
    this.shadowRoot.querySelector("ha-dialog.location-dialog")?.remove();
    const home = this._homeLocation() || { latitude: 0, longitude: 0 };
    const data = {
      latitude: this._previewLocation?.latitude ?? home.latitude,
      longitude: this._previewLocation?.longitude ?? home.longitude,
    };
    const dialog = document.createElement("ha-dialog");
    dialog.className = "location-dialog";
    dialog.setAttribute("header-title", "Preview location");
    dialog.open = true;

    const help = document.createElement("p");
    help.textContent =
      "Sun times and light graphs use this place. The clock stays on your Home Assistant timezone.";

    const searchRow = document.createElement("div");
    searchRow.className = "location-search";
    const searchField = customElements.get("ha-textfield")
      ? document.createElement("ha-textfield")
      : document.createElement("input");
    if (searchField.localName === "ha-textfield") {
      searchField.label = "Search";
      searchField.placeholder = "City or address";
    } else {
      searchField.type = "search";
      searchField.placeholder = "City or address";
      searchField.setAttribute("aria-label", "Search");
    }
    const searchBtn = document.createElement("ha-button");
    searchBtn.textContent = "Search";
    searchRow.append(searchField, searchBtn);

    const searchError = document.createElement("p");
    searchError.className = "error";
    searchError.hidden = true;
    const results = document.createElement("div");
    results.className = "location-search-results";

    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = "Location";
    picker.selector = { location: { radius: false } };
    picker.value = { latitude: data.latitude, longitude: data.longitude };
    const applyCoords = (latitude, longitude) => {
      data.latitude = latitude;
      data.longitude = longitude;
      picker.value = { latitude, longitude };
    };
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const value = ev.detail?.value;
      if (value?.latitude == null || value?.longitude == null) {
        return;
      }
      data.latitude = value.latitude;
      data.longitude = value.longitude;
    });

    const runSearch = async () => {
      const query = (searchField.value || "").trim();
      searchError.hidden = true;
      results.replaceChildren();
      if (!query) {
        return;
      }
      searchBtn.disabled = true;
      try {
        const hits = await this._searchLocations(query);
        if (!hits.length) {
          searchError.textContent = "No matching places. Try a city name or move the map.";
          searchError.hidden = false;
          return;
        }
        if (hits.length === 1) {
          applyCoords(hits[0].latitude, hits[0].longitude);
          return;
        }
        for (const hit of hits) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = hit.label;
          btn.addEventListener("click", () => {
            applyCoords(hit.latitude, hit.longitude);
            results.replaceChildren();
          });
          results.appendChild(btn);
        }
      } catch (err) {
        searchError.textContent = err.message || String(err);
        searchError.hidden = false;
      } finally {
        searchBtn.disabled = false;
      }
    };
    searchBtn.addEventListener("click", () => {
      runSearch();
    });
    searchField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        runSearch();
      }
    });

    dialog.append(help, searchRow, searchError, results, picker);

    const footer = customElements.get("ha-dialog-footer")
      ? document.createElement("ha-dialog-footer")
      : document.createElement("div");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = this._loc("ui.common.cancel", "Cancel");
    cancel.addEventListener("click", () => {
      dialog.open = false;
    });
    const apply = document.createElement("ha-button");
    apply.slot = "primaryAction";
    apply.variant = "brand";
    apply.textContent = "Preview";
    apply.addEventListener("click", () => {
      this._setPreviewLocation(data);
      dialog.open = false;
    });
    footer.append(cancel, apply);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => dialog.remove());
    this.shadowRoot.appendChild(dialog);
  }

  async _searchLocations(query) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Location search failed (${response.status})`);
    }
    const payload = await response.json();
    return (payload.features || []).map((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const props = feature.properties || {};
      const label = [
        props.name,
        props.street,
        props.city || props.county,
        props.state,
        props.country,
      ]
        .filter(Boolean)
        .filter((part, index, all) => all.indexOf(part) === index)
        .join(", ");
      return { latitude, longitude, label: label || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` };
    });
  }

  _buildYearScrub() {
    const scrub = document.createElement("div");
    scrub.className = "sun-year-scrub";
    scrub.tabIndex = 0;
    scrub.setAttribute("role", "slider");
    scrub.setAttribute("aria-label", "Preview day");
    const months = document.createElement("div");
    months.className = "sun-year-months";
    const track = document.createElement("div");
    track.className = "sun-year-track";
    const bar = document.createElement("div");
    bar.className = "sun-year-bar";
    const fill = document.createElement("div");
    fill.className = "sun-year-fill";
    const todayMark = document.createElement("div");
    todayMark.className = "sun-year-today";
    const thumb = document.createElement("div");
    thumb.className = "sun-year-thumb";
    track.append(bar, fill, todayMark, thumb);
    scrub.append(months, track);

    const dateFromEvent = (ev) => {
      const rect = track.getBoundingClientRect();
      const vertical = scrub.classList.contains("vertical");
      const t = vertical
        ? rect.height
          ? (ev.clientY - rect.top) / rect.height
          : 0
        : rect.width
          ? (ev.clientX - rect.left) / rect.width
          : 0;
      const year = isoYear(this._previewDate);
      const days = daysInYear(year);
      const dayIndex = Math.max(0, Math.min(days - 1, Math.floor(t * days)));
      return isoFromDayOfYear(year, dayIndex);
    };
    const applyPointer = (ev) => {
      this._setPreviewDate(dateFromEvent(ev), { debounce: true });
    };

    scrub.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) {
        return;
      }
      ev.preventDefault();
      // Do not focus on pointer — :focus-visible still rings in some browsers
      // after programmatic focus from click. Tab / arrows keep working via tabindex.
      scrub.setPointerCapture(ev.pointerId);
      this._yearScrubbing = true;
      applyPointer(ev);
    });
    scrub.addEventListener("pointermove", (ev) => {
      if (!scrub.hasPointerCapture(ev.pointerId)) {
        return;
      }
      this._pendingScrubPoint = { clientX: ev.clientX, clientY: ev.clientY };
      if (this._scrubRaf) {
        return;
      }
      this._scrubRaf = window.requestAnimationFrame(() => {
        this._scrubRaf = undefined;
        if (!this._yearScrubbing || !this._pendingScrubPoint) {
          return;
        }
        applyPointer(this._pendingScrubPoint);
      });
    });
    const endScrub = (ev) => {
      if (!this._yearScrubbing) {
        return;
      }
      this._yearScrubbing = false;
      if (this._scrubRaf) {
        window.cancelAnimationFrame(this._scrubRaf);
        this._scrubRaf = undefined;
      }
      if (this._pendingScrubPoint) {
        applyPointer(this._pendingScrubPoint);
        this._pendingScrubPoint = undefined;
      }
      if (ev?.pointerId != null && scrub.hasPointerCapture(ev.pointerId)) {
        scrub.releasePointerCapture(ev.pointerId);
      }
      this._syncDateToolbar();
      this._syncYearScrubLayout();
      this._pathMorphMs = PREVIEW_REFINE_MS;
      this._ensureSunPath();
    };
    scrub.addEventListener("pointerup", endScrub);
    scrub.addEventListener("pointercancel", endScrub);
    scrub.addEventListener("keydown", (ev) => {
      const year = isoYear(this._previewDate);
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        this._shiftPreviewDate(-1);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault();
        this._shiftPreviewDate(1);
      } else if (ev.key === "PageDown") {
        ev.preventDefault();
        this._shiftPreviewDate(30);
      } else if (ev.key === "PageUp") {
        ev.preventDefault();
        this._shiftPreviewDate(-30);
      } else if (ev.key === "Home") {
        ev.preventDefault();
        this._setPreviewDate(`${year}-01-01`);
      } else if (ev.key === "End") {
        ev.preventDefault();
        this._setPreviewDate(`${year}-12-31`);
      }
    });

    this._yearScrub = scrub;
    this._yearMonths = months;
    this._yearFill = fill;
    this._yearTodayMark = todayMark;
    this._yearThumb = thumb;
    this._yearMonthsYear = undefined;
    return scrub;
  }

  _syncDateToolbar() {
    if (this._datePicker) {
      this._datePicker.hass = this._hass;
      this._datePicker.value = this._previewDate;
    }
    const year = new Date().getFullYear();
    const presets = [todayIso(), `${year}-06-21`, `${year}-12-21`];
    this._dateChips?.forEach((chip, index) => {
      if (presets[index] === this._previewDate) {
        chip.setAttribute("selected", "");
      } else {
        chip.removeAttribute("selected");
      }
    });
    this._syncScrubDateLabel();
    this._syncLocationToolbar();
    this._syncYearScrub();
  }

  _syncYearScrub() {
    if (!this._yearScrub) {
      return;
    }
    const iso = this._previewDate;
    const year = isoYear(iso);
    const days = daysInYear(year);
    const dayIndex = dayOfYear(iso);
    const thumbT = ((dayIndex + 0.5) / days) * 100;
    const vertical = this._yearScrub.classList.contains("vertical");
    if (vertical) {
      this._yearThumb.style.left = "";
      this._yearThumb.style.top = `${thumbT}%`;
      this._yearFill.style.width = "";
      this._yearFill.style.height = `${thumbT}%`;
    } else {
      this._yearThumb.style.top = "";
      this._yearThumb.style.left = `${thumbT}%`;
      this._yearFill.style.height = "";
      this._yearFill.style.width = `${thumbT}%`;
    }
    this._yearScrub.setAttribute("aria-valuemin", "1");
    this._yearScrub.setAttribute("aria-valuemax", String(days));
    this._yearScrub.setAttribute("aria-valuenow", String(dayIndex + 1));
    this._yearScrub.setAttribute("aria-valuetext", iso);
    this._yearScrub.setAttribute(
      "aria-orientation",
      vertical ? "vertical" : "horizontal"
    );
    this._yearScrub.title = iso;

    const today = todayIso();
    if (isoYear(today) === year) {
      this._yearTodayMark.hidden = false;
      const todayT = ((dayOfYear(today) + 0.5) / days) * 100;
      if (vertical) {
        this._yearTodayMark.style.left = "";
        this._yearTodayMark.style.top = `${todayT}%`;
      } else {
        this._yearTodayMark.style.top = "";
        this._yearTodayMark.style.left = `${todayT}%`;
      }
    } else {
      this._yearTodayMark.hidden = true;
    }

    if (this._yearMonthsYear === year && this._yearMonthsVertical === vertical) {
      return;
    }
    this._yearMonthsYear = year;
    this._yearMonthsVertical = vertical;
    const locale = this._hass?.locale?.language || this._hass?.language || "en";
    this._yearMonths.replaceChildren();
    for (let month = 0; month < 12; month += 1) {
      const label = document.createElement("span");
      label.textContent = new Date(year, month, 1).toLocaleDateString(locale, {
        month: "short",
      });
      const startDay = dayOfYear(`${year}-${String(month + 1).padStart(2, "0")}-01`);
      const pos = (startDay / days) * 100;
      if (vertical) {
        label.style.left = "auto";
        label.style.right = "0";
        label.style.top = `${pos}%`;
        if (month === 0) {
          label.style.transform = "none";
        } else if (month === 11) {
          label.style.transform = "translateY(-100%)";
        } else {
          label.style.transform = "translateY(-50%)";
        }
      } else {
        label.style.right = "";
        label.style.top = "";
        label.style.left = `${pos}%`;
        if (month === 0) {
          label.style.transform = "none";
        } else if (month === 11) {
          label.style.transform = "translateX(-100%)";
        } else {
          label.style.transform = "translateX(-50%)";
        }
      }
      this._yearMonths.appendChild(label);
    }
  }

  _isLandscape() {
    return Boolean(this._landscapeMq?.matches) ||
      window.matchMedia("(orientation: landscape)").matches;
  }

  /** Wide enough for the dual-gutter landscape scrub rail. */
  _landscapeScrubFits() {
    return window.matchMedia(
      `(min-width: ${CLOCK_LANDSCAPE_SCRUB_MIN_WIDTH_PX}px)`
    ).matches;
  }

  _sceneSidebarIsOpen() {
    const el = this.shadowRoot?.querySelector(".scene-sidebar");
    if (!el || el._closing) {
      return false;
    }
    if (el.localName === "ha-bottom-sheet") {
      return Boolean(el.open);
    }
    return el.classList.contains("open");
  }

  _ensureToolbarChrome() {
    if (this._toolbarChrome?.isConnected) {
      return this._toolbarChrome;
    }
    const chrome = document.createElement("div");
    chrome.className = "sun-toolbar-chrome";
    this._toolbarChrome = chrome;
    return chrome;
  }

  _syncYearScrubLayout() {
    if (!this._yearScrub || !this._dateToolbar || !this._scrubBlock) {
      return;
    }
    // Keep the scrub node where it is while dragging so pointer capture and
    // axis stay stable across preview redraws.
    if (this._yearScrubbing) {
      return;
    }
    const landscape = this._isLandscape();
    const clock =
      this._view === "edit" &&
      this._lightView === "dial" &&
      Boolean(this._clockScrubRail) &&
      Boolean(this.shadowRoot?.querySelector(".sun-light-clock-face"));
    const sidebarOpen = this._sceneSidebarIsOpen();
    // Portrait chrome below this width — empty left rail reads as a black bar.
    const landscapeClock = landscape && clock && this._landscapeScrubFits();
    // Collapse the rail (animated width) instead of yanking it out — that
    // fought the sidebar/page-gutter transition and looked jagged.
    const collapse = landscapeClock && sidebarOpen;
    const hideToolbarScrub = landscape && sidebarOpen && !clock;

    this._yearScrub.classList.toggle("vertical", landscapeClock);
    this._sunPathStage?.classList.toggle("landscape-clock-scrub", landscapeClock);
    this._sunPathStage?.classList.toggle("scrub-collapsed", collapse);
    this._dateToolbar?.classList.toggle("toolbar-rail-only", landscapeClock);
    this._yearScrub.setAttribute("aria-hidden", collapse || hideToolbarScrub ? "true" : "false");
    if (this._scrubDateBtn) {
      this._scrubDateBtn.hidden = collapse || hideToolbarScrub;
    }
    if (this._chipRow) {
      this._chipRow.hidden = collapse || hideToolbarScrub;
    }

    if (landscapeClock) {
      this._clockScrubRail.hidden = false;
      // Stay in the rail while collapsed so width can animate; do not use hidden.
      this._scrubBlock.hidden = false;
      if (this._scrubBlock.parentNode !== this._clockScrubRail) {
        this._clockScrubRail.appendChild(this._scrubBlock);
      }
      // Rail: chips above date; readout stays on the dial body (top-left).
      if (this._toolbarChrome) {
        this._toolbarChrome.remove();
      }
      if (
        this._hoverReadout &&
        this._sunPathBodyEl &&
        this._hoverReadout.parentNode !== this._sunPathBodyEl
      ) {
        this._sunPathBodyEl.insertBefore(
          this._hoverReadout,
          this._sunPathBodyEl.firstChild
        );
      }
      if (this._dateTools && this._chipRow && this._scrubDateBtn) {
        this._dateTools.append(this._chipRow, this._scrubDateBtn);
      }
    } else {
      this._sunPathStage?.classList.remove("scrub-collapsed");
      if (this._clockScrubRail) {
        this._clockScrubRail.hidden = true;
        this._clockScrubRail.style.height = "";
        this._clockScrubRail.style.paddingBottom = "";
        this._clockScrubRail.style.marginTop = "";
        this._clockScrubRail.style.top = "";
        this._clockScrubRail.style.left = "";
      }
      if (this._scrubBlock.parentNode !== this._dateToolbar) {
        this._dateToolbar.appendChild(this._scrubBlock);
      }
      this._scrubBlock.hidden = hideToolbarScrub;
      this._yearScrub.classList.remove("vertical");

      if (clock) {
        // Portrait dial: time/sun + chips in one wrapping chrome row; date +
        // year scrub below (in-flow so the timeline pushes the dial down).
        const chrome = this._ensureToolbarChrome();
        if (this._hoverReadout && this._hoverReadout.parentNode !== chrome) {
          chrome.appendChild(this._hoverReadout);
        }
        if (this._chipRow && this._chipRow.parentNode !== chrome) {
          chrome.appendChild(this._chipRow);
        }
        if (chrome.parentNode !== this._dateToolbar) {
          this._dateToolbar.insertBefore(chrome, this._scrubBlock);
        }
        if (this._dateTools && this._scrubDateBtn) {
          this._dateTools.replaceChildren(this._scrubDateBtn);
        }
      } else {
        // Table / list chart: chips with date; readout stays in the body.
        if (this._toolbarChrome) {
          this._toolbarChrome.remove();
        }
        if (
          this._hoverReadout &&
          this._sunPathBodyEl &&
          this._hoverReadout.parentNode !== this._sunPathBodyEl
        ) {
          this._sunPathBodyEl.insertBefore(
            this._hoverReadout,
            this._sunPathBodyEl.firstChild
          );
        }
        if (this._dateTools && this._chipRow && this._scrubDateBtn) {
          this._dateTools.append(this._scrubDateBtn, this._chipRow);
        }
      }
    }
    this._syncYearScrub();
    if (landscapeClock) {
      requestAnimationFrame(() => this._alignYearScrubRail());
    }
    // Portrait timeline is in-flow — remeasure face budget after chrome settles.
    requestAnimationFrame(() => this._syncDialHeightBudget(landscapeClock));
  }

  _syncDialHeightBudget(landscapeClock) {
    const path = this._sunPathEl;
    if (!path) {
      return;
    }
    if (!path.classList.contains("dial-view")) {
      path.style.removeProperty("--dial-timeline-h");
      path.style.removeProperty("--dial-face-max");
      path.style.removeProperty("--dial-banner-h");
      return;
    }
    const landscape =
      landscapeClock ??
      this._sunPathStage?.classList.contains("landscape-clock-scrub");
    // Portrait: toolbar (chips + year scrub) is in-flow — reserve its height so
    // the face shrinks instead of the timeline covering hour ticks. Landscape
    // rail sits beside the face (timeline-h = 0).
    let toolbarH = 0;
    if (
      !landscape &&
      this._dateToolbar &&
      !this._dateToolbar.classList.contains("toolbar-rail-only")
    ) {
      toolbarH = Math.ceil(this._dateToolbar.getBoundingClientRect().height) || 0;
    }
    path.style.setProperty("--dial-timeline-h", `${toolbarH}px`);

    // Face fills available height under the app bar, minus overhead above the
    // face (event-label pad) and gap, leaving ~32px of the first light row
    // peeking so the list is discoverable without shrinking on mobile past
    // the width/aspect lock. Draft/location banners sit above .sun-path —
    // reserve their reach so the dial shrinks instead of pushing the list
    // below the fold.
    const hostRect = this.getBoundingClientRect();
    const hostH = this.clientHeight || window.innerHeight;
    const headerVar = parseFloat(
      getComputedStyle(this).getPropertyValue("--header-height")
    );
    const headerH = Number.isFinite(headerVar) && headerVar > 0 ? headerVar : 64;
    const pathTop = path.getBoundingClientRect().top;
    // Vignette / horizon: extend to the host top (under app bar + banners).
    const vignetteReach = Math.max(0, Math.round(pathTop - hostRect.top));
    // Face budget: only the stack below the app bar (banners), not the header
    // itself (already subtracted as headerH).
    const bannerH = Math.max(0, Math.round(pathTop - (hostRect.top + headerH)));
    path.style.setProperty("--dial-banner-h", `${vignetteReach}px`);
    const clock = path.querySelector(".sun-light-clock");
    let overhead = 40 + 16;
    if (clock) {
      const cs = getComputedStyle(clock);
      const padTop = parseFloat(cs.paddingTop);
      const gap = parseFloat(cs.rowGap || cs.gap);
      overhead =
        (Number.isFinite(padTop) ? padTop : 40) +
        (Number.isFinite(gap) ? gap : 16);
    }
    const maxPx = Math.max(
      160,
      Math.floor(
        hostH - headerH - bannerH - overhead - toolbarH - DIAL_LIST_PEEK_PX
      )
    );
    path.style.setProperty("--dial-face-max", `${maxPx}px`);
    // Face size may have changed — re-align landscape rail / chrome next frame.
    requestAnimationFrame(() => this._alignYearScrubRail());
  }

  _alignYearScrubRail() {
    if (
      !this._clockScrubRail ||
      this._clockScrubRail.hidden ||
      !this._sunPathStage?.classList.contains("landscape-clock-scrub")
    ) {
      return;
    }
    const face = this.shadowRoot?.querySelector(".sun-light-clock-face");
    if (!face) {
      return;
    }
    const faceRect = face.getBoundingClientRect();
    if (!faceRect.height) {
      return;
    }
    // Match the dial height; grid columns handle horizontal centering.
    // Pad the bottom so the Save FAB does not cover the year scrub track.
    let padBottom = 0;
    const fab = this._fabEl;
    if (fab && !fab.hidden) {
      const fabRect = fab.getBoundingClientRect();
      const railRect = this._clockScrubRail.getBoundingClientRect();
      if (
        fabRect.height > 0 &&
        fabRect.left < railRect.right &&
        fabRect.right > railRect.left &&
        fabRect.top < faceRect.bottom
      ) {
        padBottom = Math.max(0, faceRect.bottom - fabRect.top + 12);
      }
    }
    this._clockScrubRail.style.height = `${faceRect.height}px`;
    this._clockScrubRail.style.paddingBottom = padBottom ? `${padBottom}px` : "";
    this._clockScrubRail.style.top = "";
    this._clockScrubRail.style.left = "";
    this._clockScrubRail.style.marginTop = "";
  }

  _drawSunPath() {
    if (!this._sunPathEl || !this._sunPath || !this._sunPath.curve?.length) {
      return;
    }
    if (this._view === "edit" && !this._dateToolbar) {
      this._lightView = this._readLightView();
    }
    const useClock = this._view === "edit" && this._lightView === "dial";
    if (
      useClock &&
      this._clockRingsHost?.isConnected &&
      this._patchLightClock(this._sunPath)
    ) {
      this._displayedSunPath = this._sunPath;
      if (this._dateToolbar) {
        if (this._yearScrubbing) {
          this._syncYearScrub();
        } else {
          this._syncDateToolbar();
        }
      }
      this._syncEditorChrome();
      this._syncYearScrubLayout();
      this._fillHoverReadout(this._idleReadoutSeconds(), { hovering: false });
      return;
    }
    const { events, curve } = this._sunPath;
    const isToday = Boolean(this._sunPath.today);
    const nowSeconds = nowSecondsSinceMidnight();
    const elevations = curve.map((point) => point[1]);
    for (const event of events) {
      elevations.push(event.elevation);
    }
    // Y scale is this location's annual max, not today's peak — a winter noon
    // that only just clears the horizon must sit near 0°, not the top of the plot.
    const peakElev = this._sunPath.max_elevation;
    const minElev = Math.min(-peakElev, ...elevations);
    const maxElev = Math.max(peakElev, ...elevations);
    const span = maxElev - minElev;
    const xOf = (seconds) =>
      PLOT_LEFT + (seconds / SECONDS_PER_DAY) * (PLOT_RIGHT - PLOT_LEFT);
    const yOf = (elevation) =>
      PLOT_TOP + ((maxElev - elevation) / span) * (PLOT_BOTTOM - PLOT_TOP);

    const nowElev = interpolateElevation(curve, nowSeconds);
    const horizonY = yOf(0);
    const hourLabels = ["00:00", "06:00", "12:00", "18:00", "24:00"];
    // Table/list chart: constant stroke — solid day, dashed night.
    const chartStrokeOf = () => 2;
    const horizonLook = skyLookFromElevation(0);
    const rampBottom = Math.min(CHART_HEIGHT - 4, horizonY + 56);
    const rampHeight = Math.max(0, rampBottom - horizonY);
    const pathRuns = sunStrokePathRuns(curve, chartStrokeOf)
      .map((run) => {
        const d = run.points
          .map(([seconds, elev], index) => {
            const x = xOf(seconds).toFixed(1);
            const y = yOf(elev).toFixed(1);
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join("");
        if (run.night) {
          // Night: dashed, slightly stronger than day opacity so it stays
          // readable over the horizon ramp.
          return `<path d="${d}" fill="none" stroke="color-mix(in srgb, var(--primary-text-color) 55%, transparent)" stroke-width="2px" stroke-opacity="0.9" stroke-dasharray="5 6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>`;
        }
        return `<path d="${d}" fill="none" stroke="var(--primary-text-color)" stroke-width="2px" stroke-opacity="1" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>`;
      })
      .join("");

    const svg = `
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="se-horizon-ramp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${horizonLook.pathColor}" stop-opacity="0.48"/>
            <stop offset="55%" stop-color="${horizonLook.pathColor}" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="${horizonLook.pathColor}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect x="${PLOT_LEFT}" y="${horizonY.toFixed(1)}" width="${PLOT_RIGHT - PLOT_LEFT}" height="${rampHeight.toFixed(1)}" fill="url(#se-horizon-ramp)"/>
        <line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${horizonY.toFixed(1)}" y2="${horizonY.toFixed(1)}" stroke="color-mix(in srgb, ${horizonLook.pathColor} 55%, var(--primary-text-color) 45%)" stroke-width="1.5" stroke-opacity="0.95" vector-effect="non-scaling-stroke"/>
        ${pathRuns}
      </svg>
    `;

    const eventsRow = document.createElement("div");
    eventsRow.className = "sun-events";
    const editable = this._view === "edit";
    for (const event of events) {
      const item = document.createElement(editable ? "button" : "div");
      item.className = "sun-event";
      if (editable) {
        item.type = "button";
        item.classList.add("clickable");
        item.dataset.eventId = event.id;
        if (this._sidebarEventId === event.id) {
          item.classList.add("selected");
          item.setAttribute("aria-current", "true");
        }
        item.addEventListener("click", () => this._toggleEventSceneDialog(event));
      }
      const bits = [];
      if (event.overridden) {
        bits.push(
          this._t(
            "frontend.chart.overridden_dusk",
            "{name} uses the dusk minimum ({solar_time} solar dusk)",
            { name: event.name, solar_time: event.solar_time }
          )
        );
      }
      if (event.fallback) {
        bits.push(
          this._t(
            "frontend.chart.seasonal_fallback",
            "Seasonal fallback (no real solar event this day)"
          )
        );
      }
      if (bits.length) {
        item.title = bits.join(" · ");
      } else {
        item.title = event.name;
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = event.name;
      const time = document.createElement("span");
      time.className = "time";
      if (event.overridden && event.solar_time) {
        const struck = document.createElement("span");
        struck.className = "solar-struck";
        struck.textContent = event.fallback
          ? `${event.solar_time}*`
          : event.solar_time;
        const clamp = document.createElement("span");
        clamp.className = "clamp-time";
        clamp.textContent = event.time;
        time.append(struck, clamp);
      } else {
        time.textContent = event.fallback ? `${event.time}*` : event.time;
      }
      item.append(name, time);
      if (editable) {
        const scene = document.createElement("span");
        scene.className = "scene";
        const sceneId = this._eventSceneId(event.id);
        const sceneName = this._sceneName(sceneId);
        scene.textContent =
          sceneName ||
          this._t("frontend.chart.choose_scene", "Choose scene");
        if (!sceneName) {
          scene.classList.add("empty");
          item.classList.add("missing");
        }
        item.appendChild(scene);
      }
      eventsRow.appendChild(item);
    }

    const chart = document.createElement("div");
    chart.className = "sun-chart";
    chart.innerHTML = svg;
    for (const event of events) {
      const markSeconds = this._eventMarkSeconds(event);
      const buttonSeconds = this._eventButtonSeconds(event);
      if (buttonSeconds == null && markSeconds == null) {
        continue;
      }
      const placeSeconds = buttonSeconds ?? markSeconds;
      const placeElev = interpolateElevation(curve, placeSeconds);
      const left = `${(xOf(placeSeconds) / CHART_WIDTH) * 100}%`;
      const top = `${yOf(placeElev)}px`;
      const sceneId = editable ? this._eventSceneId(event.id) : null;
      const sceneName = editable ? this._sceneName(sceneId) : null;
      const btn = document.createElement(editable ? "button" : "div");
      btn.className = "clock-event";
      if (!editable) {
        btn.classList.add("inert");
      } else {
        btn.type = "button";
        btn.dataset.eventId = event.id;
        if (!sceneName) {
          btn.classList.add("missing");
        }
        if (this._sidebarEventId === event.id) {
          btn.classList.add("selected");
          btn.setAttribute("aria-current", "true");
        }
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._toggleEventSceneDialog(event);
        });
      }
      btn.style.left = left;
      btn.style.top = top;
      btn.title = event.name;
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", event.icon);
      btn.appendChild(icon);
      chart.appendChild(btn);
      if (
        event.overridden &&
        markSeconds != null &&
        buttonSeconds != null &&
        buttonSeconds !== markSeconds
      ) {
        const markElev = interpolateElevation(curve, markSeconds);
        const markLeftPct = (xOf(markSeconds) / CHART_WIDTH) * 100;
        const markTopPx = yOf(markElev);
        const ghost = document.createElement("div");
        ghost.className = "clock-event ghost inert";
        ghost.style.left = `${markLeftPct}%`;
        ghost.style.top = `${markTopPx}px`;
        ghost.setAttribute("aria-hidden", "true");
        ghost.title = `${event.name} · solar ${event.solar_time || event.time}`;
        const ghostIcon = document.createElement("ha-icon");
        ghostIcon.setAttribute("icon", event.icon);
        ghost.appendChild(ghostIcon);
        chart.appendChild(ghost);
        const dyPx = yOf(placeElev) - markTopPx;
        const link = document.createElement("div");
        link.className = "sun-clamp-link";
        link.style.left = `${markLeftPct}%`;
        link.style.top = `${markTopPx}px`;
        chart.appendChild(link);
        requestAnimationFrame(() => {
          const w = chart.clientWidth;
          if (!(w > 0)) {
            return;
          }
          const dx =
            ((xOf(placeSeconds) / CHART_WIDTH) * 100 - markLeftPct) / 100 * w;
          link.style.width = `${Math.hypot(dx, dyPx)}px`;
          link.style.transform = `rotate(${(Math.atan2(dyPx, dx) * 180) / Math.PI}deg)`;
        });
      }
    }
    if (isToday) {
      const nowDot = document.createElement("div");
      nowDot.className = "sun-now";
      nowDot.title = `Now ${formatClock(nowSeconds)}`;
      nowDot.style.left = `${(xOf(nowSeconds) / CHART_WIDTH) * 100}%`;
      nowDot.style.top = `${yOf(nowElev)}px`;
      chart.appendChild(nowDot);
    }

    const hours = document.createElement("div");
    hours.className = "sun-hours";
    for (const label of hourLabels) {
      const span = document.createElement("span");
      span.textContent = label;
      hours.appendChild(span);
    }

    const readout = document.createElement("div");
    readout.className = "sun-hover-readout";
    readout.setAttribute("aria-live", "polite");
    this._hoverReadout = readout;

    const plots = document.createElement("div");
    plots.className = "sun-plots";
    const hoverLine = document.createElement("div");
    hoverLine.className = "sun-hover-line";
    this._hoverLine = hoverLine;
    let clockEl = null;
    if (this._view === "edit") {
      if (useClock) {
        clockEl = this._buildLightClock(events);
      } else {
        plots.append(chart, hours);
        const lights = this._buildLightBars(xOf, events);
        if (lights) {
          plots.appendChild(lights);
        }
      }
    } else {
      plots.append(chart, hours);
    }
    if (isToday && !useClock) {
      const nowLine = document.createElement("div");
      nowLine.className = "sun-now-line";
      nowLine.style.left = `${(xOf(nowSeconds) / CHART_WIDTH) * 100}%`;
      plots.appendChild(nowLine);
    }
    if (!useClock) {
      plots.appendChild(hoverLine);
      this._bindPlotHover(plots);
    } else {
      this._hoverLine = null;
    }

    const children = [];
    if (this._view === "edit") {
      if (!this._dateToolbar) {
        this._dateToolbar = this._buildDateToolbar();
      }
      if (this._dateToolbar.parentNode !== this._sunPathEl) {
        const before = this._sunPathStage || this._sunPathBodyEl;
        this._sunPathEl.insertBefore(this._dateToolbar, before);
      }
      if (this._yearScrubbing) {
        this._syncYearScrub();
      } else {
        this._syncDateToolbar();
      }
    } else if (this._dateToolbar) {
      this._dateToolbar.remove();
    }
    // Event assignment cards only in the editor; list uses inert chart buttons.
    children.push(...(useClock || !editable ? [] : [eventsRow]));
    if (events.some((event) => event.fallback)) {
      const note = document.createElement("p");
      note.className = "sun-fallback-note";
      note.textContent = this._t(
        "frontend.chart.fallback_note",
        "* Time uses a seasonal fallback because the sun does not rise or set that day."
      );
      children.push(note);
    }
    children.push(readout);
    if (!useClock) {
      children.push(plots);
    }
    if (clockEl) {
      children.push(clockEl);
    }

    this._sunPathEl.hidden = false;
    this._sunPathBodyEl.replaceChildren(...children);
    if (this._view === "edit") {
      this._syncEditorChrome();
      this._syncYearScrubLayout();
    } else {
      this._syncEditorChrome();
    }
    this._fillHoverReadout(this._idleReadoutSeconds(), { hovering: false });
    this._displayedSunPath = this._sunPath;
  }

  _secondsFromPlotPointer(ev, plots) {
    const rect = plots.getBoundingClientRect();
    const viewX = rect.width
      ? ((ev.clientX - rect.left) / rect.width) * CHART_WIDTH
      : PLOT_LEFT;
    const t = (viewX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
    return Math.max(0, Math.min(SECONDS_PER_DAY, t * SECONDS_PER_DAY));
  }

  _bindPlotHover(plots) {
    const apply = (seconds) => {
      this._hoverSeconds = seconds;
      const left = `${((PLOT_LEFT + (seconds / SECONDS_PER_DAY) * (PLOT_RIGHT - PLOT_LEFT)) / CHART_WIDTH) * 100}%`;
      this._hoverLine.style.left = left;
      plots.setAttribute("data-hovering", "");
      this._fillHoverReadout(seconds, { hovering: true });
    };
    const clear = () => {
      this._hoverSeconds = undefined;
      plots.removeAttribute("data-hovering");
      this._fillHoverReadout(
        this._sunPath?.today ? nowSecondsSinceMidnight() : null,
        { hovering: false }
      );
    };
    plots.addEventListener("pointermove", (ev) => {
      this._pendingHoverX = ev.clientX;
      if (this._hoverRaf) {
        return;
      }
      this._hoverRaf = window.requestAnimationFrame(() => {
        this._hoverRaf = undefined;
        if (this._pendingHoverX == null) {
          return;
        }
        apply(this._secondsFromPlotPointer({ clientX: this._pendingHoverX }, plots));
      });
    });
    plots.addEventListener("pointerleave", () => {
      this._pendingHoverX = undefined;
      if (this._hoverRaf) {
        window.cancelAnimationFrame(this._hoverRaf);
        this._hoverRaf = undefined;
      }
      clear();
    });
  }

  _fillHoverReadout(seconds, { hovering }) {
    this._updateLightNameBrightness(seconds);
    const readout = this._hoverReadout;
    if (!readout) {
      return;
    }
    readout.replaceChildren();
    if (seconds == null) {
      seconds = nowSecondsSinceMidnight();
    }
    if (hovering) {
      readout.setAttribute("data-active", "");
    } else {
      readout.removeAttribute("data-active");
    }
    const time = document.createElement("span");
    time.className = "sun-hover-time";
    const eventIdle =
      !hovering &&
      this._sidebarEventId &&
      (this._sunPath?.events || []).some((e) => e.id === this._sidebarEventId);
    const sticky = this._clockStickySeconds != null;
    time.textContent =
      hovering || eventIdle || sticky
        ? formatClock(seconds)
        : `Now ${formatClock(seconds)}`;
    const sun = document.createElement("span");
    const elev = interpolateElevation(this._sunPath.curve, seconds);
    sun.textContent = `Sun ${elev.toFixed(1)}°`;
    // Always reserve the reset slot so time/° do not shift when sticky.
    const resetSlot = document.createElement("span");
    resetSlot.className = "sun-hover-reset-slot";
    if (sticky && this._view === "edit" && this._lightView === "dial") {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "sun-hover-reset";
      reset.title = "Reset to now";
      reset.setAttribute("aria-label", "Reset sun to current time");
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:restore");
      reset.appendChild(icon);
      reset.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._resetClockSunToNow();
      });
      resetSlot.appendChild(reset);
    }
    readout.append(time, sun, resetSlot);
  }

  _resetClockSunToNow() {
    this._clockStickySeconds = undefined;
    this._clockSunDragging = false;
    this._hoverSeconds = undefined;
    this._clockSunLive = false;
    const now = nowSecondsSinceMidnight();
    this._moveClockSunTo(now, { durationMs: CLOCK_SUN_MOVE_MS });
    this._fillHoverReadout(now, { hovering: false });
  }

  /** Ease the sun along the path when it relocates (event pin, reset, etc.). */
  _moveClockSunTo(toSeconds, { durationMs = CLOCK_SUN_MOVE_MS } = {}) {
    if (!this._clockSunEl || toSeconds == null) {
      return;
    }
    const to =
      ((toSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    const from = this._clockSunDisplayedSeconds ?? to;
    this._cancelClockSunArc();
    if (Math.abs(this._shortestSecondsDelta(from, to)) < 1) {
      this._applyClockSunAppearance(to);
      return;
    }
    this._animateClockSunArc(from, to, durationMs);
  }

  _updateLightNameBrightness(seconds) {
    for (const entry of this._lightNameLabels || []) {
      const { light, titleEl, subEl, el } = entry;
      // Dial cards: title + subtitle. Table bars: single name span.
      if (titleEl) {
        titleEl.textContent = light.name;
        if (!subEl) {
          continue;
        }
        if (seconds == null) {
          subEl.textContent = "";
          continue;
        }
        const sample = interpolateLightSample(light.samples || [], seconds);
        subEl.textContent = `${Math.round(sample.brightness)}%`;
        continue;
      }
      if (!el) {
        continue;
      }
      if (seconds == null) {
        el.textContent = light.name;
        continue;
      }
      const sample = interpolateLightSample(light.samples || [], seconds);
      el.replaceChildren();
      el.appendChild(document.createTextNode(`${light.name} `));
      const pct = document.createElement("span");
      pct.className = "light-brightness";
      pct.textContent = `${Math.round(sample.brightness)}%`;
      el.appendChild(pct);
    }
  }

  _secondsFromClockPointer(ev, face) {
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = ev.clientX - cx;
    const dy = ev.clientY - cy;
    // 0° at midnight (bottom), clockwise — matches conic-gradient(from 180deg).
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI + 180;
    deg = ((deg % 360) + 360) % 360;
    return (deg / 360) * SECONDS_PER_DAY;
  }

  _clockAngleDeg(seconds) {
    // Noon at top, midnight at bottom (180° offset from CSS 12-o'clock).
    return (seconds / SECONDS_PER_DAY) * 360 + 180;
  }

  _lightAtClockPointer(ev, ringsHost, ringLights) {
    if (!ringLights.length || !ringsHost) {
      return null;
    }
    const rect = ringsHost.getBoundingClientRect();
    const ringsRadius = Math.min(rect.width, rect.height) / 2;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = Math.hypot(ev.clientX - cx, ev.clientY - cy);
    if (r > ringsRadius || ringsRadius <= 0) {
      return null;
    }
    const pct = (r / ringsRadius) * 100;
    const n = ringLights.length;
    const hole = 0;
    const stroke = (100 - hole) / n;
    for (let index = 0; index < n; index += 1) {
      const midOuter = 100 - index * stroke;
      const midInner = Math.max(hole, midOuter - stroke);
      if (pct <= midOuter && pct >= midInner) {
        return ringLights[index];
      }
    }
    // Center falls in the innermost ring when the hole is filled.
    if (pct < hole && n) {
      return ringLights[n - 1];
    }
    return null;
  }

  _clockSunIdleSeconds() {
    if (this._clockStickySeconds != null) {
      return this._clockStickySeconds;
    }
    const id = this._sidebarEventId;
    if (id) {
      const event = (this._sunPath?.events || []).find((item) => item.id === id);
      if (event?.seconds != null) {
        return event.seconds;
      }
    }
    return nowSecondsSinceMidnight();
  }

  _idleReadoutSeconds() {
    if (this._clockStickySeconds != null) {
      return this._clockStickySeconds;
    }
    if (this._sidebarEventId) {
      const event = (this._sunPath?.events || []).find(
        (item) => item.id === this._sidebarEventId
      );
      if (event?.seconds != null) {
        return event.seconds;
      }
    }
    // Wall-clock “now” on any preview date — sun elev comes from that day’s curve.
    return nowSecondsSinceMidnight();
  }

  /** Shortest signed seconds delta on the 24h circle (for arc lerps). */
  _shortestSecondsDelta(from, to) {
    let d =
      ((((to - from) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY);
    if (d > SECONDS_PER_DAY / 2) {
      d -= SECONDS_PER_DAY;
    }
    return d;
  }

  _cancelClockSunArc() {
    if (this._clockSunArcRaf) {
      window.cancelAnimationFrame(this._clockSunArcRaf);
      this._clockSunArcRaf = undefined;
    }
  }

  /**
   * Ease the sun along the elevation curve by chasing time-of-day.
   * Retargeting mid-flight only updates the goal — exponential smoothing
   * keeps motion on the arc without restarting a CSS/tween chord.
   */
  _setClockSunArcTarget(seconds, { thenLive = false } = {}) {
    this._clockSunArcTo =
      ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    this._clockSunArcThenLive = thenLive;
    this._clockSunArcLastTick = performance.now();
    if (!this._clockSunArcRaf) {
      this._clockSunArcRaf = window.requestAnimationFrame((t) =>
        this._tickClockSunArc(t)
      );
    }
  }

  _tickClockSunArc(now) {
    const last = this._clockSunArcLastTick ?? now;
    this._clockSunArcLastTick = now;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    const cur =
      this._clockSunDisplayedSeconds ?? this._clockSunIdleSeconds();
    const target = this._clockSunArcTo;
    const d = this._shortestSecondsDelta(cur, target);
    // Don't treat a zero-dt first frame as "arrived" (that snapped the
    // return-to-idle motion when hover ended).
    if (dt < 0.001) {
      this._clockSunArcRaf = window.requestAnimationFrame((t) =>
        this._tickClockSunArc(t)
      );
      return;
    }
    // ~0.11s time-constant ≈ settles in ~300ms; follows a moving pointer.
    const tau = 0.11;
    const step = d * (1 - Math.exp(-dt / tau));
    if (Math.abs(d) < 0.75) {
      this._clockSunArcRaf = undefined;
      this._applyClockSunAppearance(target);
      if (this._clockSunArcThenLive && this._hoverSeconds != null) {
        this._clockSunLive = true;
        this._applyClockSunAppearance(this._hoverSeconds);
      }
      return;
    }
    let s = cur + step;
    s = ((s % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    this._applyClockSunAppearance(s);
    this._clockSunArcRaf = window.requestAnimationFrame((t) =>
      this._tickClockSunArc(t)
    );
  }

  /** Today's peak elevation from the sun curve (may be ≤0 in polar night). */
  _clockDayPeakElevation() {
    const curve = this._sunPath?.curve;
    if (!curve?.length) {
      return 0;
    }
    let peak = -Infinity;
    for (const [, elev] of curve) {
      peak = Math.max(peak, elev);
    }
    return peak;
  }

  /**
   * Perfect-circle path radius for the preview day: larger in summer (high
   * peak), smaller in winter. Clamped between planet+pad and face−pad so the
   * stroke (and large night sun) clear the dial and the core edge.
   */
  _clockSunPathRadius() {
    const sunClear = CLOCK_SUN_R_VIEW * CLOCK_SUN_SCALE_MAX;
    const rMin = CLOCK_RINGS_OUTER + CLOCK_SUN_PATH_PAD + sunClear;
    // Mobile events sit on the path — use more of the core toward the ticks.
    const narrow =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 870px)").matches;
    const edgeScale = narrow ? 0.97 : 0.9;
    const rMax =
      (CLOCK_VIEW / 2 - CLOCK_SUN_PATH_PAD - sunClear) * edgeScale;
    const lo = Math.min(rMin, rMax);
    const hi = Math.max(rMin, rMax);
    const annual = Math.max(this._sunPath?.max_elevation || 0, 1e-6);
    const dayPeak = this._clockDayPeakElevation();
    const t = Math.min(1, Math.max(0, dayPeak / annual));
    return lo + t * (hi - lo);
  }

  _clockSunPathRadiusOf(_elevation) {
    return this._clockSunPathRadius();
  }

  /** Smallest at daytime zenith; largest at sunrise/sunset; fixed max at night. */
  _clockSunScale(elevation) {
    if (elevation < 0) {
      return CLOCK_SUN_SCALE_MAX;
    }
    const peak = Math.max(this._sunPath?.max_elevation || 0, 1e-6);
    const t = Math.min(1, Math.max(0, elevation / peak));
    return CLOCK_SUN_SCALE_MAX + (1 - CLOCK_SUN_SCALE_MAX) * t;
  }

  _clockSunXy(seconds, elevation) {
    const elev =
      elevation ?? interpolateElevation(this._sunPath?.curve || [], seconds);
    const deg = this._clockAngleDeg(seconds);
    const rad = ((deg - 90) * Math.PI) / 180;
    const r = this._clockSunPathRadiusOf(elev);
    return {
      x: CLOCK_CX + Math.cos(rad) * r,
      y: CLOCK_CY + Math.sin(rad) * r,
      r,
      rad,
      elev,
    };
  }

  _clockPolar(seconds, radius) {
    const deg = this._clockAngleDeg(seconds);
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      deg,
      rad,
      cos: Math.cos(rad),
      sin: Math.sin(rad),
      x: CLOCK_CX + Math.cos(rad) * radius,
      y: CLOCK_CY + Math.sin(rad) * radius,
    };
  }

  _clockWedgePath(fromSeconds, toSeconds, radius = CLOCK_SKY_R) {
    let span =
      (((toSeconds - fromSeconds) % SECONDS_PER_DAY) + SECONDS_PER_DAY) %
      SECONDS_PER_DAY;
    if (span < 1) {
      span = SECONDS_PER_DAY;
    }
    const start = this._clockPolar(fromSeconds, radius);
    const end = this._clockPolar(fromSeconds + span, radius);
    const large = span / SECONDS_PER_DAY > 0.5 ? 1 : 0;
    return `M ${CLOCK_CX} ${CLOCK_CY} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
  }

  _clockEventSeconds(events, id) {
    const event = (events || []).find((item) => item.id === id);
    return this._eventMarkSeconds(event);
  }

  /** True solar time for path/sky marks (ignores earliest-dusk clamp). */
  _eventMarkSeconds(event) {
    if (!event || event.seconds == null) {
      return null;
    }
    if (event.overridden && event.solar_seconds != null) {
      return event.solar_seconds;
    }
    return event.seconds;
  }

  /** Effective scene time (clamped when earliest-dusk applies). */
  _eventButtonSeconds(event) {
    return event?.seconds != null ? event.seconds : null;
  }

  _applyClockSunAppearance(seconds, { skipHorizonGlow = false } = {}) {
    const curve = this._sunPath?.curve;
    if (!curve?.length) {
      return;
    }
    this._clockSunDisplayedSeconds = seconds;
    const elev = interpolateElevation(curve, seconds);
    const glowLook = skyLookFromElevation(elev);
    const pos = this._clockSunXy(seconds, elev);
    // Year-scrub must never leave us updating a detached sun while the visible
    // outline stays put — reattach refs to the live core nodes if needed.
    this._ensureLiveClockSunEls();
    const sun = this._clockSunEl;
    const sunHit = this._clockSunHitEl;
    const scale = this._clockSunScale(elev);
    if (sun) {
      sun.style.left = `${(pos.x / CLOCK_VIEW) * 100}%`;
      sun.style.top = `${(pos.y / CLOCK_VIEW) * 100}%`;
      sun.style.setProperty("--sun-scale", String(scale));
      sun.classList.toggle("below-horizon", elev < 0);
      sun.setAttribute(
        "aria-label",
        `Sun ${elev >= 0 ? "above" : "below"} horizon`
      );
      this._layoutClockSunFill(pos, scale);
      this._layoutClockHandle(seconds, elev, scale);
    } else {
      this._layoutClockHandle(seconds, elev, 1);
    }
    if (sunHit) {
      sunHit.style.left = `${(pos.x / CLOCK_VIEW) * 100}%`;
      sunHit.style.top = `${(pos.y / CLOCK_VIEW) * 100}%`;
      sunHit.style.setProperty("--sun-scale", String(scale));
    }
    const handleHit = this._clockHandleHitEl;
    if (handleHit) {
      handleHit.style.setProperty(
        "--handle-deg",
        `${this._clockAngleDeg(seconds)}deg`
      );
    }
    // Dial glow is a blurred clone of the rings — not elevation-tinted.
    // Skip rim rebuild mid-morph — sunrise/sunset lerps made the bottom flash.
    if (!skipHorizonGlow) {
      this._updateHorizonGlow(elev, glowLook);
    }
    this._updateOverrideArc(this._clockStickySeconds);
  }

  /** Prefer connected core sun/hit nodes over detached paint leftovers. */
  _ensureLiveClockSunEls() {
    const core =
      this._clockFaceEl?.querySelector(".sun-light-clock-core") ||
      this._clockSunEl?.parentElement;
    if (!core) {
      return;
    }
    if (!this._clockSunEl?.isConnected) {
      const live = core.querySelector(":scope > .clock-sun");
      if (live) {
        this._clockSunEl = live;
      }
    }
    if (!this._clockSunHitEl?.isConnected) {
      const liveHit = core.querySelector(":scope > .clock-sun-hit");
      if (liveHit) {
        this._clockSunHitEl = liveHit;
      }
    }
    if (!this._clockSunFillEl?.isConnected) {
      const liveFill = this._clockOverlayEl?.querySelector(
        ".clock-sun-day-group .clock-sun-fill"
      );
      if (liveFill) {
        const group = liveFill.parentElement;
        this._clockSunFillEl = liveFill;
        this._clockSunGlowEl = group?.querySelector(".clock-sun-glow-disc") || null;
        this._clockSunShadowEl =
          group?.querySelector(".clock-sun-shadow-disc") || null;
      }
    }
  }

  _layoutClockHorizonBack() {
    const back = this._clockHorizonBackEl;
    const face = this._clockFaceEl;
    if (!back || !face) {
      return;
    }
    const host = this.getBoundingClientRect();
    const fr = face.getBoundingClientRect();
    if (fr.width < 8 || host.width < 8) {
      return;
    }
    const cx = fr.left + fr.width / 2;
    const cy = fr.top + fr.height / 2;
    // Reach the light list under the face so horizon/bloom fill behind it —
    // but stop ~156px past the list so an abspos back cannot inflate scroll
    // height when an ancestor becomes a scrollport (overflow-x: clip quirk).
    const clock = face.closest(".sun-light-clock");
    const legend = this._clockLegendEl;
    const listBottom =
      legend?.getBoundingClientRect().bottom ??
      clock?.getBoundingClientRect().bottom ??
      fr.bottom;
    const contentBottom = listBottom + 156;
    // Cover the full panel host from the face center — including when the
    // dial shifts left for an open sidebar (gutter). Axis + corners so a
    // square always fills the viewport under the drawer.
    const reach = Math.max(
      cx - host.left,
      host.right - cx,
      cy - host.top,
      Math.min(host.bottom, contentBottom) - cy,
      contentBottom - cy,
      Math.hypot(cx - host.left, cy - host.top),
      Math.hypot(host.right - cx, cy - host.top),
      Math.hypot(cx - host.left, Math.min(host.bottom, contentBottom) - cy),
      Math.hypot(host.right - cx, Math.min(host.bottom, contentBottom) - cy),
      fr.width * 0.62
    );
    const side = reach * 2 + 2;
    back.style.width = `${side}px`;
    back.style.height = `${side}px`;
  }

  _ensureOverrideArc(overlay) {
    const defs =
      overlay.querySelector("defs") ||
      overlay.insertBefore(
        document.createElementNS("http://www.w3.org/2000/svg", "defs"),
        overlay.firstChild
      );
    let grad = defs.querySelector("#clock-override-glow-grad");
    if (!grad) {
      grad = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "radialGradient"
      );
      grad.setAttribute("id", "clock-override-glow-grad");
      grad.setAttribute("cx", "50%");
      grad.setAttribute("cy", "50%");
      grad.setAttribute("r", "50%");
      defs.appendChild(grad);
    }
    while (grad.firstChild) {
      grad.removeChild(grad.firstChild);
    }
    const mk = (offset, opacity) => {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      stop.setAttribute("offset", offset);
      // Warm white–gold; a touch more opaque than the prior soft wash.
      stop.setAttribute("stop-color", "#ffe08a");
      stop.setAttribute("stop-opacity", String(opacity));
      grad.appendChild(stop);
    };
    // Half the prior inward reach; slightly less transparent than rev 121.
    mk("0%", 0);
    mk("78%", 0);
    mk("90%", 0.1);
    mk("100%", 0.24);
    let clip = defs.querySelector("#clock-override-wedge");
    if (!clip) {
      clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clip.setAttribute("id", "clock-override-wedge");
      clip.setAttribute("clipPathUnits", "userSpaceOnUse");
      const slice = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      clip.appendChild(slice);
      defs.appendChild(clip);
      this._clockOverrideWedgePathEl = slice;
    } else {
      this._clockOverrideWedgePathEl = clip.querySelector("path");
    }
    let glow = overlay.querySelector(".clock-override-glow");
    if (!glow) {
      glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      glow.setAttribute("class", "clock-override-glow");
      glow.setAttribute("cx", String(CLOCK_CX));
      glow.setAttribute("cy", String(CLOCK_CY));
      glow.setAttribute("r", String(CLOCK_OVERRIDE_R));
      glow.setAttribute("fill", "url(#clock-override-glow-grad)");
      glow.setAttribute("clip-path", "url(#clock-override-wedge)");
      glow.setAttribute("visibility", "hidden");
      overlay.appendChild(glow);
    }
    let arc = overlay.querySelector(".clock-override-arc");
    if (!arc) {
      arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arc.setAttribute("class", "clock-override-arc");
      arc.setAttribute("vector-effect", "non-scaling-stroke");
      arc.setAttribute("stroke-width", "1px");
      arc.setAttribute("visibility", "hidden");
      overlay.appendChild(arc);
    }
    this._clockOverrideGlowEl = glow;
    this._clockOverrideArcEl = arc;
  }

  _updateOverrideArc(overrideSeconds) {
    const glow = this._clockOverrideGlowEl;
    const arc = this._clockOverrideArcEl;
    const wedge = this._clockOverrideWedgePathEl;
    if (!glow || !arc || !wedge) {
      return;
    }
    if (overrideSeconds == null) {
      glow.setAttribute("visibility", "hidden");
      arc.setAttribute("visibility", "hidden");
      return;
    }
    const now = nowSecondsSinceMidnight();
    const delta = this._shortestSecondsDelta(now, overrideSeconds);
    if (Math.abs(delta) < 45) {
      glow.setAttribute("visibility", "hidden");
      arc.setAttribute("visibility", "hidden");
      return;
    }
    const r = this._clockOverrideR ?? CLOCK_OVERRIDE_R;
    glow.setAttribute("r", String(r));
    const start = this._clockPolar(now, r);
    const end = this._clockPolar(overrideSeconds, r);
    const absSpan = Math.abs(delta);
    const large = absSpan / SECONDS_PER_DAY > 0.5 ? 1 : 0;
    // Time increases clockwise on this dial; negative delta sweeps the other way.
    const sweep = delta >= 0 ? 1 : 0;
    const arcD = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    const wedgeD = `M ${CLOCK_CX} ${CLOCK_CY} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
    arc.setAttribute("d", arcD);
    wedge.setAttribute("d", wedgeD);
    glow.setAttribute("visibility", "visible");
    arc.setAttribute("visibility", "visible");
  }

  _layoutClockHandle(seconds, elev, scale = 1) {
    const inner = this._clockHandleInnerEl;
    const outer = this._clockHandleOuterEl;
    if (!inner || !outer) {
      return;
    }
    const pos = this._clockSunXy(seconds, elev);
    const sunR = CLOCK_SUN_R_VIEW * scale;
    const dist = Math.hypot(pos.x - CLOCK_CX, pos.y - CLOCK_CY);
    const near = this._clockPolar(seconds, Math.max(0, dist - sunR));
    const far = this._clockPolar(seconds, dist + sunR);
    const tip = this._clockPolar(
      seconds,
      Math.max(CLOCK_TICK_OUTER, dist + sunR + 4)
    );
    inner.setAttribute("x1", String(CLOCK_CX));
    inner.setAttribute("y1", String(CLOCK_CY));
    inner.setAttribute("x2", near.x.toFixed(2));
    inner.setAttribute("y2", near.y.toFixed(2));
    outer.setAttribute("x1", far.x.toFixed(2));
    outer.setAttribute("y1", far.y.toFixed(2));
    outer.setAttribute("x2", tip.x.toFixed(2));
    outer.setAttribute("y2", tip.y.toFixed(2));
  }

  _horizonWeight(seconds, center, band) {
    let delta = Math.abs(seconds - center);
    delta = Math.min(delta, SECONDS_PER_DAY - delta);
    if (delta >= band) {
      return 0;
    }
    return 0.5 * (1 + Math.cos((delta / band) * Math.PI));
  }

  _rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  _lerpRgb(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  /**
   * Continuous core→outer RGB stops for the horizon rim (then → surface).
   * Colorful gold→pink→purple only through civil twilight; at dusk (sun −6°,
   * “last light”) and below the rim is dark blue only — no afterglow pinks.
   * Elevation keyframes share the same stop count so scrub never jumps.
   */
  _horizonSpectrumStops(elev) {
    const light = !this.hasAttribute("data-dark-mode");
    // 5 stops: near-sun → mid → far, then caller mixes into surface.
    // Dusk/dawn in this product = civil ±6° (see scene_dusk helper copy).
    const keys = light
      ? [
          {
            e: -90,
            stops: [
              [130, 145, 175],
              [145, 158, 185],
              [160, 172, 198],
              [175, 185, 208],
              [190, 198, 218],
            ],
          },
          {
            // At/after dusk: dark-blue wash only (soft for light surfaces).
            e: -6,
            stops: [
              [120, 140, 180],
              [135, 152, 188],
              [150, 165, 198],
              [168, 180, 208],
              [185, 195, 218],
            ],
          },
          {
            e: 0,
            // Gold → coral → pink → mauve → soft sky (sunset / last civil light).
            stops: [
              [255, 178, 88],
              [245, 140, 96],
              [236, 120, 150],
              [196, 148, 210],
              [158, 200, 245],
            ],
          },
          {
            e: 8,
            stops: [
              [126, 200, 255],
              [140, 206, 255],
              [168, 216, 250],
              [196, 228, 252],
              [220, 238, 255],
            ],
          },
          {
            e: 90,
            stops: [
              [79, 179, 255],
              [120, 198, 255],
              [158, 214, 252],
              [190, 226, 255],
              [220, 238, 255],
            ],
          },
        ]
      : [
          {
            e: -90,
            stops: [
              [8, 12, 28],
              [10, 16, 40],
              [12, 20, 48],
              [14, 24, 56],
              [18, 30, 68],
            ],
          },
          {
            // At/after dusk (−6°): dark blue only — pink/purple end with last light.
            e: -6,
            stops: [
              [28, 45, 100],
              [22, 38, 85],
              [16, 30, 70],
              [12, 22, 55],
              [10, 16, 42],
            ],
          },
          {
            e: 0,
            // Gold/orange core (Rayleigh), then pink, mauve, blue through twilight.
            stops: [
              [255, 170, 85],
              [245, 140, 100],
              [232, 120, 160],
              [150, 90, 180],
              [70, 120, 200],
            ],
          },
          {
            e: 8,
            stops: [
              [100, 185, 250],
              [79, 179, 255],
              [70, 150, 230],
              [50, 110, 190],
              [36, 80, 150],
            ],
          },
          {
            e: 90,
            stops: [
              [79, 179, 255],
              [64, 165, 250],
              [50, 130, 220],
              [36, 90, 170],
              [28, 64, 120],
            ],
          },
        ];
    let lo = keys[0];
    let hi = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (elev >= keys[i].e && elev <= keys[i + 1].e) {
        lo = keys[i];
        hi = keys[i + 1];
        break;
      }
      if (elev < keys[0].e) {
        lo = hi = keys[0];
        break;
      }
    }
    if (elev > keys[keys.length - 1].e) {
      lo = hi = keys[keys.length - 1];
    }
    const span = hi.e - lo.e || 1;
    const t = lo === hi ? 0 : (elev - lo.e) / span;
    return lo.stops.map((a, i) => this._lerpRgb(a, hi.stops[i], t));
  }

  /** Color along spectrum for band weight 1 (event) → 0 (surface). */
  _horizonBandColor(weight, spectrumStops) {
    const SURFACE = "var(--primary-background-color)";
    const u = 1 - Math.min(1, Math.max(0, weight));
    // Evenly space RGB stops, then a final segment into the surface color.
    const n = spectrumStops.length;
    const pos = u * n;
    if (pos >= n - 1e-6) {
      return SURFACE;
    }
    const i = Math.min(n - 1, Math.floor(pos));
    const f = pos - i;
    if (i >= n - 1) {
      const pct = Math.round((1 - f) * 100);
      if (pct >= 100) {
        return this._rgbCss(spectrumStops[n - 1]);
      }
      if (pct <= 0) {
        return SURFACE;
      }
      return `color-mix(in srgb, ${this._rgbCss(spectrumStops[n - 1])} ${pct}%, ${SURFACE})`;
    }
    return this._rgbCss(this._lerpRgb(spectrumStops[i], spectrumStops[i + 1], f));
  }

  /**
   * Day-wedge sky from elevation (smooth; light = crispy blue).
   */
  _horizonDaySky(elev, spectrumStops) {
    const light = !this.hasAttribute("data-dark-mode");
    if (light) {
      return CLOCK_DAY_SKY_LIGHT;
    }
    return elev >= 4
      ? this._rgbCss(spectrumStops[0])
      : "rgb(79, 179, 255)";
  }

  _updateHorizonGlow(elev, _glowLook) {
    const el = this._clockHorizonGlowEl;
    if (!el) {
      return;
    }
    const sunrise = this._clockSunriseSeconds;
    const sunset = this._clockSunsetSeconds;
    if (sunrise == null && sunset == null) {
      this._horizonGlowCacheKey = null;
      el.style.background = "transparent";
      if (this._clockSkyDayEl) {
        this._clockSkyDayEl.setAttribute("fill", "transparent");
      }
      return;
    }
    const maxElev = Math.max(this._sunPath?.max_elevation || 0, 1e-6);
    // Skip rebuild when scrub elev has not moved enough to change the wash.
    const elevQ = Math.round(elev / 0.25) * 0.25;
    const cacheKey = `${elevQ}|${sunrise}|${sunset}|${maxElev.toFixed(2)}`;
    if (cacheKey === this._horizonGlowCacheKey) {
      return;
    }
    this._horizonGlowCacheKey = cacheKey;
    // Climb 0 at/below horizon → 1 at that day's peak (smooth; no hard palette cut).
    const climb = Math.min(1, Math.max(0, elev) / maxElev);
    const nearHorizon = elev < 0 ? 1 : 1 - climb;
    // Keep some wash at noon so sky blue still peeks; stronger near horizon.
    const strength = 0.42 + 0.58 * nearHorizon;
    // Wider band so gold→pink→purple→blue can stretch into surface.
    const band = 5 * 3600;
    const steps = 48;
    const stops = [];
    const spectrum = this._horizonSpectrumStops(elev);
    const daySky = this._horizonDaySky(elev, spectrum);
    for (let i = 0; i <= steps; i += 1) {
      const seconds = (i / steps) * SECONDS_PER_DAY;
      let weight = 0;
      if (sunrise != null) {
        weight = Math.max(weight, this._horizonWeight(seconds, sunrise, band));
      }
      if (sunset != null) {
        weight = Math.max(weight, this._horizonWeight(seconds, sunset, band));
      }
      const mix = Math.min(1, weight * strength);
      stops.push(
        `${this._horizonBandColor(mix, spectrum)} ${((i / steps) * 100).toFixed(2)}%`
      );
    }
    el.style.background = `conic-gradient(from 180deg, ${stops.join(", ")})`;

    // Day wedge (sunrise→sunset): crispy sky blue in light; elevation sky in dark.
    const dayEl = this._clockSkyDayEl;
    if (dayEl) {
      // Bridge civil twilight so fill alpha does not jump at elev=0.
      const twilight =
        elev >= 0 ? 1 : Math.min(1, Math.max(0, (elev + 6) / 6));
      const dayAlpha = 0.16 + 0.26 * twilight + 0.38 * climb;
      dayEl.setAttribute(
        "fill",
        `color-mix(in srgb, ${daySky} ${Math.round(dayAlpha * 100)}%, transparent)`
      );
    }
  }

  /** Sky wash removed — dial relies on night wedges + horizon rim glow only. */
  _updateSkyWash() {}

  _layoutClockSunFill(pos, scale) {
    const fill = this._clockSunFillEl;
    const glow = this._clockSunGlowEl;
    const shadow = this._clockSunShadowEl;
    if (!fill) {
      return;
    }
    const r = CLOCK_SUN_R_VIEW * scale * 0.94;
    fill.setAttribute("cx", pos.x.toFixed(2));
    fill.setAttribute("cy", pos.y.toFixed(2));
    fill.setAttribute("r", r.toFixed(2));
    if (glow) {
      // 50% larger than the prior 2.2× halo; shares the day-wedge clip.
      const glowR = r * 3.3;
      glow.setAttribute("cx", pos.x.toFixed(2));
      glow.setAttribute("cy", pos.y.toFixed(2));
      glow.setAttribute("r", glowR.toFixed(2));
    }
    if (shadow) {
      // Keep shadow inside the glow so the halo stays visible around it.
      const shadowR = r * 1.85;
      shadow.setAttribute("cx", pos.x.toFixed(2));
      shadow.setAttribute("cy", pos.y.toFixed(2));
      shadow.setAttribute("r", shadowR.toFixed(2));
    }
    // Without a sunrise/sunset wedge, hide fill+glow entirely below horizon.
    if (!this._clockSunDayClipId) {
      const below = this._clockSunEl?.classList.contains("below-horizon");
      const vis = below ? "hidden" : "visible";
      fill.setAttribute("visibility", vis);
      if (glow) {
        glow.setAttribute("visibility", vis);
      }
    }
  }

  _paintSunDayClip(overlay, events) {
    const sunrise = this._clockEventSeconds(events, "sunrise");
    const sunset = this._clockEventSeconds(events, "sunset");
    this._clockSunDayClipId = null;
    const defs =
      overlay.querySelector("defs") ||
      overlay.insertBefore(
        document.createElementNS("http://www.w3.org/2000/svg", "defs"),
        overlay.firstChild
      );
    let clip = defs.querySelector("#clock-sun-day-clip");
    if (sunset == null || sunrise == null) {
      clip?.remove();
      return;
    }
    if (!clip) {
      clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clip.setAttribute("id", "clock-sun-day-clip");
      clip.setAttribute("clipPathUnits", "userSpaceOnUse");
      defs.appendChild(clip);
    }
    let slice = clip.querySelector("path");
    if (!slice) {
      slice = document.createElementNS("http://www.w3.org/2000/svg", "path");
      clip.appendChild(slice);
    }
    slice.setAttribute("d", this._clockWedgePath(sunrise, sunset, CLOCK_SKY_R));
    this._clockSunDayClipId = "clock-sun-day-clip";
  }

  _paintHorizonShadow(overlay, events) {
    const sunrise = this._clockEventSeconds(events, "sunrise");
    const sunset = this._clockEventSeconds(events, "sunset");
    const dawn = this._clockEventSeconds(events, "dawn");
    const dusk = this._clockEventSeconds(events, "dusk");
    this._clockSunriseSeconds = sunrise;
    this._clockSunsetSeconds = sunset;
    this._clockSkyDayEl = null;
    if (sunset != null && sunrise != null) {
      // Day sector first (under night wedges) — sky-blue wash updates with elev.
      const day = document.createElementNS("http://www.w3.org/2000/svg", "path");
      day.setAttribute("class", "clock-sky-day");
      day.setAttribute("d", this._clockWedgePath(sunrise, sunset, CLOCK_SKY_R));
      overlay.appendChild(day);
      this._clockSkyDayEl = day;
      const night = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      night.setAttribute("class", "clock-sky-night");
      night.setAttribute("d", this._clockWedgePath(sunset, sunrise, CLOCK_SKY_R));
      overlay.appendChild(night);
    }
    if (dusk != null && dawn != null) {
      const deep = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      deep.setAttribute("class", "clock-sky-deep");
      deep.setAttribute("d", this._clockWedgePath(dusk, dawn, CLOCK_SKY_R));
      overlay.appendChild(deep);
    }
  }

  /** Timed ease along the elevation curve (used for the clock enter sweep). */
  _animateClockSunArc(fromSeconds, toSeconds, durationMs, { forward = false } = {}) {
    this._cancelClockSunArc();
    this._clockSunLive = false;
    const from =
      ((fromSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    const to =
      ((toSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    // Enter sweep wants a fixed 6h forward run; hover uses shortest arc.
    const delta = forward
      ? (((to - from) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
      : this._shortestSecondsDelta(from, to);
    const started = performance.now();
    this._applyClockSunAppearance(from);
    const tick = (now) => {
      const u = Math.min(1, (now - started) / durationMs);
      // Cubic ease-out: decelerates across more of the 1.5s than quintic.
      const eased = easeOutCubic(u);
      let s = from + delta * eased;
      s = ((s % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      this._applyClockSunAppearance(s);
      if (u < 1) {
        this._clockSunArcRaf = window.requestAnimationFrame(tick);
        return;
      }
      this._clockSunArcRaf = undefined;
      this._applyClockSunAppearance(to);
    };
    this._clockSunArcRaf = window.requestAnimationFrame(tick);
  }

  _playClockEnterAnimation(face) {
    const idle = this._clockSunIdleSeconds();
    const from =
      (((idle - 6 * 3600) % SECONDS_PER_DAY) + SECONDS_PER_DAY) %
      SECONDS_PER_DAY;
    face.classList.remove("clock-face-enter");
    // Restart CSS enter if the face was recycled in the same document.
    void face.offsetWidth;
    face.classList.add("clock-face-enter");
    const clearEnter = (ev) => {
      // Overlay + event-layer spin finish together (1.5s).
      if (ev.animationName && ev.animationName !== "clock-overlay-spin") {
        return;
      }
      face.classList.remove("clock-face-enter");
      face.removeEventListener("animationend", clearEnter);
    };
    face.addEventListener("animationend", clearEnter);
    this._animateClockSunArc(from, idle, 2250, { forward: true });
  }

  _paintClockSunPath(overlay, events, { includeSun = true } = {}) {
    const curve = this._sunPath?.curve;
    if (!curve?.length) {
      return;
    }
    this._paintSunDayClip(overlay, events);

    const r = this._clockSunPathRadius();
    const arcPath = (fromSeconds, toSeconds) => {
      let span =
        (((toSeconds - fromSeconds) % SECONDS_PER_DAY) + SECONDS_PER_DAY) %
        SECONDS_PER_DAY;
      if (span < 1) {
        return null;
      }
      const start = this._clockPolar(fromSeconds, r);
      const end = this._clockPolar(fromSeconds + span, r);
      const large = span / SECONDS_PER_DAY > 0.5 ? 1 : 0;
      return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    };
    // Night dashed arcs only below the horizon (no full-circle underlay).
    for (const run of sunStrokePathRuns(curve, () => CLOCK_SUN_PATH_WIDTH_PX)) {
      const from = run.points[0][0];
      const to = run.points[run.points.length - 1][0];
      const d = arcPath(from, to);
      if (!d) {
        continue;
      }
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      if (run.night) {
        path.setAttribute("class", "clock-sun-path-night");
      } else {
        path.setAttribute("class", "clock-sun-day");
      }
      path.setAttribute("d", d);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      path.setAttribute("stroke-width", "1px");
      overlay.appendChild(path);
    }

    const spokeOuter = Math.min(96, CLOCK_TICK_OUTER - 1);
    this._clockEventDotEls = [];
    this._clockEventSpokeEls = [];
    this._clockEventClampLinkEls = [];
    for (const event of events || []) {
      const markSeconds = this._eventMarkSeconds(event);
      if (markSeconds == null) {
        continue;
      }
      const pos = this._clockSunXy(markSeconds);
      const outer = this._clockPolar(markSeconds, spokeOuter);
      const spoke = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );
      spoke.setAttribute("class", "clock-event-ray");
      // Outer tip retargeted to mark chrome (ghost or button) in layout.
      spoke.setAttribute("x1", outer.x.toFixed(2));
      spoke.setAttribute("y1", outer.y.toFixed(2));
      spoke.setAttribute("x2", pos.x.toFixed(2));
      spoke.setAttribute("y2", pos.y.toFixed(2));
      spoke.dataset.eventId = event.id;
      overlay.appendChild(spoke);
      this._clockEventSpokeEls.push(spoke);
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      dot.setAttribute("class", "clock-event-dot");
      dot.setAttribute("cx", pos.x.toFixed(2));
      dot.setAttribute("cy", pos.y.toFixed(2));
      // r set in _layoutClockEventDots for a fixed screen size.
      overlay.appendChild(dot);
      this._clockEventDotEls.push(dot);
      const buttonSeconds = this._eventButtonSeconds(event);
      if (
        event.overridden &&
        buttonSeconds != null &&
        buttonSeconds !== markSeconds
      ) {
        const link = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );
        link.setAttribute("class", "clock-event-clamp-link");
        link.setAttribute("fill", "none");
        link.dataset.eventId = event.id;
        overlay.appendChild(link);
        this._clockEventClampLinkEls.push(link);
      }
    }

    // Year-scrub patch only refreshes path/marks — recreating sun chrome here
    // would replace _clockSunEl with a detached node and skip spoke layout.
    // Re-append the fill group so new paths stay *under* the sun (append order
    // otherwise paints the path on top of the fill; HTML outline is separate).
    if (!includeSun) {
      const dayGroup = overlay.querySelector(".clock-sun-day-group");
      if (dayGroup) {
        overlay.appendChild(dayGroup);
      }
      return;
    }

    const defs =
      overlay.querySelector("defs") ||
      overlay.insertBefore(
        document.createElementNS("http://www.w3.org/2000/svg", "defs"),
        overlay.firstChild
      );
    let glowGrad = defs.querySelector("#clock-sun-glow-grad");
    if (!glowGrad) {
      glowGrad = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "radialGradient"
      );
      glowGrad.setAttribute("id", "clock-sun-glow-grad");
      glowGrad.setAttribute("cx", "50%");
      glowGrad.setAttribute("cy", "50%");
      glowGrad.setAttribute("r", "50%");
      defs.appendChild(glowGrad);
    }
    while (glowGrad.firstChild) {
      glowGrad.removeChild(glowGrad.firstChild);
    }
    const mkGlow = (offset, color, opacity) => {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      stop.setAttribute("stop-opacity", String(opacity));
      glowGrad.appendChild(stop);
    };
    // Soft warm halo via gradient only (no CSS blur — that trailed on scrub).
    mkGlow("0%", "#ffffff", 0.28);
    mkGlow("22%", "#ffffff", 0.9);
    mkGlow("48%", "#fff1c2", 0.58);
    mkGlow("72%", "#ffd27a", 0.28);
    mkGlow("100%", "#ffc878", 0);

    let shadowGrad = defs.querySelector("#clock-sun-shadow-grad");
    if (!shadowGrad) {
      shadowGrad = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "radialGradient"
      );
      shadowGrad.setAttribute("id", "clock-sun-shadow-grad");
      shadowGrad.setAttribute("cx", "50%");
      shadowGrad.setAttribute("cy", "50%");
      shadowGrad.setAttribute("r", "50%");
      defs.appendChild(shadowGrad);
    }
    while (shadowGrad.firstChild) {
      shadowGrad.removeChild(shadowGrad.firstChild);
    }
    const mkShadow = (offset, opacity) => {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", "#000");
      stop.setAttribute("stop-opacity", String(opacity));
      shadowGrad.appendChild(stop);
    };
    mkShadow("0%", 0.22);
    mkShadow("55%", 0.12);
    mkShadow("100%", 0);

    const clipUrl = this._clockSunDayClipId
      ? `url(#${this._clockSunDayClipId})`
      : null;

    // Shadow + glow + fill share the day wedge clip so they fade together
    // across the horizon (no hard on/off). Outline ring stays unclipped.
    overlay.querySelectorAll(".clock-sun-day-group").forEach((el) => el.remove());
    const shadow = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    shadow.setAttribute("class", "clock-sun-shadow-disc");
    shadow.setAttribute("fill", "url(#clock-sun-shadow-grad)");
    const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    glow.setAttribute("class", "clock-sun-glow-disc");
    glow.setAttribute("fill", "url(#clock-sun-glow-grad)");
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fill.setAttribute("class", "clock-sun-fill");
    fill.setAttribute("fill", "#fff");
    const dayGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    dayGroup.setAttribute("class", "clock-sun-day-group");
    if (clipUrl) {
      dayGroup.setAttribute("clip-path", clipUrl);
    }
    dayGroup.append(shadow, glow, fill);
    overlay.append(dayGroup);
    this._clockSunShadowEl = shadow;
    this._clockSunGlowEl = glow;
    this._clockSunFillEl = fill;
    this._clockSunNightEl = null;

    // Full build only — caller appends these to the core. Never create them
    // during year-scrub patch (includeSun: false) or the visible outline sticks.
    const marker = document.createElement("div");
    marker.className = "clock-sun";
    marker.setAttribute("aria-hidden", "true");
    const ring = document.createElement("span");
    ring.className = "clock-sun-ring";
    marker.appendChild(ring);
    this._clockSunEl = marker;

    const hit = document.createElement("div");
    hit.className = "clock-sun-hit";
    hit.setAttribute("role", "slider");
    hit.setAttribute("aria-label", "Drag to preview time of day");
    this._clockSunHitEl = hit;
    this._clockSunLive = false;
    this._cancelClockSunArc();
  }

  _layoutClockEventDots() {
    const core = this._clockSunEl?.parentElement;
    const dots = this._clockEventDotEls;
    if (!core || !dots?.length) {
      return;
    }
    const w = core.clientWidth;
    if (w < 8) {
      return;
    }
    // 6px screen diameter, independent of dial size.
    const r = (3 / w) * CLOCK_VIEW;
    for (const dot of dots) {
      dot.setAttribute("r", r.toFixed(3));
    }
  }

  /**
   * Place event labels to avoid collisions around the dial.
   * Top → above; bottom → below; left/right → first (topmost) above, rest below.
   */
  _layoutClockEventMetas(anchors) {
    if (!anchors?.length) {
      return;
    }
    // Ghosts have no labels — only active buttons compete for placement.
    anchors = anchors.filter((anchor) => !anchor.classList.contains("ghost"));
    if (!anchors.length) {
      return;
    }
    const TOP = -0.4;
    const BOTTOM = 0.4;
    const top = [];
    const bottom = [];
    const left = [];
    const right = [];
    for (const anchor of anchors) {
      const { cos, sin } = anchor._clockPolar || {};
      if (sin == null || cos == null) {
        continue;
      }
      if (sin <= TOP) {
        top.push(anchor);
      } else if (sin >= BOTTOM) {
        bottom.push(anchor);
      } else if (cos < 0) {
        left.push(anchor);
      } else {
        right.push(anchor);
      }
    }
    const setBelow = (anchor, below) => {
      anchor.querySelector(".clock-event-meta")?.classList.toggle("below", below);
    };
    for (const anchor of top) {
      setBelow(anchor, false);
    }
    for (const anchor of bottom) {
      setBelow(anchor, true);
    }
    // Topmost first on each side — that one keeps the label above.
    left.sort((a, b) => a._clockPolar.sin - b._clockPolar.sin);
    right.sort((a, b) => a._clockPolar.sin - b._clockPolar.sin);
    left.forEach((anchor, index) => setBelow(anchor, index !== 0));
    right.forEach((anchor, index) => setBelow(anchor, index !== 0));
  }

  /** Retarget dashed spokes from path dots to mark chrome; clamp links ghost→button. */
  _layoutClockEventSpokes() {
    const spokes = this._clockEventSpokeEls;
    const links = this._clockEventClampLinkEls;
    const face = this._clockFaceEl;
    const core = this._clockSunEl?.parentElement;
    if (!face || !core) {
      return;
    }
    const faceW = face.clientWidth;
    const coreW = core.clientWidth;
    const chrome = parseFloat(
      getComputedStyle(face).getPropertyValue("--clock-chrome")
    );
    if (!(faceW > 8) || !(coreW > 8) || !Number.isFinite(chrome)) {
      return;
    }
    const iconR = this._clockEventIconR;
    if (iconR == null) {
      return;
    }
    const chromePoint = (seconds) => {
      const deg = this._clockAngleDeg(seconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const faceX = (0.5 + (cos * iconR) / 100) * faceW;
      const faceY = (0.5 + (sin * iconR) / 100) * faceW;
      return {
        x: ((faceX - chrome) / coreW) * CLOCK_VIEW,
        y: ((faceY - chrome) / coreW) * CLOCK_VIEW,
      };
    };
    for (const spoke of spokes || []) {
      const id = spoke.dataset.eventId;
      const event = (this._sunPath?.events || []).find((item) => item.id === id);
      const markSeconds = this._eventMarkSeconds(event);
      if (markSeconds == null) {
        continue;
      }
      // Spoke aims at true-solar chrome (ghost when overridden, else button).
      const tip = chromePoint(markSeconds);
      spoke.setAttribute("x1", tip.x.toFixed(2));
      spoke.setAttribute("y1", tip.y.toFixed(2));
    }
    for (const link of links || []) {
      const id = link.dataset.eventId;
      const event = (this._sunPath?.events || []).find((item) => item.id === id);
      const markSeconds = this._eventMarkSeconds(event);
      const buttonSeconds = this._eventButtonSeconds(event);
      if (markSeconds == null || buttonSeconds == null) {
        continue;
      }
      const from = chromePoint(markSeconds);
      const to = chromePoint(buttonSeconds);
      // Arc along the event-button circle (same radius), shortest way.
      const r = Math.hypot(from.x - CLOCK_CX, from.y - CLOCK_CY);
      if (!(r > 1)) {
        continue;
      }
      const delta = this._shortestSecondsDelta(markSeconds, buttonSeconds);
      const absSpan = Math.abs(delta);
      if (absSpan < 30) {
        link.setAttribute("d", "");
        continue;
      }
      const large = absSpan / SECONDS_PER_DAY > 0.5 ? 1 : 0;
      // Positive delta = clockwise on this dial (matches override arc).
      const sweep = delta >= 0 ? 1 : 0;
      link.setAttribute(
        "d",
        `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
      );
    }
  }

  _paintClockHandle(overlay) {
    const handleInner = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    handleInner.setAttribute("class", "clock-handle");
    handleInner.setAttribute("vector-effect", "non-scaling-stroke");
    handleInner.setAttribute("stroke-width", "1.5px");
    const handleOuter = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    handleOuter.setAttribute("class", "clock-handle");
    handleOuter.setAttribute("vector-effect", "non-scaling-stroke");
    handleOuter.setAttribute("stroke-width", "1.5px");
    overlay.append(handleInner, handleOuter);
    this._clockHandleInnerEl = handleInner;
    this._clockHandleOuterEl = handleOuter;
  }

  _clockMagnetEvents() {
    return (this._sunPath?.events || []).filter(
      (event) => event?.seconds != null
    );
  }

  _nearestClockMagnet(seconds) {
    let best = null;
    let bestAbs = Infinity;
    for (const event of this._clockMagnetEvents()) {
      const delta = this._shortestSecondsDelta(seconds, event.seconds);
      const abs = Math.abs(delta);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = { event, delta, abs };
      }
    }
    return best;
  }

  /** Snap to a solar event only when the pointer is within the capture window. */
  _clockSnapTargetSeconds(pointerSeconds) {
    const nearest = this._nearestClockMagnet(pointerSeconds);
    if (nearest && nearest.abs <= CLOCK_SNAP_CAPTURE_SEC) {
      return nearest.event.seconds;
    }
    return pointerSeconds;
  }

  _bindClockSunDrag(face, handles) {
    const applyLive = (seconds) => {
      this._hoverSeconds = seconds;
      this._clockStickySeconds = seconds;
      this._applyClockSunAppearance(seconds);
      this._fillHoverReadout(seconds, { hovering: true });
    };
    const onMove = (ev) => {
      if (!this._clockPointerArmed) {
        return;
      }
      const origin = this._clockPointerOrigin;
      if (origin) {
        const dist = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
        if (dist >= CLOCK_DRAG_CLICK_PX) {
          this._clockSunDragging = true;
          // Keep the event sidebar open while dragging; close on release.
          if (this._sidebarEventId) {
            this._clockCloseSidebarAfterDrag = true;
          }
        }
      }
      if (!this._clockSunDragging) {
        return;
      }
      this._pendingClockHover = { clientX: ev.clientX, clientY: ev.clientY };
      if (this._clockHoverRaf) {
        return;
      }
      this._clockHoverRaf = window.requestAnimationFrame(() => {
        this._clockHoverRaf = undefined;
        if (!this._pendingClockHover || !this._clockSunDragging) {
          return;
        }
        const pointer = this._secondsFromClockPointer(
          this._pendingClockHover,
          face
        );
        applyLive(pointer);
      });
    };
    const onUp = (ev) => {
      if (!this._clockPointerArmed) {
        return;
      }
      this._clockPointerArmed = false;
      this._pendingClockHover = undefined;
      if (this._clockHoverRaf) {
        window.cancelAnimationFrame(this._clockHoverRaf);
        this._clockHoverRaf = undefined;
      }
      const wasDragging = this._clockSunDragging;
      this._clockSunDragging = false;
      try {
        ev.currentTarget.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* already released */
      }
      if (!wasDragging) {
        // Click — return to wall-clock now.
        this._resetClockSunToNow();
        return;
      }
      const pointer = this._secondsFromClockPointer(ev, face);
      const finalSeconds = this._clockSnapTargetSeconds(pointer);
      this._cancelClockSunArc();
      this._clockStickySeconds = finalSeconds;
      this._hoverSeconds = undefined;
      this._clockSunLive = false;
      // Snap only after release: 1s quintic ease-out (same curve as event pin).
      if (
        Math.abs(
          this._shortestSecondsDelta(
            this._clockSunDisplayedSeconds ?? pointer,
            finalSeconds
          )
        ) >= 1
      ) {
        this._moveClockSunTo(finalSeconds, { durationMs: CLOCK_SUN_MOVE_MS });
      } else {
        this._applyClockSunAppearance(finalSeconds);
      }
      this._fillHoverReadout(finalSeconds, { hovering: false });
      if (this._clockCloseSidebarAfterDrag) {
        this._clockCloseSidebarAfterDrag = false;
        this._closeSceneSidebar({ animate: true });
      }
    };
    const onDown = (ev) => {
      if (ev.button != null && ev.button !== 0) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      this._clockPointerArmed = true;
      this._clockSunDragging = false;
      this._clockCloseSidebarAfterDrag = false;
      this._clockPointerOrigin = { x: ev.clientX, y: ev.clientY };
      this._cancelClockSunArc();
      this._clockSunLive = true;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    };
    for (const el of handles) {
      if (!el) {
        continue;
      }
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    }
  }

  /**
   * Update an existing dial face for year scrub without replaceChildren.
   * Returns false when the light set changed and a full rebuild is required.
   *
   * morphing: mid refine/date morph — update ring fills + sun only. Skip bloom
   * clones and horizon wedge rebuilds (those are translucent layers that stack
   * and flash under the dial when destroyed/recreated every frame).
   */
  /**
   * Year-scrub / date morph may patch rings in place. After the list replaces
   * the body with the linear chart, those nodes are detached — patching them
   * would succeed and skip rebuilding the visible dial.
   */
  _forgetClockDom() {
    this._clockRingsHost = undefined;
    this._clockOverlayEl = undefined;
    this._clockGlowLayer = undefined;
    this._layoutDialChromeFn = undefined;
  }

  _patchLightClock(payload, { morphing = false } = {}) {
    const ringsHost = this._clockRingsHost;
    const overlay = this._clockOverlayEl;
    if (
      !ringsHost?.isConnected ||
      !overlay?.isConnected ||
      !payload?.events
    ) {
      return false;
    }
    const ringLights = this._clockRingLights(payload.lights || []);
    const rings = [...ringsHost.querySelectorAll(":scope > .clock-ring")];
    if (rings.length !== ringLights.length) {
      return false;
    }
    for (let index = 0; index < rings.length; index += 1) {
      if (rings[index].dataset.entityId !== ringLights[index].entity_id) {
        return false;
      }
    }
    for (let index = 0; index < rings.length; index += 1) {
      const bg = conicGradientFromSamples(ringLights[index].samples || []);
      const fill = rings[index].querySelector(".clock-ring-fill");
      if (fill) {
        fill.style.background = bg;
      }
    }
    // Bloom is two semi-transparent blurred clones of the same conics. Updating
    // them every morph frame doubles the mid-transition chroma under the dial;
    // sync once when morphing finishes.
    if (!morphing) {
      for (const glow of this._clockGlowLayer?.querySelectorAll(
        ":scope > .sun-light-clock-glow"
      ) || []) {
        const glowRings = glow.querySelectorAll(":scope > .clock-ring");
        for (let index = 0; index < glowRings.length; index += 1) {
          const fill = glowRings[index].querySelector(".clock-ring-fill");
          if (fill && ringLights[index]) {
            fill.style.background = conicGradientFromSamples(
              ringLights[index].samples || []
            );
          }
        }
      }
    }
    for (const sel of [
      ".clock-sun-day",
      ".clock-sun-path-night",
      ".clock-event-dot",
      ".clock-event-ray",
      ".clock-event-clamp-link",
    ]) {
      overlay.querySelectorAll(sel).forEach((el) => el.remove());
    }
    this._paintClockSunPath(overlay, payload.events, { includeSun: false });
    if (!morphing) {
      const sky = this._clockHorizonSkyEl;
      if (sky) {
        while (sky.firstChild) {
          sky.removeChild(sky.firstChild);
        }
        this._paintHorizonShadow(sky, payload.events);
      }
    } else {
      // Keep wedge geometry in sync without tear-down (avoids bottom flash).
      this._syncHorizonShadowPaths(payload.events);
    }
    this._syncClockEventAnchorsForScrub(payload.events);
    this._layoutDialChromeFn?.();
    const seconds =
      this._clockStickySeconds ??
      this._clockSunDisplayedSeconds ??
      this._clockSunIdleSeconds();
    this._applyClockSunAppearance(seconds, { skipHorizonGlow: morphing });
    if (this._hoverReadout) {
      this._fillHoverReadout(seconds, { hovering: false });
    }
    return true;
  }

  /** Update night/day wedge path `d` in place during morph (no node churn). */
  _syncHorizonShadowPaths(events) {
    const sky = this._clockHorizonSkyEl;
    if (!sky) {
      return;
    }
    const sunrise = this._clockEventSeconds(events, "sunrise");
    const sunset = this._clockEventSeconds(events, "sunset");
    const dawn = this._clockEventSeconds(events, "dawn");
    const dusk = this._clockEventSeconds(events, "dusk");
    this._clockSunriseSeconds = sunrise;
    this._clockSunsetSeconds = sunset;
    const dayEl = sky.querySelector(".clock-sky-day");
    const nightEl = sky.querySelector(".clock-sky-night");
    const deepEl = sky.querySelector(".clock-sky-deep");
    if (sunrise != null && sunset != null) {
      if (dayEl) {
        dayEl.setAttribute(
          "d",
          this._clockWedgePath(sunrise, sunset, CLOCK_SKY_R)
        );
        this._clockSkyDayEl = dayEl;
      }
      if (nightEl) {
        nightEl.setAttribute(
          "d",
          this._clockWedgePath(sunset, sunrise, CLOCK_SKY_R)
        );
      }
    }
    if (dusk != null && dawn != null && deepEl) {
      deepEl.setAttribute(
        "d",
        this._clockWedgePath(dusk, dawn, CLOCK_SKY_R)
      );
    }
  }

  /** Reposition / relabel event buttons mid-scrub (ghosts move with solar marks). */
  _syncClockEventAnchorsForScrub(events) {
    const anchors = this._clockEventAnchors || [];
    for (const anchor of anchors) {
      const eventId = anchor.dataset.eventId;
      const event = (events || []).find((item) => item.id === eventId);
      if (event == null) {
        continue;
      }
      const isGhost = anchor.classList.contains("ghost");
      const markSeconds = this._eventMarkSeconds(event);
      const buttonSeconds = this._eventButtonSeconds(event);
      const placeSeconds = isGhost ? markSeconds : buttonSeconds;
      if (placeSeconds == null) {
        continue;
      }
      if (isGhost) {
        const show =
          event.overridden &&
          markSeconds != null &&
          buttonSeconds != null &&
          markSeconds !== buttonSeconds;
        anchor.hidden = !show;
        if (!show) {
          continue;
        }
      }
      const deg = this._clockAngleDeg(placeSeconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      anchor._clockPolar = { cos: Math.cos(rad), sin: Math.sin(rad) };
      if (isGhost) {
        const ghostBtn = anchor.querySelector(".clock-event");
        if (ghostBtn) {
          ghostBtn.title = `${event.name} · solar ${event.solar_time || event.time}`;
        }
        continue;
      }
      const timeText = event.fallback ? `${event.time}*` : event.time;
      const heading = anchor.querySelector(".clock-event-heading");
      if (heading) {
        heading.textContent = `${event.name} · ${timeText}`;
      }
      const btn = anchor.querySelector(".clock-event");
      if (btn) {
        const sceneName = this._sceneName(this._eventSceneId(event.id));
        const solarHint =
          event.overridden && event.solar_time
            ? ` (solar ${event.solar_time})`
            : "";
        btn.title = sceneName
          ? `${event.name} · ${timeText}${solarHint} · ${sceneName}`
          : `${event.name} · ${timeText}${solarHint}`;
      }
    }
  }

  _buildLightClock(events) {
    this._lightNameLabels = [];
    const lights = this._sunPath.lights || [];
    const ringLights = this._clockRingLights(lights);
    const legendLights = this._legendLights(lights);
    const suggested = lights.filter((light) => light.suggested);
    const wrap = document.createElement("div");
    wrap.className = "sun-light-clock";

    const face = document.createElement("div");
    face.className = "sun-light-clock-face";
    face.setAttribute("role", "img");
    face.setAttribute(
      "aria-label",
      "24-hour light rings with sun elevation around the rim; midnight at the bottom"
    );

    // Horizon glow + event shadow sit behind the planet (and outside the core).
    const horizonBack = document.createElement("div");
    horizonBack.className = "clock-horizon-back";
    horizonBack.setAttribute("aria-hidden", "true");
    this._clockHorizonBackEl = horizonBack;
    this._clockFaceEl = face;
    const horizonGlow = document.createElement("div");
    horizonGlow.className = "clock-horizon-glow";
    this._clockHorizonGlowEl = horizonGlow;
    const skyOverlay = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    skyOverlay.setAttribute("class", "clock-horizon-sky");
    skyOverlay.setAttribute("viewBox", `0 0 ${CLOCK_VIEW} ${CLOCK_VIEW}`);
    this._paintHorizonShadow(skyOverlay, events);
    horizonBack.append(horizonGlow, skyOverlay);
    this._clockHorizonSkyEl = skyOverlay;

    const core = document.createElement("div");
    core.className = "sun-light-clock-core";

    const ringsHost = document.createElement("div");
    ringsHost.className = "sun-light-clock-rings";
    this._clockRingsHost = ringsHost;
    const n = ringLights.length;
    const hole = 0;
    const usable = 100 - hole;
    const stroke = n ? usable / n : 0;
    // Band edges are the true partitions; --clock-feather bleeds them into
    // neighbors in soft mode and drops to 0% in sharp (hover/selected) mode.
    for (let index = 0; index < n; index += 1) {
      const light = ringLights[index];
      const outer = 100 - index * stroke;
      const inner = Math.max(hole, outer - stroke);
      // --ring-expand / --ring-rim-w grow the hover rim; --clock-feather softens seams.
      const mask = `radial-gradient(farthest-side, transparent calc(var(--ring-inner) - var(--clock-feather) - var(--ring-expand)), #000 calc(var(--ring-inner) + var(--clock-feather) - var(--ring-expand)), #000 calc(var(--ring-outer) - var(--clock-feather) + var(--ring-expand)), transparent calc(var(--ring-outer) + var(--clock-feather) + var(--ring-expand)))`;
      const bg = conicGradientFromSamples(light.samples || []);

      const ring = document.createElement("div");
      ring.className = "clock-ring";
      ring.dataset.entityId = light.entity_id;
      ring.style.setProperty("--ring-inner", `${inner}%`);
      ring.style.setProperty("--ring-outer", `${outer}%`);
      if (light.entity_id === this._sidebarLightId) {
        ring.classList.add("selected");
        ring.setAttribute("aria-current", "true");
      }
      const fill = document.createElement("div");
      fill.className = "clock-ring-fill";
      fill.style.background = bg;
      fill.style.webkitMaskImage = mask;
      fill.style.maskImage = mask;
      ring.appendChild(fill);
      ring.title = light.name;
      ringsHost.appendChild(ring);
    }
    const hoverName = document.createElement("div");
    hoverName.className = "clock-ring-hover-name";
    hoverName.setAttribute("aria-live", "polite");
    hoverName.hidden = true;
    // On the core (not ringsHost — glow clones copy ringsHost). Positioned at
    // the rings inset so the pill sits flush above the outer light ring.
    const setHoveredRing = (entityId) => {
      let label = "";
      for (const ring of ringsHost.querySelectorAll(".clock-ring")) {
        const on =
          Boolean(entityId) && ring.dataset.entityId === entityId;
        ring.classList.toggle("hovered", on);
        if (on) {
          label = ring.title || "";
        }
      }
      if (label) {
        hoverName.textContent = label;
        hoverName.hidden = false;
      } else {
        hoverName.textContent = "";
        hoverName.hidden = true;
      }
    };
    const updateRingHover = (ev) => {
      // Block page scroll while a finger/pen scrubs across the planet.
      if (ev.cancelable && (ev.pointerType === "touch" || ev.pointerType === "pen")) {
        ev.preventDefault();
      }
      const light = this._lightAtClockPointer(ev, ringsHost, ringLights);
      setHoveredRing(light?.entity_id || null);
    };
    // Touch/pen: open on release (click is unreliable after preventDefault).
    let suppressRingClick = false;
    ringsHost.addEventListener("pointerdown", (ev) => {
      // Touch has no hover: capture so move events keep updating the band.
      if (ev.pointerType === "touch" || ev.pointerType === "pen") {
        if (ev.cancelable) {
          ev.preventDefault();
        }
        try {
          ringsHost.setPointerCapture(ev.pointerId);
        } catch (_err) {
          /* capture optional */
        }
      }
      updateRingHover(ev);
    });
    ringsHost.addEventListener("pointermove", updateRingHover);
    ringsHost.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch" || ev.pointerType === "pen") {
        const light = this._lightAtClockPointer(ev, ringsHost, ringLights);
        if (light) {
          openRingAt(ev, light);
          suppressRingClick = true;
        }
        setHoveredRing(null);
        if (ringsHost.hasPointerCapture?.(ev.pointerId)) {
          try {
            ringsHost.releasePointerCapture(ev.pointerId);
          } catch (_err) {
            /* optional */
          }
        }
      }
    });
    ringsHost.addEventListener("pointercancel", (ev) => {
      setHoveredRing(null);
      if (
        (ev.pointerType === "touch" || ev.pointerType === "pen") &&
        ringsHost.hasPointerCapture?.(ev.pointerId)
      ) {
        try {
          ringsHost.releasePointerCapture(ev.pointerId);
        } catch (_err) {
          /* optional */
        }
      }
    });
    ringsHost.addEventListener("pointerleave", (ev) => {
      // With capture, leave can fire mid-drag; only clear when not captured.
      if (ringsHost.hasPointerCapture?.(ev.pointerId)) {
        return;
      }
      setHoveredRing(null);
    });
    // Non-passive touchmove so preventDefault can block scroll on older engines.
    ringsHost.addEventListener(
      "touchmove",
      (ev) => {
        ev.preventDefault();
      },
      { passive: false }
    );
    const openRingAt = (ev, light) => {
      if (!light) {
        return;
      }
      // Clicking the already-selected ring deselects and closes the sidebar.
      if (light.entity_id === this._sidebarLightId) {
        this._requestCloseSceneSidebar();
        return;
      }
      const assigned = events.filter((item) => this._eventSceneId(item.id));
      if (!assigned.length) {
        return;
      }
      const seconds =
        this._clockSunDisplayedSeconds ??
        this._clockStickySeconds ??
        this._clockSunIdleSeconds();
      const closest = this._closestEvent(assigned, seconds);
      if (closest) {
        this._openLightEditDialog(light, closest);
      }
    };
    ringsHost.addEventListener("click", (ev) => {
      // Always stop: planet clicks must not hit the outside-deselect listener.
      ev.stopPropagation();
      if (suppressRingClick) {
        suppressRingClick = false;
        return;
      }
      openRingAt(ev, this._lightAtClockPointer(ev, ringsHost, ringLights));
    });
    ringsHost.tabIndex = 0;
    ringsHost.setAttribute("role", "listbox");
    ringsHost.setAttribute("aria-label", "Light rings");
    ringsHost.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") {
        return;
      }
      ev.preventDefault();
      const selected =
        ringLights.find((light) => light.entity_id === this._sidebarLightId) ||
        ringLights[0];
      openRingAt(ev, selected);
    });
    // Click outside the rings (and outside light-pickers / the sidebar)
    // clears the selection by closing the light editor.
    if (this._clockOutsideClick) {
      this.shadowRoot?.removeEventListener("click", this._clockOutsideClick);
    }
    this._clockOutsideClick = (ev) => {
      if (!this._sidebarLightId) {
        return;
      }
      const t = ev.target;
      if (!(t instanceof Element)) {
        return;
      }
      if (
        t.closest(
          ".scene-sidebar, .sun-light-clock-rings, .clock-legend-row.interactive, .clock-event, .sun-event"
        )
      ) {
        return;
      }
      this._requestCloseSceneSidebar();
    };
    this.shadowRoot.addEventListener("click", this._clockOutsideClick);
    // Soft bloom clones behind the interactive rings — same conic colors as the
    // planet (not elevation sky). Large + half-size layers share opacity.
    // Face-level layer (not inside core) so bloom paints over the horizon wash.
    const makeGlow = (mod) => {
      const glow = ringsHost.cloneNode(true);
      glow.className = `sun-light-clock-glow ${mod}`;
      glow.removeAttribute("tabindex");
      glow.removeAttribute("role");
      glow.removeAttribute("aria-label");
      glow.setAttribute("aria-hidden", "true");
      for (const ring of glow.querySelectorAll(".clock-ring")) {
        ring.classList.remove("selected", "hovered");
        ring.removeAttribute("aria-current");
        ring.removeAttribute("title");
      }
      return glow;
    };
    const glowLayer = document.createElement("div");
    glowLayer.className = "sun-light-clock-glow-layer";
    glowLayer.setAttribute("aria-hidden", "true");
    const glowLg = makeGlow("glow-lg");
    const glowMd = makeGlow("glow-md");
    glowLayer.append(glowLg, glowMd);
    this._clockSkyGlow = glowLg;
    this._clockGlowLayer = glowLayer;
    core.append(ringsHost, hoverName);

    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "sun-light-clock-overlay");
    overlay.setAttribute("viewBox", `0 0 ${CLOCK_VIEW} ${CLOCK_VIEW}`);
    overlay.setAttribute("aria-hidden", "true");
    this._clockOverlayEl = overlay;
    const cx = CLOCK_CX;
    const cy = CLOCK_CY;
    // Hour ticks + numbers live on the face (outer chrome). Core overlay is
    // path / sun / handle only.
    const hourLabels = [];
    const faceTicks = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    faceTicks.setAttribute("class", "clock-face-ticks");
    faceTicks.setAttribute("viewBox", `0 0 ${CLOCK_VIEW} ${CLOCK_VIEW}`);
    faceTicks.setAttribute("aria-hidden", "true");
    const faceTickLines = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const seconds = hour * 3600;
      const deg = this._clockAngleDeg(seconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      const major = hour % 6 === 0;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("class", major ? "clock-tick major" : "clock-tick");
      faceTicks.appendChild(tick);
      faceTickLines.push({
        el: tick,
        cos,
        sin,
        len: major ? CLOCK_TICK_MAJOR_LEN : CLOCK_TICK_MINOR_LEN,
      });
      if (major) {
        const label = document.createElement("div");
        label.className = "clock-hour-label";
        label.textContent = hour === 0 ? "24" : String(hour).padStart(2, "0");
        label._clockPolar = { cos, sin };
        hourLabels.push(label);
      }
    }
    this._paintClockSunPath(overlay, events);
    this._ensureOverrideArc(overlay);

    const handleOverlay = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    handleOverlay.setAttribute("class", "sun-light-clock-handle-overlay");
    handleOverlay.setAttribute("viewBox", `0 0 ${CLOCK_VIEW} ${CLOCK_VIEW}`);
    handleOverlay.setAttribute("aria-hidden", "true");
    this._paintClockHandle(handleOverlay);

    const handleHit = document.createElement("div");
    handleHit.className = "clock-handle-hit";
    handleHit.setAttribute("aria-hidden", "true");
    this._clockHandleHitEl = handleHit;
    // Path under sun; rings above handle so the planet occludes it.
    core.append(
      overlay,
      this._clockSunEl,
      handleOverlay,
      this._clockSunHitEl,
      handleHit
    );
    // Horizon → light bloom → planet; face ticks under event buttons / labels.
    face.append(horizonBack, glowLayer, core, faceTicks);

    const editable = this._view === "edit";
    const eventLayer = document.createElement("div");
    eventLayer.className = "clock-event-layer";
    const eventAnchors = [];
    const polarForSeconds = (seconds) => {
      const deg = this._clockAngleDeg(seconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      return { cos: Math.cos(rad), sin: Math.sin(rad) };
    };
    for (const event of events) {
      const buttonSeconds = this._eventButtonSeconds(event);
      const markSeconds = this._eventMarkSeconds(event);
      if (buttonSeconds == null) {
        continue;
      }
      const { cos, sin } = polarForSeconds(buttonSeconds);
      const sceneId = this._eventSceneId(event.id);
      const sceneName = this._sceneName(sceneId);
      const timeText = event.fallback ? `${event.time}*` : event.time;

      const anchor = document.createElement("div");
      anchor.className = "clock-event-anchor";
      anchor.dataset.eventId = event.id;
      anchor._clockPolar = { cos, sin };

      const meta = document.createElement("div");
      meta.className = "clock-event-meta";
      meta.setAttribute("aria-hidden", "true");
      const heading = document.createElement("span");
      heading.className = "clock-event-heading";
      heading.textContent = `${event.name} · ${timeText}`;
      const sceneEl = document.createElement("span");
      sceneEl.className = "clock-event-scene";
      if (sceneName) {
        sceneEl.textContent = sceneName;
      } else {
        sceneEl.textContent = this._t(
          "frontend.chart.choose_scene",
          "Choose scene"
        );
        sceneEl.classList.add("empty");
      }
      meta.append(heading, sceneEl);

      const btn = document.createElement(editable ? "button" : "div");
      btn.className = "clock-event";
      if (editable) {
        btn.type = "button";
        btn.dataset.eventId = event.id;
      }
      const solarHint =
        event.overridden && event.solar_time
          ? ` (solar ${event.solar_time})`
          : "";
      btn.title = sceneName
        ? `${event.name} · ${timeText}${solarHint} · ${sceneName}`
        : `${event.name} · ${timeText}${solarHint}`;
      if (!sceneName) {
        btn.classList.add("missing");
      }
      if (this._sidebarEventId === event.id) {
        btn.classList.add("selected");
        btn.setAttribute("aria-current", "true");
      }
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", event.icon);
      btn.appendChild(icon);
      if (editable) {
        btn.setAttribute(
          "aria-label",
          sceneName
            ? `${event.name} ${timeText}: ${sceneName}`
            : `${event.name} ${timeText}: choose scene`
        );
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._toggleEventSceneDialog(event);
        });
      }
      anchor.append(meta, btn);
      eventLayer.appendChild(anchor);
      eventAnchors.push(anchor);

      if (
        event.overridden &&
        markSeconds != null &&
        markSeconds !== buttonSeconds
      ) {
        const ghostPolar = polarForSeconds(markSeconds);
        const ghost = document.createElement("div");
        ghost.className = "clock-event-anchor ghost";
        ghost.dataset.eventId = event.id;
        ghost._clockPolar = ghostPolar;
        ghost.setAttribute("aria-hidden", "true");
        const ghostBtn = document.createElement("div");
        ghostBtn.className = "clock-event ghost";
        ghostBtn.title = `${event.name} · solar ${event.solar_time || timeText}`;
        const ghostIcon = document.createElement("ha-icon");
        ghostIcon.setAttribute("icon", event.icon);
        ghostBtn.appendChild(ghostIcon);
        ghost.appendChild(ghostBtn);
        eventLayer.appendChild(ghost);
        eventAnchors.push(ghost);
      }
    }
    // Hour labels on the face (above event anchors in paint order).
    face.appendChild(eventLayer);
    for (const label of hourLabels) {
      face.appendChild(label);
    }

    const layoutEventAnchors = () => {
      const w = face.clientWidth;
      if (!w) {
        return;
      }
      // Face chrome: tick tips near the edge, hour numbers just inside the
      // ticks (clear of the stroke). Event buttons track the sun path at a
      // fixed core-viewBox gap (desktop) or on the path (mobile ≤870px).
      const tickOuterPad = w >= 871 ? 10 : 6;
      const labelFontPx = w >= 871 ? 32 : 16;
      // Past major tick length + ~half glyph + air so digits do not sit on ticks.
      const labelInsetPx =
        (CLOCK_TICK_MAJOR_LEN / 100) * (w / 2) + labelFontPx * 0.55 + 4 + 18;
      const labelPad = tickOuterPad + labelInsetPx;
      // Mobile: events on the path — chrome is tick clearance only. Desktop:
      // fixed chrome (no face-size lerp); gap from path stays constant.
      const narrowFace = window.matchMedia("(max-width: 870px)").matches;
      const chromeFloor = narrowFace
        ? Math.ceil(
            tickOuterPad + (CLOCK_TICK_MAJOR_LEN / 100) * (w / 2) + 2
          )
        : Math.ceil(labelPad + 4);
      const chromePx = narrowFace
        ? chromeFloor
        : Math.max(CLOCK_CHROME_PX, chromeFloor);
      face.style.setProperty("--clock-chrome", `${chromePx}px`);
      // Derive core size from chrome (do not wait for a second layout pass).
      const coreW = w - 2 * chromePx;
      if (coreW < 8) {
        return;
      }
      // Face SVG viewBox radius 100 ≡ half the face; pad → viewBox r.
      const tickOuterR = 100 * (1 - (2 * tickOuterPad) / w);
      for (const tick of faceTickLines) {
        const outer = tickOuterR;
        const inner = tickOuterR - tick.len;
        tick.el.setAttribute("x1", (cx + tick.cos * inner).toFixed(2));
        tick.el.setAttribute("y1", (cy + tick.sin * inner).toFixed(2));
        tick.el.setAttribute("x2", (cx + tick.cos * outer).toFixed(2));
        tick.el.setAttribute("y2", (cy + tick.sin * outer).toFixed(2));
      }
      const labelR = ((w / 2 - labelPad) / w) * 100;
      for (const label of hourLabels) {
        const { cos, sin } = label._clockPolar;
        label.style.left = `${50 + cos * labelR}%`;
        label.style.top = `${50 + sin * labelR}%`;
      }
      const pathR = this._clockSunPathRadius();
      // Mobile: event buttons sit on the path so the dial can grow larger.
      const eventGap = narrowFace ? 0 : CLOCK_EVENT_GAP_FROM_PATH;
      const eventRCore = pathR + eventGap;
      const eventRFacePx = (eventRCore / 100) * (coreW / 2);
      const iconR = (eventRFacePx / w) * 100;
      for (const anchor of eventAnchors) {
        const { cos, sin } = anchor._clockPolar;
        anchor.style.left = `${50 + cos * iconR}%`;
        anchor.style.top = `${50 + sin * iconR}%`;
      }
      // Override arc/glow on the outer tip of the face hour ticks, in core space.
      const tickOuterPx = (tickOuterR / 100) * (w / 2);
      const overrideR = (tickOuterPx / (coreW / 2)) * 100;
      this._clockOverrideR = overrideR;
      if (this._clockOverrideGlowEl) {
        this._clockOverrideGlowEl.setAttribute("r", String(overrideR));
      }
      this._updateOverrideArc(this._clockStickySeconds);
      this._layoutClockEventMetas(eventAnchors);
      this._clockEventIconR = iconR;
      this._layoutClockEventSpokes();
    };
    this._clockEventAnchors = eventAnchors;
    this._layoutDialChromeFn = () => {
      layoutEventAnchors();
      this._layoutClockEventDots();
      this._layoutClockHorizonBack();
      this._alignYearScrubRail();
    };
    layoutEventAnchors();
    const layoutDialChrome = () => {
      this._layoutDialChromeFn();
    };
    layoutDialChrome();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => {
        layoutDialChrome();
      });
      ro.observe(face);
      ro.observe(this);
    }
    requestAnimationFrame(() => layoutDialChrome());

    this._bindClockSunDrag(face, [this._clockSunHitEl, this._clockHandleHitEl]);
    // Enter once per editor visit (not on date/scene redraws). Cleared when
    // returning to the list so list → edit plays again.
    if (this._clockEnterPlayed) {
      this._applyClockSunAppearance(this._clockSunIdleSeconds());
    } else {
      this._clockEnterPlayed = true;
      this._playClockEnterAnimation(face);
    }
    wrap.appendChild(face);

    if (!ringLights.length) {
      const hint = document.createElement("p");
      hint.className = "sun-light-clock-empty-hint";
      hint.textContent = suggested.length
        ? "Create a native scene from a solar event to fill the dial — area lights are listed below."
        : "No lights in this area yet.";
      wrap.appendChild(hint);
    }

    const legend = document.createElement("div");
    legend.className = "sun-light-clock-legend";
    for (const light of legendLights) {
      legend.appendChild(this._clockLegendRow(light, events));
    }
    this._clockLegendEl = legend;
    wrap.appendChild(legend);
    return wrap;
  }

  _clockLegendRow(light, events) {
    const suggested = Boolean(light.suggested);
    const row = document.createElement("div");
    row.className = "clock-legend-row";
    row.dataset.entityId = light.entity_id;
    if (suggested) {
      row.classList.add("suggested");
    }
    if (light.in_area === false) {
      row.classList.add("out-of-area");
    }
    if (this._lightIsUnavailable(light.entity_id)) {
      row.classList.add("unavailable");
    }
    if (light.entity_id === this._sidebarLightId) {
      row.classList.add("selected");
    }

    const accent = this._lightLegendAccent(light);
    if (accent) {
      row.style.setProperty("--clock-legend-accent", accent);
    }

    const iconWrap = document.createElement("div");
    iconWrap.className = "clock-legend-icon-wrap";
    iconWrap.appendChild(this._lightEntityIcon(light.entity_id));
    row.appendChild(iconWrap);

    const meta = document.createElement("div");
    meta.className = "clock-legend-meta";
    const title = document.createElement("div");
    title.className = "clock-legend-title";
    title.textContent = light.name;
    if (light.in_area === false) {
      title.title = "This light is not in the selected area";
    }
    const sub = document.createElement("div");
    sub.className = "clock-legend-sub";
    const unavailable = this._lightIsUnavailable(light.entity_id);
    if (unavailable) {
      sub.textContent = this._t("frontend.lights.unavailable", "Unavailable");
    } else if (suggested) {
      sub.textContent = "Not in an assigned scene yet";
    }
    meta.append(title, sub);
    row.appendChild(meta);
    if (!suggested && !unavailable) {
      this._lightNameLabels.push({ light, titleEl: title, subEl: sub });
    }

    if (this._view === "edit") {
      const assigned = events.filter((item) => this._eventSceneId(item.id));
      if (!suggested && assigned.length) {
        row.classList.add("interactive");
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label", `Edit ${light.name}`);
        const openClosest = (ev) => {
          ev.stopPropagation();
          const seconds =
            this._clockSunDisplayedSeconds ??
            this._clockStickySeconds ??
            this._clockSunIdleSeconds();
          const closest = this._closestEvent(assigned, seconds);
          if (closest) {
            this._openLightEditDialog(light, closest);
          }
        };
        row.addEventListener("click", openClosest);
        row.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") {
            return;
          }
          ev.preventDefault();
          openClosest(ev);
        });
      }
      const missingScenes = this._missingSceneRows(light);
      if (missingScenes.length) {
        const names = [
          ...new Set(missingScenes.map((row) => row.scene_name).filter(Boolean)),
        ];
        const warn = document.createElement("button");
        warn.type = "button";
        warn.className = "light-warn";
        warn.title =
          "Add this light using the typical brightness and color of the other lights in that scene";
        warn.setAttribute(
          "aria-label",
          suggested
            ? `Add ${light.name} to scenes`
            : `Add ${light.name} to ${names.join(", ")}`
        );
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:lightbulb-plus-outline");
        const text = document.createElement("span");
        text.textContent = suggested
          ? "Add to scenes"
          : `Add to ${names.join(", ")}`;
        warn.append(icon, text);
        warn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._addLightToMissingScenes(light);
        });
        row.appendChild(warn);
      }
      if (!suggested) {
        const remove = document.createElement("ha-icon-button");
        remove.className = "light-remove";
        remove.label = `Remove ${light.name} from scenes`;
        const removeIcon = document.createElement("ha-icon");
        removeIcon.setAttribute("icon", "mdi:close");
        remove.appendChild(removeIcon);
        remove.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._removeLightFromAssignedScenes(light.entity_id);
        });
        row.appendChild(remove);
        if (assigned.length) {
          const chevron = document.createElement("ha-icon");
          chevron.className = "clock-legend-chevron";
          chevron.setAttribute("icon", "mdi:chevron-right");
          row.appendChild(chevron);
        }
      }
    }
    return row;
  }

  _lightLegendAccent(light) {
    const samples = light.samples || [];
    const mid =
      samples[Math.floor(samples.length / 2)] || samples[0] || null;
    if (mid && mid[1] > 0) {
      const r = mid[2];
      const g = mid[3];
      const b = mid[4];
      // Near-white samples read as gray on the badge — keep HA light amber.
      if (!(r > 230 && g > 220 && b > 200)) {
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
    const state = this._hass?.states?.[light.entity_id];
    const rgb = state?.attributes?.rgb_color;
    if (Array.isArray(rgb) && rgb.length >= 3) {
      const [r, g, b] = rgb;
      if (!(r > 230 && g > 220 && b > 200)) {
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
    return null;
  }

  _lightEntityIcon(entityId) {
    const state = this._hass?.states?.[entityId];
    const entry = this._hass?.entities?.[entityId];
    // Prefer HA’s state icon so device-class / registry icons win over a
    // generic lightbulb fallback.
    if (customElements.get("ha-state-icon")) {
      const icon = document.createElement("ha-state-icon");
      icon.className = "clock-legend-icon";
      icon.hass = this._hass;
      if (state) {
        icon.stateObj = state;
      }
      if (entityId) {
        icon.entityId = entityId;
      }
      return icon;
    }
    const icon = document.createElement("ha-icon");
    icon.className = "clock-legend-icon";
    const named =
      entry?.icon || state?.attributes?.icon || state?.attributes?.entity_picture;
    icon.setAttribute(
      "icon",
      typeof named === "string" && named.startsWith("mdi:")
        ? named
        : "mdi:lightbulb"
    );
    return icon;
  }

  _buildLightBars(xOf, events) {
    this._lightNameLabels = [];
    const lights = this._sunPath.lights || [];
    if (!lights.length) {
      return null;
    }
    const wrap = document.createElement("div");
    wrap.className = "sun-lights";
    for (const light of this._legendLights(lights)) {
      wrap.appendChild(this._lightRow(light, xOf, events));
    }
    return wrap;
  }

  _lightRow(light, xOf, events) {
    const suggested = Boolean(light.suggested);
    const row = document.createElement("div");
    row.className = "light-row";
    row.dataset.entityId = light.entity_id;
    if (suggested) {
      row.classList.add("suggested");
    }
    if (light.in_area === false) {
      row.classList.add("out-of-area");
    }
    if (this._lightIsUnavailable(light.entity_id)) {
      row.classList.add("unavailable");
    }
    if (!suggested && light.entity_id === this._sidebarLightId) {
      row.classList.add("selected");
      row.setAttribute("aria-current", "true");
    }

    const bar = document.createElement("div");
    bar.className = "light-bar";
    if (!suggested) {
      const samples = light.samples || [];
      const gradientId = `light-grad-${light.entity_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const stops = samples
        .map((sample) => {
          const offset = (sample[0] / SECONDS_PER_DAY) * 100;
          return `<stop offset="${offset.toFixed(2)}%" stop-color="${darkenedRgb(sample)}"/>`;
        })
        .join("");
      bar.innerHTML = `
        <svg viewBox="0 0 ${CHART_WIDTH} ${LIGHT_BAR_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${PLOT_LEFT}" y1="0" x2="${PLOT_RIGHT}" y2="0">
              ${stops}
            </linearGradient>
          </defs>
          <rect x="${PLOT_LEFT}" y="0" width="${PLOT_RIGHT - PLOT_LEFT}" height="${LIGHT_BAR_HEIGHT}" fill="url(#${gradientId})"></rect>
        </svg>
      `;
    }
    const name = document.createElement("span");
    name.className = "light-name";
    name.textContent = light.name;
    if (this._lightIsUnavailable(light.entity_id)) {
      name.textContent = `${light.name} · ${this._t(
        "frontend.lights.unavailable",
        "Unavailable"
      )}`;
    }
    if (light.in_area === false) {
      name.title = "This light is not in the selected area";
    }
    if (!suggested && !this._lightIsUnavailable(light.entity_id)) {
      this._lightNameLabels.push({ light, el: name });
    }
    bar.appendChild(name);
    if (this._view === "edit" && !suggested) {
      const assigned = events.filter((item) => this._eventSceneId(item.id));
      const hit = document.createElement("div");
      hit.className = "light-bar-hit";
      hit.setAttribute("role", "button");
      hit.tabIndex = 0;
      hit.setAttribute("aria-label", `Edit ${light.name}`);
      const openClosest = (ev) => {
        ev.stopPropagation();
        const seconds = this._secondsFromElementPointer(ev, bar);
        const closest = this._closestEvent(assigned, seconds);
        if (closest) {
          this._openLightEditDialog(light, closest);
        }
      };
      hit.addEventListener("click", openClosest);
      hit.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const seconds =
          this._hoverSeconds ??
          (this._sunPath?.today
            ? nowSecondsSinceMidnight()
            : SECONDS_PER_DAY / 2);
        const closest = this._closestEvent(assigned, seconds);
        if (closest) {
          this._openLightEditDialog(light, closest);
        }
      });
      bar.appendChild(hit);
      const edits = document.createElement("div");
      edits.className = "light-edits";
      for (const event of assigned) {
        const editHit = document.createElement("div");
        editHit.className = "light-edit";
        editHit.style.left = `${(xOf(event.seconds) / CHART_WIDTH) * 100}%`;
        editHit.setAttribute("role", "button");
        editHit.tabIndex = 0;
        editHit.setAttribute("aria-label", `Edit ${light.name} at ${event.name}`);
        const dot = document.createElement("span");
        dot.className = "light-edit-dot";
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:pencil");
        const action = document.createElement("span");
        action.className = "light-edit-action";
        action.appendChild(icon);
        const setExpanded = (on) => {
          /* Class on each node: :hover descendant rules do not restyle
             children inside this shadow tree. */
          editHit.classList.toggle("expanded", on);
          dot.classList.toggle("expanded", on);
          action.classList.toggle("expanded", on);
        };
        editHit.addEventListener("pointerenter", () => setExpanded(true));
        editHit.addEventListener("pointerleave", () => setExpanded(false));
        editHit.addEventListener("focusin", () => setExpanded(true));
        editHit.addEventListener("focusout", () => {
          window.requestAnimationFrame(() => {
            if (!editHit.contains(editHit.getRootNode().activeElement)) {
              setExpanded(false);
            }
          });
        });
        const open = (ev) => {
          ev.stopPropagation();
          this._openLightEditDialog(light, event);
        };
        editHit.addEventListener("click", open);
        editHit.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            open(ev);
          }
        });
        editHit.append(dot, action);
        edits.appendChild(editHit);
      }
      bar.appendChild(edits);
      const missingScenes = this._missingSceneRows(light);
      if (missingScenes.length) {
        const names = [
          ...new Set(missingScenes.map((row) => row.scene_name).filter(Boolean)),
        ];
        const warn = document.createElement("button");
        warn.type = "button";
        warn.className = "light-warn";
        warn.title =
          "Add this light using the typical brightness and color of the other lights in that scene";
        warn.setAttribute(
          "aria-label",
          suggested
            ? `Add ${light.name} to scenes`
            : `Add ${light.name} to ${names.join(", ")}`
        );
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:lightbulb-plus-outline");
        const text = document.createElement("span");
        text.textContent = suggested
          ? "Add to scenes"
          : `Add to ${names.join(", ")}`;
        warn.append(icon, text);
        warn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._addLightToMissingScenes(light);
        });
        bar.appendChild(warn);
      }
      const remove = document.createElement("ha-icon-button");
      remove.className = "light-remove";
      remove.label = `Remove ${light.name} from scenes`;
      const removeIcon = document.createElement("ha-icon");
      removeIcon.setAttribute("icon", "mdi:close");
      remove.appendChild(removeIcon);
      remove.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._removeLightFromAssignedScenes(light.entity_id);
      });
      bar.appendChild(remove);
    }
    row.appendChild(bar);
    return row;
  }
}
function entitySelector(hass, domain, areaId, nativeScenesOnly, extraIds) {
  const config = { domain, multiple: false };
  const include = [];
  const entities = hass.entities || {};
  for (const [entityId, meta] of Object.entries(entities)) {
    if (!entityId.startsWith(`${domain}.`)) {
      continue;
    }
    if (nativeScenesOnly) {
      if (meta.platform && meta.platform !== "homeassistant") {
        continue;
      }
      const state = hass.states[entityId];
      if (state && state.attributes.integration === DOMAIN) {
        continue;
      }
    }
    if (areaId && meta.area_id !== areaId) {
      continue;
    }
    include.push(entityId);
  }
  for (const extra of extraIds || []) {
    if (extra && !include.includes(extra)) {
      include.push(extra);
    }
  }
  if (areaId || nativeScenesOnly) {
    config.include_entities = include;
  }
  return { entity: config };
}

function formatLatLng(lat, lng) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lng).toFixed(2)}° ${ew}`;
}

function sameLocation(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6
  );
}

if (!customElements.get("scene-extrapolation-panel")) {
  customElements.define("scene-extrapolation-panel", SceneExtrapolationPanel);
}
