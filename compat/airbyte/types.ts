/**
 * Airbyte API Types
 *
 * TypeScript definitions for Airbyte Cloud/OSS API compatibility.
 * Maps to Airbyte API v1 specification.
 *
 * @see https://reference.airbyte.com/reference/getting-started
 */

// =============================================================================
// Workspace Types
// =============================================================================

/**
 * Workspace status
 */
export type WorkspaceStatus = 'active' | 'inactive' | 'deleted'

/**
 * Workspace configuration
 */
export interface Workspace {
  workspaceId: string
  name: string
  slug?: string
  initialSetupComplete?: boolean
  displaySetupWizard?: boolean
  anonymousDataCollection?: boolean
  news?: boolean
  securityUpdates?: boolean
  notifications?: NotificationSettings
  status: WorkspaceStatus
  createdAt: number
  updatedAt: number
}

/**
 * Workspace notification settings
 */
export interface NotificationSettings {
  sendOnSuccess?: boolean
  sendOnFailure?: boolean
  sendOnConnectionUpdate?: boolean
  sendOnConnectionUpdateActionRequired?: boolean
  sendOnSyncDisabled?: boolean
  sendOnSyncDisabledWarning?: boolean
  notificationItem?: NotificationItem[]
}

/**
 * Notification item
 */
export interface NotificationItem {
  notificationType: 'slack' | 'email' | 'webhook'
  slackConfiguration?: {
    webhook: string
  }
  emailConfiguration?: {
    email: string
  }
  webhookConfiguration?: {
    webhook: string
  }
}

/**
 * Workspace creation request
 */
export interface CreateWorkspaceRequest {
  name: string
  email?: string
  organizationId?: string
}

/**
 * Workspace update request
 */
export interface UpdateWorkspaceRequest {
  workspaceId: string
  name?: string
  notifications?: NotificationSettings
  anonymousDataCollection?: boolean
  news?: boolean
  securityUpdates?: boolean
}

// =============================================================================
// Source Types
// =============================================================================

/**
 * Source configuration
 */
export interface Source {
  sourceId: string
  sourceDefinitionId: string
  workspaceId: string
  name: string
  connectionConfiguration: Record<string, unknown>
  sourceName?: string
  icon?: string
  status?: 'active' | 'deprecated' | 'inactive'
  createdAt: number
  updatedAt: number
}

/**
 * Source definition - describes a type of source
 */
export interface SourceDefinition {
  sourceDefinitionId: string
  name: string
  dockerRepository: string
  dockerImageTag: string
  documentationUrl?: string
  icon?: string
  sourceType?: 'api' | 'file' | 'database' | 'custom'
  releaseStage?: 'alpha' | 'beta' | 'generally_available' | 'custom'
  releaseDate?: string
  supportLevel?: 'community' | 'certified' | 'custom'
  resourceRequirements?: ResourceRequirements
  protocolVersion?: string
  maxSecondsBetweenMessages?: number
}

/**
 * Resource requirements for a connector
 */
export interface ResourceRequirements {
  cpu_request?: string
  cpu_limit?: string
  memory_request?: string
  memory_limit?: string
}

/**
 * Source creation request
 */
export interface CreateSourceRequest {
  workspaceId: string
  sourceDefinitionId: string
  name: string
  connectionConfiguration: Record<string, unknown>
}

/**
 * Source update request
 */
export interface UpdateSourceRequest {
  sourceId: string
  name?: string
  connectionConfiguration?: Record<string, unknown>
}

/**
 * Check connection result
 */
export interface CheckConnectionResult {
  status: 'succeeded' | 'failed'
  message?: string
  jobInfo?: {
    id: string
    createdAt: number
    endedAt?: number
    succeeded: boolean
    connectorConfigurationUpdated?: boolean
  }
}

/**
 * Discover schema request
 */
export interface DiscoverSchemaRequest {
  sourceId: string
  disable_cache?: boolean
  connectionId?: string
  notifySchemaChange?: boolean
}

/**
 * Catalog discovery result
 */
export interface AirbyteCatalog {
  streams: AirbyteStreamAndConfiguration[]
}

/**
 * Stream and its configuration
 */
export interface AirbyteStreamAndConfiguration {
  stream: AirbyteStream
  config: AirbyteStreamConfiguration
}

/**
 * Stream metadata from source
 */
export interface AirbyteStream {
  name: string
  namespace?: string
  jsonSchema: Record<string, unknown>
  supportedSyncModes: SyncMode[]
  sourceDefinedPrimaryKey?: string[][]
  sourceDefinedCursor?: boolean
  defaultCursorField?: string[]
}

/**
 * Stream configuration for sync
 */
export interface AirbyteStreamConfiguration {
  syncMode: SyncMode
  destinationSyncMode: DestinationSyncMode
  cursorField?: string[]
  primaryKey?: string[][]
  aliasName?: string
  selected?: boolean
  suggested?: boolean
  fieldSelectionEnabled?: boolean
  selectedFields?: SelectedField[]
}

/**
 * Selected field for partial sync
 */
export interface SelectedField {
  fieldPath: string[]
}

/**
 * Sync modes
 */
export type SyncMode = 'full_refresh' | 'incremental'

/**
 * Destination sync modes
 */
export type DestinationSyncMode = 'overwrite' | 'append' | 'append_dedup'

// =============================================================================
// Destination Types
// =============================================================================

/**
 * Destination configuration
 */
export interface Destination {
  destinationId: string
  destinationDefinitionId: string
  workspaceId: string
  name: string
  connectionConfiguration: Record<string, unknown>
  destinationName?: string
  icon?: string
  status?: 'active' | 'deprecated' | 'inactive'
  createdAt: number
  updatedAt: number
}

/**
 * Destination definition - describes a type of destination
 */
export interface DestinationDefinition {
  destinationDefinitionId: string
  name: string
  dockerRepository: string
  dockerImageTag: string
  documentationUrl?: string
  icon?: string
  releaseStage?: 'alpha' | 'beta' | 'generally_available' | 'custom'
  releaseDate?: string
  supportLevel?: 'community' | 'certified' | 'custom'
  supportsDbt?: boolean
  normalizationRepository?: string
  normalizationTag?: string
  normalizationIntegrationType?: string
  supportedDestinationSyncModes?: DestinationSyncMode[]
  resourceRequirements?: ResourceRequirements
  protocolVersion?: string
}

/**
 * Destination creation request
 */
export interface CreateDestinationRequest {
  workspaceId: string
  destinationDefinitionId: string
  name: string
  connectionConfiguration: Record<string, unknown>
}

/**
 * Destination update request
 */
export interface UpdateDestinationRequest {
  destinationId: string
  name?: string
  connectionConfiguration?: Record<string, unknown>
}

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Connection status
 */
export type ConnectionStatus = 'active' | 'inactive' | 'deprecated'

/**
 * Connection schedule type
 */
export type ScheduleType = 'manual' | 'basic' | 'cron'

/**
 * Basic schedule configuration
 */
export interface BasicSchedule {
  units: number
  timeUnit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months'
}

/**
 * Cron schedule configuration
 */
export interface CronSchedule {
  cronExpression: string
  cronTimeZone?: string
}

/**
 * Schedule configuration
 */
export interface ScheduleData {
  scheduleType: ScheduleType
  basicSchedule?: BasicSchedule
  cron?: CronSchedule
}

/**
 * Connection (sync) configuration
 */
export interface Connection {
  connectionId: string
  name: string
  namespaceDefinition?: 'source' | 'destination' | 'customformat'
  namespaceFormat?: string
  prefix?: string
  sourceId: string
  destinationId: string
  operationIds?: string[]
  syncCatalog: AirbyteCatalog
  schedule?: BasicSchedule
  scheduleType?: ScheduleType
  scheduleData?: ScheduleData
  status: ConnectionStatus
  resourceRequirements?: ResourceRequirements
  sourceCatalogId?: string
  geography?: 'auto' | 'us' | 'eu'
  breakingChange?: boolean
  notifySchemaChanges?: boolean
  notifySchemaChangesByEmail?: boolean
  nonBreakingChangesPreference?: 'ignore' | 'disable' | 'propagate_columns' | 'propagate_fully'
  createdAt: number
  updatedAt: number
}

/**
 * Connection creation request
 */
export interface CreateConnectionRequest {
  name?: string
  namespaceDefinition?: 'source' | 'destination' | 'customformat'
  namespaceFormat?: string
  prefix?: string
  sourceId: string
  destinationId: string
  operationIds?: string[]
  syncCatalog?: AirbyteCatalog
  schedule?: BasicSchedule
  scheduleType?: ScheduleType
  scheduleData?: ScheduleData
  status?: ConnectionStatus
  resourceRequirements?: ResourceRequirements
  geography?: 'auto' | 'us' | 'eu'
  nonBreakingChangesPreference?: 'ignore' | 'disable' | 'propagate_columns' | 'propagate_fully'
}

/**
 * Connection update request
 */
export interface UpdateConnectionRequest {
  connectionId: string
  namespaceDefinition?: 'source' | 'destination' | 'customformat'
  namespaceFormat?: string
  prefix?: string
  operationIds?: string[]
  syncCatalog?: AirbyteCatalog
  schedule?: BasicSchedule
  scheduleType?: ScheduleType
  scheduleData?: ScheduleData
  status?: ConnectionStatus
  resourceRequirements?: ResourceRequirements
  sourceCatalogId?: string
  name?: string
  geography?: 'auto' | 'us' | 'eu'
  notifySchemaChanges?: boolean
  notifySchemaChangesByEmail?: boolean
  nonBreakingChangesPreference?: 'ignore' | 'disable' | 'propagate_columns' | 'propagate_fully'
}

// =============================================================================
// Job Types
// =============================================================================

/**
 * Job status
 */
export type JobStatus = 'pending' | 'running' | 'incomplete' | 'failed' | 'succeeded' | 'cancelled'

/**
 * Job type
 */
export type JobConfigType = 'check_connection_source' | 'check_connection_destination' | 'discover_schema' | 'get_spec' | 'sync' | 'reset_connection' | 'connection_updater' | 'replicate'

/**
 * Job configuration
 */
export interface Job {
  id: string
  configType: JobConfigType
  configId: string
  status: JobStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  endedAt?: number
  enabledStreams?: string[]
  resetConfig?: {
    streamsToReset: StreamDescriptor[]
  }
}

/**
 * Stream descriptor
 */
export interface StreamDescriptor {
  name: string
  namespace?: string
}

/**
 * Job with attempts
 */
export interface JobWithAttempts {
  job: Job
  attempts: Attempt[]
}

/**
 * Attempt status
 */
export type AttemptStatus = 'pending' | 'running' | 'failed' | 'succeeded'

/**
 * Attempt details
 */
export interface Attempt {
  id: number
  status: AttemptStatus
  createdAt: number
  updatedAt: number
  endedAt?: number
  bytesSynced?: number
  recordsSynced?: number
  totalStats?: AttemptStats
  streamStats?: StreamAttemptStats[]
  failureSummary?: AttemptFailureSummary
}

/**
 * Attempt statistics
 */
export interface AttemptStats {
  bytesEmitted?: number
  recordsEmitted?: number
  bytesCommitted?: number
  recordsCommitted?: number
  estimatedBytes?: number
  estimatedRecords?: number
}

/**
 * Per-stream attempt statistics
 */
export interface StreamAttemptStats {
  streamName: string
  streamNamespace?: string
  stats: AttemptStats
}

/**
 * Attempt failure summary
 */
export interface AttemptFailureSummary {
  failures: AttemptFailureReason[]
  partialSuccess?: boolean
}

/**
 * Attempt failure reason
 */
export interface AttemptFailureReason {
  failureOrigin: 'source' | 'destination' | 'replication' | 'normalization' | 'dbt' | 'airbyte_platform' | 'unknown'
  failureType: 'config_error' | 'system_error' | 'manual_cancellation' | 'refresh_schema'
  externalMessage?: string
  internalMessage?: string
  stacktrace?: string
  retryable?: boolean
  timestamp?: number
}

// =============================================================================
// Sync Types
// =============================================================================

/**
 * Trigger sync request
 */
export interface TriggerSyncRequest {
  connectionId: string
  jobType?: 'sync' | 'reset'
}

/**
 * Sync result
 */
export interface SyncResult {
  job: Job
}

/**
 * Job list request
 */
export interface ListJobsRequest {
  configTypes?: JobConfigType[]
  configId?: string
  includingJobId?: string
  pagination?: {
    pageSize?: number
    rowOffset?: number
  }
  statuses?: JobStatus[]
  createdAtStart?: string
  createdAtEnd?: string
  updatedAtStart?: string
  updatedAtEnd?: string
  orderByField?: 'createdAt' | 'updatedAt'
  orderByMethod?: 'ASC' | 'DESC'
}

/**
 * Job list response
 */
export interface ListJobsResponse {
  jobs: JobWithAttempts[]
  totalJobCount: number
}

// =============================================================================
// Operation Types (Normalization, DBT)
// =============================================================================

/**
 * Operation type
 */
export type OperatorType = 'normalization' | 'dbt' | 'webhook'

/**
 * Normalization option
 */
export type NormalizationOption = 'basic'

/**
 * Operation configuration
 */
export interface Operation {
  operationId: string
  workspaceId: string
  name: string
  operatorConfiguration: OperatorConfiguration
}

/**
 * Operator configuration
 */
export interface OperatorConfiguration {
  operatorType: OperatorType
  normalization?: {
    option: NormalizationOption
  }
  dbt?: {
    gitRepoUrl: string
    gitRepoBranch?: string
    dockerImage?: string
    dbtArguments?: string
  }
  webhook?: {
    webhookConfigId: string
    webhookType?: 'dbtCloud'
    dbtCloud?: {
      accountId: number
      jobId: number
    }
  }
}

// =============================================================================
// Connector Definitions Registry
// =============================================================================

/**
 * List source definitions request
 */
export interface ListSourceDefinitionsRequest {
  workspaceId?: string
}

/**
 * List destination definitions request
 */
export interface ListDestinationDefinitionsRequest {
  workspaceId?: string
}

/**
 * Spec connection response
 */
export interface SpecConnectionResponse {
  jobInfo: {
    id: string
    configType: 'get_spec'
    configId: string
    createdAt: number
    endedAt: number
    succeeded: boolean
  }
  spec: ConnectorSpecification
}

/**
 * Connector specification
 */
export interface ConnectorSpecification {
  documentationUrl?: string
  connectionSpecification: Record<string, unknown>
  supportsIncremental?: boolean
  supportedDestinationSyncModes?: DestinationSyncMode[]
  supportsNormalization?: boolean
  supportsDBT?: boolean
  supported_destination_sync_modes?: DestinationSyncMode[]
  authSpecification?: AuthSpecification
  advancedAuth?: AdvancedAuth
}

/**
 * Auth specification
 */
export interface AuthSpecification {
  auth_type: 'oauth2.0'
  oauth2Specification?: OAuth2Specification
}

/**
 * OAuth2 specification
 */
export interface OAuth2Specification {
  rootObject?: string[]
  oauthFlowInitParameters?: string[][]
  oauthFlowOutputParameters?: string[][]
}

/**
 * Advanced auth configuration
 */
export interface AdvancedAuth {
  authFlowType?: 'oauth2.0' | 'oauth1.0'
  predicateKey?: string[]
  predicateValue?: string
  oauthConfigSpecification?: OAuthConfigSpecification
}

/**
 * OAuth config specification
 */
export interface OAuthConfigSpecification {
  oauthUserInputFromConnectorConfigSpecification?: Record<string, unknown>
  completeOAuthOutputSpecification?: Record<string, unknown>
  completeOAuthServerInputSpecification?: Record<string, unknown>
  completeOAuthServerOutputSpecification?: Record<string, unknown>
}

// =============================================================================
// API Client Interface
// =============================================================================

/**
 * Airbyte API client interface
 */
export interface AirbyteClient {
  // Workspace APIs
  workspaces: {
    list: () => Promise<Workspace[]>
    get: (workspaceId: string) => Promise<Workspace>
    create: (request: CreateWorkspaceRequest) => Promise<Workspace>
    update: (request: UpdateWorkspaceRequest) => Promise<Workspace>
    delete: (workspaceId: string) => Promise<void>
  }

  // Source APIs
  sources: {
    list: (workspaceId: string) => Promise<Source[]>
    get: (sourceId: string) => Promise<Source>
    create: (request: CreateSourceRequest) => Promise<Source>
    update: (request: UpdateSourceRequest) => Promise<Source>
    delete: (sourceId: string) => Promise<void>
    checkConnection: (sourceId: string) => Promise<CheckConnectionResult>
    discoverSchema: (request: DiscoverSchemaRequest) => Promise<AirbyteCatalog>
  }

  // Source Definition APIs
  sourceDefinitions: {
    list: (request?: ListSourceDefinitionsRequest) => Promise<SourceDefinition[]>
    get: (sourceDefinitionId: string) => Promise<SourceDefinition>
    getSpec: (sourceDefinitionId: string) => Promise<ConnectorSpecification>
  }

  // Destination APIs
  destinations: {
    list: (workspaceId: string) => Promise<Destination[]>
    get: (destinationId: string) => Promise<Destination>
    create: (request: CreateDestinationRequest) => Promise<Destination>
    update: (request: UpdateDestinationRequest) => Promise<Destination>
    delete: (destinationId: string) => Promise<void>
    checkConnection: (destinationId: string) => Promise<CheckConnectionResult>
  }

  // Destination Definition APIs
  destinationDefinitions: {
    list: (request?: ListDestinationDefinitionsRequest) => Promise<DestinationDefinition[]>
    get: (destinationDefinitionId: string) => Promise<DestinationDefinition>
    getSpec: (destinationDefinitionId: string) => Promise<ConnectorSpecification>
  }

  // Connection APIs
  connections: {
    list: (workspaceId: string) => Promise<Connection[]>
    get: (connectionId: string) => Promise<Connection>
    create: (request: CreateConnectionRequest) => Promise<Connection>
    update: (request: UpdateConnectionRequest) => Promise<Connection>
    delete: (connectionId: string) => Promise<void>
  }

  // Job APIs
  jobs: {
    list: (request: ListJobsRequest) => Promise<ListJobsResponse>
    get: (jobId: string) => Promise<JobWithAttempts>
    cancel: (jobId: string) => Promise<Job>
  }

  // Sync APIs
  sync: {
    trigger: (request: TriggerSyncRequest) => Promise<SyncResult>
    getStatus: (connectionId: string) => Promise<Job | null>
  }
}
