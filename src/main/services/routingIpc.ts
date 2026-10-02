import { BrowserWindow, ipcMain } from 'electron'
import type { z } from 'zod'

import {
  ROUTING_CHANNELS,
  routingEmptyRequestSchema,
  routingModelListSchema,
  routingObservationSettingsSchema,
  routingProgressEventSchema,
  routingRefreshRequestSchema,
  routingRefreshResultSchema,
  routingSettingsSchema,
  routingSettingsSetRequestSchema,
  routingStatusSchema,
  routingTiersRequestSchema,
  tierResultSchema,
  type RoutingReply
} from '../../shared/routing'
import { scrubSecrets } from './logger'
import type { RoutingObserver } from './routingObserver'
import { DEFAULT_ROUTING_LOG, RoutingError, type RoutingLog, type RoutingService } from './routingService'

/**
 * Model Routing Task 2-4: the `routing:*` IPC surface (ImplementationSpec-2-4,
 * K9, MR-G5). Eight request channels and one broadcast, on the Teams pattern
 * (`teamIpc.ts`), with routing's fixed error codes.
 *
 * Every request goes through the same envelope, in this order, and nothing
 * reaches the service before steps 1 and 2 pass:
 *   1. the sender must be an application window's main frame (UNAUTHORIZED);
 *   2. the input is parsed with its Zod schema here, in main (INVALID_REQUEST);
 *   3. the action runs;
 *   4. its output is parsed too; a failure is main's own bug, so it is
 *      OPERATION_FAILED, and the warning names the channel and an issue count,
 *      never the payload (C23);
 *   5. `{ ok: true, value }` carries the PARSED output.
 *   6. A RoutingError keeps its code, its message passed through
 *      `scrubSecrets` once more; anything else is logged and becomes the fixed
 *      OPERATION_FAILED message, so exception text never reaches a response.
 *
 * The preload has no Zod (it breaks under the page CSP); every check is here.
 * Progress events are parsed before they are sent, an invalid one is dropped
 * with a warning, and a `failed` event's message is scrubbed once more. No
 * response or event carries key material.
 */

export interface RoutingIpcDeps {
  service: Pick<
    RoutingService,
    'models' | 'tiers' | 'refresh' | 'getSettings' | 'setSettings' | 'getObservation' | 'setObservation' | 'onProgress'
  >
  observer: Pick<RoutingObserver, 'status'>
  log?: RoutingLog // default: logger with the '[routing] ' prefix
}

const MESSAGES = {
  unauthorized: 'Routing actions require an application window.',
  invalid: 'Invalid routing request.',
  failed: 'Routing operation failed.'
} as const

/** Registered once, from index.ts. Validates every input and output in main (MR-G5). */
export function registerRoutingIpc(deps: RoutingIpcDeps): void {
  const { service, observer } = deps
  const log = deps.log ?? DEFAULT_ROUTING_LOG

  function handle<I, O>(channel: string, input: z.ZodType<I>, output: z.ZodType<O>, action: (q: I) => O | Promise<O>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<RoutingReply<O>> => {
      try {
        // 1. Sender: an application window's main frame (the teamIpc.ts check). The service is not called.
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || window.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
          return { ok: false, code: 'UNAUTHORIZED', message: MESSAGES.unauthorized }
        }
        // 2. Input. The service is not called on a failure.
        const parsed = input.safeParse(raw)
        if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: MESSAGES.invalid }
        // 3. Action.
        const value = await action(parsed.data)
        // 4. Output (C23): main's own bug. Log the channel and the issue count, never the payload.
        const checked = output.safeParse(value)
        if (!checked.success) {
          log.warn(`${channel} produced an invalid response (${checked.error.issues.length} issues)`)
          return { ok: false, code: 'OPERATION_FAILED', message: MESSAGES.failed }
        }
        // 5.
        return { ok: true, value: checked.data }
      } catch (error) {
        // 6.
        if (error instanceof RoutingError) return { ok: false, code: error.code, message: scrubSecrets(error.message) }
        try {
          log.error(`${channel} failed`, error)
        } catch {
          // A non-Error throwable (a string, null) can make the logger's err serializer throw;
          // the fixed reply below must not depend on the log call succeeding.
        }
        return { ok: false, code: 'OPERATION_FAILED', message: MESSAGES.failed }
      }
    })
  }

  handle(ROUTING_CHANNELS.models, routingEmptyRequestSchema, routingModelListSchema, () => service.models())
  handle(ROUTING_CHANNELS.tiers, routingTiersRequestSchema, tierResultSchema, (q) => service.tiers(q))
  // May take about 30 seconds while the probe runs; `invoke` has no timeout, and progress arrives on the broadcast.
  handle(ROUTING_CHANNELS.refresh, routingRefreshRequestSchema, routingRefreshResultSchema, (q) => service.refresh(q))
  handle(ROUTING_CHANNELS.status, routingEmptyRequestSchema, routingStatusSchema, () => observer.status())
  handle(ROUTING_CHANNELS.settingsGet, routingEmptyRequestSchema, routingSettingsSchema, () => service.getSettings())
  handle(ROUTING_CHANNELS.settingsSet, routingSettingsSetRequestSchema, routingSettingsSchema, (q) => service.setSettings(q.settings))
  handle(ROUTING_CHANNELS.observationGet, routingEmptyRequestSchema, routingObservationSettingsSchema, () => service.getObservation())
  handle(ROUTING_CHANNELS.observationSet, routingObservationSettingsSchema, routingObservationSettingsSchema, (q) => service.setObservation(q))

  // The broadcast, on council's emitProgress shape (ipc.ts): parsed HERE, then sent to every live
  // window. Unlike emitProgress it never throws: an invalid event is dropped with a warning.
  service.onProgress((event) => {
    try {
      const parsed = routingProgressEventSchema.safeParse(event)
      if (!parsed.success) {
        log.warn('progress event did not validate; not sent')
        return
      }
      // A `failed` event's message is scrubbed once more, as a RoutingError's message is on the reply path.
      const outgoing = parsed.data.stage === 'failed' ? { ...parsed.data, message: scrubSecrets(parsed.data.message) } : parsed.data
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue
        try {
          window.webContents.send(ROUTING_CHANNELS.progress, outgoing)
        } catch {
          log.warn('progress event could not be sent to a window')
        }
      }
    } catch {
      log.warn('progress broadcast failed')
    }
  })
}
