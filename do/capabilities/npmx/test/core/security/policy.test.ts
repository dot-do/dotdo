/**
 * RED Phase Tests: Security Allowlist for AI Agent Package Installation
 *
 * Issue: dotdo-o01fw - P0 SECURITY
 *
 * These tests define the expected behavior for a security policy system
 * that prevents AI agents from installing malicious packages.
 *
 * Acceptance Criteria:
 * - [ ] Packages not in allowlist are rejected
 * - [ ] Blocklisted packages throw SecurityError
 * - [ ] License violations detected
 * - [ ] Vulnerability threshold enforcement
 * - [ ] Per-agent security configs work
 * - [ ] SecurityError has actionable info
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SecurityPolicy,
  type NpmSecurityConfig,
  type SecurityCheckResult,
  type SecurityViolation,
  type VulnerabilitySeverity,
} from '../../../core/security/policy.js'
import { SecurityError } from '../../../core/errors/index.js'

describe('Security Policy for Package Installation', () => {
  describe('Allowlist Enforcement', () => {
    it('should allow packages on the allowlist', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash', 'react', 'typescript'],
      })

      const result = policy.check('lodash')

      expect(result.allowed).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('should reject packages not on the allowlist when allowlist is set', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash', 'react'],
      })

      const result = policy.check('malicious-package')

      expect(result.allowed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('not_in_allowlist')
      expect(result.violations[0].package).toBe('malicious-package')
    })

    it('should allow any package when no allowlist is configured', () => {
      const policy = new SecurityPolicy({})

      const result = policy.check('any-package')

      expect(result.allowed).toBe(true)
    })

    it('should support scoped packages in allowlist', () => {
      const policy = new SecurityPolicy({
        allowlist: ['@types/node', '@dotdo/npmx'],
      })

      expect(policy.check('@types/node').allowed).toBe(true)
      expect(policy.check('@dotdo/npmx').allowed).toBe(true)
      expect(policy.check('@malicious/pkg').allowed).toBe(false)
    })

    it('should support wildcard patterns in allowlist', () => {
      const policy = new SecurityPolicy({
        allowlist: ['@types/*', 'lodash*', '@dotdo/*'],
      })

      expect(policy.check('@types/node').allowed).toBe(true)
      expect(policy.check('@types/react').allowed).toBe(true)
      expect(policy.check('lodash').allowed).toBe(true)
      expect(policy.check('lodash-es').allowed).toBe(true)
      expect(policy.check('@dotdo/fsx').allowed).toBe(true)
      expect(policy.check('other-package').allowed).toBe(false)
    })
  })

  describe('Blocklist Enforcement', () => {
    it('should block packages on the blocklist', () => {
      const policy = new SecurityPolicy({
        blocklist: ['event-stream', 'flatmap-stream'],
      })

      const result = policy.check('event-stream')

      expect(result.allowed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('blocklisted')
      expect(result.violations[0].package).toBe('event-stream')
    })

    it('should block packages matching blocklist patterns', () => {
      const policy = new SecurityPolicy({
        blocklist: ['malicious-*', '@evil/*'],
      })

      expect(policy.check('malicious-package').allowed).toBe(false)
      expect(policy.check('malicious-lib').allowed).toBe(false)
      expect(policy.check('@evil/pkg').allowed).toBe(false)
    })

    it('should prioritize blocklist over allowlist', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash', 'event-stream'], // event-stream accidentally allowed
        blocklist: ['event-stream'], // but explicitly blocked
      })

      expect(policy.check('lodash').allowed).toBe(true)
      expect(policy.check('event-stream').allowed).toBe(false)
    })

    it('should allow packages not on blocklist when no allowlist', () => {
      const policy = new SecurityPolicy({
        blocklist: ['bad-package'],
      })

      expect(policy.check('good-package').allowed).toBe(true)
    })
  })

  describe('License Checking', () => {
    it('should allow packages with approved licenses', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause'],
      })

      const result = policy.checkLicense('lodash', 'MIT')

      expect(result.allowed).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('should reject packages with non-approved licenses', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT', 'Apache-2.0'],
      })

      const result = policy.checkLicense('gpl-package', 'GPL-3.0')

      expect(result.allowed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('license_violation')
      expect(result.violations[0].details).toContain('GPL-3.0')
    })

    it('should allow any license when no license restrictions', () => {
      const policy = new SecurityPolicy({})

      const result = policy.checkLicense('gpl-package', 'GPL-3.0')

      expect(result.allowed).toBe(true)
    })

    it('should handle SPDX expressions', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT', 'Apache-2.0'],
      })

      // MIT OR Apache-2.0 is valid if either is allowed
      expect(policy.checkLicense('dual-licensed', 'MIT OR Apache-2.0').allowed).toBe(true)

      // MIT AND GPL-3.0 requires both
      expect(policy.checkLicense('dual-required', 'MIT AND GPL-3.0').allowed).toBe(false)
    })

    it('should warn for UNLICENSED packages', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT'],
      })

      const result = policy.checkLicense('unlicensed-pkg', 'UNLICENSED')

      expect(result.allowed).toBe(false)
      expect(result.violations[0].type).toBe('license_violation')
    })

    it('should handle missing license gracefully', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT'],
      })

      const result = policy.checkLicense('no-license-pkg', undefined)

      expect(result.allowed).toBe(false)
      expect(result.violations[0].type).toBe('license_violation')
      expect(result.violations[0].details).toContain('unknown')
    })
  })

  describe('Vulnerability Threshold Enforcement', () => {
    it('should allow packages with no vulnerabilities', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'low',
      })

      const result = policy.checkVulnerabilities('safe-pkg', [])

      expect(result.allowed).toBe(true)
    })

    it('should reject packages exceeding vulnerability threshold', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'high', // Allow up to high
      })

      const result = policy.checkVulnerabilities('vuln-pkg', [
        { severity: 'critical', advisory: 'CVE-2021-12345', title: 'Critical RCE' },
      ])

      expect(result.allowed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('vulnerability')
      expect(result.violations[0].severity).toBe('critical')
    })

    it('should allow packages with vulnerabilities below threshold', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'high',
      })

      const result = policy.checkVulnerabilities('pkg', [
        { severity: 'medium', advisory: 'CVE-2021-11111', title: 'Medium issue' },
        { severity: 'low', advisory: 'CVE-2021-22222', title: 'Low issue' },
      ])

      expect(result.allowed).toBe(true)
    })

    it('should use correct severity ordering', () => {
      // critical > high > medium > low
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'medium',
      })

      expect(
        policy.checkVulnerabilities('pkg', [
          { severity: 'low', advisory: 'CVE-1', title: 'Low' },
        ]).allowed
      ).toBe(true)

      expect(
        policy.checkVulnerabilities('pkg', [
          { severity: 'medium', advisory: 'CVE-2', title: 'Medium' },
        ]).allowed
      ).toBe(true)

      expect(
        policy.checkVulnerabilities('pkg', [
          { severity: 'high', advisory: 'CVE-3', title: 'High' },
        ]).allowed
      ).toBe(false)
    })

    it('should report all vulnerabilities exceeding threshold', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'medium',
      })

      const result = policy.checkVulnerabilities('pkg', [
        { severity: 'critical', advisory: 'CVE-1', title: 'Critical' },
        { severity: 'high', advisory: 'CVE-2', title: 'High' },
        { severity: 'medium', advisory: 'CVE-3', title: 'Medium' },
      ])

      // Should report critical and high, but not medium
      expect(result.violations).toHaveLength(2)
      expect(result.violations.map((v) => v.severity)).toContain('critical')
      expect(result.violations.map((v) => v.severity)).toContain('high')
    })
  })

  describe('Package Size Limits', () => {
    it('should allow packages within size limit', () => {
      const policy = new SecurityPolicy({
        maxPackageSize: 10 * 1024 * 1024, // 10 MB
      })

      const result = policy.checkSize('small-pkg', 1024 * 1024) // 1 MB

      expect(result.allowed).toBe(true)
    })

    it('should reject packages exceeding size limit', () => {
      const policy = new SecurityPolicy({
        maxPackageSize: 5 * 1024 * 1024, // 5 MB
      })

      const result = policy.checkSize('huge-pkg', 50 * 1024 * 1024) // 50 MB

      expect(result.allowed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].type).toBe('size_exceeded')
    })

    it('should allow any size when no limit is set', () => {
      const policy = new SecurityPolicy({})

      const result = policy.checkSize('huge-pkg', 100 * 1024 * 1024)

      expect(result.allowed).toBe(true)
    })
  })

  describe('Combined Security Check', () => {
    it('should perform all checks in checkAll()', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash'],
        allowedLicenses: ['MIT'],
        maxVulnerabilitySeverity: 'high',
        maxPackageSize: 10 * 1024 * 1024,
      })

      const result = policy.checkAll('lodash', {
        license: 'MIT',
        vulnerabilities: [],
        size: 1024 * 1024,
      })

      expect(result.allowed).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('should aggregate all violations in checkAll()', () => {
      const policy = new SecurityPolicy({
        blocklist: ['bad-pkg'],
        allowedLicenses: ['MIT'],
        maxVulnerabilitySeverity: 'high',
        maxPackageSize: 1024 * 1024,
      })

      const result = policy.checkAll('bad-pkg', {
        license: 'GPL-3.0',
        vulnerabilities: [{ severity: 'critical', advisory: 'CVE-1', title: 'RCE' }],
        size: 50 * 1024 * 1024,
      })

      expect(result.allowed).toBe(false)
      // Should have multiple violations
      expect(result.violations.length).toBeGreaterThan(1)
      expect(result.violations.map((v) => v.type)).toContain('blocklisted')
      expect(result.violations.map((v) => v.type)).toContain('license_violation')
      expect(result.violations.map((v) => v.type)).toContain('vulnerability')
      expect(result.violations.map((v) => v.type)).toContain('size_exceeded')
    })
  })

  describe('SecurityError Generation', () => {
    it('should generate SecurityError from violations', () => {
      const policy = new SecurityPolicy({
        blocklist: ['malicious-pkg'],
      })

      const result = policy.check('malicious-pkg')
      const error = policy.toSecurityError(result)

      expect(error).toBeInstanceOf(SecurityError)
      expect(error.code).toBe('ESECURITY')
      expect(error.message).toContain('malicious-pkg')
      expect(error.message).toContain('blocklisted')
    })

    it('should include all violations in error message', () => {
      const policy = new SecurityPolicy({
        blocklist: ['pkg'],
        allowedLicenses: ['MIT'],
      })

      const result = policy.checkAll('pkg', {
        license: 'GPL-3.0',
      })

      const error = policy.toSecurityError(result)

      expect(error.message).toContain('blocklisted')
      expect(error.message).toContain('license')
    })

    it('should include severity from vulnerability violations', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'low',
      })

      const result = policy.checkVulnerabilities('pkg', [
        { severity: 'critical', advisory: 'CVE-1', title: 'RCE' },
      ])

      const error = policy.toSecurityError(result)

      expect(error.severity).toBe('critical')
    })

    it('should throw SecurityError via assert()', () => {
      const policy = new SecurityPolicy({
        blocklist: ['blocked-pkg'],
      })

      expect(() => policy.assert('blocked-pkg')).toThrow(SecurityError)
    })

    it('should not throw for allowed packages via assert()', () => {
      const policy = new SecurityPolicy({
        allowlist: ['safe-pkg'],
      })

      expect(() => policy.assert('safe-pkg')).not.toThrow()
    })

    it('should throw via assertAll() with full metadata', () => {
      const policy = new SecurityPolicy({
        allowedLicenses: ['MIT'],
      })

      expect(() =>
        policy.assertAll('pkg', { license: 'GPL-3.0' })
      ).toThrow(SecurityError)
    })
  })

  describe('Per-Agent Configuration', () => {
    it('should support creating policies for different security levels', () => {
      const restrictedPolicy = SecurityPolicy.preset('restricted')
      const standardPolicy = SecurityPolicy.preset('standard')
      const permissivePolicy = SecurityPolicy.preset('permissive')

      // Restricted should be most limiting
      expect(restrictedPolicy.check('random-pkg').allowed).toBe(false)

      // Standard should have common packages allowed
      expect(standardPolicy.check('lodash').allowed).toBe(true)

      // Permissive should allow most things (no allowlist)
      expect(permissivePolicy.check('random-pkg').allowed).toBe(true)
    })

    it('should allow merging policies', () => {
      const basePolicy = new SecurityPolicy({
        blocklist: ['event-stream'],
        allowedLicenses: ['MIT', 'Apache-2.0'],
      })

      const merged = basePolicy.extend({
        blocklist: ['another-bad-pkg'], // Added to existing
        maxPackageSize: 10 * 1024 * 1024, // New constraint
      })

      expect(merged.check('event-stream').allowed).toBe(false)
      expect(merged.check('another-bad-pkg').allowed).toBe(false)
      expect(merged.checkLicense('pkg', 'MIT').allowed).toBe(true)
      expect(merged.checkSize('pkg', 50 * 1024 * 1024).allowed).toBe(false)
    })

    it('should support workspace-level policy inheritance', () => {
      const orgPolicy = new SecurityPolicy({
        blocklist: ['*crypto-miner*'],
        allowedLicenses: ['MIT', 'Apache-2.0', 'ISC'],
      })

      const projectPolicy = orgPolicy.extend({
        allowlist: ['lodash', 'react', 'typescript'],
      })

      // Project policy should inherit org blocklist
      expect(projectPolicy.check('crypto-miner-hidden').allowed).toBe(false)

      // And have its own allowlist
      expect(projectPolicy.check('lodash').allowed).toBe(true)
      expect(projectPolicy.check('random-pkg').allowed).toBe(false)
    })
  })

  describe('Violation Details', () => {
    it('should provide actionable information in violations', () => {
      const policy = new SecurityPolicy({
        blocklist: ['malicious-pkg'],
        allowedLicenses: ['MIT'],
      })

      const result = policy.checkAll('malicious-pkg', { license: 'GPL-3.0' })

      for (const violation of result.violations) {
        expect(violation.package).toBeDefined()
        expect(violation.type).toBeDefined()
        expect(violation.message).toBeDefined()
        // Message should explain what went wrong
        expect(violation.message.length).toBeGreaterThan(10)
      }
    })

    it('should include suggestions for resolution', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash'],
      })

      const result = policy.check('underscore')
      const violation = result.violations[0]

      // Should suggest what to do
      expect(violation.suggestion).toBeDefined()
      expect(violation.suggestion).toContain('allowlist')
    })
  })

  describe('Configuration Validation', () => {
    it('should validate configuration on construction', () => {
      // Invalid severity should throw
      expect(() =>
        new SecurityPolicy({
          maxVulnerabilitySeverity: 'invalid' as VulnerabilitySeverity,
        })
      ).toThrow()
    })

    it('should reject negative maxPackageSize', () => {
      expect(() =>
        new SecurityPolicy({
          maxPackageSize: -1,
        })
      ).toThrow()
    })

    it('should accept empty configuration', () => {
      expect(() => new SecurityPolicy({})).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty package name', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash'],
      })

      const result = policy.check('')

      expect(result.allowed).toBe(false)
    })

    it('should handle package names with special characters', () => {
      const policy = new SecurityPolicy({
        allowlist: ['@babel/core'],
      })

      expect(policy.check('@babel/core').allowed).toBe(true)
    })

    it('should handle very long package names', () => {
      const longName = 'a'.repeat(1000)
      const policy = new SecurityPolicy({
        allowlist: [longName],
      })

      expect(policy.check(longName).allowed).toBe(true)
    })

    it('should be case-sensitive for package names', () => {
      const policy = new SecurityPolicy({
        allowlist: ['lodash'],
      })

      expect(policy.check('lodash').allowed).toBe(true)
      expect(policy.check('Lodash').allowed).toBe(false)
      expect(policy.check('LODASH').allowed).toBe(false)
    })

    it('should handle undefined vulnerabilities array', () => {
      const policy = new SecurityPolicy({
        maxVulnerabilitySeverity: 'low',
      })

      const result = policy.checkVulnerabilities('pkg', undefined as any)

      expect(result.allowed).toBe(true) // No vulnerabilities = safe
    })
  })

  describe('JSON Serialization', () => {
    it('should serialize config to JSON', () => {
      const config: NpmSecurityConfig = {
        allowlist: ['lodash'],
        blocklist: ['bad-pkg'],
        allowedLicenses: ['MIT'],
        maxVulnerabilitySeverity: 'high',
        maxPackageSize: 10 * 1024 * 1024,
      }
      const policy = new SecurityPolicy(config)

      const json = policy.toJSON()
      const parsed = JSON.parse(JSON.stringify(json))

      expect(parsed.allowlist).toEqual(['lodash'])
      expect(parsed.blocklist).toEqual(['bad-pkg'])
    })

    it('should create policy from JSON config', () => {
      const json = {
        allowlist: ['lodash'],
        maxVulnerabilitySeverity: 'high',
      }

      const policy = SecurityPolicy.fromJSON(json)

      expect(policy.check('lodash').allowed).toBe(true)
      expect(policy.check('other').allowed).toBe(false)
    })
  })
})

describe('SecurityCheckResult', () => {
  it('should have required properties', () => {
    const policy = new SecurityPolicy({})
    const result = policy.check('package')

    expect(result).toHaveProperty('allowed')
    expect(result).toHaveProperty('violations')
    expect(result).toHaveProperty('package')
    expect(Array.isArray(result.violations)).toBe(true)
  })
})

describe('SecurityViolation', () => {
  it('should have required properties', () => {
    const policy = new SecurityPolicy({
      blocklist: ['pkg'],
    })
    const result = policy.check('pkg')
    const violation = result.violations[0]

    expect(violation).toHaveProperty('type')
    expect(violation).toHaveProperty('package')
    expect(violation).toHaveProperty('message')
    expect(violation).toHaveProperty('suggestion')
  })
})
