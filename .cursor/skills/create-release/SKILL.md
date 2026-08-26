---
name: create-release
description: >-
  Cut a Scene Extrapolation release: choose semver, move CHANGELOG Unreleased,
  bump manifest.json, reset PANEL_ASSET_REV, commit, and create the GitHub
  release. Use when the user asks to release, ship, tag, bump the version,
  publish to HACS, or cut a GitHub release.
---

# Create a Scene Extrapolation release

Do this **in the repo** (not via the GitHub “Version Bump” workflow). Those workflows rewrite `CHANGELOG.md` again and will duplicate or empty Unreleased if the agent already moved it.

Push and `gh release` only when the user asked to publish. Never force-push.

## 1. Classify the Unreleased work

Read `CHANGELOG.md` Unreleased and `docs/DECISIONS.md`.

| Bump | When |
|------|------|
| **major** (`X.0.0`) | Stored keys, entity unique ids, or service fields change and **cannot** be migrated. Mark those lines 🚨 in the changelog. |
| **minor** (`x.Y.0`) | Features or a configuration-home move with an automatic migrator. |
| **patch** (`x.y.Z`) | Fixes only. |

The sidebar/store move (single config entry, panel editor) is a **minor**. Legacy per-room entries import into `scene_extrapolation.scenes` with the old `unique_id`; extra config entries are removed; scene entities keep that id. Users do **not** reconfigure rooms. Options flow is gone on purpose — editing is the sidebar.

Do **not** call that a breaking reconfigure. Future majors need a missing migrator, not a new screen.

## 2. Finish Unreleased

- Every user-visible change in the diff is listed.
- Drop empty `### Added` / `Changed` / `Fixed` subsections.
- No secrets, tokens, or sandbox entity dumps.

## 3. Apply the version

Current version: `custom_components/scene_extrapolation/manifest.json` → `version`.

1. Set `version` to the new `X.Y.Z`.
2. Set `PANEL_ASSET_REV` in `custom_components/scene_extrapolation/panel.py` to `"1"` (the manifest version already cache-busts `panel.js`).
3. In `CHANGELOG.md`:
   - Insert `## [X.Y.Z] - YYYY-MM-DD` (today’s date) **above** previous versions.
   - Move the Unreleased body under that heading.
   - Leave a fresh empty Unreleased section (Added / Changed / Fixed) at the top.

Do not also run `.github/workflows/version-bump.yml` or push a tag whose message contains `release=true` — `release.yml` would shuffle Unreleased a second time.

## 4. Commit

Stage only the version files (manifest, `panel.py` if rev changed, `CHANGELOG.md`). Commit:

```
Release X.Y.Z: <one-line why this version exists>.
```

Follow `.cursor/rules/commit-after-changes.mdc`. No amend / `--no-verify` unless the user asks.

## 5. Publish (only if asked)

```bash
git push origin HEAD
gh release create "vX.Y.Z" --title "Scene Extrapolation X.Y.Z" --notes-file - <<'EOF'
<the new changelog section, without the heading line if gh adds the title>
EOF
```

HACS picks up GitHub releases; `hacs.json` does not contain a version.

## Do not

- Leave Unreleased empty and invent notes from memory — read the diff.
- Bump major because the UI moved if `__init__.py` still imports legacy entries.
- Commit `.storage`, `dev/config/secrets.yaml`, or `release_notes.md` unless the user wants that file.
- Use `git tag` + `release=true` after already moving Unreleased.

## Old patterns

The Actions workflows in `.github/workflows/release.yml` and `version-bump.yml` still exist. Prefer this skill. If someone uses them, Unreleased must still be on `master` when the tag is pushed, and the tag message must include `release=true`.
