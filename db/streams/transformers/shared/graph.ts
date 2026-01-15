/**
 * Graph Column Utilities
 *
 * Utilities for computing lean graph columns (depth, is_leaf, is_root) on UnifiedEvent.
 * These columns enable 10x faster depth/leaf queries by avoiding recursive CTEs.
 *
 * @module db/streams/transformers/shared/graph
 */

import type { UnifiedEvent } from '../../../../types/unified-event'

/**
 * Parent depth lookup result.
 * Only depth is needed from parent to compute child depth.
 */
export interface ParentDepthInfo {
  depth: number
}

/**
 * Result of computing graph columns for an event.
 */
export interface GraphColumnsResult {
  /** Graph depth: 0 for root spans, parent.depth + 1 for children */
  depth: number
  /** Whether this span is a root (has no parent) */
  is_root: boolean
}

/**
 * Computes graph columns (depth, is_root) for an event.
 *
 * Rules:
 * - If parent_id is null/undefined: depth=0, is_root=true
 * - If parent_id exists and parent found: depth=parent.depth+1, is_root=false
 * - If parent_id exists but parent not found: depth=1 (default), is_root=false
 *
 * @param event - Partial event with optional parent_id
 * @param parentLookup - Optional function to look up parent depth info
 * @returns Graph columns (depth, is_root)
 *
 * @example
 * ```typescript
 * // Root span
 * const rootResult = computeGraphColumns({ parent_id: null })
 * // => { depth: 0, is_root: true }
 *
 * // Child span with parent lookup
 * const parentLookup = (id: string) => ({ depth: 0 })
 * const childResult = computeGraphColumns({ parent_id: 'parent-123' }, parentLookup)
 * // => { depth: 1, is_root: false }
 * ```
 */
export function computeGraphColumns(
  event: Partial<Pick<UnifiedEvent, 'parent_id'>>,
  parentLookup?: (parentId: string) => ParentDepthInfo | undefined
): GraphColumnsResult {
  const hasParent = event.parent_id != null && event.parent_id !== ''

  if (!hasParent) {
    return { depth: 0, is_root: true }
  }

  // Has a parent - look up parent's depth if lookup provided
  const parentInfo = parentLookup?.(event.parent_id!)
  const depth = parentInfo ? parentInfo.depth + 1 : 1 // Default to 1 if parent not found

  return { depth, is_root: false }
}

/**
 * Determines if a span is a leaf (has no children).
 *
 * @param spanId - The span ID to check
 * @param hasChildren - Function that returns true if the span has children
 * @returns true if the span has no children (is a leaf)
 *
 * @example
 * ```typescript
 * const spans = [
 *   { id: 'root', parent_id: null },
 *   { id: 'child', parent_id: 'root' },
 * ]
 * const hasChildren = (id: string) => spans.some(s => s.parent_id === id)
 *
 * computeIsLeaf('root', hasChildren)   // => false (has 'child')
 * computeIsLeaf('child', hasChildren)  // => true (no children)
 * ```
 */
export function computeIsLeaf(
  spanId: string,
  hasChildren: (spanId: string) => boolean
): boolean {
  return !hasChildren(spanId)
}

/**
 * Batch computes graph columns for multiple events.
 * More efficient than computing individually when you have the full dataset.
 *
 * @param events - Array of events to compute graph columns for
 * @returns Map from event ID to computed graph columns
 *
 * @example
 * ```typescript
 * const events = [
 *   { id: 'evt-1', span_id: 'span-1', parent_id: null },
 *   { id: 'evt-2', span_id: 'span-2', parent_id: 'span-1' },
 * ]
 * const results = computeGraphColumnsBatch(events)
 * // results.get('evt-1') => { depth: 0, is_root: true, is_leaf: false }
 * // results.get('evt-2') => { depth: 1, is_root: false, is_leaf: true }
 * ```
 */
export function computeGraphColumnsBatch(
  events: Array<Partial<Pick<UnifiedEvent, 'id' | 'span_id' | 'parent_id'>>>
): Map<string, GraphColumnsResult & { is_leaf: boolean }> {
  const results = new Map<string, GraphColumnsResult & { is_leaf: boolean }>()

  // Build a map of span_id -> depth for parent lookups
  const depthBySpanId = new Map<string, number>()

  // First pass: identify roots and build initial depth map
  for (const event of events) {
    const id = event.id ?? event.span_id
    if (!id) continue

    const hasParent = event.parent_id != null && event.parent_id !== ''
    if (!hasParent) {
      depthBySpanId.set(event.span_id ?? id, 0)
    }
  }

  // Second pass: compute depths for children (may need multiple iterations for deep trees)
  let changed = true
  while (changed) {
    changed = false
    for (const event of events) {
      const spanId = event.span_id ?? event.id
      if (!spanId) continue
      if (depthBySpanId.has(spanId)) continue // Already computed

      const parentId = event.parent_id
      if (parentId && depthBySpanId.has(parentId)) {
        depthBySpanId.set(spanId, depthBySpanId.get(parentId)! + 1)
        changed = true
      }
    }
  }

  // Third pass: identify leaves (spans with no children)
  const spanIdsWithChildren = new Set<string>()
  for (const event of events) {
    if (event.parent_id) {
      spanIdsWithChildren.add(event.parent_id)
    }
  }

  // Build final results
  for (const event of events) {
    const id = event.id ?? event.span_id
    const spanId = event.span_id ?? id
    if (!id || !spanId) continue

    const hasParent = event.parent_id != null && event.parent_id !== ''
    const depth = depthBySpanId.get(spanId) ?? (hasParent ? 1 : 0)
    const is_root = !hasParent
    const is_leaf = !spanIdsWithChildren.has(spanId)

    results.set(id, { depth, is_root, is_leaf })
  }

  return results
}
