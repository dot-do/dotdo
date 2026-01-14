/**
 * Airbyte API Compatibility Layer
 *
 * Drop-in compatible Airbyte client backed by ConnectorFramework primitive.
 * Supports Airbyte Cloud/OSS API v1 specification.
 *
 * @example Basic usage
 * ```typescript
 * import { Airbyte } from '@dotdo/airbyte'
 *
 * const airbyte = new Airbyte()
 *
 * // Create a workspace
 * const workspace = await airbyte.workspaces.create({ name: 'My Workspace' })
 *
 * // Create a source
 * const source = await airbyte.sources.create({
 *   workspaceId: workspace.workspaceId,
 *   sourceDefinitionId: 'postgres',
 *   name: 'Production DB',
 *   connectionConfiguration: { host: 'localhost', port: 5432 }
 * })
 *
 * // Discover schema
 * const catalog = await airbyte.sources.discoverSchema({ sourceId: source.sourceId })
 * ```
 */

import {
  createConnectorFramework,
  createSourceConnector,
  createDestinationConnector,
  type ConnectorFramework,
  type SourceConnector,
  type DestinationConnector,
  type SourceConfig,
  type DestinationConfig,
  type Stream,
  type ConfiguredCatalog,
  type SyncState,
  type AirbyteMessage,
  type ConnectionStatus as ConnectorConnectionStatus,
  type SourceConnectorSpec,
  type DestinationConnectorSpec,
  type DestinationSyncMode as ConnectorDestSyncMode,
  discoverStreamFromRecords,
  discoverCatalogFromData,
} from '../../db/primitives/connector-framework'

import type {
  Workspace,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Source,
  CreateSourceRequest,
  UpdateSourceRequest,
  SourceDefinition,
  CheckConnectionResult,
  DiscoverSchemaRequest,
  AirbyteCatalog,
  AirbyteStream,
  AirbyteStreamConfiguration,
  Destination,
  CreateDestinationRequest,
  UpdateDestinationRequest,
  DestinationDefinition,
  Connection,
  CreateConnectionRequest,
  UpdateConnectionRequest,
  Job,
  JobWithAttempts,
  Attempt,
  TriggerSyncRequest,
  SyncResult,
  ListJobsRequest,
  ListJobsResponse,
  ListSourceDefinitionsRequest,
  ListDestinationDefinitionsRequest,
  ConnectorSpecification,
  JobStatus,
  JobConfigType,
  AttemptStatus,
  AirbyteClient,
  SyncMode,
  DestinationSyncMode,
} from './types'

// =============================================================================
// ID Generation
// =============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

// =============================================================================
// Store Interfaces
// =============================================================================

interface WorkspaceStore {
  get(id: string): Workspace | undefined
  set(id: string, workspace: Workspace): void
  delete(id: string): boolean
  list(): Workspace[]
}

interface SourceStore {
  get(id: string): Source | undefined
  set(id: string, source: Source): void
  delete(id: string): boolean
  listByWorkspace(workspaceId: string): Source[]
}

interface DestinationStore {
  get(id: string): Destination | undefined
  set(id: string, destination: Destination): void
  delete(id: string): boolean
  listByWorkspace(workspaceId: string): Destination[]
}

interface ConnectionStore {
  get(id: string): Connection | undefined
  set(id: string, connection: Connection): void
  delete(id: string): boolean
  listByWorkspace(workspaceId: string): Connection[]
}

interface JobStore {
  get(id: string): JobWithAttempts | undefined
  set(id: string, job: JobWithAttempts): void
  list(request: ListJobsRequest): ListJobsResponse
  getActiveByConnection(connectionId: string): Job | null
}

// =============================================================================
// In-Memory Stores
// =============================================================================

function createWorkspaceStore(): WorkspaceStore {
  const store = new Map<string, Workspace>()

  return {
    get: (id) => store.get(id),
    set: (id, workspace) => store.set(id, workspace),
    delete: (id) => store.delete(id),
    list: () => Array.from(store.values()),
  }
}

function createSourceStore(): SourceStore {
  const store = new Map<string, Source>()

  return {
    get: (id) => store.get(id),
    set: (id, source) => store.set(id, source),
    delete: (id) => store.delete(id),
    listByWorkspace: (workspaceId) =>
      Array.from(store.values()).filter((s) => s.workspaceId === workspaceId),
  }
}

function createDestinationStore(): DestinationStore {
  const store = new Map<string, Destination>()

  return {
    get: (id) => store.get(id),
    set: (id, destination) => store.set(id, destination),
    delete: (id) => store.delete(id),
    listByWorkspace: (workspaceId) =>
      Array.from(store.values()).filter((d) => d.workspaceId === workspaceId),
  }
}

function createConnectionStore(): ConnectionStore {
  const store = new Map<string, Connection>()

  return {
    get: (id) => store.get(id),
    set: (id, connection) => store.set(id, connection),
    delete: (id) => store.delete(id),
    listByWorkspace: (workspaceId) => {
      // Get all connections and filter by workspace through source lookup
      return Array.from(store.values())
    },
  }
}

function createJobStore(): JobStore {
  const store = new Map<string, JobWithAttempts>()

  return {
    get: (id) => store.get(id),
    set: (id, job) => store.set(id, job),
    list: (request) => {
      let jobs = Array.from(store.values())

      // Filter by configId
      if (request.configId) {
        jobs = jobs.filter((j) => j.job.configId === request.configId)
      }

      // Filter by config types
      if (request.configTypes?.length) {
        jobs = jobs.filter((j) => request.configTypes!.includes(j.job.configType))
      }

      // Filter by statuses
      if (request.statuses?.length) {
        jobs = jobs.filter((j) => request.statuses!.includes(j.job.status))
      }

      // Sort
      const orderBy = request.orderByField ?? 'createdAt'
      const orderMethod = request.orderByMethod ?? 'DESC'
      jobs.sort((a, b) => {
        const aVal = a.job[orderBy]
        const bVal = b.job[orderBy]
        return orderMethod === 'DESC' ? bVal - aVal : aVal - bVal
      })

      // Paginate
      const offset = request.pagination?.rowOffset ?? 0
      const limit = request.pagination?.pageSize ?? 20
      const totalJobCount = jobs.length
      jobs = jobs.slice(offset, offset + limit)

      return { jobs, totalJobCount }
    },
    getActiveByConnection: (connectionId) => {
      const jobs = Array.from(store.values())
      const active = jobs.find(
        (j) =>
          j.job.configId === connectionId &&
          j.job.configType === 'sync' &&
          (j.job.status === 'pending' || j.job.status === 'running')
      )
      return active?.job ?? null
    },
  }
}

// =============================================================================
// Default Source/Destination Definitions
// =============================================================================

const DEFAULT_SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    sourceDefinitionId: 'postgres',
    name: 'Postgres',
    dockerRepository: 'airbyte/source-postgres',
    dockerImageTag: '2.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/postgres',
    sourceType: 'database',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
  },
  {
    sourceDefinitionId: 'mysql',
    name: 'MySQL',
    dockerRepository: 'airbyte/source-mysql',
    dockerImageTag: '2.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/mysql',
    sourceType: 'database',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
  },
  {
    sourceDefinitionId: 'stripe',
    name: 'Stripe',
    dockerRepository: 'airbyte/source-stripe',
    dockerImageTag: '4.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/stripe',
    sourceType: 'api',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
  },
  {
    sourceDefinitionId: 'github',
    name: 'GitHub',
    dockerRepository: 'airbyte/source-github',
    dockerImageTag: '1.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/github',
    sourceType: 'api',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
  },
  {
    sourceDefinitionId: 'file',
    name: 'File (CSV, JSON, etc.)',
    dockerRepository: 'airbyte/source-file',
    dockerImageTag: '0.3.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/file',
    sourceType: 'file',
    releaseStage: 'generally_available',
    supportLevel: 'community',
  },
  {
    sourceDefinitionId: 'http',
    name: 'HTTP Request',
    dockerRepository: 'airbyte/source-http-request',
    dockerImageTag: '0.1.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/sources/http-request',
    sourceType: 'api',
    releaseStage: 'alpha',
    supportLevel: 'community',
  },
]

const DEFAULT_DESTINATION_DEFINITIONS: DestinationDefinition[] = [
  {
    destinationDefinitionId: 'postgres',
    name: 'Postgres',
    dockerRepository: 'airbyte/destination-postgres',
    dockerImageTag: '1.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/destinations/postgres',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
    supportedDestinationSyncModes: ['overwrite', 'append', 'append_dedup'],
  },
  {
    destinationDefinitionId: 'bigquery',
    name: 'BigQuery',
    dockerRepository: 'airbyte/destination-bigquery',
    dockerImageTag: '2.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/destinations/bigquery',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
    supportedDestinationSyncModes: ['overwrite', 'append', 'append_dedup'],
    supportsNormalization: true,
    supportsDbt: true,
  },
  {
    destinationDefinitionId: 'snowflake',
    name: 'Snowflake',
    dockerRepository: 'airbyte/destination-snowflake',
    dockerImageTag: '2.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/destinations/snowflake',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
    supportedDestinationSyncModes: ['overwrite', 'append', 'append_dedup'],
    supportsNormalization: true,
    supportsDbt: true,
  },
  {
    destinationDefinitionId: 's3',
    name: 'S3',
    dockerRepository: 'airbyte/destination-s3',
    dockerImageTag: '1.0.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/destinations/s3',
    releaseStage: 'generally_available',
    supportLevel: 'certified',
    supportedDestinationSyncModes: ['overwrite', 'append'],
  },
  {
    destinationDefinitionId: 'local-json',
    name: 'Local JSON',
    dockerRepository: 'airbyte/destination-local-json',
    dockerImageTag: '0.2.0',
    documentationUrl: 'https://docs.airbyte.com/integrations/destinations/local-json',
    releaseStage: 'alpha',
    supportLevel: 'community',
    supportedDestinationSyncModes: ['overwrite', 'append'],
  },
]

// =============================================================================
// Airbyte Client Implementation
// =============================================================================

export interface AirbyteOptions {
  /** Custom connector framework instance */
  connectorFramework?: ConnectorFramework
  /** Custom source definitions */
  sourceDefinitions?: SourceDefinition[]
  /** Custom destination definitions */
  destinationDefinitions?: DestinationDefinition[]
}

/**
 * Airbyte-compatible ETL platform client
 */
export class Airbyte implements AirbyteClient {
  private framework: ConnectorFramework
  private workspaceStore: WorkspaceStore
  private sourceStore: SourceStore
  private destinationStore: DestinationStore
  private connectionStore: ConnectionStore
  private jobStore: JobStore
  private sourceDefinitionMap: Map<string, SourceDefinition>
  private destinationDefinitionMap: Map<string, DestinationDefinition>
  private sourceConnectors: Map<string, SourceConnector>
  private destinationConnectors: Map<string, DestinationConnector>
  private syncStates: Map<string, SyncState>

  constructor(options: AirbyteOptions = {}) {
    this.framework = options.connectorFramework ?? createConnectorFramework()
    this.workspaceStore = createWorkspaceStore()
    this.sourceStore = createSourceStore()
    this.destinationStore = createDestinationStore()
    this.connectionStore = createConnectionStore()
    this.jobStore = createJobStore()

    // Initialize source definitions
    this.sourceDefinitionMap = new Map()
    const sourceDefs = options.sourceDefinitions ?? DEFAULT_SOURCE_DEFINITIONS
    for (const def of sourceDefs) {
      this.sourceDefinitionMap.set(def.sourceDefinitionId, def)
    }

    // Initialize destination definitions
    this.destinationDefinitionMap = new Map()
    const destDefs = options.destinationDefinitions ?? DEFAULT_DESTINATION_DEFINITIONS
    for (const def of destDefs) {
      this.destinationDefinitionMap.set(def.destinationDefinitionId, def)
    }

    // Runtime connectors (registered on source/destination creation)
    this.sourceConnectors = new Map()
    this.destinationConnectors = new Map()
    this.syncStates = new Map()
  }

  // ===========================================================================
  // Workspace APIs
  // ===========================================================================

  workspaces = {
    list: async (): Promise<Workspace[]> => {
      return this.workspaceStore.list()
    },

    get: async (workspaceId: string): Promise<Workspace> => {
      const workspace = this.workspaceStore.get(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      return workspace
    },

    create: async (request: CreateWorkspaceRequest): Promise<Workspace> => {
      const now = Date.now()
      const workspace: Workspace = {
        workspaceId: generateId(),
        name: request.name,
        slug: request.name.toLowerCase().replace(/\s+/g, '-'),
        initialSetupComplete: false,
        displaySetupWizard: true,
        anonymousDataCollection: true,
        news: true,
        securityUpdates: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      this.workspaceStore.set(workspace.workspaceId, workspace)
      return workspace
    },

    update: async (request: UpdateWorkspaceRequest): Promise<Workspace> => {
      const workspace = this.workspaceStore.get(request.workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${request.workspaceId}`)
      }

      const updated: Workspace = {
        ...workspace,
        name: request.name ?? workspace.name,
        notifications: request.notifications ?? workspace.notifications,
        anonymousDataCollection: request.anonymousDataCollection ?? workspace.anonymousDataCollection,
        news: request.news ?? workspace.news,
        securityUpdates: request.securityUpdates ?? workspace.securityUpdates,
        updatedAt: Date.now(),
      }

      this.workspaceStore.set(request.workspaceId, updated)
      return updated
    },

    delete: async (workspaceId: string): Promise<void> => {
      const workspace = this.workspaceStore.get(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      this.workspaceStore.delete(workspaceId)
    },
  }

  // ===========================================================================
  // Source APIs
  // ===========================================================================

  sources = {
    list: async (workspaceId: string): Promise<Source[]> => {
      return this.sourceStore.listByWorkspace(workspaceId)
    },

    get: async (sourceId: string): Promise<Source> => {
      const source = this.sourceStore.get(sourceId)
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`)
      }
      return source
    },

    create: async (request: CreateSourceRequest): Promise<Source> => {
      // Validate workspace exists
      const workspace = this.workspaceStore.get(request.workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${request.workspaceId}`)
      }

      // Validate source definition exists
      const definition = this.sourceDefinitionMap.get(request.sourceDefinitionId)
      if (!definition) {
        throw new Error(`Source definition not found: ${request.sourceDefinitionId}`)
      }

      const now = Date.now()
      const source: Source = {
        sourceId: generateId(),
        sourceDefinitionId: request.sourceDefinitionId,
        workspaceId: request.workspaceId,
        name: request.name,
        connectionConfiguration: request.connectionConfiguration,
        sourceName: definition.name,
        icon: definition.icon,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }

      this.sourceStore.set(source.sourceId, source)

      // Create a source connector for this source
      this._createSourceConnector(source)

      return source
    },

    update: async (request: UpdateSourceRequest): Promise<Source> => {
      const source = this.sourceStore.get(request.sourceId)
      if (!source) {
        throw new Error(`Source not found: ${request.sourceId}`)
      }

      const updated: Source = {
        ...source,
        name: request.name ?? source.name,
        connectionConfiguration: request.connectionConfiguration ?? source.connectionConfiguration,
        updatedAt: Date.now(),
      }

      this.sourceStore.set(request.sourceId, updated)
      return updated
    },

    delete: async (sourceId: string): Promise<void> => {
      const source = this.sourceStore.get(sourceId)
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`)
      }
      this.sourceStore.delete(sourceId)
      this.sourceConnectors.delete(sourceId)
    },

    checkConnection: async (sourceId: string): Promise<CheckConnectionResult> => {
      const source = this.sourceStore.get(sourceId)
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      const connector = this.sourceConnectors.get(sourceId)
      if (!connector) {
        throw new Error(`Source connector not initialized: ${sourceId}`)
      }

      const jobId = generateId()
      const now = Date.now()

      try {
        const result = await connector.check(source.connectionConfiguration)
        return {
          status: result.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
          message: result.message,
          jobInfo: {
            id: jobId,
            createdAt: now,
            endedAt: Date.now(),
            succeeded: result.status === 'SUCCEEDED',
          },
        }
      } catch (err) {
        return {
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
          jobInfo: {
            id: jobId,
            createdAt: now,
            endedAt: Date.now(),
            succeeded: false,
          },
        }
      }
    },

    discoverSchema: async (request: DiscoverSchemaRequest): Promise<AirbyteCatalog> => {
      const source = this.sourceStore.get(request.sourceId)
      if (!source) {
        throw new Error(`Source not found: ${request.sourceId}`)
      }

      const connector = this.sourceConnectors.get(request.sourceId)
      if (!connector) {
        throw new Error(`Source connector not initialized: ${request.sourceId}`)
      }

      const streams = await connector.discover(source.connectionConfiguration)
      return this._convertToCatalog(streams)
    },
  }

  // ===========================================================================
  // Source Definition APIs
  // ===========================================================================

  sourceDefinitions = {
    list: async (_request?: ListSourceDefinitionsRequest): Promise<SourceDefinition[]> => {
      return Array.from(this.sourceDefinitionMap.values())
    },

    get: async (sourceDefinitionId: string): Promise<SourceDefinition> => {
      const definition = this.sourceDefinitionMap.get(sourceDefinitionId)
      if (!definition) {
        throw new Error(`Source definition not found: ${sourceDefinitionId}`)
      }
      return definition
    },

    getSpec: async (sourceDefinitionId: string): Promise<ConnectorSpecification> => {
      const definition = this.sourceDefinitionMap.get(sourceDefinitionId)
      if (!definition) {
        throw new Error(`Source definition not found: ${sourceDefinitionId}`)
      }

      // Return a basic spec based on definition type
      return {
        connectionSpecification: this._getSourceConnectionSpec(sourceDefinitionId),
        supportsIncremental: true,
        documentationUrl: definition.documentationUrl,
      }
    },
  }

  // ===========================================================================
  // Destination APIs
  // ===========================================================================

  destinations = {
    list: async (workspaceId: string): Promise<Destination[]> => {
      return this.destinationStore.listByWorkspace(workspaceId)
    },

    get: async (destinationId: string): Promise<Destination> => {
      const destination = this.destinationStore.get(destinationId)
      if (!destination) {
        throw new Error(`Destination not found: ${destinationId}`)
      }
      return destination
    },

    create: async (request: CreateDestinationRequest): Promise<Destination> => {
      // Validate workspace exists
      const workspace = this.workspaceStore.get(request.workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${request.workspaceId}`)
      }

      // Validate destination definition exists
      const definition = this.destinationDefinitionMap.get(request.destinationDefinitionId)
      if (!definition) {
        throw new Error(`Destination definition not found: ${request.destinationDefinitionId}`)
      }

      const now = Date.now()
      const destination: Destination = {
        destinationId: generateId(),
        destinationDefinitionId: request.destinationDefinitionId,
        workspaceId: request.workspaceId,
        name: request.name,
        connectionConfiguration: request.connectionConfiguration,
        destinationName: definition.name,
        icon: definition.icon,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }

      this.destinationStore.set(destination.destinationId, destination)

      // Create a destination connector
      this._createDestinationConnector(destination)

      return destination
    },

    update: async (request: UpdateDestinationRequest): Promise<Destination> => {
      const destination = this.destinationStore.get(request.destinationId)
      if (!destination) {
        throw new Error(`Destination not found: ${request.destinationId}`)
      }

      const updated: Destination = {
        ...destination,
        name: request.name ?? destination.name,
        connectionConfiguration: request.connectionConfiguration ?? destination.connectionConfiguration,
        updatedAt: Date.now(),
      }

      this.destinationStore.set(request.destinationId, updated)
      return updated
    },

    delete: async (destinationId: string): Promise<void> => {
      const destination = this.destinationStore.get(destinationId)
      if (!destination) {
        throw new Error(`Destination not found: ${destinationId}`)
      }
      this.destinationStore.delete(destinationId)
      this.destinationConnectors.delete(destinationId)
    },

    checkConnection: async (destinationId: string): Promise<CheckConnectionResult> => {
      const destination = this.destinationStore.get(destinationId)
      if (!destination) {
        throw new Error(`Destination not found: ${destinationId}`)
      }

      const connector = this.destinationConnectors.get(destinationId)
      if (!connector) {
        throw new Error(`Destination connector not initialized: ${destinationId}`)
      }

      const jobId = generateId()
      const now = Date.now()

      try {
        const result = await connector.check(destination.connectionConfiguration)
        return {
          status: result.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
          message: result.message,
          jobInfo: {
            id: jobId,
            createdAt: now,
            endedAt: Date.now(),
            succeeded: result.status === 'SUCCEEDED',
          },
        }
      } catch (err) {
        return {
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
          jobInfo: {
            id: jobId,
            createdAt: now,
            endedAt: Date.now(),
            succeeded: false,
          },
        }
      }
    },
  }

  // ===========================================================================
  // Destination Definition APIs
  // ===========================================================================

  destinationDefinitions = {
    list: async (_request?: ListDestinationDefinitionsRequest): Promise<DestinationDefinition[]> => {
      return Array.from(this.destinationDefinitionMap.values())
    },

    get: async (destinationDefinitionId: string): Promise<DestinationDefinition> => {
      const definition = this.destinationDefinitionMap.get(destinationDefinitionId)
      if (!definition) {
        throw new Error(`Destination definition not found: ${destinationDefinitionId}`)
      }
      return definition
    },

    getSpec: async (destinationDefinitionId: string): Promise<ConnectorSpecification> => {
      const definition = this.destinationDefinitionMap.get(destinationDefinitionId)
      if (!definition) {
        throw new Error(`Destination definition not found: ${destinationDefinitionId}`)
      }

      return {
        connectionSpecification: this._getDestinationConnectionSpec(destinationDefinitionId),
        supportedDestinationSyncModes: definition.supportedDestinationSyncModes,
        supportsNormalization: definition.supportsNormalization,
        supportsDBT: definition.supportsDbt,
        documentationUrl: definition.documentationUrl,
      }
    },
  }

  // ===========================================================================
  // Connection APIs
  // ===========================================================================

  connections = {
    list: async (workspaceId: string): Promise<Connection[]> => {
      // Get all connections where source is in the workspace
      const sources = this.sourceStore.listByWorkspace(workspaceId)
      const sourceIds = new Set(sources.map((s) => s.sourceId))
      return this.connectionStore.listByWorkspace(workspaceId).filter((c) => sourceIds.has(c.sourceId))
    },

    get: async (connectionId: string): Promise<Connection> => {
      const connection = this.connectionStore.get(connectionId)
      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`)
      }
      return connection
    },

    create: async (request: CreateConnectionRequest): Promise<Connection> => {
      // Validate source exists
      const source = this.sourceStore.get(request.sourceId)
      if (!source) {
        throw new Error(`Source not found: ${request.sourceId}`)
      }

      // Validate destination exists
      const destination = this.destinationStore.get(request.destinationId)
      if (!destination) {
        throw new Error(`Destination not found: ${request.destinationId}`)
      }

      // If no catalog provided, discover from source
      let catalog = request.syncCatalog
      if (!catalog) {
        const connector = this.sourceConnectors.get(request.sourceId)
        if (connector) {
          const streams = await connector.discover(source.connectionConfiguration)
          catalog = this._convertToCatalog(streams)
        } else {
          catalog = { streams: [] }
        }
      }

      const now = Date.now()
      const connection: Connection = {
        connectionId: generateId(),
        name: request.name ?? `${source.name} -> ${destination.name}`,
        namespaceDefinition: request.namespaceDefinition ?? 'source',
        namespaceFormat: request.namespaceFormat,
        prefix: request.prefix,
        sourceId: request.sourceId,
        destinationId: request.destinationId,
        operationIds: request.operationIds,
        syncCatalog: catalog,
        schedule: request.schedule,
        scheduleType: request.scheduleType ?? 'manual',
        scheduleData: request.scheduleData,
        status: request.status ?? 'active',
        resourceRequirements: request.resourceRequirements,
        geography: request.geography ?? 'auto',
        nonBreakingChangesPreference: request.nonBreakingChangesPreference ?? 'ignore',
        createdAt: now,
        updatedAt: now,
      }

      this.connectionStore.set(connection.connectionId, connection)

      // Initialize sync state for this connection
      this.syncStates.set(connection.connectionId, { streams: {} })

      return connection
    },

    update: async (request: UpdateConnectionRequest): Promise<Connection> => {
      const connection = this.connectionStore.get(request.connectionId)
      if (!connection) {
        throw new Error(`Connection not found: ${request.connectionId}`)
      }

      const updated: Connection = {
        ...connection,
        namespaceDefinition: request.namespaceDefinition ?? connection.namespaceDefinition,
        namespaceFormat: request.namespaceFormat ?? connection.namespaceFormat,
        prefix: request.prefix ?? connection.prefix,
        operationIds: request.operationIds ?? connection.operationIds,
        syncCatalog: request.syncCatalog ?? connection.syncCatalog,
        schedule: request.schedule ?? connection.schedule,
        scheduleType: request.scheduleType ?? connection.scheduleType,
        scheduleData: request.scheduleData ?? connection.scheduleData,
        status: request.status ?? connection.status,
        resourceRequirements: request.resourceRequirements ?? connection.resourceRequirements,
        sourceCatalogId: request.sourceCatalogId ?? connection.sourceCatalogId,
        name: request.name ?? connection.name,
        geography: request.geography ?? connection.geography,
        notifySchemaChanges: request.notifySchemaChanges ?? connection.notifySchemaChanges,
        notifySchemaChangesByEmail: request.notifySchemaChangesByEmail ?? connection.notifySchemaChangesByEmail,
        nonBreakingChangesPreference: request.nonBreakingChangesPreference ?? connection.nonBreakingChangesPreference,
        updatedAt: Date.now(),
      }

      this.connectionStore.set(request.connectionId, updated)
      return updated
    },

    delete: async (connectionId: string): Promise<void> => {
      const connection = this.connectionStore.get(connectionId)
      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`)
      }
      this.connectionStore.delete(connectionId)
      this.syncStates.delete(connectionId)
    },
  }

  // ===========================================================================
  // Job APIs
  // ===========================================================================

  jobs = {
    list: async (request: ListJobsRequest): Promise<ListJobsResponse> => {
      return this.jobStore.list(request)
    },

    get: async (jobId: string): Promise<JobWithAttempts> => {
      const job = this.jobStore.get(jobId)
      if (!job) {
        throw new Error(`Job not found: ${jobId}`)
      }
      return job
    },

    cancel: async (jobId: string): Promise<Job> => {
      const jobWithAttempts = this.jobStore.get(jobId)
      if (!jobWithAttempts) {
        throw new Error(`Job not found: ${jobId}`)
      }

      const job = jobWithAttempts.job
      if (job.status !== 'pending' && job.status !== 'running') {
        throw new Error(`Cannot cancel job in status: ${job.status}`)
      }

      const now = Date.now()
      const cancelled: Job = {
        ...job,
        status: 'cancelled',
        updatedAt: now,
        endedAt: now,
      }

      // Update attempt status
      const updatedAttempts = jobWithAttempts.attempts.map((a) => {
        if (a.status === 'running' || a.status === 'pending') {
          return { ...a, status: 'failed' as AttemptStatus, endedAt: now, updatedAt: now }
        }
        return a
      })

      this.jobStore.set(jobId, { job: cancelled, attempts: updatedAttempts })
      return cancelled
    },
  }

  // ===========================================================================
  // Sync APIs
  // ===========================================================================

  sync = {
    trigger: async (request: TriggerSyncRequest): Promise<SyncResult> => {
      const connection = this.connectionStore.get(request.connectionId)
      if (!connection) {
        throw new Error(`Connection not found: ${request.connectionId}`)
      }

      if (connection.status !== 'active') {
        throw new Error(`Connection is not active: ${connection.status}`)
      }

      // Check if there's already an active job
      const activeJob = this.jobStore.getActiveByConnection(request.connectionId)
      if (activeJob) {
        throw new Error(`Connection already has an active job: ${activeJob.id}`)
      }

      const now = Date.now()
      const jobId = generateId()
      const jobType = request.jobType ?? 'sync'

      const job: Job = {
        id: jobId,
        configType: jobType === 'reset' ? 'reset_connection' : 'sync',
        configId: request.connectionId,
        status: 'running',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      }

      const attempt: Attempt = {
        id: 0,
        status: 'running',
        createdAt: now,
        updatedAt: now,
      }

      this.jobStore.set(jobId, { job, attempts: [attempt] })

      // Execute the sync asynchronously
      this._executeSync(request.connectionId, jobId).catch((err) => {
        console.error('Sync failed:', err)
      })

      return { job }
    },

    getStatus: async (connectionId: string): Promise<Job | null> => {
      return this.jobStore.getActiveByConnection(connectionId)
    },
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _createSourceConnector(source: Source): void {
    const connector = createSourceConnector({
      spec: async () => ({
        name: source.sourceName ?? source.name,
        version: '1.0.0',
        configSpec: {
          type: 'object' as const,
          properties: {},
        },
      }),
      check: async (_config) => ({ status: 'SUCCEEDED' as const }),
      discover: async (_config) => [],
      read: async function* (_config, _catalog, _state) {
        // Default implementation - yields nothing
      },
    })

    this.sourceConnectors.set(source.sourceId, connector)
  }

  private _createDestinationConnector(destination: Destination): void {
    const definition = this.destinationDefinitionMap.get(destination.destinationDefinitionId)
    const supportedModes = definition?.supportedDestinationSyncModes ?? ['overwrite', 'append']

    const connector = createDestinationConnector({
      spec: async () => ({
        name: destination.destinationName ?? destination.name,
        version: '1.0.0',
        configSpec: {
          type: 'object' as const,
          properties: {},
        },
        supportedSyncModes: supportedModes as ConnectorDestSyncMode[],
      }),
      check: async (_config) => ({ status: 'SUCCEEDED' as const }),
      write: async function* (_config, _catalog, _messages) {
        // Default implementation - yields nothing
      },
    })

    this.destinationConnectors.set(destination.destinationId, connector)
  }

  private _convertToCatalog(streams: Stream[]): AirbyteCatalog {
    return {
      streams: streams.map((s) => ({
        stream: {
          name: s.name,
          namespace: s.namespace,
          jsonSchema: {
            type: 'object',
            properties: s.schema.properties,
          },
          supportedSyncModes: s.supportedSyncModes,
          sourceDefinedPrimaryKey: s.sourceDefinedPrimaryKey,
          sourceDefinedCursor: s.sourceDefinedCursor,
          defaultCursorField: s.defaultCursorField,
        },
        config: {
          syncMode: s.supportedSyncModes.includes('incremental') ? 'incremental' : 'full_refresh',
          destinationSyncMode: 'append',
          cursorField: s.defaultCursorField,
          primaryKey: s.sourceDefinedPrimaryKey,
          selected: true,
        },
      })),
    }
  }

  private _getSourceConnectionSpec(sourceDefinitionId: string): Record<string, unknown> {
    // Return basic specs based on connector type
    switch (sourceDefinitionId) {
      case 'postgres':
      case 'mysql':
        return {
          type: 'object',
          required: ['host', 'port', 'database', 'username'],
          properties: {
            host: { type: 'string', description: 'Database host' },
            port: { type: 'integer', description: 'Database port' },
            database: { type: 'string', description: 'Database name' },
            username: { type: 'string', description: 'Database username' },
            password: { type: 'string', description: 'Database password', airbyte_secret: true },
            ssl_mode: { type: 'string', enum: ['disable', 'allow', 'prefer', 'require'] },
          },
        }
      case 'stripe':
      case 'github':
        return {
          type: 'object',
          required: ['api_key'],
          properties: {
            api_key: { type: 'string', description: 'API key', airbyte_secret: true },
            start_date: { type: 'string', format: 'date-time', description: 'Start date for sync' },
          },
        }
      case 'file':
        return {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'File URL' },
            format: { type: 'string', enum: ['csv', 'json', 'jsonl', 'parquet'] },
          },
        }
      default:
        return { type: 'object', properties: {} }
    }
  }

  private _getDestinationConnectionSpec(destinationDefinitionId: string): Record<string, unknown> {
    switch (destinationDefinitionId) {
      case 'postgres':
        return {
          type: 'object',
          required: ['host', 'port', 'database', 'username'],
          properties: {
            host: { type: 'string', description: 'Database host' },
            port: { type: 'integer', description: 'Database port' },
            database: { type: 'string', description: 'Database name' },
            schema: { type: 'string', description: 'Schema name', default: 'public' },
            username: { type: 'string', description: 'Database username' },
            password: { type: 'string', description: 'Database password', airbyte_secret: true },
          },
        }
      case 'bigquery':
        return {
          type: 'object',
          required: ['project_id', 'dataset_id', 'credentials_json'],
          properties: {
            project_id: { type: 'string', description: 'GCP project ID' },
            dataset_id: { type: 'string', description: 'BigQuery dataset ID' },
            dataset_location: { type: 'string', description: 'Dataset location', default: 'US' },
            credentials_json: { type: 'string', description: 'Service account JSON', airbyte_secret: true },
          },
        }
      case 'snowflake':
        return {
          type: 'object',
          required: ['account', 'warehouse', 'database', 'schema', 'username'],
          properties: {
            account: { type: 'string', description: 'Snowflake account identifier' },
            warehouse: { type: 'string', description: 'Warehouse name' },
            database: { type: 'string', description: 'Database name' },
            schema: { type: 'string', description: 'Schema name' },
            username: { type: 'string', description: 'Username' },
            password: { type: 'string', description: 'Password', airbyte_secret: true },
          },
        }
      case 's3':
        return {
          type: 'object',
          required: ['bucket_name', 'region'],
          properties: {
            bucket_name: { type: 'string', description: 'S3 bucket name' },
            region: { type: 'string', description: 'AWS region' },
            access_key_id: { type: 'string', description: 'AWS access key ID', airbyte_secret: true },
            secret_access_key: { type: 'string', description: 'AWS secret access key', airbyte_secret: true },
            s3_path_format: { type: 'string', description: 'S3 path format' },
          },
        }
      default:
        return { type: 'object', properties: {} }
    }
  }

  private async _executeSync(connectionId: string, jobId: string): Promise<void> {
    const connection = this.connectionStore.get(connectionId)
    if (!connection) {
      this._failJob(jobId, 'Connection not found')
      return
    }

    const source = this.sourceStore.get(connection.sourceId)
    const destination = this.destinationStore.get(connection.destinationId)
    if (!source || !destination) {
      this._failJob(jobId, 'Source or destination not found')
      return
    }

    const sourceConnector = this.sourceConnectors.get(source.sourceId)
    const destConnector = this.destinationConnectors.get(destination.destinationId)
    if (!sourceConnector || !destConnector) {
      this._failJob(jobId, 'Connectors not initialized')
      return
    }

    try {
      // Get current sync state
      const state = this.syncStates.get(connectionId) ?? { streams: {} }

      // Build configured catalog
      const catalog: ConfiguredCatalog = {
        streams: connection.syncCatalog.streams
          .filter((s) => s.config.selected !== false)
          .map((s) => ({
            name: s.stream.name,
            syncMode: s.config.syncMode,
            destinationSyncMode: s.config.destinationSyncMode,
            cursorField: s.config.cursorField,
            primaryKey: s.config.primaryKey,
          })),
      }

      // Read from source
      const messages = sourceConnector.read(source.connectionConfiguration, catalog, state)

      // Write to destination
      let recordsSynced = 0
      let bytesSynced = 0

      const destOutput = destConnector.write(destination.connectionConfiguration, catalog, messages)

      for await (const message of destOutput) {
        if (message.type === 'RECORD') {
          recordsSynced++
          bytesSynced += JSON.stringify(message.record.data).length
        } else if (message.type === 'STATE') {
          // Update sync state
          if (message.state.type === 'STREAM' && message.state.stream) {
            state.streams[message.state.stream.streamDescriptor.name] = message.state.stream.streamState
          }
        }
      }

      // Save updated state
      this.syncStates.set(connectionId, state)

      // Update job as succeeded
      this._completeJob(jobId, recordsSynced, bytesSynced)
    } catch (err) {
      this._failJob(jobId, err instanceof Error ? err.message : String(err))
    }
  }

  private _failJob(jobId: string, message: string): void {
    const jobWithAttempts = this.jobStore.get(jobId)
    if (!jobWithAttempts) return

    const now = Date.now()
    const job: Job = {
      ...jobWithAttempts.job,
      status: 'failed',
      updatedAt: now,
      endedAt: now,
    }

    const attempts = jobWithAttempts.attempts.map((a, i) => {
      if (i === jobWithAttempts.attempts.length - 1) {
        return {
          ...a,
          status: 'failed' as AttemptStatus,
          updatedAt: now,
          endedAt: now,
          failureSummary: {
            failures: [
              {
                failureOrigin: 'airbyte_platform' as const,
                failureType: 'system_error' as const,
                externalMessage: message,
              },
            ],
          },
        }
      }
      return a
    })

    this.jobStore.set(jobId, { job, attempts })
  }

  private _completeJob(jobId: string, recordsSynced: number, bytesSynced: number): void {
    const jobWithAttempts = this.jobStore.get(jobId)
    if (!jobWithAttempts) return

    const now = Date.now()
    const job: Job = {
      ...jobWithAttempts.job,
      status: 'succeeded',
      updatedAt: now,
      endedAt: now,
    }

    const attempts = jobWithAttempts.attempts.map((a, i) => {
      if (i === jobWithAttempts.attempts.length - 1) {
        return {
          ...a,
          status: 'succeeded' as AttemptStatus,
          updatedAt: now,
          endedAt: now,
          recordsSynced,
          bytesSynced,
          totalStats: {
            recordsEmitted: recordsSynced,
            bytesEmitted: bytesSynced,
            recordsCommitted: recordsSynced,
            bytesCommitted: bytesSynced,
          },
        }
      }
      return a
    })

    this.jobStore.set(jobId, { job, attempts })
  }

  // ===========================================================================
  // Public Utilities
  // ===========================================================================

  /**
   * Register a custom source connector
   */
  registerSourceConnector(sourceId: string, connector: SourceConnector): void {
    this.sourceConnectors.set(sourceId, connector)
  }

  /**
   * Register a custom destination connector
   */
  registerDestinationConnector(destinationId: string, connector: DestinationConnector): void {
    this.destinationConnectors.set(destinationId, connector)
  }

  /**
   * Get the underlying connector framework
   */
  getConnectorFramework(): ConnectorFramework {
    return this.framework
  }
}

/**
 * Factory function for creating Airbyte client
 */
export function createAirbyte(options?: AirbyteOptions): Airbyte {
  return new Airbyte(options)
}
