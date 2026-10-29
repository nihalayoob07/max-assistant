# Max: 3-minute demo

Shows Max working end to end and how it uses NVIDIA Nemotron. Everything is filmed live: real replies, real server. Max runs Nemotron on **build.nvidia.com**; Nebius Token Factory is not used (no credits during the hackathon), and the video says so.

## Before recording

- **Server:** `max status` shows the sandbox Ready. Run `max ask "hi"` once so the model is warm.
- **Business:** use one real business (or `business-template/example-shop`) with a policy you're happy to show. Know its list price and floor for one product.
- **Customer phone:** a second phone or number on WhatsApp, to play the customer.
- **Your phone:** Do Not Disturb on (Telegram and the Max app allowed), clean notification shade.
- **Data:** seed a few todos and one meeting today, so the briefing and dashboard aren't empty.
- **Blur** real customer names and numbers in the edit, or use a test contact.

## Recording specs

- 1920×1080, 30 fps. Phone clips: Android's screen recorder. PC and terminal: OBS.
- One file per shot, named by shot number: `01_hook.mp4`, `03_desk.mp4`, and so on.
- Voice-over: one file per shot (`03_vo.m4a`), quiet room, phone close to your mouth. Read the line after the shot is filmed, so it matches what happened.
- Don't fake replies. If Nemotron is slow, keep filming; the wait gets cut in the edit.

## Script (≈2:55)

| Time | Shot | On screen | Voice-over |
|---|---|---|---|
| 0:00–0:08 | 1. Intro | The first 8 s of the promo (`max_demo.mp4`) | *(music only)* |
| 0:08–0:20 | 2. What it is | Telegram open on your phone, Max's chat | "This is Max, a private AI business partner that runs on my own server. NVIDIA Nemotron does all the thinking. Here it is working." |
| 0:20–1:00 | 3. Deal closed | Split screen: customer WhatsApp and your Telegram. Customer asks the price, lowballs, Max holds, counters with a precise number, customer accepts above the floor. Your Telegram gets "deal closed". | "A customer messages my business on WhatsApp. Nemotron reads the profile, answers, and haggles. It holds the first lowball, counters in small precise steps, and closes. I didn't touch anything." |
| 1:00–1:25 | 4. Escalation | Customer offers below the floor. Your Android phone rings with "incoming call · offer ₹…". Answer and say "counter at …". Max sends the counter. | "This one's below my floor, so Max can't take it. It calls me instead. I answer by voice and Max sends my counter." |
| 1:25–1:45 | 5. Code decides the price | Terminal: run the deal gate three times (OK, LOW, ESCALATE). Commands below. | "Nemotron negotiates, but code decides. Every price goes through this gate before a deal closes. The model can't agree to anything outside my limits." |
| 1:45–2:10 | 6. Personal assistant | Telegram: `todo: send invoice to Café Rio friday` gets a one-line confirmation, then `look into the cheapest courier for 2 kg parcels` gets an answer with sources, then the morning briefing message | "It's also my assistant. Todos, research with real sources, and a briefing every morning at 6:30." |
| 2:10–2:25 | 7. Desktop | Desktop app: say "Max, what's on today?", then "open Spotify" | "On my PC it listens. Simple commands run instantly, and anything harder goes to Nemotron." |
| 2:25–2:45 | 8. How Nemotron is used | Terminal: `grep MODEL max.config`, then `max status` showing the inference provider and model | "Max runs nvidia/nemotron-3.5-super on build.nvidia.com with reasoning on. Turning reasoning off was four times faster, but it made up prices, so we kept it on. Because Nemotron is open, one command switches it to Nemotron Nano on a local machine. We didn't use Nebius Token Factory; it's OpenAI-compatible, so it would be a provider switch." |
| 2:45–2:55 | 9. Private by design | Terminal: `max policy list` | "It all runs in an OpenShell sandbox. Keys stay in the gateway, and Max can only reach the hosts I've allowed." |
| 2:55–3:00 | 10. End card | The promo's last 5 s (MAX + repo link) | *(music only)* |

## Terminal commands

```bash
# Shot 5: the deal gate (use your business slug, product, list price and floor)
max exec -- ~/.hermes/scripts/deal_check.sh example-shop "desk organiser" 2 760 2026-12-20   # OK
max exec -- ~/.hermes/scripts/deal_check.sh example-shop "desk organiser" 2 600 2026-12-20   # LOW (under floor)
max exec -- ~/.hermes/scripts/deal_check.sh example-shop "desk organiser" 2 760 2026-11-01   # ESCALATE (lead time)

# Shot 8: the model
grep MODEL max.config
max status

# Shot 9: the allow-list
max policy list
```

Dry-run each command before filming, and use a delivery date far enough ahead to pass the lead time.

## Hand-off for editing

Send the shot clips (`01`–`10`) and voice files (`02_vo`–`09_vo`). The edit trims waits, adds captions and the promo intro and end card, blurs personal details, and exports a 1080p MP4 under 3:00 for YouTube.
