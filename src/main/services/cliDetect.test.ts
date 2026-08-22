import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveShim } from './cliDetect'
import { MAX_SHIM_BYTES } from './cliShimCore'

/**
 * The filesystem half of the F96 fix. `cliShimCore.test.ts` owns the parsing;
 * this file owns the three questions only a real directory can answer: does the
 * target still exist, is there a node to run a script with, and does an
 * unrecognised shim fall back exactly as it did before.
 *
 * ⚠ FIXTURES ARE BUILT IN A TEMP DIRECTORY, NEVER READ OUT OF `%APPDATA%\npm`.
 * Asserting against this machine's real codex install would make the suite a
 * test of what happens to be installed today — and would fail on any machine
 * that installed it differently, which is precisely the variation this code
 * exists to absorb.
 */
const root = mkdtempSync(path.join(tmpdir(), 'chorus-shim-test-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Write a shim, plus (optionally) the file it points at. */
function fixture(name: string, lines: string[], target: string | null): string {
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  const shim = path.join(dir, `${name}.cmd`)
  writeFileSync(shim, lines.join('\r\n') + '\r\n')
  if (target !== null) {
    const targetPath = path.join(dir, target)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, '')
  }
  return shim
}

const NODE_SHIM_LINES = [
  '@ECHO off',
  'SET dp0=%~dp0',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pkg\\bin\\cli.js" %*'
]

const EXE_SHIM_LINES = [
  '@ECHO off',
  'SET dp0=%~dp0',
  '"%dp0%\\node_modules\\pkg\\bin\\tool.exe"   %*'
]

describe('resolveShim', () => {
  it('spawns a node-script shim as node plus the script, never through cmd.exe', () => {
    const shim = fixture('nodecli', NODE_SHIM_LINES, 'node_modules/pkg/bin/cli.js')
    const resolved = resolveShim(shim)

    expect(resolved).not.toBeNull()
    expect(path.basename(resolved!.file).toLowerCase()).toBe('node.exe')
    expect(existsSync(resolved!.file)).toBe(true)
    expect(resolved!.args).toEqual([path.join(path.dirname(shim), 'node_modules\\pkg\\bin\\cli.js')])
    // The CLI's reported location stays the shim — that is what was installed.
    expect(resolved!.path).toBe(shim)
  })

  it('spawns an executable shim directly, with no interpreter and no args', () => {
    const shim = fixture('execli', EXE_SHIM_LINES, 'node_modules/pkg/bin/tool.exe')
    const resolved = resolveShim(shim)

    expect(resolved).toEqual({
      file: path.join(path.dirname(shim), 'node_modules\\pkg\\bin\\tool.exe'),
      args: [],
      path: shim
    })
  })

  /**
   * ⚠ THE CASE THAT DECIDES WHETHER THIS IS SAFE TO SHIP. A shim whose package
   * has been removed, half-upgraded, or installed by a manager that lays out
   * `node_modules` differently must fall back to cmd.exe — the route that
   * worked yesterday — rather than fail to launch.
   */
  it('declines when the target named by the shim does not exist', () => {
    const shim = fixture('missing', NODE_SHIM_LINES, null)
    expect(resolveShim(shim)).toBeNull()
  })

  it('declines a shim template it does not recognise', () => {
    const shim = fixture('unknown', ['@ECHO off', 'echo hello %*'], null)
    expect(resolveShim(shim)).toBeNull()
  })

  it('declines a file too large to be a shim', () => {
    const shim = fixture('huge', [...NODE_SHIM_LINES, 'REM ' + 'x'.repeat(MAX_SHIM_BYTES)], 'node_modules/pkg/bin/cli.js')
    expect(resolveShim(shim)).toBeNull()
  })

  it('declines a shim that is not there at all', () => {
    expect(resolveShim(path.join(root, 'nope', 'nope.cmd'))).toBeNull()
  })
})
