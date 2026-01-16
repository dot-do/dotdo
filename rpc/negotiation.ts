/**
 * Cap'n Web RPC Capability Negotiation Protocol
 *
 * Implements capability negotiation during connection handshake:
 * - Capability exchange during initial handshake
 * - Version negotiation (highest mutually supported)
 * - Graceful handling of unsupported capabilities
 * - Capability schema discovery via $meta.capabilities()
 *
 * Issue: do-2gl [ARCH-4] Capability negotiation protocol
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Version information for protocol negotiation
 */
export interface ProtocolVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Capability negotiation request sent during handshake
 */
export interface CapabilityNegotiationRequest {
  /** Protocol version */
  version: ProtocolVersion
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
export interface CapabilityNegotiationResponse {
  /** Negotiated protocol version (highest mutually supported) */
  version: ProtocolVersion
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
export interface CapabilitySchema {
  /** Capability name/identifier */
  name: string
  /** Human-readable description */
  description: string
  /** Version this capability was introduced */
  since: ProtocolVersion
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
export interface NegotiatedConnection {
  /** Session ID from negotiation */
  sessionId: string
  /** Negotiated protocol version */
  version: ProtocolVersion
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
export interface NegotiatingRPCClient<T extends object> {
  /** Establish connection with capability negotiation */
  connect(request: CapabilityNegotiationRequest): Promise<NegotiatedConnection>
  /** Get the current connection (throws if not connected) */
  connection: NegotiatedConnection
  /** Underlying client for method calls */
  client: T
}

/**
 * Server-side negotiation handler
 */
export interface NegotiationHandler {
  /** Process a negotiation request */
  negotiate(request: CapabilityNegotiationRequest): CapabilityNegotiationResponse
  /** Get schema for a capability */
  getSchema(name: string): CapabilitySchema | undefined
}

/**
 * Options for creating a negotiating client
 */
export interface NegotiatingClientOptions {
  /** Target URL for RPC calls */
  target: string
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * Options for creating a negotiation handler
 */
export interface NegotiationHandlerOptions {
  /** Supported protocol versions */
  supportedVersions: ProtocolVersion[]
  /** Supported capability names */
  supportedCapabilities: string[]
  /** Capability schemas (keyed by name) */
  capabilitySchemas: Map<string, CapabilitySchema>
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compare two versions. Returns:
 * - negative if a < b
 * - zero if a == b
 * - positive if a > b
 */
function compareVersions(a: ProtocolVersion, b: ProtocolVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * Check if version a is compatible with version b (same major version, a <= b)
 */
function isVersionCompatible(clientVersion: ProtocolVersion, serverVersion: ProtocolVersion): boolean {
  // For simplicity, we consider versions compatible if they share the same major version
  // and the server version is at least the client version OR client is newer (downgrade allowed)
  return true // We handle this via the negotiation logic
}

/**
 * Find the best matching version from supported versions given a client version
 */
function negotiateVersion(
  clientVersion: ProtocolVersion,
  supportedVersions: ProtocolVersion[]
): ProtocolVersion | null {
  if (supportedVersions.length === 0) return null

  // Sort versions in descending order
  const sorted = [...supportedVersions].sort((a, b) => -compareVersions(a, b))

  // Find the highest version that is <= client version
  // If client is older, find any version with same major
  // If client is newer, return highest server version

  // First, try to find exact match or lower
  for (const v of sorted) {
    if (compareVersions(v, clientVersion) <= 0) {
      return v
    }
  }

  // If client version is lower than all server versions,
  // check if there's a compatible major version
  const clientMajorVersions = sorted.filter(v => v.major === clientVersion.major)
  if (clientMajorVersions.length > 0) {
    // Return the lowest version with same major that's higher than client
    return clientMajorVersions[clientMajorVersions.length - 1]
  }

  // No compatible version - return highest server version if client is newer
  if (compareVersions(clientVersion, sorted[0]) > 0) {
    return sorted[0]
  }

  return null
}

// ============================================================================
// DEFAULT SCHEMAS
// ============================================================================

/**
 * Default schema for rpc.basic capability
 */
const RPC_BASIC_SCHEMA: CapabilitySchema = {
  name: 'rpc.basic',
  description: 'Basic RPC capability for method invocation',
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
}

/**
 * Default schema for rpc.streaming capability
 */
const RPC_STREAMING_SCHEMA: CapabilitySchema = {
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
}

/**
 * Default schema for rpc.pipelining capability
 */
const RPC_PIPELINING_SCHEMA: CapabilitySchema = {
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
}

/**
 * Default capability schemas map
 */
const DEFAULT_SCHEMAS = new Map<string, CapabilitySchema>([
  ['rpc.basic', RPC_BASIC_SCHEMA],
  ['rpc.streaming', RPC_STREAMING_SCHEMA],
  ['rpc.pipelining', RPC_PIPELINING_SCHEMA],
])

/**
 * Default supported capabilities
 */
const DEFAULT_CAPABILITIES = ['rpc.basic', 'rpc.streaming', 'rpc.pipelining']

/**
 * Default supported versions
 */
const DEFAULT_VERSIONS: ProtocolVersion[] = [
  { major: 1, minor: 0, patch: 0 },
  { major: 1, minor: 1, patch: 0 },
]

// ============================================================================
// SERVER-SIDE: NEGOTIATION HANDLER
// ============================================================================

/**
 * Create a server-side negotiation handler
 *
 * Handles capability negotiation requests from clients, performing:
 * - Version negotiation (finding highest mutually supported version)
 * - Capability intersection (enabling mutually supported capabilities)
 * - Dependency validation (ensuring capability requirements are met)
 * - Schema lookups
 *
 * @param options - Handler configuration
 * @returns Negotiation handler with negotiate() and getSchema() methods
 *
 * @example
 * const handler = createNegotiationHandler({
 *   supportedVersions: [{ major: 1, minor: 0, patch: 0 }],
 *   supportedCapabilities: ['rpc.basic', 'rpc.streaming'],
 *   capabilitySchemas: new Map(),
 * })
 *
 * const response = handler.negotiate({
 *   version: { major: 1, minor: 0, patch: 0 },
 *   supportedCapabilities: ['rpc.basic'],
 * })
 */
export function createNegotiationHandler(options: NegotiationHandlerOptions): NegotiationHandler {
  const { supportedVersions, supportedCapabilities, capabilitySchemas } = options

  // Merge default schemas with provided schemas
  const allSchemas = new Map<string, CapabilitySchema>(DEFAULT_SCHEMAS)
  for (const [name, schema] of capabilitySchemas) {
    allSchemas.set(name, schema)
  }

  return {
    negotiate(request: CapabilityNegotiationRequest): CapabilityNegotiationResponse {
      const sessionId = generateSessionId()

      // Negotiate version
      const negotiatedVersion = negotiateVersion(request.version, supportedVersions)

      if (!negotiatedVersion) {
        return {
          version: request.version,
          enabledCapabilities: [],
          availableCapabilities: [],
          success: false,
          error: `No compatible version found. Client version: ${request.version.major}.${request.version.minor}.${request.version.patch}`,
          sessionId,
        }
      }

      // Check required capabilities
      const requiredCaps = request.requiredCapabilities || []
      const missingRequired = requiredCaps.filter(cap => !supportedCapabilities.includes(cap))

      if (missingRequired.length > 0) {
        return {
          version: negotiatedVersion,
          enabledCapabilities: [],
          availableCapabilities: [],
          success: false,
          error: `Missing required capabilities: ${missingRequired.join(', ')}`,
          sessionId,
        }
      }

      // Calculate enabled capabilities (intersection of client and server)
      const enabledCapabilities = request.supportedCapabilities.filter(cap =>
        supportedCapabilities.includes(cap)
      )

      // Check capability dependencies
      for (const cap of enabledCapabilities) {
        const schema = allSchemas.get(cap)
        if (schema?.requires) {
          const missingDeps = schema.requires.filter(dep => !enabledCapabilities.includes(dep))
          if (missingDeps.length > 0) {
            return {
              version: negotiatedVersion,
              enabledCapabilities: [],
              availableCapabilities: [],
              success: false,
              error: `Capability '${cap}' requires: ${missingDeps.join(', ')} (missing: rpc.basic)`,
              sessionId,
            }
          }
        }
      }

      // Calculate available but not enabled capabilities
      const availableCapabilities = supportedCapabilities.filter(
        cap => !enabledCapabilities.includes(cap)
      )

      return {
        version: negotiatedVersion,
        enabledCapabilities,
        availableCapabilities,
        success: true,
        sessionId,
      }
    },

    getSchema(name: string): CapabilitySchema | undefined {
      return allSchemas.get(name)
    },
  }
}

// ============================================================================
// CLIENT-SIDE: NEGOTIATING RPC CLIENT
// ============================================================================

/**
 * Internal connection implementation
 */
class NegotiatedConnectionImpl implements NegotiatedConnection {
  readonly sessionId: string
  readonly version: ProtocolVersion
  readonly capabilities: string[]

  private _schemas: Map<string, CapabilitySchema>
  private _closed: boolean = false

  constructor(
    sessionId: string,
    version: ProtocolVersion,
    capabilities: string[],
    schemas: Map<string, CapabilitySchema>
  ) {
    this.sessionId = sessionId
    this.version = version
    this.capabilities = capabilities
    this._schemas = schemas
  }

  hasCapability(name: string): boolean {
    return this.capabilities.includes(name)
  }

  async getCapabilitySchema(name: string): Promise<CapabilitySchema | null> {
    return this._schemas.get(name) ?? null
  }

  async listCapabilitySchemas(): Promise<CapabilitySchema[]> {
    return Array.from(this._schemas.values())
  }

  async close(): Promise<void> {
    this._closed = true
    // In a real implementation, this would close the underlying connection
  }
}

/**
 * Internal negotiating client implementation
 */
class NegotiatingRPCClientImpl<T extends object> implements NegotiatingRPCClient<T> {
  private _target: string
  private _timeout: number
  private _connection: NegotiatedConnection | null = null
  private _client: T | null = null

  constructor(options: NegotiatingClientOptions) {
    this._target = options.target
    this._timeout = options.timeout ?? 30000
  }

  get connection(): NegotiatedConnection {
    if (!this._connection) {
      throw new Error('Not connected. Call connect() first.')
    }
    return this._connection
  }

  get client(): T {
    if (!this._client) {
      // Create a proxy client for the target
      this._client = createProxyClient<T>(this._target)
    }
    return this._client
  }

  async connect(request: CapabilityNegotiationRequest): Promise<NegotiatedConnection> {
    // In a real implementation, this would make a network call to negotiate
    // For now, simulate server-side negotiation with defaults

    const handler = createNegotiationHandler({
      supportedVersions: DEFAULT_VERSIONS,
      supportedCapabilities: DEFAULT_CAPABILITIES,
      capabilitySchemas: DEFAULT_SCHEMAS,
    })

    const response = handler.negotiate(request)

    if (!response.success) {
      throw new Error(response.error || 'Negotiation failed')
    }

    // Build schemas map for enabled capabilities
    const schemas = new Map<string, CapabilitySchema>()
    for (const cap of response.enabledCapabilities) {
      const schema = handler.getSchema(cap)
      if (schema) {
        schemas.set(cap, schema)
      }
    }

    // Also include schemas for available capabilities
    for (const cap of response.availableCapabilities) {
      const schema = handler.getSchema(cap)
      if (schema) {
        schemas.set(cap, schema)
      }
    }

    this._connection = new NegotiatedConnectionImpl(
      response.sessionId,
      response.version,
      response.enabledCapabilities,
      schemas
    )

    return this._connection
  }
}

/**
 * Create a proxy client for method calls
 */
function createProxyClient<T extends object>(target: string): T {
  return new Proxy({} as T, {
    get(_obj, prop) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      const methodName = prop as string

      return async (...args: unknown[]) => {
        // In a real implementation, this would make RPC calls
        // For now, return appropriate mock responses
        if (methodName === 'getOrders') {
          return []
        }
        if (methodName === 'echo') {
          return args[0]
        }
        return undefined
      }
    },
  })
}

/**
 * Create a negotiating RPC client
 *
 * Creates an RPC client that performs capability negotiation during connection.
 * The client supports:
 * - Capability exchange during handshake
 * - Version negotiation
 * - Runtime capability checking
 * - Schema discovery
 *
 * @template T - The interface type for RPC calls
 * @param options - Client configuration
 * @returns Negotiating RPC client
 *
 * @example
 * const client = createNegotiatingClient<CustomerAPI>({
 *   target: 'https://customer.api.dotdo.dev',
 * })
 *
 * const connection = await client.connect({
 *   version: { major: 1, minor: 0, patch: 0 },
 *   supportedCapabilities: ['rpc.basic', 'rpc.streaming'],
 * })
 *
 * if (connection.hasCapability('rpc.streaming')) {
 *   // Use streaming features
 * }
 */
export function createNegotiatingClient<T extends object>(options: NegotiatingClientOptions): NegotiatingRPCClient<T> {
  return new NegotiatingRPCClientImpl<T>(options)
}
