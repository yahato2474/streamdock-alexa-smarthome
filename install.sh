#!/bin/zsh
# Installs the Alexa Smart Home plugin into Stream Dock (macOS).
#   ./install.sh            copy the plugin into Stream Dock's plugin folder
#   ./install.sh --link     symlink instead (for development)
set -euo pipefail

UUID="io.github.yahato2474.alexa"
SRC="${0:A:h}/${UUID}.sdPlugin"
PLUGINS_DIR="${STREAMDOCK_PLUGINS_DIR:-$HOME/Library/Application Support/HotSpot/StreamDock/plugins}"
DEST="$PLUGINS_DIR/${UUID}.sdPlugin"
MODE="copy"
[[ "${1:-}" == "--link" ]] && MODE="link"

say() { print -P "%F{cyan}==>%f $*"; }
warn() { print -P "%F{yellow}warning:%f $*"; }
die() { print -P "%F{red}error:%f $*"; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "macOS only."
[[ -d "$PLUGINS_DIR" ]] || die "Stream Dock plugin folder not found: $PLUGINS_DIR
   Install and start the Stream Dock app once (or set STREAMDOCK_PLUGINS_DIR)."
command -v npm >/dev/null || die "npm not found. Install Node.js 18+ first:  brew install node"

say "Installing dependencies"
(cd "$SRC" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

if command -v swiftc >/dev/null; then
  say "Building microphone helper (bin/micmute)"
  mkdir -p "$SRC/bin"
  swiftc -O "$SRC/tools/micmute.swift" -o "$SRC/bin/micmute"
else
  warn "swiftc not found: microphone mute on the knob will be unavailable (xcode-select --install to enable)."
fi
chmod +x "$SRC/tools/login.command"

say "Installing into $DEST"
if [[ -L "$DEST" || -d "$DEST" ]]; then rm -rf "$DEST"; fi
if [[ "$MODE" == "link" ]]; then
  ln -s "$SRC" "$DEST"
else
  rsync -a --exclude test --exclude log "$SRC/" "$DEST/"
fi
# Files from a downloaded zip carry the quarantine flag, which blocks the helper binary.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

APP=""
for name in "Stream Dock AJAZZ" "Stream Dock" "StreamDock"; do
  if pgrep -x "$name" >/dev/null; then APP="$name"; break; fi
done
ASK=0; [[ -t 0 ]] && ASK=1
if [[ -n "$APP" && $ASK == 1 ]]; then
  read -q "?Restart $APP now to load the plugin? [y/N] " && {
    echo; pkill -TERM -x "$APP"; sleep 3; open -a "$APP"; } || echo
elif [[ -n "$APP" ]]; then
  say "Restart $APP to load the plugin."
else
  say "Start the Stream Dock app to load the plugin."
fi

if [[ ! -f "$HOME/.config/streamdock-alexa/alexa.json" && $ASK == 1 ]]; then
  read -q "?Log in to Amazon now? [y/N] " && { echo; "$DEST/tools/login.command"; } || {
    echo; say "Later: double-click \"$DEST/tools/login.command\" (or press any Alexa key)."; }
elif [[ ! -f "$HOME/.config/streamdock-alexa/alexa.json" ]]; then
  say "Next: double-click \"$DEST/tools/login.command\" to log in to Amazon."
fi
say "Done. Find the actions under \"Alexa Smart Home\" in Stream Dock."
