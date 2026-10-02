// Verification-only native prompt handling. Never imported by the application.
export function recoveryApprovalCommand(screen) {
  const modal = screen.lastIndexOf('Would you like to run the following command?')
  if (modal < 0) return null
  const prompt = screen.slice(modal)
  const selection = /›\s*1\.\s*Yes,\s*proceed\s*\(y\)/.exec(prompt)
  if (!selection) return null
  const dollar = prompt.lastIndexOf('$ ', selection.index)
  if (dollar < 0) return null
  return prompt.slice(dollar + 2, selection.index).replace(/\s+/g, ' ').trim()
}

export function allowedRecoveryApproval(command, stagedPaths = []) {
  const executable = /^(?:git|&\s+["']C:\\Program Files\\Git\\(?:cmd|bin)\\git\.exe["'])\s+(.+)$/.exec(command ?? '')
  if (!executable || /[;$`|<>\r\n]/.test(command)) return false
  let args = executable[1]
  const overrides = new Set()
  for (let i = 0; i < 2; i++) {
    const override = /^-c\s+user\.(name|email)=("Recovery Fixture"|'Recovery Fixture'|"fixture@localhost"|'fixture@localhost'|fixture@localhost)\s+/.exec(args)
    if (!override) break
    if (overrides.has(override[1]) || (override[1] === 'name' ? !/Recovery Fixture/.test(override[2]) : !/fixture@localhost/.test(override[2]))) return false
    overrides.add(override[1]); args = args.slice(override[0].length)
  }
  if (/^(?:status --porcelain|diff (?:--cached )?-- recovery-note\.txt|add -- recovery-note\.txt)$/.test(args)) return true
  return stagedPaths.length === 1 && stagedPaths[0] === 'recovery-note.txt'
    && /^commit -m (?:"[\w .-]{1,100}"|'[\w .-]{1,100}')(?: (?:--only )?-- recovery-note\.txt)?$/.test(args)
}
