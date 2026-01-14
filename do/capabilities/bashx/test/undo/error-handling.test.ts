// test/undo/error-handling.test.ts
import { describe, it, expect } from 'vitest'
import { getErrorRecord } from '../../src/undo.js'

describe('error type handling', () => {
  it('should handle Error objects', () => {
    const err = new Error('test')
    const record = getErrorRecord(err)
    expect(record.message).toBe('test')
  })

  it('should handle string errors', () => {
    const record = getErrorRecord('string error')
    expect(record.message).toBe('string error')
  })

  it('should handle null', () => {
    const record = getErrorRecord(null)
    expect(record.message).toBeDefined()
  })

  it('should handle objects with code property', () => {
    const err = { code: 'ENOENT', message: 'not found' }
    const record = getErrorRecord(err)
    expect(record.code).toBe('ENOENT')
  })
})
