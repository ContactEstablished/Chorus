import { describe, expect, it } from 'vitest'
import { clipboardIntent, type ClipboardKeyEvent } from './clipboardKeys'

/** A keydown with no modifiers; each test sets only what it is about. */
const ev = (over: Partial<ClipboardKeyEvent>): ClipboardKeyEvent => ({
  type: 'keydown',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  key: 'a',
  ...over
})

describe('terminal clipboard chords', () => {
  it('Ctrl+V and Ctrl+Shift+V both mean paste', () => {
    expect(clipboardIntent(ev({ ctrlKey: true, key: 'v' }))).toBe('paste')
    // Shift shifts the key itself, which is why the check is case-insensitive.
    expect(clipboardIntent(ev({ ctrlKey: true, shiftKey: true, key: 'V' }))).toBe('paste')
  })

  it('Ctrl+Shift+C means copy', () => {
    expect(clipboardIntent(ev({ ctrlKey: true, shiftKey: true, key: 'C' }))).toBe('copy')
  })

  it('⚠ Ctrl+C is NOT copy — it must stay SIGINT', () => {
    // The regression this file exists to prevent. Making Ctrl+C copy would take
    // away the only way to interrupt a running agent.
    expect(clipboardIntent(ev({ ctrlKey: true, key: 'c' }))).toBeNull()
  })

  it('ignores keypress and keyup, so one press fires one action', () => {
    expect(clipboardIntent(ev({ type: 'keypress', ctrlKey: true, key: 'v' }))).toBeNull()
    expect(clipboardIntent(ev({ type: 'keyup', ctrlKey: true, key: 'v' }))).toBeNull()
  })

  it('ignores AltGr and Meta variants', () => {
    // AltGr is ctrl+alt on Windows layouts: a composed character, not a chord.
    expect(clipboardIntent(ev({ ctrlKey: true, altKey: true, key: 'v' }))).toBeNull()
    expect(clipboardIntent(ev({ ctrlKey: true, metaKey: true, key: 'v' }))).toBeNull()
  })

  it('leaves every other key to the terminal', () => {
    expect(clipboardIntent(ev({ key: 'v' }))).toBeNull()
    expect(clipboardIntent(ev({ ctrlKey: true, key: 'a' }))).toBeNull()
    expect(clipboardIntent(ev({ ctrlKey: true, key: 'd' }))).toBeNull()
    // Ctrl+K is App.vue's palette chord and must reach its capture-phase
    // listener rather than being claimed here.
    expect(clipboardIntent(ev({ ctrlKey: true, key: 'k' }))).toBeNull()
  })
})
