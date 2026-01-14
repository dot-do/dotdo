/**
 * Tests for ensureDefaultDO utility
 *
 * Note: The deriveNameFromEmail function is a pure utility that doesn't require mocking.
 * The ensureDefaultDO function tests would require proper ESM mocking setup.
 */

import { describe, it, expect } from 'vitest'
import { deriveNameFromEmail } from '../../utils/ensure-default-do'

describe('deriveNameFromEmail', () => {
  it('extracts username from email', () => {
    expect(deriveNameFromEmail('john@example.com')).toBe('john')
  })

  it('replaces dots with hyphens', () => {
    expect(deriveNameFromEmail('john.doe@example.com')).toBe('john-doe')
  })

  it('replaces plus signs with hyphens', () => {
    expect(deriveNameFromEmail('john+test@example.com')).toBe('john-test')
  })

  it('handles multiple dots and plus signs', () => {
    expect(deriveNameFromEmail('john.doe+test@example.com')).toBe('john-doe-test')
  })

  it('lowercases the name', () => {
    expect(deriveNameFromEmail('John.Doe@example.com')).toBe('john-doe')
  })

  it('handles email with only username part', () => {
    expect(deriveNameFromEmail('alice@company.io')).toBe('alice')
  })

  it('handles email with numbers', () => {
    expect(deriveNameFromEmail('user123@company.io')).toBe('user123')
  })

  it('handles email with underscores', () => {
    expect(deriveNameFromEmail('john_doe@company.io')).toBe('john_doe')
  })
})
