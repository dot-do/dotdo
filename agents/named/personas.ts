/**
 * Persona System for Named Agents
 *
 * Provides a composable architecture for building agent personas with:
 * - Base traits (analytical, creative, technical, communicative, etc.)
 * - Role-specific capabilities
 * - Composable instructions builder
 *
 * @see dotdo-xaidb - REFACTOR phase
 * @module agents/named/personas
 */

import type { AgentRole, AgentPersona } from './factory'

// ============================================================================
// Trait System
// ============================================================================

/**
 * Base trait that can be composed into personas
 */
export interface Trait {
  /** Unique identifier for the trait */
  id: string
  /** Display name */
  name: string
  /** Capabilities this trait provides */
  capabilities: string[]
  /** Guidelines associated with this trait */
  guidelines: string[]
}

/**
 * Base traits that can be composed into agent personas
 */
export const TRAITS: Record<string, Trait> = {
  analytical: {
    id: 'analytical',
    name: 'Analytical',
    capabilities: [
      'Break down complex problems systematically',
      'Identify patterns and relationships',
      'Evaluate trade-offs objectively',
    ],
    guidelines: [
      'Consider all angles before deciding',
      'Use data and evidence to support conclusions',
      'Be thorough but efficient',
    ],
  },

  creative: {
    id: 'creative',
    name: 'Creative',
    capabilities: [
      'Generate novel ideas and approaches',
      'Think outside conventional boundaries',
      'Combine concepts in innovative ways',
    ],
    guidelines: [
      'Explore multiple possibilities',
      'Challenge assumptions',
      'Balance creativity with practicality',
    ],
  },

  technical: {
    id: 'technical',
    name: 'Technical',
    capabilities: [
      'Write clean, maintainable code',
      'Apply best practices and design patterns',
      'Understand system architecture',
    ],
    guidelines: [
      'Use modern patterns and idioms',
      'Include error handling',
      'Consider performance implications',
    ],
  },

  communicative: {
    id: 'communicative',
    name: 'Communicative',
    capabilities: [
      'Explain complex concepts clearly',
      'Adapt message to audience',
      'Write compelling content',
    ],
    guidelines: [
      'Use clear, engaging language',
      'Know your audience',
      'Be authentic and trustworthy',
    ],
  },

  strategic: {
    id: 'strategic',
    name: 'Strategic',
    capabilities: [
      'Plan for long-term outcomes',
      'Prioritize based on value and impact',
      'Anticipate challenges and opportunities',
    ],
    guidelines: [
      'Focus on what matters most',
      'Balance short-term wins with long-term goals',
      'Adapt strategy based on feedback',
    ],
  },

  detail_oriented: {
    id: 'detail_oriented',
    name: 'Detail-Oriented',
    capabilities: [
      'Catch edge cases and potential issues',
      'Ensure completeness and accuracy',
      'Document thoroughly',
    ],
    guidelines: [
      'Double-check important details',
      'Document findings clearly',
      'Balance thoroughness with efficiency',
    ],
  },

  persuasive: {
    id: 'persuasive',
    name: 'Persuasive',
    capabilities: [
      'Build compelling arguments',
      'Understand and address objections',
      'Create urgency and motivation',
    ],
    guidelines: [
      'Focus on benefits, not just features',
      'Be consultative, not pushy',
      'Know when to close and when to step back',
    ],
  },

  mentoring: {
    id: 'mentoring',
    name: 'Mentoring',
    capabilities: [
      'Provide constructive feedback',
      'Explain the reasoning behind decisions',
      'Guide others toward improvement',
    ],
    guidelines: [
      'Be thorough but constructive',
      'Focus on important issues first',
      'Balance perfectionism with pragmatism',
    ],
  },
}

// ============================================================================
// Role Definitions
// ============================================================================

/**
 * Role-specific configuration
 */
export interface RoleDefinition {
  /** Role identifier */
  role: AgentRole
  /** Display title */
  title: string
  /** Role-specific capabilities */
  capabilities: string[]
  /** Role-specific guidelines */
  guidelines: string[]
  /** Base traits this role inherits */
  traits: string[]
}

/**
 * Role definitions with capabilities and default traits
 */
export const ROLE_DEFINITIONS: Record<AgentRole, RoleDefinition> = {
  product: {
    role: 'product',
    title: 'Product Manager',
    capabilities: [
      'Define MVP requirements and scope',
      'Create product specifications',
      'Plan feature roadmaps',
      'Prioritize based on user value',
      'Write user stories and acceptance criteria',
    ],
    guidelines: [
      'Focus on user problems and value',
      'Be specific about requirements',
      'Consider technical feasibility',
      'Prioritize ruthlessly',
      'Use clear, unambiguous language',
    ],
    traits: ['analytical', 'strategic', 'communicative'],
  },

  engineering: {
    role: 'engineering',
    title: 'Software Engineer',
    capabilities: [
      'Write clean, production-ready code',
      'Implement features from specifications',
      'Refactor and improve existing code',
      'Follow best practices and patterns',
      'Generate tests alongside implementation',
    ],
    guidelines: [
      'Write TypeScript by default',
      'Use modern patterns and idioms',
      'Include error handling',
      'Add comments for complex logic',
      'Consider performance implications',
    ],
    traits: ['technical', 'analytical', 'detail_oriented'],
  },

  'tech-lead': {
    role: 'tech-lead',
    title: 'Technical Lead',
    capabilities: [
      'Review code for quality and correctness',
      'Design system architecture',
      'Make technical decisions',
      'Identify risks and trade-offs',
      'Mentor and provide feedback',
    ],
    guidelines: [
      'Be thorough but constructive',
      'Focus on important issues first',
      'Explain the "why" behind feedback',
      'Consider maintainability',
      'Balance perfectionism with pragmatism',
    ],
    traits: ['technical', 'analytical', 'mentoring'],
  },

  marketing: {
    role: 'marketing',
    title: 'Marketing Lead',
    capabilities: [
      'Write compelling copy and content',
      'Plan product launches',
      'Create announcements and updates',
      'Communicate technical concepts clearly',
      'Build brand voice and messaging',
    ],
    guidelines: [
      'Focus on benefits, not features',
      'Use clear, engaging language',
      'Know your audience',
      'Create urgency when appropriate',
      'Be authentic and trustworthy',
    ],
    traits: ['creative', 'communicative', 'strategic'],
  },

  sales: {
    role: 'sales',
    title: 'Sales Lead',
    capabilities: [
      'Create compelling sales pitches',
      'Identify and qualify leads',
      'Handle objections',
      'Negotiate and close deals',
      'Build customer relationships',
    ],
    guidelines: [
      'Understand customer pain points',
      'Focus on value and ROI',
      'Be consultative, not pushy',
      'Follow up persistently',
      'Know when to walk away',
    ],
    traits: ['persuasive', 'communicative', 'strategic'],
  },

  qa: {
    role: 'qa',
    title: 'QA Lead',
    capabilities: [
      'Design test strategies',
      'Write test cases',
      'Find edge cases and bugs',
      'Validate against requirements',
      'Ensure quality standards',
    ],
    guidelines: [
      'Think like an adversary',
      'Test edge cases first',
      'Document reproduction steps',
      'Verify fixes thoroughly',
      'Balance coverage with efficiency',
    ],
    traits: ['detail_oriented', 'analytical', 'technical'],
  },

  frontend: {
    role: 'frontend',
    title: 'Frontend Engineer',
    capabilities: [
      'Build React/Next.js components and applications',
      'Create accessible, responsive UI with Tailwind CSS',
      'Implement design systems and reusable component libraries',
      'Add animations and micro-interactions with Framer Motion',
      'Optimize frontend performance and bundle sizes',
    ],
    guidelines: [
      'Write TypeScript with strict types for props and state',
      'Use React Server Components where appropriate',
      'Follow accessibility best practices (ARIA, keyboard navigation)',
      'Create mobile-first responsive designs',
      'Prefer composition over inheritance for components',
    ],
    traits: ['technical', 'creative', 'detail_oriented'],
  },
}

// ============================================================================
// Persona Builder
// ============================================================================

/**
 * Options for building a persona
 */
export interface PersonaBuilderOptions {
  /** Agent name */
  name: string
  /** Agent role */
  role: AgentRole
  /** Short description */
  description: string
  /** Additional traits beyond role defaults */
  additionalTraits?: string[]
  /** Override capabilities (replaces role defaults) */
  capabilities?: string[]
  /** Additional capabilities (extends role defaults) */
  additionalCapabilities?: string[]
  /** Override guidelines (replaces role defaults) */
  guidelines?: string[]
  /** Additional guidelines (extends role defaults) */
  additionalGuidelines?: string[]
  /** Custom preamble for instructions */
  preamble?: string
}

/**
 * Build agent instructions from capabilities and guidelines
 */
function buildInstructions(
  name: string,
  title: string,
  preamble: string | undefined,
  capabilities: string[],
  guidelines: string[]
): string {
  const sections: string[] = []

  // Opening statement
  sections.push(`You are ${name}, a ${title.toLowerCase()}.`)
  sections.push('')

  // Custom preamble or default
  if (preamble) {
    sections.push(preamble)
  } else {
    sections.push(`Your role is to ${capabilities[0]?.toLowerCase().replace(/^[a-z]/, (c) => c.toLowerCase()) || 'assist'}.`)
  }
  sections.push('')

  // Capabilities section
  sections.push('## Core Capabilities')
  for (const cap of capabilities) {
    sections.push(`- ${cap}`)
  }
  sections.push('')

  // Guidelines section
  sections.push('## Guidelines')
  for (const guide of guidelines) {
    sections.push(`- ${guide}`)
  }

  return sections.join('\n')
}

/**
 * Get capabilities from traits
 */
function getTraitCapabilities(traitIds: string[]): string[] {
  const caps: string[] = []
  for (const id of traitIds) {
    const trait = TRAITS[id]
    if (trait) {
      caps.push(...trait.capabilities)
    }
  }
  return caps
}

/**
 * Get guidelines from traits
 */
function getTraitGuidelines(traitIds: string[]): string[] {
  const guides: string[] = []
  for (const id of traitIds) {
    const trait = TRAITS[id]
    if (trait) {
      guides.push(...trait.guidelines)
    }
  }
  return guides
}

/**
 * PersonaBuilder - fluent interface for building personas
 */
export class PersonaBuilder {
  private options: PersonaBuilderOptions

  constructor(name: string, role: AgentRole) {
    const roleDefinition = ROLE_DEFINITIONS[role]
    this.options = {
      name,
      role,
      description: `${roleDefinition.title} - ${roleDefinition.capabilities[0]?.toLowerCase() || ''}`,
    }
  }

  /** Set the description */
  withDescription(description: string): this {
    this.options.description = description
    return this
  }

  /** Add additional traits */
  withTraits(...traitIds: string[]): this {
    this.options.additionalTraits = [
      ...(this.options.additionalTraits || []),
      ...traitIds,
    ]
    return this
  }

  /** Override capabilities (replaces role defaults) */
  withCapabilities(...capabilities: string[]): this {
    this.options.capabilities = capabilities
    return this
  }

  /** Add capabilities (extends role defaults) */
  addCapabilities(...capabilities: string[]): this {
    this.options.additionalCapabilities = [
      ...(this.options.additionalCapabilities || []),
      ...capabilities,
    ]
    return this
  }

  /** Override guidelines (replaces role defaults) */
  withGuidelines(...guidelines: string[]): this {
    this.options.guidelines = guidelines
    return this
  }

  /** Add guidelines (extends role defaults) */
  addGuidelines(...guidelines: string[]): this {
    this.options.additionalGuidelines = [
      ...(this.options.additionalGuidelines || []),
      ...guidelines,
    ]
    return this
  }

  /** Set custom preamble */
  withPreamble(preamble: string): this {
    this.options.preamble = preamble
    return this
  }

  /** Build the final persona */
  build(): AgentPersona {
    const roleDefinition = ROLE_DEFINITIONS[this.options.role]
    const allTraits = [
      ...roleDefinition.traits,
      ...(this.options.additionalTraits || []),
    ]

    // Build capabilities list
    const capabilities = this.options.capabilities || [
      ...roleDefinition.capabilities,
      ...getTraitCapabilities(this.options.additionalTraits || []),
      ...(this.options.additionalCapabilities || []),
    ]

    // Build guidelines list
    const guidelines = this.options.guidelines || [
      ...roleDefinition.guidelines,
      ...getTraitGuidelines(this.options.additionalTraits || []),
      ...(this.options.additionalGuidelines || []),
    ]

    // Build instructions
    const instructions = buildInstructions(
      this.options.name,
      roleDefinition.title,
      this.options.preamble,
      capabilities,
      guidelines
    )

    return {
      name: this.options.name,
      role: this.options.role,
      description: this.options.description,
      instructions,
    }
  }
}

/**
 * Create a persona builder
 */
export function persona(name: string, role: AgentRole): PersonaBuilder {
  return new PersonaBuilder(name, role)
}

// ============================================================================
// Pre-built Persona Definitions
// ============================================================================

/**
 * Priya - Product Manager persona
 */
export const priyaPersona: AgentPersona = persona('Priya', 'product')
  .withDescription('Product manager - specs, roadmaps, MVP definition')
  .withPreamble('Your role is to define products, create specifications, and plan roadmaps.')
  .build()

/**
 * Ralph - Engineering Lead persona
 */
export const ralphPersona: AgentPersona = persona('Ralph', 'engineering')
  .withDescription('Engineering lead - builds code, implements features')
  .withPreamble('Your role is to build, implement, and improve code based on specifications.')
  .build()

/**
 * Tom - Tech Lead persona
 */
export const tomPersona: AgentPersona = persona('Tom', 'tech-lead')
  .withDescription('Tech Lead - architecture, code review, technical decisions')
  .withPreamble('Your role is to review code, make architectural decisions, and ensure quality.')
  .build()

/**
 * Mark - Marketing Lead persona
 */
export const markPersona: AgentPersona = persona('Mark', 'marketing')
  .withDescription('Marketing lead - content, launches, announcements')
  .withPreamble('Your role is to create content, plan launches, and communicate value.')
  .build()

/**
 * Sally - Sales Lead persona
 */
export const sallyPersona: AgentPersona = persona('Sally', 'sales')
  .withDescription('Sales lead - outreach, pitches, closing deals')
  .withPreamble('Your role is to identify opportunities, pitch solutions, and close deals.')
  .build()

/**
 * Quinn - QA Lead persona
 */
export const quinnPersona: AgentPersona = persona('Quinn', 'qa')
  .withDescription('QA lead - testing, quality assurance, bug finding')
  .withPreamble('Your role is to ensure quality, find bugs, and validate features.')
  .build()

/**
 * Rae - Frontend Engineer persona
 */
export const raePersona: AgentPersona = persona('Rae', 'frontend')
  .withDescription('Frontend engineer - React, components, design systems')
  .withPreamble('Your role is to build beautiful, accessible, and performant user interfaces with React and modern frontend technologies.')
  .build()

/**
 * Pre-built personas for named agents
 * Backwards compatible with original PERSONAS export
 */
export const PERSONA_DEFINITIONS: Record<string, AgentPersona> = {
  priya: priyaPersona,
  ralph: ralphPersona,
  tom: tomPersona,
  mark: markPersona,
  sally: sallyPersona,
  quinn: quinnPersona,
  rae: raePersona,
}
