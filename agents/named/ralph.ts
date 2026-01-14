/**
 * Ralph - Engineering Agent
 *
 * Ralph is the Engineering agent in the dotdo Business-as-Code framework.
 * Responsible for:
 * - Building code from specifications
 * - Code generation tasks
 * - Technical implementation
 * - Iterative improvement based on feedback
 *
 * @example
 * ```ts
 * import { ralph } from 'agents.do'
 *
 * // Template literal syntax
 * const app = await ralph`build ${spec}`
 *
 * // Iterative improvement pattern
 * do {
 *   app = ralph`improve ${app} per ${feedback}`
 * } while (!await reviewer.approve(app))
 * ```
 *
 * @module agents/named/ralph
 */

import { AIGatewayClient, AIGatewayEnv, ChatMessage } from '../../lib/ai/gateway'
import { BaseAgent } from '../Agent'
import type {
  Agent,
  AgentConfig,
  AgentProvider,
  AgentInput,
  AgentResult,
  AgentStreamResult,
} from '../types'
import type { AIConfig, AIProvider } from '../../types/AI'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for Ralph
 */
export interface RalphConfig {
  /** AI provider to use */
  provider?: AIProvider
  /** Model to use (defaults to claude-sonnet-4-20250514) */
  model?: string
  /** Temperature for generation (defaults to 0.3 for more deterministic code) */
  temperature?: number
  /** Max tokens for response */
  maxTokens?: number
  /** AI Gateway ID */
  gateway?: string
  /** Environment bindings */
  env?: AIGatewayEnv
}

/**
 * Options for template literal configuration
 */
export interface RalphTemplateLiteralOptions extends RalphConfig {
  /** Additional system prompt context */
  systemPrompt?: string
}

/**
 * Options for creating Ralph as an Agent
 */
export interface CreateRalphOptions {
  /** Agent provider to use */
  provider: AgentProvider
  /** Model to use */
  model?: string
  /** Maximum steps for agent loop */
  maxSteps?: number
  /** Additional configuration */
  config?: Partial<AgentConfig>
}

/**
 * Promise with chainable methods for no-await operations
 */
export interface PipelinePromise<T> extends Promise<T> {
  /** Transform the result */
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
  /** Handle errors */
  catch<R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R>
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Ralph's system prompt - engineering-focused instructions
 */
export const RALPH_SYSTEM_PROMPT = `You are Ralph, a senior software engineer and code architect.

Your role is to build, implement, and improve code based on specifications and feedback.

## Core Capabilities
- Write clean, maintainable, production-ready code
- Implement features from natural language specifications
- Refactor and improve existing code
- Follow best practices and design patterns
- Generate tests alongside implementation

## Guidelines
- Write TypeScript by default unless otherwise specified
- Use modern patterns and idioms
- Include error handling and edge cases
- Add inline comments for complex logic
- Structure code for maintainability
- Consider performance implications

## Response Format
When generating code:
- Use markdown code blocks with language identifiers
- Provide brief explanations of key decisions
- Note any assumptions or trade-offs

When asked to "build" or "implement":
- Focus on complete, working solutions
- Include necessary imports and types
- Make the code immediately usable

When asked to "improve" based on feedback:
- Address all feedback points
- Explain what changed and why
- Preserve existing functionality unless asked to change it`

/**
 * Default Ralph configuration
 */
const DEFAULT_CONFIG: RalphConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3, // Lower temperature for more deterministic code generation
}

// ============================================================================
// PipelinePromise Implementation
// ============================================================================

/**
 * Creates a PipelinePromise from a regular Promise
 */
function createPipelinePromise<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipelinePromise = promise as PipelinePromise<T>

  // Add map method for transformation
  pipelinePromise.map = <R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(promise.then(fn))
  }

  // Override catch to return PipelinePromise
  const originalCatch = pipelinePromise.catch.bind(pipelinePromise)
  pipelinePromise.catch = <R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(originalCatch(fn) as Promise<R>)
  }

  return pipelinePromise
}

// ============================================================================
// Helper Functions
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
 * Create AI client from configuration
 */
function createClient(config: RalphConfig): AIGatewayClient {
  const aiConfig: AIConfig = {
    provider: config.provider ?? DEFAULT_CONFIG.provider ?? 'anthropic',
    model: config.model ?? DEFAULT_CONFIG.model ?? 'claude-sonnet-4-20250514',
    gateway: config.gateway,
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxTokens: config.maxTokens,
  }

  const env = config.env ?? {}

  return new AIGatewayClient(aiConfig, env)
}

/**
 * Execute Ralph chat and return response
 */
async function executeChat(
  prompt: string,
  options: RalphTemplateLiteralOptions = {}
): Promise<string> {
  const client = createClient(options)

  const messages: ChatMessage[] = []

  // Build system prompt
  let systemPrompt = RALPH_SYSTEM_PROMPT
  if (options.systemPrompt) {
    systemPrompt = `${RALPH_SYSTEM_PROMPT}\n\n## Additional Context\n${options.systemPrompt}`
  }

  messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  const response = await client.chat(messages)
  return response.content
}

// ============================================================================
// Ralph Template Literal Function
// ============================================================================

/**
 * Ralph template literal function for code generation
 *
 * @example
 * ```ts
 * // Simple code generation
 * const code = await ralph`Create a React button component`
 *
 * // Build from specification
 * const app = await ralph`build ${spec}`
 *
 * // Improve based on feedback
 * const improved = await ralph`improve ${app} per ${feedback}`
 * ```
 */
export function ralph(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const prompt = interpolate(strings, values)
  return createPipelinePromise(executeChat(prompt))
}

/**
 * Create a configured ralph function with custom options
 */
ralph.configure = (options: RalphTemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const prompt = interpolate(strings, values)
    return createPipelinePromise(executeChat(prompt, options))
  }
}

// ============================================================================
// RalphAgent Class
// ============================================================================

/**
 * RalphAgent - Full Agent SDK integration for Ralph
 *
 * Provides full Agent capabilities including:
 * - Multi-step execution
 * - Tool usage
 * - Streaming
 * - Hooks
 *
 * @example
 * ```ts
 * const provider = createClaudeProvider()
 * const ralph = createRalph({ provider })
 *
 * const result = await ralph.run({
 *   prompt: 'Build a REST API for user management',
 *   tools: [writeFileTool, readFileTool],
 * })
 * ```
 */
export class RalphAgent implements Agent {
  readonly config: AgentConfig
  readonly provider: AgentProvider
  private agent: Agent

  constructor(options: CreateRalphOptions) {
    this.provider = options.provider

    // Build Ralph's configuration
    this.config = {
      id: 'ralph',
      name: 'Ralph',
      instructions: RALPH_SYSTEM_PROMPT,
      model: options.model ?? 'claude-sonnet-4-20250514',
      maxSteps: options.maxSteps ?? 20,
      ...options.config,
    }

    // Create the underlying agent
    this.agent = this.provider.createAgent(this.config)
  }

  /**
   * Run Ralph to completion
   */
  async run(input: AgentInput): Promise<AgentResult> {
    return this.agent.run(input)
  }

  /**
   * Stream Ralph's execution
   */
  stream(input: AgentInput): AgentStreamResult {
    return this.agent.stream(input)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Ralph agent instance
 *
 * @example
 * ```ts
 * import { createClaudeProvider } from '../providers'
 * import { createRalph } from './ralph'
 *
 * const provider = createClaudeProvider({ apiKey: '...' })
 * const ralph = createRalph({ provider })
 *
 * const result = await ralph.run({
 *   prompt: 'Build authentication system',
 * })
 * ```
 */
export function createRalph(options: CreateRalphOptions): RalphAgent {
  return new RalphAgent(options)
}

// ============================================================================
// Default Export
// ============================================================================

export default ralph
