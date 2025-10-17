# Release Process

This document describes the automated release process for Scene Extrapolation.

## Automated Release Workflow

This project uses GitHub Actions to automate the release process. There are two main workflows:

### 1. Version Bump Workflow (`version-bump.yml`)

**Trigger**: Manual workflow dispatch from GitHub Actions tab

**Features**:

- Automatically increments version in `manifest.json`
- Updates `CHANGELOG.md` with new version entry
- Commits and pushes changes
- Optionally creates and pushes a Git tag

**Usage**:

1. Go to GitHub Actions tab in your repository
2. Select "Version Bump" workflow
3. Click "Run workflow"
4. Choose version bump type:
   - **patch**: 0.1.0 → 0.1.1 (bug fixes)
   - **minor**: 0.1.0 → 0.2.0 (new features)
   - **major**: 0.1.0 → 1.0.0 (breaking changes)
5. Choose whether to create a release immediately
6. Click "Run workflow"

### 2. Release Workflow (`release.yml`)

**Trigger**: Automatically when a tag matching `v*` is pushed

**Features**:

- Extracts version from the tag
- Updates `manifest.json` with the correct version
- Creates a GitHub release with changelog
- Publishes the release

## Manual Release Process

If you prefer to create releases manually:

### 1. Update Version

```bash
# Update version in manifest.json manually
# Then commit the change
git add custom_components/scene_extrapolation/manifest.json
git commit -m "Bump version to X.Y.Z"
```

### 2. Create and Push Tag

```bash
git tag -a vX.Y.Z -m "Release version X.Y.Z"
git push origin vX.Y.Z
```

### 3. GitHub Release

The release workflow will automatically create a GitHub release with the changelog.

## Version Numbering

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backward compatible
- **PATCH** (0.0.1): Bug fixes, backward compatible

## Changelog Management

The `CHANGELOG.md` file is automatically updated during the version bump process. You should manually edit the changelog entries to provide meaningful descriptions of changes.

## HACS Integration

This component is designed for HACS (Home Assistant Community Store). The release process ensures:

- Proper versioning in `manifest.json`
- Updated changelog for users
- GitHub releases for distribution
- HACS compatibility

## Workflow Files

- `.github/workflows/release.yml` - Automated release creation
- `.github/workflows/version-bump.yml` - Version bumping and changelog updates
- `CHANGELOG.md` - Release notes and change history
- `hacs.json` - HACS configuration
- `custom_components/scene_extrapolation/manifest.json` - Component manifest with version
