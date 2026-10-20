#!/usr/bin/env bash
# Start (or restart) WhatsApp Web on the home server: desk/wa-browser.js in the Playwright container, with
# the Max extension in server mode. Docker restarts it after crashes and reboots.
#   desk/max-wa.sh          (re)start      desk/max-wa.sh logs     follow its log
set -euo pipefail
PW=1.63.0                                   # the container's browsers match this playwright version
IMG=mcr.microsoft.com/playwright:v$PW-noble
REPO=$(cd "$(dirname "$0")/.." && pwd)
C=~/.config/max-desk
[ -f "$REPO/max.config" ] && . "$REPO/max.config"
[ "${1:-}" = logs ] && exec docker logs -f --tail 50 max-wa

# playwright (the library) once, next to the runner
[ -d "$C/wa-node/node_modules/playwright" ] || { mkdir -p "$C/wa-node"; npm --prefix "$C/wa-node" install --no-save --silent "playwright@$PW"; }

# The extension as the server runs it: front desk on localhost, drafts go to Telegram for approval.
rm -rf "$C/extension"; cp -r "$REPO/whatsapp-extension" "$C/extension"
python3 - "$C" "${OWNER_NAME:-}" "${WHATSAPP_NUMBER:-}" <<'EOF'
import json, sys
c = sys.argv[1]
json.dump({"apiUrl": "http://127.0.0.1:18650", "token": open(f"{c}/key").read().strip(), "enabled": True,
           "ownerName": sys.argv[2], "businessNumber": sys.argv[3],
           "approval": "telegram", "unsavedOnly": False, "selfTest": True},
          open(f"{c}/extension/config.local.json", "w"))
EOF
mkdir -p "$C/wa-profile"

docker rm -f max-wa >/dev/null 2>&1 || true
# Chrome keeps running a cached copy of the extension's background script even after its files change, so
# a new version never takes effect. Clear the service-worker cache (the WhatsApp login lives elsewhere).
rm -rf "$C/wa-profile/Default/Service Worker"
docker run -d --name max-wa --restart unless-stopped --network host --init --ipc host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e TZ="${TIMEZONE:-UTC}" -e LOCALE="${LOCALE:-en-US}" \
  -e RELAY=http://127.0.0.1:18650 -e KEY_FILE=/cfg/key -e EXT=/cfg/extension -e PROFILE=/cfg/wa-profile \
  -e NODE_PATH=/cfg/wa-node/node_modules \
  -v "$C:/cfg:z" -v "$REPO/desk/wa-browser.js:/app/wa-browser.js:ro,z" \
  --memory 900m "$IMG" node /app/wa-browser.js
echo "max-wa started; logs: $0 logs"
