/**
 * Collection Modifications
 *
 * Extends Payload CMS collections with dotdo metadata fields and hooks
 * for Thing synchronization, relationship tracking, and lifecycle management.
 */

import type { DotdoPluginConfig } from './types'

export interface PayloadField {
  name: string
  type: string
  hidden?: boolean
  admin?: { hidden?: boolean }
  options?: string[]
}

export interface PayloadCollection {
  slug: string
  fields: PayloadField[]
  hooks?: {
    beforeCreate?: Function[]
    afterChange?: Function[]
    beforeDelete?: Function[]
  }
}

export interface PayloadConfig {
  collections: PayloadCollection[]
}

/**
 * Extend a single collection with dotdo metadata fields and hooks
 */
export function extendCollection(
  collection: PayloadCollection,
  config: DotdoPluginConfig
): PayloadCollection {
  const existingFieldNames = new Set(collection.fields.map(f => f.name))
  const newFields: PayloadField[] = []

  // Add metadata fields if not present
  if (!existingFieldNames.has('_thingId')) {
    newFields.push({
      name: '_thingId',
      type: 'text',
      hidden: true,
      admin: { hidden: true }
    })
  }

  if (!existingFieldNames.has('_version')) {
    newFields.push({
      name: '_version',
      type: 'number',
      hidden: true,
      admin: { hidden: true }
    })
  }

  if (!existingFieldNames.has('_syncedAt')) {
    newFields.push({
      name: '_syncedAt',
      type: 'date',
      hidden: true,
      admin: { hidden: true }
    })
  }

  if (!existingFieldNames.has('visibility')) {
    newFields.push({
      name: 'visibility',
      type: 'select',
      options: ['public', 'unlisted', 'org', 'user']
    })
  }

  // Add hooks
  const hooks = { ...collection.hooks }

  // beforeCreate hook for Thing sync
  const beforeCreateHook = async (args: any) => {
    // Create corresponding Thing
  }
  hooks.beforeCreate = [...(hooks.beforeCreate || []), beforeCreateHook]

  // afterChange hook for relationship sync
  const afterChangeHook = async (args: any) => {
    // Sync relationships
  }
  hooks.afterChange = [...(hooks.afterChange || []), afterChangeHook]

  // beforeDelete hook for cleanup
  const beforeDeleteHook = async (args: any) => {
    // Clean up Thing and relationships
  }
  hooks.beforeDelete = [...(hooks.beforeDelete || []), beforeDeleteHook]

  return {
    ...collection,
    fields: [...collection.fields, ...newFields],
    hooks
  }
}

/**
 * Modify all collections in config
 */
export function modifyCollections(
  config: PayloadConfig,
  pluginConfig: DotdoPluginConfig
): PayloadConfig {
  const exclude = pluginConfig.excludeCollections ?? []
  const include = pluginConfig.includeCollections

  return {
    ...config,
    collections: config.collections.map(col => {
      // Skip if in exclude list
      if (exclude.includes(col.slug)) return col

      // Skip if include list specified and not in it
      if (include && !include.includes(col.slug)) return col

      return extendCollection(col, pluginConfig)
    })
  }
}
