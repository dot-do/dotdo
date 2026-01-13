/**
 * Collection Response Builder
 *
 * Builds paginated, filterable collection responses in the dotdo response format
 * with JSON-LD style linked data properties.
 */

import { buildTypeUrl, buildIdUrl, normalizeNs } from './urls'

export interface CollectionResponseOptions {
  ns: string
  type: string
  parent?: string
  pagination?: {
    after?: string
    before?: string
    hasNext?: boolean
    hasPrev?: boolean
  }
  facets?: {
    sort?: string[]
    filter?: Record<string, string[]>
  }
  customActions?: string[]
}

export interface CollectionResponse<T extends object> {
  $context: string
  $type: string
  $id: string
  count: number
  links: Record<string, string>
  facets?: { sort?: string[]; filter?: Record<string, string[]> }
  actions: Record<string, string>
  items: Array<T & { $context: string; $type: string; $id: string }>
}

/**
 * Build a collection response with pagination, facets, and item metadata
 *
 * @param items - Array of items to include in the response
 * @param count - Total count of items (not just page size)
 * @param options - Configuration options for the collection
 * @returns Complete collection response with linked data properties
 *
 * @example Basic collection:
 * ```ts
 * buildCollectionResponse(
 *   [{ id: 'alice', name: 'Alice' }],
 *   100,
 *   { ns: 'https://headless.ly', type: 'Customer' }
 * )
 * ```
 *
 * @example With parent context (nested resources):
 * ```ts
 * buildCollectionResponse(
 *   [{ id: 'ord-123', total: 99.99 }],
 *   50,
 *   {
 *     ns: 'https://headless.ly',
 *     type: 'Order',
 *     parent: 'https://headless.ly/customers/alice'
 *   }
 * )
 * ```
 */
export function buildCollectionResponse<T extends { id: string }>(
  items: T[],
  count: number,
  options: CollectionResponseOptions
): CollectionResponse<T> {
  const { ns, type, parent, pagination, facets, customActions = [] } = options

  // Normalize namespace
  const normalizedNs = normalizeNs(ns)

  // Determine base URL for the collection
  // If parent is provided, use parent as the base; otherwise use ns
  const baseUrl = parent ? normalizeNs(parent) : normalizedNs

  // Build $context: parent if provided, otherwise ns
  const $context = parent || normalizedNs

  // Build $type: baseUrl + '/' + pluralize(type)
  const $type = buildTypeUrl(baseUrl, type)

  // Build $id: same as $type for collections
  const $id = $type

  // Build links
  const links: Record<string, string> = {
    home: normalizedNs,
    first: $type,
  }

  // Add pagination links
  if (pagination?.hasNext && pagination.after !== undefined) {
    links.next = `${$type}?after=${encodeURIComponent(pagination.after)}`
  }

  if (pagination?.hasPrev && pagination.before !== undefined) {
    links.prev = `${$type}?before=${encodeURIComponent(pagination.before)}`
  }

  // Add last link when hasNext is true (indicating there are more pages)
  if (pagination?.hasNext) {
    links.last = `${$type}?last=true`
  }

  // Build actions
  const actions: Record<string, string> = {
    create: $type,
  }

  // Add custom actions
  for (const action of customActions) {
    actions[action] = `${$type}/${action}`
  }

  // Transform items - each item needs $context, $type, $id
  const transformedItems = items.map((item) => {
    const itemId = buildIdUrl(baseUrl, type, item.id)
    return {
      $context,
      $type,
      $id: itemId,
      ...item,
    }
  }) as Array<T & { $context: string; $type: string; $id: string }>

  // Build response, conditionally including facets
  const response: CollectionResponse<T> = {
    $context,
    $type,
    $id,
    count,
    links,
    actions,
    items: transformedItems,
  }

  // Only include facets if provided
  if (facets) {
    response.facets = facets
  }

  return response
}
