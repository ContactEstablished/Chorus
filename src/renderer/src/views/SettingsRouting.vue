<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import RoutingTierCards from '../components/routing/RoutingTierCards.vue'
import RoutingProviderTable from '../components/routing/RoutingProviderTable.vue'
import RoutingRefreshStatus from '../components/routing/RoutingRefreshStatus.vue'
import { useRoutingStore } from '../stores/routing'
import { flashSaved } from '../composables/savedFlash'
import {
  ROUTING_PREVIEW_NOTE,
  ROUTING_NO_CREDENTIAL_HINT,
  ROUTING_REFRESH_COST_TEXT,
  ROUTING_PROFILE_LABELS,
  ROUTING_INSPECTOR_EFFORT,
  tierCardViews,
  nitroCardView,
  resultNotes,
  providerTableView,
  snapshotAgeView,
  refreshProgressView,
  cooldownRemainingSeconds,
  refreshButtonView,
  observationView,
  credentialOptionLabel
} from '../../../shared/routingView'
import { DEFAULT_ROUTING_SETTINGS, ROUTING_PROFILE_IDS } from '../../../shared/routing'

/**
 * Settings → Model routing (Model Routing Task 3-4, ImplementationSpec-3-4):
 * inspect how OpenRouter's endpoints rank for one registry model, refresh the
 * numbers on request, and set the two things Phase 3 exposes — background
 * observation (MR-D19, MR-D23) and the data-collection opt-in (MR-D11, MR-D24).
 *
 * ⚠ A PREVIEW: NOTHING HERE IS SELECTABLE OR REACHES A LAUNCH (MR-D21, C20).
 * The cards and the table are read-outs; the page says so in its first line.
 *
 * ⚠ NO REFRESH WITHOUT A CLICK (K3, C19). Mounting loads the free reads
 * (`store.load()`); the 1 s ticker only moves `nowMs` for the age line, the
 * countdown and "last check", and never calls IPC. The Refresh button is the
 * only path to a paid call, and it states its cost before it runs.
 *
 * ⚠ STORE-BOUND CONTROLS, NOT v-model ON STORE STATE. Every control shows the
 * store's value (`:value` / `:checked`) and calls a store action on `change`;
 * the store builds every renderer-to-main payload from a JSON snapshot (D14,
 * MR-G5), so this view builds none. Both settings apply immediately (K9), adopt
 * what main stored, re-sync the control after a refused write, and confirm
 * with `flashSaved()` only when main accepted the write.
 *
 * ⚠ THE OBSERVATION SELECT IS A LOCAL DRAFT WHILE OBSERVATION IS OFF (C11).
 * A credential is designated only by choosing it while observation is on, or
 * by turning observation on with it chosen; turning off always clears it.
 */

const store = useRoutingStore()
const nowMs = ref(Date.now()) // C19: display only (age line, countdown, "last check")
const observeDraft = ref('') // C11: the observation select's value; '' = none
let alive = true // F13, as SettingsVoice.vue
let release: (() => void) | null = null
let ticker: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  release = store.connect()
  ticker = setInterval(() => {
    nowMs.value = Date.now()
  }, 1_000) // never calls IPC (K3)
  await store.load()
  if (!alive) return
  observeDraft.value = store.observation?.credentialProfileId ?? ''
})

onBeforeUnmount(() => {
  alive = false
  release?.()
  if (ticker !== null) clearInterval(ticker)
})

// ── Views (all built by shared/routingView.ts; nothing is formatted here) ──
const settings = computed(() => store.settings ?? DEFAULT_ROUTING_SETTINGS)
const cards = computed(() => tierCardViews(store.tiers, settings.value))
const nitro = computed(() => nitroCardView(store.tiers, store.model ?? ''))
const notes = computed(() => (store.tiers ? resultNotes(store.tiers) : []))
const table = computed(() => (store.tiers ? providerTableView(store.tiers) : null))
const age = computed(() =>
  store.tiers ? snapshotAgeView(store.tiers.snapshotFetchedAt, nowMs.value, settings.value.snapshotMaxAgeMinutes) : null
)
const ownRefresh = computed(() => store.refresh.model !== null && store.refresh.model === store.model)
const progress = computed(() => (ownRefresh.value ? refreshProgressView(store.refresh.events, store.refresh.phase) : null))
const cooldownSeconds = computed(() => (ownRefresh.value ? cooldownRemainingSeconds(store.refresh.endedAtMs, nowMs.value) : 0))
const button = computed(() =>
  refreshButtonView({
    phase: ownRefresh.value ? store.refresh.phase : 'idle',
    cooldownSeconds: cooldownSeconds.value,
    canRefresh: store.model !== null && store.credentialProfileId !== null
  })
)
// E1 (coordinator, Phase 3): a refresh that failed after reaching the network already prints
// `Failed: <message> Spent $x.` from its adopted `failed` event, so main's message is repeated
// here only when no such event arrived (a pre-network refusal, the cooldown BUSY included, or
// a failure whose events were missed).
const refreshError = computed(() =>
  ownRefresh.value && !store.refresh.events.some((e) => e.stage === 'failed') ? (store.refresh.error?.message ?? null) : null
)
const tiersErrorText = computed(() =>
  store.tiersError && store.tiersError.code !== 'NO_SNAPSHOT' ? store.tiersError.message : null
)
const observation = computed(() =>
  store.observation ? observationView(store.observation, store.status, store.credentials, nowMs.value) : null
)
const errorText = computed(() => store.loadError?.message ?? store.actionError?.message ?? null)

const effortText = `Ranked for reasoning effort "${ROUTING_INSPECTOR_EFFORT}", fixed in this preview.` // K5

// ── Inspector inputs: each calls its store action, which reloads the (free) tiers ──
function onModel(event: Event): void {
  void store.selectModel((event.target as HTMLSelectElement).value)
}

function onProfile(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const profile = ROUTING_PROFILE_IDS.find((id) => id === value)
  if (profile !== undefined) void store.selectProfile(profile)
}

function onCredential(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void store.selectCredential(value === '' ? null : value)
}

// ── Settings (K9: apply immediately; flashSaved() only after a write main accepted) ──
async function onObserveToggle(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const enabled = target.checked
  // MR-D23 / C11: on carries the select's value (or null); off always clears the designation.
  const ok = await store.setObservation(enabled, enabled ? observeDraft.value || null : null)
  if (!alive) return
  if (ok) {
    if (!enabled) observeDraft.value = ''
    flashSaved()
  }
  target.checked = store.observation?.enabled === true // re-sync after a refusal
}

async function onObserveCredential(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  observeDraft.value = value
  if (store.observation?.enabled !== true) return // C11: a local draft while off; nothing is designated
  const ok = await store.setObservation(true, value || null)
  if (!alive) return
  if (ok) flashSaved()
  else observeDraft.value = store.observation?.credentialProfileId ?? ''
}

async function onDataCollection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const ok = await store.setDataCollection(target.checked ? 'allow' : 'deny') // MR-D24: read-modify-write in the store
  if (!alive) return
  if (ok) flashSaved()
  target.checked = store.settings?.dataCollection === 'allow'
}
</script>

<template>
  <div class="set-page max-w-4xl" data-routing-section :data-routing-loaded="String(store.loaded)">
    <div class="routing-intro">
      <div class="set-head">
        <h1 class="set-title">Model routing</h1>
        <span class="set-subtitle">how OpenRouter endpoints rank for a model</span>
      </div>
      <p class="set-hint" data-routing-preview-note>{{ ROUTING_PREVIEW_NOTE }}</p>
    </div>

    <div v-if="!store.loaded && store.loading" class="set-blank">Loading…</div>
    <p v-if="errorText !== null" class="set-hint set-hint-warn" data-routing-error>{{ errorText }}</p>

    <template v-if="store.loaded">
      <!-- ── Inspect ────────────────────────────────────────────────── -->
      <div class="set-card routing-panel">
        <h2 class="set-section-title">Inspect</h2>
        <div class="routing-inputs">
          <label class="set-field-label">
            Model
            <select
              class="set-select set-select-sm routing-select"
              data-routing-model
              :value="store.model ?? ''"
              @change="onModel"
            >
              <option v-for="m in store.models" :key="m.slug" :value="m.slug">{{ m.displayName }}</option>
            </select>
          </label>
          <label class="set-field-label">
            Profile
            <select
              class="set-select set-select-sm routing-select"
              data-routing-profile
              :value="store.profile"
              @change="onProfile"
            >
              <option v-for="id in ROUTING_PROFILE_IDS" :key="id" :value="id">{{ ROUTING_PROFILE_LABELS[id] }}</option>
            </select>
          </label>
          <label class="set-field-label">
            Refresh with
            <select
              class="set-select set-select-sm routing-select"
              data-routing-credential
              :value="store.credentialProfileId ?? ''"
              :disabled="store.credentials.length === 0"
              @change="onCredential"
            >
              <option v-if="store.credentials.length === 0" value="" disabled>No OpenRouter API-key credential</option>
              <option v-for="c in store.credentials" :key="c.id" :value="c.id">{{ credentialOptionLabel(c) }}</option>
            </select>
          </label>
        </div>
        <p class="set-hint" data-routing-effort>{{ effortText }}</p>
        <p v-if="store.credentials.length === 0" class="set-hint set-hint-warn" data-routing-no-credential>
          {{ ROUTING_NO_CREDENTIAL_HINT }}
        </p>

        <RoutingRefreshStatus
          :button="button"
          :cost-text="ROUTING_REFRESH_COST_TEXT"
          :progress="progress"
          :age-text="age?.text ?? null"
          :stale-text="age?.staleText ?? null"
          :error="refreshError"
          @refresh="store.startRefresh()"
        />
        <p v-if="tiersErrorText !== null" class="set-hint set-hint-warn" data-routing-tiers-error>{{ tiersErrorText }}</p>
      </div>

      <!-- ── Tiers and providers (read-outs only, MR-D21) ───────────── -->
      <RoutingTierCards :cards="cards" :nitro="nitro" :notes="notes" />
      <RoutingProviderTable :table="table" />

      <!-- ── Background observation (MR-D19, MR-D23, K8) ───────────── -->
      <div class="set-card routing-panel">
        <h2 class="set-section-title">Background observation</h2>
        <p class="set-hint">
          While Chorus runs, it records OpenRouter's endpoint numbers for the registry models every 30 minutes:
          one free request with the credential you choose. No prompts or code are sent, and 7 days of numbers are kept.
        </p>
        <label class="set-field-label routing-check">
          <input
            type="checkbox"
            data-routing-observe
            :checked="store.observation?.enabled === true"
            :disabled="store.saving"
            @change="onObserveToggle"
          />
          <span>Record endpoint numbers in the background</span>
        </label>
        <select
          class="set-select set-select-sm routing-select routing-observe-select"
          data-routing-observe-credential
          :value="observeDraft"
          :disabled="store.saving"
          @change="onObserveCredential"
        >
          <option value="">Choose a credential…</option>
          <option v-for="c in store.credentials" :key="c.id" :value="c.id">{{ credentialOptionLabel(c) }}</option>
          <option v-if="observation !== null && !observation.designatedUsable" :value="observation.designatedId ?? ''">
            A credential that can no longer be used
          </option>
        </select>
        <template v-if="observation !== null">
          <p class="set-hint" data-routing-observe-state>{{ observation.stateText }}</p>
          <p v-if="observation.warning !== null" class="set-hint set-hint-warn" data-routing-observe-warning>
            {{ observation.warning }}
          </p>
          <p v-if="observation.lastText !== null" class="set-hint" data-routing-observe-last>{{ observation.lastText }}</p>
          <p v-if="observation.nextText !== null" class="set-hint" data-routing-observe-next>{{ observation.nextText }}</p>
          <p v-if="observation.credentialHint !== null" class="set-hint" data-routing-observe-hint>
            {{ observation.credentialHint }}
          </p>
        </template>
      </div>

      <!-- ── Data collection (MR-D11, MR-D24) ───────────────────────── -->
      <div class="set-card routing-panel">
        <h2 class="set-section-title">Data collection</h2>
        <label class="set-field-label routing-check">
          <input
            type="checkbox"
            data-routing-data-collection
            :checked="store.settings?.dataCollection === 'allow'"
            :disabled="store.saving"
            @change="onDataCollection"
          />
          <span>Allow providers that may store or train on prompts</span>
        </label>
        <p class="set-hint">
          Off (the default), every tier asks OpenRouter only for providers that do not collect prompt data
          (<span class="set-mono">data_collection: deny</span>). On, those providers can be ranked and chosen too.
        </p>
      </div>
    </template>
  </div>
</template>

<style src="../assets/settings.css"></style>

<style scoped>
/* The preview note reads as part of the head (C20), not as a block of its own. */
.routing-intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
}

/* settings.css's .set-card carries no padding of its own; this is the section's. */
.routing-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 16px;
}

.routing-inputs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
}

.routing-select {
  display: block;
  min-width: 190px;
  margin-top: 4px;
}

.routing-check {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  cursor: default;
}

.routing-check input {
  accent-color: var(--color-accent-jade);
}

.routing-observe-select {
  align-self: flex-start;
  margin-top: 0;
}
</style>
