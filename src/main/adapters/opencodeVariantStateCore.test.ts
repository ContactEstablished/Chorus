import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPENCODE_STATE_FILE_CAP_BYTES,
  OPENCODE_VARIANT_STATE_VERSIONS,
  classifyRememberedVariant,
  isVerifiedOpencodeStateVersion,
  opencodeModelStatePath,
  opencodeStateHome,
  patchRememberedVariant
} from './opencodeVariantStateCore'

/**
 * Model Routing Task 4a-2, Table VS (ImplementationSpec-4a-2): the pure half of MR-D25. `T` is a
 * model.json in the shape OpenCode 1.18.33 writes on this machine (compact, one line, no newline).
 */

const K = 'openrouter/deepseek/deepseek-v4.1-flash'
const KN = K + ':nitro'
const T =
  '{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"high","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}'
const VS1 =
  '{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"low","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}'

describe('Table VS — opencodeVariantStateCore (MR-D25, C12, C13)', () => {
  it('VS1: rewrites only the named entry, byte for byte in 1.18.33’s compact format', () => {
    const out = patchRememberedVariant(T, K, 'low')
    expect(out).toBe(VS1)
    expect(out).toBe(T.replace('"openrouter/deepseek/deepseek-v4.1-flash":"high"', '"openrouter/deepseek/deepseek-v4.1-flash":"low"'))
  })

  it('VS2: the :nitro key is its own entry', () => {
    expect(patchRememberedVariant(T, KN, 'low')).toBe(
      T.replace('"openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"', '"openrouter/deepseek/deepseek-v4.1-flash:nitro":"low"')
    )
  })

  it('VS3: equal, absent and unreadable states write nothing', () => {
    const cases: Array<[string | null, string, string, string]> = [
      [T, K, 'high', 'equal'],
      [T, 'openrouter/other/model', 'low', 'absent'],
      ['{"recent":[]}', K, 'low', 'absent'],
      [null, K, 'low', 'unreadable'],
      ['garbage', K, 'low', 'unreadable'],
      ['[]', K, 'low', 'unreadable'],
      ['null', K, 'low', 'unreadable'],
      ['{"variant":[]}', K, 'low', 'unreadable'],
      ['{"variant":"high"}', K, 'low', 'unreadable']
    ]
    for (const [text, key, effort, expected] of cases) {
      expect(classifyRememberedVariant(text, key, effort)).toBe(expected)
      expect(patchRememberedVariant(text, key, effort)).toBeNull()
    }
  })

  it('VS4: invalid keys and efforts are refused before the file is read', () => {
    const cases: Array<[string, string]> = [
      ['', 'low'],
      ['__proto__', 'low'],
      ['x'.repeat(301), 'low'],
      [K, 'LOW'],
      [K, 'x y']
    ]
    for (const [key, effort] of cases) {
      expect(classifyRememberedVariant(T, key, effort)).toBe('invalid')
      expect(patchRememberedVariant(T, key, effort)).toBeNull()
    }
  })

  it('VS5: any other existing value differs and is replaced', () => {
    const text = '{"variant":{"openrouter/deepseek/deepseek-v4.1-flash":7}}'
    expect(classifyRememberedVariant(text, K, 'low')).toBe('differs')
    expect(patchRememberedVariant(text, K, 'low')).toBe('{"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"low"}}')
  })

  it('VS6: the output is always compact, whatever the input’s layout', () => {
    expect(patchRememberedVariant(JSON.stringify(JSON.parse(T), null, 2), K, 'low')).toBe(VS1)
  })

  it('VS7: the state home follows the child env as measured (XDG_STATE_HOME, else USERPROFILE; HOME ignored)', () => {
    expect(opencodeStateHome({ XDG_STATE_HOME: 'C:\\x\\state', USERPROFILE: 'C:\\u' }, 'C:\\f')).toBe('C:\\x\\state')
    expect(opencodeStateHome({ XDG_STATE_HOME: '', USERPROFILE: 'C:\\u' }, 'C:\\f')).toBe(path.join('C:\\u', '.local', 'state'))
    expect(opencodeStateHome({ USERPROFILE: 'C:\\u', HOME: 'C:\\h' }, 'C:\\f')).toBe(path.join('C:\\u', '.local', 'state'))
    expect(opencodeStateHome({ HOME: 'C:\\h' }, 'C:\\f')).toBe(path.join('C:\\f', '.local', 'state'))
    expect(opencodeStateHome({ xdg_state_home: 'C:\\y' }, 'C:\\f')).toBe('C:\\y')
    expect(opencodeStateHome({ Userprofile: 'C:\\v' }, 'C:\\f')).toBe(path.join('C:\\v', '.local', 'state'))
  })

  it('VS8: the state path and the constants', () => {
    expect(opencodeModelStatePath('C:\\s')).toBe(path.join('C:\\s', 'opencode', 'model.json'))
    expect(OPENCODE_VARIANT_STATE_VERSIONS).toEqual(['1.18.33', '1.18.34'])
    expect(OPENCODE_STATE_FILE_CAP_BYTES).toBe(1000000)
  })

  it('VS9: only an exact measured version is verified', () => {
    expect(isVerifiedOpencodeStateVersion('1.18.33')).toBe(true)
    expect(isVerifiedOpencodeStateVersion('1.18.34')).toBe(true)
    for (const version of ['1.18.35', '1.19.0', '1.18.32', '1.18.3', '1.18', '1.18.340', 'v1.18.34', ' 1.18.34', '1.18.34\n', '1.18.34-beta', 'unknown', '', null]) {
      expect(isVerifiedOpencodeStateVersion(version)).toBe(false)
    }
  })
})
