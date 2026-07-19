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
    include: ['src/**/*.test.ts']
  }
})
