#!/usr/bin/env bash
# Data for the weekly business report (cron injects stdout into the prompt). Last 7 days, per business.
L=~/.hermes/workspace/business/leads.tsv
. ~/.hermes/workspace/max.env 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}   # owner settings (bin/fixup); the sandbox clock is UTC
[ -s "$L" ] || { echo "NO LEADS YET"; exit 0; }
since=$(date -d '7 days ago' +%F)
quiet=$(date -d '3 days ago' +%F)
echo "WEEK: $since to $(date +%F) (local time)"
awk -F'\t' -v cur="${CURRENCY:-₹}" -v s="$since" -v q="$quiet" '
  NR == 1 { next }
  { b = $4; biz[b] = 1 }
  $2 >= s { new[b]++ }
  $3 >= s && ($7 == "agreed" || $7 == "paid") { won[b]++; val[b] += $8 }
  $3 >= s && $7 == "lost" { lost[b]++ }
  $3 >= s && $7 == "junk" { junk[b]++ }
  $7 == "escalated" { esc[b]++ }
  ($7 == "new" || $7 == "talking") && $3 < q { quietl = quietl sprintf("  %s %s (%s): %s, last touched %s\n", $1, $5, b, $10, $3) }
  END {
    for (b in biz) printf "%s: %d new, %d deals (%s%.2f), %d lost, %d junk, %d waiting on owner\n", b, new[b], won[b], cur, val[b], lost[b], junk[b], esc[b]
    printf "WENT QUIET (no update in 3+ days):\n%s", (quietl == "" ? "  (none)\n" : quietl)
  }' "$L"
