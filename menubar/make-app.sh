#!/bin/bash
# Assembles Repoes Sweep.app from the SwiftPM release build (git repos menu bar tool).
set -euo pipefail
cd "$(dirname "$0")"

APP="Repoes Sweep.app"
BUNDLE_ID="com.kris.repos"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/RepoesSweep"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/RepoesSweep"
cp Resources/*.png "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Repoes Sweep</string>
  <key>CFBundleDisplayName</key><string>Repoes Sweep</string>
  <key>CFBundleExecutable</key><string>RepoesSweep</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>Kristopher Simmons</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - --identifier "$BUNDLE_ID" "$APP" >/dev/null 2>&1 || true
echo "Built $PWD/$APP"
