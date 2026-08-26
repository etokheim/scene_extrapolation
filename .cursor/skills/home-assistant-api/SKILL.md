---
name: home-assistant-api
description: >-
  Call the local Docker sandbox Home Assistant REST API using cursor_ha_token
  in dev/config/secrets.yaml. Use when reading entity states, calling services,
  rendering templates, listing areas/devices, checking config, or when
  browser/UI inspection is insufficient and live HA data is needed. Do not use
  production HA or /config/secrets.yaml from the live home.
---

# Home Assistant API (Docker sandbox)

This repo talks to the **local Scene Extrapolation sandbox**, not the live home `/config`. Prefer the REST API for authoritative state over guessing from YAML alone.

## Auth (required)

- Token key: `cursor_ha_token` in [`dev/config/secrets.yaml`](../../../dev/config/secrets.yaml) (gitignored).
- Example template: [`dev/config/secrets.yaml.example`](../../../dev/config/secrets.yaml.example).
- Create the token in the **sandbox** UI (Profile → Long-Lived Access Tokens). See [`DEVELOPMENT.md`](../../../DEVELOPMENT.md).
- **Never** open/browse the whole secrets file. Extract **only** that key.
- **Never** print, log, or echo the token. Follow
  [`.cursor/rules/secrets-handling.mdc`](../../rules/secrets-handling.mdc).
- **Never** read production `/config/secrets.yaml` or copy live-home tokens into this workspace.

## Base URL

From this environment use:

```text
http://127.0.0.1:8123
```

(`docker-compose.yml` publishes sandbox HA on host port 8123. `/api/` returns 401 without a token — that means the Core HTTP API is up.)

## Safe call pattern

Run from the **repo root**. Extract only `cursor_ha_token`; never print it.

```bash
python3 - <<'PY'
from pathlib import Path
import json, urllib.request, yaml

secrets = yaml.safe_load(Path("dev/config/secrets.yaml").read_text())
token = secrets["cursor_ha_token"]  # do not print
base = "http://127.0.0.1:8123"

def ha(path, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

# Example: one sandbox entity (print state only — never the token)
st = ha("/api/states/light.ceiling_lights")
print(st["state"], st.get("attributes", {}).get("brightness"))
PY
```

## High-value endpoints

| Goal | Method | Path / body |
|------|--------|-------------|
| API health | GET | `/api/` |
| One entity | GET | `/api/states/<entity_id>` |
| All states | GET | `/api/states` (large — filter in Python) |
| Call service | POST | `/api/services/<domain>/<service>` + JSON body |
| Render template | POST | `/api/template` body `{"template": "{{ … }}"}` |
| Config info | GET | `/api/config` |
| Check config | POST | `/api/services/homeassistant/check_config` |
| Areas | GET | `/api/config/area_registry/list` via WS — or use REST where available; for registries prefer Websocket or existing YAML/helpers |

Service call example (sandbox dummy lights / native scenes):

```python
ha("/api/services/light/turn_on", "POST", {
    "entity_id": "light.ceiling_lights",
    "brightness_pct": 40,
})
ha("/api/services/scene/turn_on", "POST", {
    "entity_id": "scene.stue_dag",
})
```

Template example:

```python
print(ha("/api/template", "POST", {
    "template": "{{ states('light.ceiling_lights') }}"
}))
```

Official reference: [REST API](https://developers.home-assistant.io/docs/api/rest/).

## When to use API vs browser vs YAML

| Need | Prefer |
|------|--------|
| Current entity/device state, attributes, last_changed | REST API |
| Fire a service / validate a template quickly | REST API |
| Scene Extrapolation sidebar panel layout, CSS, chart | Already-authenticated **sandbox** tab (`http://localhost:8123`), or ask the user. **Never** open production HA login / submit credentials (IP ban). |
| How the integration is authored | `custom_components/scene_extrapolation/` |
| How the sandbox home is authored | `dev/config/` starter YAML |

## Safety

- Read-only by default. Only call mutating services when the task requires it.
- Do not dump `/api/states` unfiltered into chat — summarize.
- Do not commit tokens, response blobs that embed tokens, or `.storage` auth files.
- **Never** `POST /auth/login` or use the Cursor browser against a **production** HA URL if that would show a login form. Failed logins ban the IP (`login_attempts_threshold: 5`). Prefer this sandbox; do not brute-force the sandbox login form either.
