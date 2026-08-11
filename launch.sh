#!/bin/bash
# Launches Media Visualizer using the production build (dist/), no dev
# server needed. Used by the desktop entry / app icon.
cd "$(dirname "$0")"
exec env NODE_ENV=production "./node_modules/.bin/electron" . --no-sandbox
