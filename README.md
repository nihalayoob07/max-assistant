# Max: a private AI business partner you run yourself

Max is an always-on AI assistant for small-business owners that runs on **your own server**, in a locked-down sandbox. You talk to it on Telegram (or by voice on your PC). It keeps your todos, notes and calendar, looks things up with sources, sends you a morning briefing, and handles customer enquiries for your businesses: it answers from your business profile and **negotiates and closes deals by itself, but only inside price limits that code enforces**. Anything outside them comes to you, on Telegram or as a phone call.

Your notes, customers and prices stay on your server. Keys stay in the sandbox gateway; the AI never sees them.

Built for the **NVIDIA Personal AI Track**: NVIDIA **Nemotron** (open model) + NVIDIA **NemoClaw** + **OpenShell** + **Hermes Agent**.

**→ Set up your own: [docs/SETUP.md](docs/SETUP.md)** (about 45 minutes, no programming).

## How Max uses NVIDIA Nemotron

- **Nemotron does all of Max's thinking.** Every Telegram message, customer enquiry, research question, morning brief and voice command goes to `nvidia/nemotron-3.5-super-vl-120b-a12b` on build.nvidia.com. It plans the tool calls (calendar, leads, deal gate, search), writes the replies and haggles with customers.
- **Reasoning stays on.** With Nemotron's reasoning switched off (`agent.reasoning_effort none`), replies came back in 21 s instead of about 90 s, but Max made up prices and skipped house rules. Max keeps reasoning on and puts every hard limit in code (`scripts/deal_check.sh`), so the model negotiates but never decides a price on its own.
- **Open model, so it can run fully offline.** Because Nemotron is open, the same setup can switch to Nemotron 3 Nano 4B on local Ollama with one command (`nemohermes inference set`), so no conversation text leaves your server at all.
- **Checked at install.** `bin/install` tests your NVIDIA key against the configured Nemotron model before onboarding. Hosted models can be retired per account, and a 404 there means pick another model.

**Nebius Token Factory:** not used. No Nebius credits were available during the hackathon, so Max runs on build.nvidia.com. Inference is OpenAI-compatible, so moving to Token Factory is a provider switch (`custom` provider, endpoint `https://api.tokenfactory.nebius.com/v1`, plus Nebius's Nemotron model ID). No other Nebius tools or services are used.

## What it does

| | How you use it |
|---|---|
| **Quick capture** | `todo: pay the supplier friday`, `note: ...`, `idea: ...`, `done ...`, `what's on my list?` · [skill](skills/quick-capture/SKILL.md) |
| **Calendar** | `meeting with Jordan tomorrow 4pm`, `am I free friday?` |
| **Research** | `look into the cheapest courier for 2 kg parcels` → a short answer with sources, saved to your notes · [skill](skills/look-into/SKILL.md) |
| **Morning briefing** | Every morning on Telegram: weather, today's schedule, overdue todos, follow-ups due · [skill](skills/morning-briefing/SKILL.md) |
| **Business desk** | A customer message for any of your businesses: Max picks the business, answers from its profile, haggles in steps, and **closes only when [`deal_check.sh`](scripts/deal_check.sh) approves the price, quantity and date** against your policy. Everything else is escalated with a suggested reply. Leads and client memory, quotes and invoices as PDFs, a weekly report · [skill](skills/business-desk/SKILL.md) |
| **WhatsApp front desk** *(optional)* | WhatsApp Web runs on your server. Customers talk to a **separate, tool-less AI** ([`desk.py`](scripts/desk.py)) while code makes every price decision and checks each reply before it goes out. You approve replies on Telegram, or switch on auto-send · [details](whatsapp-extension/README.md) |
| **Desktop app** *(optional)* | Windows HUD: Inbox of decisions, Chat, Leads, Calendar, Businesses, plus voice ("Max, ...", local speech recognition and voice) and control of your PC and server ("open Spotify", "play lofi on YouTube", "what's this error on my screen?") · [`app/`](app/), [`hands/`](hands/README.md) |
| **Android app** *(optional)* | Rings you like a phone call when a deal needs you, before meetings, and with a spoken morning brief; answer by voice ("counter at thirteen and a half") · [`phone/`](phone/) |
| **Shop orders** *(optional)* | "Any new orders?" from your online shop's database · [skill](skills/shop-orders/SKILL.md), [example](examples/shop-orders/) |

Telegram alone is enough; every other part is optional. Personality and house rules: [`SOUL.md`](SOUL.md).

## Privacy model

- **Your data stays on your server**, inside an OpenShell sandbox: notes, memory, calendar, leads, client notes, prices.
- **Allow-listed network:** the sandbox can reach only the hosts and HTTP methods its policy allows (NVIDIA, Telegram, weather, public references, Tavily, PyPI, and the PC helpers if enabled); everything else is denied.
- **Keys never enter the sandbox.** NVIDIA, Telegram and Tavily keys are typed at hidden prompts, registered with the OpenShell gateway on the host, and swapped in at egress. The agent only sees placeholders, so it can't leak what it doesn't have.
- **Customers can't reach Max's tools.** WhatsApp messages go to a front desk with no tools; prices and deals are decided in code, and a reply with an unapproved price or your name in it never goes out.
- **What leaves the server:** conversation text to NVIDIA's API (the model), your Telegram chats, and search questions to Tavily.

## Architecture

```
 You ── Telegram ──┐                                   your Linux server (Docker)
 Desktop app ─ SSH ┤      ┌──────────────────────────────────────────────────────────────┐
 Android ─ Tailscale ─────┤ OpenShell gateway ──► sandbox "max" (1 CPU / 1 GiB cap)        │
 Customers ─ WhatsApp Web ┤   keys held here      └─ Hermes Agent: skills, memory, cron      │
   (server browser)       │   egress allow-list      ├─ notes, calendar, leads (workspace)   │
                          │                          └─ desk.py: tool-less front desk        │
                          │ max-desk (WhatsApp relay) · max-hands (PC control)            │
                          │ max-phone (Android API) · max-api-watch                       │
                          └───────────────────────┬──────────────────────────────────────┘
                                                  └─► NVIDIA Nemotron (build.nvidia.com)
```

- **Nemotron** is the model: `nvidia/nemotron-3.5-super-vl-120b-a12b` by default (`MODEL` in `max.config`). The API is OpenAI-compatible, so local or other hosted inference can be switched in with `nemohermes inference set`.
- **Hermes Agent** provides the agent loop, persistent memory, skills and the cron scheduler.
- **OpenShell** enforces the sandbox: per-host, per-method, per-path network rules, with keys kept in the gateway.
- **NemoClaw (NemoHermes)** installs and manages it all: onboarding, policies, channels and recovery.

## Quick start

On a Linux server with 4 GB+ RAM, with an NVIDIA API key, a Telegram bot token and your Telegram user ID ready ([what you need](docs/SETUP.md#1-what-you-need)):

```bash
git clone https://github.com/nihalayoob07/max-assistant.git ~/max-assistant
cd ~/max-assistant && bin/install
```

The installer asks a few questions, writes `max.config`, installs Docker and NemoClaw, creates the sandbox, and sets everything up. It is safe to re-run. Then send `/start` to your bot. Add your business in `private/business/<name>/` and run `max-fixup` ([how](docs/SETUP.md#3-add-your-business)).

## Integration notes (found while building)

- **Hermes ignored SOUL.md and custom skills in gateway sessions.** NemoClaw keeps the gateway's `state.db` in `~/.hermes/runtime/`, and Hermes resolves the agent home from that db's folder. `fixup` links `SOUL.md`, `skills/` and `memories/` into `runtime/`.
- **Rebuild preflight rejects native NVIDIA endpoints.** After `inference set --provider build`, `rebuild` compares against OpenShell's shared `inference.local` route, which native providers never set, so `channels add` can't finish its rebuild. `fixup` applies the Telegram and Tavily settings directly instead, and `install` never re-onboards an existing sandbox.
- **Never let NemoClaw rebuild a working sandbox.** A rebuild can fail after the old sandbox is gone (on rootless Podman: Hermes tightens `~/.hermes` to `0700`, the backup restores that mode, and the capability-less container root then can't write `managed-policy.json`). Answer **n** to rebuild prompts; attach a channel's provider with `openshell sandbox provider attach max <provider>` and restart instead.
- **No unknown keys in the sandbox's `~/.hermes/.env`**: NemoClaw refuses to start Hermes (`SECRET_BOUNDARY_REFUSED`). Settings go in `config.yaml` via `hermes config set`.
- **Never enable `gateway.multiplex_profiles`**: it breaks NVIDIA key injection (every answer a 401).
- **Hosted models get retired per account.** NVIDIA dropped `nemotron-3-super-120b-a12b` for our key with `404 Function ... Not found for account` while `/v1/models` still listed it. `install` checks the key against the configured model before onboarding; a 404 means pick another model, a 401/403 means the key.
- **The sandbox clock is UTC and can't be changed.** Scripts take the owner's time zone from `max.env` (written by `fixup`), and cron times are converted to UTC when jobs are created.
- **Sandbox egress to Telegram only works from Python** (curl gets 403), hence `scripts/notify.sh`.
- **The :8642 API forward dies on its own** sometimes; the `max-api-watch` timer restarts it.
- **Telegram allows one poller per bot**, so the WhatsApp desk uses a second bot.
- **WSL:** native Docker inside WSL is blocked by NemoClaw preflight, but rootless Podman works (`NEMOCLAW_GATEWAY_RUNTIME=podman`, `--no-gpu`). On Podman the sandbox's `169.254.2.2/32` address on `lo` doesn't survive a reboot; persist it in `/etc/wsl.conf` (`[boot] command="mount --make-rshared / ; ip address replace 169.254.2.2/32 dev lo"`). Max now targets native Linux with Docker.
- **Unattended sessions can't run Python snippets** (`execute_code` needs approval on the API/cron surfaces), so skills use plain shell.
- **Below 8 GB of RAM, swap is mandatory**: a 3.7 GB server without it froze during image builds and Telegram replies were silently dropped mid-reconnect.

## Repo layout

```
bin/install                one-time (re-runnable) setup of a Linux server
bin/fixup                  re-apply skills, SOUL, scripts, businesses, policies, cron and workarounds (max-fixup)
bin/max                    drive the sandbox: max ask "...", max backup, max status, max logs ...
max.config.example         your settings (copied to the git-ignored max.config)
SOUL.md, skills/           personality and Hermes skills ({{OWNER}}, {{TZ}}, {{CURRENCY}} filled in by fixup)
scripts/                   run inside the sandbox: deal gate, leads, calendar, briefing data, front desk, invoices, PC control
business-template/         example business: profile, price policy, never-agree list
private/business/<slug>/   your real businesses (git-ignored)
desk/                      WhatsApp front desk: relay service and the server-side WhatsApp Web runner
hands/                     PC-control helpers (server service and the desktop app's laptop helper)
watch/                     API port watchdog (systemd timer)
app/                       Windows desktop app (Electron)
phone/                     Android app (Kotlin) and its server API
whatsapp-extension/        Chrome extension WhatsApp Web <-> front desk
examples/shop-orders/      example: feed an online shop's orders to Max
tests/                     bash tests/business_test.sh · bash tests/cal_test.sh · python3 scripts/desk.py --self-test
docs/SETUP.md              the setup guide
```

No secrets are stored in this repo or in `max.config`.

## Hackathon

Max started as the author's own assistant and has run 24/7 on a 3.7 GB home server since 2026-10-17. Demo script: [`DEMO.md`](DEMO.md). Write-up: [`SUBMISSION.md`](SUBMISSION.md).


## License

MIT, see [LICENSE](LICENSE).
