/**
 * @module AgentDO
 * @description Durable Object for AI Agent entity storage and management
 *
 * AgentDO provides the DO implementation for AI agent entities as defined in
 * the schema.org.ai/Agent type. It manages agent configuration, tool registrations,
 * memory state, and execution context.
 *
 * **Note:** This is different from the `Agent` class in `objects/workers/Agent.ts`.
 * - **Agent (Worker)**: Full implementation with tool execution, memory, and goal-seeking
 * - **AgentDO (Entity)**: Storage and configuration management for agent definitions
 *
 * **Core Features:**
 * - Agent configuration storage (model, temperature, tokens)
 * - Tool registration and management
 * - System prompt management
 * - Execution mode settings (autonomous/supervised/manual)
 * - Agent metadata and capabilities
 *
 * **Agent Properties (from schema.org.ai):**
 * | Property | Type | Description |
 * |----------|------|-------------|
 * | model | string | AI model identifier (e.g., 'claude-3-opus') |
 * | tools | string[] | List of available tool names |
 * | autonomous | boolean | Can operate without human approval |
 * | systemPrompt | string | Instructions for the agent |
 * | temperature | number | Model temperature (0-1) |
 * | maxTokens | number | Maximum tokens per response |
 *
 * @example Creating an AgentDO
 * ```typescript
 * const stub = env.AgentDO.get(env.AgentDO.idFromName('support-agent'))
 * await stub.configure({
 *   model: 'claude-3-opus',
 *   tools: ['search', 'email', 'ticket'],
 *   autonomous: false,
 *   systemPrompt: 'You are a helpful support agent...'
 * })
 * ```
 *
 * @example Registering Tools
 * ```typescript
 * await stub.registerTool({
 *   name: 'createTicket',
 *   description: 'Create a support ticket',
 *   parameters: { subject: 'string', body: 'string' }
 * })
 * ```
 *
 * @see Agent - Full worker implementation in objects/workers/Agent.ts
 * @see Worker - Base class for work-performing entities
 */

import { DO, type Env } from '../core/DO'
import { Agent as AgentNoun } from '../../nouns/workers/Agent'
import type { AnyNoun } from '../../nouns/types'

/**
 * Agent operation mode
 */
export type AgentMode = 'autonomous' | 'supervised' | 'manual'

/**
 * Agent configuration settings
 */
export interface AgentConfig {
  /** AI model identifier */
  model: string
  /** List of available tool names */
  tools?: string[]
  /** Can operate without human approval */
  autonomous?: boolean
  /** System prompt/instructions */
  systemPrompt?: string
  /** Model temperature (0-1) */
  temperature?: number
  /** Maximum tokens per response */
  maxTokens?: number
  /** Operation mode */
  mode?: AgentMode
}

/**
 * Tool definition for agent capabilities
 */
export interface AgentToolDefinition {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Parameter schema */
  parameters?: Record<string, unknown>
  /** Required permissions */
  permissions?: string[]
  /** Whether tool requires human approval */
  requiresApproval?: boolean
}

/**
 * AgentDO - Durable Object for AI Agent entity storage
 *
 * Provides configuration storage and management for AI agent definitions.
 * This is a lightweight entity DO, not the full Agent worker implementation.
 */
export class AgentDO extends DO {
  /** Type identifier from schema.org.ai */
  static readonly $type: string = AgentNoun.$type
  /** Noun definition for Agent */
  static readonly noun: AnyNoun = AgentNoun

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get the agent configuration
   */
  async getConfig(): Promise<AgentConfig | null> {
    const config = await this.ctx.storage.get<AgentConfig>('config')
    return config ?? null
  }

  /**
   * Configure the agent
   */
  async configure(config: AgentConfig): Promise<void> {
    await this.ctx.storage.put('config', config)
    await this.emit('agent.configured', { config })
  }

  /**
   * Update agent configuration partially
   */
  async updateConfig(updates: Partial<AgentConfig>): Promise<AgentConfig | null> {
    const current = await this.getConfig()
    if (!current) return null

    const updated = { ...current, ...updates }
    await this.ctx.storage.put('config', updated)
    await this.emit('agent.config.updated', { config: updated, changes: updates })
    return updated
  }

  /**
   * Get the AI model identifier
   */
  async getModel(): Promise<string | null> {
    const config = await this.getConfig()
    return config?.model ?? null
  }

  /**
   * Set the AI model
   */
  async setModel(model: string): Promise<void> {
    const config = await this.getConfig() ?? { model }
    config.model = model
    await this.ctx.storage.put('config', config)
    await this.emit('agent.model.changed', { model })
  }

  /**
   * Get all registered tools
   */
  async getTools(): Promise<AgentToolDefinition[]> {
    const tools = await this.ctx.storage.get<AgentToolDefinition[]>('tools')
    return tools ?? []
  }

  /**
   * Register a tool for this agent
   */
  async registerTool(tool: AgentToolDefinition): Promise<void> {
    const tools = await this.getTools()
    const existingIndex = tools.findIndex(t => t.name === tool.name)

    if (existingIndex >= 0) {
      tools[existingIndex] = tool
    } else {
      tools.push(tool)
    }

    await this.ctx.storage.put('tools', tools)

    // Also update the tool names in config
    const config = await this.getConfig()
    if (config) {
      config.tools = tools.map(t => t.name)
      await this.ctx.storage.put('config', config)
    }

    await this.emit('agent.tool.registered', { tool })
  }

  /**
   * Unregister a tool
   */
  async unregisterTool(toolName: string): Promise<boolean> {
    const tools = await this.getTools()
    const filteredTools = tools.filter(t => t.name !== toolName)
    if (filteredTools.length === tools.length) return false

    await this.ctx.storage.put('tools', filteredTools)

    // Update config
    const config = await this.getConfig()
    if (config) {
      config.tools = filteredTools.map(t => t.name)
      await this.ctx.storage.put('config', config)
    }

    await this.emit('agent.tool.unregistered', { toolName })
    return true
  }

  /**
   * Get the system prompt
   */
  async getSystemPrompt(): Promise<string | null> {
    const config = await this.getConfig()
    return config?.systemPrompt ?? null
  }

  /**
   * Set the system prompt
   */
  async setSystemPrompt(systemPrompt: string): Promise<void> {
    const config = await this.getConfig() ?? { model: 'default', systemPrompt }
    config.systemPrompt = systemPrompt
    await this.ctx.storage.put('config', config)
    await this.emit('agent.prompt.updated', { systemPrompt })
  }

  /**
   * Check if agent is autonomous
   */
  async isAutonomous(): Promise<boolean> {
    const config = await this.getConfig()
    return config?.autonomous ?? false
  }

  /**
   * Set autonomous mode
   */
  async setAutonomous(autonomous: boolean): Promise<void> {
    const config = await this.getConfig() ?? { model: 'default', autonomous }
    config.autonomous = autonomous
    await this.ctx.storage.put('config', config)
    await this.emit('agent.mode.changed', { autonomous })
  }
}

export default AgentDO
