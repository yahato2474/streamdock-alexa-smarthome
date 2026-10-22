#!/bin/zsh
# Removes the plugin from Stream Dock. Pass --purge to also delete the saved Alexa login.
set -euo pipefail
UUID="io.github.yahato2474.alexa"
PLUGINS_DIR="${STREAMDOCK_PLUGINS_DIR:-$HOME/Library/Application Support/HotSpot/StreamDock/plugins}"
DEST="$PLUGINS_DIR/${UUID}.sdPlugin"

if [[ -L "$DEST" || -d "$DEST" ]]; then
  rm -rf "$DEST"
  echo "Removed $DEST (restart Stream Dock to unload it)."
else
  echo "Not installed: $DEST"
fi
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$HOME/.config/streamdock-alexa"
  echo "Removed saved Alexa login (~/.config/streamdock-alexa)."
fi
