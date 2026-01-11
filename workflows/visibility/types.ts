/**
 * Workflow Visibility Types
 *
 * Type definitions for Temporal-like workflow visibility API.
 * Enables listing and querying running workflows.
 */

// ============================================================================
// WORKFLOW STATUS
// ============================================================================

/**
 * Workflow execution status
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
 * Search attribute value types
 */
export type SearchAttributeValue = string | number | boolean | Date | string[] | number[]

/**
 * Search attributes for workflow queries
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
