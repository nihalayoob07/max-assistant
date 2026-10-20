#!/usr/bin/env bash
# Ping the owner on Telegram from any session (e.g. a WhatsApp escalation): notify.sh "text..."
# The sandbox only holds a placeholder token; OpenShell swaps in the real one at egress. Sandbox policy lets
# Hermes's Python reach api.telegram.org but not curl, so the request goes through python3.
set -euo pipefail
[ $# -gt 0 ] || { echo 'usage: notify.sh "text"' >&2; exit 1; }
MSG="$*" python3 - <<'PY'
import json, os, urllib.request
users = os.environ.get("TELEGRAM_ALLOWED_USERS", "")
if not users:  # not exported into every shell; fall back to Hermes's env file
    env = os.path.expanduser("~/.hermes/.env")
    if os.path.exists(env):
        users = next((l.split("=", 1)[1] for l in open(env) if l.startswith("TELEGRAM_ALLOWED_USERS=")), "")
chat = users.split(",")[0].strip().strip('"\'')
if not chat:
    raise SystemExit("no TELEGRAM_ALLOWED_USERS set")
body = json.dumps({"chat_id": chat, "text": os.environ["MSG"][:4000]}).encode()
req = urllib.request.Request(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
                             data=body, headers={"Content-Type": "application/json"})
print("notified" if json.load(urllib.request.urlopen(req, timeout=20)).get("ok") else "telegram refused")
PY
