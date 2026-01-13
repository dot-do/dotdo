/**
 * Auto-Register Tests
 *
 * Tests for provider registry and auto-registration functionality.
 * Verifies tool registration orchestration from compat/ providers.
 *
 * @see lib/tools/auto-register.ts
 * @see dotdo-pwg8u - Extract Common Provider Patterns from compat/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ProviderRegistry,
  globalRegistry,
  registerAdapterFactory,
  getAdapterFactoryNames,
  loadProvider,
  loadAllProviders,
  registryToThings,
  createTestRegistry,
  type ProviderFilter,
  type ToolFilter,
  type ToolWithProvider,
  type LoadResult,
} from '../auto-register'
import {
  createProviderAdapter,
  ProviderError,
  type ProviderToolAdapter,
  type RuntimeCredentials,
} from '../provider-adapter'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock provider adapter for testing
 */
function createMockAdapter(config: {
  name: string
  category?: string
  tools?: Array<{ id: string; name: string; tags?: string[]; deprecated?: boolean }>
}): ProviderToolAdapter {
  return createProviderAdapter({
    name: config.name,
    category: (config.category || 'communication') as any,
    credential: { type: 'api_key' },
    tools: (config.tools || [{ id: 'default_tool', name: 'Default Tool' }]).map(t => ({
      id: t.id,
      name: t.name,
      description: `${t.name} description`,
      parameters: { type: 'object', properties: {} },
      handler: vi.fn().mockResolvedValue({ success: true }),
      tags: t.tags,
      deprecated: t.deprecated,
    })),
  })
}

// ============================================================================
// ProviderRegistry TESTS
// ============================================================================

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  describe('register', () => {
    it('registers a provider adapter', () => {
      const adapter = createMockAdapter({ name: 'test' })

      registry.register(adapter)

      expect(registry.has('test')).toBe(true)
    })

    it('emits registered event for new provider', () => {
      const adapter = createMockAdapter({ name: 'test' })
      const listener = vi.fn()
      registry.subscribe(listener)

      registry.register(adapter)

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'registered',
          provider: 'test',
        })
      )
    })

    it('emits updated event when re-registering', () => {
      const adapter1 = createMockAdapter({ name: 'test' })
      const adapter2 = createMockAdapter({ name: 'test' })
      const listener = vi.fn()

      registry.register(adapter1)
      registry.subscribe(listener)
      registry.register(adapter2)

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updated',
          provider: 'test',
        })
      )
    })
  })

  describe('unregister', () => {
    it('removes registered provider', () => {
      const adapter = createMockAdapter({ name: 'test' })
      registry.register(adapter)

      const result = registry.unregister('test')

      expect(result).toBe(true)
      expect(registry.has('test')).toBe(false)
    })

    it('returns false for non-existent provider', () => {
      const result = registry.unregister('non-existent')

      expect(result).toBe(false)
    })

    it('emits unregistered event', () => {
      const adapter = createMockAdapter({ name: 'test' })
      registry.register(adapter)
      const listener = vi.fn()
      registry.subscribe(listener)

      registry.unregister('test')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'unregistered',
          provider: 'test',
        })
      )
    })
  })

  describe('get', () => {
    it('returns registered adapter', () => {
      const adapter = createMockAdapter({ name: 'test' })
      registry.register(adapter)

      const result = registry.get('test')

      expect(result).toBe(adapter)
    })

    it('returns undefined for non-existent provider', () => {
      const result = registry.get('non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('has', () => {
    it('returns true for registered provider', () => {
      const adapter = createMockAdapter({ name: 'test' })
      registry.register(adapter)

      expect(registry.has('test')).toBe(true)
    })

    it('returns false for non-existent provider', () => {
      expect(registry.has('non-existent')).toBe(false)
    })
  })

  describe('getProviderNames', () => {
    it('returns all registered provider names', () => {
      registry.register(createMockAdapter({ name: 'provider1' }))
      registry.register(createMockAdapter({ name: 'provider2' }))
      registry.register(createMockAdapter({ name: 'provider3' }))

      const names = registry.getProviderNames()

      expect(names).toHaveLength(3)
      expect(names).toContain('provider1')
      expect(names).toContain('provider2')
      expect(names).toContain('provider3')
    })

    it('returns empty array when no providers', () => {
      const names = registry.getProviderNames()

      expect(names).toEqual([])
    })
  })

  describe('getProviders', () => {
    beforeEach(() => {
      registry.register(createMockAdapter({ name: 'sendgrid', category: 'communication' }))
      registry.register(createMockAdapter({ name: 'stripe', category: 'commerce' }))
      registry.register(createMockAdapter({ name: 'slack', category: 'collaboration' }))
    })

    it('returns all providers without filter', () => {
      const providers = registry.getProviders()

      expect(providers).toHaveLength(3)
    })

    it('filters by category', () => {
      const providers = registry.getProviders({ category: 'communication' })

      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('sendgrid')
    })

    it('filters by credential type', () => {
      const providers = registry.getProviders({ credentialType: 'api_key' })

      expect(providers).toHaveLength(3) // All use api_key
    })

    it('filters by search term in name', () => {
      const providers = registry.getProviders({ search: 'send' })

      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('sendgrid')
    })

    it('filters by search term in description (case-insensitive)', () => {
      const providers = registry.getProviders({ search: 'STRIPE' })

      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('stripe')
    })
  })

  describe('getTools', () => {
    beforeEach(() => {
      registry.register(createMockAdapter({
        name: 'sendgrid',
        category: 'communication',
        tools: [
          { id: 'send_email', name: 'Send Email', tags: ['email'] },
          { id: 'list_templates', name: 'List Templates', tags: ['templates'] },
        ],
      }))
      registry.register(createMockAdapter({
        name: 'stripe',
        category: 'commerce',
        tools: [
          { id: 'create_customer', name: 'Create Customer', tags: ['customer'] },
          { id: 'deprecated_method', name: 'Deprecated', deprecated: true },
        ],
      }))
    })

    it('returns all tools without filter', () => {
      const tools = registry.getTools()

      // Excludes deprecated by default
      expect(tools).toHaveLength(3)
    })

    it('includes deprecated tools when requested', () => {
      const tools = registry.getTools({ includeDeprecated: true })

      expect(tools).toHaveLength(4)
    })

    it('filters by provider', () => {
      const tools = registry.getTools({ provider: 'sendgrid' })

      expect(tools).toHaveLength(2)
      expect(tools.every(t => t.provider.name === 'sendgrid')).toBe(true)
    })

    it('filters by tags', () => {
      const tools = registry.getTools({ tags: ['email'] })

      expect(tools).toHaveLength(1)
      expect(tools[0].tool.id).toBe('send_email')
    })

    it('filters by search term', () => {
      const tools = registry.getTools({ search: 'customer' })

      expect(tools).toHaveLength(1)
      expect(tools[0].tool.id).toBe('create_customer')
    })

    it('returns tools with provider metadata and qualified ID', () => {
      const tools = registry.getTools({ provider: 'sendgrid' })
      const tool = tools.find(t => t.tool.id === 'send_email')!

      expect(tool.provider.name).toBe('sendgrid')
      expect(tool.provider.category).toBe('communication')
      expect(tool.fullyQualifiedId).toBe('communication.sendgrid.send_email')
    })
  })

  describe('getTool', () => {
    beforeEach(() => {
      registry.register(createMockAdapter({
        name: 'sendgrid',
        tools: [{ id: 'send_email', name: 'Send Email' }],
      }))
    })

    it('returns tool by provider and ID', () => {
      const tool = registry.getTool('sendgrid', 'send_email')

      expect(tool).toBeDefined()
      expect(tool?.id).toBe('send_email')
    })

    it('returns undefined for non-existent tool', () => {
      const tool = registry.getTool('sendgrid', 'non_existent')

      expect(tool).toBeUndefined()
    })

    it('returns undefined for non-existent provider', () => {
      const tool = registry.getTool('non_existent', 'send_email')

      expect(tool).toBeUndefined()
    })
  })

  describe('execute', () => {
    const mockHandler = vi.fn().mockResolvedValue({ result: 'success' })

    beforeEach(() => {
      const adapter = createProviderAdapter({
        name: 'test',
        category: 'communication',
        credential: { type: 'api_key' },
        tools: [{
          id: 'test_tool',
          name: 'Test Tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          handler: mockHandler,
        }],
      })
      registry.register(adapter)
    })

    it('executes tool via provider', async () => {
      const result = await registry.execute(
        'test',
        'test_tool',
        { key: 'value' },
        { apiKey: 'secret' }
      )

      expect(result).toEqual({ result: 'success' })
      expect(mockHandler).toHaveBeenCalledWith(
        { key: 'value' },
        { apiKey: 'secret' },
        undefined
      )
    })

    it('passes context to tool', async () => {
      await registry.execute(
        'test',
        'test_tool',
        {},
        {},
        { requestId: 'req-123' }
      )

      expect(mockHandler).toHaveBeenCalledWith(
        {},
        {},
        { requestId: 'req-123' }
      )
    })

    it('throws for non-existent provider', async () => {
      await expect(
        registry.execute('non_existent', 'tool', {}, {})
      ).rejects.toThrow(ProviderError)

      try {
        await registry.execute('non_existent', 'tool', {}, {})
      } catch (error) {
        expect((error as ProviderError).code).toBe('PROVIDER_NOT_FOUND')
      }
    })
  })

  describe('executeByFullId', () => {
    beforeEach(() => {
      const adapter = createProviderAdapter({
        name: 'sendgrid',
        category: 'communication',
        credential: { type: 'api_key' },
        tools: [{
          id: 'send_email',
          name: 'Send Email',
          description: 'Send email',
          parameters: { type: 'object', properties: {} },
          handler: vi.fn().mockResolvedValue({ sent: true }),
        }],
      })
      registry.register(adapter)
    })

    it('executes tool by fully qualified ID', async () => {
      const result = await registry.executeByFullId(
        'communication.sendgrid.send_email',
        { to: 'test@example.com' },
        { apiKey: 'key' }
      )

      expect(result).toEqual({ sent: true })
    })

    it('throws for invalid ID format', async () => {
      await expect(
        registry.executeByFullId('invalid.id', {}, {})
      ).rejects.toThrow(ProviderError)

      try {
        await registry.executeByFullId('invalid', {}, {})
      } catch (error) {
        expect((error as ProviderError).code).toBe('INVALID_TOOL_ID')
      }
    })
  })

  describe('validateCredentials', () => {
    it('returns true when adapter has no validator', async () => {
      registry.register(createMockAdapter({ name: 'test' }))

      const result = await registry.validateCredentials('test', { apiKey: 'key' })

      expect(result).toBe(true)
    })

    it('throws for non-existent provider', async () => {
      await expect(
        registry.validateCredentials('non_existent', {})
      ).rejects.toThrow(ProviderError)
    })
  })

  describe('getStats', () => {
    it('returns correct statistics', () => {
      registry.register(createMockAdapter({
        name: 'sendgrid',
        category: 'communication',
        tools: [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }],
      }))
      registry.register(createMockAdapter({
        name: 'stripe',
        category: 'commerce',
        tools: [{ id: 't3', name: 'T3' }],
      }))

      const stats = registry.getStats()

      expect(stats.providerCount).toBe(2)
      expect(stats.toolCount).toBe(3)
      expect(stats.categoryCount).toEqual({
        communication: 1,
        commerce: 1,
      })
    })

    it('returns zeros for empty registry', () => {
      const stats = registry.getStats()

      expect(stats.providerCount).toBe(0)
      expect(stats.toolCount).toBe(0)
      expect(stats.categoryCount).toEqual({})
    })
  })

  describe('subscribe', () => {
    it('notifies listeners of events', () => {
      const listener = vi.fn()
      registry.subscribe(listener)

      registry.register(createMockAdapter({ name: 'test' }))

      expect(listener).toHaveBeenCalled()
    })

    it('returns unsubscribe function', () => {
      const listener = vi.fn()
      const unsubscribe = registry.subscribe(listener)

      unsubscribe()
      registry.register(createMockAdapter({ name: 'test' }))

      expect(listener).not.toHaveBeenCalled()
    })

    it('handles listener errors gracefully', () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const normalListener = vi.fn()

      registry.subscribe(errorListener)
      registry.subscribe(normalListener)

      // Should not throw
      registry.register(createMockAdapter({ name: 'test' }))

      expect(normalListener).toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('removes all providers', () => {
      registry.register(createMockAdapter({ name: 'p1' }))
      registry.register(createMockAdapter({ name: 'p2' }))

      registry.clear()

      expect(registry.getProviderNames()).toEqual([])
    })

    it('emits unregistered events for each provider', () => {
      registry.register(createMockAdapter({ name: 'p1' }))
      registry.register(createMockAdapter({ name: 'p2' }))
      const listener = vi.fn()
      registry.subscribe(listener)

      registry.clear()

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unregistered', provider: 'p1' })
      )
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unregistered', provider: 'p2' })
      )
    })
  })
})

// ============================================================================
// ADAPTER FACTORY TESTS
// ============================================================================

describe('Adapter Factory Functions', () => {
  // Note: These tests use the module-level factory map, so be careful about test isolation

  describe('registerAdapterFactory & getAdapterFactoryNames', () => {
    it('registers and retrieves factory names', () => {
      const factory = () => createMockAdapter({ name: 'factory-test' })

      registerAdapterFactory('factory-test', factory)

      const names = getAdapterFactoryNames()
      expect(names).toContain('factory-test')
    })
  })

  describe('loadProvider', () => {
    it('loads provider from factory', async () => {
      const adapter = createMockAdapter({ name: 'load-test' })
      registerAdapterFactory('load-test', () => adapter)

      const registry = new ProviderRegistry()
      const loaded = await loadProvider(registry, 'load-test')

      expect(loaded).toBe(adapter)
      expect(registry.has('load-test')).toBe(true)
    })

    it('returns null for non-existent factory', async () => {
      const registry = new ProviderRegistry()
      const loaded = await loadProvider(registry, 'non-existent-factory')

      expect(loaded).toBeNull()
    })

    it('handles factory errors gracefully', async () => {
      registerAdapterFactory('error-factory', () => {
        throw new Error('Factory error')
      })

      const registry = new ProviderRegistry()
      const loaded = await loadProvider(registry, 'error-factory')

      expect(loaded).toBeNull()
    })
  })

  describe('loadAllProviders', () => {
    it('loads all registered factories', async () => {
      registerAdapterFactory('all-test-1', () => createMockAdapter({ name: 'all-test-1' }))
      registerAdapterFactory('all-test-2', () => createMockAdapter({ name: 'all-test-2' }))

      const registry = new ProviderRegistry()
      const result = await loadAllProviders(registry)

      expect(result.loaded).toContain('all-test-1')
      expect(result.loaded).toContain('all-test-2')
    })

    it('reports failed loads', async () => {
      registerAdapterFactory('success-factory', () => createMockAdapter({ name: 'success-factory' }))
      registerAdapterFactory('fail-factory', () => {
        throw new Error('Load failed')
      })

      const registry = new ProviderRegistry()
      const result = await loadAllProviders(registry)

      expect(result.loaded).toContain('success-factory')
      expect(result.failed.some(f => f.name === 'fail-factory')).toBe(true)
    })
  })
})

// ============================================================================
// registryToThings TESTS
// ============================================================================

describe('registryToThings', () => {
  it('converts registry to Thing graph format', () => {
    const registry = new ProviderRegistry()
    registry.register(createMockAdapter({
      name: 'sendgrid',
      category: 'communication',
      tools: [
        { id: 'send_email', name: 'Send Email' },
        { id: 'list_templates', name: 'List Templates' },
      ],
    }))

    const { providers, tools, relationships } = registryToThings(registry)

    // Check providers
    expect(providers).toHaveLength(1)
    expect(providers[0].$type).toBe('Provider')
    expect(providers[0].$id).toBe('provider:sendgrid')
    expect(providers[0].data.name).toBe('sendgrid')

    // Check tools
    expect(tools).toHaveLength(2)
    expect(tools[0].$type).toBe('Tool')
    expect(tools[0].data.provider).toBe('sendgrid')

    // Check relationships
    expect(relationships).toHaveLength(2)
    expect(relationships[0].verb).toBe('providedBy')
    expect(relationships[0].to).toBe('provider:sendgrid')
  })

  it('handles multiple providers', () => {
    const registry = new ProviderRegistry()
    registry.register(createMockAdapter({ name: 'provider1' }))
    registry.register(createMockAdapter({ name: 'provider2' }))

    const { providers } = registryToThings(registry)

    expect(providers).toHaveLength(2)
  })

  it('handles empty registry', () => {
    const registry = new ProviderRegistry()

    const { providers, tools, relationships } = registryToThings(registry)

    expect(providers).toEqual([])
    expect(tools).toEqual([])
    expect(relationships).toEqual([])
  })
})

// ============================================================================
// createTestRegistry TESTS
// ============================================================================

describe('createTestRegistry', () => {
  it('creates a new empty registry', () => {
    const registry = createTestRegistry()

    expect(registry).toBeInstanceOf(ProviderRegistry)
    expect(registry.getProviderNames()).toEqual([])
  })

  it('creates independent registries', () => {
    const registry1 = createTestRegistry()
    const registry2 = createTestRegistry()

    registry1.register(createMockAdapter({ name: 'test' }))

    expect(registry1.has('test')).toBe(true)
    expect(registry2.has('test')).toBe(false)
  })
})

// ============================================================================
// globalRegistry TESTS
// ============================================================================

describe('globalRegistry', () => {
  it('is a ProviderRegistry instance', () => {
    expect(globalRegistry).toBeInstanceOf(ProviderRegistry)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Auto-Registration Integration', () => {
  it('complete registration and execution flow', async () => {
    const registry = createTestRegistry()
    const handler = vi.fn().mockResolvedValue({ messageId: 'msg-123' })

    // Register provider
    const adapter = createProviderAdapter({
      name: 'email',
      displayName: 'Email Service',
      category: 'communication',
      credential: { type: 'api_key', envVar: 'EMAIL_API_KEY' },
      tools: [{
        id: 'send',
        name: 'Send Email',
        description: 'Send an email',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['to', 'body'],
        },
        handler,
        tags: ['email', 'send'],
      }],
    })

    registry.register(adapter)

    // Verify registration
    expect(registry.has('email')).toBe(true)

    // Get tools
    const tools = registry.getTools({ provider: 'email' })
    expect(tools).toHaveLength(1)
    expect(tools[0].tool.name).toBe('Send Email')

    // Execute tool
    const result = await registry.execute(
      'email',
      'send',
      { to: 'user@example.com', body: 'Hello!' },
      { apiKey: 'test-key' }
    )

    expect(result).toEqual({ messageId: 'msg-123' })
    expect(handler).toHaveBeenCalledWith(
      { to: 'user@example.com', body: 'Hello!' },
      { apiKey: 'test-key' },
      undefined
    )

    // Convert to Things
    const { providers, tools: toolThings, relationships } = registryToThings(registry)

    expect(providers).toHaveLength(1)
    expect(toolThings).toHaveLength(1)
    expect(relationships).toHaveLength(1)
  })
})
