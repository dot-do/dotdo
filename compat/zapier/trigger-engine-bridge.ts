/**
 * Zapier TriggerEngine Bridge
 *
 * Connects Zapier's trigger system to dotdo's TriggerEngine primitive
 * for unified trigger handling, deduplication, and monitoring.
 */

import type {
  TriggerConfig,
  PollingTriggerConfig,
  HookTriggerConfig,
  PollingTriggerOperation,
  HookTriggerOperation,
  Bundle,
  ZObject,
} from './types'
import {
  TriggerEngine,
  type TriggerContext,
  type TriggerOutput,
  type TriggerStats,
  type WebhookConfig,
  type PollingConfig,
} from '../../primitives/trigger-engine'
import { Trigger } from './triggers'

// =============================================================================
// TYPES
// =============================================================================

/** Options for ZapierTriggerBridge */
export interface ZapierTriggerBridgeOptions {
  /** ID field for deduplication */
  idField?: string
  /** Default polling interval in ms */
  defaultIntervalMs?: number
  /** Minimum interval between polls */
  minIntervalMs?: number
  /** Initial backoff duration on errors */
  initialBackoffMs?: number
  /** Maximum backoff duration */
  maxBackoffMs?: number
}

/** Options for ZapierWebhookBridge */
export interface ZapierWebhookBridgeOptions {
  /** Webhook secret for HMAC validation */
  secret?: string
  /** Header containing signature */
  signatureHeader?: string
  /** Signature algorithm */
  signatureAlgorithm?: 'sha256' | 'sha1'
}

/** Options for ZapierPollingBridge */
export interface ZapierPollingBridgeOptions {
  /** Default polling interval in ms */
  defaultIntervalMs?: number
  /** Minimum interval between polls */
  minIntervalMs?: number
  /** Initial backoff duration on errors */
  initialBackoffMs?: number
  /** Maximum backoff duration */
  maxBackoffMs?: number
  /** ID field for deduplication */
  idField?: string
}

/** Registered trigger metadata */
interface TriggerMetadata {
  triggerId: string
  zapierConfig: TriggerConfig
  bundle: Bundle
  seenIds: Set<string>
  cursor?: unknown
}

/** Trigger callback type */
type TriggerCallback = (items: unknown[]) => void

// =============================================================================
// ZAPIER TRIGGER BRIDGE
// =============================================================================

/**
 * Main bridge connecting Zapier triggers to TriggerEngine
 */
export class ZapierTriggerBridge {
  private engine: TriggerEngine
  private options: ZapierTriggerBridgeOptions
  private triggers = new Map<string, TriggerMetadata>()
  private callbacks = new Map<string, Set<TriggerCallback>>()

  constructor(engine: TriggerEngine, options: ZapierTriggerBridgeOptions = {}) {
    this.engine = engine
    this.options = {
      idField: 'id',
      defaultIntervalMs: 60_000,
      minIntervalMs: 5_000,
      initialBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      ...options,
    }
  }

  /**
   * Register a Zapier trigger with TriggerEngine
   */
  async registerTrigger(config: TriggerConfig, bundle: Bundle): Promise<string> {
    const trigger = new Trigger(config)
    const triggerId = `zapier-${config.key}-${Date.now()}`

    // Store metadata
    this.triggers.set(triggerId, {
      triggerId,
      zapierConfig: config,
      bundle,
      seenIds: new Set(),
    })

    // Register with TriggerEngine based on type
    if (trigger.isHook()) {
      await this.registerWebhookTrigger(triggerId, config, bundle)
    } else {
      await this.registerPollingTrigger(triggerId, config, bundle)
    }

    return triggerId
  }

  /**
   * Register a polling trigger
   */
  private async registerPollingTrigger(
    triggerId: string,
    config: TriggerConfig,
    bundle: Bundle
  ): Promise<void> {
    const pollingConfig: PollingConfig = {
      url: '', // Zapier triggers don't use direct URL polling
      intervalMs: this.options.defaultIntervalMs!,
      minIntervalMs: this.options.minIntervalMs,
      idField: this.options.idField,
      initialBackoffMs: this.options.initialBackoffMs,
      maxBackoffMs: this.options.maxBackoffMs,
    }

    // Use pollingTrigger to properly set up stats tracking
    this.engine.pollingTrigger(triggerId, pollingConfig, async (ctx: TriggerContext): Promise<TriggerOutput> => {
      return {
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'polling',
        data: ctx.data,
        context: {
          zapier: {
            key: config.key,
            noun: config.noun,
            zapId: bundle.meta?.zap?.id,
          },
        },
      }
    })
  }

  /**
   * Register a webhook trigger
   */
  private async registerWebhookTrigger(
    triggerId: string,
    config: TriggerConfig,
    bundle: Bundle
  ): Promise<void> {
    const operation = config.operation as HookTriggerOperation
    const path = `/webhooks/zapier/${config.key}`

    const webhookConfig: WebhookConfig = {
      path,
    }

    this.engine.webhook(triggerId, webhookConfig, async (ctx: TriggerContext): Promise<TriggerOutput> => {
      return {
        success: true,
        triggerId,
        timestamp: ctx.timestamp,
        source: 'webhook',
        data: ctx.data,
        context: {
          zapier: {
            key: config.key,
            noun: config.noun,
            zapId: bundle.meta?.zap?.id,
          },
        },
      }
    })
  }

  /**
   * Execute a trigger and get results
   */
  async executeTrigger(
    triggerId: string,
    z: ZObject,
    bundle: Bundle
  ): Promise<unknown[]> {
    const metadata = this.triggers.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }

    const trigger = new Trigger(metadata.zapierConfig)
    const startTime = Date.now()

    try {
      // Execute Zapier perform function
      const results = await trigger.perform(z, {
        ...bundle,
        meta: {
          ...bundle.meta,
          cursor: metadata.cursor,
        },
      })

      // Update stats
      const stats = this.engine.getStats(triggerId)
      stats.fireCount++
      stats.successCount++
      stats.lastFiredAt = Date.now()

      // Deduplicate results
      const idField = this.options.idField || 'id'
      const newItems = results.filter((item) => {
        const record = item as Record<string, unknown>
        const id = String(record[idField] ?? '')
        if (metadata.seenIds.has(id)) {
          return false
        }
        metadata.seenIds.add(id)
        return true
      })

      // Emit event
      this.engine.events.emit('zapier.trigger.fired', {
        triggerId,
        triggerKey: metadata.zapierConfig.key,
        resultCount: newItems.length,
        timestamp: Date.now(),
      })

      // Notify subscribers
      const callbacks = this.callbacks.get(triggerId)
      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(newItems)
          } catch {
            // Continue even if callback throws
          }
        }
      }

      return newItems
    } catch (error) {
      // Update failure stats
      const stats = this.engine.getStats(triggerId)
      stats.fireCount++
      stats.failureCount++
      throw error
    }
  }

  /**
   * Execute trigger and get raw TriggerOutput
   */
  async executeTriggerRaw(
    triggerId: string,
    z: ZObject,
    bundle: Bundle
  ): Promise<TriggerOutput> {
    const metadata = this.triggers.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }

    try {
      const results = await this.executeTrigger(triggerId, z, bundle)

      return {
        success: true,
        triggerId,
        timestamp: Date.now(),
        source: 'polling',
        data: results,
        context: {
          zapier: {
            key: metadata.zapierConfig.key,
            noun: metadata.zapierConfig.noun,
            zapId: bundle.meta?.zap?.id,
          },
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        triggerId,
        timestamp: Date.now(),
        source: 'polling',
        data: null,
      }
    }
  }

  /**
   * Subscribe to trigger events
   */
  onTrigger(triggerId: string, callback: TriggerCallback): () => void {
    let callbacks = this.callbacks.get(triggerId)
    if (!callbacks) {
      callbacks = new Set()
      this.callbacks.set(triggerId, callbacks)
    }
    callbacks.add(callback)

    // Return unsubscribe function
    return () => {
      callbacks?.delete(callback)
    }
  }

  /**
   * Get the underlying TriggerEngine
   */
  getEngine(): TriggerEngine {
    return this.engine
  }
}

// =============================================================================
// ZAPIER POLLING BRIDGE
// =============================================================================

/**
 * Specialized bridge for Zapier polling triggers
 */
export class ZapierPollingBridge {
  private engine: TriggerEngine
  private options: ZapierPollingBridgeOptions
  private triggers = new Map<string, TriggerMetadata>()
  private backoffs = new Map<string, number>()
  private cursors = new Map<string, unknown>()
  private callbacks = new Map<string, Set<TriggerCallback>>()

  constructor(engine: TriggerEngine, options: ZapierPollingBridgeOptions = {}) {
    this.engine = engine
    this.options = {
      defaultIntervalMs: 60_000,
      minIntervalMs: 5_000,
      initialBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      idField: 'id',
      ...options,
    }
  }

  /**
   * Register a polling trigger
   */
  async registerTrigger(config: TriggerConfig, bundle: Bundle): Promise<string> {
    if (config.operation.type !== 'polling') {
      throw new Error('This bridge only supports polling triggers')
    }

    const triggerId = `zapier-poll-${config.key}-${Date.now()}`

    // Store metadata
    this.triggers.set(triggerId, {
      triggerId,
      zapierConfig: config,
      bundle,
      seenIds: new Set(),
    })

    // Register with TriggerEngine polling scheduler
    const pollingConfig: PollingConfig = {
      url: '', // Zapier triggers don't use direct URL
      intervalMs: this.options.defaultIntervalMs!,
      minIntervalMs: this.options.minIntervalMs,
      idField: this.options.idField,
      initialBackoffMs: this.options.initialBackoffMs,
      maxBackoffMs: this.options.maxBackoffMs,
    }

    this.backoffs.set(triggerId, 0)

    // Use pollingTrigger to properly set up stats tracking
    this.engine.pollingTrigger(triggerId, pollingConfig, async (ctx) => ({
      success: true,
      triggerId,
      timestamp: ctx.timestamp,
      source: 'polling',
      data: ctx.data,
    }))

    return triggerId
  }

  /**
   * Execute polling trigger
   */
  async executeTrigger(
    triggerId: string,
    z: ZObject,
    bundle: Bundle
  ): Promise<unknown[]> {
    const metadata = this.triggers.get(triggerId)
    if (!metadata) {
      throw new Error(`Unknown trigger: ${triggerId}`)
    }

    const trigger = new Trigger(metadata.zapierConfig)
    const cursor = this.cursors.get(triggerId)

    // Wrap z.cursor to capture cursor set operations
    const wrappedZ: ZObject = {
      ...z,
      cursor: {
        get: async () => cursor,
        set: async (value: unknown) => {
          this.cursors.set(triggerId, value)
          // Also call the original if it exists
          if (z.cursor?.set) {
            await z.cursor.set(value)
          }
        },
      },
    }

    try {
      // Execute Zapier perform function with cursor
      const bundleWithCursor: Bundle = {
        ...bundle,
        meta: {
          ...bundle.meta,
          cursor,
        },
      }

      const results = await trigger.perform(wrappedZ, bundleWithCursor)

      // Reset backoff on success
      this.backoffs.set(triggerId, 0)

      // Deduplicate
      const idField = this.options.idField || 'id'
      const newItems = results.filter((item) => {
        const record = item as Record<string, unknown>
        const id = String(record[idField] ?? '')
        if (metadata.seenIds.has(id)) {
          return false
        }
        metadata.seenIds.add(id)
        return true
      })

      // Notify callbacks
      const callbacks = this.callbacks.get(triggerId)
      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(newItems)
          } catch {
            // Continue
          }
        }
      }

      return newItems
    } catch (error) {
      // Apply exponential backoff
      const currentBackoff = this.backoffs.get(triggerId) || 0
      const newBackoff = currentBackoff === 0
        ? this.options.initialBackoffMs!
        : Math.min(currentBackoff * 2, this.options.maxBackoffMs!)
      this.backoffs.set(triggerId, newBackoff)

      throw error
    }
  }

  /**
   * Get current backoff for trigger
   */
  getBackoffMs(triggerId: string): number {
    return this.backoffs.get(triggerId) || 0
  }

  /**
   * Get polling configuration
   */
  getPollingConfig(triggerId: string): { intervalMs: number; minIntervalMs?: number } {
    return {
      intervalMs: this.options.defaultIntervalMs!,
      minIntervalMs: this.options.minIntervalMs,
    }
  }

  /**
   * Get cursor value
   */
  async getCursor(triggerId: string): Promise<unknown> {
    return this.cursors.get(triggerId)
  }

  /**
   * Set cursor value
   */
  async setCursor(triggerId: string, cursor: unknown): Promise<void> {
    this.cursors.set(triggerId, cursor)
  }

  /**
   * Subscribe to trigger events
   */
  onTrigger(triggerId: string, callback: TriggerCallback): () => void {
    let callbacks = this.callbacks.get(triggerId)
    if (!callbacks) {
      callbacks = new Set()
      this.callbacks.set(triggerId, callbacks)
    }
    callbacks.add(callback)

    return () => {
      callbacks?.delete(callback)
    }
  }
}

// =============================================================================
// ZAPIER WEBHOOK BRIDGE
// =============================================================================

/**
 * Specialized bridge for Zapier webhook triggers
 */
export class ZapierWebhookBridge {
  private engine: TriggerEngine
  private options: ZapierWebhookBridgeOptions
  private triggers = new Map<string, TriggerMetadata>()
  private callbacks = new Map<string, Set<TriggerCallback>>()

  constructor(engine: TriggerEngine, options: ZapierWebhookBridgeOptions = {}) {
    this.engine = engine
    this.options = options
  }

  /**
   * Register a webhook trigger
   */
  async registerTrigger(
    config: TriggerConfig,
    z: ZObject,
    bundle: Bundle
  ): Promise<string> {
    if (config.operation.type !== 'hook') {
      throw new Error('This bridge only supports webhook triggers')
    }

    const triggerId = `zapier-webhook-${config.key}-${Date.now()}`
    const path = `/webhooks/zapier/${config.key}`

    // Store metadata
    this.triggers.set(triggerId, {
      triggerId,
      zapierConfig: config,
      bundle,
      seenIds: new Set(),
    })

    // Register with TriggerEngine webhook receiver
    const webhookConfig: WebhookConfig = {
      path,
      secret: this.options.secret,
      signatureHeader: this.options.signatureHeader,
      signatureAlgorithm: this.options.signatureAlgorithm,
    }

    this.engine.webhook(triggerId, webhookConfig, async (ctx: TriggerContext): Promise<TriggerOutput> => {
      // Transform through Zapier perform function
      const operation = config.operation as HookTriggerOperation
      const webhookBundle: Bundle = {
        ...bundle,
        cleanedRequest: ctx.data,
        rawRequest: ctx.data,
      }

      try {
        const results = await operation.perform(z, webhookBundle)

        // Notify callbacks
        const callbacks = this.callbacks.get(triggerId)
        if (callbacks) {
          for (const callback of callbacks) {
            try {
              callback(results)
            } catch {
              // Continue
            }
          }
        }

        return {
          success: true,
          triggerId,
          timestamp: ctx.timestamp,
          source: 'webhook',
          data: results.length === 1 ? results[0] : results,
          context: {
            zapier: {
              key: config.key,
              noun: config.noun,
            },
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          triggerId,
          timestamp: ctx.timestamp,
          source: 'webhook',
          data: null,
        }
      }
    })

    // Execute subscription
    const operation = config.operation as HookTriggerOperation
    await operation.performSubscribe(z, bundle)

    return triggerId
  }

  /**
   * Handle incoming webhook
   */
  async handleWebhook(triggerId: string, request: Request): Promise<TriggerOutput> {
    const metadata = this.triggers.get(triggerId)
    if (!metadata) {
      return {
        success: false,
        error: `Unknown trigger: ${triggerId}`,
        triggerId,
        timestamp: Date.now(),
        source: 'webhook',
        data: null,
      }
    }

    const path = `/webhooks/zapier/${metadata.zapierConfig.key}`
    return this.engine.handleWebhook(request, path)
  }

  /**
   * Subscribe to trigger events
   */
  onTrigger(triggerId: string, callback: TriggerCallback): () => void {
    let callbacks = this.callbacks.get(triggerId)
    if (!callbacks) {
      callbacks = new Set()
      this.callbacks.set(triggerId, callbacks)
    }
    callbacks.add(callback)

    return () => {
      callbacks?.delete(callback)
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { TriggerEngine }
