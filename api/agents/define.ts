/**
 * Agent Types and defineAgent()
 *
 * Defines the Agent type and factory function for creating agents
 * with template literal invocation support.
 *
 * @see dotdo-r6my2 - TDD: Agent types and defineAgent()
 * @see dotdo-cdge8 - TDD: Sam agent (support)
 * @module agents/define
 */

import type { Role } from './roles'

// ============================================================================
// Types
// ============================================================================

/**
 * Persona configuration for an agent
 * Defines the voice, style, and other personality traits
 */
export interface Persona {
  /** Communication voice (e.g., 'professional', 'friendly', 'technical') */
  voice?: string
  /** Response style (e.g., 'concise', 'detailed', 'conversational') */
  style?: string
  /** Additional persona traits */
  [key: string]: unknown
}

/**
 * Configuration for defining an agent
 */
export interface AgentConfig {
  /** Agent's display name */
  name: string
  /** Agent's .do domain (e.g., 'priya.do') */
  domain: string
  /** Role this agent implements */
  role: Role
  /** Persona configuration */
  persona: Persona
  /** Optional system instructions override */
  instructions?: string
  /** Optional model configuration */
  model?: string
  /** Optional temperature */
  temperature?: number
  /** Optional max tokens */
  maxTokens?: number
}

/**
 * Agent interface - callable function with metadata properties
 *
 * Agents can be invoked as template literal tags:
 * ```ts
 * await priya`plan the roadmap for ${feature}`
 * ```
 */
export interface Agent {
  /** Template literal tag function */
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<string>

  /** Agent's display name */
  readonly name: string
  /** Agent's .do domain */
  readonly domain: string
  /** Role this agent implements */
  readonly role: Role
  /** Persona configuration */
  readonly persona: Persona
  /** Original config */
  readonly config: AgentConfig
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Interpolate template literal strings and values
 */
function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    let value = ''
    if (i < values.length) {
      const v = values[i]
      if (v === null || v === undefined) {
        value = ''
      } else if (typeof v === 'object') {
        value = JSON.stringify(v, null, 2)
      } else {
        value = String(v)
      }
    }
    return result + str + value
  }, '')
}

/**
 * Build system prompt from agent config
 */
function buildSystemPrompt(config: AgentConfig): string {
  const { name, role, persona } = config

  const sections: string[] = []

  // Opening
  sections.push(`You are ${name}, implementing the ${role.name} role.`)
  sections.push('')

  // Persona
  if (persona.voice || persona.style) {
    sections.push('## Persona')
    if (persona.voice) {
      sections.push(`- Voice: ${persona.voice}`)
    }
    if (persona.style) {
      sections.push(`- Style: ${persona.style}`)
    }
    sections.push('')
  }

  // OKRs
  if (role.okrs.length > 0) {
    sections.push('## Objectives')
    for (const okr of role.okrs) {
      sections.push(`- ${okr}`)
    }
    sections.push('')
  }

  // Capabilities
  if (role.capabilities.length > 0) {
    sections.push('## Capabilities')
    for (const cap of role.capabilities) {
      sections.push(`- ${cap}`)
    }
  }

  return sections.join('\n')
}

/**
 * Environment configuration for agent execution
 * Should be passed from CloudflareEnv bindings
 */
export interface AgentEnv {
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
}

// Module-level env storage for agent execution
// Set via setAgentEnv() from Worker/DO context
let moduleEnv: AgentEnv = {}

/**
 * Set the environment bindings for agent execution
 * Call this from your Worker/DO with the CloudflareEnv bindings
 */
export function setAgentEnv(env: AgentEnv): void {
  moduleEnv = env
}

/**
 * Execute an agent invocation
 *
 * In production, this calls an LLM API using keys from CloudflareEnv.
 * For testing without API keys, returns a mock response.
 */
async function executeAgent(config: AgentConfig, prompt: string): Promise<string> {
  // Check for API key from module env (set via setAgentEnv)
  const anthropicKey = moduleEnv.ANTHROPIC_API_KEY
  const openaiKey = moduleEnv.OPENAI_API_KEY

  // If no API keys, return mock response (for testing)
  if (!anthropicKey && !openaiKey) {
    return `[${config.name}] Response for: ${prompt.slice(0, 50)}...`
  }

  const systemPrompt = config.instructions || buildSystemPrompt(config)

  // Use Anthropic if available
  if (anthropicKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: config.maxTokens || 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature,
    })

    const textBlocks = response.content.filter((b) => b.type === 'text')
    return textBlocks.map((b) => (b as { text: string }).text).join('')
  }

  // Fall back to OpenAI
  if (openaiKey) {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: openaiKey })

    const response = await client.chat.completions.create({
      model: config.model || 'gpt-4-turbo-preview',
      max_tokens: config.maxTokens || 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: config.temperature,
    })

    return response.choices[0]?.message?.content || ''
  }

  // Should not reach here
  return `[${config.name}] Response for: ${prompt.slice(0, 50)}...`
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Define an agent with a name, domain, role, and persona
 *
 * The returned agent is callable as a template literal tag function:
 * ```ts
 * const priya = defineAgent({
 *   name: 'Priya',
 *   domain: 'priya.do',
 *   role: product,
 *   persona: { voice: 'professional', style: 'concise' },
 * })
 *
 * // Usage
 * await priya`plan the roadmap for ${feature}`
 * ```
 *
 * @param config - Agent configuration
 * @returns Agent instance (callable function with metadata)
 */
export function defineAgent(config: AgentConfig): Agent {
  // Create the callable function
  const agent = function (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<string> {
    const prompt = interpolate(strings, values)
    return executeAgent(config, prompt)
  } as Agent

  // Add readonly properties
  Object.defineProperty(agent, 'name', {
    value: config.name,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'domain', {
    value: config.domain,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'role', {
    value: config.role,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'persona', {
    value: config.persona,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'config', {
    value: config,
    writable: false,
    enumerable: true,
  })

  return agent
}
