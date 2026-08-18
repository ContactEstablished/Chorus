# Implementation Spec 5-2 — Local transcription: `whisper-cli` as a child process

_Normative companion to [`../Tasks/Task-5-2.md`](../Tasks/Task-5-2.md).
Written 2026-08-17 against `4369954`._

---

## §0 — D4 the binary before writing one line of argv

**Do this first and paste the output into `_verify/5-2/whisper-help.txt`.**

```
whisper-cli.exe --help
```

`CLAUDE.md` is explicit: *"CLI agent flags move fast. Verify current flags
against the tool's own docs/`--help` before hardcoding them; don't trust
training-data memory for CLI syntax."* This program has already paid for
ignoring that (D87: `-c` is `--continue` on kimi, **not** `--config`).

**The flags below are EXPECTED, not KNOWN. Replace this table with the observed
one and note any difference:**

| Purpose | Expected flag |
|---|---|
| model file | `-m <path>` |
| input wav | `-f <path>` |
| suppress timestamps | `-nt` / `--no-timestamps` |
| language | `-l en` |
| machine-readable output | `-oj` / `--output-json` |
| thread count | `-t <n>` |

⚠ **Prefer machine-readable output over scraping the console.** If `--output-json`
exists, use it: whisper's plain output interleaves progress and timing with the
transcript, and a scraper will one day eat a timing line as speech.

---

## §1 — Distribution, and the two paths that will diverge

**Source, measured 2026-08-17:** whisper.cpp **v1.9.2** (published 2026-08-04),
asset `whisper-bin-x64.zip` — **7.9 MB zipped, 19.9 MB unpacked, 37 entries**.

### Ship these, and nothing else

| File | Size | Why |
|---|---|---|
| `whisper-cli.exe` | 0.46 MB | the engine |
| `whisper.dll` | 1.30 MB | its library |
| `ggml-base.dll`, `ggml.dll` | ~0.9 MB | ggml core |
| `ggml-cpu-*.dll` (9 files) | ~7 MB | **runtime CPU dispatch** — sse42 / sandybridge / haswell / skylakex / icelake / cascadelake / alderlake / cannonlake / x64 |

**≈ 8 MB of the 19.9 MB.** ⚠ **Do not prune the `ggml-cpu-*` family to "the one
this machine needs".** They are selected at runtime by CPU feature detection;
shipping only the dev machine's variant produces a build that works here and
fails on a different CPU — the worst possible failure distribution.

**Do NOT ship:** `whisper-talk-llama.exe` (2.44 MB), `SDL2.dll` (2.38 MB), the
parakeet tools, `wchess`, `whisper-server`, `whisper-stream`, or any `test-*.exe`.

### ⚠ Dev and packaged paths differ, and this is where it breaks

```ts
// ⚠ ONE RESOLVER, BOTH PATHS, AND BOTH PROVEN.
// dev:      <repo>/resources/whisper/whisper-cli.exe
// packaged: join(process.resourcesPath, 'whisper', 'whisper-cli.exe')
// A path that works only under `electron-vite dev` is the classic way this
// ships broken, because every unit test and every dev drive passes.
const whisperBinary = app.isPackaged ? /* … */ : /* … */
```

Bundle via electron-builder `extraResources`. **Verify in a packaged build** —
this is an acceptance criterion, not a nicety.

---

## §2 — The model, and D159

**`base.en` is the default (D159).** `Plan.md` commits to `small.en`; that line
is corrected in this commit.

| Model | Measured size | Role |
|---|---|---|
| `ggml-tiny.en.bin` | 74.1 MB | not offered in v1 |
| **`ggml-base.en.bin`** | **141.1 MB** | **v1 default** |
| `ggml-small.en.bin` | 465.0 MB | opt-in upgrade, exposed in 5-4 |
| `ggml-medium.en.bin` | 1462.7 MB | not offered in v1 |

URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<name>.bin`
— all four returned **HTTP 200 with a `content-length`** on 2026-08-17.

Destination: `join(app.getPath('userData'), 'models', 'ggml-base.en.bin')`.

### The download is the risky part, and its failure modes are the feature

```ts
// ⚠ DOWNLOAD TO `.part`, RENAME ON SUCCESS — the scrollback mirror's discipline
// (Task 4a-4) for the same reason: an abort at the FINAL path leaves a file
// that exists, is the wrong size, and looks installed.
//
// ⚠ AND "PRESENT" IS NOT "VALID". Check the size against the expected
// content-length. A truncated 40 MB base.en is the nastiest case here: whisper
// does not politely refuse it, and a partially-valid model produces plausible
// garbage — a failure that reads as "voice is inaccurate" rather than
// "the download broke".
```

Required behaviours:

- Progress reported monotonically (bytes received / total).
- **Offline** at first use → a clear in-app error naming the size and offering
  retry. ⚠ **It must not be a toast** — toasts are proven dead on this machine
  (`ToastEnabled=0`, every exit toast failing `HRESULT: -2143420140`).
- Abort mid-flight → **no file at the final path**.
- Disk full → typed error, `.part` cleaned up.
- Size mismatch on an existing file → re-download, do not run.

---

## §3 — `whisperCore.ts` (new, pure)

### WAV assembly

whisper-cli takes a WAV file. 5-1 produced Int16 mono at 16 kHz, so the header
is fixed and the body is a copy.

```ts
export function wavHeader(sampleCount: number): Uint8Array
// RIFF/WAVE, fmt chunk 16 bytes, PCM (format 1), 1 channel, 16000 Hz,
// byteRate 32000, blockAlign 2, bitsPerSample 16, then `data`.
// ⚠ Both size fields are LITTLE-ENDIAN and both are counted in BYTES, not
// samples. Writing sampleCount where byteCount belongs yields a file that
// opens, plays as half-length, and transcribes as truncated speech — i.e. it
// fails as a QUALITY problem rather than as an error.
```

A zero-length capture must produce a **valid empty** WAV, not a malformed one —
the user who taps the hotkey by accident should get an empty transcript, not a
crash.

### Output parsing

> **⚠ CORRECTED 2026-08-17 AT IMPLEMENTATION — F81. THE REQUIREMENT BELOW WAS
> RIGHT AND ITS MECHANISM WAS WRONG. READ THIS BEFORE THE PARAGRAPH IT REPLACES.**
>
> The goal stands exactly as written: *a user who says nothing must get nothing.*
> **But this engine and this model never emit those markers.** Measured against
> whisper.cpp v1.9.2 + `ggml-base.en.bin`: given pure digital silence they
> transcribe the word **`" you"`** — at 0.3 s, 1 s, 3 s, 10 s and 30 s, and
> identically for quiet room tone. `[BLANK_AUDIO]` appeared **zero times in
> eleven runs**, and **no flag suppresses it**: `-sns` / `--suppress-nst`,
> `-nth 0.9`, `-nth 0.99` and `-nf` were all tried, while the `jfk.wav` control
> still transcribed correctly.
>
> **So a marker filter is not the control — it passes every test this section
> asks for and still injects "you" into an agent's prompt on every accidental
> hotkey tap**, which is worse than the marker case because `[BLANK_AUDIO]` is
> obviously wrong on sight and "you" reads as something the user might have said.
>
> **The primary defence is an ENERGY GATE BEFORE TRANSCRIPTION** — `hasSpeech`
> in `whisperCore.ts`, so silent audio never reaches the engine at all. Measured
> anchors: real speech **0.14210** RMS (loudest 100 ms window **0.38238**),
> threshold **0.01000**, live microphone ambient on this machine **0.00150**.
> ⚠ It is a **peak-window** test, not a whole-file RMS: a real dictation is
> mostly pause, and averaging would discard the shortest, most deliberate
> utterances. Full evidence: `_verify/5-2/F-silence-hallucination.md`.
>
> ⚠ **AND A ZERO-SAMPLE CAPTURE WRITES NO JSON AT ALL** — `whisper-cli` exits 0,
> prints nothing, and `-oj` produces no file. "JSON absent + exit 0" is a legal
> outcome meaning *empty transcript*, not a failure.

Map whisper's non-speech markers to an **empty transcript**, not to text:
`[BLANK_AUDIO]`, `(silence)`, `[SILENCE]`, `[MUSIC]`, and the bare `[…]` shape.
Unit-test each. A user who says nothing must get nothing — surfacing
`[BLANK_AUDIO]` into an agent's prompt would be absurd and is exactly what a
naive passthrough does.

**Retained as DEFENCE IN DEPTH, not as the silence control** (F81): D159's
`small.en` upgrade path is a different model and may well behave differently, and
a marker reaching an agent's prompt is a bad enough outcome to keep two defences
against. It must never be *reported* as the silence protection.

---

## §4 — `whisper.ts` (new, impure)

Follow `services/git.ts`, which already documents each choice:

```ts
execFile(binary, args, {
  cwd,                 // explicit
  timeout: …,          // bounded — a hung transcribe must not hang the app
  windowsHide: true,   // no console flash
  maxBuffer: …,        // bounded
})
```

⚠ **Argument arrays only. Never a shell string.** A transcript path is
user-influenced only indirectly here, but the rule is absolute in this codebase
and `git.ts` states it: *"argument arrays only, never a shell"*.

Every effect injected (`spawn`, `fs`, `fetch`, clock) so `whisper.test.ts` can
drive the failure paths without a binary present.

### Errors carry no content

```ts
// ⚠ NO TRANSCRIPT TEXT IN ANY ERROR OR LOG LINE, AT ANY LEVEL.
// This is the first task in the app's history to hold a transcript, so this is
// where the discipline starts. G4's secret-grep cannot see this category — it
// greps for key SHAPES — so the control here is review plus the phase's own
// grep. An error says WHICH STAGE failed and how long the audio was. Never what
// was said.
```

---

## §5 — Wiring into `voice.ts`

Replace 5-1's discard: frames → `Int16Array` concat → WAV → `whisper-cli` →
transcript. Hold the **original transcript** as the source of truth (D161 — in
memory, since no table exists), and surface `finalizing` → `ready-for-review`.

⚠ **Concatenate once, at the end.** Do not grow a `Buffer` per frame — that is
O(n²) copying across a two-minute capture. Collect the frames and join once.

---

## §6 — Verification

### Deterministic

```
npm run typecheck                                     # 0
npx vitest run                                        # count printed; NEVER --reporter=basic
npm run grep:secrets                                  # clean

node -e "console.log(Object.keys(require('./package.json').dependencies).length)"    # 8 — unchanged
grep -rn "exec(\|shell: true" src/main/services/whisper*.ts                          # ZERO
grep -rn "logger\." src/main/services/whisper*.ts src/main/services/voice.ts         # review each
```

### Runtime — in this order

1. **`--help` captured** to `_verify/5-2/whisper-help.txt`; §0's table updated to
   match, differences noted.
2. **Cold first run**: no model present → real **141.1 MB** download with
   progress → transcription succeeds. Record the wall-clock.
3. **⭐ THE OFFLINE FLOOR — disable the network adapter** and dictate. It must
   transcribe. This is the task's headline claim; **argue it and it is not
   proven, drive it and it is.**
4. **Known sentence** in, recognisably that sentence out. Paste both into the
   evidence directory.
5. **Truncated model**: chop ~20 MB off the file → the app detects the size
   mismatch and re-downloads rather than running it.
6. **Abort mid-download** → no file at the final path, `.part` cleaned up.
7. **Silence** → empty transcript, not `[BLANK_AUDIO]`.
8. **Packaged build** → binary resolves from `process.resourcesPath`.

### What a reviewer should distrust

- A flag table that matches this spec **exactly** — this spec's table is a
  guess and says so. Identical output means `--help` was probably not run.
- `ggml-cpu-*` pruned to one file "because the others are unused".
- Size-zero used as the only validity check on the model.
- Progress computed from a `content-length` that was never checked for presence.
- A `Buffer.concat` inside the frame loop.
- Any claim about the packaged path that was not driven in a packaged build.
- An error message that quotes the transcript.
