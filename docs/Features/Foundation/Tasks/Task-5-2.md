# Task 5-2 — Local transcription: `whisper-cli` as a child process

_Phase 5, task 2 of 4. Authored 2026-08-17 against `4369954`._

---

## Source Of Truth

| Document | Owns |
|---|---|
| [`Phase-5-Overview.md`](Phase-5-Overview.md) | Ground facts, the D4 measurements this task is built on, D159 |
| [`../Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) §5, §10 | The offline floor and the Chorus-specific failure modes |
| [`../ImplementationSpecs/ImplementationSpec-5-2.md`](../ImplementationSpecs/ImplementationSpec-5-2.md) | Exact argv, parsing, paths, runtime verification |
| `CLAUDE.md` | Main owns processes; verify CLI flags against the tool's own `--help`, never from memory |
| `roadmap.md` §6 | **D159** (base.en default) · **D147(d)** (the `docker` CLI precedent this follows) · **D161** (no migration) |

---

## Initial Starting Point — verified 2026-08-17 at `4369954`

| Fact | Value |
|---|---|
| Existing child-process adapters to imitate | `services/git.ts` (promisified `execFile`, argument arrays only, never a shell, explicit cwd, timeout, `windowsHide`) and `services/docker.ts` + `dockerCore.ts` (D147(d): the **CLI**, not a library binding) |
| `MIGRATIONS.length` | **20** — and it stays there (D161) |
| Runtime dependencies | **8** — and this task adds **none** |
| whisper.cpp current release | **v1.9.2**, published **2026-08-04** |
| Windows x64 bundle | `whisper-bin-x64.zip` — **7.9 MB zipped, 19.9 MB unpacked, 37 entries** |
| The binary Chorus needs | `whisper-cli.exe` **0.46 MB**, plus `whisper.dll` 1.3 MB, `ggml-base.dll` 0.64 MB, `ggml.dll`, and the `ggml-cpu-*.dll` runtime CPU-dispatch family (sse42 / sandybridge / haswell / skylakex / icelake / cascadelake / alderlake / cannonlake / x64) |
| Model sizes, measured live | `tiny.en` **74.1 MB** · **`base.en` 141.1 MB ← D159's default** · `small.en` **465.0 MB** · `medium.en` 1462.7 MB |
| Model URL shape | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<name>.bin` — all four returned **HTTP 200** with a `content-length` |

> **✅ THE DISTRIBUTION SHAPE IS THE CHEAPEST ONE AVAILABLE, AND IT WAS MEASURED
> RATHER THAN HOPED FOR.** whisper.cpp ships **prebuilt x64 Windows binaries**.
> There is **no source build, no `node-gyp`, no native addon and therefore no
> Electron ABI coupling at all** — the engine is a **child process**, which is
> exactly where `CLAUDE.md` wants process ownership and exactly the ruling
> **D147(d)** took when it chose the `docker` CLI over `dockerode`.
>
> ⚠ **An intermediate finding of the D4 pass said "Win32 only, no x64" and was
> wrong** — a `/win|windows/i` filter over the release assets misses
> `whisper-bin-x64.zip`, which carries no "win" in its name and is the
> most-downloaded Windows asset in the release by 30×. Recorded because it is
> **F77's lesson one phase later**: a conclusion resting on *"the search returned
> nothing"* has assumed its corpus.

---

## Goal

Turn 5-1's PCM frames into text, entirely offline. Ship the `whisper-cli.exe`
child-process adapter, resolve and (on first use) download the **`base.en`**
model, and produce a transcript in main. **This task completes the offline
floor: no network at transcription time, no key, no vendor, no LLM.**

---

## ⚠ D159 corrects `Plan.md` §9, and the reason is a number nobody had

`Plan.md` §9 commits to downloading **`small.en` on first use**. Measured, that
is **465.0 MB** — so the first dictation a user ever attempts is also a 465 MB
download, on a path the VoicePlan's own §10 calls *"the one most likely to be
tested least"*.

**D159 makes `base.en` (141.1 MB) the default and `small.en` an opt-in upgrade
in settings.** 3.3× smaller, adequate for close-mic English dictation, which is
the whole v1 use case. **`Plan.md` §9 is corrected in this task's commit**, not
left to contradict the shipped behaviour.

**The upgrade path is built here but exposed in 5-4** — this task resolves
whichever model is configured; the *setting* that chooses it is 5-4's.

---

## Exact Scope

**Create:**

| File | Purpose |
|---|---|
| `src/main/services/whisperCore.ts` | **Pure.** argv construction, stdout/JSON parsing, model-file identity and expected sizes, WAV header construction from Int16 PCM. No `fs`, no `child_process`, no clock. |
| `src/main/services/whisperCore.test.ts` | Unit tests |
| `src/main/services/whisper.ts` | The impure half: `execFile` the binary, resolve the model, download on first use with progress, every effect injected |
| `src/main/services/whisper.test.ts` | Unit tests with injected spawn/fs/fetch |

**Edit:**

| File | Change |
|---|---|
| `src/main/services/voice.ts` | Hand a completed capture's frames to the transcriber; hold the **original transcript** as the source of truth |
| `src/main/ipc.ts` | Transcription status/result on the existing `voice:*` surface |
| `src/shared/ipc.ts` | Schema additions; **new channels only if genuinely required** — re-count if so |
| `src/shared/ipc.test.ts` | Re-count both assertions if the count moved (G6) |
| `docs/PLAN.md` | §9's `small.en` → `base.en` correction, citing D159 |
| `electron-builder` config | Bundle the curated binary set as an extra resource |

---

## ⚠ Bundle the binaries; download only the model

**Coordinator decision, from the measurement.** The curated set Chorus needs —
`whisper-cli.exe` + `whisper.dll` + `ggml*.dll` — is roughly **8 MB** of the
19.9 MB zip. The other 12 MB is `whisper-talk-llama.exe`, `SDL2.dll`, the
parakeet tools, `wchess` and a dozen test executables, **none of which ship**.

- **Binaries are bundled** — 8 MB in the installer, and **zero first-run network
  dependency for the engine itself**.
- **Only the model is downloaded** (141 MB, once), because it is too large to
  bundle and is the one piece a user might legitimately want to change.

This means **exactly one first-run download**, not two, and the failure mode is
correspondingly narrower.

⚠ **The dev and packaged paths differ and this is where it will break.** Under
`electron-vite dev` the binaries sit in the repo; in a packaged build they sit
under `process.resourcesPath`. Resolve through one helper that handles
`app.isPackaged`, and **prove both** — a path that works only in dev is the
classic way this ships broken.

---

## Non-Goals

- **No cloud STT** (D155). No STT vendor, no audio in any `fetch` body, no
  `connect-src`. The only network call this task makes is **downloading a model
  file from HuggingFace**, and it happens once.
- **No refinement, no LLM, no `createApiSession`** (5-4).
- **No hotkey, no overlay, no injection** (5-3). The transcript stops in main.
- **No settings UI** — the model choice is *read* here, *chosen* in 5-4 (D76).
- **No migration** (D161). `MIGRATIONS.length` stays **20**.
- **No new runtime dependency.** No `nodejs-whisper`, no `smart-whisper`
  (`node-gyp rebuild` on install — the better-sqlite3 trap, and last published
  2024), no `@xenova/transformers` (WASM in the renderer, which F80's CSP
  forbids anyway).
- **No transcript text in any log**, at any level. This is the task that first
  *has* a transcript, so this is where the discipline starts.
- **No streaming/interim results** — finalize-on-release, per the Overview.
- **Do not revert or commit** the pre-existing uncommitted doc changes.

---

## Dependencies

**Task 5-1** — the frames, the envelope, and `voice.ts`'s session ownership.

---

## Step-by-step Work

1. **D4 the binary before writing one line of argv.** Unpack the bundle, run
   `whisper-cli.exe --help`, and **write the observed flags into the spec**.
   `CLAUDE.md` is explicit: verify flags against the tool's own output, never
   from training memory. The flags below are *expected*, not *known*:
   `-m <model>`, `-f <wav>`, `-nt` (no timestamps), `-l en`, `-oj`/`--output-json`.
2. **`whisperCore.ts` first**, pure and tested: WAV header from Int16 mono
   16 kHz, argv builder, output parser.
3. **Model resolution**: `%APPDATA%/chorus/models/ggml-base.en.bin`. Present and
   the right size → use it. Absent → download with progress.
4. **The download's failure modes are the feature here** — offline, mid-flight
   failure, disk full, and a **truncated file that looks present**. Verify the
   size against the expected `content-length`; a partial file must never be
   accepted. Download to `.part` and rename on success — the `.tmp` discipline
   Task 4a-4 used for the scrollback mirror.
5. **Spawn** via `execFile` with an argument array, explicit cwd, `windowsHide`,
   a timeout, and a bounded `maxBuffer` — the `git.ts` shape, which already
   documents each of those choices.
6. **Wire into `voice.ts`**: frames → WAV → transcribe → the original transcript
   held in memory as the source of truth (D161).
7. **Correct `Plan.md` §9** in the same commit.

---

## Test Expectations

- WAV header: correct RIFF/fmt/data sizes for 16 kHz mono Int16; a zero-length
  capture produces a valid (empty) file rather than a corrupt one.
- argv builder: model path and wav path quoted/passed as array elements, never
  concatenated into a shell string.
- Output parser: normal output, empty transcript, and whisper's own
  non-speech markers (`[BLANK_AUDIO]`, `(silence)`) mapped to an empty result
  rather than surfaced as text.
- Model resolution: present / absent / **present-but-truncated** → the third
  must trigger a re-download, not a corrupt run.
- Download: progress reported monotonically; a mid-flight abort leaves **no**
  file at the final path.
- Spawn failure, non-zero exit, and timeout each produce a typed error carrying
  **no transcript content**.

**Expect roughly +35 to +50 tests.**

⚠ **What tests cannot reach:** the real binary, real audio, and the real
download. Runtime gates below.

---

## Verification Commands

```
npm run typecheck                 # 0
npx vitest run                    # >= 5-1's total + new; NEVER --reporter=basic
npm run grep:secrets              # clean

# The engine is a child process, not a native module (no new deps)
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"   # expect 8

# No migration (D161)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log(i.elements.length)"   # expect 20

# No shell string anywhere in the spawn path
grep -rn "exec(\|shell: true" src/main/services/whisper*.ts        # expect ZERO

# Plan.md §9 corrected
grep -n "small.en\|base.en" docs/PLAN.md                            # base.en is the default; small.en named as the upgrade

# No transcript in logs
grep -rn "logger\." src/main/services/whisper*.ts src/main/services/voice.ts   # review every hit
```

### Runtime gates (G2)

1. **`--help` was read.** The spec's flag table matches the installed binary's
   own output, pasted into the evidence directory.
2. **First run downloads.** With no model present, a real download of
   **141.1 MB** completes with progress, and the file's size matches exactly.
3. **The offline floor holds.** With **the network disabled**, a dictation still
   transcribes. This is the task's headline claim and it must be driven, not
   argued.
4. **Real speech, real text.** Speak a known sentence; the transcript is
   recognisably that sentence.
5. **Truncated model is rejected.** Truncate the model file by a few MB; the app
   re-downloads rather than running a corrupt model.
6. **Packaged path works.** Verified in a packaged build, not only under
   `electron-vite dev`.

---

## Acceptance Criteria

- [ ] `whisper-cli.exe --help` output captured in `_verify/5-2/` and the spec's
      flags match it.
- [ ] Curated binary set bundled (~8 MB); `whisper-talk-llama`, `SDL2.dll`,
      parakeet and the test executables are **not** shipped.
- [ ] Resolution works in **both** dev and packaged builds.
- [ ] `base.en` is the default (D159); `Plan.md` §9 corrected in this commit.
- [ ] A truncated model is detected and re-fetched.
- [ ] **Transcription succeeds with the network off.**
- [ ] Runtime dependencies still **8**; `MIGRATIONS.length` still **20**.
- [ ] No transcript text in any log line.
- [ ] typecheck 0 · vitest green with a printed count · `grep:secrets` clean.

---

## Review Checklist

- Were the flags **read from the binary**, or recalled? Ask for the `--help`
  paste; `CLAUDE.md` exists because of this exact failure.
- Is the spawn an argument array with `windowsHide` and a timeout, or did a
  shell string creep in?
- Is a **truncated** model distinguished from a missing one, or does size-zero
  logic quietly accept a 40 MB partial?
- Does the download write to a temp path and rename, or straight to the final
  path where an abort leaves poison?
- Is the packaged path **proven**, or merely written?
- Does any error message or log line embed transcript content?
- Is the original transcript held as the source of truth, never overwritten by a
  later refinement (the source document's clearest rule, enforced in memory)?
