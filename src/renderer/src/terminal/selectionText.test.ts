import { describe, expect, it } from 'vitest'
import { trimSelectionForClipboard as trim } from './selectionText'

describe('terminal selection → clipboard', () => {
  it('strips the grid padding a one-line selection carries', () => {
    // The measured real case: xterm pads the row to the selection rectangle.
    expect(trim('AFTERFIX-CTRLV-EPSILON            ')).toBe('AFTERFIX-CTRLV-EPSILON')
  })

  it('⚠ preserves LEADING whitespace — indentation is content', () => {
    // The thing a per-line .trim() would destroy: copied code and diffs.
    expect(trim('function f() {   \n    return 1   \n}   ')).toBe('function f() {\n    return 1\n}')
    expect(trim('        deeply indented   ')).toBe('        deeply indented')
  })

  it('preserves interior blank lines', () => {
    // A gap inside the selection is something the user selected; only the
    // padding after the last content row is an artefact.
    expect(trim('one   \n   \ntwo   ')).toBe('one\n\ntwo')
  })

  it('drops blank rows dragged past the end', () => {
    expect(trim('one\ntwo\n   \n      \n')).toBe('one\ntwo')
  })

  it('⚠ leaves CRLF selections as CRLF', () => {
    // Split-and-rejoin would rewrite these to LF and make this a line-ending
    // converter by accident.
    expect(trim('one  \r\ntwo  \r\n')).toBe('one\r\ntwo')
    expect(trim('a \r\n \r\nb ')).toBe('a\r\n\r\nb')
  })

  it('handles tabs as trailing padding', () => {
    expect(trim('value\t\t  ')).toBe('value')
  })

  it('is total on the degenerate inputs', () => {
    expect(trim('')).toBe('')
    expect(trim('   ')).toBe('')
    expect(trim('\n\n')).toBe('')
    // Nothing to do is a no-op, not a rewrite.
    expect(trim('already clean')).toBe('already clean')
  })
})
