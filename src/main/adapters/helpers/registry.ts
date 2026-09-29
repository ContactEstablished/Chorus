import { claudeHelper } from './claude'
import { codexHelper } from './codex'
import { opencodeHelper } from './opencode'
import type { HelperAdapter, HelperId } from './types'

export const helperRegistry: Readonly<Record<HelperId, HelperAdapter>> = Object.freeze({
  claude: claudeHelper, codex: codexHelper, opencode: opencodeHelper
})
export function getHelperAdapter(id: string): HelperAdapter | undefined {
  return Object.hasOwn(helperRegistry, id) ? helperRegistry[id as HelperId] : undefined
}
