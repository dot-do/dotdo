/**
 * AccessControl Types
 * Comprehensive type definitions for the access control system
 */

/**
 * Principal - The entity requesting access (user, service, role)
 */
export interface Principal {
  id: string
  type: 'user' | 'service' | 'role' | 'group'
  attributes?: Record<string, unknown>
  roles?: string[]
  groups?: string[]
}

/**
 * Resource - The object being accessed
 */
export interface Resource {
  type: string
  id: string
  owner?: string
  attributes?: Record<string, unknown>
}

/**
 * Action - The operation being performed
 */
export interface Action {
  name: string
  parameters?: Record<string, unknown>
}

/**
 * Condition operators for policy evaluation
 */
export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'exists'
  | 'notExists'
  | 'matches' // regex

/**
 * Condition - A single condition to evaluate
 */
export interface Condition {
  type: 'principal' | 'resource' | 'action' | 'context' | 'time'
  field: string
  operator: ConditionOperator
  value: unknown
}

/**
 * Permission - A single permission grant
 */
export interface Permission {
  effect: 'allow' | 'deny'
  resources: string[] // Resource patterns (e.g., "document:*", "project:123")
  actions: string[] // Action patterns (e.g., "read", "write", "*")
  conditions?: Condition[]
}

/**
 * Policy - A named policy with conditions and priority
 */
export interface Policy {
  id: string
  name?: string
  description?: string
  effect: 'allow' | 'deny'
  principals?: string[] // Principal patterns
  resources: string[] // Resource patterns
  actions: string[] // Action patterns
  conditions?: Condition[]
  priority: number // Higher priority evaluated first
}

/**
 * AccessDecision - The result of an access check
 */
export interface AccessDecision {
  allowed: boolean
  reason: string
  matchedPolicies: string[]
  evaluatedAt: Date
  cached?: boolean
}

/**
 * Scope - Multi-tenant scoping context
 */
export interface Scope {
  tenant?: string
  organization?: string
  team?: string
}

/**
 * AccessRequest - A request for access check
 */
export interface AccessRequest {
  principal: Principal
  action: Action
  resource: Resource
  context?: Record<string, unknown>
  scope?: Scope
}

/**
 * BatchAccessRequest - Multiple access requests
 */
export interface BatchAccessRequest {
  requests: AccessRequest[]
}

/**
 * BatchAccessResponse - Results for batch requests
 */
export interface BatchAccessResponse {
  results: AccessDecision[]
}

/**
 * EffectivePermissions - All permissions for a principal
 */
export interface EffectivePermissions {
  principal: Principal
  permissions: Permission[]
  inheritedFrom: Array<{
    source: 'role' | 'group' | 'policy'
    id: string
    permissions: Permission[]
  }>
}

/**
 * CacheOptions - Configuration for decision caching
 */
export interface CacheOptions {
  enabled: boolean
  ttlMs: number
  maxSize: number
}

/**
 * AccessControlOptions - Configuration options
 */
export interface AccessControlOptions {
  defaultEffect?: 'allow' | 'deny'
  cache?: CacheOptions
  scope?: Scope
}

/**
 * PrincipalHierarchy - Define parent-child relationships
 */
export interface PrincipalHierarchy {
  parentId: string
  childId: string
  type: 'role' | 'group'
}
