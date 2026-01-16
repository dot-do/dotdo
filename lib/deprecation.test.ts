/**
 * Deprecation Warning Tests
 *
 * Tests for runtime deprecation warnings that help developers migrate from deprecated APIs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  emitDeprecationWarning,
  wrapDeprecated,
  clearDeprecationWarnings,
  _getWarningCalls,
  _resetWarningCalls,
} from './deprecation'

describe('Deprecation Utilities', () => {
  beforeEach(() => {
    // Clear any previous warnings before each test
    clearDeprecationWarnings()
    _resetWarningCalls()
  })

  describe('emitDeprecationWarning', () => {
    it('should emit a warning on first call', () => {
      emitDeprecationWarning('oldMethod')

      const calls = _getWarningCalls()
      expect(calls.length).toBe(1)
      expect(calls[0]).toBe('[DEPRECATED] oldMethod is deprecated.')
    })

    it('should include replacement method in warning when provided', () => {
      emitDeprecationWarning('oldMethod', 'newMethod')

      const calls = _getWarningCalls()
      expect(calls[0]).toBe(
        '[DEPRECATED] oldMethod is deprecated. Use newMethod instead.'
      )
    })

    it('should only warn once per method', () => {
      emitDeprecationWarning('oldMethod')
      emitDeprecationWarning('oldMethod')
      emitDeprecationWarning('oldMethod')

      const calls = _getWarningCalls()
      expect(calls.length).toBe(1)
    })

    it('should warn separately for different methods', () => {
      emitDeprecationWarning('method1')
      emitDeprecationWarning('method2')

      const calls = _getWarningCalls()
      expect(calls.length).toBe(2)
    })

    it('should include class context when provided', () => {
      emitDeprecationWarning('DOCore.getThingPublic', 'DOCore.getThingById')

      const calls = _getWarningCalls()
      expect(calls[0]).toBe(
        '[DEPRECATED] DOCore.getThingPublic is deprecated. Use DOCore.getThingById instead.'
      )
    })
  })

  describe('wrapDeprecated function wrapper', () => {
    it('should emit warning when wrapped function is called', () => {
      const original = () => 'result'
      const wrapped = wrapDeprecated('oldMethod', original, 'newMethod')

      const result = wrapped()

      expect(result).toBe('result')
      const calls = _getWarningCalls()
      expect(calls.length).toBe(1)
      expect(calls[0]).toBe(
        '[DEPRECATED] oldMethod is deprecated. Use newMethod instead.'
      )
    })

    it('should only warn once across multiple calls', () => {
      const original = () => 'result'
      const wrapped = wrapDeprecated('testMethod', original, 'newMethod')

      wrapped()
      wrapped()
      wrapped()

      const calls = _getWarningCalls()
      expect(calls.length).toBe(1)
    })

    it('should preserve function return value', () => {
      const original = () => ({ complex: 'value', array: [1, 2, 3] })
      const wrapped = wrapDeprecated('testMethod2', original, 'newMethod')

      const result = wrapped()

      expect(result).toEqual({ complex: 'value', array: [1, 2, 3] })
    })

    it('should preserve function arguments', () => {
      const original = (a: number, b: string) => `${a}-${b}`
      const wrapped = wrapDeprecated('testMethod3', original, 'newMethod')

      const result = wrapped(42, 'test')

      expect(result).toBe('42-test')
    })

    it('should work with async functions', async () => {
      const original = async () => Promise.resolve('async result')
      const wrapped = wrapDeprecated('asyncMethod', original, 'newMethod')

      const result = await wrapped()

      expect(result).toBe('async result')
      const calls = _getWarningCalls()
      expect(calls.length).toBe(1)
    })

    it('should propagate errors from wrapped function', () => {
      const original = () => {
        throw new Error('test error')
      }
      const wrapped = wrapDeprecated('errorMethod', original, 'newMethod')

      expect(() => wrapped()).toThrow('test error')
    })

    it('should warn separately for different method names', () => {
      const fn1 = wrapDeprecated('method1', () => 'A', 'new1')
      const fn2 = wrapDeprecated('method2', () => 'B', 'new2')

      fn1()
      fn2()

      const calls = _getWarningCalls()
      expect(calls.length).toBe(2)
    })
  })

  describe('clearDeprecationWarnings', () => {
    it('should allow warnings to be emitted again after clearing', () => {
      emitDeprecationWarning('method')
      expect(_getWarningCalls().length).toBe(1)

      clearDeprecationWarnings()
      _resetWarningCalls()

      emitDeprecationWarning('method')
      expect(_getWarningCalls().length).toBe(1) // Warned again after clear
    })
  })
})
