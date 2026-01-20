// Base DO class - THE Durable Object for Digital Objects
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { WorkflowContext } from './context'
import { EntityManager } from './entities'
import { WebSocketManager } from './websocket'
import { HibernationManager, type HibernationConfig, type HibernationAttachment, type HibernationState } from './hibernation'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder } from '../db'
import { IntegrationRegistry } from '../integrations'
import { RPCError, NotFoundError, InternalError } from '../rpc/errors'
import { createLogger } from '../utils/logger'

const logger = createLogger('[DO]')

export interface DOEnv {
  [key: string]: unknown
  // Common secret environment variables
  JWT_SECRET?: string
  JWKS_URL?: string
  DO_INTERNAL_SECRET?: string
}

/**
 * Configuration for secret validation on DO startup
 * Allows customizing which secrets are required for a given deployment
 */
export interface SecretValidationConfig {
  /**
   * Require JWT_SECRET or JWKS_URL for authentication
   * @default false
   */
  requireAuth?: boolean

  /**
   * Require DO_INTERNAL_SECRET for DO-to-DO HMAC signing
   * @default false
   */
  requireInternalSecret?: boolean

  /**
   * Custom required environment variables
   * Specify key names that must be present and non-empty
   */
  requiredEnvVars?: string[]

  /**
   * Skip all validation (useful for testing)
   * @default false
   */
  skipValidation?: boolean
}

/**
 * Result of secret validation
 */
export interface SecretValidationResult {
  valid: boolean
  missing: string[]
  warnings: string[]
}

/**
 * Error thrown when required secrets are missing on DO startup
 */
export class MissingSecretsError extends Error {
  public readonly missingSecrets: string[]

  constructor(missingSecrets: string[]) {
    const message = `Missing required secrets: ${missingSecrets.join(', ')}. ` +
      `Configure these in your wrangler.toml [vars] or as Cloudflare secrets.`
    super(message)
    this.name = 'MissingSecretsError'
    this.missingSecrets = missingSecrets
  }
}

export interface DOOptions {
  cors?: boolean
  /**
   * Secret validation configuration
   * When provided, validates required secrets are present on startup
   */
  secretValidation?: SecretValidationConfig
  /**
   * Hibernation configuration for WebSocket connections
   * Enables cost-effective real-time connections with 95%+ savings on idle
   */
  hibernation?: HibernationConfig
}

export class DO implements DurableObject {
  protected app: Hono
  protected state: DurableObjectState
  protected env: DOEnv
  protected $!: WorkflowContext
  private routesInitialized = false
  private entityManager: EntityManager
  private websocketManager: WebSocketManager
  private _integrations: IntegrationRegistry

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env

    // Validate required secrets on startup (do-pj71)
    if (options.secretValidation) {
      this.validateRequiredSecrets(env, options.secretValidation)
    }

    this.app = new Hono()
    // Pass SQL storage to EntityManager for persistence (do-4s3f)
    // state.storage.sql is the SQLite storage on Durable Objects
    const sql = (state.storage as any).sql
    this.entityManager = new EntityManager({ sql })
    this.websocketManager = new WebSocketManager()
    this._integrations = new IntegrationRegistry()

    // Initialize EntityManager (runs migrations) within blockConcurrencyWhile
    // to ensure schema is ready before any requests are processed
    if (sql) {
      state.blockConcurrencyWhile(async () => {
        await this.entityManager.ensureInitialized()
      })
    }

    // Setup middleware
    if (options.cors !== false) {
      this.app.use('/*', cors())
    }

    // Setup default routes
    this.setupRoutes()
  }

  /**
   * Validate that required secrets are present in the environment
   * Throws MissingSecretsError if any required secrets are missing
   *
   * @param env - The environment object containing secrets
   * @param config - Validation configuration specifying which secrets are required
   * @throws MissingSecretsError if required secrets are missing
   */
  protected validateRequiredSecrets(env: DOEnv, config: SecretValidationConfig): SecretValidationResult {
    if (config.skipValidation) {
      return { valid: true, missing: [], warnings: [] }
    }

    const missing: string[] = []
    const warnings: string[] = []

    // Check auth secrets (JWT_SECRET or JWKS_URL)
    if (config.requireAuth) {
      const hasJwtSecret = typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length > 0
      const hasJwksUrl = typeof env.JWKS_URL === 'string' && env.JWKS_URL.length > 0

      if (!hasJwtSecret && !hasJwksUrl) {
        missing.push('JWT_SECRET or JWKS_URL')
      }

      // Warn about weak JWT secrets
      if (hasJwtSecret && typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length < 32) {
        warnings.push('JWT_SECRET should be at least 32 characters for security')
      }
    }

    // Check DO internal secret for DO-to-DO authentication
    if (config.requireInternalSecret) {
      const hasInternalSecret = typeof env.DO_INTERNAL_SECRET === 'string' && env.DO_INTERNAL_SECRET.length > 0

      if (!hasInternalSecret) {
        missing.push('DO_INTERNAL_SECRET')
      } else if (typeof env.DO_INTERNAL_SECRET === 'string' && env.DO_INTERNAL_SECRET.length < 32) {
        warnings.push('DO_INTERNAL_SECRET should be at least 32 characters for security')
      }
    }

    // Check custom required environment variables
    if (config.requiredEnvVars && config.requiredEnvVars.length > 0) {
      for (const varName of config.requiredEnvVars) {
        const value = env[varName]
        if (value === undefined || value === null || value === '') {
          missing.push(varName)
        }
      }
    }

    // Log warnings
    for (const warning of warnings) {
      logger.warn(`Secret validation warning: ${warning}`)
    }

    // Throw if any required secrets are missing
    if (missing.length > 0) {
      logger.error(`Missing required secrets: ${missing.join(', ')}`)
      throw new MissingSecretsError(missing)
    }

    return { valid: true, missing: [], warnings }
  }

  /**
   * Static helper to validate secrets without instantiating a DO
   * Useful for checking configuration in tests or worker initialization
   */
  static validateSecrets(env: DOEnv, config: SecretValidationConfig): SecretValidationResult {
    if (config.skipValidation) {
      return { valid: true, missing: [], warnings: [] }
    }

    const missing: string[] = []
    const warnings: string[] = []

    if (config.requireAuth) {
      const hasJwtSecret = typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length > 0
      const hasJwksUrl = typeof env.JWKS_URL === 'string' && env.JWKS_URL.length > 0

      if (!hasJwtSecret && !hasJwksUrl) {
        missing.push('JWT_SECRET or JWKS_URL')
      }

      if (hasJwtSecret && typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length < 32) {
        warnings.push('JWT_SECRET should be at least 32 characters for security')
      }
    }

    if (config.requireInternalSecret) {
      const hasInternalSecret = typeof env.DO_INTERNAL_SECRET === 'string' && env.DO_INTERNAL_SECRET.length > 0

      if (!hasInternalSecret) {
        missing.push('DO_INTERNAL_SECRET')
      } else if (typeof env.DO_INTERNAL_SECRET === 'string' && env.DO_INTERNAL_SECRET.length < 32) {
        warnings.push('DO_INTERNAL_SECRET should be at least 32 characters for security')
      }
    }

    if (config.requiredEnvVars && config.requiredEnvVars.length > 0) {
      for (const varName of config.requiredEnvVars) {
        const value = env[varName]
        if (value === undefined || value === null || value === '') {
          missing.push(varName)
        }
      }
    }

    return {
      valid: missing.length === 0,
      missing,
      warnings,
    }
  }

  // WebSocket manager accessor
  get ws(): WebSocketManager {
    return this.websocketManager
  }

  // Integration registry accessor
  get integrations(): IntegrationRegistry {
    return this._integrations
  }

  // Entity store accessors
  get things(): ThingsStore {
    return this.entityManager.things
  }

  get events(): EventsStore {
    return this.entityManager.events
  }

  get relationships(): RelationshipsStore {
    return this.entityManager.relationships
  }

  // Audit logging accessors (do-xebw)
  get auditLogs(): AuditLogStore {
    return this.entityManager.auditLogs
  }

  /**
   * Set the audit context for tracking who performed actions
   * Call this at the start of request handling
   */
  setAuditContext(context: AuditContext): void {
    this.entityManager.setAuditContext(context)
  }

  /**
   * Get the current audit context
   */
  getAuditContext(): AuditContext {
    return this.entityManager.getAuditContext()
  }

  query(): QueryBuilder {
    return this.entityManager.query()
  }

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // RPC endpoint
    this.app.post('/rpc', async (c) => {
      try {
        const { method, args } = await c.req.json<{ method: string; args: unknown[] }>()

        // Navigate to method
        const parts = method.split('.')
        let current: any = this

        for (let i = 0; i < parts.length - 1; i++) {
          current = current[parts[i]]
          if (!current) {
            const error = new NotFoundError(`Method not found: ${method}`)
            return c.json(error.toJSON(), error.httpStatus)
          }
        }

        const fn = current[parts[parts.length - 1]]
        if (typeof fn !== 'function') {
          const error = new NotFoundError(`Method not found: ${method}`)
          return c.json(error.toJSON(), error.httpStatus)
        }

        const result = await fn.apply(current, args)
        return c.json(result)
      } catch (error) {
        // Re-throw RPCErrors with proper formatting
        if (error instanceof RPCError) {
          return c.json(error.toJSON(), error.httpStatus)
        }
        // Wrap unknown errors in InternalError
        const wrappedError = InternalError.wrap(error)
        logger.error('RPC error:', error)
        return c.json(wrappedError.toJSON(), wrappedError.httpStatus)
      }
    })

    // Storage info
    this.app.get('/info', async (c) => {
      const stored = await this.state.storage.list()
      return c.json({
        id: this.state.id.toString(),
        keys: stored.size,
      })
    })
  }

  // Subclasses can override to add routes
  protected routes(_app: Hono): void {
    // Override in subclass
  }

  async fetch(request: Request): Promise<Response> {
    // Allow subclasses to add routes (only once)
    if (!this.routesInitialized) {
      this.routes(this.app)
      this.routesInitialized = true
    }
    return this.app.fetch(request)
  }

  // Alarm handler (for scheduling)
  async alarm(): Promise<void> {
    // Override in subclass or use $ scheduling
  }

  // WebSocket handlers - Override in subclass for custom behavior

  /**
   * Handle incoming WebSocket message
   * By default, routes to WebSocketManager handlers
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.websocketManager.handleMessage(ws, message)
  }

  /**
   * Handle WebSocket close event
   * By default, cleans up WebSocket tracking
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error event
   * Override in subclass for custom error handling
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log with context - no silent catches
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)
    this.websocketManager.cleanupWebSocket(ws)
  }
}
