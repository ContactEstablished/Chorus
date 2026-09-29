// Copies only a selected encrypted profile and its provider into disposable verification storage.
// Source is opened read-only. Plaintext is resolved later by the production vault/launch path.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull } from 'drizzle-orm'
import { providerConfigs, credentialProfiles } from '../src/main/db/schema'
import type { StorageService } from '../src/main/services/storage'

export function copyFixtureCredential(sourceDatabase: string, destination: StorageService): string {
  const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true })
  try {
    const db = drizzle(source)
    const provider = db.select().from(providerConfigs).where(and(eq(providerConfigs.authMode, 'api_key'), eq(providerConfigs.baseUrl, 'https://openrouter.ai/api/v1'))).get()
    if (!provider) throw Error('Verified fixture API provider is unavailable')
    const profile = db.select().from(credentialProfiles).where(and(eq(credentialProfiles.providerId, provider.id), isNull(credentialProfiles.unavailableSince))).get()
    if (!profile) throw Error('Selected encrypted fixture credential is unavailable')
    destination.createProviderConfig(provider)
    destination.createCredentialProfile(profile)
    return profile.id
  } finally { source.close() }
}
