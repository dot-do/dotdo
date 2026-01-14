/**
 * Role Types and Interfaces
 *
 * Core type definitions for the agent role system with hierarchical
 * permission inheritance.
 *
 * @see dotdo-eahcx - Agent Roles epic
 * @module agents/roles/types
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Role identifier - a unique string identifying a role
 */
export type RoleId = string

/**
 * Capability identifier - a unique string identifying a capability
 */
export type CapabilityId = string

/**
 * Permission level for capabilities
 */
export type PermissionLevel = 'none' | 'read' | 'write' | 'admin'

/**
 * Permission scope for limiting capability access
 */
export interface PermissionScope {
  /** Resource type this scope applies to */
  resourceType?: string
  /** Specific resource IDs this scope applies to */
  resourceIds?: string[]
  /** Namespace/tenant restriction */
  namespace?: string
}

/**
 * A single capability with its permission configuration
 */
export interface Capability {
  /** Unique capability identifier */
  id: CapabilityId
  /** Human-readable name */
  name: string
  /** Description of what this capability allows */
  description: string
  /** Category for grouping capabilities */
  category: CapabilityCategory
  /** Default permission level */
  defaultLevel: PermissionLevel
  /** Whether this capability can be delegated to sub-roles */
  delegable: boolean
  /** Dependencies on other capabilities */
  requires?: CapabilityId[]
}

/**
 * Capability categories for organization
 */
export type CapabilityCategory =
  | 'code'      // Code-related: read, write, execute
  | 'data'      // Data access: read, write, delete
  | 'comms'     // Communications: email, slack, etc.
  | 'finance'   // Financial: transactions, reports
  | 'admin'     // Administrative: users, settings
  | 'ai'        // AI operations: model calls, embeddings
  | 'tools'     // Tool execution: bash, git, etc.
  | 'workflow'  // Workflow: approvals, escalations

/**
 * Capability assignment to a role with specific permissions
 */
export interface CapabilityAssignment {
  /** The capability being assigned */
  capabilityId: CapabilityId
  /** Permission level for this assignment */
  level: PermissionLevel
  /** Optional scope restrictions */
  scope?: PermissionScope
  /** Can this assignment be inherited by child roles? */
  inheritable: boolean
}

// ============================================================================
// Role Definition
// ============================================================================

/**
 * OKR (Objective and Key Result) for a role
 */
export interface OKR {
  /** Objective description */
  objective: string
  /** Key results that measure success */
  keyResults: string[]
  /** Target metrics if applicable */
  metrics?: Record<string, number | string>
}

/**
 * Role configuration for defining a role
 */
export interface RoleConfig {
  /** Unique role identifier */
  id: RoleId
  /** Human-readable name */
  name: string
  /** Role description */
  description: string
  /** Parent role for inheritance (null for root roles) */
  parent?: RoleId
  /** OKRs this role is responsible for */
  okrs: OKR[]
  /** Capability assignments for this role */
  capabilities: CapabilityAssignment[]
  /** System instructions for AI agents with this role */
  instructions: string
  /** Default model for this role */
  model?: string
  /** Default operation mode */
  mode?: 'autonomous' | 'supervised' | 'interactive' | 'batch'
  /** Tags for categorization */
  tags?: string[]
}

/**
 * A fully resolved role with inherited capabilities
 */
export interface Role extends RoleConfig {
  /** All capabilities including inherited ones */
  resolvedCapabilities: Map<CapabilityId, CapabilityAssignment>
  /** Parent role chain (for debugging/introspection) */
  inheritanceChain: RoleId[]
  /** Depth in the role hierarchy (0 for root roles) */
  depth: number
}

// ============================================================================
// Role Registry Types
// ============================================================================

/**
 * Query options for listing roles
 */
export interface RoleQueryOptions {
  /** Filter by parent role */
  parent?: RoleId | null
  /** Filter by tag */
  tag?: string
  /** Filter by capability */
  hasCapability?: CapabilityId
  /** Include only roles at this depth */
  depth?: number
  /** Include descendant roles */
  includeDescendants?: boolean
}

/**
 * Result of a capability check
 */
export interface CapabilityCheckResult {
  /** Whether the capability is allowed */
  allowed: boolean
  /** The effective permission level */
  level: PermissionLevel
  /** The role that granted this capability */
  grantedBy: RoleId
  /** Any scope restrictions */
  scope?: PermissionScope
  /** Reason if denied */
  reason?: string
}

/**
 * Role hierarchy statistics
 */
export interface RoleHierarchyStats {
  /** Total number of roles */
  totalRoles: number
  /** Number of root roles (no parent) */
  rootRoles: number
  /** Maximum depth of hierarchy */
  maxDepth: number
  /** Number of roles at each depth */
  rolesByDepth: Record<number, number>
  /** Total capabilities defined */
  totalCapabilities: number
  /** Capabilities per category */
  capabilitiesByCategory: Record<CapabilityCategory, number>
}
