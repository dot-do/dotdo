/**
 * AccessControl - Comprehensive access control system
 */
export * from './types'

import type {
  Principal,
  Resource,
  Action,
  Permission,
  AccessDecision,
  AccessControlOptions,
  Condition,
  Policy,
  Scope,
  BatchAccessRequest,
  BatchAccessResponse,
  EffectivePermissions,
} from './types'

/**
 * ConditionMatcher - Evaluates conditions against context
 */
export class ConditionMatcher {
  /**
   * Evaluate all conditions (AND logic)
   */
  evaluateAll(
    conditions: Condition[],
    principal: Principal,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): boolean {
    for (const condition of conditions) {
      if (!this.evaluate(condition, principal, action, resource, context)) {
        return false
      }
    }
    return true
  }

  /**
   * Evaluate a single condition
   */
  evaluate(
    condition: Condition,
    principal: Principal,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): boolean {
    const actualValue = this.getFieldValue(condition.type, condition.field, principal, action, resource, context)
    const expectedValue = this.resolveValue(condition.value, principal, action, resource, context)

    return this.compareValues(actualValue, condition.operator, expectedValue)
  }

  /**
   * Get the value of a field from the appropriate object
   */
  private getFieldValue(
    type: Condition['type'],
    field: string,
    principal: Principal,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): unknown {
    let target: Record<string, unknown>

    switch (type) {
      case 'principal':
        target = principal as unknown as Record<string, unknown>
        break
      case 'resource':
        target = resource as unknown as Record<string, unknown>
        break
      case 'action':
        target = action as unknown as Record<string, unknown>
        break
      case 'context':
        target = context || {}
        break
      case 'time':
        return this.getTimeValue(field)
      default:
        return undefined
    }

    return this.getNestedValue(target, field)
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Get time-based values
   */
  private getTimeValue(field: string): unknown {
    const now = new Date()
    switch (field) {
      case 'hour':
        return now.getHours()
      case 'dayOfWeek':
        return now.getDay()
      case 'date':
        return now.toISOString().split('T')[0]
      case 'timestamp':
        return now.getTime()
      default:
        return undefined
    }
  }

  /**
   * Resolve template values like ${principal.id}
   */
  private resolveValue(
    value: unknown,
    principal: Principal,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): unknown {
    if (typeof value !== 'string') {
      return value
    }

    // Check for template pattern ${...}
    const templateMatch = value.match(/^\$\{(.+)\}$/)
    if (!templateMatch) {
      return value
    }

    const path = templateMatch[1]
    const [type, ...rest] = path.split('.')
    const field = rest.join('.')

    switch (type) {
      case 'principal':
        return this.getNestedValue(principal as unknown as Record<string, unknown>, field)
      case 'resource':
        return this.getNestedValue(resource as unknown as Record<string, unknown>, field)
      case 'action':
        return this.getNestedValue(action as unknown as Record<string, unknown>, field)
      case 'context':
        return this.getNestedValue(context || {}, field)
      default:
        return value
    }
  }

  /**
   * Compare values using the specified operator
   */
  private compareValues(actual: unknown, operator: Condition['operator'], expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected

      case 'notEquals':
        return actual !== expected

      case 'in':
        if (!Array.isArray(expected)) return false
        return expected.includes(actual)

      case 'notIn':
        if (!Array.isArray(expected)) return true
        return !expected.includes(actual)

      case 'contains':
        if (typeof actual !== 'string') return false
        return actual.includes(String(expected))

      case 'startsWith':
        if (typeof actual !== 'string') return false
        return actual.startsWith(String(expected))

      case 'endsWith':
        if (typeof actual !== 'string') return false
        return actual.endsWith(String(expected))

      case 'greaterThan':
        return Number(actual) > Number(expected)

      case 'lessThan':
        return Number(actual) < Number(expected)

      case 'greaterThanOrEqual':
        return Number(actual) >= Number(expected)

      case 'lessThanOrEqual':
        return Number(actual) <= Number(expected)

      case 'exists':
        return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null

      case 'notExists':
        return expected ? actual === undefined || actual === null : actual !== undefined && actual !== null

      case 'matches':
        if (typeof actual !== 'string' || typeof expected !== 'string') return false
        const regex = new RegExp(expected)
        return regex.test(actual)

      default:
        return false
    }
  }
}

/**
 * DecisionCache - Caches access decisions
 */
interface CacheEntry {
  decision: AccessDecision
  timestamp: number
}

export class DecisionCache {
  private cache: Map<string, CacheEntry> = new Map()
  private ttlMs: number
  private maxSize: number

  constructor(ttlMs: number = 60000, maxSize: number = 1000) {
    this.ttlMs = ttlMs
    this.maxSize = maxSize
  }

  private getCacheKey(principal: Principal, action: Action, resource: Resource, context?: Record<string, unknown>): string {
    return JSON.stringify({ principal, action, resource, context })
  }

  get(principal: Principal, action: Action, resource: Resource, context?: Record<string, unknown>): AccessDecision | null {
    const key = this.getCacheKey(principal, action, resource, context)
    const entry = this.cache.get(key)

    if (!entry) return null

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return null
    }

    return { ...entry.decision, cached: true }
  }

  set(principal: Principal, action: Action, resource: Resource, decision: AccessDecision, context?: Record<string, unknown>): void {
    const key = this.getCacheKey(principal, action, resource, context)

    // Evict oldest if at max size
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      decision,
      timestamp: Date.now(),
    })
  }

  clear(): void {
    this.cache.clear()
  }
}

/**
 * ScopeEnforcer - Enforces multi-tenant scoping
 */
export class ScopeEnforcer {
  private configuredScope?: Scope

  constructor(scope?: Scope) {
    this.configuredScope = scope
  }

  /**
   * Check if request scope matches configured scope
   */
  isInScope(requestScope?: Scope): boolean {
    if (!this.configuredScope) return true
    if (!requestScope) return true

    // Check tenant
    if (this.configuredScope.tenant && requestScope.tenant !== this.configuredScope.tenant) {
      return false
    }

    // Check organization
    if (this.configuredScope.organization && requestScope.organization !== this.configuredScope.organization) {
      return false
    }

    // Check team
    if (this.configuredScope.team && requestScope.team !== this.configuredScope.team) {
      return false
    }

    return true
  }
}

export class AccessControl {
  private permissions: Map<string, Permission[]> = new Map()
  private policies: Policy[] = []
  private options: AccessControlOptions
  private conditionMatcher: ConditionMatcher
  private roleHierarchy: Map<string, string[]> = new Map()
  private decisionCache?: DecisionCache
  private scopeEnforcer: ScopeEnforcer

  constructor(options: AccessControlOptions = {}) {
    this.options = {
      defaultEffect: 'deny',
      ...options,
    }
    this.conditionMatcher = new ConditionMatcher()
    this.scopeEnforcer = new ScopeEnforcer(options.scope)

    if (options.cache?.enabled) {
      this.decisionCache = new DecisionCache(options.cache.ttlMs, options.cache.maxSize)
    }
  }

  /**
   * Register role hierarchy (child inherits from parent)
   */
  registerHierarchy(childRole: string, parentRole: string): void {
    const parents = this.roleHierarchy.get(childRole) || []
    if (!parents.includes(parentRole)) {
      parents.push(parentRole)
    }
    this.roleHierarchy.set(childRole, parents)
  }

  /**
   * Get all roles a principal has (including inherited roles)
   */
  private getEffectiveRoles(principal: Principal): string[] {
    const roles = new Set<string>()

    if (principal.roles) {
      for (const role of principal.roles) {
        roles.add(role)
        this.collectParentRoles(role, roles)
      }
    }

    return Array.from(roles)
  }

  /**
   * Recursively collect parent roles
   */
  private collectParentRoles(role: string, collected: Set<string>): void {
    const parents = this.roleHierarchy.get(role) || []
    for (const parent of parents) {
      if (!collected.has(parent)) {
        collected.add(parent)
        this.collectParentRoles(parent, collected)
      }
    }
  }

  /**
   * Get all permissions for a principal (including inherited)
   */
  private getAllPermissions(principal: Principal): Permission[] {
    const allPermissions: Permission[] = []

    // Direct permissions
    const directKey = this.getPrincipalKey(principal)
    const directPerms = this.permissions.get(directKey) || []
    allPermissions.push(...directPerms)

    // Role permissions (including inherited roles)
    const effectiveRoles = this.getEffectiveRoles(principal)
    for (const roleId of effectiveRoles) {
      const roleKey = `role:${roleId}`
      const rolePerms = this.permissions.get(roleKey) || []
      allPermissions.push(...rolePerms)
    }

    // Group permissions
    if (principal.groups) {
      for (const groupId of principal.groups) {
        const groupKey = `group:${groupId}`
        const groupPerms = this.permissions.get(groupKey) || []
        allPermissions.push(...groupPerms)
      }
    }

    return allPermissions
  }

  /**
   * Check if a principal can perform an action on a resource
   */
  check(principal: Principal, action: Action, resource: Resource, context?: Record<string, unknown>): AccessDecision {
    // Check scope first
    const requestScope = (context as { scope?: Scope })?.scope
    if (!this.scopeEnforcer.isInScope(requestScope)) {
      return {
        allowed: false,
        reason: 'Outside configured scope',
        matchedPolicies: [],
        evaluatedAt: new Date(),
      }
    }

    // Check cache
    if (this.decisionCache) {
      const cached = this.decisionCache.get(principal, action, resource, context)
      if (cached) return cached
    }

    const decision = this.performCheck(principal, action, resource, context)

    // Store in cache
    if (this.decisionCache) {
      this.decisionCache.set(principal, action, resource, decision, context)
    }

    return decision
  }

  private performCheck(principal: Principal, action: Action, resource: Resource, context?: Record<string, unknown>): AccessDecision {
    const allPermissions = this.getAllPermissions(principal)
    const resourcePattern = `${resource.type}:${resource.id}`

    // Sort policies by priority (highest first)
    const sortedPolicies = [...this.policies].sort((a, b) => b.priority - a.priority)
    const matchedPolicies: string[] = []

    // Evaluate policies first (they have priority)
    for (const policy of sortedPolicies) {
      // Check if principal matches (if principals are specified)
      if (policy.principals && policy.principals.length > 0) {
        const principalPattern = `${principal.type}:${principal.id}`
        const principalMatches = policy.principals.some((p) => this.matchPattern(p, principalPattern))
        if (!principalMatches) continue
      }

      // Check resource and action match
      if (
        this.matchesResource(policy.resources, resourcePattern) &&
        this.matchesAction(policy.actions, action.name) &&
        this.evaluateConditions(policy.conditions, principal, action, resource, context)
      ) {
        matchedPolicies.push(policy.id)

        if (policy.effect === 'deny') {
          return {
            allowed: false,
            reason: 'Policy denied',
            matchedPolicies,
            evaluatedAt: new Date(),
          }
        }

        if (policy.effect === 'allow') {
          return {
            allowed: true,
            reason: 'Policy allowed',
            matchedPolicies,
            evaluatedAt: new Date(),
          }
        }
      }
    }

    // Check for explicit deny first (direct permissions take priority)
    const directKey = this.getPrincipalKey(principal)
    const directPerms = this.permissions.get(directKey) || []
    for (const perm of directPerms) {
      if (perm.effect === 'deny') {
        if (
          this.matchesResource(perm.resources, resourcePattern) &&
          this.matchesAction(perm.actions, action.name) &&
          this.evaluateConditions(perm.conditions, principal, action, resource, context)
        ) {
          return {
            allowed: false,
            reason: 'Permission explicitly denied',
            matchedPolicies,
            evaluatedAt: new Date(),
          }
        }
      }
    }

    // Check all permissions (including inherited) for deny
    for (const perm of allPermissions) {
      if (perm.effect === 'deny') {
        if (
          this.matchesResource(perm.resources, resourcePattern) &&
          this.matchesAction(perm.actions, action.name) &&
          this.evaluateConditions(perm.conditions, principal, action, resource, context)
        ) {
          return {
            allowed: false,
            reason: 'Permission explicitly denied',
            matchedPolicies,
            evaluatedAt: new Date(),
          }
        }
      }
    }

    // Check for allow (all permissions including inherited)
    for (const perm of allPermissions) {
      if (perm.effect === 'allow') {
        if (
          this.matchesResource(perm.resources, resourcePattern) &&
          this.matchesAction(perm.actions, action.name) &&
          this.evaluateConditions(perm.conditions, principal, action, resource, context)
        ) {
          return {
            allowed: true,
            reason: 'Permission granted',
            matchedPolicies,
            evaluatedAt: new Date(),
          }
        }
      }
    }

    return {
      allowed: false,
      reason: 'No matching policy found',
      matchedPolicies,
      evaluatedAt: new Date(),
    }
  }

  /**
   * Batch check multiple access requests
   */
  checkBatch(batch: BatchAccessRequest): BatchAccessResponse {
    const results: AccessDecision[] = []

    for (const request of batch.requests) {
      const decision = this.check(request.principal, request.action, request.resource, request.context)
      results.push(decision)
    }

    return { results }
  }

  /**
   * Get effective permissions for a principal
   */
  getEffectivePermissions(principal: Principal): EffectivePermissions {
    const directKey = this.getPrincipalKey(principal)
    const directPerms = this.permissions.get(directKey) || []

    const inheritedFrom: EffectivePermissions['inheritedFrom'] = []

    // Role permissions
    const effectiveRoles = this.getEffectiveRoles(principal)
    for (const roleId of effectiveRoles) {
      const roleKey = `role:${roleId}`
      const rolePerms = this.permissions.get(roleKey) || []
      if (rolePerms.length > 0) {
        inheritedFrom.push({
          source: 'role',
          id: roleId,
          permissions: rolePerms,
        })
      }
    }

    // Group permissions
    if (principal.groups) {
      for (const groupId of principal.groups) {
        const groupKey = `group:${groupId}`
        const groupPerms = this.permissions.get(groupKey) || []
        if (groupPerms.length > 0) {
          inheritedFrom.push({
            source: 'group',
            id: groupId,
            permissions: groupPerms,
          })
        }
      }
    }

    // Collect all permissions
    const allPermissions = [...directPerms]
    for (const inherited of inheritedFrom) {
      allPermissions.push(...inherited.permissions)
    }

    return {
      principal,
      permissions: allPermissions,
      inheritedFrom,
    }
  }

  /**
   * Clear the decision cache
   */
  clearCache(): void {
    if (this.decisionCache) {
      this.decisionCache.clear()
    }
  }

  /**
   * Add a policy to the system
   */
  addPolicy(policy: Policy): void {
    this.policies = this.policies.filter((p) => p.id !== policy.id)
    this.policies.push(policy)
  }

  /**
   * Remove a policy by id
   */
  removePolicy(policyId: string): void {
    this.policies = this.policies.filter((p) => p.id !== policyId)
  }

  /**
   * Get a policy by id
   */
  getPolicy(policyId: string): Policy | undefined {
    return this.policies.find((p) => p.id === policyId)
  }

  /**
   * Grant a permission to a principal
   */
  grant(principal: Principal, permission: Permission): void {
    const key = this.getPrincipalKey(principal)
    const existing = this.permissions.get(key) || []
    existing.push(permission)
    this.permissions.set(key, existing)
  }

  /**
   * Revoke a permission from a principal
   */
  revoke(principal: Principal, permission: Permission): void {
    const key = this.getPrincipalKey(principal)
    const existing = this.permissions.get(key) || []
    const filtered = existing.filter(
      (p) =>
        !(
          p.effect === permission.effect &&
          JSON.stringify(p.resources) === JSON.stringify(permission.resources) &&
          JSON.stringify(p.actions) === JSON.stringify(permission.actions)
        )
    )
    this.permissions.set(key, filtered)
  }

  private getPrincipalKey(principal: Principal): string {
    return `${principal.type}:${principal.id}`
  }

  private matchesResource(patterns: string[], resource: string): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(pattern, resource)) return true
    }
    return false
  }

  private matchPattern(pattern: string, value: string): boolean {
    if (pattern === value) return true
    if (pattern === '*') return true

    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      const regex = new RegExp(`^${regexPattern}$`)
      return regex.test(value)
    }

    return false
  }

  private matchesAction(patterns: string[], action: string): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(pattern, action)) return true
    }
    return false
  }

  private evaluateConditions(
    conditions: Condition[] | undefined,
    principal: Principal,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): boolean {
    if (!conditions || conditions.length === 0) {
      return true
    }
    return this.conditionMatcher.evaluateAll(conditions, principal, action, resource, context)
  }
}
