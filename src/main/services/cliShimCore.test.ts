import { describe, expect, it } from 'vitest'
import { MAX_SHIM_BYTES, parseNpmShim } from './cliShimCore'

/**
 * ⚠ THE THREE FIXTURES BELOW ARE THE REAL SHIMS ON THIS MACHINE, COPIED BYTE
 * FOR BYTE ON 2026-08-21 — not written from npm's documentation. They are CRLF,
 * which is itself part of what the parser has to survive, so they are built by
 * joining on `\r\n` rather than written as template literals a formatter could
 * quietly normalise.
 *
 * Sizes at capture: codex.cmd 341 bytes, opencode.cmd 148, kimi.cmd 351.
 * They cover the two shapes npm emits — a node script and a direct executable —
 * and the third is a second instance of the first with a `.mjs` entry point.
 */
const crlf = (lines: string[]): string => lines.join('\r\n') + '\r\n'

const CODEX_SHIM = crlf([
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*'
])

const OPENCODE_SHIM = crlf([
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*'
])

const KIMI_SHIM = CODEX_SHIM.replace(
  '\\node_modules\\@openai\\codex\\bin\\codex.js',
  '\\node_modules\\@moonshot-ai\\kimi-code\\dist\\main.mjs'
)

const NPM_DIR = 'C:\\Users\\matth\\AppData\\Roaming\\npm'

describe('parseNpmShim', () => {
  it('resolves the codex shim to node plus its own JS entry point', () => {
    expect(parseNpmShim(CODEX_SHIM, `${NPM_DIR}\\codex.cmd`)).toEqual({
      file: `${NPM_DIR}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      kind: 'node-script'
    })
  })

  /**
   * ⚠ THE ONE THAT WOULD BE MISSED BY A PARSER THAT ONLY LOOKED FOR `.js`.
   * opencode's shim launches a real executable directly, so it needs no
   * interpreter at all — and spawning it is strictly better than the cmd.exe
   * route it used before.
   */
  it('resolves the opencode shim to the executable it launches, with no interpreter', () => {
    expect(parseNpmShim(OPENCODE_SHIM, `${NPM_DIR}\\opencode.cmd`)).toEqual({
      file: `${NPM_DIR}\\node_modules\\opencode-ai\\bin\\opencode.exe`,
      kind: 'executable'
    })
  })

  it('treats a .mjs entry point as a node script', () => {
    expect(parseNpmShim(KIMI_SHIM, `${NPM_DIR}\\kimi.cmd`)?.kind).toBe('node-script')
  })

  /**
   * ⚠ THE `IF EXIST "%dp0%\node.exe"` LINE IS A TRAP, AND THIS IS THE TEST THAT
   * CATCHES IT. It is a quoted, `%dp0%`-relative, `.exe`-suffixed token — every
   * surface property of a target — but it is the interpreter probe. A parser
   * that scanned the whole file would resolve codex to node.exe and silently
   * launch node with no script.
   */
  it('does not mistake the interpreter probe for the target', () => {
    const target = parseNpmShim(CODEX_SHIM, `${NPM_DIR}\\codex.cmd`)
    expect(target?.file.toLowerCase()).not.toContain('\\node.exe')
  })

  it('normalises the double separator npm\'s own template writes', () => {
    // `%dp0%` already ends in a backslash and the template adds another.
    const target = parseNpmShim(CODEX_SHIM, `${NPM_DIR}\\codex.cmd`)
    expect(target?.file).not.toContain('\\\\')
  })

  it('accepts the older %~dp0 spelling', () => {
    const shim = crlf(['@ECHO off', '"%~dp0\\node_modules\\thing\\bin\\thing.exe" %*'])
    expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toEqual({
      file: 'C:\\bin\\node_modules\\thing\\bin\\thing.exe',
      kind: 'executable'
    })
  })

  describe('refuses rather than guesses', () => {
    it('returns null for empty text', () => {
      expect(parseNpmShim('', `${NPM_DIR}\\codex.cmd`)).toBeNull()
    })

    it('returns null past the size cap', () => {
      const padded = CODEX_SHIM + '\r\nREM ' + 'x'.repeat(MAX_SHIM_BYTES)
      expect(parseNpmShim(padded, `${NPM_DIR}\\codex.cmd`)).toBeNull()
    })

    it('returns null when no line forwards arguments', () => {
      const shim = crlf(['@ECHO off', '"%dp0%\\node_modules\\thing\\bin\\thing.exe"'])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null when two lines forward arguments', () => {
      const shim = crlf([
        '@ECHO off',
        'IF DEFINED X "%dp0%\\a\\one.exe" %*',
        '"%dp0%\\b\\two.exe" %*'
      ])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null when the invocation line names two dp0-relative tokens', () => {
      const shim = crlf(['@ECHO off', '"%dp0%\\a.exe" "%dp0%\\b.js" %*'])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null when the target is not dp0-relative', () => {
      const shim = crlf(['@ECHO off', '"C:\\elsewhere\\thing.exe" %*'])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null for an extension we have not measured', () => {
      const shim = crlf(['@ECHO off', '"%dp0%\\node_modules\\thing\\thing.ps1" %*'])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null when the target still holds an unexpanded variable', () => {
      const shim = crlf(['@ECHO off', '"%dp0%\\node_modules\\%PKG%\\bin\\cli.js" %*'])
      expect(parseNpmShim(shim, 'C:\\bin\\thing.cmd')).toBeNull()
    })

    it('returns null when the shim path has no directory to resolve against', () => {
      const shim = crlf(['@ECHO off', '"%dp0%\\a.exe" %*'])
      expect(parseNpmShim(shim, 'thing.cmd')).toBeNull()
    })
  })
})
