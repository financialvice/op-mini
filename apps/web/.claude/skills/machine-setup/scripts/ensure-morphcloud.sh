#!/usr/bin/env bash
# Ensures morphcloud CLI is installed and outputs CLI map
set -e

# Check if morphcloud is available
if ! command -v morphcloud &>/dev/null && ! type morph &>/dev/null; then
  echo "Installing morphcloud via uv..."
  uv tool install morphcloud
fi

# Determine the command to use
CMD="morphcloud"
if type morph &>/dev/null 2>&1; then
  CMD="morph"
fi

echo "=== MorphCloud CLI Map ==="
echo ""

echo "## Root Commands"
$CMD --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "## instance - Manage Morph instances"
$CMD instance --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "## snapshot - Manage Morph snapshots"
$CMD snapshot --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "## image - Manage Morph base images"
$CMD image --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "## user - Manage user settings"
$CMD user --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "=== Key Commands Detail ==="
echo ""

echo "### instance start"
$CMD instance start --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "### instance ssh"
$CMD instance ssh --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "### instance exec"
$CMD instance exec --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "### instance copy"
$CMD instance copy --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "### instance expose-http"
$CMD instance expose-http --help 2>&1 | grep -v "Warning:" || true
echo ""

echo "### snapshot create"
$CMD snapshot create --help 2>&1 | grep -v "Warning:" || true
