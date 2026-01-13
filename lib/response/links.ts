/**
 * Links Builder Utilities
 *
 * Functions for constructing HATEOAS-style navigation links for API responses.
 */

import { buildTypeUrl, buildIdUrl } from './urls'

/**
 * Options for building item links
 */
export interface ItemLinksOptions {
  ns: string
  type: string
  id: string
  relations?: string[]
}

/**
 * Options for building collection links
 */
export interface CollectionLinksOptions {
  ns: string
  type: string
  pagination?: {
    after?: string
    before?: string
    hasNext?: boolean
    hasPrev?: boolean
  }
}

/**
 * Build navigation links for a single item
 *
 * Expected links:
 * - collection: URL to the collection this item belongs to
 * - edit: URL to edit this item
 * - [relation]: URL to related collections (if relations provided)
 *
 * @param options - Item link options
 * @returns Record of link name to fully qualified URL
 */
export function buildItemLinks(options: ItemLinksOptions): Record<string, string> {
  const { ns, type, id, relations } = options

  const links: Record<string, string> = {
    collection: buildTypeUrl(ns, type),
    edit: buildIdUrl(ns, type, id) + '/edit',
  }

  // Add relation links
  if (relations) {
    for (const relation of relations) {
      links[relation] = buildIdUrl(ns, type, id) + '/' + relation
    }
  }

  return links
}

/**
 * Build navigation links for a collection
 *
 * Expected links:
 * - home: URL to namespace root
 * - first: URL to first page of collection
 * - next: URL to next page (if hasNext and after cursor provided)
 * - prev: URL to previous page (if hasPrev and before cursor provided)
 *
 * @param options - Collection link options
 * @returns Record of link name to fully qualified URL
 */
export function buildCollectionLinks(options: CollectionLinksOptions): Record<string, string> {
  const { ns, type, pagination } = options

  const links: Record<string, string> = {
    home: ns,
    first: buildTypeUrl(ns, type),
  }

  // Add next link if hasNext is true and after cursor is provided
  if (pagination?.hasNext && pagination.after !== undefined) {
    links.next = buildTypeUrl(ns, type) + '?after=' + encodeURIComponent(pagination.after)
  }

  // Add prev link if hasPrev is true and before cursor is provided
  if (pagination?.hasPrev && pagination.before !== undefined) {
    links.prev = buildTypeUrl(ns, type) + '?before=' + encodeURIComponent(pagination.before)
  }

  return links
}
