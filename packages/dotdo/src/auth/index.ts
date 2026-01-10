/**
 * Auth module - Authentication and authorization configuration for dotdo
 *
 * Provides default secure configurations and utilities for managing
 * method-level authentication requirements.
 */

export {
  DEFAULT_AUTH_CONFIG,
  mergeAuthConfig,
  matchAuthPattern,
  getMethodAuth,
  type MethodAuthConfig,
  type Role,
  type AuditLevel,
  type AuthConfig,
} from './defaults'
