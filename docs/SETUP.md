# Setting up your own Max

This guide takes you from nothing to your own Max answering you on Telegram and selling for your business. It's written for owners, not programmers: you'll copy a few commands into a terminal, and the installer asks you everything else.

Max runs on **your** server: a spare PC at home, a mini PC, or a small rented Linux server (a VPS). Your notes, customers and prices stay there.

**Time:** about 45 minutes, most of it waiting for downloads.

---

## 1. What you need

| | What | Cost |
|---|---|---|
| A Linux server | Ubuntu 22.04+/Debian 12+/Fedora 39+, 2+ CPU cores, **4 GB RAM or more** (8 GB is comfortable), 30 GB free disk. With less than 8 GB of RAM the installer adds swap. A home PC that stays on, or a VPS (Hetzner, DigitalOcean, Oracle's free tier...). | Free (your PC) to ~$5–10/month (VPS) |
| An NVIDIA API key | Sign in at [build.nvidia.com](https://build.nvidia.com), open any model, **Get API Key**. It starts with `nvapi-`. This is the brain: NVIDIA Nemotron. | Free tier (rate-limited) |
| A Telegram bot | In Telegram, message **@BotFather** → `/newbot` → pick a name. Copy the token (`123456:ABC...`). | Free |
| Your Telegram user ID | Message **@userinfobot**; it replies with your numeric ID. Only this account can talk to Max. | Free |
| *(optional)* Tavily key | For web search with sources ("look into ..."). [tavily.com](https://tavily.com) | Free tier (1,000 searches/month) |
| *(optional)* WhatsApp | A WhatsApp number for your business and a **second** Telegram bot (step 6). | Free |
| *(optional)* Windows PC | For the desktop app with voice (step 7). | Free |
| *(optional)* Android phone | For the app that rings you for decisions (step 8). Needs a free Firebase project and Tailscale. | Free |

You need to be able to open a terminal on the server (directly, or `ssh you@server` from your computer).

## 2. Install

On the server, as your normal user (not root):

```bash
git clone https://github.com/nihalayoob07/max-assistant.git ~/max-assistant
```

```bash
cd ~/max-assistant && bin/install
```

The installer:

1. asks your name, Telegram ID, time zone, city, currency, and which optional parts you want, and saves them in `max.config`;
2. installs Docker if it's missing (it asks first; if it adds you to the `docker` group, log out and in, then run `bin/install` again);
3. adds a swap file if your server has under 8 GB of RAM (asks first);
4. asks for your NVIDIA key, Telegram bot token and optional Tavily key at **hidden prompts**, checks the NVIDIA key works, then installs NVIDIA NemoClaw and creates Max's sandbox. This step takes 10–20 minutes;
5. puts Max's skills, personality and your business into the sandbox, and sets up the morning briefing and weekly report;
6. starts the small background services for the parts you chose.

**It's safe to run again.** Each step checks what's already done. If something fails, fix what it says and run `bin/install` again.

When it finishes, open your bot in Telegram, send `/start`, then `hi`. The first answer can take a minute or two.

### Try it

| Send Max | What happens |
|---|---|
| `todo: call the bank friday` | Saved to your todo list with the real date |
| `note: supplier prefers calls after 2pm` / `idea: ...` | Saved to notes / ideas |
| `what's on my list?` · `done call the bank` | Your todos / tick one off |
| `meeting with Jordan tomorrow 4pm` | On your calendar |
| `look into the cheapest courier for 2 kg parcels` | A short answer with sources, saved to your notes |
| `brief me` | The morning briefing now (it also arrives every day at `BRIEFING_TIME`) |

## 3. Add your business

Max sells for you, but only inside limits **you** write down. Each business is a folder in `private/business/` (it never goes into git). The installer made your first one from the example; to add another:

```bash
cp -r business-template/example-shop private/business/my-bakery
```

(Folder names: lowercase letters, digits and dashes.) Then edit the three files, for example with `nano private/business/my-bakery/profile.md`:

**`profile.md`**: what customers may be told. The first line is the name. Keep the labelled lines:

```
# My Bakery
Sells: custom cakes, cupcakes and cookie boxes, made to order.
Channels: hello@mybakery.com, WhatsApp +44 7700 900000
Payment terms: 50% to confirm, the rest on collection.
Tone: warm, short, British English.
Location / delivery: collection in Leeds, or delivery within 10 km for £5.

## FAQ
- Gluten-free? Yes, on all cakes, with 2 days' notice.
```

`Channels:` is how Max tells businesses apart when you have several. `Payment terms:` is printed on quotes and invoices.

**`policy.tsv`**: your price list, one product per line, columns separated by a **Tab** (not spaces):

```
# product	unit	list_price	floor_price	min_qty	min_lead_days	target_price (optional)
celebration cake	cake	45	38	1	3	42
cupcakes	box of 12	24	20	1	2
```

- `list_price`: what Max quotes first.
- `floor_price`: the lowest Max may ever agree to. **Code checks this, not the AI**: a price under the floor can't be agreed, whatever a customer says.
- `target_price` (optional): Max tries not to go below this unless the customer would walk away.
- `min_qty`, `min_lead_days`: smaller orders or faster dates come to you.

**`never.md`**: things Max must never agree to and must hand to you instead (refunds, credit, discounts on top of offers, rush jobs...).

Apply your changes (any time you edit them):

```bash
max-fixup
```

Test it without a real customer:

```bash
max ask "customer +441234567890 on whatsapp says: hi, how much for a celebration cake for saturday?"
```

How deals work: Max haggles in small steps inside your limits, closes by itself only when the code says the price is OK, and sends you anything outside them (a near-miss offer, an impossible date, something in `never.md`) on Telegram with a suggested reply. Leads, client notes and agreed deals are tracked for you; quotes and invoices come to you as PDFs to forward. Every Monday you get a short business report.

### Shop orders (optional)

If you run an online shop on the same server, Max can answer "any new orders?" and include them in your morning brief. Copy your orders into `business/<name>/orders.tsv` in the sandbox every few minutes; `examples/shop-orders/` has a working example for a shop that keeps orders in SQLite.

## 4. Everyday use

Talk to Max on Telegram. On the server:

| Command | What |
|---|---|
| `max status` | Is Max healthy? |
| `max logs --follow` | Watch what it's doing |
| `max ask "..."` | One message to Max from the terminal |
| `max-fixup` | Re-apply settings, skills and businesses after any change |
| `max backup` | Save notes, memory, leads and calendar to `~/max-backup-<date>.tgz` |
| `max restore <file>` | Put a backup back |

Change your settings in `~/max-assistant/max.config`, then run `max-fixup`. To switch an optional part on, set it to `yes` and run `bin/install` again.

## 5. Privacy: what goes where

- **Stays on your server:** your notes, todos, calendar, memory, customers, leads, prices and business files. They live inside a locked-down OpenShell sandbox.
- **Goes to NVIDIA:** the text of each conversation turn, so Nemotron can answer (build.nvidia.com's terms apply). Screenshots too, if you ask the desktop app about your screen.
- **Goes to Telegram:** your messages with Max, as with any Telegram chat.
- **Goes to Tavily** (if set): your search questions.
- **Keys:** typed at hidden prompts, held by the OpenShell gateway on your server, and swapped in only as requests leave. The sandbox (and so the AI) only ever sees placeholders. Nothing secret is in the repo or `max.config`.
- **The sandbox can only reach** the services on its allow-list (NVIDIA, Telegram, weather, Wikipedia-style references, Tavily, PyPI, and the PC-control helpers if you use them). See `max policy list`.
- **Customers** (WhatsApp) talk to a separate front desk with no tools at all, so a customer can't make Max run commands or read your files; prices are decided by code.

## 6. WhatsApp front desk (optional)

> **Read first.** WhatsApp doesn't allow automated messaging, and numbers that send automated replies through WhatsApp Web **can be banned**. Use it on a number you can afford to lose, leave auto-send off (you tap **Send** on each reply), and keep volumes human. Customer messages are processed by NVIDIA's model like the rest; tell customers if your local law requires it.

1. Make a **second** Telegram bot with @BotFather (Telegram allows one reader per bot, and Max uses the first). Send it `/start`.
2. Set `WHATSAPP=yes` and `WHATSAPP_NUMBER="..."` in `max.config`, then run `bin/install`. It asks for the second bot's token.
3. A WhatsApp QR code arrives from the second bot. On your phone: WhatsApp → **Linked devices** → **Link a device**, scan it. Then **don't restart anything until your phone stops saying "syncing"**.

From then on, each new customer chat asks you "Max or me?". Replies come to the second bot with **Send / Edit / Skip**; `/mode` switches auto-send on or off. Only chats with **unsaved numbers** are handled, so friends and family never reach the AI. It needs about 600 MB of RAM.

## 7. Desktop app for Windows (optional)

A holographic HUD with your Inbox (decisions waiting), Chat, Leads, Calendar and Businesses, plus voice ("Max, ...", or Ctrl+Shift+Space) and control of your PC ("open Spotify", "play lofi on YouTube", "move this to the other screen"). Speech runs on your PC; nothing is uploaded except the text you say to Max.

1. On the server: `DESKTOP=yes` in `max.config`, then `bin/install`.
2. On the PC, SSH key access to the server (PowerShell):
   ```
   ssh-keygen -t ed25519
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh you@your-server "cat >> ~/.ssh/authorized_keys"
   ```
   Then `ssh you@your-server` must log in **without a password**.
3. Get the app: download `Max-Setup.exe` from the project's releases, or build it yourself with Node.js 22 installed: `cd app`, `npm install`, `npm run dist` → `app/dist/Max-Setup.exe`.
4. Install and start it. The first time, Notepad opens `server.txt`: write your SSH login (`you@192.168.1.50`), save, start Max again.

The app opens SSH tunnels to the server only while it runs; Max's API is never exposed to the network. "Hands" only accepts commands from your own Max, refuses catastrophic commands (wiping disks, shutdown...) until you confirm, and logs everything to `~/.max-hands-*.log`. Away from home, put the PC and server on [Tailscale](https://tailscale.com) and use the server's Tailscale name in `server.txt`.

## 8. Android app (optional)

A native app that **rings you like a phone call** when a deal needs your decision, a WhatsApp customer needs an answer only you have, 10 minutes before a meeting, and with a spoken morning brief. You answer by voice ("counter at thirteen and a half", "accept") or with buttons. It also shows the dashboard.

1. **Server:** `PHONE=yes` in `max.config`, `bin/install`. The phone API listens on port 18660; its key is in `~/.config/max-phone/key`.
2. **Tailscale** (free): install it on the server and the phone, sign in to the same account. Note the server's Tailscale address (`tailscale ip -4`, like `100.x.y.z`). Don't open port 18660 to the internet.
3. **Firebase** (free, for the ringing): at [console.firebase.google.com](https://console.firebase.google.com) create a project → add an Android app with package `app.max.assistant` → download `google-services.json` into `phone/android/app/`. Then Project settings → Service accounts → **Generate new private key**, and copy that file to the server as `~/.config/max-phone/firebase.json` (`chmod 600`). Restart: `systemctl --user restart max-phone`.
4. **Build the APK** (on a PC with Android Studio, or JDK 17+): create `phone/android/phone.properties`:
   ```
   urls=http://100.x.y.z:18660,http://192.168.1.50:18660
   key=<contents of ~/.config/max-phone/key on the server>
   ```
   then in `phone/android/`: `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`). The APK has your key baked in: don't share it.
5. Install it, open it, and follow the **Setup** tab (notifications, full-screen calls, battery). "Test call in 8 s" checks the ringing without the server; "Ring me from the server" checks the whole path.

Quiet hours (default 23:00–07:00) hold everything but reminders: `~/.config/max-phone/quiet`. Brief time: `~/.config/max-phone/brief-time`.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Max doesn't answer on Telegram | Did you send `/start` to the bot? Then `max status` and `max logs --follow`. Only one copy of Max may use a bot token: stop any other. |
| Answers stopped with `404 ... Function not found for account` | NVIDIA retired that model for your key. Pick a current one on build.nvidia.com, set `MODEL` in `max.config`, and follow "Switch model" below. |
| `401` / `Invalid JWT` errors | Restart the sandbox: `max stop`, then `max start`. Never turn on Hermes `gateway.multiplex_profiles`. |
| Max won't start after you edited files in the sandbox | Never add unknown keys to the sandbox's `~/.hermes/.env` (NemoClaw refuses to start Hermes). Put settings in `config.yaml` with `hermes config set`. |
| `Host port 8642 is held by a listener NemoClaw cannot attribute` | `pkill -f "forward.*8642"`, then `max recover`. The `max-api-watch` timer normally fixes this by itself. |
| Server slow, replies take many minutes or never arrive | Out of memory. Check `free -h`; add swap; don't build big Docker images on a small server while Max is in use. |
| Morning briefing arrives at the wrong time | Cron runs on the sandbox's UTC clock, so your local time is converted when you run `max-fixup`. Run it again after changing `BRIEFING_TIME`/`REPORT_TIME` or a daylight-saving change. Check with `max exec -- hermes cron list`. |
| WhatsApp logged out | A new QR code comes from the second bot by itself; scan it, then wait for syncing to finish before touching anything. |
| Desktop app says it can't reach the server | `ssh you@server` must work without a password from that PC; check `server.txt` in `%APPDATA%\Max`. Launch log: `%APPDATA%\Max\hands-launch.log`. |

**Golden rule: never let NemoClaw rebuild Max's sandbox.** If any `nemohermes` command asks "Rebuild now?", answer **n**. A rebuild can fail half-way and take the sandbox (and its stored keys) with it. `bin/install` never re-onboards an existing sandbox.

**Switch model:** `nemohermes inference set --provider build --model <id> --sandbox max`. If it says the in-sandbox configuration "did not fully converge", don't rebuild: replace the old model id with the new one in the sandbox's `~/.hermes/config.yaml` (`max exec -- sh -c "sed -i 's#<old>#<new>#g' ~/.hermes/config.yaml"`), then `max gateway restart` and `max-fixup`.

## 10. Backup and update

**Backup** (do it weekly, and before any update):

```bash
max backup
```

Copy the `.tgz` somewhere off the server, together with `~/max-assistant/max.config` and `~/max-assistant/private/`. Keys aren't in backups: on a new server you type them again.

**Update Max:**

```bash
max backup && cd ~/max-assistant && git pull && max-fixup && systemctl --user restart max-desk max-phone max-hands 2>/dev/null; true
```

If an update adds a new optional part or service, run `bin/install` again too.

**Move to a new server:** clone and run `bin/install` there with the same `max.config` and `private/`, stop Max on the old one (one bot, one reader), then `max restore <backup.tgz>` and `max-fixup`.

**Uninstall:** `nemohermes max destroy`, `systemctl --user disable --now max-api-watch.timer max-desk max-phone max-hands`, `docker rm -f max-wa`, and delete `~/max-assistant` and `~/.config/max-*`.

## 11. Costs

Everything Max uses has a free tier: NVIDIA's API (rate-limited: fine for one owner, slow at peak times; a chat turn takes 30 s to 2 min), Telegram, Tavily (1,000 searches/month), Firebase Cloud Messaging and Tailscale (personal plans). The only real cost is the server: nothing for a PC you already have (plus electricity), or about $5–10 a month for a 4–8 GB VPS.
