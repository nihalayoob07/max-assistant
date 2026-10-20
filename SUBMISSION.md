# Max: a private, always-on personal assistant

**Track:** NVIDIA Personal AI
**Stack:** NVIDIA Nemotron 3 Super · Hermes Agent · OpenShell · NemoClaw (NemoHermes)
**Author:** Nihal

## The problem

The useful personal assistants want your whole life: your todos, your notes, what you search for, when you wake up. Today, giving them that means handing it to someone else's cloud, and handing an agent your API keys. I wanted an assistant I'd actually trust with that context. It should live on hardware I own, reach only the services I pick, and never hold a key it could leak.

## What Max does

I talk to Max on Telegram, mostly from my phone. It has three skills (plain Markdown `SKILL.md` files that Hermes loads):

- **Quick capture.** `todo: pay the electricity bill friday`, `note: ...`, `idea: ...`, `done ...`, `what's on my list?`. Relative dates are resolved in IST, and items are written one line each to plain Markdown files in the sandbox. Every capture gets a one-line confirmation and no follow-up questions. Stable facts about me also go into Hermes's persistent memory.
- **Look into.** "look into X" gives a short answer (under 120 words) with up to three sources, using Tavily search plus Wikipedia, with key facts cross-checked. Each brief is saved to `notes/research/`. If a source is blocked by policy, Max says so instead of pretending it checked.
- **Morning briefing.** A Hermes cron job runs every day at 06:30 IST and sends a Telegram message with the weather, overdue and today's todos, and anything from yesterday that needs action. A small shell script gathers the data and injects it into the prompt, so the scheduled run needs no browsing and no extra tool calls.

[`SOUL.md`](SOUL.md) sets the house rules. Replies are phone-sized. Max acts, then confirms. It asks before anything that sends, deletes or spends. It never invents sources.

## Privacy model

Privacy comes from the architecture, not from a promise:

1. **Keys stay in the gateway.** The NVIDIA, Tavily and Telegram credentials are registered with the OpenShell gateway on the host and injected at egress. The sandbox, and so the agent, only ever sees placeholders. A prompt injection can't leak a key the agent has never seen. Every setup script reads keys at hidden prompts and passes them straight to the gateway. None are written to disk in the repo or the sandbox.
2. **Egress is allow-listed.** OpenShell enforces per-host, per-method and per-path network rules. Max can reach Telegram, NVIDIA inference, Tavily, a weather service, Wikipedia and PyPI, and everything else is denied. `max policy list` shows exactly what's allowed.
3. **Data stays home.** Notes, memory and conversation history live only inside the sandbox on my own server. The only data that leaves is the prompt going to Nemotron inference, and Nemotron is an open model: one command (`nemohermes inference set`) switches to Nemotron 3 Nano 4B on local Ollama, so nothing leaves at all.

## Always on, at home

Max runs 24/7 on a small Fedora home server (4 cores, 3.7 GB RAM, no GPU), alongside a live web store. The sandbox is capped at **1 CPU / 1 GiB** (`NEMOCLAW_CPU=1 NEMOCLAW_RAM=1Gi`) and uses about 640 MB in practice, so the other services keep their headroom. `bin/install` does the whole install in one re-runnable step: Docker, swap on small boxes, NemoClaw, onboarding on Nemotron, Tavily, Telegram, the resource caps, `bin/fixup` and the server services. It isn't tied to me: everything personal lives in a git-ignored `max.config` and `private/business/`, so anyone can run their own Max for their own business by following [docs/SETUP.md](docs/SETUP.md). Max started on my laptop under WSL2. I moved it to the server because a laptop sleeps, and an assistant that misses its 06:30 briefing isn't always on.

## How the NVIDIA stack fits together

- **Nemotron 3 Super** (build.nvidia.com) is the model, with Nemotron 3 Nano 4B on local Ollama as a fully local fallback.
- **Hermes Agent** provides the agent loop, persistent memory, the skills system, the cron scheduler and the Telegram gateway.
- **OpenShell** is the sandbox: network policy and credential injection.
- **NemoClaw / NemoHermes** handles install, onboarding, policies, channels and recovery.

## NemoClaw integration findings

Getting this to run unattended exposed several integration gaps. Each one has a workaround in [`bin/fixup`](bin/fixup), and I'm happy to file them upstream:

- **Hermes ignored `SOUL.md` and custom skills in gateway sessions.** NemoClaw keeps the gateway's `state.db` in `~/.hermes/runtime/`, and Hermes resolves the agent home from that db's folder. Fix: symlink `SOUL.md`, `skills/` and `memories/` into `runtime/`.
- **Rebuild preflight rejects native NVIDIA endpoints.** After `inference set --provider build`, `rebuild` checks against OpenShell's shared `inference.local` route, which native providers never set, so `channels add` can't finish its rebuild. Fix: apply the Telegram and Tavily config directly.
- **`rebuild` is destructive on rootless Podman.** Hermes tightens `~/.hermes` to `0700`, and the backup restores that mode. The capability-less container root then can't write `managed-policy.json` (`EACCES`), so the recreate fails after the old sandbox is already gone. Fix: skip the rebuild, then `openshell sandbox provider attach` and restart.
- **WSL2:** native Docker is blocked by preflight, but rootless Podman works. The sandbox's gateway address (`169.254.2.2/32` on `lo`) doesn't survive a reboot, which leaves the sandbox in an `Error` state it can't recover from. Fix: persist the address in `/etc/wsl.conf`.
- **Unattended sessions can't run Python snippets.** `execute_code` and `python3 -c` need approval on the API and cron surfaces, so the skills use plain shell (`date`, `printf >>`, `grep`).

## What's next

- Nebius Serverless inference for Nemotron (OpenAI-compatible, so it's a provider switch), once credits are available.
- A weekly review skill, gym-session tracking, and calendar and email skills, each with its own narrow egress rule.
- More channels (WhatsApp).

## Try it

See [docs/SETUP.md](docs/SETUP.md) to set up your own (`bin/install` on any Linux server), and [DEMO.md](DEMO.md) for the 2-minute walkthrough.
