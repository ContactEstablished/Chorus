/**
 * ⚠ THIS FILE IS WHERE THE FEATURE'S CORRECTNESS LIVES, BECAUSE THERE ARE NO
 * `.vue` TESTS IN THIS REPOSITORY. Nothing mounts a dialog; nothing can. Written
 * beside `layout.test.ts`, the precedent for testing a pure shared module.
 *
 * ⚠ THIS FILE MAY import from `shared/ipc`; the module under test may NOT. The
 * test runs in node under Vitest, where Zod is fine — which is exactly what lets
 * it tie the module's numbers to the wire's without the module importing
 * anything. See the purity guard at the bottom.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { AGENT_DESCRIPTION_MAX, agentKindSchema, type AgentKind } from './ipc'
import {
  LAUNCH_PRESETS,
  MAX_LAUNCH_COUNT,
  PARTNER_ORDER,
  batchOutcomeLine,
  offeredCounts,
  partnerFor,
  planLaunches,
  presetDisabledReason,
  progressLabel,
  roleLabels,
  type PlanInput,
  type PresetId
} from './launchPresets'

/** Everything a normal machine has installed, including 7a-2's Terminal. */
const ALL: AgentKind[] = ['claude', 'codex', 'grok', 'kimi', 'opencode', 'shell']

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  preset: 'solo',
  agent: 'claude',
  count: 1,
  mode: 'current-tree',
  installed: ALL,
  ...over
})

describe('planLaunches — solo', () => {
  it('at 1 is ONE slot at the dialog\'s own mode — the byte-identity case', () => {
    // ⚠ THE CASE THE WHOLE TASK IS MEASURED AGAINST. An untouched dialog must
    // still send exactly what it sends today: the picked agent, the mode the
    // user is looking at, no role, and no description of the preset's own (so
    // the dialog hands slot 0 the typed note untouched).
    expect(planLaunches(input({ preset: 'solo', count: 1 }))).toEqual([
      { agent: 'claude', workspaceMode: 'current-tree', role: null, description: null }
    ])
  })

  it('above 1 gives slot 1 the dialog mode and slots 2..N a new worktree (D186)', () => {
    // By the time agent 2 launches, another live session IS writing the repo —
    // exactly the condition `suggestMode()` already keys on
    // (`liveSessionsInRepo >= 1`). The preset applies the existing rule forward
    // through the batch rather than inventing one.
    //
    // ⚠ THIS ASSERTION IS THE ONE THAT SILENTLY REVERTS if someone "simplifies"
    // Solo to N × the chosen mode. Treat its deletion as a scope change.
    expect(planLaunches(input({ preset: 'solo', count: 3 })).map((s) => s.workspaceMode)).toEqual([
      'current-tree',
      'new-worktree',
      'new-worktree'
    ])
  })

  it('above 1 from an existing worktree keeps slot 1 attached and forks the rest', () => {
    // Slots 2..N cannot attach the same worktree — main refuses one owned by a
    // live session — so `new-worktree` is the only honest answer there too.
    expect(
      planLaunches(input({ preset: 'solo', count: 3, mode: 'existing-worktree' })).map(
        (s) => s.workspaceMode
      )
    ).toEqual(['existing-worktree', 'new-worktree', 'new-worktree'])
  })
})

describe('planLaunches — pair', () => {
  it('is builder then partner, both in the current tree, whatever the count says', () => {
    for (const count of [1, 2, 5]) {
      const plan = planLaunches(input({ preset: 'pair', count }))
      expect(plan).toHaveLength(2)
      expect(plan.map((s) => s.agent)).toEqual(['claude', 'codex'])
      expect(plan.map((s) => s.workspaceMode)).toEqual(['current-tree', 'current-tree'])
      expect(plan.map((s) => s.role)).toEqual(['builder', 'reviewer'])
      // The builder inherits whatever the user typed; the reviewer does not.
      expect(plan[0].description).toBeNull()
      expect(plan[1].description).toBe('Reviewing the same tree')
    }
  })

  it('is empty when no second agent is installed', () => {
    expect(planLaunches(input({ preset: 'pair', installed: ['claude'] }))).toEqual([])
  })
})

describe('planLaunches — workbench', () => {
  it('is the picked agent plus the shell, both in the current tree', () => {
    const plan = planLaunches(input({ preset: 'workbench' }))
    expect(plan.map((s) => s.agent)).toEqual(['claude', 'shell'])
    expect(plan.map((s) => s.workspaceMode)).toEqual(['current-tree', 'current-tree'])
    expect(plan.map((s) => s.role)).toEqual(['builder', 'shell'])
    expect(plan[1].description).toBe('Shell in the same tree')
  })

  it('is empty when the shell was not detected', () => {
    expect(planLaunches(input({ preset: 'workbench', installed: ['claude', 'codex'] }))).toEqual([])
  })
})

describe('planLaunches — swarm', () => {
  it('is N of the picked agent, EVERY slot in its own worktree — including the first', () => {
    const plan = planLaunches(input({ preset: 'swarm', count: 4 }))
    expect(plan).toHaveLength(4)
    expect(plan.every((s) => s.agent === 'claude')).toBe(true)
    expect(plan.every((s) => s.workspaceMode === 'new-worktree')).toBe(true)
  })

  it('forks slot 1 too, even when the dialog is showing current-tree', () => {
    // Four writers in one tree collide; that is the whole point of the shape.
    expect(planLaunches(input({ preset: 'swarm', count: 2, mode: 'current-tree' }))[0].workspaceMode).toBe(
      'new-worktree'
    )
  })
})

describe('planLaunches — the count is clamped, never trusted', () => {
  it.each([0, -1, 0.4, Number.NaN])('a count of %p still yields one slot', (count) => {
    expect(planLaunches(input({ preset: 'solo', count }))).toHaveLength(1)
    expect(planLaunches(input({ preset: 'swarm', count }))).toHaveLength(1)
  })

  it('a count past the ceiling is capped at MAX_LAUNCH_COUNT', () => {
    // Asserted against the imported constant, never a literal 6.
    expect(planLaunches(input({ preset: 'swarm', count: 99 }))).toHaveLength(MAX_LAUNCH_COUNT)
  })
})

describe('partnerFor', () => {
  it('walks claude -> codex -> grok -> opencode and skips the builder', () => {
    expect(partnerFor('claude', ALL)).toBe('codex')
    expect(partnerFor('codex', ALL)).toBe('claude')
    expect(partnerFor('grok', ALL)).toBe('claude')
    expect(partnerFor('opencode', ALL)).toBe('claude')
  })

  it('respects install order rather than the alphabet', () => {
    expect(partnerFor('claude', ['grok', 'opencode'])).toBe('grok')
    expect(partnerFor('grok', ['opencode', 'grok'])).toBe('opencode')
  })

  it('NEVER returns shell or kimi, even when both are installed', () => {
    // A raw prompt reviews nothing, and kimi is withheld from the picker by
    // HIDDEN_AGENTS — a presentation filter, not a removal.
    expect(partnerFor('claude', ['shell', 'kimi'])).toBeNull()
    expect(partnerFor('codex', ['kimi', 'shell'])).toBeNull()
  })

  it('returns null on a one-CLI machine', () => {
    expect(partnerFor('claude', ['claude'])).toBeNull()
  })

  it('DRIFT GUARD: every agent kind is either a candidate partner or explicitly excluded', () => {
    // `agentKindSchema` is the closed list; PARTNER_ORDER is a deliberate
    // subset. Every kind must be in one or the other, so a SEVENTH kind fails
    // here until someone decides IN WRITING whether it can review.
    const EXCLUDED: AgentKind[] = [
      'shell', // a raw prompt reviews nothing
      'kimi' // withheld from the picker by HIDDEN_AGENTS (a presentation filter)
    ]
    expect([...PARTNER_ORDER, ...EXCLUDED].sort()).toEqual([...agentKindSchema.options].sort())
  })
})

/* ── The invariants — worth more than any single case ────────────────────── */

const EVERY_PRESET: PresetId[] = ['solo', 'pair', 'workbench', 'swarm']
const EVERY_INSTALLED: AgentKind[][] = [
  ALL,
  ['claude'],
  ['claude', 'codex'],
  ['claude', 'shell'],
  ['shell'],
  ['claude', 'kimi', 'shell']
]

describe('invariants', () => {
  it('slot 0 is ALWAYS the user\'s — their agent, and no description of ours', () => {
    // This is what lets the dialog hand slot 0 the typed name and typed note
    // untouched, which is in turn what makes Solo-at-1 byte-identical.
    for (const preset of EVERY_PRESET) {
      for (const installed of EVERY_INSTALLED) {
        for (const count of [1, 2, 4, 6]) {
          for (const agent of ['claude', 'codex', 'shell'] as AgentKind[]) {
            const plan = planLaunches(input({ preset, count, agent, installed }))
            if (plan.length === 0) continue
            expect(plan[0].agent).toBe(agent)
            expect(plan[0].description).toBeNull()
          }
        }
      }
    }
  })

  it('an empty plan and a disabled reason are the SAME condition', () => {
    // ⚠ THE BICONDITIONAL, not the two halves. The failure that matters is the
    // two disagreeing: a Launch button enabled over a strip that renders
    // nothing, or a card disabled for a shape that would have worked.
    for (const preset of EVERY_PRESET) {
      for (const installed of EVERY_INSTALLED) {
        for (const agent of ['claude', 'codex', 'shell'] as AgentKind[]) {
          const empty = planLaunches(input({ preset, agent, installed })).length === 0
          const reason = presetDisabledReason(preset, { agent, installed }) !== null
          expect(empty, `${preset} / ${agent} / [${installed.join(',')}]`).toBe(reason)
        }
      }
    }
  })

  it('every description this module authors fits the wire', () => {
    // The module cannot import this cap (it lives in the Zod module and the
    // renderer's CSP forbids pulling Zod in through a shared module), so the
    // two numbers are tied together HERE — and there is no second literal.
    for (const preset of EVERY_PRESET) {
      for (const agent of ['claude', 'codex', 'shell'] as AgentKind[]) {
        for (const s of planLaunches(input({ preset, agent, count: 6 }))) {
          if (s.description) expect(s.description.length).toBeLessThanOrEqual(AGENT_DESCRIPTION_MAX)
        }
      }
    }
  })

  it('the picked agent may itself be the shell — both shapes are legal, neither special-cased', () => {
    // Pinned so nobody adds a rule for it later. The Will-launch strip shows
    // exactly what will happen either way.
    expect(planLaunches(input({ preset: 'workbench', agent: 'shell' })).map((s) => s.agent)).toEqual([
      'shell',
      'shell'
    ])
    expect(planLaunches(input({ preset: 'pair', agent: 'shell' })).map((s) => s.agent)).toEqual([
      'shell',
      'claude'
    ])
  })

  it('every preset row has a label, a blurb, and a coherent count shape', () => {
    expect(LAUNCH_PRESETS.map((p) => p.id)).toEqual(EVERY_PRESET)
    for (const p of LAUNCH_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.blurb.length).toBeGreaterThan(0)
      // countable and fixedCount are two views of one fact; they cannot disagree.
      expect(p.countable).toBe(p.fixedCount === null)
    }
  })

  it('roleLabels covers every role the planner can emit', () => {
    const emitted = new Set<string>()
    for (const preset of EVERY_PRESET) {
      for (const s of planLaunches(input({ preset, count: 3 }))) if (s.role) emitted.add(s.role)
    }
    for (const r of emitted) expect(roleLabels[r as keyof typeof roleLabels]).toBeTruthy()
  })
})

/* ── The purity guard ────────────────────────────────────────────────────── */

describe('purity', () => {
  it('imports from ./ipc are TYPE-ONLY — a value import breaks the renderer silently', () => {
    // ⚠ THREE LINES THAT CATCH A SILENT RUNTIME FAILURE. A value import of
    // `./ipc` from launchPresets.ts pulls Zod into a module the RENDERER loads,
    // and the page CSP has no `unsafe-eval`: it throws EvalError where nobody is
    // looking. `import type` is erased at build time and is fine.
    // Same source-text technique db/schema.test.ts uses over storage.ts.
    const src = readFileSync(new URL('./launchPresets.ts', import.meta.url), 'utf8')
    const imports = src.split('\n').filter((l) => l.startsWith('import'))
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) expect(line.startsWith('import type ')).toBe(true)
  })
})

/* ── The wording ─────────────────────────────────────────────────────────── */

describe('wording', () => {
  it('a single launch still reads exactly "Launching…"', () => {
    // Character for character, ellipsis included — the string Task 6b-3 chose
    // (D170). A Solo launch must not gain a "1 of 1".
    expect(progressLabel(0, 1)).toBe('Launching…')
    expect(progressLabel(0, 0)).toBe('Launching…')
  })

  it('a batch counts up and cannot overrun its denominator', () => {
    expect(progressLabel(0, 4)).toBe('Launching 1 of 4…')
    expect(progressLabel(1, 4)).toBe('Launching 2 of 4…')
    expect(progressLabel(4, 4)).toBe('Launching 4 of 4…')
  })

  it('the outcome line is null for one slot and carries its denominator for a batch', () => {
    expect(batchOutcomeLine(0, 1)).toBeNull()
    expect(batchOutcomeLine(2, 4)).toBe('2 of 4 launched')
    expect(batchOutcomeLine(0, 4)).toBe('0 of 4 launched')
  })

  it('offeredCounts clamps to the budget and is never empty', () => {
    expect(offeredCounts(0)).toEqual([1])
    expect(offeredCounts(-5)).toEqual([1])
    expect(offeredCounts(2)).toEqual([1, 2])
    expect(offeredCounts(99)).toHaveLength(MAX_LAUNCH_COUNT)
  })
})
