# Implementation Spec 3-4 — First Real Settings View

_Companion to `Tasks/Task-3-4.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to commit `fb3201e`, verified 2026-07-22.** Re-anchor against Task 3-3's commit before starting: this task consumes 3-2's and 3-3's channels, and their final shapes are whatever those commits landed, not whatever the specs sketched.

---

## 1. The navigation concept — deliberately the smallest one that works

D29 gives Chorus its first view switch, and notes that Phase 3b's council configuration UI will inherit it. That is an argument for making it *good*, not for making it *general*. A router, a route table, and URL state would all be speculative: there are two views, one of them has two sections, and nothing links to a deep location.

So the switch is the same shape as `viewStore.mode`, which has carried the filmstrip/grid decision since 1b-2 without complaint:

```ts
// App.vue
const activeView = ref<'workspace' | 'settings'>('workspace')
```

**Where the `v-if` goes matters more than what drives it.** Put it around the **main region only**, leaving the top bar mounted in both views:

```
<div class="app">
  <header> ProjectTabs · view toggle · [Settings ⇄ Workspace] </header>
  <main>
    <SettingsView v-if="activeView === 'settings'" @close="activeView = 'workspace'" />
    <template v-else>  … FilmstripRenderer / LayoutRenderer / EmptyState … </template>
  </main>
  … overlays (unchanged) …
</div>
```

The header staying mounted is not cosmetic — it is what keeps the user from being stranded in a modal-feeling screen with no exit, and it is why this is a *view switch* rather than a fourth overlay.

**The terminal panes will unmount when the workspace region is `v-if`'d away.** That is acceptable and expected: the PTYs live in main, the sessions keep running, and `attach()` replays the ring buffer on the way back — this is precisely the F5-resolved architecture doing its job. What must be verified (task acceptance) is that a session **survives the round trip with its scrollback intact**, because that is the observable proof the replay path works from a view switch and not just from a sibling-close remount.

Consider `v-show` if the round trip proves visually janky; do **not** reach for `<KeepAlive>`, which would keep xterm instances alive invisibly and reintroduce a class of leak `de98679` spent a session removing.

---

## 2. `stores/settings.ts`

Model it on `stores/view.ts`, which is the closest existing thing: small state, an async loader with a **store-level supersede guard**, no debounce.

```ts
interface SettingsState {
  providers: ProviderConfigWire[]
  profiles: CredentialProfileMeta[]
  adapters: AdapterDescriptor[]
  loading: boolean
  error: string | null
  /** Store-level supersede token. A component-level token cannot cancel an
   *  await that has already started INSIDE the store — the exact reason
   *  view.ts carries `loadSeq` beyond App.vue's own token (1b-2). */
  loadSeq: number
}
```

**There is no `key` field, and there will never be one.** State this in a comment at the top of the interface, because the absence is the design and a future contributor will otherwise "helpfully" add one for an edit form.

```ts
async load(): Promise<void> {
  const seq = ++this.loadSeq
  this.loading = true
  try {
    const [providers, profiles, adapters] = await Promise.all([
      window.chorus.listProviders(),
      window.chorus.listCredentialProfiles(),
      window.chorus.listAdapters()
    ])
    if (seq !== this.loadSeq) return   // superseded — drop the whole result
    this.providers = providers
    this.profiles = profiles
    this.adapters = adapters
  } catch (e) {
    if (seq !== this.loadSeq) return
    this.error = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === this.loadSeq) this.loading = false
  }
}
```

The `finally` guard is easy to get wrong: an unguarded `this.loading = false` lets a **stale** load clear the spinner of a **live** one.

### Mutations

Each action calls through and reloads. The key parameter is **passed through, never stored**:

```ts
/** The plaintext key travels as a PARAMETER and is never assigned to state.
 *  Pinia state is devtools-inspectable; a key placed here would be readable
 *  by anyone with the window open, which is exactly the exposure D33 clause 3
 *  exists to prevent. The unit test deep-scans $state to keep this true. */
async createProfile(input: { providerId: string; label: string; key: string }): Promise<boolean> {
  const res = await window.chorus.createCredential({ ...input })
  if (!res.ok) { this.error = res.reason; return false }
  await this.load()
  return true
}
```

**D14:** `input` here is built from component-local `ref` values. `{...input}` produces a plain object literal of primitives — sufficient. If any field ever becomes store-sourced, it needs `JSON.parse(JSON.stringify(...))`. Say so in a comment; this is the D14 trap and it has bitten twice.

---

## 3. `SettingsView.vue` — the shell

```ts
onMounted(async () => {
  let alive = true
  onUnmounted(() => { alive = false })
  await settings.load()
  if (!alive) return          // F13 — bail after EVERY await
  …
})
```

**F13 is not theoretical here.** `de98679` fixed exactly this in `TerminalPane`: the continuation runs regardless of unmount, `cleanups` arrays are consumed exactly once, and anything registered after the await leaks for the app's lifetime. This view has three concurrent loads behind one await and a plausible user behaviour (open settings, immediately go back) that triggers it. Register the unmount flag **before** the first await, not after.

Layout: a header with the title and a "← Workspace" button (emitting `close`), then the two panels stacked. Two panels do not justify a tab strip; if a third section arrives in Phase 3b, that is when it earns one.

---

## 4. `SettingsCredentials.vue` — the one security-sensitive component

### 4.1 The input

```html
<input
  ref="keyInput"
  v-model="keyValue"
  type="password"
  autocomplete="off"
  spellcheck="false"
  class="…"
/>
```

- `type="password"` — not for secrecy from the user, but so the browser never treats it as autofillable text and no screenshot of the settings screen leaks it.
- `autocomplete="off"` — Chromium's password manager must not offer to save it.
- `spellcheck="false"` — a spellchecker is a text-processing path a key has no business entering.
- **`keyValue` is a component-local `ref`.** Not a prop, not store state, not a `defineModel` bound to anything that outlives the form.

### 4.2 The submit path

```ts
async function submit(): Promise<void> {
  if (!providerId.value || !label.value || !keyValue.value || busy.value) return
  busy.value = true
  try {
    const ok = await settings.createProfile({
      providerId: providerId.value,
      label: label.value,
      key: keyValue.value
    })
    if (ok) { keyValue.value = ''; label.value = '' }
  } finally {
    busy.value = false
  }
}
```

**Clear on success only.** Clearing on failure would destroy a long pasted key over a transient refusal — an obvious user-hostile choice that is also, on reflection, the *safer-looking* one, which is how it tends to get chosen. Do not.

**Also clear on unmount:**

```ts
onBeforeUnmount(() => { keyValue.value = '' })
```

A `ref` on an unmounted component is garbage eventually, not immediately; explicit clearing shortens the window at zero cost.

### 4.3 What the error path may say

An error surfaced here comes from main and has already been through D33's message discipline (label only, no blob, no key). **The renderer must not enrich it.** Specifically:

```ts
// WRONG — interpolates the submitted value into a rendered string:
error.value = `Could not store ${keyValue.value}: ${res.reason}`
// RIGHT:
error.value = res.reason
```

This is the single likeliest way a key reaches the DOM in this whole phase, and it looks like helpful diagnostics while you are writing it.

### 4.4 Rendering a profile

The complete set of facts the renderer may know about a credential profile:

| Field | Source | Rendered as |
|---|---|---|
| `label` | user-supplied at creation | the primary identifier — it is doing the disambiguation work fingerprints were removed from (D33(b)) |
| `providerId` | row | resolved to the provider's `name` for display |
| `createdAt` | row | a relative date |
| `lastVerifiedAt` | row | "never verified" until Task 3-6's probe writes it |
| `unavailableSince` | row | a distinct, actionable **unavailable** state |

**Nothing else exists.** No key, no fingerprint, no length, no masked preview. If the design feels information-poor, that is the contract being visible, not a gap to fill.

The `unavailable` state must not look like a healthy row with a subtitle. It is the state where a launch naming this profile will be **refused**, so it earns a real visual treatment and a message that says what to do: *re-enter the credential*. Reuse the red-dot vocabulary the pane headers already use for `exited`, so the app has one language for "this thing is broken".

### 4.5 The label field should push for a real label

Since the label is the only handle a user will ever have on a stored key, an empty-ish one is a future support problem. A placeholder doing real work (`e.g. "Anthropic — personal"`, `"OpenRouter — work billing"`) costs nothing. Do not add validation beyond 3-2's `min(1).max(120)` — nagging is worse than a bad label.

---

## 5. `SettingsProviders.vue`

The form's two selects are driven entirely by `adapter:list`:

- **Adapter** — `adapters.map(a => ({value: a.id, label: a.displayName}))`.
- **Auth mode** — the selected adapter's `authMethods`, rendered by `label`, valued by `type`.

**`env_var_name` is an override, and the distinction from a default is the whole point.** Render the selected auth method's `requiredEnvVar` as the input's **placeholder**, and leave the input **empty** by default:

```html
<input v-model="envVarName" :placeholder="selectedAuthMethod?.requiredEnvVar ?? 'adapter default'" />
```

Pre-filling would persist a copy of today's default into the row, so a later adapter correction would silently not apply to existing providers. An empty column means "use the adapter's default" and stays correct forever — which is exactly what D34(e) intends by making the column nullable.

**Provider deletion** surfaces 3-2's structured refusal inline. Do not pre-disable the delete button by counting profiles in the renderer: the renderer's list can be stale, main is the authority, and duplicating the rule creates two places for it to be wrong. Let main refuse and render the reason — the same discipline `LaunchDialog` uses for launch failures.

---

## 6. The palette command

In `buildCommands`, following the existing group conventions:

```ts
{
  id: 'settings.open',
  group: 'Application',
  label: 'Open settings',
  keywords: ['settings', 'providers', 'credentials', 'keys', 'config'],
  enabled: () => true,
  run: () => ctx.openSettings()
}
```

`PaletteContext` gains `openSettings: () => void`, supplied by `App.vue`'s `paletteCommands` computed alongside the existing `openLaunchDialog`. Keep `commands.ts` pure — no store imports, no `window.chorus` (the 1b-3 discipline).

Note that `fuzzyFilter` **omits disabled commands**, so `enabled: () => true` is deliberate: settings are not project-scoped, and a user with no project should still reach them. If the implementer concludes otherwise, that is a design change to flag rather than encode.

---

## 7. Verification notes

### 7.1 The sweep must run against the live window

Every check in the task's no-leak sweep is a CDP `Runtime.evaluate` against the **running** app after a real form submission — not a reasoned argument from reading the code. Wrap each in an IIFE (top-level `const` collides across evaluates). The Pinia check needs the store instance; the simplest reliable route is to expose nothing and instead read Vue devtools' global hook, or — more robustly — assert over `JSON.stringify(document.documentElement.outerHTML)` **plus** a `performance`-free scan of the store via an app-level debug accessor you then remove. If exposing an accessor is required to test, **remove it before committing** and say so; the review checks the commit diff (the Task 2-4 instrumentation precedent).

### 7.2 The test-the-test discipline

Both leak checks (unit deep-scan and runtime DOM scan) must be **shown to fail** when a key is deliberately retained. A scan that would pass regardless proves nothing, and this is the one task where a false-negative security check is worse than no check — it would be cited later as evidence.

### 7.3 The reload check has a specific point

Reloading the window and confirming the profile still lists **while remaining unrecoverable** is what proves persistence and secrecy are not in tension — i.e. that the implementer did not achieve secrecy by keeping the profile only in memory. Do it.
