/**
 * Webhook Receiver with HMAC Validation
 *
 * Provides robust webhook reception with:
 * - Multiple HMAC algorithms (SHA-256, SHA-1, SHA-512)
 * - Multiple header format patterns (Stripe, GitHub, Slack)
 * - Timestamp validation for replay protection
 * - Secret rotation support
 * - Idempotency via request ID tracking
 * - Event normalization to common format
 *
 * @example
 * ```typescript
 * import { WebhookReceiver } from 'db/primitives/triggers/webhook-receiver'
 *
 * const receiver = new WebhookReceiver()
 *
 * receiver.registerEndpoint('/webhooks/stripe', {
 *   provider: 'stripe',
 *   secrets: [process.env.STRIPE_WEBHOOK_SECRET!],
 *   timestampTolerance: 300, // 5 minutes
 * })
 *
 * const result = await receiver.handleRequest(request)
 * ```
 *
 * @module db/primitives/triggers/webhook-receiver
 */

// =============================================================================
// Types
// =============================================================================

export type HashAlgorithm = 'SHA-256' | 'SHA-1' | 'SHA-512'

export type WebhookProvider = 'stripe' | 'github' | 'slack' | 'generic'

export interface EndpointConfig {
  /** Provider type for auto-detecting signature format */
  provider?: WebhookProvider
  /** Secrets for HMAC validation (supports rotation with multiple secrets) */
  secrets: string[]
  /** Hash algorithm to use (default: SHA-256) */
  algorithm?: HashAlgorithm
  /** Header name for signature (auto-detected by provider if not set) */
  signatureHeader?: string
  /** Header name for timestamp (auto-detected by provider if not set) */
  timestampHeader?: string
  /** Timestamp tolerance in seconds for replay protection (default: 300) */
  timestampTolerance?: number
  /** Custom signature format parser */
  signatureParser?: (header: string) => ParsedSignature | null
  /** Enable idempotency tracking */
  enableIdempotency?: boolean
  /** Custom event normalizer */
  normalizer?: (payload: unknown) => NormalizedEvent
}

export interface ParsedSignature {
  signature: string
  timestamp?: number
  version?: string
}

export interface NormalizedEvent {
  id: string
  type: string
  source: string
  timestamp: Date
  data: unknown
  metadata?: Record<string, unknown>
}

export interface WebhookResult {
  success: boolean
  event?: NormalizedEvent
  error?: string
  isDuplicate?: boolean
}

export interface ValidationResult {
  valid: boolean
  error?: string
  matchedSecretIndex?: number
}

interface RegisteredEndpoint {
  path: string
  config: Required<Pick<EndpointConfig, 'secrets' | 'algorithm' | 'timestampTolerance'>> &
    Omit<EndpointConfig, 'secrets' | 'algorithm' | 'timestampTolerance'>
  processedIds: Set<string>
}

// =============================================================================
// Provider Configurations
// =============================================================================

const PROVIDER_CONFIGS: Record<WebhookProvider, Partial<EndpointConfig>> = {
  stripe: {
    algorithm: 'SHA-256',
    signatureHeader: 'Stripe-Signature',
    timestampTolerance: 300,
  },
  github: {
    algorithm: 'SHA-256',
    signatureHeader: 'X-Hub-Signature-256',
    timestampTolerance: 300,
  },
  slack: {
    algorithm: 'SHA-256',
    signatureHeader: 'X-Slack-Signature',
    timestampHeader: 'X-Slack-Request-Timestamp',
    timestampTolerance: 300,
  },
  generic: {
    algorithm: 'SHA-256',
    signatureHeader: 'X-Webhook-Signature',
    timestampTolerance: 300,
  },
}

// =============================================================================
// Signature Parsers
// =============================================================================

/**
 * Parse Stripe-style signature header: t=1234567890,v1=abc123
 */
export function parseStripeSignature(header: string): ParsedSignature | null {
  const parts = header.split(',')
  let timestamp: number | undefined
  let signature: string | undefined
  let version: string | undefined

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (key === 't') {
      timestamp = parseInt(value!, 10)
    } else if (key === 'v1') {
      signature = value
      version = 'v1'
    } else if (key === 'v0') {
      // Fallback to v0 if v1 not present
      if (!signature) {
        signature = value
        version = 'v0'
      }
    }
  }

  if (!signature) {
    return null
  }

  return { signature, timestamp, version }
}

/**
 * Parse GitHub-style signature header: sha256=abc123
 */
export function parseGitHubSignature(header: string): ParsedSignature | null {
  const match = header.match(/^(sha256|sha1)=([a-f0-9]+)$/i)
  if (!match) {
    return null
  }

  return {
    signature: match[2]!,
    version: match[1]!.toLowerCase(),
  }
}

/**
 * Parse Slack-style signature header: v0=abc123
 */
export function parseSlackSignature(header: string): ParsedSignature | null {
  const match = header.match(/^(v\d+)=([a-f0-9]+)$/i)
  if (!match) {
    return null
  }

  return {
    signature: match[2]!,
    version: match[1]!,
  }
}

/**
 * Parse generic plain hex signature
 */
export function parseGenericSignature(header: string): ParsedSignature | null {
  const trimmed = header.trim()
  if (!/^[a-f0-9]+$/i.test(trimmed)) {
    return null
  }

  return { signature: trimmed }
}

function getSignatureParser(provider: WebhookProvider): (header: string) => ParsedSignature | null {
  switch (provider) {
    case 'stripe':
      return parseStripeSignature
    case 'github':
      return parseGitHubSignature
    case 'slack':
      return parseSlackSignature
    case 'generic':
    default:
      return parseGenericSignature
  }
}

// =============================================================================
// HMAC Utilities
// =============================================================================

function getHashName(algorithm: HashAlgorithm): string {
  switch (algorithm) {
    case 'SHA-256':
      return 'SHA-256'
    case 'SHA-1':
      return 'SHA-1'
    case 'SHA-512':
      return 'SHA-512'
    default:
      return 'SHA-256'
  }
}

async function computeHMAC(payload: string, secret: string, algorithm: HashAlgorithm): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(payload)

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: getHashName(algorithm) }, false, ['sign'])

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const signatureArray = new Uint8Array(signature)

  return Array.from(signatureArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

// =============================================================================
// Event Normalizers
// =============================================================================

function normalizeStripeEvent(payload: unknown): NormalizedEvent {
  const data = payload as Record<string, unknown>
  return {
    id: (data.id as string) ?? crypto.randomUUID(),
    type: (data.type as string) ?? 'unknown',
    source: 'stripe',
    timestamp: data.created ? new Date((data.created as number) * 1000) : new Date(),
    data: data.data ?? payload,
    metadata: {
      livemode: data.livemode,
      api_version: data.api_version,
    },
  }
}

function normalizeGitHubEvent(payload: unknown, headers?: Headers): NormalizedEvent {
  const data = payload as Record<string, unknown>
  const eventType = headers?.get('X-GitHub-Event') ?? 'unknown'

  return {
    id: headers?.get('X-GitHub-Delivery') ?? crypto.randomUUID(),
    type: eventType,
    source: 'github',
    timestamp: new Date(),
    data: payload,
    metadata: {
      hook_id: headers?.get('X-GitHub-Hook-ID'),
      hook_installation_target_type: headers?.get('X-GitHub-Hook-Installation-Target-Type'),
    },
  }
}

function normalizeSlackEvent(payload: unknown): NormalizedEvent {
  const data = payload as Record<string, unknown>

  // Handle URL verification challenge
  if (data.type === 'url_verification') {
    return {
      id: crypto.randomUUID(),
      type: 'url_verification',
      source: 'slack',
      timestamp: new Date(),
      data: payload,
    }
  }

  // Handle event callbacks
  const event = (data.event as Record<string, unknown>) ?? {}
  return {
    id: (data.event_id as string) ?? crypto.randomUUID(),
    type: (event.type as string) ?? (data.type as string) ?? 'unknown',
    source: 'slack',
    timestamp: event.event_ts ? new Date(parseFloat(event.event_ts as string) * 1000) : new Date(),
    data: event,
    metadata: {
      team_id: data.team_id,
      api_app_id: data.api_app_id,
      event_context: data.event_context,
    },
  }
}

function normalizeGenericEvent(payload: unknown): NormalizedEvent {
  const data = payload as Record<string, unknown>
  return {
    id: (data.id as string) ?? (data.event_id as string) ?? crypto.randomUUID(),
    type: (data.type as string) ?? (data.event_type as string) ?? 'unknown',
    source: 'webhook',
    timestamp: data.timestamp ? new Date(data.timestamp as string | number) : new Date(),
    data: payload,
  }
}

function getEventNormalizer(
  provider: WebhookProvider
): (payload: unknown, headers?: Headers) => NormalizedEvent {
  switch (provider) {
    case 'stripe':
      return normalizeStripeEvent
    case 'github':
      return normalizeGitHubEvent
    case 'slack':
      return normalizeSlackEvent
    case 'generic':
    default:
      return normalizeGenericEvent
  }
}

// =============================================================================
// WebhookReceiver Implementation
// =============================================================================

export class WebhookReceiver {
  private endpoints: Map<string, RegisteredEndpoint> = new Map()

  /**
   * Register a webhook endpoint with configuration
   */
  registerEndpoint(path: string, config: EndpointConfig): void {
    const provider = config.provider ?? 'generic'
    const providerConfig = PROVIDER_CONFIGS[provider]

    const normalizedConfig = {
      ...providerConfig,
      ...config,
      provider,
      secrets: config.secrets,
      algorithm: config.algorithm ?? providerConfig.algorithm ?? 'SHA-256',
      timestampTolerance: config.timestampTolerance ?? providerConfig.timestampTolerance ?? 300,
    }

    this.endpoints.set(path, {
      path,
      config: normalizedConfig,
      processedIds: new Set(),
    })
  }

  /**
   * Unregister a webhook endpoint
   */
  unregisterEndpoint(path: string): boolean {
    return this.endpoints.delete(path)
  }

  /**
   * Get registered endpoint configuration
   */
  getEndpoint(path: string): RegisteredEndpoint | undefined {
    return this.endpoints.get(path)
  }

  /**
   * List all registered endpoint paths
   */
  listEndpoints(): string[] {
    return Array.from(this.endpoints.keys())
  }

  /**
   * Validate webhook signature against provided secret(s)
   */
  async validateSignature(
    request: Request,
    secret: string | string[],
    options?: {
      algorithm?: HashAlgorithm
      signatureHeader?: string
      signatureParser?: (header: string) => ParsedSignature | null
      timestampHeader?: string
      timestampTolerance?: number
      provider?: WebhookProvider
    }
  ): Promise<ValidationResult> {
    const secrets = Array.isArray(secret) ? secret : [secret]
    const algorithm = options?.algorithm ?? 'SHA-256'
    const provider = options?.provider ?? 'generic'
    const signatureHeader = options?.signatureHeader ?? PROVIDER_CONFIGS[provider].signatureHeader ?? 'X-Webhook-Signature'
    const timestampHeader = options?.timestampHeader ?? PROVIDER_CONFIGS[provider].timestampHeader
    const timestampTolerance = options?.timestampTolerance ?? 300
    const signatureParser = options?.signatureParser ?? getSignatureParser(provider)

    // Get signature from header
    const signatureHeaderValue = request.headers.get(signatureHeader)
    if (!signatureHeaderValue) {
      return { valid: false, error: `Missing signature header: ${signatureHeader}` }
    }

    // Parse signature
    const parsed = signatureParser(signatureHeaderValue)
    if (!parsed) {
      return { valid: false, error: 'Invalid signature format' }
    }

    // Validate timestamp if present
    let timestamp: number | undefined = parsed.timestamp
    if (timestampHeader && !timestamp) {
      const tsHeader = request.headers.get(timestampHeader)
      if (tsHeader) {
        timestamp = parseInt(tsHeader, 10)
      }
    }

    if (timestamp !== undefined) {
      const now = Math.floor(Date.now() / 1000)
      const diff = Math.abs(now - timestamp)
      if (diff > timestampTolerance) {
        return { valid: false, error: `Timestamp outside tolerance: ${diff}s > ${timestampTolerance}s` }
      }
    }

    // Get payload
    const payload = await request.clone().text()

    // Build signing payload (provider-specific)
    let signingPayload: string
    if (provider === 'stripe' && timestamp !== undefined) {
      signingPayload = `${timestamp}.${payload}`
    } else if (provider === 'slack' && timestamp !== undefined) {
      signingPayload = `v0:${timestamp}:${payload}`
    } else {
      signingPayload = payload
    }

    // Try each secret (for rotation support)
    for (let i = 0; i < secrets.length; i++) {
      const expectedSignature = await computeHMAC(signingPayload, secrets[i]!, algorithm)
      if (timingSafeEqual(expectedSignature, parsed.signature.toLowerCase())) {
        return { valid: true, matchedSecretIndex: i }
      }
    }

    return { valid: false, error: 'Signature mismatch' }
  }

  /**
   * Handle incoming webhook request
   */
  async handleRequest(request: Request): Promise<WebhookResult> {
    const url = new URL(request.url)
    const endpoint = this.endpoints.get(url.pathname)

    if (!endpoint) {
      return { success: false, error: `Unknown endpoint: ${url.pathname}` }
    }

    const { config, processedIds } = endpoint
    const provider = config.provider ?? 'generic'

    // Validate signature
    const validation = await this.validateSignature(request, config.secrets, {
      algorithm: config.algorithm,
      signatureHeader: config.signatureHeader,
      signatureParser: config.signatureParser,
      timestampHeader: config.timestampHeader,
      timestampTolerance: config.timestampTolerance,
      provider,
    })

    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Parse payload
    let payload: unknown
    try {
      payload = await request.clone().json()
    } catch {
      return { success: false, error: 'Invalid JSON payload' }
    }

    // Normalize event
    const normalizer = config.normalizer ?? getEventNormalizer(provider)
    const event = normalizer(payload, request.headers)

    // Check idempotency
    if (config.enableIdempotency) {
      if (processedIds.has(event.id)) {
        return { success: true, event, isDuplicate: true }
      }
      processedIds.add(event.id)

      // Limit processed IDs to prevent memory growth
      if (processedIds.size > 10000) {
        const idsArray = Array.from(processedIds)
        for (let i = 0; i < 5000; i++) {
          processedIds.delete(idsArray[i]!)
        }
      }
    }

    return { success: true, event }
  }

  /**
   * Format response for provider expectations
   */
  formatResponse(result: WebhookResult, provider?: WebhookProvider): Response {
    const status = result.success ? 200 : 400

    // Provider-specific responses
    if (provider === 'slack' && result.event?.type === 'url_verification') {
      const challenge = (result.event.data as Record<string, unknown>)?.challenge
      return new Response(JSON.stringify({ challenge }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (result.isDuplicate) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ received: true, eventId: result.event?.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Clear processed IDs for an endpoint (useful for testing)
   */
  clearProcessedIds(path: string): void {
    const endpoint = this.endpoints.get(path)
    if (endpoint) {
      endpoint.processedIds.clear()
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new WebhookReceiver instance
 */
export function createWebhookReceiver(): WebhookReceiver {
  return new WebhookReceiver()
}

// =============================================================================
// Exports
// =============================================================================

export { computeHMAC as generateSignature }
