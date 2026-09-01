# Release Process

Development lives on **`dev`**. Merging a pull request into **`master`** publishes the GitHub (and HACS) release.

Do not bump the version or rewrite Unreleased in the PR. The merge workflow does that.

## Ship a version

1. Finish work on `dev` (feature branches merge to `dev` first).
2. An agent (or you) follows [`.cursor/skills/prepare-release-pr/SKILL.md`](.cursor/skills/prepare-release-pr/SKILL.md):
   - One pass for **nb / nn / de / es** (English is already kept current).
   - Rewrite `CHANGELOG.md` **Unreleased** from the diff since the last version.
   - Open a PR **`dev` → `master`** with a `release:patch` / `release:minor` / `release:major` label.
3. Merge the PR when CI is green. [`.github/workflows/release.yml`](.github/workflows/release.yml) then:
   - Infers the bump from that label, or from Unreleased (`🚨` → major, `### Added` → minor, otherwise patch)
   - Sets `manifest.json` `version`, moves Unreleased to `## [X.Y.Z] - date`, resets `PANEL_ASSET_REV` to `"1"`
   - Commits, tags `vX.Y.Z`, creates the GitHub release (HACS picks this up)
   - Merges `master` back into `dev` (or creates `dev` if it is missing)

Empty Unreleased, or the `release:skip` label, updates `master` without publishing. Use skip for workflow/docs-only PRs that must land on `master`.

Manual fallback: Actions → **Release** → Run workflow, with bump `auto` or an explicit type. `master` still needs Unreleased entries.

## Version numbering

[Semantic Versioning](https://semver.org/):

- **MAJOR** (`X.0.0`): stored keys, entity unique ids, or service fields that cannot be migrated (mark 🚨 in the changelog)
- **MINOR** (`x.Y.0`): features; configuration-home moves with an automatic migrator
- **PATCH** (`x.y.Z`): fixes only

The sidebar/store move (single config entry, panel editor) is a **minor**. Users do not reconfigure rooms.

## Changelog

`CHANGELOG.md` Unreleased is filled in the release PR, not during everyday `dev` work. Keep a Changelog format: Added / Changed / Fixed.

## HACS

`hacs.json` has no version. HACS uses GitHub releases.

## Workflow files

- `.github/workflows/release.yml` — publish on merged PR to `master`
- `.github/workflows/ci.yml` — lint/tests on `dev` and `master`; translation key-tree check on PRs to `master`
- `.github/scripts/cut_release.py` — version + changelog rewrite
- `.github/scripts/check_translations.py` — en/nb/nn/de/es key parity
- `CHANGELOG.md` — history
- `custom_components/scene_extrapolation/manifest.json` — component version
