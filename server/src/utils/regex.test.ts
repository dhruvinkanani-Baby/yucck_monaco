import { describe, it, expect } from '@jest/globals'
import { escapeRegex } from './regex.js'

describe('Step 10 — escapeRegex Utility', () => {
  it('escapes all special regex characters correctly', () => {
    const dangerous = '.*+?^${}()|[]\\'
    const escaped = escapeRegex(dangerous)
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')

    // Confirm that the escaped pattern matches the literal string in a RegExp
    const re = new RegExp(escaped)
    expect(re.test(dangerous)).toBe(true)
    expect(re.test('foobar')).toBe(false)
  })

  it('handles benign alphanumeric strings without alteration', () => {
    const plain = 'FullStackEngineering101'
    expect(escapeRegex(plain)).toBe('FullStackEngineering101')
  })

  it('safely handles empty or non-string inputs', () => {
    expect(escapeRegex('')).toBe('')
    // @ts-expect-error test non-string runtime guard
    expect(escapeRegex(null)).toBe('')
    // @ts-expect-error test non-string runtime guard
    expect(escapeRegex(undefined)).toBe('')
  })
})
