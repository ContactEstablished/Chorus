# Implementation Spec 3b-4 — The Council View, Brief In → Findings Out

_Governs exact contents for `Task-3b-4.md`. Task doc wins on **what**; this spec wins on **how**._

## 1. The path boundary — main only, and one path not two

```ts
validateBriefPath(raw: string): { ok: true; path: string } | { ok: false; reason: string }
```

Ordered refusals, each returning before the next is attempted:

1. **Not absolute** (`path.isAbsolute`) — reject. A relative path resolves against main's cwd, which is not the user's mental model and is a different directory in dev and in a packaged build.
2. **Contains a null byte** — reject before touching the filesystem. Node throws on these, but a thrown error is a worse refusal than a named one.
3. **Not `.md`** (case-insensitive) — reject. Narrow by construction; the feature reads briefs.
4. **Does not exist, or is not a regular file** (`fs.statSync().isFile()`) — reject. `existsSync` alone passes a directory, which is the `session:launch` cwd check's own lesson.
5. **Exceeds a size cap** — reject. A brief is a document; a multi-megabyte file is either a mistake or an attack on the cost envelope, since **every member pays input tokens for every byte**.

**⚠ Normalize with `path.resolve` and re-check after normalizing.** A traversal (`..`) that resolves inside the allowed directory is fine; one that escapes is not. Checking before normalizing checks the wrong string.

**The findings path is DERIVED, never supplied:**

```ts
findingsPathFor(briefPath) => join(dirname(briefPath), `${basename(briefPath, '.md')}-Findings.md`)
```

One validated input, one computed output. **A second renderer-supplied path would be a second boundary to get right, and it would be an arbitrary-file-write primitive** — strictly worse than the read. Deriving it removes the class.

**Refuse rather than overwrite** an existing findings file, or suffix it. Silently replacing a previous council's output destroys the record §4 exists to keep. **Whichever is chosen, state it in the commit.**

### 1.1 The dialog

`dialog.showOpenDialog` in **main** (the `project:add` precedent), filtered to `.md`, **cancel returning a structured no-op** rather than an error. The renderer never sees a path it did not receive from this call, and main re-validates anyway — the dialog is a convenience, not the boundary.

## 2. The sanitization pre-pass (D63(f))

```ts
scanBriefForSecrets(text: string): readonly { pattern: string; line: number }[]
```

**Imports the pattern list from `src/main/services/secret-patterns.json`** — the same file `logger.ts`'s `scrubSecrets` and `scripts/secret-grep.mjs` already share. **Zero new pattern literals.** That file's header states the reason: one list, so the gate can never test different shapes than the scrubber. A second list here would silently reintroduce exactly that divergence.

**Report the pattern NAME and the LINE NUMBER. Never the matched value**, not in a log, not in a refusal message, not in the view. A refusal that echoes the secret it found is a leak wearing a warning's clothes — and it would be written to a log file the user might then share.

**Recommended behaviour on a hit: REFUSE the run**, naming the pattern and line so the user can fix the brief. The alternative — redact and proceed — quietly changes the text five models are about to reason about, which corrupts the deliberation *and* buries the warning. **This is a real decision; make it explicitly and say which in the commit.**

**⚠ The claim it licenses is bounded, and the bound goes in the UI, not just the docs.** The pre-pass catches *known shapes*. It cannot catch a credential that looks like prose, a partial key, or a shape no pattern covers. See `Task-3b-4.md` for the only sentence this task may ship.

## 3. Findings format

Match §4's existing shape — the format `CouncilBrief-3b.0-Findings.md` uses, because the whole point of D27 is that native output drops into the same workflow: a synthesized verdict, per-model positions, issues ranked by severity, **dissents preserved as their own section**, and action items.

**Two things the writer must include that a naive template omits:**

1. **Provenance** — which members ran, on which models, at what time, and the run id. A findings file whose authorship cannot be reconstructed is not usable as a record.
2. **⚠ A standing caveat, in the file itself:** these findings are **model deliberation, not verified fact.** CR-3b.0 is the live evidence — its rulings were sound and its verbatim TypeScript had four compile errors, because it had the brief and not the repo. **The file must say so**, or a later reader will cite it as verification.

## 4. Renderer

**`stores/council.ts`** — `{ runId, phase, round, members, messages, findings, error }`, a `loadSeq` supersede token, and the `council:progress` subscription registered on mount and **removed on unmount**. The `TerminalPane` leak (`de98679`) is the precedent: listeners registered after an `await` in `onMounted` leak if the component unmounts mid-attach. **Bail out after any `await` if the component is gone.**

**`CouncilView.vue`** — roster, live deliberation, findings. Reuses the `LaunchDialog` / `CommandPalette` overlay and focus-trap idiom.

**Three rendering rules that are not styling:**

1. **Progress text arrives already scrubbed** from `SessionOutput.onText`. The view never sees a raw stream and must not be given a second channel that does.
2. **A partial run reads as partial.** If a member refused or timed out, the view says so beside the roster. A council that ran with three of five members must not render as five.
3. **Findings are presented as deliberation**, not as verification — the same caveat as §3.2, visible in the UI rather than only in the file.

**`palette/commands.ts`** — one command, `id: 'council.run'`, label `Run council…`, `enabled()` false without an active project. **Pure registry rules hold**: no store import, no `window.chorus`, no Zod. The existing `fuzzyFilter` excludes disabled commands, so a disabled entry simply does not render.

## 5. Verification specifics

- **The path table runs in main with no filesystem** for the pure refusals, and against real temp files for the stat-dependent ones.
- **The false-positive guard matters as much as the true positives.** A pre-pass that refuses every brief containing a git SHA is a feature nobody can use. `logger.test.ts` already establishes the fixtures — a 40-char SHA, a Windows path, a UUID, a `chorus/<repo>/<8hex>` branch name — and they must pass through clean.
- **`grep:secrets` must run over the WRITTEN FINDINGS FILE**, not only over `src/`. It is the one artifact in this phase whose content Chorus did not author, and it is written to the repo.
- **CDP-driven Vue forms need a microtask tick between `input` and the submit click**, or the click lands on a stale `:disabled`. This has broken a drive in three separate tasks.
- **The dev window is not foregrounded by default** (F29) and other apps steal foreground mid-run — foreground deliberately before any screenshot check.

## 6. What this spec deliberately does not decide

- **Overwrite vs suffix** for an existing findings file (§1) — decide and narrate.
- **Refuse vs redact** on a sanitization hit (§2) — recommended refuse; decide and narrate.
- **Rendering the run archive.** Runs persist and nothing browses them; a history surface is a later phase's call.
- **Re-running a council on the same brief.** Nothing prevents it and nothing special-cases it; whether findings accumulate or replace falls out of the overwrite ruling.
