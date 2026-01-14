/**
 * applyGate Pipeline Stage Tests (RED phase)
 *
 * Tests for the safety gate pipeline stage that decides whether to block
 * command execution based on safety classification and confirmation state.
 *
 * These tests document the expected behavior of an independently callable
 * pipeline stage. They are expected to FAIL initially because the module
 * `src/mcp/pipeline/gate.ts` does not exist yet.
 *
 * @module test/mcp/pipeline/gate.test.ts
 */

import { describe, it, expect } from 'vitest'
import { applyGate } from '../../../src/mcp/pipeline/gate.js'
import type { GateInput, GateResult } from '../../../src/mcp/pipeline/gate.js'
import type { SafetyClassification } from '../../../core/types.js'

describe('applyGate stage', () => {
  describe('critical impact handling', () => {
    it('should block critical commands without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Recursive delete of root filesystem',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toBeDefined()
    })

    it('should allow critical commands with confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Recursive delete',
      }

      const result = applyGate({
        classification,
        confirm: true,
      })

      expect(result.blocked).toBe(false)
    })

    it('should provide suggestion when blocking', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Dangerous operation',
        suggestion: 'Use rm with -i flag for interactive deletion',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.suggestion).toBe('Use rm with -i flag for interactive deletion')
    })
  })

  describe('high impact handling', () => {
    it('should warn but not block high impact without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'high',
        reversible: true,
        reason: 'System file modification',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(true)
    })

    it('should allow high impact with confirmation', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'high',
        reversible: true,
        reason: 'System file modification',
      }

      const result = applyGate({
        classification,
        confirm: true,
      })

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })
  })

  describe('low/medium impact handling', () => {
    it('should allow medium impact commands', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'medium',
        reversible: true,
        reason: 'File write operation',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })

    it('should allow low impact commands', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'low',
        reversible: true,
        reason: 'Simple file creation',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })

    it('should allow no impact commands', () => {
      const classification: SafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only operation',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })
  })

  describe('stage independence', () => {
    it('should be callable without other pipeline stages', () => {
      const classification: SafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Safe read',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty('blocked')
      expect(result).toHaveProperty('requiresConfirm')
    })

    it('should have correct type exports', () => {
      const input: GateInput = {
        classification: {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Test',
        },
        confirm: false,
      }
      expect(input).toBeDefined()
    })

    it('should return consistent result structure', () => {
      const classifications: SafetyClassification[] = [
        { type: 'read', impact: 'none', reversible: true, reason: 'Read' },
        { type: 'write', impact: 'medium', reversible: true, reason: 'Write' },
        { type: 'delete', impact: 'critical', reversible: false, reason: 'Delete' },
      ]

      for (const classification of classifications) {
        const result = applyGate({ classification, confirm: false })
        expect(result).toMatchObject({
          blocked: expect.any(Boolean),
          requiresConfirm: expect.any(Boolean),
        })
      }
    })
  })

  describe('block reasons', () => {
    it('should include reason in block result', () => {
      const classification: SafetyClassification = {
        type: 'system',
        impact: 'critical',
        reversible: false,
        reason: 'System destruction command',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(true)
      expect(result.blockReason).toMatch(/dangerous|blocked|system/i)
    })

    it('should not include block reason for allowed commands', () => {
      const classification: SafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Safe command',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
      expect(result.blockReason).toBeUndefined()
    })
  })

  describe('network operation handling', () => {
    it('should handle network operations based on impact', () => {
      const classification: SafetyClassification = {
        type: 'network',
        impact: 'medium',
        reversible: true,
        reason: 'Network request',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(false)
    })

    it('should block high-risk network exfiltration', () => {
      const classification: SafetyClassification = {
        type: 'network',
        impact: 'critical',
        reversible: false,
        reason: 'Potential data exfiltration to external server',
      }

      const result = applyGate({
        classification,
        confirm: false,
      })

      expect(result.blocked).toBe(true)
    })
  })
})
