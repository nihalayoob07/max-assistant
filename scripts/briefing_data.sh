#!/usr/bin/env bash
# Gathers raw data for the morning-briefing cron job; stdout is injected into the agent prompt.
# BRIEFING_CITY (in ~/.hermes/workspace/max.env, from CITY in max.config) sets the weather location; the sandbox proxy blocks wttr.in's bare "/" geolocation.
N=~/.hermes/workspace/notes
. ~/.hermes/workspace/max.env 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}   # owner settings (bin/fixup); the sandbox clock is UTC
city=$(printf '%s' "${BRIEFING_CITY:-}" | sed 's/ /+/g')

echo "DATE: $(date '+%a %d %b %Y')"
if [ -z "$city" ]; then echo "WEATHER: no city set (set CITY in max.config, then run bin/fixup)"
else echo "WEATHER: $(curl -fsS --max-time 15 -G "https://wttr.in/${city}" --data-urlencode 'format=%l: %C, %t (feels %f), rain %p, wind %w' 2>&1 || echo unavailable)"; fi
echo "TODAY'S SCHEDULE:"; ~/.hermes/scripts/cal.sh today 2>/dev/null | tail -n +2 | cut -f3-5 | grep . || echo "(nothing scheduled)"
echo "OPEN TODOS:"; grep -F -- '- [ ]' "$N/todos.md" 2>/dev/null || echo "(none)"
y=$(date -d yesterday +%F)
echo "CAPTURED YESTERDAY ($y):"; grep -h -F -- "$y" "$N/notes.md" "$N/ideas.md" 2>/dev/null || echo "(none)"
echo "FOLLOW-UPS DUE:"; ~/.hermes/scripts/lead.sh due 2>/dev/null | tail -n +2 | cut -f1,4,5,7,10 | grep . || echo "(none)"
