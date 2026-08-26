const DOMAIN = "scene_extrapolation";
const SECONDS_PER_DAY = 24 * 3600;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 200;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 168;
const PLOT_LEFT = 16;
const PLOT_RIGHT = 984;
const LIGHT_BAR_HEIGHT = 60;
const LIGHT_BAR_TOP = 0;
const LIGHT_BAR_BOTTOM = 60;
const LINKED_EVENTS = ["dawn", "sunrise", "sunset"];
const EVENT_SCENE_KEYS = {
  dawn: "scene_dawn",
  sunrise: "scene_sunrise",
  noon: "scene_noon",
  sunset: "scene_sunset",
  dusk: "scene_dusk",
};

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
        if (active && this._datePicker?.contains(active)) {
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
          position: relative;
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
        .sun-date-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .sun-date-nav ha-selector {
          min-width: 168px;
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
        .light-edits {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .light-edit {
          position: absolute;
          bottom: 0;
          transform: translateX(-50%);
          pointer-events: auto;
          --mdc-icon-button-size: 28px;
          --mdc-icon-size: 16px;
          color: var(--primary-text-color);
          filter: drop-shadow(0 0 4px var(--card-background-color));
        }
        .light-dialog ha-selector,
        .light-dialog ha-switch,
        .event-dialog ha-selector,
        .event-dialog ha-switch {
          display: block;
          margin-top: 16px;
        }
        .dialog-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 16px;
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
          margin: 0;
          padding: 6px 4px;
          border: 1px solid transparent;
          border-radius: 12px;
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: default;
        }
        .sun-event.clickable {
          cursor: pointer;
        }
        .sun-event.clickable:hover {
          background: var(--secondary-background-color);
        }
        .sun-event.linked {
          border-color: var(--primary-color);
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
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
          color: var(--secondary-text-color);
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
          padding: 16px 16px 88px;
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
        /* Corner overlay matching hass-subpage #fab. ha-top-app-bar-fixed has
           no fab slot, so this sits as a sibling of the app bar. */
        .fab {
          position: absolute;
          right: calc(16px + var(--safe-area-inset-right, 0px));
          bottom: calc(16px + var(--safe-area-inset-bottom, 0px));
          z-index: 6;
          --ha-button-box-shadow: var(--ha-box-shadow-l);
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
        <div class="sun-path" hidden></div>
        <div class="content"></div>
      </ha-top-app-bar-fixed>
      <div class="fab" hidden></div>
    `;
    this._appBar = this.shadowRoot.querySelector("ha-top-app-bar-fixed");
    this._appBar.narrow = Boolean(this._narrow);
    this._headerEl = this.shadowRoot.querySelector("[slot='title']");
    this._sunPathEl = this.shadowRoot.querySelector(".sun-path");
    this._contentEl = this.shadowRoot.querySelector(".content");
    this._fabEl = this.shadowRoot.querySelector(".fab");
    this._syncHash();
  }

  _syncHash() {
    const hash = (window.location.hash || "#").replace(/^#/, "");
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
    this._render();
  }

  _go(hash) {
    window.location.hash = hash;
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
    return this._fabButton("New extrapolation scene", "mdi:plus", () =>
      this._openAreaDialog({ context: "list" })
    );
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

  _setActionItems(node) {
    for (const child of [...this._appBar.children]) {
      if (child.getAttribute("slot") === "actionItems") {
        child.remove();
      }
    }
    if (!node) {
      return;
    }
    node.slot = "actionItems";
    this._appBar.appendChild(node);
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
    if (!this._entityId) {
      return;
    }
    const detail = { entityId: this._entityId };
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

  _renderEditor() {
    this._headerEl.textContent = this._editId
      ? this._formData.scene_name || "Edit scene"
      : "New scene";
    this._setNavigationIcon(this._backButton());
    this._setActionItems(this._overflowMenu());
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
      this._formData = { ...this._formData, ...ev.detail.value };
      this._error = null;
      this._schedulePreview();
    });
    this._form = form;
    wrap.appendChild(form);
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
    return [
      {
        name: "nightlights_boolean",
        selector: { entity: { domain: "input_boolean", multiple: false } },
      },
      { name: "nightlights_scene", selector: sceneSelector },
    ];
  }

  _eventSceneId(eventId) {
    if (LINKED_EVENTS.includes(eventId) && this._formData.display_scenes_combined) {
      return this._formData.scene_dawn_sunrise_sunset || null;
    }
    return this._formData[EVENT_SCENE_KEYS[eventId]] || null;
  }

  _sceneName(entityId) {
    if (!entityId) {
      return "";
    }
    const state = this._hass?.states?.[entityId];
    return state?.attributes?.friendly_name || entityId.replace(/^scene\./, "");
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

  _openEventSceneDialog(event) {
    this.shadowRoot.querySelector("ha-dialog.event-dialog")?.remove();
    const canLink = LINKED_EVENTS.includes(event.id);
    const data = {
      scene: this._eventSceneId(event.id),
      linked: Boolean(canLink && this._formData.display_scenes_combined),
    };
    const dialog = document.createElement("ha-dialog");
    dialog.className = "event-dialog";
    dialog.setAttribute("header-title", event.name);
    dialog.open = true;

    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = "Scene";
    picker.value = data.scene;
    picker.selector = entitySelector(
      this._hass,
      "scene",
      this._formData.area || null,
      true
    );
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      data.scene = ev.detail?.value || null;
    });
    dialog.appendChild(picker);

    if (event.id === "dusk") {
      data.duskMinimum = this._formData.scene_dusk_minimum_time_of_day;
      const timePicker = document.createElement("ha-selector");
      timePicker.hass = this._hass;
      timePicker.label = LABELS.scene_dusk_minimum_time_of_day;
      timePicker.helper = HELPERS.scene_dusk_minimum_time_of_day;
      timePicker.value = data.duskMinimum;
      timePicker.selector = { time: {} };
      timePicker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        data.duskMinimum = ev.detail?.value;
      });
      dialog.appendChild(timePicker);
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
      });
      row.append(text, toggle);
      dialog.appendChild(row);
    }

    const footer = document.createElement("ha-dialog-footer");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      dialog.open = false;
    });
    const done = document.createElement("ha-button");
    done.slot = "primaryAction";
    done.variant = "brand";
    done.textContent = "Done";
    done.addEventListener("click", () => {
      if (event.id === "dusk" && data.duskMinimum) {
        this._formData.scene_dusk_minimum_time_of_day = data.duskMinimum;
      }
      this._setEventScene(event.id, data.scene, canLink ? data.linked : false);
      dialog.open = false;
    });
    footer.append(cancel, done);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => dialog.remove());
    this.shadowRoot.appendChild(dialog);
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

  async _openLightEditDialog(light, event) {
    const sceneEntityId = this._eventSceneId(event.id);
    if (!sceneEntityId) {
      this._openEventSceneDialog(event);
      return;
    }
    this.shadowRoot.querySelector("ha-dialog.light-dialog")?.remove();
    const eventState = (light.event_states || []).find(
      (item) => item.event === event.id
    );
    const draft = { ...(eventState?.state || { state: "off" }) };
    const snapshot = this._snapshotLight(light.entity_id);
    let liveEdit = false;
    let liveApplied = false;
    const supported =
      this._hass.states[light.entity_id]?.attributes?.supported_color_modes || [];

    const dialog = document.createElement("ha-dialog");
    dialog.className = "light-dialog";
    dialog.setAttribute("header-title", `${light.name} · ${event.name}`);
    dialog.open = true;

    const sceneLine = document.createElement("p");
    sceneLine.className = "sun-fallback-note";
    sceneLine.style.margin = "0 0 8px";
    sceneLine.textContent = `Saved to ${this._sceneName(sceneEntityId)}`;
    dialog.appendChild(sceneLine);

    const applyLive = async () => {
      if (!liveEdit) {
        return;
      }
      liveApplied = true;
      await this._applyLightState(light.entity_id, draft);
    };

    const liveRow = document.createElement("label");
    liveRow.className = "dialog-row";
    const liveLabel = document.createElement("span");
    liveLabel.textContent = "Live edit";
    const liveSwitch = document.createElement("ha-switch");
    liveSwitch.checked = false;
    liveSwitch.addEventListener("change", async () => {
      liveEdit = Boolean(liveSwitch.checked);
      if (liveEdit) {
        await applyLive();
      } else if (liveApplied) {
        await this._applyLightState(light.entity_id, snapshot);
        liveApplied = false;
      }
    });
    liveRow.append(liveLabel, liveSwitch);
    dialog.appendChild(liveRow);

    const onField = document.createElement("ha-selector");
    onField.hass = this._hass;
    onField.label = "On";
    onField.value = draft.state !== "off";
    onField.selector = { boolean: {} };
    onField.addEventListener("value-changed", async (ev) => {
      ev.stopPropagation();
      draft.state = ev.detail.value ? "on" : "off";
      await applyLive();
    });
    dialog.appendChild(onField);

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
      draft.brightness = Math.round((Number(ev.detail.value) / 100) * 255);
      if (draft.brightness > 0) {
        draft.state = "on";
      }
      await applyLive();
    });
    dialog.appendChild(brightness);

    const hasTemp = supported.includes("color_temp");
    const hasColor = supported.some((mode) =>
      ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode)
    );
    if (hasTemp) {
      const attrs = this._hass.states[light.entity_id]?.attributes || {};
      const temp = document.createElement("ha-selector");
      temp.hass = this._hass;
      temp.label = "Color temperature";
      temp.value = draft.color_temp_kelvin || attrs.min_color_temp_kelvin || 2700;
      temp.selector = {
        color_temp: {
          unit: "kelvin",
          min: attrs.min_color_temp_kelvin,
          max: attrs.max_color_temp_kelvin,
        },
      };
      temp.addEventListener("value-changed", async (ev) => {
        ev.stopPropagation();
        draft.color_temp_kelvin = ev.detail.value;
        draft.rgb_color = undefined;
        draft.hs_color = undefined;
        draft.state = "on";
        await applyLive();
      });
      dialog.appendChild(temp);
    }
    if (hasColor) {
      const color = document.createElement("ha-selector");
      color.hass = this._hass;
      color.label = "Color";
      color.value = draft.rgb_color || [255, 214, 170];
      color.selector = { color_rgb: {} };
      color.addEventListener("value-changed", async (ev) => {
        ev.stopPropagation();
        draft.rgb_color = ev.detail.value;
        draft.color_temp_kelvin = undefined;
        draft.state = "on";
        await applyLive();
      });
      dialog.appendChild(color);
    }

    const restoreLive = async () => {
      if (liveApplied) {
        await this._applyLightState(light.entity_id, snapshot);
        liveApplied = false;
      }
    };

    const footer = document.createElement("ha-dialog-footer");
    footer.slot = "footer";
    const cancel = document.createElement("ha-button");
    cancel.slot = "secondaryAction";
    cancel.appearance = "plain";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", async () => {
      await restoreLive();
      dialog.open = false;
    });
    const save = document.createElement("ha-button");
    save.slot = "primaryAction";
    save.variant = "brand";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        await this._hass.callWS({
          type: `${DOMAIN}/update_native_scene`,
          scene_entity_id: sceneEntityId,
          entity_id: light.entity_id,
          entity_state: draft,
        });
        await restoreLive();
        dialog.open = false;
        this._sunPathKey = undefined;
        this._ensureSunPath();
      } catch (err) {
        this._error = err.message || String(err);
        await restoreLive();
        dialog.open = false;
        this._renderEditor();
      }
    });
    footer.append(cancel, save);
    dialog.appendChild(footer);
    dialog.addEventListener("closed", () => {
      restoreLive();
      dialog.remove();
    });
    this.shadowRoot.appendChild(dialog);
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

  _shiftPreviewDate(days) {
    this._previewDate = shiftIsoDate(this._previewDate, days);
    this._sunPathKey = undefined;
    this._ensureSunPath();
  }

  _buildDateToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "sun-toolbar";
    const nav = document.createElement("div");
    nav.className = "sun-date-nav";

    const prev = customElements.get("ha-icon-button-prev")
      ? document.createElement("ha-icon-button-prev")
      : document.createElement("ha-icon-button");
    prev.label = "Previous day";
    if (prev.localName === "ha-icon-button") {
      const prevIcon = document.createElement("ha-icon");
      prevIcon.setAttribute("icon", "mdi:chevron-left");
      prev.appendChild(prevIcon);
    }
    prev.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._shiftPreviewDate(-1);
    });

    // Activity uses ha-date-range-picker (a range). A single calendar day is
    // ha-selector { date: {} }, which lazy-loads ha-date-input from HA's bundle.
    const picker = document.createElement("ha-selector");
    picker.hass = this._hass;
    picker.label = "Date";
    picker.required = true;
    picker.selector = { date: {} };
    picker.value = this._previewDate;
    picker.addEventListener("value-changed", (ev) => {
      const value = ev.detail?.value;
      if (!value) {
        return;
      }
      this._previewDate = value;
      this._sunPathKey = undefined;
      this._ensureSunPath();
    });

    const next = customElements.get("ha-icon-button-next")
      ? document.createElement("ha-icon-button-next")
      : document.createElement("ha-icon-button");
    next.label = "Next day";
    if (next.localName === "ha-icon-button") {
      const nextIcon = document.createElement("ha-icon");
      nextIcon.setAttribute("icon", "mdi:chevron-right");
      next.appendChild(nextIcon);
    }
    next.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._shiftPreviewDate(1);
    });

    nav.append(prev, picker, next);
    toolbar.appendChild(nav);
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
        picker.value = value;
        this._sunPathKey = undefined;
        this._ensureSunPath();
      });
      toolbar.appendChild(chip);
    }
    this._datePicker = picker;
    this._dateChips = toolbar.querySelectorAll(".sun-chip");
    return toolbar;
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
    const editable = this._view === "edit";
    const linked = Boolean(this._formData.display_scenes_combined);
    for (const event of events) {
      const item = document.createElement(editable ? "button" : "div");
      item.className = "sun-event";
      if (editable) {
        item.type = "button";
        item.classList.add("clickable");
        item.addEventListener("click", () => this._openEventSceneDialog(event));
      }
      if (editable && linked && LINKED_EVENTS.includes(event.id)) {
        item.classList.add("linked");
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
        <path d="${area}" fill="url(#${gradientId})" fill-opacity="1"></path>
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
    if (this._view === "edit") {
      const edits = document.createElement("div");
      edits.className = "light-edits";
      for (const event of events) {
        if (!this._eventSceneId(event.id)) {
          continue;
        }
        const button = document.createElement("ha-icon-button");
        button.className = "light-edit";
        button.label = `Edit ${light.name} at ${event.name}`;
        button.style.left = `${(xOf(event.seconds) / CHART_WIDTH) * 100}%`;
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:pencil");
        button.appendChild(icon);
        button.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._openLightEditDialog(light, event);
        });
        edits.appendChild(button);
      }
      bar.appendChild(edits);
    }
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
