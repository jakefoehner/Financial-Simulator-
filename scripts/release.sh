#!/bin/bash
# Builds a signed, notarized, stapled universal DMG ready to share.
#
# One-time setup (see README "Releasing"):
#   - A "Developer ID Application" certificate in your keychain
#   - Notary credentials saved as a keychain profile:
#       xcrun notarytool store-credentials fsim-notary --apple-id <you> --team-id <TEAMID>
#
# Usage:
#   npm run release                 full build + notarize app + DMG
#   npm run release -- --dmg-only   reuse an already-notarized app; redo only the DMG
# Override the notary profile with NOTARY_PROFILE=name.
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
PROFILE="${NOTARY_PROFILE:-fsim-notary}"
DMG_ONLY=false
[ "${1:-}" = "--dmg-only" ] && DMG_ONLY=true

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------
step "Checking signing setup"
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
[ -n "$IDENTITY" ] || fail "No valid 'Developer ID Application' certificate found. Run: security find-identity -v -p codesigning"
echo "Signing as: $IDENTITY"
xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1 ||
  fail "Notary profile '$PROFILE' not found. Run: xcrun notarytool store-credentials $PROFILE --apple-id <you> --team-id <TEAMID>"

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
APP_NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
OUT="target/release-artifacts"
APP="target/universal-apple-darwin/release/bundle/macos/$APP_NAME.app"
DMG="$OUT/$APP_NAME $VERSION.dmg"

echo "Heads up: macOS may ask to let codesign use your signing key."
echo "Enter your Mac password and click \"Always Allow\" so the build isn't left waiting."

# Submits a file for notarization and waits. Prints Apple's log on rejection.
notarize() {
  local file="$1" result status id
  result=$(xcrun notarytool submit "$file" --keychain-profile "$PROFILE" --wait --output-format json)
  status=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.status)' "$result")
  id=$(node -e 'const j=JSON.parse(process.argv[1]); console.log(j.id)' "$result")
  echo "Notarization $id: $status"
  if [ "$status" != "Accepted" ]; then
    xcrun notarytool log "$id" --keychain-profile "$PROFILE" || true
    fail "Apple rejected $file"
  fi
}

# codesign with a clear explanation when the keychain refuses access.
sign() {
  local out
  if ! out=$(codesign "$@" 2>&1); then
    echo "$out" >&2
    if grep -q errSecInternalComponent <<<"$out"; then
      fail "codesign couldn't use your signing key (the keychain prompt was declined, allowed only once, or timed out).
Re-run and click \"Always Allow\" when asked:  npm run release -- --dmg-only"
    fi
    fail "codesign failed"
  fi
}

if $DMG_ONLY; then
  # --- Reuse the notarized app ------------------------------------------------
  step "Reusing the already-notarized app"
  [ -d "$APP" ] || fail "No app at $APP. Run a full release: npm run release"
  APP_VERSION=$(defaults read "$PWD/$APP/Contents/Info.plist" CFBundleShortVersionString)
  [ "$APP_VERSION" = "$VERSION" ] || fail "Built app is $APP_VERSION but config says $VERSION. Run a full release: npm run release"
  xcrun stapler validate "$APP" >/dev/null || fail "The app isn't notarized and stapled. Run a full release: npm run release"
  echo "$APP_NAME $APP_VERSION is notarized and stapled."
  mkdir -p "$OUT"
else
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

  # --- Build & sign the app -------------------------------------------------
  step "Building $APP_NAME $VERSION (universal) and signing with hardened runtime"
  APPLE_SIGNING_IDENTITY="$IDENTITY" npx tauri build --target universal-apple-darwin --bundles app
  codesign --verify --deep --strict "$APP"

  # --- Notarize & staple the app --------------------------------------------
  rm -rf "$OUT" && mkdir -p "$OUT"
  step "Notarizing the app (usually 1-5 minutes; the first ever submission can take much longer)"
  ditto -c -k --keepParent "$APP" "$OUT/app.zip"
  notarize "$OUT/app.zip"
  xcrun stapler staple "$APP"
  rm "$OUT/app.zip"
fi

# --- Package, sign, notarize & staple the DMG --------------------------------
step "Creating the DMG"
STAGE="$OUT/dmg-stage"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null 2>&1
rm -rf "$STAGE"
sign --sign "$IDENTITY" --timestamp "$DMG"

step "Notarizing the DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"

# --- Verify what Gatekeeper will see ----------------------------------------
step "Verifying"
spctl --assess --type execute --verbose=2 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
xcrun stapler validate "$DMG"

cp "$DMG" "$HOME/Desktop/"
step "Done: ~/Desktop/$(basename "$DMG")"
