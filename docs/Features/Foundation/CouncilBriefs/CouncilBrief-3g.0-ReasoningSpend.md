# Council Brief 3g.0 — Reasoning-token spend in the Chorus council

_Issued 2026-08-07 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson_

You are a review council of independent LLM models. Deliberate on the two
questions below and answer in the **Required Output Format** at the end. You have
no other context on this project — everything you need is in this document. Where
you are uncertain about an external fact, say so explicitly rather than guessing.
Be brief: a few short paragraphs per question is enough.

---

## 1. Context

Chorus is a local-first Windows desktop app for running several AI coding agents
in parallel. It also has a **council**: a small roster of models that answer a
brief's numbered questions blind, critique each other anonymised, and are then
ruled on by an arbiter. Council members are reached over OpenRouter's streaming
chat-completions API.

Two measured facts frame this decision:

- **The decoder reads only `choices[].delta.content`.** Reasoning models emit
  their thinking on a separate channel, which Chorus discards. Those tokens are
  nevertheless billed by OpenRouter as *output* tokens.
- **A run on 2026-08-06 failed entirely because of this.** Three reasoning
  members shared a default per-turn output allowance of 1200 tokens. All three
  spent the whole allowance thinking, emitted no visible content, and were
  recorded as refusals. The run was billed $0.028 for reasoning nobody could
  read. The allowance has since been raised to 16,000 per member (32,000 for the
  arbiter), which fixes the empty answers but not the invisibility of the spend.

OpenRouter exposes a `reasoning` request parameter that can cap reasoning
(`max_tokens`), lower it (`effort`), or exclude it from the response
(`exclude`). Chorus does not currently send it: the council transport sends only
`model`, `messages`, `stream` and `max_tokens`, deliberately, and widening that
is a real code change rather than a setting.

## 2. The questions

1. Should Chorus send OpenRouter's `reasoning` parameter on council turns, to cap or exclude reasoning tokens?
2. Should reasoning-token spend be surfaced in the council transcript, and if so how?

Elaboration on each, in order.

**On question 1.** Consider both directions. Capping or excluding reasoning makes
cost predictable and stops a member burning its allowance before it speaks — but
reasoning is often *why* a strong model is on the roster, and suppressing it may
lower the quality of exactly the deliberation the council exists to produce. If
you recommend sending it, say what the default should be and whether the setting
belongs per-member or per-run.

**On question 2.** Today a member's turn shows its visible answer and a token
count that silently includes thinking the reader never sees. Options include:
showing reasoning tokens as a separate figure, showing the reasoning text
itself, showing nothing but documenting it, or something else. Consider that
this app's standing rule is never to render a value it cannot honestly source,
and that a transcript is read afterwards to audit what a run cost and concluded.

## 3. Required Output Format

Answer each question separately, in this shape:

```
Q1: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>

Q2: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>
```

Begin each answer with the verdict token on its own line as shown — the app
counts those tokens to summarise where the council agreed. Interpret AGREE as
"yes, do the thing the question proposes", DISAGREE as "no, do not", and
QUALIFY as "yes but only under conditions you then state".
