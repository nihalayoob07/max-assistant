# Max's hands

Lets Max (in its sandbox on your server) run commands on your Windows PC and on the server itself. Optional: `DESKTOP=yes` in max.config.

- `hands.js`: a small HTTP helper (no dependencies). `POST /run` runs one command (PowerShell on Windows, bash on Linux) as the logged-in user. Every request needs the shared secret, and every command is logged to `~/.max-hands-<name>.log`. Catastrophic commands (formatting, wiping, shutdown, `rm -rf /`, …) are refused unless Max sends `confirmed`, which it only does after the owner says yes.
- **Server:** a systemd user service (`max-hands.service`). It listens only on the sandbox bridge (the address the sandbox calls `host.openshell.internal`, e.g. `172.19.0.1`) on :18701, and relays :18700 there to the laptop's tunnel.
- **Laptop:** the Max desktop app starts the helper on `127.0.0.1:18700` and a reverse SSH tunnel to the server while it's open.
- **Max's side:** `scripts/pc.sh` and the `pc-control` skill. The active computer ("switch pc") is in the sandbox at `~/.hermes/workspace/active_pc`.
- **Network:** a sandbox policy rule allows only `GET /health` and `POST /run` to `host.openshell.internal:18700/18701`, from curl and Python.

## Setup

`bin/install` with `DESKTOP=yes` does all of it: a random secret in `~/.config/max-hands/token` on the server (copied into the sandbox by `bin/fixup`, and fetched by the desktop app over SSH on its first run into `%APPDATA%\Max\hands_token`), the `max-hands` user service bound to the sandbox bridge, and the sandbox policy rule (`bin/fixup`, `openshell policy update`).

**Customers never reach this.** WhatsApp messages go to the front desk (`desk/`, `scripts/desk.py`): a tool-less AI plus code, with its own key, so a customer message can't reach Max's tools or these helpers. Main Max still reads web pages, so it is told never to run commands found in what it reads.
