import type { CredentialVault } from './vault'
import type { JevActionResponse } from '../../shared/ipc'

export const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'

/** A fixed sample verifies inference access without sending project content.
 * No automatic retries: a test is one potentially billable request.
 * https://docs.typesafe.ai/api */
export async function testJevKey(
  vault: Pick<CredentialVault, 'decryptJevKey'>,
  fetcher: typeof fetch = fetch
): Promise<JevActionResponse> {
  try {
    const resolved = await vault.decryptJevKey()
    if (!resolved.ok) return { ok: false, reason: resolved.message }
    const response = await fetcher(JEV_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolved.value.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: 'The connection test is ready.',
        questions: { ready: { type: 'noul', instructions: 'Does the text say the connection test is ready?' } }
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    })
    if (!response.ok) {
      await response.body?.cancel()
      const reason = response.status === 401 || response.status === 403
        ? 'JEV rejected the API key. Check the key and its permissions.'
        : response.status === 429
          ? 'JEV rate limit reached. Try again later.'
          : response.status === 402
            ? 'JEV requires available account credit. Check your TypeSafe account.'
            : 'JEV could not complete the connection test. Try again later.'
      return { ok: false, reason }
    }
    const data = await response.json() as { answers?: { ready?: { type?: unknown; noul?: unknown } } } | null
    const answer = data?.answers?.ready
    if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      return { ok: false, reason: 'JEV returned an unexpected response. Try again later.' }
    }
    return { ok: true }
  } catch {
    // Never return/log an exception or a response body: either may echo the key.
    return { ok: false, reason: 'Could not connect to JEV. Check your connection and try again.' }
  }
}
