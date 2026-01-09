/**
 * Collection Modifications Tests
 *
 * Tests for the dotdo plugin's collection modification functionality.
 * These tests verify that the plugin correctly extends Payload collections
 * with dotdo metadata fields, hooks, and sync capabilities.
 */

import { describe, it, expect } from 'vitest'
import {
  extendCollection,
  modifyCollections,
  type PayloadCollection,
  type PayloadConfig
} from '../../src/plugin/collections'
import type { DotdoPluginConfig } from '../../src/plugin/types'

describe('Collection Modifications', () => {
  const defaultConfig: DotdoPluginConfig = {}

  describe('extendCollection', () => {
    it('should add dotdo metadata fields to collection', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [] }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.fields).toContainEqual(expect.objectContaining({ name: '_thingId' }))
    })

    it('should add visibility field if not present', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [] }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.fields).toContainEqual(expect.objectContaining({ name: 'visibility' }))
    })

    it('should preserve existing fields', () => {
      const collection: PayloadCollection = {
        slug: 'posts',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'content', type: 'richText' }
        ]
      }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.fields).toContainEqual(expect.objectContaining({ name: 'title' }))
      expect(extended.fields).toContainEqual(expect.objectContaining({ name: 'content' }))
    })

    it('should not duplicate fields if already present', () => {
      const collection: PayloadCollection = {
        slug: 'posts',
        fields: [
          { name: '_thingId', type: 'text' },
          { name: 'title', type: 'text' }
        ]
      }
      const extended = extendCollection(collection, defaultConfig)
      const thingIdFields = extended.fields.filter(f => f.name === '_thingId')
      expect(thingIdFields).toHaveLength(1)
    })
  })

  describe('collection hooks', () => {
    it('should add beforeCreate hook for Thing sync', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [], hooks: {} }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.hooks?.beforeCreate).toBeDefined()
      expect(extended.hooks?.beforeCreate?.length).toBeGreaterThan(0)
    })

    it('should add afterChange hook for relationship sync', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [], hooks: {} }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.hooks?.afterChange).toBeDefined()
      expect(extended.hooks?.afterChange?.length).toBeGreaterThan(0)
    })

    it('should add beforeDelete hook for cleanup', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [], hooks: {} }
      const extended = extendCollection(collection, defaultConfig)
      expect(extended.hooks?.beforeDelete).toBeDefined()
      expect(extended.hooks?.beforeDelete?.length).toBeGreaterThan(0)
    })

    it('should chain with existing hooks', () => {
      let existingHookCalled = false
      const collection: PayloadCollection = {
        slug: 'posts',
        fields: [],
        hooks: {
          beforeCreate: [() => { existingHookCalled = true }]
        }
      }
      const extended = extendCollection(collection, defaultConfig)
      // Simulate hook execution
      extended.hooks?.beforeCreate?.forEach(hook => hook({ data: {} }))
      expect(existingHookCalled).toBe(true)
      expect(extended.hooks?.beforeCreate?.length).toBeGreaterThan(1)
    })
  })

  describe('modifyCollections', () => {
    it('should modify all collections in config', () => {
      const col1: PayloadCollection = { slug: 'posts', fields: [] }
      const col2: PayloadCollection = { slug: 'users', fields: [] }
      const col3: PayloadCollection = { slug: 'comments', fields: [] }
      const config: PayloadConfig = { collections: [col1, col2, col3] }
      const result = modifyCollections(config, defaultConfig)
      expect(result.collections.every(c => c.fields.some(f => f.name === '_thingId'))).toBe(true)
    })

    it('should skip collections in exclude list', () => {
      const col1: PayloadCollection = { slug: 'posts', fields: [] }
      const col2: PayloadCollection = { slug: 'media', fields: [] }
      const config: PayloadConfig = { collections: [col1, col2] }
      const pluginConfig: DotdoPluginConfig = { excludeCollections: ['media'] }
      const result = modifyCollections(config, pluginConfig)
      const posts = result.collections.find(c => c.slug === 'posts')
      const media = result.collections.find(c => c.slug === 'media')
      expect(posts?.fields.some(f => f.name === '_thingId')).toBe(true)
      expect(media?.fields.some(f => f.name === '_thingId')).toBe(false)
    })

    it('should only modify collections in include list if specified', () => {
      const col1: PayloadCollection = { slug: 'posts', fields: [] }
      const col2: PayloadCollection = { slug: 'users', fields: [] }
      const col3: PayloadCollection = { slug: 'comments', fields: [] }
      const config: PayloadConfig = { collections: [col1, col2, col3] }
      const pluginConfig: DotdoPluginConfig = { includeCollections: ['posts'] }
      const result = modifyCollections(config, pluginConfig)
      const posts = result.collections.find(c => c.slug === 'posts')
      const users = result.collections.find(c => c.slug === 'users')
      expect(posts?.fields.some(f => f.name === '_thingId')).toBe(true)
      expect(users?.fields.some(f => f.name === '_thingId')).toBe(false)
    })
  })

  describe('field injection', () => {
    it('should inject _thingId as hidden text field', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [] }
      const extended = extendCollection(collection, defaultConfig)
      const thingIdField = extended.fields.find(f => f.name === '_thingId')
      expect(thingIdField).toBeDefined()
      expect(thingIdField?.type).toBe('text')
      expect(thingIdField?.admin?.hidden).toBe(true)
    })

    it('should inject _version as hidden number field', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [] }
      const extended = extendCollection(collection, defaultConfig)
      const versionField = extended.fields.find(f => f.name === '_version')
      expect(versionField).toBeDefined()
      expect(versionField?.type).toBe('number')
      expect(versionField?.admin?.hidden).toBe(true)
    })

    it('should inject _syncedAt as hidden date field', () => {
      const collection: PayloadCollection = { slug: 'posts', fields: [] }
      const extended = extendCollection(collection, defaultConfig)
      const syncedAtField = extended.fields.find(f => f.name === '_syncedAt')
      expect(syncedAtField).toBeDefined()
      expect(syncedAtField?.type).toBe('date')
      expect(syncedAtField?.admin?.hidden).toBe(true)
    })
  })
})
