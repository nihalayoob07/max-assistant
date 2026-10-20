# Max: 2-minute demo

Three things, all filmed live on a phone over Telegram: texting a todo, a "look into" with sources, and the 06:30 IST briefing arriving. Max runs on the home server the whole time; the laptop is only used for the screen-recorded terminal shots.

## Before recording

- Phone: Do Not Disturb on (Telegram allowed), clean notification shade, and the clock visible in the status bar.
- Seed a few todos a day early, so the briefing has something real to show: one overdue, one due today, one open.
- The briefing shot has to be filmed at 06:30 IST, so record it first, on a morning before the rest. Backup if you miss it: text `brief me` (same skill, same data script).
- Pre-check on the server: `max status` shows the sandbox Ready, and `max policy list` shows the allow-list for shot 5.
- Screen-record the phone (Android's built-in recorder) and the terminal (OBS). Edit them together afterwards.

## Script

| Time | Shot | On screen | Voice-over |
|---|---|---|---|
| 0:00–0:12 | 1. Hook | Phone lock screen at 06:30, Max's briefing notification pops in | "This is Max. Every morning at 6:30 it sends me what I need for the day, and it runs on my own server, not someone's cloud." |
| 0:12–0:30 | 2. Briefing | Open Telegram and scroll the briefing: weather, overdue and today's todos | "Weather for my city, what's overdue, what's due today. It's built from my own notes files inside the sandbox." |
| 0:30–0:50 | 3. Capture | Type `todo: submit hackathon video sunday`. Reply: `✓ todo: submit hackathon video (due Sun ...)`. Then `what's on my list?` | "I text it like a friend. It works out that 'sunday' is a date, files the todo, and confirms in one line. No app, no forms." |
| 0:50–1:20 | 4. Look into | Type `look into the cheapest way to get from Mumbai to Pune this weekend`. Show the short answer plus the `Sources:` links, and tap one | "Ask it to look into something and you get a short answer with real sources, through Tavily search. It's also saved to my notes, so I can find it later." |
| 1:20–1:45 | 5. Privacy | Terminal: `max policy list` (the allow-list), then a request to a host that isn't on the list getting denied. Overlay: "keys live in the OpenShell gateway, never in the sandbox" | "Max runs in an NVIDIA OpenShell sandbox. It can only reach the services I've allowed, and the API keys stay in the gateway. The agent only ever sees placeholders." |
| 1:45–2:00 | 6. Stack + close | Architecture diagram from the README. Overlay: Nemotron 3 Super · Hermes Agent · OpenShell · NemoClaw · 1 CPU / 1 GiB home server | "Nemotron 3 Super for the brain, Hermes for memory, skills and the schedule, and NemoClaw to wire it up. Always on, and private by default." |

## Shot list

1. Phone lock screen at 06:30 IST, briefing notification arriving (real time, no edits to the clock)
2. Telegram: the full briefing message, scrolled slowly
3. Telegram: typing the todo, then the one-line confirmation
4. Telegram: `what's on my list?` reply
5. Telegram: the look-into question, the sourced answer, and tapping a source link
6. Terminal: `max policy list`
7. Terminal: a request to a blocked host being denied (for example `max exec -- curl -sS https://example.com`; dry-run it first to check it's denied)
8. README architecture diagram, as a still with the stack names overlaid
9. Optional B-roll: the home server box, and `max status` showing Ready

## Notes

- Keep the replies real. If Max is slow, cut the wait, but don't fake a reply.
- Blur anything personal in the notes files before you show them.
