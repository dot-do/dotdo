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
 * await conn.login('user@example.com', 'password+securitytoken')
 *
 * // Query records with SOQL
 * const result = await conn.query("SELECT Id, Name FROM Account WHERE Industry = 'Technology'")
 *
 * // Create a record
 * const account = await conn.sobject('Account').create({
 *   Name: 'Acme Inc',
 *   Industry: 'Technology',
 * })
 *
 * // Bulk operations
 * const job = conn.bulk.createJob('Account', 'insert')
 * const batch = job.createBatch()
 * batch.execute([{ Name: 'Account 1' }, { Name: 'Account 2' }])
 * await new Promise(r => batch.on('queue', r))
 *
 * // Run a report
 * const report = await conn.analytics.report('00Oxx...')
 * const results = await report.execute({ details: true })
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
  AuthorizeParams,
  TokenResponse,
  AuthUrlOptions,
  OAuth2Config,

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
  ReportResult,
  ReportExecuteOptions,
  ReportFilter,
  ReportMetadata,
  ReportType,
  SortColumn,
  GroupingInfo,
  AggregateInfo,
  StandardFilter,
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

  // Query builder types
  WhereConditions,
  ConditionValue,
  OrderDirection,
  QueryOptions,

  // Streaming types
  StreamingChannelType,
  StreamingSubscription,
  StreamingMessage,

  // Limits types
  Limits,
  LimitInfo,

  // Error types
  SalesforceErrorData,
  OAuthError,
} from './types'

// =============================================================================
// Default Export (jsforce compatibility)
// =============================================================================

import { Connection } from './salesforce'

/**
 * Default export matching jsforce interface
 */
const jsforce = {
  Connection,
}

export default jsforce
