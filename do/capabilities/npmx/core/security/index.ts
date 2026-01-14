/**
 * Security module for npm operations
 *
 * Provides policy-based security controls for AI agent package installation.
 *
 * @module npmx/core/security
 */

export {
  SecurityPolicy,
  type NpmSecurityConfig,
  type SecurityCheckResult,
  type SecurityViolation,
  type VulnerabilitySeverity,
  type ViolationType,
  type VulnerabilityInfo,
  type PackageSecurityMetadata,
} from './policy.js'
