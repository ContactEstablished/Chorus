import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { plainTeamInput, newerTeamSnapshot, useTeamStore } from './team'
import { teamFixtureRun } from '../../../main/services/teamTestFixtures'
import type { TeamSnapshot } from '../../../shared/team'
const snapshot = (): TeamSnapshot => ({ run: teamFixtureRun(), members: [], tasks: [], attempts: [], integrations: [], events: [], lastSequence: 1, hasMoreEvents: false })
beforeEach(() => setActivePinia(createPinia()))
describe('Team renderer store', () => {
  it('keeps healthy history visible and removes stale actionable snapshots for unavailable runs', async () => {
    const original = snapshot(), other = { ...original.run, id: '00000000-0000-4000-8000-000000000099' }
    vi.stubGlobal('window', { chorus: { team: { list: vi.fn().mockResolvedValue({ ok: true, value: { runs: [other], unavailable: [{ runId: original.run.id, reason: 'History retained for recovery.' }] } }) } } })
    const store = useTeamStore(); store.runs[original.run.id] = original.run; store.snapshots[original.run.id] = original
    await store.load(original.run.projectId)
    expect(store.runs[other.id]).toEqual(other); expect(store.runs[original.run.id]).toBeUndefined(); expect(store.snapshots[original.run.id]).toBeUndefined()
    expect(store.unavailable[original.run.id].reason).toContain('retained'); vi.unstubAllGlobals()
  })
  it('snapshots nested Vue proxies into cloneable plain payloads', () => {
    const state = reactive({ config: teamFixtureRun().config }); const plain = plainTeamInput(state)
    expect(() => structuredClone(plain)).not.toThrow(); expect(plain).toEqual(state)
    plain.config.helpers[0].label = 'Changed'; expect(state.config.helpers[0].label).toBe('Helper')
  })
  it('does not roll back a snapshot from an out-of-order response', () => {
    const current = snapshot(); current.run.version = 8; current.lastSequence = 20
    expect(newerTeamSnapshot(current, snapshot())).toBe(false)
    const next = structuredClone(current); next.lastSequence++
    expect(newerTeamSnapshot(current, next)).toBe(true)
  })
  it('shares one listener and disposes it after the final pane detaches', () => {
    const dispose = vi.fn(), subscribe = vi.fn(() => dispose)
    vi.stubGlobal('window', { chorus: { team: { onChanged: subscribe } } })
    const store = useTeamStore(), a = store.connect(), b = store.connect()
    expect(subscribe).toHaveBeenCalledTimes(1); a(); a(); expect(dispose).not.toHaveBeenCalled(); b(); expect(dispose).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
  it('retains the last snapshot and surfaces a failed refresh', async () => {
    vi.stubGlobal('window', { chorus: { team: { snapshot: vi.fn().mockResolvedValue({ ok: false, code: 'BLOCKED', message: 'Retained state unavailable.' }) } } })
    const store = useTeamStore(), original = snapshot(); store.snapshots[original.run.id] = original
    await expect(store.refresh(original.run.id)).rejects.toThrow('Retained state unavailable')
    expect(store.snapshots[original.run.id].lastSequence).toBe(1); expect(store.errors[original.run.id]).toBe('Retained state unavailable.')
    vi.unstubAllGlobals()
  })
})
