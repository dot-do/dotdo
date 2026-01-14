/**
 * AgentBuilder - Unified Agent Creation Pattern
 *
 * Provides a fluent builder API for creating agents consistently across all patterns:
 * - BaseAgent (runtime execution)
 * - Named Agents (template literal invocation)
 * - DO Agents (Durable Object-based)
 * - Agent Things (graph persistence)
 *
 * @see dotdo-ycte2 - [REFACTOR] Unify Agent Creation Patterns
 * @module agents/builder
 */

import type { AgentConfig, AgentProvider, Agent, ToolDefinition, AgentHooks, StopCondition } from './types'
import type { AgentRole, AgentPersona as NamedAgentPersona, NamedAgent, AgentConfig as NamedAgentConfig } from './named/factory'
import type { AgentMode, AgentThingData, AgentPersonaData, Agent as AgentThing, RegisterAgentInput } from './registry'
import type { Role } from './roles'
import type { AgentConfig as DefineAgentConfig, Persona } from './define'
import { createNamedAgent as createNamedAgentFromFactory, PERSONAS } from './named/factory'
import { BaseAgent, BaseAgentOptions } from './Agent'
import type { SQLiteGraphStore } from '../db/graph/stores/sqlite'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Trait for persona building
 */
export type Trait = 'analytical' | 'strategic' | 'communicative' | 'technical' | 'creative' | 'detail_oriented' | 'persuasive' | 'mentoring'

/**
 * Builder options for creating agents
 */
export interface AgentBuilderOptions {
  /** Agent unique name (e.g., 'ralph', 'priya') */
  name: string
  /** Agent role */
  role?: AgentRole
  /** Agent mode */
  mode?: AgentMode
  /** AI model identifier */
  model?: string
  /** Optional description */
  description?: string
  /** Optional instructions (system prompt) */
  instructions?: string
  /** Optional temperature */
  temperature?: number
  /** Optional max tokens */
  maxTokens?: number
  /** Optional tools */
  tools?: ToolDefinition[]
  /** Optional tool names (for Thing storage) */
  toolNames?: string[]
  /** Optional handoff targets */
  handoffs?: string[]
  /** Optional traits */
  traits?: Trait[]
  /** Optional capabilities */
  capabilities?: string[]
  /** Optional guidelines */
  guidelines?: string[]
  /** Optional provider */
  provider?: AgentProvider
  /** Optional hooks */
  hooks?: AgentHooks
  /** Optional stop conditions */
  stopWhen?: StopCondition | StopCondition[]
  /** Can spawn subagents */
  canSpawnSubagents?: boolean
}

/**
 * Built agent result - can be used as NamedAgent, runtime Agent, or Thing
 */
export interface BuiltAgent {
  /** Runtime agent for execution */
  runtime?: Agent
  /** Named agent for template literal invocation */
  named?: NamedAgent
  /** Agent Thing data for graph persistence */
  thingData: AgentThingData
  /** The original config used to build */
  config: AgentBuilderOptions
}

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Default role descriptions
 */
const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  product: 'Product manager - specs, roadmaps, MVP definition',
  engineering: 'Engineering lead - builds code, implements features',
  'tech-lead': 'Tech Lead - architecture, code review, technical decisions',
  marketing: 'Marketing lead - content, launches, announcements',
  sales: 'Sales lead - outreach, pitches, closing deals',
  qa: 'QA lead - testing, quality assurance, bug finding',
  frontend: 'Frontend engineer - React, components, design systems',
  'customer-success': 'Customer success - onboarding, retention, customer advocacy',
  finance: 'Finance lead - budgets, forecasting, financial analysis',
  data: 'Data analyst - analytics, metrics, data-driven insights',
}

/**
 * Default role instructions
 */
const ROLE_INSTRUCTIONS: Record<AgentRole, string> = {
  product: 'Your role is to define products, create specifications, and plan roadmaps.',
  engineering: 'Your role is to build, implement, and improve code based on specifications.',
  'tech-lead': 'Your role is to review code, make architectural decisions, and ensure quality.',
  marketing: 'Your role is to create content, plan launches, and communicate value.',
  sales: 'Your role is to identify opportunities, pitch solutions, and close deals.',
  qa: 'Your role is to ensure quality, find bugs, and validate features.',
  frontend: 'Your role is to build beautiful, accessible, and performant user interfaces.',
  'customer-success': 'Your role is to ensure customer success by guiding onboarding and building relationships.',
  finance: 'Your role is to manage finances, create forecasts, and provide financial analysis.',
  data: 'Your role is to analyze data, extract insights, and drive data-informed decisions.',
}

/**
 * Default model by role
 */
const ROLE_MODELS: Record<AgentRole, string> = {
  product: 'claude-opus-4-20250514', // Complex reasoning for strategy
  engineering: 'claude-sonnet-4-20250514', // Fast for coding
  'tech-lead': 'claude-opus-4-20250514', // Complex reasoning for architecture
  marketing: 'claude-sonnet-4-20250514',
  sales: 'claude-sonnet-4-20250514',
  qa: 'claude-sonnet-4-20250514',
  frontend: 'claude-sonnet-4-20250514',
  'customer-success': 'claude-sonnet-4-20250514',
  finance: 'claude-sonnet-4-20250514', // Supervised mode needs precision
  data: 'claude-sonnet-4-20250514',
}

/**
 * Default mode by role
 */
const ROLE_MODES: Record<AgentRole, AgentMode> = {
  product: 'supervised', // Product decisions need oversight
  engineering: 'autonomous', // Can work independently
  'tech-lead': 'supervised', // Architectural decisions need oversight
  marketing: 'autonomous',
  sales: 'interactive', // Sales needs human interaction
  qa: 'batch', // Testing can be batched
  frontend: 'autonomous',
  'customer-success': 'interactive',
  finance: 'supervised', // Financial decisions need oversight
  data: 'autonomous',
}

// ============================================================================
// AGENT BUILDER
// ============================================================================

/**
 * AgentBuilder provides a fluent API for creating agents.
 *
 * @example
 * ```typescript
 * // Create a simple agent
 * const agent = new AgentBuilder('ralph')
 *   .withRole('engineering')
 *   .withModel('claude-sonnet-4-20250514')
 *   .build()
 *
 * // Create a fully configured agent
 * const agent = new AgentBuilder('custom-agent')
 *   .withRole('engineering')
 *   .withDescription('Custom engineering agent')
 *   .withInstructions('Build amazing code')
 *   .withTraits(['technical', 'analytical'])
 *   .withCapabilities(['Write TypeScript', 'Review code'])
 *   .withTools([readFileTool, writeFileTool])
 *   .withProvider(provider)
 *   .build()
 *
 * // Use the built agent
 * const result = await agent.named`build a todo app`
 * ```
 */
export class AgentBuilder {
  private options: AgentBuilderOptions

  constructor(name: string) {
    this.options = {
      name,
      role: 'engineering', // Default role
      mode: 'autonomous', // Default mode
      model: 'claude-sonnet-4-20250514', // Default model
    }
  }

  /**
   * Set the agent role
   */
  withRole(role: AgentRole): this {
    this.options.role = role
    // Apply role defaults if not already set
    if (!this.options.description) {
      this.options.description = ROLE_DESCRIPTIONS[role]
    }
    if (!this.options.instructions) {
      this.options.instructions = ROLE_INSTRUCTIONS[role]
    }
    if (!this.options.model || this.options.model === 'claude-sonnet-4-20250514') {
      this.options.model = ROLE_MODELS[role]
    }
    if (!this.options.mode || this.options.mode === 'autonomous') {
      this.options.mode = ROLE_MODES[role]
    }
    return this
  }

  /**
   * Set agent from a Role object (from defineRole)
   *
   * This allows interoperability with the defineAgent/defineRole pattern.
   *
   * @example
   * ```typescript
   * import { engineering } from './roles'
   *
   * const builder = new AgentBuilder('ralph')
   *   .fromRole(engineering)
   *   .build()
   * ```
   */
  fromRole(role: Role): this {
    // Map role name to AgentRole if possible
    const roleName = role.name as AgentRole
    if (roleName in ROLE_DESCRIPTIONS) {
      this.options.role = roleName
    }

    // Apply role properties
    if (role.description) {
      this.options.description = role.description
    }
    if (role.capabilities && role.capabilities.length > 0) {
      this.options.capabilities = [...role.capabilities]
    }

    // Build instructions from OKRs and capabilities
    if (role.okrs && role.okrs.length > 0) {
      const okrsText = role.okrs.map(okr => `- ${okr}`).join('\n')
      const capsText = role.capabilities.map(cap => `- ${cap}`).join('\n')
      this.options.instructions = `You are implementing the ${role.name} role.\n\n## Objectives\n${okrsText}\n\n## Capabilities\n${capsText}`
    }

    return this
  }

  /**
   * Set the agent mode
   */
  withMode(mode: AgentMode): this {
    this.options.mode = mode
    return this
  }

  /**
   * Set the AI model
   */
  withModel(model: string): this {
    this.options.model = model
    return this
  }

  /**
   * Set the agent description
   */
  withDescription(description: string): this {
    this.options.description = description
    return this
  }

  /**
   * Set the agent instructions (system prompt)
   */
  withInstructions(instructions: string): this {
    this.options.instructions = instructions
    return this
  }

  /**
   * Set the temperature
   */
  withTemperature(temperature: number): this {
    this.options.temperature = temperature
    return this
  }

  /**
   * Set the max tokens
   */
  withMaxTokens(maxTokens: number): this {
    this.options.maxTokens = maxTokens
    return this
  }

  /**
   * Add personality traits
   */
  withTraits(traits: Trait[]): this {
    this.options.traits = [...(this.options.traits || []), ...traits]
    return this
  }

  /**
   * Add capabilities
   */
  withCapabilities(capabilities: string[]): this {
    this.options.capabilities = [...(this.options.capabilities || []), ...capabilities]
    return this
  }

  /**
   * Add guidelines
   */
  withGuidelines(guidelines: string[]): this {
    this.options.guidelines = [...(this.options.guidelines || []), ...guidelines]
    return this
  }

  /**
   * Add tools (for runtime execution)
   */
  withTools(tools: ToolDefinition[]): this {
    this.options.tools = [...(this.options.tools || []), ...tools]
    // Also store tool names for Thing data
    this.options.toolNames = [...(this.options.toolNames || []), ...tools.map(t => t.name)]
    return this
  }

  /**
   * Add tool names only (for Thing storage without runtime tools)
   */
  withToolNames(toolNames: string[]): this {
    this.options.toolNames = [...(this.options.toolNames || []), ...toolNames]
    return this
  }

  /**
   * Add handoff targets
   */
  withHandoffs(handoffs: string[]): this {
    this.options.handoffs = [...(this.options.handoffs || []), ...handoffs]
    return this
  }

  /**
   * Set the provider for runtime execution
   */
  withProvider(provider: AgentProvider): this {
    this.options.provider = provider
    return this
  }

  /**
   * Add hooks for runtime execution
   */
  withHooks(hooks: AgentHooks): this {
    this.options.hooks = { ...this.options.hooks, ...hooks }
    return this
  }

  /**
   * Set stop conditions
   */
  withStopCondition(stopWhen: StopCondition | StopCondition[]): this {
    this.options.stopWhen = stopWhen
    return this
  }

  /**
   * Enable subagent spawning
   */
  canSpawnSubagents(enabled: boolean = true): this {
    this.options.canSpawnSubagents = enabled
    return this
  }

  /**
   * Load configuration from an existing persona
   */
  fromPersona(personaName: keyof typeof PERSONAS): this {
    const persona = PERSONAS[personaName]
    if (persona) {
      this.options.description = persona.description
      this.options.instructions = persona.instructions
      // Apply role from persona
      this.withRole(persona.role)
    }
    return this
  }

  /**
   * Get the current options
   */
  getOptions(): AgentBuilderOptions {
    return { ...this.options }
  }

  /**
   * Build the agent persona data
   */
  private buildPersonaData(): AgentPersonaData {
    const role = this.options.role || 'engineering'
    return {
      role,
      description: this.options.description || ROLE_DESCRIPTIONS[role],
      instructions: this.options.instructions || ROLE_INSTRUCTIONS[role],
      traits: this.options.traits,
      capabilities: this.options.capabilities,
      guidelines: this.options.guidelines,
    }
  }

  /**
   * Build the agent Thing data (for graph persistence)
   */
  buildThingData(): AgentThingData {
    const persona = this.buildPersonaData()
    return {
      name: this.options.name,
      persona,
      model: this.options.model || ROLE_MODELS[persona.role],
      mode: this.options.mode || ROLE_MODES[persona.role],
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      tools: this.options.toolNames,
      handoffs: this.options.handoffs,
      canSpawnSubagents: this.options.canSpawnSubagents,
    }
  }

  /**
   * Build as a NamedAgent for template literal invocation
   */
  buildNamed(): NamedAgent {
    const persona = this.buildPersonaData()
    const namedPersona: NamedAgentPersona = {
      name: this.options.name,
      role: persona.role,
      description: persona.description,
      instructions: persona.instructions,
    }
    const config: NamedAgentConfig = {
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      model: this.options.model,
      provider: this.options.provider,
    }
    return createNamedAgentFromFactory(namedPersona, config)
  }

  /**
   * Build as an AgentConfig for runtime use
   */
  buildConfig(): AgentConfig {
    const persona = this.buildPersonaData()
    return {
      id: `agent-${this.options.name}`,
      name: this.options.name,
      instructions: persona.instructions,
      model: this.options.model || ROLE_MODELS[persona.role],
      tools: this.options.tools,
      stopWhen: this.options.stopWhen,
      canSpawnSubagents: this.options.canSpawnSubagents,
      handoffs: this.options.handoffs?.map(name => ({
        id: `agent-${name}`,
        name,
        instructions: '',
        model: 'claude-sonnet-4-20250514',
      })),
      providerOptions: {
        temperature: this.options.temperature,
        maxTokens: this.options.maxTokens,
      },
    }
  }

  /**
   * Build as RegisterAgentInput for AgentRegistry
   */
  buildRegisterInput(): RegisterAgentInput {
    const persona = this.buildPersonaData()
    return {
      name: this.options.name,
      role: persona.role,
      model: this.options.model || ROLE_MODELS[persona.role],
      mode: this.options.mode || ROLE_MODES[persona.role],
      description: persona.description,
      instructions: persona.instructions,
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      tools: this.options.toolNames,
      handoffs: this.options.handoffs,
      canSpawnSubagents: this.options.canSpawnSubagents,
    }
  }

  /**
   * Build the complete agent with all representations
   */
  build(): BuiltAgent {
    const thingData = this.buildThingData()
    const named = this.buildNamed()

    return {
      named,
      thingData,
      config: this.options,
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new AgentBuilder
 *
 * @example
 * ```typescript
 * const agent = createAgentBuilder('ralph')
 *   .withRole('engineering')
 *   .withTools([readFileTool])
 *   .build()
 * ```
 */
export function createAgentBuilder(name: string): AgentBuilder {
  return new AgentBuilder(name)
}

/**
 * Create an agent from a persona name
 *
 * @example
 * ```typescript
 * const ralph = createAgentFromPersona('ralph')
 * const result = await ralph.named`build a todo app`
 * ```
 */
export function createAgentFromPersona(personaName: keyof typeof PERSONAS): BuiltAgent {
  return new AgentBuilder(personaName)
    .fromPersona(personaName)
    .build()
}

/**
 * Create an agent from a DefineAgentConfig (for interop with defineAgent pattern)
 *
 * This allows migration from the older defineAgent pattern to the unified builder.
 *
 * @example
 * ```typescript
 * import { product } from './roles'
 *
 * // Old pattern (still works)
 * const oldAgent = defineAgent({
 *   name: 'Priya',
 *   domain: 'priya.do',
 *   role: product,
 *   persona: { voice: 'professional', style: 'concise' },
 * })
 *
 * // New pattern using builder
 * const newAgent = createAgentFromDefineConfig({
 *   name: 'Priya',
 *   domain: 'priya.do',
 *   role: product,
 *   persona: { voice: 'professional', style: 'concise' },
 * })
 *
 * // Both can be invoked the same way
 * await newAgent.named`plan the roadmap`
 * ```
 */
export function createAgentFromDefineConfig(config: DefineAgentConfig): BuiltAgent {
  const builder = new AgentBuilder(config.name)
    .fromRole(config.role)

  if (config.instructions) {
    builder.withInstructions(config.instructions)
  }
  if (config.model) {
    builder.withModel(config.model)
  }
  if (config.temperature) {
    builder.withTemperature(config.temperature)
  }
  if (config.maxTokens) {
    builder.withMaxTokens(config.maxTokens)
  }

  // Store persona in guidelines (persona is freeform in defineAgent)
  if (config.persona.voice) {
    builder.withGuidelines([`Voice: ${config.persona.voice}`])
  }
  if (config.persona.style) {
    builder.withGuidelines([`Style: ${config.persona.style}`])
  }

  return builder.build()
}

/**
 * Create an agent and register it in the graph store
 *
 * @example
 * ```typescript
 * const { agent, thing } = await createAndRegisterAgent(store, {
 *   name: 'ralph',
 *   role: 'engineering',
 * })
 * ```
 */
export async function createAndRegisterAgent(
  store: SQLiteGraphStore,
  options: AgentBuilderOptions
): Promise<{ agent: BuiltAgent; thing: AgentThing }> {
  const builder = new AgentBuilder(options.name)

  if (options.role) builder.withRole(options.role)
  if (options.mode) builder.withMode(options.mode)
  if (options.model) builder.withModel(options.model)
  if (options.description) builder.withDescription(options.description)
  if (options.instructions) builder.withInstructions(options.instructions)
  if (options.temperature) builder.withTemperature(options.temperature)
  if (options.maxTokens) builder.withMaxTokens(options.maxTokens)
  if (options.traits) builder.withTraits(options.traits)
  if (options.capabilities) builder.withCapabilities(options.capabilities)
  if (options.guidelines) builder.withGuidelines(options.guidelines)
  if (options.tools) builder.withTools(options.tools)
  if (options.toolNames) builder.withToolNames(options.toolNames)
  if (options.handoffs) builder.withHandoffs(options.handoffs)
  if (options.provider) builder.withProvider(options.provider)
  if (options.hooks) builder.withHooks(options.hooks)
  if (options.stopWhen) builder.withStopCondition(options.stopWhen)
  if (options.canSpawnSubagents) builder.canSpawnSubagents(options.canSpawnSubagents)

  const agent = builder.build()

  // Import AgentRegistry dynamically to avoid circular dependencies
  const { AgentRegistry } = await import('./registry')
  const registry = new AgentRegistry(store)
  const thing = await registry.register(builder.buildRegisterInput())

  return { agent, thing }
}

/**
 * Load an agent from the graph store
 *
 * @example
 * ```typescript
 * const agent = await loadAgentFromGraph(store, 'ralph')
 * const result = await agent.named`build a todo app`
 * ```
 */
export async function loadAgentFromGraph(
  store: SQLiteGraphStore,
  name: string,
  provider?: AgentProvider
): Promise<BuiltAgent | null> {
  const { AgentRegistry } = await import('./registry')
  const registry = new AgentRegistry(store)
  const agentThing = await registry.get(name)

  if (!agentThing) {
    return null
  }

  const builder = new AgentBuilder(agentThing.name)
    .withRole(agentThing.role)
    .withMode(agentThing.mode)
    .withModel(agentThing.model)
    .withDescription(agentThing.persona.description)
    .withInstructions(agentThing.persona.instructions)

  if (agentThing.temperature) builder.withTemperature(agentThing.temperature)
  if (agentThing.maxTokens) builder.withMaxTokens(agentThing.maxTokens)
  if (agentThing.persona.traits) builder.withTraits(agentThing.persona.traits as Trait[])
  if (agentThing.persona.capabilities) builder.withCapabilities(agentThing.persona.capabilities)
  if (agentThing.persona.guidelines) builder.withGuidelines(agentThing.persona.guidelines)
  if (agentThing.tools) builder.withToolNames(agentThing.tools)
  if (agentThing.handoffs) builder.withHandoffs(agentThing.handoffs)
  if (agentThing.canSpawnSubagents) builder.canSpawnSubagents(agentThing.canSpawnSubagents)
  if (provider) builder.withProvider(provider)

  return builder.build()
}

// ============================================================================
// CONVENIENCE BUILDERS FOR NAMED AGENTS
// ============================================================================

/**
 * Pre-built agent builders for all named agents
 */
export const agents = {
  priya: () => new AgentBuilder('Priya').fromPersona('priya'),
  ralph: () => new AgentBuilder('Ralph').fromPersona('ralph'),
  tom: () => new AgentBuilder('Tom').fromPersona('tom'),
  mark: () => new AgentBuilder('Mark').fromPersona('mark'),
  sally: () => new AgentBuilder('Sally').fromPersona('sally'),
  quinn: () => new AgentBuilder('Quinn').fromPersona('quinn'),
  rae: () => new AgentBuilder('Rae').fromPersona('rae'),
  finn: () => new AgentBuilder('Finn').fromPersona('finn'),
  casey: () => new AgentBuilder('Casey').fromPersona('casey'),
  dana: () => new AgentBuilder('Dana').fromPersona('dana'),
} as const

export default AgentBuilder
