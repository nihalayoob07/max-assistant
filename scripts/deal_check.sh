#!/usr/bin/env bash
# The deal gate: is this offer inside the owner's policy? Prints "OK ..." (exit 0), "LOW: ... (gap N%)" (exit 3, price under the floor)
# or "ESCALATE: reason" (exit 2, anything else).
# Usage: deal_check.sh <business> <product> <qty> <unit_price> [delivery YYYY-MM-DD]
# Policy: ~/.hermes/workspace/business/<business>/policy.tsv, written by the owner only (synced by bin/fixup).
set -u
. ~/.hermes/workspace/max.env 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}   # owner settings (bin/fixup); the sandbox clock is UTC
CUR=${CURRENCY:-₹}
B=~/.hermes/workspace/business
biz=${1:-} product=${2:-} qty=${3:-} price=${4:-} due=${5:-}
esc() { echo "ESCALATE: $*"; exit 2; }

[[ $biz =~ ^[a-z0-9-]+$ ]] && [ -n "$product" ] || esc "usage: deal_check.sh <business> <product> <qty> <unit_price> [YYYY-MM-DD]"
[[ $qty =~ ^[0-9]+$ ]] && [ "$qty" -gt 0 ] || esc "quantity '$qty' is not a whole number"
[[ $price =~ ^[0-9]+(\.[0-9]+)?$ ]] || esc "price '$price' is not a number"
pol="$B/$biz/policy.tsv"
[ -f "$pol" ] || esc "no policy for business '$biz'"

# policy.tsv columns: product, unit, list_price, floor_price, min_qty, min_lead_days[, target_price] (# lines are comments)
# floor_price is the hard limit; target_price (optional) is where the owner would rather stay.
row=$(awk -F'\t' -v p="$product" '!/^#/ && tolower($1) == tolower(p) { print; exit }' "$pol")
[ -n "$row" ] || esc "product '$product' is not in $biz's policy"
IFS=$'\t' read -r _ unit list floor min_qty lead target <<< "$row"

if ! awk -v a="$price" -v b="$floor" 'BEGIN { exit !(a + 0 >= b + 0) }'; then
  # Exit 3 = price too low (vs 2 = anything else); the gap lets lead.sh tell a sensible offer from a lowball.
  echo "LOW: $CUR$price/$unit is below the floor for $product (gap $(awk -v a="$price" -v b="$floor" 'BEGIN { printf "%.0f", (b - a) * 100 / b }')%)"; exit 3
fi
[ "$qty" -ge "${min_qty:-1}" ] || esc "$qty $unit is under the minimum order of $min_qty"
if [ -n "$due" ]; then
  due_s=$(date -d "$due" +%s 2>/dev/null) || esc "delivery date '$due' is not a date"
  today_s=$(date -d "$(date +%F)" +%s)
  days=$(( (due_s - today_s) / 86400 ))
  [ "$days" -ge "${lead:-0}" ] || esc "delivery in $days days is under the $lead-day minimum lead time"
fi
total=$(awk -v a="$price" -v q="$qty" 'BEGIN { printf "%.2f", a * q }')
note=""
if [ -n "${target:-}" ] && awk -v a="$price" -v t="$target" 'BEGIN { exit !(a + 0 < t + 0) }'; then
  note=" — NOTE: below the $CUR$target target; only if the client would otherwise walk away"
fi
echo "OK $biz: $qty $unit $product at $CUR$price (list $CUR$list) = $CUR$total$note"
