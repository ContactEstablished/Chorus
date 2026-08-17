# whisper.cpp binaries — provenance

Vendored third-party binaries. **Do not hand-edit, and do not add to this
directory casually** — everything here ships inside the installer.

| Fact | Value |
|---|---|
| Project | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Release | **v1.9.2**, published 2026-08-04 |
| Asset | `whisper-bin-x64.zip` (7.81 MB zipped, 19.88 MB / 37 files unpacked) |
| Asset sha256 | `49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a` |
| Licence | MIT |
| Vendored | 2026-08-17, Task 5-2 |

## What is here, and why each file

**13 files, 9.54 MB** — the curated subset of the 37-file archive.

| File | Size | Why |
|---|---|---|
| `whisper-cli.exe` | 0.46 MB | the engine Chorus spawns |
| `whisper.dll` | 1.30 MB | its library |
| `ggml-base.dll`, `ggml.dll` | 0.70 MB | ggml core |
| `ggml-cpu-*.dll` × 9 | 7.08 MB | **runtime CPU dispatch** |

### ⚠ DO NOT PRUNE THE `ggml-cpu-*` FAMILY

The nine variants — `sse42`, `sandybridge`, `haswell`, `skylakex`, `icelake`,
`cascadelake`, `alderlake`, `cannonlake`, `x64` — are selected **at runtime by
CPU feature detection**. Keeping only "the one this machine needs" produces a
build that works on the developer's machine and fails on a different CPU, which
is the worst possible failure distribution: it passes every test you run and
breaks for a subset of users you cannot reproduce.

Observed on the dev machine: `load_backend: loaded CPU backend from
ggml-cpu-alderlake.dll`. A different CPU loads a different one of the nine.

## What is deliberately NOT here

`whisper-talk-llama.exe` (2.44 MB), `SDL2.dll` (2.38 MB), `whisper-server.exe`,
`whisper-stream.exe`, `whisper-command.exe`, `whisper-lsp.exe`,
`whisper-bench.exe`, `whisper-vad-speech-segments.exe`, `whisper-quantize.exe`,
the `parakeet*` family, `wchess.exe`, and every `test-*.exe` — **10.35 MB not
shipped.** None is on any code path Chorus has.

## Upgrading

1. Download the new release's `whisper-bin-x64.zip` and record its sha256 above.
2. Copy **only** the 13 files listed above.
3. ⚠ **Re-run `whisper-cli.exe --help` and diff it against
   `_verify/5-2/whisper-help.txt`.** `CLAUDE.md`'s rule is that CLI flags are
   verified against the tool's own output, never recalled — and this project has
   already paid for ignoring it (D87). The argv in `whisperCore.ts` is built from
   that captured output.
4. Re-run the silence fixture. The measured behaviour that the whole design turns
   on — silence transcribing as the word `" you"` rather than `[BLANK_AUDIO]` —
   is a property of the engine + model, and a new release could change it in
   either direction. See `_verify/5-2/F-silence-hallucination.md`.

## The model is NOT here

`ggml-base.en.bin` (141.1 MB) is downloaded once at first use into
`userData/models/`. It is far too large to vendor, and it is the one piece a user
may legitimately want to change (D159 makes `small.en` an opt-in upgrade).
