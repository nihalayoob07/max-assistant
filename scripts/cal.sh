#!/usr/bin/env bash
# The owner's calendar. Plain TSV in the workspace; dates in the owner's time zone (max.env).
#   cal.sh add <date> <HH:MM|allday> [until HH:MM] <title...>   date: YYYY-MM-DD or anything `date -d` understands
#                                                                ("tomorrow", "thursday", "next monday")
#   cal.sh list [from] [days]     events from <from> (default today) for <days> (default 14), sorted
#   cal.sh today                  today's events
#   cal.sh rm <id>                delete an event
set -euo pipefail
. ~/.hermes/workspace/max.env 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}   # owner settings (bin/fixup); the sandbox clock is UTC
C=~/.hermes/workspace/calendar.tsv
[ -s "$C" ] || printf 'id\tdate\tstart\tend\ttitle\n' > "$C"
ist() { date -d "$1" +%F 2>/dev/null; }
clean() { printf '%s' "$*" | tr '\t\r\n' '   '; }

cmd=${1:-list}; shift || true
case $cmd in
  add)
    [ $# -ge 3 ] || { echo 'usage: cal.sh add <date> <HH:MM|allday> [until HH:MM] <title...>' >&2; exit 1; }
    d=$(ist "$1") || true
    [ -n "$d" ] || { echo "not a date: '$1'" >&2; exit 1; }
    t=$2; shift 2
    [[ $t =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ || $t == allday ]] || { echo "time must be HH:MM or allday, got '$t'" >&2; exit 1; }
    [[ $t == allday ]] || t=$(printf '%05s' "$t" | tr ' ' 0)
    end=''
    if [ "${1:-}" = until ]; then
      end=$2; shift 2
      [[ $end =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "end time must be HH:MM" >&2; exit 1; }
      end=$(printf '%05s' "$end" | tr ' ' 0)
    fi
    [ $# -gt 0 ] || { echo 'missing title' >&2; exit 1; }
    id=$(printf 'E%04d' "$(( $(awk -F'\t' 'NR > 1 { n = substr($1, 2) + 0; if (n > m) m = n } END { print m + 0 }' "$C") + 1 ))")
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$d" "$t" "$end" "$(clean "$*")" >> "$C"
    echo "$id $d $t${end:+-$end} $(clean "$*")" ;;
  list)
    from=$(ist "${1:-today}"); days=${2:-14}
    to=$(date -d "$from + $days days" +%F)
    { head -1 "$C"; awk -F'\t' -v f="$from" -v t="$to" 'NR > 1 && $2 >= f && $2 < t' "$C" | sort -t$'\t' -k2,2 -k3,3; } ;;
  today) "$0" list today 1 ;;
  rm)
    [[ ${1:-} =~ ^E[0-9]{4}$ ]] || { echo 'usage: cal.sh rm <id>' >&2; exit 1; }
    awk -F'\t' -v id="$1" '$1 == id { f = 1 } END { exit !f }' "$C" || { echo "no event $1" >&2; exit 1; }
    awk -F'\t' -v id="$1" '$1 != id' "$C" > "$C.tmp" && mv "$C.tmp" "$C"; echo "removed $1" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
