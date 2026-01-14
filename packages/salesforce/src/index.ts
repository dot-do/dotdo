/**
 * @dotdo/salesforce - Salesforce API Compatibility Layer for Cloudflare Workers
 *
 * Drop-in replacement for jsforce SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import jsforce from '@dotdo/salesforce'
 *
 * const conn = new jsforce.Connection({
 *   loginUrl: 'https://login.salesforce.com',
 * })
 *
 * await conn.login('user@example.com', 'password+token')
 *
 * // Query records
 * const result = await conn.query("SELECT Id, Name FROM Account")
 *
 * // Create records
 * const account = await conn.sobject('Account').create({
 *   Name: 'Acme Inc',
 *   Industry: 'Technology',
 * })
 *
 * // Bulk operations
 * const job = conn.bulk.createJob('Account', 'insert')
 * const batch = job.createBatch()
 * batch.execute([{ Name: 'Account 1' }, { Name: 'Account 2' }])
 * ```
 *
 * @module @dotdo/salesforce
 */

// =============================================================================
// Main Client
// =============================================================================

export {
  Connection,
  SalesforceError,
  OAuth2,
  SObjectResource,
  QueryBuilder,
  Bulk,
  Analytics,
  Metadata,
} from './salesforce'

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  SObject,
  SObjectAttributes,
  SaveResult,
  UpsertResult,
  SaveError,
  QueryResult,
  UserInfo,
  Identity,

  // Connection types
  ConnectionConfig,
  OAuth2Config,
  AuthorizeParams,
  TokenResponse,
  AuthUrlOptions,

  // Describe types
  DescribeGlobalResult,
  DescribeGlobalSObject,
  DescribeSObjectResult,
  DescribeField,
  FieldType,
  PicklistValue,
  RecordTypeInfo,
  ChildRelationship,
  DescribeOptions,

  // Bulk API types
  BulkOperation,
  BulkJobState,
  BulkJobOptions,
  BulkJobInfo,
  BulkJob,
  BulkBatch,
  BulkQueryJob,
  BulkResult,

  // Analytics types
  Report,
  ReportExecuteOptions,
  ReportFilter,
  ReportMetadata,
  ReportType,
  SortColumn,
  GroupingInfo,
  AggregateInfo,
  StandardFilter,
  ReportResult,
  FactMap,
  AggregateValue,
  DataRow,
  DataCell,
  GroupingValue,
  GroupingData,
  ReportExtendedMetadata,
  ColumnInfo,
  ReportInstance,
  DashboardListResult,
  DashboardInfo,

  // Metadata types
  MetadataType,
  MetadataComponent,
  MetadataListQuery,
  MetadataReadResult,
  MetadataDeployResult,
  MetadataDeployDetails,
  MetadataComponentResult,
  RunTestResult,
  TestSuccess,
  TestFailure,
  CodeCoverageResult,
  CodeCoverageWarning,

  // Error types
  SalesforceErrorData,
  OAuthError,

  // Query builder types
  OrderDirection,
  ConditionValue,
  WhereConditions,
  QueryOptions,

  // Streaming types
  StreamingChannelType,
  StreamingSubscription,
  StreamingMessage,

  // Limits types
  Limits,
  LimitInfo,
} from './types'

// =============================================================================
// Local Implementation (for testing and edge deployment)
// =============================================================================

export {
  SalesforceLocal,
  LocalSObjectResource,
  LocalQueryBuilder,
  type SalesforceLocalConfig,
  type SalesforceLocalStorage,
} from './local'

// =============================================================================
// Default Export
// =============================================================================

export { default } from './salesforce'
