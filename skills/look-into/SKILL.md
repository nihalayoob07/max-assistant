---
name: look-into
description: "Answer 'look into X' with a short sourced brief, saved to notes."
version: 0.1.0
author: Nihal
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Research, Web, Sources]
    related_skills: [quick-capture, arxiv, grounded-citations]
---

# Research on Demand

{{OWNER}} asks Max to look something up and wants the answer, not a report.

## When to Use

- "look into X", "research X", "what's the deal with X", "compare X and Y", "find me X".
- A factual question whose answer may have changed recently.

Don't use for things answerable from memory or the notes files (use `quick-capture` search).

## Sources (in order)

1. Web search tool, if available (Tavily).
2. Wikipedia / Wikidata REST APIs for definitions, people, places, background (`https://en.wikipedia.org/api/rest_v1/page/summary/<Title>`).
3. `arxiv` skill for papers and technical topics.

Network access is limited by sandbox policy. If a source is blocked, say which one in one line and continue with the rest; never claim you checked something you could not reach.

## Procedure

1. Restate the question to yourself in one sentence; pick 1–3 queries.
2. Search, open the 2–4 most relevant results, and extract the facts that answer the question.
3. Cross-check any number, date or claim that the answer depends on against a second source when possible.
4. Write the brief (shape below).
5. Save it to `~/.hermes/workspace/notes/research/YYYY-MM-DD-<slug>.md`, with the question at the top and the sources at the bottom. Get the local date from `TZ={{TZ}} date +%F` (the sandbox clock is UTC).

## Output Shape

- Answer first: 2–5 sentences, ≤120 words. Plain words, no hype.
- Then `Sources:` with up to 3 links.
- If sources disagree or evidence is thin, say so in one line.
- If the topic needs follow-up, end with one suggested next step.
