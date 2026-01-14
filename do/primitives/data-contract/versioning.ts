/**
 * Semantic Version Management for DataContract
 *
 * Provides:
 * - Parse and compare semver versions
 * - Automatic version bump suggestions based on schema changes
 * - Version range matching (^, ~, >=, etc.)
 * - Breaking change detection for major bumps
 * - New field additions for minor bumps
 * - Bug fix / metadata changes for patch bumps
 */

import type { JSONSchema, DataContract, SchemaDiff } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed semantic version components
 */
export interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease?: string[]
  build?: string
}

/**
 * Version bump type
 */
export type BumpType = 'major' | 'minor' | 'patch'

/**
 * Schema change categorization for version bump suggestions
 */
export interface SchemaChange {
  type: 'breaking' | 'addition' | 'deprecation' | 'patch'
  category: string
  field?: string
  message: string
}

/**
 * Detailed compatibility analysis
 */
export interface VersionCompatibilityResult {
  compatible: boolean
  breakingChanges: SchemaChange[]
  additions: SchemaChange[]
  deprecations: SchemaChange[]
  patchChanges: SchemaChange[]
  suggestedBump: BumpType
  suggestedVersion: string
}

/**
 * Version range operators
 */
export type RangeOperator = '^' | '~' | '>' | '>=' | '<' | '<=' | '=' | '-'

/**
 * Parsed version range
 */
export interface VersionRange {
  operator: RangeOperator
  version: SemVer
  upperBound?: SemVer // For hyphen ranges
}

/**
 * Contract version entry with metadata
 */
export interface ContractVersionEntry {
  version: string
  schema: JSONSchema
  checksum: string
  publishedAt: Date
  changes?: SchemaChange[]
  description?: string
}

// ============================================================================
// SEMVER PARSING AND COMPARISON
// ============================================================================

/**
 * Parse a semver string into components
 * Supports: 1.2.3, 1.2.3-alpha.1, 1.2.3+build.123
 */
export function parseSemVer(version: string): SemVer {
  const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  const match = version.match(regex)

  if (!match) {
    throw new Error(`Invalid semver format: ${version}. Expected format: X.Y.Z[-prerelease][+build]`)
  }

  const result: SemVer = {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  }

  if (match[4]) {
    result.prerelease = match[4].split('.')
  }

  if (match[5]) {
    result.build = match[5]
  }

  return result
}

/**
 * Format a SemVer back to string
 */
export function formatSemVer(version: SemVer): string {
  let result = `${version.major}.${version.minor}.${version.patch}`

  if (version.prerelease && version.prerelease.length > 0) {
    result += '-' + version.prerelease.join('.')
  }

  if (version.build) {
    result += '+' + version.build
  }

  return result
}

/**
 * Compare two prerelease identifiers
 * Returns: -1 if a < b, 1 if a > b, 0 if equal
 */
function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNum = parseInt(a, 10)
  const bNum = parseInt(b, 10)

  // Both numeric
  if (!isNaN(aNum) && !isNaN(bNum)) {
    return aNum < bNum ? -1 : aNum > bNum ? 1 : 0
  }

  // Numeric identifiers have lower precedence
  if (!isNaN(aNum)) return -1
  if (!isNaN(bNum)) return 1

  // Both strings - compare lexically
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compare prerelease arrays
 */
function comparePrerelease(a?: string[], b?: string[]): number {
  // No prerelease > prerelease (1.0.0 > 1.0.0-alpha)
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1

  // Compare identifier by identifier
  const maxLen = Math.max(a.length, b.length)
  for (let i = 0; i < maxLen; i++) {
    const aId = a[i]
    const bId = b[i]

    // Shorter prerelease has lower precedence if all previous are equal
    if (aId === undefined) return -1
    if (bId === undefined) return 1

    const cmp = comparePrereleaseIdentifier(aId, bId)
    if (cmp !== 0) return cmp
  }

  return 0
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 1 if a > b, 0 if equal
 */
export function compareSemVer(a: string | SemVer, b: string | SemVer): -1 | 0 | 1 {
  const versionA = typeof a === 'string' ? parseSemVer(a) : a
  const versionB = typeof b === 'string' ? parseSemVer(b) : b

  // Compare major
  if (versionA.major !== versionB.major) {
    return versionA.major < versionB.major ? -1 : 1
  }

  // Compare minor
  if (versionA.minor !== versionB.minor) {
    return versionA.minor < versionB.minor ? -1 : 1
  }

  // Compare patch
  if (versionA.patch !== versionB.patch) {
    return versionA.patch < versionB.patch ? -1 : 1
  }

  // Compare prerelease
  const prereleaseCmp = comparePrerelease(versionA.prerelease, versionB.prerelease)
  return prereleaseCmp as -1 | 0 | 1
}

/**
 * Check if version string is valid semver
 */
export function isValidSemVer(version: string): boolean {
  try {
    parseSemVer(version)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// VERSION BUMPING
// ============================================================================

/**
 * Bump a version by type
 */
export function bumpVersion(version: string | SemVer, type: BumpType): string {
  const parsed = typeof version === 'string' ? parseSemVer(version) : version

  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  }
}

/**
 * Increment to next prerelease version
 * 1.0.0 -> 1.0.1-0
 * 1.0.1-0 -> 1.0.1-1
 * 1.0.1-alpha.1 -> 1.0.1-alpha.2
 */
export function bumpPrerelease(version: string | SemVer, identifier?: string): string {
  const parsed = typeof version === 'string' ? parseSemVer(version) : version

  if (!parsed.prerelease || parsed.prerelease.length === 0) {
    // No prerelease, add one with patch bump
    if (identifier) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${identifier}.0`
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-0`
  }

  // Has prerelease, increment last numeric identifier
  const newPrerelease = [...parsed.prerelease]
  let found = false

  for (let i = newPrerelease.length - 1; i >= 0; i--) {
    const num = parseInt(newPrerelease[i]!, 10)
    if (!isNaN(num)) {
      newPrerelease[i] = String(num + 1)
      found = true
      break
    }
  }

  if (!found) {
    // No numeric identifier found, append 1
    newPrerelease.push('1')
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}-${newPrerelease.join('.')}`
}

// ============================================================================
// VERSION RANGE MATCHING
// ============================================================================

/**
 * Parse a version range string
 * Supports: ^1.2.3, ~1.2.3, >=1.2.3, >1.2.3, <=1.2.3, <1.2.3, =1.2.3, 1.2.3 - 2.0.0
 */
export function parseVersionRange(range: string): VersionRange[] {
  const trimmed = range.trim()
  const ranges: VersionRange[] = []

  // Handle OR (||)
  const orParts = trimmed.split(/\s*\|\|\s*/)
  for (const part of orParts) {
    // Handle hyphen range (1.2.3 - 2.0.0)
    const hyphenMatch = part.match(/^(\d+\.\d+\.\d+(?:-[^\s]+)?)\s+-\s+(\d+\.\d+\.\d+(?:-[^\s]+)?)$/)
    if (hyphenMatch) {
      ranges.push({
        operator: '-',
        version: parseSemVer(hyphenMatch[1]!),
        upperBound: parseSemVer(hyphenMatch[2]!),
      })
      continue
    }

    // Handle operator prefixes
    const operatorMatch = part.match(/^(\^|~|>=|>|<=|<|=)?(.+)$/)
    if (!operatorMatch) {
      throw new Error(`Invalid version range: ${part}`)
    }

    const operator = (operatorMatch[1] || '=') as RangeOperator
    const versionStr = operatorMatch[2]!.trim()

    ranges.push({
      operator,
      version: parseSemVer(versionStr),
    })
  }

  return ranges
}

/**
 * Check if a version satisfies a single range condition
 */
function satisfiesRange(version: SemVer, range: VersionRange): boolean {
  const cmp = compareSemVer(version, range.version)

  switch (range.operator) {
    case '=':
      return cmp === 0

    case '>':
      return cmp === 1

    case '>=':
      return cmp >= 0

    case '<':
      return cmp === -1

    case '<=':
      return cmp <= 0

    case '^': {
      // Caret: allows changes that do not modify the left-most non-zero digit
      // ^1.2.3 := >=1.2.3 <2.0.0
      // ^0.2.3 := >=0.2.3 <0.3.0
      // ^0.0.3 := >=0.0.3 <0.0.4
      if (cmp === -1) return false

      if (range.version.major === 0) {
        if (range.version.minor === 0) {
          // ^0.0.x - only exact patch
          return version.major === 0 && version.minor === 0 && version.patch === range.version.patch
        }
        // ^0.x.x - same minor
        return version.major === 0 && version.minor === range.version.minor
      }
      // ^x.x.x - same major
      return version.major === range.version.major
    }

    case '~': {
      // Tilde: allows patch-level changes
      // ~1.2.3 := >=1.2.3 <1.3.0
      if (cmp === -1) return false
      return version.major === range.version.major && version.minor === range.version.minor
    }

    case '-': {
      // Hyphen range: inclusive on both ends
      if (cmp === -1) return false
      if (!range.upperBound) return true
      return compareSemVer(version, range.upperBound) <= 0
    }
  }
}

/**
 * Check if a version satisfies a range expression
 * Multiple ranges are OR'd together
 */
export function satisfies(version: string | SemVer, range: string): boolean {
  const parsed = typeof version === 'string' ? parseSemVer(version) : version
  const ranges = parseVersionRange(range)

  // Any range can match (OR logic)
  return ranges.some((r) => satisfiesRange(parsed, r))
}

/**
 * Find the maximum version that satisfies a range from a list of versions
 */
export function maxSatisfying(versions: string[], range: string): string | null {
  const satisfying = versions.filter((v) => {
    try {
      return satisfies(v, range)
    } catch {
      return false
    }
  })

  if (satisfying.length === 0) return null

  return satisfying.sort((a, b) => -compareSemVer(a, b))[0] || null
}

/**
 * Find the minimum version that satisfies a range from a list of versions
 */
export function minSatisfying(versions: string[], range: string): string | null {
  const satisfying = versions.filter((v) => {
    try {
      return satisfies(v, range)
    } catch {
      return false
    }
  })

  if (satisfying.length === 0) return null

  return satisfying.sort((a, b) => compareSemVer(a, b))[0] || null
}

// ============================================================================
// SCHEMA CHANGE ANALYSIS
// ============================================================================

/**
 * Analyze schema changes and categorize them
 */
export function analyzeSchemaChanges(
  oldSchema: JSONSchema,
  newSchema: JSONSchema
): SchemaChange[] {
  const changes: SchemaChange[] = []
  const oldProps = oldSchema.properties || {}
  const newProps = newSchema.properties || {}
  const oldRequired = new Set(oldSchema.required || [])
  const newRequired = new Set(newSchema.required || [])

  // Removed fields
  for (const field of Object.keys(oldProps)) {
    if (!(field in newProps)) {
      const wasRequired = oldRequired.has(field)
      changes.push({
        type: wasRequired ? 'breaking' : 'deprecation',
        category: 'field-removed',
        field,
        message: wasRequired
          ? `Required field '${field}' was removed (BREAKING)`
          : `Optional field '${field}' was removed`,
      })
    }
  }

  // Added fields
  for (const field of Object.keys(newProps)) {
    if (!(field in oldProps)) {
      const isRequired = newRequired.has(field)
      changes.push({
        type: isRequired ? 'breaking' : 'addition',
        category: 'field-added',
        field,
        message: isRequired
          ? `New required field '${field}' was added (BREAKING)`
          : `New optional field '${field}' was added`,
      })
    }
  }

  // Type changes (fields in both)
  for (const field of Object.keys(newProps)) {
    if (field in oldProps) {
      const oldType = getFieldType(oldProps[field]!)
      const newType = getFieldType(newProps[field]!)

      if (oldType !== newType) {
        changes.push({
          type: 'breaking',
          category: 'type-changed',
          field,
          message: `Field '${field}' type changed from ${oldType} to ${newType} (BREAKING)`,
        })
      }
    }
  }

  // Required status changes
  for (const field of Object.keys(newProps)) {
    if (field in oldProps) {
      const wasRequired = oldRequired.has(field)
      const isRequired = newRequired.has(field)

      if (!wasRequired && isRequired) {
        changes.push({
          type: 'breaking',
          category: 'required-added',
          field,
          message: `Field '${field}' became required (BREAKING)`,
        })
      } else if (wasRequired && !isRequired) {
        changes.push({
          type: 'addition',
          category: 'required-removed',
          field,
          message: `Field '${field}' became optional`,
        })
      }
    }
  }

  // Constraint changes (min/max, pattern, format, etc.)
  for (const field of Object.keys(newProps)) {
    if (field in oldProps) {
      const constraintChanges = analyzeConstraintChanges(field, oldProps[field]!, newProps[field]!)
      changes.push(...constraintChanges)
    }
  }

  return changes
}

/**
 * Analyze constraint changes for a field
 */
function analyzeConstraintChanges(
  field: string,
  oldSchema: JSONSchema,
  newSchema: JSONSchema
): SchemaChange[] {
  const changes: SchemaChange[] = []

  // Minimum constraint
  if (oldSchema.minimum !== newSchema.minimum) {
    if (newSchema.minimum !== undefined && (oldSchema.minimum === undefined || newSchema.minimum > oldSchema.minimum)) {
      changes.push({
        type: 'breaking',
        category: 'constraint-tightened',
        field,
        message: `Field '${field}' minimum constraint tightened (BREAKING)`,
      })
    } else if (newSchema.minimum === undefined || newSchema.minimum < (oldSchema.minimum || 0)) {
      changes.push({
        type: 'patch',
        category: 'constraint-relaxed',
        field,
        message: `Field '${field}' minimum constraint relaxed`,
      })
    }
  }

  // Maximum constraint
  if (oldSchema.maximum !== newSchema.maximum) {
    if (newSchema.maximum !== undefined && (oldSchema.maximum === undefined || newSchema.maximum < oldSchema.maximum)) {
      changes.push({
        type: 'breaking',
        category: 'constraint-tightened',
        field,
        message: `Field '${field}' maximum constraint tightened (BREAKING)`,
      })
    } else if (newSchema.maximum === undefined || newSchema.maximum > (oldSchema.maximum || 0)) {
      changes.push({
        type: 'patch',
        category: 'constraint-relaxed',
        field,
        message: `Field '${field}' maximum constraint relaxed`,
      })
    }
  }

  // Min length constraint
  if (oldSchema.minLength !== newSchema.minLength) {
    if (newSchema.minLength !== undefined && (oldSchema.minLength === undefined || newSchema.minLength > oldSchema.minLength)) {
      changes.push({
        type: 'breaking',
        category: 'constraint-tightened',
        field,
        message: `Field '${field}' minLength constraint tightened (BREAKING)`,
      })
    }
  }

  // Max length constraint
  if (oldSchema.maxLength !== newSchema.maxLength) {
    if (newSchema.maxLength !== undefined && (oldSchema.maxLength === undefined || newSchema.maxLength < oldSchema.maxLength)) {
      changes.push({
        type: 'breaking',
        category: 'constraint-tightened',
        field,
        message: `Field '${field}' maxLength constraint tightened (BREAKING)`,
      })
    }
  }

  // Pattern constraint
  if (oldSchema.pattern !== newSchema.pattern) {
    if (newSchema.pattern !== undefined && oldSchema.pattern === undefined) {
      changes.push({
        type: 'breaking',
        category: 'constraint-added',
        field,
        message: `Field '${field}' pattern constraint added (BREAKING)`,
      })
    } else if (newSchema.pattern === undefined && oldSchema.pattern !== undefined) {
      changes.push({
        type: 'patch',
        category: 'constraint-removed',
        field,
        message: `Field '${field}' pattern constraint removed`,
      })
    } else if (newSchema.pattern !== undefined && oldSchema.pattern !== undefined) {
      changes.push({
        type: 'breaking',
        category: 'constraint-changed',
        field,
        message: `Field '${field}' pattern constraint changed (BREAKING)`,
      })
    }
  }

  // Enum constraint
  if (JSON.stringify(oldSchema.enum) !== JSON.stringify(newSchema.enum)) {
    if (oldSchema.enum && newSchema.enum) {
      const oldEnumSet = new Set(oldSchema.enum.map(String))
      const newEnumSet = new Set(newSchema.enum.map(String))

      // Check for removed values (breaking)
      const removedValues = oldSchema.enum.filter(v => !newEnumSet.has(String(v)))
      if (removedValues.length > 0) {
        changes.push({
          type: 'breaking',
          category: 'enum-values-removed',
          field,
          message: `Field '${field}' enum values removed: ${removedValues.join(', ')} (BREAKING)`,
        })
      }

      // Check for added values (non-breaking)
      const addedValues = newSchema.enum.filter(v => !oldEnumSet.has(String(v)))
      if (addedValues.length > 0) {
        changes.push({
          type: 'addition',
          category: 'enum-values-added',
          field,
          message: `Field '${field}' enum values added: ${addedValues.join(', ')}`,
        })
      }
    } else if (!oldSchema.enum && newSchema.enum) {
      changes.push({
        type: 'breaking',
        category: 'enum-constraint-added',
        field,
        message: `Field '${field}' enum constraint added (BREAKING)`,
      })
    } else if (oldSchema.enum && !newSchema.enum) {
      changes.push({
        type: 'patch',
        category: 'enum-constraint-removed',
        field,
        message: `Field '${field}' enum constraint removed`,
      })
    }
  }

  return changes
}

/**
 * Get a string representation of a field's type
 */
function getFieldType(schema: JSONSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ')
  }
  return schema.type || 'any'
}

/**
 * Suggest version bump based on schema changes
 */
export function suggestVersionBump(changes: SchemaChange[]): BumpType {
  const hasBreaking = changes.some((c) => c.type === 'breaking')
  const hasAdditions = changes.some((c) => c.type === 'addition')
  const hasDeprecations = changes.some((c) => c.type === 'deprecation')

  if (hasBreaking) {
    return 'major'
  }

  if (hasAdditions || hasDeprecations) {
    return 'minor'
  }

  return 'patch'
}

/**
 * Full compatibility analysis between two schemas
 */
export function analyzeCompatibility(
  currentVersion: string,
  oldSchema: JSONSchema,
  newSchema: JSONSchema
): VersionCompatibilityResult {
  const changes = analyzeSchemaChanges(oldSchema, newSchema)

  const breakingChanges = changes.filter((c) => c.type === 'breaking')
  const additions = changes.filter((c) => c.type === 'addition')
  const deprecations = changes.filter((c) => c.type === 'deprecation')
  const patchChanges = changes.filter((c) => c.type === 'patch')

  const suggestedBump = suggestVersionBump(changes)
  const suggestedVersion = bumpVersion(currentVersion, suggestedBump)

  return {
    compatible: breakingChanges.length === 0,
    breakingChanges,
    additions,
    deprecations,
    patchChanges,
    suggestedBump,
    suggestedVersion,
  }
}

// ============================================================================
// VERSIONED CONTRACT CLASS
// ============================================================================

/**
 * Generate a checksum for a schema using FNV-1a hash algorithm
 * (SHA-256 would be better in production)
 */
export function generateSchemaChecksum(schema: JSONSchema): string {
  // Deep sort keys for consistent ordering
  const sortedSchema = sortObjectKeys(schema)
  const str = JSON.stringify(sortedSchema)

  // FNV-1a hash - better distribution than simple hash
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // FNV prime multiplication with 32-bit overflow handling
    hash = Math.imul(hash, 16777619)
  }

  // Convert to unsigned and format as hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Recursively sort object keys for consistent JSON stringification
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
  }
  return sorted
}

/**
 * Manages versioned data contracts with history and rollback
 */
export class VersionedContract {
  private versions: Map<string, ContractVersionEntry> = new Map()
  private currentVersion: string | null = null

  /**
   * Publish a new version of the contract
   */
  publish(
    version: string,
    schema: JSONSchema,
    options?: { description?: string; changes?: SchemaChange[] }
  ): ContractVersionEntry {
    if (!isValidSemVer(version)) {
      throw new Error(`Invalid version format: ${version}`)
    }

    // Check version ordering
    if (this.currentVersion && compareSemVer(version, this.currentVersion) <= 0) {
      throw new Error(
        `New version ${version} must be greater than current version ${this.currentVersion}`
      )
    }

    const entry: ContractVersionEntry = {
      version,
      schema,
      checksum: generateSchemaChecksum(schema),
      publishedAt: new Date(),
      changes: options?.changes,
      description: options?.description,
    }

    this.versions.set(version, entry)
    this.currentVersion = version

    return entry
  }

  /**
   * Publish with automatic version bump suggestion
   */
  publishWithAnalysis(
    schema: JSONSchema,
    options?: { description?: string }
  ): { entry: ContractVersionEntry; analysis: VersionCompatibilityResult } {
    const current = this.getCurrentVersion()

    if (!current) {
      // First version
      const entry = this.publish('1.0.0', schema, options)
      return {
        entry,
        analysis: {
          compatible: true,
          breakingChanges: [],
          additions: [],
          deprecations: [],
          patchChanges: [],
          suggestedBump: 'minor',
          suggestedVersion: '1.0.0',
        },
      }
    }

    const analysis = analyzeCompatibility(current.version, current.schema, schema)
    const entry = this.publish(analysis.suggestedVersion, schema, {
      ...options,
      changes: [
        ...analysis.breakingChanges,
        ...analysis.additions,
        ...analysis.deprecations,
        ...analysis.patchChanges,
      ],
    })

    return { entry, analysis }
  }

  /**
   * Get a specific version
   */
  getVersion(version: string): ContractVersionEntry | undefined {
    return this.versions.get(version)
  }

  /**
   * Get the current (latest) version
   */
  getCurrentVersion(): ContractVersionEntry | undefined {
    if (!this.currentVersion) return undefined
    return this.versions.get(this.currentVersion)
  }

  /**
   * Get all versions in order
   */
  getAllVersions(): ContractVersionEntry[] {
    return Array.from(this.versions.values()).sort((a, b) =>
      compareSemVer(a.version, b.version)
    )
  }

  /**
   * Get versions that match a range
   */
  getMatchingVersions(range: string): ContractVersionEntry[] {
    return this.getAllVersions().filter((entry) => satisfies(entry.version, range))
  }

  /**
   * Rollback to a previous version
   */
  rollback(version: string): ContractVersionEntry {
    const entry = this.versions.get(version)
    if (!entry) {
      throw new Error(`Version ${version} not found`)
    }

    // Remove all versions after the rollback target
    const versionsToRemove = Array.from(this.versions.keys()).filter(
      (v) => compareSemVer(v, version) > 0
    )

    for (const v of versionsToRemove) {
      this.versions.delete(v)
    }

    this.currentVersion = version
    return entry
  }

  /**
   * Compare two versions
   */
  compare(a: string, b: string): -1 | 0 | 1 {
    return compareSemVer(a, b)
  }

  /**
   * Check compatibility between two versions
   */
  isCompatible(fromVersion: string, toVersion: string): VersionCompatibilityResult {
    const from = this.versions.get(fromVersion)
    const to = this.versions.get(toVersion)

    if (!from) {
      throw new Error(`Version ${fromVersion} not found`)
    }
    if (!to) {
      throw new Error(`Version ${toVersion} not found`)
    }

    return analyzeCompatibility(fromVersion, from.schema, to.schema)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new versioned contract manager
 */
export function createVersionedContract(): VersionedContract {
  return new VersionedContract()
}
