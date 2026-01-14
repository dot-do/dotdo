/**
 * Linear Cycles Resource - Local Implementation
 *
 * Uses WindowManager for sprint/cycle tracking.
 * Supports full cycle lifecycle: create, update, archive.
 */

import {
  WindowManager,
  type Window,
  EventTimeTrigger,
  hours,
} from '../../db/primitives/window-manager'
import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store'
import type {
  Cycle,
  CycleCreateInput,
  CycleUpdateInput,
  CyclePayload,
  CycleFilterArgs,
  CycleFilter,
  Connection,
  PageInfo,
  ID,
  DateTime,
  Team,
  Issue,
  IssueFilterArgs,
  SuccessPayload,
} from './types'

export interface CyclesResourceOptions {
  onEvent?: (type: string, action: string, data: unknown) => void
  getTeam: (id: ID) => Promise<Team>
  getCycleIssues: (cycleId: ID, args?: IssueFilterArgs) => Promise<Connection<Issue>>
}

interface StoredCycle {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  number: number
  name?: string | null
  description?: string | null
  startsAt: DateTime
  endsAt: DateTime
  completedAt?: DateTime | null
  progress: number
  scopeHistory: number[]
  completedScopeHistory: number[]
  issueCountHistory: number[]
  completedIssueCountHistory: number[]
  teamId: ID
}

interface CycleElement {
  cycleId: ID
  type: 'start' | 'end'
  timestamp: number
}

/**
 * Local Cycles Resource
 * Uses WindowManager for cycle duration tracking
 */
export class LocalCyclesResource {
  private store: TemporalStore<StoredCycle>
  private cycleCounters: Map<ID, number> = new Map() // teamId -> cycle number
  private onEvent?: (type: string, action: string, data: unknown) => void
  private options: CyclesResourceOptions

  // WindowManager for tracking cycle periods
  private cycleManager: WindowManager<CycleElement>

  constructor(options: CyclesResourceOptions) {
    this.store = createTemporalStore<StoredCycle>({
      enableTTL: false,
      retention: { maxVersions: 50 },
    })
    this.onEvent = options.onEvent
    this.options = options

    // Create window manager for cycle tracking (14-day tumbling windows = 336 hours)
    this.cycleManager = new WindowManager(WindowManager.tumbling<CycleElement>(hours(336)))
    this.cycleManager.withTrigger(new EventTimeTrigger())
    this.cycleManager.onTrigger((window, elements) => {
      this.handleCycleWindowTrigger(window, elements)
    })
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private getNextCycleNumber(teamId: ID): number {
    const current = this.cycleCounters.get(teamId) ?? 0
    const next = current + 1
    this.cycleCounters.set(teamId, next)
    return next
  }

  /**
   * Handle cycle window trigger (start/end of cycle)
   */
  private handleCycleWindowTrigger(_window: Window, elements: CycleElement[]): void {
    for (const element of elements) {
      if (element.type === 'end') {
        // Cycle ended - emit event
        this.emitEvent('Cycle', 'update', {
          cycleId: element.cycleId,
          event: 'cycle_ended',
        })
      }
    }
  }

  /**
   * Convert stored cycle to full Cycle type
   */
  private async hydrate(stored: StoredCycle): Promise<Cycle> {
    const team = await this.options.getTeam(stored.teamId)

    const cycle: Cycle = {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      number: stored.number,
      name: stored.name,
      description: stored.description,
      startsAt: stored.startsAt,
      endsAt: stored.endsAt,
      completedAt: stored.completedAt,
      progress: stored.progress,
      scopeHistory: stored.scopeHistory,
      completedScopeHistory: stored.completedScopeHistory,
      issueCountHistory: stored.issueCountHistory,
      completedIssueCountHistory: stored.completedIssueCountHistory,
      team,

      // Relationship methods
      issues: async (args) => this.options.getCycleIssues(stored.id, args),
    }

    return cycle
  }

  /**
   * Create a new cycle
   */
  async create(input: CycleCreateInput): Promise<CyclePayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const cycleNumber = this.getNextCycleNumber(input.teamId)

    const stored: StoredCycle = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      number: cycleNumber,
      name: input.name ?? null,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      completedAt: null,
      progress: 0,
      scopeHistory: [],
      completedScopeHistory: [],
      issueCountHistory: [],
      completedIssueCountHistory: [],
      teamId: input.teamId,
    }

    await this.store.put(id, stored, Date.now())

    // Track cycle in window manager
    const startsAtMs = new Date(input.startsAt).getTime()
    const endsAtMs = new Date(input.endsAt).getTime()

    this.cycleManager.process({ cycleId: id, type: 'start', timestamp: startsAtMs }, startsAtMs)
    this.cycleManager.process({ cycleId: id, type: 'end', timestamp: endsAtMs }, endsAtMs)

    const cycle = await this.hydrate(stored)

    this.emitEvent('Cycle', 'create', cycle)

    return {
      success: true,
      cycle,
    }
  }

  /**
   * Retrieve a cycle by ID
   */
  async retrieve(id: ID): Promise<Cycle> {
    const stored = await this.store.get(id)
    if (!stored) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }
    return this.hydrate(stored)
  }

  /**
   * Update a cycle
   */
  async update(id: ID, input: CycleUpdateInput): Promise<CyclePayload> {
    const existing = await this.store.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }

    const now = new Date().toISOString()

    const updated: StoredCycle = {
      ...existing,
      updatedAt: now,
      name: input.name !== undefined ? input.name : existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
      completedAt: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
    }

    await this.store.put(id, updated, Date.now())
    const cycle = await this.hydrate(updated)

    this.emitEvent('Cycle', 'update', cycle)

    return {
      success: true,
      cycle,
    }
  }

  /**
   * Archive a cycle
   */
  async archive(id: ID): Promise<SuccessPayload> {
    const existing = await this.store.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Cycle not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: StoredCycle = {
      ...existing,
      updatedAt: now,
      archivedAt: now,
    }

    await this.store.put(id, updated, Date.now())

    this.emitEvent('Cycle', 'update', { id, archived: true })

    return {
      success: true,
    }
  }

  /**
   * List all stored cycles (internal)
   */
  private async listAll(): Promise<StoredCycle[]> {
    const results: StoredCycle[] = []
    const iterator = this.store.range('', {})
    let result = await iterator.next()

    while (!result.done) {
      results.push(result.value)
      result = await iterator.next()
    }

    return results
  }

  /**
   * List cycles with filtering and pagination
   */
  async list(args?: CycleFilterArgs): Promise<Connection<Cycle>> {
    const all = await this.listAll()
    let filtered = all

    if (!args?.includeArchived) {
      filtered = filtered.filter((c) => !c.archivedAt)
    }

    if (args?.filter) {
      filtered = this.applyFilter(filtered, args.filter)
    }

    const hydrated = await Promise.all(filtered.map((c) => this.hydrate(c)))

    // Apply ordering
    if (args?.orderBy) {
      hydrated.sort((a, b) => {
        switch (args.orderBy) {
          case 'createdAt':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          case 'startsAt':
            return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
          case 'endsAt':
            return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
          case 'number':
            return b.number - a.number
          default:
            return 0
        }
      })
    } else {
      // Default sort by starts descending
      hydrated.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    }

    return this.paginateResults(hydrated, args)
  }

  /**
   * Get cycles by team
   */
  async listByTeam(teamId: ID, args?: CycleFilterArgs): Promise<Connection<Cycle>> {
    const all = await this.listAll()
    let filtered = all.filter((c) => c.teamId === teamId)

    if (!args?.includeArchived) {
      filtered = filtered.filter((c) => !c.archivedAt)
    }

    const hydrated = await Promise.all(filtered.map((c) => this.hydrate(c)))

    // Sort by number descending
    hydrated.sort((a, b) => b.number - a.number)

    return this.paginateResults(hydrated, args)
  }

  /**
   * Get active cycle for a team
   */
  async getActiveCycle(teamId: ID): Promise<Cycle | null> {
    const all = await this.listAll()
    const now = Date.now()

    const activeCycle = all.find((c) => {
      if (c.teamId !== teamId) return false
      if (c.archivedAt) return false
      if (c.completedAt) return false

      const startsAt = new Date(c.startsAt).getTime()
      const endsAt = new Date(c.endsAt).getTime()

      return startsAt <= now && now <= endsAt
    })

    if (!activeCycle) return null

    return this.hydrate(activeCycle)
  }

  /**
   * Update cycle progress
   */
  async updateProgress(
    id: ID,
    progress: number,
    stats?: {
      scopeCount?: number
      completedScopeCount?: number
      issueCount?: number
      completedIssueCount?: number
    }
  ): Promise<void> {
    const existing = await this.store.get(id)
    if (!existing) return

    const updated: StoredCycle = {
      ...existing,
      progress: Math.min(100, Math.max(0, progress)),
      scopeHistory: stats?.scopeCount
        ? [...existing.scopeHistory, stats.scopeCount]
        : existing.scopeHistory,
      completedScopeHistory: stats?.completedScopeCount
        ? [...existing.completedScopeHistory, stats.completedScopeCount]
        : existing.completedScopeHistory,
      issueCountHistory: stats?.issueCount
        ? [...existing.issueCountHistory, stats.issueCount]
        : existing.issueCountHistory,
      completedIssueCountHistory: stats?.completedIssueCount
        ? [...existing.completedIssueCountHistory, stats.completedIssueCount]
        : existing.completedIssueCountHistory,
    }

    await this.store.put(id, updated, Date.now())
  }

  private applyFilter(cycles: StoredCycle[], filter: CycleFilter): StoredCycle[] {
    return cycles.filter((cycle) => {
      // Number filter
      if (filter.number) {
        if (filter.number.eq !== undefined && cycle.number !== filter.number.eq) return false
        if (filter.number.gt !== undefined && cycle.number <= filter.number.gt) return false
        if (filter.number.gte !== undefined && cycle.number < filter.number.gte) return false
        if (filter.number.lt !== undefined && cycle.number >= filter.number.lt) return false
        if (filter.number.lte !== undefined && cycle.number > filter.number.lte) return false
      }

      // Team filter
      if (filter.team?.id?.eq && cycle.teamId !== filter.team.id.eq) return false

      // Name filter
      if (filter.name) {
        if (filter.name.eq && cycle.name !== filter.name.eq) return false
        if (filter.name.contains && !cycle.name?.includes(filter.name.contains)) return false
      }

      // Active filter
      if (filter.isActive?.eq !== undefined) {
        const now = Date.now()
        const startsAt = new Date(cycle.startsAt).getTime()
        const endsAt = new Date(cycle.endsAt).getTime()
        const isActive = startsAt <= now && now <= endsAt && !cycle.completedAt

        if (filter.isActive.eq !== isActive) return false
      }

      // AND filter
      if (filter.and) {
        for (const subFilter of filter.and) {
          if (this.applyFilter([cycle], subFilter).length === 0) return false
        }
      }

      // OR filter
      if (filter.or && filter.or.length > 0) {
        let anyMatch = false
        for (const subFilter of filter.or) {
          if (this.applyFilter([cycle], subFilter).length > 0) {
            anyMatch = true
            break
          }
        }
        if (!anyMatch) return false
      }

      return true
    })
  }

  private paginateResults<T extends { id: string }>(
    items: T[],
    args?: CycleFilterArgs
  ): Connection<T> {
    const first = args?.first ?? 50
    let startIndex = 0

    if (args?.after) {
      const afterIndex = items.findIndex((i) => i.id === args.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const page = items.slice(startIndex, startIndex + first)
    const hasNextPage = startIndex + first < items.length
    const hasPreviousPage = startIndex > 0

    const pageInfo: PageInfo = {
      hasNextPage,
      hasPreviousPage,
      startCursor: page[0]?.id,
      endCursor: page[page.length - 1]?.id,
    }

    return {
      nodes: page,
      pageInfo,
    }
  }

  private emitEvent(type: string, action: string, data: unknown): void {
    if (this.onEvent) {
      this.onEvent(type, action, data)
    }
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    return error
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cycleManager.dispose()
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.store = createTemporalStore<StoredCycle>({
      enableTTL: false,
      retention: { maxVersions: 50 },
    })
    this.cycleCounters.clear()
  }

  /**
   * Initialize team cycle counter
   */
  initTeamCounter(teamId: ID): void {
    if (!this.cycleCounters.has(teamId)) {
      this.cycleCounters.set(teamId, 0)
    }
  }
}
