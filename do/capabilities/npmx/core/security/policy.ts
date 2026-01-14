/**
 * Security Policy for AI Agent Package Installation
 *
 * Provides allowlist/blocklist enforcement, license checking,
 * vulnerability threshold enforcement, and package size limits.
 *
 * Prevents AI agents from installing malicious or unauthorized packages.
 *
 * @module npmx/core/security/policy
 */

import { SecurityError } from '../errors/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Vulnerability severity levels (ordered from most to least severe)
 */
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low'

/**
 * Configuration for npm security policy
 */
export interface NpmSecurityConfig {
  /** Packages explicitly allowed (supports wildcards like @types/*) */
  allowlist?: string[]
  /** Packages explicitly blocked (supports wildcards) */
  blocklist?: string[]
  /** SPDX license identifiers that are allowed */
  allowedLicenses?: string[]
  /** Maximum allowed vulnerability severity */
  maxVulnerabilitySeverity?: VulnerabilitySeverity
  /** Maximum allowed package size in bytes */
  maxPackageSize?: number
}

/**
 * Information about a vulnerability
 */
export interface VulnerabilityInfo {
  severity: VulnerabilitySeverity
  advisory: string
  title: string
}

/**
 * Types of security violations
 */
export type ViolationType =
  | 'not_in_allowlist'
  | 'blocklisted'
  | 'license_violation'
  | 'vulnerability'
  | 'size_exceeded'

/**
 * Details about a security violation
 */
export interface SecurityViolation {
  type: ViolationType
  package: string
  message: string
  suggestion: string
  details?: string
  severity?: VulnerabilitySeverity
}

/**
 * Result of a security check
 */
export interface SecurityCheckResult {
  allowed: boolean
  package: string
  violations: SecurityViolation[]
}

/**
 * Package metadata for full security check
 */
export interface PackageSecurityMetadata {
  license?: string
  vulnerabilities?: VulnerabilityInfo[]
  size?: number
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Severity ordering (lower number = more severe)
 */
const SEVERITY_ORDER: Record<VulnerabilitySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/**
 * Valid severity values for validation
 */
const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low'])

/**
 * Default allowlist for standard preset
 */
const STANDARD_ALLOWLIST = [
  // Common utility libraries
  'lodash',
  'lodash-es',
  'underscore',
  'ramda',
  // React ecosystem
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  '@tanstack/*',
  // Type definitions
  '@types/*',
  // Build tools
  'typescript',
  'vite',
  'vitest',
  'esbuild',
  'rollup',
  // Testing
  'jest',
  '@jest/*',
  // Node.js utilities
  'zod',
  'yup',
  'dayjs',
  'date-fns',
  'uuid',
  'nanoid',
]

/**
 * Default blocklist for known malicious packages
 */
const DEFAULT_BLOCKLIST = [
  'event-stream', // Compromised in 2018
  'flatmap-stream', // Malicious dependency
  'ua-parser-js', // Compromised versions
  'coa', // Compromised versions
  'rc', // Compromised versions
]

// =============================================================================
// SecurityPolicy Class
// =============================================================================

/**
 * Security policy for package installation
 *
 * Enforces allowlist/blocklist, license requirements,
 * vulnerability thresholds, and size limits.
 */
export class SecurityPolicy {
  private readonly config: NpmSecurityConfig
  private readonly allowlistPatterns: RegExp[]
  private readonly blocklistPatterns: RegExp[]

  constructor(config: NpmSecurityConfig) {
    this.validateConfig(config)
    this.config = config
    this.allowlistPatterns = this.compilePatterns(config.allowlist ?? [])
    this.blocklistPatterns = this.compilePatterns(config.blocklist ?? [])
  }

  // ===========================================================================
  // Configuration Validation
  // ===========================================================================

  /**
   * Validate configuration values
   */
  private validateConfig(config: NpmSecurityConfig): void {
    if (
      config.maxVulnerabilitySeverity !== undefined &&
      !VALID_SEVERITIES.has(config.maxVulnerabilitySeverity)
    ) {
      throw new Error(
        `Invalid maxVulnerabilitySeverity: ${config.maxVulnerabilitySeverity}. ` +
          `Must be one of: critical, high, medium, low`
      )
    }

    if (config.maxPackageSize !== undefined && config.maxPackageSize < 0) {
      throw new Error(`maxPackageSize cannot be negative: ${config.maxPackageSize}`)
    }
  }

  /**
   * Compile glob-like patterns to RegExp
   */
  private compilePatterns(patterns: string[]): RegExp[] {
    return patterns.map((pattern) => {
      // Escape special regex characters except *
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      // Convert * to .* for glob-style matching
      const regex = escaped.replace(/\*/g, '.*')
      return new RegExp(`^${regex}$`)
    })
  }

  /**
   * Check if a package matches any pattern in a list
   */
  private matchesPattern(packageName: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(packageName))
  }

  // ===========================================================================
  // Basic Checks
  // ===========================================================================

  /**
   * Check if a package is allowed by allowlist/blocklist rules
   */
  check(packageName: string): SecurityCheckResult {
    const violations: SecurityViolation[] = []

    // Empty package name is never allowed
    if (!packageName) {
      violations.push({
        type: 'not_in_allowlist',
        package: packageName,
        message: 'Empty package name is not allowed',
        suggestion: 'Provide a valid package name',
      })
      return { allowed: false, package: packageName, violations }
    }

    // Blocklist always takes priority
    if (this.matchesPattern(packageName, this.blocklistPatterns)) {
      violations.push({
        type: 'blocklisted',
        package: packageName,
        message: `Package '${packageName}' is blocklisted`,
        suggestion:
          'This package has been explicitly blocked. Contact your administrator to request removal from the blocklist.',
      })
      return { allowed: false, package: packageName, violations }
    }

    // If allowlist is configured (even if empty), package must be in it
    // An empty allowlist means NO packages are allowed
    if (this.config.allowlist !== undefined) {
      if (!this.matchesPattern(packageName, this.allowlistPatterns)) {
        violations.push({
          type: 'not_in_allowlist',
          package: packageName,
          message: `Package '${packageName}' is not in the allowlist`,
          suggestion:
            'Add this package to the allowlist in your security policy configuration.',
        })
        return { allowed: false, package: packageName, violations }
      }
    }

    return { allowed: true, package: packageName, violations }
  }

  /**
   * Check if a package's license is allowed
   */
  checkLicense(packageName: string, license: string | undefined): SecurityCheckResult {
    const violations: SecurityViolation[] = []

    // If no license restrictions, allow everything
    if (!this.config.allowedLicenses || this.config.allowedLicenses.length === 0) {
      return { allowed: true, package: packageName, violations }
    }

    // Handle missing license
    if (license === undefined || license === null) {
      violations.push({
        type: 'license_violation',
        package: packageName,
        message: `Package '${packageName}' has unknown license`,
        suggestion:
          'Check the package for license information or add it to an approved exception list.',
        details: 'License: unknown',
      })
      return { allowed: false, package: packageName, violations }
    }

    // Handle UNLICENSED
    if (license === 'UNLICENSED') {
      violations.push({
        type: 'license_violation',
        package: packageName,
        message: `Package '${packageName}' is UNLICENSED`,
        suggestion: 'Contact the package author about licensing or find an alternative.',
        details: 'License: UNLICENSED',
      })
      return { allowed: false, package: packageName, violations }
    }

    // Parse SPDX expression
    const allowed = this.checkSpdxLicense(license)

    if (!allowed) {
      violations.push({
        type: 'license_violation',
        package: packageName,
        message: `Package '${packageName}' has disallowed license: ${license}`,
        suggestion: `Update allowedLicenses to include '${license}' or find an alternative package.`,
        details: `License: ${license}`,
      })
      return { allowed: false, package: packageName, violations }
    }

    return { allowed: true, package: packageName, violations }
  }

  /**
   * Check SPDX license expression against allowed licenses
   */
  private checkSpdxLicense(license: string): boolean {
    const allowed = this.config.allowedLicenses!

    // Handle OR expressions (either license is acceptable)
    if (license.includes(' OR ')) {
      const parts = license.split(' OR ').map((l) => l.trim())
      return parts.some((l) => allowed.includes(l))
    }

    // Handle AND expressions (both licenses must be allowed)
    if (license.includes(' AND ')) {
      const parts = license.split(' AND ').map((l) => l.trim())
      return parts.every((l) => allowed.includes(l))
    }

    // Simple license check
    return allowed.includes(license)
  }

  /**
   * Check if vulnerabilities exceed threshold
   */
  checkVulnerabilities(
    packageName: string,
    vulnerabilities: VulnerabilityInfo[] | undefined
  ): SecurityCheckResult {
    const violations: SecurityViolation[] = []

    // If no threshold or no vulnerabilities, allow
    if (!this.config.maxVulnerabilitySeverity || !vulnerabilities || vulnerabilities.length === 0) {
      return { allowed: true, package: packageName, violations }
    }

    const maxAllowedSeverity = SEVERITY_ORDER[this.config.maxVulnerabilitySeverity]

    for (const vuln of vulnerabilities) {
      const vulnSeverity = SEVERITY_ORDER[vuln.severity]

      // If vulnerability is more severe than allowed (lower number = more severe)
      if (vulnSeverity < maxAllowedSeverity) {
        violations.push({
          type: 'vulnerability',
          package: packageName,
          message: `Package '${packageName}' has ${vuln.severity} vulnerability: ${vuln.title}`,
          suggestion: `Update to a patched version or find an alternative. Advisory: ${vuln.advisory}`,
          details: `${vuln.advisory}: ${vuln.title}`,
          severity: vuln.severity,
        })
      }
    }

    return {
      allowed: violations.length === 0,
      package: packageName,
      violations,
    }
  }

  /**
   * Check if package size is within limits
   */
  checkSize(packageName: string, sizeBytes: number): SecurityCheckResult {
    const violations: SecurityViolation[] = []

    // If no size limit, allow any size
    if (!this.config.maxPackageSize) {
      return { allowed: true, package: packageName, violations }
    }

    if (sizeBytes > this.config.maxPackageSize) {
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2)
      const limitMB = (this.config.maxPackageSize / 1024 / 1024).toFixed(2)

      violations.push({
        type: 'size_exceeded',
        package: packageName,
        message: `Package '${packageName}' exceeds size limit: ${sizeMB}MB > ${limitMB}MB`,
        suggestion: 'Increase maxPackageSize limit or find a smaller alternative.',
        details: `Size: ${sizeMB}MB, Limit: ${limitMB}MB`,
      })
    }

    return {
      allowed: violations.length === 0,
      package: packageName,
      violations,
    }
  }

  // ===========================================================================
  // Combined Checks
  // ===========================================================================

  /**
   * Perform all security checks on a package
   */
  checkAll(packageName: string, metadata: PackageSecurityMetadata = {}): SecurityCheckResult {
    const allViolations: SecurityViolation[] = []

    // Basic allowlist/blocklist check
    const basicResult = this.check(packageName)
    allViolations.push(...basicResult.violations)

    // License check
    if (metadata.license !== undefined || this.config.allowedLicenses) {
      const licenseResult = this.checkLicense(packageName, metadata.license)
      allViolations.push(...licenseResult.violations)
    }

    // Vulnerability check
    const vulnResult = this.checkVulnerabilities(packageName, metadata.vulnerabilities)
    allViolations.push(...vulnResult.violations)

    // Size check
    if (metadata.size !== undefined) {
      const sizeResult = this.checkSize(packageName, metadata.size)
      allViolations.push(...sizeResult.violations)
    }

    return {
      allowed: allViolations.length === 0,
      package: packageName,
      violations: allViolations,
    }
  }

  // ===========================================================================
  // Error Generation
  // ===========================================================================

  /**
   * Convert check result to SecurityError
   */
  toSecurityError(result: SecurityCheckResult): SecurityError {
    const violationMessages = result.violations.map((v) => v.message).join('; ')
    const message = `Security policy violation for '${result.package}': ${violationMessages}`

    // Find the highest severity from violations
    let severity: VulnerabilitySeverity | undefined
    for (const v of result.violations) {
      if (v.severity) {
        if (!severity || SEVERITY_ORDER[v.severity] < SEVERITY_ORDER[severity]) {
          severity = v.severity
        }
      }
    }

    return new SecurityError(message, {
      package: result.package,
      severity,
    })
  }

  /**
   * Assert that a package passes basic security check, throw if not
   */
  assert(packageName: string): void {
    const result = this.check(packageName)
    if (!result.allowed) {
      throw this.toSecurityError(result)
    }
  }

  /**
   * Assert that a package passes all security checks, throw if not
   */
  assertAll(packageName: string, metadata: PackageSecurityMetadata = {}): void {
    const result = this.checkAll(packageName, metadata)
    if (!result.allowed) {
      throw this.toSecurityError(result)
    }
  }

  // ===========================================================================
  // Policy Presets and Extension
  // ===========================================================================

  /**
   * Create a policy from a preset
   */
  static preset(name: 'restricted' | 'standard' | 'permissive'): SecurityPolicy {
    switch (name) {
      case 'restricted':
        return new SecurityPolicy({
          allowlist: [], // Nothing allowed by default
          blocklist: DEFAULT_BLOCKLIST,
          allowedLicenses: ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause'],
          maxVulnerabilitySeverity: 'low',
          maxPackageSize: 5 * 1024 * 1024, // 5 MB
        })

      case 'standard':
        return new SecurityPolicy({
          allowlist: STANDARD_ALLOWLIST,
          blocklist: DEFAULT_BLOCKLIST,
          allowedLicenses: [
            'MIT',
            'Apache-2.0',
            'ISC',
            'BSD-2-Clause',
            'BSD-3-Clause',
            'CC0-1.0',
            '0BSD',
          ],
          maxVulnerabilitySeverity: 'high',
          maxPackageSize: 50 * 1024 * 1024, // 50 MB
        })

      case 'permissive':
        return new SecurityPolicy({
          // No allowlist = all packages allowed
          blocklist: DEFAULT_BLOCKLIST,
          // No license restrictions
          maxVulnerabilitySeverity: 'critical',
          // Large size limit
          maxPackageSize: 200 * 1024 * 1024, // 200 MB
        })

      default:
        throw new Error(`Unknown preset: ${name}`)
    }
  }

  /**
   * Create a new policy by extending this one with additional constraints
   */
  extend(additional: NpmSecurityConfig): SecurityPolicy {
    return new SecurityPolicy({
      // Merge allowlists
      allowlist: this.config.allowlist
        ? additional.allowlist
          ? [...this.config.allowlist, ...additional.allowlist]
          : this.config.allowlist
        : additional.allowlist,

      // Merge blocklists (always additive)
      blocklist: [
        ...(this.config.blocklist ?? []),
        ...(additional.blocklist ?? []),
      ],

      // Inherit or override licenses
      allowedLicenses: additional.allowedLicenses ?? this.config.allowedLicenses,

      // Use more restrictive vulnerability setting
      maxVulnerabilitySeverity:
        additional.maxVulnerabilitySeverity ?? this.config.maxVulnerabilitySeverity,

      // Use smaller size limit
      maxPackageSize: additional.maxPackageSize ?? this.config.maxPackageSize,
    })
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize policy configuration to JSON-serializable object
   */
  toJSON(): NpmSecurityConfig {
    return { ...this.config }
  }

  /**
   * Create a policy from JSON configuration
   */
  static fromJSON(json: NpmSecurityConfig): SecurityPolicy {
    return new SecurityPolicy(json)
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export type {
  NpmSecurityConfig as SecurityConfig,
}
