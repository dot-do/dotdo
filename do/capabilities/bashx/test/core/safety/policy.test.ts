// test/core/safety/policy.test.ts
import { describe, it, expect } from 'vitest'
import type { SafetyPolicy } from '../../../core/safety/policy.js'
import { DEFAULT_POLICY, PERMISSIVE_POLICY, STRICT_POLICY } from '../../../core/safety/policy.js'

describe('SafetyPolicy interface', () => {
  const policies = [DEFAULT_POLICY, PERMISSIVE_POLICY, STRICT_POLICY]

  policies.forEach(policy => {
    describe(policy.name, () => {
      it('should implement shouldBlock', () => {
        expect(typeof policy.shouldBlock).toBe('function')
      })

      it('should implement getMessage', () => {
        expect(typeof policy.getMessage).toBe('function')
      })
    })
  })

  describe('DEFAULT_POLICY', () => {
    it('should block critical impact', () => {
      const result = DEFAULT_POLICY.shouldBlock({ impact: 'critical' })
      expect(result).toBe(true)
    })

    it('should not block low impact', () => {
      const result = DEFAULT_POLICY.shouldBlock({ impact: 'low' })
      expect(result).toBe(false)
    })
  })
})
