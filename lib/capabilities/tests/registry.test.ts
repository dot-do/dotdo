/**
 * Tests for the Feature Capability Registry
 *
 * Tests the runtime feature discovery system for checking
 * what capabilities are available (vector-search, graph-store, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FeatureCapabilityRegistry,
  CapabilityRegistryError,
  featureRegistry,
  registerCapability,
  hasCapability,
  getCapabilities,
  getCapability,
  isCapabilityAvailable,
  WellKnownCapabilities,
  createWellKnownCapability,
  type Capability,
} from '../registry'

// ============================================================================
// FeatureCapabilityRegistry CLASS
// ============================================================================

describe('FeatureCapabilityRegistry', () => {
  let registry: FeatureCapabilityRegistry

  beforeEach(() => {
    registry = new FeatureCapabilityRegistry()
  })

  // --------------------------------------------------------------------------
  // registerCapability
  // --------------------------------------------------------------------------

  describe('registerCapability()', () => {
    it('registers a valid capability', () => {
      const cap: Capability = {
        name: 'vector-search',
        version: '1.0.0',
        description: 'Vector similarity search',
      }

      registry.registerCapability(cap)

      expect(registry.hasCapability('vector-search')).toBe(true)
    })

    it('sets default status to available', () => {
      registry.registerCapability({
        name: 'test-cap',
        version: '1.0.0',
      })

      const cap = registry.getCapability('test-cap')
      expect(cap?.status).toBe('available')
    })

    it('preserves explicit status', () => {
      registry.registerCapability({
        name: 'degraded-cap',
        version: '1.0.0',
        status: 'degraded',
      })

      const cap = registry.getCapability('degraded-cap')
      expect(cap?.status).toBe('degraded')
    })

    it('throws on duplicate registration', () => {
      registry.registerCapability({
        name: 'my-cap',
        version: '1.0.0',
      })

      expect(() =>
        registry.registerCapability({
          name: 'my-cap',
          version: '1.0.0',
        }),
      ).toThrow(CapabilityRegistryError)
    })

    it('allows duplicate with force option', () => {
      registry.registerCapability({
        name: 'my-cap',
        version: '1.0.0',
      })

      registry.registerCapability(
        {
          name: 'my-cap',
          version: '2.0.0',
        },
        { force: true },
      )

      const cap = registry.getCapability('my-cap')
      expect(cap?.version).toBe('2.0.0')
    })

    it('validates capability name is required', () => {
      expect(() =>
        registry.registerCapability({
          name: '',
          version: '1.0.0',
        }),
      ).toThrow(CapabilityRegistryError)
    })

    it('validates capability version is required', () => {
      expect(() =>
        registry.registerCapability({
          name: 'test',
          version: '',
        }),
      ).toThrow(CapabilityRegistryError)
    })

    it('validates name format (kebab-case)', () => {
      // Valid names
      expect(() =>
        registry.registerCapability({ name: 'a', version: '1.0.0' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'test', version: '1.0.0' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'vector-search', version: '1.0.0' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'my-long-capability-name', version: '1.0.0' }),
      ).not.toThrow()

      // Invalid names
      expect(() =>
        registry.registerCapability({ name: 'VectorSearch', version: '1.0.0' }),
      ).toThrow(CapabilityRegistryError)
      expect(() =>
        registry.registerCapability({ name: 'vector_search', version: '1.0.0' }),
      ).toThrow(CapabilityRegistryError)
      expect(() =>
        registry.registerCapability({ name: '-invalid', version: '1.0.0' }),
      ).toThrow(CapabilityRegistryError)
      expect(() =>
        registry.registerCapability({ name: 'invalid-', version: '1.0.0' }),
      ).toThrow(CapabilityRegistryError)
    })

    it('validates version format (semver)', () => {
      // Valid versions
      expect(() =>
        registry.registerCapability({ name: 'cap1', version: '1.0.0' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'cap2', version: '0.0.1' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'cap3', version: '10.20.30' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'cap4', version: '1.0.0-beta' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'cap5', version: '1.0.0-alpha.1' }),
      ).not.toThrow()
      expect(() =>
        registry.registerCapability({ name: 'cap6', version: '1.0.0+build.123' }),
      ).not.toThrow()

      // Invalid versions
      expect(() =>
        registry.registerCapability({ name: 'bad1', version: '1.0' }),
      ).toThrow(CapabilityRegistryError)
      expect(() =>
        registry.registerCapability({ name: 'bad2', version: 'v1.0.0' }),
      ).toThrow(CapabilityRegistryError)
      expect(() =>
        registry.registerCapability({ name: 'bad3', version: '1' }),
      ).toThrow(CapabilityRegistryError)
    })

    it('validates dependencies exist by default', () => {
      expect(() =>
        registry.registerCapability({
          name: 'dependent-cap',
          version: '1.0.0',
          dependencies: ['nonexistent'],
        }),
      ).toThrow(CapabilityRegistryError)
    })

    it('skips dependency validation when disabled', () => {
      expect(() =>
        registry.registerCapability(
          {
            name: 'dependent-cap',
            version: '1.0.0',
            dependencies: ['nonexistent'],
          },
          { validateDependencies: false },
        ),
      ).not.toThrow()
    })

    it('allows registration when dependencies exist', () => {
      registry.registerCapability({
        name: 'base-cap',
        version: '1.0.0',
      })

      expect(() =>
        registry.registerCapability({
          name: 'dependent-cap',
          version: '1.0.0',
          dependencies: ['base-cap'],
        }),
      ).not.toThrow()
    })

    it('stores metadata', () => {
      registry.registerCapability({
        name: 'meta-cap',
        version: '1.0.0',
        metadata: {
          provider: 'cloudflare',
          region: 'global',
        },
      })

      const cap = registry.getCapability('meta-cap')
      expect(cap?.metadata).toEqual({
        provider: 'cloudflare',
        region: 'global',
      })
    })
  })

  // --------------------------------------------------------------------------
  // unregisterCapability
  // --------------------------------------------------------------------------

  describe('unregisterCapability()', () => {
    it('removes a registered capability', () => {
      registry.registerCapability({
        name: 'remove-me',
        version: '1.0.0',
      })

      const result = registry.unregisterCapability('remove-me')

      expect(result).toBe(true)
      expect(registry.hasCapability('remove-me')).toBe(false)
    })

    it('returns false for non-existent capability', () => {
      const result = registry.unregisterCapability('nonexistent')
      expect(result).toBe(false)
    })

    it('cleans up dependents index', () => {
      registry.registerCapability({
        name: 'base',
        version: '1.0.0',
      })
      registry.registerCapability({
        name: 'dependent',
        version: '1.0.0',
        dependencies: ['base'],
      })

      expect(registry.getDependents('base')).toContain('dependent')

      registry.unregisterCapability('dependent')

      expect(registry.getDependents('base')).not.toContain('dependent')
    })
  })

  // --------------------------------------------------------------------------
  // hasCapability
  // --------------------------------------------------------------------------

  describe('hasCapability()', () => {
    it('returns true for registered capability', () => {
      registry.registerCapability({
        name: 'exists',
        version: '1.0.0',
      })

      expect(registry.hasCapability('exists')).toBe(true)
    })

    it('returns false for unregistered capability', () => {
      expect(registry.hasCapability('not-exists')).toBe(false)
    })

    it('returns true even for unavailable status', () => {
      registry.registerCapability({
        name: 'unavailable',
        version: '1.0.0',
        status: 'unavailable',
      })

      expect(registry.hasCapability('unavailable')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // isCapabilityAvailable
  // --------------------------------------------------------------------------

  describe('isCapabilityAvailable()', () => {
    it('returns true for available capability', () => {
      registry.registerCapability({
        name: 'available',
        version: '1.0.0',
        status: 'available',
      })

      expect(registry.isCapabilityAvailable('available')).toBe(true)
    })

    it('returns true for capability with default status', () => {
      registry.registerCapability({
        name: 'default-status',
        version: '1.0.0',
      })

      expect(registry.isCapabilityAvailable('default-status')).toBe(true)
    })

    it('returns false for degraded capability', () => {
      registry.registerCapability({
        name: 'degraded',
        version: '1.0.0',
        status: 'degraded',
      })

      expect(registry.isCapabilityAvailable('degraded')).toBe(false)
    })

    it('returns false for unavailable capability', () => {
      registry.registerCapability({
        name: 'unavailable',
        version: '1.0.0',
        status: 'unavailable',
      })

      expect(registry.isCapabilityAvailable('unavailable')).toBe(false)
    })

    it('returns false for unregistered capability', () => {
      expect(registry.isCapabilityAvailable('nonexistent')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // getCapability
  // --------------------------------------------------------------------------

  describe('getCapability()', () => {
    it('returns the capability if exists', () => {
      registry.registerCapability({
        name: 'get-me',
        version: '2.0.0',
        description: 'Test capability',
      })

      const cap = registry.getCapability('get-me')

      expect(cap).toBeDefined()
      expect(cap?.name).toBe('get-me')
      expect(cap?.version).toBe('2.0.0')
      expect(cap?.description).toBe('Test capability')
    })

    it('returns undefined if not exists', () => {
      const cap = registry.getCapability('not-there')
      expect(cap).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // getCapabilities
  // --------------------------------------------------------------------------

  describe('getCapabilities()', () => {
    beforeEach(() => {
      registry.registerCapability({
        name: 'vector-search',
        version: '1.0.0',
        status: 'available',
      })
      registry.registerCapability({
        name: 'graph-store',
        version: '1.0.0',
        status: 'degraded',
      })
      registry.registerCapability({
        name: 'workflow-runtime',
        version: '2.0.0',
        status: 'available',
        dependencies: ['vector-search'],
      })
      registry.registerCapability({
        name: 'analytics',
        version: '1.0.0',
        status: 'unavailable',
      })
    })

    it('returns all capabilities without filter', () => {
      const caps = registry.getCapabilities()
      expect(caps).toHaveLength(4)
    })

    it('filters by single status', () => {
      const caps = registry.getCapabilities({ status: 'available' })
      expect(caps).toHaveLength(2)
      expect(caps.map((c) => c.name)).toContain('vector-search')
      expect(caps.map((c) => c.name)).toContain('workflow-runtime')
    })

    it('filters by multiple statuses', () => {
      const caps = registry.getCapabilities({ status: ['available', 'degraded'] })
      expect(caps).toHaveLength(3)
    })

    it('filters by name string (includes match)', () => {
      const caps = registry.getCapabilities({ name: 'search' })
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe('vector-search')
    })

    it('filters by name regex', () => {
      const caps = registry.getCapabilities({ name: /-/ })
      expect(caps).toHaveLength(3) // vector-search, graph-store, workflow-runtime
    })

    it('filters by dependsOn', () => {
      const caps = registry.getCapabilities({ dependsOn: 'vector-search' })
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe('workflow-runtime')
    })

    it('combines multiple filters (AND logic)', () => {
      const caps = registry.getCapabilities({
        status: 'available',
        name: 'workflow',
      })
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe('workflow-runtime')
    })
  })

  // --------------------------------------------------------------------------
  // listCapabilities
  // --------------------------------------------------------------------------

  describe('listCapabilities()', () => {
    it('returns empty array when empty', () => {
      expect(registry.listCapabilities()).toEqual([])
    })

    it('returns all capability names', () => {
      registry.registerCapability({ name: 'cap1', version: '1.0.0' })
      registry.registerCapability({ name: 'cap2', version: '1.0.0' })
      registry.registerCapability({ name: 'cap3', version: '1.0.0' })

      const names = registry.listCapabilities()

      expect(names).toHaveLength(3)
      expect(names).toContain('cap1')
      expect(names).toContain('cap2')
      expect(names).toContain('cap3')
    })
  })

  // --------------------------------------------------------------------------
  // setCapabilityStatus
  // --------------------------------------------------------------------------

  describe('setCapabilityStatus()', () => {
    it('updates capability status', () => {
      registry.registerCapability({
        name: 'status-test',
        version: '1.0.0',
        status: 'available',
      })

      const result = registry.setCapabilityStatus('status-test', 'degraded')

      expect(result).toBe(true)
      expect(registry.getCapability('status-test')?.status).toBe('degraded')
    })

    it('returns false for non-existent capability', () => {
      const result = registry.setCapabilityStatus('nonexistent', 'available')
      expect(result).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // checkDependencies
  // --------------------------------------------------------------------------

  describe('checkDependencies()', () => {
    beforeEach(() => {
      registry.registerCapability({
        name: 'available-dep',
        version: '1.0.0',
        status: 'available',
      })
      registry.registerCapability({
        name: 'degraded-dep',
        version: '1.0.0',
        status: 'degraded',
      })
    })

    it('returns satisfied for met dependencies', () => {
      const result = registry.checkDependencies(['available-dep'])

      expect(result.satisfied).toBe(true)
      expect(result.missing).toEqual([])
      expect(result.degraded).toEqual([])
    })

    it('returns missing for unregistered dependencies', () => {
      const result = registry.checkDependencies(['available-dep', 'nonexistent'])

      expect(result.satisfied).toBe(false)
      expect(result.missing).toContain('nonexistent')
    })

    it('reports degraded dependencies', () => {
      const result = registry.checkDependencies(['available-dep', 'degraded-dep'])

      expect(result.satisfied).toBe(true) // satisfied means registered
      expect(result.degraded).toContain('degraded-dep')
    })

    it('handles empty dependency array', () => {
      const result = registry.checkDependencies([])

      expect(result.satisfied).toBe(true)
      expect(result.missing).toEqual([])
      expect(result.degraded).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // getDependents
  // --------------------------------------------------------------------------

  describe('getDependents()', () => {
    it('returns capabilities that depend on a given capability', () => {
      registry.registerCapability({
        name: 'base',
        version: '1.0.0',
      })
      registry.registerCapability({
        name: 'dep1',
        version: '1.0.0',
        dependencies: ['base'],
      })
      registry.registerCapability({
        name: 'dep2',
        version: '1.0.0',
        dependencies: ['base'],
      })
      registry.registerCapability({
        name: 'independent',
        version: '1.0.0',
      })

      const dependents = registry.getDependents('base')

      expect(dependents).toHaveLength(2)
      expect(dependents).toContain('dep1')
      expect(dependents).toContain('dep2')
    })

    it('returns empty array for capability with no dependents', () => {
      registry.registerCapability({
        name: 'lonely',
        version: '1.0.0',
      })

      const dependents = registry.getDependents('lonely')
      expect(dependents).toEqual([])
    })

    it('returns empty array for nonexistent capability', () => {
      const dependents = registry.getDependents('nonexistent')
      expect(dependents).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // clear
  // --------------------------------------------------------------------------

  describe('clear()', () => {
    it('removes all capabilities', () => {
      registry.registerCapability({ name: 'cap1', version: '1.0.0' })
      registry.registerCapability({ name: 'cap2', version: '1.0.0' })

      registry.clear()

      expect(registry.listCapabilities()).toEqual([])
      expect(registry.hasCapability('cap1')).toBe(false)
      expect(registry.hasCapability('cap2')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns stats for empty registry', () => {
      const stats = registry.getStats()

      expect(stats.total).toBe(0)
      expect(stats.byStatus.available).toBe(0)
      expect(stats.byStatus.degraded).toBe(0)
      expect(stats.byStatus.unavailable).toBe(0)
    })

    it('returns accurate stats', () => {
      registry.registerCapability({ name: 'a', version: '1.0.0', status: 'available' })
      registry.registerCapability({ name: 'b', version: '1.0.0', status: 'available' })
      registry.registerCapability({ name: 'c', version: '1.0.0', status: 'degraded' })
      registry.registerCapability({ name: 'd', version: '1.0.0', status: 'unavailable' })

      const stats = registry.getStats()

      expect(stats.total).toBe(4)
      expect(stats.byStatus.available).toBe(2)
      expect(stats.byStatus.degraded).toBe(1)
      expect(stats.byStatus.unavailable).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // toJSON / fromJSON
  // --------------------------------------------------------------------------

  describe('toJSON()', () => {
    it('exports registry to JSON', () => {
      registry.registerCapability({
        name: 'test-cap',
        version: '1.0.0',
        description: 'Test',
        status: 'available',
      })

      const json = registry.toJSON()

      expect(json.capabilities).toHaveLength(1)
      expect(json.capabilities[0]).toMatchObject({
        name: 'test-cap',
        version: '1.0.0',
        description: 'Test',
        status: 'available',
      })
    })
  })

  describe('fromJSON()', () => {
    it('imports capabilities from JSON', () => {
      const json = {
        capabilities: [
          { name: 'imported1', version: '1.0.0' },
          { name: 'imported2', version: '2.0.0' },
        ],
      }

      registry.fromJSON(json)

      expect(registry.hasCapability('imported1')).toBe(true)
      expect(registry.hasCapability('imported2')).toBe(true)
    })
  })
})

// ============================================================================
// CONVENIENCE FUNCTIONS (DEFAULT REGISTRY)
// ============================================================================

describe('Default registry convenience functions', () => {
  beforeEach(() => {
    featureRegistry.clear()
  })

  describe('registerCapability()', () => {
    it('registers to default registry', () => {
      registerCapability({
        name: 'global-cap',
        version: '1.0.0',
      })

      expect(featureRegistry.hasCapability('global-cap')).toBe(true)
    })
  })

  describe('hasCapability()', () => {
    it('checks default registry', () => {
      expect(hasCapability('nonexistent')).toBe(false)

      registerCapability({ name: 'exists', version: '1.0.0' })

      expect(hasCapability('exists')).toBe(true)
    })
  })

  describe('getCapabilities()', () => {
    it('gets from default registry', () => {
      registerCapability({ name: 'cap1', version: '1.0.0' })
      registerCapability({ name: 'cap2', version: '1.0.0' })

      const caps = getCapabilities()

      expect(caps).toHaveLength(2)
    })

    it('supports filtering', () => {
      registerCapability({ name: 'vector-search', version: '1.0.0' })
      registerCapability({ name: 'graph-store', version: '1.0.0' })

      const caps = getCapabilities({ name: 'vector' })

      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe('vector-search')
    })
  })

  describe('getCapability()', () => {
    it('gets from default registry', () => {
      registerCapability({
        name: 'my-cap',
        version: '1.0.0',
        description: 'My capability',
      })

      const cap = getCapability('my-cap')

      expect(cap?.description).toBe('My capability')
    })
  })

  describe('isCapabilityAvailable()', () => {
    it('checks availability in default registry', () => {
      registerCapability({ name: 'available', version: '1.0.0', status: 'available' })
      registerCapability({ name: 'degraded', version: '1.0.0', status: 'degraded' })

      expect(isCapabilityAvailable('available')).toBe(true)
      expect(isCapabilityAvailable('degraded')).toBe(false)
    })
  })
})

// ============================================================================
// WELL-KNOWN CAPABILITIES
// ============================================================================

describe('WellKnownCapabilities', () => {
  it('defines storage capabilities', () => {
    expect(WellKnownCapabilities.VECTOR_SEARCH).toBe('vector-search')
    expect(WellKnownCapabilities.GRAPH_STORE).toBe('graph-store')
    expect(WellKnownCapabilities.OBJECT_STORAGE).toBe('object-storage')
    expect(WellKnownCapabilities.KV_STORAGE).toBe('kv-storage')
  })

  it('defines runtime capabilities', () => {
    expect(WellKnownCapabilities.WORKFLOW_RUNTIME).toBe('workflow-runtime')
    expect(WellKnownCapabilities.AGENT_RUNTIME).toBe('agent-runtime')
    expect(WellKnownCapabilities.FUNCTION_RUNTIME).toBe('function-runtime')
  })

  it('defines AI capabilities', () => {
    expect(WellKnownCapabilities.AI_GATEWAY).toBe('ai-gateway')
    expect(WellKnownCapabilities.EMBEDDINGS).toBe('embeddings')
    expect(WellKnownCapabilities.LLM_INFERENCE).toBe('llm-inference')
  })

  it('defines platform capabilities', () => {
    expect(WellKnownCapabilities.DURABLE_OBJECTS).toBe('durable-objects')
    expect(WellKnownCapabilities.QUEUES).toBe('queues')
    expect(WellKnownCapabilities.CRON).toBe('cron')
    expect(WellKnownCapabilities.ANALYTICS).toBe('analytics')
  })

  it('defines extension capabilities', () => {
    expect(WellKnownCapabilities.BROWSER_RENDERING).toBe('browser-rendering')
    expect(WellKnownCapabilities.EMAIL_SENDING).toBe('email-sending')
    expect(WellKnownCapabilities.SMS_SENDING).toBe('sms-sending')
  })
})

describe('createWellKnownCapability()', () => {
  it('creates a well-known capability with name and version', () => {
    const cap = createWellKnownCapability(WellKnownCapabilities.VECTOR_SEARCH, '1.0.0')

    expect(cap.name).toBe('vector-search')
    expect(cap.version).toBe('1.0.0')
  })

  it('accepts optional fields', () => {
    const cap = createWellKnownCapability(WellKnownCapabilities.GRAPH_STORE, '2.0.0', {
      description: 'Graph database storage',
      status: 'degraded',
      dependencies: ['object-storage'],
    })

    expect(cap.name).toBe('graph-store')
    expect(cap.version).toBe('2.0.0')
    expect(cap.description).toBe('Graph database storage')
    expect(cap.status).toBe('degraded')
    expect(cap.dependencies).toEqual(['object-storage'])
  })
})

// ============================================================================
// CapabilityRegistryError
// ============================================================================

describe('CapabilityRegistryError', () => {
  it('has correct name', () => {
    const error = new CapabilityRegistryError('test', 'not_found')
    expect(error.name).toBe('CapabilityRegistryError')
  })

  it('includes capability name and reason', () => {
    const error = new CapabilityRegistryError('my-cap', 'not_found')
    expect(error.capability).toBe('my-cap')
    expect(error.reason).toBe('not_found')
  })

  it('generates default message for already_exists', () => {
    const error = new CapabilityRegistryError('dupe', 'already_exists')
    expect(error.message).toContain('already registered')
  })

  it('generates default message for not_found', () => {
    const error = new CapabilityRegistryError('missing', 'not_found')
    expect(error.message).toContain('not registered')
  })

  it('generates default message for dependency_missing', () => {
    const error = new CapabilityRegistryError('dep', 'dependency_missing')
    expect(error.message).toContain('missing dependencies')
  })

  it('generates default message for invalid', () => {
    const error = new CapabilityRegistryError('bad', 'invalid')
    expect(error.message).toContain('Invalid')
  })

  it('uses custom message when provided', () => {
    const error = new CapabilityRegistryError('test', 'invalid', 'Custom error message')
    expect(error.message).toBe('Custom error message')
  })
})

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('Integration scenarios', () => {
  let registry: FeatureCapabilityRegistry

  beforeEach(() => {
    registry = new FeatureCapabilityRegistry()
  })

  describe('Platform capability chain', () => {
    it('sets up a realistic capability dependency chain', () => {
      // Register base platform capabilities
      registry.registerCapability({
        name: 'durable-objects',
        version: '1.0.0',
        description: 'Cloudflare Durable Objects runtime',
      })

      registry.registerCapability({
        name: 'kv-storage',
        version: '1.0.0',
        description: 'Cloudflare KV storage',
      })

      registry.registerCapability({
        name: 'r2-storage',
        version: '1.0.0',
        description: 'Cloudflare R2 object storage',
      })

      // Register capabilities that depend on base
      registry.registerCapability({
        name: 'vector-search',
        version: '1.0.0',
        description: 'Vector similarity search via Vectorize',
        dependencies: ['durable-objects'],
      })

      registry.registerCapability({
        name: 'workflow-runtime',
        version: '1.0.0',
        description: 'Workflow execution engine',
        dependencies: ['durable-objects', 'kv-storage'],
      })

      // Register high-level capabilities
      registry.registerCapability({
        name: 'agent-runtime',
        version: '1.0.0',
        description: 'AI agent execution environment',
        dependencies: ['workflow-runtime', 'vector-search'],
      })

      // Verify chain
      expect(registry.listCapabilities()).toHaveLength(6)
      expect(registry.getDependents('durable-objects')).toContain('vector-search')
      expect(registry.getDependents('durable-objects')).toContain('workflow-runtime')
      expect(registry.getDependents('workflow-runtime')).toContain('agent-runtime')
    })
  })

  describe('Runtime feature discovery', () => {
    it('allows conditional feature usage', () => {
      // Simulate platform initialization
      registry.registerCapability({
        name: 'vector-search',
        version: '1.0.0',
        status: 'available',
      })

      registry.registerCapability({
        name: 'browser-rendering',
        version: '1.0.0',
        status: 'unavailable', // Not enabled in this environment
      })

      // Application code would check like this:
      const useVectorSearch = registry.isCapabilityAvailable('vector-search')
      const useBrowserRendering = registry.isCapabilityAvailable('browser-rendering')

      expect(useVectorSearch).toBe(true)
      expect(useBrowserRendering).toBe(false)
    })
  })

  describe('Graceful degradation', () => {
    it('handles status changes for degraded services', () => {
      registry.registerCapability({
        name: 'ai-gateway',
        version: '1.0.0',
        status: 'available',
      })

      // Service becomes degraded
      registry.setCapabilityStatus('ai-gateway', 'degraded')

      const cap = registry.getCapability('ai-gateway')
      expect(cap?.status).toBe('degraded')

      // Can still check if registered vs fully available
      expect(registry.hasCapability('ai-gateway')).toBe(true)
      expect(registry.isCapabilityAvailable('ai-gateway')).toBe(false)
    })
  })
})
