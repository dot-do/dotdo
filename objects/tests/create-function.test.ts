/**
 * createFunction() Factory Tests
 *
 * RED TDD: These tests should FAIL because createFunction() doesn't exist yet.
 *
 * createFunction() is a factory that creates function instances based on type:
 * - CodeFunction: executes TypeScript/JavaScript code
 * - GenerativeFunction: calls LLM for generation
 * - AgenticFunction: orchestrates multi-step AI tasks
 * - HumanFunction: queues tasks for human input
 *
 * The factory validates definitions, registers with DO, and supports composition.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// This import will FAIL - createFunction doesn't exist yet
import {
  createFunction,
  type FunctionDefinition,
  type CodeFunctionDefinition,
  type GenerativeFunctionDefinition,
  type AgenticFunctionDefinition,
  type HumanFunctionDefinition,
  type FunctionInstance,
  type FunctionRegistry,
  type ComposedFunction,
  ValidationError,
  RegistrationError,
  ExecutionError,
} from '../createFunction'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected base function definition
 */
interface ExpectedFunctionDefinition {
  name: string
  description?: string
  type: 'code' | 'generative' | 'agentic' | 'human'
  timeout?: number
  retries?: number
  requiredPermission?: string
}

/**
 * Expected CodeFunction definition
 */
interface ExpectedCodeFunctionDefinition extends ExpectedFunctionDefinition {
  type: 'code'
  handler: (input: unknown, context: FunctionContext) => unknown | Promise<unknown>
  runtime?: 'javascript' | 'typescript'
  sandboxed?: boolean
}

/**
 * Expected GenerativeFunction definition
 */
interface ExpectedGenerativeFunctionDefinition extends ExpectedFunctionDefinition {
  type: 'generative'
  model: string
  prompt: string | ((input: unknown) => string)
  temperature?: number
  maxTokens?: number
  stream?: boolean
  schema?: Record<string, unknown> // JSON Schema for structured output
}

/**
 * Expected AgenticFunction definition
 */
interface ExpectedAgenticFunctionDefinition extends ExpectedFunctionDefinition {
  type: 'agentic'
  agent: string
  tools?: string[]
  maxIterations?: number
  systemPrompt?: string
  onStep?: (step: AgentStep) => void | Promise<void>
}

/**
 * Expected HumanFunction definition
 */
interface ExpectedHumanFunctionDefinition extends ExpectedFunctionDefinition {
  type: 'human'
  channel: string
  prompt?: string | ((input: unknown) => string)
  timeout: number // Required for human functions
  escalation?: {
    timeout: number
    to: string // another channel or function
  }
  form?: FormDefinition
}

interface FunctionContext {
  functionId: string
  invocationId: string
  input: unknown
  env: Record<string, unknown>
  emit: (event: string, data: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
}

interface AgentStep {
  iteration: number
  thought: string
  action?: string
  observation?: string
}

interface FormDefinition {
  fields: Array<{
    name: string
    type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
    label: string
    required?: boolean
    options?: string[]
    validation?: (value: unknown) => boolean | string
  }>
}

// ============================================================================
// MOCK DO STATE & REGISTRY
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-function-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    AI: {
      generate: vi.fn().mockResolvedValue({ text: 'Generated response' }),
      stream: vi.fn(),
    },
    AGENT_RUNNER: {
      run: vi.fn().mockResolvedValue({ result: 'Agent completed' }),
    },
    NOTIFICATIONS: {
      send: vi.fn().mockResolvedValue(undefined),
      waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
    },
  }
}

function createMockRegistry(): FunctionRegistry {
  const functions = new Map<string, FunctionInstance>()
  return {
    register: vi.fn(async (fn: FunctionInstance) => {
      functions.set(fn.name, fn)
    }),
    get: vi.fn(async (name: string) => functions.get(name) || null),
    list: vi.fn(async () => Array.from(functions.values())),
    unregister: vi.fn(async (name: string) => functions.delete(name)),
    has: vi.fn(async (name: string) => functions.has(name)),
  }
}

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const validCodeFunction: ExpectedCodeFunctionDefinition = {
  name: 'calculateTotal',
  type: 'code',
  description: 'Calculate total from items',
  handler: (input: { items: Array<{ price: number }> }) => {
    return input.items.reduce((sum, item) => sum + item.price, 0)
  },
  timeout: 5000,
}

const validGenerativeFunction: ExpectedGenerativeFunctionDefinition = {
  name: 'summarize',
  type: 'generative',
  description: 'Summarize text content',
  model: 'claude-3-sonnet',
  prompt: 'Summarize the following text: {{text}}',
  temperature: 0.7,
  maxTokens: 500,
}

const validAgenticFunction: ExpectedAgenticFunctionDefinition = {
  name: 'research',
  type: 'agentic',
  description: 'Research a topic using multiple tools',
  agent: 'researcher',
  tools: ['web_search', 'read_url', 'summarize'],
  maxIterations: 10,
  systemPrompt: 'You are a thorough researcher.',
}

const validHumanFunction: ExpectedHumanFunctionDefinition = {
  name: 'approveExpense',
  type: 'human',
  description: 'Approve expense request',
  channel: 'slack',
  prompt: 'Please approve expense: {{amount}} for {{reason}}',
  timeout: 86400000, // 24 hours
  form: {
    fields: [
      { name: 'approved', type: 'boolean', label: 'Approve?', required: true },
      { name: 'comment', type: 'text', label: 'Comment' },
    ],
  },
}

// ============================================================================
// TESTS
// ============================================================================

describe('createFunction Factory', () => {
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockRegistry: FunctionRegistry

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockRegistry = createMockRegistry()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. FACTORY CREATION TESTS
  // ==========================================================================

  describe('Factory Creation', () => {
    describe('CodeFunction creation', () => {
      it('creates a CodeFunction with valid definition', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn).toBeDefined()
        expect(fn.name).toBe('calculateTotal')
        expect(fn.type).toBe('code')
        expect(fn.description).toBe('Calculate total from items')
      })

      it('creates CodeFunction with handler that receives context', async () => {
        const handler = vi.fn((input: unknown, ctx: FunctionContext) => {
          expect(ctx.functionId).toBeDefined()
          expect(ctx.invocationId).toBeDefined()
          expect(ctx.emit).toBeInstanceOf(Function)
          return { result: 'ok' }
        })

        const fn = await createFunction({
          ...validCodeFunction,
          handler,
        }, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ test: true })

        expect(handler).toHaveBeenCalled()
      })

      it('supports async handlers', async () => {
        const asyncHandler = vi.fn(async (input: { value: number }) => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return input.value * 2
        })

        const fn = await createFunction({
          ...validCodeFunction,
          handler: asyncHandler,
        }, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ value: 21 })

        expect(result).toBe(42)
      })

      it('supports sandboxed execution option', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          sandboxed: true,
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.sandboxed).toBe(true)
      })

      it('defaults to javascript runtime', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.runtime).toBe('javascript')
      })

      it('accepts typescript runtime', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          runtime: 'typescript',
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.runtime).toBe('typescript')
      })
    })

    describe('GenerativeFunction creation', () => {
      it('creates a GenerativeFunction with valid definition', async () => {
        const fn = await createFunction(validGenerativeFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn).toBeDefined()
        expect(fn.name).toBe('summarize')
        expect(fn.type).toBe('generative')
        expect(fn.model).toBe('claude-3-sonnet')
      })

      it('supports template string prompts', async () => {
        const fn = await createFunction(validGenerativeFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.prompt).toBe('Summarize the following text: {{text}}')
      })

      it('supports function prompts', async () => {
        const promptFn = (input: { text: string; style: string }) =>
          `Summarize in ${input.style} style: ${input.text}`

        const fn = await createFunction({
          ...validGenerativeFunction,
          prompt: promptFn,
        }, { registry: mockRegistry, env: mockEnv })

        expect(typeof fn.prompt).toBe('function')
      })

      it('supports JSON schema for structured output', async () => {
        const schema = {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            keyPoints: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary'],
        }

        const fn = await createFunction({
          ...validGenerativeFunction,
          schema,
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.schema).toEqual(schema)
      })

      it('supports streaming option', async () => {
        const fn = await createFunction({
          ...validGenerativeFunction,
          stream: true,
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.stream).toBe(true)
      })

      it('uses default temperature if not specified', async () => {
        const fn = await createFunction({
          name: 'generate',
          type: 'generative',
          model: 'claude-3-sonnet',
          prompt: 'Test',
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.temperature).toBe(1) // Default
      })
    })

    describe('AgenticFunction creation', () => {
      it('creates an AgenticFunction with valid definition', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn).toBeDefined()
        expect(fn.name).toBe('research')
        expect(fn.type).toBe('agentic')
        expect(fn.agent).toBe('researcher')
      })

      it('includes tool definitions', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.tools).toEqual(['web_search', 'read_url', 'summarize'])
      })

      it('supports maxIterations configuration', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.maxIterations).toBe(10)
      })

      it('defaults maxIterations to 10 if not specified', async () => {
        const fn = await createFunction({
          name: 'agent',
          type: 'agentic',
          agent: 'default',
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.maxIterations).toBe(10)
      })

      it('supports step callback for observability', async () => {
        const onStep = vi.fn()

        const fn = await createFunction({
          ...validAgenticFunction,
          onStep,
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.onStep).toBe(onStep)
      })

      it('includes system prompt', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.systemPrompt).toBe('You are a thorough researcher.')
      })
    })

    describe('HumanFunction creation', () => {
      it('creates a HumanFunction with valid definition', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn).toBeDefined()
        expect(fn.name).toBe('approveExpense')
        expect(fn.type).toBe('human')
        expect(fn.channel).toBe('slack')
      })

      it('requires timeout for human functions', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.timeout).toBe(86400000)
      })

      it('supports form definition for structured input', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        expect(fn.form).toBeDefined()
        expect(fn.form?.fields).toHaveLength(2)
        expect(fn.form?.fields[0].name).toBe('approved')
      })

      it('supports escalation configuration', async () => {
        const fn = await createFunction({
          ...validHumanFunction,
          escalation: {
            timeout: 3600000, // 1 hour
            to: 'email',
          },
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.escalation).toBeDefined()
        expect(fn.escalation?.timeout).toBe(3600000)
        expect(fn.escalation?.to).toBe('email')
      })

      it('supports function prompts', async () => {
        const promptFn = (input: { amount: number }) => `Approve $${input.amount}?`

        const fn = await createFunction({
          ...validHumanFunction,
          prompt: promptFn,
        }, { registry: mockRegistry, env: mockEnv })

        expect(typeof fn.prompt).toBe('function')
      })
    })

    describe('Common creation options', () => {
      it('assigns unique function ID', async () => {
        const fn1 = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })
        const fn2 = await createFunction({ ...validCodeFunction, name: 'fn2' }, { registry: mockRegistry, env: mockEnv })

        expect(fn1.id).toBeDefined()
        expect(fn2.id).toBeDefined()
        expect(fn1.id).not.toBe(fn2.id)
      })

      it('supports custom function ID', async () => {
        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          id: 'custom-id-123',
        })

        expect(fn.id).toBe('custom-id-123')
      })

      it('tracks creation timestamp', async () => {
        const before = Date.now()
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })
        const after = Date.now()

        expect(fn.createdAt).toBeInstanceOf(Date)
        expect(fn.createdAt.getTime()).toBeGreaterThanOrEqual(before)
        expect(fn.createdAt.getTime()).toBeLessThanOrEqual(after)
      })

      it('supports required permission configuration', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          requiredPermission: 'functions:execute',
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.requiredPermission).toBe('functions:execute')
      })

      it('supports retry configuration', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          retries: 3,
        }, { registry: mockRegistry, env: mockEnv })

        expect(fn.retries).toBe(3)
      })
    })
  })

  // ==========================================================================
  // 2. VALIDATION TESTS
  // ==========================================================================

  describe('Validation', () => {
    describe('Required fields validation', () => {
      it('throws ValidationError when name is missing', async () => {
        await expect(
          createFunction({ type: 'code', handler: () => {} } as ExpectedCodeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws ValidationError when name is empty string', async () => {
        await expect(
          createFunction({ ...validCodeFunction, name: '' }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws ValidationError when type is missing', async () => {
        await expect(
          createFunction({ name: 'test' } as FunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws ValidationError when type is invalid', async () => {
        await expect(
          createFunction({ name: 'test', type: 'invalid' as 'code' }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })
    })

    describe('CodeFunction validation', () => {
      it('throws when handler is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'code',
          } as ExpectedCodeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when handler is not a function', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'code',
            handler: 'not a function' as unknown as Function,
          } as ExpectedCodeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when runtime is invalid', async () => {
        await expect(
          createFunction({
            ...validCodeFunction,
            runtime: 'python' as 'javascript',
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })
    })

    describe('GenerativeFunction validation', () => {
      it('throws when model is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'generative',
            prompt: 'Test prompt',
          } as ExpectedGenerativeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when model is empty', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'generative',
            model: '',
            prompt: 'Test',
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when prompt is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'generative',
            model: 'claude-3-sonnet',
          } as ExpectedGenerativeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when temperature is out of range', async () => {
        await expect(
          createFunction({
            ...validGenerativeFunction,
            temperature: 2.5,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)

        await expect(
          createFunction({
            ...validGenerativeFunction,
            temperature: -0.1,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when maxTokens is negative', async () => {
        await expect(
          createFunction({
            ...validGenerativeFunction,
            maxTokens: -100,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when schema is invalid JSON Schema', async () => {
        await expect(
          createFunction({
            ...validGenerativeFunction,
            schema: { type: 'invalid-type' },
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })
    })

    describe('AgenticFunction validation', () => {
      it('throws when agent is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'agentic',
          } as ExpectedAgenticFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when agent is empty', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'agentic',
            agent: '',
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when maxIterations is less than 1', async () => {
        await expect(
          createFunction({
            ...validAgenticFunction,
            maxIterations: 0,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when maxIterations exceeds limit', async () => {
        await expect(
          createFunction({
            ...validAgenticFunction,
            maxIterations: 1001,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when tools contains duplicates', async () => {
        await expect(
          createFunction({
            ...validAgenticFunction,
            tools: ['search', 'search', 'read'],
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })
    })

    describe('HumanFunction validation', () => {
      it('throws when channel is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'human',
            timeout: 60000,
          } as ExpectedHumanFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when channel is empty', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'human',
            channel: '',
            timeout: 60000,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when timeout is missing', async () => {
        await expect(
          createFunction({
            name: 'test',
            type: 'human',
            channel: 'slack',
          } as ExpectedHumanFunctionDefinition, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when timeout is not positive', async () => {
        await expect(
          createFunction({
            ...validHumanFunction,
            timeout: 0,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)

        await expect(
          createFunction({
            ...validHumanFunction,
            timeout: -1000,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when form field is missing name', async () => {
        await expect(
          createFunction({
            ...validHumanFunction,
            form: {
              fields: [
                { type: 'text', label: 'Missing name' } as unknown as FormDefinition['fields'][0],
              ],
            },
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when form field has invalid type', async () => {
        await expect(
          createFunction({
            ...validHumanFunction,
            form: {
              fields: [
                { name: 'test', type: 'invalid' as 'text', label: 'Test' },
              ],
            },
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when escalation timeout exceeds main timeout', async () => {
        await expect(
          createFunction({
            ...validHumanFunction,
            timeout: 3600000,
            escalation: {
              timeout: 7200000, // Greater than main timeout
              to: 'email',
            },
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })
    })

    describe('Common validation', () => {
      it('throws when timeout is negative', async () => {
        await expect(
          createFunction({
            ...validCodeFunction,
            timeout: -1000,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when retries is negative', async () => {
        await expect(
          createFunction({
            ...validCodeFunction,
            retries: -1,
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('throws when name contains invalid characters', async () => {
        await expect(
          createFunction({
            ...validCodeFunction,
            name: 'invalid name with spaces',
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)

        await expect(
          createFunction({
            ...validCodeFunction,
            name: 'invalid/name',
          }, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(ValidationError)
      })

      it('allows valid name patterns', async () => {
        const validNames = ['myFunction', 'my_function', 'myFunction123', 'MyFunction']

        for (const name of validNames) {
          const fn = await createFunction({
            ...validCodeFunction,
            name,
          }, { registry: mockRegistry, env: mockEnv })

          expect(fn.name).toBe(name)
        }
      })

      it('provides descriptive error messages', async () => {
        try {
          await createFunction({
            name: '',
            type: 'code',
            handler: () => {},
          } as ExpectedCodeFunctionDefinition, { registry: mockRegistry, env: mockEnv })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError)
          expect((error as ValidationError).message).toMatch(/name/i)
        }
      })
    })
  })

  // ==========================================================================
  // 3. REGISTRATION TESTS
  // ==========================================================================

  describe('Registration', () => {
    describe('Automatic registration', () => {
      it('registers function with provided registry', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        expect(mockRegistry.register).toHaveBeenCalledWith(fn)
      })

      it('can retrieve registered function by name', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        const retrieved = await mockRegistry.get('calculateTotal')

        expect(retrieved).toBeDefined()
        expect(retrieved?.name).toBe(fn.name)
      })

      it('prevents duplicate function names', async () => {
        await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        await expect(
          createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })
        ).rejects.toThrow(RegistrationError)
      })

      it('allows duplicate names with replace option', async () => {
        const fn1 = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })
        const fn2 = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          replace: true,
        })

        expect(fn2.id).not.toBe(fn1.id)
        expect(await mockRegistry.get('calculateTotal')).toBe(fn2)
      })
    })

    describe('Manual registration', () => {
      it('skips auto-registration with autoRegister: false', async () => {
        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          autoRegister: false,
        })

        expect(mockRegistry.register).not.toHaveBeenCalled()
        expect(await mockRegistry.get('calculateTotal')).toBeNull()
      })

      it('can manually register after creation', async () => {
        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          autoRegister: false,
        })

        await fn.register(mockRegistry)

        expect(mockRegistry.register).toHaveBeenCalledWith(fn)
      })
    })

    describe('Registration with DO', () => {
      it('can register function directly with DO instance', async () => {
        // Mock DO with function registry
        const mockDO = {
          registerFunction: vi.fn(),
        }

        const fn = await createFunction(validCodeFunction, {
          env: mockEnv,
          durableObject: mockDO as unknown as DurableObject,
        })

        expect(mockDO.registerFunction).toHaveBeenCalledWith(fn)
      })

      it('stores function definition in DO storage', async () => {
        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          state: mockState,
        })

        const stored = await mockState.storage.get(`function:${fn.name}`)

        expect(stored).toBeDefined()
        expect((stored as { name: string }).name).toBe('calculateTotal')
      })

      it('persists function metadata across DO restarts', async () => {
        // Create and register
        const fn1 = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          state: mockState,
        })

        // Simulate restart by creating new registry
        const newRegistry = createMockRegistry()

        // Recreate from storage (factory should reload from state)
        const fn2 = await createFunction.fromStorage('calculateTotal', {
          registry: newRegistry,
          env: mockEnv,
          state: mockState,
        })

        expect(fn2).toBeDefined()
        expect(fn2.name).toBe(fn1.name)
        expect(fn2.type).toBe(fn1.type)
      })
    })

    describe('Registration events', () => {
      it('emits function.registered event', async () => {
        const onEvent = vi.fn()

        await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          onEvent,
        })

        expect(onEvent).toHaveBeenCalledWith('function.registered', expect.objectContaining({
          name: 'calculateTotal',
          type: 'code',
        }))
      })

      it('emits function.replaced event when replacing', async () => {
        const onEvent = vi.fn()

        await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })
        await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          replace: true,
          onEvent,
        })

        expect(onEvent).toHaveBeenCalledWith('function.replaced', expect.objectContaining({
          name: 'calculateTotal',
        }))
      })
    })

    describe('Unregistration', () => {
      it('can unregister function', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        await fn.unregister()

        expect(mockRegistry.unregister).toHaveBeenCalledWith('calculateTotal')
        expect(await mockRegistry.get('calculateTotal')).toBeNull()
      })

      it('removes function from storage when unregistered', async () => {
        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          state: mockState,
        })

        await fn.unregister()

        const stored = await mockState.storage.get(`function:${fn.name}`)
        expect(stored).toBeUndefined()
      })
    })
  })

  // ==========================================================================
  // 4. EXECUTION TESTS
  // ==========================================================================

  describe('Execution', () => {
    describe('CodeFunction execution', () => {
      it('executes handler with input', async () => {
        const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ items: [{ price: 10 }, { price: 20 }] })

        expect(result).toBe(30)
      })

      it('passes context to handler', async () => {
        let capturedContext: FunctionContext | null = null

        const fn = await createFunction({
          ...validCodeFunction,
          handler: (input: unknown, ctx: FunctionContext) => {
            capturedContext = ctx
            return 'done'
          },
        }, { registry: mockRegistry, env: mockEnv })

        await fn.execute({})

        expect(capturedContext).not.toBeNull()
        expect(capturedContext!.functionId).toBe(fn.id)
        expect(capturedContext!.invocationId).toBeDefined()
      })

      it('respects timeout', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          timeout: 100,
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 500))
            return 'done'
          },
        }, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({})).rejects.toThrow(ExecutionError)
        await expect(fn.execute({})).rejects.toThrow(/timeout/i)
      })

      it('retries on failure when configured', async () => {
        let attempts = 0

        const fn = await createFunction({
          ...validCodeFunction,
          retries: 3,
          handler: () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Temporary failure')
            }
            return 'success'
          },
        }, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({})

        expect(result).toBe('success')
        expect(attempts).toBe(3)
      })

      it('throws ExecutionError after all retries exhausted', async () => {
        const fn = await createFunction({
          ...validCodeFunction,
          retries: 2,
          handler: () => {
            throw new Error('Persistent failure')
          },
        }, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({})).rejects.toThrow(ExecutionError)
      })
    })

    describe('GenerativeFunction execution', () => {
      it('calls AI service with prompt', async () => {
        const fn = await createFunction(validGenerativeFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ text: 'This is a long document...' })

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(expect.objectContaining({
          model: 'claude-3-sonnet',
          prompt: expect.stringContaining('Summarize'),
        }))
      })

      it('substitutes template variables in prompt', async () => {
        const fn = await createFunction(validGenerativeFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ text: 'Hello world' })

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(expect.objectContaining({
          prompt: 'Summarize the following text: Hello world',
        }))
      })

      it('calls prompt function when provided', async () => {
        const promptFn = vi.fn((input: { text: string }) => `Custom: ${input.text}`)

        const fn = await createFunction({
          ...validGenerativeFunction,
          prompt: promptFn,
        }, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ text: 'test' })

        expect(promptFn).toHaveBeenCalledWith({ text: 'test' })
        expect(mockEnv.AI.generate).toHaveBeenCalledWith(expect.objectContaining({
          prompt: 'Custom: test',
        }))
      })

      it('passes temperature and maxTokens to AI', async () => {
        const fn = await createFunction(validGenerativeFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ text: 'test' })

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(expect.objectContaining({
          temperature: 0.7,
          maxTokens: 500,
        }))
      })

      it('validates output against schema when provided', async () => {
        mockEnv.AI.generate.mockResolvedValueOnce({
          text: JSON.stringify({ summary: 'A summary', keyPoints: ['point 1'] }),
        })

        const fn = await createFunction({
          ...validGenerativeFunction,
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              keyPoints: { type: 'array', items: { type: 'string' } },
            },
            required: ['summary'],
          },
        }, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ text: 'test' })

        expect(result).toEqual({
          summary: 'A summary',
          keyPoints: ['point 1'],
        })
      })

      it('throws when AI output does not match schema', async () => {
        mockEnv.AI.generate.mockResolvedValueOnce({
          text: JSON.stringify({ invalid: 'response' }),
        })

        const fn = await createFunction({
          ...validGenerativeFunction,
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
        }, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({ text: 'test' })).rejects.toThrow(ExecutionError)
      })

      it('returns stream when stream option is enabled', async () => {
        mockEnv.AI.stream.mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield { text: 'Hello' }
            yield { text: ' world' }
          },
        })

        const fn = await createFunction({
          ...validGenerativeFunction,
          stream: true,
        }, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ text: 'test' })

        expect(result).toBeDefined()
        // Result should be async iterable
        const chunks: string[] = []
        for await (const chunk of result as AsyncIterable<{ text: string }>) {
          chunks.push(chunk.text)
        }
        expect(chunks.join('')).toBe('Hello world')
      })
    })

    describe('AgenticFunction execution', () => {
      it('calls agent runner with configuration', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ query: 'Research AI trends' })

        expect(mockEnv.AGENT_RUNNER.run).toHaveBeenCalledWith(expect.objectContaining({
          agent: 'researcher',
          input: { query: 'Research AI trends' },
          tools: ['web_search', 'read_url', 'summarize'],
          maxIterations: 10,
        }))
      })

      it('passes system prompt to agent', async () => {
        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ query: 'test' })

        expect(mockEnv.AGENT_RUNNER.run).toHaveBeenCalledWith(expect.objectContaining({
          systemPrompt: 'You are a thorough researcher.',
        }))
      })

      it('calls onStep callback for each iteration', async () => {
        const onStep = vi.fn()
        const steps = [
          { iteration: 1, thought: 'I need to search', action: 'web_search', observation: 'Found results' },
          { iteration: 2, thought: 'Now summarize', action: 'summarize', observation: 'Summary done' },
        ]

        mockEnv.AGENT_RUNNER.run.mockImplementationOnce(async ({ onStep: callback }) => {
          for (const step of steps) {
            await callback?.(step)
          }
          return { result: 'complete' }
        })

        const fn = await createFunction({
          ...validAgenticFunction,
          onStep,
        }, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ query: 'test' })

        expect(onStep).toHaveBeenCalledTimes(2)
        expect(onStep).toHaveBeenNthCalledWith(1, steps[0])
        expect(onStep).toHaveBeenNthCalledWith(2, steps[1])
      })

      it('respects maxIterations limit', async () => {
        const fn = await createFunction({
          ...validAgenticFunction,
          maxIterations: 5,
        }, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ query: 'test' })

        expect(mockEnv.AGENT_RUNNER.run).toHaveBeenCalledWith(expect.objectContaining({
          maxIterations: 5,
        }))
      })

      it('throws when agent exceeds maxIterations', async () => {
        mockEnv.AGENT_RUNNER.run.mockRejectedValueOnce(new Error('Max iterations exceeded'))

        const fn = await createFunction(validAgenticFunction, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({ query: 'test' })).rejects.toThrow(ExecutionError)
      })
    })

    describe('HumanFunction execution', () => {
      it('sends notification to channel', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ amount: 100, reason: 'Office supplies' })

        expect(mockEnv.NOTIFICATIONS.send).toHaveBeenCalledWith(expect.objectContaining({
          channel: 'slack',
          message: expect.stringContaining('100'),
        }))
      })

      it('substitutes template variables in prompt', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ amount: 500, reason: 'Team dinner' })

        expect(mockEnv.NOTIFICATIONS.send).toHaveBeenCalledWith(expect.objectContaining({
          message: 'Please approve expense: 500 for Team dinner',
        }))
      })

      it('waits for human response with timeout', async () => {
        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        await fn.execute({ amount: 100, reason: 'test' })

        expect(mockEnv.NOTIFICATIONS.waitForResponse).toHaveBeenCalledWith(expect.objectContaining({
          timeout: 86400000,
        }))
      })

      it('returns human response', async () => {
        mockEnv.NOTIFICATIONS.waitForResponse.mockResolvedValueOnce({
          approved: true,
          comment: 'Looks good!',
        })

        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ amount: 100, reason: 'test' })

        expect(result).toEqual({
          approved: true,
          comment: 'Looks good!',
        })
      })

      it('validates response against form schema', async () => {
        mockEnv.NOTIFICATIONS.waitForResponse.mockResolvedValueOnce({
          approved: 'not a boolean', // Invalid
          comment: 'test',
        })

        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({ amount: 100, reason: 'test' })).rejects.toThrow(ExecutionError)
      })

      it('handles timeout with escalation', async () => {
        mockEnv.NOTIFICATIONS.waitForResponse.mockRejectedValueOnce(new Error('Timeout'))
        mockEnv.NOTIFICATIONS.waitForResponse.mockResolvedValueOnce({ approved: true })

        const fn = await createFunction({
          ...validHumanFunction,
          escalation: {
            timeout: 3600000,
            to: 'email',
          },
        }, { registry: mockRegistry, env: mockEnv })

        const result = await fn.execute({ amount: 100, reason: 'test' })

        expect(mockEnv.NOTIFICATIONS.send).toHaveBeenCalledTimes(2)
        expect(mockEnv.NOTIFICATIONS.send).toHaveBeenLastCalledWith(expect.objectContaining({
          channel: 'email',
        }))
        expect(result).toEqual({ approved: true })
      })

      it('throws when timeout and no escalation', async () => {
        mockEnv.NOTIFICATIONS.waitForResponse.mockRejectedValueOnce(new Error('Timeout'))

        const fn = await createFunction(validHumanFunction, { registry: mockRegistry, env: mockEnv })

        await expect(fn.execute({ amount: 100, reason: 'test' })).rejects.toThrow(ExecutionError)
      })
    })

    describe('Execution events', () => {
      it('emits function.invoked event at start', async () => {
        const onEvent = vi.fn()

        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          onEvent,
        })

        await fn.execute({ items: [] })

        expect(onEvent).toHaveBeenCalledWith('function.invoked', expect.objectContaining({
          functionId: fn.id,
          input: { items: [] },
        }))
      })

      it('emits function.completed event on success', async () => {
        const onEvent = vi.fn()

        const fn = await createFunction(validCodeFunction, {
          registry: mockRegistry,
          env: mockEnv,
          onEvent,
        })

        await fn.execute({ items: [{ price: 10 }] })

        expect(onEvent).toHaveBeenCalledWith('function.completed', expect.objectContaining({
          functionId: fn.id,
          result: 10,
        }))
      })

      it('emits function.failed event on error', async () => {
        const onEvent = vi.fn()

        const fn = await createFunction({
          ...validCodeFunction,
          handler: () => {
            throw new Error('Test error')
          },
        }, {
          registry: mockRegistry,
          env: mockEnv,
          onEvent,
        })

        await expect(fn.execute({})).rejects.toThrow()

        expect(onEvent).toHaveBeenCalledWith('function.failed', expect.objectContaining({
          functionId: fn.id,
          error: expect.stringContaining('Test error'),
        }))
      })

      it('tracks invocation duration', async () => {
        const onEvent = vi.fn()

        const fn = await createFunction({
          ...validCodeFunction,
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 50))
            return 'done'
          },
        }, {
          registry: mockRegistry,
          env: mockEnv,
          onEvent,
        })

        await fn.execute({})

        expect(onEvent).toHaveBeenCalledWith('function.completed', expect.objectContaining({
          duration: expect.any(Number),
        }))

        const completedCall = onEvent.mock.calls.find(call => call[0] === 'function.completed')
        expect(completedCall[1].duration).toBeGreaterThanOrEqual(50)
      })
    })
  })

  // ==========================================================================
  // 5. COMPOSITION TESTS
  // ==========================================================================

  describe('Composition', () => {
    describe('Function chaining', () => {
      it('can chain functions with .then()', async () => {
        const fn1 = await createFunction({
          name: 'double',
          type: 'code',
          handler: (input: { value: number }) => ({ value: input.value * 2 }),
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'addTen',
          type: 'code',
          handler: (input: { value: number }) => ({ value: input.value + 10 }),
        }, { registry: mockRegistry, env: mockEnv })

        const chained = fn1.then(fn2)

        const result = await chained.execute({ value: 5 })

        expect(result).toEqual({ value: 20 }) // (5 * 2) + 10
      })

      it('can chain multiple functions', async () => {
        const fn1 = await createFunction({
          name: 'step1',
          type: 'code',
          handler: (input: { value: number }) => ({ value: input.value + 1 }),
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'step2',
          type: 'code',
          handler: (input: { value: number }) => ({ value: input.value * 2 }),
        }, { registry: mockRegistry, env: mockEnv })

        const fn3 = await createFunction({
          name: 'step3',
          type: 'code',
          handler: (input: { value: number }) => ({ value: input.value - 3 }),
        }, { registry: mockRegistry, env: mockEnv })

        const chained = fn1.then(fn2).then(fn3)

        const result = await chained.execute({ value: 5 })

        expect(result).toEqual({ value: 9 }) // ((5 + 1) * 2) - 3
      })

      it('chained function has combined name', async () => {
        const fn1 = await createFunction({
          name: 'fetch',
          type: 'code',
          handler: () => ({}),
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'transform',
          type: 'code',
          handler: () => ({}),
        }, { registry: mockRegistry, env: mockEnv })

        const chained = fn1.then(fn2)

        expect(chained.name).toBe('fetch -> transform')
      })

      it('chain stops on error', async () => {
        const fn1 = await createFunction({
          name: 'fail',
          type: 'code',
          handler: () => {
            throw new Error('First fails')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'never',
          type: 'code',
          handler: vi.fn(),
        }, { registry: mockRegistry, env: mockEnv })

        const chained = fn1.then(fn2)

        await expect(chained.execute({})).rejects.toThrow('First fails')
        expect(fn2.handler).not.toHaveBeenCalled()
      })
    })

    describe('Parallel execution', () => {
      it('can execute functions in parallel with .all()', async () => {
        const fn1 = await createFunction({
          name: 'task1',
          type: 'code',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 50))
            return { result: 'one' }
          },
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'task2',
          type: 'code',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 50))
            return { result: 'two' }
          },
        }, { registry: mockRegistry, env: mockEnv })

        const parallel = createFunction.all([fn1, fn2])

        const start = Date.now()
        const results = await parallel.execute({})
        const duration = Date.now() - start

        expect(results).toEqual([{ result: 'one' }, { result: 'two' }])
        expect(duration).toBeLessThan(100) // Should run in parallel
      })

      it('parallel execution fails if any function fails', async () => {
        const fn1 = await createFunction({
          name: 'success',
          type: 'code',
          handler: () => 'ok',
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'failure',
          type: 'code',
          handler: () => {
            throw new Error('Failed')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const parallel = createFunction.all([fn1, fn2])

        await expect(parallel.execute({})).rejects.toThrow('Failed')
      })

      it('can use allSettled for fault-tolerant parallel execution', async () => {
        const fn1 = await createFunction({
          name: 'success',
          type: 'code',
          handler: () => 'ok',
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'failure',
          type: 'code',
          handler: () => {
            throw new Error('Failed')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const parallel = createFunction.allSettled([fn1, fn2])

        const results = await parallel.execute({})

        expect(results).toEqual([
          { status: 'fulfilled', value: 'ok' },
          { status: 'rejected', reason: expect.any(Error) },
        ])
      })
    })

    describe('Conditional execution', () => {
      it('can conditionally execute with .if()', async () => {
        const fn = await createFunction({
          name: 'conditionalFn',
          type: 'code',
          handler: (input: { value: number }) => ({ doubled: input.value * 2 }),
        }, { registry: mockRegistry, env: mockEnv })

        const conditional = fn.if((input: { value: number }) => input.value > 10)

        const result1 = await conditional.execute({ value: 15 })
        expect(result1).toEqual({ doubled: 30 })

        const result2 = await conditional.execute({ value: 5 })
        expect(result2).toBeNull() // Skipped
      })

      it('can provide else branch', async () => {
        const mainFn = await createFunction({
          name: 'main',
          type: 'code',
          handler: () => 'main executed',
        }, { registry: mockRegistry, env: mockEnv })

        const elseFn = await createFunction({
          name: 'else',
          type: 'code',
          handler: () => 'else executed',
        }, { registry: mockRegistry, env: mockEnv })

        const conditional = mainFn.if(() => false).else(elseFn)

        const result = await conditional.execute({})

        expect(result).toBe('else executed')
      })
    })

    describe('Transform and map', () => {
      it('can transform output with .map()', async () => {
        const fn = await createFunction({
          name: 'getData',
          type: 'code',
          handler: () => ({ items: [1, 2, 3], total: 6 }),
        }, { registry: mockRegistry, env: mockEnv })

        const mapped = fn.map(
          (output: { items: number[]; total: number }) => output.items
        )

        const result = await mapped.execute({})

        expect(result).toEqual([1, 2, 3])
      })

      it('can transform input with .contramap()', async () => {
        const fn = await createFunction({
          name: 'sumValues',
          type: 'code',
          handler: (input: { values: number[] }) => input.values.reduce((a, b) => a + b, 0),
        }, { registry: mockRegistry, env: mockEnv })

        const contramapped = fn.contramap(
          (input: { items: Array<{ value: number }> }) => ({
            values: input.items.map(i => i.value),
          })
        )

        const result = await contramapped.execute({
          items: [{ value: 1 }, { value: 2 }, { value: 3 }],
        })

        expect(result).toBe(6)
      })
    })

    describe('Error handling in composition', () => {
      it('can catch errors with .catch()', async () => {
        const fn = await createFunction({
          name: 'failingFn',
          type: 'code',
          handler: () => {
            throw new Error('Something went wrong')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const recovered = fn.catch(() => 'recovered')

        const result = await recovered.execute({})

        expect(result).toBe('recovered')
      })

      it('catch handler receives error', async () => {
        const fn = await createFunction({
          name: 'failingFn',
          type: 'code',
          handler: () => {
            throw new Error('Specific error')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const recovered = fn.catch((error: Error) => `Caught: ${error.message}`)

        const result = await recovered.execute({})

        expect(result).toBe('Caught: Specific error')
      })

      it('can use .finally() for cleanup', async () => {
        const cleanup = vi.fn()

        const fn = await createFunction({
          name: 'withCleanup',
          type: 'code',
          handler: () => 'done',
        }, { registry: mockRegistry, env: mockEnv })

        const withFinally = fn.finally(cleanup)

        await withFinally.execute({})

        expect(cleanup).toHaveBeenCalled()
      })

      it('.finally() runs even on error', async () => {
        const cleanup = vi.fn()

        const fn = await createFunction({
          name: 'failingWithCleanup',
          type: 'code',
          handler: () => {
            throw new Error('Failed')
          },
        }, { registry: mockRegistry, env: mockEnv })

        const withFinally = fn.finally(cleanup)

        await expect(withFinally.execute({})).rejects.toThrow()
        expect(cleanup).toHaveBeenCalled()
      })
    })

    describe('Pipeline composition', () => {
      it('can create complex pipelines', async () => {
        // Fetch -> Validate -> Transform -> Store
        const fetchFn = await createFunction({
          name: 'fetch',
          type: 'code',
          handler: (input: { url: string }) => ({ data: { value: 42 }, url: input.url }),
        }, { registry: mockRegistry, env: mockEnv })

        const validateFn = await createFunction({
          name: 'validate',
          type: 'code',
          handler: (input: { data: { value: number } }) => {
            if (input.data.value < 0) throw new Error('Invalid')
            return input.data
          },
        }, { registry: mockRegistry, env: mockEnv })

        const transformFn = await createFunction({
          name: 'transform',
          type: 'code',
          handler: (input: { value: number }) => ({ processed: input.value * 2 }),
        }, { registry: mockRegistry, env: mockEnv })

        const storeFn = await createFunction({
          name: 'store',
          type: 'code',
          handler: (input: { processed: number }) => ({
            stored: true,
            value: input.processed,
          }),
        }, { registry: mockRegistry, env: mockEnv })

        const pipeline = fetchFn
          .then(validateFn)
          .then(transformFn)
          .then(storeFn)

        const result = await pipeline.execute({ url: 'https://api.example.com' })

        expect(result).toEqual({ stored: true, value: 84 })
      })

      it('pipeline tracks intermediate results', async () => {
        const results: unknown[] = []

        const fn1 = await createFunction({
          name: 'step1',
          type: 'code',
          handler: () => {
            results.push('step1')
            return { step: 1 }
          },
        }, { registry: mockRegistry, env: mockEnv })

        const fn2 = await createFunction({
          name: 'step2',
          type: 'code',
          handler: () => {
            results.push('step2')
            return { step: 2 }
          },
        }, { registry: mockRegistry, env: mockEnv })

        const pipeline = fn1.then(fn2)

        await pipeline.execute({})

        expect(results).toEqual(['step1', 'step2'])
      })
    })

    describe('Cross-type composition', () => {
      it('can chain code and generative functions', async () => {
        const prepareFn = await createFunction({
          name: 'prepare',
          type: 'code',
          handler: (input: { topic: string }) => ({
            text: `Write about ${input.topic} in detail.`,
          }),
        }, { registry: mockRegistry, env: mockEnv })

        const generateFn = await createFunction({
          ...validGenerativeFunction,
          name: 'generate',
          prompt: '{{text}}',
        }, { registry: mockRegistry, env: mockEnv })

        const chained = prepareFn.then(generateFn)

        mockEnv.AI.generate.mockResolvedValueOnce({ text: 'AI generated content' })

        await chained.execute({ topic: 'artificial intelligence' })

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(expect.objectContaining({
          prompt: 'Write about artificial intelligence in detail.',
        }))
      })

      it('can chain human approval with code execution', async () => {
        const approveFn = await createFunction({
          name: 'approve',
          type: 'human',
          channel: 'slack',
          timeout: 60000,
        }, { registry: mockRegistry, env: mockEnv })

        const processFn = await createFunction({
          name: 'process',
          type: 'code',
          handler: (input: { approved: boolean }) => {
            if (!input.approved) throw new Error('Not approved')
            return { processed: true }
          },
        }, { registry: mockRegistry, env: mockEnv })

        mockEnv.NOTIFICATIONS.waitForResponse.mockResolvedValueOnce({ approved: true })

        const chained = approveFn.then(processFn)

        const result = await chained.execute({ request: 'Test request' })

        expect(result).toEqual({ processed: true })
      })

      it('can compose agentic with code functions', async () => {
        const researchFn = await createFunction({
          ...validAgenticFunction,
          name: 'research',
        }, { registry: mockRegistry, env: mockEnv })

        const formatFn = await createFunction({
          name: 'format',
          type: 'code',
          handler: (input: { result: string }) => ({
            formatted: `Research Results: ${input.result}`,
          }),
        }, { registry: mockRegistry, env: mockEnv })

        mockEnv.AGENT_RUNNER.run.mockResolvedValueOnce({ result: 'AI findings' })

        const chained = researchFn.then(formatFn)

        const result = await chained.execute({ query: 'What is AI?' })

        expect(result).toEqual({ formatted: 'Research Results: AI findings' })
      })
    })
  })

  // ==========================================================================
  // 6. SERIALIZATION & INTROSPECTION
  // ==========================================================================

  describe('Serialization & Introspection', () => {
    it('can serialize function definition to JSON', async () => {
      const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

      const json = fn.toJSON()

      expect(json).toEqual(expect.objectContaining({
        id: fn.id,
        name: 'calculateTotal',
        type: 'code',
        description: 'Calculate total from items',
      }))
    })

    it('does not serialize handler function', async () => {
      const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

      const json = fn.toJSON()

      expect(json.handler).toBeUndefined()
    })

    it('can get function metadata', async () => {
      const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

      const meta = fn.getMetadata()

      expect(meta).toEqual(expect.objectContaining({
        id: fn.id,
        name: 'calculateTotal',
        type: 'code',
        createdAt: expect.any(Date),
        invocationCount: 0,
      }))
    })

    it('tracks invocation count', async () => {
      const fn = await createFunction(validCodeFunction, { registry: mockRegistry, env: mockEnv })

      await fn.execute({ items: [] })
      await fn.execute({ items: [] })
      await fn.execute({ items: [] })

      const meta = fn.getMetadata()

      expect(meta.invocationCount).toBe(3)
    })

    it('can get invocation history', async () => {
      const fn = await createFunction(validCodeFunction, {
        registry: mockRegistry,
        env: mockEnv,
        state: mockState,
      })

      await fn.execute({ items: [{ price: 10 }] })
      await fn.execute({ items: [{ price: 20 }] })

      const history = await fn.getInvocationHistory()

      expect(history).toHaveLength(2)
      expect(history[0]).toEqual(expect.objectContaining({
        input: { items: [{ price: 10 }] },
        output: 10,
        status: 'completed',
      }))
    })

    it('composed function describes its pipeline', async () => {
      const fn1 = await createFunction({
        name: 'step1',
        type: 'code',
        handler: () => ({}),
      }, { registry: mockRegistry, env: mockEnv })

      const fn2 = await createFunction({
        name: 'step2',
        type: 'code',
        handler: () => ({}),
      }, { registry: mockRegistry, env: mockEnv })

      const composed = fn1.then(fn2)

      expect(composed.describe()).toEqual({
        type: 'pipeline',
        steps: [
          { name: 'step1', type: 'code' },
          { name: 'step2', type: 'code' },
        ],
      })
    })
  })
})
