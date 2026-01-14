/**
 * MetricsAccessControl - Fine-grained access control for SemanticLayer
 *
 * Provides comprehensive access control including:
 * - Cube-level access (who can query which cubes)
 * - Measure-level access (hide sensitive metrics)
 * - Dimension-level access (restrict grouping options)
 * - Row-level security (tenant isolation, data masking)
 * - Column-level security (PII redaction)
 * - Role-based access control integration
 * - Query-time security context injection
 *
 * @see dotdo-jaiwu
 */

import {
  SemanticLayer,
  type SemanticQuery,
  type QueryResult,
  type SchemaMeta,
  type CubeMeta,
  InvalidQueryError,
} from './index'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Error thrown when access to a metric resource is denied
 */
export class MetricsAccessDeniedError extends Error {
  public readonly deniedMeasure?: string
  public readonly deniedDimension?: string
  public readonly deniedCube?: string
  public readonly denialType: 'cube' | 'measure' | 'dimension' | 'row' | 'column'
  public readonly userId: string
  public readonly roles: string[]

  constructor(options: {
    message: string
    denialType: 'cube' | 'measure' | 'dimension' | 'row' | 'column'
    userId: string
    roles: string[]
    deniedMeasure?: string
    deniedDimension?: string
    deniedCube?: string
  }) {
    super(options.message)
    this.name = 'MetricsAccessDeniedError'
    this.denialType = options.denialType
    this.userId = options.userId
    this.roles = options.roles
    this.deniedMeasure = options.deniedMeasure
    this.deniedDimension = options.deniedDimension
    this.deniedCube = options.deniedCube
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Security context passed with each query
 */
export interface SecurityContext {
  user: {
    id: string
    roles: string[]
    tenantId?: string
    region?: string
    managedRegions?: string[]
    attributes?: Record<string, unknown>
  }
  requestId?: string
}

/**
 * Row filter function type
 */
export type RowFilter = (ctx: SecurityContext) => string

/**
 * Column mask function type
 */
export type ColumnMask = (value: unknown) => string

/**
 * Allow/Deny specification
 */
export interface AllowDeny {
  allow?: string[]
  deny?: string[]
}

/**
 * Context injection configuration
 */
export interface ContextInjection {
  variables?: Record<string, (ctx: SecurityContext) => unknown>
}

/**
 * Access rule for metrics
 */
export interface MetricsAccessRule {
  id?: string
  role: string
  inherits?: string[]
  cubes?: AllowDeny
  measures?: AllowDeny
  measuresByCube?: Record<string, AllowDeny>
  dimensions?: AllowDeny
  dimensionsByCube?: Record<string, AllowDeny>
  rowFilter?: RowFilter
  columnMasks?: Record<string, ColumnMask>
  columnMasksSql?: Record<string, string>
  excludeColumns?: string[]
  presets?: string[]
  condition?: (ctx: SecurityContext) => boolean
  contextInjection?: ContextInjection
}

/**
 * Preset definition for reusable rule sets
 */
export interface RulePreset {
  dimensions?: AllowDeny
  measures?: AllowDeny
  columnMasks?: Record<string, ColumnMask>
  columnMasksSql?: Record<string, string>
  excludeColumns?: string[]
  rowFilter?: RowFilter
}

/**
 * Extended query result with security metadata
 */
export interface SecureQueryResult extends QueryResult {
  maskedColumns?: string[]
  securityContext?: {
    currentUserId?: string
    currentTenant?: string
    [key: string]: unknown
  }
  requestId?: string
}

/**
 * Role validator function
 */
export type RoleValidator = (role: string, ctx: SecurityContext) => boolean

/**
 * Query callback for audit logging
 */
export type QueryCallback = (query: SemanticQuery, ctx: SecurityContext) => void

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sanitize a string value to prevent SQL injection
 */
function sanitizeSqlValue(value: string): string {
  // Check for common SQL injection patterns
  const dangerousPatterns = [
    /['";]/,  // Quote characters
    /--/,      // SQL comment
    /\/\*/,    // Block comment start
    /\*\//,    // Block comment end
    /\bOR\b/i, // OR keyword
    /\bAND\b/i && /[=<>]/, // AND with comparison
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bEXEC\b/i,
    /\bUNION\b/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(value)) {
      throw new Error(`Invalid value detected: potential SQL injection attempt`)
    }
  }

  return value
}

/**
 * Check if a value matches a pattern (supports * wildcard)
 */
function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (pattern === value) return true

  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(value)
  }

  return false
}

/**
 * Check if a value is in an allow/deny list
 */
function isAllowed(value: string, allowDeny?: AllowDeny): boolean {
  if (!allowDeny) return true

  // Check deny first
  if (allowDeny.deny) {
    for (const pattern of allowDeny.deny) {
      if (matchesPattern(pattern, value)) {
        return false
      }
    }
  }

  // Check allow
  if (allowDeny.allow) {
    for (const pattern of allowDeny.allow) {
      if (matchesPattern(pattern, value)) {
        return true
      }
    }
    return false // If allow list exists but no match, deny
  }

  return true // No allow list means allow all (unless denied)
}

/**
 * Parse a reference like "cube.member" into parts
 */
function parseRef(ref: string): { cubeName: string; memberName: string } {
  const parts = ref.split('.')
  if (parts.length !== 2) {
    throw new InvalidQueryError(`Invalid reference format: ${ref}. Expected 'cube.member'`)
  }
  return { cubeName: parts[0]!, memberName: parts[1]! }
}

// =============================================================================
// METRICS ACCESS CONTROL CLASS
// =============================================================================

/**
 * MetricsAccessControl - Main class for access control on SemanticLayer
 */
export class MetricsAccessControl {
  private semantic: SemanticLayer
  private rules: Map<string, MetricsAccessRule> = new Map()
  private presets: Map<string, RulePreset> = new Map()
  private roleValidator?: RoleValidator
  private queryCallbacks: QueryCallback[] = []
  private ruleIdCounter = 0

  constructor(semantic: SemanticLayer) {
    this.semantic = semantic
  }

  // ===========================================================================
  // RULE MANAGEMENT
  // ===========================================================================

  /**
   * Add an access rule
   */
  addRule(rule: MetricsAccessRule): void {
    const id = rule.id || `rule-${++this.ruleIdCounter}`
    this.rules.set(id, { ...rule, id })
  }

  /**
   * Remove a rule by ID
   */
  removeRule(id: string): void {
    this.rules.delete(id)
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): MetricsAccessRule | undefined {
    return this.rules.get(id)
  }

  /**
   * Update an existing rule
   */
  updateRule(id: string, updates: Partial<MetricsAccessRule>): void {
    const existing = this.rules.get(id)
    if (existing) {
      this.rules.set(id, { ...existing, ...updates })
    }
  }

  /**
   * List all rules, optionally filtered by role
   */
  listRules(filter?: { role?: string }): MetricsAccessRule[] {
    const all = Array.from(this.rules.values())
    if (filter?.role) {
      return all.filter((r) => r.role === filter.role)
    }
    return all
  }

  /**
   * Define a reusable preset
   */
  definePreset(name: string, preset: RulePreset): void {
    this.presets.set(name, preset)
  }

  /**
   * Set the role validator function
   */
  setRoleValidator(validator: RoleValidator): void {
    this.roleValidator = validator
  }

  /**
   * Register a query callback for audit logging
   */
  onQuery(callback: QueryCallback): void {
    this.queryCallbacks.push(callback)
  }

  // ===========================================================================
  // ACCESS CHECK METHODS
  // ===========================================================================

  /**
   * Get effective rules for a security context
   */
  private getEffectiveRules(ctx: SecurityContext): MetricsAccessRule[] {
    const effectiveRules: MetricsAccessRule[] = []
    const validRoles = new Set<string>()

    // Validate roles if validator is set
    for (const role of ctx.user.roles) {
      if (this.roleValidator) {
        if (this.roleValidator(role, ctx)) {
          validRoles.add(role)
        }
      } else {
        validRoles.add(role)
      }
    }

    // Collect rules for valid roles
    for (const rule of this.rules.values()) {
      if (!validRoles.has(rule.role)) continue

      // Check condition if present
      if (rule.condition && !rule.condition(ctx)) continue

      effectiveRules.push(rule)
    }

    // Resolve inheritance
    const resolvedRules = this.resolveInheritance(effectiveRules)

    // Apply presets
    return this.applyPresets(resolvedRules)
  }

  /**
   * Resolve role inheritance in rules
   */
  private resolveInheritance(rules: MetricsAccessRule[]): MetricsAccessRule[] {
    const rulesByRole = new Map<string, MetricsAccessRule[]>()

    // Group rules by role
    for (const rule of rules) {
      const existing = rulesByRole.get(rule.role) || []
      existing.push(rule)
      rulesByRole.set(rule.role, existing)
    }

    // Resolve inheritance for each rule
    const resolved: MetricsAccessRule[] = []

    for (const rule of rules) {
      const mergedRule = { ...rule }

      if (rule.inherits) {
        for (const parentRole of rule.inherits) {
          const parentRules = rulesByRole.get(parentRole) || []
          for (const parentRule of parentRules) {
            // Merge parent permissions into this rule
            mergedRule.cubes = this.mergeAllowDeny(parentRule.cubes, mergedRule.cubes)
            mergedRule.measures = this.mergeAllowDeny(parentRule.measures, mergedRule.measures)
            mergedRule.dimensions = this.mergeAllowDeny(parentRule.dimensions, mergedRule.dimensions)
          }
        }
      }

      resolved.push(mergedRule)
    }

    return resolved
  }

  /**
   * Merge two AllowDeny objects
   */
  private mergeAllowDeny(parent?: AllowDeny, child?: AllowDeny): AllowDeny | undefined {
    if (!parent && !child) return undefined

    const merged: AllowDeny = {}

    // Merge allow lists
    const allowSet = new Set<string>()
    if (parent?.allow) parent.allow.forEach((a) => allowSet.add(a))
    if (child?.allow) child.allow.forEach((a) => allowSet.add(a))
    if (allowSet.size > 0) merged.allow = Array.from(allowSet)

    // Merge deny lists
    const denySet = new Set<string>()
    if (parent?.deny) parent.deny.forEach((d) => denySet.add(d))
    if (child?.deny) child.deny.forEach((d) => denySet.add(d))
    if (denySet.size > 0) merged.deny = Array.from(denySet)

    return merged
  }

  /**
   * Apply presets to rules
   */
  private applyPresets(rules: MetricsAccessRule[]): MetricsAccessRule[] {
    return rules.map((rule) => {
      if (!rule.presets || rule.presets.length === 0) return rule

      const merged = { ...rule }

      for (const presetName of rule.presets) {
        const preset = this.presets.get(presetName)
        if (!preset) continue

        merged.dimensions = this.mergeAllowDeny(preset.dimensions, merged.dimensions)
        merged.measures = this.mergeAllowDeny(preset.measures, merged.measures)

        if (preset.columnMasks) {
          merged.columnMasks = { ...preset.columnMasks, ...merged.columnMasks }
        }
        if (preset.columnMasksSql) {
          merged.columnMasksSql = { ...preset.columnMasksSql, ...merged.columnMasksSql }
        }
        if (preset.excludeColumns) {
          merged.excludeColumns = [
            ...(merged.excludeColumns || []),
            ...preset.excludeColumns,
          ]
        }
        if (preset.rowFilter && !merged.rowFilter) {
          merged.rowFilter = preset.rowFilter
        }
      }

      return merged
    })
  }

  /**
   * Check cube access
   */
  private checkCubeAccess(
    cubeName: string,
    rules: MetricsAccessRule[],
    ctx: SecurityContext
  ): void {
    let hasAccess = false

    for (const rule of rules) {
      if (rule.cubes && isAllowed(cubeName, rule.cubes)) {
        hasAccess = true
        break
      }
    }

    if (!hasAccess) {
      throw new MetricsAccessDeniedError({
        message: `Access denied to cube '${cubeName}'`,
        denialType: 'cube',
        userId: ctx.user.id,
        roles: ctx.user.roles,
        deniedCube: cubeName,
      })
    }
  }

  /**
   * Check measure access
   */
  private checkMeasureAccess(
    cubeName: string,
    measureName: string,
    rules: MetricsAccessRule[],
    ctx: SecurityContext
  ): void {
    const fullName = `${cubeName}.${measureName}`

    for (const rule of rules) {
      // Check cube-specific measures first
      if (rule.measuresByCube?.[cubeName]) {
        if (!isAllowed(measureName, rule.measuresByCube[cubeName])) {
          throw new MetricsAccessDeniedError({
            message: `Access denied to measure '${fullName}'`,
            denialType: 'measure',
            userId: ctx.user.id,
            roles: ctx.user.roles,
            deniedMeasure: fullName,
          })
        }
        return // Found cube-specific rule, it takes precedence
      }

      // Check global measures
      if (rule.measures) {
        if (!isAllowed(measureName, rule.measures)) {
          throw new MetricsAccessDeniedError({
            message: `Access denied to measure '${fullName}'`,
            denialType: 'measure',
            userId: ctx.user.id,
            roles: ctx.user.roles,
            deniedMeasure: fullName,
          })
        }
        return
      }
    }

    // If no rules define measures, check if we have any rule that allows this cube
    const hasCubeAccess = rules.some((r) => r.cubes && isAllowed(cubeName, r.cubes))
    if (!hasCubeAccess) {
      throw new MetricsAccessDeniedError({
        message: `Access denied to measure '${fullName}'`,
        denialType: 'measure',
        userId: ctx.user.id,
        roles: ctx.user.roles,
        deniedMeasure: fullName,
      })
    }
  }

  /**
   * Check dimension access
   */
  private checkDimensionAccess(
    cubeName: string,
    dimensionName: string,
    rules: MetricsAccessRule[],
    ctx: SecurityContext
  ): void {
    const fullName = `${cubeName}.${dimensionName}`

    for (const rule of rules) {
      // Check excluded columns
      if (rule.excludeColumns?.includes(dimensionName)) {
        throw new MetricsAccessDeniedError({
          message: `Access denied to dimension '${fullName}'`,
          denialType: 'dimension',
          userId: ctx.user.id,
          roles: ctx.user.roles,
          deniedDimension: fullName,
        })
      }

      // Check cube-specific dimensions first
      if (rule.dimensionsByCube?.[cubeName]) {
        if (!isAllowed(dimensionName, rule.dimensionsByCube[cubeName])) {
          throw new MetricsAccessDeniedError({
            message: `Access denied to dimension '${fullName}'`,
            denialType: 'dimension',
            userId: ctx.user.id,
            roles: ctx.user.roles,
            deniedDimension: fullName,
          })
        }
        return
      }

      // Check global dimensions
      if (rule.dimensions) {
        if (!isAllowed(dimensionName, rule.dimensions)) {
          throw new MetricsAccessDeniedError({
            message: `Access denied to dimension '${fullName}'`,
            denialType: 'dimension',
            userId: ctx.user.id,
            roles: ctx.user.roles,
            deniedDimension: fullName,
          })
        }
        return
      }
    }
  }

  /**
   * Collect row filters from rules
   */
  private collectRowFilters(rules: MetricsAccessRule[], ctx: SecurityContext): string[] {
    const filters: string[] = []

    for (const rule of rules) {
      if (rule.rowFilter) {
        const filterSql = rule.rowFilter(ctx)

        // Validate the generated SQL to prevent injection
        // Check for any values that might have been interpolated
        if (ctx.user.tenantId) {
          sanitizeSqlValue(ctx.user.tenantId)
        }
        if (ctx.user.region) {
          sanitizeSqlValue(ctx.user.region)
        }
        if (ctx.user.managedRegions) {
          for (const region of ctx.user.managedRegions) {
            sanitizeSqlValue(region)
          }
        }

        filters.push(filterSql)
      }
    }

    return filters
  }

  /**
   * Collect column masks from rules
   */
  private collectColumnMasks(
    rules: MetricsAccessRule[]
  ): {
    masks: Record<string, ColumnMask>
    sqlMasks: Record<string, string>
  } {
    const masks: Record<string, ColumnMask> = {}
    const sqlMasks: Record<string, string> = {}

    for (const rule of rules) {
      if (rule.columnMasks) {
        Object.assign(masks, rule.columnMasks)
      }
      if (rule.columnMasksSql) {
        Object.assign(sqlMasks, rule.columnMasksSql)
      }
    }

    return { masks, sqlMasks }
  }

  /**
   * Build security context for result
   */
  private buildSecurityContext(
    rules: MetricsAccessRule[],
    ctx: SecurityContext
  ): Record<string, unknown> {
    const securityContext: Record<string, unknown> = {
      currentUserId: ctx.user.id,
    }

    if (ctx.user.tenantId) {
      securityContext.currentTenant = ctx.user.tenantId
    }

    for (const rule of rules) {
      if (rule.contextInjection?.variables) {
        for (const [key, fn] of Object.entries(rule.contextInjection.variables)) {
          securityContext[key] = fn(ctx)
        }
      }
    }

    return securityContext
  }

  // ===========================================================================
  // QUERY EXECUTION
  // ===========================================================================

  /**
   * Execute a query with access control
   */
  async query(query: SemanticQuery, ctx: SecurityContext): Promise<SecureQueryResult> {
    // Validate security context
    if (!ctx?.user?.id || !ctx.user.roles) {
      throw new Error('Invalid security context: missing user id or roles')
    }

    // Get effective rules for this user
    const effectiveRules = this.getEffectiveRules(ctx)

    if (effectiveRules.length === 0) {
      throw new MetricsAccessDeniedError({
        message: 'No access rules match the current user',
        denialType: 'cube',
        userId: ctx.user.id,
        roles: ctx.user.roles,
      })
    }

    // Track cubes accessed in this query
    const cubesAccessed = new Set<string>()

    // Check measure access
    if (query.measures) {
      for (const measureRef of query.measures) {
        const { cubeName, memberName } = parseRef(measureRef)
        cubesAccessed.add(cubeName)
        this.checkCubeAccess(cubeName, effectiveRules, ctx)
        this.checkMeasureAccess(cubeName, memberName, effectiveRules, ctx)
      }
    }

    // Check dimension access
    if (query.dimensions) {
      for (const dimRef of query.dimensions) {
        const { cubeName, memberName } = parseRef(dimRef)
        cubesAccessed.add(cubeName)
        this.checkCubeAccess(cubeName, effectiveRules, ctx)
        this.checkDimensionAccess(cubeName, memberName, effectiveRules, ctx)
      }
    }

    // Check time dimension access
    if (query.timeDimensions) {
      for (const td of query.timeDimensions) {
        const { cubeName, memberName } = parseRef(td.dimension)
        cubesAccessed.add(cubeName)
        this.checkCubeAccess(cubeName, effectiveRules, ctx)
        this.checkDimensionAccess(cubeName, memberName, effectiveRules, ctx)
      }
    }

    // Check filter access
    if (query.filters) {
      for (const filter of query.filters) {
        const { cubeName, memberName } = parseRef(filter.dimension)
        cubesAccessed.add(cubeName)
        this.checkCubeAccess(cubeName, effectiveRules, ctx)
        this.checkDimensionAccess(cubeName, memberName, effectiveRules, ctx)
      }
    }

    // Collect row filters
    const rowFilters = this.collectRowFilters(effectiveRules, ctx)

    // Collect column masks
    const { masks, sqlMasks } = this.collectColumnMasks(effectiveRules)

    // Modify query to include row filters
    const securedQuery = this.applyRowFilters(query, rowFilters)

    // Apply SQL column masks
    const maskedQuery = this.applySqlColumnMasks(securedQuery, sqlMasks)

    // Notify callbacks
    for (const callback of this.queryCallbacks) {
      callback(maskedQuery, ctx)
    }

    // Execute the query
    const result = await this.semantic.query(maskedQuery)

    // Build the secure result
    const secureResult: SecureQueryResult = {
      ...result,
      requestId: ctx.requestId,
    }

    // Add masked columns info
    const maskedColumnNames = [
      ...Object.keys(masks),
      ...Object.keys(sqlMasks),
    ]
    if (maskedColumnNames.length > 0) {
      secureResult.maskedColumns = maskedColumnNames
    }

    // Build security context
    const securityContext = this.buildSecurityContext(effectiveRules, ctx)
    if (Object.keys(securityContext).length > 0) {
      secureResult.securityContext = securityContext
    }

    return secureResult
  }

  /**
   * Apply row filters to a query
   */
  private applyRowFilters(query: SemanticQuery, rowFilters: string[]): SemanticQuery {
    if (rowFilters.length === 0) return query

    const modified = { ...query }

    // Find the primary cube from the query
    let primaryCube: string | undefined
    if (query.measures?.[0]) {
      primaryCube = parseRef(query.measures[0]).cubeName
    } else if (query.dimensions?.[0]) {
      primaryCube = parseRef(query.dimensions[0]).cubeName
    } else if (query.timeDimensions?.[0]) {
      primaryCube = parseRef(query.timeDimensions[0].dimension).cubeName
    }

    if (!primaryCube) return query

    // Convert row filters to query filters
    // Note: This is a simplified approach. In a real implementation,
    // the row filters would be injected directly into the SQL generation
    // For now, we'll add them as special filters that the SQL generator handles
    const existingFilters = modified.filters || []

    // Add security filters - these will be handled specially by the SQL generator
    // In this implementation, we prepend them to the WHERE clause
    modified._securityFilters = rowFilters

    modified.filters = existingFilters

    return modified
  }

  /**
   * Apply SQL column masks to dimensions
   */
  private applySqlColumnMasks(
    query: SemanticQuery,
    sqlMasks: Record<string, string>
  ): SemanticQuery {
    if (Object.keys(sqlMasks).length === 0) return query

    const modified = { ...query }

    // Store the masks for the SQL generator to use
    modified._columnMasks = sqlMasks

    return modified
  }

  // ===========================================================================
  // SCHEMA INTROSPECTION
  // ===========================================================================

  /**
   * Get filtered schema metadata based on user access
   */
  async getMeta(ctx: SecurityContext): Promise<SchemaMeta> {
    const fullMeta = this.semantic.getMeta()
    const effectiveRules = this.getEffectiveRules(ctx)

    if (effectiveRules.length === 0) {
      return { cubes: [] }
    }

    const filteredCubes: CubeMeta[] = []

    for (const cube of fullMeta.cubes) {
      // Check cube access
      const hasCubeAccess = effectiveRules.some(
        (r) => r.cubes && isAllowed(cube.name, r.cubes)
      )

      if (!hasCubeAccess) continue

      // Filter measures
      const filteredMeasures = cube.measures.filter((m) => {
        for (const rule of effectiveRules) {
          if (rule.measuresByCube?.[cube.name]) {
            return isAllowed(m.name, rule.measuresByCube[cube.name])
          }
          if (rule.measures) {
            return isAllowed(m.name, rule.measures)
          }
        }
        return true
      })

      // Filter dimensions
      const filteredDimensions = cube.dimensions.filter((d) => {
        // Check excluded columns
        for (const rule of effectiveRules) {
          if (rule.excludeColumns?.includes(d.name)) {
            return false
          }
        }

        for (const rule of effectiveRules) {
          if (rule.dimensionsByCube?.[cube.name]) {
            return isAllowed(d.name, rule.dimensionsByCube[cube.name])
          }
          if (rule.dimensions) {
            return isAllowed(d.name, rule.dimensions)
          }
        }
        return true
      })

      filteredCubes.push({
        ...cube,
        measures: filteredMeasures,
        dimensions: filteredDimensions,
      })
    }

    return { cubes: filteredCubes }
  }
}

// Extend SemanticQuery to support security filters
declare module './index' {
  interface SemanticQuery {
    _securityFilters?: string[]
    _columnMasks?: Record<string, string>
  }
}
