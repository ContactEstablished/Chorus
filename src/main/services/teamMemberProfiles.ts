import { randomUUID } from 'node:crypto'
import { teamMemberProfileSaveSchema, type TeamMemberProfileList } from '../../shared/teamProfiles'
import type { z } from 'zod'
import type { StorageService } from './storage'
import type { TeamStorage } from './teamStorage'
import type { CredentialVault } from './vault'
import { fingerprint } from './vaultCore'
import { teamAssert } from './teamCore'
import { scrubSecrets } from './logger'

export const TEAM_OPENROUTER_URL = 'https://openrouter.ai/api/v1'
export class TeamMemberProfiles {
  constructor(private readonly storage: StorageService, private readonly teams: TeamStorage, private readonly vault: CredentialVault) {}
  list(): TeamMemberProfileList {
    const providers = this.storage.listProviderConfigs().filter(p => p.authMode === 'api_key' && p.baseUrl?.replace(/\/+$/, '') === TEAM_OPENROUTER_URL)
    return { profiles: this.teams.listMemberProfiles(), credentials: this.vault.listProfiles().filter(p => providers.some(provider => provider.id === p.providerId)).map(p => ({
      id: p.id, label: p.label, providerId: p.providerId, providerName: providers.find(provider => provider.id === p.providerId)!.name, available: !p.unavailableSince
    })) }
  }
  save(raw: z.infer<typeof teamMemberProfileSaveSchema>): TeamMemberProfileList {
    const input = teamMemberProfileSaveSchema.parse(raw), id = input.id ?? randomUUID(), now = new Date().toISOString()
    const publicFields = [input.label, input.model, input.instructions], publicText = JSON.stringify(publicFields)
    teamAssert(scrubSecrets(publicText) === publicText && (!input.apiKey || !publicFields.some(text => text.includes(input.apiKey!))), 'SECRET_IN_RECORD', 'Put API keys only in the API key field.')
    this.teams.saveMemberProfile(id, input.expectedVersion, old => {
      let credentialId = input.credentialProfileId
      if (input.apiKey) {
        let provider = this.storage.listProviderConfigs().find(p => p.authMode === 'api_key' && p.baseUrl?.replace(/\/+$/, '') === TEAM_OPENROUTER_URL)
        if (!provider) provider = this.storage.createProviderConfig({ id: randomUUID(), name: 'OpenRouter (Team helpers)', adapterType: 'opencode', authMode: 'api_key', envVarName: 'OPENROUTER_API_KEY', baseUrl: TEAM_OPENROUTER_URL, createdAt: now })
        const existing = this.storage.getCredentialProfileByFingerprint(provider.id, fingerprint(input.apiKey))
        if (existing) {
          teamAssert(!existing.unavailableSince, 'CREDENTIAL_UNAVAILABLE', 'This saved credential is unavailable. Replace it in Settings → Providers first.')
          credentialId = existing.id
        } else {
          const saved = this.vault.createProfile({ providerId: provider.id, label: `${input.label.slice(0, 75)} · ${randomUUID().slice(0, 8)}`, key: input.apiKey })
          teamAssert(saved.ok, 'CREDENTIAL_SAVE_FAILED', saved.ok ? '' : saved.message)
          credentialId = saved.value.id
        }
      }
      const credential = credentialId ? this.storage.getCredentialProfileById(credentialId) : null
      const provider = credential ? this.storage.getProviderConfigById(credential.providerId) : null
      teamAssert(credential && !credential.unavailableSince && provider?.authMode === 'api_key' && provider.baseUrl?.replace(/\/+$/, '') === TEAM_OPENROUTER_URL, 'CREDENTIAL_UNAVAILABLE', 'Choose an available OpenRouter API credential.')
      return { id, version: (old?.version ?? 0) + 1, label: input.label, model: input.model, instructions: input.instructions, credentialProfileId: credential.id, createdAt: old?.createdAt ?? now, updatedAt: now }
    })
    return this.list()
  }
  delete(id: string, expectedVersion: number): TeamMemberProfileList {
    this.teams.deleteMemberProfile(id, expectedVersion)
    return this.list()
  }
}
