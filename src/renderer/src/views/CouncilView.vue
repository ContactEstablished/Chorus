<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useCouncilStore } from '../stores/council'

/**
 * Council view (Task 3b-4 / D64(1)): brief `.md` in, deliberation on screen,
 * findings `.md` out beside the brief. A VIEW/ROUTE on the `SettingsView`
 * precedent, deliberately NOT a layout pane — D45(3)'s versioned layout-schema
 * change stays entirely out of this phase.
 *
 * Three rendering rules here are not styling (spec §4):
 *  1. every byte of the live deliberation arrived through main's ONE scrub seam
 *     (`SessionOutput.onText`); this component is given no other channel;
 *  2. a partial run READS as partial — the roster says who could not take part
 *     and the accounting says how many actually answered;
 *  3. findings are presented as DELIBERATION, not as verification. CR-3b.0's
 *     four compile errors are the standing evidence for why.
 */
const props = defineProps<{ overlayOpen: boolean; projectId: string | null }>()
const emit = defineEmits<{ close: [] }>()

const council = useCouncilStore()

/**
 * ⚠ THE ONLY SENTENCE THIS FEATURE MAY SHIP ABOUT REDACTION (F27, and
 * `Task-3b-4.md` quotes it verbatim). It is bounded on purpose: the pre-pass
 * matches KNOWN SHAPES from `secret-patterns.json` and cannot recognise a
 * credential that looks like prose. "Your brief is safe" is the claim this
 * wording exists to refuse.
 */
const REDACTION_WORDING =
  'Chorus redacts registered exact values on ingest and scans briefs for known credential shapes. ' +
  'It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.'

// F13 (de98679): the view can unmount while the roster load is in flight. The
// flag is set BEFORE the first await and checked after it; the Esc listener and
// the progress subscription get the same discipline — registered on mount,
// released on unmount, never leaked.
let alive = true
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  council.subscribe()
  await council.loadMembers()
  if (!alive) return
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', onKeydown)
  council.unsubscribe()
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // An overlay above the view owns Esc first (the SettingsView rule). A run in
  // flight also owns it: leaving mid-deliberation would strand a paid-for run
  // with nowhere to render.
  if (props.overlayOpen || council.running) return
  emit('close')
}

const briefName = computed<string>(() => {
  const path = council.briefPath
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
})

const canRun = computed<boolean>(
  () => !council.running && council.briefPath !== null && council.deliberators.length >= 2 && council.arbiters.length === 1
)

const labelFor = (memberId: string | null): string => {
  if (memberId === null) return 'orchestrator'
  return council.members.find((m) => m.id === memberId)?.label ?? memberId
}

const PHASE_LABEL: Record<string, string> = {
  positions: 'Positions (blind)',
  critique: 'Critique (anonymised)',
  arbitration: 'Arbitration',
  synthesis: 'Synthesis',
  done: 'Done'
}
</script>

<template>
  <div class="flex h-full">
    <!-- roster -->
    <nav class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-800 bg-neutral-900 px-3 py-3">
      <div class="px-1 pb-1 text-[10px] tracking-[0.18em] text-neutral-500 select-none">COUNCIL</div>

      <div v-if="council.members.length === 0" class="px-1 text-xs text-neutral-500">
        No council members are configured. Add some in Settings first.
      </div>

      <div
        v-for="m in council.members"
        :key="m.id"
        class="rounded border px-2 py-1.5"
        :class="m.available ? 'border-neutral-700 bg-neutral-800' : 'border-red-900 bg-neutral-800'"
      >
        <div class="flex items-baseline gap-2">
          <span class="truncate text-xs font-medium text-neutral-100">{{ m.label }}</span>
          <span class="text-[10px] uppercase tracking-wider text-neutral-500">{{ m.role }}</span>
        </div>
        <div class="truncate text-[11px] text-neutral-400">
          {{ m.resolvedModel ?? 'no model resolved' }}
        </div>
        <!-- ⚠ A member that cannot deliberate is SHOWN AND EXPLAINED, never
             quietly dropped: assembly refuses the whole run over it, and a
             roster that hid it would make that refusal unreadable. -->
        <div v-if="!m.available" class="mt-1 text-[11px] text-red-400">
          {{ m.unavailableReason ?? 'unavailable' }}
        </div>
      </div>

      <div class="flex-1"></div>
      <button
        class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
        :disabled="council.running"
        @click="emit('close')"
      >
        back to workspace
        <span class="flex-1"></span>
        <span class="rounded border border-neutral-700 bg-neutral-800 px-1 py-px text-[10px] text-neutral-500">
          esc
        </span>
      </button>
    </nav>

    <!-- run surface -->
    <div class="min-w-0 flex-1 overflow-y-auto px-8 py-5">
      <h1 class="text-sm font-medium text-neutral-100">Council review</h1>
      <p class="mt-1 max-w-3xl text-xs text-neutral-400">
        Point Chorus at a brief. Every member answers its numbered questions blind, critiques the
        others anonymised, and the arbiter rules and synthesizes. The findings land as a
        <code class="text-neutral-300">-Findings.md</code> file beside the brief.
      </p>

      <!-- brief picker -->
      <div class="mt-5 flex items-center gap-3">
        <button
          class="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 hover:border-neutral-600 disabled:opacity-40"
          :disabled="council.running"
          data-testid="council-choose-brief"
          @click="council.pickBrief()"
        >
          Choose brief…
        </button>
        <span v-if="briefName" class="truncate text-xs text-neutral-300" :title="council.briefPath ?? ''">
          {{ briefName }}
        </span>
        <span v-else class="text-xs text-neutral-500">no brief chosen</span>

        <span class="flex-1"></span>

        <button
          v-if="council.running"
          class="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-40"
          :disabled="council.runId === null"
          @click="council.cancel()"
        >
          Cancel run
        </button>
        <button
          v-else
          class="rounded border border-neutral-600 bg-neutral-700 px-3 py-1.5 text-xs text-neutral-50 hover:border-neutral-500 disabled:opacity-40"
          :disabled="!canRun"
          data-testid="council-run"
          @click="council.run(props.projectId)"
        >
          Run council
        </button>
      </div>

      <!-- ⚠ F27, verbatim and unabridged. This is the first surface a user reads
           a redaction claim on, and the claim is deliberately bounded. -->
      <p class="mt-3 max-w-3xl text-[11px] leading-relaxed text-neutral-500">
        {{ REDACTION_WORDING }}
      </p>

      <p v-if="council.error" class="mt-4 max-w-3xl rounded border border-red-900 bg-neutral-900 px-3 py-2 text-xs text-red-400">
        {{ council.error }}
      </p>

      <!-- live deliberation -->
      <section v-if="council.messages.length > 0" class="mt-6">
        <h2 class="text-xs font-medium text-neutral-200">
          Deliberation
          <span v-if="council.phase" class="ml-2 text-[11px] font-normal text-neutral-500">
            {{ PHASE_LABEL[council.phase] ?? council.phase }}
            <template v-if="council.round !== null"> · round {{ council.round }}</template>
          </span>
        </h2>
        <div class="mt-2 space-y-3">
          <article
            v-for="(msg, i) in council.messages"
            :key="i"
            class="rounded border border-neutral-800 bg-neutral-900 px-3 py-2"
          >
            <div class="text-[11px] text-neutral-500">
              {{ labelFor(msg.memberId) }} · {{ PHASE_LABEL[msg.phase] ?? msg.phase }} · round {{ msg.round }}
            </div>
            <pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-neutral-300">{{ msg.text }}</pre>
          </article>
        </div>
      </section>

      <!-- findings -->
      <section v-if="council.findings" class="mt-6">
        <h2 class="text-xs font-medium text-neutral-200">Findings</h2>

        <!-- ⚠ SPEC §4.3 / §3.2: presented as DELIBERATION, not as verification.
             The same caveat the written file carries, visible here so a reader
             who never opens the file still gets it. -->
        <p class="mt-2 max-w-3xl rounded border border-amber-900 bg-neutral-900 px-3 py-2 text-[11px] text-amber-300">
          These findings are model deliberation, not verified fact. Nothing here was compiled, run or
          tested, and no member could see the repository.
        </p>

        <p v-if="council.findingsPath" class="mt-2 text-[11px] text-neutral-400">
          Written to <span class="text-neutral-300">{{ council.findingsPath }}</span>
        </p>
        <p v-else-if="council.findingsError" class="mt-2 text-[11px] text-red-400">
          {{ council.findingsError }}
        </p>

        <!-- ⚠ D55 ONE LAYER UP: no number without its denominator. A cost or a
             token count rendered alone is the same defect the schema already
             forbids on the wire. -->
        <dl v-if="council.accounting" class="mt-3 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-neutral-400">
          <dt>Members answered</dt>
          <dd class="text-neutral-300">
            {{ council.accounting.membersAnswered }} of {{ council.accounting.membersPlanned }}
            <template v-if="council.accounting.membersRefused > 0">
              · {{ council.accounting.membersRefused }} refused at least once
            </template>
          </dd>
          <dt>Turns</dt>
          <dd class="text-neutral-300">
            {{ council.accounting.turnsAnswered }} answered · {{ council.accounting.turnsRefused }} refused
          </dd>
          <dt>Usage reported</dt>
          <dd class="text-neutral-300">
            for {{ council.accounting.usageReported }} turn(s) · absent for
            {{ council.accounting.usageAbsent }}
          </dd>
          <dt>Tokens</dt>
          <dd class="text-neutral-300">
            <template v-if="council.accounting.tokensIn === null && council.accounting.tokensOut === null">
              not reported
            </template>
            <template v-else>
              {{ council.accounting.tokensIn ?? 'n/r' }} in · {{ council.accounting.tokensOut ?? 'n/r' }} out
            </template>
          </dd>
          <dt>Cost</dt>
          <dd class="text-neutral-300">
            <template v-if="council.costUsd === null">not reported by the provider</template>
            <template v-else>${{ council.costUsd }}</template>
            <span class="text-neutral-500">
              — for the {{ council.accounting.turnsAnswered + council.accounting.turnsRefused }} turn(s) above
            </span>
          </dd>
        </dl>

        <pre
          class="mt-3 max-w-4xl overflow-x-auto whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-900 px-3 py-2 font-sans text-xs text-neutral-300"
        >{{ council.findings }}</pre>
      </section>
    </div>
  </div>
</template>
