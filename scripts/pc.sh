#!/usr/bin/env bash
# Max's hands on the owner's computers. Runs one command on the laptop (Windows PowerShell) or the home
# server (bash) through the hands helpers.
#   pc.sh <laptop|server|active> [--confirmed] [--timeout SECONDS] <command...>
#   pc.sh <laptop|server|active> --health
#   pc.sh which                     prints the active computer (set by "switch pc" in the app)
# --confirmed is only for commands on the catastrophic list, and only after the owner said yes.
set -euo pipefail
W=~/.hermes/workspace
. "$W/max.env" 2>/dev/null || true; export TZ=${MAX_TZ:-UTC}
target=${1:-}; shift || true
active() { cat "$W/active_pc" 2>/dev/null || echo laptop; }
[ "$target" = which ] && { active; exit 0; }
[ "$target" = active ] && target=$(active)
case $target in laptop) port=18700 ;; server) port=18701 ;; *) echo 'usage: pc.sh <laptop|server|active> [--confirmed] [--timeout S] <command...>' >&2; exit 2 ;; esac
confirmed=false; timeout=60; health=false
while [ $# -gt 0 ]; do
  case $1 in
    --confirmed) confirmed=true; shift ;;
    --timeout) timeout=$2; shift 2 ;;
    --health) health=true; shift ;;
    *) break ;;
  esac
done
$health || [ $# -gt 0 ] || { echo 'missing command' >&2; exit 2; }
# pc.sh laptop youtube <n> <search words>  plays the nth search result in the default browser.
if [ "${1:-}" = youtube ]; then
  target=laptop port=18700   # videos only make sense on the laptop screen
  n=${2:-}; shift 2 || true
  [[ $n =~ ^[1-9][0-9]?$ ]] && [ $# -gt 0 ] || { echo 'usage: pc.sh laptop youtube <n> <search words>' >&2; exit 2; }
  q=${*//\'/\'\'}
  set -- "\$h=(Invoke-WebRequest ('https://www.youtube.com/results?search_query='+[uri]::EscapeDataString('$q')) -UseBasicParsing).Content;" \
    "\$ids=@([regex]::Matches(\$h,'\"videoRenderer\":\{\"videoId\":\"([\w-]{11})\"') | % { \$_.Groups[1].Value } | Select -Unique);" \
    "if (\$ids.Count -lt $n) { 'only '+\$ids.Count+' results'; exit 1 };" \
    "\$u='https://www.youtube.com/watch?v='+\$ids[$((n-1))]; Start-Process \$u; 'playing '+\$u"
fi
TOKEN=$(cat "$W/.hands_token") URL="http://host.openshell.internal:$port" HEALTH=$health \
CMD="$*" CONFIRMED=$confirmed TIMEOUT=$timeout TARGET=$target python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
h = {"X-Max-Token": os.environ["TOKEN"], "Content-Type": "application/json"}
try:
    if os.environ["HEALTH"] == "true":
        r = urllib.request.urlopen(urllib.request.Request(os.environ["URL"] + "/health", headers=h), timeout=10)
        print(r.read().decode()); sys.exit(0)
    body = json.dumps({"cmd": os.environ["CMD"], "confirmed": os.environ["CONFIRMED"] == "true",
                       "timeout": int(os.environ["TIMEOUT"])}).encode()
    t = int(os.environ["TIMEOUT"]) + 15
    r = json.load(urllib.request.urlopen(urllib.request.Request(os.environ["URL"] + "/run", data=body, headers=h), timeout=t))
except urllib.error.HTTPError as e:
    msg = e.read().decode()[:300]
    if e.code == 403:   # the catastrophic-command guard: goes on the dashboard's Shield screen
        import datetime
        when = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        with open(os.path.expanduser("~/.hermes/workspace/shield.tsv"), "a") as f:
            f.write(f"{when}\trefused\t{os.environ['TARGET']}\tblocked a risky command until the owner confirms: {os.environ['CMD'][:120].replace(chr(9), ' ')}\n")
    print(f"{os.environ['TARGET']}: refused ({e.code}) {msg}"); sys.exit(1)
except Exception as e:
    print(f"{os.environ['TARGET']} is not reachable right now ({str(e)[:120]}). "
          + ("The laptop is reachable only while the Max app is open on it." if os.environ["TARGET"] == "laptop" else ""))
    sys.exit(1)
if r.get("stdout"): print(r["stdout"].rstrip())
if r.get("stderr"): print("[stderr] " + r["stderr"].rstrip())
print(f"[exit {r.get('code')}]")
sys.exit(0 if r.get("code") == 0 else 1)
PY
