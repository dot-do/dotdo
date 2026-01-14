/**
 * Schema Mapping/Transformation Module
 *
 * Provides comprehensive schema mapping and transformation capabilities:
 * - Field renaming and aliasing (bidirectional)
 * - Type coercion rules with edge cases
 * - Nested field flattening and unflattening
 * - Computed/derived fields with dependencies
 * - Schema evolution handling (versioned migrations)
 *
 * @module db/primitives/connector-framework/schema-mapper
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Coercion target types supported by default
 */
export type CoercionTargetType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'iso-date'
  | 'iso-datetime'
  | 'array'
  | 'json'

/**
 * Field mapping definition
 */
export interface SchemaMapping {
  source: string
  target: string
  coerce?: CoercionTargetType | string
  condition?: (record: Record<string, unknown>) => boolean
}

/**
 * Field alias definition
 */
export interface FieldAlias {
  canonical: string
  aliases: string[]
  preferredAlias?: string
}

/**
 * Coercion rule function type
 */
export type CoercionRule = (value: unknown) => unknown

/**
 * Computed field definition
 */
export interface ComputedFieldDef {
  name: string
  compute: (record: Record<string, unknown>) => unknown
  dependsOn?: string[]
  condition?: (record: Record<string, unknown>) => boolean
  async?: boolean
  removeOnReverse?: boolean
}

/**
 * Schema change types
 */
export type SchemaChangeType = 'add' | 'remove' | 'rename' | 'typeChange'

/**
 * Schema change definition
 */
export interface SchemaChange {
  type: SchemaChangeType
  field?: string
  from?: string
  to?: string
  defaultValue?: unknown
}

/**
 * Schema version definition
 */
export interface SchemaVersion {
  version: number
  changes: SchemaChange[]
}

/**
 * Schema evolution configuration
 */
export interface SchemaEvolution {
  currentVersion: number
  versions: SchemaVersion[]
}

/**
 * Flatten options
 */
export interface FlattenOptions {
  separator?: string
  maxDepth?: number
  flattenArrays?: boolean
  prefix?: string
}

/**
 * Unflatten options
 */
export interface UnflattenOptions {
  separator?: string
  detectArrays?: boolean
}

/**
 * Schema mapper configuration
 */
export interface SchemaMapperConfig {
  mappings?: SchemaMapping[]
  aliases?: FieldAlias[]
  computed?: ComputedFieldDef[]
  flatten?: {
    enabled: boolean
    separator?: string
    maxDepth?: number
    flattenArrays?: boolean
  }
  evolution?: {
    versions: SchemaVersion[]
  }
}

/**
 * Schema mapper interface
 */
export interface SchemaMapper {
  mapToTarget: (record: Record<string, unknown>) => Record<string, unknown>
  mapToSource: (record: Record<string, unknown>) => Record<string, unknown>
  mapToTargetAsync: (record: Record<string, unknown>) => Promise<Record<string, unknown>>
}

// =============================================================================
// Coercion Rules Registry
// =============================================================================

const coercionRules = new Map<string, CoercionRule>()

/**
 * Register a custom coercion rule
 */
export function registerCoercionRule(name: string, rule: CoercionRule): void {
  coercionRules.set(name, rule)
}

/**
 * Get list of available coercion rules
 */
export function getCoercionRules(): string[] {
  return [...coercionRules.keys()]
}

// Register default coercion rules
registerCoercionRule('string', (value) => {
  if (value === null || value === undefined) return value
  return String(value)
})

registerCoercionRule('number', (value) => {
  if (value === null || value === undefined) return value
  return Number(value)
})

registerCoercionRule('integer', (value) => {
  if (value === null || value === undefined) return value
  return Math.trunc(Number(value))
})

registerCoercionRule('boolean', (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim()
    if (lower === 'true' || lower === 'yes' || lower === '1') return true
    if (lower === 'false' || lower === 'no' || lower === '0' || lower === '') return false
    return Boolean(value)
  }
  return Boolean(value)
})

registerCoercionRule('date', (value) => {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  return new Date(value as string)
})

registerCoercionRule('iso-date', (value) => {
  if (value === null || value === undefined) return value
  const date = value instanceof Date ? value : new Date(value as string | number)
  return date.toISOString().split('T')[0]
})

registerCoercionRule('iso-datetime', (value) => {
  if (value === null || value === undefined) return value
  const date = value instanceof Date ? value : new Date(value as string | number)
  return date.toISOString()
})

registerCoercionRule('array', (value) => {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    if (value.includes(',')) return value.split(',').map((s) => s.trim())
    return [value]
  }
  return [value]
})

registerCoercionRule('json', (value) => {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
})

/**
 * Coerce a value to a target type
 */
export function coerceValue(value: unknown, targetType: CoercionTargetType | string): unknown {
  const rule = coercionRules.get(targetType)
  if (!rule) {
    throw new Error(`Unknown coercion type: ${targetType}`)
  }
  return rule(value)
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Delete a nested value from an object using dot notation
 */
function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  if (parts.length === 1) {
    delete obj[path]
    return
  }
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      return
    }
    current = current[part] as Record<string, unknown>
  }
  delete current[parts[parts.length - 1]]
}

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj.getTime()) as T
  if (Array.isArray(obj)) return obj.map((item) => deepClone(item)) as T
  const cloned: Record<string, unknown> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone((obj as Record<string, unknown>)[key])
    }
  }
  return cloned as T
}

// =============================================================================
// Flatten/Unflatten Functions
// =============================================================================

/**
 * Flatten a nested object into a flat object with dot-separated keys
 */
export function flattenRecord(
  obj: Record<string, unknown>,
  options: FlattenOptions = {},
): Record<string, unknown> {
  const { separator = '_', maxDepth = Infinity, flattenArrays = false, prefix = '' } = options
  const result: Record<string, unknown> = {}

  function flatten(current: unknown, currentPath: string, depth: number): void {
    // Handle null/undefined
    if (current === null || current === undefined) {
      result[currentPath] = current
      return
    }

    // Handle arrays
    if (Array.isArray(current)) {
      if (flattenArrays) {
        current.forEach((item, index) => {
          const newPath = currentPath ? `${currentPath}${separator}${index}` : String(index)
          flatten(item, newPath, depth)
        })
      } else {
        result[currentPath] = current
      }
      return
    }

    // Handle objects (not Date)
    if (typeof current === 'object' && !(current instanceof Date)) {
      if (depth >= maxDepth) {
        result[currentPath] = current
        return
      }
      for (const [key, value] of Object.entries(current)) {
        const newPath = currentPath ? `${currentPath}${separator}${key}` : key
        flatten(value, newPath, depth + 1)
      }
      return
    }

    // Handle primitives and dates
    result[currentPath] = current
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}${separator}${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      flatten(value, path, 1)
    } else if (Array.isArray(value) && flattenArrays) {
      value.forEach((item, index) => {
        flatten(item, `${path}${separator}${index}`, 1)
      })
    } else {
      result[path] = value
    }
  }

  return result
}

/**
 * Unflatten a flat object into a nested object
 */
export function unflattenRecord(
  obj: Record<string, unknown>,
  options: UnflattenOptions = {},
): Record<string, unknown> {
  const { separator = '_', detectArrays = false } = options
  const result: Record<string, unknown> = {}

  // Sort keys to ensure proper nesting order
  const keys = Object.keys(obj).sort()

  for (const key of keys) {
    const value = obj[key]
    const parts = key.split(separator)

    if (parts.length === 1) {
      result[key] = value
      continue
    }

    let current = result
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      const nextPart = parts[i + 1]

      // Check if next part is a number (array index)
      const isArrayIndex = detectArrays && /^\d+$/.test(nextPart)

      if (!(part in current)) {
        current[part] = isArrayIndex ? [] : {}
      }

      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]

    // If detectArrays and lastPart is numeric, treat parent as array
    if (detectArrays && /^\d+$/.test(lastPart)) {
      const arrayParent = current as unknown[]
      arrayParent[parseInt(lastPart, 10)] = value
    } else {
      current[lastPart] = value
    }
  }

  return result
}

// =============================================================================
// Schema Evolution Functions
// =============================================================================

/**
 * Create a schema evolution handler
 */
export function createSchemaEvolution(config: { versions: SchemaVersion[] }): SchemaEvolution {
  const sortedVersions = [...config.versions].sort((a, b) => a.version - b.version)
  return {
    currentVersion: sortedVersions.length > 0 ? sortedVersions[sortedVersions.length - 1].version : 0,
    versions: sortedVersions,
  }
}

/**
 * Detect schema changes between two schema definitions
 */
export function detectSchemaChanges(
  oldSchema: Record<string, string>,
  newSchema: Record<string, string>,
): SchemaChange[] {
  const changes: SchemaChange[] = []

  // Detect added fields
  for (const field of Object.keys(newSchema)) {
    if (!(field in oldSchema)) {
      changes.push({ type: 'add', field })
    }
  }

  // Detect removed fields
  for (const field of Object.keys(oldSchema)) {
    if (!(field in newSchema)) {
      changes.push({ type: 'remove', field })
    }
  }

  // Detect type changes
  for (const field of Object.keys(oldSchema)) {
    if (field in newSchema && oldSchema[field] !== newSchema[field]) {
      changes.push({ type: 'typeChange', field, from: oldSchema[field], to: newSchema[field] })
    }
  }

  return changes
}

/**
 * Migrate a record through schema evolution
 */
export function migrateRecord(
  record: Record<string, unknown>,
  evolution: SchemaEvolution,
): Record<string, unknown> {
  const currentVersion = (record._schemaVersion as number) ?? 0
  const result = deepClone(record)

  // Find versions to apply
  const versionsToApply = evolution.versions.filter((v) => v.version > currentVersion)

  for (const version of versionsToApply) {
    for (const change of version.changes) {
      switch (change.type) {
        case 'rename':
          if (change.from && change.to && change.from in result) {
            result[change.to] = result[change.from]
            delete result[change.from]
          }
          break
        case 'add':
          if (change.field && !(change.field in result)) {
            result[change.field] = change.defaultValue
          }
          break
        case 'remove':
          if (change.field && change.field in result) {
            delete result[change.field]
          }
          break
        case 'typeChange':
          if (change.field && change.field in result && change.to) {
            result[change.field] = coerceValue(result[change.field], change.to)
          }
          break
      }
    }
  }

  result._schemaVersion = evolution.currentVersion
  return result
}

// =============================================================================
// Schema Mapper Implementation
// =============================================================================

/**
 * Topologically sort computed fields by dependencies
 */
function sortComputedFields(computed: ComputedFieldDef[]): ComputedFieldDef[] {
  const sorted: ComputedFieldDef[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const fieldMap = new Map<string, ComputedFieldDef>()

  for (const field of computed) {
    fieldMap.set(field.name, field)
  }

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving field: ${name}`)
    }

    const field = fieldMap.get(name)
    if (!field) return

    visiting.add(name)

    if (field.dependsOn) {
      for (const dep of field.dependsOn) {
        if (fieldMap.has(dep)) {
          visit(dep)
        }
      }
    }

    visiting.delete(name)
    visited.add(name)
    sorted.push(field)
  }

  for (const field of computed) {
    visit(field.name)
  }

  return sorted
}

/**
 * Create a schema mapper
 */
export function createSchemaMapper(config: SchemaMapperConfig): SchemaMapper {
  const { mappings = [], aliases = [], computed = [], flatten, evolution } = config

  // Validate and sort computed fields by dependencies
  const sortedComputed = computed.length > 0 ? sortComputedFields(computed) : []

  // Build alias lookup (alias -> canonical)
  const aliasToCanonical = new Map<string, string>()
  const canonicalToPreferred = new Map<string, string>()

  for (const alias of aliases) {
    for (const a of alias.aliases) {
      aliasToCanonical.set(a, alias.canonical)
    }
    aliasToCanonical.set(alias.canonical, alias.canonical)
    if (alias.preferredAlias) {
      canonicalToPreferred.set(alias.canonical, alias.preferredAlias)
    }
  }

  // Build reverse mapping lookup (target -> source)
  const targetToSource = new Map<string, SchemaMapping>()
  for (const mapping of mappings) {
    targetToSource.set(mapping.target, mapping)
  }

  // Build computed field names set (for removal on reverse)
  const computedFieldNames = new Set<string>()
  const removeOnReverseFields = new Set<string>()
  for (const field of sortedComputed) {
    computedFieldNames.add(field.name)
    if (field.removeOnReverse) {
      removeOnReverseFields.add(field.name)
    }
  }

  // Create schema evolution if provided
  const schemaEvolution = evolution ? createSchemaEvolution(evolution) : null

  /**
   * Apply alias normalization to a record
   */
  function normalizeAliases(record: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      const canonical = aliasToCanonical.get(key) ?? key
      result[canonical] = value
    }
    return result
  }

  /**
   * Apply reverse alias mapping
   */
  function denormalizeAliases(record: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      const preferred = canonicalToPreferred.get(key)
      result[preferred ?? key] = value
    }
    return result
  }

  /**
   * Map a record to target schema
   */
  function mapToTarget(record: Record<string, unknown>): Record<string, unknown> {
    let result = deepClone(record)

    // Apply schema evolution first
    if (schemaEvolution && typeof record._schemaVersion === 'number') {
      result = migrateRecord(result, schemaEvolution)
    }

    // Normalize aliases
    result = normalizeAliases(result)

    // Apply field mappings
    const mappedResult: Record<string, unknown> = {}
    const mappedSourceFields = new Set<string>()

    for (const mapping of mappings) {
      // Check condition
      if (mapping.condition && !mapping.condition(result)) {
        continue
      }

      // Handle wildcard mappings
      if (mapping.source.endsWith('.*')) {
        const sourcePrefix = mapping.source.slice(0, -2)
        const targetPrefix = mapping.target.slice(0, -2)
        const sourceValue = getNestedValue(result, sourcePrefix)

        if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
          setNestedValue(mappedResult, targetPrefix, deepClone(sourceValue))
          mappedSourceFields.add(sourcePrefix)
        }
        continue
      }

      const value = getNestedValue(result, mapping.source)
      if (value !== undefined) {
        let coercedValue = value
        if (mapping.coerce) {
          coercedValue = coerceValue(value, mapping.coerce)
        }
        setNestedValue(mappedResult, mapping.target, coercedValue)
        mappedSourceFields.add(mapping.source.split('.')[0])
      }
    }

    // Copy unmapped fields
    for (const [key, value] of Object.entries(result)) {
      if (!mappedSourceFields.has(key) && key !== '_schemaVersion') {
        if (!(key in mappedResult)) {
          mappedResult[key] = value
        }
      }
    }

    // Apply computed fields (pass mappedResult so dependencies can be read)
    for (const field of sortedComputed) {
      if (field.condition && !field.condition(result)) {
        continue
      }
      // Merge original result with mappedResult so computed fields can access both
      // original fields and previously computed fields
      const computeContext = { ...result, ...mappedResult }
      const computedValue = field.compute(computeContext)
      setNestedValue(mappedResult, field.name, computedValue)
    }

    // Apply flattening if enabled
    if (flatten?.enabled) {
      return flattenRecord(mappedResult, {
        separator: flatten.separator,
        maxDepth: flatten.maxDepth,
        flattenArrays: flatten.flattenArrays,
      })
    }

    return mappedResult
  }

  /**
   * Map a record from target schema back to source
   */
  function mapToSource(record: Record<string, unknown>): Record<string, unknown> {
    let result = deepClone(record)

    // Apply unflattening if flattening was enabled
    if (flatten?.enabled) {
      result = unflattenRecord(result, { separator: flatten.separator })
    }

    // Remove computed fields that should be removed on reverse
    for (const fieldName of removeOnReverseFields) {
      deleteNestedValue(result, fieldName)
    }

    // Apply reverse field mappings
    const reversedResult: Record<string, unknown> = {}
    const mappedTargetFields = new Set<string>()

    for (const mapping of mappings) {
      // Handle wildcard mappings
      if (mapping.target.endsWith('.*')) {
        const targetPrefix = mapping.target.slice(0, -2)
        const sourcePrefix = mapping.source.slice(0, -2)
        const targetValue = getNestedValue(result, targetPrefix)

        if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
          setNestedValue(reversedResult, sourcePrefix, deepClone(targetValue))
          mappedTargetFields.add(targetPrefix)
        }
        continue
      }

      const value = getNestedValue(result, mapping.target)
      if (value !== undefined) {
        setNestedValue(reversedResult, mapping.source, value)
        mappedTargetFields.add(mapping.target.split('.')[0])
      }
    }

    // Copy unmapped fields
    for (const [key, value] of Object.entries(result)) {
      if (!mappedTargetFields.has(key)) {
        if (!(key in reversedResult)) {
          reversedResult[key] = value
        }
      }
    }

    // Denormalize aliases
    return denormalizeAliases(reversedResult)
  }

  /**
   * Map a record to target schema with async computed fields
   */
  async function mapToTargetAsync(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    let result = deepClone(record)

    // Apply schema evolution first
    if (schemaEvolution && typeof record._schemaVersion === 'number') {
      result = migrateRecord(result, schemaEvolution)
    }

    // Normalize aliases
    result = normalizeAliases(result)

    // Apply field mappings
    const mappedResult: Record<string, unknown> = {}
    const mappedSourceFields = new Set<string>()

    for (const mapping of mappings) {
      if (mapping.condition && !mapping.condition(result)) {
        continue
      }

      if (mapping.source.endsWith('.*')) {
        const sourcePrefix = mapping.source.slice(0, -2)
        const targetPrefix = mapping.target.slice(0, -2)
        const sourceValue = getNestedValue(result, sourcePrefix)

        if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
          setNestedValue(mappedResult, targetPrefix, deepClone(sourceValue))
          mappedSourceFields.add(sourcePrefix)
        }
        continue
      }

      const value = getNestedValue(result, mapping.source)
      if (value !== undefined) {
        let coercedValue = value
        if (mapping.coerce) {
          coercedValue = coerceValue(value, mapping.coerce)
        }
        setNestedValue(mappedResult, mapping.target, coercedValue)
        mappedSourceFields.add(mapping.source.split('.')[0])
      }
    }

    // Copy unmapped fields
    for (const [key, value] of Object.entries(result)) {
      if (!mappedSourceFields.has(key) && key !== '_schemaVersion') {
        if (!(key in mappedResult)) {
          mappedResult[key] = value
        }
      }
    }

    // Apply computed fields (including async, with dependency resolution)
    for (const field of sortedComputed) {
      if (field.condition && !field.condition(result)) {
        continue
      }
      // Merge original result with mappedResult so computed fields can access both
      // original fields and previously computed fields
      const computeContext = { ...result, ...mappedResult }
      const computedValue = field.async
        ? await (field.compute(computeContext) as Promise<unknown>)
        : field.compute(computeContext)
      setNestedValue(mappedResult, field.name, computedValue)
    }

    // Apply flattening if enabled
    if (flatten?.enabled) {
      return flattenRecord(mappedResult, {
        separator: flatten.separator,
        maxDepth: flatten.maxDepth,
        flattenArrays: flatten.flattenArrays,
      })
    }

    return mappedResult
  }

  return {
    mapToTarget,
    mapToSource,
    mapToTargetAsync,
  }
}
