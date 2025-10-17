#!/bin/bash

# Script to bump version locally
# Usage: ./scripts/bump-version.sh [patch|minor|major]

set -e

VERSION_TYPE=${1:-patch}
MANIFEST_FILE="custom_components/scene_extrapolation/manifest.json"

if [ ! -f "$MANIFEST_FILE" ]; then
    echo "Error: manifest.json not found"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(jq -r '.version' "$MANIFEST_FILE")
echo "Current version: $CURRENT_VERSION"

# Split version into parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate new version
case $VERSION_TYPE in
    major)
        NEW_VERSION="$((MAJOR + 1)).0.0"
        ;;
    minor)
        NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
        ;;
    patch)
        NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        ;;
    *)
        echo "Error: Invalid version type. Use patch, minor, or major"
        exit 1
        ;;
esac

echo "New version: $NEW_VERSION"

# Update manifest.json
jq --arg version "$NEW_VERSION" '.version = $version' "$MANIFEST_FILE" > temp.json
mv temp.json "$MANIFEST_FILE"

echo "Updated $MANIFEST_FILE to version $NEW_VERSION"

# Update CHANGELOG.md
if [ -f "CHANGELOG.md" ]; then
    TEMP_CHANGELOG=$(mktemp)
    echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)" >> "$TEMP_CHANGELOG"
    echo "" >> "$TEMP_CHANGELOG"
    echo "### Added" >> "$TEMP_CHANGELOG"
    echo "- " >> "$TEMP_CHANGELOG"
    echo "" >> "$TEMP_CHANGELOG"
    echo "### Changed" >> "$TEMP_CHANGELOG"
    echo "- " >> "$TEMP_CHANGELOG"
    echo "" >> "$TEMP_CHANGELOG"
    echo "### Fixed" >> "$TEMP_CHANGELOG"
    echo "- " >> "$TEMP_CHANGELOG"
    echo "" >> "$TEMP_CHANGELOG"

    # Prepend to existing CHANGELOG
    cat CHANGELOG.md >> "$TEMP_CHANGELOG"
    mv "$TEMP_CHANGELOG" CHANGELOG.md

    echo "Updated CHANGELOG.md with version $NEW_VERSION"
fi

echo "Version bump completed. Don't forget to:"
echo "1. Edit CHANGELOG.md to add meaningful change descriptions"
echo "2. Commit your changes: git add . && git commit -m 'Bump version to $NEW_VERSION'"
echo "3. Create and push tag: git tag -a v$NEW_VERSION -m 'Release version $NEW_VERSION' && git push origin v$NEW_VERSION"
