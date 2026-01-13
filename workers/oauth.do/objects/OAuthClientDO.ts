/**
 * OAuthClientDO - Durable Object for OAuth Client Management
 *
 * Stores and manages OAuth client registrations with:
 * - Client credentials (id, secret)
 * - Redirect URIs
 * - Allowed scopes and grant types
 * - Rate limiting per client
 *
 * Each client has its own DO instance, identified by client_id.
 */

import type { OAuthClient, ClientRegistrationRequest, ClientRegistrationResponse } from '../types'
import { generateClientId, generateClientSecret, hashSecret } from '../crypto'

// ============================================================================
// Types
// ============================================================================

interface ClientState extends Omit<OAuthClient, 'clientSecret'> {
  clientSecretHash: string
  rateLimitRequests: number
  rateLimitResetAt: number
}

interface CreateClientInput {
  name: string
  redirectUris: string[]
  scopes?: string[]
  grantTypes?: string[]
  userId: string
  organizationId?: string
  public?: boolean
  skipConsent?: boolean
}

// ============================================================================
// Durable Object
// ============================================================================

/**
 * OAuth Client Durable Object
 *
 * Manages a single OAuth client registration.
 *
 * @example
 * ```typescript
 * // Get client DO by client_id
 * const clientId = 'cl_abc123'
 * const id = env.OAUTH_CLIENTS.idFromName(clientId)
 * const stub = env.OAUTH_CLIENTS.get(id)
 *
 * // Validate client credentials
 * const response = await stub.fetch('/validate', {
 *   method: 'POST',
 *   body: JSON.stringify({ clientSecret: 'cs_xxx' })
 * })
 * ```
 */
export class OAuthClientDO implements DurableObject {
  private state: DurableObjectState
  private clientData: ClientState | null = null

  constructor(state: DurableObjectState) {
    this.state = state
  }

  /**
   * Load client data from storage
   */
  private async ensureLoaded(): Promise<ClientState | null> {
    if (this.clientData === null) {
      this.clientData = await this.state.storage.get<ClientState>('client') || null
    }
    return this.clientData
  }

  /**
   * Save client data to storage
   */
  private async save(): Promise<void> {
    if (this.clientData) {
      await this.state.storage.put('client', this.clientData)
    }
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      switch (path) {
        case '/':
        case '/get':
          return this.handleGet()

        case '/create':
          return this.handleCreate(request)

        case '/update':
          return this.handleUpdate(request)

        case '/validate':
          return this.handleValidate(request)

        case '/rotate-secret':
          return this.handleRotateSecret()

        case '/delete':
          return this.handleDelete()

        case '/rate-limit':
          return this.handleRateLimit(request)

        default:
          return new Response('Not Found', { status: 404 })
      }
    } catch (error) {
      console.error('OAuthClientDO error:', error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  /**
   * Get client data (without secret)
   */
  private async handleGet(): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Return client without secret hash
    const { clientSecretHash, ...publicData } = client
    return new Response(JSON.stringify(publicData), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Create a new client
   */
  private async handleCreate(request: Request): Promise<Response> {
    const existing = await this.ensureLoaded()
    if (existing) {
      return new Response(JSON.stringify({ error: 'Client already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const input = await request.json() as CreateClientInput

    // Generate credentials
    const clientId = generateClientId()
    const clientSecret = generateClientSecret()
    const clientSecretHash = await hashSecret(clientSecret)

    const now = new Date()

    this.clientData = {
      id: crypto.randomUUID(),
      clientId,
      clientSecretHash,
      name: input.name,
      redirectUris: input.redirectUris,
      scopes: input.scopes || ['openid', 'profile', 'email'],
      grantTypes: input.grantTypes || ['authorization_code', 'refresh_token'],
      public: input.public || false,
      skipConsent: input.skipConsent || false,
      userId: input.userId,
      organizationId: input.organizationId,
      rateLimitRequests: 0,
      rateLimitResetAt: Date.now() + 3600000, // 1 hour from now
      createdAt: now,
      updatedAt: now,
    }

    await this.save()

    // Return client data WITH the plaintext secret (only time it's returned)
    const { clientSecretHash: _, rateLimitRequests: __, rateLimitResetAt: ___, ...publicData } = this.clientData
    return new Response(
      JSON.stringify({
        ...publicData,
        clientSecret, // Only returned on creation
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  /**
   * Update client settings
   */
  private async handleUpdate(request: Request): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const updates = await request.json() as Partial<CreateClientInput>

    if (updates.name !== undefined) client.name = updates.name
    if (updates.redirectUris !== undefined) client.redirectUris = updates.redirectUris
    if (updates.scopes !== undefined) client.scopes = updates.scopes
    if (updates.grantTypes !== undefined) client.grantTypes = updates.grantTypes
    if (updates.skipConsent !== undefined) client.skipConsent = updates.skipConsent

    client.updatedAt = new Date()

    await this.save()

    const { clientSecretHash, rateLimitRequests, rateLimitResetAt, ...publicData } = client
    return new Response(JSON.stringify(publicData), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Validate client credentials
   */
  private async handleValidate(request: Request): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ valid: false, error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { clientSecret } = await request.json() as { clientSecret: string }

    // Public clients don't need secret validation
    if (client.public) {
      return new Response(JSON.stringify({ valid: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate secret
    const secretHash = await hashSecret(clientSecret)
    const valid = secretHash === client.clientSecretHash

    return new Response(
      JSON.stringify({
        valid,
        ...(valid ? {} : { error: 'Invalid client secret' }),
      }),
      {
        status: valid ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  /**
   * Rotate client secret
   */
  private async handleRotateSecret(): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Generate new secret
    const newSecret = generateClientSecret()
    client.clientSecretHash = await hashSecret(newSecret)
    client.updatedAt = new Date()

    await this.save()

    return new Response(
      JSON.stringify({
        clientId: client.clientId,
        clientSecret: newSecret, // Only returned on rotation
        rotatedAt: new Date().toISOString(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  /**
   * Delete client
   */
  private async handleDelete(): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await this.state.storage.delete('client')
    this.clientData = null

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Check and update rate limits
   */
  private async handleRateLimit(request: Request): Promise<Response> {
    const client = await this.ensureLoaded()
    if (!client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { action } = await request.json() as { action: 'check' | 'increment' }
    const now = Date.now()

    // Reset if window has passed
    if (now > client.rateLimitResetAt) {
      client.rateLimitRequests = 0
      client.rateLimitResetAt = now + 3600000 // 1 hour
    }

    const limit = 1000 // Default rate limit per hour
    const remaining = Math.max(0, limit - client.rateLimitRequests)
    const allowed = remaining > 0

    if (action === 'increment' && allowed) {
      client.rateLimitRequests++
      await this.save()
    }

    return new Response(
      JSON.stringify({
        allowed,
        limit,
        remaining: action === 'increment' ? remaining - 1 : remaining,
        reset: client.rateLimitResetAt,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
