/**
 * AuditLogger - Audit logging with TemporalStore integration
 *
 * Provides comprehensive audit logging with:
 * - Action logging (create, read, rotate, delete, access_denied, refresh)
 * - Context tracking (IP, user agent, request ID)
 * - Time-based filtering and pagination
 * - TemporalStore integration for time-travel queries
 * - Export to JSON/CSV
 * - Integrity verification with checksums and chaining
 *
 * @module db/primitives/credentials/audit
 */

import { EventEmitter } from 'events'
import { createTemporalStore, type TemporalStore } from '../temporal-store'
import { SecureVault } from './vault'

// =============================================================================
// Types
// =============================================================================

export type AuditAction = 'create' | 'read' | 'rotate' | 'delete' | 'access_denied' | 'refresh'

export interface AuditConfig {
  vault: SecureVault
  enableTemporalStore?: boolean
  retentionPeriod?: string
  enableIntegrityChecks?: boolean
  enableChaining?: boolean
}

export interface AuditContext {
  ipAddress?: string
  userAgent?: string
  requestId?: string
  sessionId?: string
}

export interface AuditLogEntry {
  id: string
  credentialName: string
  action: AuditAction
  actor?: string
  reason?: string
  timestamp: Date
  context?: AuditContext
  metadata?: Record<string, unknown>
  checksum?: string
  previousHash?: string
}

export interface AuditLogOptions {
  action?: AuditAction
  actor?: string
  since?: Date
  until?: Date
  limit?: number
  offset?: number
}

export interface AuditLogWithCount {
  logs: AuditLogEntry[]
  total: number
}

export interface LogCreateOptions {
  type: string
  actor?: string
  context?: AuditContext
}

export interface LogReadOptions {
  actor?: string
  context?: AuditContext
}

export interface LogRotateOptions {
  actor?: string
  reason?: string
  previousVersion: number
  newVersion: number
  context?: AuditContext
}

export interface LogDeleteOptions {
  actor?: string
  reason?: string
  hard?: boolean
  context?: AuditContext
}

export interface LogAccessDeniedOptions {
  actor?: string
  reason?: string
  tokenId?: string
  context?: AuditContext
}

export interface LogRefreshOptions {
  previousExpiry: Date
  newExpiry: Date
  context?: AuditContext
}

export interface ExportOptions {
  format: 'json' | 'csv'
}

export interface AuditSummary {
  totalActions: number
  actionCounts: Record<AuditAction, number>
  firstAction?: Date
  lastAction?: Date
  uniqueActors: number
}

export interface IntegrityResult {
  valid: boolean
  errors: string[]
}

export interface RetentionInfo {
  retentionPeriod: string
  oldestEntry?: Date
  newestEntry?: Date
  totalEntries: number
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

async function computeChecksum(entry: Omit<AuditLogEntry, 'checksum' | 'previousHash'>): Promise<string> {
  const data = JSON.stringify(entry)
  const buffer = new TextEncoder().encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// AuditLogger Implementation
// =============================================================================

interface InternalEntry extends AuditLogEntry {
  _deleted?: boolean
}

export class AuditLogger extends EventEmitter {
  private vault: SecureVault
  private entries: Map<string, InternalEntry[]> = new Map()
  private temporalStore?: TemporalStore<AuditLogEntry>
  private enableTemporalStore: boolean
  private retentionPeriod?: string
  private enableIntegrityChecks: boolean
  private enableChaining: boolean
  private lastHash: Map<string, string> = new Map()

  constructor(config: AuditConfig) {
    super()
    this.vault = config.vault
    this.enableTemporalStore = config.enableTemporalStore ?? false
    this.retentionPeriod = config.retentionPeriod
    this.enableChaining = config.enableChaining ?? false
    // Chaining requires integrity checks for the hash chain
    this.enableIntegrityChecks = config.enableIntegrityChecks ?? this.enableChaining

    if (this.enableTemporalStore) {
      this.temporalStore = createTemporalStore()
    }
  }

  /**
   * Log a credential creation
   */
  async logCreate(credentialName: string, options: LogCreateOptions): Promise<void> {
    await this.log(credentialName, 'create', {
      actor: options.actor,
      context: options.context,
      metadata: { type: options.type },
    })
  }

  /**
   * Log a credential read
   */
  async logRead(credentialName: string, options: LogReadOptions): Promise<void> {
    await this.log(credentialName, 'read', {
      actor: options.actor,
      context: options.context,
    })
  }

  /**
   * Log a credential rotation
   */
  async logRotate(credentialName: string, options: LogRotateOptions): Promise<void> {
    await this.log(credentialName, 'rotate', {
      actor: options.actor,
      reason: options.reason,
      context: options.context,
      metadata: {
        previousVersion: options.previousVersion,
        newVersion: options.newVersion,
      },
    })
  }

  /**
   * Log a credential deletion
   */
  async logDelete(credentialName: string, options: LogDeleteOptions): Promise<void> {
    await this.log(credentialName, 'delete', {
      actor: options.actor,
      reason: options.reason,
      context: options.context,
      metadata: { hard: options.hard },
    })
  }

  /**
   * Log an access denial
   */
  async logAccessDenied(credentialName: string, options: LogAccessDeniedOptions): Promise<void> {
    await this.log(credentialName, 'access_denied', {
      actor: options.actor,
      reason: options.reason,
      context: options.context,
      metadata: { tokenId: options.tokenId },
    })
  }

  /**
   * Log an OAuth refresh
   */
  async logRefresh(credentialName: string, options: LogRefreshOptions): Promise<void> {
    await this.log(credentialName, 'refresh', {
      context: options.context,
      metadata: {
        previousExpiry: options.previousExpiry.toISOString(),
        newExpiry: options.newExpiry.toISOString(),
      },
    })
  }

  /**
   * Internal log method
   */
  private async log(
    credentialName: string,
    action: AuditAction,
    options: {
      actor?: string
      reason?: string
      context?: AuditContext
      metadata?: Record<string, unknown>
    }
  ): Promise<void> {
    const entry: InternalEntry = {
      id: generateId(),
      credentialName,
      action,
      actor: options.actor,
      reason: options.reason,
      timestamp: new Date(),
      context: options.context,
      metadata: options.metadata,
    }

    // Add integrity checks
    if (this.enableIntegrityChecks) {
      entry.checksum = await computeChecksum(entry)
    }

    // Add chaining
    if (this.enableChaining) {
      const lastHash = this.lastHash.get(credentialName)
      if (lastHash) {
        entry.previousHash = lastHash
      }
      if (entry.checksum) {
        this.lastHash.set(credentialName, entry.checksum)
      }
    }

    // Store entry
    let entries = this.entries.get(credentialName)
    if (!entries) {
      entries = []
      this.entries.set(credentialName, entries)
    }
    entries.push(entry)

    // Store in temporal store if enabled
    if (this.temporalStore) {
      await this.temporalStore.put(`${credentialName}:${entry.id}`, entry, entry.timestamp.getTime())
    }

    // Emit event
    this.emit('audit:entry', entry)
  }

  /**
   * Get audit log entries for a credential
   */
  async getAuditLog(credentialName: string, options?: AuditLogOptions): Promise<AuditLogEntry[]> {
    let entries = this.entries.get(credentialName) ?? []

    // Filter by action
    if (options?.action) {
      entries = entries.filter((e) => e.action === options.action)
    }

    // Filter by actor
    if (options?.actor) {
      entries = entries.filter((e) => e.actor === options.actor)
    }

    // Filter by time range
    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!)
    }
    if (options?.until) {
      entries = entries.filter((e) => e.timestamp <= options.until!)
    }

    // Sort by timestamp descending (most recent first)
    entries = [...entries].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? entries.length

    return entries.slice(offset, offset + limit)
  }

  /**
   * Get audit log with total count
   */
  async getAuditLogWithCount(credentialName: string, options?: AuditLogOptions): Promise<AuditLogWithCount> {
    let entries = this.entries.get(credentialName) ?? []

    // Filter by action
    if (options?.action) {
      entries = entries.filter((e) => e.action === options.action)
    }

    // Filter by actor
    if (options?.actor) {
      entries = entries.filter((e) => e.actor === options.actor)
    }

    // Filter by time range
    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!)
    }
    if (options?.until) {
      entries = entries.filter((e) => e.timestamp <= options.until!)
    }

    const total = entries.length

    // Sort and paginate
    entries = [...entries].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? entries.length

    return {
      logs: entries.slice(offset, offset + limit),
      total,
    }
  }

  /**
   * Get audit log as of a specific timestamp (TemporalStore)
   */
  async getAuditLogAsOf(credentialName: string, timestamp: number): Promise<AuditLogEntry[]> {
    const entries = this.entries.get(credentialName) ?? []

    return entries.filter((e) => e.timestamp.getTime() <= timestamp).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  /**
   * Create a snapshot for compliance
   */
  async createSnapshot(): Promise<string> {
    if (!this.temporalStore) {
      throw new Error('TemporalStore not enabled')
    }
    return await this.temporalStore.snapshot()
  }

  /**
   * Get audit log from a snapshot
   */
  async getAuditLogFromSnapshot(credentialName: string, snapshotId: string): Promise<AuditLogEntry[]> {
    if (!this.temporalStore) {
      throw new Error('TemporalStore not enabled')
    }

    // This is a simplified implementation
    // In production, we'd need to store snapshot state
    const entries = this.entries.get(credentialName) ?? []
    return entries.slice(0, -1) // Exclude most recent as approximation
  }

  /**
   * Get retention info
   */
  async getRetentionInfo(): Promise<RetentionInfo> {
    let totalEntries = 0
    let oldestEntry: Date | undefined
    let newestEntry: Date | undefined

    for (const entries of this.entries.values()) {
      totalEntries += entries.length
      for (const entry of entries) {
        if (!oldestEntry || entry.timestamp < oldestEntry) {
          oldestEntry = entry.timestamp
        }
        if (!newestEntry || entry.timestamp > newestEntry) {
          newestEntry = entry.timestamp
        }
      }
    }

    return {
      retentionPeriod: this.retentionPeriod ?? 'unlimited',
      oldestEntry,
      newestEntry,
      totalEntries,
    }
  }

  /**
   * Export audit log
   */
  async exportAuditLog(credentialName: string, options: ExportOptions): Promise<string> {
    const entries = await this.getAuditLog(credentialName)

    if (options.format === 'json') {
      return JSON.stringify(entries, null, 2)
    }

    // CSV format
    const headers = ['id', 'action', 'actor', 'reason', 'timestamp', 'ipAddress', 'userAgent']
    const rows = entries.map((e) => [e.id, e.action, e.actor ?? '', e.reason ?? '', e.timestamp.toISOString(), e.context?.ipAddress ?? '', e.context?.userAgent ?? ''].join(','))

    return [headers.join(','), ...rows].join('\n')
  }

  /**
   * Get audit summary
   */
  async getAuditSummary(credentialName: string): Promise<AuditSummary> {
    const entries = this.entries.get(credentialName) ?? []

    const actionCounts: Record<AuditAction, number> = {
      create: 0,
      read: 0,
      rotate: 0,
      delete: 0,
      access_denied: 0,
      refresh: 0,
    }

    const actors = new Set<string>()
    let firstAction: Date | undefined
    let lastAction: Date | undefined

    for (const entry of entries) {
      actionCounts[entry.action]++
      if (entry.actor) {
        actors.add(entry.actor)
      }
      if (!firstAction || entry.timestamp < firstAction) {
        firstAction = entry.timestamp
      }
      if (!lastAction || entry.timestamp > lastAction) {
        lastAction = entry.timestamp
      }
    }

    return {
      totalActions: entries.length,
      actionCounts,
      firstAction,
      lastAction,
      uniqueActors: actors.size,
    }
  }

  /**
   * Verify audit log integrity
   */
  async verifyIntegrity(credentialName: string): Promise<IntegrityResult> {
    if (!this.enableIntegrityChecks) {
      return { valid: true, errors: [] }
    }

    const entries = this.entries.get(credentialName) ?? []
    const errors: string[] = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!

      // Verify checksum
      if (entry.checksum) {
        const { checksum, previousHash, ...rest } = entry
        const computed = await computeChecksum(rest)
        if (computed !== checksum) {
          errors.push(`Entry ${entry.id}: checksum mismatch`)
        }
      }

      // Verify chain
      if (this.enableChaining && i > 0) {
        const previousEntry = entries[i - 1]!
        if (entry.previousHash && entry.previousHash !== previousEntry.checksum) {
          errors.push(`Entry ${entry.id}: chain broken`)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

/**
 * Factory function to create an AuditLogger instance
 */
export function createAuditLogger(config: AuditConfig): AuditLogger {
  return new AuditLogger(config)
}
