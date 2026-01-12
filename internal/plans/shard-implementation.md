---
title: "shard implementation"
description: Documentation for plans
---

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARD & UNSHARD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shard this DO into multiple DOs for horizontal scaling
   *
   * Creates N new shard DOs and distributes Things across them based on a shard key.
   * Supports multiple distribution strategies (hash, range, roundRobin).
   *
   * @param options - Shard options including key, count, and strategy
   * @returns ShardResult with shard details and distribution info
   */
  async shard(options: ShardOptions & {
    correlationId?: string
    timeout?: number
    keyExtractor?: (thing: { id: string; type: unknown; branch: string | null; name: string; data: Record<string, unknown>; deleted: boolean }) => string
    includeMetadata?: boolean
    targetShards?: string[]
  }): Promise<ShardResult & {
    duration: number
    registry: {
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
    stats: {
      totalThings: number
      minPerShard: number
      maxPerShard: number
      avgPerShard: number
      stdDev: number
      skewRatio: number
    }
  }> {
    const startTime = Date.now()
    const {
      key,
      count,
      strategy = 'hash',
      mode = 'atomic',
      correlationId = crypto.randomUUID(),
      timeout = 30000,
      keyExtractor,
    } = options

    // === VALIDATION ===

    // Require shard key
    if (!key || key.trim() === '') {
      throw new Error('Shard key is required')
    }

    // Require positive shard count
    if (count <= 0) {
      throw new Error('Shard count must be positive')
    }

    // Validate shard count is reasonable (max 1000 shards)
    if (count > 1000) {
      throw new Error('Shard count too large: maximum 1000 shards')
    }

    // Validate strategy
    const validStrategies: ShardStrategy[] = ['hash', 'range', 'roundRobin', 'custom']
    if (!validStrategies.includes(strategy)) {
      throw new Error(`Invalid shard strategy: '${strategy}'`)
    }

    // Get things to shard
    const things = await this.db.select().from(schema.things)

    if (things.length === 0) {
      throw new Error('Cannot shard empty DO: no data to shard')
    }

    // Check if already sharded
    const existingRegistry = await this.ctx.storage.get('shardRegistry')
    if (existingRegistry) {
      throw new Error('DO is already sharded: cannot shard twice')
    }

    // Emit shard.started event
    await this.emitEvent('shard.started', {
      correlationId,
      key,
      count,
      strategy,
      thingsCount: things.length,
    })

    try {
      // Create shard registry
      const registryId = crypto.randomUUID()
      const shardEndpoints: Array<{
        shardIndex: number
        ns: string
        doId: string
        status: 'active' | 'inactive' | 'rebalancing'
      }> = []

      // Create N shard DOs
      const shards: Array<{
        ns: string
        doId: string
        shardIndex: number
        thingCount: number
        stub: DOStub
      }> = []

      if (!this.env.DO) {
        throw new Error('DO namespace not configured')
      }

      for (let i = 0; i < count; i++) {
        const shardNs = `${this.ns}-shard-${i}`
        const shardDoId = this.env.DO.idFromName(shardNs)
        const stub = this.env.DO.get(shardDoId)

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

      // Get relationships
      const relationships = await this.db.select().from(schema.relationships)

      // Distribute things across shards based on strategy
      const shardDistribution: Map<number, Array<typeof things[0]>> = new Map()
      for (let i = 0; i < count; i++) {
        shardDistribution.set(i, [])
      }

      for (const thing of things) {
        let shardIndex: number

        // Extract shard key value
        let shardKeyValue: string
        if (keyExtractor) {
          shardKeyValue = keyExtractor(thing as { id: string; type: unknown; branch: string | null; name: string; data: Record<string, unknown>; deleted: boolean })
        } else {
          // Extract from data using key path (support nested keys like 'metadata.organization.id')
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
            // Consistent hashing
            let hash = 0
            for (let i = 0; i < shardKeyValue.length; i++) {
              hash = ((hash << 5) - hash) + shardKeyValue.charCodeAt(i)
              hash = hash & hash // Convert to 32bit integer
            }
            shardIndex = Math.abs(hash) % count
            break
          }
          case 'range': {
            // Range-based: extract numeric value from key
            const numValue = typeof thing.data[key] === 'number'
              ? thing.data[key] as number
              : parseInt(shardKeyValue) || 0

            // Find min/max for range calculation
            const allValues = things.map(t => {
              const val = typeof t.data[key] === 'number'
                ? t.data[key] as number
                : parseInt(String(t.data[key])) || 0
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
            // Simple round-robin by index
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

        // Get relationships for things in this shard
        const shardThingIds = new Set(shardThings.map(t => t.id))
        const shardRelationships = relationships.filter(r =>
          shardThingIds.has(r.from) || shardThingIds.has(r.to)
        )

        // Initialize shard DO
        const initUrl = `https://${shard.ns}/init`
        await shard.stub.fetch(new Request(initUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            correlationId,
            mode: 'atomic',
          }),
        }))

        // Transfer data to shard
        const transferUrl = `https://${shard.ns}/transfer`
        await shard.stub.fetch(new Request(transferUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            things: shardThings.map(t => ({
              id: t.id,
              type: t.type,
              branch: t.branch,
              name: t.name,
              data: t.data,
              deleted: t.deleted,
            })),
            relationships: shardRelationships.map(r => ({
              id: r.id,
              verb: r.verb,
              from: r.from,
              to: r.to,
              data: r.data,
            })),
          }),
        }))

        // Store shard metadata in objects table
        await this.db.insert(schema.objects).values({
          ns: shard.ns,
          id: shard.doId,
          class: 'DO',
          region: null,
          primary: false,
          createdAt: new Date(),
        })
      }

      // Calculate distribution statistics
      const counts = shards.map(s => s.thingCount)
      const totalThings = counts.reduce((a, b) => a + b, 0)
      const avgPerShard = totalThings / count
      const minPerShard = Math.min(...counts)
      const maxPerShard = Math.max(...counts)

      // Calculate standard deviation
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - avgPerShard, 2), 0) / count
      const stdDev = Math.sqrt(variance)

      // Calculate skew ratio
      const skewRatio = minPerShard > 0 ? maxPerShard / minPerShard : maxPerShard

      // Create shard registry
      const registry = {
        id: registryId,
        shardKey: key,
        shardCount: count,
        strategy,
        createdAt: new Date(),
        endpoints: shardEndpoints,
      }

      // Store registry in source DO
      await this.ctx.storage.put('shardRegistry', registry)

      const duration = Date.now() - startTime

      // Emit shard.completed event
      await this.emitEvent('shard.completed', {
        correlationId,
        shardCount: count,
        totalThings,
        duration,
      })

      return {
        shardKey: key,
        shards: shards.map(s => ({
          ns: s.ns,
          doId: s.doId,
          shardIndex: s.shardIndex,
          thingCount: s.thingCount,
        })),
        duration,
        registry,
        stats: {
          totalThings,
          minPerShard,
          maxPerShard,
          avgPerShard,
          stdDev,
          skewRatio,
        },
      }
    } catch (error) {
      // Emit shard.failed event
      await this.emitEvent('shard.failed', {
        correlationId,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /**
   * Unshard (merge) sharded DOs back into one
   */
  async unshard(options?: UnshardOptions): Promise<void> {
    const registry = await this.ctx.storage.get('shardRegistry') as {
      endpoints: Array<{ shardIndex: number; ns: string; doId: string; status: string }>
    } | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    // Collect all things from shards
    const allThings: Array<{ id: string; type: unknown; branch: string | null; name: string | null; data: unknown; deleted: boolean }> = []
    const allRelationships: Array<{ id: string; verb: string; from: string; to: string; data: unknown }> = []

    for (const endpoint of registry.endpoints) {
      const shardDoId = this.env.DO.idFromName(endpoint.ns)
      const stub = this.env.DO.get(shardDoId)
      const stateUrl = `https://${endpoint.ns}/state`
      const response = await stub.fetch(new Request(stateUrl))

      if (response.ok) {
        const state = await response.json() as {
          things: Array<{ id: string; type: unknown; branch: string | null; name: string | null; data: unknown; deleted: boolean }>
          relationships: Array<{ id: string; verb: string; from: string; to: string; data: unknown }>
        }
        allThings.push(...state.things)
        allRelationships.push(...state.relationships)
      }
    }

    // Clear current things and relationships
    await this.db.delete(schema.things)
    await this.db.delete(schema.relationships)

    // Insert merged data
    if (allThings.length > 0) {
      await this.db.insert(schema.things).values(
        allThings.map(t => ({
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
      await this.db.insert(schema.relationships).values(
        allRelationships.map(r => ({
          id: r.id,
          verb: r.verb,
          from: r.from,
          to: r.to,
          data: r.data as Record<string, unknown> | null,
          createdAt: new Date(),
        }))
      )
    }

    // Clean up shard registry
    await this.ctx.storage.delete('shardRegistry')

    // Clean up shard DOs from objects table
    for (const endpoint of registry.endpoints) {
      await this.db.delete(schema.objects).where(eq(schema.objects.ns, endpoint.ns))
    }
  }

  /**
   * Check if this DO is sharded
   */
  async isSharded(): Promise<boolean> {
    const registry = await this.ctx.storage.get('shardRegistry')
    return !!registry
  }

  /**
   * Discover shards in this shard set
   */
  async discoverShards(): Promise<{
    registry: { id: string; shardKey: string; shardCount: number; strategy: ShardStrategy; createdAt: Date; endpoints: Array<{ shardIndex: number; ns: string; doId: string; status: string }> }
    health: Array<{ shardIndex: number; healthy: boolean; lastCheck: Date; responseTime?: number }>
  }> {
    const registry = await this.ctx.storage.get('shardRegistry') as {
      id: string
      shardKey: string
      shardCount: number
      strategy: ShardStrategy
      createdAt: Date
      endpoints: Array<{ shardIndex: number; ns: string; doId: string; status: string }>
    } | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    const health = await Promise.all(
      registry.endpoints.map(async (endpoint) => {
        const startTime = Date.now()
        try {
          const shardDoId = this.env.DO.idFromName(endpoint.ns)
          const stub = this.env.DO.get(shardDoId)
          const healthUrl = `https://${endpoint.ns}/health`
          const response = await stub.fetch(new Request(healthUrl))
          const responseTime = Date.now() - startTime

          return {
            shardIndex: endpoint.shardIndex,
            healthy: response.ok,
            lastCheck: new Date(),
            responseTime,
          }
        } catch {
          return {
            shardIndex: endpoint.shardIndex,
            healthy: false,
            lastCheck: new Date(),
          }
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
    shardResults: Array<{ shardIndex: number; itemCount: number; duration: number; error?: string }>
    totalItems: number
  }> {
    const registry = await this.ctx.storage.get('shardRegistry') as {
      endpoints: Array<{ shardIndex: number; ns: string; doId: string; status: string }>
    } | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }

    const shardResults: Array<{ shardIndex: number; itemCount: number; duration: number; error?: string }> = []
    const allData: T[] = []

    for (const endpoint of registry.endpoints) {
      const startTime = Date.now()
      try {
        const shardDoId = this.env.DO.idFromName(endpoint.ns)
        const stub = this.env.DO.get(shardDoId)
        const queryUrl = `https://${endpoint.ns}/query`
        const response = await stub.fetch(new Request(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: options.query }),
        }))

        if (response.ok) {
          const result = await response.json() as { data: T[] }
          const duration = Date.now() - startTime
          allData.push(...result.data)
          shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: result.data.length, duration })
        } else {
          const duration = Date.now() - startTime
          shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: 0, duration, error: `Query failed: ${response.status}` })
        }
      } catch (error) {
        const duration = Date.now() - startTime
        shardResults.push({ shardIndex: endpoint.shardIndex, itemCount: 0, duration, error: (error as Error).message })
        if (!options.continueOnError) throw error
      }
    }

    return { data: allData, shardResults, totalItems: allData.length }
  }

  /**
   * Rebalance shards
   */
  async rebalanceShards(options: { targetCount?: number; maxSkew?: number; strategy?: 'incremental' | 'full' }): Promise<{
    itemsMoved: number
    newStats: { totalThings: number; minPerShard: number; maxPerShard: number; avgPerShard: number; stdDev: number; skewRatio: number }
    modifiedShards: number[]
    duration: number
  }> {
    const registry = await this.ctx.storage.get('shardRegistry') as {
      id: string
      shardKey: string
      shardCount: number
      strategy: ShardStrategy
      endpoints: Array<{ shardIndex: number; ns: string; doId: string; status: string }>
    } | undefined

    if (!registry) {
      throw new Error('DO is not sharded')
    }

    const startTime = Date.now()

    // Stub implementation
    return {
      itemsMoved: 0,
      newStats: { totalThings: 0, minPerShard: 0, maxPerShard: 0, avgPerShard: 0, stdDev: 0, skewRatio: 0 },
      modifiedShards: [],
      duration: Date.now() - startTime,
    }
  }
