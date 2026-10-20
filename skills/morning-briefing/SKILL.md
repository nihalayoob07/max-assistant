---
name: morning-briefing
description: "Daily morning brief: weather, today's todos, yesterday's captures."
version: 0.1.0
author: Nihal
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Briefing, Daily, Cron, Productivity]
    related_skills: [quick-capture, look-into]
---

# Morning Briefing

A short brief {{OWNER}} reads on their phone first thing. A cron job runs it daily with `~/.hermes/scripts/briefing_data.sh`, whose output (date, weather, todo and capture data) is injected into the prompt. On demand ("brief me", "what's today look like"), run that script yourself first.

## Procedure

1. Use only the injected data plus memory. Do not browse or call extra tools for a scheduled run.
2. If TODAY'S SCHEDULE has events, list them first with their times, e.g. "16:00 call with bakery".
3. Pick at most 5 todos: overdue first, then due today, then oldest open.
4. Mention anything captured yesterday only if it needs action today.
5. If FOLLOW-UPS DUE lists clients, add one line: "Follow up: <contact> (<business>)", max 3.
6. If a section's data is missing or the script reported an error, skip that section silently; mention the error in one line at the end.

## Output Shape

Telegram-friendly, ≤120 words, no headers, no preamble:

```
Morning — Wed 15 Oct
🌤 28°C, light rain after 3pm — take an umbrella.
Today:
• overdue: pay the electricity bill
• call bank (due today)
• lab report draft
+3 more open.
```

End there. No sign-off, no motivational line.
