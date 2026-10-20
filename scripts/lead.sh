#!/usr/bin/env bash
# Leads and client memory for Max's business desk. Plain TSV so it works without Python.
# Fast path (one call each, so a client message takes two tool calls):
#   lead.sh open "<contact>" "<channel>" "<need...>"   find or create the lead; prints it, client notes, business profile(s)
#   lead.sh update <id> [biz <slug>] [status <s>] [next <+Nd|YYYY-MM-DD>] [bid|offer|agree <product> <qty> <price> [YYYY-MM-DD]] [note <text...>]
#     bid = the client's price (verdict: ACCEPTABLE / SENSIBLE -> owner / LOWBALL round n / DECLINE); offer = your counter; agree = close
# Other: add <business> <contact> <channel> <need...> | set <id> <field> <value> | agree <id> <product> <qty> <price> [date]
#        list [status|business] | due | show <id|contact> | note <contact> <text...>
# Statuses: new talking escalated agreed paid lost junk
set -euo pipefail
. ~/.hermes/workspace/max.env 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}   # owner settings (bin/fixup); the sandbox clock is UTC
CUR=${CURRENCY:-₹}
B=~/.hermes/workspace/business
L=$B/leads.tsv
DC=~/.hermes/scripts/deal_check.sh
HDR=$'id\tcreated\tupdated\tbusiness\tcontact\tchannel\tstatus\tvalue\tnext\tneed'
mkdir -p "$B/clients"
[ -s "$L" ] || echo "$HDR" > "$L"
today=$(date +%F)
clean() { printf '%s' "$*" | tr '\t\r\n' '   '; }   # customer text must never break the TSV
slug() { printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9@.+_-' '_'; }
field() { awk -F'\t' -v id="$1" -v c="$2" '$1 == id { print $c }' "$L"; }
row() { awk -F'\t' -v id="$1" 'NR == 1 || $1 == id' "$L"; }

setf() {  # setf <id> <column> <value>
  local col
  case $2 in status) col=7;; value) col=8;; next) col=9;; need) col=10;; business) col=4;;
    *) echo "unknown field '$2'" >&2; exit 1;; esac
  awk -F'\t' -v id="$1" '$1 == id { f = 1 } END { exit !f }' "$L" || { echo "no lead $1" >&2; exit 1; }
  awk -F'\t' -v OFS='\t' -v id="$1" -v c="$col" -v v="$(clean "$3")" -v d="$today" \
    '$1 == id { $c = v; $3 = d } { print }' "$L" > "$L.tmp" && mv "$L.tmp" "$L"
}
addl() {  # addl <business> <contact> <channel> <need...> -> id
  local id; id=$(printf 'L%04d' "$(wc -l < "$L")")
  printf '%s\t%s\t%s\t%s\t%s\t%s\tnew\t\t\t%s\n' "$id" "$today" "$today" "$(clean "$1")" "$(clean "$2")" "$(clean "$3")" "$(clean "${*:4}")" >> "$L"
  echo "$id"
}
notes() { local f; f="$B/clients/$(slug "$1").md"; [ -f "$f" ] && { echo "--- client notes"; cat "$f"; } || true; }
deal() {  # deal <id> <agree|offer|owner> "product|qty|price[|date]"   owner = a price the owner approved: no policy check
  local biz product qty price due res
  biz=$(field "$1" 4); IFS='|' read -r product qty price due <<< "$3"
  if { [ "$2" = owner ] && res="owner-approved $CUR$price"; } || res=$("$DC" "$biz" "$product" "$qty" "$price" "${due:-}"); then
    if [ "$2" != offer ]; then
      setf "$1" status agreed; setf "$1" value "$(awk -v a="$price" -v q="$qty" 'BEGIN { printf "%.2f", a * q }')"
      # the line items quotes and invoices are made from (invoice.py): id, date, product, qty, unit price
      # a new agreement replaces the lead's old one, so a quote never lists the deal twice
      touch "$B/deals.tsv"; awk -F'\t' -v id="$1" '$1 != id' "$B/deals.tsv" > "$B/deals.tsv.tmp" && mv "$B/deals.tsv.tmp" "$B/deals.tsv"
      printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$today" "$(clean "$product")" "$qty" "$price" >> "$B/deals.tsv"
    fi
  elif [ "$2" = agree ]; then setf "$1" status escalated; fi
  echo "$2: $res"
}
# The client's own price -> one verdict, decided here rather than by the model.
# ponytail: "sensible" = within NEAR_PCT of the floor and 3 lowball rounds are fixed; make them policy columns if a business needs different ones.
NEAR_PCT=10 MAX_ROUNDS=3
bid() {  # bid <id> "product|qty|price[|date]"
  local biz product qty price due res rc gap n floor R=$B/rounds.tsv
  biz=$(field "$1" 4); IFS='|' read -r product qty price due <<< "$2"
  res=$("$DC" "$biz" "$product" "$qty" "$price" "${due:-}") && rc=0 || rc=$?
  case $rc in
    0) echo "bid: ACCEPTABLE ($res). You may agree at this price." ;;
    3) gap=$(printf '%s' "$res" | sed -n 's/.*(gap \([0-9]*\)%).*/\1/p')
       if [ "${gap:-100}" -le "$NEAR_PCT" ]; then
         setf "$1" status escalated
         echo "bid: SENSIBLE (${gap}% under our limit). Don't accept or refuse: tell the client you'll check with our manager, and send the owner the offer."
       else
         # rounds.tsv: id, rounds, last price. Re-checking the same price in one turn isn't a new round.
         touch "$R"; read -r n last <<< "$(awk -v id="$1" '$1 == id { print $2, $3 }' "$R")"
         n=${n:-0}; [ "$price" = "${last:-}" ] || n=$((n + 1)); [ "$n" -ge 1 ] || n=1
         { grep -v "^$1 " "$R" || true; echo "$1 $n $price"; } > "$R.tmp" && mv "$R.tmp" "$R"
         if [ "$n" -lt "$MAX_ROUNDS" ]; then
           setf "$1" status talking
           echo "bid: LOWBALL (round $n of $MAX_ROUNDS). Don't escalate. Explain what the price includes and why it's worth it, then counter (check your counter with offer)."
         else
           floor=$(awk -F'\t' -v p="$product" '!/^#/ && tolower($1) == tolower(p) { print $4; exit }' "$B/$biz/policy.tsv")
           setf "$1" status lost
           echo "bid: DECLINE (round $n of $MAX_ROUNDS). Politely decline, and say our final price is $CUR$floor per unit if they change their mind."
         fi
       fi ;;
    *) setf "$1" status escalated; echo "bid: $res" ;;
  esac
}

cmd=${1:-list}; shift || true
case $cmd in
  open)
    [ $# -ge 2 ] || { echo 'usage: lead.sh open "<contact>" "<channel>" "<need...>"' >&2; exit 1; }
    # Reuse any unfinished lead, declined (lost) ones included, so a client cannot reset the haggle rounds by writing again.
    id=$(awk -F'\t' -v k="$(clean "$1")" 'NR > 1 && tolower($5) == tolower(k) && $7 != "paid" { i = $1 } END { print i }' "$L")
    [ -n "$id" ] && echo "EXISTING LEAD" || { id=$(addl unknown "$1" "$2" "${*:3}"); echo "NEW LEAD (business unknown: set it with update $id business=<slug>)"; }
    row "$id"; notes "$1"
    biz=$(field "$id" 4)
    for d in "$B"/*/; do
      s=$(basename "$d"); [ "$s" = clients ] && continue
      [ "$biz" = unknown ] || [ "$biz" = "$s" ] || continue
      echo "=== business: $s"; cat "$d/profile.md" 2>/dev/null; cat "$d/never.md" 2>/dev/null; echo
    done ;;
  update)
    # Plain words, no quoting games: update L0002 biz example-shop status talking next +2d offer keychain 50 175 note client is a cafe
    id=${1:-}; shift || true
    [ -n "$(field "$id" 1)" ] || { echo "no lead '$id'" >&2; exit 1; }
    has_agree=0; for w in "$@"; do [[ $w =~ ^(agree|bid|owner)$ ]] && has_agree=1; done   # agree/bid set the status themselves
    skip() { echo "skipped: $*"; }   # one bad word never throws away the rest of the update
    while [ $# -gt 0 ]; do
      k=$1; shift
      case $k in
        biz|business) v=${1:-}; shift || true
          if [[ $v =~ ^[a-z0-9-]+$ ]] && [ -d "$B/$v" ]; then setf "$id" business "$v"; else skip "no business '$v'"; fi ;;
        status) v=${1:-}; shift || true
          if [ "$has_agree" = 1 ]; then continue; fi   # agree decides the status itself
          case $v in
            new|talking|escalated|lost|junk) setf "$id" status "$v" ;;
            paid) if [ "$(field "$id" 7)" = agreed ]; then setf "$id" status paid; else skip "status paid needs an agreed deal first"; fi ;;
            agreed) skip "status agreed is refused: use 'agree <product> <qty> <price> [date]' so the deal is checked" ;;
            *) skip "unknown status '$v'" ;;
          esac ;;
        next) v=${1:-}; shift || true
          case $v in today|+0d) v=+0d;; tomorrow) v=+1d;; esac
          [[ ! $v =~ ^[0-9]{4} ]] && [[ $v =~ ^\+?([0-9]+)d?$ ]] && v=$(date -d "+${BASH_REMATCH[1]} days" +%F)
          if [[ $v =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then setf "$id" next "$v"; else skip "next must be +Nd, today, tomorrow or YYYY-MM-DD"; fi ;;
        offer|agree|bid|owner)  # <product> <qty> <price> [YYYY-MM-DD]; product may be several words (stops at the number)
          p=""; while [ $# -gt 0 ] && ! [[ $1 =~ ^[0-9]+$ ]]; do p="${p:+$p }$1"; shift; done
          q=${1:-}; pr=${2:-}; shift 2 || true; d=""
          if [[ ${1:-} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then d=$1; shift; fi
          if [ "$k" = bid ]; then bid "$id" "$p|$q|$pr|$d"; else deal "$id" "$k" "$p|$q|$pr|$d"; fi ;;
        note|need) v=$(clean "$*"); set --   # takes the rest of the line, so put it last
          if [ "$k" = note ]; then printf -- '- %s: %s\n' "$today" "$v" >> "$B/clients/$(slug "$(field "$id" 5)").md"; else setf "$id" need "$v"; fi ;;
        *) skip "unknown word '$k' (expected biz, status, next, offer, agree, note, need)" ;;
      esac
    done
    row "$id" | tail -n 1 ;;
  add)
    [ $# -ge 4 ] || { echo "usage: lead.sh add <business> <contact> <channel> <need...>" >&2; exit 1; }
    addl "$@" ;;
  set) [ "${2:-}" = status ] && [[ ${3:-} =~ ^(agreed|paid)$ ]] && { echo "use update (agree / status paid) for that" >&2; exit 1; }
       setf "$1" "$2" "${*:3}"; echo "ok $1 $2" ;;
  agree) deal "$1" agree "$2|$3|$4|${5:-}" | sed 's/^agree: //' ;;
  list)
    if [ $# -gt 0 ]; then awk -F'\t' -v f="$1" 'NR == 1 || $7 == f || $4 == f' "$L"; else cat "$L"; fi ;;
  due)
    awk -F'\t' -v d="$today" 'NR == 1 || ($9 != "" && $9 <= d && $7 !~ /^(paid|lost|junk)$/)' "$L" ;;
  show)
    awk -F'\t' -v k="$1" 'NR == 1 || $1 == k || tolower($5) == tolower(k)' "$L"; notes "$1" ;;
  note)
    printf -- '- %s: %s\n' "$today" "$(clean "${*:2}")" >> "$B/clients/$(slug "$1").md"; echo "noted" ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
