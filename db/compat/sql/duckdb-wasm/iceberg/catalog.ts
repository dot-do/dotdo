/**
 * R2 Data Catalog Client for Iceberg Tables
 *
 * Provides REST API client for R2 Data Catalog, enabling:
 * - Table listing and discovery
 * - Metadata retrieval
 * - Table creation
 * - Table loading for queries
 *
 * The R2 Data Catalog implements the Iceberg REST Catalog specification,
 * allowing standard Iceberg tools to work with R2-stored data.
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/catalog
 * @see https://iceberg.apache.org/spec/#rest-catalog
 */

import type {
  R2CatalogConfig,
  TableMetadata,
  IcebergSchema,
  TableRef,
  Snapshot,
  PartitionSpec,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Table identifier from catalog API response
 */
interface TableIdentifier {
  namespace: string[]
  name: string
}

/**
 * Catalog API response for table listing
 */
interface ListTablesResponse {
  identifiers: TableIdentifier[]
}

/**
 * Catalog API response for table metadata
 */
interface LoadTableResponse {
  metadata: TableMetadata
  'metadata-location'?: string
}

/**
 * Create table request body
 */
interface CreateTableRequest {
  name: string
  schema: IcebergSchema
  'partition-spec'?: {
    fields: Array<{
      'source-id': number
      'field-id': number
      name: string
      transform: string
    }>
  }
  'write-order'?: {
    'order-id': number
    fields: Array<{
      'source-id': number
      transform: string
      direction: string
      'null-order': string
    }>
  }
  properties?: Record<string, string>
}

// ============================================================================
// R2 Catalog Client Class
// ============================================================================

/**
 * Client for interacting with R2 Data Catalog REST API
 */
export class R2CatalogClient {
  private config: R2CatalogConfig
  private fetchFn: typeof fetch
  private baseUrl: string

  constructor(config: R2CatalogConfig, fetchFn: typeof fetch = fetch) {
    this.config = config
    this.fetchFn = fetchFn
    this.baseUrl = this.buildBaseUrl()
  }

  /**
   * Build the base URL for catalog API requests
   */
  private buildBaseUrl(): string {
    const catalogPath = this.config.catalogPath ?? 'v1'
    return `${this.config.endpoint}/${catalogPath}`
  }

  /**
   * Build authorization headers for R2 requests
   */
  private buildHeaders(): Record<string, string> {
    // R2 Data Catalog uses AWS Signature V4 for authentication
    // For simplicity, we'll use bearer token if available or basic credentials
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add basic auth if credentials provided
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      const credentials = `${this.config.accessKeyId}:${this.config.secretAccessKey}`
      const encoded = typeof btoa !== 'undefined'
        ? btoa(credentials)
        : Buffer.from(credentials).toString('base64')
      headers['Authorization'] = `Basic ${encoded}`
    }

    return headers
  }

  /**
   * Make a request to the catalog API
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers = this.buildHeaders()

    const response = await this.fetchFn(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    })

    if (!response.ok) {
      throw new Error(`Catalog error: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * List all tables in a namespace
   *
   * @param namespace Namespace/database name
   * @returns Array of table names
   */
  async listTables(namespace: string): Promise<string[]> {
    const response = await this.request<ListTablesResponse>(
      `/namespaces/${encodeURIComponent(namespace)}/tables`
    )

    return response.identifiers.map((id) => id.name)
  }

  /**
   * Get table metadata from the catalog
   *
   * @param namespace Namespace/database name
   * @param tableName Table name
   * @returns Table metadata
   */
  async getTableMetadata(namespace: string, tableName: string): Promise<TableMetadata> {
    const response = await this.request<LoadTableResponse>(
      `/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(tableName)}`
    )

    return response.metadata
  }

  /**
   * Create a new table in the catalog
   *
   * @param namespace Namespace/database name
   * @param tableName Table name
   * @param schema Table schema
   * @param options Optional table creation options
   * @returns Created table metadata
   */
  async createTable(
    namespace: string,
    tableName: string,
    schema: IcebergSchema,
    options?: {
      partitionSpec?: PartitionSpec
      properties?: Record<string, string>
    }
  ): Promise<TableMetadata> {
    const request: CreateTableRequest = {
      name: tableName,
      schema,
      properties: options?.properties,
    }

    if (options?.partitionSpec) {
      request['partition-spec'] = {
        fields: options.partitionSpec.fields.map((f) => ({
          'source-id': f.sourceId,
          'field-id': f.fieldId,
          name: f.name,
          transform: f.transform,
        })),
      }
    }

    const response = await this.request<LoadTableResponse>(
      `/namespaces/${encodeURIComponent(namespace)}/tables`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    )

    return response.metadata
  }

  /**
   * Load a table for querying
   *
   * Returns a TableRef containing metadata and convenient accessors
   * for the current schema, partition spec, and snapshot.
   *
   * @param namespace Namespace/database name
   * @param tableName Table name
   * @returns Table reference with metadata
   */
  async loadTable(namespace: string, tableName: string): Promise<TableRef> {
    const metadata = await this.getTableMetadata(namespace, tableName)

    // Get current schema
    const currentSchema = metadata.schemas.find(
      (s) => s.schemaId === metadata.currentSchemaId
    )

    if (!currentSchema) {
      throw new Error(
        `Schema ${metadata.currentSchemaId} not found in table metadata`
      )
    }

    // Get current partition spec
    const partitionSpec = metadata.partitionSpecs.find(
      (s) => s.specId === metadata.defaultSpecId
    )

    if (!partitionSpec) {
      throw new Error(
        `Partition spec ${metadata.defaultSpecId} not found in table metadata`
      )
    }

    // Get current snapshot
    let currentSnapshot: Snapshot | null = null
    if (metadata.currentSnapshotId !== null) {
      currentSnapshot = metadata.snapshots.find(
        (s) => s.snapshotId === metadata.currentSnapshotId
      ) ?? null
    }

    return {
      namespace,
      tableName,
      metadata,
      schema: currentSchema,
      partitionSpec,
      currentSnapshot,
    }
  }

  /**
   * Drop a table from the catalog
   *
   * @param namespace Namespace/database name
   * @param tableName Table name
   * @param purge Whether to purge the data files
   */
  async dropTable(
    namespace: string,
    tableName: string,
    purge = false
  ): Promise<void> {
    await this.request<void>(
      `/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(tableName)}?purge=${purge}`,
      { method: 'DELETE' }
    )
  }

  /**
   * Check if a table exists
   *
   * @param namespace Namespace/database name
   * @param tableName Table name
   * @returns True if table exists
   */
  async tableExists(namespace: string, tableName: string): Promise<boolean> {
    try {
      await this.request<void>(
        `/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(tableName)}`,
        { method: 'HEAD' }
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * List all namespaces in the catalog
   *
   * @returns Array of namespace names
   */
  async listNamespaces(): Promise<string[]> {
    const response = await this.request<{ namespaces: string[][] }>('/namespaces')
    return response.namespaces.map((ns) => ns.join('.'))
  }

  /**
   * Create a namespace
   *
   * @param namespace Namespace name
   * @param properties Optional namespace properties
   */
  async createNamespace(
    namespace: string,
    properties?: Record<string, string>
  ): Promise<void> {
    await this.request<void>('/namespaces', {
      method: 'POST',
      body: JSON.stringify({
        namespace: namespace.split('.'),
        properties: properties || {},
      }),
    })
  }

  /**
   * Get catalog configuration
   */
  getConfig(): R2CatalogConfig {
    return { ...this.config }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an R2 Catalog Client
 *
 * @param config R2 catalog configuration
 * @param fetchFn Optional custom fetch function (for testing)
 * @returns R2CatalogClient instance
 *
 * @example
 * ```typescript
 * const client = createCatalogClient({
 *   accountId: 'abc123',
 *   accessKeyId: env.R2_ACCESS_KEY,
 *   secretAccessKey: env.R2_SECRET_KEY,
 *   endpoint: 'https://abc123.r2.cloudflarestorage.com',
 *   bucketName: 'iceberg-data',
 * })
 *
 * const tables = await client.listTables('analytics')
 * const metadata = await client.getTableMetadata('analytics', 'events')
 * ```
 */
export function createCatalogClient(
  config: R2CatalogConfig,
  fetchFn: typeof fetch = fetch
): R2CatalogClient {
  return new R2CatalogClient(config, fetchFn)
}
