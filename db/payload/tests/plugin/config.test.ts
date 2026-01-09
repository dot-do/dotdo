import { describe, it, expect } from 'vitest'
import { dotdoPlugin } from '../../src/plugin'
import type { DotdoPluginConfig } from '../../src/plugin/types'

describe('Plugin Configuration', () => {
  describe('dotdoPlugin', () => {
    it('should be a valid Payload plugin function', () => {
      const plugin = dotdoPlugin({})
      expect(typeof plugin).toBe('function')
    })

    it('should accept configuration options', () => {
      const config: DotdoPluginConfig = {
        namespace: 'https://example.do',
        syncEndpoint: true,
        workflowEndpoint: true,
      }
      const plugin = dotdoPlugin(config)
      expect(typeof plugin).toBe('function')
    })

    it('should merge with existing Payload config', () => {
      const plugin = dotdoPlugin({})
      const config = { collections: [{ slug: 'posts', fields: [] }] }
      const result = plugin(config)
      expect(result.collections).toContainEqual(
        expect.objectContaining({ slug: 'posts' })
      )
    })

    it('should add dotdo endpoints when enabled', () => {
      const plugin = dotdoPlugin({ syncEndpoint: true, workflowEndpoint: true })
      const config = { endpoints: [] }
      const result = plugin(config)
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/dotdo/sync', method: 'post' })
      )
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/dotdo/workflow', method: 'post' })
      )
    })

    it('should preserve existing endpoints when adding new ones', () => {
      const plugin = dotdoPlugin({ syncEndpoint: true })
      const existingEndpoint = { path: '/api/custom', method: 'get' as const, handler: async () => Response.json({}) }
      const config = { endpoints: [existingEndpoint] }
      const result = plugin(config)
      expect(result.endpoints).toHaveLength(2)
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/api/custom' })
      )
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/dotdo/sync' })
      )
    })
  })

  describe('DotdoPluginConfig', () => {
    it('should define namespace option', () => {
      const config: DotdoPluginConfig = {
        namespace: 'https://example.do',
      }
      expect(config.namespace).toBe('https://example.do')
    })

    it('should define endpoint toggle options', () => {
      const config: DotdoPluginConfig = {
        syncEndpoint: true,
        workflowEndpoint: false,
      }
      expect(config.syncEndpoint).toBe(true)
      expect(config.workflowEndpoint).toBe(false)
    })

    it('should define hook options', () => {
      const syncCalled: string[] = []
      const workflowCalled: string[] = []

      const config: DotdoPluginConfig = {
        onSync: ({ collection, operation }) => {
          syncCalled.push(`${operation}:${collection}`)
        },
        onWorkflow: ({ workflow, step }) => {
          workflowCalled.push(`${workflow}:${step}`)
        },
      }

      // Verify callbacks are functions
      expect(typeof config.onSync).toBe('function')
      expect(typeof config.onWorkflow).toBe('function')

      // Call them to verify they work
      config.onSync!({ collection: 'posts', operation: 'create', doc: {} })
      config.onWorkflow!({ workflow: 'publish', step: 'validate', data: {} })

      expect(syncCalled).toContain('create:posts')
      expect(workflowCalled).toContain('publish:validate')
    })
  })

  describe('config validation', () => {
    it('should throw on invalid namespace URL', () => {
      expect(() => dotdoPlugin({ namespace: 'not-a-url' })).toThrow(
        'Invalid namespace URL'
      )
    })

    it('should accept valid namespace URL', () => {
      expect(() =>
        dotdoPlugin({ namespace: 'https://example.do' })
      ).not.toThrow()
    })

    it('should use sensible defaults', () => {
      const plugin = dotdoPlugin({})
      const config = {}
      const result = plugin(config)

      // By default, no endpoints should be added
      expect(result.endpoints).toEqual([])
      // Collections should be preserved (empty array when none provided)
      expect(result.collections).toEqual([])
    })

    it('should only add sync endpoint when syncEndpoint is true', () => {
      const plugin = dotdoPlugin({ syncEndpoint: true, workflowEndpoint: false })
      const result = plugin({})
      expect(result.endpoints).toHaveLength(1)
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/dotdo/sync' })
      )
    })

    it('should only add workflow endpoint when workflowEndpoint is true', () => {
      const plugin = dotdoPlugin({ syncEndpoint: false, workflowEndpoint: true })
      const result = plugin({})
      expect(result.endpoints).toHaveLength(1)
      expect(result.endpoints).toContainEqual(
        expect.objectContaining({ path: '/dotdo/workflow' })
      )
    })
  })
})
