# Chorus

**Local-first, BYOK desktop command center for running and supervising multiple AI coding agents in
parallel — built on the principle that attention, not compute, is the scarce resource.**

Chorus runs several AI coding CLIs side by side in real terminal panes, each in its own isolated git
worktree, and keeps track of what they cost you: in money, and in the minutes of your attention they
actually consumed. Your API keys stay encrypted on your machine and are injected into agent processes
as environment variables at launch — never written to a config file, never passed as a command-line
argument, never printed to a log or a transcript.

> **Status: pre-1.0, Windows x64.** Phases 0 through 3e are complete; Phase 6 (a per-project memory
> graph) is planned and in progress. It is used daily by its author to build itself.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [What it does today](#what-it-does-today)
- [Supported agents](#supported-agents)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Getting started](#getting-started)
- [Building an installer](#building-an-installer)
- [Project layout](#project-layout)
- [Development](#development)
- [How this project is planned](#how-this-project-is-planned)
- [License](#license)

---

## Why this exists

Running one coding agent is easy. Running four is a different problem, and it is not a compute
problem.

Four agents working in one repository overwrite each other. Four terminals in four windows means you
have lost track of which one is waiting for you. Four sets of API keys in four config files means
four plaintext secrets on disk. And when the bill arrives, nothing tells you which task the money
went to.

Chorus is the supervision layer for that: isolation so agents cannot collide, one screen so you can
see who needs you, one encrypted vault so keys are not scattered, and measurement so cost has a
denominator.

## What it does today

### Parallel agent panes

- **Grid and filmstrip layouts** — split panes arbitrarily, or focus one agent full-size with the
  rest as a strip. Layouts persist across restarts.
- **Real terminals**, not transcript viewers: `xterm.js` over `node-pty`, with full interactivity,
  resize and scrollback.
- **Auto-titling** — panes name themselves from the agent's own terminal title, so a pane says what
  it is working on rather than which tool it is.
- **Sessions survive restarts.** Chorus records what was running and relaunches it, healing rows
  whose processes are gone rather than trusting the database.
- **Command palette** (`Ctrl+K`) for launching, focusing, restarting and switching projects.

### Git worktree isolation

- **One worktree per agent**, created on launch as `chorus/<repo>/<shortid>`, so parallel agents
  never write to the same files.
- **Boot reconcile heals against reality** — `git worktree list` is the authority, and a worktree
  removed behind Chorus's back is a row to heal, not an error to raise.
- **No auto-merge, no un-gated `--force`, no branch auto-deletion.** Removal is offered only when a
  worktree is provably clean, and uncommitted work survives close, detach, quit and restart.
- **Per-pane diff summaries** on a bounded poll, so you can see what an agent has actually changed.

### BYOK credential vault

- Keys are encrypted with **Electron `safeStorage`** (Windows DPAPI) and stored as an envelope in
  SQLite — never in plaintext on disk.
- **Decrypt-per-launch.** No unattended decryption: no boot hook, no timer, no retry path.
- **Injected as environment variables** into the child process, with a per-session scrubber over the
  PTY stream so a key an agent echoes never reaches the pane or the transcript.
- **Provider routes** — point an agent at OpenRouter or another OpenAI-compatible gateway, with a
  live model catalog and a per-provider shortlist.
- **Launch profiles** reproduce an agent's full configuration — agent, route, model, effort,
  workspace mode — in one click.

### Council review

Point Chorus at a brief written in Markdown and it convenes a **multi-model deliberation** over it:

1. every member answers the brief's numbered questions **blind**;
2. members critique each other's positions **anonymised**;
3. an arbiter rules on each question, then writes the findings.

The findings land as a Markdown file beside the brief. Two properties are enforced in code rather
than requested in a prompt:

- **Dissent cannot be dropped.** The orchestrator builds the dissent list from the transcript before
  the arbiter is ever asked to synthesise, and appends it to the document unconditionally — so a
  disagreement survives an arbiter that would rather not mention it.
- **A partial council reads as partial.** If a member fails, the document says so in its first line,
  names who failed and why, and the accounting reports how many actually answered.

Every findings document carries a standing caveat above its conclusions: this is model deliberation,
not verified fact — nothing in it was compiled, executed or tested. A finished run's transcript can
be reopened from the findings panel.

### Attention and cost measurement

- A 15-second sampler classifies your attention into exactly one of five states — `pane`,
  `overhead`, `blurred`, `idle`, `locked` — so "time spent" has a denominator and a known coverage
  percentage rather than being a wall-clock guess.
- **Every figure travels with its denominator.** Chorus reports "43 of 512", never "43", and omits a
  number it cannot source rather than rendering a plausible zero.
- Per-credential spend is recorded where the provider reports usage; where it does not, the figure is
  labelled a floor rather than presented as a total.

## Supported agents

Four harnesses ship, each with an adapter declaring what it can honestly do:

| Agent | Subscription login | API key | Notes |
|---|---|---|---|
| **Claude Code** | ✅ | ✅ | Reasoning effort mapped to Chorus's four levels (`fast` / `balanced` / `deep` / `max`) |
| **Codex** | ✅ | ✅ | Provider routes passed as launch arguments — never written to its config file |
| **Kimi** | ✅ | — | Subscription login only |
| **opencode** | ✅ | ✅ | |

Chorus also probes for `git`, `docker` and `node`, so a missing prerequisite is reported rather than
discovered as a failed launch.

Adapters form a closed, typed registry: an agent that *declares* a capability must *implement* it, and
a unit test fails the build if the two ever disagree.

## Architecture

```
┌─ main process ──────────────────────────────┐
│  SessionManager     owns every PTY          │
│  StorageService     SQLite (better-sqlite3) │
│  CredentialVault    DPAPI envelopes         │
│  CouncilService     multi-model runs        │
│  AttentionTracker   the 15s sampler         │
│  adapters/          claude codex kimi …     │
└────────────────┬────────────────────────────┘
                 │  typed IPC, Zod-validated
                 │  contextBridge preload
┌────────────────┴────────────────────────────┐
│  renderer (Vue 3 + Pinia)                   │
│  panes attach to a sessionId — they never   │
│  spawn a process                            │
└─────────────────────────────────────────────┘
```

Three rules are non-negotiable and hold everywhere:

1. **Sessions live in the main process.** Panes and windows are *views* that attach to a
   `sessionId`. The renderer never spawns a process, so closing a pane cannot orphan an agent.
2. **All IPC is typed and Zod-validated** through a `contextBridge` preload, with validation in main
   on both the inbound and the outbound side. `nodeIntegration` is off.
3. **Business logic lives in pure cores** (`*Core.ts`) importing neither Electron nor SQLite — a
   native module built for Electron's ABI cannot be loaded by the test runner, so logic that is not
   in a pure core is logic that cannot be tested.

**Stack** (locked): Electron 43 · Vue 3 + TypeScript + Vite + Pinia · xterm.js · node-pty ·
better-sqlite3 + drizzle-orm · Zod · pino.

## Security model

The bright line: **no secret value is ever written into another tool's configuration file, in any
mode.** Not by default — never.

A key in a vendor's config file cannot be rotated by the vault, cannot be revoked when its profile is
deleted, and is invisible to this repository's own secret scanner. So instead:

- keys live in DPAPI-encrypted envelopes and are decrypted only when a human clicks Launch;
- they reach the child process as **environment variables**, never as command-line arguments —
  `argv` is world-readable on Windows;
- where a tool must be told about a credential, Chorus passes the **variable's name**, not its value;
- a per-session scrubber sits over the PTY stream, so a secret an agent prints is redacted before it
  reaches the screen or the stored transcript.

`npm run grep:secrets` gates six patterns across the source tree on every change. It does **not**
reach outside the repository, and the code states that limit where it matters rather than implying
coverage it does not have.

## Getting started

**Prerequisites:** Windows 10/11 x64 · Node.js 22+ · Git · at least one agent CLI on your `PATH`
(`claude`, `codex`, `kimi` or `opencode`). Chorus detects what is installed and tells you what is
missing.

```bash
git clone https://github.com/ContactEstablished/Chorus.git
cd Chorus
npm install
npm run dev
```

On first run Chorus opens with an empty project list — add a project, then launch an agent into it.

> **Note on native modules.** `better-sqlite3` is built against Electron's ABI rather than Node's,
> which `.npmrc` pins. If a fresh install fails to compile it, run `npm run rebuild:better-sqlite3`,
> which applies a documented MSVC workaround.

## Building an installer

```bash
npm run dist
```

Produces `release/Chorus Setup <version>.exe` — a per-user NSIS installer (no administrator
elevation) with a Start Menu entry, a desktop shortcut and an uninstaller. Uninstalling removes the
program and **leaves your data** in `%APPDATA%\chorus`, so a reinstall finds your projects where they
were.

The build is **Windows x64** and **unsigned**: SmartScreen warns once on a machine that has not seen
the binary before. Removing that warning requires a paid code-signing certificate.

## Project layout

```
src/
  main/            Electron main process — owns all state and all processes
    adapters/      one per agent CLI, plus the capability registry
    services/      SessionManager, storage, vault, council, attention, git
    db/            drizzle schema; migrations live in storage.ts
  preload/         contextBridge surface — no Zod here (CSP forbids eval)
  renderer/        Vue 3 app: views, components, Pinia stores
  shared/          the IPC contract: channel names + Zod schemas
docs/
  Plan.md          the original product specification
  Features/        per-feature roadmaps, task documents and investigations
  design/          the visual mocks the UI is built against
```

## Development

```bash
npm run dev          # Electron + Vite dev server with HMR
npm run typecheck    # tsc for main/preload, vue-tsc for the renderer
npm test             # Vitest — pure cores, no Electron required
npm run grep:secrets # secret scanner across the source tree
npm run build        # typecheck, then production bundle
```

Four gates run on every change: **typecheck clean**, **the full suite passing and never shrinking**,
**the secret scanner clean**, and — the one that catches what the others cannot — **run the app and
verify the change in it.** A feature that compiles is not a feature that works.

## How this project is planned

Chorus is built in numbered phases, each decomposed into task documents before any code is written,
and every architectural decision is recorded with its reasoning in a roadmap that also records the
decisions which turned out to be **wrong**.

That last part is deliberate. `docs/Features/Foundation/roadmap.md` carries retractions, corrected
measurements and superseded rulings alongside the ones that held — because a decision log that only
remembers its successes teaches nothing. Several measurements in this project were taken three times
before they were right, and the record says so plainly.

Where a change carries real risk — a credential design, a schema, a protocol — it goes to a **council
review** before implementation: the same multi-model deliberation the app ships, used on its own
design.

## License

[Apache License 2.0](LICENSE) — Copyright © 2026 Matthew Wilson.
