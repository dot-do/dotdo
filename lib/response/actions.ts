/**
 * Actions Builder Utilities
 *
 * Functions for constructing action URLs for mutations in the dotdo response format.
 */

import { buildTypeUrl, buildIdUrl } from './urls'

/**
 * Options for building item-level actions
 */
export interface ItemActionsOptions {
  ns: string
  type: string
  id: string
  customActions?: string[]
}

/**
 * Options for building collection-level actions
 */
export interface CollectionActionsOptions {
  ns: string
  type: string
  customActions?: string[]
}

/**
 * Build action URLs for an item (update, delete, custom actions)
 *
 * @param options - Item action options
 * @returns Record of action name to fully qualified URL
 */
export function buildItemActions(options: ItemActionsOptions): Record<string, string> {
  const { ns, type, id, customActions = [] } = options

  // Build the base item URL using buildIdUrl
  const itemUrl = buildIdUrl(ns, type, id)

  // Build default actions
  const actions: Record<string, string> = {
    update: itemUrl,
    delete: itemUrl,
  }

  // Add custom actions
  for (const action of customActions) {
    actions[action] = `${itemUrl}/${action}`
  }

  return actions
}

/**
 * Build action URLs for a collection (create, custom actions)
 *
 * @param options - Collection action options
 * @returns Record of action name to fully qualified URL
 */
export function buildCollectionActions(options: CollectionActionsOptions): Record<string, string> {
  const { ns, type, customActions = [] } = options

  // Build the base collection URL using buildTypeUrl
  const collectionUrl = buildTypeUrl(ns, type)

  // Build default actions
  const actions: Record<string, string> = {
    create: collectionUrl,
  }

  // Add custom actions
  for (const action of customActions) {
    actions[action] = `${collectionUrl}/${action}`
  }

  return actions
}
