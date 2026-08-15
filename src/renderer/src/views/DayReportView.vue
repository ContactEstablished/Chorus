<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModelCombobox from '../components/ModelCombobox.vue'
import { useSettingsStore } from '../stores/settings'
import type { DayReport, ModelCatalogEntry } from '../../../shared/ipc'

/**
 * The day report (D153) — "what was worked on today", across every project,
 * for a timesheet or project notes.
 *
 * ⚠ THIS SCREEN IS DELIBERATELY AGENT-BLIND, AND THAT IS THE FEATURE RATHER
 * THAN AN OMISSION. It never says which work came from Claude and which from
 * codex, because its source is git and git does not record it — a commit reads
 * identically whichever agent, or which pair of hands, produced it. That is
 * also what makes it work at all for a mixed fleet: the hook spine is
 * Claude-only (D129), so no telemetry-derived answer could cover codex.
 *
 * ⚠ AND IT STATES ITS OWN LIMITS ON THE PAGE. Work that was written and then
 * discarded never reaches git and is invisible here; in-flight work is
 * recognised by file mtime, which a checkout can disturb. A timesheet source
 * that quietly overstated a day would be worse than none, so the caveats are
 * rendered, not buried in a comment.
 */

const emit = defineEmits<{ (e: 'close'): void }>()

/** Local `YYYY-MM-DD`, never UTC: `toISOString()` would hand back yesterday
 *  for anyone west of Greenwich after 19:00. */
function localToday(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const date = ref(localToday())
const report = ref<DayReport | null>(null)
const storedDates = ref<string[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)
/** Off by default is wrong here: the written summary is the thing the user
 *  asked for. It is a checkbox so an offline or out-of-credit day still has a
 *  one-click path to the bullets. */
const summarize = ref(true)

/* ── The summarizer choice (a credential profile + a model id) ────────── */

const settings = useSettingsStore()
const configuring = ref(false)
const draftProfileId = ref('')
const draftModelId = ref('')
const summarizerSaved = ref<{ credentialProfileId: string; modelId: string } | null>(null)
const savingSummarizer = ref(false)

/** Suggestions for the chosen profile's provider. A FREE-TEXT combobox, never
 *  a closed select — the same D48 ruling the provider screen records: a user
 *  must be able to type an id the catalog has never heard of. */
const modelOptions = computed<ModelCatalogEntry[]>(() => {
  const profile = settings.profiles.find((p) => p.id === draftProfileId.value)
  if (profile === undefined) return []
  return (settings.modelsByProvider[profile.providerId]?.models ?? []).filter(
    (m) => m.missingSince === null
  )
})

const savedSummarizerLabel = computed(() => {
  if (summarizerSaved.value === null) return null
  const profile = settings.profiles.find((p) => p.id === summarizerSaved.value?.credentialProfileId)
  return `${summarizerSaved.value.modelId} · ${profile?.label ?? 'a deleted credential'}`
})

async function loadSummarizer(): Promise<void> {
  try {
    const res = await window.chorus.getDaySummarizer()
    if (!alive) return
    summarizerSaved.value = res.summarizer
    draftProfileId.value = res.summarizer?.credentialProfileId ?? ''
    draftModelId.value = res.summarizer?.modelId ?? ''
  } catch {
    // Cosmetic: the report still generates without prose.
  }
}

async function saveSummarizer(clear = false): Promise<void> {
  savingSummarizer.value = true
  error.value = null
  try {
    const next =
      clear || draftProfileId.value === '' || draftModelId.value.trim() === ''
        ? null
        : { credentialProfileId: draftProfileId.value, modelId: draftModelId.value.trim() }
    const res = await window.chorus.setDaySummarizer(next)
    if (!alive) return
    // Read back what main STORED, never the local draft.
    summarizerSaved.value = res.summarizer
    draftProfileId.value = res.summarizer?.credentialProfileId ?? ''
    draftModelId.value = res.summarizer?.modelId ?? ''
    configuring.value = false
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) savingSummarizer.value = false
  }
}

/** F13: this view can unmount while a generate is in flight. */
let alive = true
let copyTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  // The store may already be loaded by the settings screen; `load()` is
  // idempotent there and this view must work as the FIRST screen opened.
  await Promise.all([
    settings.load(),
    loadSummarizer(),
    loadStoredDates(),
    load(date.value)
  ])
})

onBeforeUnmount(() => {
  alive = false
  if (copyTimer !== null) clearTimeout(copyTimer)
})

async function loadStoredDates(): Promise<void> {
  try {
    const res = await window.chorus.listDayReports()
    if (alive) storedDates.value = res.dates
  } catch {
    // A missing history list is cosmetic; the page still works.
  }
}

/** Read a stored day. Never generates — opening the screen must not spawn git
 *  across six repositories, and must never spend money on a model. */
async function load(which: string): Promise<void> {
  error.value = null
  try {
    const res = await window.chorus.readDayReport(which)
    if (alive) report.value = res
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  }
}

async function generate(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const res = await window.chorus.generateDayReport(date.value, summarize.value)
    if (!alive) return
    report.value = res
    await loadStoredDates()
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) busy.value = false
  }
}

async function onPickDate(): Promise<void> {
  report.value = null
  await load(date.value)
}

/** Jump to a captured day. A named handler rather than two statements inline:
 *  Vue's template compiler parses an inline handler as a single expression and
 *  rejects the pair outright — and it does so at BUILD time, which `vue-tsc`
 *  does not reach. */
async function selectStoredDate(d: string): Promise<void> {
  date.value = d
  await onPickDate()
}

async function copy(): Promise<void> {
  if (report.value === null) return
  await navigator.clipboard.writeText(report.value.markdown)
  if (!alive) return
  copied.value = true
  if (copyTimer !== null) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1600)
}

const isToday = computed(() => date.value === localToday())

/** Counts for the header line. Derived on read — the same organising rule the
 *  rest of this feature keeps: nothing aggregated is stored. */
const totals = computed(() => {
  const repos = report.value?.evidence.repos ?? []
  return {
    projects: repos.length,
    commits: repos.reduce((n, r) => n + r.commits.length, 0),
    inFlight: repos.reduce((n, r) => n + r.dirty.length, 0)
  }
})
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">Day summary</h1>
      <span class="set-subtitle">what was worked on, across every project</span>
    </div>

    <div class="set-card p-4">
      <div class="flex items-end gap-3">
        <label class="set-field-label">
          Date
          <input
            v-model="date"
            type="date"
            class="set-input set-input-sm mt-1"
            @change="onPickDate"
          />
        </label>

        <label class="set-field-label">
          <span class="opacity-0">.</span>
          <span class="mt-1 flex items-center gap-2">
            <input v-model="summarize" type="checkbox" />
            <span>Write a summary</span>
          </span>
        </label>

        <button class="set-btn-primary" :disabled="busy" @click="generate">
          {{ busy ? 'Collecting…' : report === null ? 'Generate' : 'Regenerate' }}
        </button>

        <span class="flex-1"></span>

        <button v-if="report !== null" class="set-action" @click="copy">
          {{ copied ? 'Copied' : 'Copy markdown' }}
        </button>
      </div>

      <!-- ⚠ The honest caveat, on the page rather than in a comment. -->
      <p class="set-hint mt-3">
        Built from git across every active project — commits made on this date, plus files still
        uncommitted that were edited on it. Work that was never committed and has since been
        discarded does not appear, and this does not record which agent did what.
      </p>

      <!-- The summarizer choice. Inline rather than buried in Settings: it is
           the one setting this screen has, and a checkbox that silently does
           nothing because no model is configured is the failure to avoid. -->
      <div class="set-row mt-3">
        <span class="set-row-name">Summary model</span>
        <span class="set-row-detail">
          {{ savedSummarizerLabel ?? 'none — the report will have bullets but no written summary' }}
        </span>
        <span class="flex-1"></span>
        <button class="set-action" @click="configuring = !configuring">
          {{ configuring ? 'Cancel' : summarizerSaved === null ? 'Choose' : 'Change' }}
        </button>
      </div>

      <div v-if="configuring" class="mt-3 flex items-end gap-3">
        <label class="set-field-label">
          Credential
          <select v-model="draftProfileId" class="set-input set-input-sm mt-1">
            <option value="">Select a credential…</option>
            <option v-for="p in settings.profiles" :key="p.id" :value="p.id">
              {{ p.label }}
            </option>
          </select>
        </label>
        <label class="set-field-label flex-1">
          Model
          <ModelCombobox
            v-model="draftModelId"
            :options="modelOptions"
            class="mt-1 w-full"
            placeholder='search, or type e.g. "anthropic/claude-haiku-4.5"'
            :empty-hint="`${modelOptions.length} ids from the last refresh — type to search`"
          />
        </label>
        <button
          class="set-btn-primary"
          :disabled="savingSummarizer || draftProfileId === '' || draftModelId.trim() === ''"
          @click="saveSummarizer(false)"
        >
          Save
        </button>
        <button
          v-if="summarizerSaved !== null"
          class="set-action set-action-danger"
          :disabled="savingSummarizer"
          @click="saveSummarizer(true)"
        >
          Clear
        </button>
      </div>

      <p v-if="configuring" class="set-hint mt-2">
        A day's evidence is a few kilobytes, so a small, cheap model is the right choice here —
        it is writing three sentences over facts that are already assembled, not doing the
        analysis. Only commit subjects, file paths and symbol names are sent; no file contents
        and no diffs.
      </p>

      <p v-if="error" class="set-hint set-hint-warn mt-3">{{ error }}</p>

      <p v-if="busy" class="set-blank mt-4">
        Reading git across your projects…
      </p>

      <template v-else-if="report !== null">
        <div class="set-row mt-4">
          <span class="set-row-name">
            {{ totals.projects }} project{{ totals.projects === 1 ? '' : 's' }}
          </span>
          <span class="set-row-detail">
            {{ totals.commits }} commit{{ totals.commits === 1 ? '' : 's' }} ·
            {{ totals.inFlight }} file{{ totals.inFlight === 1 ? '' : 's' }} in flight
          </span>
        </div>

        <!-- The summarizer failing is stated, never silent: the bullets below
             are complete either way, and the user needs to know which half is
             missing and why. -->
        <p v-if="report.summaryError" class="set-hint set-hint-warn mt-3">
          {{ report.summaryError }}
        </p>

        <pre class="day-md mt-3">{{ report.markdown }}</pre>
      </template>

      <div v-else class="set-blank mt-4">
        <template v-if="isToday">
          No summary for today yet — press Generate.
        </template>
        <template v-else> Nothing was captured for this date. </template>
      </div>
    </div>

    <div v-if="storedDates.length > 0" class="set-card p-4 mt-4">
      <h2 class="set-section-title">Captured days</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          v-for="d in storedDates"
          :key="d"
          class="set-action"
          :class="d === date && 'set-action-on'"
          @click="selectStoredDate(d)"
        >
          {{ d }}
        </button>
      </div>
    </div>

    <button class="set-back mt-4" @click="emit('close')">
      back to workspace
      <span class="flex-1"></span>
      <span class="set-keycap">esc</span>
    </button>
  </div>
</template>

<style src="../assets/settings.css"></style>
<style scoped>
/* The report is markdown and is COPIED far more often than it is read here,
   so it renders as monospace source rather than being formatted. Rendering it
   would need a markdown parser (a dependency, and CLAUDE.md says ask first)
   and would make what you see differ from what you paste. */
.day-md {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, 'Cascadia Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.55;
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
}
</style>
