# Git workflow for Scene Extrapolation

## Branches

| Branch | Role |
|--------|------|
| **`dev`** | Default place for work. Feature branches merge here. |
| **`master`** | Released code. A merged PR into `master` publishes a GitHub / HACS release. |

Do not open feature PRs against `master`. To ship: [`.cursor/skills/prepare-release-pr/SKILL.md`](../.cursor/skills/prepare-release-pr/SKILL.md) (translations + changelog, then `dev` → `master`). The merge runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which assigns the version. Details: [`RELEASE.md`](../RELEASE.md).

If `origin/dev` does not exist yet:

```bash
git checkout -b dev origin/master
git push -u origin dev
```

After clone, check out `dev` before starting work (`git checkout dev`). GitHub’s default branch stays `master` so visitors see released code.

## What is versioned

- Integration: `custom_components/scene_extrapolation/`
- Agent instructions: `AGENTS.md`, `.cursor/`, `docs/`
- Local sandbox **starter** YAML: `dev/config/configuration.yaml`, `scenes.yaml.example`, `packages/`, `area_map.yaml`, `apply_area_map.py`, plus empty `automations.yaml` / `scripts.yaml`. Live `scenes.yaml` is gitignored (HA writes it back from the UI).
- Tooling: `docker-compose.yml`, `pyproject.toml`, `DEVELOPMENT.md`, CI under `.github/`

## What is not versioned

- `dev/config/` runtime: `.storage/`, databases, logs, onboarding, `custom_components/virtual/` (hass-virtual copy)
- `dev/config/secrets.yaml` (use `dev/config/secrets.yaml.example` as a template)
- `dev/config/scenes.yaml` (use `dev/config/scenes.yaml.example` as a template)
- `__pycache__/`, `.env`

## Clone

Public origin: [`etokheim/scene_extrapolation`](https://github.com/etokheim/scene_extrapolation).

```bash
git clone git@github.com:etokheim/scene_extrapolation.git
cd scene_extrapolation
git checkout dev
```

Sandbox setup: [`DEVELOPMENT.md`](../DEVELOPMENT.md).

## Private vs this repo

This integration is public. Do **not** copy live-home YAML, production tokens, or `/config` from [`etokheim/Home-Assistant-Config`](https://github.com/etokheim/Home-Assistant-Config). Talk to a running HA only via the Docker sandbox in this repo.

## If `secrets.yaml` was ever pushed

Rotate any exposed credentials, then rewrite history (e.g. `git filter-repo`) before pushing to a shared remote.

## Commits without local git user

If `git commit` fails with “tell me who you are”, set author for one command only (does not write config):

```bash
GIT_AUTHOR_NAME='Your Name' GIT_AUTHOR_EMAIL='you@example.com' \
GIT_COMMITTER_NAME='Your Name' GIT_COMMITTER_EMAIL='you@example.com' \
git commit -m "message"
```
