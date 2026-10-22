#!/bin/zsh
# Double-click to log in to Alexa (also opened by the plugin when the login has expired).
cd "${0:A:h}/.." || exit 1
NODE=""
for candidate in "/Applications/Stream Dock AJAZZ.app/Contents/Helpers/node20" \
                 "/Applications/Stream Dock.app/Contents/Helpers/node20" \
                 "/Applications/StreamDock.app/Contents/Helpers/node20"; do
  [[ -x "$candidate" ]] && NODE="$candidate" && break
done
[[ -z "$NODE" ]] && NODE="$(command -v node)"
if [[ -z "$NODE" ]]; then
  echo "Node.js not found. Install Stream Dock or Node.js (brew install node)."
  read -k1 "?Press any key to close..."
  exit 1
fi
"$NODE" tools/login.js "$@"
