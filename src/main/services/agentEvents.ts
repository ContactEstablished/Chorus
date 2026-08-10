import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { logger } from './logger'
import {
  classifyHookEvent,
  parseHookPath,
  readHookEventName,
  readTranscriptPath,
  type AgentActivity
} from './agentEventsCore'

/**
 * The localhost hook listener — Phase 4's spine, built here for its FIRST
 * consumer: the filmstrip's activity lights.
 *
 * An agent CLI that supports hooks is configured (per session, at launch) to
 * POST its lifecycle events here. That gives Chorus the one fact it could
 * never derive before: whether a live agent is WORKING or has STOPPED AND
 * NEEDS A HUMAN. See `agentEventsCore.ts` for why that retires D78's premise.
 *
 * ─── SCOPE, STATED SO IT IS NOT MISTAKEN FOR ALL OF PHASE 4 ───────────────
 * This is the listener and the activity derivation, and nothing else. Phase 4
 * also owns notification policies, toast -> focus-pane, the tray badge, the
 * notification center, the Attention Inbox and the per-session event timeline;
 * NONE of them are built here. In particular there is deliberately NO
 * `agent_events` TABLE: events are held in memory only, because the lights
 * need the CURRENT state and nothing yet reads history. The append-only bus
 * stays Phase 4's to add when a consumer exists — an unused table with a
 * migration behind it is a schema commitment made for nobody.
 *
 * ─── SECURITY: THE [CR] QUESTION THE ROADMAP PARKED ───────────────────────
 * The roadmap's open question is *"how do we secure the localhost hook
 * listener against local processes spoofing agent events?"*. The answer
 * implemented here, and its honest limit:
 *
 *  1. **Bound to 127.0.0.1, on an OS-assigned ephemeral port.** Nothing off
 *     this machine can reach it, and the port is not guessable from a
 *     well-known constant.
 *  2. **A per-session capability token** — 32 crypto-random bytes, minted at
 *     launch, mapped to exactly one sessionId, revoked on exit. An event is
 *     attributed by TOKEN, never by anything in the payload, so a body that
 *     claims someone else's `session_id` cannot cross sessions. This is also
 *     what makes attribution correct at all: Claude's own `session_id` is not
 *     Chorus's, and two sessions in one cwd would be indistinguishable.
 *  3. **The surface is one route.** POST `/hook/<64 hex>` and nothing else;
 *     every other method, path and token shape gets an identical 404 with an
 *     empty body, so the listener never confirms what exists.
 *  4. **Bounded input.** The body is capped and the connection destroyed past
 *     the cap, so a local process cannot grow main's heap through this port.
 *  5. **Two fields are read** off the body, and only two: `hook_event_name`
 *     (the lights) and `transcript_path` (the context ring, v16). No prompt
 *     text, no `last_assistant_message`, no tool input is extracted, stored or
 *     logged.
 *
 *     ⚠ POINT 5 USED TO READ "**Only `hook_event_name` is read** … no
 *     transcript path", and v16 made that false. It is corrected here rather
 *     than left standing, because a stale security claim is worse than none —
 *     the next person to widen this surface would have been measuring against a
 *     guarantee the code had already stopped honouring. `contextUsage.ts`
 *     carries the full argument for why reading the path is acceptable and what
 *     bounds it; the short version is that the token already implies same-user
 *     access, the read is size-capped, and no byte of the file reaches any
 *     output.
 *
 * ⚠ NAMED LIMIT, NOT A CLAIM OF PROOF: this defends against a local process
 * that does not already have the user's file access — a blind port-scanner
 * spraying JSON at localhost. It does NOT defend against a process running as
 * the same user, which can read the token out of the per-session settings file
 * (or the DB, or main's heap) and is therefore already inside the trust
 * boundary the vault assumes. Same-user code execution is an excluded threat
 * class here exactly as it is for `safeStorage`, and it is recorded rather
 * than papered over.
 */

export type AgentActivityListener = (sessionId: string, activity: AgentActivity) => void

/**
 * v16: called with the transcript path off any hook body that carries one.
 *
 * ⚠ A CALLBACK RATHER THAN A DIRECT DEPENDENCY ON THE CONTEXT TRACKER, so this
 * module keeps knowing nothing about context, windows or token counters — its
 * job stays "authenticate a hook and read two fields". It is also what lets the
 * listener be constructed in tests with no tracker at all.
 *
 * ⚠ IT MUST NOT THROW AND MUST NOT BLOCK: it is invoked from inside the hook
 * request handler, which Claude Code waits on.
 */
export type TranscriptPathListener = (sessionId: string, transcriptPath: string) => void

/** A hook body past this is refused outright. Real payloads observed at
 *  launch are ~300–2000 bytes; `Stop` carries `last_assistant_message` and is
 *  the largest. 256 KB is far above any of them and far below anything that
 *  could pressure main's heap. */
const MAX_BODY_BYTES = 256 * 1024

/** A hook command that cannot deliver in this long has already lost its race
 *  with the next event; the socket is closed rather than held. */
const REQUEST_TIMEOUT_MS = 5_000

export interface AgentEventListener {
  /** Bind the server. Idempotent; resolves with the bound port. */
  start(): Promise<number>
  /**
   * Mint this session's capability token and return the URL its hook command
   * must POST to. Re-registering a session ROTATES the token (a restart gets a
   * fresh one and the old one stops working immediately).
   * Throws if called before `start()` — the URL needs the bound port.
   */
  register(sessionId: string): string
  /** Revoke the token and forget the activity. Safe to call for an unknown id. */
  revoke(sessionId: string): void
  /** Current activity, or null when this session has never reported one. */
  activityFor(sessionId: string): AgentActivity | null
  /** Every session with a known activity — the renderer's cold-start read. */
  snapshot(): ReadonlyArray<{ sessionId: string; activity: AgentActivity }>
  /** Edge-triggered: fires only when a session's activity actually CHANGES. */
  onActivity(listener: AgentActivityListener): () => void
  /** v16: every hook body carrying a transcript path, NOT edge-triggered — the
   *  path is the same every time and the consumer throttles its own reads. */
  onTranscriptPath(listener: TranscriptPathListener): () => void
  dispose(): Promise<void>
}

export function createAgentEventListener(): AgentEventListener {
  /** token -> sessionId. The ONLY attribution path (security note 2). */
  const tokens = new Map<string, string>()
  /** sessionId -> token, so a re-register can revoke the previous one. */
  const bySession = new Map<string, string>()
  const activity = new Map<string, AgentActivity>()
  const listeners = new Set<AgentActivityListener>()
  const transcriptListeners = new Set<TranscriptPathListener>()

  let server: http.Server | null = null
  let port: number | null = null
  let starting: Promise<number> | null = null

  function record(sessionId: string, next: AgentActivity): void {
    // Edge-triggered, exactly like the renderer's attention reporter: a
    // working agent fires PreToolUse/PostToolUse pairs continuously, and
    // broadcasting each one would put a stream of no-op IPC messages behind
    // every tool call.
    if (activity.get(sessionId) === next) return
    activity.set(sessionId, next)
    for (const listener of listeners) {
      try {
        listener(sessionId, next)
      } catch (err) {
        // One bad listener must not stop the others, and must never take down
        // the HTTP request that is mid-flight.
        logger.error({ err }, '[agent-events] activity listener threw')
      }
    }
  }

  /** Every rejection looks identical from outside (security note 3). */
  function reject(res: http.ServerResponse): void {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      req.resume() // drain, or the socket hangs
      reject(res)
      return
    }
    const token = parseHookPath(req.url)
    const sessionId = token ? tokens.get(token) : undefined
    if (!sessionId) {
      req.resume()
      reject(res)
      return
    }

    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Destroy rather than respond: a sender past the cap is not a client
        // we owe a reply to (security note 4).
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      // ⚠ ALWAYS ANSWER, AND ANSWER FAST. A hook command that blocks is a hook
      // command that stalls the AGENT — Claude Code waits on it. Chorus must
      // never be the reason a session hangs, so the response is sent before
      // any derivation work and the body is parsed defensively after.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')

      let body: unknown = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return // untrusted input; a malformed body is simply not an event
      }
      // v16: the context ring, BEFORE the event-name gate below. An event this
      // module cannot classify still carries a perfectly good transcript path,
      // and `SessionStart` — deliberately unclassified, so it lights nothing —
      // is the first hook of a resumed session and therefore the earliest
      // chance to draw a ring at all. Gating the path on the activity map would
      // have made the ring's freshness an accident of which events happen to be
      // in `WORKING_EVENTS`.
      const transcriptPath = readTranscriptPath(body)
      if (transcriptPath) {
        for (const listener of transcriptListeners) {
          try {
            listener(sessionId, transcriptPath)
          } catch (err) {
            // ⚠ The path is NOT in this log line — it names a directory under
            // the user's home. Same rule as the token.
            logger.error({ err }, '[agent-events] transcript listener threw')
          }
        }
      }

      const eventName = readHookEventName(body)
      if (!eventName) return
      const next = classifyHookEvent(eventName)
      // null = an event that says nothing about who holds the ball. The
      // session's activity is LEFT ALONE rather than reset (agentEventsCore).
      if (!next) return
      record(sessionId, next)
    })
    req.on('error', () => {
      /* client vanished mid-body; nothing to clean up beyond the socket */
    })
  }

  return {
    start(): Promise<number> {
      if (starting) return starting
      starting = new Promise<number>((resolve, reject_) => {
        const srv = http.createServer(handle)
        srv.setTimeout(REQUEST_TIMEOUT_MS)
        srv.on('error', (err) => {
          logger.error({ err }, '[agent-events] listener failed to bind')
          reject_(err)
        })
        // Port 0 -> the OS picks a free ephemeral port (security note 1).
        srv.listen(0, '127.0.0.1', () => {
          server = srv
          port = (srv.address() as AddressInfo).port
          logger.info({ port }, '[agent-events] hook listener bound on 127.0.0.1')
          resolve(port)
        })
      })
      return starting
    },

    register(sessionId: string): string {
      if (port === null) {
        throw new Error('agent event listener not started')
      }
      const previous = bySession.get(sessionId)
      if (previous) tokens.delete(previous)
      const token = crypto.randomBytes(32).toString('hex')
      tokens.set(token, sessionId)
      bySession.set(sessionId, token)
      // ⚠ The token is NOT logged, here or anywhere. It is a capability.
      return `http://127.0.0.1:${port}/hook/${token}`
    },

    revoke(sessionId: string): void {
      const token = bySession.get(sessionId)
      if (token) tokens.delete(token)
      bySession.delete(sessionId)
      activity.delete(sessionId)
    },

    activityFor(sessionId: string): AgentActivity | null {
      return activity.get(sessionId) ?? null
    },

    snapshot(): ReadonlyArray<{ sessionId: string; activity: AgentActivity }> {
      return [...activity.entries()].map(([sessionId, a]) => ({ sessionId, activity: a }))
    },

    onActivity(listener: AgentActivityListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    onTranscriptPath(listener: TranscriptPathListener): () => void {
      transcriptListeners.add(listener)
      return () => transcriptListeners.delete(listener)
    },

    async dispose(): Promise<void> {
      tokens.clear()
      bySession.clear()
      activity.clear()
      listeners.clear()
      transcriptListeners.clear()
      const srv = server
      server = null
      starting = null
      port = null
      if (!srv) return
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    }
  }
}
