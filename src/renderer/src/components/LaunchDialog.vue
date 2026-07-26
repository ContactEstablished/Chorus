<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  AdapterDescriptor,
  AgentKind,
  AttachResponse,
  CredentialProfileMetaWire,
  DetectedCli,
  EffortLevel,
  LaunchProfileWire,
  ModelCatalogEntry,
  PickableWorktree,
  ProviderConfig,
  WorkspaceMode
} from '../../../shared/ipc'

/**
 * Launch dialog (Task 1-4): pick an agent + cwd, launch via session:launch.
 * Agent cards are capability-driven by cli:detect — an undetected agent is a
 * disabled card with a "not found" note, never a hidden or broken option.
 * Validation failures ({ok:false}) render inline; the dialog stays open.
 *
 * Task 2-2 (D22/D26f): the workspace-mode selector. Main computes the default
 * (suggestedMode) and the attachable-worktree list on session:launch-context;
 * the CHOSEN mode always travels explicitly in the launch payload — main
 * validates it, never silently overrides. A non-git project root shows an
 * inline "not a git repository" state and offers only current-tree.
 *
 * Task 3-3 (D34f): cards render from the WIRE — the adapter-supplied
 * agentKind/displayName on each cli:detect row. Nothing here hardcodes an
 * agent name or label anymore; card ORDER now derives from main's
 * DETECTED_TOOLS (the same order the deleted kind-list constant had).
 *
 * Task 3-6 (spec §8): an auth-method choice. SUBSCRIPTION stays the default
 * — a user with no credential profiles sees today's dialog, unchanged; BYOK
 * is opt-in. The api_key choice appears only when an ELIGIBLE profile exists
 * for the selected agent (its provider's adapter_type matches the agent,
 * auth_mode is api_key, and the profile is not marked unavailable).
 */
const emit = defineEmits<{
  cancel: []
  launched: [payload: { agent: AgentKind; snapshot: AttachResponse }]
}>()

/** The active project's id — threaded into both project-aware IPC calls
 *  (Task 1-5: session:launch-context and session:launch resolve it in main). */
const props = defineProps<{ projectId: string }>()

interface AgentCard {
  name: AgentKind
  label: string
  found: boolean
  version: string | null
}

const panel = ref<HTMLDivElement | null>(null)
const cwdInput = ref<HTMLInputElement | null>(null)
const agents = ref<AgentCard[]>([])
const selected = ref<AgentKind | null>(null)
const cwd = ref('')
const projectRoot = ref('')
const recentCwds = ref<string[]>([])
const repoRoot = ref<string | null>(null)
const mode = ref<WorkspaceMode>('current-tree')
const pickable = ref<PickableWorktree[]>([])
const selectedWorktree = ref<string | null>(null)
const error = ref('')
const busy = ref(false)

/* 3-6 (spec §8): BYOK auth choice. 'subscription' is the DEFAULT — with no
 * credential profiles the dialog behaves exactly as it did before 3-6. */
type AuthChoice = 'subscription' | 'api_key'
const authChoice = ref<AuthChoice>('subscription')
const providers = ref<ProviderConfig[]>([])
const profiles = ref<CredentialProfileMetaWire[]>([])
const selectedProfile = ref<string | null>(null)

/** Profiles eligible for the SELECTED agent: the profile's provider targets
 *  that agent (adapter_type) via an api_key auth mode, and the profile is
 *  not marked unavailable (it would refuse at launch anyway; the Settings
 *  view is where that state is explained). */
const eligibleProfiles = computed(() => {
  if (selected.value === null) return []
  const agent = selected.value
  return profiles.value.filter((p) => {
    const provider = providers.value.find((pr) => pr.id === p.providerId)
    return (
      provider !== undefined &&
      provider.adapter_type === agent &&
      provider.auth_mode === 'api_key' &&
      p.unavailableSince === null
    )
  })
})

/* 3a-4 (PLAN §4): the app-level Fast/Balanced/Deep/Max control, plus the
 * missing-model warning beside the resolved model. `effort` is per-launch and
 * UNPERSISTED — nothing here writes it anywhere. */
const adapters = ref<AdapterDescriptor[]>([])
const effort = ref<EffortLevel | null>(null)
const catalog = ref<ModelCatalogEntry[]>([])

/**
 * ⚠ ABSENT, NOT DISABLED. When the selected adapter declares no effort
 * descriptor the control DOES NOT RENDER — no greyed slider, and no
 * explanatory text in its place either; absence is the message. PLAN §4
 * ("LaunchDialog renders only what the selected adapter's capabilities allow")
 * and Task 3-4's standing bar on dead UI.
 *
 * The levels AND their labels come from the descriptor, via adapter:list —
 * there are no hardcoded 'Fast'/'Deep' strings driving choices in this file.
 */
const effortLevels = computed(
  () => adapters.value.find((a) => a.id === selected.value)?.capabilities.reasoningEffort?.levels ?? []
)

/* 3a-5 (D43): the saved-profile picker.
 *
 * ⚠ NAME CARE. `selectedProfile` above already means the CREDENTIAL profile
 * (3-6). This is the LAUNCH profile, and the two are different things — hence
 * the longer name rather than a one-character difference in the same file. */
const launchProfiles = ref<LaunchProfileWire[]>([])
const selectedLaunchProfileId = ref<string | null>(null)

const selectedLaunchProfile = computed<LaunchProfileWire | null>(
  () => launchProfiles.value.find((p) => p.id === selectedLaunchProfileId.value) ?? null
)

/** Save-as-profile, offered after a successful launch. */
const saveLabel = ref('')
const saveError = ref('')
const savedOk = ref(false)

/**
 * The model precedence order, RESOLVED IN MAIN and merely displayed here.
 *
 * Rank 1 is the chosen launch profile's resolved model (main already applied
 * profile -> route -> null); rank 2 is the bare route default for a launch with
 * no profile. The renderer does NOT re-implement the table — that would be the
 * second home 3a-4's ruling exists to prevent.
 */
const resolvedModel = computed<string | null>(() => {
  if (selectedLaunchProfile.value !== null) return selectedLaunchProfile.value.model
  if (authChoice.value !== 'api_key' || selectedProfile.value === null) return null
  const profile = profiles.value.find((p) => p.id === selectedProfile.value)
  if (!profile) return null
  return providers.value.find((pr) => pr.id === profile.providerId)?.model ?? null
})

/** ⚠ Only a model that WAS catalogued and then disappeared earns a warning
 *  (worked example 8). An id the catalog has never seen produces none
 *  (worked example 11) — a warning that fires on the normal case is a warning
 *  nobody reads. The launch is never blocked either way. */
const missingModelRow = computed<ModelCatalogEntry | null>(() => {
  const model = resolvedModel.value
  if (model === null) return null
  const row = catalog.value.find((m) => m.modelId === model)
  return row && row.missingSince !== null ? row : null
})

// Agent switches recompute eligibility: an api_key choice with no eligible
// profiles falls back to subscription, and the chosen profile is re-anchored
// to the new list. Choosing api_key defaults to the first eligible profile.
watch([selected, authChoice], () => {
  if (authChoice.value === 'api_key' && eligibleProfiles.value.length === 0) {
    authChoice.value = 'subscription'
  }
  if (!eligibleProfiles.value.some((p) => p.id === selectedProfile.value)) {
    selectedProfile.value = eligibleProfiles.value[0]?.id ?? null
  }
  // A level chosen for one adapter is meaningless on another.
  if (effort.value !== null && !effortLevels.value.some((l) => l.id === effort.value)) {
    effort.value = null
  }
})

/**
 * Load the CACHED catalog for the chosen profile's provider so the
 * missing-model warning can render BEFORE a launch is spent rather than after.
 *
 * ⚠ This is `listModels` — a PURE READ that makes no network call and
 * decrypts nothing. `refreshModels`, the live key-bearing call, is NOT
 * reachable from this component at all: it lives behind the Settings card's
 * Refresh button and nowhere else.
 */
watch(selectedProfile, async (id) => {
  catalog.value = []
  if (id === null) return
  const profile = profiles.value.find((p) => p.id === id)
  if (!profile) return
  const res = await window.chorus.listModels(profile.providerId)
  // Re-check: the selection may have moved while this was in flight.
  if (selectedProfile.value === id) catalog.value = res.models
})

/**
 * Picking a launch profile PREFILLS agent, workspace mode, credential and
 * effort — and the user may override any of them before launching. The profile
 * is a DEFAULT, not a lock.
 *
 * ⚠ Selecting NOTHING is first-class: a dialog with no saved profiles behaves
 * exactly as it did before this task (the 3-6 discipline — no visible change
 * unless you use the feature).
 */
watch(selectedLaunchProfileId, async (id) => {
  const profile = launchProfiles.value.find((p) => p.id === id)
  if (!profile) return
  selected.value = profile.agent
  mode.value = profile.workspace_mode
  if (profile.credential_profile_id) {
    authChoice.value = 'api_key'
    selectedProfile.value = profile.credential_profile_id
  } else {
    authChoice.value = 'subscription'
  }
  // 3a-4's absent-not-disabled rule is unchanged: if the adapter declares no
  // effort axis the control does not render, and a stored level is simply not
  // offered — never greyed out.
  effort.value = profile.effort
  // The catalog for the missing-model warning, keyed on the profile's route.
  catalog.value = []
  if (profile.provider_id) {
    const res = await window.chorus.listModels(profile.provider_id)
    if (selectedLaunchProfileId.value === id) catalog.value = res.models
  }
})

onMounted(async () => {
  const [clis, ctx, providerRows, profileRows, adapterRows] = await Promise.all([
    window.chorus.detectClis(),
    window.chorus.getLaunchContext(props.projectId),
    window.chorus.listProviders(),
    window.chorus.listCredentials(),
    window.chorus.listAdapters()
  ])
  adapters.value = adapterRows
  agents.value = clis
    .filter((c): c is DetectedCli & { agentKind: AgentKind } => c.agentKind !== null)
    .map((c) => ({
      name: c.agentKind,
      label: c.displayName ?? c.agentKind,
      found: c.found,
      version: c.version
    }))
  projectRoot.value = ctx.projectRoot
  recentCwds.value = ctx.recentCwds
  cwd.value = ctx.projectRoot
  // 2-2: main's suggestion is the default; the user may override it freely.
  repoRoot.value = ctx.repoRoot
  mode.value = ctx.suggestedMode
  pickable.value = ctx.worktrees
  selectedWorktree.value = ctx.worktrees[0]?.id ?? null
  providers.value = providerRows
  profiles.value = profileRows
  selected.value = agents.value.find((a) => a.found)?.name ?? null
  // 3a-5: the picker rows and the per-project last-used pointer ride in on the
  // launch context — no fifth round trip. Both are computed in MAIN; a
  // DANGLING pointer already arrived as null, so there is nothing to resolve
  // here and no default for the renderer to invent.
  launchProfiles.value = ctx.launchProfiles
  selectedLaunchProfileId.value = ctx.lastLaunchProfileId
  cwdInput.value?.focus()
})

function cancel(): void {
  emit('cancel')
}

/** Mode-button styling mirrors the agent cards: the active choice wears the
 *  sky ring; an unavailable choice (no attachable worktrees) dims out. */
function modeClass(m: WorkspaceMode): string {
  return mode.value === m ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700'
}

/** Same vocabulary as modeClass, for the 3-6 auth-method buttons. */
function authClass(a: AuthChoice): string {
  return authChoice.value === a ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700'
}

/** The route backing the current credential choice, for the save default. */
const currentProviderName = computed<string | null>(() => {
  if (authChoice.value !== 'api_key' || selectedProfile.value === null) return null
  const profile = profiles.value.find((p) => p.id === selectedProfile.value)
  if (!profile) return null
  return providers.value.find((pr) => pr.id === profile.providerId)?.name ?? null
})

/**
 * D43: the default label is `<provider name>/<model>`, and it is a DEFAULT the
 * user immediately owns — never a key. A route-less profile names the agent.
 * (Main's `defaultProfileLabel` is the same rule; this is the prefill, and main
 * validates whatever actually arrives.)
 */
function prefillSaveLabel(): void {
  saveError.value = ''
  savedOk.value = false
  const left = currentProviderName.value ?? selected.value ?? ''
  saveLabel.value = resolvedModel.value ? `${left}/${resolvedModel.value}` : left
}

/**
 * Save the configuration currently in the dialog as a launch profile.
 *
 * ⚠ `existing-worktree` is never saved: a saved profile may not pin a transient
 * worktree row, so the stored mode falls back to current-tree and main refuses
 * anything else. The user picks a worktree at launch, which is the point.
 */
async function saveAsProfile(): Promise<void> {
  if (!selected.value || busy.value) return
  saveError.value = ''
  savedOk.value = false
  const credentialId =
    authChoice.value === 'api_key' && selectedProfile.value ? selectedProfile.value : null
  const providerId = credentialId
    ? (profiles.value.find((p) => p.id === credentialId)?.providerId ?? null)
    : null
  // D14: a fresh literal of primitives. Nothing store-sourced crosses.
  const res = await window.chorus.createLaunchProfile({
    label: saveLabel.value.trim(),
    agent: selected.value,
    provider_id: providerId,
    credential_profile_id: credentialId,
    // ⚠ NULL, not the resolved value. Storing the route's default here would
    // COPY rank 2 into rank 1 and create the second home for "which model"
    // that D48 exists to prevent. A null model inherits the route default at
    // resolve time, every time.
    model: null,
    effort: effort.value,
    permission_mode: null,
    workspace_mode: mode.value === 'new-worktree' ? 'new-worktree' : 'current-tree',
    env_json: null
  })
  if (!res.ok) {
    saveError.value = res.reason
    return
  }
  savedOk.value = true
  launchProfiles.value = [...launchProfiles.value, res.profile].sort((a, b) =>
    a.label.localeCompare(b.label)
  )
  selectedLaunchProfileId.value = res.profile.id
}

async function submit(): Promise<void> {
  if (!selected.value || !cwd.value || busy.value) return
  if (mode.value === 'existing-worktree' && !selectedWorktree.value) return
  busy.value = true
  error.value = ''
  try {
    // D14: a fresh literal of primitives — nothing store-sourced crosses.
    // The mode ALWAYS travels explicitly; worktree_id rides along only for
    // existing-worktree (main ignores it otherwise).
    // 3-6: credential_profile_id rides along only for the api_key choice.
    // The dialog sends a PROFILE ID, never a key — it structurally CANNOT
    // obtain one (3-2's write-only IPC has no read path), so there is
    // nothing here to "pre-validate" a key with; the probe lives in main.
    const res = await window.chorus.launch({
      project_id: props.projectId,
      agent: selected.value,
      cwd: cwd.value,
      workspace_mode: mode.value,
      ...(mode.value === 'existing-worktree' && selectedWorktree.value
        ? { worktree_id: selectedWorktree.value }
        : {}),
      // 3a-5: a launch profile and a bare credential are MUTUALLY EXCLUSIVE —
      // main authors that refusal, and the dialog simply never sends both.
      // ⚠ A STRING PRIMITIVE, never a spread profile object: a Pinia/reactive
      // object is a Vue Proxy and structured clone rejects it with NO
      // compile-time signal (D14).
      ...(selectedLaunchProfileId.value
        ? { launch_profile_id: selectedLaunchProfileId.value }
        : authChoice.value === 'api_key' && selectedProfile.value
          ? { credential_profile_id: selectedProfile.value }
          : {}),
      // 3a-4: omitted entirely when nothing was chosen, which is what makes a
      // no-effort launch byte-identical to a pre-3a-4 one. 3a-5 prefills this
      // SAME field from the profile — there is no second effort field.
      ...(effort.value !== null ? { effort: effort.value } : {})
    })
    if ('ok' in res) {
      error.value = res.reason
      return
    }
    emit('launched', { agent: selected.value, snapshot: res })
  } catch (e) {
    // Rejected invoke (e.g. spawn failure in main) — same inline treatment.
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

/** Basic focus trap: Tab/Shift-Tab cycle within the panel; Esc cancels. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    cancel()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const focusables = Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])'
    )
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    last.focus()
    e.preventDefault()
  } else if (!e.shiftKey && active === last) {
    first.focus()
    e.preventDefault()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @keydown="onKeydown">
    <div ref="panel" class="w-[28rem] rounded-lg bg-neutral-900 p-5 shadow-xl" role="dialog" aria-modal="true">
      <h2 class="text-sm font-semibold text-neutral-200">Launch agent</h2>

      <!-- 3a-5 (D43): the saved-profile picker. Rendered ONLY when profiles
           exist — with none, this dialog is byte-for-byte the pre-3a-5 dialog
           (the 3-6 discipline: no visible change unless you use the feature).

           ⚠ AN UNLAUNCHABLE PROFILE IS SHOWN, DISABLED AND EXPLAINED — never
           filtered out. A launch profile is a row the USER NAMED, so a named
           entry that silently vanishes is worse than one that says why it
           cannot launch. (Deliberately unlike the credential picker below,
           whose eligibleProfiles DOES hide unavailable rows — those are
           plumbing, not user-named rows.) -->
      <template v-if="launchProfiles.length > 0">
        <label class="mt-3 block text-xs text-neutral-400">Saved profile</label>
        <select
          v-model="selectedLaunchProfileId"
          class="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        >
          <option :value="null">No profile — configure below</option>
          <option
            v-for="p in launchProfiles"
            :key="p.id"
            :value="p.id"
            :disabled="p.disabled_reason !== null"
          >
            {{ p.label }}{{ p.disabled_reason ? ' — unavailable' : '' }}
          </option>
        </select>
        <p v-if="selectedLaunchProfile?.disabled_reason" class="mt-1 text-xs text-amber-400">
          {{ selectedLaunchProfile.disabled_reason }}
        </p>
      </template>

      <!-- agent cards from cli:detect -->
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button
          v-for="a in agents"
          :key="a.name"
          :disabled="!a.found"
          :class="[
            selected === a.name ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700',
            !a.found && 'opacity-40 cursor-not-allowed'
          ]"
          class="rounded-md p-3 text-left"
          @click="selected = a.name"
        >
          <div class="text-neutral-100">{{ a.label }}</div>
          <div class="text-xs text-neutral-400">
            {{ a.found ? a.version : 'not found' }}
          </div>
        </button>
      </div>

      <!-- auth method (3-6 / spec §8): subscription is the default and the
           api_key choice appears ONLY when an eligible credential profile
           exists for the selected agent — BYOK is opt-in. -->
      <label class="mt-4 block text-xs text-neutral-400">Auth</label>
      <div class="mt-1 flex gap-2">
        <button
          :class="authClass('subscription')"
          class="rounded-md px-3 py-1 text-xs text-neutral-100"
          @click="authChoice = 'subscription'"
        >
          Subscription
        </button>
        <button
          v-if="eligibleProfiles.length > 0"
          :class="authClass('api_key')"
          class="rounded-md px-3 py-1 text-xs text-neutral-100"
          @click="authChoice = 'api_key'"
        >
          API key
        </button>
      </div>
      <select
        v-if="authChoice === 'api_key'"
        v-model="selectedProfile"
        class="mt-2 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
      >
        <option v-for="p in eligibleProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>

      <!-- 3a-4 (worked example 8): the resolved model, and — only when the
           catalog SAW it and then stopped seeing it — the warning, met here
           BEFORE a launch is spent rather than at the provider afterwards.
           The launch is NOT blocked and nothing is substituted. -->
      <p
        v-if="missingModelRow"
        class="mt-2 text-[11px] leading-snug text-amber-300"
        data-launch-missing-model
      >
        ⚠ <span class="font-mono">{{ resolvedModel }}</span> was not in the last model refresh ({{
          missingModelRow.missingSince!.slice(0, 10)
        }}). It may have been retired — this launch will fail at the provider.
      </p>

      <!-- 3a-4 effort (PLAN §4): rendered ONLY when the selected adapter
           declares a descriptor. Absent, not disabled — and no explanatory
           text in its place either. Labels come from the descriptor via
           adapter:list; nothing here hardcodes a level name. -->
      <template v-if="effortLevels.length > 0">
        <label class="mt-4 block text-xs text-neutral-400">Effort</label>
        <div class="mt-1 flex gap-2">
          <button
            v-for="l in effortLevels"
            :key="l.id"
            :class="effort === l.id ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700'"
            class="rounded-md px-3 py-1 text-xs text-neutral-100"
            :title="l.args.join(' ')"
            data-launch-effort
            @click="effort = effort === l.id ? null : l.id"
          >
            {{ l.label }}
          </button>
        </div>
        <!-- A COLLAPSED mapping (two levels resolving to the same adapter
             value) is legal, and this is what makes it visible rather than
             misleading: the resolved tokens are shown, from the descriptor. -->
        <p v-if="effort !== null" class="mt-1 font-mono text-[10px] text-neutral-500">
          {{ effortLevels.find((l) => l.id === effort)?.args.join(' ') }}
        </p>
      </template>

      <!-- cwd -->
      <label class="mt-4 block text-xs text-neutral-400">Working directory</label>
      <input
        ref="cwdInput"
        v-model="cwd"
        class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-neutral-100"
        @keydown.enter="submit"
      />
      <div class="mt-1 flex flex-wrap gap-1">
        <button class="text-xs text-sky-400 hover:text-sky-300" @click="cwd = projectRoot">
          use project root
        </button>
        <button
          v-for="r in recentCwds"
          :key="r"
          class="text-xs text-neutral-400 hover:text-neutral-200"
          @click="cwd = r"
        >
          {{ r }}
        </button>
      </div>

      <!-- workspace mode (2-2 / D22): a non-git project root offers only
           current-tree, with the inline note (findings risk 3). -->
      <label class="mt-4 block text-xs text-neutral-400">Workspace</label>
      <div v-if="repoRoot === null" class="mt-1 text-xs text-neutral-500">
        Not a git repository — launching in the current working tree.
      </div>
      <div v-else class="mt-1 flex gap-2">
        <button :class="modeClass('current-tree')" class="rounded-md px-3 py-1 text-xs text-neutral-100" @click="mode = 'current-tree'">
          Current tree
        </button>
        <button :class="modeClass('new-worktree')" class="rounded-md px-3 py-1 text-xs text-neutral-100" @click="mode = 'new-worktree'">
          New worktree
        </button>
        <button
          :class="modeClass('existing-worktree')"
          :disabled="pickable.length === 0"
          class="rounded-md px-3 py-1 text-xs text-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Attach to a worktree an earlier session left behind"
          @click="mode = 'existing-worktree'"
        >
          Existing worktree
        </button>
      </div>
      <select
        v-if="mode === 'existing-worktree' && repoRoot !== null"
        v-model="selectedWorktree"
        class="mt-2 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
      >
        <option v-for="w in pickable" :key="w.id" :value="w.id">{{ w.branch }} — {{ w.path }}</option>
      </select>

      <p v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</p>

      <!-- 3a-5 (D43): save THIS configuration as a reusable profile. Offered
           only when the launch did not already come from one — re-saving a
           profile is a rename, and renaming lives in Settings. -->
      <template v-if="selectedLaunchProfileId === null && selected">
        <div v-if="saveLabel === ''" class="mt-4">
          <button
            class="text-xs text-sky-400 hover:text-sky-300"
            data-save-as-profile
            @click="prefillSaveLabel"
          >
            Save as launch profile…
          </button>
        </div>
        <div v-else class="mt-4">
          <label class="block text-xs text-neutral-400">Profile name</label>
          <div class="mt-1 flex gap-2">
            <input
              v-model="saveLabel"
              class="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
              data-save-label
            />
            <button
              class="rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
              :disabled="saveLabel.trim() === ''"
              data-save-confirm
              @click="saveAsProfile"
            >
              Save
            </button>
          </div>
          <p v-if="saveError" class="mt-1 text-xs text-red-400">{{ saveError }}</p>
          <p v-if="savedOk" class="mt-1 text-xs text-emerald-400">Saved.</p>
        </div>
      </template>

      <div class="mt-5 flex justify-end gap-2">
        <button class="text-sm text-neutral-400 hover:text-neutral-200" @click="cancel">Cancel</button>
        <button
          class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!selected || !cwd || busy || (mode === 'existing-worktree' && !selectedWorktree)"
          @click="submit"
        >
          Launch
        </button>
      </div>
    </div>
  </div>
</template>
