#!/usr/bin/env bash
# Smoke test for bin/install and bin/fixup on a clean Ubuntu 24.04 container (podman or docker on the host).
# NemoClaw, OpenShell, Docker, systemd and sudo are stand-ins that log their calls; the "sandbox" is a plain
# /sandbox folder, so fixup's work can be checked file by file. Needs no keys and touches nothing outside the
# container. What it can't cover: real onboarding, real Telegram/NVIDIA, real services. Run: bash tests/install_smoke.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
rt=$(command -v podman || command -v docker) || { echo "needs podman or docker" >&2; exit 1; }
exec "$rt" run --rm -i -v "$repo:/repo:ro" docker.io/library/ubuntu:24.04 bash -s <<'OUTER'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl python3 git openssl nodejs npm perl tzdata >/dev/null
useradd -m alex; echo '172.19.0.1 host.openshell.internal' >> /etc/hosts
mkdir -p /sandbox /stubs/sandbox /stubs/later && chown alex /sandbox

# ---- stand-ins ----
cat > /stubs/curl <<'EOF'
#!/bin/bash
case "$*" in
  *integrate.api.nvidia.com*) printf 200 ;;                                   # key check
  *nemoclaw.sh*) printf 'mkdir -p ~/.local/bin; cp /stubs/later/* ~/.local/bin/; nemohermes onboard\n' ;;
  *) exec /usr/bin/curl "$@" ;;
esac
EOF
cat > /stubs/later/nemohermes <<'EOF'
#!/bin/bash
echo "nemohermes $*" >> /tmp/calls.log
case "$1" in
  onboard) env | grep -q '^NVIDIA_INFERENCE_API_KEY=nvapi-' || { echo "no key in env" >&2; exit 1; }
           [ "$NEMOCLAW_SANDBOX_NAME" = max ] && [ "$NEMOCLAW_RAM" = 1Gi ] || exit 1
           touch /tmp/sandbox-exists; mkdir -p /sandbox/.hermes/{runtime,skills,memories,workspace}; : > /sandbox/.hermes/.env
           printf 'platforms:\n  api_server:\n    toolsets:\n    - browser\n    - terminal\n  telegram:\n' > /sandbox/.hermes/config.yaml; exit 0 ;;
esac
shift
case "$1" in
  exec) shift; [ "$1" = -- ] && shift; HOME=/sandbox PATH=/stubs/sandbox:$PATH "$@" ;;
  upload) mkdir -p "$(dirname "$3")"; cp -r "$2" "$3" ;;
  skill) cp -r "${3%/}" /sandbox/.hermes/skills/ ;;
  gateway-token) echo tok_0123456789abcdefghij ;;
esac
EOF
cat > /stubs/later/openshell <<'EOF'
#!/bin/bash
echo "openshell $*" >> /tmp/calls.log
[ "$1 $2" = "sandbox list" ] && { echo "NAME CREATED PHASE"; [ -f /tmp/sandbox-exists ] && echo "max 2026-10-21 Ready"; }
exit 0
EOF
cat > /stubs/sandbox/hermes <<'EOF'
#!/bin/bash
C=/tmp/cron
case "$1 $2" in
  "config set") echo "$3=$4" >> /tmp/hermes-config ;;
  "cron list") cat $C 2>/dev/null ;;
  "cron create") sched=$3; shift 4; while [ $# -gt 0 ]; do [ "$1" = --name ] && name=$2; shift; done
    printf '  %s [active]\n    Name:      %s\n    Schedule:  %s\n' "$(openssl rand -hex 6)" "$name" "$sched" >> $C ;;
  "cron edit") id=$3; sched=$5; awk -v id="$id" -v s="$sched" '$1 == id { on = 1 } on && $1 == "Schedule:" { $0 = "    Schedule:  " s; on = 0 } 1' $C > $C.t && mv $C.t $C ;;
esac
EOF
for s in docker systemctl loginctl sudo npm; do printf '#!/bin/bash\necho "%s $*" >> /tmp/calls.log\n[ "%s $1" = "npm --prefix" ] && mkdir -p "$2/node_modules/playwright"\n[ "%s $1" = "docker version" ] && echo 27.0\nexit 0\n' $s $s $s > /stubs/$s; done
chmod +x /stubs/* /stubs/sandbox/* /stubs/later/*

# ---- install, as the owner would ----
cp -r /repo /home/alex/src && rm -rf /home/alex/src/private /home/alex/src/max.config && chown -R alex /home/alex/src
answers='Mary Jane
abc
123456789
Mars/Base
Asia/Kolkata
Pune
$
en-US
y
+1 555 0100
y
y
bad
nvapi-test
123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123

Sunrise Bakery & Co
123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0124
'
run() { su alex -c "cd ~/src && PATH=/stubs:\$PATH script -qec bin/install /dev/null" ; }
printf '%s' "$answers" | run > /tmp/run1.log 2>&1 || { cat /tmp/run1.log; exit 1; }
run < /dev/null > /tmp/run2.log 2>&1 || { echo "--- second run failed"; cat /tmp/run2.log; exit 1; }

# ---- checks ----
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
H=/home/alex; S=/sandbox/.hermes
check "max.config answers"        "grep -qx 'OWNER_NAME=\"Mary Jane\"' $H/src/max.config && grep -qx 'TELEGRAM_USER_ID=123456789' $H/src/max.config && grep -qx 'TIMEZONE=Asia/Kolkata' $H/src/max.config && grep -qx 'CURRENCY=\"\\\$\"' $H/src/max.config && grep -qx 'WHATSAPP=yes' $H/src/max.config"
check "bad answers re-asked"      "grep -q 'digits only' /tmp/run1.log && grep -q 'Not a time zone' /tmp/run1.log && grep -q 'starts with nvapi-' /tmp/run1.log"
check "~/max-assistant link"      "[ \"\$(readlink -f $H/max-assistant)\" = $H/src ]"
check "onboarded once"            "[ \$(grep -c '^nemohermes onboard' /tmp/calls.log) = 1 ]"
check "second run skips onboard"  "grep -q 'already exists: leaving it alone' /tmp/run2.log"
check "SOUL rendered"             "grep -q 'Mary Jane' $S/SOUL.md && grep -q 'Asia/Kolkata' $S/SOUL.md && ! grep -rqE '[{][{](OWNER|TZ|CURRENCY)' $S/SOUL.md $S/skills"
check "skills installed"          "[ -f $S/skills/shop-orders/SKILL.md ] && [ -f $S/skills/business-desk/SKILL.md ]"
check "max.env"                   "(. $S/workspace/max.env; [ \"\$OWNER_NAME\" = 'Mary Jane' ] && [ \"\$MAX_TZ\" = Asia/Kolkata ] && [ \"\$CURRENCY\" = '\$' ] && [ \"\$BRIEFING_CITY\" = Pune ])"
check "first business"            "head -1 $S/workspace/business/sunrise-bakery-co/profile.md | grep -qx '# Sunrise Bakery & Co' && [ ! -d $S/workspace/business/example-shop ]"
check "runtime links"             "[ -L $S/runtime/SOUL.md ] && [ -L $S/runtime/skills ]"
check "telegram user once"        "[ \$(grep -c '^TELEGRAM_ALLOWED_USERS=123456789' $S/.env) = 1 ]"
check "sandbox browser removed"   "! grep -q '    - browser' $S/config.yaml && grep -q '    - terminal' $S/config.yaml"
check "cron in UTC, not doubled"  "[ \$(grep -c 'Name:' /tmp/cron) = 2 ] && grep -q 'Schedule:  0 1 \\* \\* \\*' /tmp/cron && grep -q 'Schedule:  30 3 \\* \\* 1' /tmp/cron"
check "hands token + policy"      "[ -s $S/workspace/.hands_token ] && grep -q 'policy update max --rule-name allow_host_openshell_internal_18700' /tmp/calls.log"
check "hands unit on the bridge"  "grep -q -- '--listen 172.19.0.1:18701' $H/.config/systemd/user/max-hands.service"
check "units read max.config"     "grep -q 'EnvironmentFile=-%h/max-assistant/max.config' $H/.config/systemd/user/max-desk.service $H/.config/systemd/user/max-phone.service"
check "desk key, bot, owner"      "[ \$(stat -c %a $H/.config/max-desk/key) = 600 ] && [ -s $H/.config/max-desk/bot-token ] && [ \"\$(cat $H/.config/max-desk/owner-chat)\" = 123456789 ]"
check "extension config"          "python3 -c 'import json,sys; c=json.load(open(\"$H/.config/max-desk/extension/config.local.json\")); sys.exit(not (c[\"ownerName\"] == \"Mary Jane\" and c[\"businessNumber\"] == \"+1 555 0100\"))'"
check "services enabled"          "grep -q 'systemctl --user enable --now max-api-watch.timer max-hands.service max-desk.service max-phone.service' /tmp/calls.log"
check "deal gate in \$"           "su alex -c 'HOME=/sandbox bash $S/scripts/deal_check.sh sunrise-bakery-co keychain 2 199' | grep -q 'at \\\$199'"
su alex -c "PATH=/stubs:$H/.local/bin:\$PATH; echo '- [ ] buy flour' > $S/workspace/notes/todos.md; max backup /tmp/b.tgz && rm $S/workspace/notes/todos.md && max restore /tmp/b.tgz" > /tmp/backup.log 2>&1 || cat /tmp/backup.log
check "backup and restore"        "grep -q 'buy flour' $S/workspace/notes/todos.md"
[ $fails = 0 ] && echo "all passed" || { echo "$fails failed; first run log:"; tail -40 /tmp/run1.log; exit 1; }
OUTER
