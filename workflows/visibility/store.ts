/**
 * Workflow Visibility Store
 *
 * Storage implementation for workflow metadata.
 * Provides in-memory storage for testing and base implementation
 * that can be extended for D1/KV backends.
 */

import type {
  WorkflowMetadata,
  WorkflowVisibilityStore,
  ListWorkflowsOptions,
  ListWorkflowsResult,
  WorkflowQuery,
  QueryFilter,
  SearchAttributeValue,
} from './types'
import { parseQuery } from './query-parser'

// ============================================================================
// IN-MEMORY STORE
// ============================================================================

/**
 * In-memory implementation of WorkflowVisibilityStore.
 * Used for testing and development.
 */
export class InMemoryWorkflowVisibilityStore implements WorkflowVisibilityStore {
  private workflows: Map<string, WorkflowMetadata> = new Map()

  async upsert(metadata: WorkflowMetadata): Promise<void> {
    this.workflows.set(metadata.workflowId, { ...metadata })
  }

  async get(workflowId: string): Promise<WorkflowMetadata | null> {
    const metadata = this.workflows.get(workflowId)
    return metadata ? { ...metadata } : null
  }

  async delete(workflowId: string): Promise<void> {
    this.workflows.delete(workflowId)
  }

  async list(options: ListWorkflowsOptions): Promise<ListWorkflowsResult> {
    // Parse query string into structured filters
    const filters = options.query ? parseQuery(options.query) : []

    // Get all workflows and apply filters
    let workflows = Array.from(this.workflows.values())

    // Apply filters
    if (filters.length > 0) {
      workflows = workflows.filter(w => matchesAllFilters(w, filters))
    }

    // Sort by startTime descending (most recent first)
    workflows.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())

    // Apply pagination
    return applyPagination(workflows, options)
  }

  async query(
    query: WorkflowQuery,
    options: { pageSize?: number; nextPageToken?: string } = {}
  ): Promise<ListWorkflowsResult> {
    // Get all workflows and apply filters
    let workflows = Array.from(this.workflows.values())

    if (query.filters.length > 0) {
      workflows = workflows.filter(w => matchesAllFilters(w, query.filters))
    }

    // Sort by startTime descending
    workflows.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())

    return applyPagination(workflows, options)
  }

  /**
   * Clear all stored workflows (for testing)
   */
  clear(): void {
    this.workflows.clear()
  }

  /**
   * Get count of stored workflows (for testing)
   */
  count(): number {
    return this.workflows.size
  }
}

// ============================================================================
// FILTER MATCHING
// ============================================================================

/**
 * Check if a workflow matches all filters (AND logic)
 */
function matchesAllFilters(workflow: WorkflowMetadata, filters: QueryFilter[]): boolean {
  return filters.every(filter => matchesFilter(workflow, filter))
}

/**
 * Check if a workflow matches a single filter
 */
function matchesFilter(workflow: WorkflowMetadata, filter: QueryFilter): boolean {
  const value = getFieldValue(workflow, filter.field)

  switch (filter.operator) {
    case '=':
      return compareEqual(value, filter.value)
    case '!=':
      return !compareEqual(value, filter.value)
    case '>':
      return compareGreater(value, filter.value)
    case '<':
      return compareLess(value, filter.value)
    case '>=':
      return compareEqual(value, filter.value) || compareGreater(value, filter.value)
    case '<=':
      return compareEqual(value, filter.value) || compareLess(value, filter.value)
    case 'IN':
      return Array.isArray(filter.value) && filter.value.some(v => compareEqual(value, v))
    case 'NOT IN':
      return !Array.isArray(filter.value) || !filter.value.some(v => compareEqual(value, v))
    default:
      return false
  }
}

/**
 * Get a field value from workflow metadata
 */
function getFieldValue(workflow: WorkflowMetadata, field: string): SearchAttributeValue | undefined {
  // Standard fields (case-insensitive matching for common fields)
  const normalizedField = field.toLowerCase()

  switch (normalizedField) {
    case 'workflowtype':
      return workflow.workflowType
    case 'status':
      return workflow.status
    case 'workflowid':
      return workflow.workflowId
    case 'runid':
      return workflow.runId
    case 'taskqueue':
      return workflow.taskQueue
    case 'namespace':
      return workflow.namespace
    case 'starttime':
      return workflow.startTime
    case 'closetime':
      return workflow.closeTime
    default:
      // Check search attributes
      return workflow.searchAttributes?.[field]
  }
}

/**
 * Compare two values for equality
 */
function compareEqual(a: SearchAttributeValue | undefined, b: SearchAttributeValue | SearchAttributeValue[]): boolean {
  if (a === undefined) return false
  if (Array.isArray(b)) return false // Single value comparison

  // Handle Date comparison
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  // String comparison (case-sensitive)
  return String(a) === String(b)
}

/**
 * Compare if a > b
 */
function compareGreater(a: SearchAttributeValue | undefined, b: SearchAttributeValue | SearchAttributeValue[]): boolean {
  if (a === undefined || Array.isArray(b)) return false

  // Handle Date comparison
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() > b.getTime()
  }

  // Numeric comparison
  if (typeof a === 'number' && typeof b === 'number') {
    return a > b
  }

  // String comparison
  return String(a) > String(b)
}

/**
 * Compare if a < b
 */
function compareLess(a: SearchAttributeValue | undefined, b: SearchAttributeValue | SearchAttributeValue[]): boolean {
  if (a === undefined || Array.isArray(b)) return false

  // Handle Date comparison
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() < b.getTime()
  }

  // Numeric comparison
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b
  }

  // String comparison
  return String(a) < String(b)
}

// ============================================================================
// PAGINATION
// ============================================================================

/**
 * Apply pagination to a list of workflows
 */
function applyPagination(
  workflows: WorkflowMetadata[],
  options: { pageSize?: number; nextPageToken?: string }
): ListWorkflowsResult {
  const pageSize = options.pageSize ?? 100
  let startIndex = 0

  // Decode cursor (simple offset-based pagination)
  if (options.nextPageToken) {
    try {
      const decoded = JSON.parse(atob(options.nextPageToken))
      startIndex = decoded.offset ?? 0
    } catch (error) {
      // Log pagination token errors so users see why pagination might be wrong
      console.warn('[workflows] Invalid pagination token - starting from beginning:', {
        token: options.nextPageToken.slice(0, 50) + '...',
        error: error instanceof Error ? error.message : 'unknown',
      })
      startIndex = 0
    }
  }

  // Slice results
  const endIndex = startIndex + pageSize
  const pageWorkflows = workflows.slice(startIndex, endIndex)

  // Generate next page token if there are more results
  let nextPageToken: string | undefined
  if (endIndex < workflows.length) {
    nextPageToken = btoa(JSON.stringify({ offset: endIndex }))
  }

  return {
    workflows: pageWorkflows,
    nextPageToken,
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new in-memory workflow visibility store
 */
export function createWorkflowVisibilityStore(): WorkflowVisibilityStore {
  return new InMemoryWorkflowVisibilityStore()
}

export { WorkflowVisibilityStore }
