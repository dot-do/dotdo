/**
 * Tool DO - Represents a registered tool/capability
 *
 * A Durable Object that manages tool definitions, execution, and usage statistics.
 * Tools are capabilities that humans or agents can use to perform actions.
 *
 * @see https://schema.org.ai/Tool
 * @see digital-tools package for type definitions
 */

import { DO, type Env } from '../core/DO'
import type { Tool as ToolType } from '@dotdo/digital-tools'
import { createTool } from '@dotdo/digital-tools'
import { Tool as ToolNoun } from '../../nouns/tools/Tool'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tool data stored in the DO
 */
export interface ToolData {
  name: string
  description: string
  category?: string
  version?: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Usage statistics for the tool
 */
export interface ToolUsageStats {
  totalInvocations: number
  successfulInvocations: number
  failedInvocations: number
  lastInvokedAt?: Date
  averageLatencyMs?: number
}

/**
 * Tool invocation input
 */
export interface ToolInvokeInput {
  input: unknown
  context?: Record<string, unknown>
}

/**
 * Tool invocation result
 */
export interface ToolInvokeResult {
  success: boolean
  output?: unknown
  error?: string
  latencyMs: number
  invokedAt: Date
}

// ============================================================================
// TOOL DO
// ============================================================================

export class Tool extends DO {
  static override readonly $type: string = ToolNoun.$type
  static readonly noun = ToolNoun

  // Tool data cache (loaded from storage)
  private _toolData?: ToolData
  private _stats?: ToolUsageStats

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the tool definition as a Tool type
   */
  async getTool(): Promise<ToolType | null> {
    const data = await this.getToolData()
    if (!data) {
      return null
    }

    return createTool({
      $id: this.ns,
      name: data.name,
      description: data.description,
      category: data.category,
      version: data.version,
    })
  }

  /**
   * Get the raw tool data from storage
   */
  async getToolData(): Promise<ToolData | null> {
    if (this._toolData) {
      return this._toolData
    }

    const data = await this.ctx.storage.get<ToolData>('tool')
    if (data) {
      this._toolData = data
    }
    return data ?? null
  }

  /**
   * Update the tool definition
   */
  async updateTool(data: Partial<ToolData>): Promise<ToolData> {
    const existing = await this.getToolData()

    const updated: ToolData = {
      name: data.name ?? existing?.name ?? 'Unnamed Tool',
      description: data.description ?? existing?.description ?? '',
      category: data.category ?? existing?.category,
      version: data.version ?? existing?.version,
      enabled: data.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    }

    await this.ctx.storage.put('tool', updated)
    this._toolData = updated

    // Emit update event
    await this.emitEvent('Tool.updated', { tool: updated })

    return updated
  }

  /**
   * Create a new tool (initialization)
   */
  async createTool(data: Omit<ToolData, 'createdAt' | 'updatedAt'>): Promise<ToolData> {
    const existing = await this.getToolData()
    if (existing) {
      throw new Error('Tool already exists. Use updateTool() to modify.')
    }

    const toolData: ToolData = {
      ...data,
      enabled: data.enabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await this.ctx.storage.put('tool', toolData)
    this._toolData = toolData

    // Initialize stats
    const stats: ToolUsageStats = {
      totalInvocations: 0,
      successfulInvocations: 0,
      failedInvocations: 0,
    }
    await this.ctx.storage.put('stats', stats)
    this._stats = stats

    // Emit creation event
    await this.emitEvent('Tool.created', { tool: toolData })

    return toolData
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL INVOCATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Invoke the tool with the given input
   *
   * This is a base implementation that subclasses should override
   * to provide actual tool functionality.
   */
  async invoke(input: ToolInvokeInput): Promise<ToolInvokeResult> {
    const startTime = Date.now()
    const invokedAt = new Date()

    const toolData = await this.getToolData()
    if (!toolData) {
      return {
        success: false,
        error: 'Tool not found',
        latencyMs: Date.now() - startTime,
        invokedAt,
      }
    }

    if (!toolData.enabled) {
      return {
        success: false,
        error: 'Tool is disabled',
        latencyMs: Date.now() - startTime,
        invokedAt,
      }
    }

    try {
      // Execute the tool - subclasses should override this method
      // to provide actual implementation
      const output = await this.executeToolLogic(input)

      const latencyMs = Date.now() - startTime

      // Update stats
      await this.recordInvocation(true, latencyMs)

      // Emit invocation event
      await this.emitEvent('Tool.invoked', {
        success: true,
        latencyMs,
        invokedAt,
      })

      return {
        success: true,
        output,
        latencyMs,
        invokedAt,
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Update stats
      await this.recordInvocation(false, latencyMs)

      // Emit failure event
      await this.emitEvent('Tool.failed', {
        error: errorMessage,
        latencyMs,
        invokedAt,
      })

      return {
        success: false,
        error: errorMessage,
        latencyMs,
        invokedAt,
      }
    }
  }

  /**
   * Execute the actual tool logic - subclasses should override this
   */
  protected async executeToolLogic(input: ToolInvokeInput): Promise<unknown> {
    // Base implementation just echoes the input
    // Subclasses should override this method
    return { echo: input.input }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USAGE STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get usage statistics for the tool
   */
  async getUsageStats(): Promise<ToolUsageStats> {
    if (this._stats) {
      return this._stats
    }

    const stats = await this.ctx.storage.get<ToolUsageStats>('stats')
    if (stats) {
      this._stats = stats
      return stats
    }

    // Return default stats if none exist
    return {
      totalInvocations: 0,
      successfulInvocations: 0,
      failedInvocations: 0,
    }
  }

  /**
   * Record an invocation in the statistics
   */
  private async recordInvocation(success: boolean, latencyMs: number): Promise<void> {
    const stats = await this.getUsageStats()

    const totalLatency = (stats.averageLatencyMs ?? 0) * stats.totalInvocations
    const newTotal = stats.totalInvocations + 1

    const updated: ToolUsageStats = {
      totalInvocations: newTotal,
      successfulInvocations: success ? stats.successfulInvocations + 1 : stats.successfulInvocations,
      failedInvocations: success ? stats.failedInvocations : stats.failedInvocations + 1,
      lastInvokedAt: new Date(),
      averageLatencyMs: (totalLatency + latencyMs) / newTotal,
    }

    await this.ctx.storage.put('stats', updated)
    this._stats = updated
  }

  /**
   * Reset usage statistics
   */
  async resetStats(): Promise<void> {
    const stats: ToolUsageStats = {
      totalInvocations: 0,
      successfulInvocations: 0,
      failedInvocations: 0,
    }
    await this.ctx.storage.put('stats', stats)
    this._stats = stats
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      // GET / - Get tool definition
      if (method === 'GET' && url.pathname === '/') {
        const tool = await this.getTool()
        if (!tool) {
          return Response.json({ error: 'Tool not found' }, { status: 404 })
        }
        return Response.json(tool)
      }

      // PUT / - Update tool definition
      if (method === 'PUT' && url.pathname === '/') {
        const body = await request.json() as Partial<ToolData>
        const updated = await this.updateTool(body)
        return Response.json(updated)
      }

      // POST / - Create tool (initialization)
      if (method === 'POST' && url.pathname === '/') {
        const body = await request.json() as Omit<ToolData, 'createdAt' | 'updatedAt'>
        const created = await this.createTool(body)
        return Response.json(created, { status: 201 })
      }

      // POST /invoke - Invoke the tool
      if (method === 'POST' && url.pathname === '/invoke') {
        const body = await request.json() as ToolInvokeInput
        const result = await this.invoke(body)
        return Response.json(result, { status: result.success ? 200 : 500 })
      }

      // GET /stats - Get usage statistics
      if (method === 'GET' && url.pathname === '/stats') {
        const stats = await this.getUsageStats()
        return Response.json(stats)
      }

      // POST /stats/reset - Reset statistics
      if (method === 'POST' && url.pathname === '/stats/reset') {
        await this.resetStats()
        return Response.json({ success: true })
      }

      // Health check
      if (url.pathname === '/health') {
        const data = await this.getToolData()
        return Response.json({
          status: 'ok',
          ns: this.ns,
          $type: this.$type,
          enabled: data?.enabled ?? false,
        })
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 400 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit an event (wrapper for $.send-like functionality)
   */
  private async emitEvent(verb: string, data: unknown): Promise<void> {
    try {
      // Use the events store if available
      if (this.events) {
        await this.events.emit({
          verb,
          source: this.ns,
          data: data as Record<string, unknown>,
        })
      }
    } catch {
      // Best-effort event emission
    }
  }
}

export default Tool
