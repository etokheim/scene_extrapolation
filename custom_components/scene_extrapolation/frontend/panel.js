const DOMAIN = "scene_extrapolation";
const SECONDS_PER_DAY = 24 * 3600;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 200;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 168;
const PLOT_LEFT = 16;
const PLOT_RIGHT = 984;
const LIGHT_BAR_HEIGHT = 52;
const LIGHT_BAR_TOP = 0;
const LIGHT_BAR_BOTTOM = 52;

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
    this._error = null;
    this._saving = false;
    this._built = false;
    this._sunPath = null;
    this._sunPathKey = undefined;
    this._previewDate = todayIso();
    this._onHashChange = () => this._syncHash();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
    }
    if (this._menuButtonEl) {
      this._menuButtonEl.hass = hass;
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
  }

  set route(_route) {}

  set panel(_panel) {}

  connectedCallback() {
    window.addEventListener("hashchange", this._onHashChange);
    if (this._hass && !this._built) {
      this._build();
    }
    if (!this._sunTimer) {
      this._sunTimer = window.setInterval(() => {
        const active = this.shadowRoot?.activeElement;
        if (active && active.classList.contains("sun-date")) {
          return;
        }
        this._drawSunPath();
      }, 30000);
    }
  }

  disconnectedCallback() {
    window.removeEventListener("hashchange", this._onHashChange);
    if (this._previewTimer) {
      window.clearTimeout(this._previewTimer);
      this._previewTimer = undefined;
    }
    if (this._sunTimer) {
      window.clearInterval(this._sunTimer);
      this._sunTimer = undefined;
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
          height: 100vh;
          overflow: hidden;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
        }
        /* ha-panel-custom often computes to 0 height, so 100% on the app bar
           collapses. Fill the viewport, then stretch the bar to this host. */
        ha-top-app-bar-fixed {
          height: 100% !important;
        }
        .sun-path {
          background: var(--card-background-color);
          border-bottom: 1px solid var(--divider-color);
        }
        .sun-path[hidden] {
          display: none;
        }
        .sun-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 12px 16px 0;
        }
        .sun-toolbar label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }
        .sun-date {
          background: var(--secondary-background-color, var(--input-fill-color, transparent));
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          padding: 6px 8px;
          font: inherit;
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
        }
        .light-row {
          position: relative;
        }
        .light-bar {
          position: relative;
          height: ${LIGHT_BAR_HEIGHT}px;
        }
        .light-bar svg {
          display: block;
          width: 100%;
          height: ${LIGHT_BAR_HEIGHT}px;
        }
        .light-name {
          position: absolute;
          left: 16px;
          top: 6px;
          z-index: 1;
          margin: 0;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
          cursor: pointer;
          text-shadow: 0 0 6px var(--card-background-color);
        }
        .light-name:hover {
          text-decoration: underline;
        }
        .light-warn {
          position: absolute;
          right: 16px;
          top: 6px;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--warning-color, var(--error-color));
          text-shadow: 0 0 6px var(--card-background-color);
        }
        .light-warn ha-icon {
          --mdc-icon-size: 14px;
        }
        .sun-events {
          display: flex;
          justify-content: space-between;
          gap: 4px;
          padding: 12px 16px 4px;
        }
        .sun-event {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 2px;
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
        .content {
          padding: 16px;
        }
        .content.wide {
          max-width: 720px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
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
        .fab {
          position: fixed;
          right: 16px;
          bottom: 16px;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 24px;
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
        <div class="sun-path" hidden></div>
        <div class="content"></div>
      </ha-top-app-bar-fixed>
    `;
    this._appBar = this.shadowRoot.querySelector("ha-top-app-bar-fixed");
    this._appBar.narrow = Boolean(this._narrow);
    this._headerEl = this.shadowRoot.querySelector("[slot='title']");
    this._sunPathEl = this.shadowRoot.querySelector(".sun-path");
    this._contentEl = this.shadowRoot.querySelector(".content");
    this._syncHash();
  }

  _syncHash() {
    const hash = (window.location.hash || "#").replace(/^#/, "");
    if (hash === "new") {
      this._view = "edit";
      this._editId = null;
      this._formData = emptyFormData();
      this._error = null;
      this._render();
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
      this._formData = { ...emptyFormData(), ...(item.form || item) };
    } catch (err) {
      this._error = err.message || String(err);
      this._formData = emptyFormData();
    }
    this._render();
  }

  _go(hash) {
    window.location.hash = hash;
  }

  _render() {
    if (!this._built) {
      return;
    }
    if (this._view === "edit") {
      this._renderEditor();
    } else {
      this._renderList();
    }
    this._ensureSunPath();
  }

  _renderList() {
    this._form = undefined;
    this._headerEl.textContent = "Scene Extrapolation";
    this._setNavigationIcon(this._menuButton());
    this._contentEl.classList.remove("wide");

    if (this._error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = this._error;
      this._contentEl.replaceChildren(error);
      return;
    }

    const wrap = document.createElement("div");
    if (!this._items.length) {
      wrap.className = "empty";
      wrap.textContent =
        "No extrapolation scenes yet. Add one to start lighting a room from the sun.";
    } else {
      wrap.className = "list";
      for (const item of this._items) {
        wrap.appendChild(this._listRow(item));
      }
    }
    this._contentEl.replaceChildren(wrap);
    this._contentEl.appendChild(this._addButton());
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
    const holder = document.createElement("div");
    holder.className = "fab";
    if (customElements.get("ha-fab")) {
      const fab = document.createElement("ha-fab");
      fab.label = "Add";
      fab.extended = true;
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:plus");
      icon.slot = "icon";
      fab.appendChild(icon);
      fab.addEventListener("click", () => this._go("new"));
      holder.appendChild(fab);
    } else {
      const button = document.createElement("button");
      button.className = "fallback";
      button.textContent = "Add";
      button.addEventListener("click", () => this._go("new"));
      holder.appendChild(button);
    }
    return holder;
  }

  _renderEditor() {
    this._headerEl.textContent = this._editId
      ? this._formData.scene_name || "Edit scene"
      : "Add scene";
    this._setNavigationIcon(this._backButton());
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
      const previousCombined = this._formData.display_scenes_combined;
      this._formData = ev.detail.value;
      this._error = null;
      if (previousCombined !== this._formData.display_scenes_combined) {
        form.schema = this._schema();
      }
      this._schedulePreview();
    });
    this._form = form;
    wrap.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "actions";
    if (this._editId) {
      actions.appendChild(
        this._button("Delete", () => this._delete(), { danger: true, ghost: true })
      );
    }
    actions.appendChild(this._button("Save", () => this._save()));
    wrap.appendChild(actions);
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
      } else if (!options.ghost) {
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
    const schema = [
      { name: "scene_name", required: true, selector: { text: {} } },
      { name: "area", selector: { area: {} } },
      { name: "display_scenes_combined", selector: { boolean: {} } },
    ];
    if (this._formData.display_scenes_combined) {
      schema.push(
        {
          name: "scene_dawn_sunrise_sunset",
          required: true,
          selector: sceneSelector,
        },
        { name: "scene_noon", required: true, selector: sceneSelector },
        { name: "scene_dusk", required: true, selector: sceneSelector }
      );
    } else {
      schema.push(
        { name: "scene_dawn", required: true, selector: sceneSelector },
        { name: "scene_sunrise", required: true, selector: sceneSelector },
        { name: "scene_noon", required: true, selector: sceneSelector },
        { name: "scene_sunset", required: true, selector: sceneSelector },
        { name: "scene_dusk", required: true, selector: sceneSelector }
      );
    }
    schema.push(
      { name: "scene_dusk_minimum_time_of_day", selector: { time: {} } },
      {
        name: "nightlights_boolean",
        selector: { entity: { domain: "input_boolean", multiple: false } },
      },
      { name: "nightlights_scene", selector: sceneSelector }
    );
    return schema;
  }

  async _save() {
    this._saving = true;
    this._error = null;
    try {
      const saved = await this._hass.callWS({
        type: `${DOMAIN}/save`,
        scene_id: this._editId || undefined,
        data: this._formData,
      });
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
    if (!window.confirm("Delete this extrapolation scene?")) {
      return;
    }
    try {
      await this._hass.callWS({
        type: `${DOMAIN}/delete`,
        scene_id: this._editId,
      });
      this._go("");
    } catch (err) {
      this._error = err.message || String(err);
      this._renderEditor();
    }
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
    });
  }

  _schedulePreview() {
    if (this._previewTimer) {
      window.clearTimeout(this._previewTimer);
    }
    this._previewTimer = window.setTimeout(() => {
      this._previewTimer = undefined;
      this._ensureSunPath();
    }, 150);
  }

  async _ensureSunPath() {
    if (!this._hass || !this._sunPathEl) {
      return;
    }
    const key = this._chartKey();
    if (this._sunPath && this._sunPathKey === key) {
      this._drawSunPath();
      return;
    }
    this._chartRequest = key;
    try {
      let payload;
      if (this._view === "edit") {
        const msg = {
          type: `${DOMAIN}/preview`,
          date: this._previewDate,
          scenes: this._sceneIdsFromForm(),
        };
        const dusk = this._duskMinimumSeconds();
        if (dusk != null) {
          msg.dusk_minimum = dusk;
        }
        payload = await this._hass.callWS(msg);
      } else {
        payload = await this._hass.callWS({ type: `${DOMAIN}/sun_path` });
      }
      if (this._chartRequest !== key) {
        return;
      }
      this._sunPath = payload;
      this._sunPathKey = key;
      this._drawSunPath();
    } catch (err) {
      if (this._chartRequest !== key) {
        return;
      }
      this._sunPath = null;
      this._sunPathKey = undefined;
      this._sunPathEl.hidden = false;
      const error = document.createElement("p");
      error.className = "error";
      error.style.padding = "16px";
      error.textContent = err.message || String(err);
      this._sunPathEl.replaceChildren(error);
    }
  }

  _buildDateToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "sun-toolbar";
    const label = document.createElement("label");
    label.append("Date");
    const input = document.createElement("input");
    input.type = "date";
    input.className = "sun-date";
    input.value = this._previewDate;
    input.addEventListener("change", () => {
      if (!input.value) {
        return;
      }
      this._previewDate = input.value;
      this._sunPathKey = undefined;
      this._ensureSunPath();
    });
    label.appendChild(input);
    toolbar.appendChild(label);
    const year = new Date().getFullYear();
    const presets = [
      ["Today", todayIso()],
      ["21 Jun", `${year}-06-21`],
      ["21 Dec", `${year}-12-21`],
    ];
    for (const [name, value] of presets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sun-chip";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        this._previewDate = value;
        input.value = value;
        this._sunPathKey = undefined;
        this._ensureSunPath();
      });
      toolbar.appendChild(chip);
    }
    this._dateInput = input;
    this._dateChips = toolbar.querySelectorAll(".sun-chip");
    return toolbar;
  }

  _syncDateToolbar() {
    if (!this._dateInput) {
      return;
    }
    if (this.shadowRoot.activeElement !== this._dateInput) {
      this._dateInput.value = this._previewDate;
    }
    const presets = [todayIso(), `${new Date().getFullYear()}-06-21`, `${new Date().getFullYear()}-12-21`];
    this._dateChips?.forEach((chip, index) => {
      if (presets[index] === this._previewDate) {
        chip.setAttribute("selected", "");
      } else {
        chip.removeAttribute("selected");
      }
    });
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
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);
    const span = Math.max(maxElev - minElev, 1);
    const xOf = (seconds) =>
      PLOT_LEFT + (seconds / SECONDS_PER_DAY) * (PLOT_RIGHT - PLOT_LEFT);
    const yOf = (elevation) =>
      PLOT_TOP + ((maxElev - elevation) / span) * (PLOT_BOTTOM - PLOT_TOP);

    const line = curve
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${xOf(point[0]).toFixed(1)},${yOf(point[1]).toFixed(1)}`;
      })
      .join(" ");
    const area = `${line} L${xOf(curve[curve.length - 1][0]).toFixed(1)},${PLOT_BOTTOM} L${xOf(curve[0][0]).toFixed(1)},${PLOT_BOTTOM} Z`;
    const nowElev = interpolateElevation(curve, nowSeconds);
    const showHorizon = minElev < 0 && maxElev > 0;
    const hourLabels = ["00:00", "06:00", "12:00", "18:00", "24:00"];

    const svg = `
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="sun-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffb74d" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#ffb74d" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#sun-fill)"></path>
        ${
          showHorizon
            ? `<line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="var(--divider-color)" stroke-dasharray="4 4" stroke-width="1"/>`
            : ""
        }
        ${hourLabels
          .map((_, index) => {
            const x = xOf((index / 4) * SECONDS_PER_DAY);
            return `<line x1="${x}" x2="${x}" y1="${PLOT_TOP}" y2="${PLOT_BOTTOM}" stroke="var(--divider-color)" stroke-opacity="0.45" stroke-width="1"/>`;
          })
          .join("")}
        <path d="${line}" fill="none" stroke="#ffb74d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
        ${events
          .map((event) => {
            const x = xOf(event.seconds);
            const y = yOf(event.elevation);
            return `<line x1="${x}" x2="${x}" y1="${y}" y2="${PLOT_BOTTOM}" stroke="var(--secondary-text-color)" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 4"/>`;
          })
          .join("")}
        ${
          isToday
            ? `<line x1="${xOf(nowSeconds)}" x2="${xOf(nowSeconds)}" y1="${PLOT_TOP}" y2="${PLOT_BOTTOM}" stroke="var(--primary-color)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`
            : ""
        }
      </svg>
    `;

    const eventsRow = document.createElement("div");
    eventsRow.className = "sun-events";
    for (const event of events) {
      const item = document.createElement("div");
      item.className = "sun-event";
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

    const children = [];
    if (this._view === "edit") {
      if (!this._dateToolbar) {
        this._dateToolbar = this._buildDateToolbar();
      }
      this._syncDateToolbar();
      children.push(this._dateToolbar);
    }
    children.push(eventsRow);
    if (events.some((event) => event.fallback)) {
      const note = document.createElement("p");
      note.className = "sun-fallback-note";
      note.textContent =
        "* Time uses a seasonal fallback because the sun does not rise or set that day.";
      children.push(note);
    }
    children.push(chart, hours);
    if (this._view === "edit") {
      const lights = this._buildLightBars(xOf, events, isToday, nowSeconds);
      if (lights) {
        children.push(lights);
      }
    }

    this._sunPathEl.hidden = false;
    this._sunPathEl.replaceChildren(...children);
  }

  _buildLightBars(xOf, events, isToday, nowSeconds) {
    const lights = this._sunPath.lights || [];
    if (!lights.length) {
      return null;
    }
    const wrap = document.createElement("div");
    wrap.className = "sun-lights";
    for (const light of lights) {
      wrap.appendChild(this._lightRow(light, xOf, events, isToday, nowSeconds));
    }
    return wrap;
  }

  _lightRow(light, xOf, events, isToday, nowSeconds) {
    const row = document.createElement("div");
    row.className = "light-row";

    const bar = document.createElement("div");
    bar.className = "light-bar";
    const samples = light.samples || [];
    const gradientId = `light-grad-${light.entity_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const plotHeight = LIGHT_BAR_BOTTOM - LIGHT_BAR_TOP;
    const yOf = (brightness) =>
      LIGHT_BAR_BOTTOM - (Math.max(0, brightness) / 100) * plotHeight;
    const line = samples
      .map((sample, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${xOf(sample[0]).toFixed(1)},${yOf(sample[1]).toFixed(1)}`;
      })
      .join(" ");
    const firstX = samples.length ? xOf(samples[0][0]).toFixed(1) : PLOT_LEFT;
    const lastX = samples.length
      ? xOf(samples[samples.length - 1][0]).toFixed(1)
      : PLOT_RIGHT;
    const area = samples.length
      ? `${line} L${lastX},${LIGHT_BAR_BOTTOM} L${firstX},${LIGHT_BAR_BOTTOM} Z`
      : "";
    const stops = samples
      .map((sample) => {
        const offset = (sample[0] / SECONDS_PER_DAY) * 100;
        return `<stop offset="${offset.toFixed(2)}%" stop-color="rgb(${sample[2]},${sample[3]},${sample[4]})"/>`;
      })
      .join("");
    const eventLines = events
      .map((event) => {
        const x = xOf(event.seconds);
        return `<line x1="${x}" x2="${x}" y1="${LIGHT_BAR_TOP}" y2="${LIGHT_BAR_BOTTOM}" stroke="var(--secondary-text-color)" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="2 4"/>`;
      })
      .join("");
    const nowLine =
      isToday
        ? `<line x1="${xOf(nowSeconds)}" x2="${xOf(nowSeconds)}" y1="${LIGHT_BAR_TOP}" y2="${LIGHT_BAR_BOTTOM}" stroke="var(--primary-color)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`
        : "";
    bar.innerHTML = `
      <svg viewBox="0 0 ${CHART_WIDTH} ${LIGHT_BAR_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${PLOT_LEFT}" y1="0" x2="${PLOT_RIGHT}" y2="0">
            ${stops}
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#${gradientId})" fill-opacity="0.35"></path>
        <path d="${line}" fill="none" stroke="url(#${gradientId})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
        ${eventLines}
        ${nowLine}
      </svg>
    `;
    const name = document.createElement("button");
    name.type = "button";
    name.className = "light-name";
    name.textContent = light.name;
    name.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          bubbles: true,
          composed: true,
          detail: { entityId: light.entity_id },
        })
      );
    });
    bar.appendChild(name);
    if (light.gaps?.length) {
      const warn = document.createElement("div");
      warn.className = "light-warn";
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:alert-outline");
      const missing = [...new Set(light.gaps.map((gap) => gap.missing_name))];
      const text = document.createElement("span");
      text.textContent = `Not in ${missing.join(", ")}`;
      warn.append(icon, text);
      bar.appendChild(warn);
    }
    row.appendChild(bar);
    return row;
  }
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyFormData() {
  return {
    scene_name: "Automatic Lighting",
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

function entitySelector(hass, domain, areaId, nativeScenesOnly) {
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

if (!customElements.get("scene-extrapolation-panel")) {
  customElements.define("scene-extrapolation-panel", SceneExtrapolationPanel);
}
