---
name: quick-capture
description: "Capture todos, notes, ideas and facts from short messages; list, complete and search them."
version: 0.1.0
author: Nihal
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Capture, Todos, Notes, Productivity]
    related_skills: [morning-briefing, look-into]
---

# Quick Capture

{{OWNER}} fires off short messages (often from Telegram) to get something out of their head. File it fast and confirm in one line. Never ask follow-up questions for a plain capture.

## When to Use

- A message starts with `todo`, `note`, `idea`, `remember`, `buy`, `call`, or `remind me`.
- A short standalone statement that is clearly something to keep ("dentist thursday 4pm", "ask prof about lab slot").
- "What's on my list?", "show my todos", "what did I note about X?"
- "done X", "finished X", "drop X".

Don't use for questions that need an answer (use `look-into`) or normal conversation.

## Storage

All files live in `~/.hermes/workspace/notes/`. Create the folder if missing. One item per line, newest last:

| File | What goes in | Line format |
|---|---|---|
| `todos.md` | actions | `- [ ] text (added YYYY-MM-DD)` ; due date if given: `- [ ] text (due YYYY-MM-DD, added ...)` |
| `notes.md` | facts, info, reference | `- YYYY-MM-DD: text` |
| `ideas.md` | ideas, someday | `- YYYY-MM-DD: text` |

Dates are {{TZ}}. Resolve relative dates ("thursday", "tomorrow") to an absolute date before writing, with the terminal: `TZ={{TZ}} date -d friday +%F` (today: `TZ={{TZ}} date +%F`). Use `date`, not Python — Python snippets need approval.

Stable facts about {{OWNER}} (preferences, people, routines) also go to the memory tool, so they persist into every conversation.

## Procedure

1. Classify: todo, note, idea, or a command (list / done / search).
2. Capture: append the line with a shell command, e.g. `printf '%s\n' "- [ ] call bank (added 2026-10-15)" >> ~/.hermes/workspace/notes/todos.md`. Keep {{OWNER}}'s wording; fix only obvious typos.
3. Done/drop: change the matching `- [ ]` line to `- [x]` (done) or delete it (drop). If more than one line matches, ask which one.
4. List: show open todos, overdue first, then by due date, max 10. Say how many more exist.
5. Search: grep all three files case-insensitively and quote matching lines with their dates.

## Output Shape

One line. Examples:
- `✓ todo: call bank (due Thu 16 Oct)`
- `✓ noted`
- `✓ done: call bank — 4 open left`
