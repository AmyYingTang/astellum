#!/usr/bin/env bash
#
# One command to get back to a screenshot session: the four surfaces plus a
# Chrome you can click around in and grab high-resolution frames from with
# scripts/shot.mjs. Both are skipped if they are already up, so re-running
# this after a crash or a restart is safe.
#
#   scripts/poster-shots.sh
#   node scripts/shot.mjs out/poster-shots/studio.png
#
# ATLAS_PASSWORD is deliberately blanked: .env sets it to put the atlas behind
# HTTP Basic before exposing it over a tunnel, which only gets in the way of a
# local screenshot run. .env itself is untouched — this is for this run only.
#
# The Chrome here is a throwaway profile under out/, not your everyday browser,
# so it carries none of your sign-ins and loses nothing when you delete it.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHOTS="$ROOT/out/poster-shots"
PORT="${CHROME_DEBUG_PORT:-9222}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

mkdir -p "$SHOTS"

up() { curl -fsS -o /dev/null -m 2 "http://127.0.0.1:$1/" 2>/dev/null; }
debug_up() { curl -fsS -o /dev/null -m 2 "http://127.0.0.1:$PORT/json/version" 2>/dev/null; }

if up 3000; then
  echo "==> hub already running"
else
  if [ ! -f "$ROOT/packages/cli/dist/index.js" ]; then
    echo "==> no build yet; running pnpm build"
    pnpm build
  fi
  echo "==> starting hub (log: out/poster-shots/hub.log)"
  ATLAS_PASSWORD= nohup node packages/cli/dist/index.js hub \
    --atlas-data-dir "$ROOT/packages/atlas/data" --no-open \
    >"$SHOTS/hub.log" 2>&1 &
  for _ in $(seq 1 40); do
    up 3000 && break
    sleep 0.5
  done
  up 3000 || { echo "hub did not come up; see $SHOTS/hub.log" >&2; exit 1; }
fi

if debug_up; then
  echo "==> debug Chrome already running on :$PORT"
else
  if [ ! -x "$CHROME" ]; then
    echo "Chrome not found at: $CHROME (set \$CHROME to override)" >&2
    exit 1
  fi
  echo "==> starting debug Chrome on :$PORT"
  nohup "$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$SHOTS/chrome-profile" \
    --window-size=1440,900 \
    --no-first-run --no-default-browser-check \
    "http://localhost:3010/" \
    >"$SHOTS/chrome.log" 2>&1 &
  # Setting up a fresh profile makes Chrome answer on the port, drop it and
  # come back, so one successful probe is not enough — wait for two in a row.
  streak=0
  for _ in $(seq 1 60); do
    if debug_up; then
      streak=$((streak + 1))
      [ "$streak" -ge 2 ] && break
    else
      streak=0
    fi
    sleep 0.5
  done
  [ "$streak" -ge 2 ] || {
    echo "debug Chrome did not answer on :$PORT; see $SHOTS/chrome.log" >&2
    exit 1
  }
fi

echo
echo "hub 3000 · studio 3010 · atlas 3100 · kiosk 3200 · debug Chrome :$PORT"
echo "Click to the frame you want, then:"
echo "  node scripts/shot.mjs out/poster-shots/<name>.png [scale]"
