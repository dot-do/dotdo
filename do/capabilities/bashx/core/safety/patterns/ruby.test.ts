/**
 * Ruby Safety Pattern Detection Tests (RED Phase)
 *
 * Tests for detecting dangerous patterns in Ruby code.
 * This enables multi-language safety analysis in bashx.
 *
 * Detection categories:
 * 1. eval family - Arbitrary code execution (critical impact)
 * 2. system execution - Shell command execution (high impact)
 * 3. binding exploitation - Scope exploitation (critical impact)
 * 4. Safe code - No dangerous patterns (low impact)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The analyzeRubySafety implementation will be done in the GREEN phase.
 *
 * Total: 12 tests
 * - eval family: 4 tests
 * - system execution: 5 tests
 * - binding exploitation: 1 test
 * - safe code: 2 tests
 */

import { describe, it, expect } from 'vitest'

import {
  analyzeRubySafety,
  type RubySafetyAnalysis,
  type DetectedPattern,
} from './ruby.js'

describe('analyzeRubySafety', () => {
  // ==========================================================================
  // eval Family Detection (4 tests)
  // Critical impact - arbitrary code execution vulnerability
  // ==========================================================================
  describe('eval family detection', () => {
    it('detects eval as critical impact', () => {
      const result = analyzeRubySafety('result = eval(user_input)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'eval',
          impact: 'critical',
        })
      )
    })

    it('detects instance_eval as critical impact', () => {
      const result = analyzeRubySafety('obj.instance_eval(code_string)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'instance_eval',
          impact: 'critical',
        })
      )
    })

    it('detects class_eval as critical impact', () => {
      const result = analyzeRubySafety('MyClass.class_eval(dynamic_code)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'class_eval',
          impact: 'critical',
        })
      )
    })

    it('detects module_eval as critical impact', () => {
      const result = analyzeRubySafety('MyModule.module_eval(code)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'module_eval',
          impact: 'critical',
        })
      )
    })
  })

  // ==========================================================================
  // System Execution Detection (5 tests)
  // High impact - shell command execution
  // ==========================================================================
  describe('system execution detection', () => {
    it('detects system() as high impact', () => {
      const result = analyzeRubySafety('system("rm -rf /")')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'system',
          impact: 'high',
        })
      )
    })

    it('detects backticks as high impact', () => {
      const result = analyzeRubySafety('output = `whoami`')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'backticks',
          impact: 'high',
        })
      )
    })

    it('detects %x{} as high impact', () => {
      const result = analyzeRubySafety('result = %x{ls -la}')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'percent_x',
          impact: 'high',
        })
      )
    })

    it('detects exec() as high impact', () => {
      const result = analyzeRubySafety('exec("/bin/bash")')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'exec',
          impact: 'high',
        })
      )
    })

    it('detects spawn() as high impact', () => {
      const result = analyzeRubySafety('pid = spawn("./background_job")')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'spawn',
          impact: 'high',
        })
      )
    })
  })

  // ==========================================================================
  // Binding Exploitation Detection (1 test)
  // Critical impact - scope exploitation vulnerability
  // ==========================================================================
  describe('binding exploitation detection', () => {
    it('detects binding.eval() as critical impact', () => {
      const result = analyzeRubySafety('binding.eval(user_code)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'binding_eval',
          impact: 'critical',
        })
      )
    })
  })

  // ==========================================================================
  // Safe Code Detection (2 tests)
  // Low impact - no dangerous patterns
  // ==========================================================================
  describe('safe code detection', () => {
    it('allows safe puts statements (low impact)', () => {
      const result = analyzeRubySafety('puts "Hello, World!"')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      expect(result.patterns).toHaveLength(0)
    })

    it('allows safe require statements', () => {
      const result = analyzeRubySafety('require "json"\ndata = JSON.parse(text)')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      expect(result.requires).toContain('json')
      // Should not contain any high-impact patterns
      const highImpactPatterns = result.patterns.filter(
        p => p.impact === 'high' || p.impact === 'critical'
      )
      expect(highImpactPatterns).toHaveLength(0)
    })
  })
})
