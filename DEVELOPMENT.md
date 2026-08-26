# Local development

This repo is a Home Assistant custom integration. Python changes only take effect after HA restarts.

The sandbox is configured in YAML under `dev/config/`:

- `packages/` — extra virtual lights per area ([hass-virtual](https://github.com/twrecked/hass-virtual), old-style YAML)
- `scenes.yaml` — native day/evening/night scenes per area
- `area_map.yaml` — area assignment (HA has no YAML for this; applied to the registries after first boot)

Onboarding created the areas **Stue**, **Kjøkken**, and **Soverom**.

## Start

Install hass-virtual into the sandbox (once):

```bash
git clone --depth 1 --branch v0.9.3 https://github.com/twrecked/hass-virtual.git /tmp/hass-virtual
mkdir -p dev/config/custom_components
cp -R /tmp/hass-virtual/custom_components/virtual dev/config/custom_components/virtual
```

```bash
docker compose up -d
```

Open http://localhost:8123 and finish onboarding (once). Then assign lights and scenes to areas:

```bash
docker compose stop
docker compose run --rm --no-deps --entrypoint python3 homeassistant /config/apply_area_map.py
docker compose start
```

After that:

1. **Settings → Devices & services → Add integration → Scene Extrapolation**
2. Pick an area and that area's **dag / kveld** scenes (optional `input_boolean.nightlights` + natt scene)
3. Activate the generated scene from **Developer tools → States**

Logs: `dev/config/home-assistant.log` or `docker compose logs -f`.

## After code changes

HA does not hot-reload custom component Python. Restart, then test again:

```bash
docker compose restart
```

YAML in `dev/config/` can usually be reloaded from **Developer tools → YAML**. Translation JSON under `custom_components/` still needs a restart. After adding new lights, re-run `apply_area_map.py` with HA stopped.

## Stop

```bash
docker compose down
```

Config, onboarding, and your test entities persist in `dev/config/` (runtime files are gitignored).

## Agent REST token (optional)

To let Cursor agents call the sandbox REST API, create a long-lived token in the sandbox UI (Profile → Long-Lived Access Tokens), copy `dev/config/secrets.yaml.example` to `dev/config/secrets.yaml`, and set `cursor_ha_token`. See [`.cursor/skills/home-assistant-api/SKILL.md`](.cursor/skills/home-assistant-api/SKILL.md).
