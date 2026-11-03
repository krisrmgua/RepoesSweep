#!/bin/bash
# Builds Repoes Sweep.app, installs it to ~/Applications, and starts it at login (LaunchAgent).
set -euo pipefail
cd "$(dirname "$0")"

LABEL="com.kris.repos"
APP_DEST="$HOME/Applications/Repoes Sweep.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

./make-app.sh
pkill -x Repos 2>/dev/null || true
pkill -x RepoesSweep 2>/dev/null || true
rm -rf "$HOME/Applications/Repos.app"
rm -rf "$APP_DEST"
cp -R "Repoes Sweep.app" "$APP_DEST"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$APP_DEST/Contents/MacOS/RepoesSweep</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
PLIST

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $APP_DEST and enabled login start ($PLIST)"
