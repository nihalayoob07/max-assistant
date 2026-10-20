#!/usr/bin/env bash
# Self-check for the deal gate and leads store. Runs in a throwaway HOME: bash tests/business_test.sh
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
export HOME=$(mktemp -d); trap 'rm -rf "$HOME"' EXIT
mkdir -p "$HOME/.hermes/workspace"; printf "MAX_TZ='Pacific/Kiritimati'\nCURRENCY='\$'\n" > "$HOME/.hermes/workspace/max.env"
export TZ=Pacific/Kiritimati   # UTC+14: a hard-coded zone or UTC date shows up as a wrong day
S=$HOME/.hermes/scripts; mkdir -p "$S" "$HOME/.hermes/workspace/business"
cp "$here"/scripts/*.sh "$S"; chmod +x "$S"/*.sh
cp -r "$here/business-template/example-shop" "$HOME/.hermes/workspace/business/"
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails + 1)); fi; }
dc() { "$S/deal_check.sh" "$@" >/dev/null; echo $?; }
in6=$(date -d '+6 days' +%F); in1=$(date -d '+1 days' +%F)

check "at floor passes"         "$(dc example-shop keychain 20 140 "$in6")" 0
check "below floor is LOW (3)"   "$(dc example-shop keychain 20 139.99)" 3
check "short lead escalates"    "$(dc example-shop keychain 20 150 "$in1")" 2
check "unknown product"         "$(dc example-shop mug 1 100)" 2
check "bad quantity"            "$(dc example-shop keychain x 150)" 2
printf 'site\tsite\t1000\t800\t1\t0\t900\n' >> "$HOME/.hermes/workspace/business/example-shop/policy.tsv"
check "above target, no note"   "$("$S/deal_check.sh" example-shop site 1 950 | grep -c NOTE)" 0
check "below target warns"      "$("$S/deal_check.sh" example-shop site 1 850 | grep -c NOTE)" 1
check "path in business name"   "$(dc ../etc keychain 1 200)" 2

id=$("$S/lead.sh" add example-shop ravi@x.in email "20 keychains	tab and
newline")
check "lead id"                 "$id" L0001
check "need stays on one row"   "$(wc -l < "$HOME/.hermes/workspace/business/leads.tsv" | tr -d ' ')" 2
"$S/lead.sh" agree "$id" keychain 20 120 >/dev/null
check "agree below floor"       "$("$S/lead.sh" list escalated | tail -n +2 | cut -f1)" L0001
"$S/lead.sh" agree "$id" keychain 20 150 >/dev/null
check "agree inside policy"     "$("$S/lead.sh" list agreed | tail -n +2 | cut -f8)" 3000.00

out=$("$S/lead.sh" open "+910000011111" whatsapp "wants a site")
check "open creates lead"       "$(printf '%s\n' "$out" | grep -c '^L0002	')" 1
check "open shows profiles"     "$(printf '%s\n' "$out" | grep -c '=== business: example-shop')" 1
check "open finds same lead"    "$("$S/lead.sh" open "+910000011111" whatsapp "again" | grep -c 'EXISTING LEAD')" 1
"$S/lead.sh" update L0002 biz example-shop status talking next +2d note "client's budget, likes blue" >/dev/null
check "update business"         "$("$S/lead.sh" list example-shop | grep -c '^L0002')" 1
check "update next +2d"         "$("$S/lead.sh" list talking | tail -n 1 | cut -f9)" "$(date -d '+2 days' +%F)"
check "update note"             "$(grep -c 'likes blue' "$HOME/.hermes/workspace/business/clients/+910000011111.md")" 1
check "update bad business"     "$("$S/lead.sh" update L0002 biz ../x 2>&1 | grep -c "no business")" 1
check "update offer below floor" "$("$S/lead.sh" update L0002 offer keychain 10 100 | grep -c "offer: LOW")" 1
check "status agreed refused"   "$("$S/lead.sh" update L0002 status agreed 2>&1 | grep -c refused)" 1
check "set agreed refused"      "$("$S/lead.sh" set L0002 status agreed 2>&1 | grep -c 'use update')" 1
check "paid needs agreed"       "$("$S/lead.sh" update L0002 status paid 2>&1 | grep -c 'needs an agreed')" 1
check "multi-word product"      "$("$S/lead.sh" update L0002 offer desk organiser 1 750 | grep -c '^offer: OK')" 1
"$S/lead.sh" update L0002 agree keychain 10 150 >/dev/null
check "update agree"            "$("$S/lead.sh" list agreed | grep '^L0002' | cut -f8)" 1500.00
id3=$("$S/lead.sh" add example-shop x@y.in email test)
"$S/lead.sh" update "$id3" status agreed agree keychain 5 100 next today note "tried to sneak" >/dev/null
check "agree below floor + status agreed stays escalated" "$("$S/lead.sh" list escalated | grep -c "^$id3")" 1
check "next today accepted"     "$("$S/lead.sh" show "$id3" | grep "^$id3" | cut -f9)" "$(date +%F)"
check "note kept despite errors" "$(grep -c 'tried to sneak' "$HOME/.hermes/workspace/business/clients/x@y.in.md")" 1

# bid: keychain floor is 140, so 126+ is a sensible offer (within 10%) and anything lower is a lowball.
b=$("$S/lead.sh" add example-shop bidder@y.in email keychains)
check "bid sensible -> owner"   "$("$S/lead.sh" update "$b" bid keychain 10 130 | grep -c SENSIBLE)" 1
check "sensible escalates"      "$("$S/lead.sh" list escalated | grep -c "^$b")" 1
check "lowball round 1"         "$("$S/lead.sh" update "$b" bid keychain 10 50 | grep -c 'LOWBALL (round 1')" 1
check "lowball keeps talking"   "$("$S/lead.sh" list talking | grep -c "^$b")" 1
check "same price again is not a new round" "$("$S/lead.sh" update "$b" bid keychain 10 50 | grep -c 'LOWBALL (round 1')" 1
check "lowball round 2"         "$("$S/lead.sh" update "$b" bid keychain 10 60 status escalated | grep -c 'LOWBALL (round 2')" 1
check "round 3 declines at floor" "$("$S/lead.sh" update "$b" bid keychain 10 70 | grep -c 'DECLINE.*[$]140 per unit')" 1
check "declined lead is lost"   "$("$S/lead.sh" list lost | grep -c "^$b")" 1
check "writing again reuses the declined lead" "$("$S/lead.sh" open bidder@y.in email "ok 80 then" | grep -c "EXISTING LEAD")" 1
check "still declined next round" "$("$S/lead.sh" update "$b" bid keychain 10 80 | grep -c DECLINE)" 1
check "bid at floor acceptable" "$("$S/lead.sh" update "$b" bid keychain 10 140 | grep -c ACCEPTABLE)" 1

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
