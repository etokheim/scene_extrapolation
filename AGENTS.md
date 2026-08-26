# Agent notes (Scene Extrapolation)

Custom Home Assistant integration in `custom_components/scene_extrapolation/`. This is **not** the live `/config` + Heim dashboard. Keep this file short; durable rationale lives in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Must do

- **Commit after each change set** — see [`.cursor/rules/commit-after-changes.mdc`](.cursor/rules/commit-after-changes.mdc). Overrides global “only commit when asked.” Dirty tree after your edits = commit before finishing the turn.
- **Do not hard-reload the HA/Cursor browser** — bump `PANEL_ASSET_REV` and use normal navigation/refresh. See [`.cursor/rules/no-browser-reload.mdc`](.cursor/rules/no-browser-reload.mdc).
- **Do not silence bugs** — fix the cause; do not clamp or catch-and-guess to hide invariant failures. See [`.cursor/rules/dont-silence-bugs.mdc`](.cursor/rules/dont-silence-bugs.mdc).
- **Record non-obvious decisions** inline or in [`docs/DECISIONS.md`](docs/DECISIONS.md). See [`.cursor/rules/document-decisions.mdc`](.cursor/rules/document-decisions.mdc).
- **HA Jinja templates** — follow [`.cursor/skills/home-assistant-templates/SKILL.md`](.cursor/skills/home-assistant-templates/SKILL.md); update that skill when you find new quirks.
- **HA REST API** — local sandbox at `http://127.0.0.1:8123`; auth via `cursor_ha_token` in `dev/config/secrets.yaml`. See [`.cursor/skills/home-assistant-api/SKILL.md`](.cursor/skills/home-assistant-api/SKILL.md).
- **Releases** — [`.cursor/skills/create-release/SKILL.md`](.cursor/skills/create-release/SKILL.md). Sidebar/store is a minor with automatic migration, not a breaking reconfigure.
- **Secrets** — never dump tokens, `.env`, or HA `.storage` credentials; disclose any accidental secret read immediately. See [`.cursor/rules/secrets-handling.mdc`](.cursor/rules/secrets-handling.mdc).

## Local sandbox

- Docker + starter YAML: [`DEVELOPMENT.md`](DEVELOPMENT.md). Python changes need `docker compose restart`.
- Integration code: [`custom_components/scene_extrapolation/`](custom_components/scene_extrapolation/). Runtime files under `dev/config/` are gitignored except the committed starter YAML.

## Git remote

Public origin: [`etokheim/scene_extrapolation`](https://github.com/etokheim/scene_extrapolation). Workflow: [`docs/GIT.md`](docs/GIT.md).
