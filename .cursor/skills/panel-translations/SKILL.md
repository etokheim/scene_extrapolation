---
name: panel-translations
description: >-
  Keep Scene Extrapolation panel and config translations (en/nb/nn/de/es) in
  sync when adding or changing user-visible UI strings. Use whenever editing
  panel.js copy, translation JSON, config flow text, or shipping i18n changes.
---

# Panel / integration translations

## Languages

Maintain these files under `custom_components/scene_extrapolation/translations/`:

| Code | Language |
|------|----------|
| `en.json` | English (source of truth) |
| `nb.json` | Norwegian Bokmål |
| `nn.json` | Norwegian Nynorsk |
| `de.json` | German |
| `es.json` | Spanish |

Do **not** use `strings.json` or Lokalise placeholders — custom integrations ship full text in each language file ([HA docs](https://developers.home-assistant.io/docs/internationalization/custom_integration/)).

## Structure

- `config.*` — config flow (HA loads category `config`).
- `frontend.*` — sidebar panel copy (load with `hass.loadBackendTranslation("frontend", DOMAIN)`).

Keys are nested JSON; the panel resolves them as:

`component.scene_extrapolation.<path>` via `_t("frontend.tabs.extrapolation", "…")`.

## When you change UI copy

1. Add or update the key in **`en.json` first**.
2. Update **nb, nn, de, es** in the same change set (no English-only leftovers).
3. Wire the panel with `_t("frontend.…", "English fallback")` — never hardcode a new user-facing string without a key.
4. Prefer `ui.common.*` / other HA core keys via `_loc` when the meaning matches (Cancel, Delete, …).
5. Record non-obvious i18n choices in `docs/DECISIONS.md` if needed.

## Loading

The panel calls `_ensureTranslations()` before first paint (`loadBackendTranslation` for `frontend` and `config`). After language changes, HA reloads resources; a normal document reload picks up new JSON after `docker compose restart`.

## Checks

- Every key present in `en.json` exists in nb/nn/de/es (same tree).
- ICU-style `{name}` / `{step}` placeholders stay identical across languages.
- Config abort/step strings stay translated when the flow text changes.
