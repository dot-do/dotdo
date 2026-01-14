/**
 * ContractRegistry - Durable Object for DataContract schema storage and discovery
 *
 * Provides:
 * - Schema registration and versioning
 * - Schema discovery API (search by namespace/name/tag/owner)
 * - Lineage tracking (producer/consumer relationships)
 * - Deprecation lifecycle management
 * - Pagination for list operations
 *
 * Storage Design:
 * - Metadata in DO SQLite for fast queries
 * - Schema content in DO storage (large schemas could use R2)
 * - Lineage graph in DO storage for relationship queries
 */

import type { DataContract, JSONSchema, SchemaMetadata, SchemaVersionEntry, ValidationResult, CompatibilityCheck, SchemaDiff, Migration, MigrationChange } from './index'
import { SchemaVersion, createSchema as createDataContract } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Contract version stored in the registry
 */
export interface ContractVersion {
  name: string
  version: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Contract summary for list operations
 */
export interface ContractSummary {
  name: string
  version: string
  namespace?: string
  owner?: string
  tags?: string[]
  deprecated?: boolean
  deprecationMessage?: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Filter options for listing contracts
 */
export interface ContractFilter {
  namespace?: string
  owner?: string
  tags?: string[]
  deprecated?: boolean
  search?: string
  limit?: number
  offset?: number
}

/**
 * Lineage relationship types
 */
export type LineageRelationType = 'produces' | 'consumes' | 'derived-from'

/**
 * Lineage relationship between contracts
 */
export interface LineageRelationship {
  id: string
  type: LineageRelationType
  fromContract: string
  fromVersion?: string
  toContract: string
  toVersion?: string
  description?: string
  createdAt: Date
}

/**
 * Lineage graph for a contract
 */
export interface LineageGraph {
  contract: string
  version?: string
  producers: LineageRelationship[]
  consumers: LineageRelationship[]
  derivedFrom: LineageRelationship[]
  derivatives: LineageRelationship[]
}

/**
 * Stored contract entry with schema
 */
interface StoredContract {
  name: string
  version: string
  schema: JSONSchema
  metadata?: SchemaMetadata
  createdAt: string
  updatedAt: string
}

/**
 * Registry publish input
 */
export interface PublishInput {
  name: string
  version: string
  schema: JSONSchema
  metadata?: SchemaMetadata
}

/**
 * Deprecation options
 */
export interface DeprecateOptions {
  message?: string
  replacedBy?: {
    name: string
    version?: string
  }
}

// ============================================================================
// JSON SCHEMA VALIDATOR
// ============================================================================

/**
 * Validation error details
 */
interface ValidationError {
  path: string
  message: string
  keyword?: string
  params?: Record<string, unknown>
}

/**
 * JSON Schema validator class
 */
class Validator {
  /**
   * Validate data against a JSON Schema
   */
  validate(schema: JSONSchema, data: unknown, path = ''): ValidationError[] {
    const errors: ValidationError[] = []

    // Handle type validation
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      const actualType = this.getType(data)

      if (!types.includes(actualType as typeof schema.type extends Array<infer T> ? T : typeof schema.type)) {
        // Special case: integer is also valid as number
        if (!(actualType === 'number' && types.includes('integer') && Number.isInteger(data))) {
          // Check if null is allowed
          if (!(data === null && types.includes('null'))) {
            errors.push({
              path: path || 'root',
              message: `Expected ${types.join(' | ')}, got ${actualType}`,
              keyword: 'type',
              params: { expected: types, actual: actualType },
            })
            return errors
          }
        }
      }
    }

    // Handle null
    if (data === null) {
      return errors
    }

    // Object validation
    if (schema.type === 'object' || (typeof data === 'object' && !Array.isArray(data) && data !== null)) {
      errors.push(...this.validateObject(schema, data as Record<string, unknown>, path))
    }

    // Array validation
    if (schema.type === 'array' || Array.isArray(data)) {
      errors.push(...this.validateArray(schema, data as unknown[], path))
    }

    // String validation
    if (typeof data === 'string') {
      errors.push(...this.validateString(schema, data, path))
    }

    // Number validation
    if (typeof data === 'number') {
      errors.push(...this.validateNumber(schema, data, path))
    }

    // Enum validation
    if (schema.enum !== undefined && !schema.enum.includes(data as string | number | boolean | null)) {
      errors.push({
        path: path || 'root',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      })
    }

    return errors
  }

  private getType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
    return typeof value
  }

  private validateObject(schema: JSONSchema, data: Record<string, unknown>, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        const propSchema = schema.properties[key]
        if (propSchema) {
          const propPath = path ? `${path}.${key}` : key
          errors.push(...this.validate(propSchema, value, propPath))
        } else if (schema.additionalProperties === false) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Additional property not allowed: ${key}`,
            keyword: 'additionalProperties',
            params: { additionalProperty: key },
          })
        }
      }
    }

    return errors
  }

  private validateArray(schema: JSONSchema, data: unknown[], path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minItems
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at least ${schema.minItems} items`,
        keyword: 'minItems',
        params: { limit: schema.minItems },
      })
    }

    // maxItems
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: 'maxItems',
        params: { limit: schema.maxItems },
      })
    }

    // Items validation
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`
        errors.push(...this.validate(schema.items, data[i], itemPath))
      }
    }

    return errors
  }

  private validateString(schema: JSONSchema, data: string, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minLength
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at least ${schema.minLength} characters`,
        keyword: 'minLength',
        params: { limit: schema.minLength },
      })
    }

    // maxLength
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at most ${schema.maxLength} characters`,
        keyword: 'maxLength',
        params: { limit: schema.maxLength },
      })
    }

    // pattern
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern)
      if (!regex.test(data)) {
        errors.push({
          path: path || 'root',
          message: `String must match pattern: ${schema.pattern}`,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
        })
      }
    }

    // format validation
    if (schema.format !== undefined) {
      const formatError = this.validateFormat(schema.format, data, path)
      if (formatError) {
        errors.push(formatError)
      }
    }

    return errors
  }

  private validateNumber(schema: JSONSchema, data: number, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minimum
    if (schema.minimum !== undefined) {
      if (schema.exclusiveMinimum === true) {
        if (data <= schema.minimum) {
          errors.push({
            path: path || 'root',
            message: `Number must be greater than ${schema.minimum}`,
            keyword: 'exclusiveMinimum',
            params: { limit: schema.minimum },
          })
        }
      } else if (data < schema.minimum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at least ${schema.minimum}`,
          keyword: 'minimum',
          params: { limit: schema.minimum },
        })
      }
    }

    // maximum
    if (schema.maximum !== undefined) {
      if (schema.exclusiveMaximum === true) {
        if (data >= schema.maximum) {
          errors.push({
            path: path || 'root',
            message: `Number must be less than ${schema.maximum}`,
            keyword: 'exclusiveMaximum',
            params: { limit: schema.maximum },
          })
        }
      } else if (data > schema.maximum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at most ${schema.maximum}`,
          keyword: 'maximum',
          params: { limit: schema.maximum },
        })
      }
    }

    // Integer check
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      errors.push({
        path: path || 'root',
        message: 'Number must be an integer',
        keyword: 'type',
        params: { expected: 'integer' },
      })
    }

    return errors
  }

  private validateFormat(format: string, data: string, path: string): ValidationError | null {
    const formatValidators: Record<string, (value: string) => boolean> = {
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      uri: (v) => {
        try {
          new URL(v)
          return true
        } catch {
          return false
        }
      },
      'date-time': (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v),
      date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      time: (v) => /^\d{2}:\d{2}:\d{2}/.test(v),
      uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
    }

    const validator = formatValidators[format]
    if (validator && !validator(data)) {
      return {
        path: path || 'root',
        message: `Invalid ${format} format`,
        keyword: 'format',
        params: { format },
      }
    }

    return null
  }
}

// ============================================================================
// CONTRACT REGISTRY
// ============================================================================

/**
 * ContractRegistry - Schema storage with discovery and lineage
 *
 * Implements the DataContract registry as a class that can be used
 * as a Durable Object or standalone. Uses DO storage patterns for
 * metadata and schema content.
 */
export class ContractRegistry {
  private storage: DurableObjectStorage
  private validator = new Validator()

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  // ============================================================================
  // SCHEMA REGISTRATION
  // ============================================================================

  /**
   * Publish a new contract version to the registry
   */
  async publish(input: PublishInput): Promise<ContractVersion> {
    // Validate version format
    if (!SchemaVersion.isValid(input.version)) {
      throw new Error(`Invalid version format: ${input.version}. Expected format: X.Y.Z`)
    }

    const now = new Date()
    const stored: StoredContract = {
      name: input.name,
      version: input.version,
      schema: input.schema,
      metadata: input.metadata,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    // Store contract at contract:{name}:{version}
    const key = `contract:${input.name}:${input.version}`
    await this.storage.put(key, stored)

    // Update version index for this contract
    await this.updateVersionIndex(input.name, input.version)

    return {
      name: input.name,
      version: input.version,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Update the version index for a contract
   */
  private async updateVersionIndex(name: string, version: string): Promise<void> {
    const indexKey = `versions:${name}`
    const existing = await this.storage.get<string[]>(indexKey)
    const versions = existing || []

    if (!versions.includes(version)) {
      versions.push(version)
      versions.sort(SchemaVersion.compare)
      await this.storage.put(indexKey, versions)
    }
  }

  /**
   * Get a contract by name and optional version
   * If version is not specified, returns the latest version
   */
  async get(name: string, version?: string): Promise<DataContract> {
    let targetVersion = version

    if (!targetVersion) {
      // Get latest version
      const versions = await this.getVersions(name)
      if (versions.length === 0) {
        throw new Error(`Contract not found: ${name}`)
      }
      targetVersion = versions[versions.length - 1]!
    }

    const key = `contract:${name}:${targetVersion}`
    const stored = await this.storage.get<StoredContract>(key)

    if (!stored) {
      throw new Error(`Contract version not found: ${name}@${targetVersion}`)
    }

    return {
      name: stored.name,
      version: stored.version,
      schema: stored.schema,
      metadata: stored.metadata,
      createdAt: new Date(stored.createdAt),
      updatedAt: new Date(stored.updatedAt),
    }
  }

  /**
   * Get all versions of a contract
   */
  async getVersions(name: string): Promise<string[]> {
    const indexKey = `versions:${name}`
    const versions = await this.storage.get<string[]>(indexKey)
    return versions || []
  }

  /**
   * Get version history with schema entries
   */
  async getVersionHistory(name: string): Promise<SchemaVersionEntry[]> {
    const versions = await this.getVersions(name)
    const entries: SchemaVersionEntry[] = []

    for (const version of versions) {
      const contract = await this.get(name, version)
      entries.push({
        version: contract.version,
        schema: contract.schema,
        metadata: contract.metadata,
        createdAt: contract.createdAt!,
      })
    }

    return entries
  }

  /**
   * Check if a contract exists
   */
  async exists(name: string, version?: string): Promise<boolean> {
    try {
      await this.get(name, version)
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a contract version
   */
  async delete(name: string, version: string): Promise<void> {
    const key = `contract:${name}:${version}`
    await this.storage.delete(key)

    // Update version index
    const indexKey = `versions:${name}`
    const versions = await this.storage.get<string[]>(indexKey)
    if (versions) {
      const updated = versions.filter(v => v !== version)
      if (updated.length === 0) {
        await this.storage.delete(indexKey)
      } else {
        await this.storage.put(indexKey, updated)
      }
    }

    // Clean up lineage relationships
    await this.deleteLineageForVersion(name, version)
  }

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  /**
   * List contracts with optional filters and pagination
   */
  async list(filter?: ContractFilter): Promise<ContractSummary[]> {
    // Get all contract keys
    const map = await this.storage.list({ prefix: 'versions:' })
    const results: ContractSummary[] = []

    for (const [key] of map) {
      const name = key.slice('versions:'.length)
      const versions = await this.getVersions(name)
      if (versions.length === 0) continue

      // Get latest version
      const latestVersion = versions[versions.length - 1]!
      const contract = await this.get(name, latestVersion)

      results.push(this.toSummary(contract))
    }

    // Apply filters
    let filtered = results

    if (filter?.namespace) {
      filtered = filtered.filter(c => c.namespace === filter.namespace)
    }

    if (filter?.owner) {
      filtered = filtered.filter(c => c.owner === filter.owner)
    }

    if (filter?.tags && filter.tags.length > 0) {
      filtered = filtered.filter(c => {
        const contractTags = c.tags || []
        return filter.tags!.some(tag => contractTags.includes(tag))
      })
    }

    if (filter?.deprecated !== undefined) {
      // Treat undefined/missing deprecated as false
      filtered = filtered.filter(c => (c.deprecated ?? false) === filter.deprecated)
    }

    if (filter?.search) {
      const searchLower = filter.search.toLowerCase()
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(searchLower) ||
        c.description?.toLowerCase().includes(searchLower)
      )
    }

    // Apply pagination
    const offset = filter?.offset || 0
    const limit = filter?.limit || 100

    return filtered.slice(offset, offset + limit)
  }

  /**
   * Search contracts by query string
   */
  async search(query: string): Promise<ContractSummary[]> {
    return this.list({ search: query })
  }

  /**
   * Find contracts by owner
   */
  async byOwner(owner: string): Promise<ContractSummary[]> {
    return this.list({ owner })
  }

  /**
   * Find contracts by tag
   */
  async byTag(tag: string): Promise<ContractSummary[]> {
    return this.list({ tags: [tag] })
  }

  /**
   * Find contracts by namespace
   */
  async byNamespace(namespace: string): Promise<ContractSummary[]> {
    return this.list({ namespace })
  }

  /**
   * Convert contract to summary
   */
  private toSummary(contract: DataContract): ContractSummary {
    return {
      name: contract.name,
      version: contract.version,
      namespace: contract.metadata?.namespace,
      owner: contract.metadata?.owner,
      tags: contract.metadata?.tags,
      deprecated: contract.metadata?.deprecated,
      deprecationMessage: contract.metadata?.deprecationMessage,
      description: contract.metadata?.description,
      createdAt: contract.createdAt!,
      updatedAt: contract.updatedAt!,
    }
  }

  // ============================================================================
  // DEPRECATION LIFECYCLE
  // ============================================================================

  /**
   * Mark a contract version as deprecated
   */
  async deprecate(name: string, version: string, options?: DeprecateOptions): Promise<void> {
    const contract = await this.get(name, version)

    const stored: StoredContract = {
      name: contract.name,
      version: contract.version,
      schema: contract.schema,
      metadata: {
        ...contract.metadata,
        deprecated: true,
        deprecationMessage: options?.message || `Contract ${name}@${version} is deprecated`,
      },
      createdAt: contract.createdAt!.toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const key = `contract:${name}:${version}`
    await this.storage.put(key, stored)

    // If replacedBy is specified, add a lineage relationship
    if (options?.replacedBy) {
      await this.addDependency(options.replacedBy.name, name, 'derived-from', {
        description: `Replaces deprecated ${name}@${version}`,
      })
    }
  }

  /**
   * Undeprecate a contract version
   */
  async undeprecate(name: string, version: string): Promise<void> {
    const contract = await this.get(name, version)

    const stored: StoredContract = {
      name: contract.name,
      version: contract.version,
      schema: contract.schema,
      metadata: {
        ...contract.metadata,
        deprecated: false,
        deprecationMessage: undefined,
      },
      createdAt: contract.createdAt!.toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const key = `contract:${name}:${version}`
    await this.storage.put(key, stored)
  }

  /**
   * Check if a contract version is deprecated
   */
  async isDeprecated(name: string, version?: string): Promise<boolean> {
    const contract = await this.get(name, version)
    return contract.metadata?.deprecated === true
  }

  // ============================================================================
  // LINEAGE TRACKING
  // ============================================================================

  /**
   * Add a dependency relationship between contracts
   */
  async addDependency(
    consumer: string,
    provider: string,
    type: LineageRelationType = 'consumes',
    options?: { consumerVersion?: string; providerVersion?: string; description?: string }
  ): Promise<LineageRelationship> {
    const relationship: LineageRelationship = {
      id: crypto.randomUUID(),
      type,
      fromContract: consumer,
      fromVersion: options?.consumerVersion,
      toContract: provider,
      toVersion: options?.providerVersion,
      description: options?.description,
      createdAt: new Date(),
    }

    // Store relationship
    const key = `lineage:${relationship.id}`
    await this.storage.put(key, {
      ...relationship,
      createdAt: relationship.createdAt.toISOString(),
    })

    // Index by source
    await this.addToLineageIndex(`lineage-from:${consumer}`, relationship.id)

    // Index by target
    await this.addToLineageIndex(`lineage-to:${provider}`, relationship.id)

    return relationship
  }

  /**
   * Remove a dependency relationship
   */
  async removeDependency(relationshipId: string): Promise<void> {
    const key = `lineage:${relationshipId}`
    const relationship = await this.storage.get<LineageRelationship & { createdAt: string }>(key)

    if (relationship) {
      await this.storage.delete(key)

      // Remove from indexes
      await this.removeFromLineageIndex(`lineage-from:${relationship.fromContract}`, relationshipId)
      await this.removeFromLineageIndex(`lineage-to:${relationship.toContract}`, relationshipId)
    }
  }

  /**
   * Get lineage graph for a contract
   */
  async getLineage(name: string, version?: string): Promise<LineageGraph> {
    const graph: LineageGraph = {
      contract: name,
      version,
      producers: [],
      consumers: [],
      derivedFrom: [],
      derivatives: [],
    }

    // Get relationships where this contract is the source (consuming)
    const fromIds = await this.storage.get<string[]>(`lineage-from:${name}`) || []
    for (const id of fromIds) {
      const rel = await this.getRelationship(id)
      if (rel) {
        if (rel.type === 'consumes') {
          graph.producers.push(rel)
        } else if (rel.type === 'derived-from') {
          graph.derivedFrom.push(rel)
        }
      }
    }

    // Get relationships where this contract is the target (being consumed)
    const toIds = await this.storage.get<string[]>(`lineage-to:${name}`) || []
    for (const id of toIds) {
      const rel = await this.getRelationship(id)
      if (rel) {
        if (rel.type === 'consumes') {
          graph.consumers.push(rel)
        } else if (rel.type === 'produces') {
          graph.producers.push(rel)
        } else if (rel.type === 'derived-from') {
          graph.derivatives.push(rel)
        }
      }
    }

    return graph
  }

  /**
   * Get all consumers of a contract
   */
  async getConsumers(name: string): Promise<string[]> {
    const lineage = await this.getLineage(name)
    return [...new Set(lineage.consumers.map(r => r.fromContract))]
  }

  /**
   * Get all providers (dependencies) of a contract
   */
  async getProviders(name: string): Promise<string[]> {
    const lineage = await this.getLineage(name)
    return [...new Set(lineage.producers.map(r => r.toContract))]
  }

  /**
   * Get a lineage relationship by ID
   */
  private async getRelationship(id: string): Promise<LineageRelationship | null> {
    const stored = await this.storage.get<LineageRelationship & { createdAt: string }>(`lineage:${id}`)
    if (!stored) return null

    return {
      ...stored,
      createdAt: new Date(stored.createdAt),
    }
  }

  /**
   * Add ID to lineage index
   */
  private async addToLineageIndex(indexKey: string, id: string): Promise<void> {
    const existing = await this.storage.get<string[]>(indexKey) || []
    if (!existing.includes(id)) {
      existing.push(id)
      await this.storage.put(indexKey, existing)
    }
  }

  /**
   * Remove ID from lineage index
   */
  private async removeFromLineageIndex(indexKey: string, id: string): Promise<void> {
    const existing = await this.storage.get<string[]>(indexKey) || []
    const updated = existing.filter(i => i !== id)
    if (updated.length === 0) {
      await this.storage.delete(indexKey)
    } else {
      await this.storage.put(indexKey, updated)
    }
  }

  /**
   * Delete all lineage relationships for a contract version
   */
  private async deleteLineageForVersion(name: string, version: string): Promise<void> {
    const fromIds = await this.storage.get<string[]>(`lineage-from:${name}`) || []
    const toIds = await this.storage.get<string[]>(`lineage-to:${name}`) || []

    const allIds = [...new Set([...fromIds, ...toIds])]

    for (const id of allIds) {
      const rel = await this.getRelationship(id)
      if (rel) {
        // Only delete if version matches (or if no version specified in relationship)
        if (!rel.fromVersion || rel.fromVersion === version ||
            !rel.toVersion || rel.toVersion === version) {
          await this.removeDependency(id)
        }
      }
    }
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate data against a registered contract
   */
  async validate(name: string, data: unknown, version?: string): Promise<ValidationResult> {
    const contract = await this.get(name, version)
    const errors = this.validator.validate(contract.schema, data)

    return {
      valid: errors.length === 0,
      errors: errors.map(e => ({
        path: e.path,
        message: e.message,
        keyword: e.keyword,
        params: e.params,
      })),
      data: errors.length === 0 ? data : undefined,
    }
  }

  // ============================================================================
  // COMPATIBILITY CHECKING
  // ============================================================================

  /**
   * Check compatibility between current and new schema
   */
  async checkCompatibility(name: string, newVersion: string, newSchema: JSONSchema): Promise<CompatibilityCheck> {
    const breakingChanges: string[] = []
    const warnings: string[] = []

    try {
      const current = await this.get(name)
      const schemaDiff = this.diff(current.schema, newSchema)

      // Check for breaking changes
      for (const field of schemaDiff.removedFields) {
        const wasRequired = current.schema.required?.includes(field)
        if (wasRequired) {
          breakingChanges.push(`Breaking: Required field '${field}' was removed`)
        } else {
          warnings.push(`Warning: Optional field '${field}' was removed`)
        }
      }

      for (const change of schemaDiff.changedRequired) {
        if (!change.wasRequired && change.isRequired) {
          breakingChanges.push(`Breaking: Field '${change.field}' became required`)
        } else if (change.wasRequired && !change.isRequired) {
          warnings.push(`Info: Field '${change.field}' became optional`)
        }
      }

      for (const change of schemaDiff.changedTypes) {
        breakingChanges.push(`Breaking: Field '${change.field}' type changed from ${change.from} to ${change.to}`)
      }

      for (const field of schemaDiff.addedFields) {
        const isRequired = newSchema.required?.includes(field)
        if (isRequired) {
          breakingChanges.push(`Breaking: New required field '${field}' was added`)
        }
      }

      // Determine suggested version bump
      let suggestedVersionBump: 'major' | 'minor' | 'patch' = 'patch'
      if (breakingChanges.length > 0) {
        suggestedVersionBump = 'major'
      } else if (schemaDiff.addedFields.length > 0 || warnings.length > 0) {
        suggestedVersionBump = 'minor'
      }

      return {
        compatible: breakingChanges.length === 0,
        breakingChanges,
        warnings,
        suggestedVersionBump,
      }
    } catch {
      // No existing schema, so any schema is compatible
      return {
        compatible: true,
        breakingChanges: [],
        warnings: [],
        suggestedVersionBump: 'minor',
      }
    }
  }

  /**
   * Calculate diff between two schemas
   */
  diff(oldSchema: JSONSchema, newSchema: JSONSchema): SchemaDiff {
    const addedFields: string[] = []
    const removedFields: string[] = []
    const changedTypes: Array<{ field: string; from: string; to: string }> = []
    const changedRequired: Array<{ field: string; wasRequired: boolean; isRequired: boolean }> = []

    const oldProps = oldSchema.properties || {}
    const newProps = newSchema.properties || {}
    const oldRequired = new Set(oldSchema.required || [])
    const newRequired = new Set(newSchema.required || [])

    // Find added and changed fields
    for (const field of Object.keys(newProps)) {
      if (!(field in oldProps)) {
        addedFields.push(field)
      } else {
        // Check type changes
        const oldType = this.getSchemaType(oldProps[field]!)
        const newType = this.getSchemaType(newProps[field]!)
        if (oldType !== newType) {
          changedTypes.push({ field, from: oldType, to: newType })
        }
      }
    }

    // Find removed fields
    for (const field of Object.keys(oldProps)) {
      if (!(field in newProps)) {
        removedFields.push(field)
      }
    }

    // Find required changes (for fields that exist in both)
    const allFieldsSet = new Set([...Object.keys(oldProps), ...Object.keys(newProps)])
    for (const field of allFieldsSet) {
      const wasRequired = oldRequired.has(field)
      const isRequired = newRequired.has(field)
      if (wasRequired !== isRequired && field in oldProps && field in newProps) {
        changedRequired.push({ field, wasRequired, isRequired })
      }
    }

    return { addedFields, removedFields, changedTypes, changedRequired }
  }

  private getSchemaType(schema: JSONSchema): string {
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ')
    }
    return schema.type || 'any'
  }

  // ============================================================================
  // MIGRATION
  // ============================================================================

  /**
   * Generate migration from one version to a new schema
   */
  async generateMigration(name: string, fromVersion: string, toSchema: JSONSchema): Promise<Migration> {
    const fromContract = await this.get(name, fromVersion)
    const diff = this.diff(fromContract.schema, toSchema)
    const changes: MigrationChange[] = []

    // Add removals
    for (const field of diff.removedFields) {
      changes.push({ type: 'remove', field })
    }

    // Add additions
    for (const field of diff.addedFields) {
      const propSchema = toSchema.properties?.[field]
      changes.push({
        type: 'add',
        field,
        defaultValue: propSchema?.default ?? this.getDefaultValue(propSchema),
      })
    }

    return {
      fromVersion,
      toVersion: SchemaVersion.bump(fromVersion, 'major'),
      changes,
    }
  }

  private getDefaultValue(schema?: JSONSchema): unknown {
    if (!schema) return undefined
    switch (schema.type) {
      case 'string':
        return ''
      case 'number':
      case 'integer':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return null
    }
  }

  /**
   * Apply migration to data
   */
  applyMigration(data: Record<string, unknown>, migration: Migration): Record<string, unknown> {
    const result = { ...data }

    for (const change of migration.changes) {
      switch (change.type) {
        case 'remove':
          if (change.field) {
            delete result[change.field]
          }
          break
        case 'add':
          if (change.field && !(change.field in result)) {
            result[change.field] = change.defaultValue
          }
          break
        case 'rename':
          if (change.from && change.to && change.from in result) {
            result[change.to] = result[change.from]
            delete result[change.from]
          }
          break
        case 'transform':
          if (change.field && change.transform && change.field in result) {
            result[change.field] = change.transform(result[change.field])
          }
          break
      }
    }

    return result
  }

  // ============================================================================
  // TYPESCRIPT GENERATION
  // ============================================================================

  /**
   * Generate TypeScript interface from schema
   */
  async generateTypes(name: string, version?: string): Promise<string> {
    const contract = await this.get(name, version)
    const interfaceName = this.toPascalCase(name)

    return this.generateTypeForSchema(contract.schema, interfaceName, contract.schema.required || [])
  }

  private generateTypeForSchema(schema: JSONSchema, name: string, required: string[], indent = ''): string {
    const lines: string[] = []
    lines.push(`${indent}interface ${name} {`)

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = required.includes(propName)
        const optional = isRequired ? '' : '?'
        const propType = this.schemaToTypeScript(propSchema)
        lines.push(`${indent}  ${propName}${optional}: ${propType};`)
      }
    }

    lines.push(`${indent}}`)
    return lines.join('\n')
  }

  private schemaToTypeScript(schema: JSONSchema): string {
    // Handle arrays of types (nullable)
    if (Array.isArray(schema.type)) {
      const types = schema.type.map((t) => this.primitiveTypeToTS(t))
      return types.join(' | ')
    }

    // Handle enums
    if (schema.enum) {
      return schema.enum.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(' | ')
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      const itemType = this.schemaToTypeScript(schema.items)
      return `${itemType}[]`
    }

    // Handle objects
    if (schema.type === 'object' && schema.properties) {
      const props: string[] = []
      const required = schema.required || []
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = required.includes(propName)
        const optional = isRequired ? '' : '?'
        const propType = this.schemaToTypeScript(propSchema)
        props.push(`${propName}${optional}: ${propType}`)
      }
      return `{ ${props.join('; ')} }`
    }

    // Handle primitives
    return this.primitiveTypeToTS(schema.type)
  }

  private primitiveTypeToTS(type?: string | string[]): string {
    if (Array.isArray(type)) {
      return type.map(t => this.primitiveTypeToTS(t)).join(' | ')
    }
    switch (type) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'object':
        return 'Record<string, unknown>'
      case 'array':
        return 'unknown[]'
      default:
        return 'unknown'
    }
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a ContractRegistry instance with the given storage
 */
export function createContractRegistry(storage: DurableObjectStorage): ContractRegistry {
  return new ContractRegistry(storage)
}
