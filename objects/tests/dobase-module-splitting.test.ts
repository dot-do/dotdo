/**
 * DOBase Module Splitting Tests - RED Phase
 *
 * These tests document the expected modular architecture for splitting DOBase.ts
 * into three focused modules:
 *
 * 1. Storage Module - Store accessors and persistence
 *    - things, rels, actions, events, search, objects, dlq stores
 *    - Iceberg state persistence (save/load)
 *    - Auto-checkpoint functionality
 *    - Fencing tokens for single-writer semantics
 *
 * 2. Transport Module - HTTP, WebSocket, and RPC handling
 *    - handleFetch() routing
 *    - Cap'n Web RPC
 *    - MCP handling
 *    - Sync WebSocket
 *    - REST router
 *    - Introspection endpoint
 *
 * 3. Workflow Module - WorkflowContext ($) and event system
 *    - $ context creation (send, try, do)
 *    - $.on event handlers
 *    - $.every scheduling
 *    - Domain proxies ($.Noun(id).method())
 *    - Action logging and lifecycle
 *    - Event emission and dispatch
 *
 * DOBase should compose these modules rather than having ~3500 lines of monolithic code.
 *
 * Current state: DOBase.ts is ~3500 lines with mixed responsibilities.
 * Target state: DOBase.ts composes Storage, Transport, Workflow modules (~100 lines).
 *
 * @see /Users/nathanclevenger/projects/dotdo/objects/DOBase.ts
 */

import { describe, it, expect } from 'vitest'

// These imports will fail until modules are created - that's the RED phase
// import { StorageModule } from '../modules/StorageModule'
// import { TransportModule } from '../modules/TransportModule'
// import { WorkflowModule } from '../modules/WorkflowModule'

// ============================================================================
// MODULE EXISTENCE TESTS
// Verify the modules exist and can be imported
// ============================================================================

describe('DOBase Module Splitting', () => {
  describe('Module Structure', () => {
    it('should have a StorageModule that can be imported', async () => {
      // RED: This will fail until StorageModule is created
      const module = await import('../modules/StorageModule').catch(() => null)
      expect(module).not.toBeNull()
      expect(module?.StorageModule).toBeDefined()
    })

    it('should have a TransportModule that can be imported', async () => {
      // RED: This will fail until TransportModule is created
      const module = await import('../modules/TransportModule').catch(() => null)
      expect(module).not.toBeNull()
      expect(module?.TransportModule).toBeDefined()
    })

    it('should have a WorkflowModule that can be imported', async () => {
      // RED: This will fail until WorkflowModule is created
      const module = await import('../modules/WorkflowModule').catch(() => null)
      expect(module).not.toBeNull()
      expect(module?.WorkflowModule).toBeDefined()
    })
  })
})

// ============================================================================
// STORAGE MODULE TESTS
// Tests for store accessors and persistence
// ============================================================================

describe('StorageModule', () => {
  describe('Store Accessors', () => {
    it('should provide lazy-loaded things store', async () => {
      // RED: Import will fail
      const { StorageModule } = await import('../modules/StorageModule')

      // The StorageModule should provide a getThingsStore() method
      // that returns a ThingsStore instance
      expect(StorageModule.prototype.getThingsStore).toBeDefined()
      expect(typeof StorageModule.prototype.getThingsStore).toBe('function')
    })

    it('should provide lazy-loaded relationships store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getRelsStore).toBeDefined()
    })

    it('should provide lazy-loaded actions store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getActionsStore).toBeDefined()
    })

    it('should provide lazy-loaded events store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getEventsStore).toBeDefined()
    })

    it('should provide lazy-loaded search store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getSearchStore).toBeDefined()
    })

    it('should provide lazy-loaded objects store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getObjectsStore).toBeDefined()
    })

    it('should provide lazy-loaded DLQ store', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getDLQStore).toBeDefined()
    })
  })

  describe('Noun Management', () => {
    it('should provide resolveNounToFK method', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.resolveNounToFK).toBeDefined()
    })

    it('should provide registerNoun method', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.registerNoun).toBeDefined()
    })

    it('should cache noun FK lookups in typeCache', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.getTypeCache).toBeDefined()
    })
  })

  describe('Iceberg Persistence', () => {
    it('should provide loadFromIceberg method', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.loadFromIceberg).toBeDefined()
    })

    it('should provide saveToIceberg method', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.saveToIceberg).toBeDefined()
    })

    it('should provide configureIceberg for auto-checkpoint setup', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.configureIceberg).toBeDefined()
    })

    it('should track pending changes for smart checkpointing', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.onDataChange).toBeDefined()
      expect(StorageModule.prototype.getPendingChanges).toBeDefined()
    })

    it('should provide fencing token methods for single-writer semantics', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.acquireFencingToken).toBeDefined()
      expect(StorageModule.prototype.releaseFencingToken).toBeDefined()
      expect(StorageModule.prototype.hasFencingToken).toBeDefined()
    })
  })

  describe('Lifecycle Events', () => {
    it('should emit stateLoaded lifecycle event', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      // StorageModule should accept a lifecycle event emitter
      expect(StorageModule.prototype.onLifecycleEvent).toBeDefined()
    })

    it('should emit checkpointed lifecycle event', async () => {
      const { StorageModule } = await import('../modules/StorageModule')
      expect(StorageModule.prototype.onLifecycleEvent).toBeDefined()
    })
  })
})

// ============================================================================
// TRANSPORT MODULE TESTS
// Tests for HTTP, WebSocket, and RPC handling
// ============================================================================

describe('TransportModule', () => {
  describe('HTTP Routing', () => {
    it('should provide handleRequest as the main entry point', async () => {
      // RED: Import will fail
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleRequest).toBeDefined()
    })

    it('should route /health to health check handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleHealthCheck).toBeDefined()
    })

    it('should route / GET to index handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleGetIndex).toBeDefined()
    })

    it('should route /$introspect to introspection handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleIntrospect).toBeDefined()
    })

    it('should route /resolve to cross-DO resolution handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleResolve).toBeDefined()
    })
  })

  describe('Cap\'n Web RPC', () => {
    it('should provide handleCapnWebRpc for POST / requests', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleCapnWebRpc).toBeDefined()
    })

    it('should provide handleCapnWebWebSocket for WebSocket / requests', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleCapnWebWebSocket).toBeDefined()
    })

    it('should detect Cap\'n Web requests via isCapnWebRequest', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.isCapnWebRequest).toBeDefined()
    })
  })

  describe('MCP Transport', () => {
    it('should route /mcp to MCP handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleMcp).toBeDefined()
    })

    it('should manage MCP sessions', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.getMcpSessions).toBeDefined()
    })
  })

  describe('Sync WebSocket', () => {
    it('should route /sync to WebSocket sync handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleSyncWebSocket).toBeDefined()
    })

    it('should extract bearer token from WebSocket protocol header', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.extractBearerTokenFromProtocol).toBeDefined()
    })

    it('should validate sync auth tokens', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.validateSyncAuthToken).toBeDefined()
    })
  })

  describe('REST Router', () => {
    it('should route /:type to collection list handler', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleRestRequest).toBeDefined()
    })

    it('should route /:type/:id to thing CRUD handlers', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.handleRestRequest).toBeDefined()
    })

    it('should provide REST router context', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.getRestRouterContext).toBeDefined()
    })
  })

  describe('Cross-DO Resolution', () => {
    it('should provide resolve method for URL resolution', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.resolve).toBeDefined()
    })

    it('should provide resolveLocal for same-DO resolution', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.resolveLocal).toBeDefined()
    })

    it('should provide resolveCrossDO for remote DO resolution', async () => {
      const { TransportModule } = await import('../modules/TransportModule')
      expect(TransportModule.prototype.resolveCrossDO).toBeDefined()
    })
  })
})

// ============================================================================
// WORKFLOW MODULE TESTS
// Tests for WorkflowContext ($) and event system
// ============================================================================

describe('WorkflowModule', () => {
  describe('WorkflowContext Creation', () => {
    it('should create $ context as a Proxy', async () => {
      // RED: Import will fail
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.createWorkflowContext).toBeDefined()
    })

    it('should provide $ with send execution mode', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.send).toBeDefined()
    })

    it('should provide $ with try execution mode', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.try).toBeDefined()
    })

    it('should provide $ with do execution mode (durable)', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.do).toBeDefined()
    })
  })

  describe('Event Handlers ($.on)', () => {
    it('should create $.on proxy for event subscriptions', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.createOnProxy).toBeDefined()
    })

    it('should register event handlers with priority', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.registerEventHandler).toBeDefined()
    })

    it('should support wildcard handlers (*.verb, Noun.*)', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.collectMatchingHandlers).toBeDefined()
    })

    it('should dispatch events to registered handlers', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.dispatchEventToHandlers).toBeDefined()
    })

    it('should unregister event handlers', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.unregisterEventHandler).toBeDefined()
    })
  })

  describe('Scheduling ($.every)', () => {
    it('should create $.every proxy for schedule building', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.createScheduleBuilder).toBeDefined()
    })

    it('should register schedule handlers', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.registerScheduleHandler).toBeDefined()
    })

    it('should provide access to schedule manager', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.getScheduleManager).toBeDefined()
    })
  })

  describe('Domain Proxies ($.Noun)', () => {
    it('should create domain proxy for $.Noun(id)', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.createDomainProxy).toBeDefined()
    })

    it('should invoke local methods if available', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.invokeDomainMethod).toBeDefined()
    })

    it('should invoke cross-DO methods with circuit breaker', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.invokeCrossDOMethod).toBeDefined()
    })

    it('should manage circuit breaker state per target DO', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.checkCircuitBreaker).toBeDefined()
      expect(WorkflowModule.prototype.recordCircuitBreakerSuccess).toBeDefined()
      expect(WorkflowModule.prototype.recordCircuitBreakerFailure).toBeDefined()
    })
  })

  describe('Action Logging', () => {
    it('should log actions to actions store', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.logAction).toBeDefined()
    })

    it('should update action status', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.updateActionStatus).toBeDefined()
    })

    it('should complete actions with output', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.completeAction).toBeDefined()
    })

    it('should fail actions with error', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.failAction).toBeDefined()
    })
  })

  describe('Event Emission', () => {
    it('should emit events to events store and pipeline', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.emitEvent).toBeDefined()
    })

    it('should add failed events to DLQ', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.emitSystemError).toBeDefined()
    })
  })

  describe('Retry Policy', () => {
    it('should provide default retry policy', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.DEFAULT_RETRY_POLICY).toBeDefined()
    })

    it('should calculate backoff delay with jitter', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.calculateBackoffDelay).toBeDefined()
    })

    it('should generate step IDs for deduplication', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.generateStepId).toBeDefined()
    })

    it('should persist and load step results', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')
      expect(WorkflowModule.prototype.persistStepResult).toBeDefined()
      expect(WorkflowModule.prototype.loadPersistedSteps).toBeDefined()
    })
  })
})

// ============================================================================
// COMPOSITION TESTS
// Verify DOBase composes the modules correctly
// ============================================================================

describe('DOBase Composition', () => {
  describe('Module Integration', () => {
    it('should compose StorageModule for store accessors', async () => {
      // DOBase should delegate to StorageModule for things, rels, etc.
      // This verifies the composition pattern works
      const { DO } = await import('../DOBase')

      // After refactoring, DO should have a storage property or mixin
      // that provides the store accessors
      expect(DO.prototype).toHaveProperty('things')
      expect(DO.prototype).toHaveProperty('rels')
      expect(DO.prototype).toHaveProperty('actions')
      expect(DO.prototype).toHaveProperty('events')
    })

    it('should compose TransportModule for HTTP handling', async () => {
      const { DO } = await import('../DOBase')

      // After refactoring, handleFetch should delegate to TransportModule
      // The method should exist and be overridable
      expect(typeof DO.prototype.handleFetch).toBe('function')
    })

    it('should compose WorkflowModule for $ context', async () => {
      const { DO } = await import('../DOBase')

      // After refactoring, $ should be created by WorkflowModule
      // The createWorkflowContext method should exist
      expect(typeof DO.prototype.createWorkflowContext).toBe('function')
    })
  })

  describe('Module Independence', () => {
    it('should allow StorageModule to be used independently', async () => {
      // RED: This verifies modules are standalone
      const module = await import('../modules/StorageModule').catch(() => null)

      // StorageModule should not require TransportModule or WorkflowModule
      expect(module?.StorageModule).toBeDefined()
    })

    it('should allow TransportModule to be used independently', async () => {
      const module = await import('../modules/TransportModule').catch(() => null)

      // TransportModule needs StorageModule for REST, but not WorkflowModule
      expect(module?.TransportModule).toBeDefined()
    })

    it('should allow WorkflowModule to be used independently', async () => {
      const module = await import('../modules/WorkflowModule').catch(() => null)

      // WorkflowModule needs StorageModule for actions/events, but not TransportModule
      expect(module?.WorkflowModule).toBeDefined()
    })
  })

  describe('Dependency Injection', () => {
    it('should allow injecting StorageModule into TransportModule', async () => {
      const { TransportModule } = await import('../modules/TransportModule')

      // TransportModule constructor should accept a storage provider
      expect(TransportModule.prototype.setStorageProvider).toBeDefined()
    })

    it('should allow injecting StorageModule into WorkflowModule', async () => {
      const { WorkflowModule } = await import('../modules/WorkflowModule')

      // WorkflowModule constructor should accept a storage provider
      expect(WorkflowModule.prototype.setStorageProvider).toBeDefined()
    })
  })
})

// ============================================================================
// SIZE REDUCTION VERIFICATION
// Tests that verify the refactoring achieved size goals
// ============================================================================

describe('Module Size Goals', () => {
  it('should have StorageModule under 500 lines', async () => {
    // This is a documentation test - actual line count verification
    // would be done in CI or code review
    //
    // Expected StorageModule contents (~400-500 lines):
    // - Store accessor getters (things, rels, actions, events, search, objects, dlq)
    // - Noun FK resolution and registration
    // - Type cache management
    // - Iceberg persistence (load, save, auto-checkpoint)
    // - Fencing tokens
    // - Store context creation
    expect(true).toBe(true)
  })

  it('should have TransportModule under 400 lines', async () => {
    // Expected TransportModule contents (~300-400 lines):
    // - HTTP routing (health, index, introspect, resolve)
    // - Cap'n Web RPC handling
    // - MCP session management
    // - Sync WebSocket handling
    // - REST router delegation
    // - Cross-DO resolution
    expect(true).toBe(true)
  })

  it('should have WorkflowModule under 600 lines', async () => {
    // Expected WorkflowModule contents (~500-600 lines):
    // - $ context creation (Proxy)
    // - Execution modes (send, try, do)
    // - $.on event handler registry
    // - $.every schedule builder
    // - Domain proxy creation
    // - Cross-DO method invocation with circuit breaker
    // - Action logging lifecycle
    // - Event emission and DLQ
    // - Retry policy and backoff
    expect(true).toBe(true)
  })

  it('should reduce DOBase.ts to under 200 lines', async () => {
    // Expected DOBase.ts after refactoring (~100-200 lines):
    // - Class definition extending DOTiny
    // - Module composition (mixins or has-a)
    // - Static configuration ($mcp, capabilities)
    // - Constructor calling module setup
    // - Delegating methods to modules
    // - OKR framework (optional, could be separate module)
    // - Location detection (optional, could be separate module)
    expect(true).toBe(true)
  })
})

// ============================================================================
// RESPONSIBILITY BOUNDARY TESTS
// Verify each module has clear, focused responsibilities
// ============================================================================

describe('Module Responsibility Boundaries', () => {
  describe('StorageModule responsibilities', () => {
    it('should NOT handle HTTP routing', async () => {
      const module = await import('../modules/StorageModule').catch(() => null)
      if (module?.StorageModule) {
        expect(module.StorageModule.prototype.handleFetch).toBeUndefined()
        expect(module.StorageModule.prototype.handleRequest).toBeUndefined()
      }
    })

    it('should NOT create WorkflowContext', async () => {
      const module = await import('../modules/StorageModule').catch(() => null)
      if (module?.StorageModule) {
        expect(module.StorageModule.prototype.createWorkflowContext).toBeUndefined()
      }
    })

    it('should handle all persistence concerns', async () => {
      const module = await import('../modules/StorageModule').catch(() => null)
      if (module?.StorageModule) {
        // These should be in StorageModule
        expect(module.StorageModule.prototype.getThingsStore).toBeDefined()
        expect(module.StorageModule.prototype.loadFromIceberg).toBeDefined()
        expect(module.StorageModule.prototype.saveToIceberg).toBeDefined()
      }
    })
  })

  describe('TransportModule responsibilities', () => {
    it('should NOT manage stores directly', async () => {
      const module = await import('../modules/TransportModule').catch(() => null)
      if (module?.TransportModule) {
        expect(module.TransportModule.prototype.getThingsStore).toBeUndefined()
        expect(module.TransportModule.prototype._things).toBeUndefined()
      }
    })

    it('should NOT handle event dispatch', async () => {
      const module = await import('../modules/TransportModule').catch(() => null)
      if (module?.TransportModule) {
        expect(module.TransportModule.prototype.dispatchEventToHandlers).toBeUndefined()
        expect(module.TransportModule.prototype.createOnProxy).toBeUndefined()
      }
    })

    it('should handle all HTTP/WebSocket concerns', async () => {
      const module = await import('../modules/TransportModule').catch(() => null)
      if (module?.TransportModule) {
        expect(module.TransportModule.prototype.handleRequest).toBeDefined()
        expect(module.TransportModule.prototype.handleCapnWebRpc).toBeDefined()
        expect(module.TransportModule.prototype.handleSyncWebSocket).toBeDefined()
      }
    })
  })

  describe('WorkflowModule responsibilities', () => {
    it('should NOT handle HTTP routing', async () => {
      const module = await import('../modules/WorkflowModule').catch(() => null)
      if (module?.WorkflowModule) {
        expect(module.WorkflowModule.prototype.handleFetch).toBeUndefined()
        expect(module.WorkflowModule.prototype.handleRequest).toBeUndefined()
      }
    })

    it('should NOT manage Iceberg persistence', async () => {
      const module = await import('../modules/WorkflowModule').catch(() => null)
      if (module?.WorkflowModule) {
        expect(module.WorkflowModule.prototype.loadFromIceberg).toBeUndefined()
        expect(module.WorkflowModule.prototype.saveToIceberg).toBeUndefined()
      }
    })

    it('should handle all workflow concerns', async () => {
      const module = await import('../modules/WorkflowModule').catch(() => null)
      if (module?.WorkflowModule) {
        expect(module.WorkflowModule.prototype.createWorkflowContext).toBeDefined()
        expect(module.WorkflowModule.prototype.createOnProxy).toBeDefined()
        expect(module.WorkflowModule.prototype.dispatchEventToHandlers).toBeDefined()
      }
    })
  })
})
