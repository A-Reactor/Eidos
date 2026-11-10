#!/bin/bash
# Eidos Engine — Dev Server
set -e
cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║           E i d o s              ║"
echo "  ║     AI-Driven World Engine       ║"
echo "  ╚══════════════════════════════════╝"
echo ""

if [ ! -d node_modules ]; then
  echo "  [setup] Installing dependencies..."
  npm ci
  echo ""
fi

echo "  [start] http://localhost:3000"
echo ""
npm run dev
