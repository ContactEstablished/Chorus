# Chorus — Agent Instructions

Full architecture and roadmap: see docs/PLAN.md. Read it before non-trivial work.

## What this is
Local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple
AI coding agents in parallel terminal panes. Windows-only v1.

## Stack (locked — do not substitute)
Electron · Vue 3 + TypeScript + Vite + Pinia · xterm.js · node-pty · better-sqlite3
· Zod on all IPC boundaries. No React. No alternative state libs.

## Non-negotiable architecture rules
- Sessions live in the MAIN process, owned by SessionManager. Panes/windows are
  views that attach to a sessionId. The renderer never spawns processes.
- All IPC is typed and Zod-validated via a contextBridge preload. No nodeIntegration.
- Secrets: encrypt with Electron safeStorage (DPAPI). Keys are injected as env vars
  into child PTYs at launch — never in CLI args, never written to disk in plaintext,
  never logged or written into transcripts.
- CLI agent flags move fast. Verify current flags against the tool's own docs/--help
  before hardcoding them; don't trust training-data memory for CLI syntax.

## Working style
- Build in the phase order from PLAN.md. Do not jump ahead to UI/settings screens.
- Prefer small, reviewable changes. Explain architectural choices briefly before large edits.
- Ask before adding dependencies not named in the stack.