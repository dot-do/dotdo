/**
 * @dotdo/oauth KV Session Store
 *
 * Cloudflare KV-backed session storage.
 * Best for read-heavy workloads with global distribution.
 *
 * @module @dotdo/oauth/storage/kv
 */

import type { SessionData, SessionStore, SessionStoreOptions } from './interface'

/** Default TTL: 24 hours in seconds (KV uses seconds) */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60

/** KV store specific options */
export interface KVSessionStoreOptions extends SessionStoreOptions {
  /** Key prefix for session keys (default: 'session:') */
  prefix?: string
}

/**
 * Cloudflare KV session store implementation.
 *
 * Features:
 * - Global distribution with eventual consistency
 * - Automatic TTL expiration (handled by KV)
 * - Configurable key prefix for namespacing
 *
 * Note: KV is eventually consistent. For strong consistency,
 * use D1SessionStore instead.
 */
export class KVSessionStore implements SessionStore {
  private kv: KVNamespace
  private prefix: string
  private defaultTTLSeconds: number

  constructor(kv: KVNamespace, options: KVSessionStoreOptions = {}) {
    this.kv = kv
    this.prefix = options.prefix ?? 'session:'
    // Convert ms to seconds for KV, or use default
    this.defaultTTLSeconds = options.defaultTTL
      ? Math.ceil(options.defaultTTL / 1000)
      : DEFAULT_TTL_SECONDS
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const key = this.getKey(sessionId)
    const value = await this.kv.get(key, 'json')
    return value as SessionData | null
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const key = this.getKey(sessionId)
    const expirationTtl = ttl ? Math.ceil(ttl / 1000) : this.defaultTTLSeconds

    await this.kv.put(key, JSON.stringify(data), {
      expirationTtl,
    })
  }

  async delete(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId)
    await this.kv.delete(key)
  }

  // Note: KV handles TTL expiration automatically, so cleanup is a no-op
  async cleanup(): Promise<void> {
    // KV automatically expires keys based on TTL
    // No manual cleanup needed
  }

  async rotate(oldSessionId: string, newSessionId: string): Promise<string | null> {
    const data = await this.get(oldSessionId)

    if (!data) {
      return null
    }

    // Note: This is not atomic. For strong consistency, use D1.
    await this.set(newSessionId, data)
    await this.delete(oldSessionId)

    return newSessionId
  }
}
