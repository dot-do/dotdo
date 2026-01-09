/**
 * Auth Bridge Module
 *
 * Re-exports all auth bridge types and utilities for Payload CMS integration.
 *
 * @module @dotdo/payload/auth
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Role types
  BetterAuthRole,
  PayloadAccessLevel,
  // User types
  BetterAuthUser,
  PayloadUser,
  // Mapping types
  RoleMapping,
  BetterAuthToPayloadUser,
  // Config types
  AuthBridgeConfig,
  // Session types
  SessionData,
  SessionValidationResult,
  // API key types
  ApiKeyData,
  ApiKeyValidationResult,
} from './types'

// ============================================================================
// Extraction Utilities
// ============================================================================

export {
  extractSessionFromCookie,
  extractBearerToken,
  extractApiKey,
  extractCredentials,
} from './extraction'

export type { ExtractedCredentials } from './extraction'

// ============================================================================
// Session Validation
// ============================================================================

export { validateSession } from './session'

export type {
  SessionDatabase,
  SessionWithUser,
  ValidateSessionOptions,
} from './session'

// ============================================================================
// Role Mapping
// ============================================================================

export {
  mapRoleToAccess,
  getEffectiveRole,
  generateAccessLevels,
  createAccessControl,
} from './roles'

export type {
  AccessPermission,
  AccessLevels,
  OrganizationRole,
  UserContext,
  CollectionAccessConfig,
  PayloadUserWithRole,
  PayloadAccessFunction,
  PayloadAccessControl,
  CreateAccessControlConfig,
} from './roles'
