#!/usr/bin/env bash
# Builds the Electron app, installs it to ~/Applications/Repoes Sweep.app, and launches it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Repoes Sweep.app"
APP_DEST="$HOME/Applications/$APP_NAME"
LABEL="com.kris.repos"

if ! command -v npm >/dev/null; then
  echo "npm is required (Node.js 20 or newer)" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required (found $(node -v))" >&2
  exit 1
fi
if ! command -v git >/dev/null; then
  echo "warning: git is not on PATH; the app needs it to scan clones" >&2
fi

npm install
npm run pack:mac

APP_SRC="$(find "$ROOT/release" -maxdepth 3 -name "$APP_NAME" -type d 2>/dev/null | head -1 || true)"
if [[ -z "${APP_SRC}" ]]; then
  echo "$APP_NAME not found under release/" >&2
  exit 1
fi

# Stop the Swift build and any earlier Electron build.
pkill -x RepoesSweep 2>/dev/null || true
pkill -x Repos 2>/dev/null || true
pkill -f "$APP_NAME/Contents/MacOS/Repoes Sweep" 2>/dev/null || true

# The Swift installer started the app with a LaunchAgent. The Electron app
# registers itself as a login item instead (Preferences > Open at login).
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ -f "$PLIST" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed the Swift LaunchAgent ($PLIST)"
fi

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Repos.app"
rm -rf "$APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"
codesign --force --deep --sign - "$APP_DEST" >/dev/null 2>&1 || true

mkdir -p "$HOME/bin"
cat >"$HOME/bin/repoes-sweep" <<'EOF'
#!/usr/bin/env bash
APP="$HOME/Applications/Repoes Sweep.app"
BIN="Repoes Sweep.app/Contents/MacOS/Repoes Sweep"
case "${1:-}" in
  start) open -a "$APP" ;;
  stop) pkill -f "$BIN" 2>/dev/null || true ;;
  status)
    if pgrep -f "$BIN" >/dev/null; then
      echo "running"
    else
      echo "stopped"
    fi
    ;;
  *)
    echo "usage: repoes-sweep {start|stop|status}"
    exit 1
    ;;
esac
EOF
chmod +x "$HOME/bin/repoes-sweep"

open -a "$APP_DEST"
echo "Installed $APP_DEST"
echo "CLI: repoes-sweep start|stop|status (ensure ~/bin is on PATH)"
