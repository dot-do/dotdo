/**
 * ThingsStore - CRUD operations for Things
 *
 * Provides typed access to the things table with:
 * - Version-aware get/list operations
 * - Branch-scoped operations
 * - Soft delete by default
 */

import * as schema from '..'
import type {
  StoreContext,
  ThingsStore as IThingsStore,
  ThingEntity,
  ThingsGetOptions,
  ThingsListOptions,
  ThingsCreateOptions,
  ThingsUpdateOptions,
  ThingsDeleteOptions,
} from './types'

export class ThingsStore implements IThingsStore {
  private db: StoreContext['db']
  private ns: string
  private currentBranch: string
  private typeCache: Map<string, number>

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.ns = ctx.ns
    this.currentBranch = ctx.currentBranch
    this.typeCache = ctx.typeCache
  }

  /**
   * Resolve a type name to its numeric FK
   * In production this would query the nouns table
   */
  private resolveType(typeName: string): number {
    const cached = this.typeCache.get(typeName)
    if (cached !== undefined) return cached
    // Default to 0 for now - in production would query nouns table
    return 0
  }

  /**
   * Get the current branch for operations
   */
  private getCurrentBranch(): string {
    return this.currentBranch
  }

  async get(id: string, options?: ThingsGetOptions): Promise<ThingEntity | null> {
    const branch = options?.branch ?? this.getCurrentBranch()
    const includeDeleted = options?.includeDeleted ?? false

    const results = await this.db.select().from(schema.things)

    // Filter by id
    let filtered = results.filter((r) => r.id === id)

    // Filter by branch
    if (branch) {
      filtered = filtered.filter((r) => r.branch === branch || r.branch === null)
    }

    // Filter deleted
    if (!includeDeleted) {
      filtered = filtered.filter((r) => !r.deleted)
    }

    // Get specific version or latest
    if (options?.version !== undefined) {
      filtered = filtered.filter((r) => r.version === options.version)
    } else {
      // Get latest version (highest version number)
      filtered.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    }

    const result = filtered[0]
    if (!result) return null

    return this.toEntity(result)
  }

  async list(options?: ThingsListOptions): Promise<ThingEntity[]> {
    const branch = options?.branch ?? this.getCurrentBranch()
    const includeDeleted = options?.includeDeleted ?? false
    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    const results = await this.db.select().from(schema.things)

    let filtered = results

    // Filter by type
    if (options?.type) {
      filtered = filtered.filter((r) => {
        const data = r.data as Record<string, unknown> | null
        return data?.$type === options.type
      })
    }

    // Filter by branch
    if (branch) {
      filtered = filtered.filter((r) => r.branch === branch || r.branch === null)
    }

    // Filter deleted
    if (!includeDeleted) {
      filtered = filtered.filter((r) => !r.deleted)
    }

    // Filter by where clause
    if (options?.where) {
      filtered = filtered.filter((r) => {
        const data = r.data as Record<string, unknown> | null
        if (!data) return false
        return Object.entries(options.where!).every(([key, value]) => {
          // Support nested paths like 'data.status'
          const path = key.split('.')
          let current: unknown = data
          for (const part of path) {
            if (current && typeof current === 'object') {
              current = (current as Record<string, unknown>)[part]
            } else {
              return false
            }
          }
          return current === value
        })
      })
    }

    // Group by id and get latest version for each (last in array = latest)
    const latestById = new Map<string, (typeof results)[0]>()
    for (const item of filtered) {
      // In append-only model, later items are newer versions
      latestById.set(item.id, item)
    }
    filtered = Array.from(latestById.values())

    // Order
    if (options?.orderBy) {
      const order = options.order ?? 'asc'
      filtered.sort((a, b) => {
        const aData = a.data as Record<string, unknown> | null
        const bData = b.data as Record<string, unknown> | null
        const aVal = aData?.[options.orderBy!] as string | number | undefined
        const bVal = bData?.[options.orderBy!] as string | number | undefined
        if (aVal === undefined && bVal === undefined) return 0
        if (aVal === undefined) return order === 'asc' ? 1 : -1
        if (bVal === undefined) return order === 'asc' ? -1 : 1
        if (aVal < bVal) return order === 'asc' ? -1 : 1
        if (aVal > bVal) return order === 'asc' ? 1 : -1
        return 0
      })
    }

    // Cursor-based pagination
    if (options?.after) {
      const afterIndex = filtered.findIndex((r) => r.id === options.after)
      if (afterIndex >= 0) {
        filtered = filtered.slice(afterIndex + 1)
      }
    }

    // Apply offset and limit
    filtered = filtered.slice(offset, offset + limit)

    return filtered.map((r) => this.toEntity(r, undefined))
  }

  async create(data: Partial<ThingEntity>, options?: ThingsCreateOptions): Promise<ThingEntity> {
    const branch = options?.branch ?? this.getCurrentBranch()
    const id = data.$id ?? crypto.randomUUID()

    if (!data.$type) {
      throw new Error('$type is required')
    }

    // Check for duplicate
    const existing = await this.get(id, { branch, includeDeleted: true })
    if (existing) {
      throw new Error(`Thing with id ${id} already exists`)
    }

    const typeId = this.resolveType(data.$type)
    const thingData = {
      ...data.data,
      $type: data.$type,
      name: data.name,
    }

    // Insert matches schema: id, type (int), branch, name, data, deleted
    await this.db.insert(schema.things).values({
      id,
      type: typeId,
      branch: branch || null,
      name: data.name ?? null,
      data: thingData,
      deleted: false,
    })

    return {
      $id: id,
      $type: data.$type,
      name: data.name,
      data: data.data,
      branch,
      version: 1, // First version
      deleted: false,
    }
  }

  async update(id: string, data: Partial<ThingEntity>, options?: ThingsUpdateOptions): Promise<ThingEntity> {
    const branch = options?.branch ?? this.getCurrentBranch()
    const merge = options?.merge ?? true

    const existing = await this.get(id, { branch })
    if (!existing) {
      throw new Error(`Thing with id ${id} not found`)
    }

    // Merge or replace data
    let newData: Record<string, unknown>
    if (merge && data.data && existing.data) {
      newData = this.deepMerge(existing.data, data.data)
    } else {
      newData = data.data ?? existing.data ?? {}
    }

    // Add type info to data
    const typeName = data.$type ?? existing.$type
    newData.$type = typeName
    newData.name = data.name ?? existing.name

    const typeId = this.resolveType(typeName)

    // Append-only: insert new version
    await this.db.insert(schema.things).values({
      id,
      type: typeId,
      branch: branch || null,
      name: (newData.name as string) ?? null,
      data: newData,
      deleted: false,
    })

    return {
      $id: id,
      $type: typeName,
      name: newData.name as string | undefined,
      data: newData,
      branch,
      version: (existing.version ?? 0) + 1,
      deleted: false,
    }
  }

  async delete(id: string, options?: ThingsDeleteOptions): Promise<ThingEntity> {
    const branch = options?.branch ?? this.getCurrentBranch()
    const hard = options?.hard ?? false

    const existing = await this.get(id, { branch })
    if (!existing) {
      throw new Error(`Thing with id ${id} not found`)
    }

    if (hard) {
      // Hard delete - remove all versions
      // Note: In production, use proper Drizzle delete with conditions
      // await this.db.delete(schema.things).where(eq(schema.things.id, id))
    } else {
      // Soft delete - insert new version with deleted=true
      const typeId = this.resolveType(existing.$type)

      await this.db.insert(schema.things).values({
        id,
        type: typeId,
        branch: branch || null,
        name: existing.name ?? null,
        data: { ...existing.data, $type: existing.$type, name: existing.name },
        deleted: true,
      })
    }

    return {
      ...existing,
      deleted: true,
    }
  }

  async versions(id: string): Promise<ThingEntity[]> {
    const results = await this.db.select().from(schema.things)
    // Filter by id and sort - rowid order represents version order
    const filtered = results.filter((r) => r.id === id)

    return filtered.map((r, index) => this.toEntity(r, index + 1))
  }

  private toEntity(row: typeof schema.things.$inferSelect, version?: number): ThingEntity {
    const data = row.data as Record<string, unknown> | null
    return {
      $id: row.id,
      $type: (data?.$type as string) ?? String(row.type),
      name: (data?.name as string) ?? row.name ?? undefined,
      data: data ?? undefined,
      branch: row.branch ?? undefined,
      version, // Passed in from context (rowid-based ordering)
      deleted: row.deleted ?? false,
    }
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target }
    for (const key of Object.keys(source)) {
      const sourceVal = source[key]
      const targetVal = target[key]
      if (
        sourceVal &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        )
      } else {
        result[key] = sourceVal
      }
    }
    return result
  }
}
