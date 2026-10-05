import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../services/logger'
import {
  OPENCODE_STATE_FILE_CAP_BYTES,
  classifyRememberedVariant,
  isVerifiedOpencodeStateVersion,
  opencodeModelStatePath,
  patchRememberedVariant
} from './opencodeVariantStateCore'

export type RememberedVariantOutcome = 'written' | 'unchanged' | 'skipped'

/**
 * MR-D25: set opencode's remembered variant for `modelKey` to `effort` before a launch that writes
 * that effort. NEVER throws. 'skipped' — a version outside OPENCODE_VARIANT_STATE_VERSIONS (an
 * unmeasured one, null or 'unknown'), no, empty or relative state home, a
 * missing, non-file (a symlink included), oversize or unreadable (not strict UTF-8, not the measured
 * JSON shape) model.json, invalid input, or a failed write (nothing changed on disk); 'unchanged' —
 * no entry for this model, or it already equals `effort`; 'written'.
 *
 * ⚠ IT WRITES ANOTHER APPLICATION'S STATE FILE (authorised by MR-D25 alone). One key, the rest
 * preserved, temp-fsync-rename beside the target. A running TUI may rewrite the file afterwards.
 *
 * ⚠ THE REWRITE ROUND-TRIPS THROUGH JSON: lossless for 1.18.33's and 1.18.34's own file (strings, arrays and
 * objects only), but numbers beyond double precision or duplicate keys outside that shape may not
 * survive it. And a TUI write that lands between this read and the rename is lost — the race goes
 * both ways, since the TUI may equally overwrite this write.
 */
export function applyRememberedVariant(opts: {
  stateHome: string
  modelKey: string
  effort: string
  installedVersion: string | null
}): RememberedVariantOutcome {
  try {
    if (!isVerifiedOpencodeStateVersion(opts.installedVersion) || opts.stateHome.length === 0) return 'skipped'
    // A relative state home would resolve against Chorus's own cwd, not the child's (review fix N3).
    if (!path.isAbsolute(opts.stateHome)) return 'skipped'
    const target = opencodeModelStatePath(opts.stateHome)
    let stat: fs.Stats
    try {
      // lstat, not stat: a symlinked model.json is not a file here, so it is never replaced by one (N2).
      stat = fs.lstatSync(target)
    } catch {
      return 'skipped' // missing: the ordinary case on a machine where the TUI never remembered anything
    }
    if (!stat.isFile() || stat.size > OPENCODE_STATE_FILE_CAP_BYTES) return 'skipped'
    const bytes = fs.readFileSync(target)
    let text: string
    try {
      // Strict UTF-8 (S2): invalid bytes are unreadable, not U+FFFD that the rewrite would then persist.
      // `ignoreBOM: true` keeps a BOM as U+FEFF, so JSON.parse fails and the file is left alone.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      return 'skipped'
    }
    const state = classifyRememberedVariant(text, opts.modelKey, opts.effort)
    if (state === 'absent' || state === 'equal') return 'unchanged'
    const patched = state === 'differs' ? patchRememberedVariant(text, opts.modelKey, opts.effort) : null
    if (patched === null) return 'skipped'
    writeAtomically(target, patched)
    try {
      logger.info(`[launch] set OpenCode's remembered variant for ${opts.modelKey} to ${opts.effort}`)
    } catch {
      // The file did change; a failing logger must not turn that into 'skipped' (N1).
    }
    return 'written'
  } catch {
    try {
      logger.warn("[launch] could not update OpenCode's remembered variant; the launch continues")
    } catch {
      // Never throws.
    }
    return 'skipped'
  }
}

/** Temp file beside the target (`<target>.chorus-<pid>.tmp`), written and fsync'd, then renamed over it; the temp file is removed on failure. */
function writeAtomically(target: string, text: string): void {
  const temp = `${target}.chorus-${process.pid}.tmp`
  const bytes = Buffer.from(text, 'utf8')
  try {
    const fd = fs.openSync(temp, 'w')
    try {
      let offset = 0
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temp, target)
  } catch (err) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // The reported failure is the write's.
    }
    throw err
  }
}
