/**
 * Auth Bridge Types
 *
 * Type definitions that bridge Better Auth's authentication model
 * to Payload CMS's expected auth interface.
 *
 * These types enable seamless authentication between:
 * - Better Auth (session management, user storage)
 * - Payload CMS (authenticate() callback, access control)
 */

// ============================================================================
// Better Auth Role Types
// ============================================================================

/**
 * Union type for Better Auth user roles.
 * Matches the role field in db/auth.ts users table.
 */
export type BetterAuthRole = 'user' | 'admin' | 'owner'

// ============================================================================
// Payload Access Level Types
// ============================================================================

/**
 * Payload access level type.
 * String type to support custom access levels beyond standard ones.
 * Common levels: 'viewer', 'editor', 'admin'
 */
export type PayloadAccessLevel = string

// ============================================================================
// Better Auth User Type
// ============================================================================

/**
 * User type from Better Auth sessions table.
 * Matches the shape from db/auth.ts users table.
 */
export interface BetterAuthUser {
  /** Unique user identifier */
  id: string
  /** User's display name */
  name: string
  /** User's email address */
  email: string
  /** Whether the email has been verified */
  emailVerified: boolean
  /** User role: 'user', 'admin', or 'owner' */
  role: BetterAuthRole | null
  /** URL to user's avatar image */
  image: string | null
  /** Whether the user is banned */
  banned: boolean
  /** Reason for ban if banned */
  banReason: string | null
  /** When the user was created */
  createdAt: Date
  /** When the user was last updated */
  updatedAt: Date
}

// ============================================================================
// Payload User Type
// ============================================================================

/**
 * User type expected by Payload CMS's authenticate() callback.
 * This is the minimal shape Payload needs to identify a user.
 */
export interface PayloadUser {
  /** Unique user identifier */
  id: string
  /** User's email (optional for service accounts) */
  email?: string
  /** Which Payload collection this user belongs to */
  collection: string
}

// ============================================================================
// Role Mapping Type
// ============================================================================

/**
 * Maps Better Auth roles to Payload access levels.
 * Enables customizable role translation between systems.
 */
export interface RoleMapping {
  /** Access level for 'user' role */
  user: PayloadAccessLevel
  /** Access level for 'admin' role */
  admin: PayloadAccessLevel
  /** Access level for 'owner' role */
  owner: PayloadAccessLevel
  /** Index signature for BetterAuthRole lookup */
  [key: string]: PayloadAccessLevel
}

// ============================================================================
// User Mapping Function Type
// ============================================================================

/**
 * Function type that maps a Better Auth user to Payload user format.
 * Optionally accepts config for role mapping and collection name.
 */
export type BetterAuthToPayloadUser = (
  user: BetterAuthUser,
  config?: AuthBridgeConfig,
) => PayloadUser

// ============================================================================
// Auth Bridge Configuration
// ============================================================================

/**
 * Configuration options for the auth bridge.
 */
export interface AuthBridgeConfig {
  /** Which Payload collection holds user documents (default: 'users') */
  usersCollection: string
  /** Cookie name for Better Auth session token */
  sessionCookieName: string
  /** Header name for API key authentication */
  apiKeyHeader: string
  /** Optional custom role mapping */
  roleMapping?: RoleMapping
  /** Whether to auto-create Payload users from Better Auth sessions */
  autoCreateUsers?: boolean
  /** Custom function to map Better Auth user to Payload user */
  userMapper?: BetterAuthToPayloadUser
}

// ============================================================================
// Session Data Type
// ============================================================================

/**
 * Session data returned when validating a Better Auth session.
 */
export interface SessionData {
  /** Session identifier */
  id: string
  /** Session token */
  token: string
  /** When the session expires */
  expiresAt: Date
  /** User ID associated with this session */
  userId: string
}

// ============================================================================
// Session Validation Result
// ============================================================================

/**
 * Result of validating a Better Auth session.
 * Uses discriminated union for type-safe success/failure handling.
 */
export type SessionValidationResult =
  | {
      /** Session is valid */
      valid: true
      /** The authenticated user */
      user: BetterAuthUser
      /** Session information */
      session: SessionData
    }
  | {
      /** Session is invalid */
      valid: false
      /** Error message explaining why validation failed */
      error: string
    }

// ============================================================================
// API Key Data Type
// ============================================================================

/**
 * API key metadata returned when validating an API key.
 */
export interface ApiKeyData {
  /** API key identifier */
  id: string
  /** Human-readable name for the API key */
  name: string
  /** User ID that owns this API key */
  userId: string
  /** Permissions granted to this API key */
  permissions: string[]
  /** When the API key expires (null = never) */
  expiresAt: Date | null
}

// ============================================================================
// API Key Validation Result
// ============================================================================

/**
 * Result of validating an API key.
 * Uses discriminated union for type-safe success/failure handling.
 */
export type ApiKeyValidationResult =
  | {
      /** API key is valid */
      valid: true
      /** The user associated with this API key */
      user: BetterAuthUser
      /** API key metadata */
      apiKey: ApiKeyData
    }
  | {
      /** API key is invalid */
      valid: false
      /** Error message explaining why validation failed */
      error: string
      /** Seconds until rate limit resets (for rate limit errors) */
      retryAfter?: number
    }
