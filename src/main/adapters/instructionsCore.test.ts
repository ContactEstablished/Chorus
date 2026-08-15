import { describe, expect, it } from 'vitest'
import { CHORUS_MEMORY_SERVER } from '../services/memoryService'
import {
  assertSingleLine,
  memoryContractLines,
  renderInstructionsMarkdown,
  renderInstructionsOneLine
} from './instructionsCore'

/**
 * Task 6a-1 / D148 — the pure snippet core.
 *
 * ⚠ THIS SUITE IMPORTS NEITHER `electron` NOR `fs`, AND THAT IS THE POINT.
 * The module under test is loadable under plain node with no Electron ABI,
 * which is what lets both adapters and the ipc composition share one copy of
 * the rule instead of three.
 */
describe('Task 6a-1: the memory usage contract text (D148)', () => {
  const lines = memoryContractLines()

  it('names the MCP server exactly as memoryService spells it', () => {
    // ⚠ IMPORTED, NEVER RE-TYPED. A second spelling here would teach every
    // agent a name that the `.mcp.json` it is reading does not use — a failure
    // with no error message anywhere.
    expect(CHORUS_MEMORY_SERVER).toBe('chorus-memory')
    expect(lines[0]).toContain(`"${CHORUS_MEMORY_SERVER}"`)
  })

  it('⚠ EVERY line is one physical line — this is what makes the codex render legal', () => {
    for (const line of lines) expect(line).not.toMatch(/[\r\n]/)
  })

  it('says all four things the contract exists to say', () => {
    const all = lines.join(' ')
    expect(all).toContain('READ BEFORE ASSUMING')
    expect(all).toContain('WRITE AFTER A MILESTONE')
    expect(all).toContain('EVERY MEMORY MUST CITE ITS SOURCE')
    expect(all).toContain('NEVER DELETE OR RELABEL A MEMORY YOU DID NOT WRITE')
  })

  it('names SUPPORTED_BY, because memory:validate counts nothing else as sourced', () => {
    // The provenance ratio's denominator would otherwise be measuring
    // compliance with an instruction nobody was ever given (identity model §6).
    expect(lines.join(' ')).toContain('SUPPORTED_BY')
  })

  /* ── the two renderers ─────────────────────────────────────────────────── */

  it('the Markdown render carries every sentence and ends with a newline', () => {
    const md = renderInstructionsMarkdown(lines)
    for (const line of lines) expect(md).toContain(line)
    expect(md).toMatch(/\n$/)
    expect(md.startsWith('# Project memory (Chorus)')).toBe(true)
  })

  it('⚠ the one-line render contains NO raw newline and NO carriage return', () => {
    // Asserted directly rather than inferred from the input, because a raw
    // newline inside a `-c key="…"` override is an illegal TOML basic string —
    // `tomlBasicString` escapes \ and " and NOT newlines — and codex discards a
    // malformed override WITHOUT A WORD. The symptom would be a contract that
    // simply never arrives.
    const oneLine = renderInstructionsOneLine(lines)
    expect(oneLine).not.toContain('\n')
    expect(oneLine).not.toContain('\r')
    for (const line of lines) expect(oneLine).toContain(line)
  })

  /* ── the guard ─────────────────────────────────────────────────────────── */

  it('⚠ assertSingleLine THROWS on multi-line input — it is load-bearing, not decorative', () => {
    expect(() => assertSingleLine('one\ntwo')).toThrow(/one physical line/)
    expect(() => assertSingleLine('one\r\ntwo')).toThrow(/one physical line/)
    expect(() => assertSingleLine('one\rtwo')).toThrow(/one physical line/)
  })

  it('assertSingleLine returns its input unchanged when the input is legal', () => {
    expect(assertSingleLine('a single line')).toBe('a single line')
  })
})
