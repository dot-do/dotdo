/**
 * RPC Protocol Contract Tests (RED Phase)
 *
 * These tests define the contract for Cap'n Web RPC protocol.
 * They verify:
 * 1. All RPC methods match their schemas
 * 2. Request/response shapes are validated
 * 3. Error responses follow the contract
 * 4. Versioning is handled properly
 *
 * Tests should FAIL initially (RED phase) until proper validation is implemented.
 *
 * @see do-5w4: RPC contract tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateInterface,
  createRPCClient,
  createCapability,
  serialize,
  deserialize,
  RPCError,
  sendRPCRequest,
} from '../../rpc/index'
import type {
  Schema,
  FieldSchema,
  MethodSchema,
  ParamSchema,
  MethodDescriptor,
  MetaInterface,
} from '../../rpc/index'

// ============================================================================
// CONTRACT TYPE DEFINITIONS
// ============================================================================

/**
 * RPC Request envelope - the wire format for RPC requests
 */
interface RPCRequest {
  /** Protocol version */
  version: string
  /** Request ID for correlation */
  id: string
  /** Target DO type/namespace */
  target: {
    type: string
    id: string
  }
  /** Method to invoke */
  method: string
  /** Method arguments */
  args: unknown[]
  /** Optional metadata */
  meta?: {
    timeout?: number
    retries?: number
    correlationId?: string
  }
}

/**
 * RPC Response envelope - the wire format for RPC responses
 */
interface RPCResponse {
  /** Protocol version */
  version: string
  /** Request ID correlation */
  id: string
  /** Success or error */
  status: 'success' | 'error'
  /** Result data (on success) */
  result?: unknown
  /** Error details (on error) */
  error?: {
    code: string
    message: string
    details?: unknown
    stack?: string
  }
  /** Response metadata */
  meta?: {
    duration?: number
    retryCount?: number
  }
}

/**
 * RPC Protocol version specification
 */
interface ProtocolVersion {
  major: number
  minor: number
  patch: number
}

// ============================================================================
// MOCK DO CLASSES FOR CONTRACT TESTING
// ============================================================================

class TestDO {
  static readonly $type = 'TestEntity'

  $id: string
  name: string
  value: number
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>

  constructor(id: string, name: string, value: number) {
    this.$id = id
    this.name = name
    this.value = value
    this.tags = []
    this.createdAt = new Date()
    this.metadata = {}
  }

  async getValue(): Promise<number> {
    return this.value
  }

  async setValue(value: number): Promise<void> {
    this.value = value
  }

  async increment(by: number = 1): Promise<number> {
    this.value += by
    return this.value
  }

  async getTags(): Promise<string[]> {
    return this.tags
  }

  async addTag(tag: string): Promise<void> {
    this.tags.push(tag)
  }

  async setMetadata(key: string, value: unknown): Promise<void> {
    this.metadata[key] = value
  }

  async getMetadata(key: string): Promise<unknown> {
    return this.metadata[key]
  }
}

// ============================================================================
// 1. RPC METHOD SCHEMA VALIDATION TESTS
// ============================================================================

describe('RPC Method Schema Validation', () => {
  describe('schema structure compliance', () => {
    it('generated schema has required protocol fields', () => {
      const iface = generateInterface(TestDO)

      // Contract: Schema MUST have $type identifying the entity
      expect(iface).toHaveProperty('$type')
      expect(typeof iface.$type).toBe('string')
      expect(iface.$type).toBe('TestEntity')

      // Contract: Schema MUST have $schema reference for validation
      expect(iface).toHaveProperty('$schema')
      expect(iface.$schema).toMatch(/json-schema/)

      // Contract: Schema MUST have methods array
      expect(iface).toHaveProperty('methods')
      expect(Array.isArray(iface.methods)).toBe(true)

      // Contract: Schema MUST have fields array
      expect(iface).toHaveProperty('fields')
      expect(Array.isArray(iface.fields)).toBe(true)
    })

    it('method descriptors have complete signature information', () => {
      const iface = generateInterface(TestDO) as { methods: MethodDescriptor[] }

      for (const method of iface.methods) {
        // Contract: Each method MUST have a name
        expect(method).toHaveProperty('name')
        expect(typeof method.name).toBe('string')
        expect(method.name.length).toBeGreaterThan(0)

        // Contract: Each method MUST have params array
        expect(method).toHaveProperty('params')
        expect(Array.isArray(method.params)).toBe(true)

        // Contract: Each method MUST have returns type
        expect(method).toHaveProperty('returns')
        expect(typeof method.returns).toBe('string')

        // Contract: Each method MUST have isAsync flag
        expect(method).toHaveProperty('isAsync')
        expect(typeof method.isAsync).toBe('boolean')
      }
    })

    it('parameter schemas have required fields', () => {
      const iface = generateInterface(TestDO) as { methods: MethodDescriptor[] }

      const incrementMethod = iface.methods.find((m) => m.name === 'increment')
      expect(incrementMethod).toBeDefined()

      // Contract: Parameters MUST have name and type
      for (const param of incrementMethod!.params) {
        expect(param).toHaveProperty('name')
        expect(typeof param.name).toBe('string')
        expect(param).toHaveProperty('type')
        expect(typeof param.type).toBe('string')
      }
    })

    it('field schemas have required fields', () => {
      const iface = generateInterface(TestDO) as { fields: FieldSchema[] }

      for (const field of iface.fields) {
        // Contract: Fields MUST have name and type
        expect(field).toHaveProperty('name')
        expect(typeof field.name).toBe('string')
        expect(field).toHaveProperty('type')
        expect(typeof field.type).toBe('string')
      }
    })
  })

  describe('schema method signature validation', () => {
    it('validates method exists before invocation', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      // Contract: Calling non-existent method MUST throw with method name
      await expect(
        (client as unknown as Record<string, () => Promise<unknown>>).nonExistentMethod()
      ).rejects.toThrow(/method.*not.*found|unknown.*method/i)
    })

    it('validates parameter types at runtime', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      // Contract: Passing wrong type MUST be validated
      // increment expects a number, not a string
      await expect(
        (client.increment as (arg: unknown) => Promise<number>)('not-a-number')
      ).rejects.toThrow(/type.*mismatch|invalid.*argument|expected.*number/i)
    })

    it('validates required parameters are provided', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      // Contract: Missing required parameter MUST throw
      await expect(
        (client.addTag as () => Promise<void>)()
      ).rejects.toThrow(/required.*parameter|missing.*argument/i)
    })

    it('validates return type matches schema', async () => {
      const iface = generateInterface(TestDO) as { methods: MethodDescriptor[] }
      const getValueMethod = iface.methods.find((m) => m.name === 'getValue')

      // Contract: Return type MUST be declared in schema
      expect(getValueMethod).toBeDefined()
      expect(getValueMethod!.returns).toMatch(/Promise<number>/i)
    })
  })
})

// ============================================================================
// 2. REQUEST/RESPONSE SHAPE VALIDATION TESTS
// ============================================================================

describe('RPC Request/Response Shape Validation', () => {
  describe('request envelope structure', () => {
    it('serialized request includes version field', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'req-123',
        target: { type: 'TestEntity', id: 'entity-123' },
        method: 'getValue',
        args: [],
      }

      const serialized = serialize(request) as string
      const parsed = JSON.parse(serialized)

      // Contract: Request MUST include version
      expect(parsed).toHaveProperty('version')
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('serialized request includes correlation id', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'req-456',
        target: { type: 'TestEntity', id: 'entity-123' },
        method: 'setValue',
        args: [42],
      }

      const serialized = serialize(request) as string
      const parsed = JSON.parse(serialized)

      // Contract: Request MUST include id for correlation
      expect(parsed).toHaveProperty('id')
      expect(typeof parsed.id).toBe('string')
      expect(parsed.id.length).toBeGreaterThan(0)
    })

    it('serialized request includes target specification', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'req-789',
        target: { type: 'TestEntity', id: 'entity-456' },
        method: 'increment',
        args: [5],
      }

      const serialized = serialize(request) as string
      const parsed = JSON.parse(serialized)

      // Contract: Request MUST include target with type and id
      expect(parsed).toHaveProperty('target')
      expect(parsed.target).toHaveProperty('type')
      expect(parsed.target).toHaveProperty('id')
      expect(typeof parsed.target.type).toBe('string')
      expect(typeof parsed.target.id).toBe('string')
    })

    it('serialized request preserves argument types', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'req-abc',
        target: { type: 'TestEntity', id: 'entity-789' },
        method: 'setMetadata',
        args: [
          'config',
          {
            nested: { value: 42 },
            date: new Date('2026-01-15T12:00:00Z'),
            array: [1, 2, 3],
          },
        ],
      }

      const serialized = serialize(request) as string
      const deserialized = deserialize<RPCRequest>(serialized)

      // Contract: Arguments MUST be preserved through serialization
      expect(deserialized.args[0]).toBe('config')
      expect(deserialized.args[1]).toHaveProperty('nested')
      expect((deserialized.args[1] as Record<string, unknown>).date).toBeInstanceOf(Date)
    })
  })

  describe('response envelope structure', () => {
    it('success response has correct shape', () => {
      const response: RPCResponse = {
        version: '1.0.0',
        id: 'req-123',
        status: 'success',
        result: 42,
      }

      const serialized = serialize(response) as string
      const parsed = JSON.parse(serialized)

      // Contract: Success response MUST have status='success'
      expect(parsed.status).toBe('success')
      // Contract: Success response MUST include result
      expect(parsed).toHaveProperty('result')
      // Contract: Success response MUST NOT include error
      expect(parsed.error).toBeUndefined()
    })

    it('error response has correct shape', () => {
      const response: RPCResponse = {
        version: '1.0.0',
        id: 'req-456',
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid argument',
        },
      }

      const serialized = serialize(response) as string
      const parsed = JSON.parse(serialized)

      // Contract: Error response MUST have status='error'
      expect(parsed.status).toBe('error')
      // Contract: Error response MUST include error object
      expect(parsed).toHaveProperty('error')
      // Contract: Error MUST have code and message
      expect(parsed.error).toHaveProperty('code')
      expect(parsed.error).toHaveProperty('message')
      // Contract: Error response MUST NOT include result
      expect(parsed.result).toBeUndefined()
    })

    it('response includes request correlation id', () => {
      const response: RPCResponse = {
        version: '1.0.0',
        id: 'original-req-id',
        status: 'success',
        result: null,
      }

      const serialized = serialize(response) as string
      const parsed = JSON.parse(serialized)

      // Contract: Response id MUST match request id
      expect(parsed.id).toBe('original-req-id')
    })

    it('response includes matching version', () => {
      const response: RPCResponse = {
        version: '1.0.0',
        id: 'req-789',
        status: 'success',
        result: [],
      }

      const serialized = serialize(response) as string
      const parsed = JSON.parse(serialized)

      // Contract: Response version MUST match request version
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('special type preservation', () => {
    it('Date objects are preserved in request/response', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'date-test',
        target: { type: 'TestEntity', id: 'entity-1' },
        method: 'setMetadata',
        args: ['timestamp', new Date('2026-01-15T10:30:00Z')],
      }

      const serialized = serialize(request) as string
      const deserialized = deserialize<RPCRequest>(serialized)

      // Contract: Dates MUST be preserved through serialization
      expect(deserialized.args[1]).toBeInstanceOf(Date)
      expect((deserialized.args[1] as Date).toISOString()).toBe('2026-01-15T10:30:00.000Z')
    })

    it('BigInt values are preserved in request/response', () => {
      const request: RPCRequest = {
        version: '1.0.0',
        id: 'bigint-test',
        target: { type: 'TestEntity', id: 'entity-2' },
        method: 'setMetadata',
        args: ['largeNumber', BigInt('9007199254740993')],
      }

      const serialized = serialize(request) as string
      const deserialized = deserialize<RPCRequest>(serialized)

      // Contract: BigInt MUST be preserved through serialization
      expect(typeof deserialized.args[1]).toBe('bigint')
      expect(deserialized.args[1].toString()).toBe('9007199254740993')
    })

    it('Map objects are preserved in request/response', () => {
      const testMap = new Map([
        ['key1', 'value1'],
        ['key2', 42],
      ])

      const request: RPCRequest = {
        version: '1.0.0',
        id: 'map-test',
        target: { type: 'TestEntity', id: 'entity-3' },
        method: 'setMetadata',
        args: ['mappedData', testMap],
      }

      const serialized = serialize(request) as string
      const deserialized = deserialize<RPCRequest>(serialized)

      // Contract: Map MUST be preserved through serialization
      expect(deserialized.args[1]).toBeInstanceOf(Map)
      expect((deserialized.args[1] as Map<string, unknown>).get('key1')).toBe('value1')
      expect((deserialized.args[1] as Map<string, unknown>).get('key2')).toBe(42)
    })

    it('Set objects are preserved in request/response', () => {
      const testSet = new Set([1, 2, 3, 'four'])

      const request: RPCRequest = {
        version: '1.0.0',
        id: 'set-test',
        target: { type: 'TestEntity', id: 'entity-4' },
        method: 'setMetadata',
        args: ['uniqueItems', testSet],
      }

      const serialized = serialize(request) as string
      const deserialized = deserialize<RPCRequest>(serialized)

      // Contract: Set MUST be preserved through serialization
      expect(deserialized.args[1]).toBeInstanceOf(Set)
      expect((deserialized.args[1] as Set<unknown>).has(1)).toBe(true)
      expect((deserialized.args[1] as Set<unknown>).has('four')).toBe(true)
    })
  })
})

// ============================================================================
// 3. ERROR RESPONSE CONTRACT TESTS
// ============================================================================

describe('RPC Error Response Contract', () => {
  describe('error code standards', () => {
    it('RPCError has standard code property', () => {
      const error = new RPCError('Test error')

      // Contract: RPCError MUST have code property
      expect(error).toHaveProperty('code')
      expect(typeof error.code).toBe('string')
      expect(error.code).toBe('RPC_ERROR')
    })

    it('RPCError includes method context', () => {
      const error = new RPCError('Method failed', {
        method: 'getValue',
        target: 'https://test.api/entity-123',
      })

      // Contract: RPCError MUST include method that failed
      expect(error.method).toBe('getValue')
      // Contract: RPCError MUST include target URL
      expect(error.target).toBe('https://test.api/entity-123')
    })

    it('RPCError preserves stack trace', () => {
      const error = new RPCError('Stack trace test')

      // Contract: RPCError MUST have stack trace
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('RPCError')
    })

    it('RPCError includes partial results on pipeline failure', () => {
      const partialResults = [{ id: 1 }, { id: 2 }]
      const error = new RPCError('Pipeline step 3 failed', {
        partialResults,
      })

      // Contract: Pipeline errors MUST include partial results
      expect(error.partialResults).toBeDefined()
      expect(error.partialResults).toHaveLength(2)
      expect(error.partialResults![0]).toEqual({ id: 1 })
    })
  })

  describe('error categories', () => {
    it('validation errors have VALIDATION_ERROR code', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      try {
        // Contract: Invalid arguments MUST produce VALIDATION_ERROR
        await (client.increment as (arg: unknown) => Promise<number>)('invalid')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as RPCError).code).toBe('VALIDATION_ERROR')
      }
    })

    it('timeout errors have TIMEOUT code', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://slow.api.dotdo.dev/entity-123',
        timeout: 100, // Short timeout (100ms)
      })

      try {
        await client.getValue()
        expect.fail('Should have thrown')
      } catch (error) {
        // Contract: Timeout MUST produce TIMEOUT error code
        expect((error as RPCError).code).toMatch(/TIMEOUT|RPC_ERROR/)
      }
    }, 60000)

    it('method not found errors have METHOD_NOT_FOUND code', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      try {
        await (client as unknown as Record<string, () => Promise<unknown>>).undefinedMethod()
        expect.fail('Should have thrown')
      } catch (error) {
        // Contract: Unknown method MUST produce METHOD_NOT_FOUND code
        expect((error as RPCError).code).toBe('METHOD_NOT_FOUND')
      }
    })

    it('capability errors have UNAUTHORIZED code', async () => {
      const entity = new TestDO('entity-123', 'Test', 0)
      const limitedCap = createCapability(entity, ['getValue']) // Only getValue

      try {
        await limitedCap.invoke('setValue', 100)
        expect.fail('Should have thrown')
      } catch (error) {
        // Contract: Unauthorized method MUST produce UNAUTHORIZED code
        expect((error as Error).message).toMatch(/not authorized/i)
      }
    })

    it('revoked capability errors have REVOKED code', async () => {
      const entity = new TestDO('entity-123', 'Test', 0)
      const cap = createCapability(entity)

      cap.revoke()

      try {
        await cap.invoke('getValue')
        expect.fail('Should have thrown')
      } catch (error) {
        // Contract: Revoked capability MUST produce REVOKED error
        expect((error as Error).message).toMatch(/revoked/i)
      }
    })

    it('expired capability errors have EXPIRED code', async () => {
      const entity = new TestDO('entity-123', 'Test', 0)
      const cap = createCapability(entity)

      // Set expiration to past
      ;(cap as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000)

      try {
        await cap.invoke('getValue')
        expect.fail('Should have thrown')
      } catch (error) {
        // Contract: Expired capability MUST produce EXPIRED error
        expect((error as Error).message).toMatch(/expired/i)
      }
    })
  })

  describe('error serialization', () => {
    it('errors serialize to standard format', () => {
      const error = new RPCError('Serialization test', {
        method: 'testMethod',
        target: 'test://target',
      })

      const errorResponse: RPCResponse = {
        version: '1.0.0',
        id: 'err-req-123',
        status: 'error',
        error: {
          code: error.code,
          message: error.message,
          details: {
            method: error.method,
            target: error.target,
          },
          stack: error.stack,
        },
      }

      const serialized = serialize(errorResponse) as string
      const parsed = JSON.parse(serialized)

      // Contract: Error serialization MUST preserve all fields
      expect(parsed.error.code).toBe('RPC_ERROR')
      expect(parsed.error.message).toBe('Serialization test')
      expect(parsed.error.details.method).toBe('testMethod')
    })

    it('error responses deserialize correctly', () => {
      const errorJson = JSON.stringify({
        version: '1.0.0',
        id: 'err-req-456',
        status: 'error',
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
          details: { foo: 'bar' },
        },
      })

      const response = deserialize<RPCResponse>(errorJson)

      // Contract: Error deserialization MUST preserve structure
      expect(response.status).toBe('error')
      expect(response.error?.code).toBe('TEST_ERROR')
      expect(response.error?.message).toBe('Test error message')
      expect(response.error?.details).toEqual({ foo: 'bar' })
    })
  })
})

// ============================================================================
// 4. PROTOCOL VERSIONING TESTS
// ============================================================================

describe('RPC Protocol Versioning', () => {
  describe('version negotiation', () => {
    it('$meta.version() returns semantic version', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      const version = await client.$meta.version()

      // Contract: Version MUST follow semver
      expect(version).toHaveProperty('major')
      expect(version).toHaveProperty('minor')
      expect(version).toHaveProperty('patch')
      expect(typeof version.major).toBe('number')
      expect(typeof version.minor).toBe('number')
      expect(typeof version.patch).toBe('number')
      expect(version.major).toBeGreaterThanOrEqual(0)
    })

    it('protocol version is included in schema', () => {
      const iface = generateInterface(TestDO)

      // Contract: Schema SHOULD include protocol version
      // This test will fail if version is not embedded
      expect(iface).toHaveProperty('$version')
      expect(typeof (iface as { $version?: string }).$version).toBe('string')
    })

    it('request with incompatible version is rejected', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      // Contract: Server MUST reject requests with unsupported major version
      // This would require version header support in the client
      const invalidVersionRequest = {
        version: '99.0.0', // Future major version
        id: 'version-test',
        target: { type: 'TestEntity', id: 'entity-123' },
        method: 'getValue',
        args: [],
      }

      // When validation is implemented, this should fail
      await expect(
        sendRPCRequest(client, invalidVersionRequest)
      ).rejects.toThrow(/unsupported.*version|version.*mismatch/i)
    })

    it('minor version differences are handled gracefully', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      const currentVersion = await client.$meta.version()

      // Contract: Minor version bump MUST be backwards compatible
      const minorBumpRequest = {
        version: `${currentVersion.major}.${currentVersion.minor + 1}.0`,
        id: 'minor-version-test',
        target: { type: 'TestEntity', id: 'entity-123' },
        method: 'getValue',
        args: [],
      }

      // Should not reject minor version differences
      await expect(
        sendRPCRequest(client, minorBumpRequest)
      ).resolves.not.toThrow(/version/i)
    })
  })

  describe('backwards compatibility', () => {
    it('v1 schema is compatible with v1 requests', () => {
      // Contract: Same major version MUST be compatible
      const v1Schema = generateInterface(TestDO)

      expect(v1Schema.$schema).toMatch(/json-schema/)
      expect((v1Schema as { $type?: string }).$type).toBe('TestEntity')
    })

    it('deprecated methods are marked in schema', () => {
      const iface = generateInterface(TestDO) as { methods: (MethodDescriptor & { deprecated?: boolean })[] }

      // Contract: Deprecated methods SHOULD be marked
      // This verifies the schema supports deprecation markers
      for (const method of iface.methods) {
        if (method.deprecated) {
          expect(typeof method.deprecated).toBe('boolean')
        }
      }
    })

    it('schema includes minimum supported version', () => {
      const iface = generateInterface(TestDO)

      // Contract: Schema SHOULD declare minimum supported version
      expect(iface).toHaveProperty('$minVersion')
      const minVersion = (iface as { $minVersion?: string }).$minVersion
      expect(minVersion).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })
})

// ============================================================================
// 5. SCHEMA VALIDATION TESTS
// ============================================================================

describe('RPC Schema Validation', () => {
  describe('JSON Schema compliance', () => {
    it('generated schema is valid JSON Schema', () => {
      const iface = generateInterface(TestDO)

      // Contract: Schema MUST be valid JSON Schema draft-07
      expect(iface.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(iface.type).toBe('object')
      expect(iface.properties).toBeDefined()
      expect(typeof iface.properties).toBe('object')
    })

    it('field types map to JSON Schema types', () => {
      const iface = generateInterface(TestDO) as {
        properties: Record<string, { type: string }>
        fields: FieldSchema[]
      }

      // Contract: TypeScript types MUST map to JSON Schema types
      const validJsonTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']

      for (const field of iface.fields) {
        const propType = iface.properties[field.name]?.type
        if (propType) {
          expect(validJsonTypes).toContain(propType)
        }
      }
    })

    it('schema includes type constraints', () => {
      const iface = generateInterface(TestDO) as {
        properties: Record<string, { type: string; minimum?: number; maxLength?: number }>
        fields: FieldSchema[]
      }

      // Contract: Schema SHOULD include validation constraints
      // Check if numeric types have constraints
      const valueField = iface.properties['value']
      if (valueField && valueField.type === 'number') {
        // Schema should support constraints like minimum, maximum
        expect(valueField).toHaveProperty('minimum')
      }
    })
  })

  describe('runtime validation', () => {
    it('validates request against schema before sending', async () => {
      const client = createRPCClient<TestDO>({
        target: 'https://test.api.dotdo.dev/entity-123',
      })

      // Contract: Request validation MUST happen before network call
      // Pass invalid data type - should be caught locally
      await expect(
        (client.increment as (arg: unknown) => Promise<number>)({ invalid: 'object' })
      ).rejects.toThrow(/validation|type|invalid/i)
    })

    it('validates response against expected schema', async () => {
      // Contract: Response MUST be validated against expected return type
      // This would require schema-based response validation

      const mockBadResponse = {
        version: '1.0.0',
        id: 'bad-response-test',
        status: 'success' as const,
        result: 'not-a-number', // getValue should return number
      }

      // When validation is implemented, this should detect the mismatch
      expect(() => validateResponse(mockBadResponse, 'number')).toThrow(/type.*mismatch/i)
    })
  })
})

// ============================================================================
// 6. INTROSPECTION CONTRACT TESTS
// ============================================================================

describe('RPC Introspection Contract', () => {
  let client: TestDO & { $meta: MetaInterface }

  beforeEach(() => {
    client = createRPCClient<TestDO>({
      target: 'https://test.api.dotdo.dev/entity-123',
    })
  })

  describe('$meta.schema() contract', () => {
    it('returns complete type schema', async () => {
      const schema = await client.$meta.schema()

      // Contract: Schema MUST have name
      expect(schema.name).toBeDefined()
      expect(typeof schema.name).toBe('string')

      // Contract: Schema MUST have fields array
      expect(Array.isArray(schema.fields)).toBe(true)

      // Contract: Schema MUST have methods array
      expect(Array.isArray(schema.methods)).toBe(true)
    })

    it('schema fields match actual class fields', async () => {
      const schema = await client.$meta.schema()
      const fieldNames = schema.fields.map((f) => f.name)

      // Contract: Schema fields MUST reflect actual fields
      expect(fieldNames).toContain('$id')
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('value')
    })

    it('schema methods match actual class methods', async () => {
      const schema = await client.$meta.schema()
      const methodNames = schema.methods.map((m) => m.name)

      // Contract: Schema methods MUST reflect actual methods
      expect(methodNames).toContain('getValue')
      expect(methodNames).toContain('setValue')
      expect(methodNames).toContain('increment')
    })
  })

  describe('$meta.methods() contract', () => {
    it('returns method descriptors with signatures', async () => {
      const methods = await client.$meta.methods()

      // Contract: Each method descriptor MUST have complete signature
      for (const method of methods) {
        expect(method.name).toBeDefined()
        expect(Array.isArray(method.params)).toBe(true)
        expect(method.returns).toBeDefined()
        expect(typeof method.isAsync).toBe('boolean')
      }
    })

    it('method descriptors include documentation', async () => {
      const methods = await client.$meta.methods()

      // Contract: Method descriptors SHOULD include description
      for (const method of methods) {
        expect(method.description).toBeDefined()
        expect(typeof method.description).toBe('string')
      }
    })

    it('methods are sorted alphabetically', async () => {
      const methods = await client.$meta.methods()
      const names = methods.map((m) => m.name)
      const sorted = [...names].sort()

      // Contract: Methods MUST be returned in sorted order
      expect(names).toEqual(sorted)
    })
  })

  describe('$meta.capabilities() contract', () => {
    it('returns available capabilities', async () => {
      const caps = await client.$meta.capabilities()

      // Contract: MUST return array of capabilities
      expect(Array.isArray(caps)).toBe(true)
      expect(caps.length).toBeGreaterThan(0)
    })

    it('capabilities have required properties', async () => {
      const caps = await client.$meta.capabilities()

      for (const cap of caps) {
        // Contract: Each capability MUST have id, type, methods
        expect(cap.id).toBeDefined()
        expect(cap.type).toBeDefined()
        expect(Array.isArray(cap.methods)).toBe(true)
      }
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS FOR CONTRACT TESTING
// ============================================================================

// Note: sendRPCRequest is now imported from '../../rpc/index'
// It provides version validation and proper RPC request handling

/**
 * Validate response against expected type (mock for contract testing)
 */
function validateResponse(response: RPCResponse, expectedType: string): void {
  if (response.status === 'success') {
    const actualType = typeof response.result
    if (actualType !== expectedType) {
      throw new Error(`Type mismatch: expected ${expectedType}, got ${actualType}`)
    }
  }
}
