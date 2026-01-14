/**
 * Permission Engine Types
 * Comprehensive type definitions for the authorization system
 */

/**
 * Actions that can be performed on resources
 */
export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage' | '*'

/**
 * Comparison operators for conditions
 */
export type ConditionOperator =
  | 'eq' // equals
  | 'neq' // not equals
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'in' // in array
  | 'nin' // not in array
  | 'contains' // string/array contains
  | 'startsWith' // string starts with
  | 'endsWith' // string ends with
  | 'matches' // regex match
  | 'exists' // field exists
  | 'isOwner' // subject is resource owner

/**
 * A condition for permission evaluation
 */
export interface Condition {
  /** Field to evaluate (supports dot notation for nested fields) */
  field: string
  /** Comparison operator */
  operator: ConditionOperator
  /** Value to compare against */
  value: unknown
}

/**
 * Effect of a policy - allow or deny
 */
export type PolicyEffect = 'allow' | 'deny'

/**
 * A permission definition
 */
export interface Permission {
  /** Resource type this permission applies to (supports wildcards) */
  resource: string
  /** Actions allowed/denied (supports wildcards) */
  actions: Action[]
  /** Optional conditions that must be met */
  conditions?: Condition[]
}

/**
 * A role that can be assigned to subjects
 */
export interface Role {
  /** Unique role identifier */
  name: string
  /** Human-readable description */
  description?: string
  /** Permissions granted by this role */
  permissions: Permission[]
  /** Other roles this role inherits from */
  inherits?: string[]
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * A policy for attribute-based access control
 */
export interface Policy {
  /** Unique policy identifier */
  id: string
  /** Human-readable name */
  name?: string
  /** Description of the policy's purpose */
  description?: string
  /** Whether this policy allows or denies access */
  effect: PolicyEffect
  /** Resource types this policy applies to (supports wildcards) */
  resources: string[]
  /** Actions this policy applies to */
  actions: Action[]
  /** Conditions that must be met for this policy to apply */
  conditions?: Condition[]
  /** Priority (lower number = higher priority, for conflict resolution) */
  priority?: number
  /** Whether the policy is active */
  enabled?: boolean
}

/**
 * A subject (user, service, etc.) that can perform actions
 */
export interface Subject {
  /** Unique identifier */
  id: string
  /** Type of subject (user, service, api-key, etc.) */
  type: string
  /** Roles assigned to this subject */
  roles: string[]
  /** Attributes for ABAC evaluation */
  attributes: Record<string, unknown>
}

/**
 * A resource that can be accessed
 */
export interface Resource {
  /** Resource type (e.g., 'document', 'project', 'user') */
  type: string
  /** Unique identifier */
  id: string
  /** Owner of the resource (subject id) */
  owner?: string
  /** Attributes for ABAC evaluation */
  attributes: Record<string, unknown>
}

/**
 * Result of an authorization check
 */
export interface AuthorizationResult {
  /** Whether access is allowed */
  allowed: boolean
  /** Reason for the decision */
  reason: AuthorizationReason
  /** The policy that determined the result (if applicable) */
  matchedPolicy?: Policy
  /** The permission that determined the result (if applicable) */
  matchedPermission?: Permission
  /** The role that granted access (if applicable) */
  matchedRole?: string
  /** Additional context about the decision */
  context?: Record<string, unknown>
}

/**
 * Reasons for authorization decisions
 */
export type AuthorizationReason =
  | 'ALLOWED_BY_PERMISSION' // Permission explicitly allows
  | 'ALLOWED_BY_POLICY' // Policy explicitly allows
  | 'ALLOWED_BY_OWNERSHIP' // Subject owns the resource
  | 'ALLOWED_BY_WILDCARD' // Wildcard permission allows
  | 'DENIED_BY_POLICY' // Policy explicitly denies
  | 'DENIED_NO_PERMISSION' // No permission grants access
  | 'DENIED_CONDITION_FAILED' // Permission exists but conditions not met
  | 'DENIED_BY_DEFAULT' // Default deny (no matching rules)
  | 'SUBJECT_NOT_FOUND' // Subject doesn't exist
  | 'RESOURCE_NOT_FOUND' // Resource doesn't exist
  | 'ROLE_NOT_FOUND' // Role doesn't exist

/**
 * Authorization context for evaluation
 */
export interface AuthorizationContext {
  /** The subject requesting access */
  subject: Subject
  /** The action being performed */
  action: Action
  /** The resource being accessed */
  resource: Resource
  /** Additional context (environment, time, etc.) */
  environment?: Record<string, unknown>
}

/**
 * Audit log entry for authorization decisions
 */
export interface AuditLogEntry {
  /** Unique identifier */
  id: string
  /** Timestamp of the decision */
  timestamp: string
  /** Subject that requested access */
  subject: Subject
  /** Action requested */
  action: Action
  /** Resource accessed */
  resource: Resource
  /** Result of the authorization */
  result: AuthorizationResult
  /** Request metadata */
  metadata?: Record<string, unknown>
}

/**
 * Cache entry for permission decisions
 */
export interface CacheEntry {
  /** The cached result */
  result: AuthorizationResult
  /** When the entry was created */
  createdAt: number
  /** When the entry expires */
  expiresAt: number
}

/**
 * Configuration for the PermissionEngine
 */
export interface PermissionEngineConfig {
  /** Roles to initialize with */
  roles?: Role[]
  /** Policies to initialize with */
  policies?: Policy[]
  /** Default effect when no rules match (default: 'deny') */
  defaultEffect?: PolicyEffect
  /** Enable permission caching */
  enableCache?: boolean
  /** Cache TTL in milliseconds */
  cacheTtl?: number
  /** Enable audit logging */
  enableAudit?: boolean
  /** Custom audit logger */
  auditLogger?: AuditLogger
}

/**
 * Interface for audit logging
 */
export interface AuditLogger {
  log(entry: AuditLogEntry): void | Promise<void>
}

/**
 * Event emitted during authorization
 */
export interface AuthorizationEvent {
  type: 'check' | 'grant' | 'revoke' | 'assign' | 'remove'
  timestamp: string
  subject?: Subject
  action?: Action
  resource?: Resource
  result?: AuthorizationResult
  role?: string
  permission?: Permission
}

/**
 * Listener for authorization events
 */
export type AuthorizationEventListener = (event: AuthorizationEvent) => void
