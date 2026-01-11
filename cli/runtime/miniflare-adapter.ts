/**
 * Miniflare Adapter
 *
 * Wraps Miniflare for local DO runtime with full feature support.
 * Provides DO isolation, SQLite storage, and RPC bridging.
 */

import type { Miniflare, MiniflareOptions, DurableObjectNamespace } from 'miniflare'
import { Logger, createLogger } from '../utils/logger'
import { loadConfig, type DotdoConfig } from '../utils/config'
import { DORegistry } from './do-registry'
import { EmbeddedDB } from './embedded-db'

export interface MiniflareAdapterOptions {
  port?: number
  config?: DotdoConfig
  logger?: Logger
  modules?: boolean
  persist?: boolean | string
  durableObjects?: Record<string, { className: string; scriptName?: string }>
}

export interface RunningInstance {
  miniflare: Miniflare
  port: number
  url: string
  stop: () => Promise<void>
}

/**
 * Creates and configures Miniflare for local DO development
 */
export class MiniflareAdapter {
  private miniflare: Miniflare | null = null
  private logger: Logger
  private config: DotdoConfig
  private registry: DORegistry
  private db: EmbeddedDB

  constructor(options: MiniflareAdapterOptions = {}) {
    this.logger = options.logger ?? createLogger('miniflare')
    this.config = options.config ?? loadConfig()
    this.registry = new DORegistry({ logger: this.logger })
    this.db = new EmbeddedDB({ logger: this.logger, persist: options.persist })
  }

  /**
   * Discover Durable Object classes from the project
   */
  async discoverDOs(): Promise<Record<string, { className: string }>> {
    return this.registry.discover(this.config.srcDir ?? '.')
  }

  /**
   * Build Miniflare options from config and discovered DOs
   */
  async buildOptions(overrides: Partial<MiniflareOptions> = {}): Promise<MiniflareOptions> {
    const durableObjects = await this.discoverDOs()

    const baseOptions: MiniflareOptions = {
      modules: true,
      script: this.config.entryPoint ?? 'index.ts',
      port: this.config.port ?? 8787,

      // Durable Object configuration
      durableObjects,

      // SQLite-backed DO storage
      d1Databases: {
        DB: this.db.getPath(),
      },

      // R2 for blob storage (local filesystem)
      r2Buckets: ['BUCKET'],

      // KV for simple key-value
      kvNamespaces: ['KV'],

      // Compatibility flags
      compatibilityDate: this.config.compatibilityDate ?? '2024-01-01',
      compatibilityFlags: this.config.compatibilityFlags ?? ['nodejs_compat'],

      // Live reload on file changes
      live: true,
    }

    return { ...baseOptions, ...overrides }
  }

  /**
   * Start the Miniflare runtime
   */
  async start(options: Partial<MiniflareOptions> = {}): Promise<RunningInstance> {
    if (this.miniflare) {
      throw new Error('Miniflare already running')
    }

    // Dynamic import to avoid bundling issues
    const { Miniflare } = await import('miniflare')

    const mfOptions = await this.buildOptions(options)
    this.logger.info('Starting Miniflare...', { port: mfOptions.port })

    this.miniflare = new Miniflare(mfOptions)
    await this.miniflare.ready

    const port = mfOptions.port as number
    const url = `http://localhost:${port}`

    this.logger.success(`Miniflare running at ${url}`)

    return {
      miniflare: this.miniflare,
      port,
      url,
      stop: () => this.stop(),
    }
  }

  /**
   * Stop the Miniflare runtime
   */
  async stop(): Promise<void> {
    if (this.miniflare) {
      this.logger.info('Stopping Miniflare...')
      await this.miniflare.dispose()
      this.miniflare = null
      this.logger.success('Miniflare stopped')
    }
  }

  /**
   * Get a Durable Object namespace from the running instance
   */
  async getNamespace(name: string): Promise<DurableObjectNamespace | null> {
    if (!this.miniflare) {
      throw new Error('Miniflare not running')
    }
    return this.miniflare.getDurableObjectNamespace(name)
  }

  /**
   * Get direct access to embedded DB for DO operations
   */
  getDB(): EmbeddedDB {
    return this.db
  }

  /**
   * Get the DO registry
   */
  getRegistry(): DORegistry {
    return this.registry
  }
}

/**
 * Create a new Miniflare adapter instance
 */
export function createAdapter(options?: MiniflareAdapterOptions): MiniflareAdapter {
  return new MiniflareAdapter(options)
}
