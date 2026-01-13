/**
 * Permission Type Definitions
 *
 * Defines the Permission Thing interface for graph-based permission enforcement.
 * Permissions are stored as Things in the graph and linked to Tools via 'requires'
 * relationships and to Executors via 'hasPermission' relationships.
 *
 * @module types/Permission
 *
 * @example
 * ```typescript
 * // Create a permission
 * const permission: PermissionThingData = {
 *   type: 'read',
 *   resource: 'email',
 *   scope: 'organization',
 * }
 *
 * // Custom permission for specific operations
 * const customPermission: PermissionThingData = {
 *   type: 'custom',
 *   name: 'approve-large-refunds',
 * }
 * ```
 */

// ============================================================================
// PERMISSION TYPES
// ============================================================================

/**
 * Permission type enumeration.
 *
 * - `read`: Permission to read/view a resource
 * - `write`: Permission to create/update a resource
 * - `execute`: Permission to execute an action on a resource
 * - `admin`: Full administrative access to a resource
 * - `custom`: Custom permission with a specific name
 */
export type PermissionType = 'read' | 'write' | 'execute' | 'admin' | 'custom'

/**
 * Permission scope determines the boundary of the permission.
 *
 * - `user`: Permission applies only to the user's own resources
 * - `organization`: Permission applies to all resources within the organization
 * - `global`: Permission applies to all resources (admin-level)
 */
export type PermissionScope = 'user' | 'organization' | 'global'

/**
 * Data stored in a Permission Thing.
 *
 * Permissions define what actions can be taken on resources.
 * They are linked to Tools via 'requires' relationships and
 * granted to Executors via 'hasPermission' relationships.
 */
export interface PermissionThingData {
  /**
   * Type of permission (read, write, execute, admin, custom).
   */
  type: PermissionType

  /**
   * Resource this permission applies to (e.g., 'email', 'payment', 'customer').
   * Optional for custom permissions that may span resources.
   */
  resource?: string

  /**
   * Scope of the permission (user, organization, global).
   * Defaults to 'user' if not specified.
   */
  scope?: PermissionScope

  /**
   * Custom permission name (only used when type is 'custom').
   * Example: 'approve-large-refunds', 'manage-api-keys'
   */
  name?: string

  /**
   * Human-readable description of the permission.
   */
  description?: string
}

// ============================================================================
// SECURITY LEVELS
// ============================================================================

/**
 * Security level for tools and executors.
 *
 * Security levels form a hierarchy from least to most privileged:
 * - `public`: No authentication required
 * - `internal`: Requires authenticated user/agent
 * - `confidential`: Requires elevated trust level
 * - `restricted`: Requires highest security clearance
 *
 * An executor can only access tools with equal or lower security level.
 */
export type SecurityLevel = 'public' | 'internal' | 'confidential' | 'restricted'

/**
 * Ordered array of security levels from lowest to highest.
 */
export const SECURITY_LEVELS: SecurityLevel[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
]

/**
 * Get the numeric index of a security level (0 = lowest, 3 = highest).
 */
export function getSecurityLevelIndex(level: SecurityLevel): number {
  return SECURITY_LEVELS.indexOf(level)
}

/**
 * Check if an executor security level can access a tool security level.
 */
export function canAccessSecurityLevel(
  executorLevel: SecurityLevel,
  toolLevel: SecurityLevel
): boolean {
  return getSecurityLevelIndex(executorLevel) >= getSecurityLevelIndex(toolLevel)
}

// ============================================================================
// TOOL TYPES (for permission context)
// ============================================================================

/**
 * Data stored in a Tool Thing.
 *
 * Tools have security levels and may require permissions.
 * Permission requirements are expressed as graph relationships.
 */
export interface ToolThingData {
  /**
   * Name of the tool (e.g., 'sendEmail', 'processPayment').
   */
  name: string

  /**
   * Description of what the tool does.
   */
  description?: string

  /**
   * Security level required to access this tool.
   * Defaults to 'internal' if not specified.
   */
  securityLevel?: SecurityLevel

  /**
   * JSON Schema for tool input validation (optional).
   */
  inputSchema?: Record<string, unknown>

  /**
   * Whether the tool can be interrupted during execution.
   */
  interruptible?: boolean
}

// ============================================================================
// EXECUTOR TYPES (for permission context)
// ============================================================================

/**
 * Data stored in an Executor Thing (agent/user).
 *
 * Executors have security levels and granted permissions.
 * Permissions are expressed as graph relationships.
 */
export interface ExecutorThingData {
  /**
   * Name of the executor (e.g., 'CustomerServiceAgent', 'admin@example.com').
   */
  name: string

  /**
   * Security level of the executor.
   * Defaults to 'public' if not specified.
   */
  securityLevel?: SecurityLevel

  /**
   * Type of executor (agent, user, service).
   */
  executorType?: 'agent' | 'user' | 'service'
}
