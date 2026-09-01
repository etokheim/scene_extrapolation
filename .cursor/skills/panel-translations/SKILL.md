---
name: panel-translations
description: >-
  Scene Extrapolation panel and config i18n (en/nb/nn/de/es): file layout,
  keys, and checks. During development, update en.json only. Sync the other
  languages in the prepare-release-pr pass, not in each feature change set.
  Use when adding UI copy, editing translation JSON, or running the release
  translation pass.
---

# Panel / integration translations

## Languages

Files under `custom_components/scene_extrapolation/translations/`:

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

## During development

Keep the product working in English. Do **not** translate nb/nn/de/es in the
same change set (that is one pass before a PR to `master` —
[prepare-release-pr](../prepare-release-pr/SKILL.md)).

1. Add or update the key in **`en.json`**.
2. Wire the panel with `_t("frontend.…", "English fallback")` — never hardcode a
   new user-facing string without a key. The fallback covers other languages
   until the release pass.
3. Prefer `ui.common.*` / other HA core keys via `_loc` when the meaning matches
   (Cancel, Delete, …).
4. Record non-obvious i18n choices in `docs/DECISIONS.md` if needed.

## Release pass

Before a PR to `master`, bring **nb, nn, de, es** in line with `en.json` (same
tree, translated values, identical `{placeholders}`). Run:

```bash
python .github/scripts/check_translations.py
```

CI runs that script on PRs targeting `master` only.

## Loading

The panel calls `_ensureTranslations()` before first paint (`loadBackendTranslation` for `frontend` and `config`). After language changes, HA reloads resources; a normal document reload picks up new JSON after `docker compose restart`.

## Checks

- Every key present in `en.json` exists in nb/nn/de/es (same tree) **on `master` / release PRs**.
- ICU-style `{name}` / `{step}` placeholders stay identical across languages.
- Config abort/step strings stay translated when the flow text changes.
