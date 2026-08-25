import { readonly, ref } from 'vue'

/**
 * THE SAVE CONFIRMATION'S TRIGGER — the mark animates in the middle of the
 * window and says *Saved*, and any view that just wrote something calls
 * `flashSaved()`.
 *
 * ⚠ A MODULE-LEVEL REF RATHER THAN AN EVENT CHAIN, AND THE ALTERNATIVE IS WHY.
 * The three Save buttons that use this sit at three different depths —
 * `ProjectSettingsView` is App's own child, `SettingsVoice` and
 * `SettingsProviders` are two levels down inside `SettingsView` — so an emit
 * would have to be forwarded through a component that has no interest in the
 * fact and would grow a prop and a re-emit for every future caller. This is one
 * import and one call.
 *
 * ⚠ IT HOLDS NO TIMER. How long the confirmation stays is a property of the
 * ANIMATION, and the animation is CSS in `SavedFlash.vue`; a duration here
 * would be a second home for a number that has to match a keyframe. The
 * component times itself out and reports `done`, exactly as `StartupSplash`
 * already does.
 */

/** Bumped on every flash. App uses it as the component's `key`, which is what
 *  makes a second save RESTART the animation instead of leaving the first one
 *  mid-fade: a new key remounts, and CSS animations begin again. Counting up
 *  rather than toggling means two saves in a row are two distinct keys. */
const token = ref(0)
const showing = ref(false)

/** Confirm a write that actually happened. ⚠ ONLY THAT — the word on screen is
 *  `Saved`, so a call on a no-op path (a create flow's untouched form, a
 *  refused write) would be the app claiming something it did not do. */
export function flashSaved(): void {
  token.value += 1
  showing.value = true
}

/** The component's own `done`, wired at the one place it is rendered. */
export function dismissSavedFlash(): void {
  showing.value = false
}

export function useSavedFlash(): {
  savedFlashToken: Readonly<typeof token>
  savedFlashShowing: Readonly<typeof showing>
} {
  return { savedFlashToken: readonly(token), savedFlashShowing: readonly(showing) }
}
