/**
 * FunctionRegistry
 *
 * Registry for discovering and managing function definitions.
 * Provides:
 * - Function registration and lookup
 * - Discovery by type, tags, or name patterns
 * - Metadata management
 * - Validation of function definitions
 */

import type {
  FunctionConfig,
  FunctionType,
  CodeFunctionConfig,
  GenerativeFunctionConfig,
  AgenticFunctionConfig,
  HumanFunctionConfig,
} from '../executors/BaseFunctionExecutor'

// ============================================================================
// TYPES
// ============================================================================

export interface FunctionMetadata {
  name: string
  type: FunctionType
  description?: string
  tags?: string[]
  version?: string
  author?: string
  deprecated?: boolean
  deprecationMessage?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface RegisteredFunction<T extends FunctionConfig = FunctionConfig> {
  config: T
  metadata: FunctionMetadata
}

export type FunctionFilter = {
  type?: FunctionType | FunctionType[]
  tags?: string[]
  name?: string | RegExp
  deprecated?: boolean
}

export interface RegistryStats {
  total: number
  byType: Record<FunctionType, number>
  deprecated: number
  tags: Map<string, number>
}

// ============================================================================
// ERRORS
// ============================================================================

export class FunctionNotFoundError extends Error {
  constructor(name: string) {
    super(`Function not found: ${name}`)
    this.name = 'FunctionNotFoundError'
  }
}

export class FunctionAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Function already exists: ${name}`)
    this.name = 'FunctionAlreadyExistsError'
  }
}

export class FunctionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunctionValidationError'
  }
}

// ============================================================================
// FUNCTION REGISTRY
// ============================================================================

export class FunctionRegistry {
  private functions: Map<string, RegisteredFunction> = new Map()
  private tagIndex: Map<string, Set<string>> = new Map()
  private typeIndex: Map<FunctionType, Set<string>> = new Map()

  constructor() {
    // Initialize type index
    const types: FunctionType[] = ['code', 'generative', 'agentic', 'human']
    for (const type of types) {
      this.typeIndex.set(type, new Set())
    }
  }

  /**
   * Register a function configuration
   */
  register<T extends FunctionConfig>(
    config: T,
    metadata?: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): this {
    const name = config.name

    // Validate
    this.validateConfig(config)

    // Check for duplicates
    if (this.functions.has(name)) {
      throw new FunctionAlreadyExistsError(name)
    }

    // Build full metadata
    const fullMetadata: FunctionMetadata = {
      name,
      type: config.type,
      description: config.description ?? metadata?.description,
      tags: metadata?.tags ?? [],
      version: metadata?.version ?? '1.0.0',
      author: metadata?.author,
      deprecated: metadata?.deprecated ?? false,
      deprecationMessage: metadata?.deprecationMessage,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Store function
    this.functions.set(name, {
      config,
      metadata: fullMetadata,
    })

    // Update type index
    this.typeIndex.get(config.type)?.add(name)

    // Update tag index
    for (const tag of fullMetadata.tags ?? []) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set())
      }
      this.tagIndex.get(tag)?.add(name)
    }

    return this
  }

  /**
   * Register a code function
   */
  registerCode(
    config: Omit<CodeFunctionConfig, 'type'>,
    metadata?: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): this {
    return this.register({ ...config, type: 'code' } as CodeFunctionConfig, metadata)
  }

  /**
   * Register a generative function
   */
  registerGenerative(
    config: Omit<GenerativeFunctionConfig, 'type'>,
    metadata?: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): this {
    return this.register({ ...config, type: 'generative' } as GenerativeFunctionConfig, metadata)
  }

  /**
   * Register an agentic function
   */
  registerAgentic(
    config: Omit<AgenticFunctionConfig, 'type'>,
    metadata?: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): this {
    return this.register({ ...config, type: 'agentic' } as AgenticFunctionConfig, metadata)
  }

  /**
   * Register a human function
   */
  registerHuman(
    config: Omit<HumanFunctionConfig, 'type'>,
    metadata?: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): this {
    return this.register({ ...config, type: 'human' } as HumanFunctionConfig, metadata)
  }

  /**
   * Unregister a function
   */
  unregister(name: string): boolean {
    const fn = this.functions.get(name)
    if (!fn) {
      return false
    }

    // Remove from functions
    this.functions.delete(name)

    // Remove from type index
    this.typeIndex.get(fn.config.type)?.delete(name)

    // Remove from tag index
    for (const tag of fn.metadata.tags ?? []) {
      this.tagIndex.get(tag)?.delete(name)
      // Clean up empty tag sets
      if (this.tagIndex.get(tag)?.size === 0) {
        this.tagIndex.delete(tag)
      }
    }

    return true
  }

  /**
   * Get a function by name
   */
  get<T extends FunctionConfig = FunctionConfig>(name: string): RegisteredFunction<T> | undefined {
    return this.functions.get(name) as RegisteredFunction<T> | undefined
  }

  /**
   * Get a function or throw if not found
   */
  getOrThrow<T extends FunctionConfig = FunctionConfig>(name: string): RegisteredFunction<T> {
    const fn = this.get<T>(name)
    if (!fn) {
      throw new FunctionNotFoundError(name)
    }
    return fn
  }

  /**
   * Check if a function exists
   */
  has(name: string): boolean {
    return this.functions.has(name)
  }

  /**
   * List all function names
   */
  list(): string[] {
    return Array.from(this.functions.keys())
  }

  /**
   * Find functions matching a filter
   */
  find(filter: FunctionFilter): RegisteredFunction[] {
    const results: RegisteredFunction[] = []

    // Start with type filter (most efficient)
    let candidates: Set<string> | undefined

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      candidates = new Set()
      for (const type of types) {
        const typeNames = this.typeIndex.get(type)
        if (typeNames) {
          for (const name of typeNames) {
            candidates.add(name)
          }
        }
      }
    }

    // Intersect with tag filter
    if (filter.tags && filter.tags.length > 0) {
      const tagCandidates = new Set<string>()
      for (const tag of filter.tags) {
        const tagNames = this.tagIndex.get(tag)
        if (tagNames) {
          for (const name of tagNames) {
            tagCandidates.add(name)
          }
        }
      }

      if (candidates) {
        // Intersect with type candidates
        candidates = new Set(
          Array.from(candidates).filter((name) => tagCandidates.has(name))
        )
      } else {
        candidates = tagCandidates
      }
    }

    // Default to all functions if no type/tag filter
    const namestoCheck = candidates ?? this.functions.keys()

    for (const name of namestoCheck) {
      const fn = this.functions.get(name)
      if (!fn) continue

      // Apply name filter
      if (filter.name) {
        if (typeof filter.name === 'string') {
          if (!fn.metadata.name.includes(filter.name)) continue
        } else {
          if (!filter.name.test(fn.metadata.name)) continue
        }
      }

      // Apply deprecated filter
      if (filter.deprecated !== undefined) {
        if (fn.metadata.deprecated !== filter.deprecated) continue
      }

      results.push(fn)
    }

    return results
  }

  /**
   * Find functions by type
   */
  findByType<T extends FunctionConfig = FunctionConfig>(
    type: FunctionType
  ): RegisteredFunction<T>[] {
    return this.find({ type }) as RegisteredFunction<T>[]
  }

  /**
   * Find functions by tag
   */
  findByTag(tag: string): RegisteredFunction[] {
    return this.find({ tags: [tag] })
  }

  /**
   * Find functions by tags (all tags must match)
   */
  findByTags(tags: string[]): RegisteredFunction[] {
    // Get intersection of all tag sets
    const sets = tags
      .map((tag) => this.tagIndex.get(tag))
      .filter((s): s is Set<string> => s !== undefined)

    if (sets.length === 0) {
      return []
    }

    // Find intersection
    let intersection = new Set(sets[0])
    for (let i = 1; i < sets.length; i++) {
      intersection = new Set(
        Array.from(intersection).filter((name) => sets[i]!.has(name))
      )
    }

    return Array.from(intersection)
      .map((name) => this.functions.get(name))
      .filter((fn): fn is RegisteredFunction => fn !== undefined)
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const stats: RegistryStats = {
      total: this.functions.size,
      byType: {
        code: 0,
        generative: 0,
        agentic: 0,
        human: 0,
      },
      deprecated: 0,
      tags: new Map(),
    }

    for (const [type, names] of this.typeIndex) {
      stats.byType[type] = names.size
    }

    for (const [tag, names] of this.tagIndex) {
      stats.tags.set(tag, names.size)
    }

    for (const fn of this.functions.values()) {
      if (fn.metadata.deprecated) {
        stats.deprecated++
      }
    }

    return stats
  }

  /**
   * Get all registered tags
   */
  getTags(): string[] {
    return Array.from(this.tagIndex.keys())
  }

  /**
   * Update function metadata
   */
  updateMetadata(
    name: string,
    updates: Partial<Omit<FunctionMetadata, 'name' | 'type'>>
  ): boolean {
    const fn = this.functions.get(name)
    if (!fn) {
      return false
    }

    // Handle tag changes
    const oldTags = new Set(fn.metadata.tags ?? [])
    const newTags = new Set(updates.tags ?? fn.metadata.tags ?? [])

    // Remove from old tags
    for (const tag of oldTags) {
      if (!newTags.has(tag)) {
        this.tagIndex.get(tag)?.delete(name)
        if (this.tagIndex.get(tag)?.size === 0) {
          this.tagIndex.delete(tag)
        }
      }
    }

    // Add to new tags
    for (const tag of newTags) {
      if (!oldTags.has(tag)) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set())
        }
        this.tagIndex.get(tag)?.add(name)
      }
    }

    // Update metadata
    fn.metadata = {
      ...fn.metadata,
      ...updates,
      updatedAt: new Date(),
    }

    return true
  }

  /**
   * Mark a function as deprecated
   */
  deprecate(name: string, message?: string): boolean {
    return this.updateMetadata(name, {
      deprecated: true,
      deprecationMessage: message,
    })
  }

  /**
   * Clear all registered functions
   */
  clear(): void {
    this.functions.clear()
    this.tagIndex.clear()
    for (const type of this.typeIndex.keys()) {
      this.typeIndex.set(type, new Set())
    }
  }

  /**
   * Export registry as JSON
   */
  toJSON(): { functions: Array<{ config: FunctionConfig; metadata: FunctionMetadata }> } {
    return {
      functions: Array.from(this.functions.values()).map((fn) => ({
        config: fn.config,
        metadata: fn.metadata,
      })),
    }
  }

  /**
   * Import functions from JSON
   */
  fromJSON(data: { functions: Array<{ config: FunctionConfig; metadata: FunctionMetadata }> }): this {
    for (const { config, metadata } of data.functions) {
      this.register(config, metadata)
    }
    return this
  }

  /**
   * Validate a function configuration
   */
  private validateConfig(config: FunctionConfig): void {
    if (!config.name) {
      throw new FunctionValidationError('Function name is required')
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.name)) {
      throw new FunctionValidationError(
        `Invalid function name: ${config.name}. Names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }

    switch (config.type) {
      case 'code':
        if (typeof config.handler !== 'function') {
          throw new FunctionValidationError('Code function requires a handler function')
        }
        break

      case 'generative':
        if (!config.model) {
          throw new FunctionValidationError('Generative function requires a model')
        }
        if (!config.prompt) {
          throw new FunctionValidationError('Generative function requires a prompt')
        }
        break

      case 'agentic':
        if (!config.model) {
          throw new FunctionValidationError('Agentic function requires a model')
        }
        if (!config.goal) {
          throw new FunctionValidationError('Agentic function requires a goal')
        }
        if (!Array.isArray(config.tools)) {
          throw new FunctionValidationError('Agentic function requires tools array')
        }
        break

      case 'human':
        if (!config.channel) {
          throw new FunctionValidationError('Human function requires a channel')
        }
        if (!config.prompt) {
          throw new FunctionValidationError('Human function requires a prompt')
        }
        break

      default:
        throw new FunctionValidationError(`Unknown function type: ${(config as { type: string }).type}`)
    }
  }
}

// Singleton instance for convenience
let defaultRegistry: FunctionRegistry | null = null

export function getDefaultRegistry(): FunctionRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new FunctionRegistry()
  }
  return defaultRegistry
}

export function createRegistry(): FunctionRegistry {
  return new FunctionRegistry()
}

export default FunctionRegistry
