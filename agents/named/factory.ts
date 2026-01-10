/**
 * Named Agent Factory
 *
 * Creates template-literal-invocable agents with personas for the
 * Business-as-Code framework.
 *
 * @see dotdo-kp869 - GREEN phase implementation
 * @see dotdo-xaidb - REFACTOR phase (persona extraction)
 * @module agents/named/factory
 */

// ============================================================================
// Types
// ============================================================================

export type AgentRole = 'product' | 'engineering' | 'tech-lead' | 'marketing' | 'sales' | 'qa'

export interface AgentPersona {
  name: string
  role: AgentRole
  description: string
  instructions: string
}

export interface AgentConfig {
  temperature?: number
  maxTokens?: number
  model?: string
}

export interface PipelinePromise<T> extends Promise<T> {
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
}

/**
 * Stream template result - async iterable of string chunks
 */
export interface StreamTemplate {
  (strings: TemplateStringsArray, ...values: unknown[]): AsyncIterable<string>
}

/**
 * Named agent that can be invoked via template literal or function call
 */
export interface NamedAgent {
  /** Template literal invocation */
  (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string>
  /** Function call invocation (alternative syntax) */
  (input: string | object): PipelinePromise<string>

  /** Agent role identifier */
  readonly role: AgentRole

  /** Agent name */
  readonly name: string

  /** Agent description */
  readonly description: string

  /** Create agent with custom config */
  withConfig(config: AgentConfig): NamedAgent

  /** Reset agent context/state */
  reset(): void

  /** Stream template literal for long responses */
  stream: StreamTemplate

  /** Approval method (for reviewers like Tom, Quinn) */
  approve?(input: unknown): Promise<boolean>
}

// ============================================================================
// Personas
// ============================================================================

// Re-export composable persona system for extensibility
export {
  PersonaBuilder,
  persona,
  TRAITS,
  ROLE_DEFINITIONS,
  PERSONA_DEFINITIONS,
  type Trait,
  type RoleDefinition,
  type PersonaBuilderOptions,
} from './personas'

/**
 * Legacy PERSONAS export with original hardcoded instructions.
 * Maintained for backwards compatibility.
 *
 * For new personas, use the composable PersonaBuilder:
 * @example
 * ```ts
 * import { persona } from './personas'
 *
 * const customAgent = persona('Alex', 'engineering')
 *   .withDescription('Backend specialist')
 *   .addCapabilities('Optimize database queries')
 *   .build()
 * ```
 */
export const PERSONAS: Record<string, AgentPersona> = {
  priya: {
    name: 'Priya',
    role: 'product',
    description: 'Product manager - specs, roadmaps, MVP definition',
    instructions: `You are Priya, a product manager and strategist.

Your role is to define products, create specifications, and plan roadmaps.

## Core Capabilities
- Define MVP requirements and scope
- Create product specifications
- Plan feature roadmaps
- Prioritize based on user value
- Write user stories and acceptance criteria

## Guidelines
- Focus on user problems and value
- Be specific about requirements
- Consider technical feasibility
- Prioritize ruthlessly
- Use clear, unambiguous language`,
  },

  ralph: {
    name: 'Ralph',
    role: 'engineering',
    description: 'Engineering lead - builds code, implements features',
    instructions: `You are Ralph, a senior software engineer.

Your role is to build, implement, and improve code based on specifications.

## Core Capabilities
- Write clean, production-ready code
- Implement features from specifications
- Refactor and improve existing code
- Follow best practices and patterns
- Generate tests alongside implementation

## Guidelines
- Write TypeScript by default
- Use modern patterns and idioms
- Include error handling
- Add comments for complex logic
- Consider performance implications`,
  },

  tom: {
    name: 'Tom',
    role: 'tech-lead',
    description: 'Tech Lead - architecture, code review, technical decisions',
    instructions: `You are Tom, a technical lead and architect.

Your role is to review code, make architectural decisions, and ensure quality.

## Core Capabilities
- Review code for quality and correctness
- Design system architecture
- Make technical decisions
- Identify risks and trade-offs
- Mentor and provide feedback

## Guidelines
- Be thorough but constructive
- Focus on important issues first
- Explain the "why" behind feedback
- Consider maintainability
- Balance perfectionism with pragmatism`,
  },

  mark: {
    name: 'Mark',
    role: 'marketing',
    description: 'Marketing lead - content, launches, announcements',
    instructions: `You are Mark, a marketing and communications lead.

Your role is to create content, plan launches, and communicate value.

## Core Capabilities
- Write compelling copy and content
- Plan product launches
- Create announcements and updates
- Communicate technical concepts clearly
- Build brand voice and messaging

## Guidelines
- Focus on benefits, not features
- Use clear, engaging language
- Know your audience
- Create urgency when appropriate
- Be authentic and trustworthy`,
  },

  sally: {
    name: 'Sally',
    role: 'sales',
    description: 'Sales lead - outreach, pitches, closing deals',
    instructions: `You are Sally, a sales and business development lead.

Your role is to identify opportunities, pitch solutions, and close deals.

## Core Capabilities
- Create compelling sales pitches
- Identify and qualify leads
- Handle objections
- Negotiate and close deals
- Build customer relationships

## Guidelines
- Understand customer pain points
- Focus on value and ROI
- Be consultative, not pushy
- Follow up persistently
- Know when to walk away`,
  },

  quinn: {
    name: 'Quinn',
    role: 'qa',
    description: 'QA lead - testing, quality assurance, bug finding',
    instructions: `You are Quinn, a quality assurance and testing lead.

Your role is to ensure quality, find bugs, and validate features.

## Core Capabilities
- Design test strategies
- Write test cases
- Find edge cases and bugs
- Validate against requirements
- Ensure quality standards

## Guidelines
- Think like an adversary
- Test edge cases first
- Document reproduction steps
- Verify fixes thoroughly
- Balance coverage with efficiency`,
  },
}

// ============================================================================
// Mock Mode for Testing
// ============================================================================

let mockMode = false
let mockResponses: Map<string, string> = new Map()

/**
 * Enable mock mode for testing without API calls
 */
export function enableMockMode(): void {
  mockMode = true
}

/**
 * Disable mock mode
 */
export function disableMockMode(): void {
  mockMode = false
  mockResponses.clear()
}

/**
 * Set a mock response for a specific prompt pattern
 */
export function setMockResponse(pattern: string, response: string): void {
  mockResponses.set(pattern, response)
}

/**
 * Check if mock mode is enabled
 */
export function isMockMode(): boolean {
  return mockMode
}

// ============================================================================
// Factory Implementation
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
 * Create a pipeline promise with chainable methods
 */
function createPipelinePromise<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipelinePromise = promise as PipelinePromise<T>

  pipelinePromise.map = <R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(promise.then(fn))
  }

  return pipelinePromise
}

/**
 * Execute agent with the given prompt
 */
async function executeAgent(persona: AgentPersona, prompt: string, _config: AgentConfig = {}): Promise<string> {
  // In mock mode, return a mock response
  if (mockMode) {
    // Check for specific mock response
    for (const [pattern, response] of mockResponses) {
      if (prompt.includes(pattern)) {
        return response
      }
    }
    // Default mock response
    return `[${persona.name}] Mock response for: ${prompt.slice(0, 50)}...`
  }

  // Real implementation would call AI here
  // For now, throw if no API key configured
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      `No API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, ` +
        `or call enableMockMode() for testing.`
    )
  }

  // TODO: Integrate with actual AI Gateway
  // For now, return a placeholder indicating the agent was invoked
  return `[${persona.name}] Would process: ${prompt}`
}

/**
 * Check if argument is a template literal strings array
 */
function isTemplateStringsArray(arg: unknown): arg is TemplateStringsArray {
  return Array.isArray(arg) && 'raw' in arg
}

/**
 * Create a named agent from a persona
 */
export function createNamedAgent(persona: AgentPersona, config: AgentConfig = {}): NamedAgent {
  // Create the callable function (handles both template literal and function call)
  const agent = function (
    stringsOrInput: TemplateStringsArray | string | object,
    ...values: unknown[]
  ): PipelinePromise<string> {
    let prompt: string

    if (isTemplateStringsArray(stringsOrInput)) {
      // Template literal: priya`define the MVP`
      prompt = interpolate(stringsOrInput, values)
    } else if (typeof stringsOrInput === 'string') {
      // Direct string: priya('define the MVP')
      prompt = stringsOrInput
    } else {
      // Object: priya({ task: 'build auth', context: { ... } })
      prompt = JSON.stringify(stringsOrInput, null, 2)
    }

    return createPipelinePromise(executeAgent(persona, prompt, config))
  } as NamedAgent

  // Add readonly properties
  Object.defineProperty(agent, 'role', {
    value: persona.role,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'name', {
    value: persona.name,
    writable: false,
    enumerable: true,
  })

  Object.defineProperty(agent, 'description', {
    value: persona.description,
    writable: false,
    enumerable: true,
  })

  // Add withConfig method
  agent.withConfig = (newConfig: AgentConfig): NamedAgent => {
    return createNamedAgent(persona, { ...config, ...newConfig })
  }

  // Add reset method (clears conversation context - placeholder for now)
  agent.reset = (): void => {
    // In a real implementation, this would clear conversation history
    // For now, it's a no-op since we don't maintain state yet
  }

  // Add stream method for streaming responses
  agent.stream = function (
    strings: TemplateStringsArray,
    ...streamValues: unknown[]
  ): AsyncIterable<string> {
    const prompt = interpolate(strings, streamValues)

    return {
      async *[Symbol.asyncIterator]() {
        // In mock mode or placeholder, simulate streaming by chunking the response
        const fullResponse = await executeAgent(persona, prompt, config)
        // Split into chunks for streaming simulation
        const chunkSize = 20
        for (let i = 0; i < fullResponse.length; i += chunkSize) {
          yield fullResponse.slice(i, i + chunkSize)
        }
      },
    }
  }

  // Add approve method for reviewers (tom, quinn)
  if (persona.role === 'tech-lead' || persona.role === 'qa') {
    agent.approve = async (input: unknown): Promise<boolean> => {
      const prompt = `Review and approve the following:\n\n${JSON.stringify(input, null, 2)}\n\nRespond with APPROVED or REJECTED.`
      const result = await executeAgent(persona, prompt, config)
      return result.toUpperCase().includes('APPROVED')
    }
  }

  return agent
}

// ============================================================================
// Pre-built Agents
// ============================================================================

export const priya = createNamedAgent(PERSONAS.priya)
export const ralph = createNamedAgent(PERSONAS.ralph)
export const tom = createNamedAgent(PERSONAS.tom)
export const mark = createNamedAgent(PERSONAS.mark)
export const sally = createNamedAgent(PERSONAS.sally)
export const quinn = createNamedAgent(PERSONAS.quinn)
