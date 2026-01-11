/**
 * Workflow Visibility API
 *
 * Temporal-like visibility for listing and querying workflows.
 *
 * @example
 * ```typescript
 * import { listWorkflows, createWorkflowVisibilityStore } from './visibility'
 *
 * const store = createWorkflowVisibilityStore()
 *
 * // List all running order workflows
 * const result = await listWorkflows(store, {
 *   query: 'WorkflowType = "orderWorkflow" AND Status = "RUNNING"',
 *   pageSize: 100,
 * })
 *
 * for (const workflow of result.workflows) {
 *   console.log(workflow.workflowId, workflow.status)
 * }
 * ```
 */

// Re-export types
export {
  WorkflowStatus,
  WorkflowMetadata,
  WorkflowQuery,
  QueryFilter,
  QueryOperator,
  SearchAttributes,
  SearchAttributeValue,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  WorkflowVisibilityStore,
} from './types'

// Re-export store
export {
  createWorkflowVisibilityStore,
  InMemoryWorkflowVisibilityStore,
} from './store'

// Re-export query parser
export { parseQuery, buildQuery } from './query-parser'

// Import types for function signatures
import type {
  WorkflowVisibilityStore,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  WorkflowQuery,
} from './types'

// ============================================================================
// LIST WORKFLOWS
// ============================================================================

/**
 * List workflows with optional query filter.
 *
 * @param store Visibility store instance
 * @param options List options including query string and pagination
 * @returns List of matching workflows with pagination info
 *
 * @example
 * ```typescript
 * // List all workflows
 * const all = await listWorkflows(store, {})
 *
 * // List running order workflows
 * const running = await listWorkflows(store, {
 *   query: 'WorkflowType = "orderWorkflow" AND Status = "RUNNING"',
 * })
 *
 * // Paginate through results
 * let result = await listWorkflows(store, { pageSize: 10 })
 * while (result.nextPageToken) {
 *   result = await listWorkflows(store, {
 *     pageSize: 10,
 *     nextPageToken: result.nextPageToken,
 *   })
 * }
 * ```
 */
export async function listWorkflows(
  store: WorkflowVisibilityStore,
  options: ListWorkflowsOptions = {}
): Promise<ListWorkflowsResult> {
  return store.list(options)
}

// ============================================================================
// QUERY WORKFLOWS
// ============================================================================

/**
 * Query workflows with structured filters.
 *
 * @param store Visibility store instance
 * @param query Structured query with filter conditions
 * @param options Pagination options
 * @returns List of matching workflows with pagination info
 *
 * @example
 * ```typescript
 * const result = await queryWorkflows(store, {
 *   filters: [
 *     { field: 'WorkflowType', operator: '=', value: 'orderWorkflow' },
 *     { field: 'Status', operator: '=', value: 'RUNNING' },
 *   ],
 * })
 * ```
 */
export async function queryWorkflows(
  store: WorkflowVisibilityStore,
  query: WorkflowQuery,
  options: { pageSize?: number; nextPageToken?: string } = {}
): Promise<ListWorkflowsResult> {
  return store.query(query, options)
}

// ============================================================================
// WORKFLOW VISIBILITY CLIENT
// ============================================================================

/**
 * Workflow visibility client for convenient access to visibility APIs.
 *
 * @example
 * ```typescript
 * const client = new WorkflowVisibilityClient(store)
 *
 * // List with query string
 * const result = await client.list({
 *   query: 'WorkflowType = "orderWorkflow" AND Status = "RUNNING"',
 *   pageSize: 100,
 * })
 *
 * // Iterate with async iterator
 * for await (const workflow of client.iterate({ query: 'Status = "RUNNING"' })) {
 *   console.log(workflow.workflowId)
 * }
 * ```
 */
export class WorkflowVisibilityClient {
  constructor(private readonly store: WorkflowVisibilityStore) {}

  /**
   * List workflows with optional query
   */
  async list(options: ListWorkflowsOptions = {}): Promise<ListWorkflowsResult> {
    return listWorkflows(this.store, options)
  }

  /**
   * Query workflows with structured filters
   */
  async query(
    query: WorkflowQuery,
    options: { pageSize?: number; nextPageToken?: string } = {}
  ): Promise<ListWorkflowsResult> {
    return queryWorkflows(this.store, query, options)
  }

  /**
   * Async iterator for paginating through all matching workflows
   */
  async *iterate(options: ListWorkflowsOptions = {}): AsyncIterableIterator<import('./types').WorkflowMetadata> {
    let nextPageToken: string | undefined

    do {
      const result = await this.list({
        ...options,
        nextPageToken,
      })

      for (const workflow of result.workflows) {
        yield workflow
      }

      nextPageToken = result.nextPageToken
    } while (nextPageToken)
  }
}

/**
 * Create a new workflow visibility client
 */
export function createWorkflowVisibilityClient(store: WorkflowVisibilityStore): WorkflowVisibilityClient {
  return new WorkflowVisibilityClient(store)
}
