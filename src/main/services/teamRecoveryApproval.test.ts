import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
const { recoveryApprovalCommand, allowedRecoveryApproval } = createRequire(import.meta.url)('../../../scripts/team-recovery-approval.mjs')

describe('verification-only Codex recovery approvals', () => {
  it('requires the native prompt and selected one-command approval', () => {
    const screen = `Would you like to run the following command?\nReason: Authorized recovery checkpoint\n  $ & 'C:\\Program Files\\Git\\cmd\\git.exe' add --\n    recovery-note.txt\n› 1. Yes, proceed (y)\n2. Yes, and don't ask again (p)`
    expect(recoveryApprovalCommand(screen)).toBe("& 'C:\\Program Files\\Git\\cmd\\git.exe' add -- recovery-note.txt")
    expect(recoveryApprovalCommand(screen.replace('› 1.', '  1.'))).toBeNull()
    expect(recoveryApprovalCommand(screen.replace('Would you like to run the following command?', 'Assistant summary'))).toBeNull()
  })
  it('permits only scoped Git operations and a commit with exactly the retained file staged', () => {
    expect(allowedRecoveryApproval('git status --porcelain')).toBe(true)
    expect(allowedRecoveryApproval('git diff -- recovery-note.txt')).toBe(true)
    expect(allowedRecoveryApproval('git add -- recovery-note.txt')).toBe(true)
    const commit = '& "C:\\Program Files\\Git\\cmd\\git.exe" -c user.name="Recovery Fixture" -c user.email="fixture@localhost" commit -m "Checkpoint retained work"'
    expect(allowedRecoveryApproval(commit, ['recovery-note.txt'])).toBe(true)
    expect(allowedRecoveryApproval(commit + ' --only -- recovery-note.txt', ['recovery-note.txt'])).toBe(true)
    expect(allowedRecoveryApproval(commit, [])).toBe(false)
    expect(allowedRecoveryApproval(commit, ['recovery-note.txt', 'unrelated.txt'])).toBe(false)
  })
  it.each(['git add .', 'git add -- unrelated.txt', 'git reset --hard', 'git push', 'git -c core.hooksPath=elsewhere commit -m "Checkpoint"', 'git add -- recovery-note.txt; git push', 'git commit -am "Checkpoint"', 'git commit -m "$(Get-Content private.txt)"', 'git commit -m "`command`"', '& "C:\\other\\git.exe" add -- recovery-note.txt'])('refuses unapproved command %s', command => {
    expect(allowedRecoveryApproval(command, ['recovery-note.txt'])).toBe(false)
  })
})
