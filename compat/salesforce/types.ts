/**
 * @dotdo/salesforce - Salesforce API Type Definitions
 *
 * Type definitions for Salesforce API compatibility layer.
 * Based on jsforce API and Salesforce REST API v59.0
 *
 * @module @dotdo/salesforce/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Salesforce record attributes
 */
export interface SObjectAttributes {
  type: string
  url: string
}

/**
 * Base SObject record type
 */
export interface SObject {
  Id?: string
  attributes?: SObjectAttributes
  [key: string]: unknown
}

/**
 * Save result from create/update operations
 */
export interface SaveResult {
  id: string
  success: boolean
  errors: SaveError[]
}

/**
 * Upsert result with created flag
 */
export interface UpsertResult extends SaveResult {
  created: boolean
}

/**
 * Save error details
 */
export interface SaveError {
  errorCode: string
  message: string
  fields?: string[]
  statusCode?: string
}

/**
 * Query result wrapper
 */
export interface QueryResult<T = SObject> {
  totalSize: number
  done: boolean
  nextRecordsUrl?: string
  records: T[]
}

/**
 * User info returned from login
 */
export interface UserInfo {
  id: string
  organizationId: string
  url: string
}

/**
 * Identity response
 */
export interface Identity {
  id: string
  user_id: string
  organization_id: string
  username: string
  display_name: string
  email: string
  first_name?: string
  last_name?: string
  timezone?: string
  locale?: string
  language?: string
  photos?: {
    picture?: string
    thumbnail?: string
  }
  urls?: Record<string, string>
}

// =============================================================================
// Connection Types
// =============================================================================

/**
 * OAuth2 configuration
 */
export interface OAuth2Config {
  clientId: string
  clientSecret?: string
  redirectUri?: string
  loginUrl?: string
}

/**
 * Connection configuration options
 */
export interface ConnectionConfig {
  /** Login URL (production: https://login.salesforce.com, sandbox: https://test.salesforce.com) */
  loginUrl?: string
  /** Instance URL for authenticated connections */
  instanceUrl?: string
  /** Access token for authenticated connections */
  accessToken?: string
  /** Refresh token for token refresh */
  refreshToken?: string
  /** API version (default: 59.0) */
  version?: string
  /** OAuth2 configuration */
  oauth2?: OAuth2Config
  /** Maximum number of network retries */
  maxNetworkRetries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Log level */
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'
}

/**
 * Authorization parameters
 */
export interface AuthorizeParams {
  grant_type?: string
  code?: string
  assertion?: string
  username?: string
  password?: string
  refresh_token?: string
}

/**
 * OAuth token response
 */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  instance_url: string
  id: string
  token_type: string
  issued_at?: string
  signature?: string
  scope?: string
}

/**
 * Authorization URL options
 */
export interface AuthUrlOptions {
  scope?: string
  state?: string
  prompt?: 'login' | 'consent' | 'select_account'
  display?: 'page' | 'popup' | 'touch' | 'mobile'
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'S256' | 'plain'
}

// =============================================================================
// Describe Types
// =============================================================================

/**
 * Global describe result
 */
export interface DescribeGlobalResult {
  encoding: string
  maxBatchSize: number
  sobjects: DescribeGlobalSObject[]
}

/**
 * Global describe SObject summary
 */
export interface DescribeGlobalSObject {
  name: string
  label: string
  labelPlural?: string
  keyPrefix?: string
  queryable: boolean
  createable: boolean
  updateable?: boolean
  deletable?: boolean
  custom?: boolean
  customSetting?: boolean
  layoutable?: boolean
  mergeable?: boolean
  searchable?: boolean
  triggerable?: boolean
  undeletable?: boolean
  urls?: Record<string, string>
}

/**
 * Full SObject describe result
 */
export interface DescribeSObjectResult {
  name: string
  label: string
  labelPlural: string
  keyPrefix?: string
  queryable: boolean
  createable: boolean
  updateable: boolean
  deletable: boolean
  custom: boolean
  fields: DescribeField[]
  recordTypeInfos: RecordTypeInfo[]
  childRelationships: ChildRelationship[]
  urls?: Record<string, string>
  searchLayoutable?: boolean
  listviewable?: boolean
  lookupLayoutable?: boolean
  triggerable?: boolean
}

/**
 * Field describe information
 */
export interface DescribeField {
  name: string
  type: FieldType
  label: string
  length?: number
  byteLength?: number
  digits?: number
  precision?: number
  scale?: number
  unique?: boolean
  nillable?: boolean
  createable?: boolean
  updateable?: boolean
  defaultValue?: unknown
  defaultValueFormula?: string
  calculated?: boolean
  calculatedFormula?: string
  autoNumber?: boolean
  externalId?: boolean
  idLookup?: boolean
  nameField?: boolean
  namePointing?: boolean
  custom?: boolean
  htmlFormatted?: boolean
  dependentPicklist?: boolean
  restrictedPicklist?: boolean
  filterable?: boolean
  sortable?: boolean
  groupable?: boolean
  permissionable?: boolean
  cascadeDelete?: boolean
  restrictedDelete?: boolean
  writeRequiresMasterRead?: boolean
  encrypted?: boolean
  mask?: string
  maskType?: string
  referenceTo?: string[]
  relationshipName?: string
  relationshipOrder?: number
  picklistValues?: PicklistValue[]
  compoundFieldName?: string
  inlineHelpText?: string
  soapType?: string
  displayLocationInDecimal?: boolean
  extraTypeInfo?: string
  highScaleNumber?: boolean
  polymorphicForeignKey?: boolean
  aggregatable?: boolean
  aiPredictionField?: boolean
  queryByDistance?: boolean
  searchPrefilterable?: boolean
}

/**
 * Salesforce field types
 */
export type FieldType =
  | 'id'
  | 'string'
  | 'textarea'
  | 'boolean'
  | 'int'
  | 'double'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'time'
  | 'phone'
  | 'email'
  | 'url'
  | 'picklist'
  | 'multipicklist'
  | 'combobox'
  | 'reference'
  | 'base64'
  | 'address'
  | 'location'
  | 'encryptedstring'
  | 'anyType'
  | 'complexvalue'

/**
 * Picklist value
 */
export interface PicklistValue {
  value: string
  label: string
  active: boolean
  defaultValue: boolean
  validFor?: string
}

/**
 * Record type information
 */
export interface RecordTypeInfo {
  recordTypeId: string
  name: string
  developerName: string
  available: boolean
  defaultRecordTypeMapping: boolean
  master: boolean
  active?: boolean
}

/**
 * Child relationship information
 */
export interface ChildRelationship {
  childSObject: string
  field: string
  relationshipName?: string
  cascadeDelete?: boolean
  restrictedDelete?: boolean
  deprecatedAndHidden?: boolean
  junctionIdListNames?: string[]
  junctionReferenceTo?: string[]
}

/**
 * Describe options
 */
export interface DescribeOptions {
  refresh?: boolean
}

// =============================================================================
// Bulk API Types
// =============================================================================

/**
 * Bulk job operation type
 */
export type BulkOperation = 'insert' | 'update' | 'upsert' | 'delete' | 'hardDelete' | 'query' | 'queryAll'

/**
 * Bulk job state
 */
export type BulkJobState = 'Open' | 'UploadComplete' | 'InProgress' | 'JobComplete' | 'Failed' | 'Aborted'

/**
 * Bulk job options
 */
export interface BulkJobOptions {
  externalIdFieldName?: string
  concurrencyMode?: 'Parallel' | 'Serial'
  lineEnding?: 'LF' | 'CRLF'
  columnDelimiter?: 'BACKQUOTE' | 'CARET' | 'COMMA' | 'PIPE' | 'SEMICOLON' | 'TAB'
}

/**
 * Bulk job information
 */
export interface BulkJobInfo {
  id: string
  operation: BulkOperation
  object: string
  state: BulkJobState
  createdDate?: string
  systemModstamp?: string
  createdById?: string
  concurrencyMode?: string
  contentType?: string
  apiVersion?: string
  lineEnding?: string
  columnDelimiter?: string
  externalIdFieldName?: string
  numberRecordsProcessed?: number
  numberRecordsFailed?: number
  retries?: number
  totalProcessingTime?: number
  errorMessage?: string
}

/**
 * Bulk job interface
 */
export interface BulkJob {
  id?: string
  object: string
  operation: BulkOperation
  options?: BulkJobOptions
  createBatch(): BulkBatch
  close(): Promise<BulkJobInfo>
  abort(): Promise<BulkJobInfo>
  check(): Promise<BulkJobInfo>
}

/**
 * Bulk batch interface
 */
export interface BulkBatch {
  execute(records: SObject[] | string): void
  poll(): Promise<BulkResult[]>
  on(event: 'queue', callback: () => void): void
  on(event: 'response', callback: (results: BulkResult[]) => void): void
  on(event: 'error', callback: (error: Error) => void): void
}

/**
 * Bulk query job interface
 */
export interface BulkQueryJob {
  id: string
  operation: 'query' | 'queryAll'
  state: BulkJobState
  poll(): Promise<SObject[]>
  result(): Promise<SObject[]>
}

/**
 * Bulk result for each record
 */
export interface BulkResult {
  id?: string
  success: boolean
  created?: boolean
  errors: SaveError[]
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Report reference
 */
export interface Report {
  id: string
  name?: string
  execute(options?: ReportExecuteOptions): Promise<ReportResult>
  executeAsync(): Promise<ReportInstance>
  describe(): Promise<ReportMetadata>
}

/**
 * Report execute options
 */
export interface ReportExecuteOptions {
  details?: boolean
  includeDetails?: boolean
  reportFilters?: ReportFilter[]
  reportBooleanFilter?: string
}

/**
 * Report filter
 */
export interface ReportFilter {
  column: string
  operator: string
  value: string | string[]
}

/**
 * Report metadata
 */
export interface ReportMetadata {
  name: string
  id: string
  developerName?: string
  reportFormat: 'TABULAR' | 'SUMMARY' | 'MATRIX' | 'MULTI_BLOCK'
  reportType: ReportType
  reportFilters?: ReportFilter[]
  detailColumns?: string[]
  sortBy?: SortColumn[]
  groupingsDown?: GroupingInfo[]
  groupingsAcross?: GroupingInfo[]
  aggregates?: AggregateInfo[]
  hasDetailRows?: boolean
  hasRecordCount?: boolean
  standardFilters?: StandardFilter[]
}

/**
 * Report type
 */
export interface ReportType {
  type: string
  label: string
}

/**
 * Sort column
 */
export interface SortColumn {
  sortColumn: string
  sortOrder: 'Asc' | 'Desc'
}

/**
 * Grouping information
 */
export interface GroupingInfo {
  name: string
  sortOrder: 'Asc' | 'Desc'
  dateGranularity?: string
}

/**
 * Aggregate information
 */
export interface AggregateInfo {
  name: string
  label: string
  type: string
  downGroupingContext?: string
  acrossGroupingContext?: string
}

/**
 * Standard filter
 */
export interface StandardFilter {
  name: string
  value: string
}

/**
 * Report result
 */
export interface ReportResult {
  factMap: FactMap
  groupingsDown?: GroupingValue
  groupingsAcross?: GroupingValue
  hasDetailRows: boolean
  reportMetadata: ReportMetadata
  reportExtendedMetadata?: ReportExtendedMetadata
  allData?: boolean
}

/**
 * Fact map with grouped data
 */
export interface FactMap {
  [key: string]: {
    aggregates: AggregateValue[]
    rows?: DataRow[]
  }
}

/**
 * Aggregate value
 */
export interface AggregateValue {
  label: string
  value: number | string | null
}

/**
 * Data row
 */
export interface DataRow {
  dataCells: DataCell[]
}

/**
 * Data cell
 */
export interface DataCell {
  label: string
  value: unknown
}

/**
 * Grouping value
 */
export interface GroupingValue {
  groupings: GroupingData[]
}

/**
 * Grouping data
 */
export interface GroupingData {
  key: string
  label: string
  value: unknown
  groupings?: GroupingData[]
}

/**
 * Report extended metadata
 */
export interface ReportExtendedMetadata {
  detailColumnInfo?: Record<string, ColumnInfo>
  aggregateColumnInfo?: Record<string, ColumnInfo>
  groupingColumnInfo?: Record<string, ColumnInfo>
}

/**
 * Column info
 */
export interface ColumnInfo {
  label: string
  dataType: string
  entityColumnName?: string
}

/**
 * Report instance (async execution)
 */
export interface ReportInstance {
  id: string
  status: 'New' | 'Running' | 'Success' | 'Error'
  requestDate?: string
  completionDate?: string
  ownerId?: string
  url?: string
  hasDetailRows?: boolean
  queryable?: boolean
  factMap?: FactMap
}

/**
 * Dashboard list result
 */
export interface DashboardListResult {
  dashboards: DashboardInfo[]
}

/**
 * Dashboard info
 */
export interface DashboardInfo {
  id: string
  name: string
  statusUrl?: string
  folderId?: string
  folderName?: string
  url?: string
}

// =============================================================================
// Metadata API Types
// =============================================================================

/**
 * Metadata component type
 */
export type MetadataType =
  | 'ApexClass'
  | 'ApexComponent'
  | 'ApexPage'
  | 'ApexTrigger'
  | 'CustomApplication'
  | 'CustomField'
  | 'CustomLabel'
  | 'CustomMetadata'
  | 'CustomObject'
  | 'CustomTab'
  | 'EmailTemplate'
  | 'Flow'
  | 'Layout'
  | 'PermissionSet'
  | 'Profile'
  | 'Queue'
  | 'RecordType'
  | 'Report'
  | 'Role'
  | 'Workflow'
  | string

/**
 * Metadata component
 */
export interface MetadataComponent {
  fullName: string
  type?: MetadataType
  createdById?: string
  createdByName?: string
  createdDate?: string
  fileName?: string
  id?: string
  lastModifiedById?: string
  lastModifiedByName?: string
  lastModifiedDate?: string
  manageableState?: 'beta' | 'deleted' | 'deprecated' | 'deprecatedEditable' | 'installed' | 'installedEditable' | 'released' | 'unmanaged'
  namespacePrefix?: string
  [key: string]: unknown
}

/**
 * Metadata list query
 */
export interface MetadataListQuery {
  type: MetadataType
  folder?: string
}

/**
 * Metadata read result
 */
export interface MetadataReadResult {
  fullName: string
  [key: string]: unknown
}

/**
 * Metadata deploy result
 */
export interface MetadataDeployResult {
  id: string
  done: boolean
  success?: boolean
  status: 'Pending' | 'InProgress' | 'Succeeded' | 'SucceededPartial' | 'Failed' | 'Canceling' | 'Canceled'
  numberComponentsDeployed?: number
  numberComponentsTotal?: number
  numberComponentErrors?: number
  numberTestsCompleted?: number
  numberTestsTotal?: number
  numberTestErrors?: number
  details?: MetadataDeployDetails
}

/**
 * Metadata deploy details
 */
export interface MetadataDeployDetails {
  componentSuccesses?: MetadataComponentResult[]
  componentFailures?: MetadataComponentResult[]
  runTestResult?: RunTestResult
}

/**
 * Metadata component result
 */
export interface MetadataComponentResult {
  fullName: string
  componentType: string
  success: boolean
  changed: boolean
  created: boolean
  deleted: boolean
  problem?: string
  problemType?: 'Warning' | 'Error'
  lineNumber?: number
  columnNumber?: number
}

/**
 * Run test result
 */
export interface RunTestResult {
  numTestsRun: number
  numFailures: number
  totalTime: number
  successes?: TestSuccess[]
  failures?: TestFailure[]
  codeCoverage?: CodeCoverageResult[]
  codeCoverageWarnings?: CodeCoverageWarning[]
}

/**
 * Test success
 */
export interface TestSuccess {
  name: string
  methodName: string
  time: number
}

/**
 * Test failure
 */
export interface TestFailure {
  name: string
  methodName: string
  message: string
  stackTrace?: string
  time: number
  type?: string
}

/**
 * Code coverage result
 */
export interface CodeCoverageResult {
  name: string
  type: string
  numLocations: number
  numLocationsNotCovered: number
  locationsNotCovered?: { line: number; column: number }[]
}

/**
 * Code coverage warning
 */
export interface CodeCoverageWarning {
  name?: string
  message: string
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Salesforce API error
 */
export interface SalesforceErrorData {
  errorCode: string
  message: string
  fields?: string[]
}

/**
 * OAuth error response
 */
export interface OAuthError {
  error: string
  error_description: string
}

// =============================================================================
// Query Builder Types
// =============================================================================

/**
 * Order direction
 */
export type OrderDirection = 'ASC' | 'DESC' | 'asc' | 'desc'

/**
 * Condition value
 */
export type ConditionValue = string | number | boolean | Date | null | string[] | number[]

/**
 * Where conditions
 */
export interface WhereConditions {
  [field: string]: ConditionValue | { $eq?: ConditionValue; $ne?: ConditionValue; $lt?: ConditionValue; $lte?: ConditionValue; $gt?: ConditionValue; $gte?: ConditionValue; $like?: string; $in?: (string | number)[]; $nin?: (string | number)[]; $includes?: string[]; $excludes?: string[] }
}

/**
 * Query options
 */
export interface QueryOptions {
  fields?: string[]
  conditions?: WhereConditions
  orderBy?: string | { field: string; direction?: OrderDirection }[]
  limit?: number
  offset?: number
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Streaming channel types
 */
export type StreamingChannelType = 'PushTopic' | 'GenericEvent' | 'PlatformEvent' | 'ChangeDataCapture'

/**
 * Streaming subscription
 */
export interface StreamingSubscription {
  topic: string
  type: StreamingChannelType
  unsubscribe(): void
}

/**
 * Streaming message
 */
export interface StreamingMessage {
  channel: string
  data: {
    event: {
      createdDate: string
      replayId: number
      type: 'created' | 'updated' | 'deleted' | 'undeleted' | 'gap_create' | 'gap_update' | 'gap_delete' | 'gap_undelete' | 'gap_overflow'
    }
    sobject: SObject
  }
}

// =============================================================================
// Limits Types
// =============================================================================

/**
 * Organization limits
 */
export interface Limits {
  DailyApiRequests: LimitInfo
  DailyAsyncApexExecutions: LimitInfo
  DailyBulkApiRequests: LimitInfo
  DailyBulkV2QueryJobs: LimitInfo
  DailyBulkV2QueryFileStorageMB: LimitInfo
  DailyDurableGenericStreamingApiEvents: LimitInfo
  DailyDurableStreamingApiEvents: LimitInfo
  DailyGenericStreamingApiEvents: LimitInfo
  DailyStandardVolumePlatformEvents: LimitInfo
  DailyStreamingApiEvents: LimitInfo
  DailyWorkflowEmails: LimitInfo
  DataStorageMB: LimitInfo
  FileStorageMB: LimitInfo
  HourlyAsyncReportRuns: LimitInfo
  HourlyDashboardRefreshes: LimitInfo
  HourlyDashboardResults: LimitInfo
  HourlyDashboardStatuses: LimitInfo
  HourlyLongTermIdMapping: LimitInfo
  HourlyManagedContentPublicRequests: LimitInfo
  HourlyODataCallout: LimitInfo
  HourlyPublishedPlatformEvents: LimitInfo
  HourlyPublishedStandardVolumePlatformEvents: LimitInfo
  HourlyShortTermIdMapping: LimitInfo
  HourlySyncReportRuns: LimitInfo
  HourlyTimeBasedWorkflow: LimitInfo
  MassEmail: LimitInfo
  MonthlyPlatformEvents: LimitInfo
  MonthlyPlatformEventsUsageEntitlement: LimitInfo
  Package2VersionCreates: LimitInfo
  Package2VersionCreatesWithoutValidation: LimitInfo
  PermissionSets: LimitInfo
  PrivateConnectOutboundCalloutHourlyLimitMB: LimitInfo
  SingleEmail: LimitInfo
  StreamingApiConcurrentClients: LimitInfo
  [key: string]: LimitInfo
}

/**
 * Limit info
 */
export interface LimitInfo {
  Max: number
  Remaining: number
}

// =============================================================================
// Lead Conversion Types
// =============================================================================

/**
 * Options for converting a Lead
 */
export interface ConvertLeadOptions {
  /** The ID of the Lead to convert */
  leadId: string
  /** The converted status to assign to the Lead */
  convertedStatus: string
  /** Optional: ID of an existing Account to merge into */
  accountId?: string
  /** Optional: ID of an existing Contact to merge into */
  contactId?: string
  /** Optional: Name for the Opportunity to create */
  opportunityName?: string
  /** Optional: If true, don't create an Opportunity */
  doNotCreateOpportunity?: boolean
  /** Optional: If true, overwrite the lead source on the new records */
  overwriteLeadSource?: boolean
  /** Optional: If true, send notification emails */
  sendNotificationEmail?: boolean
  /** Optional: ID of the owner for the new records */
  ownerId?: string
}

/**
 * Result of converting a single Lead
 */
export interface ConvertLeadResult {
  /** ID of the Account created or merged into */
  accountId: string | null
  /** ID of the Contact created or merged into */
  contactId: string | null
  /** ID of the Opportunity created (if any) */
  opportunityId: string | null
  /** Whether the conversion was successful */
  success: boolean
  /** Any errors that occurred */
  errors: SaveError[]
}

/**
 * Result of converting a Lead in a batch operation
 */
export interface ConvertLeadBatchResult {
  /** Name of the action */
  actionName: string
  /** Output values from the conversion */
  outputValues: {
    accountId: string | null
    contactId: string | null
    opportunityId: string | null
  }
  /** Whether the conversion was successful */
  isSuccess: boolean
  /** Any errors that occurred */
  errors: SaveError[]
}
