<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AdapterDescriptor,
  AgentKind,
  AttachResponse,
  CredentialProfileMetaWire,
  DetectedCli,
  EffortLevel,
  LaunchProfileWire,
  ModelCatalogEntry,
  PermissionMode,
  PickableWorktree,
  ProviderConfig,
  WorkspaceMode
} from '../../../shared/ipc'
import { AGENT_DESCRIPTION_MAX, AGENT_NAME_MAX, LAUNCH_PANE_CAP } from '../../../shared/ipc'
import { suggestAgentName } from '../../../shared/agentNames'
import { useFleetStore } from '../stores/fleet'
/* The launch SHAPE lives in a pure module with an exhaustive test — this
 * repository has no `.vue` tests, so a rule written here is a rule nothing can
 * check (Task 7a-3 / D186). */
import {
  LAUNCH_PRESETS,
  batchOutcomeLine,
  offeredCounts,
  planLaunches,
  presetDisabledReason,
  progressLabel,
  roleLabels,
  type PresetId
} from '../../../shared/launchPresets'
import AgentMark from './AgentMark.vue'

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
  /**
   * The batch ended and AT LEAST ONE session started (Task 7a-3 / D186).
   *
   * ⚠ A SECOND EVENT RATHER THAN A FLAG ON `launched`, because `launched` must
   * keep meaning exactly what it means today — "one session exists, wire it up"
   * — so `App.onLaunched` runs UNCHANGED per session. What moves out of that
   * handler is the DIALOG CLOSE, which was never a per-session fact and is what
   * would otherwise unmount this component after slot 1.
   *
   * ⚠ NOT EMITTED WHEN NOTHING STARTED. A batch that failed at slot 1 leaves the
   * dialog open with main's reason inline — today's behaviour, preserved.
   */
  done: [payload: { launched: number }]
}>()

/** The active project's id — threaded into both project-aware IPC calls
 *  (Task 1-5: session:launch-context and session:launch resolve it in main).
 *
 *  `paneCount` is the ACTIVE project's live pane count, for the count clamp
 *  (F104). ⚠ A PROP, NOT A STORE READ: this component has never imported a
 *  store, and because the parent passes a computed it stays live — including
 *  for leaves this very batch just appended, which is the staleness F104 is
 *  about. */
const props = defineProps<{ projectId: string; paneCount: number }>()

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

/* ── The session's authored identity ─────────────────────────────────────
 *
 * A rail of eight panes all labelled "Claude Code" tells you nothing about
 * which is which, which is the entire problem these two fields solve: the name
 * says WHO ("Bob") and the note says WHAT ("Bug Fix - Missing Color").
 *
 * ⚠ THE NAME IS SUGGESTED, NOT ASSIGNED. It is prefilled from the shared pool
 * (minus the names this project is already using) and the user may overwrite or
 * CLEAR it — an empty field sends nothing and produces an unnamed session that
 * renders exactly as every session did before this feature. Main invents
 * nothing; the suggestion happens here, where it is visible before it is sent.
 */
const sessionName = ref('')
const sessionNote = ref('')
/** Names already spoken for in this project — main's list, subtracted from the
 *  pool so the dialog never hands out a second "Bob". */
const usedAgentNames = ref<string[]>([])

/**
 * D182 / D2 (kickoff 2026-08-27): names already held by a LIVE session
 * anywhere on this machine, folded into the "taken" list.
 *
 * ⚠ ADVISORY HYGIENE, NEVER A RESERVATION. §4.7 measured a name being taken
 * MINUTES AFTER launch — a session that asked for "Zeta" while it was held
 * got a derived name, then took "Zeta" once the holder exited, leaving two
 * live sessions with the same address. So a launch-time check cannot
 * prevent a collision; it only avoids walking into one. The drift that
 * follows is surfaced by the pane chip's sticky `changed` state, which is
 * where §6.1 puts it.
 *
 * ⚠ AND THERE IS NO `chorus-` PREFIX (D2, Matthew's call). The address and
 * the displayed name must be ONE string, so a prefix would put four
 * characters of boilerplate on every name in the rail.
 *
 * `usedAgentNames` remains the PROJECT's names; this widens the suggestion
 * to the machine, because the peer namespace is machine-wide.
 */
const fleetStore = useFleetStore()
function takenNames(extra: readonly string[] = []): string[] {
  const live = fleetStore.externalPeers.map((p) => p.name)
  return [...usedAgentNames.value, ...live, ...extra]
}

/** Another name from the pool. The suggestion is a convenience, so the user
 *  gets a cheap way to spin it again rather than having to think of one. */
function rerollName(): void {
  // D182 + 7a-3: the taken list is now MACHINE-WIDE (live registry names
  // fold in via takenNames), and the reroll still marks the result as a
  // suggestion rather than a typed name. Both halves of the merge kept.
  sessionName.value = suggestAgentName(takenNames([sessionName.value]))
  nameIsSuggestion.value = true
}

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

/* ── The permission control (2026-08-14) ─────────────────────────────────
 *
 * The sibling of `effort` above and deliberately built to the same rules: a
 * closed pick from a list MAIN owns, per-launch, and `null` means "whatever the
 * adapter declares".
 *
 * ⚠ `null` DOES NOT MEAN "no flag" HERE, WHICH IS THE ONE PLACE THIS DIFFERS
 * FROM `effort`'s ORIGINAL SEMANTICS. The adapter's `defaultLevelId` is applied
 * in `buildLaunch`, so a null here still launches claude in Auto — and the
 * prefill below exists so the control SHOWS that rather than looking empty
 * while sending something. A dialog that displayed "nothing selected" over a
 * launch that carries `--permission-mode auto` would be lying about the one
 * setting where being lied to matters.
 */
const permissionMode = ref<PermissionMode | null>(null)

/* ── D90: the per-launch model pick ──────────────────────────────────────
 *
 * ⚠ THIS IS THE ONE THING D81 SAID THIS FILE WOULD NEVER HAVE, so the shape is
 * deliberate. D81/D48 refused a FREE-TEXT model field standing beside the
 * route's own default — two hand-authored homes for one fact. This is a CLOSED
 * pick from a list MAIN owns, `null` means "use whatever main resolves", and
 * nothing here re-implements the precedence table: `session:launch` still
 * decides, and this only supplies rank 0.
 */
const shortlist = ref<string[]>([])
const modelChoice = ref<string | null>(null)

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
const selectedCapabilities = computed(
  () => adapters.value.find((a) => a.id === selected.value)?.capabilities ?? null
)

/**
 * The selected adapter's DECLARED auth methods — `null` while `adapter:list` is
 * still in flight (D185, Task 7a-2).
 *
 * ⚠ THREE STATES, NOT TWO, AND AN `?? []` DEFAULT WOULD BE THE BUG. `adapters`
 * is empty until `adapter:list` lands, so `?? []` would read "no auth methods"
 * for EVERY agent for the first frames and blink the Auth control out and back
 * in on every dialog open. `null` = not probed yet (render it); `[]` = probed
 * and genuinely empty (hide it). Same null-vs-empty rule the capability
 * descriptors above follow.
 */
const selectedAuthMethods = computed(
  () => adapters.value.find((a) => a.id === selected.value)?.authMethods ?? null
)

const effortLevels = computed(
  () => selectedCapabilities.value?.reasoningEffort?.levels ?? []
)

/**
 * D179: the OTHER effort control — the one whose positions belong to the MODEL.
 *
 * ⚠ IT IS A SECOND CONTROL, NOT A SECOND SOURCE FOR THE FIRST, and the two are
 * mutually exclusive by construction: an adapter declaring `source: 'model'`
 * carries no `levels`, so `effortLevels` above is empty for it and its control
 * does not render. Chorus's four rungs and a model's own words are different
 * vocabularies (`modelEffortSchema` in the wire contract states why), and one
 * control switching between them would be one control lying about one of them.
 */
const modelEffort = ref<string | null>(null)

/**
 * The positions, read from the SELECTED MODEL rather than from the adapter.
 *
 * ⚠ EMPTY IS THE COMMON, CORRECT ANSWER AND MUST STAY CHEAP. It is empty when
 * the adapter's efforts are its own (every adapter but opencode), when no model
 * is resolved yet, when the catalog has never been refreshed for this route
 * (`reasoningEfforts === null` — nobody has asked the provider), and when the
 * model simply does not reason (`[]`). All four render nothing, which is the
 * absent-not-disabled rule this dialog has followed since 3a-4.
 *
 * ⚠ THE LABELS COME OFF THE DESCRIPTOR, NEVER FROM THIS FILE — the standing
 * rule two computeds up. An id the adapter has no word for renders as itself,
 * so a provider that ships a new rung costs a plain lowercase word rather than
 * a blank button.
 */
const modelEffortLevels = computed<{ id: string; label: string }[]>(() => {
  const descriptor = selectedCapabilities.value?.reasoningEffort
  if (descriptor?.source !== 'model') return []
  const model = effectiveModel.value
  if (model === null) return []
  const efforts = catalog.value.find((m) => m.modelId === model)?.reasoningEfforts
  if (!efforts) return []
  return efforts.map((id) => ({ id, label: descriptor.labels?.[id] ?? id }))
})

/** The permission control's positions — same absent-not-disabled rule, same
 *  descriptor-supplied labels, same rendered ORDER as declared. */
const permissionLevels = computed(() => selectedCapabilities.value?.permissionMode?.levels ?? [])

/**
 * The rung each control starts on for the SELECTED adapter, as the adapter
 * itself declares it. `undefined` = this adapter has no opinion, and the
 * control then starts empty exactly as every control in this dialog did before
 * 2026-08-14.
 *
 * ⚠ THESE ARE THE ONLY DEFAULTS THE RENDERER KNOWS, AND IT DID NOT INVENT
 * EITHER OF THEM. Hardcoding `'deep'` / `'auto'` here would put the app's
 * opinion in two places — the descriptor that already carries it and this file
 * — and the two would be right for exactly one adapter and wrong for the next.
 */
const defaultEffort = computed(() => selectedCapabilities.value?.reasoningEffort?.defaultLevelId)
const defaultPermission = computed(() => selectedCapabilities.value?.permissionMode?.defaultLevelId)

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

/**
 * D90: the model this launch will ACTUALLY run on — the per-launch pick when
 * there is one, otherwise whatever main resolved. Everything user-facing below
 * (the Model field, the missing-model warning) reads THIS rather than
 * `resolvedModel`, so the dialog never shows one model while sending another.
 */
const effectiveModel = computed<string | null>(() => modelChoice.value ?? resolvedModel.value)

/**
 * D90 / D85: what the dropdown offers — THE SHORTLIST FIRST, the full catalog
 * as the fallback (Matthew's call, 2026-07-28).
 *
 * ⚠ THE ORDER IS NOT ALPHABETISED AND MUST NOT BE. `model_shortlist` is
 * returned in the order the user built it (storage.ts is explicit that "a
 * personal shortlist carries information in its order"); re-sorting it here
 * would throw that away. The catalog fallback arrives in main's order for the
 * same reason.
 */
const modelOptions = computed<string[]>(() =>
  shortlist.value.length > 0 ? shortlist.value : catalog.value.map((m) => m.modelId)
)

/** ⚠ Only a model that WAS catalogued and then disappeared earns a warning
 *  (worked example 8). An id the catalog has never seen produces none
 *  (worked example 11) — a warning that fires on the normal case is a warning
 *  nobody reads. The launch is never blocked either way. */
const missingModelRow = computed<ModelCatalogEntry | null>(() => {
  const model = effectiveModel.value
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
})

/**
 * Re-anchor the two levelled controls whenever the SELECTED ADAPTER'S
 * capabilities change — which is both "the user picked a different agent" and
 * "adapter:list finally landed", hence the watch on the computed rather than on
 * `selected` alone.
 *
 * Two rules, in order:
 *   1. A level chosen for one adapter is meaningless on another, so anything
 *      the new adapter does not declare is dropped.
 *   2. An empty control then takes the new adapter's DECLARED default, so what
 *      the dialog shows is what the launch will send. Without this the control
 *      would read "nothing selected" while `buildLaunch` quietly applied
 *      `--permission-mode auto` — the dialog lying about the one setting where
 *      that matters most.
 *
 * ⚠ `immediate` IS NOT SET AND MUST NOT BE. The launch-profile watcher below
 * assigns both refs from a saved profile; an immediate run here would fight it
 * for the same fields on open.
 */
/**
 * ⚠ WHOSE OPINION IS CURRENTLY IN THE CONTROL — and this pair of flags is not
 * bookkeeping, it closes a leak the first runtime drive of this feature found.
 *
 * Without it: the dialog opens on claude, claude's default puts Deep in the
 * effort control, the user switches to codex, and `deep` is in codex's
 * vocabulary too — so it stays, and codex silently launches with
 * `-c model_reasoning_effort="high"` when nobody chose anything and codex
 * declares no default at all. A default belonging to one adapter had become a
 * setting on another.
 *
 * The rule the flags buy: A USER'S CHOICE SURVIVES AN AGENT SWITCH (if the new
 * adapter has that level); AN INHERITED DEFAULT DOES NOT.
 */
const effortChosenByUser = ref(false)
const permissionChosenByUser = ref(false)

function anchorLevelledControls(): void {
  // A level chosen for one adapter can be meaningless on another. An invalidated
  // choice is no longer a choice, so the flag falls with the value.
  if (effort.value !== null && !effortLevels.value.some((l) => l.id === effort.value)) {
    effort.value = null
    effortChosenByUser.value = false
  }
  if (
    permissionMode.value !== null &&
    !permissionLevels.value.some((l) => l.id === permissionMode.value)
  ) {
    permissionMode.value = null
    permissionChosenByUser.value = false
  }
  // Anything not deliberately chosen re-anchors to THIS adapter's declared
  // default, which is `undefined` for every adapter but claude and grok — and `?? null`
  // is what makes an inherited default disappear rather than carry across.
  if (!effortChosenByUser.value) effort.value = defaultEffort.value ?? null
  if (!permissionChosenByUser.value) permissionMode.value = defaultPermission.value ?? null
}

/* Clicking the level already on toggles it back off — but ONLY for an adapter
 * that declares no default. Where a default exists there is no "off" to return
 * to (buildLaunch would apply it anyway), so the click re-affirms instead. */
function chooseEffort(id: EffortLevel): void {
  effort.value = effort.value === id && defaultEffort.value === undefined ? null : id
  effortChosenByUser.value = effort.value !== null
}

/**
 * D179: the model-effort control has NO DEFAULT to fall back to, so clicking
 * the active segment always clears it — the pre-2026-08-14 behaviour, and here
 * it is the honest one rather than a leftover. An adapter cannot declare a
 * default drawn from a vocabulary it cannot see, so "nothing chosen" really
 * does mean "write no effort and let the CLI's own default stand".
 */
function chooseModelEffort(id: string): void {
  modelEffort.value = modelEffort.value === id ? null : id
}

/**
 * Drop a model-effort the current positions no longer offer.
 *
 * ⚠ IT WATCHES THE POSITIONS, NOT THE AGENT, because for this control the
 * positions move when the MODEL moves — switching from `glm-5.2` (`high`,
 * `xhigh`) to `deepseek-v4-flash` (`low`, `high`, `max`) must not leave `xhigh`
 * selected on a model that would discard it in silence (F99). There is no
 * "re-anchor to the declared default" half here, for the reason
 * `chooseModelEffort` gives: there is no default to re-anchor to.
 */
watch(modelEffortLevels, (levels) => {
  if (modelEffort.value !== null && !levels.some((l) => l.id === modelEffort.value)) {
    modelEffort.value = null
  }
})

function choosePermission(id: PermissionMode): void {
  permissionMode.value =
    permissionMode.value === id && defaultPermission.value === undefined ? null : id
  permissionChosenByUser.value = permissionMode.value !== null
}

watch(selectedCapabilities, anchorLevelledControls)

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
  // D90: a model chosen for one route is meaningless on another — clear the
  // pick with the list it came from, never carry it across.
  shortlist.value = []
  modelChoice.value = null
  if (id === null) return
  const profile = profiles.value.find((p) => p.id === id)
  if (!profile) return
  const res = await window.chorus.listModels(profile.providerId)
  // Re-check: the selection may have moved while this was in flight.
  if (selectedProfile.value === id) {
    catalog.value = res.models
    shortlist.value = res.shortlist
  }
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
  // D179: prefilled like its neighbours. The watcher above drops it if the
  // profile's model turns out not to offer it any more — a provider can retire
  // a rung, and a saved profile is not evidence that it still exists.
  modelEffort.value = profile.model_effort
  permissionMode.value = profile.permission_mode
  // A saved profile's stored value is a DELIBERATE choice — the user made it
  // once and named it — so it outranks the adapter default and must survive the
  // re-anchor below. A null field is not a choice: it means "inherit".
  effortChosenByUser.value = profile.effort !== null
  permissionChosenByUser.value = profile.permission_mode !== null
  // ⚠ CALLED DIRECTLY, NOT LEFT TO THE `selectedCapabilities` WATCHER ABOVE.
  // That watcher only fires when the capabilities CHANGE, and picking a profile
  // for the agent already selected changes nothing — so a profile storing no
  // effort/permission would blank both controls and leave them blank while
  // `buildLaunch` went on applying the adapter's defaults. A profile is a
  // DEFAULT, not a lock (this file's own words, above); a null field in one
  // means "inherit", and inheriting has to be visible.
  anchorLevelledControls()
  // The catalog for the missing-model warning, keyed on the profile's route.
  catalog.value = []
  shortlist.value = []
  // D90: the profile's own model is rank 1 and main applies it; the dialog's
  // rank-0 pick starts empty so picking a profile does not silently override
  // the very model that profile names.
  modelChoice.value = null
  if (profile.provider_id) {
    const res = await window.chorus.listModels(profile.provider_id)
    if (selectedLaunchProfileId.value === id) {
      catalog.value = res.models
      shortlist.value = res.shortlist
    }
  }
})

/** ⚠ THE RE-PROBE BELOW OUTLIVES A DIALOG THAT IS CLOSED QUICKLY. ~480ms of
 *  process spawns against a component the user can dismiss with Esc in far less
 *  — F13's leak class exactly, and the flag is the same fix `CouncilView` uses. */
let alive = true
onBeforeUnmount(() => {
  alive = false
})

/**
 * Agent kinds that are still fully wired end-to-end — adapter, detection,
 * resume, persisted sessions — but are NOT offered as a launch choice.
 *
 * ⚠ A PRESENTATION FILTER, NOT A REMOVAL. `kimi` keeps its adapter, its entry
 * in `agentKindSchema` and `staticRegistry`, and its glyph/label maps, so an
 * EXISTING kimi session (or a persisted layout holding one) still attaches,
 * renders and resumes exactly as before. Only the card is withheld, which is
 * the narrowest change that answers "don't offer it to me" without breaking
 * rows already in the database.
 */
const HIDDEN_AGENTS: readonly AgentKind[] = ['kimi']

/**
 * Kinds the name SUGGESTION is withheld for: a pane whose LABEL already is its
 * identity. `suggestAgentName` exists so "Claude Code — Bob" and "Claude Code —
 * Ruth" are told apart in a rail of identical labels; a terminal called "Bob"
 * is noise, because the pane already reads `Terminal` and that is unambiguous.
 *
 * ⚠ A PRESENTATION CHOICE, KEYED ON THE KIND ON PURPOSE. There is no capability
 * that means "this is not a person", and inventing one to carry a naming
 * preference would put a UI opinion into the adapter contract, where D34 Q1 says
 * only MEASURED FACTS ABOUT A CLI belong. `HIDDEN_AGENTS` above makes the
 * identical trade for the identical reason.
 *
 * The field stays EDITABLE — a user who wants to name their terminal may. Only
 * the suggestion and its reroll control are withheld.
 */
const UNNAMED_AGENTS: readonly AgentKind[] = ['shell']

/** True while `sessionName` holds a SUGGESTION nobody has typed over. It is the
 *  guard that keeps an agent switch from ever destroying the user's own text. */
const nameIsSuggestion = ref(false)

/** What was withheld when an `UNNAMED_AGENTS` kind was picked. Switching back
 *  restores it VERBATIM rather than rolling a fresh one — a name that changes
 *  under the user for no reason is worse than no suggestion at all. */
const withheldName = ref<string | null>(null)

/** Suppress or restore the suggestion as the selected kind changes. Only ever
 *  clears a SUGGESTION; typed text is never touched. */
function syncNameSuggestion(now: AgentKind | null, before: AgentKind | null): void {
  const nowUnnamed = now !== null && UNNAMED_AGENTS.includes(now)
  const wasUnnamed = before !== null && UNNAMED_AGENTS.includes(before)
  if (nowUnnamed && !wasUnnamed) {
    if (!nameIsSuggestion.value) return
    withheldName.value = sessionName.value
    sessionName.value = ''
  } else if (!nowUnnamed && wasUnnamed) {
    if (withheldName.value !== null && sessionName.value === '') {
      sessionName.value = withheldName.value
      nameIsSuggestion.value = true
    }
    withheldName.value = null
  }
}

watch(selected, (now, before) => syncNameSuggestion(now, before ?? null))

const toAgentCards = (clis: DetectedCli[]): AgentCard[] =>
  clis
    .filter((c): c is DetectedCli & { agentKind: AgentKind } => c.agentKind !== null)
    .filter((c) => !HIDDEN_AGENTS.includes(c.agentKind))
    .map((c) => ({
      name: c.agentKind,
      label: c.displayName ?? c.agentKind,
      found: c.found,
      version: c.version
    }))

onMounted(async () => {
  const [clis, ctx, providerRows, profileRows, adapterRows] = await Promise.all([
    // The MEMOIZED read, so the dialog paints immediately. The fresh one is
    // fired below and swapped in when it lands.
    window.chorus.detectClis(),
    window.chorus.getLaunchContext(props.projectId),
    window.chorus.listProviders(),
    window.chorus.listCredentials(),
    window.chorus.listAdapters()
  ])
  adapters.value = adapterRows
  agents.value = toAgentCards(clis)

  /**
   * ⚠ RE-PROBE ON EVERY OPEN, BECAUSE THE MEMO CAN BE CONFIDENTLY WRONG.
   * `detectClis` is memoized for the life of the process, so a CLI upgraded in a
   * terminal since startup leaves this dialog advertising a version that is no
   * longer installed — and launching resolves the binary FRESH through
   * `resolveCli` on every spawn, so the card and the process that starts would
   * disagree. The worse case is an agent INSTALLED since startup: it stays greyed
   * out as undetected with nothing on screen to suggest a restart would fix it.
   *
   * ⚠ NOT AWAITED, DELIBERATELY. Blocking the open on ~480ms of process spawns
   * would put a visible stall in front of the app's most common action. The memo
   * above is right in the overwhelming majority of opens; this corrects it in
   * place on the rare one where it is not.
   *
   * ⚠ AND NOT ON WINDOW FOCUS. That is the ratified backstop for the Docket's
   * file scan (CR-3f.1 A10), but this probe spawns four processes — paying that
   * on every alt-tab would be a background cost for a question nobody is asking
   * unless this dialog is open.
   *
   * `selected` holds an agent KIND rather than an index, so replacing the array
   * cannot silently move the user's choice to a different agent.
   */
  void window.chorus
    .detectClis(true)
    .then((fresh) => {
      if (!alive) return
      agents.value = toAgentCards(fresh)
    })
    .catch(() => {
      // A failed re-probe leaves the memoized cards in place. They are what the
      // app has always shown, and replacing a working list with an error state
      // because a refresh failed would be a downgrade.
    })
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
  // The name suggestion, made once per open. Re-suggesting on every keystroke
  // or agent switch would fight the user for a field they are typing in.
  usedAgentNames.value = ctx.usedAgentNames
  sessionName.value = suggestAgentName(takenNames())
  nameIsSuggestion.value = true
  // ⚠ THE WATCHER CANNOT COVER THIS ONE. `selected` is set above, BEFORE this
  // line, so a non-immediate watch never fires for the initial kind — the mount
  // path has to suppress inline or Terminal opens holding a person's name.
  syncNameSuggestion(selected.value, null)
  cwdInput.value?.focus()
})

function cancel(): void {
  emit('cancel')
}

/* ⚠ THE TWO-LETTER `codes` MAP LIVED HERE AND IS GONE (D184, Task 7a-1). The
 * glyph is now `AgentMark`, imported above — a vendor mark rather than a code
 * standing in for one. THE RULE THE OLD DOCBLOCK RECORDED IS UNCHANGED AND STILL
 * BINDING: this file hardcodes no agent NAME or LABEL — those come from the wire
 * (`displayName`) — and card ORDER still comes from main's `DETECTED_TOOLS`.
 * D38's "agent identity by glyph only, never colour" is likewise intact: the mark
 * is a single `currentColor` fill and the tile below still supplies the colour. */

/** The three workspace modes as CARDS (the mock's anatomy) rather than the
 *  three buttons 3c-4 replaced. Order and labels are unchanged from what the
 *  buttons rendered; the list is a const so the template needs no type cast. */
const MODES: readonly WorkspaceMode[] = ['current-tree', 'new-worktree', 'existing-worktree']

const modeLabels: Record<WorkspaceMode, string> = {
  'current-tree': 'Current tree',
  'new-worktree': 'New worktree',
  'existing-worktree': 'Existing worktree'
}

/** Static descriptors for the three workspace modes — the mock gives each card
 *  a sub-line. These are DESCRIPTIVE COPY, not data: the mock's own sub-line
 *  for new-worktree is a branch name main has not generated yet at dialog time,
 *  so it is not reproduced (D76 — never render a value the app cannot know). */
const modeNotes: Record<WorkspaceMode, string> = {
  'current-tree': 'works in place',
  'new-worktree': 'fresh branch',
  'existing-worktree': 'attach a kept one'
}

/* ── Launch presets (Task 7a-3 / D186) ─────────────────────────────────────
 *
 * ⚠ THE SHAPE LIVES IN `shared/launchPresets.ts`, NOT HERE. This repository has
 * NO `.vue` component tests, so a rule written in this file is a rule nothing
 * can check. Everything below is state and rendering; every decision is one
 * function call away in a module with an exhaustive test.
 */
const preset = ref<PresetId>('solo')
const count = ref(1)

/** Per-slot progress for the Will-launch strip. Index-aligned with `plan`. */
type SlotState = 'pending' | 'running' | 'done' | 'failed'
const rowStates = ref<SlotState[]>([])
const completed = ref(0)

/** Installed, non-hidden agent kinds — `agents` is already filtered by
 *  `HIDDEN_AGENTS`, so the partner rule can never offer a card the user cannot
 *  see. */
const installedAgents = computed(() => agents.value.filter((a) => a.found).map((a) => a.name))

const selectedPreset = computed(
  () => LAUNCH_PRESETS.find((p) => p.id === preset.value) ?? LAUNCH_PRESETS[0]
)

/**
 * ⚠ A COMPUTED, NOT SOMETHING BUILT INSIDE `submit()`. The Will-launch strip
 * exists to show what will happen BEFORE Launch is pressed; a plan computed at
 * submit time would make that strip a guess, and the honesty surface this task
 * exists to build would be decoration.
 */
const plan = computed(() =>
  selected.value === null
    ? []
    : planLaunches({
        preset: preset.value,
        agent: selected.value,
        count: count.value,
        // ⚠ THE DIALOG'S CURRENT MODE. The same as the suggested one until the
        // user touches the workspace cards — and slot 1 must reproduce today's
        // payload exactly, `existing-worktree` included.
        mode: mode.value,
        installed: installedAgents.value
      })
)

const presetReason = computed(() =>
  selected.value === null
    ? null
    : presetDisabledReason(preset.value, {
        agent: selected.value,
        installed: installedAgents.value
      })
)

/** Why a given card is disabled, for its title and its `:disabled`. */
function disabledReasonFor(id: PresetId): string | null {
  if (selected.value === null) return null
  return presetDisabledReason(id, { agent: selected.value, installed: installedAgents.value })
}

/** F104's first mitigation: never RENDER a count the cap would refuse. */
const counts = computed(() => offeredCounts(LAUNCH_PANE_CAP - props.paneCount))

const outcomeText = computed(() => batchOutcomeLine(completed.value, plan.value.length))

/** The wire's `displayName`, never a hardcoded name — this file's standing rule
 *  since 3-3/D34f. */
function agentLabel(kind: AgentKind): string {
  return agents.value.find((a) => a.name === kind)?.label ?? kind
}

const selectedLabel = computed(() =>
  selected.value === null ? 'agent' : agentLabel(selected.value)
)

/* ⚠ Clamp the count when the offered list shrinks. Without this, closing panes
 * elsewhere while the dialog is open can leave a selected `4` that is no longer
 * rendered, and the plan would silently keep building four. */
watch(counts, (list) => {
  const top = list[list.length - 1] ?? 1
  if (count.value > top) count.value = top
})

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
    // D179: saved on the same terms. A profile that names a model-vocabulary
    // effort is only meaningful together with the model it was chosen for, and
    // that model is rank 1 -> rank 2 at resolve time — so a saved effort whose
    // model later stops offering it is discarded by opencode rather than
    // silently applied to something else (F99).
    model_effort: modelEffort.value,
    // ⚠ NO LONGER HARDCODED NULL. 3a-5 wrote null here because the column was
    // "stored and consumed by nothing"; it now maps onto a CLI flag, so saving
    // the profile saves what the dialog is showing. A null is still meaningful
    // and still reachable — it means "inherit the adapter's default".
    permission_mode: permissionMode.value,
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
  const slots = plan.value
  // An empty plan means the preset cannot run here (launchPresets.ts). The
  // button is already disabled on the same condition; this is the belt to that
  // brace, so the two can never disagree.
  if (slots.length === 0) return
  if (slots.some((s) => s.workspaceMode === 'existing-worktree') && !selectedWorktree.value) return

  busy.value = true
  error.value = ''
  completed.value = 0
  rowStates.value = slots.map(() => 'pending')

  /* The names already spoken for, GROWING as the batch hands more out — so a
   * swarm of four cannot produce four sessions called "Bob", which is the whole
   * reason names exist.
   * ⚠ AN EMPTY NAME FIELD STAYS EMPTY FOR EVERY SLOT: clearing it is a
   * legitimate choice, and an unnamed batch is unnamed rather than auto-named. */
  const taken = [...usedAgentNames.value]
  const typedName = sessionName.value.trim()
  if (typedName) taken.push(typedName)

  try {
    // ⚠ SEQUENTIAL, AND NEVER `Promise.all`. `git worktree add` contends on the
    // repository index, and each worktree launch already awaits a checkout under
    // a 10-minute timeout. Six concurrent `worktree add`s against one index is a
    // lock fight whose failure mode is a dialog that appears hung for minutes.
    // The `await` inside the `for` is the feature, not an oversight.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      rowStates.value[i] = 'running'

      /* ⚠ THE PER-AGENT CONTROLS TRAVEL ONLY ON SLOTS RUNNING THE PICKED AGENT,
       * AND THIS IS MEASURED RATHER THAN CAUTIOUS. D186's "the controls apply to
       * the whole batch" is about Solo and Swarm, where every slot IS the picked
       * agent. Pair's partner and Workbench's shell are a DIFFERENT agent, and
       * forwarding these fields to them is wrong several ways:
       *   · main REFUSES a mismatched profile outright ("That launch profile is
       *     for codex, not claude."), so the batch would stop at slot 2 on the
       *     HAPPY PATH;
       *   · `permissionModeSchema` is ONE enum spanning TWO ladders (`plan` is
       *     claude's, `full-access` codex's — D183), so a rung chosen for the
       *     builder may not exist for the partner;
       *   · a model id is route-scoped (D90 rank 0) and fails at the provider
       *     minutes later, where nothing points back to this dialog;
       *   · and D185 requires main to refuse a `shell` launch carrying a
       *     credential at all.
       * Omitting them drops that slot onto the ADAPTER'S declared defaults —
       * byte-identical to what an untouched dialog would send for that agent. */
      const own = slot.agent === selected.value

      /* Slot 0's identity is the USER'S, always (the `plan[0]` invariant in
       * launchPresets.ts). Later slots get a fresh suggestion from the same pure
       * pool the dialog already uses, and the preset's own note.
       *
       * ⚠ FOUR IDENTICAL "Bob"s IS THE FAILURE THIS AVOIDS. A rail of eight panes
       * all reading the same thing is precisely the problem names were added to
       * solve, and a swarm is the fastest way to create it. `taken` grows as the
       * batch hands names out, so one batch cannot issue a name twice.
       *
       * ⚠ AND A KIND THAT TAKES NO SUGGESTED NAME GETS NONE — `UNNAMED_AGENTS`
       * rather than a `=== 'shell'` test here. A Terminal pane's header already
       * reads "Terminal"; 7a-2's rule is that selecting it never leaves a
       * person's name in a field the user did not type, and a batch must not be
       * the one path that puts one there. */
      const name =
        i === 0
          ? typedName
          : typedName && !UNNAMED_AGENTS.includes(slot.agent)
            ? suggestAgentName(taken)
            : ''
      if (name && i > 0) taken.push(name)
      const note = slot.description ?? sessionNote.value.trim()

      // D14: a fresh literal of primitives — nothing store-sourced crosses.
      // The mode ALWAYS travels explicitly; worktree_id rides along only for
      // existing-worktree (main ignores it otherwise).
      // 3-6: credential_profile_id rides along only for the api_key choice.
      // The dialog sends a PROFILE ID, never a key — it structurally CANNOT
      // obtain one (3-2's write-only IPC has no read path), so there is
      // nothing here to "pre-validate" a key with; the probe lives in main.
      const res = await window.chorus.launch({
        project_id: props.projectId,
        agent: slot.agent,
        cwd: cwd.value,
        workspace_mode: slot.workspaceMode,
        ...(slot.workspaceMode === 'existing-worktree' && selectedWorktree.value
          ? { worktree_id: selectedWorktree.value }
          : {}),
        // 3a-5: a launch profile and a bare credential are MUTUALLY EXCLUSIVE —
        // main authors that refusal, and the dialog simply never sends both.
        // ⚠ A STRING PRIMITIVE, never a spread profile object: a Pinia/reactive
        // object is a Vue Proxy and structured clone rejects it with NO
        // compile-time signal (D14).
        ...(own && selectedLaunchProfileId.value
          ? { launch_profile_id: selectedLaunchProfileId.value }
          : own && authChoice.value === 'api_key' && selectedProfile.value
            ? { credential_profile_id: selectedProfile.value }
            : {}),
        // 3a-4: omitted entirely when nothing was chosen, which is what makes a
        // no-effort launch byte-identical to a pre-3a-4 one. 3a-5 prefills this
        // SAME field from the profile — there is no second effort field.
        ...(own && effort.value !== null ? { effort: effort.value } : {}),
        // D179: the model-vocabulary effort, omitted on exactly the same terms —
        // absent means Chorus writes no effort at all and opencode's own default
        // stands, so a launch that never touched this control is byte-identical
        // to a pre-D179 one.
        ...(own && modelEffort.value !== null ? { model_effort: modelEffort.value } : {}),
        // Same discipline, one difference worth stating: omitting this does NOT
        // mean "no permission flag" — it means main falls through to the profile
        // and then to the ADAPTER's declared default. The control is prefilled
        // from that same default, so in practice this is always present for an
        // adapter that declares one, and the payload says out loud what the user
        // is looking at.
        ...(own && permissionMode.value !== null ? { permission_mode: permissionMode.value } : {}),
        // D90: rank 0. A STRING PRIMITIVE, and omitted entirely when the user
        // left the pick on "route default" — same discipline as `effort` above,
        // and the reason an untouched dialog still sends a pre-D90 payload.
        ...(own && modelChoice.value !== null ? { model: modelChoice.value } : {}),
        // The authored identity. OMITTED when cleared rather than sent as "" —
        // main folds whitespace to null anyway, but a payload that says nothing
        // about a name is the honest shape for a session that has none.
        ...(name ? { name } : {}),
        ...(note ? { description: note } : {})
      })

      if ('ok' in res) {
        // ⚠ STOP AT THE FIRST FAILURE AND KEEP WHAT LAUNCHED. Nothing in this
        // codebase silently undoes user-visible state, and a half-swarm the user
        // can SEE beats a rollback they cannot. Continuing past a failure would
        // be worse still: the usual reason is environmental (a git lock, a
        // missing repo, the cap), so slots 3..6 would fail the same way and bury
        // the first reason under five copies of itself.
        error.value = res.reason
        rowStates.value[i] = 'failed'
        break
      }
      rowStates.value[i] = 'done'
      completed.value += 1
      // Unchanged per session: App.onLaunched registers the row, appends the
      // leaf (D174's single line) and focuses it. The batch is N sequential
      // trips through that same line.
      emit('launched', { agent: slot.agent, snapshot: res })
    }
  } catch (e) {
    // Rejected invoke (e.g. spawn failure in main) — same inline treatment.
    error.value = e instanceof Error ? e.message : String(e)
    const running = rowStates.value.indexOf('running')
    if (running >= 0) rowStates.value[running] = 'failed'
  } finally {
    busy.value = false
  }

  // ⚠ ONLY WHEN SOMETHING STARTED. Nothing started = the dialog stays open with
  // main's reason and "0 of 4 launched" beside it.
  if (completed.value > 0) emit('done', { launched: completed.value })
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
  <div class="overlay-scrim overlay-scrim-dialog" @keydown="onKeydown">
    <div
      ref="panel"
      class="overlay-panel overlay-panel-dialog launch"
      role="dialog"
      aria-modal="true"
    >
      <!-- ⚠ The mock's header also carries a project chip ("■ TaxApp"). This
           dialog receives a projectId and a projectRoot but never the project's
           NAME, and deriving it from the root's basename would be a guess that
           goes wrong the moment a project is renamed — omitted rather than
           approximated (D76's rule applied to a label). Esc IS bound
           (onKeydown), so its keycap is honest and stays. -->
      <div class="overlay-header launch-head">
        <span class="launch-title">New session</span>
        <span class="overlay-keycap">esc</span>
      </div>

      <div class="overlay-body launch-body">

      <!-- Launch presets (Task 7a-3 / D186). One press starts a SHAPE of work.
           ⚠ A disabled card is SHOWN WITH ITS REASON, never hidden — the
           treatment launch profiles' `disabled_reason` already establishes for
           a row a user might reasonably expect to see. A Pair card that
           vanished on a one-CLI machine would read as a missing feature rather
           than an unmet condition. -->
      <div class="launch-section">
        <span class="overlay-label">Preset</span>
        <div class="launch-grid launch-grid-4">
          <button
            v-for="p in LAUNCH_PRESETS"
            :key="p.id"
            type="button"
            class="overlay-card"
            :class="{ 'overlay-card-selected': preset === p.id }"
            :disabled="disabledReasonFor(p.id) !== null"
            :title="disabledReasonFor(p.id) ?? undefined"
            data-launch-preset
            @click="preset = p.id"
          >
            <span class="launch-mode-name">
              {{ p.label }}
              <!-- Pair and Workbench are fixed at two; the badge says so where
                   the count row would otherwise be. -->
              <span v-if="p.fixedCount" class="launch-preset-badge">{{ p.fixedCount }}</span>
            </span>
            <span class="launch-mode-note">{{ p.blurb }}</span>
          </button>
        </div>
        <p v-if="selectedPreset.note" class="overlay-note">{{ selectedPreset.note }}</p>
        <p v-if="presetReason" class="launch-warn">{{ presetReason }}</p>
      </div>

      <!-- ⚠ ABSENT, NOT DISABLED, for Pair and Workbench: their size is fixed
           at two and shows as a badge on the card. The standing rule of this
           file since 3a-4.
           ⚠ AND THE OPTIONS ARE CLAMPED TO THE REMAINING PANE BUDGET (F104) —
           a value the cap would refuse is NOT RENDERED. -->
      <div v-if="selectedPreset.countable" class="launch-section">
        <span class="overlay-label">How many</span>
        <div class="overlay-segmented">
          <button
            v-for="n in counts"
            :key="n"
            type="button"
            class="overlay-segment"
            :class="{ 'overlay-segment-on': count === n }"
            data-launch-count
            @click="count = n"
          >
            {{ n }}
          </button>
        </div>
      </div>

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
        <div class="launch-profiles">
          <span class="overlay-eyebrow">PROFILES</span>
          <div class="launch-chips">
            <button
              type="button"
              class="launch-chip"
              :class="{ 'launch-chip-on': selectedLaunchProfileId === null }"
              @click="selectedLaunchProfileId = null"
            >
              No profile
            </button>
            <button
              v-for="p in launchProfiles"
              :key="p.id"
              type="button"
              class="launch-chip"
              :class="{ 'launch-chip-on': selectedLaunchProfileId === p.id }"
              :disabled="p.disabled_reason !== null"
              :title="p.disabled_reason ?? undefined"
              @click="selectedLaunchProfileId = p.id"
            >
              {{ p.label }}{{ p.disabled_reason ? ' — unavailable' : '' }}
            </button>
          </div>
        </div>
        <p v-if="selectedLaunchProfile?.disabled_reason" class="launch-warn">
          {{ selectedLaunchProfile.disabled_reason }}
        </p>
      </template>

      <!-- agent cards from cli:detect -->
      <div class="launch-section">
        <span class="overlay-label">Agent</span>
        <div class="launch-grid">
          <button
            v-for="a in agents"
            :key="a.name"
            type="button"
            class="overlay-card launch-agent"
            :class="{ 'overlay-card-selected': selected === a.name }"
            :disabled="!a.found"
            @click="selected = a.name"
          >
            <span class="launch-agent-tile"><AgentMark :name="a.name" :size="16" /></span>
            <span class="launch-agent-text">
              <span class="launch-agent-name">{{ a.label }}</span>
              <span class="launch-agent-ver" :class="{ 'launch-agent-found': a.found }">
                {{ a.found ? a.version : 'not found' }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <!-- Who this agent is, and what it is doing. Placed directly under the
           agent cards because it completes the same sentence: "Claude Code —
           Bob, on the missing-colour bug".

           ⚠ NEITHER FIELD IS REQUIRED and neither gates Launch. Clearing the
           name is a legitimate choice (an unnamed session is what every session
           was until now), so there is no validation, no error state, and no
           disabled button hanging off either input. -->
      <div class="launch-row">
        <div class="launch-section">
          <span class="overlay-label">Name</span>
          <div class="overlay-field">
            <input
              v-model="sessionName"
              class="launch-cwd"
              :maxlength="AGENT_NAME_MAX"
              @input="nameIsSuggestion = false"
              placeholder="unnamed"
              spellcheck="false"
              data-launch-name
              @keydown.enter="submit"
            />
            <!-- ⚠ ABSENT, NOT DISABLED, for an UNNAMED_AGENTS kind — the standing
                 rule for a control that cannot apply. A greyed dice with no
                 explanation is exactly the dead UI that rule bars. -->
            <button
              v-if="selected === null || !UNNAMED_AGENTS.includes(selected)"
              type="button"
              class="launch-reroll"
              title="Suggest another name"
              aria-label="Suggest another name"
              @click="rerollName"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M10 6a4 4 0 1 1-1.2-2.8" />
                <path d="M10.2 1.6v2.2H8" />
              </svg>
            </button>
          </div>
        </div>
        <div class="launch-section">
          <span class="overlay-label">Description</span>
          <div class="overlay-field">
            <input
              v-model="sessionNote"
              class="launch-cwd"
              :maxlength="AGENT_DESCRIPTION_MAX"
              placeholder="what this agent is working on"
              data-launch-note
              @keydown.enter="submit"
            />
            <!-- The cap is short enough to hit mid-sentence, so it counts down
                 in place rather than silently swallowing keystrokes. -->
            <span class="launch-count">{{ AGENT_DESCRIPTION_MAX - sessionNote.length }}</span>
          </div>
        </div>
      </div>

      <!-- auth method (3-6 / spec §8): subscription is the default and the
           api_key choice appears ONLY when an eligible credential profile
           exists for the selected agent — BYOK is opt-in. -->
      <!-- ⚠ THE WHOLE SECTION GOES when the selected adapter declares NO auth
           methods — for Terminal this was a lone `subscription` segment with
           nothing behind it, on the one card whose answer is "there is no auth
           here". `authChoice` stays 'subscription' and `submit()` sends nothing
           either way, so this is a rendering fix with no wire consequence. -->
      <div v-if="selectedAuthMethods === null || selectedAuthMethods.length > 0" class="launch-row">
        <div class="launch-section">
          <span class="overlay-label">Auth</span>
          <div class="overlay-segmented">
            <button
              type="button"
              class="overlay-segment"
              :class="{ 'overlay-segment-alt-on': authChoice === 'subscription' }"
              @click="authChoice = 'subscription'"
            >
              subscription
            </button>
            <button
              v-if="eligibleProfiles.length > 0"
              type="button"
              class="overlay-segment"
              :class="{ 'overlay-segment-alt-on': authChoice === 'api_key' }"
              @click="authChoice = 'api_key'"
            >
              api key
            </button>
          </div>
        </div>

        <!-- ⚠ D81 IS REVISED HERE BY D90, AND ONLY THIS FAR. D81 said this
             dialog has no model input, because D48 refused a FREE-TEXT field
             standing beside the route's own default. What follows is not that:
             it is a CLOSED <select> over a list MAIN owns (`model_shortlist`,
             then `model_catalog` — D85), whose empty value means "whatever main
             resolves". No precedence table is re-implemented here; the dialog
             supplies rank 0 and `session:launch` still decides.

             ⚠ AND IT IS STILL A <select>, NOT AN <input list>. ImplementationSpec
             -3c-4 §3/§6.3 once asked for "an <input> with a <datalist>"; D81
             struck that check and it stays struck — a free-text box is exactly
             what D48 refused, and the shortlist is the answer to "but what if my
             model isn't listed" (it is user-authored and accepts uncatalogued
             ids by design).

             Falls back to the display-only field when the route offers no list,
             and is absent entirely when nothing resolves — the same
             absent-not-disabled discipline the effort control uses. -->
        <div v-if="effectiveModel || modelOptions.length > 0" class="launch-section">
          <span class="overlay-label">Model</span>
          <select
            v-if="modelOptions.length > 0"
            v-model="modelChoice"
            class="launch-select"
            data-launch-model
          >
            <!-- ⚠ The null option is FIRST and is the default. A launch that
                 touches nothing here is byte-identical to a pre-D90 launch,
                 which is what makes this additive rather than a behaviour
                 change for every existing route. -->
            <option :value="null">
              {{ resolvedModel ? `Route default — ${resolvedModel}` : 'CLI default' }}
            </option>
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
          </select>
          <div v-else class="overlay-field launch-model">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              aria-hidden="true"
            >
              <circle cx="4.2" cy="4.2" r="3" />
              <path d="M6.5 6.5 9 9" />
            </svg>
            <span class="launch-model-id">{{ effectiveModel }}</span>
          </div>
        </div>
      </div>

      <select
        v-if="authChoice === 'api_key'"
        v-model="selectedProfile"
        class="launch-select"
      >
        <option v-for="p in eligibleProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>

      <!-- 3a-4 (worked example 8): the resolved model, and — only when the
           catalog SAW it and then stopped seeing it — the warning, met here
           BEFORE a launch is spent rather than at the provider afterwards.
           The launch is NOT blocked and nothing is substituted.
           ⚠ Wording unchanged by 3c-4; only its colour is now a token. -->
      <p v-if="missingModelRow" class="launch-warn" data-launch-missing-model>
        ⚠ <span class="launch-mono">{{ effectiveModel }}</span> was not in the last model refresh ({{
          missingModelRow.missingSince!.slice(0, 10)
        }}). It may have been retired — this launch will fail at the provider.
      </p>

      <!-- 3a-4 effort (PLAN §4): rendered ONLY when the selected adapter
           declares a descriptor. Absent, not disabled — and no explanatory
           text in its place either. Labels come from the descriptor via
           adapter:list; nothing here hardcodes a level name. -->
      <div v-if="effortLevels.length > 0" class="launch-section">
        <span class="overlay-label">Effort</span>
        <div class="overlay-segmented">
          <button
            v-for="l in effortLevels"
            :key="l.id"
            type="button"
            class="overlay-segment"
            :class="{ 'overlay-segment-on': effort === l.id }"
            :title="l.args.join(' ')"
            data-launch-effort
            @click="chooseEffort(l.id)"
          >
            {{ l.label }}
          </button>
        </div>
        <!-- A COLLAPSED mapping (two levels resolving to the same adapter
             value) is legal, and this is what makes it visible rather than
             misleading: the resolved tokens are shown, from the descriptor. -->
        <p v-if="effort !== null" class="launch-args">
          {{ effortLevels.find((l) => l.id === effort)?.args.join(' ') }}
        </p>
      </div>

      <!-- D179 effort, for an adapter whose vocabulary belongs to the MODEL
           (opencode). Same absent-not-disabled rule as the control above, with
           one more way to be absent: the SELECTED MODEL may publish no efforts,
           or the catalog may never have been refreshed for this route — and
           "we have not asked" must render as nothing rather than as an empty
           ladder. Labels and order come from the model and the descriptor;
           nothing here hardcodes an effort name.

           ⚠ NO `launch-args` LINE UNDER THIS ONE, and its absence is accurate.
           The control above shows the argv tokens a rung resolves to; this
           effort reaches the agent through opencode's config file, so there are
           no tokens to show and inventing a line would describe a command line
           Chorus does not build. -->
      <div v-if="modelEffortLevels.length > 0" class="launch-section">
        <span class="overlay-label">Effort</span>
        <div class="overlay-segmented">
          <button
            v-for="l in modelEffortLevels"
            :key="l.id"
            type="button"
            class="overlay-segment"
            :class="{ 'overlay-segment-on': modelEffort === l.id }"
            :title="l.id"
            data-launch-model-effort
            @click="chooseModelEffort(l.id)"
          >
            {{ l.label }}
          </button>
        </div>
      </div>

      <!-- Permission mode (2026-08-14, PLAN principle 009): rendered ONLY when
           the selected adapter declares a descriptor — the same absent-not-
           disabled rule the effort control above has followed since 3a-4, and
           the reason codex/kimi/opencode show nothing here rather than a greyed
           box. Labels and ORDER come from the descriptor via adapter:list;
           nothing here hardcodes a mode name.

           ⚠ THE DESELECT BRANCH IS DELIBERATELY ABSENT WHEN THE ADAPTER
           DECLARES A DEFAULT (both controls). Clicking the active segment used
           to clear it to "nothing", which meant "emit no flag" — a state that
           no longer exists for a default-bearing adapter, because buildLaunch
           would apply the default anyway. Leaving the toggle in would give the
           user a click that appears to turn something off and does not. -->
      <div v-if="permissionLevels.length > 0" class="launch-section">
        <span class="overlay-label">Permission</span>
        <div class="overlay-segmented">
          <button
            v-for="l in permissionLevels"
            :key="l.id"
            type="button"
            class="overlay-segment"
            :class="{ 'overlay-segment-on': permissionMode === l.id }"
            :title="l.args.join(' ')"
            data-launch-permission
            @click="choosePermission(l.id)"
          >
            {{ l.label }}
          </button>
        </div>
        <p v-if="permissionMode !== null" class="launch-args">
          {{ permissionLevels.find((l) => l.id === permissionMode)?.args.join(' ') }}
        </p>
      </div>

      <!-- workspace mode (2-2 / D22): a non-git project root offers only
           current-tree, with the inline note (findings risk 3).

           ⚠ RENDERED ONLY FOR `solo`, AND THAT IS A DELIBERATE REMOVAL OF A
           CONTROL RATHER THAN AN OVERSIGHT (Task 7a-3). Pair and Workbench are
           `current-tree` by definition — a reviewer in a different worktree is
           reviewing different files — and every Swarm slot is `new-worktree`.
           Leaving the cards rendered would give the user a control the plan
           ignores, which is exactly what this file refuses for the permission
           control: "leaving the toggle in would give the user a click that
           appears to turn something off and does not." The Will-launch strip
           states the target for every row, so nothing is hidden — it is SHOWN
           AS AN OUTCOME instead of OFFERED AS A CHOICE. -->
      <div v-if="preset === 'solo'" class="launch-section">
        <span class="overlay-label">Workspace</span>
        <div v-if="repoRoot === null" class="overlay-note">
          Not a git repository — launching in the current working tree.
        </div>
        <div v-else class="launch-grid launch-grid-3">
          <button
            v-for="m in MODES"
            :key="m"
            type="button"
            class="overlay-card"
            :class="{ 'overlay-card-selected': mode === m }"
            :disabled="m === 'existing-worktree' && pickable.length === 0"
            :title="
              m === 'existing-worktree'
                ? 'Attach to a worktree an earlier session left behind'
                : undefined
            "
            @click="mode = m"
          >
            <span class="launch-mode-name">{{ modeLabels[m] }}</span>
            <span class="launch-mode-note">{{ modeNotes[m] }}</span>
          </button>
        </div>
        <select
          v-if="mode === 'existing-worktree' && repoRoot !== null"
          v-model="selectedWorktree"
          class="launch-select"
        >
          <option v-for="w in pickable" :key="w.id" :value="w.id">
            {{ w.branch }} — {{ w.path }}
          </option>
        </select>
      </div>

      <!-- cwd -->
      <div class="launch-section">
        <span class="overlay-label">Working directory</span>
        <div class="overlay-field">
          <input
            ref="cwdInput"
            v-model="cwd"
            class="launch-cwd"
            @keydown.enter="submit"
          />
        </div>
        <div class="launch-recents">
          <button type="button" class="launch-recent launch-recent-root" @click="cwd = projectRoot">
            use project root
          </button>
          <button
            v-for="r in recentCwds"
            :key="r"
            type="button"
            class="launch-recent"
            :title="r"
            @click="cwd = r"
          >
            {{ r }}
          </button>
        </div>
      </div>

      <p v-if="error" class="overlay-error">{{ error }}</p>
      <!-- ⚠ `batchOutcomeLine` returns null for a one-slot plan, so a Solo
           failure renders exactly what it renders today — a lone reason with
           nothing new under it. -->
      <p v-if="error && outcomeText" class="launch-warn">{{ outcomeText }}</p>

      <!-- 3a-5 (D43): save THIS configuration as a reusable profile. Offered
           only when the launch did not already come from one — re-saving a
           profile is a rename, and renaming lives in Settings. -->
      <template v-if="selectedLaunchProfileId === null && selected">
        <div v-if="saveLabel === ''" class="launch-section">
          <button type="button" class="launch-link" data-save-as-profile @click="prefillSaveLabel">
            Save as launch profile…
          </button>
        </div>
        <div v-else class="launch-section">
          <span class="overlay-label">Profile name</span>
          <div class="launch-save-row">
            <div class="overlay-field">
              <input v-model="saveLabel" class="launch-cwd" data-save-label />
            </div>
            <button
              type="button"
              class="overlay-btn-ghost"
              :disabled="saveLabel.trim() === ''"
              data-save-confirm
              @click="saveAsProfile"
            >
              Save
            </button>
          </div>
          <p v-if="saveError" class="overlay-error">{{ saveError }}</p>
          <p v-if="savedOk" class="launch-saved">Saved.</p>
        </div>
      </template>

      <!-- ⚠ NEVER RENDERED EMPTY OR AS "0 sessions" (D76: omit, or give it a
           source). An empty plan means the preset cannot run here, and the
           reason is already on the card above.
           ⚠ THIS IS THE HONESTY SURFACE FOR WHAT SWARM COSTS. The Phase 6b
           housekeeping notes record a multi-pane drive quietly accumulating a
           worktree per pane; Swarm makes that INTENDED, which is only an
           improvement if the checkouts are visible BEFORE Launch is pressed. -->
      <div v-if="plan.length > 0" class="launch-section">
        <span class="overlay-label">Will launch</span>
        <ul class="launch-plan">
          <li v-for="(s, i) in plan" :key="i" class="launch-plan-row" :data-state="rowStates[i]">
            <AgentMark :name="s.agent" :size="12" class="launch-plan-mark" />
            <span class="launch-plan-name">{{ agentLabel(s.agent) }}</span>
            <span v-if="s.role" class="launch-plan-role">{{ roleLabels[s.role] }}</span>
            <span class="launch-plan-target">{{ modeLabels[s.workspaceMode] }}</span>
          </li>
        </ul>
        <!-- One line, because the alternative is a per-slot settings matrix and
             D186 refuses one. -->
        <p class="launch-plan-hint">
          Model, effort and permission apply to every {{ selectedLabel }} in this batch.
        </p>
      </div>
      </div>

      <!-- ⚠ The mock's footer also prints an estimated cost per task
           ("est. ~$0.40–0.90 / task at deep"). Chorus has no cost ESTIMATOR —
           attribution is account-scoped and after the fact (F35) — so D76 omits
           it rather than inventing a range. The mock's `ctrl+↵` keycap on
           Launch is omitted for the same family of reason: no such binding
           exists, and a keycap for a shortcut that does nothing is a false
           statement about the app. -->
      <div class="overlay-footer launch-foot">
        <span class="launch-foot-spacer" />
        <button type="button" class="overlay-btn-ghost" @click="cancel">Cancel</button>
        <button
          type="button"
          class="overlay-btn-primary"
          :disabled="
            !selected ||
            !cwd ||
            busy ||
            plan.length === 0 ||
            (plan.some((s) => s.workspaceMode === 'existing-worktree') && !selectedWorktree)
          "
          @click="submit"
        >
          <!-- Task 6b-3 (D170): a launch into a memory-configured project may
               now wait up to 20 s while Chorus starts the graph, and a button
               that still reads `Launch` behind that wait reads as a FROZEN APP
               — precisely the "this feature is flaky" impression D169 exists to
               prevent. ⚠ DELIBERATELY NOT MEMORY-SPECIFIC: the renderer is not
               told WHY the launch is slow, because telling it would need a
               mid-flight channel this task refuses to add, and "Launching..." is
               true of every launch. -->
          <!-- ⚠ `progressLabel` returns EXACTLY 'Launching…' for a one-slot
               plan, so a Solo launch reads character-for-character as it does
               today; only a real batch gains a "2 of 4". -->
          {{ busy ? progressLabel(completed, plan.length) : 'Launch' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* Geometry from docs/design/v2/Chorus Launch Dialog.dc.html (D73). The shared
   anatomy — scrim, panel, header/footer rules, fields, cards, segmented
   controls, buttons — lives in overlays.css above. */
.launch {
  width: 640px;
}

.launch-head {
  padding: 13px 18px;
}

.launch-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.launch-body {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 14px 18px 16px;
}

.launch-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* The mock pairs auth/model and effort/runtime as two-column rows. Chorus has
   no runtime (native/wsl) concept, so only the first pair is reproduced. */
.launch-row {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 10px;
  align-items: end;
}

.launch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.launch-grid-3 {
  grid-template-columns: 1fr 1fr 1fr;
}

/* ── Launch presets and the Will-launch strip (Task 7a-3) ───────────────── */

.launch-grid-4 {
  grid-template-columns: repeat(4, 1fr);
}

/** The fixed size of Pair and Workbench, where the count row would otherwise
 *  be. Same badge chrome as the agent tile, so the two read as one family. */
.launch-preset-badge {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: var(--radius-chip);
  background: var(--color-surface-badge);
  border: 1px solid var(--color-border-badge);
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-badge);
}

.launch-plan {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.launch-plan-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.launch-plan-mark {
  flex: none;
  color: var(--color-text-badge);
}

.launch-plan-name {
  color: var(--color-text-body);
}

.launch-plan-role {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-quiet);
}

/* Pushed right, and never wrapped: this is the column that says what a Swarm
   actually costs. */
.launch-plan-target {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-quiet);
  white-space: nowrap;
}

/* Per-slot progress, expressed with [data-state] rather than four v-ifs. No new
   colour tokens: `done` borrows the jade the app already uses for success and
   `failed` the existing error text colour. */
.launch-plan-row[data-state='pending'] {
  opacity: 0.55;
}

.launch-plan-row[data-state='running'] .launch-plan-name {
  color: var(--color-state-running-text);
}

.launch-plan-row[data-state='done'] .launch-plan-name {
  color: var(--color-accent-jade);
}

.launch-plan-row[data-state='failed'] .launch-plan-name {
  color: var(--color-state-error-text);
}

.launch-plan-hint {
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.45;
  color: var(--color-text-quiet);
}

/* ── Profile chips ─────────────────────────────────────────────────────── */
.launch-profiles {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 0;
}

.launch-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.launch-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: 99px;
  padding: 3px 11px;
  cursor: default;
}

.launch-chip:hover:not(:disabled):not(.launch-chip-on) {
  border-color: var(--color-logo-bar-low);
  color: var(--color-text-body);
}

.launch-chip-on {
  color: var(--color-accent-jade);
  border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-jade) 7%, transparent);
}

.launch-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Agent cards ───────────────────────────────────────────────────────── */
.launch-agent {
  display: flex;
  align-items: center;
  gap: 8px;
}

.launch-agent-tile {
  width: 24px;
  height: 24px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-chip);
  background: var(--color-surface-badge);
  border: 1px solid var(--color-border-badge);
  /* ⚠ `color` IS NOT TEXT STYLING ANY MORE — IT IS THE MARK'S TINT, and deleting
     it as dead CSS fails silently. `AgentMark` fills with `currentColor`, so this
     line is the only thing deciding what the glyph resolves to; without it the
     mark inherits from the card and the whole family shifts tone in a way no gate
     catches. The `font-family`/`font-size` that sat beside it ARE gone: this tile
     can never hold text again. (`.card-tile` in FilmstripRenderer keeps its
     pair — that one still renders a '??' fallback.) */
  color: var(--color-text-badge);
}

.launch-agent-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.launch-agent-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay-card-selected .launch-agent-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.launch-agent-ver {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-quiet);
}

/* A detected version is the mock's jade "vX detected" line. */
.overlay-card-selected .launch-agent-found {
  color: var(--color-accent-jade);
}

/* ── Model (display only — D81) ────────────────────────────────────────── */
.launch-model {
  color: var(--color-text-quiet);
}

.launch-model-id {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Workspace mode cards ──────────────────────────────────────────────── */
.launch-mode-name {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-body);
}

.overlay-card-selected .launch-mode-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.launch-mode-note {
  display: block;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-quiet);
}

.overlay-card-selected .launch-mode-note {
  color: var(--color-accent-jade);
}

/* ── Inputs ────────────────────────────────────────────────────────────── */
.launch-cwd {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-text-body);
}

/* The reroll glyph and the countdown both sit INSIDE their field, on the
   trailing edge — the field is the control, and a button parked beside it
   would read as a second one. */
.launch-reroll {
  flex: none;
  display: flex;
  align-items: center;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--color-text-eyebrow);
  cursor: default;
}

.launch-reroll:hover {
  color: var(--color-accent-jade);
}

.launch-count {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

.launch-select {
  width: 100%;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-rail);
  padding: 7px 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-text-body);
}

.launch-recents {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.launch-recent {
  border: 0;
  background: transparent;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
  cursor: default;
  max-width: 14rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.launch-recent:hover {
  color: var(--color-text-quiet);
}

.launch-recent-root {
  color: var(--color-accent-jade);
}

.launch-recent-root:hover {
  color: var(--color-accent-jade-hover);
}

/* ── Messages ──────────────────────────────────────────────────────────── */
.launch-warn {
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-state-attention-text);
}

.launch-mono {
  font-family: var(--font-mono);
}

.launch-args {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

.launch-saved {
  font-size: 11.5px;
  color: var(--color-state-running-text);
}

.launch-link {
  align-self: flex-start;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 11.5px;
  color: var(--color-accent-jade);
  cursor: default;
}

.launch-link:hover {
  color: var(--color-accent-jade-hover);
}

.launch-save-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Footer ────────────────────────────────────────────────────────────── */
.launch-foot {
  padding: 11px 18px;
}

.launch-foot-spacer {
  flex: 1;
}
</style>
