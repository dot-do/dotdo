/**
 * REST Catalog Client for Iceberg
 *
 * Implements the Iceberg REST Catalog specification.
 *
 * @see https://iceberg.apache.org/spec/#rest-catalog
 * @module db/compat/sql/duckdb-wasm/iceberg/deep/catalog
 */

import type {
  IcebergCatalog,
  RESTCatalogConfig,
  CatalogConfig,
  NamespaceInfo,
  TableIdentifier,
  LoadedTable,
  CreateTableOptions,
  TableCommit,
  SchemaEvolution,
} from './types'
import type { TableMetadata, IcebergSchema } from '../types'

// ============================================================================
// REST Catalog Implementation
// ============================================================================

class RESTCatalogClient implements IcebergCatalog {
  private config: RESTCatalogConfig
  private fetchFn: typeof fetch
  private accessToken?: string
  private tokenExpiry?: number

  constructor(config: RESTCatalogConfig) {
    this.config = config
    this.fetchFn = config.fetchFn ?? fetch
  }

  /**
   * Make authenticated request to catalog API
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.uri}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    }

    // Add authentication
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    } else if (this.config.credentials) {
      const credentials = `${this.config.credentials.accessKeyId}:${this.config.credentials.secretAccessKey}`
      const encoded = typeof btoa !== 'undefined'
        ? btoa(credentials)
        : Buffer.from(credentials).toString('base64')
      headers['Authorization'] = `Basic ${encoded}`
    }

    const response = await this.fetchFn(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> || {}),
      },
    })

    if (!response.ok) {
      let errorMessage = `Catalog error: ${response.status} ${response.statusText}`
      try {
        const errorBody = await response.json() as { error?: { message?: string } }
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage)
    }

    return response.json() as Promise<T>
  }

  /**
   * Encode namespace for URL
   */
  private encodeNamespace(namespace: string[]): string {
    return namespace.map(encodeURIComponent).join('%1F')
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async getConfig(): Promise<CatalogConfig> {
    const response = await this.request<{
      defaults: Record<string, string>
      overrides: Record<string, string>
    }>('/config', { method: 'GET' })

    return {
      defaults: response.defaults,
      overrides: response.overrides,
      warehouse: response.defaults?.warehouse || this.config.warehouse,
    }
  }

  async authenticate(): Promise<void> {
    if (!this.config.oauth) {
      return
    }

    const { tokenEndpoint, clientId, clientSecret, scope } = this.config.oauth

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      ...(scope ? { scope } : {}),
    })

    const response = await this.fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new Error(`OAuth authentication failed: ${response.status}`)
    }

    const tokenResponse = await response.json() as {
      access_token: string
      token_type: string
      expires_in: number
    }

    this.accessToken = tokenResponse.access_token
    this.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000)
  }

  // ============================================================================
  // Namespace Operations
  // ============================================================================

  async listNamespaces(parent?: string[]): Promise<string[][]> {
    const path = parent
      ? `/namespaces?parent=${this.encodeNamespace(parent)}`
      : '/namespaces'

    const response = await this.request<{ namespaces: string[][] }>(path)
    return response.namespaces
  }

  async createNamespace(
    namespace: string[],
    properties?: Record<string, string>
  ): Promise<NamespaceInfo> {
    const response = await this.request<NamespaceInfo>('/namespaces', {
      method: 'POST',
      body: JSON.stringify({
        namespace,
        properties: properties || {},
      }),
    })

    return response
  }

  async getNamespaceProperties(namespace: string[]): Promise<Record<string, string>> {
    const response = await this.request<NamespaceInfo>(
      `/namespaces/${this.encodeNamespace(namespace)}`
    )
    return response.properties
  }

  // ============================================================================
  // Table Operations
  // ============================================================================

  async listTables(namespace: string[]): Promise<TableIdentifier[]> {
    const response = await this.request<{ identifiers: TableIdentifier[] }>(
      `/namespaces/${this.encodeNamespace(namespace)}/tables`
    )
    return response.identifiers
  }

  async loadTable(namespace: string[], name: string): Promise<LoadedTable> {
    const response = await this.request<{
      metadata: TableMetadata
      'metadata-location': string
    }>(`/namespaces/${this.encodeNamespace(namespace)}/tables/${encodeURIComponent(name)}`)

    return {
      metadata: response.metadata,
      metadataLocation: response['metadata-location'],
    }
  }

  async createTable(
    namespace: string[],
    name: string,
    options: CreateTableOptions
  ): Promise<LoadedTable> {
    const request: Record<string, unknown> = {
      name,
      schema: options.schema,
    }

    if (options.partitionSpec) {
      request['partition-spec'] = {
        'spec-id': options.partitionSpec.specId,
        fields: options.partitionSpec.fields.map((f) => ({
          'source-id': f.sourceId,
          'field-id': f.fieldId,
          name: f.name,
          transform: f.transform,
        })),
      }
    }

    if (options.writeOrder) {
      request['write-order'] = {
        'order-id': options.writeOrder.orderId,
        fields: options.writeOrder.fields.map((f) => ({
          'source-id': f.sourceId,
          transform: f.transform,
          direction: f.direction,
          'null-order': f.nullOrder,
        })),
      }
    }

    if (options.properties) {
      request.properties = options.properties
    }

    if (options.stageCreate) {
      request['stage-create'] = true
    }

    const response = await this.request<{
      metadata: TableMetadata
      'metadata-location'?: string
    }>(`/namespaces/${this.encodeNamespace(namespace)}/tables`, {
      method: 'POST',
      body: JSON.stringify(request),
    })

    return {
      metadata: response.metadata,
      metadataLocation: response['metadata-location'] || '',
    }
  }

  async commitTable(
    namespace: string[],
    name: string,
    commit: TableCommit
  ): Promise<void> {
    await this.request(
      `/namespaces/${this.encodeNamespace(namespace)}/tables/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        body: JSON.stringify(commit),
      }
    )
  }

  async dropTable(
    namespace: string[],
    name: string,
    purge = false
  ): Promise<void> {
    await this.request(
      `/namespaces/${this.encodeNamespace(namespace)}/tables/${encodeURIComponent(name)}?purge=${purge}`,
      { method: 'DELETE' }
    )
  }

  async renameTable(
    sourceNamespace: string[],
    sourceName: string,
    destNamespace: string[],
    destName: string
  ): Promise<void> {
    await this.request('/tables/rename', {
      method: 'POST',
      body: JSON.stringify({
        source: {
          namespace: sourceNamespace,
          name: sourceName,
        },
        destination: {
          namespace: destNamespace,
          name: destName,
        },
      }),
    })
  }

  async evolveSchema(
    namespace: string[],
    name: string,
    evolution: SchemaEvolution
  ): Promise<void> {
    const updates: Record<string, unknown>[] = []

    switch (evolution.type) {
      case 'add-column':
        updates.push({
          action: 'add-column',
          ...evolution.column,
        })
        break

      case 'rename-column':
        updates.push({
          action: 'rename-column',
          'column-id': evolution.columnId,
          'new-name': evolution.newName,
        })
        break

      case 'make-optional':
        updates.push({
          action: 'make-column-optional',
          'column-id': evolution.columnId,
        })
        break

      case 'update-column':
        updates.push({
          action: 'update-column',
          'column-id': evolution.columnId,
          type: evolution.newType,
        })
        break

      case 'delete-column':
        updates.push({
          action: 'delete-column',
          'column-id': evolution.columnId,
        })
        break
    }

    const commit: TableCommit = {
      requirements: [],
      updates: updates.map((u) => ({ action: u.action as string, ...u })),
    }

    await this.commitTable(namespace, name, commit)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a REST catalog client
 *
 * @param config - Catalog configuration
 * @returns Iceberg catalog instance
 *
 * @example
 * ```typescript
 * const catalog = createRESTCatalog({
 *   uri: 'https://catalog.example.com/v1',
 *   warehouse: 's3://iceberg-data/warehouse',
 *   credentials: {
 *     accessKeyId: 'access-key',
 *     secretAccessKey: 'secret-key',
 *   },
 * })
 *
 * const tables = await catalog.listTables(['analytics'])
 * const table = await catalog.loadTable(['analytics'], 'events')
 * ```
 */
export function createRESTCatalog(config: RESTCatalogConfig): IcebergCatalog {
  return new RESTCatalogClient(config)
}
