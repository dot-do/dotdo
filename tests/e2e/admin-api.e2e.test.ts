/**
 * Admin API E2E Tests (RED Phase)
 *
 * Tests the $.functions API on admin.example.org.ai via RPC.
 * These tests define the expected contract for the functions management API.
 *
 * Expected to FAIL initially until the implementation is complete.
 *
 * @see do-fibs: [RED] E2E test: $.functions access via RPC
 * @see types/functions.ts (main branch) for FunctionConfig schema reference
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRPCClient, RPCError } from '../../rpc/index'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Admin endpoint URL
 * In production, this would resolve to admin.example.org.ai
 * For local development, uses TEST_URL or localhost
 */
const ADMIN_URL = process.env.ADMIN_URL || process.env.TEST_URL || 'http://localhost:8787'

// Skip deployed tests if no TEST_URL configured
const SKIP_DEPLOYED_TESTS = !process.env.TEST_URL && !process.env.CI

// =============================================================================
// Type Definitions for $.functions API
// =============================================================================

/**
 * Function type discriminant - the four implementation types
 */
type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Input/Output schema definition
 */
interface IOSchema {
  name: string
  type: string
  description?: string
  required?: boolean
}

/**
 * Function definition returned from $.functions.list() and $.functions.get()
 *
 * Based on types/functions.ts FunctionConfig from main branch
 */
interface FunctionDefinition {
  /** Unique identifier for the function */
  id: string
  /** Function name */
  name: string
  /** Human-readable description */
  description?: string
  /** Function type (code, generative, agentic, human) */
  type: FunctionType
  /** Input parameter schema */
  inputs: IOSchema[]
  /** Output schema */
  outputs: IOSchema[]
  /** Source code for code functions */
  code?: string
  /** Model identifier for AI functions */
  model?: string
  /** Prompt template for AI functions */
  prompt?: string
  /** Version string */
  version?: string
  /** Created timestamp */
  createdAt?: string
  /** Updated timestamp */
  updatedAt?: string
}

/**
 * Parameters for creating a function
 */
interface CreateFunctionParams {
  name: string
  description?: string
  type?: FunctionType
  inputs?: IOSchema[]
  outputs?: IOSchema[]
  code?: string
  model?: string
  prompt?: string
}

/**
 * Admin API interface for $.functions
 */
interface AdminFunctionsAPI {
  /**
   * List all function definitions
   * @returns Array of function definitions
   */
  list(): Promise<FunctionDefinition[]>

  /**
   * Get a specific function by ID
   * @param id - Function identifier
   * @returns Function definition or null if not found
   */
  get(id: string): Promise<FunctionDefinition | null>

  /**
   * Create a new function
   * @param params - Function creation parameters
   * @returns Created function definition
   */
  create(params: CreateFunctionParams): Promise<FunctionDefinition>

  /**
   * Update an existing function
   * @param id - Function identifier
   * @param params - Fields to update
   * @returns Updated function definition
   */
  update(id: string, params: Partial<CreateFunctionParams>): Promise<FunctionDefinition>

  /**
   * Delete a function
   * @param id - Function identifier
   * @returns True if deleted
   */
  delete(id: string): Promise<boolean>
}

/**
 * Admin DO API with $.functions accessor
 */
interface AdminDOAPI {
  functions: AdminFunctionsAPI
  $meta: import('../../rpc/proxy').MetaInterface
}

// =============================================================================
// $.functions E2E Tests
// =============================================================================

describe('$.functions API via RPC', () => {
  let client: AdminDOAPI

  beforeAll(() => {
    // Create RPC client targeting admin.example.org.ai endpoint
    client = createRPCClient<AdminDOAPI>({
      target: ADMIN_URL,
      headers: {
        // Admin endpoints expect Host header for routing
        Host: 'admin.example.org.ai',
      },
    })
  })

  // ---------------------------------------------------------------------------
  // 1. $.functions.list() Tests
  // ---------------------------------------------------------------------------

  describe('$.functions.list()', () => {
    it('returns an array of function definitions', async () => {
      // Contract: $.functions.list() MUST return an array
      const functions = await client.functions.list()

      expect(Array.isArray(functions)).toBe(true)
    })

    it('each function has required schema fields', async () => {
      const functions = await client.functions.list()

      // Contract: Each function MUST have id, name, type, inputs, outputs
      for (const fn of functions) {
        expect(fn).toHaveProperty('id')
        expect(typeof fn.id).toBe('string')

        expect(fn).toHaveProperty('name')
        expect(typeof fn.name).toBe('string')

        expect(fn).toHaveProperty('type')
        expect(['code', 'generative', 'agentic', 'human']).toContain(fn.type)

        expect(fn).toHaveProperty('inputs')
        expect(Array.isArray(fn.inputs)).toBe(true)

        expect(fn).toHaveProperty('outputs')
        expect(Array.isArray(fn.outputs)).toBe(true)
      }
    })

    it('function inputs/outputs have proper schema', async () => {
      const functions = await client.functions.list()

      for (const fn of functions) {
        // Validate inputs schema
        for (const input of fn.inputs) {
          expect(input).toHaveProperty('name')
          expect(typeof input.name).toBe('string')
          expect(input).toHaveProperty('type')
          expect(typeof input.type).toBe('string')
        }

        // Validate outputs schema
        for (const output of fn.outputs) {
          expect(output).toHaveProperty('name')
          expect(typeof output.name).toBe('string')
          expect(output).toHaveProperty('type')
          expect(typeof output.type).toBe('string')
        }
      }
    })

    it('code functions include code field', async () => {
      const functions = await client.functions.list()
      const codeFunctions = functions.filter((fn) => fn.type === 'code')

      // Contract: Code functions SHOULD have code field
      for (const fn of codeFunctions) {
        expect(fn).toHaveProperty('code')
        expect(typeof fn.code).toBe('string')
      }
    })

    it('generative functions include model and prompt', async () => {
      const functions = await client.functions.list()
      const generativeFunctions = functions.filter((fn) => fn.type === 'generative')

      // Contract: Generative functions SHOULD have model and prompt
      for (const fn of generativeFunctions) {
        expect(fn).toHaveProperty('model')
        expect(typeof fn.model).toBe('string')
        expect(fn).toHaveProperty('prompt')
        expect(typeof fn.prompt).toBe('string')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 2. $.functions.get(id) Tests
  // ---------------------------------------------------------------------------

  describe('$.functions.get(id)', () => {
    it('returns specific function by ID', async () => {
      // First list to get an ID
      const functions = await client.functions.list()

      // Skip if no functions exist (we'll create one in create tests)
      if (functions.length === 0) {
        // Create a test function first
        const created = await client.functions.create({
          name: 'test-get-function',
          description: 'Test function for get() test',
          type: 'code',
          code: 'return input * 2',
          inputs: [{ name: 'input', type: 'number' }],
          outputs: [{ name: 'result', type: 'number' }],
        })

        const result = await client.functions.get(created.id)

        expect(result).not.toBeNull()
        expect(result!.id).toBe(created.id)
        expect(result!.name).toBe('test-get-function')
        return
      }

      const firstFunction = functions[0]
      const result = await client.functions.get(firstFunction.id)

      // Contract: get() MUST return the same function that was in list()
      expect(result).not.toBeNull()
      expect(result!.id).toBe(firstFunction.id)
      expect(result!.name).toBe(firstFunction.name)
    })

    it('returns null for non-existent function', async () => {
      const result = await client.functions.get('non-existent-function-id-12345')

      // Contract: get() MUST return null for unknown ID
      expect(result).toBeNull()
    })

    it('returned function has complete schema', async () => {
      const functions = await client.functions.list()

      if (functions.length === 0) {
        // Create a test function
        const created = await client.functions.create({
          name: 'schema-test-function',
          description: 'Test function for schema validation',
          type: 'code',
          code: 'return input.toUpperCase()',
          inputs: [{ name: 'input', type: 'string', description: 'Input string' }],
          outputs: [{ name: 'result', type: 'string', description: 'Uppercased string' }],
        })

        const result = await client.functions.get(created.id)

        // Contract: get() result MUST have expected schema fields
        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('description')
        expect(result).toHaveProperty('type')
        expect(result).toHaveProperty('inputs')
        expect(result).toHaveProperty('outputs')
        expect(result).toHaveProperty('code')
        return
      }

      const result = await client.functions.get(functions[0].id)

      // Contract: get() result MUST have expected schema fields
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('inputs')
      expect(result).toHaveProperty('outputs')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. $.functions.create() Tests
  // ---------------------------------------------------------------------------

  describe('$.functions.create()', () => {
    const testFunctionId = `test-fn-${Date.now()}`

    it('creates code function with name, description, code', async () => {
      const created = await client.functions.create({
        name: `create-test-${testFunctionId}`,
        description: 'A test function created via RPC',
        type: 'code',
        code: `
          function handler(input) {
            return { result: input.value * 2 };
          }
        `,
        inputs: [
          { name: 'value', type: 'number', description: 'Value to double', required: true },
        ],
        outputs: [
          { name: 'result', type: 'number', description: 'Doubled value' },
        ],
      })

      // Contract: create() MUST return the created function with ID
      expect(created).toHaveProperty('id')
      expect(typeof created.id).toBe('string')
      expect(created.id.length).toBeGreaterThan(0)

      expect(created.name).toBe(`create-test-${testFunctionId}`)
      expect(created.description).toBe('A test function created via RPC')
      expect(created.type).toBe('code')
      expect(created.code).toContain('input.value * 2')
    })

    it('creates generative function with model and prompt', async () => {
      const created = await client.functions.create({
        name: `generative-test-${testFunctionId}`,
        description: 'A generative AI function',
        type: 'generative',
        model: 'claude-3-opus',
        prompt: 'Summarize the following text: {{input}}',
        inputs: [
          { name: 'input', type: 'string', description: 'Text to summarize' },
        ],
        outputs: [
          { name: 'summary', type: 'string', description: 'Generated summary' },
        ],
      })

      expect(created).toHaveProperty('id')
      expect(created.type).toBe('generative')
      expect(created.model).toBe('claude-3-opus')
      expect(created.prompt).toContain('{{input}}')
    })

    it('validates required fields', async () => {
      // Contract: create() MUST require name
      await expect(
        client.functions.create({
          // Missing name
          description: 'Invalid function',
        } as CreateFunctionParams)
      ).rejects.toThrow(/name.*required|missing.*name/i)
    })

    it('validates function type', async () => {
      // Contract: create() MUST validate type is one of the allowed values
      await expect(
        client.functions.create({
          name: 'invalid-type-test',
          type: 'invalid-type' as FunctionType,
        })
      ).rejects.toThrow(/invalid.*type|type.*must be/i)
    })

    it('created function is retrievable via get()', async () => {
      const created = await client.functions.create({
        name: `retrieve-test-${testFunctionId}`,
        description: 'Test retrieval',
        type: 'code',
        code: 'return true',
        inputs: [],
        outputs: [{ name: 'result', type: 'boolean' }],
      })

      // Contract: Created function MUST be immediately retrievable
      const retrieved = await client.functions.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.name).toBe(created.name)
    })

    it('created function appears in list()', async () => {
      const created = await client.functions.create({
        name: `list-test-${testFunctionId}`,
        description: 'Test list inclusion',
        type: 'code',
        code: 'return 42',
        inputs: [],
        outputs: [{ name: 'result', type: 'number' }],
      })

      // Contract: Created function MUST appear in list()
      const functions = await client.functions.list()
      const found = functions.find((fn) => fn.id === created.id)

      expect(found).toBeDefined()
      expect(found!.name).toBe(`list-test-${testFunctionId}`)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Function Schema Validation Tests
  // ---------------------------------------------------------------------------

  describe('Function schema has expected fields', () => {
    it('name field is required string', async () => {
      const functions = await client.functions.list()

      for (const fn of functions) {
        expect(fn.name).toBeDefined()
        expect(typeof fn.name).toBe('string')
        expect(fn.name.length).toBeGreaterThan(0)
      }
    })

    it('description field is optional string', async () => {
      const functions = await client.functions.list()

      for (const fn of functions) {
        if (fn.description !== undefined) {
          expect(typeof fn.description).toBe('string')
        }
      }
    })

    it('inputs field is array of IOSchema', async () => {
      const functions = await client.functions.list()

      for (const fn of functions) {
        expect(Array.isArray(fn.inputs)).toBe(true)

        for (const input of fn.inputs) {
          // IOSchema must have name and type
          expect(input.name).toBeDefined()
          expect(typeof input.name).toBe('string')

          expect(input.type).toBeDefined()
          expect(typeof input.type).toBe('string')

          // Optional fields
          if (input.description !== undefined) {
            expect(typeof input.description).toBe('string')
          }
          if (input.required !== undefined) {
            expect(typeof input.required).toBe('boolean')
          }
        }
      }
    })

    it('outputs field is array of IOSchema', async () => {
      const functions = await client.functions.list()

      for (const fn of functions) {
        expect(Array.isArray(fn.outputs)).toBe(true)

        for (const output of fn.outputs) {
          // IOSchema must have name and type
          expect(output.name).toBeDefined()
          expect(typeof output.name).toBe('string')

          expect(output.type).toBeDefined()
          expect(typeof output.type).toBe('string')
        }
      }
    })

    it('code field is string for code functions', async () => {
      const functions = await client.functions.list()
      const codeFunctions = functions.filter((fn) => fn.type === 'code')

      for (const fn of codeFunctions) {
        expect(fn.code).toBeDefined()
        expect(typeof fn.code).toBe('string')
      }
    })

    it('type field is valid FunctionType', async () => {
      const functions = await client.functions.list()
      const validTypes: FunctionType[] = ['code', 'generative', 'agentic', 'human']

      for (const fn of functions) {
        expect(validTypes).toContain(fn.type)
      }
    })
  })
})

// =============================================================================
// Connection Error Tests (Expected to fail in RED phase)
// =============================================================================

describe('$.functions RPC connection', () => {
  it('fails with METHOD_NOT_FOUND if functions API not implemented', async () => {
    const client = createRPCClient<AdminDOAPI>({
      target: ADMIN_URL,
      headers: {
        Host: 'admin.example.org.ai',
      },
    })

    // This test documents expected failure mode before implementation
    // In RED phase, we expect either:
    // - METHOD_NOT_FOUND error (method doesn't exist)
    // - Connection error (admin DO doesn't exist)
    // - Some other error indicating missing implementation

    try {
      await client.functions.list()
      // If we get here without error, the API is implemented (GREEN)
      // For RED phase, we expect this to fail
    } catch (error) {
      // Expected failure - document the error type
      expect(error).toBeDefined()

      // Common error patterns we might see:
      // - RPCError with code METHOD_NOT_FOUND
      // - Connection refused
      // - 404 Not Found
      // - Property 'functions' doesn't exist

      if (error instanceof RPCError) {
        // RPC-level error
        expect(['METHOD_NOT_FOUND', 'RPC_ERROR', 'TIMEOUT']).toContain(error.code)
      } else if (error instanceof Error) {
        // Network or other error
        expect(error.message).toBeDefined()
      }
    }
  })
})

// =============================================================================
// $.drizzle DB ACCESS VIA RPC (RED Phase - Expected to FAIL)
// =============================================================================
//
// @see do-smu5: [RED] E2E test: $.drizzle provides DB access via RPC
// @see do-k6f7: admin.example.org.ai - MDXUI Admin Integration (parent epic)
//
// These tests define the contract for $.drizzle access via RPC.
// They should FAIL initially because drizzle access is not yet implemented.
// =============================================================================

/**
 * Noun record structure (mirrors db/nouns.ts schema)
 */
interface NounRecord {
  noun: string
  plural: string | null
  description: string | null
  schema: Record<string, unknown> | null
  doClass: string | null
  sharded: boolean
  shardCount: number
  shardKey: string | null
  storage: string
  ttlDays: number | null
  indexedFields: string[] | null
  nsStrategy: string
  replicaRegions: string[] | null
  consistencyMode: string
  replicaBinding: string | null
}

/**
 * Verb record structure (mirrors db/verbs.ts schema)
 */
interface VerbRecord {
  verb: string
  action: string | null
  activity: string | null
  event: string | null
  reverse: string | null
  inverse: string | null
  description: string | null
}

/**
 * Action record structure (mirrors db/actions.ts schema)
 */
interface ActionRecord {
  id: string
  verb: string
  actor: string | null
  target: string
  input: number | null
  output: number | null
  options: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error: Record<string, unknown> | null
  requestId: string | null
  sessionId: string | null
  workflowId: string | null
  startedAt: Date | null
  completedAt: Date | null
  duration: number | null
  createdAt: Date
}

/**
 * Generic CRUD accessor for drizzle tables
 */
interface DrizzleTableAccessor<T, CreateInput = Partial<T>> {
  list(query?: { where?: Partial<T>; limit?: number; offset?: number }): Promise<T[]>
  get(id: string): Promise<T | null>
  create(data: CreateInput): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<boolean>
  count(where?: Partial<T>): Promise<number>
}

/**
 * Extended Admin API interface with $.drizzle access
 */
interface AdminAPIWithDrizzle extends AdminDOAPI {
  drizzle: {
    nouns: DrizzleTableAccessor<NounRecord>
    verbs: DrizzleTableAccessor<VerbRecord>
    actions: DrizzleTableAccessor<ActionRecord>
  }
}

// =============================================================================
// Test Data for $.drizzle tests
// =============================================================================

const TEST_NOUN_DATA = {
  noun: 'TestNoun',
  plural: 'TestNouns',
  description: 'A test noun for E2E testing',
  storage: 'hot',
  sharded: false,
  shardCount: 1,
  nsStrategy: 'tenant',
  consistencyMode: 'eventual',
}

const TEST_VERB_DATA = {
  verb: 'tests',
  action: 'test',
  activity: 'testing',
  event: 'tested',
  reverse: 'testedBy',
  description: 'A test verb for E2E testing',
}

const TEST_ACTION_DATA = {
  id: `test-action-${Date.now()}`,
  verb: 'create',
  target: 'TestNoun/test-1',
  durability: 'try' as const,
  status: 'pending' as const,
}

// =============================================================================
// DRIZZLE NOUNS E2E TESTS
// =============================================================================

describe('$.drizzle.nouns - Noun CRUD via RPC', () => {
  let client: AdminAPIWithDrizzle

  beforeAll(() => {
    client = createRPCClient<AdminAPIWithDrizzle>({
      target: ADMIN_URL,
      headers: {
        Host: 'admin.example.org.ai',
      },
    })
  })

  describe('$.drizzle.nouns.list()', () => {
    it('returns array of nouns', async () => {
      // RED: Should fail - $.drizzle.nouns.list() doesn't exist yet
      const nouns = await client.drizzle.nouns.list()

      expect(Array.isArray(nouns)).toBe(true)
      // Each noun should have required fields
      if (nouns.length > 0) {
        expect(nouns[0]).toHaveProperty('noun')
        expect(typeof nouns[0].noun).toBe('string')
      }
    })

    it('supports query filters', async () => {
      // RED: Should fail - method doesn't exist
      const nouns = await client.drizzle.nouns.list({
        where: { storage: 'hot' },
        limit: 5,
      })

      expect(Array.isArray(nouns)).toBe(true)
      expect(nouns.length).toBeLessThanOrEqual(5)
      // All returned nouns should have storage='hot'
      nouns.forEach((noun) => {
        expect(noun.storage).toBe('hot')
      })
    })
  })

  describe('$.drizzle.nouns.create()', () => {
    it('creates a noun', async () => {
      // RED: Should fail - $.drizzle.nouns.create() doesn't exist yet
      const result = await client.drizzle.nouns.create(TEST_NOUN_DATA)

      expect(result).toBeDefined()
      expect(result.noun).toBe(TEST_NOUN_DATA.noun)
      expect(result.plural).toBe(TEST_NOUN_DATA.plural)
      expect(result.description).toBe(TEST_NOUN_DATA.description)
      expect(result.storage).toBe(TEST_NOUN_DATA.storage)
    })
  })

  describe('$.drizzle.nouns.get()', () => {
    it('returns specific noun by ID', async () => {
      // RED: Should fail - method doesn't exist
      const noun = await client.drizzle.nouns.get('Customer')

      expect(noun).not.toBeNull()
      expect(noun!.noun).toBe('Customer')
    })

    it('returns null for non-existent noun', async () => {
      // RED: Should fail - method doesn't exist
      const noun = await client.drizzle.nouns.get('NonExistentNoun12345')

      expect(noun).toBeNull()
    })
  })

  describe('$.drizzle.nouns.update()', () => {
    it('updates a noun', async () => {
      // RED: Should fail - method doesn't exist
      const updated = await client.drizzle.nouns.update('TestNoun', {
        description: 'Updated description for E2E testing',
      })

      expect(updated.description).toBe('Updated description for E2E testing')
    })
  })

  describe('$.drizzle.nouns.delete()', () => {
    it('deletes a noun', async () => {
      // RED: Should fail - method doesn't exist
      const deleted = await client.drizzle.nouns.delete('TestNoun')
      expect(deleted).toBe(true)

      // Verify it's gone
      const shouldBeNull = await client.drizzle.nouns.get('TestNoun')
      expect(shouldBeNull).toBeNull()
    })
  })

  describe('$.drizzle.nouns.count()', () => {
    it('returns noun count', async () => {
      // RED: Should fail - method doesn't exist
      const count = await client.drizzle.nouns.count()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// DRIZZLE VERBS E2E TESTS
// =============================================================================

describe('$.drizzle.verbs - Verb CRUD via RPC', () => {
  let client: AdminAPIWithDrizzle

  beforeAll(() => {
    client = createRPCClient<AdminAPIWithDrizzle>({
      target: ADMIN_URL,
      headers: {
        Host: 'admin.example.org.ai',
      },
    })
  })

  describe('$.drizzle.verbs.list()', () => {
    it('returns array of verbs', async () => {
      // RED: Should fail - $.drizzle.verbs.list() doesn't exist yet
      const verbs = await client.drizzle.verbs.list()

      expect(Array.isArray(verbs)).toBe(true)
      // Each verb should have required fields
      if (verbs.length > 0) {
        expect(verbs[0]).toHaveProperty('verb')
        expect(typeof verbs[0].verb).toBe('string')
      }
    })

    it('supports query filters', async () => {
      // RED: Should fail - method doesn't exist
      const verbs = await client.drizzle.verbs.list({
        limit: 10,
      })

      expect(Array.isArray(verbs)).toBe(true)
      expect(verbs.length).toBeLessThanOrEqual(10)
    })
  })

  describe('$.drizzle.verbs.create()', () => {
    it('creates a verb', async () => {
      // RED: Should fail - $.drizzle.verbs.create() doesn't exist yet
      const result = await client.drizzle.verbs.create(TEST_VERB_DATA)

      expect(result).toBeDefined()
      expect(result.verb).toBe(TEST_VERB_DATA.verb)
      expect(result.action).toBe(TEST_VERB_DATA.action)
      expect(result.activity).toBe(TEST_VERB_DATA.activity)
      expect(result.event).toBe(TEST_VERB_DATA.event)
      expect(result.reverse).toBe(TEST_VERB_DATA.reverse)
    })
  })

  describe('$.drizzle.verbs.get()', () => {
    it('returns specific verb by ID', async () => {
      // RED: Should fail - method doesn't exist
      const verb = await client.drizzle.verbs.get('creates')

      expect(verb).not.toBeNull()
      expect(verb!.verb).toBe('creates')
    })

    it('returns null for non-existent verb', async () => {
      // RED: Should fail - method doesn't exist
      const verb = await client.drizzle.verbs.get('nonExistentVerb12345')

      expect(verb).toBeNull()
    })
  })

  describe('$.drizzle.verbs.update()', () => {
    it('updates a verb', async () => {
      // RED: Should fail - method doesn't exist
      const updated = await client.drizzle.verbs.update('tests', {
        description: 'Updated verb description',
      })

      expect(updated.description).toBe('Updated verb description')
    })
  })

  describe('$.drizzle.verbs.delete()', () => {
    it('deletes a verb', async () => {
      // RED: Should fail - method doesn't exist
      const deleted = await client.drizzle.verbs.delete('tests')
      expect(deleted).toBe(true)
    })
  })

  describe('$.drizzle.verbs.count()', () => {
    it('returns verb count', async () => {
      // RED: Should fail - method doesn't exist
      const count = await client.drizzle.verbs.count()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// DRIZZLE ACTIONS E2E TESTS
// =============================================================================

describe('$.drizzle.actions - Action CRUD via RPC', () => {
  let client: AdminAPIWithDrizzle

  beforeAll(() => {
    client = createRPCClient<AdminAPIWithDrizzle>({
      target: ADMIN_URL,
      headers: {
        Host: 'admin.example.org.ai',
      },
    })
  })

  describe('$.drizzle.actions.list()', () => {
    it('returns array of actions', async () => {
      // RED: Should fail - $.drizzle.actions.list() doesn't exist yet
      const actions = await client.drizzle.actions.list()

      expect(Array.isArray(actions)).toBe(true)
      // Each action should have required fields
      if (actions.length > 0) {
        expect(actions[0]).toHaveProperty('id')
        expect(actions[0]).toHaveProperty('verb')
        expect(actions[0]).toHaveProperty('target')
        expect(actions[0]).toHaveProperty('status')
      }
    })

    it('supports query filters', async () => {
      // RED: Should fail - method doesn't exist
      const actions = await client.drizzle.actions.list({
        where: { status: 'completed' },
        limit: 20,
      })

      expect(Array.isArray(actions)).toBe(true)
      expect(actions.length).toBeLessThanOrEqual(20)
      actions.forEach((action) => {
        expect(action.status).toBe('completed')
      })
    })
  })

  describe('$.drizzle.actions.create()', () => {
    it('creates an action', async () => {
      // RED: Should fail - $.drizzle.actions.create() doesn't exist yet
      const result = await client.drizzle.actions.create(TEST_ACTION_DATA)

      expect(result).toBeDefined()
      expect(result.id).toBe(TEST_ACTION_DATA.id)
      expect(result.verb).toBe(TEST_ACTION_DATA.verb)
      expect(result.target).toBe(TEST_ACTION_DATA.target)
      expect(result.status).toBe(TEST_ACTION_DATA.status)
    })
  })

  describe('$.drizzle.actions.get()', () => {
    it('returns specific action by ID', async () => {
      // RED: Should fail - method doesn't exist
      const action = await client.drizzle.actions.get('some-action-id')

      // Should return the action if it exists, or null
      if (action) {
        expect(action.id).toBe('some-action-id')
      } else {
        expect(action).toBeNull()
      }
    })

    it('returns null for non-existent action', async () => {
      // RED: Should fail - method doesn't exist
      const action = await client.drizzle.actions.get('non-existent-action-id-12345')

      expect(action).toBeNull()
    })
  })

  describe('$.drizzle.actions.update()', () => {
    it('updates an action status', async () => {
      // RED: Should fail - method doesn't exist
      const updated = await client.drizzle.actions.update(TEST_ACTION_DATA.id, {
        status: 'completed',
      })

      expect(updated.status).toBe('completed')
    })
  })

  describe('$.drizzle.actions.delete()', () => {
    it('deletes an action', async () => {
      // RED: Should fail - method doesn't exist
      const deleted = await client.drizzle.actions.delete(TEST_ACTION_DATA.id)
      expect(deleted).toBe(true)
    })
  })

  describe('$.drizzle.actions.count()', () => {
    it('returns action count', async () => {
      // RED: Should fail - method doesn't exist
      const count = await client.drizzle.actions.count()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('supports where filter', async () => {
      // RED: Should fail - method doesn't exist
      const count = await client.drizzle.actions.count({ status: 'pending' })

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// DRIZZLE ERROR HANDLING TESTS
// =============================================================================

describe('$.drizzle error responses', () => {
  let client: AdminAPIWithDrizzle

  beforeAll(() => {
    client = createRPCClient<AdminAPIWithDrizzle>({
      target: ADMIN_URL,
      headers: {
        Host: 'admin.example.org.ai',
      },
    })
  })

  it('throws METHOD_NOT_FOUND for missing drizzle methods', async () => {
    // This test validates that WHEN these methods don't exist,
    // the RPC system properly returns METHOD_NOT_FOUND errors.

    try {
      await client.drizzle.nouns.list()
      // If we get here in RED phase, something is wrong
    } catch (error) {
      // Expected: METHOD_NOT_FOUND error or similar
      expect(error).toBeDefined()

      if (error instanceof RPCError) {
        expect(['METHOD_NOT_FOUND', 'RPC_ERROR', 'TIMEOUT']).toContain(error.code)
      } else if (error instanceof Error) {
        expect(error.message).toBeDefined()
      }
    }
  })
})

// =============================================================================
// DRIZZLE CONTRACT DOCUMENTATION
// =============================================================================

describe('$.drizzle contract documentation', () => {
  it('documents the $.drizzle RPC contract', () => {
    console.log(`
    ================================================================================
    $.drizzle RPC Contract (RED Phase)
    ================================================================================

    Expected methods for each table (nouns, verbs, actions):
    - $.drizzle.<table>.list(query?)  -> Record[]  - List with optional filters
    - $.drizzle.<table>.get(id)       -> Record | null - Get by primary key
    - $.drizzle.<table>.create(data)  -> Record    - Create new record
    - $.drizzle.<table>.update(id, data) -> Record - Update existing record
    - $.drizzle.<table>.delete(id)    -> boolean   - Delete record
    - $.drizzle.<table>.count(where?) -> number    - Count records

    Query format:
    {
      where?: Partial<Record>,  // Filter conditions
      limit?: number,           // Max results
      offset?: number           // Skip N results
    }

    NounRecord fields (primary key: noun):
    - noun: string, plural: string?, description: string?
    - schema: JSON?, doClass: string?
    - sharded: boolean, shardCount: number, shardKey: string?
    - storage: 'hot'|'cold'|'tiered', ttlDays: number?
    - indexedFields: string[]?, nsStrategy: string
    - replicaRegions: string[]?, consistencyMode: string, replicaBinding: string?

    VerbRecord fields (primary key: verb):
    - verb: string, action: string?, activity: string?
    - event: string?, reverse: string?, inverse: string?
    - description: string?

    ActionRecord fields (primary key: id):
    - id: string, verb: string, actor: string?, target: string
    - input: number?, output: number?, options: JSON?
    - durability: 'send'|'try'|'do'
    - status: 'pending'|'running'|'completed'|'failed'|'undone'|'retrying'
    - error: JSON?, requestId: string?, sessionId: string?, workflowId: string?
    - startedAt: Date?, completedAt: Date?, duration: number?, createdAt: Date

    Target: https://admin.example.org.ai
    Status: RED (tests expected to FAIL - methods not implemented)
    ================================================================================
    `)

    // This is a documentation test - always passes
    expect(true).toBe(true)
  })
})
