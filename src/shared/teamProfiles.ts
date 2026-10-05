import { z } from 'zod'

export const deepseekFlashModel = 'deepseek/deepseek-v4.1-flash'
export const defaultTeamHelperModel = `${deepseekFlashModel}:nitro`
/** Routing aliases retain the bounded helper policy; other suffixes are not qualified. */
export function isDeepSeekFlashHelperModel(value: string): boolean {
  const model = normalizeTeamModel(value)
  return model === deepseekFlashModel || model === defaultTeamHelperModel
}

/** OpenRouter IDs are vendor/model, not URLs or shell commands. Accept the old CLI prefix too. */
export function normalizeTeamModel(value: string): string {
  const model = value.trim()
  return model.startsWith('openrouter/') && model.slice(11).includes('/') ? model.slice(11) : model
}
export const teamModelSchema = z.string().trim().min(3).max(200).transform(normalizeTeamModel)
  .pipe(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/, 'Enter an OpenRouter model ID such as vendor/model.'))
export const teamMemberProfileSchema = z.strictObject({
  id: z.uuid(), version: z.number().int().positive(), label: z.string().trim().min(1).max(100),
  model: teamModelSchema, instructions: z.string().trim().max(8000), credentialProfileId: z.uuid(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime()
})
export type TeamMemberProfile = z.infer<typeof teamMemberProfileSchema>
export const teamMemberProfileSaveSchema = z.strictObject({
  id: z.uuid().optional(), expectedVersion: z.number().int().positive().nullable(),
  label: z.string().trim().min(1).max(100), model: teamModelSchema, instructions: z.string().trim().max(8000).default(''),
  credentialProfileId: z.uuid().nullable(), apiKey: z.string().trim().min(1).max(16384).optional()
}).superRefine((v, ctx) => {
  if (!!v.credentialProfileId === !!v.apiKey) ctx.addIssue({ code: 'custom', message: 'Choose a saved credential or enter a new API key.' })
  if (!!v.id !== (v.expectedVersion !== null)) ctx.addIssue({ code: 'custom', message: 'Updates require the current member version.' })
})
export const teamMemberProfileDeleteSchema = z.strictObject({ id: z.uuid(), expectedVersion: z.number().int().positive() })
export const teamMemberProfileListSchema = z.strictObject({
  profiles: z.array(teamMemberProfileSchema),
  credentials: z.array(z.strictObject({ id: z.uuid(), label: z.string(), providerId: z.uuid(), providerName: z.string(), available: z.boolean() }))
})
export type TeamMemberProfileList = z.infer<typeof teamMemberProfileListSchema>
