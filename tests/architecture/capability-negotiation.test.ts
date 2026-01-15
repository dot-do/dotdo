/**
 * Capability Negotiation Protocol Tests (RED Phase)
 *
 * Tests for Cap'n Web capability negotiation during handshake.
 * These tests verify that:
 * 1. Capabilities are exchanged during handshake
 * 2. Version negotiation works correctly
 * 3. Unsupported capabilities are handled gracefully
 * 4. Capability schema is discoverable
 *
 * Issue: do-2gl [ARCH-4] Capability negotiation protocol
 *
 * @see rpc/capability.ts for current capability implementation
 * @see rpc/proxy.ts for RPC client implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS - Expected Protocol Types
// ============================================================================

/**
 * Capability negotiation request sent during handshake
 */
interface CapabilityNegotiationRequest {
  /** Protocol version */
  version: { major: number; minor: number; patch: number }
  /** Capabilities the client supports */
  supportedCapabilities: string[]
  /** Minimum required capabilities (connection fails if not met) */
  requiredCapabilities?: string[]
  /** Client identifier for debugging */
  clientId?: string
}

/**
 * Capability negotiation response from server
 */
interface CapabilityNegotiationResponse {
  /** Negotiated protocol version (highest mutually supported) */
  version: { major: number; minor: number; patch: number }
  /** Capabilities enabled for this connection */
  enabledCapabilities: string[]
  /** Capabilities the server supports but client didn't request */
  availableCapabilities: string[]
  /** Whether handshake succeeded */
  success: boolean
  /** Error message if handshake failed */
  error?: string
  /** Server-assigned session ID */
  sessionId: string
}

/**
 * Capability schema describing a capability's interface
 */
interface CapabilitySchema {
  /** Capability name/identifier */
  name: string
  /** Human-readable description */
  description: string
  /** Version this capability was introduced */
  since: { major: number; minor: number; patch: number }
  /** Dependencies on other capabilities */
  requires?: string[]
  /** Methods provided by this capability */
  methods: Array<{
    name: string
    description: string
    params: Array<{ name: string; type: string; required?: boolean }>
    returns: string
  }>
}

/**
 * Connection with capability negotiation support
 */
interface NegotiatedConnection {
  /** Session ID from negotiation */
  sessionId: string
  /** Negotiated protocol version */
  version: { major: number; minor: number; patch: number }
  /** Enabled capabilities */
  capabilities: string[]
  /** Check if a capability is enabled */
  hasCapability(name: string): boolean
  /** Get schema for a capability */
  getCapabilitySchema(name: string): Promise<CapabilitySchema | null>
  /** List all available capability schemas */
  listCapabilitySchemas(): Promise<CapabilitySchema[]>
  /** Close connection */
  close(): Promise<void>
}

/**
 * RPC client with negotiation support
 */
interface NegotiatingRPCClient<T> {
  /** Establish connection with capability negotiation */
  connect(request: CapabilityNegotiationRequest): Promise<NegotiatedConnection>
  /** Get the current connection (throws if not connected) */
  connection: NegotiatedConnection
  /** Underlying client for method calls */
  client: T
}

// ============================================================================
// IMPORTS - Import actual implementations from rpc/negotiation.ts
// ============================================================================

import {
  createNegotiatingClient,
  createNegotiationHandler,
} from '../../rpc/negotiation'

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Capability Negotiation Protocol', () => {
  describe('Handshake - Capability Exchange', () => {
    it('should exchange capabilities during initial handshake', async () => {
      const client = createNegotiatingClient<{ echo(msg: string): Promise<string> }>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const response = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic', 'rpc.streaming', 'rpc.pipelining'],
      })

      // Should receive negotiation response
      expect(response.sessionId).toBeDefined()
      expect(response.sessionId.length).toBeGreaterThan(0)
      expect(response.version).toBeDefined()
      expect(response.capabilities).toBeDefined()
      expect(Array.isArray(response.capabilities)).toBe(true)
    })

    it('should include server capabilities in handshake response', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const response = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Server should advertise what it supports
      expect(response.capabilities.length).toBeGreaterThan(0)
      // rpc.basic should be enabled since both support it
      expect(response.hasCapability('rpc.basic')).toBe(true)
    })

    it('should only enable mutually supported capabilities', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      // Client requests capabilities server doesn't have
      const response = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic', 'rpc.nonexistent'],
      })

      // Should not have nonexistent capability
      expect(response.hasCapability('rpc.nonexistent')).toBe(false)
      // Should still have basic
      expect(response.hasCapability('rpc.basic')).toBe(true)
    })

    it('should provide list of available but not enabled capabilities', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic', 'rpc.streaming', 'rpc.pipelining', 'rpc.advanced'],
        capabilitySchemas: new Map(),
      })

      // Client only requests basic
      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should succeed
      expect(response.success).toBe(true)
      // Should have basic enabled
      expect(response.enabledCapabilities).toContain('rpc.basic')
      // Should list other available capabilities
      expect(response.availableCapabilities).toContain('rpc.streaming')
      expect(response.availableCapabilities).toContain('rpc.pipelining')
      // Available should not include already-enabled
      expect(response.availableCapabilities).not.toContain('rpc.basic')
    })
  })

  describe('Version Negotiation', () => {
    it('should negotiate highest mutually supported version', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [
          { major: 1, minor: 0, patch: 0 },
          { major: 1, minor: 1, patch: 0 },
          { major: 2, minor: 0, patch: 0 },
        ],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      // Client requests v1.1.0
      const response = handler.negotiate({
        version: { major: 1, minor: 1, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Server should negotiate v1.1.0 (highest mutual)
      expect(response.version).toEqual({ major: 1, minor: 1, patch: 0 })
    })

    it('should downgrade to compatible version when client is newer', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [
          { major: 1, minor: 0, patch: 0 },
          { major: 1, minor: 2, patch: 0 },
        ],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      // Client requests v2.0.0 (newer than server)
      const response = handler.negotiate({
        version: { major: 2, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should downgrade to highest server version (1.2.0)
      expect(response.success).toBe(true)
      expect(response.version.major).toBe(1)
      expect(response.version.minor).toBe(2)
    })

    it('should fail when no compatible version exists', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 2, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      // Client only supports v1
      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should fail - no compatible version
      expect(response.success).toBe(false)
      expect(response.error).toContain('version')
    })

    it('should include version in connection state after negotiation', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      expect(connection.version).toBeDefined()
      expect(connection.version.major).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Unsupported Capabilities - Graceful Handling', () => {
    it('should fail handshake when required capability is not supported', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic', 'rpc.required-feature'],
        requiredCapabilities: ['rpc.required-feature'], // Required but server doesn't have
      })

      expect(response.success).toBe(false)
      expect(response.error).toContain('required')
      expect(response.error).toContain('rpc.required-feature')
    })

    it('should succeed when optional unsupported capabilities are requested', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic', 'rpc.optional-feature'],
        // No requiredCapabilities - all are optional
      })

      expect(response.success).toBe(true)
      expect(response.enabledCapabilities).toContain('rpc.basic')
      expect(response.enabledCapabilities).not.toContain('rpc.optional-feature')
    })

    it('should handle capability dependencies correctly', async () => {
      const schemas = new Map<string, CapabilitySchema>()
      schemas.set('rpc.pipelining', {
        name: 'rpc.pipelining',
        description: 'Promise pipelining support',
        since: { major: 1, minor: 0, patch: 0 },
        requires: ['rpc.basic'], // Depends on basic
        methods: [],
      })

      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic', 'rpc.pipelining'],
        capabilitySchemas: schemas,
      })

      // Client requests pipelining without basic
      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.pipelining'], // Missing rpc.basic
      })

      // Should fail - pipelining requires basic
      expect(response.success).toBe(false)
      expect(response.error).toContain('rpc.basic')
    })

    it('should allow checking capability at runtime', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should be able to check capabilities
      expect(typeof connection.hasCapability).toBe('function')
      const hasBasic = connection.hasCapability('rpc.basic')
      expect(typeof hasBasic).toBe('boolean')
    })

    it('should return meaningful error for completely unsupported requests', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      // Empty capabilities - nonsensical request
      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: [],
        requiredCapabilities: ['rpc.magic'], // Required but doesn't exist
      })

      expect(response.success).toBe(false)
      expect(response.error).toBeDefined()
      expect(response.error!.length).toBeGreaterThan(0)
    })
  })

  describe('Capability Schema Discovery', () => {
    it('should expose capability schema through connection', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should be able to get schema for enabled capability
      const schema = await connection.getCapabilitySchema('rpc.basic')
      expect(schema).not.toBeNull()
      expect(schema!.name).toBe('rpc.basic')
      expect(schema!.description).toBeDefined()
      expect(schema!.methods).toBeDefined()
      expect(Array.isArray(schema!.methods)).toBe(true)
    })

    it('should return null for unknown capability schema', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      const schema = await connection.getCapabilitySchema('rpc.nonexistent')
      expect(schema).toBeNull()
    })

    it('should list all available capability schemas', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      const schemas = await connection.listCapabilitySchemas()
      expect(Array.isArray(schemas)).toBe(true)
      expect(schemas.length).toBeGreaterThan(0)

      // Each schema should have required fields
      for (const schema of schemas) {
        expect(schema.name).toBeDefined()
        expect(schema.description).toBeDefined()
        expect(schema.since).toBeDefined()
        expect(schema.methods).toBeDefined()
      }
    })

    it('should include version info in capability schema', async () => {
      const schemas = new Map<string, CapabilitySchema>()
      schemas.set('rpc.streaming', {
        name: 'rpc.streaming',
        description: 'Streaming RPC support',
        since: { major: 1, minor: 1, patch: 0 },
        methods: [
          {
            name: 'stream',
            description: 'Create a bidirectional stream',
            params: [{ name: 'options', type: 'StreamOptions', required: false }],
            returns: 'AsyncIterable<T>',
          },
        ],
      })

      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 1, patch: 0 }],
        supportedCapabilities: ['rpc.basic', 'rpc.streaming'],
        capabilitySchemas: schemas,
      })

      const schema = handler.getSchema('rpc.streaming')
      expect(schema).toBeDefined()
      expect(schema!.since).toEqual({ major: 1, minor: 1, patch: 0 })
    })

    it('should describe capability methods in schema', async () => {
      const schemas = new Map<string, CapabilitySchema>()
      schemas.set('rpc.basic', {
        name: 'rpc.basic',
        description: 'Basic RPC capability',
        since: { major: 1, minor: 0, patch: 0 },
        methods: [
          {
            name: 'invoke',
            description: 'Invoke a remote method',
            params: [
              { name: 'method', type: 'string', required: true },
              { name: 'args', type: 'unknown[]', required: false },
            ],
            returns: 'Promise<unknown>',
          },
          {
            name: 'ping',
            description: 'Check connection health',
            params: [],
            returns: 'Promise<{ latencyMs: number }>',
          },
        ],
      })

      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: schemas,
      })

      const schema = handler.getSchema('rpc.basic')
      expect(schema!.methods.length).toBe(2)

      const invokeMethod = schema!.methods.find(m => m.name === 'invoke')
      expect(invokeMethod).toBeDefined()
      expect(invokeMethod!.params.length).toBe(2)
      expect(invokeMethod!.params[0].name).toBe('method')
      expect(invokeMethod!.params[0].required).toBe(true)
    })

    it('should include capability dependencies in schema', async () => {
      const schemas = new Map<string, CapabilitySchema>()
      schemas.set('rpc.pipelining', {
        name: 'rpc.pipelining',
        description: 'Promise pipelining for chained calls',
        since: { major: 1, minor: 0, patch: 0 },
        requires: ['rpc.basic'],
        methods: [
          {
            name: 'pipeline',
            description: 'Create a pipeline builder',
            params: [],
            returns: 'PipelineBuilder<T>',
          },
        ],
      })

      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic', 'rpc.pipelining'],
        capabilitySchemas: schemas,
      })

      const schema = handler.getSchema('rpc.pipelining')
      expect(schema!.requires).toBeDefined()
      expect(schema!.requires).toContain('rpc.basic')
    })
  })

  describe('Connection Lifecycle', () => {
    it('should generate unique session ID for each connection', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      const response1 = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      const response2 = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Sessions should be unique
      expect(response1.sessionId).not.toBe(response2.sessionId)
    })

    it('should allow graceful connection close', async () => {
      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // Should be able to close
      await expect(connection.close()).resolves.not.toThrow()
    })

    it('should include client ID in request for debugging', async () => {
      const handler = createNegotiationHandler({
        supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
        supportedCapabilities: ['rpc.basic'],
        capabilitySchemas: new Map(),
      })

      const response = handler.negotiate({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
        clientId: 'test-client-123',
      })

      // Should succeed and include session
      expect(response.success).toBe(true)
      expect(response.sessionId).toBeDefined()
    })
  })

  describe('Integration with Existing RPC', () => {
    it('should be compatible with existing createRPCClient', async () => {
      // The negotiating client should return something compatible with
      // the existing RPC client interface
      const client = createNegotiatingClient<{ getOrders(): Promise<unknown[]> }>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      // After connection, should have access to client methods
      const connection = await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic'],
      })

      // The underlying client should be usable
      expect(client.client).toBeDefined()
    })

    it('should expose negotiated capabilities through $meta interface', async () => {
      // This test defines how negotiation integrates with existing $meta
      // The $meta.capabilities() should reflect what was negotiated

      const client = createNegotiatingClient<unknown>({
        target: 'https://test.api.dotdo.dev/negotiation-test',
      })

      await client.connect({
        version: { major: 1, minor: 0, patch: 0 },
        supportedCapabilities: ['rpc.basic', 'rpc.pipelining'],
      })

      // Connection capabilities should be accessible
      expect(client.connection.capabilities).toBeDefined()
      expect(Array.isArray(client.connection.capabilities)).toBe(true)
    })
  })
})
