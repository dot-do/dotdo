/**
 * Package Name Encoding Tests
 *
 * RED phase - These tests should FAIL initially.
 * They define the expected behavior for encoding package names in registry URLs.
 *
 * @see https://github.com/npm/npm-package-arg
 * @see https://docs.npmjs.com/cli/v10/using-npm/scope
 */

import { describe, it, expect } from 'vitest'
import { encodePackageName, validatePackageNameForRegistry } from '../../../core/package/name'

describe('encodePackageName', () => {
  // =============================================================================
  // Scoped Packages - The main fix
  // =============================================================================
  describe('Scoped packages', () => {
    it('should encode @types/node correctly', () => {
      const result = encodePackageName('@types/node')
      // The / in @types/node must be URL-encoded as %2F for registry URLs
      expect(result).toBe('@types%2Fnode')
    })

    it('should encode @scope/package correctly', () => {
      const result = encodePackageName('@scope/package')
      expect(result).toBe('@scope%2Fpackage')
    })

    it('should encode complex scoped names', () => {
      const result = encodePackageName('@my-org/my-package')
      expect(result).toBe('@my-org%2Fmy-package')
    })

    it('should encode @babel/core correctly', () => {
      const result = encodePackageName('@babel/core')
      expect(result).toBe('@babel%2Fcore')
    })

    it('should encode @cloudflare/workers-types correctly', () => {
      const result = encodePackageName('@cloudflare/workers-types')
      expect(result).toBe('@cloudflare%2Fworkers-types')
    })

    it('should encode nested scope names with special characters', () => {
      // Package names can contain dots, underscores, hyphens
      const result = encodePackageName('@my-org/my.package_name')
      expect(result).toBe('@my-org%2Fmy.package_name')
    })
  })

  // =============================================================================
  // Unscoped Packages - Should remain unchanged (no regression)
  // =============================================================================
  describe('Unscoped packages', () => {
    it('should NOT encode unscoped packages', () => {
      expect(encodePackageName('lodash')).toBe('lodash')
    })

    it('should NOT encode package with hyphen', () => {
      expect(encodePackageName('my-package')).toBe('my-package')
    })

    it('should NOT encode package with underscore', () => {
      expect(encodePackageName('my_package')).toBe('my_package')
    })

    it('should NOT encode package with dots', () => {
      expect(encodePackageName('lodash.get')).toBe('lodash.get')
    })

    it('should NOT encode package with numbers', () => {
      expect(encodePackageName('babel7')).toBe('babel7')
    })

    it('should NOT encode complex unscoped names', () => {
      expect(encodePackageName('react-dom-17')).toBe('react-dom-17')
    })
  })

  // =============================================================================
  // Edge Cases - Error handling
  // =============================================================================
  describe('Edge cases', () => {
    it('should throw on empty scope (@/package)', () => {
      expect(() => encodePackageName('@/package')).toThrow('Invalid scoped package name')
    })

    it('should throw on empty package name (@scope/)', () => {
      expect(() => encodePackageName('@scope/')).toThrow('Invalid scoped package name')
    })

    it('should throw on double @ (@@scope/package)', () => {
      expect(() => encodePackageName('@@scope/package')).toThrow('Invalid scoped package name')
    })

    it('should throw on scope-only (@scope)', () => {
      expect(() => encodePackageName('@scope')).toThrow('Invalid scoped package name')
    })

    it('should throw on multiple slashes (@scope/pkg/extra)', () => {
      expect(() => encodePackageName('@scope/pkg/extra')).toThrow('Invalid scoped package name')
    })

    it('should throw on empty string', () => {
      expect(() => encodePackageName('')).toThrow('Package name cannot be empty')
    })

    it('should throw on whitespace-only string', () => {
      expect(() => encodePackageName('   ')).toThrow('Package name cannot be empty')
    })
  })

  // =============================================================================
  // URL Safety - Ensures the result can be used in URLs
  // =============================================================================
  describe('URL safety', () => {
    it('should produce URL-safe output for scoped packages', () => {
      const encoded = encodePackageName('@types/node')
      // Should be usable directly in a URL without further encoding
      const url = `https://registry.npmjs.org/${encoded}`
      expect(url).toBe('https://registry.npmjs.org/@types%2Fnode')
      // Should not contain raw / that would break the URL path
      expect(encoded).not.toContain('/')
    })

    it('should work in full registry URL for metadata fetch', () => {
      const encoded = encodePackageName('@babel/core')
      const url = `https://registry.npmjs.org/${encoded}/latest`
      expect(url).toBe('https://registry.npmjs.org/@babel%2Fcore/latest')
    })

    it('should work in full registry URL for version fetch', () => {
      const encoded = encodePackageName('@types/node')
      const url = `https://registry.npmjs.org/${encoded}/22.0.0`
      expect(url).toBe('https://registry.npmjs.org/@types%2Fnode/22.0.0')
    })
  })
})

describe('validatePackageNameForRegistry', () => {
  // =============================================================================
  // Validation for registry operations
  // =============================================================================
  describe('Valid package names', () => {
    it('should accept valid unscoped package', () => {
      const result = validatePackageNameForRegistry('lodash')
      expect(result.valid).toBe(true)
      expect(result.scoped).toBe(false)
    })

    it('should accept valid scoped package', () => {
      const result = validatePackageNameForRegistry('@types/node')
      expect(result.valid).toBe(true)
      expect(result.scoped).toBe(true)
      expect(result.scope).toBe('types')
      expect(result.name).toBe('node')
    })

    it('should parse scope and name correctly', () => {
      const result = validatePackageNameForRegistry('@babel/core')
      expect(result.scope).toBe('babel')
      expect(result.name).toBe('core')
    })
  })

  describe('Invalid package names', () => {
    it('should reject empty scope', () => {
      const result = validatePackageNameForRegistry('@/package')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('EMPTY_SCOPE')
    })

    it('should reject empty package name', () => {
      const result = validatePackageNameForRegistry('@scope/')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('EMPTY_NAME')
    })

    it('should reject scope-only name', () => {
      const result = validatePackageNameForRegistry('@scope')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('MISSING_SLASH')
    })

    it('should reject names starting with @@ ', () => {
      const result = validatePackageNameForRegistry('@@scope/pkg')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('INVALID_SCOPE_PREFIX')
    })

    it('should reject empty string', () => {
      const result = validatePackageNameForRegistry('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('EMPTY_INPUT')
    })

    it('should reject multiple slashes in scoped package', () => {
      const result = validatePackageNameForRegistry('@scope/pkg/extra')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('MULTIPLE_SLASHES')
    })
  })
})
