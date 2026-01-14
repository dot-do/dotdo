/**
 * Transformation Tracking for Data Lineage
 *
 * Tracks non-SQL transformations and pipeline operations to build complete lineage graphs.
 * Supports code transformations, pipeline stages, external tool outputs, and manual data entry.
 *
 * ## Transformation Types
 * - Code transformations (TypeScript/Python functions)
 * - Pipeline stages (map, filter, aggregate)
 * - External tool outputs (dbt, Airflow)
 * - Manual data entry points
 *
 * ## Capture Methods
 * - Explicit annotation: `@tracked` decorator
 * - Implicit capture: Wrap data operations with LineageContext
 * - Import: Parse external lineage metadata
 *
 * @module db/primitives/lineage-tracker/transformation
 */

import type { LineageNode, CreateNodeInput, CreateEdgeInput } from './types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Types of transformations that can be tracked
 */
export type TransformKind =
  | 'code' // TypeScript/JavaScript/Python functions
  | 'pipeline' // Pipeline stages (map, filter, aggregate, etc.)
  | 'external' // External tool outputs (dbt, Airflow, Spark)
  | 'manual' // Manual data entry or modification
  | 'copy' // Direct copy without transformation
  | 'unknown' // Transformation type not specified

/**
 * Pipeline operation types
 */
export type PipelineOperation =
  | 'map'
  | 'filter'
  | 'reduce'
  | 'aggregate'
  | 'join'
  | 'union'
  | 'sort'
  | 'distinct'
  | 'limit'
  | 'custom'

/**
 * External tool identifiers
 */
export type ExternalTool = 'dbt' | 'airflow' | 'spark' | 'beam' | 'flink' | 'prefect' | 'dagster' | 'other'

/**
 * Asset identifier - references a data asset in the lineage graph
 */
export interface AssetRef {
  /** Unique ID of the asset node */
  id?: string
  /** Type of node (defaults to 'entity') */
  type?: 'entity' | 'source' | 'sink' | 'transformation'
  /** Human-readable name */
  name: string
  /** Namespace (database, schema, service) */
  namespace?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Schema definition for input/output data
 */
export interface SchemaDefinition {
  /** Fields in the schema */
  fields: SchemaField[]
  /** Schema format (e.g., 'json-schema', 'avro', 'protobuf') */
  format?: string
  /** Schema version */
  version?: string
}

/**
 * Individual field in a schema
 */
export interface SchemaField {
  /** Field name */
  name: string
  /** Field type */
  type: string
  /** Whether the field is nullable */
  nullable?: boolean
  /** Field description */
  description?: string
  /** Nested fields (for objects/arrays) */
  fields?: SchemaField[]
}

/**
 * Runtime metrics captured during transformation execution
 */
export interface RuntimeMetrics {
  /** Number of input records processed */
  inputRecords?: number
  /** Number of output records produced */
  outputRecords?: number
  /** Execution duration in milliseconds */
  durationMs?: number
  /** Memory usage in bytes */
  memoryBytes?: number
  /** CPU time in milliseconds */
  cpuTimeMs?: number
  /** Number of errors encountered */
  errorCount?: number
  /** Custom metrics */
  custom?: Record<string, number>
}

/**
 * Transformation metadata - captures all details about a transformation
 */
export interface TransformMeta {
  /** Type of transformation */
  kind: TransformKind
  /** Human-readable name */
  name: string
  /** Description of what the transformation does */
  description?: string

  // Code transformation details
  /** Source code of the transformation (for code type) */
  code?: string
  /** Programming language */
  language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'
  /** Function signature */
  signature?: string

  // Pipeline transformation details
  /** Pipeline operation type */
  pipelineOp?: PipelineOperation
  /** Pipeline configuration */
  pipelineConfig?: Record<string, unknown>

  // External tool details
  /** External tool that produced this transformation */
  externalTool?: ExternalTool
  /** Job/task name in the external tool */
  jobName?: string
  /** Run ID from the external tool */
  runId?: string
  /** External tool-specific metadata */
  externalMeta?: Record<string, unknown>

  // Schema information
  /** Input schema */
  inputSchema?: SchemaDefinition
  /** Output schema */
  outputSchema?: SchemaDefinition

  // Execution details
  /** Execution timestamp (epoch ms) */
  executedAt?: number
  /** User or service that executed the transformation */
  executedBy?: string
  /** Runtime metrics */
  metrics?: RuntimeMetrics

  // Additional metadata
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Tags for categorization */
  tags?: string[]
}

/**
 * Result of tracking a transformation
 */
export interface TrackingResult {
  /** Created/referenced input nodes */
  inputs: LineageNode[]
  /** Created/referenced output nodes */
  outputs: LineageNode[]
  /** Transformation node created */
  transformation: LineageNode
  /** Edges connecting inputs to transformation */
  inputEdges: { id: string; fromNodeId: string; toNodeId: string }[]
  /** Edges connecting transformation to outputs */
  outputEdges: { id: string; fromNodeId: string; toNodeId: string }[]
  /** Timestamp of tracking */
  trackedAt: number
}

/**
 * Options for the @tracked decorator
 */
export interface TrackedOptions {
  /** Transformation name (defaults to function name) */
  name?: string
  /** Transformation kind (defaults to 'code') */
  kind?: TransformKind
  /** Description */
  description?: string
  /** Input asset names (will be resolved at runtime) */
  inputs?: string[]
  /** Output asset names (will be resolved at runtime) */
  outputs?: string[]
  /** Capture input/output schemas automatically */
  captureSchemas?: boolean
  /** Capture runtime metrics automatically */
  captureMetrics?: boolean
  /** Additional tags */
  tags?: string[]
}

/**
 * Context for manual lineage tracking within a scope
 */
export interface LineageContextOptions {
  /** Context name (e.g., pipeline name) */
  name: string
  /** Parent context ID (for nested contexts) */
  parentId?: string
  /** Default transformation kind */
  defaultKind?: TransformKind
  /** Default namespace for assets */
  defaultNamespace?: string
  /** Tags applied to all tracked transformations */
  tags?: string[]
}

/**
 * Transformation tracker interface
 */
export interface TransformationTracker {
  /**
   * Track a transformation between data assets
   *
   * @param inputs - Input assets (sources of data)
   * @param outputs - Output assets (destinations of data)
   * @param transform - Transformation metadata
   * @returns Tracking result with created nodes and edges
   */
  trackTransformation(inputs: AssetRef[], outputs: AssetRef[], transform: TransformMeta): TrackingResult

  /**
   * Track a code transformation (convenience method)
   */
  trackCode(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      code?: string
      language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'
      description?: string
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track a pipeline stage (convenience method)
   */
  trackPipeline(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      operation: PipelineOperation
      config?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track an external tool execution (convenience method)
   */
  trackExternal(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      tool: ExternalTool
      jobName?: string
      runId?: string
      externalMeta?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track manual data entry/modification
   */
  trackManual(
    outputs: AssetRef[],
    options: {
      name: string
      description?: string
      modifiedBy?: string
      reason?: string
    }
  ): TrackingResult

  /**
   * Get transformation history for an asset
   */
  getTransformationHistory(assetId: string): TransformMeta[]

  /**
   * Create a lineage context for scoped tracking
   */
  createContext(options: LineageContextOptions): LineageContext
}

/**
 * Lineage context for scoped, manual tracking
 */
export interface LineageContext {
  /** Context ID */
  readonly id: string
  /** Context name */
  readonly name: string

  /**
   * Begin tracking a transformation within this context
   */
  begin(
    name: string,
    options?: {
      kind?: TransformKind
      description?: string
      inputs?: AssetRef[]
    }
  ): TransformationScope

  /**
   * Record a simple transformation (no explicit scope)
   */
  record(inputs: AssetRef[], outputs: AssetRef[], transform: Partial<TransformMeta>): TrackingResult

  /**
   * Get all transformations tracked in this context
   */
  getTransformations(): TrackingResult[]

  /**
   * End the context (finalizes any pending tracking)
   */
  end(): void
}

/**
 * Scope for tracking a single transformation
 */
export interface TransformationScope {
  /** Scope ID */
  readonly id: string

  /**
   * Add an input asset to this transformation
   */
  addInput(asset: AssetRef): void

  /**
   * Add an output asset to this transformation
   */
  addOutput(asset: AssetRef): void

  /**
   * Set the transformation code
   */
  setCode(code: string, language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'): void

  /**
   * Set runtime metrics
   */
  setMetrics(metrics: RuntimeMetrics): void

  /**
   * Set input/output schemas
   */
  setSchemas(input?: SchemaDefinition, output?: SchemaDefinition): void

  /**
   * Complete the transformation tracking
   */
  complete(): TrackingResult

  /**
   * Abort the transformation tracking (e.g., on error)
   */
  abort(error?: Error): void
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Lineage store interface (minimal interface for transformation tracking)
 */
interface LineageStoreAdapter {
  createNode(input: CreateNodeInput): LineageNode
  getNode(id: string): LineageNode | null
  createEdge(input: CreateEdgeInput): { id: string; fromNodeId: string; toNodeId: string }
  findNodes(query?: { type?: string; namespace?: string; nameContains?: string }): LineageNode[]
}

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Implementation of TransformationScope
 */
class TransformationScopeImpl implements TransformationScope {
  readonly id: string
  private inputs: AssetRef[] = []
  private outputs: AssetRef[] = []
  private transform: Partial<TransformMeta>
  private completed = false
  private aborted = false
  private startTime: number
  private readonly tracker: TransformationTrackerImpl
  private readonly contextId: string

  constructor(tracker: TransformationTrackerImpl, contextId: string, name: string, options?: Partial<TransformMeta>) {
    this.id = generateId('scope')
    this.tracker = tracker
    this.contextId = contextId
    this.transform = {
      kind: options?.kind ?? 'code',
      name,
      description: options?.description,
      ...options,
    }
    this.startTime = Date.now()

    // Add initial inputs if provided
    if (options?.metadata?.['initialInputs']) {
      const initialInputs = options.metadata['initialInputs'] as AssetRef[]
      this.inputs.push(...initialInputs)
    }
  }

  addInput(asset: AssetRef): void {
    if (this.completed || this.aborted) {
      throw new Error('Cannot modify completed or aborted scope')
    }
    this.inputs.push(asset)
  }

  addOutput(asset: AssetRef): void {
    if (this.completed || this.aborted) {
      throw new Error('Cannot modify completed or aborted scope')
    }
    this.outputs.push(asset)
  }

  setCode(code: string, language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'): void {
    if (this.completed || this.aborted) {
      throw new Error('Cannot modify completed or aborted scope')
    }
    this.transform.code = code
    if (language) {
      this.transform.language = language
    }
  }

  setMetrics(metrics: RuntimeMetrics): void {
    if (this.completed || this.aborted) {
      throw new Error('Cannot modify completed or aborted scope')
    }
    this.transform.metrics = metrics
  }

  setSchemas(input?: SchemaDefinition, output?: SchemaDefinition): void {
    if (this.completed || this.aborted) {
      throw new Error('Cannot modify completed or aborted scope')
    }
    if (input) {
      this.transform.inputSchema = input
    }
    if (output) {
      this.transform.outputSchema = output
    }
  }

  complete(): TrackingResult {
    if (this.completed) {
      throw new Error('Scope already completed')
    }
    if (this.aborted) {
      throw new Error('Cannot complete aborted scope')
    }

    this.completed = true

    // Calculate duration if not set
    if (!this.transform.metrics?.durationMs) {
      this.transform.metrics = {
        ...this.transform.metrics,
        durationMs: Date.now() - this.startTime,
      }
    }

    // Set execution timestamp
    this.transform.executedAt = this.startTime

    return this.tracker.trackTransformation(this.inputs, this.outputs, this.transform as TransformMeta)
  }

  abort(error?: Error): void {
    if (this.completed) {
      throw new Error('Cannot abort completed scope')
    }
    this.aborted = true

    // Optionally track failed transformation
    if (error) {
      this.transform.metadata = {
        ...this.transform.metadata,
        aborted: true,
        error: error.message,
        errorStack: error.stack,
      }
    }
  }
}

/**
 * Implementation of LineageContext
 */
class LineageContextImpl implements LineageContext {
  readonly id: string
  readonly name: string
  private readonly tracker: TransformationTrackerImpl
  private readonly options: LineageContextOptions
  private transformations: TrackingResult[] = []
  private ended = false

  constructor(tracker: TransformationTrackerImpl, options: LineageContextOptions) {
    this.id = generateId('ctx')
    this.name = options.name
    this.tracker = tracker
    this.options = options
  }

  begin(
    name: string,
    options?: {
      kind?: TransformKind
      description?: string
      inputs?: AssetRef[]
    }
  ): TransformationScope {
    if (this.ended) {
      throw new Error('Cannot begin transformation in ended context')
    }

    return new TransformationScopeImpl(this.tracker, this.id, name, {
      kind: options?.kind ?? this.options.defaultKind ?? 'code',
      description: options?.description,
      tags: this.options.tags,
      metadata: {
        contextId: this.id,
        contextName: this.name,
        initialInputs: options?.inputs,
      },
    })
  }

  record(inputs: AssetRef[], outputs: AssetRef[], transform: Partial<TransformMeta>): TrackingResult {
    if (this.ended) {
      throw new Error('Cannot record transformation in ended context')
    }

    // Apply context defaults
    const fullTransform: TransformMeta = {
      kind: transform.kind ?? this.options.defaultKind ?? 'code',
      name: transform.name ?? 'unnamed',
      ...transform,
      tags: [...(this.options.tags ?? []), ...(transform.tags ?? [])],
      metadata: {
        ...transform.metadata,
        contextId: this.id,
        contextName: this.name,
      },
    }

    // Apply default namespace to assets
    const normalizedInputs = inputs.map((i) => ({
      ...i,
      namespace: i.namespace ?? this.options.defaultNamespace,
    }))
    const normalizedOutputs = outputs.map((o) => ({
      ...o,
      namespace: o.namespace ?? this.options.defaultNamespace,
    }))

    const result = this.tracker.trackTransformation(normalizedInputs, normalizedOutputs, fullTransform)
    this.transformations.push(result)
    return result
  }

  getTransformations(): TrackingResult[] {
    return [...this.transformations]
  }

  end(): void {
    this.ended = true
  }
}

/**
 * Implementation of TransformationTracker
 */
export class TransformationTrackerImpl implements TransformationTracker {
  private readonly store: LineageStoreAdapter
  private transformationHistory: Map<string, TransformMeta[]> = new Map()

  constructor(store: LineageStoreAdapter) {
    this.store = store
  }

  trackTransformation(inputs: AssetRef[], outputs: AssetRef[], transform: TransformMeta): TrackingResult {
    const trackedAt = Date.now()

    // Create or get input nodes
    const inputNodes: LineageNode[] = inputs.map((input) => {
      if (input.id) {
        const existing = this.store.getNode(input.id)
        if (existing) return existing
      }

      return this.store.createNode({
        id: input.id,
        type: input.type ?? 'entity',
        name: input.name,
        namespace: input.namespace,
        metadata: input.metadata,
      })
    })

    // Create or get output nodes
    const outputNodes: LineageNode[] = outputs.map((output) => {
      if (output.id) {
        const existing = this.store.getNode(output.id)
        if (existing) return existing
      }

      return this.store.createNode({
        id: output.id,
        type: output.type ?? 'entity',
        name: output.name,
        namespace: output.namespace,
        metadata: output.metadata,
      })
    })

    // Create transformation node
    const transformNode = this.store.createNode({
      type: 'transformation',
      name: transform.name,
      namespace: transform.metadata?.['namespace'] as string | undefined,
      metadata: {
        kind: transform.kind,
        description: transform.description,
        code: transform.code,
        language: transform.language,
        signature: transform.signature,
        pipelineOp: transform.pipelineOp,
        pipelineConfig: transform.pipelineConfig,
        externalTool: transform.externalTool,
        jobName: transform.jobName,
        runId: transform.runId,
        externalMeta: transform.externalMeta,
        inputSchema: transform.inputSchema,
        outputSchema: transform.outputSchema,
        executedAt: transform.executedAt ?? trackedAt,
        executedBy: transform.executedBy,
        metrics: transform.metrics,
        tags: transform.tags,
        ...transform.metadata,
      },
    })

    // Create edges from inputs to transformation
    const inputEdges = inputNodes.map((input) =>
      this.store.createEdge({
        fromNodeId: input.id,
        toNodeId: transformNode.id,
        operation: 'input',
        metadata: {
          transformKind: transform.kind,
          trackedAt,
        },
      })
    )

    // Create edges from transformation to outputs
    const outputEdges = outputNodes.map((output) =>
      this.store.createEdge({
        fromNodeId: transformNode.id,
        toNodeId: output.id,
        operation: 'output',
        metadata: {
          transformKind: transform.kind,
          trackedAt,
        },
      })
    )

    // Update transformation history for all involved assets
    const allAssetIds = [...inputNodes, ...outputNodes].map((n) => n.id)
    for (const assetId of allAssetIds) {
      const history = this.transformationHistory.get(assetId) ?? []
      history.push(transform)
      this.transformationHistory.set(assetId, history)
    }

    return {
      inputs: inputNodes,
      outputs: outputNodes,
      transformation: transformNode,
      inputEdges,
      outputEdges,
      trackedAt,
    }
  }

  trackCode(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      code?: string
      language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'
      description?: string
      metrics?: RuntimeMetrics
    }
  ): TrackingResult {
    return this.trackTransformation(inputs, outputs, {
      kind: 'code',
      name: options.name,
      code: options.code,
      language: options.language,
      description: options.description,
      metrics: options.metrics,
      executedAt: Date.now(),
    })
  }

  trackPipeline(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      operation: PipelineOperation
      config?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult {
    return this.trackTransformation(inputs, outputs, {
      kind: 'pipeline',
      name: options.name,
      pipelineOp: options.operation,
      pipelineConfig: options.config,
      metrics: options.metrics,
      executedAt: Date.now(),
    })
  }

  trackExternal(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      tool: ExternalTool
      jobName?: string
      runId?: string
      externalMeta?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult {
    return this.trackTransformation(inputs, outputs, {
      kind: 'external',
      name: options.name,
      externalTool: options.tool,
      jobName: options.jobName,
      runId: options.runId,
      externalMeta: options.externalMeta,
      metrics: options.metrics,
      executedAt: Date.now(),
    })
  }

  trackManual(
    outputs: AssetRef[],
    options: {
      name: string
      description?: string
      modifiedBy?: string
      reason?: string
    }
  ): TrackingResult {
    return this.trackTransformation(
      [], // No inputs for manual entry
      outputs,
      {
        kind: 'manual',
        name: options.name,
        description: options.description,
        executedBy: options.modifiedBy,
        metadata: {
          reason: options.reason,
        },
        executedAt: Date.now(),
      }
    )
  }

  getTransformationHistory(assetId: string): TransformMeta[] {
    return this.transformationHistory.get(assetId) ?? []
  }

  createContext(options: LineageContextOptions): LineageContext {
    return new LineageContextImpl(this, options)
  }
}

// =============================================================================
// DECORATOR
// =============================================================================

/**
 * Internal function to wrap a method with transformation tracking
 */
function wrapMethodWithTracking<T extends (...args: unknown[]) => unknown>(
  originalMethod: T,
  methodName: string,
  tracker: TransformationTracker,
  options?: TrackedOptions
): T {
  const wrapped = async function (this: unknown, ...args: unknown[]) {
    const startTime = Date.now()
    let result: unknown
    let error: Error | undefined

    try {
      result = await originalMethod.apply(this, args)
    } catch (e) {
      error = e as Error
      throw e
    } finally {
      const endTime = Date.now()

      // Build inputs from options or infer from args
      const inputs: AssetRef[] = (options?.inputs ?? []).map((name) => ({ name }))

      // Build outputs from options
      const outputs: AssetRef[] = (options?.outputs ?? []).map((name) => ({ name }))

      // Build transform metadata
      const transform: TransformMeta = {
        kind: options?.kind ?? 'code',
        name: options?.name ?? methodName,
        description: options?.description,
        language: 'typescript',
        signature: `${methodName}(${args.length} args)`,
        executedAt: startTime,
        tags: options?.tags,
      }

      // Capture metrics if requested
      if (options?.captureMetrics) {
        transform.metrics = {
          durationMs: endTime - startTime,
          errorCount: error ? 1 : 0,
        }

        // Try to capture record counts from result
        if (Array.isArray(result)) {
          transform.metrics.outputRecords = result.length
        }
        if (Array.isArray(args[0])) {
          transform.metrics.inputRecords = args[0].length
        }
      }

      // Capture schemas if requested (basic inference)
      if (options?.captureSchemas && !error) {
        if (Array.isArray(result) && result.length > 0) {
          transform.outputSchema = inferSchema(result[0])
        }
        if (Array.isArray(args[0]) && args[0].length > 0) {
          transform.inputSchema = inferSchema(args[0][0])
        }
      }

      // Add error info if failed
      if (error) {
        transform.metadata = {
          ...transform.metadata,
          error: error.message,
          errorStack: error.stack,
        }
      }

      // Track the transformation (fire and forget for performance)
      try {
        tracker.trackTransformation(inputs, outputs, transform)
      } catch {
        // Don't fail the original function if tracking fails
        console.warn('Failed to track transformation:', methodName)
      }
    }

    return result
  }

  return wrapped as T
}

/**
 * Decorator factory for tracking function-based transformations
 *
 * Supports both legacy TypeScript decorators and ES2022 decorators.
 *
 * @example
 * ```typescript
 * const tracker = createTransformationTracker(store)
 *
 * class DataPipeline {
 *   @tracked(tracker, {
 *     name: 'aggregate_events',
 *     inputs: ['raw_events'],
 *     outputs: ['aggregated_events'],
 *     captureMetrics: true,
 *   })
 *   async aggregateEvents(events: Event[]): Promise<AggregatedEvent[]> {
 *     // ... transformation logic
 *   }
 * }
 * ```
 */
export function tracked(tracker: TransformationTracker, options?: TrackedOptions) {
  // Return a decorator that supports both legacy and modern decorator protocols
  return function (
    targetOrValue: unknown,
    contextOrPropertyKey?: string | ClassMethodDecoratorContext,
    descriptor?: TypedPropertyDescriptor<(...args: unknown[]) => unknown>
  ): unknown {
    // ES2022 decorators: contextOrPropertyKey is a DecoratorContext object
    if (
      contextOrPropertyKey &&
      typeof contextOrPropertyKey === 'object' &&
      'kind' in contextOrPropertyKey &&
      contextOrPropertyKey.kind === 'method'
    ) {
      const context = contextOrPropertyKey as ClassMethodDecoratorContext
      const methodName = String(context.name)
      const originalMethod = targetOrValue as (...args: unknown[]) => unknown

      return wrapMethodWithTracking(originalMethod, methodName, tracker, options)
    }

    // Legacy TypeScript decorators: descriptor is provided
    if (descriptor && typeof contextOrPropertyKey === 'string') {
      const propertyKey = contextOrPropertyKey
      const originalMethod = descriptor.value!

      descriptor.value = wrapMethodWithTracking(originalMethod, propertyKey, tracker, options)

      return descriptor
    }

    // Fallback: assume ES2022 decorator with function as first argument
    if (typeof targetOrValue === 'function') {
      const methodName = options?.name ?? targetOrValue.name ?? 'anonymous'
      return wrapMethodWithTracking(targetOrValue as (...args: unknown[]) => unknown, methodName, tracker, options)
    }

    throw new Error('Invalid decorator usage')
  }
}

/**
 * Infer a basic schema from a value
 */
function inferSchema(value: unknown): SchemaDefinition {
  const fields: SchemaField[] = []

  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      fields.push({
        name: key,
        type: inferType(val),
        nullable: val === null || val === undefined,
      })
    }
  }

  return { fields, format: 'inferred' }
}

/**
 * Infer the type of a value
 */
function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'datetime'
  return typeof value
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TransformationTracker instance
 *
 * @param store - Lineage store adapter (typically from createLineageStore)
 * @returns A new TransformationTracker instance
 *
 * @example
 * ```typescript
 * import { createLineageStore, createTransformationTracker } from 'dotdo/db/primitives/lineage-tracker'
 *
 * const store = createLineageStore(ctx.storage.sql)
 * const tracker = createTransformationTracker(store)
 *
 * // Track a code transformation
 * tracker.trackCode(
 *   [{ name: 'raw_events' }],
 *   [{ name: 'processed_events' }],
 *   {
 *     name: 'processEvents',
 *     code: 'events.map(e => ({ ...e, processed: true }))',
 *     language: 'typescript',
 *   }
 * )
 *
 * // Track a pipeline stage
 * tracker.trackPipeline(
 *   [{ name: 'users' }, { name: 'orders' }],
 *   [{ name: 'user_orders' }],
 *   {
 *     name: 'join_users_orders',
 *     operation: 'join',
 *     config: { joinKey: 'user_id' },
 *   }
 * )
 *
 * // Track external tool execution
 * tracker.trackExternal(
 *   [{ name: 'staging_data' }],
 *   [{ name: 'warehouse_data' }],
 *   {
 *     name: 'dbt_transform',
 *     tool: 'dbt',
 *     jobName: 'transform_staging',
 *     runId: 'run-12345',
 *   }
 * )
 * ```
 */
export function createTransformationTracker(store: LineageStoreAdapter): TransformationTracker {
  return new TransformationTrackerImpl(store)
}
