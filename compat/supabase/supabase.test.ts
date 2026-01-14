/**
 * Tests for Supabase compat layer - MFA recovery code generation
 *
 * These tests verify that recovery codes are cryptographically secure:
 * - Use crypto.getRandomValues (not predictable patterns)
 * - Sufficient entropy (at least 128 bits)
 * - Codes are properly formatted and unique
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { generateRecoveryCodes, RECOVERY_CODE_CONFIG } from './supabase'

describe('Supabase MFA Recovery Codes', () => {
  describe('recovery code generation', () => {
    it('should generate the expected number of recovery codes', () => {
      const codes = generateRecoveryCodes()
      expect(codes).toHaveLength(10)
    })

    it('should generate unique codes within a batch', () => {
      const codes = generateRecoveryCodes()
      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })

    it('should NOT contain predictable patterns like timestamps or indices', () => {
      const codes = generateRecoveryCodes()

      for (const code of codes) {
        // Should not contain "recovery-" prefix from old implementation
        expect(code).not.toMatch(/^recovery-/)

        // Should not contain obvious timestamp patterns (13-digit numbers)
        expect(code).not.toMatch(/\d{13}/)

        // Should not contain sequential index patterns
        expect(code).not.toMatch(/-\d$/)
      }
    })

    it('should generate different codes on each call', () => {
      const codes1 = generateRecoveryCodes()
      const codes2 = generateRecoveryCodes()

      // The probability of collision with proper randomness is negligible
      // If codes are predictable (timestamp-based), consecutive calls may have overlaps
      const allCodes = new Set([...codes1, ...codes2])
      expect(allCodes.size).toBe(20) // All codes should be unique
    })

    it('should have sufficient entropy per code (at least 128 bits total)', () => {
      const codes = generateRecoveryCodes()

      // Recovery codes should use enough random bytes
      // 128 bits = 16 bytes minimum for the entire set
      // With 10 codes, each code should contribute meaningful entropy

      // Check code length - should be substantial enough for entropy
      // Typical formats: hex (32 chars = 128 bits), base32 (26 chars ~ 130 bits)
      for (const code of codes) {
        // Each code should have at least 16 characters (64 bits per code minimum)
        // With 10 codes, total entropy is at least 640 bits
        expect(code.length).toBeGreaterThanOrEqual(16)
      }
    })

    it('should use proper character set for recovery codes', () => {
      const codes = generateRecoveryCodes()

      for (const code of codes) {
        // Recovery codes should only contain safe characters
        // Typically alphanumeric with optional separators
        expect(code).toMatch(/^[A-Za-z0-9-]+$/)
      }
    })

    it('should be formatted for easy user entry', () => {
      const codes = generateRecoveryCodes()

      for (const code of codes) {
        // Codes should have separators for readability (e.g., XXXX-XXXX-XXXX)
        const parts = code.split('-')
        expect(parts.length).toBeGreaterThanOrEqual(2)

        // Each part should be a reasonable length for typing
        for (const part of parts) {
          expect(part.length).toBeLessThanOrEqual(8)
        }
      }
    })

    it('should pass statistical randomness test', () => {
      // Generate a large sample to test distribution
      const allCodes: string[] = []
      for (let i = 0; i < 100; i++) {
        allCodes.push(...generateRecoveryCodes())
      }

      // Count character frequencies in first position
      const charCounts = new Map<string, number>()
      for (const code of allCodes) {
        const firstChar = code[0]
        charCounts.set(firstChar, (charCounts.get(firstChar) || 0) + 1)
      }

      // With random distribution, no single character should dominate
      // If timestamp-based, certain digits would appear much more frequently
      const maxCount = Math.max(...charCounts.values())
      const minCount = Math.min(...charCounts.values())

      // The ratio should be reasonable for random distribution
      // Allow some variance but catch obvious patterns
      expect(maxCount / Math.max(minCount, 1)).toBeLessThan(10)
    })

    it('should expose configuration for entropy requirements', () => {
      expect(RECOVERY_CODE_CONFIG).toBeDefined()
      expect(RECOVERY_CODE_CONFIG.entropyBits).toBeGreaterThanOrEqual(128)
      expect(RECOVERY_CODE_CONFIG.codeCount).toBe(10)
    })
  })

  describe('edge cases', () => {
    it('should handle custom code count', () => {
      const codes = generateRecoveryCodes({ count: 5 })
      expect(codes).toHaveLength(5)
    })

    it('should handle custom entropy bits', () => {
      // Higher entropy should still work
      const codes = generateRecoveryCodes({ entropyBits: 256 })
      expect(codes).toHaveLength(10)

      // Codes should be longer with higher entropy
      for (const code of codes) {
        expect(code.length).toBeGreaterThanOrEqual(20)
      }
    })
  })
})
