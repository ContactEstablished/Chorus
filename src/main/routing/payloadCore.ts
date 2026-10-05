import {
  QUANTIZATIONS,
  type CandidateExplanation,
  type NitroSelection,
  type OpenRouterProviderPrefs,
  type Quantization,
  type RoutingSettings
} from '../../shared/routing'

/**
 * Model Routing Task 1-3: OpenRouter `provider` objects (ImplementationSpec-1-3;
 * K12, C8, MR-D4, MR-D5, MR-D11).
 *
 * Budget, Balanced and Fast pin their endpoints by tag in `order` with no
 * fallback outside it; they never carry a live sort, an ignore or only list, a
 * price cap or any `preferred_*` key. Nitro sends the `:nitro` slug and lets
 * OpenRouter choose. Every tier sends `data_collection: 'deny'` unless the
 * settings say `'allow'`, in which case the key is absent (never `undefined`).
 *
 * Pure and plain JSON: every result is a fresh object that shares no array
 * with its input.
 */

/**
 * K12, C8: the distinct union of the selected candidates' declared row
 * quantizations, in `QUANTIZATIONS` order. These are the values OpenRouter
 * filters on, so an admitted first-party `unknown` contributes `'unknown'`,
 * never its effective precision.
 */
export function quantizationsFor(selected: CandidateExplanation[]): Quantization[] {
  const declared = new Set<Quantization>()
  for (const c of selected) for (const q of c.rowQuantizations) declared.add(q)
  return QUANTIZATIONS.filter((q) => declared.has(q))
}

/**
 * MR-D5, MR-D11: keys in exactly this insertion order: `order` (tags, never
 * display names), `allow_fallbacks`, `require_parameters`, `quantizations`,
 * then `data_collection` only under `'deny'`.
 */
export function buildRankedProvider(selected: CandidateExplanation[], settings: RoutingSettings): OpenRouterProviderPrefs {
  const provider: OpenRouterProviderPrefs = {
    order: selected.map((c) => c.tag),
    allow_fallbacks: false,
    require_parameters: true,
    quantizations: quantizationsFor(selected)
  }
  if (settings.dataCollection === 'deny') provider.data_collection = 'deny'
  return provider
}

/**
 * MR-D4, MR-D11: `<slug>:nitro`, with `{ data_collection: 'deny' }` under
 * `'deny'` and no provider object under `'allow'`. `likely` and
 * `likelyFailsRules` are the ranker's preview, copied unchanged.
 */
export function buildNitroSelection(
  slug: string,
  likely: NitroSelection['likely'],
  likelyFailsRules: string[],
  settings: RoutingSettings
): NitroSelection {
  return {
    model: `${slug}:nitro`,
    provider: settings.dataCollection === 'deny' ? { data_collection: 'deny' } : null,
    likely: likely === null ? null : { tag: likely.tag, providerName: likely.providerName, tpsP50: likely.tpsP50 },
    likelyFailsRules: [...likelyFailsRules]
  }
}
