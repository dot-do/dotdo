/**
 * Actions Builder Utilities
 *
 * Functions for constructing action URLs for mutations in the dotdo response format.
 * Supports both simple URL strings and clickable action objects with method/href.
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
 * Clickable action object with method and href
 * This format is used for E2E-compatible "clickable" API responses
 */
export interface ClickableAction {
  method: string
  href: string
  type?: string
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
 * Build clickable action objects for an item (update, delete, custom actions)
 * Returns objects with method and href properties for E2E-compatible responses
 *
 * @param options - Item action options
 * @returns Record of action name to ClickableAction object
 */
export function buildItemActionsClickable(options: ItemActionsOptions): Record<string, ClickableAction> {
  const { ns, type, id, customActions = [] } = options

  // Build the base item URL using buildIdUrl
  const itemUrl = buildIdUrl(ns, type, id)

  // Build default actions with method and href
  const actions: Record<string, ClickableAction> = {
    update: { method: 'PUT', href: itemUrl },
    delete: { method: 'DELETE', href: itemUrl },
  }

  // Add custom actions (default to POST for custom actions)
  for (const action of customActions) {
    actions[action] = { method: 'POST', href: `${itemUrl}/${action}` }
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

/**
 * Build clickable action objects for a collection (create, custom actions)
 * Returns objects with method and href properties for E2E-compatible responses
 *
 * @param options - Collection action options
 * @returns Record of action name to ClickableAction object
 */
export function buildCollectionActionsClickable(options: CollectionActionsOptions): Record<string, ClickableAction> {
  const { ns, type, customActions = [] } = options

  // Build the base collection URL using buildTypeUrl
  const collectionUrl = buildTypeUrl(ns, type)

  // Build default actions with method and href
  const actions: Record<string, ClickableAction> = {
    create: { method: 'POST', href: collectionUrl },
  }

  // Add custom actions (default to POST for custom actions)
  for (const action of customActions) {
    actions[action] = { method: 'POST', href: `${collectionUrl}/${action}` }
  }

  return actions
}
