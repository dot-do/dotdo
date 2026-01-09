/**
 * Compact Lifecycle Module
 *
 * Handles compaction operations for Durable Objects:
 * - Squash history to current state
 * - Archive old data to R2
 * - Configurable thresholds and preservation
 */

import * as schema from '../../db'
import type { LifecycleContext, LifecycleModule } from './types'

/**
 * Options for configuring compact behavior
 */
export interface CompactOptions {
  /**
   * Minimum number of total thing versions before compacting.
   * If the total version count is below this threshold, compact is a no-op.
   * Default: 0 (always compact)
   */
  threshold?: number

  /**
   * Whether to archive compacted data to R2.
   * When false, old versions are deleted without archiving.
   * Default: true
   */
  archive?: boolean

  /**
   * Thing IDs to preserve all versions for (exempt from compaction).
   * Useful for audit trails or important documents.
   */
  preserveKeys?: string[]

  /**
   * Time-to-live in seconds for archived data in R2.
   * After TTL expires, R2 lifecycle rules will delete the archives.
   * Default: undefined (no expiration)
   */
  ttl?: number
}

/**
 * Result of a compact operation
 */
export interface CompactResult {
  thingsCompacted: number
  actionsArchived: number
  eventsArchived: number
  skipped?: boolean
  preservedKeys?: string[]
  archiveTtl?: number
}

/**
 * Compact lifecycle module implementing state compaction.
 */
export class CompactModule implements LifecycleModule {
  private ctx!: LifecycleContext

  initialize(context: LifecycleContext): void {
    this.ctx = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Squash history to current state (same identity)
   */
  async compact(options?: CompactOptions): Promise<CompactResult> {
    const things = await this.ctx.db.select().from(schema.things)
    const actions = await this.ctx.db.select().from(schema.actions)
    const events = await this.ctx.db.select().from(schema.events)

    // Check if there's anything to compact
    if (things.length === 0) {
      throw new Error('Nothing to compact')
    }

    // Check threshold if specified
    if (options?.threshold && things.length < options.threshold) {
      return {
        thingsCompacted: 0,
        actionsArchived: 0,
        eventsArchived: 0,
        skipped: true,
      }
    }

    const shouldArchive = options?.archive !== false
    const preserveKeys = options?.preserveKeys ?? []
    const ttl = options?.ttl

    // Archive old things versions to R2 FIRST - this provides atomicity
    const R2 = this.ctx.env.R2 as
      | { put(key: string, data: string, options?: { httpMetadata?: { cacheExpiry?: Date } }): Promise<void> }
      | undefined

    if (R2 && shouldArchive) {
      const archiveOptions = ttl
        ? { httpMetadata: { cacheExpiry: new Date(Date.now() + ttl * 1000) } }
        : undefined

      await R2.put(`archives/${this.ctx.ns}/things/${Date.now()}.json`, JSON.stringify(things), archiveOptions)

      // Archive actions to R2
      if (actions.length > 0) {
        await R2.put(
          `archives/${this.ctx.ns}/actions/${Date.now()}.json`,
          JSON.stringify(actions),
          archiveOptions
        )
      }

      // Archive events to R2
      const eventsToArchive = events.filter(
        (e) => e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      )
      if (eventsToArchive.length > 0) {
        await R2.put(
          `archives/${this.ctx.ns}/events/${Date.now()}.json`,
          JSON.stringify(eventsToArchive),
          archiveOptions
        )
      }
    }

    // Emit compact.started event
    await this.ctx.emitEvent('compact.started', { thingsCount: things.length })

    // Group things by id+branch to find latest versions
    const thingsByKey = new Map<string, (typeof things)[number][]>()
    for (const thing of things) {
      const key = `${thing.id}:${thing.branch || 'main'}`
      const group = thingsByKey.get(key) || []
      group.push(thing)
      thingsByKey.set(key, group)
    }

    // Keep only latest version of each thing
    let compactedCount = 0
    const latestThings: (typeof things)[number][] = []

    for (const [key, group] of thingsByKey) {
      // Check if this key should be preserved
      const thingId = key.split(':')[0]
      if (preserveKeys.includes(thingId)) {
        // Keep all versions for preserved keys
        latestThings.push(...group)
        continue
      }

      // Get latest version (last in array based on insertion order)
      const latest = group[group.length - 1]

      // Only keep non-deleted things
      if (!latest.deleted) {
        latestThings.push(latest)
      }

      compactedCount += group.length - 1
    }

    // Delete old versions (use raw SQL for bulk delete)
    await this.ctx.ctx.storage.sql.exec('DELETE FROM things')

    // Re-insert only latest versions
    for (const thing of latestThings) {
      await this.ctx.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: thing.deleted ?? false,
      })
    }

    // Clear actions
    await this.ctx.ctx.storage.sql.exec('DELETE FROM actions')

    const eventsArchivedCount = events.filter(
      (e) => e.verb !== 'compact.started' && e.verb !== 'compact.completed'
    ).length

    // Emit compact.completed event
    await this.ctx.emitEvent('compact.completed', {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: eventsArchivedCount,
    })

    return {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: eventsArchivedCount,
      preservedKeys: preserveKeys.length > 0 ? preserveKeys : undefined,
      archiveTtl: ttl,
    }
  }

  /**
   * Get archive metadata from R2
   */
  async getArchiveInfo(): Promise<{
    thingsArchives: number
    actionsArchives: number
    eventsArchives: number
    oldestArchive?: Date
    newestArchive?: Date
  }> {
    const R2 = this.ctx.env.R2 as
      | { list(options: { prefix: string }): Promise<{ objects: Array<{ key: string; uploaded: Date }> }> }
      | undefined

    if (!R2) {
      return {
        thingsArchives: 0,
        actionsArchives: 0,
        eventsArchives: 0,
      }
    }

    const thingsList = await R2.list({ prefix: `archives/${this.ctx.ns}/things/` })
    const actionsList = await R2.list({ prefix: `archives/${this.ctx.ns}/actions/` })
    const eventsList = await R2.list({ prefix: `archives/${this.ctx.ns}/events/` })

    const allDates = [
      ...thingsList.objects.map((o) => o.uploaded),
      ...actionsList.objects.map((o) => o.uploaded),
      ...eventsList.objects.map((o) => o.uploaded),
    ].sort((a, b) => a.getTime() - b.getTime())

    return {
      thingsArchives: thingsList.objects.length,
      actionsArchives: actionsList.objects.length,
      eventsArchives: eventsList.objects.length,
      oldestArchive: allDates[0],
      newestArchive: allDates[allDates.length - 1],
    }
  }

  /**
   * Restore from an archive
   */
  async restoreFromArchive(timestamp: number): Promise<{
    thingsRestored: number
    actionsRestored: number
    eventsRestored: number
  }> {
    const R2 = this.ctx.env.R2 as
      | {
          get(key: string): Promise<{ json(): Promise<unknown> } | null>
        }
      | undefined

    if (!R2) {
      throw new Error('R2 not configured')
    }

    // Get archived data
    const thingsArchive = await R2.get(`archives/${this.ctx.ns}/things/${timestamp}.json`)
    if (!thingsArchive) {
      throw new Error(`Archive not found: ${timestamp}`)
    }

    const things = (await thingsArchive.json()) as Array<{
      id: string
      type: number
      branch: string | null
      name: string | null
      data: Record<string, unknown>
      deleted: boolean
    }>

    // Clear current data
    await this.ctx.ctx.storage.sql.exec('DELETE FROM things')
    await this.ctx.ctx.storage.sql.exec('DELETE FROM actions')

    // Restore things
    for (const thing of things) {
      await this.ctx.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data,
        deleted: thing.deleted,
      })
    }

    // Try to restore actions
    let actionsRestored = 0
    const actionsArchive = await R2.get(`archives/${this.ctx.ns}/actions/${timestamp}.json`)
    if (actionsArchive) {
      const actions = (await actionsArchive.json()) as Array<{
        id: string
        verb: string
        target: string
        actor: string
        input: Record<string, unknown>
        status: string
        createdAt: Date
      }>

      for (const action of actions) {
        await this.ctx.db.insert(schema.actions).values(action)
        actionsRestored++
      }
    }

    // Try to restore events
    let eventsRestored = 0
    const eventsArchive = await R2.get(`archives/${this.ctx.ns}/events/${timestamp}.json`)
    if (eventsArchive) {
      const events = (await eventsArchive.json()) as Array<{
        id: string
        verb: string
        source: string
        data: Record<string, unknown>
        createdAt: Date
      }>

      for (const event of events) {
        await this.ctx.db.insert(schema.events).values(event)
        eventsRestored++
      }
    }

    await this.ctx.emitEvent('compact.restored', {
      timestamp,
      thingsRestored: things.length,
      actionsRestored,
      eventsRestored,
    })

    return {
      thingsRestored: things.length,
      actionsRestored,
      eventsRestored,
    }
  }
}

// Export singleton factory
export function createCompactModule(): CompactModule {
  return new CompactModule()
}
