/**
 * Tool-Thing Integration Tests
 *
 * Tests for the unified tool-thing module that bridges
 * agents/Tool.ts with the db/graph Things system.
 *
 * @see dotdo-vxnoy - [REFACTOR] Unify agents/Tool.ts with Tool Things
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import { tool } from './Tool'
import {
  // Core conversion functions
  toolToThing,
  thingToTool,
  // Handler registry
  registerHandler,
  getHandler,
  unregisterHandler,
  clearHandlerRegistry,
  getHandlerCount,
  // Persistent tool creation
  persistentTool,
  loadToolFromGraph,
  listToolsFromGraph,
  deleteToolFromGraph,
  // Registry class
  ToolThingRegistry,
  createToolThingRegistry,
  // Constants
  TOOL_TYPE_NAME,
  TOOL_TYPE_ID,
  // Types
  type ToolThingData,
} from './tool-thing'
import type { GraphStore, GraphThing } from '../db/graph/types'
import type { ToolContext } from './types'

// ============================================================================
// Mock Graph Store
// ============================================================================

function createMockGraphStore(): GraphStore & { things: Map<string, GraphThing> } {
  const things = new Map<string, GraphThing>()

  return {
    things,
    async createThing(input) {
      const thing: GraphThing = {
        id: input.id,
        typeId: input.typeId,
        typeName: input.typeName,
        data: input.data ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }
      things.set(input.id, thing)
      return thing
    },
    async getThing(id) {
      return things.get(id) ?? null
    },
    async getThingsByType(options) {
      let results = Array.from(things.values())
      if (options.typeName) {
        results = results.filter((t) => t.typeName === options.typeName)
      }
      if (options.typeId) {
        results = results.filter((t) => t.typeId === options.typeId)
      }
      if (options.offset) {
        results = results.slice(options.offset)
      }
      if (options.limit) {
        results = results.slice(0, options.limit)
      }
      return results
    },
    async updateThing(id, updates) {
      const existing = things.get(id)
      if (!existing) return null
      const updated: GraphThing = {
        ...existing,
        data: updates.data !== undefined ? updates.data : existing.data,
        updatedAt: Date.now(),
      }
      things.set(id, updated)
      return updated
    },
    async deleteThing(id) {
      const existing = things.get(id)
      if (!existing) return null
      const deleted: GraphThing = { ...existing, deletedAt: Date.now() }
      things.set(id, deleted)
      return deleted
    },
    // Relationships (not used in tool tests)
    async createRelationship() {
      throw new Error('Not implemented')
    },
    async queryRelationshipsFrom() {
      return []
    },
    async queryRelationshipsTo() {
      return []
    },
    async queryRelationshipsByVerb() {
      return []
    },
    async deleteRelationship() {
      return false
    },
  }
}

// ============================================================================
// Test Context Helper
// ============================================================================

function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  }
}

// ============================================================================
// Handler Registry Tests
// ============================================================================

describe('Handler Registry', () => {
  beforeEach(() => {
    clearHandlerRegistry()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('registers a handler and returns an ID', () => {
    const handler = vi.fn()
    const id = registerHandler('myTool', handler)

    expect(id).toMatch(/^handler:myTool:/)
    expect(getHandlerCount()).toBe(1)
  })

  it('retrieves a registered handler by ID', () => {
    const handler = vi.fn().mockResolvedValue('result')
    const id = registerHandler('myTool', handler)

    const retrieved = getHandler(id)
    expect(retrieved).toBe(handler)
  })

  it('returns undefined for unknown handler ID', () => {
    const retrieved = getHandler('handler:unknown:xyz')
    expect(retrieved).toBeUndefined()
  })

  it('unregisters a handler', () => {
    const handler = vi.fn()
    const id = registerHandler('myTool', handler)

    expect(getHandlerCount()).toBe(1)
    const removed = unregisterHandler(id)
    expect(removed).toBe(true)
    expect(getHandlerCount()).toBe(0)
    expect(getHandler(id)).toBeUndefined()
  })

  it('returns false when unregistering unknown handler', () => {
    const removed = unregisterHandler('handler:unknown:xyz')
    expect(removed).toBe(false)
  })

  it('clears all handlers', () => {
    registerHandler('tool1', vi.fn())
    registerHandler('tool2', vi.fn())
    registerHandler('tool3', vi.fn())

    expect(getHandlerCount()).toBe(3)
    clearHandlerRegistry()
    expect(getHandlerCount()).toBe(0)
  })
})

// ============================================================================
// toolToThing Tests
// ============================================================================

describe('toolToThing()', () => {
  beforeEach(() => {
    clearHandlerRegistry()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('converts a ToolDefinition to Thing input', () => {
    const weatherTool = tool({
      name: 'getWeather',
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => ({ temp: 22, location }),
    })

    const { thingInput, handlerId } = toolToThing(weatherTool)

    expect(thingInput.id).toBe('tool:getWeather')
    expect(thingInput.typeId).toBe(TOOL_TYPE_ID)
    expect(thingInput.typeName).toBe(TOOL_TYPE_NAME)

    const data = thingInput.data as ToolThingData
    expect(data.name).toBe('getWeather')
    expect(data.description).toBe('Get weather for a location')
    expect(data.inputSchema.type).toBe('object')
    expect(data.handlerId).toBe(handlerId)
  })

  it('registers the execute handler', () => {
    const executeFn = vi.fn().mockResolvedValue({ result: 'ok' })
    const myTool = tool({
      name: 'myTool',
      description: 'My tool',
      inputSchema: z.object({}),
      execute: executeFn,
    })

    const { handlerId } = toolToThing(myTool)

    const handler = getHandler(handlerId)
    expect(handler).toBe(executeFn)
  })

  it('converts Zod schema to JSON Schema', () => {
    const myTool = tool({
      name: 'myTool',
      description: 'My tool',
      inputSchema: z.object({
        name: z.string().describe('User name'),
        age: z.number().optional(),
      }),
      execute: async () => ({}),
    })

    const { thingInput } = toolToThing(myTool)
    const data = thingInput.data as ToolThingData

    expect(data.inputSchema.type).toBe('object')
    expect(data.inputSchema.properties?.name?.type).toBe('string')
    expect(data.inputSchema.properties?.name?.description).toBe('User name')
    expect(data.inputSchema.properties?.age?.type).toBe('number')
    expect(data.inputSchema.required).toContain('name')
    expect(data.inputSchema.required).not.toContain('age')
  })

  it('preserves optional properties', () => {
    const myTool = tool({
      name: 'myTool',
      description: 'My tool',
      inputSchema: z.object({}),
      execute: async () => ({}),
      interruptible: true,
      permission: 'confirm',
    })

    const { thingInput } = toolToThing(myTool)
    const data = thingInput.data as ToolThingData

    expect(data.interruptible).toBe(true)
    expect(data.permission).toBe('confirm')
  })

  it('handles JSON Schema input', () => {
    const myTool = tool({
      name: 'jsonTool',
      description: 'JSON Schema tool',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' },
        },
        required: ['input'],
      } as any,
      execute: async () => ({}),
    })

    const { thingInput } = toolToThing(myTool)
    const data = thingInput.data as ToolThingData

    expect(data.inputSchema.type).toBe('object')
    expect(data.inputSchema.properties?.input?.type).toBe('string')
  })
})

// ============================================================================
// thingToTool Tests
// ============================================================================

describe('thingToTool()', () => {
  beforeEach(() => {
    clearHandlerRegistry()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('converts a GraphThing back to ToolDefinition', async () => {
    // First create a tool and convert to thing
    const originalTool = tool({
      name: 'getWeather',
      description: 'Get weather',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ temp: 22, location }),
    })

    const { thingInput, handlerId } = toolToThing(originalTool)

    // Create a mock GraphThing
    const thing: GraphThing = {
      id: thingInput.id,
      typeId: thingInput.typeId,
      typeName: thingInput.typeName,
      data: thingInput.data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    // Convert back
    const reconstructedTool = thingToTool(thing)

    expect(reconstructedTool).not.toBeNull()
    expect(reconstructedTool!.name).toBe('getWeather')
    expect(reconstructedTool!.description).toBe('Get weather')
    expect(reconstructedTool!.execute).toBeDefined()

    // Verify execute works
    const result = await reconstructedTool!.execute({ location: 'SF' }, createToolContext())
    expect(result).toEqual({ temp: 22, location: 'SF' })
  })

  it('returns null for non-Tool Things', () => {
    const thing: GraphThing = {
      id: 'customer:alice',
      typeId: 1,
      typeName: 'Customer',
      data: { name: 'Alice' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const result = thingToTool(thing)
    expect(result).toBeNull()
  })

  it('returns null for Things with missing handler', () => {
    const thing: GraphThing = {
      id: 'tool:orphaned',
      typeId: TOOL_TYPE_ID,
      typeName: TOOL_TYPE_NAME,
      data: {
        name: 'orphaned',
        description: 'Orphaned tool',
        inputSchema: { type: 'object' },
        handlerId: 'handler:orphaned:missing',
      } as ToolThingData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const result = thingToTool(thing)
    expect(result).toBeNull()
  })

  it('returns null for Things with null data', () => {
    const thing: GraphThing = {
      id: 'tool:nodata',
      typeId: TOOL_TYPE_ID,
      typeName: TOOL_TYPE_NAME,
      data: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    }

    const result = thingToTool(thing)
    expect(result).toBeNull()
  })
})

// ============================================================================
// persistentTool Tests
// ============================================================================

describe('persistentTool()', () => {
  let store: ReturnType<typeof createMockGraphStore>

  beforeEach(() => {
    clearHandlerRegistry()
    store = createMockGraphStore()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('creates tool without store (in-memory only)', async () => {
    const myTool = await persistentTool({
      name: 'inMemoryTool',
      description: 'In-memory tool',
      inputSchema: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ echoed: input }),
    })

    expect(myTool.name).toBe('inMemoryTool')
    expect(myTool.description).toBe('In-memory tool')

    const result = await myTool.execute({ input: 'hello' }, createToolContext())
    expect(result).toEqual({ echoed: 'hello' })
  })

  it('creates tool and persists to graph store', async () => {
    const myTool = await persistentTool({
      name: 'persistedTool',
      description: 'Persisted tool',
      inputSchema: z.object({ value: z.number() }),
      execute: async ({ value }) => ({ doubled: value * 2 }),
      store,
    })

    expect(myTool.name).toBe('persistedTool')

    // Verify it was stored
    const thing = await store.getThing('tool:persistedTool')
    expect(thing).not.toBeNull()
    expect(thing!.typeName).toBe(TOOL_TYPE_NAME)

    const data = thing!.data as ToolThingData
    expect(data.name).toBe('persistedTool')
    expect(data.description).toBe('Persisted tool')
  })

  it('updates existing tool in graph store', async () => {
    // Create initial tool
    await persistentTool({
      name: 'updateMe',
      description: 'Initial description',
      inputSchema: z.object({}),
      execute: async () => ({ version: 1 }),
      store,
    })

    // Update with new description
    const updatedTool = await persistentTool({
      name: 'updateMe',
      description: 'Updated description',
      inputSchema: z.object({}),
      execute: async () => ({ version: 2 }),
      store,
    })

    expect(updatedTool.description).toBe('Updated description')

    // Verify store was updated
    const thing = await store.getThing('tool:updateMe')
    const data = thing!.data as ToolThingData
    expect(data.description).toBe('Updated description')
  })
})

// ============================================================================
// loadToolFromGraph Tests
// ============================================================================

describe('loadToolFromGraph()', () => {
  let store: ReturnType<typeof createMockGraphStore>

  beforeEach(() => {
    clearHandlerRegistry()
    store = createMockGraphStore()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('loads a tool from the graph store', async () => {
    // Create and persist a tool
    await persistentTool({
      name: 'loadedTool',
      description: 'Tool to load',
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => ({ squared: x * x }),
      store,
    })

    // Load it back
    const loaded = await loadToolFromGraph(store, 'loadedTool')

    expect(loaded).not.toBeNull()
    expect(loaded!.name).toBe('loadedTool')

    const result = await loaded!.execute({ x: 5 }, createToolContext())
    expect(result).toEqual({ squared: 25 })
  })

  it('returns null for non-existent tool', async () => {
    const loaded = await loadToolFromGraph(store, 'nonExistent')
    expect(loaded).toBeNull()
  })
})

// ============================================================================
// listToolsFromGraph Tests
// ============================================================================

describe('listToolsFromGraph()', () => {
  let store: ReturnType<typeof createMockGraphStore>

  beforeEach(() => {
    clearHandlerRegistry()
    store = createMockGraphStore()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('lists all tools from graph store', async () => {
    // Create multiple tools
    await persistentTool({
      name: 'tool1',
      description: 'First tool',
      inputSchema: z.object({}),
      execute: async () => ({}),
      store,
    })

    await persistentTool({
      name: 'tool2',
      description: 'Second tool',
      inputSchema: z.object({}),
      execute: async () => ({}),
      store,
    })

    await persistentTool({
      name: 'tool3',
      description: 'Third tool',
      inputSchema: z.object({}),
      execute: async () => ({}),
      store,
    })

    const tools = await listToolsFromGraph(store)

    expect(tools.length).toBe(3)
    expect(tools.map((t) => t.name).sort()).toEqual(['tool1', 'tool2', 'tool3'])
  })

  it('returns empty array when no tools', async () => {
    const tools = await listToolsFromGraph(store)
    expect(tools).toEqual([])
  })

  it('skips tools with missing handlers', async () => {
    // Create a tool
    await persistentTool({
      name: 'validTool',
      description: 'Valid tool',
      inputSchema: z.object({}),
      execute: async () => ({}),
      store,
    })

    // Manually add an orphaned tool thing (handler not registered)
    await store.createThing({
      id: 'tool:orphaned',
      typeId: TOOL_TYPE_ID,
      typeName: TOOL_TYPE_NAME,
      data: {
        name: 'orphaned',
        description: 'Orphaned',
        inputSchema: { type: 'object' },
        handlerId: 'handler:orphaned:missing',
      } as ToolThingData,
    })

    const tools = await listToolsFromGraph(store)

    // Should only return the valid tool
    expect(tools.length).toBe(1)
    expect(tools[0].name).toBe('validTool')
  })
})

// ============================================================================
// deleteToolFromGraph Tests
// ============================================================================

describe('deleteToolFromGraph()', () => {
  let store: ReturnType<typeof createMockGraphStore>

  beforeEach(() => {
    clearHandlerRegistry()
    store = createMockGraphStore()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  it('deletes a tool from the graph store', async () => {
    await persistentTool({
      name: 'deleteMe',
      description: 'Tool to delete',
      inputSchema: z.object({}),
      execute: async () => ({}),
      store,
    })

    const initialCount = getHandlerCount()

    const deleted = await deleteToolFromGraph(store, 'deleteMe')

    expect(deleted).toBe(true)

    // Handler should be unregistered
    expect(getHandlerCount()).toBe(initialCount - 1)

    // Thing should be soft-deleted
    const thing = await store.getThing('tool:deleteMe')
    expect(thing?.deletedAt).not.toBeNull()
  })

  it('returns false for non-existent tool', async () => {
    const deleted = await deleteToolFromGraph(store, 'nonExistent')
    expect(deleted).toBe(false)
  })
})

// ============================================================================
// ToolThingRegistry Tests
// ============================================================================

describe('ToolThingRegistry', () => {
  let store: ReturnType<typeof createMockGraphStore>

  beforeEach(() => {
    clearHandlerRegistry()
    store = createMockGraphStore()
  })

  afterEach(() => {
    clearHandlerRegistry()
  })

  describe('without graph store', () => {
    it('registers and retrieves tools in memory', async () => {
      const registry = createToolThingRegistry()

      const myTool = tool({
        name: 'memoryTool',
        description: 'Memory tool',
        inputSchema: z.object({}),
        execute: async () => ({ success: true }),
      })

      await registry.register(myTool)

      const retrieved = await registry.get('memoryTool')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('memoryTool')
    })

    it('lists all registered tools', async () => {
      const registry = createToolThingRegistry()

      await registry.register(
        tool({
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: z.object({}),
          execute: async () => ({}),
        })
      )

      await registry.register(
        tool({
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: z.object({}),
          execute: async () => ({}),
        })
      )

      const tools = await registry.list()
      expect(tools.length).toBe(2)
    })

    it('checks if tool exists', async () => {
      const registry = createToolThingRegistry()

      await registry.register(
        tool({
          name: 'exists',
          description: 'Exists',
          inputSchema: z.object({}),
          execute: async () => ({}),
        })
      )

      expect(await registry.has('exists')).toBe(true)
      expect(await registry.has('notExists')).toBe(false)
    })

    it('unregisters tools', async () => {
      const registry = createToolThingRegistry()

      await registry.register(
        tool({
          name: 'toRemove',
          description: 'To remove',
          inputSchema: z.object({}),
          execute: async () => ({}),
        })
      )

      expect(await registry.has('toRemove')).toBe(true)

      const removed = await registry.unregister('toRemove')
      expect(removed).toBe(true)
      expect(await registry.has('toRemove')).toBe(false)
    })
  })

  describe('with graph store', () => {
    it('persists tools to graph store by default', async () => {
      const registry = createToolThingRegistry(store)

      const myTool = tool({
        name: 'persistedTool',
        description: 'Persisted',
        inputSchema: z.object({}),
        execute: async () => ({}),
      })

      await registry.register(myTool)

      // Verify in graph store
      const thing = await store.getThing('tool:persistedTool')
      expect(thing).not.toBeNull()
    })

    it('retrieves tools from graph store', async () => {
      const registry = createToolThingRegistry(store)

      // Persist a tool directly
      await persistentTool({
        name: 'graphTool',
        description: 'From graph',
        inputSchema: z.object({}),
        execute: async () => ({ from: 'graph' }),
        store,
      })

      // Registry should find it
      const retrieved = await registry.get('graphTool')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('graphTool')
    })

    it('prefers in-memory tools over graph tools', async () => {
      const registry = createToolThingRegistry(store)

      // Register in-memory version
      await registry.register(
        tool({
          name: 'sameName',
          description: 'In-memory version',
          inputSchema: z.object({}),
          execute: async () => ({ source: 'memory' }),
        })
      )

      const retrieved = await registry.get('sameName')
      expect(retrieved!.description).toBe('In-memory version')
    })

    it('lists tools from both memory and graph', async () => {
      const registry = createToolThingRegistry(store)

      // Register in-memory tool
      await registry.register(
        tool({
          name: 'memoryOnly',
          description: 'Memory',
          inputSchema: z.object({}),
          execute: async () => ({}),
        }),
        { persist: false }
      )

      // Persist another tool directly to graph
      await persistentTool({
        name: 'graphOnly',
        description: 'Graph',
        inputSchema: z.object({}),
        execute: async () => ({}),
        store,
      })

      const tools = await registry.list()
      expect(tools.length).toBe(2)
      expect(tools.map((t) => t.name).sort()).toEqual(['graphOnly', 'memoryOnly'])
    })

    it('unregisters from both memory and graph', async () => {
      const registry = createToolThingRegistry(store)

      await registry.register(
        tool({
          name: 'removeFromBoth',
          description: 'Remove',
          inputSchema: z.object({}),
          execute: async () => ({}),
        })
      )

      await registry.unregister('removeFromBoth')

      // In-memory registry should be empty
      expect(registry.size).toBe(0)

      // Graph Thing should be soft-deleted
      const thing = await store.getThing('tool:removeFromBoth')
      expect(thing?.deletedAt).not.toBeNull()

      // Note: registry.has() may still return true because it checks the graph store
      // and our mock doesn't filter out soft-deleted Things in getThing().
      // In production, the GraphStore would filter soft-deleted Things.
    })
  })

  it('tracks size of in-memory tools', async () => {
    const registry = createToolThingRegistry()

    expect(registry.size).toBe(0)

    await registry.register(
      tool({
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: z.object({}),
        execute: async () => ({}),
      })
    )

    expect(registry.size).toBe(1)

    await registry.register(
      tool({
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: z.object({}),
        execute: async () => ({}),
      })
    )

    expect(registry.size).toBe(2)
  })
})

// ============================================================================
// Backward Compatibility Tests
// ============================================================================

describe('Backward Compatibility', () => {
  it('tool() function works unchanged', () => {
    const weatherTool = tool({
      name: 'getWeather',
      description: 'Get weather',
      inputSchema: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => ({ temp: 22, location }),
    })

    expect(weatherTool.name).toBe('getWeather')
    expect(weatherTool.execute).toBeInstanceOf(Function)
  })

  it('tool() with all options works unchanged', () => {
    const fullTool = tool({
      name: 'fullTool',
      description: 'Full options tool',
      inputSchema: z.object({ input: z.string() }),
      outputSchema: z.object({ output: z.string() }),
      execute: async ({ input }) => ({ output: input.toUpperCase() }),
      interruptible: true,
      permission: 'confirm',
    })

    expect(fullTool.interruptible).toBe(true)
    expect(fullTool.permission).toBe('confirm')
    expect(fullTool.outputSchema).toBeDefined()
  })

  it('tool execute function receives context', async () => {
    const contextTool = tool({
      name: 'contextTool',
      description: 'Uses context',
      inputSchema: z.object({}),
      execute: async (_, context) => ({
        agentId: context.agentId,
        sessionId: context.sessionId,
      }),
    })

    const result = await contextTool.execute(
      {},
      { agentId: 'agent-123', sessionId: 'session-456' }
    )

    expect(result).toEqual({
      agentId: 'agent-123',
      sessionId: 'session-456',
    })
  })
})
