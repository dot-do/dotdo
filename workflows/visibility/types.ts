/**
 * Workflow Visibility Types
 *
 * Type definitions for Temporal-like workflow visibility API.
 * Enables listing and querying running workflows.
 *
 * ## Overview
 *
 * The workflow visibility system provides a queryable interface for discovering
 * and monitoring workflow executions. This is essential for:
 *
 * - **Debugging**: Finding workflows by type, status, or custom attributes
 * - **Monitoring**: Tracking workflow health and identifying failures
 * - **Operations**: Managing workflow lifecycle (cancel, terminate, etc.)
 *
 * ## Key Concepts
 *
 * ### Workflow Metadata
 * Each workflow execution stores metadata that can be queried:
 * - `workflowId` / `runId`: Unique identifiers
 * - `workflowType`: The workflow function name
 * - `status`: Current execution state (RUNNING, COMPLETED, FAILED, etc.)
 * - `startTime` / `closeTime`: Execution timestamps
 * - `searchAttributes`: Custom indexed key-value pairs for filtering
 *
 * ### Search Attributes
 * Custom attributes that you define on workflows for advanced filtering:
 * ```typescript
 * // Set when starting workflow
 * await client.start(orderWorkflow, {
 *   workflowId: 'order-123',
 *   searchAttributes: {
 *     customerId: 'cust-456',
 *     orderValue: 150.00,
 *     region: 'us-west',
 *   }
 * })
 *
 * // Query by custom attribute
 * const results = await store.list({
 *   query: 'customerId = "cust-456" AND orderValue > 100'
 * })
 * ```
 *
 * ### Query Syntax
 * SQL-like syntax for filtering workflows:
 * - Equality: `WorkflowType = "orderWorkflow"`
 * - Comparison: `orderValue > 100`
 * - Multiple conditions: `Status = "RUNNING" AND customerId = "cust-456"`
 * - IN operator: `Status IN ("RUNNING", "FAILED")`
 *
 * @module workflows/visibility/types
 */

// ============================================================================
// WORKFLOW STATUS
// ============================================================================

/**
 * Workflow execution status.
 *
 * Represents the lifecycle state of a workflow execution.
 * Use these values when querying workflows by status.
 *
 * @example
 * ```typescript
 * // Find all running workflows
 * const running = await store.list({
 *   query: 'Status = "RUNNING"'
 * })
 *
 * // Find failed workflows for debugging
 * const failed = await store.list({
 *   query: 'Status = "FAILED"'
 * })
 * ```
 */
export enum WorkflowStatus {
  /** Workflow is currently running */
  RUNNING = 'RUNNING',
  /** Workflow completed successfully */
  COMPLETED = 'COMPLETED',
  /** Workflow failed with an error */
  FAILED = 'FAILED',
  /** Workflow was cancelled */
  CANCELLED = 'CANCELLED',
  /** Workflow was terminated */
  TERMINATED = 'TERMINATED',
  /** Workflow timed out */
  TIMED_OUT = 'TIMED_OUT',
  /** Workflow continued as new */
  CONTINUED_AS_NEW = 'CONTINUED_AS_NEW',
}

// ============================================================================
// SEARCH ATTRIBUTES
// ============================================================================

/**
 * Search attribute value types.
 *
 * Search attributes support various primitive types for flexible querying:
 * - `string`: Text values (e.g., customerId, region)
 * - `number`: Numeric values for range queries (e.g., orderValue > 100)
 * - `boolean`: Boolean flags (e.g., isPriority = true)
 * - `Date`: Timestamps for time-based queries
 * - `string[]` / `number[]`: Arrays for IN queries
 */
export type SearchAttributeValue = string | number | boolean | Date | string[] | number[]

/**
 * Search attributes for workflow queries.
 *
 * Custom key-value pairs attached to workflows for advanced filtering.
 * Define search attributes based on your domain to enable powerful queries.
 *
 * @example
 * ```typescript
 * // E-commerce order workflow attributes
 * const searchAttributes: SearchAttributes = {
 *   customerId: 'cust-456',
 *   orderValue: 150.00,
 *   region: 'us-west',
 *   isPriority: true,
 *   createdAt: new Date(),
 * }
 *
 * // Later query by any combination
 * 'customerId = "cust-456" AND orderValue > 100 AND isPriority = true'
 * ```
 */
export interface SearchAttributes {
  [key: string]: SearchAttributeValue
}

// ============================================================================
// WORKFLOW METADATA
// ============================================================================

/**
 * Metadata stored for each workflow execution.
 * Used for visibility queries.
 */
export interface WorkflowMetadata {
  /** Unique workflow identifier */
  workflowId: string
  /** Run identifier for this execution */
  runId: string
  /** Workflow type name */
  workflowType: string
  /** Current workflow status */
  status: WorkflowStatus
  /** When the workflow started */
  startTime: Date
  /** When the workflow closed (completed, failed, cancelled, etc.) */
  closeTime?: Date
  /** Task queue the workflow runs on */
  taskQueue: string
  /** Namespace (optional) */
  namespace?: string
  /** Custom search attributes */
  searchAttributes?: SearchAttributes
  /** Memo (arbitrary key-value data) */
  memo?: Record<string, unknown>
  /** Parent workflow info (for child workflows) */
  parentWorkflowId?: string
  /** Parent run ID */
  parentRunId?: string
  /** Execution timeout in ms */
  executionTimeout?: number
  /** History length (number of events) */
  historyLength?: number
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query filter operator
 */
export type QueryOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN'

/**
 * Single query filter condition
 */
export interface QueryFilter {
  /** Field to filter on */
  field: string
  /** Comparison operator */
  operator: QueryOperator
  /** Value to compare against */
  value: SearchAttributeValue | SearchAttributeValue[]
}

/**
 * Structured workflow query with filters
 */
export interface WorkflowQuery {
  /** Filter conditions (ANDed together) */
  filters: QueryFilter[]
}

// ============================================================================
// LIST OPTIONS AND RESULT
// ============================================================================

/**
 * Options for listing workflows
 */
export interface ListWorkflowsOptions {
  /** SQL-like query string (e.g., 'WorkflowType = "orderWorkflow" AND Status = "RUNNING"') */
  query?: string
  /** Maximum number of results per page */
  pageSize?: number
  /** Cursor for pagination */
  nextPageToken?: string
}

/**
 * Result of listing workflows
 */
export interface ListWorkflowsResult {
  /** Matching workflow metadata */
  workflows: WorkflowMetadata[]
  /** Token for fetching next page (undefined if no more results) */
  nextPageToken?: string
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

/**
 * Interface for workflow visibility storage.
 * Can be implemented with D1, KV, or in-memory for testing.
 */
export interface WorkflowVisibilityStore {
  /**
   * Store or update workflow metadata
   */
  upsert(metadata: WorkflowMetadata): Promise<void>

  /**
   * Get workflow metadata by ID
   */
  get(workflowId: string): Promise<WorkflowMetadata | null>

  /**
   * Delete workflow metadata
   */
  delete(workflowId: string): Promise<void>

  /**
   * List workflows matching a query
   */
  list(options: ListWorkflowsOptions): Promise<ListWorkflowsResult>

  /**
   * Query workflows with structured filters
   */
  query(query: WorkflowQuery, options?: { pageSize?: number; nextPageToken?: string }): Promise<ListWorkflowsResult>
}
