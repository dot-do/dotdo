/**
 * dbt Docs Export - Generate dbt-compatible documentation
 *
 * Exports lineage data in dbt-compatible formats:
 * - catalog.json: Data catalog with table/column metadata
 * - manifest.json: DAG and model dependencies
 * - HTML documentation site generation
 *
 * This enables interoperability with dbt Cloud, dbt Core docs serve,
 * and third-party tools that consume dbt artifacts.
 *
 * @example Basic Usage
 * ```typescript
 * import { createDbtDocsExporter } from 'dotdo/db/primitives/lineage-tracker'
 *
 * const exporter = createDbtDocsExporter()
 * const graph = tracker.getFullLineage('model-1')
 *
 * // Generate catalog.json
 * const catalog = exporter.toCatalog(graph, { projectName: 'my_project' })
 *
 * // Generate manifest.json
 * const manifest = exporter.toManifest(graph, { projectName: 'my_project' })
 *
 * // Generate complete docs bundle
 * const docs = exporter.toDocsBundle(graph, {
 *   projectName: 'my_project',
 *   version: '1.0.0',
 * })
 * ```
 *
 * @module db/primitives/lineage-tracker/dbt-docs
 */

import type { LineageGraph, LineageNode, LineageEdge, NodeType } from './types'

// =============================================================================
// dbt ARTIFACT TYPES
// =============================================================================

/**
 * dbt resource types
 */
export type DbtResourceType = 'model' | 'source' | 'seed' | 'snapshot' | 'test' | 'analysis' | 'exposure' | 'metric'

/**
 * dbt materialization strategies
 */
export type DbtMaterialization = 'view' | 'table' | 'incremental' | 'ephemeral'

/**
 * Column metadata in dbt catalog
 */
export interface DbtColumn {
  /** Column type (e.g., VARCHAR, INTEGER) */
  type: string
  /** Column index (1-based) */
  index: number
  /** Column name */
  name: string
  /** Human-readable comment */
  comment?: string
}

/**
 * Table/view statistics in dbt catalog
 */
export interface DbtTableStats {
  /** Number of rows */
  row_count?: {
    id: string
    label: string
    value: number
    include: boolean
    description: string
  }
  /** Table size in bytes */
  bytes?: {
    id: string
    label: string
    value: number
    include: boolean
    description: string
  }
  /** Last modification time */
  last_modified?: {
    id: string
    label: string
    value: string
    include: boolean
    description: string
  }
}

/**
 * Node in dbt catalog (table/view metadata)
 */
export interface DbtCatalogNode {
  /** Unique identifier */
  unique_id: string
  /** Node metadata */
  metadata: {
    type: string
    schema: string
    name: string
    database?: string
    comment?: string
    owner?: string
  }
  /** Column definitions */
  columns: Record<string, DbtColumn>
  /** Table statistics */
  stats: DbtTableStats
}

/**
 * Source in dbt catalog
 */
export interface DbtCatalogSource {
  /** Unique identifier */
  unique_id: string
  /** Source metadata */
  metadata: {
    type: string
    schema: string
    name: string
    database?: string
    comment?: string
  }
  /** Column definitions */
  columns: Record<string, DbtColumn>
  /** Table statistics */
  stats: DbtTableStats
}

/**
 * dbt catalog.json structure
 */
export interface DbtCatalog {
  /** Catalog metadata */
  metadata: {
    dbt_schema_version: string
    dbt_version: string
    generated_at: string
    invocation_id: string
    env: Record<string, string>
  }
  /** Model/table nodes */
  nodes: Record<string, DbtCatalogNode>
  /** Source definitions */
  sources: Record<string, DbtCatalogSource>
  /** Any errors during catalog generation */
  errors?: string[]
}

/**
 * Node configuration in dbt manifest
 */
export interface DbtNodeConfig {
  /** Whether the model is enabled */
  enabled: boolean
  /** Materialization strategy */
  materialized: DbtMaterialization
  /** Tags applied to this model */
  tags: string[]
  /** Schema name */
  schema?: string
  /** Alias name */
  alias?: string
  /** Pre-hook SQL */
  pre_hook?: string[]
  /** Post-hook SQL */
  post_hook?: string[]
}

/**
 * Node in dbt manifest (model definition)
 */
export interface DbtManifestNode {
  /** Unique identifier */
  unique_id: string
  /** Resource type */
  resource_type: DbtResourceType
  /** Package name */
  package_name: string
  /** Relative path to model file */
  path: string
  /** Original file path */
  original_file_path: string
  /** Model name */
  name: string
  /** Human-readable description */
  description: string
  /** Node configuration */
  config: DbtNodeConfig
  /** Database name */
  database?: string
  /** Schema name */
  schema: string
  /** Materialized name (table/view name) */
  alias: string
  /** Nodes this depends on */
  depends_on: {
    macros: string[]
    nodes: string[]
  }
  /** Column definitions with tests and descriptions */
  columns: Record<
    string,
    {
      name: string
      description: string
      meta: Record<string, unknown>
      data_type?: string
      quote?: boolean
      tags: string[]
    }
  >
  /** Model tags */
  tags: string[]
  /** Model metadata */
  meta: Record<string, unknown>
  /** Compiled SQL (if available) */
  compiled_sql?: string
  /** Raw SQL */
  raw_sql?: string
  /** Documentation block */
  docs: {
    show: boolean
    node_color?: string
  }
  /** Patch path for schema.yml */
  patch_path?: string
  /** Build path */
  build_path?: string
  /** Deferred status */
  deferred: boolean
  /** Unrendered config */
  unrendered_config: Record<string, unknown>
  /** Created timestamp */
  created_at: number
  /** Relation name */
  relation_name?: string
  /** Raw code */
  raw_code?: string
  /** Language */
  language?: string
  /** Checksum */
  checksum?: {
    name: string
    checksum: string
  }
}

/**
 * Source definition in dbt manifest
 */
export interface DbtManifestSource {
  /** Unique identifier */
  unique_id: string
  /** Resource type (always 'source') */
  resource_type: 'source'
  /** Package name */
  package_name: string
  /** Path */
  path: string
  /** Original file path */
  original_file_path: string
  /** Source name */
  source_name: string
  /** Table name within source */
  name: string
  /** Description */
  description: string
  /** Database */
  database?: string
  /** Schema */
  schema: string
  /** Identifier (table name in database) */
  identifier: string
  /** Loader name */
  loader?: string
  /** Loaded at field */
  loaded_at_field?: string
  /** Freshness configuration */
  freshness?: {
    warn_after?: { count: number; period: string }
    error_after?: { count: number; period: string }
  }
  /** External configuration */
  external?: Record<string, unknown>
  /** Quoting configuration */
  quoting?: {
    database?: boolean
    schema?: boolean
    identifier?: boolean
  }
  /** Column definitions */
  columns: Record<
    string,
    {
      name: string
      description: string
      meta: Record<string, unknown>
      data_type?: string
      tags: string[]
    }
  >
  /** Tags */
  tags: string[]
  /** Metadata */
  meta: Record<string, unknown>
  /** Source description */
  source_description?: string
  /** Relation name */
  relation_name?: string
  /** Created timestamp */
  created_at: number
}

/**
 * Exposure definition in dbt manifest
 */
export interface DbtManifestExposure {
  /** Unique identifier */
  unique_id: string
  /** Resource type (always 'exposure') */
  resource_type: 'exposure'
  /** Package name */
  package_name: string
  /** Path */
  path: string
  /** Original file path */
  original_file_path: string
  /** Exposure name */
  name: string
  /** Description */
  description: string
  /** Type of exposure */
  type: 'dashboard' | 'notebook' | 'analysis' | 'ml' | 'application'
  /** Owner information */
  owner: {
    name?: string
    email?: string
  }
  /** URL to the exposure */
  url?: string
  /** Maturity level */
  maturity?: 'high' | 'medium' | 'low'
  /** Dependencies */
  depends_on: {
    macros: string[]
    nodes: string[]
  }
  /** Tags */
  tags: string[]
  /** Metadata */
  meta: Record<string, unknown>
  /** Created timestamp */
  created_at: number
}

/**
 * Parent mapping in dbt manifest
 */
export interface DbtParentMap {
  [nodeId: string]: string[]
}

/**
 * Child mapping in dbt manifest
 */
export interface DbtChildMap {
  [nodeId: string]: string[]
}

/**
 * dbt manifest.json structure
 */
export interface DbtManifest {
  /** Manifest metadata */
  metadata: {
    dbt_schema_version: string
    dbt_version: string
    generated_at: string
    invocation_id: string
    env: Record<string, string>
    project_name?: string
    project_id?: string
    user_id?: string
    send_anonymous_usage_stats?: boolean
    adapter_type?: string
  }
  /** Model/analysis/test nodes */
  nodes: Record<string, DbtManifestNode>
  /** Source definitions */
  sources: Record<string, DbtManifestSource>
  /** Exposure definitions */
  exposures: Record<string, DbtManifestExposure>
  /** Macro definitions */
  macros: Record<string, unknown>
  /** Documentation blocks */
  docs: Record<string, unknown>
  /** Disabled nodes */
  disabled: Record<string, unknown>
  /** Selector definitions */
  selectors: Record<string, unknown>
  /** Parent map (node -> parents) */
  parent_map: DbtParentMap
  /** Child map (node -> children) */
  child_map: DbtChildMap
}

/**
 * Combined dbt docs bundle for serving
 */
export interface DbtDocsBundle {
  /** catalog.json content */
  catalog: DbtCatalog
  /** manifest.json content */
  manifest: DbtManifest
  /** Generated at timestamp */
  generatedAt: string
  /** Project metadata */
  project: {
    name: string
    version: string
  }
}

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

/**
 * Options for dbt catalog generation
 */
export interface DbtCatalogOptions {
  /** Project name */
  projectName?: string
  /** dbt version to report */
  dbtVersion?: string
  /** Database name */
  database?: string
  /** Default schema */
  defaultSchema?: string
  /** Include statistics */
  includeStats?: boolean
  /** Custom environment variables */
  env?: Record<string, string>
}

/**
 * Options for dbt manifest generation
 */
export interface DbtManifestOptions {
  /** Project name */
  projectName?: string
  /** Project ID */
  projectId?: string
  /** dbt version to report */
  dbtVersion?: string
  /** Database name */
  database?: string
  /** Default schema */
  defaultSchema?: string
  /** Default materialization */
  defaultMaterialization?: DbtMaterialization
  /** Adapter type (e.g., 'postgres', 'snowflake') */
  adapterType?: string
  /** Custom environment variables */
  env?: Record<string, string>
  /** Include raw SQL from metadata */
  includeRawSql?: boolean
}

/**
 * Options for dbt docs bundle generation
 */
export interface DbtDocsBundleOptions extends DbtCatalogOptions, DbtManifestOptions {
  /** Project version */
  version?: string
}

// =============================================================================
// DBT DOCS EXPORTER
// =============================================================================

/**
 * Maps LineageNode types to dbt resource types
 */
function mapNodeTypeToDbtResourceType(type: NodeType): DbtResourceType {
  switch (type) {
    case 'source':
      return 'source'
    case 'transformation':
      return 'model'
    case 'entity':
      return 'model'
    case 'sink':
      return 'exposure'
    default:
      return 'model'
  }
}

/**
 * Maps LineageNode types to dbt table types
 */
function mapNodeTypeToTableType(type: NodeType): string {
  switch (type) {
    case 'source':
      return 'BASE TABLE'
    case 'transformation':
      return 'VIEW'
    case 'entity':
      return 'BASE TABLE'
    case 'sink':
      return 'VIEW'
    default:
      return 'BASE TABLE'
  }
}

/**
 * Infers materialization from node metadata
 */
function inferMaterialization(node: LineageNode): DbtMaterialization {
  const meta = node.metadata
  if (meta.materialized) {
    return meta.materialized as DbtMaterialization
  }
  if (meta.materialization) {
    return meta.materialization as DbtMaterialization
  }
  // Infer from node type
  switch (node.type) {
    case 'transformation':
      return 'view'
    case 'entity':
      return 'table'
    default:
      return 'view'
  }
}

/**
 * Generates a unique ID for a dbt node
 */
function generateDbtUniqueId(node: LineageNode, projectName: string): string {
  const resourceType = mapNodeTypeToDbtResourceType(node.type)
  const schema = node.namespace || 'public'
  return `${resourceType}.${projectName}.${node.name}`
}

/**
 * Extracts column information from node metadata
 */
function extractColumns(node: LineageNode): Record<string, DbtColumn> {
  const columns: Record<string, DbtColumn> = {}
  const meta = node.metadata

  // Check for columns in metadata
  if (meta.columns && Array.isArray(meta.columns)) {
    ;(meta.columns as Array<{ name: string; type?: string; description?: string }>).forEach((col, idx) => {
      columns[col.name] = {
        name: col.name,
        type: col.type || 'VARCHAR',
        index: idx + 1,
        comment: col.description,
      }
    })
  }

  // Check for schema definition
  if (meta.schema && typeof meta.schema === 'object') {
    const schema = meta.schema as { fields?: Array<{ name: string; type?: string; description?: string }> }
    if (schema.fields && Array.isArray(schema.fields)) {
      schema.fields.forEach((field, idx) => {
        columns[field.name] = {
          name: field.name,
          type: field.type || 'VARCHAR',
          index: idx + 1,
          comment: field.description,
        }
      })
    }
  }

  // Check for outputSchema
  if (meta.outputSchema && typeof meta.outputSchema === 'object') {
    const schema = meta.outputSchema as { fields?: Array<{ name: string; type?: string; description?: string }> }
    if (schema.fields && Array.isArray(schema.fields)) {
      schema.fields.forEach((field, idx) => {
        columns[field.name] = {
          name: field.name,
          type: field.type || 'VARCHAR',
          index: idx + 1,
          comment: field.description,
        }
      })
    }
  }

  return columns
}

/**
 * Extracts table statistics from node metadata
 */
function extractStats(node: LineageNode): DbtTableStats {
  const stats: DbtTableStats = {}
  const meta = node.metadata

  if (meta.rowCount !== undefined || meta.row_count !== undefined || meta.metrics) {
    const rowCount = meta.rowCount ?? meta.row_count ?? (meta.metrics as { outputRecords?: number })?.outputRecords
    if (rowCount !== undefined) {
      stats.row_count = {
        id: 'row_count',
        label: 'Row Count',
        value: Number(rowCount),
        include: true,
        description: 'Number of rows in the table',
      }
    }
  }

  if (meta.bytes !== undefined || meta.size !== undefined) {
    stats.bytes = {
      id: 'bytes',
      label: 'Approximate Size',
      value: Number(meta.bytes ?? meta.size),
      include: true,
      description: 'Approximate size in bytes',
    }
  }

  if (meta.lastModified !== undefined || meta.updatedAt !== undefined) {
    const lastMod = meta.lastModified ?? meta.updatedAt
    stats.last_modified = {
      id: 'last_modified',
      label: 'Last Modified',
      value: typeof lastMod === 'number' ? new Date(lastMod).toISOString() : String(lastMod),
      include: true,
      description: 'Last modification timestamp',
    }
  }

  return stats
}

/**
 * Generates a consistent invocation ID
 */
function generateInvocationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`
}

/**
 * DbtDocsExporter - Export lineage data to dbt-compatible formats
 *
 * Generates catalog.json and manifest.json files that are compatible with
 * dbt docs serve and third-party data catalog tools.
 */
export class DbtDocsExporter {
  private readonly defaultDbtVersion = '1.7.0'
  private readonly schemaVersion = 'https://schemas.getdbt.com/dbt/catalog/v1.json'
  private readonly manifestSchemaVersion = 'https://schemas.getdbt.com/dbt/manifest/v11.json'

  /**
   * Generate a dbt catalog.json from a lineage graph
   *
   * The catalog contains metadata about tables and views including:
   * - Table/view names and types
   * - Column definitions and types
   * - Statistics (row counts, sizes, timestamps)
   *
   * @example
   * ```typescript
   * const catalog = exporter.toCatalog(graph, {
   *   projectName: 'analytics',
   *   database: 'warehouse',
   *   defaultSchema: 'marts',
   * })
   *
   * await Bun.write('target/catalog.json', JSON.stringify(catalog, null, 2))
   * ```
   */
  toCatalog(graph: LineageGraph, options?: DbtCatalogOptions): DbtCatalog {
    const {
      projectName = 'dotdo_project',
      dbtVersion = this.defaultDbtVersion,
      database,
      defaultSchema = 'public',
      includeStats = true,
      env = {},
    } = options ?? {}

    const nodes: Record<string, DbtCatalogNode> = {}
    const sources: Record<string, DbtCatalogSource> = {}

    for (const node of graph.nodes) {
      const uniqueId = generateDbtUniqueId(node, projectName)
      const schema = node.namespace || defaultSchema
      const columns = extractColumns(node)
      const stats = includeStats ? extractStats(node) : {}

      if (node.type === 'source') {
        // Source nodes
        sources[uniqueId] = {
          unique_id: uniqueId,
          metadata: {
            type: mapNodeTypeToTableType(node.type),
            schema,
            name: node.name,
            database,
            comment: (node.metadata.description as string) || undefined,
          },
          columns,
          stats,
        }
      } else {
        // Model/entity/transformation nodes
        nodes[uniqueId] = {
          unique_id: uniqueId,
          metadata: {
            type: mapNodeTypeToTableType(node.type),
            schema,
            name: node.name,
            database,
            comment: (node.metadata.description as string) || undefined,
            owner: (node.metadata.owner as string) || undefined,
          },
          columns,
          stats,
        }
      }
    }

    return {
      metadata: {
        dbt_schema_version: this.schemaVersion,
        dbt_version: dbtVersion,
        generated_at: new Date().toISOString(),
        invocation_id: generateInvocationId(),
        env,
      },
      nodes,
      sources,
    }
  }

  /**
   * Generate a dbt manifest.json from a lineage graph
   *
   * The manifest contains the DAG structure including:
   * - Model definitions and configurations
   * - Source definitions
   * - Dependency relationships (parent_map, child_map)
   * - Exposure definitions (for sink nodes)
   *
   * @example
   * ```typescript
   * const manifest = exporter.toManifest(graph, {
   *   projectName: 'analytics',
   *   defaultMaterialization: 'table',
   * })
   *
   * await Bun.write('target/manifest.json', JSON.stringify(manifest, null, 2))
   * ```
   */
  toManifest(graph: LineageGraph, options?: DbtManifestOptions): DbtManifest {
    const {
      projectName = 'dotdo_project',
      projectId,
      dbtVersion = this.defaultDbtVersion,
      database,
      defaultSchema = 'public',
      defaultMaterialization = 'view',
      adapterType = 'postgres',
      env = {},
      includeRawSql = true,
    } = options ?? {}

    const nodes: Record<string, DbtManifestNode> = {}
    const sources: Record<string, DbtManifestSource> = {}
    const exposures: Record<string, DbtManifestExposure> = {}
    const parentMap: DbtParentMap = {}
    const childMap: DbtChildMap = {}

    // Build node ID mapping for edge processing
    const nodeIdToUniqueId = new Map<string, string>()
    for (const node of graph.nodes) {
      const uniqueId = generateDbtUniqueId(node, projectName)
      nodeIdToUniqueId.set(node.id, uniqueId)
    }

    // Build adjacency lists for parent/child maps
    const parentAdjacency = new Map<string, Set<string>>()
    const childAdjacency = new Map<string, Set<string>>()

    for (const edge of graph.edges) {
      const sourceUniqueId = nodeIdToUniqueId.get(edge.fromNodeId)
      const targetUniqueId = nodeIdToUniqueId.get(edge.toNodeId)

      if (sourceUniqueId && targetUniqueId) {
        // Parent of target is source
        if (!parentAdjacency.has(targetUniqueId)) {
          parentAdjacency.set(targetUniqueId, new Set())
        }
        parentAdjacency.get(targetUniqueId)!.add(sourceUniqueId)

        // Child of source is target
        if (!childAdjacency.has(sourceUniqueId)) {
          childAdjacency.set(sourceUniqueId, new Set())
        }
        childAdjacency.get(sourceUniqueId)!.add(targetUniqueId)
      }
    }

    // Process nodes
    for (const node of graph.nodes) {
      const uniqueId = generateDbtUniqueId(node, projectName)
      const schema = node.namespace || defaultSchema
      const parents = parentAdjacency.get(uniqueId)
      const children = childAdjacency.get(uniqueId)

      parentMap[uniqueId] = parents ? Array.from(parents) : []
      childMap[uniqueId] = children ? Array.from(children) : []

      if (node.type === 'source') {
        // Source node
        const columns: DbtManifestSource['columns'] = {}
        const extractedCols = extractColumns(node)
        for (const [name, col] of Object.entries(extractedCols)) {
          columns[name] = {
            name: col.name,
            description: col.comment || '',
            meta: {},
            data_type: col.type,
            tags: [],
          }
        }

        sources[uniqueId] = {
          unique_id: uniqueId,
          resource_type: 'source',
          package_name: projectName,
          path: `models/staging/${node.name}.yml`,
          original_file_path: `models/staging/${node.name}.yml`,
          source_name: node.namespace || 'external',
          name: node.name,
          description: (node.metadata.description as string) || '',
          database,
          schema,
          identifier: node.name,
          loader: (node.metadata.loader as string) || undefined,
          loaded_at_field: (node.metadata.loaded_at_field as string) || undefined,
          columns,
          tags: Array.isArray(node.metadata.tags) ? (node.metadata.tags as string[]) : [],
          meta: node.metadata,
          created_at: node.createdAt,
        }
      } else if (node.type === 'sink') {
        // Exposure node
        exposures[uniqueId] = {
          unique_id: uniqueId,
          resource_type: 'exposure',
          package_name: projectName,
          path: `models/exposures/${node.name}.yml`,
          original_file_path: `models/exposures/${node.name}.yml`,
          name: node.name,
          description: (node.metadata.description as string) || '',
          type: (node.metadata.exposureType as 'dashboard' | 'notebook' | 'analysis' | 'ml' | 'application') || 'dashboard',
          owner: {
            name: (node.metadata.owner as string) || undefined,
            email: (node.metadata.ownerEmail as string) || undefined,
          },
          url: (node.metadata.url as string) || undefined,
          maturity: (node.metadata.maturity as 'high' | 'medium' | 'low') || undefined,
          depends_on: {
            macros: [],
            nodes: parentMap[uniqueId] || [],
          },
          tags: Array.isArray(node.metadata.tags) ? (node.metadata.tags as string[]) : [],
          meta: node.metadata,
          created_at: node.createdAt,
        }
      } else {
        // Model/transformation/entity node
        const columns: DbtManifestNode['columns'] = {}
        const extractedCols = extractColumns(node)
        for (const [name, col] of Object.entries(extractedCols)) {
          columns[name] = {
            name: col.name,
            description: col.comment || '',
            meta: {},
            data_type: col.type,
            tags: [],
          }
        }

        const materialization = inferMaterialization(node)
        const rawSql = includeRawSql ? ((node.metadata.sql as string) || (node.metadata.raw_sql as string) || (node.metadata.code as string)) : undefined

        nodes[uniqueId] = {
          unique_id: uniqueId,
          resource_type: 'model',
          package_name: projectName,
          path: `models/${schema}/${node.name}.sql`,
          original_file_path: `models/${schema}/${node.name}.sql`,
          name: node.name,
          description: (node.metadata.description as string) || '',
          config: {
            enabled: true,
            materialized: materialization,
            tags: Array.isArray(node.metadata.tags) ? (node.metadata.tags as string[]) : [],
            schema,
          },
          database,
          schema,
          alias: node.name,
          depends_on: {
            macros: [],
            nodes: parentMap[uniqueId] || [],
          },
          columns,
          tags: Array.isArray(node.metadata.tags) ? (node.metadata.tags as string[]) : [],
          meta: node.metadata,
          compiled_sql: rawSql,
          raw_sql: rawSql,
          raw_code: rawSql,
          language: 'sql',
          docs: {
            show: true,
            node_color: node.type === 'transformation' ? '#7B68EE' : undefined,
          },
          deferred: false,
          unrendered_config: {},
          created_at: node.createdAt,
          relation_name: database ? `"${database}"."${schema}"."${node.name}"` : `"${schema}"."${node.name}"`,
        }
      }
    }

    return {
      metadata: {
        dbt_schema_version: this.manifestSchemaVersion,
        dbt_version: dbtVersion,
        generated_at: new Date().toISOString(),
        invocation_id: generateInvocationId(),
        env,
        project_name: projectName,
        project_id: projectId,
        adapter_type: adapterType,
      },
      nodes,
      sources,
      exposures,
      macros: {},
      docs: {},
      disabled: {},
      selectors: {},
      parent_map: parentMap,
      child_map: childMap,
    }
  }

  /**
   * Generate a complete dbt docs bundle
   *
   * Creates both catalog.json and manifest.json with consistent metadata.
   * This bundle can be used with dbt docs serve or uploaded to dbt Cloud.
   *
   * @example
   * ```typescript
   * const bundle = exporter.toDocsBundle(graph, {
   *   projectName: 'my_analytics',
   *   version: '1.2.0',
   * })
   *
   * await Bun.write('target/catalog.json', JSON.stringify(bundle.catalog, null, 2))
   * await Bun.write('target/manifest.json', JSON.stringify(bundle.manifest, null, 2))
   * ```
   */
  toDocsBundle(graph: LineageGraph, options?: DbtDocsBundleOptions): DbtDocsBundle {
    const { version = '1.0.0', ...sharedOptions } = options ?? {}

    const generatedAt = new Date().toISOString()
    const invocationId = generateInvocationId()

    // Generate catalog with shared invocation ID
    const catalog = this.toCatalog(graph, {
      ...sharedOptions,
    })
    catalog.metadata.generated_at = generatedAt
    catalog.metadata.invocation_id = invocationId

    // Generate manifest with shared invocation ID
    const manifest = this.toManifest(graph, {
      ...sharedOptions,
    })
    manifest.metadata.generated_at = generatedAt
    manifest.metadata.invocation_id = invocationId

    return {
      catalog,
      manifest,
      generatedAt,
      project: {
        name: options?.projectName || 'dotdo_project',
        version,
      },
    }
  }

  /**
   * Export catalog as formatted JSON string
   */
  catalogToJSON(graph: LineageGraph, options?: DbtCatalogOptions): string {
    return JSON.stringify(this.toCatalog(graph, options), null, 2)
  }

  /**
   * Export manifest as formatted JSON string
   */
  manifestToJSON(graph: LineageGraph, options?: DbtManifestOptions): string {
    return JSON.stringify(this.toManifest(graph, options), null, 2)
  }

  /**
   * Generate a simple lineage visualization in dbt-compatible format
   *
   * Returns a structure that can be consumed by dbt's lineage graph renderer.
   */
  toLineageGraph(graph: LineageGraph, options?: { projectName?: string }): {
    nodes: Array<{
      uniqueId: string
      name: string
      resourceType: DbtResourceType
      depends_on: string[]
      depended_on_by: string[]
    }>
    edges: Array<{
      source: string
      target: string
    }>
  } {
    const projectName = options?.projectName || 'dotdo_project'

    // Build node ID mapping
    const nodeIdToUniqueId = new Map<string, string>()
    for (const node of graph.nodes) {
      const uniqueId = generateDbtUniqueId(node, projectName)
      nodeIdToUniqueId.set(node.id, uniqueId)
    }

    // Build adjacency lists
    const dependsOn = new Map<string, string[]>()
    const dependedOnBy = new Map<string, string[]>()

    for (const edge of graph.edges) {
      const source = nodeIdToUniqueId.get(edge.fromNodeId)
      const target = nodeIdToUniqueId.get(edge.toNodeId)

      if (source && target) {
        if (!dependsOn.has(target)) {
          dependsOn.set(target, [])
        }
        dependsOn.get(target)!.push(source)

        if (!dependedOnBy.has(source)) {
          dependedOnBy.set(source, [])
        }
        dependedOnBy.get(source)!.push(target)
      }
    }

    return {
      nodes: graph.nodes.map((node) => {
        const uniqueId = generateDbtUniqueId(node, projectName)
        return {
          uniqueId,
          name: node.name,
          resourceType: mapNodeTypeToDbtResourceType(node.type),
          depends_on: dependsOn.get(uniqueId) || [],
          depended_on_by: dependedOnBy.get(uniqueId) || [],
        }
      }),
      edges: graph.edges
        .map((edge) => ({
          source: nodeIdToUniqueId.get(edge.fromNodeId)!,
          target: nodeIdToUniqueId.get(edge.toNodeId)!,
        }))
        .filter((e) => e.source && e.target),
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DbtDocsExporter instance
 *
 * @example
 * ```typescript
 * import { createDbtDocsExporter, createLineageTracker } from 'dotdo/db/primitives/lineage-tracker'
 *
 * const tracker = createLineageTracker(ctx.storage.sql)
 * const exporter = createDbtDocsExporter()
 *
 * // Build lineage
 * tracker.record({
 *   source: { type: 'source', name: 'raw_orders' },
 *   target: { type: 'entity', name: 'stg_orders' },
 *   operation: 'transform',
 * })
 *
 * // Export to dbt format
 * const graph = tracker.getFullLineage('stg_orders')
 * const bundle = exporter.toDocsBundle(graph, {
 *   projectName: 'ecommerce',
 *   version: '2.0.0',
 * })
 * ```
 */
export function createDbtDocsExporter(): DbtDocsExporter {
  return new DbtDocsExporter()
}
