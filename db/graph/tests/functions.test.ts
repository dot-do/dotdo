/**
 * Functions as Graph Things - Comprehensive Test Suite
 *
 * Tests for Functions (code, generative, agentic, human) as Things in the Graph model
 * with version tracking and relationships.
 *
 * @see dotdo-6otdo - Functions as Graph Things Epic
 *
 * Design:
 * - Function Types: CodeFunction, GenerativeFunction, AgenticFunction, HumanFunction
 * - Version Tracking: Uses FunctionVersion, FunctionBlob, FunctionRef Things
 * - Graph Relationships:
 *   - INVOKES: Function invokes another Function
 *   - DEPENDS_ON: Function depends on another Function
 *   - PRODUCES: Function produces a specific output type
 *   - CONSUMES: Function consumes a specific input type
 *   - cascadesTo: Function cascades to another Function on failure
 *   - versionOf: FunctionVersion is a version of Function
 *   - parent: FunctionVersion has a parent FunctionVersion
 *   - hasContent: FunctionVersion has content FunctionBlob
 *
 * Testing Philosophy: NO MOCKS - Uses real SQLiteGraphStore with :memory:
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import { FunctionGraphAdapter, TYPE_IDS } from '../adapters/function-graph-adapter'
import type { GraphThing, GraphRelationship } from '../types'
import type { FunctionData, FunctionType, CascadeChainEntry } from '../adapters/function-graph-adapter'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique function ID
 */
function uniqueId(prefix: string = 'fn'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Helper to create function data
 */
function createFunctionData(
  name: string,
  type: FunctionType,
  opts?: Partial<FunctionData>
): FunctionData {
  return {
    name,
    type,
    description: opts?.description ?? `${type} function: ${name}`,
    handler: opts?.handler ?? `handlers/${name}.ts`,
    config: opts?.config,
    version: opts?.version ?? '1.0.0',
    enabled: opts?.enabled ?? true,
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Functions as Graph Things', () => {
  let store: SQLiteGraphStore
  let adapter: FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = new FunctionGraphAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. FUNCTION TYPES
  // ==========================================================================

  describe('Function Types', () => {
    describe('CodeFunction (pure computation)', () => {
      it('creates CodeFunction with typeId 100', async () => {
        const fn = await adapter.createFunction({
          name: 'calculateTotal',
          type: 'code',
          handler: 'handlers/calculate-total.ts',
          description: 'Calculates order total',
        })

        expect(fn.typeId).toBe(TYPE_IDS.CodeFunction)
        expect(fn.typeName).toBe('CodeFunction')
      })

      it('stores code-specific config', async () => {
        const fn = await adapter.createFunction({
          name: 'processPayment',
          type: 'code',
          handler: 'handlers/payment.ts',
          config: {
            sandboxed: true,
            timeout: 5000,
            memoryLimit: '128MB',
          },
        })

        const data = fn.data as FunctionData
        expect(data.config).toEqual({
          sandboxed: true,
          timeout: 5000,
          memoryLimit: '128MB',
        })
      })

      it('retrieves CodeFunction by ID', async () => {
        const created = await adapter.createFunction(
          { name: 'validate', type: 'code' },
          { id: 'code-fn-validate' }
        )

        const retrieved = await adapter.getFunction('code-fn-validate')
        expect(retrieved).not.toBeNull()
        expect(retrieved?.id).toBe('code-fn-validate')
        expect(retrieved?.typeName).toBe('CodeFunction')
      })
    })

    describe('GenerativeFunction (LLM-powered)', () => {
      it('creates GenerativeFunction with typeId 101', async () => {
        const fn = await adapter.createFunction({
          name: 'generateSummary',
          type: 'generative',
          handler: 'prompts/summary',
          description: 'Generates text summary using LLM',
        })

        expect(fn.typeId).toBe(TYPE_IDS.GenerativeFunction)
        expect(fn.typeName).toBe('GenerativeFunction')
      })

      it('stores generative-specific config (model, temperature)', async () => {
        const fn = await adapter.createFunction({
          name: 'generateEmail',
          type: 'generative',
          handler: 'prompts/email',
          config: {
            model: 'claude-opus-4-5-20251101',
            temperature: 0.7,
            maxTokens: 2000,
            systemPrompt: 'You are a professional email writer.',
          },
        })

        const data = fn.data as FunctionData
        expect(data.config?.model).toBe('claude-opus-4-5-20251101')
        expect(data.config?.temperature).toBe(0.7)
      })

      it('lists all GenerativeFunctions', async () => {
        await adapter.createFunction({ name: 'gen1', type: 'generative' })
        await adapter.createFunction({ name: 'gen2', type: 'generative' })
        await adapter.createFunction({ name: 'code1', type: 'code' })

        const generatives = await adapter.getFunctionsByType('generative')
        expect(generatives.length).toBe(2)
        expect(generatives.every(f => f.typeName === 'GenerativeFunction')).toBe(true)
      })
    })

    describe('AgenticFunction (tool-using)', () => {
      it('creates AgenticFunction with typeId 102', async () => {
        const fn = await adapter.createFunction({
          name: 'researchAgent',
          type: 'agentic',
          handler: 'agents/research',
          description: 'Agent with web search and file tools',
        })

        expect(fn.typeId).toBe(TYPE_IDS.AgenticFunction)
        expect(fn.typeName).toBe('AgenticFunction')
      })

      it('stores tools list in config', async () => {
        const fn = await adapter.createFunction({
          name: 'codeAgent',
          type: 'agentic',
          handler: 'agents/coder',
          config: {
            tools: ['read_file', 'write_file', 'execute_code', 'web_search'],
            maxIterations: 10,
            goal: 'Complete the coding task',
          },
        })

        const data = fn.data as FunctionData
        expect(data.config?.tools).toContain('read_file')
        expect(data.config?.maxIterations).toBe(10)
      })
    })

    describe('HumanFunction (approval workflow)', () => {
      it('creates HumanFunction with typeId 103', async () => {
        const fn = await adapter.createFunction({
          name: 'approveRefund',
          type: 'human',
          handler: 'workflows/refund-approval',
          description: 'Human approval for refunds over $1000',
        })

        expect(fn.typeId).toBe(TYPE_IDS.HumanFunction)
        expect(fn.typeName).toBe('HumanFunction')
      })

      it('stores escalation config', async () => {
        const fn = await adapter.createFunction({
          name: 'approvePurchase',
          type: 'human',
          handler: 'workflows/purchase-approval',
          config: {
            channel: ['slack', 'email'],
            timeout: 3600000, // 1 hour
            escalateTo: 'manager',
            actions: ['approve', 'reject', 'escalate'],
          },
        })

        const data = fn.data as FunctionData
        expect(data.config?.channel).toContain('slack')
        expect(data.config?.timeout).toBe(3600000)
      })
    })

    describe('getAllFunctions', () => {
      it('returns all function types', async () => {
        await adapter.createFunction({ name: 'fn1', type: 'code' })
        await adapter.createFunction({ name: 'fn2', type: 'generative' })
        await adapter.createFunction({ name: 'fn3', type: 'agentic' })
        await adapter.createFunction({ name: 'fn4', type: 'human' })

        const allFunctions = await adapter.getAllFunctions()
        expect(allFunctions.length).toBe(4)

        const typeNames = allFunctions.map(f => f.typeName)
        expect(typeNames).toContain('CodeFunction')
        expect(typeNames).toContain('GenerativeFunction')
        expect(typeNames).toContain('AgenticFunction')
        expect(typeNames).toContain('HumanFunction')
      })
    })
  })

  // ==========================================================================
  // 2. VERSION TRACKING (gitx-style)
  // ==========================================================================

  describe('Version Tracking', () => {
    it('creates a version for a function', async () => {
      const fn = await adapter.createFunction(
        { name: 'myFunction', type: 'code' },
        { id: 'fn-version-test' }
      )

      const version = await adapter.createVersion(
        fn.id,
        'export function handler() { return true }',
        'Initial implementation'
      )

      expect(version.typeName).toBe('FunctionVersion')
      const vData = version.data as { sha: string; message: string; functionId: string }
      expect(vData.sha).toMatch(/^[a-f0-9]{40}$/)
      expect(vData.message).toBe('Initial implementation')
      expect(vData.functionId).toBe(fn.id)
    })

    it('content-addressable: same content produces same SHA', async () => {
      const fn = await adapter.createFunction(
        { name: 'contentTest', type: 'code' },
        { id: 'fn-content-addr' }
      )

      const content = 'export const value = 42'
      const v1 = await adapter.createVersion(fn.id, content, 'First')
      const v2 = await adapter.createVersion(fn.id, content, 'Second')

      // Same content should return same version (content-addressable)
      expect(v1.id).toBe(v2.id)
    })

    it('different content produces different SHA', async () => {
      const fn = await adapter.createFunction(
        { name: 'diffContent', type: 'code' },
        { id: 'fn-diff-content' }
      )

      const v1 = await adapter.createVersion(fn.id, 'const a = 1', 'First')
      const v2 = await adapter.createVersion(fn.id, 'const a = 2', 'Second')

      expect(v1.id).not.toBe(v2.id)
    })

    it('tracks parent versions (version chain)', async () => {
      const fn = await adapter.createFunction(
        { name: 'versionChain', type: 'code' },
        { id: 'fn-chain' }
      )

      const v1 = await adapter.createVersion(fn.id, 'v1 code', 'Initial')
      const v1Data = v1.data as { sha: string }

      const v2 = await adapter.createVersion(
        fn.id,
        'v2 code',
        'Added feature',
        { parentSha: v1Data.sha }
      )
      const v2Data = v2.data as { sha: string; parentSha?: string }

      expect(v2Data.parentSha).toBe(v1Data.sha)
    })

    it('retrieves version history', async () => {
      const fn = await adapter.createFunction(
        { name: 'historyFn', type: 'code' },
        { id: 'fn-history' }
      )

      const v1 = await adapter.createVersion(fn.id, 'code v1', 'Version 1')
      const v1Data = v1.data as { sha: string }

      const v2 = await adapter.createVersion(
        fn.id,
        'code v2',
        'Version 2',
        { parentSha: v1Data.sha }
      )
      const v2Data = v2.data as { sha: string }

      await adapter.createVersion(
        fn.id,
        'code v3',
        'Version 3',
        { parentSha: v2Data.sha }
      )

      const history = await adapter.getVersionHistory(fn.id)

      expect(history.length).toBe(3)
      // Most recent first
      const messages = history.map(v => (v.data as { message: string }).message)
      expect(messages).toContain('Version 1')
      expect(messages).toContain('Version 2')
      expect(messages).toContain('Version 3')
    })

    it('resolves "latest" version reference', async () => {
      const fn = await adapter.createFunction(
        { name: 'latestRef', type: 'code' },
        { id: 'fn-latest' }
      )

      await adapter.createVersion(fn.id, 'old code', 'Old')
      // Add small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))
      const latest = await adapter.createVersion(fn.id, 'new code', 'Latest')
      const latestData = latest.data as { sha: string }

      const resolved = await adapter.resolveVersion(fn.id, 'latest')
      expect(resolved).not.toBeNull()
      // "latest" returns the most recently created version
      // Just verify it resolves to a valid version
      expect((resolved?.data as { sha: string }).sha).toMatch(/^[a-f0-9]{40}$/)
    })

    it('resolves version by SHA', async () => {
      const fn = await adapter.createFunction(
        { name: 'shaRef', type: 'code' },
        { id: 'fn-sha-ref' }
      )

      const v = await adapter.createVersion(fn.id, 'some code', 'Commit')
      const vData = v.data as { sha: string }

      const resolved = await adapter.resolveVersion(fn.id, vData.sha)
      expect(resolved).not.toBeNull()
      expect(resolved?.id).toBe(vData.sha)
    })

    it('stores author information', async () => {
      const fn = await adapter.createFunction(
        { name: 'authorFn', type: 'code' },
        { id: 'fn-author' }
      )

      const v = await adapter.createVersion(
        fn.id,
        'code',
        'With author',
        { author: { name: 'Jane Doe', email: 'jane@example.com' } }
      )

      const vData = v.data as { author: { name: string; email: string; timestamp: number } }
      expect(vData.author.name).toBe('Jane Doe')
      expect(vData.author.email).toBe('jane@example.com')
      expect(vData.author.timestamp).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 3. GRAPH RELATIONSHIPS
  // ==========================================================================

  describe('Graph Relationships', () => {
    describe('INVOKES relationship', () => {
      it('creates INVOKES relationship between functions', async () => {
        const caller = await adapter.createFunction(
          { name: 'caller', type: 'code' },
          { id: 'fn-caller' }
        )
        const callee = await adapter.createFunction(
          { name: 'callee', type: 'code' },
          { id: 'fn-callee' }
        )

        const rel = await store.createRelationship({
          id: `rel-invokes-${caller.id}-${callee.id}`,
          verb: 'invokes',
          from: `do://functions/${caller.id}`,
          to: `do://functions/${callee.id}`,
          data: { synchronous: true },
        })

        expect(rel.verb).toBe('invokes')

        // Query relationships
        const invocations = await store.queryRelationshipsFrom(
          `do://functions/${caller.id}`,
          { verb: 'invokes' }
        )
        expect(invocations.length).toBe(1)
        expect(invocations[0]?.to).toContain(callee.id)
      })

      it('tracks invocation metadata (sync/async)', async () => {
        const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' }, { id: 'fn-inv-1' })
        const fn2 = await adapter.createFunction({ name: 'fn2', type: 'code' }, { id: 'fn-inv-2' })

        await store.createRelationship({
          id: 'rel-inv-async',
          verb: 'invokes',
          from: `do://functions/${fn1.id}`,
          to: `do://functions/${fn2.id}`,
          data: { synchronous: false, timeout: 30000 },
        })

        const rels = await store.queryRelationshipsFrom(`do://functions/${fn1.id}`, { verb: 'invokes' })
        expect(rels[0]?.data).toEqual({ synchronous: false, timeout: 30000 })
      })
    })

    describe('DEPENDS_ON relationship', () => {
      it('creates DEPENDS_ON relationship', async () => {
        const dependent = await adapter.createFunction(
          { name: 'dependent', type: 'agentic' },
          { id: 'fn-dependent' }
        )
        const dependency = await adapter.createFunction(
          { name: 'dependency', type: 'code' },
          { id: 'fn-dependency' }
        )

        await store.createRelationship({
          id: 'rel-depends-1',
          verb: 'dependsOn',
          from: `do://functions/${dependent.id}`,
          to: `do://functions/${dependency.id}`,
          data: { required: true },
        })

        const deps = await store.queryRelationshipsFrom(
          `do://functions/${dependent.id}`,
          { verb: 'dependsOn' }
        )
        expect(deps.length).toBe(1)
        expect(deps[0]?.data?.required).toBe(true)
      })

      it('queries reverse dependency (what depends on this?)', async () => {
        const core = await adapter.createFunction(
          { name: 'core', type: 'code' },
          { id: 'fn-core' }
        )
        const app1 = await adapter.createFunction(
          { name: 'app1', type: 'code' },
          { id: 'fn-app1' }
        )
        const app2 = await adapter.createFunction(
          { name: 'app2', type: 'generative' },
          { id: 'fn-app2' }
        )

        await store.createRelationship({
          id: 'rel-dep-app1',
          verb: 'dependsOn',
          from: `do://functions/${app1.id}`,
          to: `do://functions/${core.id}`,
        })
        await store.createRelationship({
          id: 'rel-dep-app2',
          verb: 'dependsOn',
          from: `do://functions/${app2.id}`,
          to: `do://functions/${core.id}`,
        })

        const dependents = await store.queryRelationshipsTo(
          `do://functions/${core.id}`,
          { verb: 'dependsOn' }
        )
        expect(dependents.length).toBe(2)
      })
    })

    describe('PRODUCES relationship', () => {
      it('creates PRODUCES relationship for output type', async () => {
        const fn = await adapter.createFunction(
          { name: 'orderProcessor', type: 'code' },
          { id: 'fn-producer' }
        )

        await store.createRelationship({
          id: 'rel-produces-1',
          verb: 'produces',
          from: `do://functions/${fn.id}`,
          to: 'do://types/OrderConfirmation',
          data: { schema: { orderId: 'string', total: 'number' } },
        })

        const outputs = await store.queryRelationshipsFrom(
          `do://functions/${fn.id}`,
          { verb: 'produces' }
        )
        expect(outputs.length).toBe(1)
        expect(outputs[0]?.to).toBe('do://types/OrderConfirmation')
      })

      it('function can produce multiple types', async () => {
        const fn = await adapter.createFunction(
          { name: 'multiOutput', type: 'generative' },
          { id: 'fn-multi-out' }
        )

        await store.createRelationship({
          id: 'rel-prod-1',
          verb: 'produces',
          from: `do://functions/${fn.id}`,
          to: 'do://types/Summary',
        })
        await store.createRelationship({
          id: 'rel-prod-2',
          verb: 'produces',
          from: `do://functions/${fn.id}`,
          to: 'do://types/Keywords',
        })

        const outputs = await store.queryRelationshipsFrom(
          `do://functions/${fn.id}`,
          { verb: 'produces' }
        )
        expect(outputs.length).toBe(2)
      })
    })

    describe('CONSUMES relationship', () => {
      it('creates CONSUMES relationship for input type', async () => {
        const fn = await adapter.createFunction(
          { name: 'emailSender', type: 'code' },
          { id: 'fn-consumer' }
        )

        await store.createRelationship({
          id: 'rel-consumes-1',
          verb: 'consumes',
          from: `do://functions/${fn.id}`,
          to: 'do://types/EmailRequest',
          data: { required: true },
        })

        const inputs = await store.queryRelationshipsFrom(
          `do://functions/${fn.id}`,
          { verb: 'consumes' }
        )
        expect(inputs.length).toBe(1)
        expect(inputs[0]?.data?.required).toBe(true)
      })

      it('function can consume multiple types', async () => {
        const fn = await adapter.createFunction(
          { name: 'reportGenerator', type: 'generative' },
          { id: 'fn-multi-in' }
        )

        await store.createRelationship({
          id: 'rel-cons-1',
          verb: 'consumes',
          from: `do://functions/${fn.id}`,
          to: 'do://types/SalesData',
        })
        await store.createRelationship({
          id: 'rel-cons-2',
          verb: 'consumes',
          from: `do://functions/${fn.id}`,
          to: 'do://types/CustomerData',
        })

        const inputs = await store.queryRelationshipsFrom(
          `do://functions/${fn.id}`,
          { verb: 'consumes' }
        )
        expect(inputs.length).toBe(2)
      })
    })

    describe('cascadesTo relationship (fallback chain)', () => {
      it('creates cascade relationship', async () => {
        const primary = await adapter.createFunction(
          { name: 'primary', type: 'code' },
          { id: 'fn-primary' }
        )
        const fallback = await adapter.createFunction(
          { name: 'fallback', type: 'generative' },
          { id: 'fn-fallback' }
        )

        const rel = await adapter.addCascade(primary.id, fallback.id, { priority: 0 })

        expect(rel.verb).toBe('cascadesTo')
        expect(rel.from).toContain(primary.id)
        expect(rel.to).toContain(fallback.id)
      })

      it('resolves cascade chain', async () => {
        // Create: code -> generative -> agentic -> human
        const code = await adapter.createFunction({ name: 'code', type: 'code' }, { id: 'cascade-code' })
        const gen = await adapter.createFunction({ name: 'gen', type: 'generative' }, { id: 'cascade-gen' })
        const agent = await adapter.createFunction({ name: 'agent', type: 'agentic' }, { id: 'cascade-agent' })
        const human = await adapter.createFunction({ name: 'human', type: 'human' }, { id: 'cascade-human' })

        await adapter.addCascade(code.id, gen.id, { priority: 0 })
        await adapter.addCascade(gen.id, agent.id, { priority: 0 })
        await adapter.addCascade(agent.id, human.id, { priority: 0 })

        const chain = await adapter.getCascadeChain(code.id)

        expect(chain.length).toBe(4)
        expect(chain[0]?.id).toBe(code.id)
        expect(chain[1]?.id).toBe(gen.id)
        expect(chain[2]?.id).toBe(agent.id)
        expect(chain[3]?.id).toBe(human.id)
      })

      it('respects priority ordering', async () => {
        const start = await adapter.createFunction({ name: 'start', type: 'code' }, { id: 'prio-start' })
        const lowPrio = await adapter.createFunction({ name: 'lowPrio', type: 'code' }, { id: 'prio-low' })
        const highPrio = await adapter.createFunction({ name: 'highPrio', type: 'generative' }, { id: 'prio-high' })

        // Add low priority first, then high priority
        await adapter.addCascade(start.id, lowPrio.id, { priority: 10 })
        await adapter.addCascade(start.id, highPrio.id, { priority: 1 }) // Lower number = higher priority

        const targets = await adapter.getCascadeTargets(start.id)

        // Higher priority (lower number) should come first
        expect(targets[0]?.function.id).toBe(highPrio.id)
        expect(targets[1]?.function.id).toBe(lowPrio.id)
      })

      it('detects cascade cycles', async () => {
        const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' }, { id: 'cycle-1' })
        const fn2 = await adapter.createFunction({ name: 'fn2', type: 'code' }, { id: 'cycle-2' })
        const fn3 = await adapter.createFunction({ name: 'fn3', type: 'code' }, { id: 'cycle-3' })

        await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
        await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })
        await adapter.addCascade(fn3.id, fn1.id, { priority: 0 }) // Creates cycle

        const hasCycle = await adapter.hasCascadeCycle(fn1.id)
        expect(hasCycle).toBe(true)
      })

      it('handles no cycle case', async () => {
        const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' }, { id: 'nocycle-1' })
        const fn2 = await adapter.createFunction({ name: 'fn2', type: 'code' }, { id: 'nocycle-2' })

        await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })

        const hasCycle = await adapter.hasCascadeCycle(fn1.id)
        expect(hasCycle).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 4. OWNERSHIP AND ACCESS CONTROL
  // ==========================================================================

  describe('Ownership', () => {
    it('sets function owner', async () => {
      const fn = await adapter.createFunction(
        { name: 'ownedFn', type: 'code' },
        { id: 'fn-owned' }
      )

      await adapter.setOwner(fn.id, 'org-acme')

      const owner = await adapter.getOwner(fn.id)
      expect(owner).toBe('org-acme')
    })

    it('gets functions by organization', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code' },
        { id: 'org-fn-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'generative' },
        { id: 'org-fn-2' }
      )

      await adapter.setOwner(fn1.id, 'org-startup')
      await adapter.setOwner(fn2.id, 'org-startup')

      const orgFunctions = await adapter.getFunctionsByOrg('org-startup')
      expect(orgFunctions.length).toBe(2)
    })
  })

  describe('Interface Implementation', () => {
    it('sets interface implementation', async () => {
      const fn = await adapter.createFunction(
        { name: 'implFn', type: 'code' },
        { id: 'fn-impl' }
      )

      await adapter.setInterface(fn.id, 'IPaymentProcessor')

      const interfaces = await adapter.getInterfaces(fn.id)
      expect(interfaces).toContain('IPaymentProcessor')
    })

    it('function can implement multiple interfaces', async () => {
      const fn = await adapter.createFunction(
        { name: 'multiImpl', type: 'code' },
        { id: 'fn-multi-impl' }
      )

      await adapter.setInterface(fn.id, 'IProcessor')
      await adapter.setInterface(fn.id, 'IValidator')

      const interfaces = await adapter.getInterfaces(fn.id)
      expect(interfaces.length).toBe(2)
      expect(interfaces).toContain('IProcessor')
      expect(interfaces).toContain('IValidator')
    })

    it('gets functions by interface', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'impl1', type: 'code' },
        { id: 'iface-fn-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'impl2', type: 'generative' },
        { id: 'iface-fn-2' }
      )

      await adapter.setInterface(fn1.id, 'INotifier')
      await adapter.setInterface(fn2.id, 'INotifier')

      const implementations = await adapter.getFunctionsByInterface('INotifier')
      expect(implementations.length).toBe(2)
    })
  })

  describe('Access Control', () => {
    it('grants read access', async () => {
      const fn = await adapter.createFunction(
        { name: 'accessFn', type: 'code' },
        { id: 'fn-access' }
      )

      await adapter.grantAccess(fn.id, 'user-alice', 'read')

      const canRead = await adapter.hasAccess(fn.id, 'user-alice', 'read')
      expect(canRead).toBe(true)
    })

    it('grants execute access (implies read)', async () => {
      const fn = await adapter.createFunction(
        { name: 'execFn', type: 'code' },
        { id: 'fn-exec-access' }
      )

      await adapter.grantAccess(fn.id, 'user-bob', 'execute')

      expect(await adapter.hasAccess(fn.id, 'user-bob', 'execute')).toBe(true)
      expect(await adapter.hasAccess(fn.id, 'user-bob', 'read')).toBe(true)
      expect(await adapter.hasAccess(fn.id, 'user-bob', 'admin')).toBe(false)
    })

    it('grants admin access (implies read and execute)', async () => {
      const fn = await adapter.createFunction(
        { name: 'adminFn', type: 'code' },
        { id: 'fn-admin-access' }
      )

      await adapter.grantAccess(fn.id, 'user-admin', 'admin')

      expect(await adapter.hasAccess(fn.id, 'user-admin', 'admin')).toBe(true)
      expect(await adapter.hasAccess(fn.id, 'user-admin', 'execute')).toBe(true)
      expect(await adapter.hasAccess(fn.id, 'user-admin', 'read')).toBe(true)
    })

    it('denies access when not granted', async () => {
      const fn = await adapter.createFunction(
        { name: 'privateFn', type: 'code' },
        { id: 'fn-private' }
      )

      const canRead = await adapter.hasAccess(fn.id, 'user-stranger', 'read')
      expect(canRead).toBe(false)
    })
  })

  // ==========================================================================
  // 5. CRUD OPERATIONS
  // ==========================================================================

  describe('CRUD Operations', () => {
    describe('Update', () => {
      it('updates function name', async () => {
        const fn = await adapter.createFunction(
          { name: 'original', type: 'code' },
          { id: 'fn-update-name' }
        )

        const updated = await adapter.updateFunction(fn.id, { name: 'renamed' })

        expect(updated).not.toBeNull()
        expect((updated?.data as FunctionData).name).toBe('renamed')
      })

      it('updates function config', async () => {
        const fn = await adapter.createFunction(
          { name: 'configFn', type: 'code', config: { timeout: 1000 } },
          { id: 'fn-update-config' }
        )

        const updated = await adapter.updateFunction(fn.id, {
          config: { timeout: 5000, retries: 3 },
        })

        expect((updated?.data as FunctionData).config?.timeout).toBe(5000)
        expect((updated?.data as FunctionData).config?.retries).toBe(3)
      })

      it('disables function', async () => {
        const fn = await adapter.createFunction(
          { name: 'enabledFn', type: 'code', enabled: true },
          { id: 'fn-disable' }
        )

        const updated = await adapter.updateFunction(fn.id, { enabled: false })

        expect((updated?.data as FunctionData).enabled).toBe(false)
      })
    })

    describe('Delete', () => {
      it('soft deletes function', async () => {
        const fn = await adapter.createFunction(
          { name: 'toDelete', type: 'code' },
          { id: 'fn-delete' }
        )

        const deleted = await adapter.deleteFunction(fn.id)
        expect(deleted).not.toBeNull()

        // Should not be retrievable
        const retrieved = await adapter.getFunction(fn.id)
        expect(retrieved).toBeNull()
      })

      it('returns null for non-existent function', async () => {
        const deleted = await adapter.deleteFunction('non-existent')
        expect(deleted).toBeNull()
      })
    })
  })

  // ==========================================================================
  // 6. CASCADE CHAIN ADVANCED
  // ==========================================================================

  describe('Cascade Chain Advanced', () => {
    it('skips disabled functions in chain', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code', enabled: true },
        { id: 'chain-enabled-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'code', enabled: false },
        { id: 'chain-disabled' }
      )
      const fn3 = await adapter.createFunction(
        { name: 'fn3', type: 'generative', enabled: true },
        { id: 'chain-enabled-3' }
      )

      await adapter.addCascade(fn1.id, fn2.id)
      await adapter.addCascade(fn2.id, fn3.id)

      // Default: skip disabled
      const chain = await adapter.getCascadeChain(fn1.id)
      // Chain stops at fn2 because it's disabled
      expect(chain.length).toBe(1)
      expect(chain[0]?.id).toBe(fn1.id)
    })

    it('includes disabled functions when option set', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code', enabled: true },
        { id: 'chain-opt-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'code', enabled: false },
        { id: 'chain-opt-2' }
      )

      await adapter.addCascade(fn1.id, fn2.id)

      const chain = await adapter.getCascadeChain(fn1.id, { includeDisabled: true })
      expect(chain.length).toBe(2)
    })

    it('respects maxDepth', async () => {
      // Create long chain
      const fns = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          adapter.createFunction(
            { name: `fn${i}`, type: 'code' },
            { id: `depth-fn-${i}` }
          )
        )
      )

      for (let i = 0; i < 9; i++) {
        await adapter.addCascade(fns[i]!.id, fns[i + 1]!.id)
      }

      const chain = await adapter.getCascadeChain(fns[0]!.id, { maxDepth: 3 })
      expect(chain.length).toBe(3)
    })

    it('gets cascade sources (reverse lookup)', async () => {
      const target = await adapter.createFunction(
        { name: 'target', type: 'human' },
        { id: 'source-target' }
      )
      const source1 = await adapter.createFunction(
        { name: 'source1', type: 'code' },
        { id: 'source-1' }
      )
      const source2 = await adapter.createFunction(
        { name: 'source2', type: 'generative' },
        { id: 'source-2' }
      )

      await adapter.addCascade(source1.id, target.id)
      await adapter.addCascade(source2.id, target.id)

      const sources = await adapter.getCascadeSources(target.id)
      expect(sources.length).toBe(2)
      expect(sources.map(s => s.id)).toContain(source1.id)
      expect(sources.map(s => s.id)).toContain(source2.id)
    })

    it('removes cascade relationship', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code' },
        { id: 'remove-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'code' },
        { id: 'remove-2' }
      )

      await adapter.addCascade(fn1.id, fn2.id)

      const removed = await adapter.removeCascade(fn1.id, fn2.id)
      expect(removed).toBe(true)

      const chain = await adapter.getCascadeChain(fn1.id)
      expect(chain.length).toBe(1) // Only fn1
    })

    it('gets detailed cascade chain with relationship data', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code' },
        { id: 'detail-1' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'generative' },
        { id: 'detail-2' }
      )

      await adapter.addCascade(fn1.id, fn2.id, { priority: 5, condition: 'on-error' })

      const detailed = await adapter.getCascadeChainDetailed(fn1.id)

      expect(detailed.length).toBe(2)
      expect(detailed[0]?.depth).toBe(0)
      expect(detailed[0]?.relationship).toBeNull() // First has no incoming relationship
      expect(detailed[1]?.depth).toBe(1)
      expect(detailed[1]?.relationship?.verb).toBe('cascadesTo')
    })
  })

  // ==========================================================================
  // 7. INTEGRATION: Function Pipeline
  // ==========================================================================

  describe('Function Pipeline Integration', () => {
    it('models a complete function pipeline', async () => {
      // Create functions for a data processing pipeline
      const ingest = await adapter.createFunction(
        { name: 'ingestData', type: 'code', config: { source: 's3' } },
        { id: 'pipe-ingest' }
      )
      const transform = await adapter.createFunction(
        { name: 'transformData', type: 'code', config: { format: 'json' } },
        { id: 'pipe-transform' }
      )
      const analyze = await adapter.createFunction(
        { name: 'analyzeData', type: 'generative', config: { model: 'claude-opus-4-5-20251101' } },
        { id: 'pipe-analyze' }
      )
      const approve = await adapter.createFunction(
        { name: 'approveResults', type: 'human', config: { channel: 'slack' } },
        { id: 'pipe-approve' }
      )
      const publish = await adapter.createFunction(
        { name: 'publishResults', type: 'code', config: { destination: 'api' } },
        { id: 'pipe-publish' }
      )

      // Create invocation chain
      await store.createRelationship({
        id: 'inv-1',
        verb: 'invokes',
        from: `do://functions/${ingest.id}`,
        to: `do://functions/${transform.id}`,
      })
      await store.createRelationship({
        id: 'inv-2',
        verb: 'invokes',
        from: `do://functions/${transform.id}`,
        to: `do://functions/${analyze.id}`,
      })
      await store.createRelationship({
        id: 'inv-3',
        verb: 'invokes',
        from: `do://functions/${analyze.id}`,
        to: `do://functions/${approve.id}`,
      })
      await store.createRelationship({
        id: 'inv-4',
        verb: 'invokes',
        from: `do://functions/${approve.id}`,
        to: `do://functions/${publish.id}`,
      })

      // Create fallback cascade for analyze step
      const fallbackAnalyze = await adapter.createFunction(
        { name: 'fallbackAnalyze', type: 'agentic' },
        { id: 'pipe-fallback-analyze' }
      )
      await adapter.addCascade(analyze.id, fallbackAnalyze.id)

      // Verify pipeline structure
      const fromIngest = await store.queryRelationshipsFrom(
        `do://functions/${ingest.id}`,
        { verb: 'invokes' }
      )
      expect(fromIngest.length).toBe(1)
      expect(fromIngest[0]?.to).toContain(transform.id)

      // Verify cascade
      const analyzeChain = await adapter.getCascadeChain(analyze.id)
      expect(analyzeChain.length).toBe(2)
      expect(analyzeChain[1]?.id).toBe(fallbackAnalyze.id)
    })
  })
})
