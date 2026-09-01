---
name: prepare-release-pr
description: >-
  Prepare a Scene Extrapolation release PR from dev to master: sync
  translations, rewrite CHANGELOG Unreleased from the diff since the last
  release, then open the PR. Merging that PR runs the GitHub release workflow.
  Use when the user asks to release, ship, publish to HACS, cut a version, tag,
  or open a PR to master.
---

# Prepare a release PR (`dev` → `master`)

Do **not** bump `manifest.json`, reset `PANEL_ASSET_REV`, move Unreleased into
a version heading, push a `v*` tag, or run `gh release create`. Merging the PR
to `master` does that (`.github/workflows/release.yml`).

Work from **`dev`**. Feature branches merge to `dev` first.

## 0. Branch

```bash
git fetch origin
git checkout dev
git pull --ff-only origin dev
git merge origin/master --no-edit
```

If `origin/dev` does not exist: `git checkout -b dev origin/master && git push -u origin dev`.

Stop if `dev` is not what should ship (unrelated WIP, failing tests). Merge or
park that work before continuing.

## 1. Translations

English is the only file kept current during development. This is the single
pass for **nb / nn / de / es**. How-to: [panel-translations](../panel-translations/SKILL.md).

1. Diff English (and panel/config copy) since `master`:

   ```bash
   git diff origin/master -- custom_components/scene_extrapolation/translations/en.json \
     custom_components/scene_extrapolation/frontend/panel.js \
     custom_components/scene_extrapolation/translations/
   ```

2. For every new or changed user-visible string: key already in `en.json` (add
   it now if a change set forgot). Translate the same key in `nb.json`,
   `nn.json`, `de.json`, `es.json`. Delete keys removed from English.
3. Same key tree and `{placeholders}` as English. No English leftovers in the
   other four files unless the string is a proper name.
4. Run `python .github/scripts/check_translations.py` (must exit 0). CI runs
   this on PRs to `master`.

Commit translations on their own:

```
Sync nb/nn/de/es translations for the release PR.
```

## 2. Changelog

Fill `## [Unreleased]` from **`git log` / `git diff origin/master`**, not from
memory. Do not keep Unreleased updated during day-to-day work on `dev`.

- Every **user-visible** change since the last `## [X.Y.Z]` heading.
- `### Added` / `Changed` / `Fixed` as appropriate. Drop empty subsections, or
  leave the three headers with no bullets (the release workflow treats empty
  Unreleased as “do not publish”).
- Breaking stored keys / unique ids / un-migratable service fields: 🚨 on that
  line (workflow → **major**).
- No secrets, tokens, or sandbox entity dumps.
- Do **not** insert `## [X.Y.Z] - date` and do **not** bump the version.

Classify (for the PR label; workflow uses the label if present, else infers):

| Bump | When |
|------|------|
| **major** | 🚨 — stored keys, entity unique ids, or service fields that **cannot** be migrated |
| **minor** | Features; `### Added` has entries |
| **patch** | Fixes only (`### Fixed` / `### Changed` without Added or 🚨) |

The sidebar/store move is a **minor** (automatic import). Future majors need a
missing migrator, not a new screen.

Commit:

```
Update Unreleased changelog for the release PR.
```

## 3. Open the PR

```bash
git push -u origin dev
gh label create release:patch --color "0E8A16" --description "Patch release when merged to master" 2>/dev/null || true
gh label create release:minor --color "1D76DB" --description "Minor release when merged to master" 2>/dev/null || true
gh label create release:major --color "B60205" --description "Major release when merged to master" 2>/dev/null || true
```

If a PR from `dev` to `master` is already open, stop after the push (do not open a second one). Otherwise:

```bash
gh pr create --base master --head dev --label "release:<patch|minor|major>" --title "Release: <one-line why>" --body "$(cat <<'EOF'
## Summary
- <user-visible why this ships>

## Release
- Suggested bump: <patch|minor|major>
- Changelog is under Unreleased; the merge workflow assigns the version.

## Test plan
- [ ] CI green
- [ ] Translation check (`check_translations.py`) passed locally
EOF
)"
```

Pushing `dev` is required to open the PR. Never force-push. Do not merge unless
the user asked.

`release:skip` on a PR to `master` updates the branch without publishing (docs /
workflow-only). Prefer that over an empty Unreleased only when nothing should
ship.

## Do not

- Leave Unreleased empty and invent notes — read the diff.
- Bump major because the UI moved if `__init__.py` still imports legacy entries.
- Commit `.storage`, `dev/config/secrets.yaml`, or `release_notes.md`.
- Run `.github/workflows` by pushing a `v*` tag (the tag-based release path is gone).
