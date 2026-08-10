import { existsSync, realpathSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * The dev server's file-serving allow list.
 *
 * ⚠ THIS EXISTS FOR GIT-WORKTREE DEV, WHERE `node_modules` IS A JUNCTION. A
 * fresh worktree under `.chorus/Chorus/wt-*` has no `node_modules` of its own;
 * the working setup is a directory junction to the primary checkout's copy
 * (`cmd /c mklink /J node_modules ..\..\..\Chorus\node_modules`), which reuses
 * the already-correct better-sqlite3 build instead of reinstalling it.
 *
 * Vite resolves a served path to its REAL location before checking it, so every
 * dependency asset behind that junction resolves outside the worktree root and
 * is refused:
 *
 *   The request id "…\Chorus\node_modules\@fontsource\archivo\files\…woff2"
 *   is outside of Vite serving allow list.
 *
 * The visible symptom is only fallback fonts in dev — the packaged build embeds
 * these assets through the normal bundle and was never affected — but the log
 * fills with refusals that look like a build fault and aren't.
 *
 * ⚠ IT RESOLVES THE TARGET AT RUNTIME RATHER THAN HARDCODING A PATH. A literal
 * `C:\Projects\…\Chorus\node_modules` would encode one machine's layout into a
 * committed file and would be wrong for every other clone. `realpathSync` asks
 * the filesystem where the junction actually goes, and returns the same path it
 * was given in a normal checkout — where the extra entry is a harmless no-op
 * because it is already inside the root.
 *
 * ⚠ AND IT EXTENDS THE DEFAULT RATHER THAN REPLACING IT. Setting `fs.allow`
 * overrides Vite's built-in list wholesale, so omitting `searchForWorkspaceRoot`
 * would trade the font refusals for a harder-to-diagnose set of new ones.
 *
 * Dev-server only: `server.fs` has no effect on `electron-vite build`.
 */
function fsAllowList(): string[] {
  const root = process.cwd()
  const allow = [searchForWorkspaceRoot(root)]
  const nodeModules = resolve(root, 'node_modules')
  try {
    if (existsSync(nodeModules)) {
      const real = realpathSync(nodeModules)
      // Only when it actually points elsewhere — in a normal checkout this is
      // the path we already allowed via the workspace root.
      if (real.toLowerCase() !== nodeModules.toLowerCase()) allow.push(real)
    }
  } catch {
    // A missing or unreadable node_modules is not a config error: dev will fail
    // for its own, much louder reasons. Never let this throw at config load.
  }
  return allow
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      fs: {
        allow: fsAllowList()
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
