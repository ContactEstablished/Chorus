import { BrowserWindow, type WebContents } from 'electron'
import {
  IpcChannel,
  appearanceSettingsChangedSchema,
  type AppearanceSettings,
  type AppearanceSettingsChanged
} from '../../shared/ipc'
import type { StorageService } from './storage'

/**
 * Text size (Settings > Appearance, and Ctrl+= / Ctrl+- / Ctrl+0).
 *
 * ⚠ CHROMIUM PAGE ZOOM, NOT A CSS FONT SIZE. The app's CSS is authored in px
 * against the mocks, so a root font-size would move almost nothing; page zoom
 * scales every px uniformly, and xterm re-measures its cells when the zoom
 * changes `devicePixelRatio`, so the panes refit on their own.
 *
 * ⚠ ZOOM IS KEYED BY HOST, AND THAT REACHES THE DICTATION OVERLAY IN DEV ONLY.
 * Chromium stores a non-isolated zoom per host (`SetZoomLevelForHost`). The
 * packaged app loads both windows from file:// URLs, which have no host, so
 * each page is keyed by its full URL and the overlay stays at 100%. `npm run
 * dev` serves both from the same localhost origin, so there the overlay scales
 * with the app. Both measured on Electron 43.1.1 with two bare windows.
 */

/** Put a stored text size on a window. Idempotent. */
export function applyUiZoom(target: WebContents, settings: AppearanceSettings): void {
  if (!target.isDestroyed()) target.setZoomFactor(settings.zoomPercent / 100)
}

/**
 * Store a text size, apply it to `target`, and tell every renderer — the
 * settings screen follows a shortcut press, and App raises the readout for one.
 * Returns what was STORED, which is what callers answer with.
 */
export function setUiZoom(
  storage: StorageService,
  target: WebContents,
  zoomPercent: number,
  source: AppearanceSettingsChanged['source']
): AppearanceSettings {
  storage.writeAppearanceSettings({ zoomPercent })
  const stored = storage.readAppearanceSettings()
  applyUiZoom(target, stored)
  const event = appearanceSettingsChangedSchema.parse({ settings: stored, source })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannel.AppearanceSettingsChanged, event)
  }
  return stored
}
