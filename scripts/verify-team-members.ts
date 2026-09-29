import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { StorageService } from '../src/main/services/storage'
import { CredentialVault } from '../src/main/services/vault'
import { TeamMemberProfiles } from '../src/main/services/teamMemberProfiles'
import { teamFixtureRun, teamFixtureId } from '../src/main/services/teamTestFixtures'

export async function verifyTeamMembers(evidence: string): Promise<number> {
  let assertions = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const dbPath = path.join(evidence, 'members.db')
  let storage = new StorageService(dbPath), teams = storage.createTeamStorage(), vault = new CredentialVault(storage), members = new TeamMemberProfiles(storage, teams, vault)
  // Disposable values generated in memory, never real account credentials.
  const key = `fixture-${randomUUID()}`, input = { expectedVersion: null, label: 'Frontend helper', model: 'vendor/custom-model', instructions: 'Focus on accessibility.', credentialProfileId: null, apiKey: key }
  check(() => assert(vault.isAvailable()))
  const first = members.save(input).profiles[0]
  check(() => assert.equal(first.version, 1))
  check(() => assert.equal(storage.listCredentialProfiles().length, 1))
  check(() => assert(!JSON.stringify(members.list()).includes(key)))
  const decrypted = await vault.decryptForLaunch(first.credentialProfileId)
  check(() => assert(decrypted.ok && decrypted.value.key === key))
  const second = members.save({ ...input, label: 'Reviewer' }).profiles.find(p => p.id !== first.id)!
  check(() => assert.equal(second.credentialProfileId, first.credentialProfileId))
  check(() => assert.equal(storage.listCredentialProfiles().length, 1))
  const run = teamFixtureRun()
  run.config.helpers[0] = { ...run.config.helpers[0], profileId: first.id, label: first.label, model: first.model, instructions: first.instructions, customModel: true, harness: 'opencode', authMode: 'api_key', providerId: storage.getCredentialProfileById(first.credentialProfileId)!.providerId, credentialProfileId: first.credentialProfileId, installedVersion: '1.18.31' }
  teams.createRun(run, 'member-snapshot', { config: run.config }, teamFixtureId(601))
  const updated = members.save({ ...input, id: first.id, expectedVersion: 1, apiKey: undefined, credentialProfileId: first.credentialProfileId, label: 'Updated helper', model: 'vendor/other-model' }).profiles.find(p => p.id === first.id)!
  check(() => assert.equal(updated.version, 2))
  check(() => assert.equal(teams.getRun(run.id).config.helpers[0].model, first.model))
  check(() => assert.throws(() => members.save({ ...input, id: first.id, expectedVersion: 1, apiKey: `fixture-${randomUUID()}` }), /changed/))
  check(() => assert.equal(storage.listCredentialProfiles().length, 1))
  check(() => assert.throws(() => members.save({ ...input, instructions: key }), /API keys/))
  check(() => assert.throws(() => members.save({ ...input, apiKey: 'fixture-"quoted', instructions: 'fixture-"quoted' }), /API keys/))
  // Failure after credential insertion must roll back the entire transaction.
  const raw = new Database(dbPath)
  raw.exec("CREATE TRIGGER member_fault BEFORE INSERT ON team_member_profiles BEGIN SELECT RAISE(ABORT, 'member fault'); END")
  check(() => assert.throws(() => members.save({ ...input, apiKey: `fixture-${randomUUID()}` }), /member fault/))
  check(() => assert.equal(storage.listCredentialProfiles().length, 1))
  raw.exec('DROP TRIGGER member_fault')
  check(() => assert.throws(() => raw.prepare('DELETE FROM credential_profiles WHERE id=?').run(first.credentialProfileId), /FOREIGN KEY/))
  check(() => assert.throws(() => members.delete(first.id, 1), /changed/))
  members.delete(first.id, 2)
  check(() => assert.equal(teams.getRun(run.id).config.helpers[0].label, first.label))
  check(() => assert.equal(storage.listCredentialProfiles().length, 1))
  raw.close(); storage.close()
  check(() => assert(!fs.readFileSync(dbPath).includes(Buffer.from(key))))
  storage = new StorageService(dbPath); teams = storage.createTeamStorage(); vault = new CredentialVault(storage); members = new TeamMemberProfiles(storage, teams, vault)
  check(() => assert.equal(members.list().profiles[0].id, second.id))
  check(() => assert.equal(members.list().profiles.length, 1))
  check(() => assert.equal(teams.getRun(run.id).config.helpers[0].instructions, first.instructions))
  storage.close()
  // Upgrade the released v26 schema while preserving existing Team history.
  const upgrade = new Database(dbPath); upgrade.exec('DROP TABLE team_member_profiles'); upgrade.prepare('DELETE FROM schema_migrations WHERE version=27').run(); upgrade.close()
  storage = new StorageService(dbPath)
  check(() => assert.equal(storage.createTeamStorage().getRun(run.id).id, run.id))
  check(() => assert.deepEqual(storage.createTeamStorage().listMemberProfiles(), []))
  storage.close()
  return assertions
}
