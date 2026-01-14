/**
 * Named Agents Factory
 *
 * Factory functions for creating named agent instances.
 * Named agents are pre-configured agent personas like dana, sam, tom, etc.
 *
 * @module agents/named/factory
 */

import type { AgentConfig } from '../types'

// =============================================================================
// AGENT PERSONAS
// =============================================================================

export type AgentRole = 'data' | 'sales' | 'tech' | 'ops' | 'pm' | 'legal' | 'hr' | 'marketing'

export interface AgentPersona {
  name: string
  role: AgentRole
  description: string
  systemPrompt?: string
}

export const PERSONAS: Record<string, AgentPersona> = {
  dana: {
    name: 'Dana',
    role: 'data',
    description: 'Data/Analytics agent for metrics and insights',
  },
  sam: {
    name: 'Sam',
    role: 'sales',
    description: 'Sales agent for customer relationships',
  },
  tom: {
    name: 'Tom',
    role: 'tech',
    description: 'Technical agent for engineering tasks',
  },
  olivia: {
    name: 'Olivia',
    role: 'ops',
    description: 'Operations agent for business processes',
  },
  priya: {
    name: 'Priya',
    role: 'pm',
    description: 'Product manager agent for planning and roadmaps',
  },
}

// =============================================================================
// AGENT FACTORY
// =============================================================================

/**
 * Create a named agent that can be called with template literals.
 */
function createNamedAgent(persona: AgentPersona) {
  const agent = async function (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<string> {
    const prompt = String.raw({ raw: strings }, ...values)
    // Placeholder implementation - actual implementation would call LLM
    return `[${persona.name}]: Processing "${prompt}"...`
  }

  // Add persona metadata
  Object.assign(agent, { persona })

  return agent
}

// =============================================================================
// NAMED AGENT EXPORTS
// =============================================================================

export const dana = createNamedAgent(PERSONAS.dana!)
export const sam = createNamedAgent(PERSONAS.sam!)
export const tom = createNamedAgent(PERSONAS.tom!)
export const olivia = createNamedAgent(PERSONAS.olivia!)
export const priya = createNamedAgent(PERSONAS.priya!)

// Default export for convenience
export default { dana, sam, tom, olivia, priya, PERSONAS }
