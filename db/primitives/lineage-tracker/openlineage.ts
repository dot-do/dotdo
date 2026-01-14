/**
 * OpenLineage Format Export - Industry Standard Lineage Interoperability
 *
 * Exports lineage data in OpenLineage standard format for interoperability
 * with data catalogs, observability tools, and governance platforms.
 *
 * OpenLineage is an open standard for lineage metadata collection, defining
 * a JSON-based event format that supports runs, jobs, datasets, and facets.
 *
 * @see https://openlineage.io
 * @see https://github.com/OpenLineage/OpenLineage/blob/main/spec/OpenLineage.md
 *
 * @module db/primitives/lineage-tracker/openlineage
 */

import type { LineageGraph, LineageNode, LineageEdge, NodeType } from './types'

// =============================================================================
// OPENLINEAGE TYPES
// =============================================================================

/**
 * OpenLineage schema URL for version compatibility
 */
export const OPENLINEAGE_SCHEMA_URL = 'https://openlineage.io/spec/2-0-2/OpenLineage.json'

/**
 * OpenLineage event types
 */
export type OpenLineageEventType = 'START' | 'RUNNING' | 'COMPLETE' | 'ABORT' | 'FAIL' | 'OTHER'

/**
 * Base facet structure - all facets have a schema URL and producer
 */
export interface BaseFacet {
  _producer: string
  _schemaURL: string
}

/**
 * Run facet for nominal time (scheduled execution time)
 */
export interface NominalTimeRunFacet extends BaseFacet {
  nominalStartTime: string
  nominalEndTime?: string
}

/**
 * Run facet for parent job/run tracking
 */
export interface ParentRunFacet extends BaseFacet {
  run: {
    runId: string
  }
  job: {
    namespace: string
    name: string
  }
}

/**
 * Run facet for error messages
 */
export interface ErrorMessageRunFacet extends BaseFacet {
  message: string
  programmingLanguage?: string
  stackTrace?: string
}

/**
 * Processing engine run facet
 */
export interface ProcessingEngineRunFacet extends BaseFacet {
  version: string
  name: string
  openlineageAdapterVersion?: string
}

/**
 * Standard run facets
 */
export interface RunFacets {
  nominalTime?: NominalTimeRunFacet
  parent?: ParentRunFacet
  errorMessage?: ErrorMessageRunFacet
  processing_engine?: ProcessingEngineRunFacet
  // Additional custom facets are allowed
  [key: string]: unknown
}

/**
 * Job facet for source code location
 */
export interface SourceCodeLocationJobFacet extends BaseFacet {
  type: 'git' | 'svn' | 'local'
  url: string
  repoUrl?: string
  path?: string
  version?: string
  tag?: string
  branch?: string
}

/**
 * Job facet for SQL queries
 */
export interface SqlJobFacet extends BaseFacet {
  query: string
}

/**
 * Job facet for documentation
 */
export interface DocumentationJobFacet extends BaseFacet {
  description: string
}

/**
 * Job facet for job type
 */
export interface JobTypeJobFacet extends BaseFacet {
  processingType: 'BATCH' | 'STREAMING' | 'NONE'
  integration: string
  jobType?: string
}

/**
 * Job facet for ownership
 */
export interface OwnershipJobFacet extends BaseFacet {
  owners: Array<{
    name: string
    type?: string
  }>
}

/**
 * Standard job facets
 */
export interface JobFacets {
  sourceCodeLocation?: SourceCodeLocationJobFacet
  sql?: SqlJobFacet
  documentation?: DocumentationJobFacet
  jobType?: JobTypeJobFacet
  ownership?: OwnershipJobFacet
  // Additional custom facets are allowed
  [key: string]: unknown
}

/**
 * Dataset schema field
 */
export interface SchemaField {
  name: string
  type: string
  description?: string
  fields?: SchemaField[]
}

/**
 * Dataset facet for schema
 */
export interface SchemaDatasetFacet extends BaseFacet {
  fields: SchemaField[]
}

/**
 * Dataset facet for data source
 */
export interface DataSourceDatasetFacet extends BaseFacet {
  name: string
  uri: string
}

/**
 * Dataset facet for lifecycle state changes
 */
export interface LifecycleStateChangeDatasetFacet extends BaseFacet {
  lifecycleStateChange: 'ALTER' | 'CREATE' | 'DROP' | 'OVERWRITE' | 'RENAME' | 'TRUNCATE'
  previousIdentifier?: {
    namespace: string
    name: string
  }
}

/**
 * Dataset facet for column lineage
 */
export interface ColumnLineageDatasetFacet extends BaseFacet {
  fields: {
    [fieldName: string]: {
      inputFields: Array<{
        namespace: string
        name: string
        field: string
        transformations?: Array<{
          type: string
          subtype?: string
          description?: string
          masking?: boolean
        }>
      }>
      transformationDescription?: string
      transformationType?: string
    }
  }
}

/**
 * Dataset facet for ownership
 */
export interface OwnershipDatasetFacet extends BaseFacet {
  owners: Array<{
    name: string
    type?: string
  }>
}

/**
 * Dataset facet for version
 */
export interface DatasetVersionDatasetFacet extends BaseFacet {
  datasetVersion: string
}

/**
 * Standard dataset facets
 */
export interface DatasetFacets {
  schema?: SchemaDatasetFacet
  dataSource?: DataSourceDatasetFacet
  lifecycleStateChange?: LifecycleStateChangeDatasetFacet
  columnLineage?: ColumnLineageDatasetFacet
  ownership?: OwnershipDatasetFacet
  version?: DatasetVersionDatasetFacet
  // Additional custom facets are allowed
  [key: string]: unknown
}

/**
 * Input dataset facets
 */
export interface InputDatasetFacets {
  dataQualityMetrics?: BaseFacet & {
    rowCount?: number
    bytes?: number
    fileCount?: number
    columnMetrics?: {
      [columnName: string]: {
        nullCount?: number
        distinctCount?: number
        min?: number
        max?: number
        quantiles?: { [key: string]: number }
      }
    }
  }
  inputStatistics?: BaseFacet & {
    rowCount?: number
    bytes?: number
  }
  // Additional custom facets are allowed
  [key: string]: unknown
}

/**
 * Output dataset facets
 */
export interface OutputDatasetFacets {
  outputStatistics?: BaseFacet & {
    rowCount?: number
    bytes?: number
  }
  // Additional custom facets are allowed
  [key: string]: unknown
}

/**
 * OpenLineage Run object
 */
export interface OpenLineageRun {
  runId: string
  facets?: RunFacets
}

/**
 * OpenLineage Job object
 */
export interface OpenLineageJob {
  namespace: string
  name: string
  facets?: JobFacets
}

/**
 * OpenLineage Dataset object (base)
 */
export interface OpenLineageDataset {
  namespace: string
  name: string
  facets?: DatasetFacets
}

/**
 * OpenLineage Input Dataset
 */
export interface OpenLineageInputDataset extends OpenLineageDataset {
  inputFacets?: InputDatasetFacets
}

/**
 * OpenLineage Output Dataset
 */
export interface OpenLineageOutputDataset extends OpenLineageDataset {
  outputFacets?: OutputDatasetFacets
}

/**
 * OpenLineage RunEvent - the main event type
 */
export interface OpenLineageRunEvent {
  eventType: OpenLineageEventType
  eventTime: string
  run: OpenLineageRun
  job: OpenLineageJob
  inputs: OpenLineageInputDataset[]
  outputs: OpenLineageOutputDataset[]
  producer: string
  schemaURL: string
}

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

/**
 * Options for OpenLineage export
 */
export interface OpenLineageExportOptions {
  /** Producer URI identifying the integration */
  producer?: string
  /** Job namespace (defaults to 'default') */
  namespace?: string
  /** Event type for the export (defaults to 'COMPLETE') */
  eventType?: OpenLineageEventType
  /** Include schema facets for datasets */
  includeSchema?: boolean
  /** Include ownership facets */
  includeOwnership?: boolean
  /** Include documentation facets */
  includeDocumentation?: boolean
  /** Custom run ID (defaults to auto-generated UUID) */
  runId?: string
  /** Event timestamp (defaults to current time) */
  eventTime?: string | Date
  /** Map node types to OpenLineage dataset/job classification */
  nodeTypeMapping?: Partial<Record<NodeType, 'job' | 'dataset'>>
}

/**
 * Options for incremental OpenLineage export
 */
export interface OpenLineageIncrementalExportOptions extends OpenLineageExportOptions {
  /** Only export nodes/edges created after this timestamp */
  since?: number
  /** Maximum number of events to export */
  limit?: number
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_PRODUCER = 'https://github.com/dotdo/dotdo/lineage-tracker'

const DEFAULT_NODE_TYPE_MAPPING: Record<NodeType, 'job' | 'dataset'> = {
  source: 'dataset',
  sink: 'dataset',
  entity: 'dataset',
  transformation: 'job',
}

// =============================================================================
// OPENLINEAGE EXPORTER CLASS
// =============================================================================

/**
 * OpenLineageExporter - Export lineage graphs to OpenLineage format
 *
 * @example
 * ```typescript
 * const exporter = new OpenLineageExporter()
 * const events = exporter.exportGraph(graph, { namespace: 'warehouse' })
 * // Send events to OpenLineage-compatible endpoint
 * await fetch('https://marquez.example.com/api/v1/lineage', {
 *   method: 'POST',
 *   body: JSON.stringify(events[0]),
 * })
 * ```
 */
export class OpenLineageExporter {
  /**
   * Export a complete lineage graph to OpenLineage events
   *
   * This generates one RunEvent for each transformation (job) in the graph,
   * with its input and output datasets.
   */
  exportGraph(graph: LineageGraph, options?: OpenLineageExportOptions): OpenLineageRunEvent[] {
    const {
      producer = DEFAULT_PRODUCER,
      namespace = 'default',
      eventType = 'COMPLETE',
      includeSchema = false,
      includeOwnership = false,
      includeDocumentation = false,
      eventTime = new Date().toISOString(),
      nodeTypeMapping = DEFAULT_NODE_TYPE_MAPPING,
    } = options ?? {}

    const events: OpenLineageRunEvent[] = []
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
    const typeMapping = { ...DEFAULT_NODE_TYPE_MAPPING, ...nodeTypeMapping }

    // Find all transformation (job) nodes
    const jobNodes = graph.nodes.filter((n) => typeMapping[n.type] === 'job')

    // For each job, create a RunEvent with its inputs and outputs
    for (const jobNode of jobNodes) {
      // Find input edges (edges pointing TO this job)
      const inputEdges = graph.edges.filter((e) => e.toNodeId === jobNode.id)
      const inputNodes = inputEdges
        .map((e) => nodeMap.get(e.fromNodeId))
        .filter((n): n is LineageNode => n !== undefined && typeMapping[n.type] === 'dataset')

      // Find output edges (edges pointing FROM this job)
      const outputEdges = graph.edges.filter((e) => e.fromNodeId === jobNode.id)
      const outputNodes = outputEdges
        .map((e) => nodeMap.get(e.toNodeId))
        .filter((n): n is LineageNode => n !== undefined && typeMapping[n.type] === 'dataset')

      // Create the RunEvent
      const event = this.createRunEvent({
        jobNode,
        inputNodes,
        outputNodes,
        inputEdges,
        outputEdges,
        producer,
        namespace,
        eventType,
        eventTime: typeof eventTime === 'string' ? eventTime : eventTime.toISOString(),
        includeSchema,
        includeOwnership,
        includeDocumentation,
      })

      events.push(event)
    }

    // If no job nodes, create a single event representing the entire graph
    if (events.length === 0 && graph.nodes.length > 0) {
      const rootNode = nodeMap.get(graph.rootId) ?? graph.nodes[0]
      const sourceNodes = graph.nodes.filter((n) => n.type === 'source')
      const sinkNodes = graph.nodes.filter((n) => n.type === 'sink')

      events.push(
        this.createRunEvent({
          jobNode: {
            ...rootNode,
            type: 'transformation', // Override for this synthetic job
          },
          inputNodes: sourceNodes.length > 0 ? sourceNodes : [rootNode],
          outputNodes: sinkNodes.length > 0 ? sinkNodes : [],
          inputEdges: [],
          outputEdges: [],
          producer,
          namespace,
          eventType,
          eventTime: typeof eventTime === 'string' ? eventTime : eventTime.toISOString(),
          includeSchema,
          includeOwnership,
          includeDocumentation,
        }),
      )
    }

    return events
  }

  /**
   * Export a single transformation to an OpenLineage RunEvent
   */
  exportTransformation(
    jobNode: LineageNode,
    inputNodes: LineageNode[],
    outputNodes: LineageNode[],
    options?: OpenLineageExportOptions,
  ): OpenLineageRunEvent {
    const {
      producer = DEFAULT_PRODUCER,
      namespace = 'default',
      eventType = 'COMPLETE',
      includeSchema = false,
      includeOwnership = false,
      includeDocumentation = false,
      runId,
      eventTime = new Date().toISOString(),
    } = options ?? {}

    return this.createRunEvent({
      jobNode,
      inputNodes,
      outputNodes,
      inputEdges: [],
      outputEdges: [],
      producer,
      namespace,
      eventType,
      eventTime: typeof eventTime === 'string' ? eventTime : eventTime.toISOString(),
      includeSchema,
      includeOwnership,
      includeDocumentation,
      runId,
    })
  }

  /**
   * Create a START event for a job run
   */
  createStartEvent(
    jobNode: LineageNode,
    inputNodes: LineageNode[],
    options?: Omit<OpenLineageExportOptions, 'eventType'>,
  ): OpenLineageRunEvent {
    return this.exportTransformation(jobNode, inputNodes, [], {
      ...options,
      eventType: 'START',
    })
  }

  /**
   * Create a COMPLETE event for a job run
   */
  createCompleteEvent(
    jobNode: LineageNode,
    inputNodes: LineageNode[],
    outputNodes: LineageNode[],
    options?: Omit<OpenLineageExportOptions, 'eventType'>,
  ): OpenLineageRunEvent {
    return this.exportTransformation(jobNode, inputNodes, outputNodes, {
      ...options,
      eventType: 'COMPLETE',
    })
  }

  /**
   * Create a FAIL event for a job run
   */
  createFailEvent(
    jobNode: LineageNode,
    inputNodes: LineageNode[],
    errorMessage: string,
    options?: Omit<OpenLineageExportOptions, 'eventType'> & { stackTrace?: string },
  ): OpenLineageRunEvent {
    const event = this.exportTransformation(jobNode, inputNodes, [], {
      ...options,
      eventType: 'FAIL',
    })

    // Add error facet
    event.run.facets = {
      ...event.run.facets,
      errorMessage: {
        _producer: event.producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/ErrorMessageRunFacet`,
        message: errorMessage,
        programmingLanguage: 'TypeScript',
        stackTrace: options?.stackTrace,
      },
    }

    return event
  }

  /**
   * Export to JSON string
   */
  toJSON(events: OpenLineageRunEvent | OpenLineageRunEvent[]): string {
    return JSON.stringify(events, null, 2)
  }

  /**
   * Export to NDJSON (newline-delimited JSON) for streaming
   */
  toNDJSON(events: OpenLineageRunEvent[]): string {
    return events.map((e) => JSON.stringify(e)).join('\n')
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private createRunEvent(params: {
    jobNode: LineageNode
    inputNodes: LineageNode[]
    outputNodes: LineageNode[]
    inputEdges: LineageEdge[]
    outputEdges: LineageEdge[]
    producer: string
    namespace: string
    eventType: OpenLineageEventType
    eventTime: string
    includeSchema: boolean
    includeOwnership: boolean
    includeDocumentation: boolean
    runId?: string
  }): OpenLineageRunEvent {
    const {
      jobNode,
      inputNodes,
      outputNodes,
      producer,
      namespace,
      eventType,
      eventTime,
      includeSchema,
      includeOwnership,
      includeDocumentation,
      runId = this.generateUUID(),
    } = params

    // Build job facets
    const jobFacets: JobFacets = {}

    if (includeDocumentation && jobNode.metadata.description) {
      jobFacets.documentation = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/DocumentationJobFacet`,
        description: String(jobNode.metadata.description),
      }
    }

    if (jobNode.metadata.sql) {
      jobFacets.sql = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/SqlJobFacet`,
        query: String(jobNode.metadata.sql),
      }
    }

    if (includeOwnership && jobNode.metadata.owner) {
      jobFacets.ownership = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/OwnershipJobFacet`,
        owners: [{ name: String(jobNode.metadata.owner) }],
      }
    }

    // Determine job type based on node metadata
    const processingType = (jobNode.metadata.processingType as 'BATCH' | 'STREAMING') ?? 'BATCH'
    jobFacets.jobType = {
      _producer: producer,
      _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/JobTypeJobFacet`,
      processingType,
      integration: 'dotdo-lineage-tracker',
      jobType: jobNode.type,
    }

    // Build run facets
    const runFacets: RunFacets = {
      processing_engine: {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/ProcessingEngineRunFacet`,
        version: '1.0.0',
        name: 'dotdo-lineage-tracker',
      },
    }

    if (jobNode.metadata.scheduledTime) {
      runFacets.nominalTime = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/NominalTimeRunFacet`,
        nominalStartTime: String(jobNode.metadata.scheduledTime),
      }
    }

    // Build input datasets
    const inputs: OpenLineageInputDataset[] = inputNodes.map((node) =>
      this.nodeToInputDataset(node, {
        producer,
        namespace,
        includeSchema,
        includeOwnership,
      }),
    )

    // Build output datasets
    const outputs: OpenLineageOutputDataset[] = outputNodes.map((node) =>
      this.nodeToOutputDataset(node, {
        producer,
        namespace,
        includeSchema,
        includeOwnership,
      }),
    )

    return {
      eventType,
      eventTime,
      run: {
        runId,
        facets: Object.keys(runFacets).length > 0 ? runFacets : undefined,
      },
      job: {
        namespace: jobNode.namespace ?? namespace,
        name: jobNode.name,
        facets: Object.keys(jobFacets).length > 0 ? jobFacets : undefined,
      },
      inputs,
      outputs,
      producer,
      schemaURL: OPENLINEAGE_SCHEMA_URL,
    }
  }

  private nodeToInputDataset(
    node: LineageNode,
    options: {
      producer: string
      namespace: string
      includeSchema: boolean
      includeOwnership: boolean
    },
  ): OpenLineageInputDataset {
    const { producer, namespace, includeSchema, includeOwnership } = options

    const dataset: OpenLineageInputDataset = {
      namespace: node.namespace ?? namespace,
      name: node.name,
    }

    const facets: DatasetFacets = {}

    // Add schema facet if available
    if (includeSchema && node.metadata.schema) {
      facets.schema = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/SchemaDatasetFacet`,
        fields: this.parseSchema(node.metadata.schema),
      }
    }

    // Add data source facet
    if (node.metadata.uri || node.metadata.url) {
      facets.dataSource = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/DataSourceDatasetFacet`,
        name: node.name,
        uri: String(node.metadata.uri ?? node.metadata.url),
      }
    }

    // Add ownership facet
    if (includeOwnership && node.metadata.owner) {
      facets.ownership = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/OwnershipDatasetFacet`,
        owners: [{ name: String(node.metadata.owner) }],
      }
    }

    // Add version facet
    if (node.metadata.version) {
      facets.version = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/DatasetVersionDatasetFacet`,
        datasetVersion: String(node.metadata.version),
      }
    }

    if (Object.keys(facets).length > 0) {
      dataset.facets = facets
    }

    // Add input-specific facets
    const inputFacets: InputDatasetFacets = {}

    if (node.metadata.rowCount !== undefined || node.metadata.bytes !== undefined) {
      inputFacets.inputStatistics = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/InputStatisticsInputDatasetFacet`,
        rowCount: node.metadata.rowCount as number | undefined,
        bytes: node.metadata.bytes as number | undefined,
      }
    }

    if (Object.keys(inputFacets).length > 0) {
      dataset.inputFacets = inputFacets
    }

    return dataset
  }

  private nodeToOutputDataset(
    node: LineageNode,
    options: {
      producer: string
      namespace: string
      includeSchema: boolean
      includeOwnership: boolean
    },
  ): OpenLineageOutputDataset {
    const { producer, namespace, includeSchema, includeOwnership } = options

    const dataset: OpenLineageOutputDataset = {
      namespace: node.namespace ?? namespace,
      name: node.name,
    }

    const facets: DatasetFacets = {}

    // Add schema facet if available
    if (includeSchema && node.metadata.schema) {
      facets.schema = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/SchemaDatasetFacet`,
        fields: this.parseSchema(node.metadata.schema),
      }
    }

    // Add data source facet
    if (node.metadata.uri || node.metadata.url) {
      facets.dataSource = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/DataSourceDatasetFacet`,
        name: node.name,
        uri: String(node.metadata.uri ?? node.metadata.url),
      }
    }

    // Add ownership facet
    if (includeOwnership && node.metadata.owner) {
      facets.ownership = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/OwnershipDatasetFacet`,
        owners: [{ name: String(node.metadata.owner) }],
      }
    }

    // Add lifecycle state change facet
    if (node.metadata.lifecycleState) {
      facets.lifecycleStateChange = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/LifecycleStateChangeDatasetFacet`,
        lifecycleStateChange: node.metadata.lifecycleState as 'ALTER' | 'CREATE' | 'DROP' | 'OVERWRITE' | 'RENAME' | 'TRUNCATE',
      }
    }

    if (Object.keys(facets).length > 0) {
      dataset.facets = facets
    }

    // Add output-specific facets
    const outputFacets: OutputDatasetFacets = {}

    if (node.metadata.rowCount !== undefined || node.metadata.bytes !== undefined) {
      outputFacets.outputStatistics = {
        _producer: producer,
        _schemaURL: `${OPENLINEAGE_SCHEMA_URL}#/$defs/OutputStatisticsOutputDatasetFacet`,
        rowCount: node.metadata.rowCount as number | undefined,
        bytes: node.metadata.bytes as number | undefined,
      }
    }

    if (Object.keys(outputFacets).length > 0) {
      dataset.outputFacets = outputFacets
    }

    return dataset
  }

  private parseSchema(schema: unknown): SchemaField[] {
    if (Array.isArray(schema)) {
      return schema.map((field) => {
        if (typeof field === 'string') {
          return { name: field, type: 'string' }
        }
        if (typeof field === 'object' && field !== null) {
          const f = field as Record<string, unknown>
          return {
            name: String(f.name ?? 'unknown'),
            type: String(f.type ?? 'string'),
            description: f.description ? String(f.description) : undefined,
          }
        }
        return { name: 'unknown', type: 'unknown' }
      })
    }

    if (typeof schema === 'object' && schema !== null) {
      return Object.entries(schema as Record<string, unknown>).map(([name, type]) => ({
        name,
        type: typeof type === 'string' ? type : 'object',
      }))
    }

    return []
  }

  private generateUUID(): string {
    // Simple UUID v4 generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

// =============================================================================
// IMPORT FUNCTIONALITY
// =============================================================================

/**
 * Options for importing OpenLineage events
 */
export interface OpenLineageImportOptions {
  /** Prefix for generated node IDs */
  idPrefix?: string
  /** Default namespace if not specified in events */
  defaultNamespace?: string
  /** Merge with existing nodes by name */
  mergeByName?: boolean
}

/**
 * Result of importing OpenLineage events
 */
export interface OpenLineageImportResult {
  /** Number of events processed */
  eventsProcessed: number
  /** Number of nodes created */
  nodesCreated: number
  /** Number of edges created */
  edgesCreated: number
  /** IDs of created nodes */
  nodeIds: string[]
  /** IDs of created edges */
  edgeIds: string[]
}

/**
 * Import OpenLineage events into lineage graph format
 *
 * Converts OpenLineage RunEvents into LineageNode and LineageEdge objects
 * that can be stored in the LineageTracker.
 */
export function importFromOpenLineage(
  events: OpenLineageRunEvent[],
  options?: OpenLineageImportOptions,
): {
  nodes: Array<{
    id?: string
    type: NodeType
    name: string
    namespace?: string
    metadata: Record<string, unknown>
  }>
  edges: Array<{
    fromNodeId: string
    toNodeId: string
    operation: string
    metadata?: Record<string, unknown>
  }>
} {
  const { idPrefix = 'ol', defaultNamespace = 'default' } = options ?? {}

  const nodes: Array<{
    id?: string
    type: NodeType
    name: string
    namespace?: string
    metadata: Record<string, unknown>
  }> = []

  const edges: Array<{
    fromNodeId: string
    toNodeId: string
    operation: string
    metadata?: Record<string, unknown>
  }> = []

  const nodeIdMap = new Map<string, string>()

  const getNodeId = (namespace: string, name: string): string => {
    const key = `${namespace}:${name}`
    if (!nodeIdMap.has(key)) {
      nodeIdMap.set(key, `${idPrefix}-${nodeIdMap.size + 1}`)
    }
    return nodeIdMap.get(key)!
  }

  for (const event of events) {
    // Create job node
    const jobNamespace = event.job.namespace ?? defaultNamespace
    const jobId = getNodeId(jobNamespace, event.job.name)

    const jobMetadata: Record<string, unknown> = {
      runId: event.run.runId,
      eventType: event.eventType,
      eventTime: event.eventTime,
      producer: event.producer,
    }

    // Extract job facets
    if (event.job.facets?.sql?.query) {
      jobMetadata.sql = event.job.facets.sql.query
    }
    if (event.job.facets?.documentation?.description) {
      jobMetadata.description = event.job.facets.documentation.description
    }
    if (event.job.facets?.ownership?.owners) {
      jobMetadata.owners = event.job.facets.ownership.owners
    }
    if (event.job.facets?.jobType) {
      jobMetadata.processingType = event.job.facets.jobType.processingType
      jobMetadata.jobType = event.job.facets.jobType.jobType
    }

    nodes.push({
      id: jobId,
      type: 'transformation',
      name: event.job.name,
      namespace: jobNamespace,
      metadata: jobMetadata,
    })

    // Create input dataset nodes and edges
    for (const input of event.inputs) {
      const inputNamespace = input.namespace ?? defaultNamespace
      const inputId = getNodeId(inputNamespace, input.name)

      const inputMetadata: Record<string, unknown> = {}

      // Extract dataset facets
      if (input.facets?.schema?.fields) {
        inputMetadata.schema = input.facets.schema.fields
      }
      if (input.facets?.dataSource) {
        inputMetadata.uri = input.facets.dataSource.uri
      }
      if (input.facets?.ownership?.owners) {
        inputMetadata.owners = input.facets.ownership.owners
      }
      if (input.facets?.version?.datasetVersion) {
        inputMetadata.version = input.facets.version.datasetVersion
      }
      if (input.inputFacets?.inputStatistics) {
        inputMetadata.rowCount = input.inputFacets.inputStatistics.rowCount
        inputMetadata.bytes = input.inputFacets.inputStatistics.bytes
      }

      nodes.push({
        id: inputId,
        type: 'source',
        name: input.name,
        namespace: inputNamespace,
        metadata: inputMetadata,
      })

      edges.push({
        fromNodeId: inputId,
        toNodeId: jobId,
        operation: 'read',
        metadata: { eventType: event.eventType },
      })
    }

    // Create output dataset nodes and edges
    for (const output of event.outputs) {
      const outputNamespace = output.namespace ?? defaultNamespace
      const outputId = getNodeId(outputNamespace, output.name)

      const outputMetadata: Record<string, unknown> = {}

      // Extract dataset facets
      if (output.facets?.schema?.fields) {
        outputMetadata.schema = output.facets.schema.fields
      }
      if (output.facets?.dataSource) {
        outputMetadata.uri = output.facets.dataSource.uri
      }
      if (output.facets?.ownership?.owners) {
        outputMetadata.owners = output.facets.ownership.owners
      }
      if (output.facets?.lifecycleStateChange) {
        outputMetadata.lifecycleState = output.facets.lifecycleStateChange.lifecycleStateChange
      }
      if (output.outputFacets?.outputStatistics) {
        outputMetadata.rowCount = output.outputFacets.outputStatistics.rowCount
        outputMetadata.bytes = output.outputFacets.outputStatistics.bytes
      }

      nodes.push({
        id: outputId,
        type: 'sink',
        name: output.name,
        namespace: outputNamespace,
        metadata: outputMetadata,
      })

      edges.push({
        fromNodeId: jobId,
        toNodeId: outputId,
        operation: 'write',
        metadata: { eventType: event.eventType },
      })
    }
  }

  // Deduplicate nodes by ID
  const uniqueNodes = Array.from(new Map(nodes.map((n) => [n.id, n])).values())

  return { nodes: uniqueNodes, edges }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new OpenLineageExporter instance
 */
export function createOpenLineageExporter(): OpenLineageExporter {
  return new OpenLineageExporter()
}
