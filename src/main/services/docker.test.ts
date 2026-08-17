import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { DockerError, findFreeBoltPort } from './docker'

/**
 * ⚠ NO CONTAINER IS STARTED HERE, AND NO `docker` IS SPAWNED. The subcommand
 * wrappers are thin pass-throughs over builders that `dockerCore.test.ts`
 * already pins argv-for-argv; running them would test docker rather than
 * Chorus, and would fail on any machine without a daemon.
 *
 * What IS tested is the part of this module that is real logic with a real
 * failure mode: the loopback port prober, and the error shape that has to tell
 * a timeout apart from a non-zero exit.
 *
 * (`git.ts`, the module this one is modelled on, has no unit test at all for
 * the same reason — its testable logic lives in pure modules.)
 */

/** A high, unloved range: far from anything Chorus, Neo4j or Docker Desktop
 *  would be holding, so a failure here is this code and not the machine. */
const BASE = 39_140

const opened: Server[] = []

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  )
})

/** Hold a port on loopback for the duration of one test. */
function hold(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.once('listening', () => {
      opened.push(server)
      resolve()
    })
    server.listen({ host: '127.0.0.1', port })
  })
}

describe('findFreeBoltPort — the OS is the registry', () => {
  it('returns the first port when nothing is holding it', async () => {
    await expect(findFreeBoltPort(BASE, 5)).resolves.toBe(BASE)
  })

  it('⚠ skips a port another process is holding on loopback', async () => {
    // This is the case that matters in practice: a second Chorus project's
    // container already published on the base port. No allocation registry is
    // kept, so the skip has to come from a real failed bind.
    await hold(BASE)
    await expect(findFreeBoltPort(BASE, 5)).resolves.toBe(BASE + 1)
  })

  it('skips a contiguous run of held ports', async () => {
    await hold(BASE)
    await hold(BASE + 1)
    await hold(BASE + 2)
    await expect(findFreeBoltPort(BASE, 8)).resolves.toBe(BASE + 3)
  })

  it('⚠ returns null rather than throwing when the whole range is taken', async () => {
    // The caller turns this into an authored sentence naming the range. A throw
    // here would surface as a stack trace in the UI instead.
    await hold(BASE + 10)
    await hold(BASE + 11)
    await expect(findFreeBoltPort(BASE + 10, 2)).resolves.toBeNull()
  })

  it('probes exactly `tries` ports and no more', async () => {
    // Bounded: a machine with a busy range must not have this walk to 65535.
    const held = [BASE + 20, BASE + 21, BASE + 22]
    for (const p of held) await hold(p)
    await expect(findFreeBoltPort(BASE + 20, 3)).resolves.toBeNull()
    // One more try would have found the free port immediately after the run.
    await expect(findFreeBoltPort(BASE + 20, 4)).resolves.toBe(BASE + 23)
  })

  it('does not leak the probe socket — the port it reports is bindable after', async () => {
    const port = await findFreeBoltPort(BASE + 30, 3)
    expect(port).not.toBeNull()
    // If the prober left its own server listening, this would throw EADDRINUSE.
    await expect(hold(port as number)).resolves.toBeUndefined()
  })
})

describe('DockerError — a timeout and a non-zero exit are different failures', () => {
  it('a non-zero exit reports the code and docker’s message', () => {
    const err = new DockerError(['ps', '-a'], 125, 'Error response from daemon: no such container')
    expect(err.timedOut).toBe(false)
    expect(err.message).toContain('docker ps -a failed (125)')
    expect(err.message).toContain('no such container')
  })

  it('⚠ a timeout says so, instead of reporting `failed (null)`', () => {
    // Node reports a timeout kill as code=null with killed=true, so `code`
    // alone cannot distinguish the two — conflating them is exactly what made
    // git's original failure read as an unexplained `failed (null)`.
    const err = new DockerError(['run', '-d'], null, 'Pulling from library/neo4j\n1ab2c3: Downloading', 900_000)
    expect(err.timedOut).toBe(true)
    expect(err.message).toContain('timed out after 900s')
    // The tail of the stream is what tells a user it was pulling, not wedged.
    expect(err.message).toContain('last output: 1ab2c3: Downloading')
  })

  it('a timeout with no output says nothing rather than an empty parenthetical', () => {
    const err = new DockerError(['stop', 'c'], null, '   \n\n  ', 60_000)
    expect(err.message).toContain('timed out after 60s')
    expect(err.message).not.toContain('last output')
  })

  it('carries the argv it ran, for a report that can be reproduced', () => {
    const err = new DockerError(['rm', 'chorus-x'], 1, 'boom')
    expect(err.args).toEqual(['rm', 'chorus-x'])
    expect(err.code).toBe(1)
  })
})
