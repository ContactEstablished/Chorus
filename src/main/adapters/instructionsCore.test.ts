import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHORUS_MEMORY_SERVER } from '../services/memoryService'
import { memoryWriteParams } from '../services/provenanceCore'
import {
  assertSingleLine,
  memoryContractLines,
  renderInstructionsFor,
  renderInstructionsMarkdown,
  renderInstructionsOneLine,
  type MemoryContractContext
} from './instructionsCore'

/**
 * Task 6a-1 / D148, contract v2 by Task 6b-2 / D169 + D173 — the pure snippet
 * core.
 *
 * ⚠ THE MODULE UNDER TEST IMPORTS NEITHER `electron` NOR `fs`, AND THAT IS THE
 * POINT. It is loadable under plain node with no Electron ABI, which is what
 * lets both adapters and the ipc composition share one copy of the rule instead
 * of three. This SUITE reads `node:fs` in exactly one assertion — the D94.3
 * source-text check — because "the word does not appear in the file" is a claim
 * about the file and cannot be made from the file's exports.
 */

/** A context whose every field is distinguishable from every other, so an
 *  assertion that a value reached the render cannot pass by coincidence. */
const CTX: MemoryContractContext = {
  projectId: 'proj-1111-2222-3333',
  workspaceInstanceId: 'pj:proj-1111-2222-3333',
  repoId: 'repo-aaaa-bbbb-cccc',
  sessionId: 'sess-4444-5555-6666',
  agentId: 'claude',
  modelId: 'model-7777-8888',
  serverName: CHORUS_MEMORY_SERVER,
  lastIndexedHead: 'head-9999-0000'
}

describe('Task 6b-2: contract v2 (D169, D173)', () => {
  const lines = memoryContractLines(CTX)
  const all = lines.join(' ')

  /* ── the count, and why it is pinned ───────────────────────────────────── */

  it('⚠ is EXACTLY nineteen lines — the count is a decision, not an outcome', () => {
    // D147(e): every line is paid for in context on EVERY launch, for every
    // session, forever. That cost was accepted rather than hidden, which means
    // growth has to be a decision somebody took — so the number is pinned here
    // and a twentieth line fails this test until the spec says nineteen is
    // wrong. Seven of these are v1's, condensed; the twelve additions each
    // answer a numbered clause of F89, D169(c) or D173(Q5).
    expect(lines).toHaveLength(19)
  })

  it('⚠ EVERY line is one physical line — this is what makes the codex render legal', () => {
    // Now over the four Cypher templates as well as the prose. A raw newline
    // inside a `-c developer_instructions="…"` override is an illegal TOML
    // basic string and codex discards a malformed override WITHOUT A WORD.
    for (const line of lines) expect(line).not.toMatch(/[\r\n]/)
  })

  /* ── F89: the ids the agent was never told ─────────────────────────────── */

  it('renders the identity bundle FROM THE CONTEXT, not from literals', () => {
    // F89's core finding: v1 told an agent to draw PRODUCED "from your own
    // :AgentSession node" while nobody ever told it the session id. Each of
    // these is asserted against the context value so a hardcoded placeholder
    // cannot pass.
    expect(all).toContain(CTX.projectId)
    expect(all).toContain(CTX.workspaceInstanceId)
    expect(all).toContain(CTX.sessionId)
    expect(all).toContain(CTX.agentId)
    expect(all).toContain(CTX.repoId as string)
    expect(all).toContain(CTX.modelId as string)
    expect(all).toContain(CTX.lastIndexedHead as string)
  })

  it('⚠ the workspace instance id is the `pj:` one it was handed, never a `wt:` one', () => {
    // The only writer of :File / :Directory nodes calls
    // `workspaceInstanceIdFor(projectId)` and therefore always writes `pj:`. A
    // worktree session handed `wt:<id>` would get a WRITE template whose
    // `MATCH (f:File …)` matches nothing — no error, no rows, no memory.
    expect(all).toContain('pj:proj-1111-2222-3333')
    expect(all).not.toContain('wt:')
  })

  it('⚠ a null repoId / model / head renders `unknown`, and NEVER the string "null"', () => {
    // A contract that says `$repoId = 'null'` teaches the agent to send the
    // four characters n-u-l-l as a parameter, which matches no :Commit and
    // fails silently — the exact class of failure this task exists to close.
    const bare = memoryContractLines({
      ...CTX,
      repoId: null,
      modelId: null,
      lastIndexedHead: null
    }).join(' ')
    expect(bare).not.toContain("'null'")
    expect(bare).not.toContain('= null')
    expect(bare).toContain("$repoId = 'unknown'")
    expect(bare).toContain('last indexed at commit unknown')
    // The model is the one that is not merely `unknown`: Chorus does not know
    // it on a subscription launch but the AGENT does, so the contract asks.
    expect(bare).toContain('unknown — pass your own model identifier')
  })

  /* ── F92: the tools are deferred, so name them ─────────────────────────── */

  it('⚠ names the three tools as EXACT literals, though the code derives them', () => {
    // Derived from one server name so the name keeps one home; pinned here as
    // literals so a change to claude's mangling fails loudly instead of quietly
    // teaching every agent three tool names that do not exist. F92 (measured on
    // 2.1.235, re-measured on 2.1.237 by this task): MCP tools are DEFERRED —
    // the agent calls ToolSearch first — so a contract that does not name them
    // is asking for tools the agent cannot see.
    expect(all).toContain('mcp__chorus-memory__read_neo4j_cypher')
    expect(all).toContain('mcp__chorus-memory__write_neo4j_cypher')
    expect(all).toContain('mcp__chorus-memory__get_neo4j_schema')
    expect(CHORUS_MEMORY_SERVER).toBe('chorus-memory')
    expect(lines[0]).toContain(`"${CHORUS_MEMORY_SERVER}"`)
  })

  it('tells the agent the tools may need loading before they are visible', () => {
    expect(lines[1]).toContain('loaded on demand')
  })

  /* ── F89: the property set validate filters on ─────────────────────────── */

  it('⚠ names ALL EIGHT :Memory properties, taken from memoryWriteParams itself', () => {
    // Drawn from the writer's own key list rather than re-typed, so a ninth
    // property added there fails HERE rather than producing memories the
    // validator silently declines to count.
    const keys = Object.keys(
      memoryWriteParams({
        id: 'x',
        content: 'x',
        chorusProjectId: 'x',
        writtenVia: 'mcp',
        assertedBy: { modelId: 'm', adapterId: 'a' },
        validFrom: 'x',
        validTo: null
      })
    )
    expect(keys).toHaveLength(8)
    for (const key of keys) expect(all).toContain(key)
    expect(all).toContain("writtenVia: 'mcp'")
  })

  it('⚠ /confidence/i matches NOTHING — not the render, and not the source file', () => {
    // D94.3, ratified by CR-6.0 Q1: a self-graded number is uncalibrated, not
    // comparable across models, and WILL be read as rigor. The source check is
    // the half that catches a well-meaning comment reintroducing the idea.
    //
    // ⚠ THE BAN IS ON THE WORD, WHICH IS STRICTER THAN D94.3 ITSELF, AND THAT
    // IS DELIBERATE (Task-6b-2.md Non-Goals + Acceptance Criteria). D94.3 drops
    // the FIELD; this file may not even name it, because the contract is read by
    // a model that pattern-matches on vocabulary — mentioning the field in order
    // to forbid it is how it gets written anyway. The prohibition survives in the
    // contract as "exactly these properties and no others" plus a positive
    // instruction about where certainty belongs instead.
    expect(all).not.toMatch(/confidence/i)
    const source = readFileSync(new URL('./instructionsCore.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/confidence/i)
  })

  it('still forbids an invented property, without naming the one it is guarding', () => {
    expect(all).toContain('exactly these properties and no others')
    expect(all).toContain('Do not add a property of your own invention')
  })

  /* ── D169(c)(4) / D173(Q5): the four templates ─────────────────────────── */

  const templates = {
    READ: () => lines.find((l) => l.startsWith('READ: ')) as string,
    'WRITE (file)': () => lines.find((l) => l.startsWith('WRITE (cited to a file)')) as string,
    'WRITE (commit)': () => lines.find((l) => l.startsWith('WRITE (cited to a commit)')) as string,
    SUPERSEDE: () => lines.find((l) => l.startsWith('SUPERSEDE ')) as string
  }

  it('carries all four templates, each found by its own opening words', () => {
    for (const [name, get] of Object.entries(templates)) {
      expect(get(), `${name} template is missing`).toBeTruthy()
    }
  })

  it.each(Object.keys(templates))('the %s template is one physical line', (name) => {
    const t = templates[name as keyof typeof templates]()
    expect(t).not.toMatch(/[\r\n]/)
  })

  it.each(Object.keys(templates))(
    '⚠ the %s template contains NO deletion verb (D147(c), D169(a))',
    (name) => {
      // :Memory is superseded, never deleted; :AgentSession is append-only
      // forever, because PRODUCED edges hang off it and removing one would
      // silently un-source every memory it produced.
      const t = templates[name as keyof typeof templates]()
      expect(t).not.toMatch(/\bDELETE\b/)
      expect(t).not.toMatch(/\bDETACH\b/)
      expect(t).not.toMatch(/\bREMOVE\b/)
    }
  )

  it('⚠ the three WRITING templates RETURN their own evidence (D173 Q5)', () => {
    // This is the only thing separating a write that created something from one
    // that created nothing. Cypher's `MATCH … CREATE` creates nothing when a
    // MATCH is empty, and the driver reports that as a NORMAL, SUCCESSFUL,
    // zero-row result — so without these counts the agent cannot tell a working
    // write from a silently discarded one. Measured against the live 5.26.29
    // inside a rolled-back transaction: `{id, produced: 1, supportedBy: 1}`.
    const file = templates['WRITE (file)']()
    const commit = templates['WRITE (commit)']()
    const supersede = templates.SUPERSEDE()

    for (const t of [file, commit, supersede]) {
      expect(t).toContain('[p:PRODUCED]')
      expect(t).toContain('count(p) AS produced')
      expect(t).toContain('AS supportedBy')
      expect(t).toContain('RETURN m.id AS id')
    }
    // ⚠ THE RELATIONSHIP VARIABLE DIFFERS IN THE COMMIT FORM, and that is not a
    // typo: `c` is already bound to the :Commit there, so the SUPPORTED_BY edge
    // has to be `r`. Both were executed against the live server.
    expect(file).toContain('[c:SUPPORTED_BY]')
    expect(commit).toContain('[r:SUPPORTED_BY]')
    expect(supersede).toContain('[c:SUPPORTED_BY]')
    // SUPERSEDE has a THIRD match that can quietly find nothing, so it counts a
    // third edge.
    expect(supersede).toContain('[x:SUPERSEDES]')
    expect(supersede).toContain('count(x) AS supersedes')
  })

  it('the READ template names the index explicitly, because the graph has two', () => {
    // `SHOW INDEXES` on the real graph lists `memory_text` AND a foreign
    // `search` FULLTEXT left behind by mcp-neo4j-memory (F49 in the wild). A
    // bare fulltext call has two candidates here.
    expect(templates.READ()).toContain("queryNodes('memory_text', $q)")
  })

  it('⚠ every Cypher string literal is SINGLE-quoted, so escaping stays one deep', () => {
    // `tomlBasicString` turns `"` into `\"`, which is legal — double quotes do
    // survive the codex render. Single quotes keep the depth at one so a reader
    // of the live command line sees the Cypher an agent will actually run. The
    // ONLY `"` in the whole contract is the pair around the server name.
    const quoted = lines.filter((l) => l.includes('"'))
    expect(quoted).toHaveLength(1)
    expect(quoted[0]).toContain(`"${CHORUS_MEMORY_SERVER}"`)
  })

  it('says both how a write fails LOUDLY and how it fails QUIETLY', () => {
    // Measured, not argued: a malformed query fires PostToolUseFailure and is
    // returned to the agent as a tool ERROR; a write whose MATCH found nothing
    // fires PostToolUse and is returned as SUCCESS with no row. Two failure
    // modes, two channels — the contract has to name both.
    expect(all).toContain('comes back as a tool ERROR')
    expect(all).toContain('comes back as SUCCESS with no row')
  })

  it('tells the agent to parameterise rather than paste', () => {
    expect(all).toContain('PASS EVERY VALUE AS A PARAMETER')
  })

  it('still says the four things v1 existed to say', () => {
    expect(all).toContain('READ BEFORE EXPLORING')
    expect(all).toContain('WRITE AFTER A MILESTONE')
    expect(all).toContain('EVERY MEMORY MUST CITE ITS SOURCE')
    expect(all).toContain('NEVER DELETE OR RELABEL A MEMORY YOU DID NOT WRITE')
    expect(all).toContain('SUPPORTED_BY')
  })

  it('uses the same exploration vocabulary 6b-1 classifies on', () => {
    // "before your first Read, Glob or Grep" is deliberately the vocabulary
    // 6b-1's classifier uses, so the ordinal comparison the counters make is
    // measuring compliance with a sentence that was actually written.
    expect(all).toContain('before your first Read, Glob or Grep')
  })

  /* ── the two renderers ─────────────────────────────────────────────────── */

  it('the Markdown render carries every sentence and ends with a newline', () => {
    const md = renderInstructionsMarkdown(lines)
    for (const line of lines) expect(md).toContain(line)
    expect(md).toMatch(/\n$/)
    expect(md.startsWith('# Project memory (Chorus)')).toBe(true)
  })

  it('⚠ the one-line render contains NO raw newline and NO carriage return', () => {
    const oneLine = renderInstructionsOneLine(lines)
    expect(oneLine).not.toContain('\n')
    expect(oneLine).not.toContain('\r')
    for (const line of lines) expect(oneLine).toContain(line)
  })

  it('⚠ the one-line render stays well under the command-line budget', () => {
    // Windows caps a command line at 32 767 characters and codex also carries
    // the ~1 156-character jade rule in the same argv. The bound below has
    // deliberate headroom over the measured length, so a future line that
    // DOUBLES the contract is a failing test rather than a truncated command
    // line — a failure that would show up as an agent ignoring instructions.
    const oneLine = renderInstructionsOneLine(lines)
    expect(oneLine.length).toBeLessThan(8000)
  })

  /* ── the gate ──────────────────────────────────────────────────────────── */

  it('⚠ a NULL context withholds the contract for EVERY mechanism — this is the gate', () => {
    // D169(b). `ctx === null` means the :AgentSession MERGE failed, which means
    // the graph did not answer. The failure this guards is not a crash: it is a
    // paragraph of confident instructions about a database that refuses every
    // query, which teaches the agent the feature is flaky. It lives in this
    // pure module rather than inside `withMcpEnv` because `src/main/ipc.test.ts`
    // does not exist — a gate written only there could not be asserted at all.
    expect(renderInstructionsFor('append-system-prompt-file', null)).toBeUndefined()
    expect(renderInstructionsFor('config-override', null)).toBeUndefined()
    expect(renderInstructionsFor(null, null)).toBeUndefined()
    expect(renderInstructionsFor(undefined, null)).toBeUndefined()
  })

  it('picks the rendering from the DESCRIPTOR, never from an agent id', () => {
    const md = renderInstructionsFor('append-system-prompt-file', CTX)
    const one = renderInstructionsFor('config-override', CTX)
    expect(md).toBe(renderInstructionsMarkdown(lines))
    expect(one).toBe(renderInstructionsOneLine(lines))
    // An adapter that declares no mechanism gets no text at all, which is what
    // makes kimi, opencode and noHarness honest rather than merely
    // unimplemented.
    expect(renderInstructionsFor(null, CTX)).toBeUndefined()
    expect(renderInstructionsFor(undefined, CTX)).toBeUndefined()
  })

  it('⚠ no agent-id comparison in the module CODE — the descriptor decides', () => {
    // ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A LOOPHOLE. The docblock
    // states the rule by quoting the forbidden expression, so a naive grep
    // matches the warning that forbids the thing — the same self-matching trap
    // a `Win32_Process` CommandLine filter falls into. What must be absent is an
    // agent-id comparison in executable code, so that is what is asserted.
    const source = readFileSync(new URL('./instructionsCore.ts', import.meta.url), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/===\s*['"`]claude['"`]/)
    expect(code).not.toMatch(/===\s*['"`]codex['"`]/)
    // And the stripping actually happened — otherwise this test would pass on
    // an empty string and assert nothing at all.
    expect(code).toContain('export function renderInstructionsFor')
    expect(source).toContain("NO `id === 'claude'` ANYWHERE IN HERE")
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
