/**
 * Shard Lifecycle Module
 *
 * Handles horizontal scaling operations for Durable Objects:
 * - shard: Distribute data across multiple DOs
 * - unshard: Merge sharded DOs back together
 * - rebalanceShards: Redistribute data across shards
 * - queryShards: Query across all shards
 */

import { eq } from 'drizzle-orm'
import * as schema from '../../db'
import type { LifecycleContext, LifecycleModule } from './types'
import type { ShardOptions, ShardResult, ShardStrategy, UnshardOptions } from '../../types/Lifecycle'

// Type for DO stub
type DOStub = {
  fetch(request: Request): Promise<Response>
}

// Type for shard registry
interface ShardRegistry {
  id: string
  shardKey: string
  shardCount: number
  strategy: ShardStrategy
  createdAt: Date
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing'
  }>
}

/**
 * Shard lifecycle module implementing horizontal scaling.
 */
export class ShardModule implements LifecycleModule {
  private ctx!: LifecycleContext

  initialize(context: LifecycleContext): void {
    this.ctx = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shard this DO into multiple DOs for horizontal scaling
   */
  async shard(
    options: ShardOptions & {
      correlationId?: string
      timeout?: number
      keyExtractor?: (thing: {
        id: string
        type: unknown
        branch: string | null
        name: string
        data: Record<string, unknown>
        deleted: boolean
      }) => string
      includeMetadata?: boolean
      targetShards?: string[]
    }
  ): Promise<
    ShardResult & {
      duration: number
      registry: ShardRegistry
      stats: {
        totalThings: number
        minPerShard: number
        maxPerShard: number
        avgPerShard: number
        stdDev: number
        skewRatio: number
      }
    }
  > {
    const startTime = Date.now()
    const {
      key,
      count,
      strategy = 'hash',
      correlationId = crypto.randomUUID(),
      keyExtractor,
    } = options

    // === VALIDATION ===
    if (!key || key.trim() === '') {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: 'Shard key is required' })
      throw new Error('Shard key is required')
    }

    if (count <= 0) {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: 'Shard count must be positive' })
      throw new Error('Shard count must be positive')
    }

    if (count > 1000) {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: 'Shard count too large' })
      throw new Error('Shard count too large: maximum 1000 shards')
    }

    const validStrategies: ShardStrategy[] = ['hash', 'range', 'roundRobin', 'custom']
    if (!validStrategies.includes(strategy)) {
      await this.ctx.emitEvent('shard.failed', {
        correlationId,
        error: `Invalid shard strategy: '${strategy}'`,
      })
      throw new Error(`Invalid shard strategy: '${strategy}'`)
    }

    const things = await this.ctx.db.select().from(schema.things)

    if (things.length === 0) {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: 'Cannot shard empty DO' })
      throw new Error('Cannot shard empty DO: no data to shard')
    }

    const existingRegistry = await this.ctx.ctx.storage.get('shardRegistry')
    if (existingRegistry) {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: 'DO is already sharded' })
      throw new Error('DO is already sharded: cannot shard twice')
    }

    await this.ctx.emitEvent('shard.started', {
      correlationId,
      key,
      count,
      strategy,
      thingsCount: things.length,
    })

    try {
      const registryId = crypto.randomUUID()
      const shardEndpoints: ShardRegistry['endpoints'] = []

      const shards: Array<{
        ns: string
        doId: string
        shardIndex: number
        thingCount: number
        stub: DOStub
      }> = []

      if (!this.ctx.env.DO) {
        throw new Error('DO namespace not configured')
      }

      type DONamespace = {
        idFromName(name: string): { toString(): string }
        get(id: { toString(): string }): DOStub
      }

      for (let i = 0; i < count; i++) {
        const shardNs = `${this.ctx.ns}-shard-${i}`
        const shardDoId = (this.ctx.env.DO as DONamespace).idFromName(shardNs)
        const stub = (this.ctx.env.DO as DONamespace).get(shardDoId)

        shards.push({
          ns: shardNs,
          doId: shardDoId.toString(),
          shardIndex: i,
          thingCount: 0,
          stub,
        })

        shardEndpoints.push({
          shardIndex: i,
          ns: shardNs,
          doId: shardDoId.toString(),
          status: 'active',
        })
      }

      const relationships = await this.ctx.db.select().from(schema.relationships)

      // Distribute things across shards
      const shardDistribution: Map<number, (typeof things)[number][]> = new Map()
      for (let i = 0; i < count; i++) {
        shardDistribution.set(i, [])
      }

      for (const thing of things) {
        let shardIndex: number

        // Extract shard key value
        let shardKeyValue: string
        if (keyExtractor) {
          shardKeyValue = keyExtractor(thing as {
            id: string
            type: unknown
            branch: string | null
            name: string
            data: Record<string, unknown>
            deleted: boolean
          })
        } else {
          const keyParts = key.split('.')
          let value: unknown = thing.data
          for (const part of keyParts) {
            if (value && typeof value === 'object') {
              value = (value as Record<string, unknown>)[part]
            } else {
              value = undefined
              break
            }
          }
          shardKeyValue = value != null ? String(value) : ''
        }

        // Determine shard index based on strategy
        switch (strategy) {
          case 'hash': {
            let hash = 0
            for (let i = 0; i < shardKeyValue.length; i++) {
              hash = ((hash << 5) - hash) + shardKeyValue.charCodeAt(i)
              hash = hash & hash
            }
            shardIndex = Math.abs(hash) % count
            break
          }
          case 'range': {
            const thingData = thing.data as Record<string, unknown>
            const numValue =
              typeof thingData[key] === 'number'
                ? (thingData[key] as number)
                : parseInt(shardKeyValue) || 0

            const allValues = things.map((t) => {
              const tData = t.data as Record<string, unknown>
              const val = typeof tData[key] === 'number' ? (tData[key] as number) : parseInt(String(tData[key])) || 0
              return val
            })
            const minVal = Math.min(...allValues)
            const maxVal = Math.max(...allValues)
            const range = maxVal - minVal

            if (range === 0) {
              shardIndex = 0
            } else {
              const normalized = (numValue - minVal) / range
              shardIndex = Math.min(Math.floor(normalized * count), count - 1)
            }
            break
          }
          case 'roundRobin': {
            const thingIndex = things.indexOf(thing)
            shardIndex = thingIndex % count
            break
          }
          default:
            shardIndex = 0
        }

        shardDistribution.get(shardIndex)?.push(thing)
      }

      // Transfer data to each shard
      for (const shard of shards) {
        const shardThings = shardDistribution.get(shard.shardIndex) || []
        shard.thingCount = shardThings.length

        const shardThingIds = new Set(shardThings.map((t) => t.id))
        const shardRelationships = relationships.filter(
          (r) => shardThingIds.has(r.from) || shardThingIds.has(r.to)
        )

        // Initialize shard DO
        await shard.stub.fetch(
          new Request(`https://${shard.ns}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correlationId, mode: 'atomic' }),
          })
        )

        // Transfer data
        await shard.stub.fetch(
          new Request(`https://${shard.ns}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              things: shardThings.map((t) => ({
                id: t.id,
                type: t.type,
                branch: t.branch,
                name: t.name,
                data: t.data,
                deleted: t.deleted,
              })),
              relationships: shardRelationships.map((r) => ({
                id: r.id,
                verb: r.verb,
                from: r.from,
                to: r.to,
                data: r.data,
              })),
            }),
          })
        )

        // Store shard metadata
        await this.ctx.db.insert(schema.objects).values({
          ns: shard.ns,
          id: shard.doId,
          class: 'DO',
          region: null,
          primary: false,
          createdAt: new Date(),
        })
      }

      // Calculate statistics
      const counts = shards.map((s) => s.thingCount)
      const totalThings = counts.reduce((a, b) => a + b, 0)
      const avgPerShard = totalThings / count
      const minPerShard = Math.min(...counts)
      const maxPerShard = Math.max(...counts)
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - avgPerShard, 2), 0) / count
      const stdDev = Math.sqrt(variance)
      const skewRatio = minPerShard > 0 ? maxPerShard / minPerShard : maxPerShard

      const registry: ShardRegistry = {
        id: registryId,
        shardKey: key,
        shardCount: count,
        strategy,
        createdAt: new Date(),
        endpoints: shardEndpoints,
      }

      await this.ctx.ctx.storage.put('shardRegistry', registry)

      const duration = Date.now() - startTime

      await this.ctx.emitEvent('shard.completed', {
        correlationId,
        shardCount: count,
        totalThings,
        duration,
      })

      return {
        shardKey: key,
        shards: shards.map((s) => ({
          ns: s.ns,
          doId: s.doId,
          shardIndex: s.shardIndex,
          thingCount: s.thingCount,
        })),
        duration,
        registry,
        stats: { totalThings, minPerShard, maxPerShard, avgPerShard, stdDev, skewRatio },
      }
    } catch (error) {
      await this.ctx.emitEvent('shard.failed', { correlationId, error: (error as Error).message })
      throw error
    }
  }

  /**
   * Unshard (merge) sharded DOs back into one
   */
  async unshard(options?: UnshardOptions): Promise<void> {
    const registry = (await this.ctx.ctx.storage.get('shardRegistry')) as ShardRegistry | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO namespace not configured')
    }

    type DONamespace = {
      idFromName(name: string): { toString(): string }
      get(id: { toString(): string }): DOStub
    }

    const allThings: Array<{
      id: string
      type: unknown
      branch: string | null
      name: string | null
      data: unknown
      deleted: boolean
    }> = []
    const allRelationships: Array<{
      id: string
      verb: string
      from: string
      to: string
      data: unknown
    }> = []

    for (const endpoint of registry.endpoints) {
      const shardDoId = (this.ctx.env.DO as DONamespace).idFromName(endpoint.ns)
      const stub = (this.ctx.env.DO as DONamespace).get(shardDoId)
      const response = await stub.fetch(new Request(`https://${endpoint.ns}/state`))

      if (response.ok) {
        try {
          const text = await response.text()
          if (text && text.startsWith('{')) {
            const state = JSON.parse(text) as {
              things: typeof allThings
              relationships: typeof allRelationships
            }
            if (state.things) allThings.push(...state.things)
            if (state.relationships) allRelationships.push(...state.relationships)
          }
        } catch {
          // Skip non-JSON responses
        }
      }
    }

    // Clear and reinsert
    await this.ctx.db.delete(schema.things)
    await this.ctx.db.delete(schema.relationships)

    if (allThings.length > 0) {
      await this.ctx.db.insert(schema.things).values(
        allThings.map((t) => ({
          id: t.id,
          type: t.type as number,
          branch: t.branch,
          name: t.name || '',
          data: t.data as Record<string, unknown>,
          deleted: t.deleted,
          visibility: 'user' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )
    }

    if (allRelationships.length > 0) {
      await this.ctx.db.insert(schema.relationships).values(
        allRelationships.map((r) => ({
          id: r.id,
          verb: r.verb,
          from: r.from,
          to: r.to,
          data: r.data as Record<string, unknown> | null,
          createdAt: new Date(),
        }))
      )
    }

    await this.ctx.ctx.storage.delete('shardRegistry')

    for (const endpoint of registry.endpoints) {
      await this.ctx.db.delete(schema.objects).where(eq(schema.objects.ns, endpoint.ns))
    }
  }

  /**
   * Check if this DO is sharded
   */
  async isSharded(): Promise<boolean> {
    const registry = await this.ctx.ctx.storage.get('shardRegistry')
    return !!registry
  }

  /**
   * Discover shards in this shard set
   */
  async discoverShards(): Promise<{
    registry: ShardRegistry
    health: Array<{
      shardIndex: number
      healthy: boolean
      lastCheck: Date
      responseTime?: number
    }>
  }> {
    const registry = (await this.ctx.ctx.storage.get('shardRegistry')) as ShardRegistry | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO namespace not configured')
    }

    type DONamespace = {
      idFromName(name: string): { toString(): string }
      get(id: { toString(): string }): DOStub
    }

    const health = await Promise.all(
      registry.endpoints.map(async (endpoint) => {
        const startTime = Date.now()
        try {
          const shardDoId = (this.ctx.env.DO as DONamespace).idFromName(endpoint.ns)
          const stub = (this.ctx.env.DO as DONamespace).get(shardDoId)
          const response = await stub.fetch(new Request(`https://${endpoint.ns}/health`))
          const responseTime = Date.now() - startTime

          return {
            shardIndex: endpoint.shardIndex,
            healthy: response.ok,
            lastCheck: new Date(),
            responseTime,
          }
        } catch {
          return { shardIndex: endpoint.shardIndex, healthy: false, lastCheck: new Date() }
        }
      })
    )

    return { registry, health }
  }

  /**
   * Query across all shards
   */
  async queryShards<T = unknown>(options: {
    query: string
    aggregation?: 'merge' | 'concat' | 'sum' | 'count' | 'avg'
    timeout?: number
    continueOnError?: boolean
  }): Promise<{
    data: T[]
    shardResults: Array<{
      shardIndex: number
      itemCount: number
      duration: number
      error?: string
    }>
    totalItems: number
  }> {
    const registry = (await this.ctx.ctx.storage.get('shardRegistry')) as ShardRegistry | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO namespace not configured')
    }

    type DONamespace = {
      idFromName(name: string): { toString(): string }
      get(id: { toString(): string }): DOStub
    }

    const shardResults: Array<{
      shardIndex: number
      itemCount: number
      duration: number
      error?: string
    }> = []
    const allData: T[] = []

    for (const endpoint of registry.endpoints) {
      const startTime = Date.now()
      try {
        const shardDoId = (this.ctx.env.DO as DONamespace).idFromName(endpoint.ns)
        const stub = (this.ctx.env.DO as DONamespace).get(shardDoId)
        const response = await stub.fetch(
          new Request(`https://${endpoint.ns}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: options.query }),
          })
        )

        if (response.ok) {
          const duration = Date.now() - startTime
          try {
            const text = await response.text()
            if (text && text.startsWith('{')) {
              const result = JSON.parse(text) as { data: T[] }
              if (result.data) {
                allData.push(...result.data)
                shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: result.data.length, duration })
              } else {
                shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: 0, duration })
              }
            } else {
              shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: 0, duration })
            }
          } catch {
            shardResults.push({
              shardIndex: endpoint.shardIndex,
              itemCount: 0,
              duration,
              error: 'Invalid JSON response',
            })
          }
        } else {
          const duration = Date.now() - startTime
          shardResults.push({
            shardIndex: endpoint.shardIndex,
            itemCount: 0,
            duration,
            error: `Query failed: ${response.status}`,
          })
        }
      } catch (error) {
        const duration = Date.now() - startTime
        shardResults.push({
          shardIndex: endpoint.shardIndex,
          itemCount: 0,
          duration,
          error: (error as Error).message,
        })
        if (!options.continueOnError) throw error
      }
    }

    return { data: allData, shardResults, totalItems: allData.length }
  }

  /**
   * Rebalance shards
   */
  async rebalanceShards(options: {
    targetCount?: number
    maxSkew?: number
    strategy?: 'incremental' | 'full'
  }): Promise<{
    itemsMoved: number
    newStats: {
      totalThings: number
      minPerShard: number
      maxPerShard: number
      avgPerShard: number
      stdDev: number
      skewRatio: number
    }
    modifiedShards: number[]
    duration: number
  }> {
    const registry = (await this.ctx.ctx.storage.get('shardRegistry')) as ShardRegistry | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.ctx.env.DO) {
      throw new Error('DO namespace not configured')
    }

    type DONamespace = {
      idFromName(name: string): { toString(): string }
      get(id: { toString(): string }): DOStub
    }

    const startTime = Date.now()
    const { targetCount, strategy = 'incremental' } = options
    const currentCount = registry.shardCount
    let itemsMoved = 0
    const modifiedShards: number[] = []

    if (targetCount !== undefined && targetCount !== currentCount) {
      const newEndpoints: ShardRegistry['endpoints'] = []

      if (targetCount > currentCount) {
        // Scale up
        for (let i = 0; i < currentCount; i++) {
          newEndpoints.push(registry.endpoints[i])
        }

        for (let i = currentCount; i < targetCount; i++) {
          const shardNs = `${this.ctx.ns}-shard-${i}`
          const shardDoId = (this.ctx.env.DO as DONamespace).idFromName(shardNs)
          const stub = (this.ctx.env.DO as DONamespace).get(shardDoId)

          await stub.fetch(
            new Request(`https://${shardNs}/init`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ correlationId: crypto.randomUUID(), mode: 'atomic' }),
            })
          )

          await stub.fetch(
            new Request(`https://${shardNs}/transfer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ things: [], relationships: [] }),
            })
          )

          newEndpoints.push({
            shardIndex: i,
            ns: shardNs,
            doId: shardDoId.toString(),
            status: 'active',
          })

          modifiedShards.push(i)
        }
      } else {
        // Scale down
        for (let i = 0; i < targetCount; i++) {
          newEndpoints.push(registry.endpoints[i])
        }

        for (let i = targetCount; i < currentCount; i++) {
          const removedShard = registry.endpoints[i]
          const stub = (this.ctx.env.DO as DONamespace).get(
            (this.ctx.env.DO as DONamespace).idFromName(removedShard.ns)
          )

          try {
            const response = await stub.fetch(new Request(`https://${removedShard.ns}/state`))

            if (response.ok) {
              const state = (await response.json()) as {
                things: Array<{
                  id: string
                  type: unknown
                  branch: string | null
                  name: string | null
                  data: unknown
                  deleted: boolean
                }>
                relationships: Array<{
                  id: string
                  verb: string
                  from: string
                  to: string
                  data: unknown
                }>
              }

              for (const thing of state.things) {
                const targetShardIndex = Math.abs(this._hashString(thing.id)) % targetCount
                const targetShard = newEndpoints[targetShardIndex]
                const targetStub = (this.ctx.env.DO as DONamespace).get(
                  (this.ctx.env.DO as DONamespace).idFromName(targetShard.ns)
                )

                await targetStub.fetch(
                  new Request(`https://${targetShard.ns}/transfer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ things: [thing], relationships: [] }),
                  })
                )

                itemsMoved++
                if (!modifiedShards.includes(targetShardIndex)) {
                  modifiedShards.push(targetShardIndex)
                }
              }

              for (const rel of state.relationships) {
                const targetShardIndex = Math.abs(this._hashString(rel.from)) % targetCount
                const targetShard = newEndpoints[targetShardIndex]
                const targetStub = (this.ctx.env.DO as DONamespace).get(
                  (this.ctx.env.DO as DONamespace).idFromName(targetShard.ns)
                )

                await targetStub.fetch(
                  new Request(`https://${targetShard.ns}/transfer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ things: [], relationships: [rel] }),
                  })
                )
              }
            }
          } catch {
            // Best effort
          }
        }
      }

      const updatedRegistry = { ...registry, shardCount: targetCount, endpoints: newEndpoints }
      await this.ctx.ctx.storage.put('shardRegistry', updatedRegistry)
    }

    const newStats = {
      totalThings: 0,
      minPerShard: 0,
      maxPerShard: 0,
      avgPerShard: 0,
      stdDev: 0,
      skewRatio: 1,
    }

    const duration = Date.now() - startTime

    return { itemsMoved, newStats, modifiedShards, duration }
  }

  private _hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash
    }
    return hash
  }
}

// Export singleton factory
export function createShardModule(): ShardModule {
  return new ShardModule()
}
