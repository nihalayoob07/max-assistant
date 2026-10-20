#!/usr/bin/env bash
# Self-check for the calendar script. Runs in a throwaway HOME: bash tests/cal_test.sh
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
export HOME=$(mktemp -d); trap 'rm -rf "$HOME"' EXIT
mkdir -p "$HOME/.hermes/workspace"; printf "MAX_TZ='Pacific/Kiritimati'\nCURRENCY='\$'\n" > "$HOME/.hermes/workspace/max.env"
export TZ=Pacific/Kiritimati   # UTC+14: a hard-coded zone or UTC date shows up as a wrong day
mkdir -p "$HOME/.hermes/workspace"
C="$here/scripts/cal.sh"
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails + 1)); fi; }
tomorrow=$(date -d tomorrow +%F)

check "add with relative date" "$(bash "$C" add tomorrow 9:30 Dentist | cut -d' ' -f1-3)" "E0001 $tomorrow 09:30"
bash "$C" add tomorrow 08:00 until 09:00 "Call with bakery" >/dev/null
bash "$C" add today allday "Hackathon prep" >/dev/null
check "ids count up"           "$(bash "$C" add "+20 days" 10:00 Later | cut -d' ' -f1)" E0004
check "list sorted by time"    "$(bash "$C" list tomorrow 1 | tail -n +2 | cut -f5 | tr '\n' '|')" "Call with bakery|Dentist|"
check "end time kept"          "$(bash "$C" list tomorrow 1 | grep bakery | cut -f4)" 09:00
check "today"                  "$(bash "$C" today | tail -n +2 | cut -f5)" "Hackathon prep"
check "14-day window"          "$(bash "$C" list | tail -n +2 | wc -l | tr -d ' ')" 3
check "bad time refused"       "$(bash "$C" add tomorrow 25:00 X 2>&1 | grep -c 'HH:MM')" 1
check "bad date refused"       "$(bash "$C" add notadate 10:00 X 2>&1 | grep -c 'not a date')" 1
check "tab in title kept on one row" "$(bash "$C" add tomorrow 11:00 "a	b" >/dev/null; bash "$C" list tomorrow 1 | grep -c 'a b')" 1
bash "$C" rm E0001 >/dev/null
check "remove"                 "$(bash "$C" list tomorrow 1 | grep -c Dentist)" 0
check "remove unknown"         "$(bash "$C" rm E0099 2>&1 | grep -c 'no event')" 1

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
