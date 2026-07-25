#!/bin/sh
set -e
HOST="${JOBKIT_CLEARANCE_HOST:-www.seriousteachers.com}"
KASM="$HOME/.agents/skills/agent-browser/kasm"
SLOT=$("$KASM" pool acquire jobkit-clearance "refresh $HOST" 2>/dev/null | grep -oE 'slot=[0-9]+' | cut -d= -f2)
[ -n "$SLOT" ] || exit 1
"$KASM" pool browser "$SLOT" open "https://$HOST/" >/dev/null 2>&1 || true
"$KASM" pool browser "$SLOT" cookies get 2>/dev/null | grep -oE 'cf_clearance=[^ ]+' | head -1
"$KASM" pool release "$SLOT" >/dev/null 2>&1 || true
