/**
 * Function Thing CRUD - Graph Storage Tests
 *
 * TDD RED phase: Failing tests for storing Functions (Code, Generative, Agentic, Human)
 * as Things in the graph data model.
 *
 * @see dotdo-781z5 - [RED] Function Thing CRUD - Graph Storage Tests
 *
 * Design:
 * - Functions are stored as Things with typeName based on their kind:
 *   - CodeFunction
 *   - GenerativeFunction
 *   - AgenticFunction
 *   - HumanFunction
 * - Function metadata stored in Thing.data
 * - Uses real SQLite via SQLiteGraphStore - NO MOCKS
 *
 * Function Types Reference (from lib/executors/BaseFunctionExecutor.ts):
 * - FunctionType = 'code' | 'generative' | 'agentic' | 'human'
 *
 * Data Structure:
 * - Common fields: name, description, timeout, retries
 * - Code: handler reference, sandboxed config
 * - Generative: model, temperature, maxTokens, prompt template
 * - Agentic: tools list, goal, systemPrompt, maxIterations
 * - Human: channel config, form schema, actions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphThing } from '../types'

// ============================================================================
// TYPE DEFINITIONS - Expected Function Thing Data Structures
// ============================================================================

/**
 * Base function data common to all function types
 */
interface BaseFunctionData {
  name: string
  description?: string
  timeout?: number
  retries?: {
    maxAttempts: number
    delay: number
    backoff?: 'fixed' | 'exponential' | 'exponential-jitter' | 'linear'
    maxDelay?: number
  }
  kind: 'code' | 'generative' | 'agentic' | 'human'
  createdBy?: string
  version?: string
}

/**
 * Code Function specific data
 */
interface CodeFunctionData extends BaseFunctionData {
  kind: 'code'
  handlerRef: string // Reference to handler code (e.g., 'r2://functions/handler-sha256')
  sandboxed?: boolean
  exposeEnv?: string[]
  resourceLimits?: {
    maxMemory?: number
    maxCpuTime?: number
    maxOutputSize?: number
  }
}

/**
 * Generative Function specific data
 */
interface GenerativeFunctionData extends BaseFunctionData {
  kind: 'generative'
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  promptTemplate?: string
  systemPrompt?: string
  schema?: Record<string, unknown>
  stopSequences?: string[]
}

/**
 * Agentic Function specific data
 */
interface AgenticFunctionData extends BaseFunctionData {
  kind: 'agentic'
  model: string
  tools: string[] // Tool references
  goal: string
  systemPrompt?: string
  maxIterations?: number
  temperature?: number
  maxTokens?: number
}

/**
 * Human Function specific data
 */
interface HumanFunctionData extends BaseFunctionData {
  kind: 'human'
  channel: string | string[]
  promptTemplate: string
  actions?: Array<string | { value: string; label: string; style?: 'primary' | 'danger' | 'default' }>
  form?: {
    fields: Array<{
      name: string
      type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
      label: string
      required?: boolean
      options?: string[]
      default?: unknown
    }>
  }
  escalation?: {
    timeout: number
    to: string
  }
  defaultOnTimeout?: {
    action: string
    reason: string
  }
}

/**
 * Union type for all function data types
 */
type FunctionData = CodeFunctionData | GenerativeFunctionData | AgenticFunctionData | HumanFunctionData

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Type ID constants for function types
 */
const TYPE_IDS = {
  CodeFunction: 100,
  GenerativeFunction: 101,
  AgenticFunction: 102,
  HumanFunction: 103,
}

/**
 * Generate a unique function ID
 */
function generateFunctionId(kind: string, name: string): string {
  return `fn-${kind}-${name}-${Date.now()}`
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Function as Graph Thing', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. CODE FUNCTION TESTS
  // ==========================================================================

  describe('Code Function', () => {
    it('creates CodeFunction Thing with correct type', async () => {
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'processOrder',
        description: 'Process incoming orders',
        handlerRef: 'r2://functions/process-order-abc123',
        sandboxed: true,
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'processOrder'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      expect(fn).toBeDefined()
      expect(fn.typeName).toBe('CodeFunction')
      expect(fn.typeId).toBe(TYPE_IDS.CodeFunction)
    })

    it('stores handler reference in data', async () => {
      const handlerRef = 'r2://functions/handler-sha256-abc123def456'
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'validatePayment',
        handlerRef,
        sandboxed: true,
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'validatePayment'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      const data = fn.data as CodeFunctionData
      expect(data.handlerRef).toBe(handlerRef)
      expect(data.kind).toBe('code')
    })

    it('stores sandbox config in data', async () => {
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'sandboxedFunction',
        handlerRef: 'r2://functions/sandboxed-handler',
        sandboxed: true,
        exposeEnv: ['DATABASE_URL', 'API_KEY'],
        resourceLimits: {
          maxMemory: 128 * 1024 * 1024, // 128MB
          maxCpuTime: 5000, // 5 seconds
          maxOutputSize: 10 * 1024 * 1024, // 10MB
        },
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'sandboxedFunction'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      const data = fn.data as CodeFunctionData
      expect(data.sandboxed).toBe(true)
      expect(data.exposeEnv).toEqual(['DATABASE_URL', 'API_KEY'])
      expect(data.resourceLimits?.maxMemory).toBe(128 * 1024 * 1024)
      expect(data.resourceLimits?.maxCpuTime).toBe(5000)
    })

    it('stores retry configuration in data', async () => {
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'retryableFunction',
        handlerRef: 'r2://functions/retryable',
        retries: {
          maxAttempts: 3,
          delay: 1000,
          backoff: 'exponential',
          maxDelay: 10000,
        },
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'retryableFunction'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      const data = fn.data as CodeFunctionData
      expect(data.retries?.maxAttempts).toBe(3)
      expect(data.retries?.delay).toBe(1000)
      expect(data.retries?.backoff).toBe('exponential')
      expect(data.retries?.maxDelay).toBe(10000)
    })

    it('stores timeout configuration in data', async () => {
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'timeoutFunction',
        handlerRef: 'r2://functions/timeout',
        timeout: 30000, // 30 seconds
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'timeoutFunction'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      const data = fn.data as CodeFunctionData
      expect(data.timeout).toBe(30000)
    })
  })

  // ==========================================================================
  // 2. GENERATIVE FUNCTION TESTS
  // ==========================================================================

  describe('Generative Function', () => {
    it('creates GenerativeFunction Thing with correct type', async () => {
      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'generateSummary',
        description: 'Generate text summaries using LLM',
        model: 'claude-sonnet-4-20250514',
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'generateSummary'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      expect(fn).toBeDefined()
      expect(fn.typeName).toBe('GenerativeFunction')
      expect(fn.typeId).toBe(TYPE_IDS.GenerativeFunction)
    })

    it('stores model config (model, temperature, maxTokens)', async () => {
      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'creativeWriter',
        model: 'claude-opus-4-20250514',
        temperature: 0.9,
        maxTokens: 4096,
        topP: 0.95,
        topK: 40,
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'creativeWriter'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      const data = fn.data as GenerativeFunctionData
      expect(data.model).toBe('claude-opus-4-20250514')
      expect(data.temperature).toBe(0.9)
      expect(data.maxTokens).toBe(4096)
      expect(data.topP).toBe(0.95)
      expect(data.topK).toBe(40)
    })

    it('stores prompt template in data', async () => {
      const promptTemplate = `You are a helpful assistant.
Given the following input: {{input}}
Please provide a detailed analysis.`

      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'analyzer',
        model: 'claude-sonnet-4-20250514',
        promptTemplate,
        systemPrompt: 'You are an expert data analyst.',
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'analyzer'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      const data = fn.data as GenerativeFunctionData
      expect(data.promptTemplate).toBe(promptTemplate)
      expect(data.systemPrompt).toBe('You are an expert data analyst.')
    })

    it('stores output schema in data', async () => {
      const schema = {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          keyPoints: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        },
        required: ['summary', 'keyPoints'],
      }

      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'structuredOutput',
        model: 'claude-sonnet-4-20250514',
        schema,
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'structuredOutput'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      const data = fn.data as GenerativeFunctionData
      expect(data.schema).toEqual(schema)
    })

    it('stores stop sequences in data', async () => {
      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'stopSequenceFunction',
        model: 'claude-sonnet-4-20250514',
        stopSequences: ['END', '---', '\n\n\n'],
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'stopSequenceFunction'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      const data = fn.data as GenerativeFunctionData
      expect(data.stopSequences).toEqual(['END', '---', '\n\n\n'])
    })
  })

  // ==========================================================================
  // 3. AGENTIC FUNCTION TESTS
  // ==========================================================================

  describe('Agentic Function', () => {
    it('creates AgenticFunction Thing with correct type', async () => {
      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'researchAgent',
        description: 'AI agent for research tasks',
        model: 'claude-opus-4-20250514',
        tools: ['web_search', 'calculator', 'file_reader'],
        goal: 'Research and summarize information on a given topic',
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'researchAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      expect(fn).toBeDefined()
      expect(fn.typeName).toBe('AgenticFunction')
      expect(fn.typeId).toBe(TYPE_IDS.AgenticFunction)
    })

    it('stores tools list in data', async () => {
      const tools = [
        'do://tools/web-search',
        'do://tools/database-query',
        'do://tools/email-sender',
        'do://tools/slack-notifier',
      ]

      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'multiToolAgent',
        model: 'claude-sonnet-4-20250514',
        tools,
        goal: 'Perform multi-step automated tasks',
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'multiToolAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      const data = fn.data as AgenticFunctionData
      expect(data.tools).toEqual(tools)
      expect(data.tools.length).toBe(4)
    })

    it('stores goal and system prompt', async () => {
      const goal = 'Analyze customer feedback and generate actionable insights'
      const systemPrompt = `You are a customer insights analyst AI.
Your job is to:
1. Analyze sentiment
2. Identify key themes
3. Generate recommendations`

      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'insightsAgent',
        model: 'claude-sonnet-4-20250514',
        tools: ['sentiment_analyzer', 'theme_extractor'],
        goal,
        systemPrompt,
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'insightsAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      const data = fn.data as AgenticFunctionData
      expect(data.goal).toBe(goal)
      expect(data.systemPrompt).toBe(systemPrompt)
    })

    it('stores maxIterations in data', async () => {
      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'iterativeAgent',
        model: 'claude-sonnet-4-20250514',
        tools: ['calculator'],
        goal: 'Solve complex math problems step by step',
        maxIterations: 20,
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'iterativeAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      const data = fn.data as AgenticFunctionData
      expect(data.maxIterations).toBe(20)
    })

    it('stores model configuration for agentic function', async () => {
      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'configuredAgent',
        model: 'claude-opus-4-20250514',
        tools: ['code_executor'],
        goal: 'Write and execute code',
        temperature: 0.3,
        maxTokens: 8192,
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'configuredAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      const data = fn.data as AgenticFunctionData
      expect(data.model).toBe('claude-opus-4-20250514')
      expect(data.temperature).toBe(0.3)
      expect(data.maxTokens).toBe(8192)
    })
  })

  // ==========================================================================
  // 4. HUMAN FUNCTION TESTS
  // ==========================================================================

  describe('Human Function', () => {
    it('creates HumanFunction Thing with correct type', async () => {
      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'approveRefund',
        description: 'Request human approval for refunds',
        channel: 'slack',
        promptTemplate: 'Please approve refund of ${{amount}} for customer {{customerId}}',
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'approveRefund'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      expect(fn).toBeDefined()
      expect(fn.typeName).toBe('HumanFunction')
      expect(fn.typeId).toBe(TYPE_IDS.HumanFunction)
    })

    it('stores channel config', async () => {
      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'multiChannelApproval',
        channel: ['slack', 'email', 'in-app'],
        promptTemplate: 'Approval needed for action',
        timeout: 86400000, // 24 hours
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'multiChannelApproval'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      const data = fn.data as HumanFunctionData
      expect(data.channel).toEqual(['slack', 'email', 'in-app'])
    })

    it('stores form schema', async () => {
      const form = {
        fields: [
          {
            name: 'decision',
            type: 'select' as const,
            label: 'Decision',
            required: true,
            options: ['approve', 'reject', 'escalate'],
          },
          {
            name: 'reason',
            type: 'text' as const,
            label: 'Reason',
            required: true,
          },
          {
            name: 'amount',
            type: 'number' as const,
            label: 'Approved Amount',
            required: false,
            default: 0,
          },
        ],
      }

      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'formBasedApproval',
        channel: 'in-app',
        promptTemplate: 'Please review the request',
        form,
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'formBasedApproval'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      const data = fn.data as HumanFunctionData
      expect(data.form).toEqual(form)
      expect(data.form?.fields.length).toBe(3)
      expect(data.form?.fields[0].options).toEqual(['approve', 'reject', 'escalate'])
    })

    it('stores actions configuration', async () => {
      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'actionBasedApproval',
        channel: 'slack',
        promptTemplate: 'Review the order',
        actions: [
          { value: 'approve', label: 'Approve', style: 'primary' },
          { value: 'reject', label: 'Reject', style: 'danger' },
          { value: 'hold', label: 'Put on Hold', style: 'default' },
        ],
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'actionBasedApproval'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      const data = fn.data as HumanFunctionData
      expect(data.actions).toHaveLength(3)
      expect(data.actions?.[0]).toEqual({ value: 'approve', label: 'Approve', style: 'primary' })
    })

    it('stores escalation config', async () => {
      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'escalatableApproval',
        channel: 'slack',
        promptTemplate: 'Urgent: Please review',
        timeout: 3600000, // 1 hour
        escalation: {
          timeout: 1800000, // 30 minutes
          to: 'manager-channel',
        },
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'escalatableApproval'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      const data = fn.data as HumanFunctionData
      expect(data.escalation?.timeout).toBe(1800000)
      expect(data.escalation?.to).toBe('manager-channel')
    })

    it('stores default on timeout config', async () => {
      const fnData: HumanFunctionData = {
        kind: 'human',
        name: 'autoApproveOnTimeout',
        channel: 'email',
        promptTemplate: 'Please confirm receipt',
        timeout: 604800000, // 1 week
        defaultOnTimeout: {
          action: 'auto_approve',
          reason: 'No response within timeout period',
        },
      }

      const fn = await store.createThing({
        id: generateFunctionId('human', 'autoApproveOnTimeout'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: fnData,
      })

      const data = fn.data as HumanFunctionData
      expect(data.defaultOnTimeout?.action).toBe('auto_approve')
      expect(data.defaultOnTimeout?.reason).toBe('No response within timeout period')
    })
  })

  // ==========================================================================
  // 5. QUERY BY TYPE TESTS
  // ==========================================================================

  describe('Query Functions by typeName', () => {
    beforeEach(async () => {
      // Create functions of each type
      await store.createThing({
        id: generateFunctionId('code', 'codeFunc1'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'codeFunc1', handlerRef: 'r2://handlers/1' } as CodeFunctionData,
      })
      await store.createThing({
        id: generateFunctionId('code', 'codeFunc2'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'codeFunc2', handlerRef: 'r2://handlers/2' } as CodeFunctionData,
      })
      await store.createThing({
        id: generateFunctionId('generative', 'genFunc1'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: { kind: 'generative', name: 'genFunc1', model: 'claude-sonnet-4-20250514' } as GenerativeFunctionData,
      })
      await store.createThing({
        id: generateFunctionId('agentic', 'agentFunc1'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: { kind: 'agentic', name: 'agentFunc1', model: 'claude-opus-4-20250514', tools: [], goal: 'test' } as AgenticFunctionData,
      })
      await store.createThing({
        id: generateFunctionId('human', 'humanFunc1'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: { kind: 'human', name: 'humanFunc1', channel: 'slack', promptTemplate: 'test' } as HumanFunctionData,
      })
    })

    it('queries all CodeFunction Things', async () => {
      const codeFunctions = await store.getThingsByType({ typeName: 'CodeFunction' })

      expect(codeFunctions.length).toBe(2)
      expect(codeFunctions.every((fn) => fn.typeName === 'CodeFunction')).toBe(true)
      expect(codeFunctions.every((fn) => (fn.data as CodeFunctionData).kind === 'code')).toBe(true)
    })

    it('queries all GenerativeFunction Things', async () => {
      const genFunctions = await store.getThingsByType({ typeName: 'GenerativeFunction' })

      expect(genFunctions.length).toBe(1)
      expect(genFunctions[0].typeName).toBe('GenerativeFunction')
      expect((genFunctions[0].data as GenerativeFunctionData).kind).toBe('generative')
    })

    it('queries all AgenticFunction Things', async () => {
      const agentFunctions = await store.getThingsByType({ typeName: 'AgenticFunction' })

      expect(agentFunctions.length).toBe(1)
      expect(agentFunctions[0].typeName).toBe('AgenticFunction')
      expect((agentFunctions[0].data as AgenticFunctionData).kind).toBe('agentic')
    })

    it('queries all HumanFunction Things', async () => {
      const humanFunctions = await store.getThingsByType({ typeName: 'HumanFunction' })

      expect(humanFunctions.length).toBe(1)
      expect(humanFunctions[0].typeName).toBe('HumanFunction')
      expect((humanFunctions[0].data as HumanFunctionData).kind).toBe('human')
    })

    it('returns empty array for non-existent function type', async () => {
      const unknownFunctions = await store.getThingsByType({ typeName: 'UnknownFunction' })

      expect(unknownFunctions).toEqual([])
    })

    it('supports pagination with limit and offset', async () => {
      const allCode = await store.getThingsByType({ typeName: 'CodeFunction' })
      const firstPage = await store.getThingsByType({ typeName: 'CodeFunction', limit: 1 })
      const secondPage = await store.getThingsByType({ typeName: 'CodeFunction', limit: 1, offset: 1 })

      expect(allCode.length).toBe(2)
      expect(firstPage.length).toBe(1)
      expect(secondPage.length).toBe(1)
      expect(firstPage[0].id).not.toBe(secondPage[0].id)
    })
  })

  // ==========================================================================
  // 6. UPDATE FUNCTION TESTS
  // ==========================================================================

  describe('Update Function metadata', () => {
    it('updates function description', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('code', 'updatable'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: {
          kind: 'code',
          name: 'updatableFunc',
          description: 'Original description',
          handlerRef: 'r2://handlers/updatable',
        } as CodeFunctionData,
      })

      const updated = await store.updateThing(fn.id, {
        data: {
          kind: 'code',
          name: 'updatableFunc',
          description: 'Updated description',
          handlerRef: 'r2://handlers/updatable',
        } as CodeFunctionData,
      })

      expect((updated?.data as CodeFunctionData).description).toBe('Updated description')
    })

    it('updates function timeout', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('generative', 'timeoutUpdate'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: {
          kind: 'generative',
          name: 'timeoutFunc',
          model: 'claude-sonnet-4-20250514',
          timeout: 30000,
        } as GenerativeFunctionData,
      })

      const updated = await store.updateThing(fn.id, {
        data: {
          kind: 'generative',
          name: 'timeoutFunc',
          model: 'claude-sonnet-4-20250514',
          timeout: 60000,
        } as GenerativeFunctionData,
      })

      expect((updated?.data as GenerativeFunctionData).timeout).toBe(60000)
    })

    it('updates agentic function tools list', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'toolsUpdate'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: {
          kind: 'agentic',
          name: 'toolsFunc',
          model: 'claude-sonnet-4-20250514',
          tools: ['tool1'],
          goal: 'Test goal',
        } as AgenticFunctionData,
      })

      const updated = await store.updateThing(fn.id, {
        data: {
          kind: 'agentic',
          name: 'toolsFunc',
          model: 'claude-sonnet-4-20250514',
          tools: ['tool1', 'tool2', 'tool3'],
          goal: 'Test goal',
        } as AgenticFunctionData,
      })

      expect((updated?.data as AgenticFunctionData).tools).toEqual(['tool1', 'tool2', 'tool3'])
    })

    it('updates human function channel', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('human', 'channelUpdate'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: {
          kind: 'human',
          name: 'channelFunc',
          channel: 'slack',
          promptTemplate: 'Test prompt',
        } as HumanFunctionData,
      })

      const updated = await store.updateThing(fn.id, {
        data: {
          kind: 'human',
          name: 'channelFunc',
          channel: ['slack', 'email'],
          promptTemplate: 'Test prompt',
        } as HumanFunctionData,
      })

      expect((updated?.data as HumanFunctionData).channel).toEqual(['slack', 'email'])
    })

    it('updates updatedAt timestamp on update', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('code', 'timestampUpdate'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'timestampFunc', handlerRef: 'r2://handlers/ts' } as CodeFunctionData,
      })

      const originalUpdatedAt = fn.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await store.updateThing(fn.id, {
        data: { kind: 'code', name: 'timestampFuncUpdated', handlerRef: 'r2://handlers/ts' } as CodeFunctionData,
      })

      expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt)
      expect(updated!.createdAt).toBe(fn.createdAt)
    })

    it('returns null for updating non-existent function', async () => {
      const updated = await store.updateThing('nonexistent-function-id', {
        data: { kind: 'code', name: 'ghost', handlerRef: 'r2://nowhere' } as CodeFunctionData,
      })

      expect(updated).toBeNull()
    })
  })

  // ==========================================================================
  // 7. SOFT-DELETE FUNCTION TESTS
  // ==========================================================================

  describe('Soft-delete Function (deletedAt timestamp)', () => {
    it('soft deletes function by setting deletedAt', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('code', 'deletable'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'deletableFunc', handlerRef: 'r2://handlers/deletable' } as CodeFunctionData,
      })

      const deleted = await store.deleteThing(fn.id)

      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()
      expect(deleted!.deletedAt).toBeGreaterThan(0)
    })

    it('soft deleted function is still retrievable by ID', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('generative', 'softDeleted'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: { kind: 'generative', name: 'softDeletedFunc', model: 'claude-sonnet-4-20250514' } as GenerativeFunctionData,
      })

      await store.deleteThing(fn.id)

      const retrieved = await store.getThing(fn.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.deletedAt).not.toBeNull()
      expect((retrieved!.data as GenerativeFunctionData).name).toBe('softDeletedFunc')
    })

    it('soft deleted functions excluded from getThingsByType by default', async () => {
      await store.createThing({
        id: generateFunctionId('agentic', 'active1'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: { kind: 'agentic', name: 'active1', model: 'claude', tools: [], goal: 'test' } as AgenticFunctionData,
      })
      const toDelete = await store.createThing({
        id: generateFunctionId('agentic', 'toDelete'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: { kind: 'agentic', name: 'toDelete', model: 'claude', tools: [], goal: 'test' } as AgenticFunctionData,
      })
      await store.createThing({
        id: generateFunctionId('agentic', 'active2'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: { kind: 'agentic', name: 'active2', model: 'claude', tools: [], goal: 'test' } as AgenticFunctionData,
      })

      await store.deleteThing(toDelete.id)

      const agenticFunctions = await store.getThingsByType({ typeName: 'AgenticFunction' })

      expect(agenticFunctions.length).toBe(2)
      expect(agenticFunctions.every((fn) => fn.deletedAt === null)).toBe(true)
    })

    it('soft deleted functions included with includeDeleted option', async () => {
      await store.createThing({
        id: generateFunctionId('human', 'activeHuman'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: { kind: 'human', name: 'activeHuman', channel: 'slack', promptTemplate: 'test' } as HumanFunctionData,
      })
      const toDelete = await store.createThing({
        id: generateFunctionId('human', 'deletedHuman'),
        typeId: TYPE_IDS.HumanFunction,
        typeName: 'HumanFunction',
        data: { kind: 'human', name: 'deletedHuman', channel: 'email', promptTemplate: 'test' } as HumanFunctionData,
      })

      await store.deleteThing(toDelete.id)

      const allHumanFunctions = await store.getThingsByType({
        typeName: 'HumanFunction',
        includeDeleted: true,
      })

      expect(allHumanFunctions.length).toBe(2)
      expect(allHumanFunctions.some((fn) => fn.deletedAt !== null)).toBe(true)
    })

    it('returns null when deleting non-existent function', async () => {
      const result = await store.deleteThing('nonexistent-function-id')

      expect(result).toBeNull()
    })

    it('deletedAt timestamp is within expected range', async () => {
      const fn = await store.createThing({
        id: generateFunctionId('code', 'timestampCheck'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'timestampCheck', handlerRef: 'r2://handlers/ts' } as CodeFunctionData,
      })

      const before = Date.now()
      const deleted = await store.deleteThing(fn.id)
      const after = Date.now()

      expect(deleted!.deletedAt).toBeGreaterThanOrEqual(before)
      expect(deleted!.deletedAt).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // 8. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles function with minimal data', async () => {
      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'minimal',
        handlerRef: 'r2://handlers/minimal',
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'minimal'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      expect(fn).toBeDefined()
      expect((fn.data as CodeFunctionData).description).toBeUndefined()
      expect((fn.data as CodeFunctionData).timeout).toBeUndefined()
      expect((fn.data as CodeFunctionData).retries).toBeUndefined()
    })

    it('handles function with maximum data complexity', async () => {
      const fnData: AgenticFunctionData = {
        kind: 'agentic',
        name: 'complexAgent',
        description: 'A highly complex agent with many tools and configurations',
        model: 'claude-opus-4-20250514',
        tools: Array.from({ length: 50 }, (_, i) => `tool-${i}`),
        goal: 'Execute a complex multi-step workflow with branching logic and error handling',
        systemPrompt: 'You are an expert autonomous agent...\n'.repeat(100),
        maxIterations: 100,
        temperature: 0.7,
        maxTokens: 16384,
        timeout: 600000,
        retries: {
          maxAttempts: 5,
          delay: 2000,
          backoff: 'exponential-jitter',
          maxDelay: 60000,
        },
        createdBy: 'admin@example.com',
        version: '2.0.0',
      }

      const fn = await store.createThing({
        id: generateFunctionId('agentic', 'complexAgent'),
        typeId: TYPE_IDS.AgenticFunction,
        typeName: 'AgenticFunction',
        data: fnData,
      })

      const retrieved = await store.getThing(fn.id)
      const data = retrieved?.data as AgenticFunctionData

      expect(data.tools.length).toBe(50)
      expect(data.systemPrompt?.length).toBeGreaterThan(1000)
    })

    it('handles Unicode in function names and descriptions', async () => {
      const fnData: GenerativeFunctionData = {
        kind: 'generative',
        name: 'internationalization-test',
        description: 'Test with Unicode characters',
        model: 'claude-sonnet-4-20250514',
        promptTemplate: 'Hello World in multiple languages',
      }

      const fn = await store.createThing({
        id: generateFunctionId('generative', 'unicode'),
        typeId: TYPE_IDS.GenerativeFunction,
        typeName: 'GenerativeFunction',
        data: fnData,
      })

      const retrieved = await store.getThing(fn.id)
      expect(retrieved).toBeDefined()
    })

    it('handles special characters in handler references', async () => {
      const handlerRef = 'r2://functions/handler-sha256-abc123!@#$%^&*()_+-=[]{}|;:,.<>?'

      const fnData: CodeFunctionData = {
        kind: 'code',
        name: 'specialCharsHandler',
        handlerRef,
      }

      const fn = await store.createThing({
        id: generateFunctionId('code', 'specialChars'),
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: fnData,
      })

      const retrieved = await store.getThing(fn.id)
      expect((retrieved?.data as CodeFunctionData).handlerRef).toBe(handlerRef)
    })

    it('handles concurrent function creations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.createThing({
          id: generateFunctionId('code', `concurrent-${i}`),
          typeId: TYPE_IDS.CodeFunction,
          typeName: 'CodeFunction',
          data: {
            kind: 'code',
            name: `concurrentFunc${i}`,
            handlerRef: `r2://handlers/concurrent-${i}`,
          } as CodeFunctionData,
        })
      )

      const results = await Promise.all(promises)

      expect(results.length).toBe(10)
      expect(new Set(results.map((r) => r.id)).size).toBe(10)
    })

    it('rejects duplicate function IDs', async () => {
      const fnId = generateFunctionId('code', 'duplicate')

      await store.createThing({
        id: fnId,
        typeId: TYPE_IDS.CodeFunction,
        typeName: 'CodeFunction',
        data: { kind: 'code', name: 'first', handlerRef: 'r2://handlers/first' } as CodeFunctionData,
      })

      await expect(
        store.createThing({
          id: fnId, // Same ID
          typeId: TYPE_IDS.CodeFunction,
          typeName: 'CodeFunction',
          data: { kind: 'code', name: 'second', handlerRef: 'r2://handlers/second' } as CodeFunctionData,
        })
      ).rejects.toThrow()
    })
  })
})
