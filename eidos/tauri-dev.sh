#!/bin/bash
# Eidos Engine — Tauri Desktop (dev mode)
set -e
cd "$(dirname "$0")"

echo ""
echo "  Eidos Engine — Tauri Desktop"
echo ""

if ! command -v cargo &>/dev/null; then
  source "$HOME/.cargo/env" 2>/dev/null || true
fi

echo "  [launch] Starting Tauri dev mode..."
echo "  First build may take a few minutes."
echo ""

cargo tauri dev
