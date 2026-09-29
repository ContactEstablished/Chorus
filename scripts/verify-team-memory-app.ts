import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import neo4j from 'neo4j-driver'
import { StorageService } from '../src/main/services/storage'
import type { TeamCapabilities, TeamSnapshot } from '../src/shared/team'

const evidence = process.env.CHORUS_TEAM_MEMORY_APP_EVIDENCE!
const uri = process.env.CHORUS_TEAM_MEMORY_APP_URI!
assert(/^bolt:\/\/127\.0\.0\.1:\d+$/.test(uri), 'Fixture requires a loopback test instance')
app.setPath('userData', path.join(evidence, 'profile'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))

app.whenReady().then(async () => {
  const source = path.join(evidence, 'source'); fs.mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { windowsHide: true, encoding: 'utf8' }).trim()
  git('init', '-q'); fs.writeFileSync(path.join(source, 'README.md'), '# Isolated Team memory registration fixture\n')
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture')
  const storage = new StorageService(path.join(evidence, 'profile', 'chorus.db'))
  const { project } = storage.getOrCreateProject(source), now = new Date().toISOString()
  storage.setActiveProjectId(project.id)
  storage.upsertProjectMemory({ projectId: project.id, mode: 'existing', boltUri: uri, databaseName: 'neo4j', authMode: 'none', credentialProfileId: null, containerId: null, containerName: null, volumeName: null, boltPort: null, httpPort: null, schemaVersion: 0, lastSeededAt: null, createdAt: now, updatedAt: now })
  storage.close()
  const graph = neo4j.driver(uri, undefined, { connectionTimeout: 3000, maxTransactionRetryTime: 0 })
  let window: BrowserWindow | undefined
  const results: unknown[] = []
  try {
    await graph.verifyConnectivity()
    require(path.resolve('out/main/index.js'))
    for (let i = 0; i < 120; i++) { window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')); if (window && !window.webContents.isLoading()) break; await sleep(500) }
    assert(window, 'Real application window unavailable')
    const evaluate = (code: string) => window!.webContents.executeJavaScript(code, true)
    const invoke = async <T>(operation: string, input: unknown): Promise<T> => { const reply = await evaluate(`window.chorus.team.${operation}(${JSON.stringify(input)})`); assert(reply.ok, JSON.stringify(reply)); return reply.value }
    const capabilities = await invoke<TeamCapabilities>('capabilities', { projectId: project.id })
    for (const leadId of ['claude', 'codex']) {
      const lead = capabilities.options.find(option => option.key === leadId && option.enabled)!
      assert(lead, `${leadId} is unavailable`)
      const acknowledgment = await invoke<{ runId: string }>('launch', { projectId: project.id, clientRequestId: randomUUID(), config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...lead.member, id: randomUUID() }, helpers: [{ ...lead.member, id: randomUUID() }], concurrency: 1, executionMinutes: 5, integrationPolicy: 'ask' } })
      let state: TeamSnapshot | undefined, trusted = false
      for (let i = 0; i < 120; i++) {
        state = await invoke<TeamSnapshot>('snapshot', { runId: acknowledgment.runId, afterSequence: 0 })
        write(`${leadId}-snapshot.json`, state)
        assert.notEqual(state.run.status, 'blocked', state.run.blocker ?? undefined)
        if (state.run.status === 'active') break
        if (state.run.leadSessionId) {
          const terminal = await evaluate(`window.chorus.attachSession(${JSON.stringify({ sessionId: state.run.leadSessionId, agent: leadId })})`)
          fs.writeFileSync(path.join(evidence, `${leadId}-terminal.log`), terminal.buffer)
          const plain = terminal.buffer.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
          if (!trusted && /Yes, continue|Yes, I trust this folder/.test(plain)) {
            trusted = true; await sleep(1200)
            if (leadId === 'claude') await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\x1b[B')})`)
            await sleep(300); await evaluate(`window.chorus.writeSession(${JSON.stringify(state.run.leadSessionId)},${JSON.stringify('\r')})`)
          }
        }
        await sleep(1000)
      }
      assert.equal(state?.run.status, 'active', 'Native Team bridge did not activate')
      const session = graph.session({ database: 'neo4j' })
      try {
        const registered = await session.run('MATCH (s:AgentSession {id: $id}) RETURN s.agent AS agent, s.chorusProjectId AS project, s.writtenVia AS via, s.model AS model', { id: state!.run.leadSessionId })
        assert.equal(registered.records.length, 1)
        const actual = registered.records[0].toObject()
        assert.equal(actual.agent, leadId); assert.equal(actual.project, project.id); assert.equal(actual.via, 'app'); assert.equal(actual.model, lead.member.model)
        results.push({ lead: leadId, runId: state!.run.id, sessionId: state!.run.leadSessionId, graphRegistration: actual, nativeTeamBridgeActive: true, helperAttempts: state!.attempts.length })
      } finally { await session.close() }
      await invoke('control', { runId: state!.run.id, expectedVersion: state!.run.version, clientRequestId: randomUUID(), action: 'stop' })
      for (let i = 0; i < 60; i++) { state = await invoke<TeamSnapshot>('snapshot', { runId: acknowledgment.runId, afterSequence: 0 }); if (state.run.status === 'stopped') break; await sleep(500) }
      assert.equal(state!.run.status, 'stopped'); write(`${leadId}-stopped.json`, state)
    }
    assert.equal(git('status', '--porcelain'), '')
    write('report.json', { passed: true, realApplicationMain: true, injectedMemoryCallback: false, isolatedGraph: uri, graphIndexingExercised: false, results, sourcePreserved: true, evidence, at: new Date().toISOString() })
  } catch (error) { write('failure.json', { message: String(error), stack: error instanceof Error ? error.stack : undefined }); process.exitCode = 1 }
  finally { await graph.close(); app.quit() }
}).catch(error => { write('failure.json', { message: String(error) }); process.exitCode = 1; app.quit() })
