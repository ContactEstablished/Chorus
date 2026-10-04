import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../services/logger'
import { applyRememberedVariant } from './opencodeVariantState'

/**
 * Model Routing Task 4a-2, Table VW (ImplementationSpec-4a-2): the MR-D25 writer on a REAL temp
 * directory (the atomicity claim is about the real filesystem). Nothing here touches a path outside
 * `os.tmpdir()`; the user's own OpenCode state is never read or written.
 */

const K = 'openrouter/deepseek/deepseek-v4.1-flash'
const T =
  '{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"high","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}'
const VS1 =
  '{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"low","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}'
const INFO = `[launch] set OpenCode's remembered variant for openrouter/deepseek/deepseek-v4.1-flash to low`
const WARN = "[launch] could not update OpenCode's remembered variant; the launch continues"

let root: string
let stateHome: string
let file: string
let V: { stateHome: string; modelKey: string; effort: string; installedVersion: string | null }
let info: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  root = fs.mkdtempSync(join(os.tmpdir(), 'chorus-variant-state-test-'))
  stateHome = join(root, 'state')
  file = join(stateHome, 'opencode', 'model.json')
  V = { stateHome, modelKey: K, effort: 'low', installedVersion: '1.18.33' }
  info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

function seed(text: string | Buffer): void {
  fs.mkdirSync(join(stateHome, 'opencode'), { recursive: true })
  fs.writeFileSync(file, text)
}

describe('Table VW — applyRememberedVariant (MR-D25, C12)', () => {
  it('VW1: writes the one entry, leaves no temp file, logs the model key and effort only', () => {
    seed(T)
    expect(applyRememberedVariant(V)).toBe('written')
    expect(fs.readFileSync(file, 'utf8')).toBe(VS1)
    expect(fs.readdirSync(join(stateHome, 'opencode'))).toEqual(['model.json'])
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(INFO)
    expect(warn).not.toHaveBeenCalled()
  })

  it('VW2: a second call finds the entry equal and writes nothing', () => {
    seed(T)
    expect(applyRememberedVariant(V)).toBe('written')
    const after = fs.readFileSync(file)
    expect(applyRememberedVariant(V)).toBe('unchanged')
    expect(fs.readFileSync(file).equals(after)).toBe(true)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('VW3: no entry for this model → unchanged, bytes identical', () => {
    seed(T)
    expect(applyRememberedVariant({ ...V, modelKey: 'openrouter/other/model' })).toBe('unchanged')
    expect(fs.readFileSync(file, 'utf8')).toBe(T)
  })

  it('VW4: any version but 1.18.33 is skipped', () => {
    seed(T)
    for (const installedVersion of ['1.18.34', null, 'unknown']) {
      expect(applyRememberedVariant({ ...V, installedVersion })).toBe('skipped')
      expect(fs.readFileSync(file, 'utf8')).toBe(T)
    }
    expect(info).not.toHaveBeenCalled()
  })

  it('VW5: no state directory → skipped, and nothing is created', () => {
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.existsSync(join(stateHome, 'opencode'))).toBe(false)
  })

  it('VW6: unreadable, oversize and non-file targets are skipped without a warning', () => {
    seed('garbage')
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.readFileSync(file, 'utf8')).toBe('garbage')

    const padded = Buffer.from(T + ' '.repeat(1_000_001 - Buffer.byteLength(T)), 'utf8')
    expect(padded.length).toBe(1_000_001)
    seed(padded)
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.readFileSync(file).equals(padded)).toBe(true)

    fs.rmSync(file)
    fs.mkdirSync(file)
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.statSync(file).isDirectory()).toBe(true)

    expect(warn).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'win32')('VW7: a failed rename leaves the original intact, no temp file, one fixed warning', () => {
    seed(T)
    fs.chmodSync(file, 0o444)
    try {
      expect(applyRememberedVariant(V)).toBe('skipped')
      expect(fs.readFileSync(file, 'utf8')).toBe(T)
      expect(fs.readdirSync(join(stateHome, 'opencode'))).toEqual(['model.json'])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(WARN)
      expect(info).not.toHaveBeenCalled()
    } finally {
      fs.chmodSync(file, 0o666)
    }
  })

  it('VW8: invalid input is skipped and never throws', () => {
    seed(T)
    for (const opts of [{ ...V, stateHome: '' }, { ...V, effort: 'LOW' }, { ...V, modelKey: '' }]) {
      expect(() => applyRememberedVariant(opts)).not.toThrow()
      expect(applyRememberedVariant(opts)).toBe('skipped')
      expect(fs.readFileSync(file, 'utf8')).toBe(T)
    }
    expect(info).not.toHaveBeenCalled()
  })
})

/**
 * VW9–VW12: coordinator, review fix (S2, N1, N3). No symlink case: this machine refuses an
 * unprivileged file symlink (EPERM), so N2's lstat is covered by review, not by a test here.
 */
describe('Table VW (review fix) — strict input and a failing logger', () => {
  it('VW9: a non-UTF-8 byte is unreadable — skipped quietly, never rewritten with U+FFFD', () => {
    const bad = Buffer.concat([
      Buffer.from('{"recent":[{"providerID":"openrouter","modelID":"caf', 'utf8'),
      Buffer.from([0xe9]),
      Buffer.from('"}],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"high"}}', 'utf8')
    ])
    // A lenient decode would see a valid file with a differing entry, so the skip is the strict decode's.
    expect(JSON.parse(bad.toString('utf8')).variant[K]).toBe('high')
    seed(bad)
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.readFileSync(file).equals(bad)).toBe(true)
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('VW10: a BOM-prefixed, otherwise valid differing file is skipped and left byte-identical', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(T, 'utf8')])
    seed(bom)
    expect(applyRememberedVariant(V)).toBe('skipped')
    expect(fs.readFileSync(file).equals(bom)).toBe(true)
    expect(info).not.toHaveBeenCalled()
  })

  it('VW11: a logger that throws after the write still reports written', () => {
    info.mockImplementation(() => {
      throw new Error('logger down')
    })
    seed(T)
    expect(applyRememberedVariant(V)).toBe('written')
    expect(fs.readFileSync(file, 'utf8')).toBe(VS1)
    expect(info).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('VW12: a relative state home is skipped', () => {
    seed(T)
    expect(applyRememberedVariant({ ...V, stateHome: 'state' })).toBe('skipped')
    expect(fs.readFileSync(file, 'utf8')).toBe(T)
    expect(info).not.toHaveBeenCalled()
  })
})
