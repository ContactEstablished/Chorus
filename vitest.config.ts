import { defineConfig } from 'vitest/config'

// Pure-logic unit tests only. Tests never import storage.ts or better-sqlite3:
// the native binding is built for the Electron ABI (NODE_MODULE_VERSION 148,
// see D2), while Vitest runs under Node 22 (127) — the first `new Database()`
// would throw an ABI mismatch. Only src/shared/layout.ts is exercised.
// No `globals: true` — test files import { describe, it, expect } explicitly
// so both tsconfig typecheck passes (node + web) resolve the same symbols.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // ⚠ RAISED FROM VITEST'S 5000ms DEFAULT, AND IT IS NOT MASKING A SLOW TEST.
    // `adapters.test.ts` calls `buildLaunch` 46 times, and EVERY call runs
    // `resolveCli` -> `execFileSync('where.exe', …)` — a synchronous process
    // spawn. That freshness is deliberate and documented (`cliDetect.ts:176`):
    // a launch resolves the binary fresh on every spawn so an agent upgraded
    // mid-session is picked up, which is exactly why `resolveCli` must NOT be
    // memoised to make this faster.
    //
    // Under the full parallel suite one of those spawns occasionally takes
    // multiple seconds on Windows, and whichever test is holding it then blows
    // the 5 s budget. Measured: the failure moved between DIFFERENT, unrelated
    // claude argv tests run to run, always at 5.2-5.5 s, never when
    // `adapters.test.ts` ran alone, and never on a stashed clean tree.
    // A per-test assertion budget of 5 s is simply wrong for a suite that
    // shells out; the green path is unaffected, since a timeout costs nothing
    // when it is not hit.
    testTimeout: 20_000
  }
})
