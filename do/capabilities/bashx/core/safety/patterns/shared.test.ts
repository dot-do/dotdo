/**
 * Shared Safety Pattern Infrastructure Tests (RED Phase)
 *
 * Tests for common utilities extracted from language-specific pattern files.
 * This enables consistent pattern detection across all supported languages.
 *
 * Common utilities:
 * 1. ImpactLevel type and IMPACT_ORDER constant
 * 2. DetectedPattern interface
 * 3. PatternDefinition interface
 * 4. detectPatterns() helper function
 * 5. compareImpact() helper function
 * 6. getHighestImpact() helper function
 * 7. buildReasonString() helper function
 *
 * Total: 15 tests
 */

import { describe, it, expect } from 'vitest'

import {
  type ImpactLevel,
  type DetectedPattern,
  type PatternDefinition,
  IMPACT_ORDER,
  detectPatterns,
  compareImpact,
  getHighestImpact,
  buildReasonString,
} from './shared.js'

describe('shared safety pattern infrastructure', () => {
  // ==========================================================================
  // IMPACT_ORDER constant (2 tests)
  // ==========================================================================
  describe('IMPACT_ORDER', () => {
    it('contains all impact levels in ascending order', () => {
      expect(IMPACT_ORDER).toEqual(['low', 'medium', 'high', 'critical'])
    })

    it('exports correct type for ImpactLevel', () => {
      const levels: ImpactLevel[] = ['low', 'medium', 'high', 'critical']
      expect(levels.every((l) => IMPACT_ORDER.includes(l))).toBe(true)
    })
  })

  // ==========================================================================
  // compareImpact() helper (4 tests)
  // ==========================================================================
  describe('compareImpact', () => {
    it('returns negative when first impact is lower', () => {
      expect(compareImpact('low', 'high')).toBeLessThan(0)
      expect(compareImpact('medium', 'critical')).toBeLessThan(0)
    })

    it('returns positive when first impact is higher', () => {
      expect(compareImpact('critical', 'low')).toBeGreaterThan(0)
      expect(compareImpact('high', 'medium')).toBeGreaterThan(0)
    })

    it('returns zero when impacts are equal', () => {
      expect(compareImpact('low', 'low')).toBe(0)
      expect(compareImpact('critical', 'critical')).toBe(0)
    })

    it('handles all combinations correctly', () => {
      // low < medium < high < critical
      expect(compareImpact('low', 'medium')).toBeLessThan(0)
      expect(compareImpact('medium', 'high')).toBeLessThan(0)
      expect(compareImpact('high', 'critical')).toBeLessThan(0)
    })
  })

  // ==========================================================================
  // getHighestImpact() helper (3 tests)
  // ==========================================================================
  describe('getHighestImpact', () => {
    it('returns low for empty pattern array', () => {
      expect(getHighestImpact([])).toBe('low')
    })

    it('returns the highest impact from patterns', () => {
      const patterns: DetectedPattern[] = [
        { type: 'test1', impact: 'low' },
        { type: 'test2', impact: 'critical' },
        { type: 'test3', impact: 'medium' },
      ]
      expect(getHighestImpact(patterns)).toBe('critical')
    })

    it('handles single pattern correctly', () => {
      const patterns: DetectedPattern[] = [{ type: 'test', impact: 'high' }]
      expect(getHighestImpact(patterns)).toBe('high')
    })
  })

  // ==========================================================================
  // detectPatterns() helper (4 tests)
  // ==========================================================================
  describe('detectPatterns', () => {
    const testPatterns: PatternDefinition[] = [
      { type: 'eval', pattern: /\beval\s*\(/, impact: 'critical' },
      { type: 'system', pattern: /\bsystem\s*\(/, impact: 'high' },
      { type: 'print', pattern: /\bprint\s*\(/, impact: 'low' },
    ]

    it('detects matching patterns in code', () => {
      const code = 'eval(user_input)'
      const result = detectPatterns(code, testPatterns)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'eval',
        impact: 'critical',
        match: 'eval(',
      })
    })

    it('returns empty array when no patterns match', () => {
      const code = 'console.log("hello")'
      const result = detectPatterns(code, testPatterns)

      expect(result).toHaveLength(0)
    })

    it('detects multiple patterns in code', () => {
      const code = 'eval(code); system("ls")'
      const result = detectPatterns(code, testPatterns)

      expect(result).toHaveLength(2)
      expect(result.map((p) => p.type)).toContain('eval')
      expect(result.map((p) => p.type)).toContain('system')
    })

    it('preserves matched substring in result', () => {
      const code = 'result = system( cmd )'
      const result = detectPatterns(code, testPatterns)

      expect(result).toHaveLength(1)
      expect(result[0].match).toBe('system(')
    })
  })

  // ==========================================================================
  // buildReasonString() helper (2 tests)
  // ==========================================================================
  describe('buildReasonString', () => {
    it('returns default message for empty patterns', () => {
      expect(buildReasonString([])).toBe('No dangerous patterns detected')
    })

    it('returns formatted message for single pattern', () => {
      const patterns: DetectedPattern[] = [
        { type: 'eval', impact: 'critical' },
      ]
      expect(buildReasonString(patterns)).toBe('Detected eval pattern')
    })

    it('returns formatted message for multiple patterns', () => {
      const patterns: DetectedPattern[] = [
        { type: 'eval', impact: 'critical' },
        { type: 'system', impact: 'high' },
      ]
      expect(buildReasonString(patterns)).toBe('Detected patterns: eval, system')
    })

    it('deduplicates pattern types', () => {
      const patterns: DetectedPattern[] = [
        { type: 'eval', impact: 'critical' },
        { type: 'eval', impact: 'critical' },
      ]
      expect(buildReasonString(patterns)).toBe('Detected eval pattern')
    })
  })
})
