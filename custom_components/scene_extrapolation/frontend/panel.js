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
/* Clock overlay viewBox is 200×200; rings host is inset 14% → outer r=72. */
const CLOCK_VIEW = 200;
const CLOCK_CX = 100;
const CLOCK_CY = 100;
const CLOCK_RINGS_OUTER = 72;
const CLOCK_SUN_HORIZON = CLOCK_RINGS_OUTER;
/* Day height is exaggerated so noon sits clearly outside the planet rim
   (not a linear °→px map). Night stays inside the face. */
const CLOCK_SUN_DAY_EMPHASIS = 2;
const CLOCK_SUN_DAY_BASE_SPAN = 22;
const CLOCK_SUN_NIGHT_MIN = 40;
const CLOCK_EVENT_ICON_R = 56;
/* Fixed px band around the dial for event buttons + labels (do not scale). */
const CLOCK_CHROME_PX = 56;
const CLOCK_SCRUB_RAIL_PX = 88;
/* Far from horizon (day high) = 52px; at/near horizon and all night = 2×.
   Below the horizon the disc stays at max scale (no shrink until daytime rise). */
const CLOCK_SUN_SIZE_PX = 52;
/* Daytime elevation where size falls back to 1× (degrees). */
const CLOCK_SUN_SIZE_HORIZON_DEG = 18;
const CLOCK_SUN_STROKE_MIN_PX = 0.2;
const CLOCK_SUN_STROKE_MAX_PX = 10;
const SIDEBAR_ANIMATION_MS = 200;
const SIDEBAR_SWAP_MS = 160;
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
      syntax: "<percentage>",
      inherits: false,
      initialValue: "0%",
    },
    {
      name: "--ring-border-w",
      syntax: "<percentage>",
      inherits: false,
      initialValue: "0%",
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
  nightlights_boolean: "Nightlights trigger",
  nightlights_scene: "Nightlights scene",
};

const HELPERS = {
  scene_name: "Name for the extrapolation scene entity",
  area: "Used to filter native Home Assistant scenes and to assign the new scene",
  display_scenes_combined: "On: 3 scene pickers. Off: 5 scene pickers",
  scene_dawn: "First light (sun 6° below the horizon)",
  scene_noon: "When the sun is at its highest point",
  scene_dusk: "Last light (sun 6° below the horizon)",
  scene_dawn_sunrise_sunset: "Used at first light, sunrise, and sunset",
  scene_dusk_minimum_time_of_day: "Avoids dimming too early in winter",
  nightlights_boolean: "When this input boolean is on, the nightlights scene is used instead",
  nightlights_scene: "Required if a nightlights trigger is set",
};

class SceneExtrapolationPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = undefined;
    this._narrow = false;
    this._view = "list";
    this._editId = null;
    this._items = [];
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
    this._persistTimer = undefined;
    this._previewInFlight = false;
    this._previewQueued = false;
    this._yearScrubbing = false;
    this._sidebarEventId = null;
    this._sidebarLightId = null;
    this._hashConfirming = false;
    this._lightView = "table";
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
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
    }
    if (this._menuButtonEl) {
      this._menuButtonEl.hass = hass;
    }
    if (this._datePicker) {
      this._datePicker.hass = hass;
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

  connectedCallback() {
    window.addEventListener("hashchange", this._onHashChange);
    window.addEventListener("keydown", this._onEditorKeydown);
    window.addEventListener("pagehide", this._onPageHide);
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
        this._drawSunPath();
      }, 30000);
    }
  }

  disconnectedCallback() {
    this._flushPersistedDraft();
    this._closeSceneSidebar();
    window.removeEventListener("hashchange", this._onHashChange);
    window.removeEventListener("keydown", this._onEditorKeydown);
    window.removeEventListener("pagehide", this._onPageHide);
    document.removeEventListener("visibilitychange", this._onPageHide);
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
          height: 100vh;
          overflow: hidden;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          --scene-sidebar-gutter: 0px;
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
          overflow: hidden;
          opacity: 1;
          box-sizing: border-box;
          z-index: 2;
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
          transition: opacity ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .sun-path-stage.landscape-clock-scrub .sun-year-scrub-rail {
          display: flex;
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
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        /* Dial: chips under the day/month control. Table: same row, date first. */
        .sun-path.dial-view .sun-date-tools {
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
        }
        .sun-chip-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .sun-year-scrub-rail .sun-chip-row {
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          gap: 4px;
        }
        .sun-year-scrub-rail .sun-chip {
          width: 100%;
          box-sizing: border-box;
          text-align: center;
          padding: 4px 6px;
          font-size: 11px;
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
        .sun-scrub-date ha-icon {
          --mdc-icon-size: 16px;
          color: var(--secondary-text-color);
          flex-shrink: 0;
        }
        /* Visually hidden but mounted — opened via ha-date-input._openDialog.
           Keep it laid out (not clip/1×1) so the selector finishes upgrading. */
        .sun-date-picker-host {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: 0;
          padding: 0;
          overflow: hidden;
          opacity: 0;
          pointer-events: none;
        }
        .sun-toolbar {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          padding: 12px 16px 0;
        }
        /* Scrub/date live in the right rail — do not leave empty toolbar padding
           above the dial (would push the face down). */
        .sun-toolbar.toolbar-rail-only {
          padding: 0;
          gap: 0;
          min-height: 0;
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
          width: 12px;
          height: 12px;
          margin-left: -6px;
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
          margin: 0 4px 0 0;
          align-self: stretch;
        }
        .sun-year-scrub.vertical .sun-year-months span {
          left: 0;
          top: 0;
          font-size: 10px;
          line-height: 1.1;
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
          left: 4px;
          top: 0;
          margin-left: 0;
          margin-top: -6px;
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
        .sun-light-clock {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 8px 16px 16px;
          box-sizing: border-box;
          overflow: visible;
        }
        .sun-light-clock-face {
          position: relative;
          /* Full column width, but never taller than 80vh (square). */
          width: min(100%, 80vh);
          aspect-ratio: 1;
          flex: 0 0 auto;
          touch-action: none;
          cursor: crosshair;
          /* Clip labels/buttons to the face; chrome padding keeps them readable. */
          overflow: hidden;
          transform-origin: center center;
          --clock-chrome: ${CLOCK_CHROME_PX}px;
        }
        /* Planet / path / glow live in the inset core; event chips stay on the
           face so their px size does not shrink with the dial. */
        .sun-light-clock-core {
          position: absolute;
          inset: var(--clock-chrome);
          border-radius: 50%;
          pointer-events: none;
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
        .sun-light-clock-face.clock-face-enter .clock-event-anchor {
          animation: clock-event-spin 2250ms cubic-bezier(0.2, 0, 0, 1) both;
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
            transform: rotate(-12deg);
          }
          to {
            transform: rotate(0deg);
          }
        }
        @keyframes clock-event-spin {
          from {
            transform: translate(-50%, -50%) rotate(-12deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(0deg);
          }
        }
        /* Registered via CSS.registerProperty (document), not @property here —
           shadow-root @property does not enable transitions. */
        /* Soft disc tinted by solar elevation (sky), not lamp conics. */
        .sun-light-clock-glow {
          position: absolute;
          inset: 14%;
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
          /* Larger than the face rings (= bigger “spread”). */
          transform: scale(1.35);
          transform-origin: center center;
          filter: blur(81px);
          opacity: 0.55;
        }
        .sun-light-clock-rings {
          position: absolute;
          inset: 14%;
          border-radius: 50%;
          /* Above the sun so the planet occludes the disc below the horizon. */
          z-index: 2;
          --clock-feather: ${CLOCK_FEATHER_PCT}%;
          transition: --clock-feather 220ms cubic-bezier(0.2, 0, 0, 1);
          cursor: pointer;
        }
        /* Sharpen on hover, and keep sharp while a lamp is selected (sidebar). */
        .sun-light-clock-rings:hover,
        .sun-light-clock-rings:has(.clock-ring.selected) {
          --clock-feather: 0.2%;
        }
        .clock-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          /* Masked rings still fill the square for hit-testing; open via
             radial pick on the host instead of per-ring clicks. */
          pointer-events: none;
          z-index: 1;
          --ring-expand: 0%;
          --ring-border-w: 0%;
          transition:
            --ring-expand 180ms cubic-bezier(0.2, 0, 0, 1),
            --ring-border-w 180ms cubic-bezier(0.2, 0, 0, 1),
            filter 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        /* Fill lives on a child so the ring mask does not clip ::after borders. */
        .clock-ring-fill {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
        }
        /* Inner + outer rim strokes; mask grows with --ring-expand. */
        .clock-ring::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          background: var(--primary-color);
          opacity: 0;
          transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
          -webkit-mask-image: radial-gradient(
            farthest-side,
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) + var(--ring-border-w)
              )
          );
          mask-image: radial-gradient(
            farthest-side,
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-inner) - var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) - var(--ring-border-w)
              ),
            #000
              calc(
                var(--ring-outer) + var(--ring-expand) + var(--ring-border-w)
              ),
            transparent
              calc(
                var(--ring-outer) + var(--ring-expand) + var(--ring-border-w)
              )
          );
        }
        .clock-ring.hovered {
          --ring-expand: 2%;
          --ring-border-w: 0.4%;
          z-index: 5;
        }
        .clock-ring.hovered::after {
          opacity: 1;
        }
        .clock-ring.selected {
          --ring-expand: 2%;
          --ring-border-w: 0.7%;
          z-index: 6;
          filter: drop-shadow(0 0 2px var(--primary-color))
            drop-shadow(0 0 6px color-mix(in srgb, var(--primary-color) 70%, transparent));
        }
        .clock-ring.selected::after {
          opacity: 1;
        }
        .clock-ring.selected.hovered {
          z-index: 7;
        }
        .sun-light-clock-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
          z-index: 5;
        }
        .sun-light-clock-overlay .clock-sun-day {
          fill: none;
          /* Stroke width + sky-tinted color set per-line in JS. */
          vector-effect: non-scaling-stroke;
          stroke-dasharray: 8 7;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.5;
        }
        .sun-light-clock-overlay .clock-sun-night {
          fill: none;
          /* Below horizon: neutral (not sky-colored). */
          stroke: var(--secondary-text-color);
          vector-effect: non-scaling-stroke;
          stroke-dasharray: 8 7;
          stroke-linejoin: round;
          stroke-linecap: round;
          opacity: 0.5;
        }
        /* CSS sun + lens flare; --sun-* set from elevation.
           z-index below rings so night sits behind the planet; day sits
           outside the rings host and stays visible (rim clips at sunrise).
           Position is driven in JS along the sun-path arc (no CSS left/top
           tween — that cut chords and stuttered when the target moved). */
        .clock-sun {
          position: absolute;
          width: ${CLOCK_SUN_SIZE_PX}px;
          height: ${CLOCK_SUN_SIZE_PX}px;
          transform: translate(-50%, -50%) scale(var(--sun-scale, 1));
          pointer-events: none;
          z-index: 1;
          --sun-core: #fff8e7;
          --sun-corona: #ffb74d;
          --sun-streak: #ffe0b2;
          --sun-streak-opacity: 0.85;
          --sun-ray-opacity: 0.55;
          --sun-ghost-opacity: 0.35;
          --sun-scale: 1;
        }
        .clock-sun > span {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
        }
        .clock-sun-ghost {
          inset: -40% -10%;
          border-radius: 50%;
          background: radial-gradient(
            closest-side circle at 35% 50%,
            color-mix(in srgb, var(--sun-corona) 55%, transparent) 0%,
            transparent 70%
          );
          opacity: var(--sun-ghost-opacity);
          mix-blend-mode: screen;
          transform: translate(-18%, 0) scale(1.6);
        }
        .clock-sun-rays {
          inset: -120%;
          background: repeating-conic-gradient(
            from 8deg,
            color-mix(in srgb, var(--sun-streak) 70%, transparent) 0deg 3deg,
            transparent 3deg 28deg
          );
          -webkit-mask-image: radial-gradient(
            closest-side,
            #000 8%,
            transparent 55%
          );
          mask-image: radial-gradient(closest-side, #000 8%, transparent 55%);
          opacity: var(--sun-ray-opacity);
          mix-blend-mode: screen;
        }
        .clock-sun-streak {
          inset: 35% -160%;
          border-radius: 50%;
          background: radial-gradient(
            closest-side ellipse at center,
            color-mix(in srgb, var(--sun-streak) 90%, white) 0%,
            color-mix(in srgb, var(--sun-streak) 40%, transparent) 45%,
            transparent 72%
          );
          opacity: var(--sun-streak-opacity);
          mix-blend-mode: screen;
        }
        .clock-sun-corona {
          inset: -55%;
          background: radial-gradient(
            closest-side circle at center,
            color-mix(in srgb, var(--sun-corona) 85%, transparent) 0%,
            color-mix(in srgb, var(--sun-corona) 35%, transparent) 42%,
            transparent 72%
          );
          mix-blend-mode: screen;
        }
        .clock-sun-core {
          inset: 22%;
          background: radial-gradient(
            closest-side circle at center,
            #fff 0%,
            var(--sun-core) 45%,
            color-mix(in srgb, var(--sun-corona) 80%, var(--sun-core)) 78%,
            transparent 100%
          );
          box-shadow: 0 0 6px color-mix(in srgb, var(--sun-core) 70%, transparent);
        }
        .sun-light-clock-overlay .clock-tick {
          stroke: var(--divider-color);
          stroke-width: 1;
        }
        .sun-light-clock-overlay .clock-tick.major {
          stroke: var(--secondary-text-color);
          stroke-width: 1.5;
        }
        .sun-light-clock-overlay .clock-label {
          fill: var(--secondary-text-color);
          font-size: 8px;
          font-variant-numeric: tabular-nums;
          text-anchor: middle;
          dominant-baseline: middle;
        }
        .sun-light-clock-overlay .clock-event-ray {
          stroke: var(--secondary-text-color);
          stroke-width: 0.5px;
          vector-effect: non-scaling-stroke;
          stroke-dasharray: 2.5 2;
          stroke-linecap: round;
          opacity: 0.4;
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
        }
        /* Sunrise/sunset sit under the icon so they do not collide with
           dawn (above) / dusk (above) on the same side of the dial. */
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
          color: var(--secondary-text-color);
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
          transition: box-shadow 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .clock-event ha-icon {
          --mdc-icon-size: 18px;
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
          width: min(100%, 80vh);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .clock-legend-row {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 2px 8px;
          border-radius: 8px;
        }
        .clock-legend-row.selected {
          background: color-mix(
            in srgb,
            var(--primary-color) 16%,
            transparent
          );
        }
        .clock-legend-row.out-of-area .clock-legend-name {
          color: var(--warning-color, var(--error-color));
        }
        .clock-legend-row.suggested {
          color: var(--secondary-text-color);
        }
        .clock-legend-swatch {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 0 1px var(--divider-color);
        }
        .clock-legend-name {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clock-legend-name .light-brightness {
          font-weight: 400;
          font-variant-numeric: tabular-nums;
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
        }
        .sun-location-override {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 4px 0 8px;
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
          padding: 28px 8px 64px;
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
          position: absolute;
          left: 8px;
          right: 8px;
          bottom: 16px;
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
        }
        .sun-event.clickable:hover {
          border-color: var(--primary-color);
          background: var(--card-background-color);
        }
        .sun-event.clickable:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .sun-event.clickable:active {
          transform: scale(0.98);
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
        .sun-chart svg {
          display: block;
          width: 100%;
          height: ${CHART_HEIGHT}px;
        }
        .sun-marker {
          position: absolute;
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: translate(-50%, -100%);
          pointer-events: none;
          width: 44px;
        }
        .sun-marker ha-icon {
          --mdc-icon-size: 16px;
          color: var(--primary-text-color);
          filter: drop-shadow(0 0 3px var(--card-background-color));
        }
        .sun-marker .time {
          font-size: 10px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
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
        }
        .sun-hover-time {
          font-weight: 500;
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
          background: var(--card-background-color);
          border: 2px solid #ffb74d;
          box-sizing: border-box;
          pointer-events: none;
        }
        .page-shell {
          box-sizing: border-box;
          width: 100%;
          padding-right: var(--scene-sidebar-gutter);
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
          --page-max-width: 1920px;
        }
        .draft-restore {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: var(--ha-space-3);
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
        .content {
          padding: var(--ha-space-3) 0 88px;
        }
        .content.wide {
          width: 100%;
          box-sizing: border-box;
        }
        .card-content {
          padding: 16px;
        }
        .empty {
          text-align: center;
          padding: 48px 16px;
          color: var(--secondary-text-color);
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 8px;
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
        .row ha-icon {
          color: var(--secondary-text-color);
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
          transition: right ${SIDEBAR_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        }
        .fab[hidden] {
          display: none;
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
          <div class="draft-restore" hidden>
            <ha-icon icon="mdi:history"></ha-icon>
            <div class="draft-restore-copy">
              <div class="title"></div>
              <div class="detail"></div>
            </div>
            <ha-button class="draft-restore-discard" appearance="plain">Discard</ha-button>
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
    if (hash !== current && this._lightEditIsDirty()) {
      this._hashConfirming = true;
      history.replaceState(null, "", this._hashHref(current));
      const leave = await this._confirmLeaveLightEdit();
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
      this._items = await this._hass.callWS({ type: `${DOMAIN}/list` });
    } catch (err) {
      this._error = err.message || String(err);
      this._items = [];
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

  _renderList() {
    this._closeSceneSidebar();
    // Allow clock enter again the next time an editor opens.
    this._clockEnterPlayed = false;
    this._liveEdit = false;
    this._liveEditSidebarHandler = null;
    this._cancelClockSunArc();
    this._form = undefined;
    this._headerEl.textContent = "Scene Extrapolation";
    this._setNavigationIcon(this._menuButton());
    this._contentEl.classList.remove("wide");
    this._syncEditorChrome();

    if (this._error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = this._error;
      this._contentEl.replaceChildren(error);
      this._setActionItems();
      this._setFab(this._addButton());
      return;
    }

    const wrap = document.createElement("div");
    if (!this._items.length) {
      wrap.className = "empty";
      wrap.textContent =
        "No extrapolation scenes yet. Create one to start lighting a room from the sun.";
    } else {
      wrap.className = "list";
      for (const item of this._items) {
        wrap.appendChild(this._listRow(item));
      }
    }
    this._contentEl.replaceChildren(wrap);
    this._setActionItems();
    this._setFab(this._addButton());
  }

  _listRow(item) {
    const row = document.createElement("div");
    row.className = "row";
    row.addEventListener("click", () => this._go(`edit/${item.id}`));

    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:auto-fix");
    row.appendChild(icon);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.scene_name || "Untitled";
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = item.area_name || item.entity_id || "No area";
    meta.append(name, sub);
    row.appendChild(meta);

    const chevron = document.createElement("ha-icon");
    chevron.setAttribute("icon", "mdi:chevron-right");
    row.appendChild(chevron);
    return row;
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
    this._fabEl.replaceChildren();
    if (!node) {
      this._fabEl.hidden = true;
      return;
    }
    this._fabEl.hidden = false;
    this._fabEl.appendChild(node);
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
      this._setLightView(this._lightView === "clock" ? "table" : "clock");
    });
    this._lightViewToggleBtn = viewBtn;
    this._syncLightViewButtons();

    const liveToggle = document.createElement("label");
    liveToggle.className = "live-edit-toggle";
    const liveLabel = document.createElement("span");
    liveLabel.textContent = "Live edit";
    const liveSwitch = document.createElement("ha-switch");
    liveSwitch.checked = Boolean(this._liveEdit);
    liveSwitch.addEventListener("change", () => {
      this._setLiveEdit(Boolean(liveSwitch.checked));
    });
    liveToggle.append(liveLabel, liveSwitch);
    this._liveEditSwitch = liveSwitch;

    const undo = this._undoRedoButton("undo");
    const redo = this._undoRedoButton("redo");
    this._undoBtn = undo;
    this._redoBtn = redo;
    if (this._narrow) {
      this._setActionItems(
        liveToggle,
        locationBtn,
        viewBtn,
        this._overflowMenu()
      );
      this._syncLocationToolbar();
      return;
    }
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

  async _confirmLeaveEditor() {
    if (this._lightEditIsDirty() && !(await this._confirmLeaveLightEdit())) {
      return false;
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
      return raw === "clock" ? "clock" : "table";
    } catch (_err) {
      return "table";
    }
  }

  _setLightView(view) {
    const next = view === "clock" ? "clock" : "table";
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
    if (this._sunPath) {
      this._drawSunPath();
    } else {
      this._syncYearScrubLayout();
    }
  }

  _syncEditorChrome() {
    const dial =
      this._view === "edit" && this._lightView === "clock";
    this.shadowRoot?.querySelector(".page")?.classList.toggle("dial-wide", dial);
    this._sunPathEl?.classList.toggle("dial-view", dial);
  }

  _syncLightViewButtons() {
    if (!this._lightViewToggleBtn) {
      return;
    }
    // Label is the destination view (single toggle in the app bar).
    this._lightViewToggleBtn.textContent =
      this._lightView === "clock" ? "Table view" : "Dial view";
    this._lightViewToggleBtn.setAttribute(
      "aria-label",
      this._lightView === "clock" ? "Switch to table view" : "Switch to dial view"
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
    const server = this._snapshotSession();
    if (!this._sessionEqual(payload.baseline, server)) {
      // Server copy moved on; the local draft was based on an older save.
      this._clearPersistedDraft();
      return null;
    }
    if (this._sessionEqual(payload.session, server)) {
      this._clearPersistedDraft();
      return null;
    }
    this._formData = structuredClone(payload.session.form);
    this._nativeDrafts = structuredClone(payload.session.nativeDrafts);
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
      this._sessionIsDirty();
    el.hidden = !show;
    if (!show) {
      return;
    }
    const age = this._formatDraftAge(this._draftRestore.savedAt);
    el.querySelector(".title").textContent = "Picked up where you left off";
    el.querySelector(".detail").textContent =
      `Unsaved edits from ${age}. This browser only — save the scene to keep them.`;
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
    queueMicrotask(() => this._persistDraftSoon());
  }

  _applySession(snapshot) {
    this._forceCloseSceneSidebar();
    this._formData = structuredClone(snapshot.form);
    this._nativeDrafts = structuredClone(snapshot.nativeDrafts);
    if (this._form) {
      this._form.data = this._formData;
    }
    this._syncPreviewOverlay();
    this._sunPath = null;
    this._clearPreviewCache();
    this._syncUndoButtons();
    this._persistDraftSoon();
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
    if (this._formData.nightlights_scene === fromId) {
      this._formData.nightlights_scene = toId;
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
      scene_name: `${this._formData.scene_name || "Automatic Lighting"} (${suffix})`,
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
    const gutter =
      docked && !this._isEditorNarrow()
        ? "calc(var(--scene-sidebar-width, 375px) + 32px)"
        : "0px";
    this.style.setProperty("--scene-sidebar-gutter", gutter);
    this._syncYearScrubLayout();
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
    const host = this.shadowRoot?.querySelector(".scene-sidebar");
    if (host) {
      host._eventId = this._sidebarEventId;
    }
    this._syncEventSelection();
    // Idle sun follows the selected solar event (or “now” when none).
    if (this._hoverSeconds == null && this._clockSunEl) {
      this._clockSunLive = false;
      this._setClockSunArcTarget(this._clockSunIdleSeconds());
      this._fillHoverReadout(this._idleReadoutSeconds(), { hovering: false });
    }
  }

  _setSidebarLight(entityId) {
    this._sidebarLightId = entityId || null;
    this._syncClockLightSelection();
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
      row.classList.toggle("selected", row.dataset.entityId === selected);
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
    this._headerEl.textContent = this._editId
      ? this._formData.scene_name || "Edit scene"
      : "New scene";
    this._setNavigationIcon(this._backButton());
    this._setEditorActions();
    this._syncEditorChrome();
    this._setFab(
      this._fabButton("Save", "mdi:content-save", () => this._openSaveDialog())
    );
    this._contentEl.classList.add("wide");

    const wrap = document.createElement("div");
    if (this._error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = this._error;
      wrap.appendChild(error);
    }

    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._formData;
    form.schema = this._schema();
    form.computeLabel = (schema) => LABELS[schema.name] || schema.name;
    form.computeHelper = (schema) => HELPERS[schema.name] || "";
    form.addEventListener("value-changed", (ev) => {
      this._commitUndo();
      this._formData = { ...this._formData, ...ev.detail.value };
      this._error = null;
      this._schedulePreview();
    });
    this._form = form;
    const card = document.createElement("ha-card");
    const cardContent = document.createElement("div");
    cardContent.className = "card-content";
    cardContent.appendChild(form);
    card.appendChild(cardContent);
    wrap.appendChild(card);
    this._contentEl.replaceChildren(wrap);
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

  _schema() {
    const areaId = this._formData.area || null;
    const sceneSelector = entitySelector(this._hass, "scene", areaId, true);
    return [
      {
        name: "nightlights_boolean",
        selector: { entity: { domain: "input_boolean", multiple: false } },
      },
      { name: "nightlights_scene", selector: sceneSelector },
    ];
  }

  _eventSceneId(eventId) {
    const sceneId =
      LINKED_EVENTS.includes(eventId) && this._formData.display_scenes_combined
        ? this._formData.scene_dawn_sunrise_sunset || null
        : this._formData[EVENT_SCENE_KEYS[eventId]] || null;
    if (sceneId && this._nativeDrafts[sceneId]?.deleted) {
      return null;
    }
    return sceneId;
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
    const state = this._hass?.states?.[entityId];
    return state?.attributes?.friendly_name || entityId.replace(/^scene\./, "");
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
    const clearBtn = document.createElement("ha-icon-button");
    clearBtn.label = "Clear scene";
    const clearIcon = document.createElement("ha-icon");
    clearIcon.setAttribute("icon", "mdi:close");
    clearBtn.appendChild(clearIcon);
    clearBtn.addEventListener("click", () => {
      data.scene = null;
      bindPicker();
      applyDraft();
      syncActions();
    });
    field.append(picker, clearBtn);
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
      clearBtn.disabled = busy;
      picker.disabled = busy;
    };
    const syncActions = () => {
      const hasArea = Boolean(this._formData.area);
      const hasScene = Boolean(data.scene);
      createBtn.disabled = !hasArea;
      renameBtn.disabled = !hasScene;
      deleteBtn.disabled = !hasScene;
      clearBtn.disabled = !hasScene;
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
      timePicker.label = LABELS.scene_dusk_minimum_time_of_day;
      timePicker.helper = HELPERS.scene_dusk_minimum_time_of_day;
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
    if (this._formData.nightlights_scene === entityId) {
      this._formData.nightlights_scene = null;
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
    for (const key of [
      "brightness",
      "color_temp_kelvin",
      "hs_color",
      "rgb_color",
      "rgbw_color",
      "rgbww_color",
      "effect",
    ]) {
      if (stored[key] != null && stored[key] !== "none") {
        data[key] = stored[key];
      }
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
        present = (light.event_states || []).some(
          (row) => row.scene_entity_id === item.sceneId && row.present
        );
        stored = present
          ? (light.event_states || []).find(
              (row) => row.scene_entity_id === item.sceneId && row.present
            )?.state ||
            (light.event_states || []).find((row) => row.event === item.event.id)
              ?.state ||
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
    infoBtn.label = this._loc("ui.dialogs.helper_settings.dialog.more_info", "More info");
    const infoIcon = document.createElement("ha-icon");
    infoIcon.setAttribute("icon", "mdi:information-outline");
    infoBtn.appendChild(infoIcon);
    infoBtn.addEventListener("click", () => this._showEntityMoreInfo(light.entity_id));

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
        wheelCtl?.disconnect();
      },
    });
    if (!opened) {
      return;
    }
    this._liveEditSidebarHandler = onLiveEditChange;
    this._setSidebarEvent(event.id);
    const { host, header, body, footer } = opened;
    host._lightEntityId = light.entity_id;
    this._setSidebarLight(light.entity_id);
    const subtitleEl = header.querySelector("[slot='subtitle']");
    const chipsHost = document.createElement("div");
    const brightnessGraphMount = document.createElement("div");
    const fieldsHost = document.createElement("div");
    const wheelMount = document.createElement("div");
    body.append(chipsHost, brightnessGraphMount, wheelMount, fieldsHost);

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
      paintFields();
      brightnessGraphCtl?.sync();
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
        const when = document.createElement("span");
        when.className = "time";
        when.textContent = item.events.map((entry) => entry.name).join(" · ");
        btn.append(icon, name, when);
        btn.addEventListener("click", () => {
          if (item.sceneId !== sceneEntityId()) {
            host._switchLightEvent(item.event);
          }
        });
        list.appendChild(btn);
      }
      chipsHost.appendChild(list);
    };

    const paintFields = () => {
      fieldsHost.replaceChildren();
      const draft = currentDraft();
      if (!draft) {
        return;
      }

      const onField = document.createElement("ha-selector");
      onField.hass = this._hass;
      onField.label = "On";
      onField.value = draft.state !== "off";
      onField.selector = { boolean: {} };
      onField.addEventListener("value-changed", async (ev) => {
        ev.stopPropagation();
        currentDraft().state = ev.detail.value ? "on" : "off";
        applyToSession();
        await applyLive();
      });
      fieldsHost.appendChild(onField);

      const brightness = document.createElement("ha-selector");
      brightness.hass = this._hass;
      brightness.label = "Brightness";
      brightness.value = Math.round(((draft.brightness || 0) / 255) * 100);
      brightness.selector = {
        number: {
          min: 0,
          max: 100,
          step: 1,
          mode: "slider",
          unit_of_measurement: "%",
        },
      };
      brightness.addEventListener("value-changed", async (ev) => {
        ev.stopPropagation();
        const nextDraft = currentDraft();
        nextDraft.brightness = Math.round((Number(ev.detail.value) / 100) * 255);
        if (nextDraft.brightness > 0) {
          nextDraft.state = "on";
        }
        applyToSession();
        brightnessGraphCtl?.sync();
        await applyLive();
      });
      fieldsHost.appendChild(brightness);
    };

    const onWheelChange = async () => {
      applyToSession();
      wheelCtl?.syncPresets();
      brightnessGraphCtl?.sync();
      await applyLive();
    };

    brightnessGraphCtl = createLightBrightnessGraph({
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
              // Scene assigned but not yet in uniqueScenes snapshot — stub it.
              entry = {
                draft: null,
                saved: "absent",
                member: false,
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
        await applyLive();
      },
      onDragEnd: () => {
        paintFields();
        wheelCtl?.sync();
      },
    });
    brightnessGraphMount.appendChild(brightnessGraphCtl.el);

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
      "Edits here change this lamp in the related native scene. Graphs update immediately. Save the extrapolation scene to keep the changes.";
    note.append(noteIcon, noteText);
    footer.appendChild(note);

    host._switchLightEvent = async (next) => {
      await selectScene(next);
    };

    paintChips();
    paintFields();
    brightnessGraphCtl?.sync();
    wheelCtl?.sync();
    if (this._liveEdit) {
      await applyLive();
    }
  }

  async _openSaveDialog({ rename = false, focus } = {}) {
    this.shadowRoot.querySelector("ha-dialog.save-dialog")?.remove();
    const data = {
      scene_name: this._formData.scene_name || "Automatic Lighting",
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
    areaPicker.label = LABELS.area;
    areaPicker.helper = HELPERS.area;
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
      keep.textContent = "Keep editing";
      const discard = document.createElement("ha-button");
      discard.slot = "primaryAction";
      discard.variant = "danger";
      discard.textContent = "Discard";
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
    text.textContent = this._loc(
      "ui.panel.config.scene.picker.delete_confirm_text",
      `Are you sure you want to delete ${this._formData.scene_name}?`,
      { name: this._formData.scene_name }
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
    const data = { area: this._formData.area || null };
    const dialog = document.createElement("ha-dialog");
    dialog.className = "area-dialog";
    dialog.setAttribute("header-title", LABELS.area);
    dialog.open = true;

    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = LABELS.area;
    picker.helper = HELPERS.area;
    picker.required = true;
    picker.value = data.area;
    picker.selector = { area: {} };
    dialog.appendChild(picker);

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
    const continueBtn = document.createElement("ha-button");
    continueBtn.slot = "primaryAction";
    continueBtn.variant = "brand";
    continueBtn.textContent = this._loc("ui.common.continue", "Continue");
    continueBtn.disabled = !data.area;
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      data.area = ev.detail?.value || null;
      continueBtn.disabled = !data.area;
    });
    continueBtn.addEventListener("click", () => {
      if (!data.area) {
        picker.reportValidity?.();
        return;
      }
      committed = true;
      if (context === "list") {
        this._pendingNewForm = { area: data.area };
        this._go("new");
      } else {
        this._formData.area = data.area;
        this._render();
      }
      dialog.open = false;
    });
    footer.append(cancel, continueBtn);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => {
      this._areaPromptOpen = false;
      dialog.remove();
      if (!committed && context === "new" && !this._formData.area) {
        this._go("");
      }
    });
    this.shadowRoot.appendChild(dialog);
  }

  _duskMinimumSeconds() {
    if (this._view !== "edit") {
      return undefined;
    }
    return timeToSeconds(this._formData.scene_dusk_minimum_time_of_day);
  }

  _sceneIdsFromForm() {
    if (this._formData.display_scenes_combined) {
      const shared = this._formData.scene_dawn_sunrise_sunset || null;
      return {
        scene_dawn: shared,
        scene_sunrise: shared,
        scene_sunset: shared,
        scene_noon: this._formData.scene_noon || null,
        scene_dusk: this._formData.scene_dusk || null,
      };
    }
    return {
      scene_dawn: this._formData.scene_dawn || null,
      scene_sunrise: this._formData.scene_sunrise || null,
      scene_noon: this._formData.scene_noon || null,
      scene_sunset: this._formData.scene_sunset || null,
      scene_dusk: this._formData.scene_dusk || null,
    };
  }

  _chartKey() {
    if (this._view !== "edit") {
      return "list";
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
        if (this._sunPath && this._sunPathKey === key) {
          this._drawSunPath();
          continue;
        }
        const cached = this._previewCache.get(key);
        if (cached) {
          this._sunPath = cached;
          this._sunPathKey = key;
          this._drawSunPath();
          continue;
        }
        try {
          let payload;
          if (this._view === "edit") {
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
          } else {
            payload = await this._hass.callWS({ type: `${DOMAIN}/sun_path` });
          }
          if (this._chartKey() !== key) {
            this._previewQueued = true;
            continue;
          }
          this._sunPath = payload;
          this._sunPathKey = key;
          if (!this._previewOverlay) {
            this._rememberPreview(key, payload);
          }
          this._drawSunPath();
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
    this._sunPathKey = undefined;
    if (debounce) {
      this._schedulePreview();
    } else {
      this._ensureSunPath();
    }
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
    const dateIcon = document.createElement("ha-icon");
    dateIcon.setAttribute("icon", "mdi:calendar-month-outline");
    dateBtn.append(dateLabel, dateIcon, pickerHost);
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
    dateTools.append(dateBtn, chipRow);

    const banner = document.createElement("div");
    banner.className = "sun-location-override";
    banner.hidden = true;
    const bannerIcon = document.createElement("ha-icon");
    bannerIcon.setAttribute("icon", "mdi:map-marker");
    const copy = document.createElement("div");
    copy.className = "sun-location-copy";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Previewing another location";
    const coords = document.createElement("div");
    coords.className = "coords";
    copy.append(title, coords);
    const change = document.createElement("ha-button");
    change.appearance = "plain";
    change.textContent = "Change";
    change.addEventListener("click", () => this._openLocationDialog());
    const reset = document.createElement("ha-icon-button");
    reset.label = "Use home location";
    const resetIcon = document.createElement("ha-icon");
    resetIcon.setAttribute("icon", "mdi:close");
    reset.appendChild(resetIcon);
    reset.addEventListener("click", () => this._setPreviewLocation(null));
    banner.append(bannerIcon, copy, change, reset);

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
    this._locationBanner = banner;
    this._locationCoords = coords;
    toolbar.append(banner, scrubBlock);
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
      scrub.focus({ preventScroll: true });
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
        label.style.left = "0";
        label.style.top = `${pos}%`;
        if (month === 0) {
          label.style.transform = "none";
        } else if (month === 11) {
          label.style.transform = "translateY(-100%)";
        } else {
          label.style.transform = "translateY(-50%)";
        }
      } else {
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
      this._lightView === "clock" &&
      Boolean(this._clockScrubRail) &&
      Boolean(this.shadowRoot?.querySelector(".sun-light-clock-face"));
    const sidebarOpen = this._sceneSidebarIsOpen();
    const landscapeClock = landscape && clock;
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
    } else {
      this._sunPathStage?.classList.remove("scrub-collapsed");
      if (this._clockScrubRail) {
        this._clockScrubRail.hidden = true;
        this._clockScrubRail.style.height = "";
        this._clockScrubRail.style.marginTop = "";
        this._clockScrubRail.style.top = "";
        this._clockScrubRail.style.left = "";
      }
      if (this._scrubBlock.parentNode !== this._dateToolbar) {
        this._dateToolbar.appendChild(this._scrubBlock);
      }
      this._scrubBlock.hidden = hideToolbarScrub;
      this._yearScrub.classList.remove("vertical");
    }
    this._syncYearScrub();
    if (landscapeClock) {
      requestAnimationFrame(() => this._alignYearScrubRail());
    }
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
    this._clockScrubRail.style.height = `${faceRect.height}px`;
    this._clockScrubRail.style.top = "";
    this._clockScrubRail.style.left = "";
    this._clockScrubRail.style.marginTop = "";
  }

  _drawSunPath() {
    if (!this._sunPathEl || !this._sunPath || !this._sunPath.curve?.length) {
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
    let dayMaxElev = -Infinity;
    for (const [, elev] of curve) {
      dayMaxElev = Math.max(dayMaxElev, elev);
    }
    const strokeOf = (elev) => {
      // Below horizon: minimum. At horizon: maximum. Daytime tapers to min at peak.
      if (elev < 0) {
        return CLOCK_SUN_STROKE_MIN_PX;
      }
      const span = Math.max(dayMaxElev, 1e-6);
      const t = Math.min(1, Math.max(0, elev / span));
      return (
        CLOCK_SUN_STROKE_MAX_PX -
        t * (CLOCK_SUN_STROKE_MAX_PX - CLOCK_SUN_STROKE_MIN_PX)
      );
    };

    const svg = `
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${horizonY}" y2="${horizonY}" stroke="var(--divider-color)" stroke-dasharray="4 4" stroke-width="1"/>
        ${sunStrokePathRuns(curve, strokeOf)
          .map((run) => {
            const stroke = run.night
              ? "var(--secondary-text-color)"
              : skyLookFromElevation(run.midElev).pathColor;
            const d = run.points
              .map(([seconds, elev], index) => {
                const x = xOf(seconds).toFixed(1);
                const y = yOf(elev).toFixed(1);
                return `${index === 0 ? "M" : "L"}${x} ${y}`;
              })
              .join("");
            return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${run.width}px" stroke-opacity="0.5" stroke-dasharray="8 7" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>`;
          })
          .join("")}
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
        bits.push(`${event.name} uses the dusk minimum (${event.solar_time} solar dusk)`);
      }
      if (event.fallback) {
        bits.push("Seasonal fallback (no real solar event this day)");
      }
      if (bits.length) {
        item.title = bits.join(" · ");
      } else {
        item.title = event.name;
      }
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", event.icon);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = event.name;
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = event.fallback ? `${event.time}*` : event.time;
      item.append(icon, name, time);
      if (editable) {
        const scene = document.createElement("span");
        scene.className = "scene";
        const sceneId = this._eventSceneId(event.id);
        const sceneName = this._sceneName(sceneId);
        scene.textContent = sceneName || "Choose scene";
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
      const left = `${(xOf(event.seconds) / CHART_WIDTH) * 100}%`;
      const top = `${yOf(event.elevation)}px`;
      const dot = document.createElement("div");
      dot.className = "sun-dot";
      dot.style.left = left;
      dot.style.top = top;
      const marker = document.createElement("div");
      marker.className = "sun-marker";
      marker.style.left = left;
      marker.style.top = top;
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", event.icon);
      marker.appendChild(icon);
      chart.append(dot, marker);
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
    // Read before painting lights: toolbar build (below) also syncs the
    // toggle, but the graphs must use storage on the first paint or the
    // highlight and the rendered view disagree after refresh.
    if (this._view === "edit" && !this._dateToolbar) {
      this._lightView = this._readLightView();
    }
    const useClock = this._view === "edit" && this._lightView === "clock";
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
    children.push(...(useClock ? [] : [eventsRow]));
    if (events.some((event) => event.fallback)) {
      const note = document.createElement("p");
      note.className = "sun-fallback-note";
      note.textContent =
        "* Time uses a seasonal fallback because the sun does not rise or set that day.";
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
    time.textContent =
      hovering || eventIdle
        ? formatClock(seconds)
        : `Now ${formatClock(seconds)}`;
    const sun = document.createElement("span");
    const elev = interpolateElevation(this._sunPath.curve, seconds);
    sun.textContent = `Sun ${elev.toFixed(1)}°`;
    readout.append(time, sun);
  }

  _updateLightNameBrightness(seconds) {
    for (const { light, el } of this._lightNameLabels || []) {
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
    // 0° at midnight (top), clockwise — matches conic-gradient(from 0deg).
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) {
      deg += 360;
    }
    return (deg / 360) * SECONDS_PER_DAY;
  }

  _clockAngleDeg(seconds) {
    return (seconds / SECONDS_PER_DAY) * 360;
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
    const hole = 20;
    const stroke = (100 - hole) / n;
    for (let index = 0; index < n; index += 1) {
      const midOuter = 100 - index * stroke;
      const midInner = Math.max(hole, midOuter - stroke);
      if (pct <= midOuter && pct >= midInner) {
        return ringLights[index];
      }
    }
    return null;
  }

  _clockSunIdleSeconds() {
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

  _clockSunRadiusOf(elevation) {
    const scale = Math.max(this._sunPath?.max_elevation || 0, 1);
    const t = elevation / scale;
    if (elevation >= 0) {
      return (
        CLOCK_SUN_HORIZON +
        Math.min(1, t) * CLOCK_SUN_DAY_BASE_SPAN * CLOCK_SUN_DAY_EMPHASIS
      );
    }
    return (
      CLOCK_SUN_HORIZON +
      Math.max(-1, t) * (CLOCK_SUN_HORIZON - CLOCK_SUN_NIGHT_MIN)
    );
  }

  _clockSunXy(seconds, elevation) {
    const elev =
      elevation ?? interpolateElevation(this._sunPath?.curve || [], seconds);
    const deg = this._clockAngleDeg(seconds);
    const rad = ((deg - 90) * Math.PI) / 180;
    const r = this._clockSunRadiusOf(elev);
    return {
      x: CLOCK_CX + Math.cos(rad) * r,
      y: CLOCK_CY + Math.sin(rad) * r,
      r,
      rad,
      elev,
    };
  }

  _applyClockSunAppearance(seconds) {
    const curve = this._sunPath?.curve;
    if (!curve?.length) {
      return;
    }
    this._clockSunDisplayedSeconds = seconds;
    const elev = interpolateElevation(curve, seconds);
    const look = skyLookFromElevation(elev);
    const sun = this._clockSunEl;
    if (sun) {
      const pos = this._clockSunXy(seconds, elev);
      // Max scale (2×) for the whole night and at the horizon; shrink only
      // as daytime elevation rises away from 0°.
      const scale =
        elev < 0
          ? 2
          : 1 + (1 - Math.min(1, elev / CLOCK_SUN_SIZE_HORIZON_DEG));
      sun.style.left = `${(pos.x / CLOCK_VIEW) * 100}%`;
      sun.style.top = `${(pos.y / CLOCK_VIEW) * 100}%`;
      sun.style.setProperty("--sun-scale", String(scale));
      sun.style.setProperty("--sun-core", look.sunCore);
      sun.style.setProperty("--sun-corona", look.sunCorona);
      sun.style.setProperty("--sun-streak", look.sunStreak);
      sun.style.setProperty("--sun-streak-opacity", String(look.streakOpacity));
      sun.style.setProperty("--sun-ray-opacity", String(look.rayOpacity));
      sun.style.setProperty("--sun-ghost-opacity", String(look.ghostOpacity));
      sun.setAttribute(
        "aria-label",
        `Sun ${elev >= 0 ? "above" : "below"} horizon`
      );
    }
    const glow = this._clockSkyGlow;
    if (glow) {
      glow.style.background = look.glowBackground;
      glow.style.opacity = String(look.glowOpacity);
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
    // Enter sweep wants a fixed 12h forward run; hover uses shortest arc.
    const delta = forward
      ? (((to - from) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
      : this._shortestSecondsDelta(from, to);
    const started = performance.now();
    this._applyClockSunAppearance(from);
    const tick = (now) => {
      const u = Math.min(1, (now - started) / durationMs);
      const eased = 1 - (1 - u) ** 3;
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
      (((idle - 12 * 3600) % SECONDS_PER_DAY) + SECONDS_PER_DAY) %
      SECONDS_PER_DAY;
    face.classList.remove("clock-face-enter");
    // Restart CSS enter if the face was recycled in the same document.
    void face.offsetWidth;
    face.classList.add("clock-face-enter");
    const clearEnter = (ev) => {
      // Events + sun finish last (1.5s); wait for that spin before clearing.
      if (ev.animationName && ev.animationName !== "clock-event-spin") {
        return;
      }
      face.classList.remove("clock-face-enter");
      face.removeEventListener("animationend", clearEnter);
    };
    face.addEventListener("animationend", clearEnter);
    this._animateClockSunArc(from, idle, 2250, { forward: true });
  }

  _paintClockSunPath(overlay, host, cx, cy) {
    const curve = this._sunPath?.curve;
    if (!curve?.length) {
      return;
    }
    let dayMaxElev = -Infinity;
    for (const [, elev] of curve) {
      dayMaxElev = Math.max(dayMaxElev, elev);
    }
    const strokeOf = (elev) => {
      // Below horizon: minimum. At horizon: maximum. Daytime tapers to min at peak.
      if (elev < 0) {
        return CLOCK_SUN_STROKE_MIN_PX;
      }
      const span = Math.max(dayMaxElev, 1e-6);
      const t = Math.min(1, Math.max(0, elev / span));
      return (
        CLOCK_SUN_STROKE_MAX_PX -
        t * (CLOCK_SUN_STROKE_MAX_PX - CLOCK_SUN_STROKE_MIN_PX)
      );
    };

    let dashOffset = 0;
    // Continuous <path> runs (not per-segment <line>s): round caps on short
    // lines stack into a double spine; one path keeps rounded dashes clean.
    for (const run of sunStrokePathRuns(curve, strokeOf)) {
      const coords = run.points.map(([seconds, elev]) =>
        this._clockSunXy(seconds, elev)
      );
      let d = "";
      let len = 0;
      for (let i = 0; i < coords.length; i += 1) {
        const p = coords[i];
        d += `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
        if (i > 0) {
          len += Math.hypot(
            p.x - coords[i - 1].x,
            p.y - coords[i - 1].y
          );
        }
      }
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute(
        "class",
        run.night ? "clock-sun-night" : "clock-sun-day"
      );
      path.setAttribute("d", d);
      path.style.strokeWidth = `${run.width}px`;
      path.style.strokeDashoffset = `${-dashOffset}`;
      dashOffset += len;
      if (!run.night) {
        path.style.stroke = skyLookFromElevation(run.midElev).pathColor;
      }
      overlay.appendChild(path);
    }

    // CSS sun+flare at “this time of day” on the preview date’s curve.
    const marker = document.createElement("div");
    marker.className = "clock-sun";
    marker.setAttribute("aria-hidden", "true");
    for (const layer of [
      "clock-sun-ghost",
      "clock-sun-rays",
      "clock-sun-streak",
      "clock-sun-corona",
      "clock-sun-core",
    ]) {
      const span = document.createElement("span");
      span.className = layer;
      marker.appendChild(span);
    }
    host.appendChild(marker);
    this._clockSunEl = marker;
    this._clockSunLive = false;
    this._cancelClockSunArc();
    // Position is set by _playClockEnterAnimation (or idle if no enter).
  }

  _bindClockHover(face) {
    const apply = (seconds) => {
      const starting = !face.hasAttribute("data-hovering");
      this._hoverSeconds = seconds;
      face.setAttribute("data-hovering", "");
      if (this._hoverLine) {
        this._hoverLine.style.display = "none";
      }
      if (starting) {
        this._clockSunLive = false;
      }
      if (this._clockSunLive) {
        this._applyClockSunAppearance(seconds);
      } else {
        // Follow the sun-path arc; retarget if the pointer moves mid-intro.
        this._setClockSunArcTarget(seconds, { thenLive: true });
      }
      this._fillHoverReadout(seconds, { hovering: true });
    };
    const clear = () => {
      this._hoverSeconds = undefined;
      face.removeAttribute("data-hovering");
      if (this._hoverLine) {
        this._hoverLine.style.display = "";
      }
      this._clockSunLive = false;
      this._setClockSunArcTarget(this._clockSunIdleSeconds(), {
        thenLive: false,
      });
      this._fillHoverReadout(this._idleReadoutSeconds(), { hovering: false });
    };
    face.addEventListener("pointermove", (ev) => {
      this._pendingClockHover = { clientX: ev.clientX, clientY: ev.clientY };
      if (this._clockHoverRaf) {
        return;
      }
      this._clockHoverRaf = window.requestAnimationFrame(() => {
        this._clockHoverRaf = undefined;
        if (!this._pendingClockHover) {
          return;
        }
        apply(this._secondsFromClockPointer(this._pendingClockHover, face));
      });
    });
    face.addEventListener("pointerleave", () => {
      this._pendingClockHover = undefined;
      if (this._clockHoverRaf) {
        window.cancelAnimationFrame(this._clockHoverRaf);
        this._clockHoverRaf = undefined;
      }
      clear();
    });
  }

  _buildLightClock(events) {
    this._lightNameLabels = [];
    const lights = this._sunPath.lights || [];
    if (!lights.length) {
      return null;
    }
    const ringLights = lights.filter((light) => !light.suggested);
    const suggested = lights.filter((light) => light.suggested);
    const wrap = document.createElement("div");
    wrap.className = "sun-light-clock";

    const face = document.createElement("div");
    face.className = "sun-light-clock-face";
    face.setAttribute("role", "img");
    face.setAttribute(
      "aria-label",
      "24-hour light rings with sun elevation around the rim; midnight at the top"
    );
    const core = document.createElement("div");
    core.className = "sun-light-clock-core";

    const glowHost = document.createElement("div");
    glowHost.className = "sun-light-clock-glow";
    glowHost.setAttribute("aria-hidden", "true");
    this._clockSkyGlow = glowHost;
    const ringsHost = document.createElement("div");
    ringsHost.className = "sun-light-clock-rings";
    const n = ringLights.length;
    const hole = 20;
    const usable = 100 - hole;
    const stroke = n ? usable / n : 0;
    // Expand each ring into its neighbors so soft edges blend over lamp
    // color, not the dark card (same idea as the table’s negative margin).
    const overlap = CLOCK_FEATHER_PCT;
    // Sky glow is applied in _applyClockSunAppearance after the sun marker.
    for (let index = 0; index < n; index += 1) {
      const light = ringLights[index];
      const midOuter = 100 - index * stroke;
      const midInner = Math.max(hole, midOuter - stroke);
      const outer = Math.min(100, midOuter + overlap);
      const inner = Math.max(0, midInner - overlap);
      // --ring-expand grows the band on hover/selected; --clock-feather softens seams.
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
    const setHoveredRing = (entityId) => {
      for (const ring of ringsHost.querySelectorAll(".clock-ring")) {
        ring.classList.toggle(
          "hovered",
          Boolean(entityId) && ring.dataset.entityId === entityId
        );
      }
    };
    ringsHost.addEventListener("pointermove", (ev) => {
      const light = this._lightAtClockPointer(ev, ringsHost, ringLights);
      setHoveredRing(light?.entity_id || null);
    });
    ringsHost.addEventListener("pointerleave", () => {
      setHoveredRing(null);
    });
    const openRingAt = (ev, light) => {
      if (!light) {
        return;
      }
      ev.stopPropagation();
      const assigned = events.filter((item) => this._eventSceneId(item.id));
      if (!assigned.length) {
        return;
      }
      const seconds =
        ev.clientX != null
          ? this._secondsFromClockPointer(ev, face)
          : this._hoverSeconds ??
            (this._sunPath?.today
              ? nowSecondsSinceMidnight()
              : SECONDS_PER_DAY / 2);
      const closest = this._closestEvent(assigned, seconds);
      if (closest) {
        this._openLightEditDialog(light, closest);
      }
    };
    ringsHost.addEventListener("click", (ev) => {
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
    core.append(glowHost, ringsHost);

    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("class", "sun-light-clock-overlay");
    overlay.setAttribute("viewBox", `0 0 ${CLOCK_VIEW} ${CLOCK_VIEW}`);
    overlay.setAttribute("aria-hidden", "true");
    const cx = CLOCK_CX;
    const cy = CLOCK_CY;
    // Hour ticks sit just outside the planet rim (rings outer = horizon).
    // Keep them outside the light rings — not inset onto the visualization.
    const tickOuter = 86;
    const tickInnerMinor = 82;
    const tickInnerMajor = 78;
    // Labels just outside the tick marks.
    const labelR = 94;
    for (let hour = 0; hour < 24; hour += 1) {
      const deg = (hour / 24) * 360;
      const rad = ((deg - 90) * Math.PI) / 180;
      const major = hour % 6 === 0;
      const inner = major ? tickInnerMajor : tickInnerMinor;
      const x1 = cx + Math.cos(rad) * inner;
      const y1 = cy + Math.sin(rad) * inner;
      const x2 = cx + Math.cos(rad) * tickOuter;
      const y2 = cy + Math.sin(rad) * tickOuter;
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("class", major ? "clock-tick major" : "clock-tick");
      tick.setAttribute("x1", x1.toFixed(2));
      tick.setAttribute("y1", y1.toFixed(2));
      tick.setAttribute("x2", x2.toFixed(2));
      tick.setAttribute("y2", y2.toFixed(2));
      overlay.appendChild(tick);
      if (major) {
        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text"
        );
        label.setAttribute("class", "clock-label");
        const lx = cx + Math.cos(rad) * labelR;
        const ly = cy + Math.sin(rad) * labelR;
        label.setAttribute("x", lx.toFixed(2));
        label.setAttribute("y", ly.toFixed(2));
        label.textContent = String(hour).padStart(2, "0");
        overlay.appendChild(label);
      }
    }
    this._paintClockSunPath(overlay, core, cx, cy);

    // Dashed spokes from each solar-event marker in to the planet horizon.
    const eventRayOuter =
      CLOCK_EVENT_ICON_R * (CLOCK_VIEW / 100) - 14;
    for (const event of events) {
      const deg = this._clockAngleDeg(event.seconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ray = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );
      ray.setAttribute("class", "clock-event-ray");
      ray.setAttribute(
        "x1",
        (cx + cos * eventRayOuter).toFixed(2)
      );
      ray.setAttribute(
        "y1",
        (cy + sin * eventRayOuter).toFixed(2)
      );
      ray.setAttribute(
        "x2",
        (cx + cos * CLOCK_SUN_HORIZON).toFixed(2)
      );
      ray.setAttribute(
        "y2",
        (cy + sin * CLOCK_SUN_HORIZON).toFixed(2)
      );
      overlay.appendChild(ray);
    }
    core.appendChild(overlay);
    face.appendChild(core);

    const editable = this._view === "edit";
    const eventAnchors = [];
    for (const event of events) {
      const deg = this._clockAngleDeg(event.seconds);
      const rad = ((deg - 90) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const sceneId = this._eventSceneId(event.id);
      const sceneName = this._sceneName(sceneId);
      const timeText = event.fallback ? `${event.time}*` : event.time;

      const anchor = document.createElement("div");
      anchor.className = "clock-event-anchor";
      anchor._clockPolar = { cos, sin };

      const meta = document.createElement("div");
      meta.className = "clock-event-meta";
      if (event.id === "sunrise" || event.id === "sunset") {
        meta.classList.add("below");
      }
      meta.setAttribute("aria-hidden", "true");
      const heading = document.createElement("span");
      heading.className = "clock-event-heading";
      heading.textContent = `${event.name} · ${timeText}`;
      const sceneEl = document.createElement("span");
      sceneEl.className = "clock-event-scene";
      if (sceneName) {
        sceneEl.textContent = sceneName;
      } else {
        sceneEl.textContent = "Choose scene";
        sceneEl.classList.add("empty");
      }
      meta.append(heading, sceneEl);

      const btn = document.createElement(editable ? "button" : "div");
      btn.className = "clock-event";
      if (editable) {
        btn.type = "button";
        btn.dataset.eventId = event.id;
      }
      btn.title = sceneName
        ? `${event.name} · ${timeText} · ${sceneName}`
        : `${event.name} · ${timeText}`;
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
      face.appendChild(anchor);
      eventAnchors.push(anchor);
    }

    const layoutEventAnchors = () => {
      const w = face.clientWidth;
      if (!w) {
        return;
      }
      // Button centers sit just outside the chrome-inset core (fixed px chrome).
      const iconR = ((w / 2 - CLOCK_CHROME_PX + 16) / w) * 100;
      for (const anchor of eventAnchors) {
        const { cos, sin } = anchor._clockPolar;
        anchor.style.left = `${50 + cos * iconR}%`;
        anchor.style.top = `${50 + sin * iconR}%`;
      }
    };
    layoutEventAnchors();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => layoutEventAnchors());
      ro.observe(face);
    }

    this._bindClockHover(face);
    // Enter once per editor visit (not on date/scene redraws). Cleared when
    // returning to the list so list → edit plays again.
    if (this._clockEnterPlayed) {
      this._applyClockSunAppearance(this._clockSunIdleSeconds());
    } else {
      this._clockEnterPlayed = true;
      this._playClockEnterAnimation(face);
    }
    wrap.appendChild(face);

    const legend = document.createElement("div");
    legend.className = "sun-light-clock-legend";
    for (const light of [...ringLights, ...suggested]) {
      legend.appendChild(this._clockLegendRow(light, events));
    }
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
    if (light.entity_id === this._sidebarLightId) {
      row.classList.add("selected");
    }
    if (!suggested) {
      const swatch = document.createElement("span");
      swatch.className = "clock-legend-swatch";
      const samples = light.samples || [];
      const mid =
        samples[Math.floor(samples.length / 2)] || samples[0] || null;
      swatch.style.background = mid ? darkenedRgb(mid) : "var(--divider-color)";
      row.appendChild(swatch);
    }
    const name = document.createElement("span");
    name.className = "clock-legend-name";
    name.textContent = light.name;
    if (light.in_area === false) {
      name.title = "This light is not in the selected area";
    }
    if (!suggested) {
      this._lightNameLabels.push({ light, el: name });
    }
    row.appendChild(name);
    if (this._view === "edit" && !suggested) {
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
    }
    const missingScenes = this._missingSceneRows(light);
    if (this._view === "edit" && missingScenes.length) {
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
    return row;
  }

  _buildLightBars(xOf, events) {
    this._lightNameLabels = [];
    const lights = this._sunPath.lights || [];
    if (!lights.length) {
      return null;
    }
    const wrap = document.createElement("div");
    wrap.className = "sun-lights";
    for (const light of lights) {
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
    if (light.in_area === false) {
      name.title = "This light is not in the selected area";
    }
    if (!suggested) {
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
    const missingScenes = this._missingSceneRows(light);
    if (this._view === "edit" && missingScenes.length) {
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
    row.appendChild(bar);
    return row;
  }
}

function isoYear(iso) {
  return Number(iso.slice(0, 4));
}

function daysInYear(year) {
  return new Date(year, 1, 29).getDate() === 29 ? 366 : 365;
}

function dayOfYear(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
}

function isoFromDayOfYear(year, dayIndex) {
  const date = new Date(Date.UTC(year, 0, 1 + dayIndex));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

const HUE_WHEEL_RENDER = 600;
const HUE_COLOR_PRESETS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#5ac8fa",
  "#007aff",
  "#5856d6",
  "#af52de",
];
const HUE_TEMP_PRESETS = [2200, 2700, 3000, 4000, 5000, 6500];
const HUE_PIN_PATH =
  "M 24,0 C 10.745166,0 0,10.575951 0,23.622046 0,39.566928 21,57.578739 22.05,58.346457 L 24,60 25.95,58.346457 C 27,57.578739 48,39.566928 48,23.622046 48,10.575951 37.254834,0 24,0 Z";
const HUE_DOT_PATH = "M6 0A6 6 0 006 12 6 6 0 006 0Z";
const HUE_DOT_OUTLINE_PATH = "M8 0A8 8 0 008 16 8 8 0 008 0Z";
const HUE_PATH_STEPS = 24;
const _hueWheelImageCache = new Map();

function hueLinearScale(t, min, max) {
  return (max - min) * t + min;
}

function hueCurveScale(t, min, max) {
  let addon = 0;
  const coef = max / min / 65;
  if (t <= 0.1) {
    addon = hueLinearScale(t * 10, 0, coef);
  } else if (t <= 0.97) {
    addon = coef - hueLinearScale((t - 0.1) / 0.9, 0, 2 * coef);
  } else {
    addon = -coef + hueLinearScale((t - 0.97) / 0.03, 0, coef);
  }
  return (Math.pow(max / min, Math.pow(t, 1.55)) + addon) * min;
}

function inverseHueCurveScale(targetValue, min, max) {
  const epsilon = 0.0001;
  let low = 0;
  let high = 1;
  let t = 0.5;
  while (high - low > epsilon) {
    const midValue = hueCurveScale(t, min, max);
    if (midValue < targetValue) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return t;
}

function xy2polar(x, y) {
  return [Math.sqrt(x * x + y * y), Math.atan2(y, x)];
}

function polar2xy(r, phi) {
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

function rad2deg(rad) {
  return ((rad + Math.PI) / (2 * Math.PI)) * 360;
}

function deg2rad(deg) {
  return (deg / 360) * 2 * Math.PI - Math.PI;
}

function hueFromDeg(deg) {
  deg -= 70;
  if (deg < 0) {
    deg += 360;
  }
  return deg;
}

function degFromHue(hue) {
  hue += 70;
  if (hue > 360) {
    hue -= 360;
  }
  return hue;
}

function saturationFromR(r, radius) {
  const exp = 1.9;
  const saturation = Math.pow(r, exp) / Math.pow(radius, exp);
  return saturation > 1 ? 1 : saturation;
}

function rFromSaturation(saturation, radius) {
  const exp = 1.9;
  return Math.pow(saturation * Math.pow(radius, exp), 1 / exp);
}

function fixHSValue(value, r, radius, hue, fixPoint, lower, maxOffset = 5) {
  const precondition = lower
    ? r > radius / 2
    : r < (3 * radius) / 4 && r > radius / 4;
  if (
    precondition &&
    hue >= fixPoint - maxOffset &&
    hue <= fixPoint + maxOffset
  ) {
    let offset = fixPoint - hue;
    if (offset < 0) {
      offset = -offset;
    }
    offset = maxOffset - offset;
    value += lower ? -offset / 360 : offset / 360;
  }
  return value;
}

function hsValue(hue, r, radius) {
  let value = 0.95;
  value = fixHSValue(value, r, radius, hue, 60, true);
  value = fixHSValue(value, r, radius, hue, 180, true);
  value = fixHSValue(value, r, radius, hue, 240, false);
  value = fixHSValue(value, r, radius, hue, 300, true);
  return value > 1 ? 1 : value;
}

function hsv2rgb(hue, saturation, value) {
  const chroma = value * saturation;
  const hue1 = hue / 60;
  const x = chroma * (1 - Math.abs((hue1 % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue1 >= 0 && hue1 <= 1) {
    [r1, g1, b1] = [chroma, x, 0];
  } else if (hue1 >= 1 && hue1 <= 2) {
    [r1, g1, b1] = [x, chroma, 0];
  } else if (hue1 >= 2 && hue1 <= 3) {
    [r1, g1, b1] = [0, chroma, x];
  } else if (hue1 >= 3 && hue1 <= 4) {
    [r1, g1, b1] = [0, x, chroma];
  } else if (hue1 >= 4 && hue1 <= 5) {
    [r1, g1, b1] = [x, 0, chroma];
  } else if (hue1 >= 5 && hue1 <= 6) {
    [r1, g1, b1] = [chroma, 0, x];
  }
  const m = value - chroma;
  return [
    Math.round(255 * (r1 + m)),
    Math.round(255 * (g1 + m)),
    Math.round(255 * (b1 + m)),
  ];
}

function rgb2hsv(r, g, b) {
  const rabs = r / 255;
  const gabs = g / 255;
  const babs = b / 255;
  const v = Math.max(rabs, gabs, babs);
  const diff = v - Math.min(rabs, gabs, babs);
  const diffc = (c) => (v - c) / 6 / diff + 1 / 2;
  let h = 0;
  let s = 0;
  if (diff !== 0) {
    s = diff / v;
    const rr = diffc(rabs);
    const gg = diffc(gabs);
    const bb = diffc(babs);
    if (rabs === v) {
      h = bb - gg;
    } else if (gabs === v) {
      h = 1 / 3 + rr - bb;
    } else {
      h = 2 / 3 + gg - rr;
    }
    if (h < 0) {
      h += 1;
    } else if (h > 1) {
      h -= 1;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100) / 100, Math.round(v * 100) / 100];
}

function hueTempToRgb(kelvin) {
  const start = 2000;
  const tres = 4200;
  const end = 6500;
  const startRgb = [255, 180, 55];
  const tresRgb = [255, 255, 255];
  const endRgb = [190, 228, 243];
  let k = kelvin;
  if (k < start) {
    k = start;
  }
  if (k > end) {
    k = end;
  }
  if (k < tres) {
    const t = (k - start) / (tres - start);
    return [
      Math.round(hueLinearScale(t, startRgb[0], tresRgb[0])),
      Math.round(hueLinearScale(t, startRgb[1], tresRgb[1])),
      Math.round(hueLinearScale(t, startRgb[2], tresRgb[2])),
    ];
  }
  const t = (k - tres) / (end - tres);
  return [
    Math.round(hueLinearScale(t, tresRgb[0], endRgb[0])),
    Math.round(hueLinearScale(t, tresRgb[1], endRgb[1])),
    Math.round(hueLinearScale(t, tresRgb[2], endRgb[2])),
  ];
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function pinForeground(rgb) {
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 192 ? "rgba(0,0,0,0.7)" : "#fff";
}

function draftWheelMode(draft, hasColor, hasTemp) {
  if (
    draft?.rgb_color ||
    draft?.hs_color ||
    draft?.rgbw_color ||
    draft?.rgbww_color
  ) {
    return hasColor ? "color" : "temp";
  }
  if (draft?.color_temp_kelvin != null) {
    return hasTemp ? "temp" : "color";
  }
  return hasColor ? "color" : "temp";
}

function draftRgb(draft) {
  if (draft?.rgb_color) {
    return draft.rgb_color;
  }
  if (draft?.hs_color) {
    return hsv2rgb(draft.hs_color[0], draft.hs_color[1] / 100, 1);
  }
  if (draft?.rgbww_color) {
    return draft.rgbww_color.slice(0, 3);
  }
  if (draft?.rgbw_color) {
    return draft.rgbw_color.slice(0, 3);
  }
  if (draft?.color_temp_kelvin != null) {
    return hueTempToRgb(draft.color_temp_kelvin);
  }
  return [255, 214, 170];
}

function applyColorToDraft(draft, rgb, hsv) {
  draft.rgb_color = rgb;
  draft.hs_color = [hsv[0], Math.round(hsv[1] * 100)];
  draft.color_temp_kelvin = undefined;
  draft.rgbw_color = undefined;
  draft.rgbww_color = undefined;
  draft.state = "on";
}

function applyTempToDraft(draft, kelvin) {
  draft.color_temp_kelvin = kelvin;
  draft.rgb_color = undefined;
  draft.hs_color = undefined;
  draft.rgbw_color = undefined;
  draft.rgbww_color = undefined;
  draft.state = "on";
}

function inferDraftColorKind(draft) {
  if (draft?.rgbww_color) {
    return "rgbww";
  }
  if (draft?.rgbw_color) {
    return "rgbw";
  }
  if (draft?.rgb_color) {
    return "rgb";
  }
  if (draft?.hs_color) {
    return "hs";
  }
  if (draft?.color_temp_kelvin != null) {
    return "temp";
  }
  return null;
}

function collapseSceneCycle(sequence) {
  const ids = [];
  for (const id of sequence || []) {
    if (!id) {
      continue;
    }
    if (!ids.length || ids[ids.length - 1] !== id) {
      ids.push(id);
    }
  }
  if (ids.length > 1 && ids[0] === ids[ids.length - 1]) {
    ids.pop();
  }
  return ids;
}

function lerpNumber(from, to, t) {
  return from + (to - from) * t;
}

function interpolateDraftSample(fromDraft, toDraft, t) {
  const fromKind = inferDraftColorKind(fromDraft);
  const toKind = inferDraftColorKind(toDraft);
  const kind = t >= 0.5 ? toKind || fromKind : fromKind || toKind;
  if (kind === "temp") {
    const fromK = fromDraft?.color_temp_kelvin;
    const toK = toDraft?.color_temp_kelvin;
    const start = fromK != null ? fromK : toK;
    const end = toK != null ? toK : fromK;
    if (start == null || end == null) {
      return { rgb: draftRgb(t < 0.5 ? fromDraft : toDraft) };
    }
    const kelvin = lerpNumber(start, end, t);
    return { kelvin, rgb: hueTempToRgb(kelvin) };
  }
  if (kind === "hs") {
    const start = fromDraft?.hs_color || toDraft?.hs_color;
    const end = toDraft?.hs_color || fromDraft?.hs_color;
    if (!start || !end) {
      return { rgb: draftRgb(t < 0.5 ? fromDraft : toDraft) };
    }
    const hs = [lerpNumber(start[0], end[0], t), lerpNumber(start[1], end[1], t)];
    return { hs, rgb: hsv2rgb(hs[0], hs[1] / 100, 1) };
  }
  if (kind === "rgbw" && fromDraft?.rgbw_color && toDraft?.rgbw_color) {
    const rgbw = fromDraft.rgbw_color.map((value, index) =>
      lerpNumber(value, toDraft.rgbw_color[index], t)
    );
    return { rgb: rgbw.slice(0, 3) };
  }
  if (kind === "rgbww" && fromDraft?.rgbww_color && toDraft?.rgbww_color) {
    const rgbww = fromDraft.rgbww_color.map((value, index) =>
      lerpNumber(value, toDraft.rgbww_color[index], t)
    );
    return { rgb: rgbww.slice(0, 3) };
  }
  const start = draftRgb(fromDraft);
  const end = draftRgb(toDraft);
  return {
    rgb: [
      lerpNumber(start[0], end[0], t),
      lerpNumber(start[1], end[1], t),
      lerpNumber(start[2], end[2], t),
    ],
  };
}

function colorWheelXY(hue, saturation, radius) {
  const phi = deg2rad(degFromHue(hue));
  const r = rFromSaturation(saturation, radius);
  const [x, y] = polar2xy(r, phi);
  return { x, y };
}

function wheelPointForSample(sample, wheelMode, radius, tempMin, tempMax) {
  if (wheelMode === "temp") {
    if (sample.kelvin == null) {
      return null;
    }
    const coords = coordinatesForTemp(sample.kelvin, radius, tempMin, tempMax);
    return { x: coords.x + radius, y: coords.y + radius, rgb: sample.rgb };
  }
  let hue;
  let saturation;
  if (sample.hs) {
    hue = sample.hs[0];
    saturation = sample.hs[1] / 100;
  } else {
    const hsv = rgb2hsv(sample.rgb[0], sample.rgb[1], sample.rgb[2]);
    hue = hsv[0];
    saturation = hsv[1];
  }
  const coords = colorWheelXY(hue, saturation, radius);
  return { x: coords.x + radius, y: coords.y + radius, rgb: sample.rgb };
}

function hueColorAt(x, y, radius) {
  const [r, phi] = xy2polar(x, y);
  if (r - 2 > radius) {
    return null;
  }
  const hue = hueFromDeg(rad2deg(phi));
  const saturation = saturationFromR(r, radius);
  const value = hsValue(hue, r, radius);
  return { rgb: hsv2rgb(hue, saturation, value), hsv: [hue, saturation, value] };
}

function hueTempAt(x, y, radius, tempMin, tempMax) {
  const [r] = xy2polar(x, y);
  if (r - 2 > radius) {
    return null;
  }
  const rowLength = 2 * radius;
  const n = (y + radius) / rowLength;
  const kelvin = Math.round(hueCurveScale(n, tempMin, tempMax));
  return { rgb: hueTempToRgb(kelvin), kelvin };
}

function coordinatesForColor(hue, saturation, radius) {
  const phi = deg2rad(degFromHue(hue));
  const r = rFromSaturation(saturation, radius);
  const [x, y] = polar2xy(r, phi);
  return { x: Math.round(x), y: Math.round(y) };
}

function coordinatesForTemp(kelvin, radius, tempMin, tempMax) {
  let k = kelvin;
  if (k < tempMin) {
    k = tempMin;
  } else if (k > tempMax) {
    k = tempMax;
  }
  const n = inverseHueCurveScale(k, tempMin, tempMax);
  const y = Math.round(n * 2 * radius - radius);
  const maxX = Math.ceil(Math.sqrt(Math.max(0, radius * radius - y * y)));
  return { x: 0, y, maxX };
}

function limitToWheel(x, y, radius) {
  const dx = x - radius;
  const dy = y - radius;
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) {
    return { x, y };
  }
  const scale = radius / dist;
  return { x: radius + dx * scale, y: radius + dy * scale };
}

function drawHueWheelImage(mode, tempMin, tempMax) {
  const key =
    mode === "temp"
      ? `temp:${HUE_WHEEL_RENDER}:${tempMin}:${tempMax}`
      : `color:${HUE_WHEEL_RENDER}`;
  const cached = _hueWheelImageCache.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = HUE_WHEEL_RENDER;
  canvas.height = HUE_WHEEL_RENDER;
  const ctx = canvas.getContext("2d");
  const radius = HUE_WHEEL_RENDER / 2;
  const image = ctx.createImageData(HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
  const data = image.data;
  for (let x = -radius; x < radius; x++) {
    for (let y = -radius; y < radius; y++) {
      const sample =
        mode === "color"
          ? hueColorAt(x, y, radius)
          : hueTempAt(x, y, radius, tempMin, tempMax);
      if (!sample) {
        continue;
      }
      const adjustedX = x + radius;
      const adjustedY = y + radius;
      const index = (adjustedX + adjustedY * HUE_WHEEL_RENDER) * 4;
      data[index] = sample.rgb[0];
      data[index + 1] = sample.rgb[1];
      data[index + 2] = sample.rgb[2];
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  _hueWheelImageCache.set(key, url);
  return url;
}

function createLightBrightnessGraph({
  getPoints,
  onSelect,
  onAdd,
  onBrightness,
  onDragEnd,
}) {
  // Full-bleed plot — 0/100% live in the heading subtext, not axis labels.
  const WIDTH = 300;
  const HEIGHT = 120;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 14;
  const PAD_B = 22;
  const PLOT_W = WIDTH - PAD_L - PAD_R;
  const PLOT_H = HEIGHT - PAD_T - PAD_B;

  const el = document.createElement("div");
  el.className = "light-brightness-graph";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Brightness by solar event, 0 to 100 percent");

  const heading = document.createElement("div");
  heading.className = "light-brightness-graph-heading";
  const title = document.createElement("div");
  title.className = "light-brightness-graph-title";
  title.textContent = "Brightness";
  const sub = document.createElement("div");
  sub.className = "light-brightness-graph-sub";
  sub.textContent = "0–100% by solar event";
  heading.append(title, sub);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "linearGradient"
  );
  const gradientId = `light-bri-grad-${Math.random().toString(36).slice(2, 9)}`;
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("x1", String(PAD_L));
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", String(PAD_L + PLOT_W));
  gradient.setAttribute("y2", "0");
  defs.appendChild(gradient);

  const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  frame.setAttribute("class", "bg-frame");
  frame.setAttribute("x", String(PAD_L));
  frame.setAttribute("y", String(PAD_T));
  frame.setAttribute("width", String(PLOT_W));
  frame.setAttribute("height", String(PLOT_H));
  frame.setAttribute("rx", "6");

  const fillArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fillArea.setAttribute("class", "fill-area");
  fillArea.setAttribute("fill", `url(#${gradientId})`);

  const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
  curve.setAttribute("class", "curve");

  const handlesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  handlesLayer.setAttribute("class", "handles");

  svg.append(defs, frame, fillArea, curve, handlesLayer);
  el.append(heading, svg);

  let drag = null;
  let dragNode = null;

  const xOf = (seconds, minS, maxS) => {
    const span = maxS - minS || 1;
    return PAD_L + ((seconds - minS) / span) * PLOT_W;
  };
  const yOf = (brightness) =>
    PAD_T + PLOT_H * (1 - Math.max(0, Math.min(255, brightness)) / 255);
  const brightnessFromY = (clientY) => {
    const rect = svg.getBoundingClientRect();
    const scaleY = HEIGHT / (rect.height || HEIGHT);
    const y = (clientY - rect.top) * scaleY;
    const t = 1 - (y - PAD_T) / PLOT_H;
    return Math.round(Math.max(0, Math.min(1, t)) * 255);
  };

  const unbindWindowDrag = () => {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  };

  const onWindowPointerMove = (ev) => {
    if (!drag || drag.pointerId !== ev.pointerId) {
      return;
    }
    onBrightness(drag.sceneId, brightnessFromY(ev.clientY));
  };

  const onWindowPointerUp = (ev) => {
    endDrag(ev);
  };

  const paintGeometry = (points) => {
    gradient.replaceChildren();
    const members = points.filter((point) => point.member);
    if (!points.length) {
      fillArea.setAttribute("d", "");
      curve.setAttribute("d", "");
      return [];
    }
    const minS = points[0].seconds;
    const maxS = points[points.length - 1].seconds;
    const span = Math.max(maxS - minS, 1);
    for (const point of members) {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      const offset = ((point.seconds - minS) / span) * 100;
      const [r, g, b] = point.rgb;
      stop.setAttribute("offset", `${offset.toFixed(2)}%`);
      stop.setAttribute("stop-color", `rgb(${r},${g},${b})`);
      gradient.appendChild(stop);
    }
    if (members.length === 1) {
      const [r, g, b] = members[0].rgb;
      const end = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      end.setAttribute("offset", "100%");
      end.setAttribute("stop-color", `rgb(${r},${g},${b})`);
      gradient.appendChild(end);
    }
    if (members.length) {
      const memberCoords = members.map((point) => ({
        x: xOf(point.seconds, minS, maxS),
        y: yOf(point.brightness),
      }));
      const top = memberCoords
        .map(
          (c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`
        )
        .join(" ");
      const area = `${top} L${memberCoords[memberCoords.length - 1].x.toFixed(
        1
      )},${(PAD_T + PLOT_H).toFixed(1)} L${memberCoords[0].x.toFixed(1)},${(
        PAD_T + PLOT_H
      ).toFixed(1)} Z`;
      fillArea.setAttribute("d", area);
      curve.setAttribute("d", top);
    } else {
      fillArea.setAttribute("d", "");
      curve.setAttribute("d", "");
    }
    return points.map((point) => ({
      x: xOf(point.seconds, minS, maxS),
      y: point.member ? yOf(point.brightness) : PAD_T + PLOT_H,
      point,
    }));
  };

  const syncDragVisual = () => {
    const points = [...getPoints()].sort((a, b) => a.seconds - b.seconds);
    const coords = paintGeometry(points);
    for (const node of handlesLayer.querySelectorAll(".handle")) {
      const match = coords.find((c) => c.point.eventId === node.dataset.eventId);
      if (!match) {
        continue;
      }
      node.classList.toggle("active", Boolean(match.point.active));
      node.classList.toggle("add", !match.point.member);
      for (const circle of node.querySelectorAll("circle")) {
        circle.setAttribute("cx", match.x.toFixed(1));
        circle.setAttribute("cy", match.y.toFixed(1));
      }
      const plus = node.querySelector(".handle-plus");
      if (plus) {
        plus.setAttribute("x", match.x.toFixed(1));
        plus.setAttribute("y", match.y.toFixed(1));
      }
      const fill = node.querySelector(".handle-fill");
      if (fill) {
        const [r, g, b] = match.point.rgb;
        fill.setAttribute("fill", `rgb(${r},${g},${b})`);
        fill.style.display = match.point.member ? "" : "none";
      }
    }
  };

  const endDrag = (ev) => {
    if (!drag || (ev && drag.pointerId !== ev.pointerId)) {
      return;
    }
    const node = dragNode;
    const pointerId = drag.pointerId;
    drag = null;
    dragNode = null;
    unbindWindowDrag();
    if (ev && node) {
      try {
        node.releasePointerCapture(pointerId);
      } catch (_err) {
        /* already released */
      }
    }
    sync();
    onDragEnd?.();
  };

  const sync = () => {
    if (drag) {
      syncDragVisual();
      return;
    }
    const points = [...getPoints()].sort((a, b) => a.seconds - b.seconds);
    handlesLayer.replaceChildren();
    const coords = paintGeometry(points);
    if (!points.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    for (const c of coords) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const classes = ["handle"];
      if (c.point.active) {
        classes.push("active");
      }
      if (!c.point.member) {
        classes.push("add");
      }
      group.setAttribute("class", classes.join(" "));
      group.dataset.eventId = c.point.eventId;
      group.dataset.sceneId = c.point.sceneId;
      const hit = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      hit.setAttribute("class", "handle-hit");
      hit.setAttribute("cx", c.x.toFixed(1));
      hit.setAttribute("cy", c.y.toFixed(1));
      hit.setAttribute("r", "14");
      const fill = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      fill.setAttribute("class", "handle-fill");
      fill.setAttribute("cx", c.x.toFixed(1));
      fill.setAttribute("cy", c.y.toFixed(1));
      fill.setAttribute("r", "5");
      const [r, gCh, b] = c.point.rgb;
      fill.setAttribute("fill", `rgb(${r},${gCh},${b})`);
      if (!c.point.member) {
        fill.style.display = "none";
      }
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      dot.setAttribute("class", "handle-dot");
      dot.setAttribute("cx", c.x.toFixed(1));
      dot.setAttribute("cy", c.y.toFixed(1));
      dot.setAttribute("r", "7");
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      label.setAttribute("class", "handle-label");
      label.setAttribute("x", c.x.toFixed(1));
      label.setAttribute("y", String(HEIGHT - 6));
      label.textContent = c.point.name;
      group.append(hit, dot, fill);
      if (!c.point.member) {
        const plus = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text"
        );
        plus.setAttribute("class", "handle-plus");
        plus.setAttribute("x", c.x.toFixed(1));
        plus.setAttribute("y", c.y.toFixed(1));
        plus.textContent = "+";
        group.appendChild(plus);
        group.setAttribute(
          "aria-label",
          `Add to ${c.point.name}`
        );
        group.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onAdd?.(c.point.sceneId, c.point.eventId);
        });
      } else {
        group.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // Window listeners so release outside the SVG still ends the drag
          // (SVG setPointerCapture alone is flaky across the sidebar chrome).
          unbindWindowDrag();
          try {
            group.setPointerCapture(ev.pointerId);
          } catch (_err) {
            /* capture optional when window listeners are bound */
          }
          dragNode = group;
          drag = {
            sceneId: c.point.sceneId,
            eventId: c.point.eventId,
            pointerId: ev.pointerId,
          };
          window.addEventListener("pointermove", onWindowPointerMove);
          window.addEventListener("pointerup", onWindowPointerUp);
          window.addEventListener("pointercancel", onWindowPointerUp);
          onSelect(c.point.eventId);
          onBrightness(c.point.sceneId, brightnessFromY(ev.clientY));
        });
      }
      group.appendChild(label);
      handlesLayer.appendChild(group);
    }
  };

  sync();
  return {
    el,
    sync,
    disconnect: () => {
      unbindWindowDrag();
      drag = null;
      dragNode = null;
    },
  };
}

function createSceneColorWheel({
  hasColor,
  hasTemp,
  tempMin,
  tempMax,
  getState,
  onSelect,
  onChange,
}) {
  // Polar HSV + kelvin disk, pin/dot markers, and presets match etokheim/huemane-light-card.
  let mode = hasColor ? "color" : "temp";
  const stage = document.createElement("div");
  stage.className = "hue-wheel-stage";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "hue-wheel-canvas";
  const glow = document.createElement("canvas");
  glow.className = "hue-wheel-glow";
  glow.setAttribute("aria-hidden", "true");
  glow.width = HUE_WHEEL_RENDER;
  glow.height = HUE_WHEEL_RENDER;
  const bg = document.createElement("canvas");
  bg.className = "hue-wheel-bg";
  bg.width = HUE_WHEEL_RENDER;
  bg.height = HUE_WHEEL_RENDER;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "hue-wheel-svg");
  svg.innerHTML = `
    <defs>
      <filter id="se-dot-shadow">
        <feDropShadow dx="0" dy="0.5" stdDeviation="1" flood-opacity="1"></feDropShadow>
      </filter>
      <filter id="se-active-shadow">
        <feOffset dx="0" dy="-10" />
        <feGaussianBlur stdDeviation="7" result="offset-blur"/>
        <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
        <feFlood flood-color="#0005" flood-opacity=".95" result="color"/>
        <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
        <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
        <feDropShadow dx="0" dy="1.0" stdDeviation="2.0" flood-opacity="1"></feDropShadow>
      </filter>
    </defs>
  `;
  const pathLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  pathLayer.setAttribute("class", "hue-wheel-paths");
  svg.appendChild(pathLayer);
  canvasWrap.append(glow, svg, bg);
  const chrome = document.createElement("div");
  chrome.className = "hue-wheel-chrome";
  const pill = document.createElement("div");
  pill.className = "hue-mode-pill";
  const presets = document.createElement("div");
  presets.className = "hue-presets";
  const presetTrack = document.createElement("div");
  presetTrack.className = "hue-presets-track";
  presetTrack.setAttribute("role", "list");
  presets.appendChild(presetTrack);
  chrome.append(pill, presets);
  stage.append(canvasWrap, chrome);

  const markers = new Map();
  let drag = null;
  let glideTimer;

  const radiusPx = () => canvasWrap.clientWidth / 2;

  const paintWheel = () => {
    const url = drawHueWheelImage(mode, tempMin, tempMax);
    const img = new Image();
    img.onload = () => {
      const bgCtx = bg.getContext("2d");
      bgCtx.clearRect(0, 0, HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
      bgCtx.drawImage(img, 0, 0);
      const glowCtx = glow.getContext("2d");
      glowCtx.clearRect(0, 0, HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
      glowCtx.drawImage(img, 0, 0);
    };
    img.src = url;
  };

  const markerOffset = (active) =>
    active ? { x: 24, y: 60 } : { x: 6, y: 6 };

  const placeMarker = (marker, x, y, active) => {
    const offset = markerOffset(active);
    marker.g.style.transform = `translate(${x - offset.x}px, ${y - offset.y}px)`;
    marker.g.style.transformOrigin = `${x}px ${y}px`;
    marker.x = x;
    marker.y = y;
  };

  const positionForDraft = (draft, markerMode, radius) => {
    if (markerMode === "color") {
      const rgb = draftRgb(draft);
      const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
      const coords = coordinatesForColor(hsv[0], hsv[1], radius);
      return { x: coords.x + radius, y: coords.y + radius, rgb };
    }
    const kelvin = draft.color_temp_kelvin ?? 2700;
    const coords = coordinatesForTemp(kelvin, radius, tempMin, tempMax);
    const rgb = hueTempToRgb(kelvin);
    return { x: coords.x + radius, y: coords.y + radius, rgb };
  };

  const applyAtPoint = (draft, x, y, radius) => {
    const limited = limitToWheel(x, y, radius);
    const cx = limited.x - radius;
    const cy = limited.y - radius;
    if (mode === "color") {
      const sample = hueColorAt(cx, cy, radius);
      if (!sample) {
        return limited;
      }
      applyColorToDraft(draft, sample.rgb, sample.hsv);
    } else {
      const sample = hueTempAt(cx, cy, radius, tempMin, tempMax);
      if (!sample) {
        return limited;
      }
      applyTempToDraft(draft, sample.kelvin);
    }
    return limited;
  };

  const updatePresetOverflow = () => {
    const maxScroll = presetTrack.scrollWidth - presetTrack.clientWidth;
    presets.classList.toggle(
      "can-scroll-end",
      maxScroll > 1 && presetTrack.scrollLeft < maxScroll - 1
    );
  };

  const syncPresets = () => {
    presetTrack.replaceChildren();
    const { scenes, activeId } = getState();
    const active = scenes.find((item) => item.id === activeId);
    const list = mode === "color" ? HUE_COLOR_PRESETS : HUE_TEMP_PRESETS;
    presetTrack.setAttribute(
      "aria-label",
      mode === "color" ? "Colors" : "Color temperature"
    );
    for (const item of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hue-preset";
      btn.setAttribute("role", "listitem");
      if (mode === "color") {
        btn.style.backgroundColor = item;
        const rgb = hexToRgb(item);
        const current = active ? draftRgb(active.draft) : null;
        if (
          current &&
          current[0] === rgb[0] &&
          current[1] === rgb[1] &&
          current[2] === rgb[2]
        ) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          if (!active) {
            return;
          }
          const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
          applyColorToDraft(active.draft, rgb, hsv);
          const marker = markers.get(active.id);
          if (marker) {
            marker.g.classList.add("glide");
            clearTimeout(glideTimer);
            glideTimer = setTimeout(() => marker.g.classList.remove("glide"), 450);
          }
          onChange();
          sync();
        });
      } else {
        const rgb = hueTempToRgb(item);
        btn.style.backgroundColor = rgbCss(rgb);
        if (active?.draft?.color_temp_kelvin === item) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          if (!active) {
            return;
          }
          applyTempToDraft(active.draft, item);
          const marker = markers.get(active.id);
          if (marker) {
            marker.g.classList.add("glide");
            clearTimeout(glideTimer);
            glideTimer = setTimeout(() => marker.g.classList.remove("glide"), 450);
          }
          onChange();
          sync();
        });
      }
      presetTrack.appendChild(btn);
    }
    requestAnimationFrame(updatePresetOverflow);
  };

  const paintPill = () => {
    pill.replaceChildren();
    if (!(hasColor && hasTemp)) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    for (const option of ["color", "temp"]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hue-mode-btn";
      if (option === mode) {
        btn.classList.add("active");
      }
      btn.setAttribute(
        "aria-label",
        option === "color" ? "Color" : "Color temperature"
      );
      const swatch = document.createElement("span");
      swatch.className = `hue-mode-swatch ${option}`;
      btn.appendChild(swatch);
      btn.addEventListener("click", () => setMode(option, { convertDraft: true }));
      pill.appendChild(btn);
    }
  };

  const sync = () => {
    const radius = radiusPx();
    const { scenes, activeId } = getState();
    const seen = new Set();
    for (const scene of scenes) {
      seen.add(scene.id);
      let marker = markers.get(scene.id);
      if (!marker) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "gm");
        const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
        outline.setAttribute("class", "marker-outline");
        outline.setAttribute("d", HUE_DOT_OUTLINE_PATH);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "marker");
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", "6");
        hit.setAttribute("cy", "6");
        hit.setAttribute("r", "12");
        hit.setAttribute("fill", "transparent");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "text");
        icon.setAttribute("class", "icon text");
        icon.setAttribute("x", "24");
        icon.setAttribute("y", "24");
        icon.setAttribute("text-anchor", "middle");
        icon.setAttribute("dominant-baseline", "middle");
        g.append(outline, path, hit, icon);
        marker = { g, path, outline, hit, icon, sceneId: scene.id };
        markers.set(scene.id, marker);
        g.addEventListener("pointerdown", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const { scenes: now, activeId: current } = getState();
          const item = now.find((row) => row.id === scene.id);
          if (!item) {
            return;
          }
          if (scene.id !== current) {
            onSelect(scene.id);
          }
          const markerMode = draftWheelMode(item.draft, hasColor, hasTemp);
          if (markerMode !== mode) {
            setMode(markerMode, { convertDraft: false });
          }
          const pt = pointFromEvent(ev);
          startDrag(
            ev,
            scene.id,
            pt.x - (marker.x ?? radiusPx()),
            pt.y - (marker.y ?? radiusPx())
          );
          g.classList.add("drag");
        });
        svg.appendChild(g);
      }
      const active = scene.id === activeId;
      const markerMode = draftWheelMode(scene.draft, hasColor, hasTemp);
      marker.path.setAttribute("d", active ? HUE_PIN_PATH : HUE_DOT_PATH);
      marker.g.classList.toggle("active", active);
      marker.g.classList.toggle("off-mode", markerMode !== mode);
      marker.icon.textContent = String(scene.index);
      marker.hit.style.display = active ? "none" : "";
      if (!radius) {
        continue;
      }
      const pos = positionForDraft(scene.draft, markerMode, radius);
      marker.g.style.color = rgbCss(pos.rgb);
      marker.icon.style.fill = pinForeground(pos.rgb);
      placeMarker(marker, pos.x, pos.y, active);
      if (active) {
        svg.appendChild(marker.g);
      }
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.g.remove();
        markers.delete(id);
      }
    }
    syncPath();
    syncPresets();
  };

  const syncPath = () => {
    pathLayer.replaceChildren();
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const { scenes, sequence } = getState();
    const byId = new Map(scenes.map((item) => [item.id, item]));
    const cycle = collapseSceneCycle(sequence || scenes.map((item) => item.id));
    if (cycle.length < 2) {
      return;
    }
    const edgeCount = cycle.length === 2 ? 1 : cycle.length;
    const edges = [];
    for (let index = 0; index < edgeCount; index += 1) {
      const from = byId.get(cycle[index]);
      const to = byId.get(cycle[(index + 1) % cycle.length]);
      if (!from || !to) {
        continue;
      }
      const pts = [];
      for (let step = 0; step <= HUE_PATH_STEPS; step += 1) {
        const sample = interpolateDraftSample(
          from.draft,
          to.draft,
          step / HUE_PATH_STEPS
        );
        const point = wheelPointForSample(
          sample,
          mode,
          radius,
          tempMin,
          tempMax
        );
        if (point) {
          pts.push(point);
        }
      }
      if (pts.length >= 2) {
        edges.push(pts);
      }
    }
    const ns = "http://www.w3.org/2000/svg";
    for (const pts of edges) {
      const under = document.createElementNS(ns, "path");
      under.setAttribute("class", "hue-path-under");
      under.setAttribute(
        "d",
        pts
          .map(
            (pt, index) =>
              `${index ? "L" : "M"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
          )
          .join(" ")
      );
      pathLayer.appendChild(under);
    }
    for (const pts of edges) {
      const mid = document.createElementNS(ns, "path");
      mid.setAttribute("class", "hue-path-mid");
      mid.setAttribute(
        "d",
        pts
          .map(
            (pt, index) =>
              `${index ? "L" : "M"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
          )
          .join(" ")
      );
      pathLayer.appendChild(mid);
    }
    for (const pts of edges) {
      for (let index = 1; index < pts.length; index += 1) {
        const start = pts[index - 1];
        const end = pts[index];
        const seg = document.createElementNS(ns, "path");
        seg.setAttribute("class", "hue-path-seg");
        seg.setAttribute(
          "d",
          `M${start.x.toFixed(2)} ${start.y.toFixed(2)} L${end.x.toFixed(2)} ${end.y.toFixed(2)}`
        );
        seg.setAttribute(
          "stroke",
          rgbCss([
            Math.round((start.rgb[0] + end.rgb[0]) / 2),
            Math.round((start.rgb[1] + end.rgb[1]) / 2),
            Math.round((start.rgb[2] + end.rgb[2]) / 2),
          ])
        );
        pathLayer.appendChild(seg);
      }
    }
  };

  const pointFromEvent = (ev) => {
    const rect = canvasWrap.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const onPointerMove = (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) {
      return;
    }
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const { scenes, activeId } = getState();
    const item = scenes.find((row) => row.id === (drag.sceneId || activeId));
    if (!item) {
      return;
    }
    const pt = pointFromEvent(ev);
    const limited = applyAtPoint(
      item.draft,
      pt.x - drag.grabX,
      pt.y - drag.grabY,
      radius
    );
    const marker = markers.get(item.id);
    if (marker) {
      marker.g.style.color = rgbCss(draftRgb(item.draft));
      marker.icon.style.fill = pinForeground(draftRgb(item.draft));
      placeMarker(marker, limited.x, limited.y, true);
    }
    syncPath();
    onChange();
  };

  const onPointerUp = (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) {
      return;
    }
    const marker = markers.get(drag.sceneId);
    marker?.g.classList.remove("drag");
    marker?.g.classList.add("boing");
    setTimeout(() => marker?.g.classList.remove("boing"), 200);
    drag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    sync();
  };

  const startDrag = (ev, sceneId, grabX = 0, grabY = 0) => {
    drag = { sceneId, pointerId: ev.pointerId, grabX, grabY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  svg.addEventListener("pointerdown", (ev) => {
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const pt = pointFromEvent(ev);
    const dist = Math.hypot(pt.x - radius, pt.y - radius);
    if (dist > radius) {
      return;
    }
    const { scenes, activeId } = getState();
    const item = scenes.find((row) => row.id === activeId);
    if (!item) {
      return;
    }
    ev.preventDefault();
    startDrag(ev, item.id);
    const limited = applyAtPoint(item.draft, pt.x, pt.y, radius);
    const marker = markers.get(item.id);
    marker?.g.classList.add("drag", "active");
    if (marker) {
      placeMarker(marker, limited.x, limited.y, true);
    }
    syncPath();
    onChange();
  });

  const setMode = (next, { convertDraft = false } = {}) => {
    if (next === "color" && !hasColor) {
      return;
    }
    if (next === "temp" && !hasTemp) {
      return;
    }
    const { scenes, activeId } = getState();
    const active = scenes.find((item) => item.id === activeId);
    if (convertDraft && active && draftWheelMode(active.draft, hasColor, hasTemp) !== next) {
      if (next === "color") {
        const rgb = draftRgb(active.draft);
        const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
        applyColorToDraft(active.draft, rgb, hsv);
      } else {
        applyTempToDraft(
          active.draft,
          active.draft.color_temp_kelvin ?? Math.round((tempMin + tempMax) / 2)
        );
      }
      onChange();
    }
    if (mode !== next) {
      mode = next;
      paintWheel();
    }
    paintPill();
    sync();
  };

  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    sync();
    updatePresetOverflow();
  });
  ro?.observe(canvasWrap);
  ro?.observe(presets);
  presetTrack.addEventListener("scroll", updatePresetOverflow, { passive: true });
  paintWheel();
  paintPill();

  const disconnect = () => {
    ro?.disconnect();
    clearTimeout(glideTimer);
    if (drag) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      drag = null;
    }
  };

  return { el: stage, setMode, sync, syncPresets, disconnect };
}

function medianNumber(values) {
  const sorted = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function circularMeanHue(hues) {
  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const rad = (Number(hue) * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const deg = (Math.atan2(y / hues.length, x / hues.length) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function lightDraftFingerprint(draft) {
  return JSON.stringify({
    state: draft?.state || "off",
    brightness: draft?.brightness ?? null,
    color_temp_kelvin: draft?.color_temp_kelvin ?? null,
    rgb_color: draft?.rgb_color ?? null,
    hs_color: draft?.hs_color ?? null,
    rgbw_color: draft?.rgbw_color ?? null,
    rgbww_color: draft?.rgbww_color ?? null,
  });
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPreviewDayMonth(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function emptyFormData() {
  return {
    scene_name: "Automatic Lighting",
    description: "",
    labels: [],
    category: null,
    area: null,
    display_scenes_combined: true,
    scene_dawn_sunrise_sunset: null,
    scene_dawn: null,
    scene_sunrise: null,
    scene_noon: null,
    scene_sunset: null,
    scene_dusk: null,
    scene_dusk_minimum_time_of_day: "22:00:00",
    nightlights_boolean: null,
    nightlights_scene: null,
  };
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

function timeToSeconds(value) {
  if (value == null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const parts = String(value).split(":").map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

function nowSecondsSinceMidnight() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function formatClock(seconds) {
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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

function sunStrokePaths(curve, xOf, yOf, { point: pointFn } = {}) {
  const paths = [];
  if (curve.length < 2) {
    return paths;
  }
  const point =
    pointFn ||
    ((seconds, elevation) =>
      `${xOf(seconds).toFixed(1)},${yOf(elevation).toFixed(1)}`);
  let night = curve[0][1] < 0;
  let current = [point(curve[0][0], curve[0][1])];
  const flush = () => {
    if (current.length >= 2) {
      paths.push({
        night,
        d: current.map((xy, index) => `${index === 0 ? "M" : "L"}${xy}`).join(" "),
      });
    }
    current = [];
  };
  for (let index = 1; index < curve.length; index += 1) {
    const [leftSeconds, leftElev] = curve[index - 1];
    const [rightSeconds, rightElev] = curve[index];
    const rightNight = rightElev < 0;
    if (rightNight === night) {
      current.push(point(rightSeconds, rightElev));
      continue;
    }
    const span = rightElev - leftElev;
    const ratio = (0 - leftElev) / span;
    const crossSeconds = leftSeconds + (rightSeconds - leftSeconds) * ratio;
    current.push(point(crossSeconds, 0));
    flush();
    night = rightNight;
    current.push(point(crossSeconds, 0), point(rightSeconds, rightElev));
  }
  flush();
  return paths;
}

/** Line segments along the sun curve, split at horizon crossings. */
function sunStrokeSegments(curve) {
  const segments = [];
  if (curve.length < 2) {
    return segments;
  }
  let night = curve[0][1] < 0;
  for (let index = 1; index < curve.length; index += 1) {
    const [leftSeconds, leftElev] = curve[index - 1];
    const [rightSeconds, rightElev] = curve[index];
    const rightNight = rightElev < 0;
    if (rightNight === night) {
      segments.push({
        s0: leftSeconds,
        e0: leftElev,
        s1: rightSeconds,
        e1: rightElev,
        night,
      });
      continue;
    }
    const span = rightElev - leftElev;
    const ratio = (0 - leftElev) / span;
    const crossSeconds = leftSeconds + (rightSeconds - leftSeconds) * ratio;
    segments.push({
      s0: leftSeconds,
      e0: leftElev,
      s1: crossSeconds,
      e1: 0,
      night,
    });
    night = rightNight;
    segments.push({
      s0: crossSeconds,
      e0: 0,
      s1: rightSeconds,
      e1: rightElev,
      night,
    });
  }
  return segments;
}

/**
 * Coalesce horizon-split segments into continuous path runs so round dashed
 * strokes do not stack overlapping caps (the “double path” look).
 * Splits when night/day flips or stroke width drifts by more than ~1.25px.
 */
function sunStrokePathRuns(curve, strokeOf) {
  const runs = [];
  for (const segment of sunStrokeSegments(curve)) {
    const midElev = (segment.e0 + segment.e1) / 2;
    const width = strokeOf(midElev);
    const last = runs[runs.length - 1];
    if (
      last &&
      last.night === segment.night &&
      Math.abs(last.width - width) < 1.25
    ) {
      last.points.push([segment.s1, segment.e1]);
      last.widthSum += width;
      last.elevSum += midElev;
      last.count += 1;
      last.width = last.widthSum / last.count;
      last.midElev = last.elevSum / last.count;
      continue;
    }
    runs.push({
      night: segment.night,
      width,
      widthSum: width,
      elevSum: midElev,
      midElev,
      count: 1,
      points: [
        [segment.s0, segment.e0],
        [segment.s1, segment.e1],
      ],
    });
  }
  return runs;
}

function interpolateElevation(curve, seconds) {
  if (!curve.length) {
    return 0;
  }
  if (seconds <= curve[0][0]) {
    return curve[0][1];
  }
  for (let index = 1; index < curve.length; index += 1) {
    const [rightSeconds, rightElev] = curve[index];
    if (seconds <= rightSeconds) {
      const [leftSeconds, leftElev] = curve[index - 1];
      const span = rightSeconds - leftSeconds || 1;
      const ratio = (seconds - leftSeconds) / span;
      return leftElev + (rightElev - leftElev) * ratio;
    }
  }
  return curve[curve.length - 1][1];
}

/** Sky glow + sun flare palette from solar elevation (degrees). */
function skyLookFromElevation(elev) {
  // Keyframes: horizon pink/red near 0°, white high day, blue then dark night.
  const keys = [
    {
      e: -90,
      outer: [4, 6, 14],
      mid: [8, 10, 22],
      glowOpacity: 0.16,
      sunCore: "#c5d0e8",
      sunCorona: "#6a7a9a",
      sunStreak: "#9aa8c4",
      streakOpacity: 0.12,
      rayOpacity: 0.08,
      ghostOpacity: 0.1,
    },
    {
      e: -18,
      outer: [10, 14, 36],
      mid: [16, 22, 55],
      glowOpacity: 0.22,
      sunCore: "#d0daf0",
      sunCorona: "#7a8ab0",
      sunStreak: "#a8b6d4",
      streakOpacity: 0.18,
      rayOpacity: 0.12,
      ghostOpacity: 0.14,
    },
    {
      e: -12,
      outer: [22, 40, 110],
      mid: [40, 70, 160],
      glowOpacity: 0.38,
      sunCore: "#e8eeff",
      sunCorona: "#6b8fd4",
      sunStreak: "#b0c4ff",
      streakOpacity: 0.35,
      rayOpacity: 0.22,
      ghostOpacity: 0.22,
    },
    {
      e: -4,
      outer: [90, 45, 95],
      mid: [200, 80, 100],
      glowOpacity: 0.52,
      sunCore: "#ffd0b8",
      sunCorona: "#ff6b6b",
      sunStreak: "#ffb0a0",
      streakOpacity: 0.75,
      rayOpacity: 0.45,
      ghostOpacity: 0.4,
    },
    {
      e: 0,
      outer: [220, 70, 70],
      mid: [255, 140, 90],
      glowOpacity: 0.62,
      sunCore: "#fff0d0",
      sunCorona: "#ff7a4d",
      sunStreak: "#ffc4a0",
      streakOpacity: 0.95,
      rayOpacity: 0.65,
      ghostOpacity: 0.5,
    },
    {
      e: 4,
      outer: [255, 120, 90],
      mid: [255, 190, 140],
      glowOpacity: 0.58,
      sunCore: "#fff6e0",
      sunCorona: "#ff9a5c",
      sunStreak: "#ffd4a8",
      streakOpacity: 0.9,
      rayOpacity: 0.6,
      ghostOpacity: 0.42,
    },
    {
      e: 8,
      outer: [160, 190, 255],
      mid: [255, 235, 210],
      glowOpacity: 0.52,
      sunCore: "#fffaf0",
      sunCorona: "#ffc878",
      sunStreak: "#ffe8c0",
      streakOpacity: 0.8,
      rayOpacity: 0.5,
      ghostOpacity: 0.32,
    },
    {
      e: 25,
      outer: [140, 185, 255],
      mid: [255, 255, 250],
      glowOpacity: 0.5,
      sunCore: "#ffffff",
      sunCorona: "#ffe08a",
      sunStreak: "#fff4c8",
      streakOpacity: 0.85,
      rayOpacity: 0.55,
      ghostOpacity: 0.28,
    },
    {
      e: 90,
      outer: [120, 170, 255],
      mid: [255, 255, 255],
      glowOpacity: 0.48,
      sunCore: "#ffffff",
      sunCorona: "#ffe9a0",
      sunStreak: "#fff8dc",
      streakOpacity: 0.88,
      rayOpacity: 0.58,
      ghostOpacity: 0.3,
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
      lo = keys[0];
      hi = keys[0];
      break;
    }
  }
  if (elev > keys[keys.length - 1].e) {
    lo = hi = keys[keys.length - 1];
  }
  const span = hi.e - lo.e || 1;
  const t = lo === hi ? 0 : (elev - lo.e) / span;
  const mixRgb = (a, b) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  const lerp = (a, b) => a + (b - a) * t;
  const outer = mixRgb(lo.outer, hi.outer);
  const mid = mixRgb(lo.mid, hi.mid);
  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mixHex = (a, b) => {
    const parse = (h) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const m = mixRgb(parse(a), parse(b));
    return `#${m.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    glowBackground: `radial-gradient(closest-side circle at center, ${rgb(mid, 1)} 0%, ${rgb(mid, 0.85)} 28%, ${rgb(outer, 0.55)} 58%, ${rgb(outer, 0)} 100%)`,
    glowOpacity: lerp(lo.glowOpacity, hi.glowOpacity),
    sunCore: mixHex(lo.sunCore, hi.sunCore),
    sunCorona: mixHex(lo.sunCorona, hi.sunCorona),
    sunStreak: mixHex(lo.sunStreak, hi.sunStreak),
    pathColor: `rgb(${mid[0]},${mid[1]},${mid[2]})`,
    streakOpacity: lerp(lo.streakOpacity, hi.streakOpacity),
    rayOpacity: lerp(lo.rayOpacity, hi.rayOpacity),
    ghostOpacity: lerp(lo.ghostOpacity, hi.ghostOpacity),
  };
}

function darkenedRgb(sample) {
  const t = sample[1] / 100;
  return `rgb(${Math.round(sample[2] * t)},${Math.round(sample[3] * t)},${Math.round(sample[4] * t)})`;
}

function conicGradientFromSamples(samples) {
  if (!samples.length) {
    return "var(--divider-color)";
  }
  const stops = samples.map((sample) => {
    const offset = (sample[0] / SECONDS_PER_DAY) * 100;
    return `${darkenedRgb(sample)} ${offset.toFixed(2)}%`;
  });
  // Close dusk→dawn at midnight so the ring has no seam gap.
  stops.push(`${darkenedRgb(samples[0])} 100%`);
  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

function interpolateLightSample(samples, seconds) {
  if (!samples.length) {
    return { brightness: 0, rgb: [0, 0, 0] };
  }
  const at = (row) => ({
    brightness: row[1],
    rgb: [row[2], row[3], row[4]],
  });
  if (seconds <= samples[0][0]) {
    return at(samples[0]);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const right = samples[index];
    if (seconds <= right[0]) {
      const left = samples[index - 1];
      const span = right[0] - left[0] || 1;
      const ratio = (seconds - left[0]) / span;
      return {
        brightness: left[1] + (right[1] - left[1]) * ratio,
        rgb: [
          Math.round(left[2] + (right[2] - left[2]) * ratio),
          Math.round(left[3] + (right[3] - left[3]) * ratio),
          Math.round(left[4] + (right[4] - left[4]) * ratio),
        ],
      };
    }
  }
  return at(samples[samples.length - 1]);
}

if (!customElements.get("scene-extrapolation-panel")) {
  customElements.define("scene-extrapolation-panel", SceneExtrapolationPanel);
}
