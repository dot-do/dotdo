/**
 * Test Response Generator for Named Agents
 *
 * Provides simulated AI responses for testing without real API calls.
 * These responses are used when:
 * - A test API key is configured (contains 'test' in the key)
 * - Testing agent functionality without incurring API costs
 *
 * @module agents/named/test-responses
 */

import type { AgentPersona, AgentRole } from './factory'

// ============================================================================
// Types
// ============================================================================

/**
 * Conversation message in the context history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Test response template function signature
 */
export type ResponseGenerator = (
  persona: AgentPersona,
  prompt: string,
  context: ConversationMessage[]
) => string | null

// ============================================================================
// Response Templates
// ============================================================================

/**
 * MVP definition response template for product agents
 */
export const MVP_DEFINITION_RESPONSE = `# MVP Definition for Todo App

## Core Features (Must-Have for MVP)

1. **User Authentication**
   - Simple sign up / login flow
   - Session management

2. **Task Management**
   - Create new tasks with title and description
   - Mark tasks as complete/incomplete
   - Delete tasks
   - List all tasks with filtering (completed/pending)

3. **Basic Organization**
   - Due dates for tasks
   - Priority levels (high/medium/low)

## User Stories

- As a user, I want to create tasks so I can track my to-dos
- As a user, I want to mark tasks complete so I can see my progress
- As a user, I want to set priorities so I can focus on important items

## Success Metrics
- Users can create and complete tasks within 2 clicks
- Page load time under 2 seconds
- Mobile-responsive design

This MVP focuses on core task management functionality, deferring advanced features like collaboration, tags, and integrations to future iterations.`

/**
 * React component response template for frontend agents
 */
export const REACT_COMPONENT_RESPONSE = `Here's a React component in TypeScript:

\`\`\`tsx
import React from 'react'

interface ButtonProps {
  /** Button text content */
  children: React.ReactNode
  /** Click handler */
  onClick?: () => void
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'outline'
  /** Disabled state */
  disabled?: boolean
}

/**
 * A reusable button component with multiple variants.
 */
export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  const baseStyles = 'px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'

  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
    outline: 'border-2 border-gray-300 text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={\`\${baseStyles} \${variantStyles[variant]} \${disabled ? 'opacity-50 cursor-not-allowed' : ''}\`}
    >
      {children}
    </button>
  )
}
\`\`\`

This component follows React best practices with:
- TypeScript interfaces for type-safe props
- Tailwind CSS for styling
- Accessibility considerations (focus states, disabled handling)
- Composable design with variants`

/**
 * Hello world code response template for engineering agents
 */
export const HELLO_WORLD_RESPONSE = `Here's a simple hello world function in TypeScript:

\`\`\`typescript
export function helloWorld(): string {
  return 'Hello, World!'
}

// Usage example
console.log(helloWorld()) // Output: Hello, World!
\`\`\`

This function follows TypeScript best practices with explicit return type annotation. You can extend it to accept parameters:

\`\`\`typescript
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\``

// ============================================================================
// Context-Aware Response Handlers
// ============================================================================

/**
 * Search conversation context for app name mentions
 *
 * @param context - Conversation history
 * @returns The app name if found, null otherwise
 */
function findAppNameInContext(context: ConversationMessage[]): string | null {
  for (const msg of context) {
    if (msg.role === 'user') {
      const appNameMatch =
        msg.content.match(/app\s+called\s+(\w+)/i) ||
        msg.content.match(/building\s+(?:an?\s+)?(\w+)\s+(?:app|project)/i) ||
        msg.content.match(/called\s+(\w+)/i)
      if (appNameMatch) {
        return appNameMatch[1]
      }
    }
  }
  return null
}

/**
 * Handle context-dependent questions (conversation memory)
 *
 * @param prompt - User's current prompt
 * @param context - Conversation history
 * @returns Response string if this is a context question, null otherwise
 */
export function handleContextQuestion(
  prompt: string,
  context: ConversationMessage[]
): string | null {
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('what is my app called') || promptLower.includes('what did i name')) {
    const appName = findAppNameInContext(context)
    if (appName) {
      return `Based on our conversation, your app is called ${appName}. This is the project management application you mentioned you're building.`
    }
    return "I don't recall you mentioning a specific app name in our conversation. Could you remind me what you're building?"
  }

  return null
}

// ============================================================================
// Role-Based Response Generators
// ============================================================================

/**
 * Generate response for product role (Priya)
 *
 * @param prompt - User's prompt
 * @returns Response string if matched, null otherwise
 */
export function generateProductResponse(prompt: string): string | null {
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('mvp') || promptLower.includes('feature') || promptLower.includes('define')) {
    return MVP_DEFINITION_RESPONSE
  }

  if (promptLower.includes('taskmaster') || promptLower.includes('project management')) {
    return "I understand you're building TaskMaster, a project management application. Let me know what specific aspects of the product you'd like to define or discuss."
  }

  return null
}

/**
 * Generate response for engineering role (Ralph)
 *
 * @param prompt - User's prompt
 * @returns Response string if matched, null otherwise
 */
export function generateEngineeringResponse(prompt: string): string | null {
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('hello world') || promptLower.includes('function')) {
    return HELLO_WORLD_RESPONSE
  }

  return null
}

/**
 * Generate response for tech-lead role (Tom)
 *
 * @param prompt - User's prompt
 * @returns Response string if matched, null otherwise
 */
export function generateTechLeadResponse(prompt: string): string | null {
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('review') || promptLower.includes('approve')) {
    const approved = !promptLower.includes('bug') && !promptLower.includes('error')
    return approved
      ? 'Code review completed. The implementation looks clean and follows best practices. APPROVED.'
      : 'Code review completed. Found some issues that need to be addressed. REJECTED.'
  }

  return null
}

/**
 * Generate response for frontend role (Rae)
 *
 * @param prompt - User's prompt
 * @returns Response string if matched, null otherwise
 */
export function generateFrontendResponse(prompt: string): string | null {
  const promptLower = prompt.toLowerCase()

  if (
    promptLower.includes('component') ||
    promptLower.includes('button') ||
    promptLower.includes('form') ||
    promptLower.includes('react')
  ) {
    return REACT_COMPONENT_RESPONSE
  }

  return null
}

/**
 * Map of role-specific response generators
 */
const ROLE_RESPONSE_GENERATORS: Record<AgentRole, ResponseGenerator | null> = {
  product: (_, prompt) => generateProductResponse(prompt),
  engineering: (_, prompt) => generateEngineeringResponse(prompt),
  'tech-lead': (_, prompt) => generateTechLeadResponse(prompt),
  frontend: (_, prompt) => generateFrontendResponse(prompt),
  marketing: null,
  sales: null,
  qa: null,
}

// ============================================================================
// Default Response Generator
// ============================================================================

/**
 * Generate a default intelligent response based on persona
 *
 * @param persona - Agent persona
 * @param prompt - User's prompt
 * @returns Default response string
 */
export function generateDefaultResponse(persona: AgentPersona, prompt: string): string {
  const truncatedPrompt = prompt.slice(0, 100) + (prompt.length > 100 ? '...' : '')

  return `As ${persona.name} (${persona.description}), I've analyzed your request: "${truncatedPrompt}"

Based on my expertise in ${persona.role}, here are my thoughts:

This is a comprehensive response that demonstrates the agent's capability to process and respond to user queries. The implementation leverages the persona's specific knowledge and expertise to provide relevant insights.

Key considerations:
- Understanding the user's requirements
- Applying domain-specific knowledge
- Providing actionable recommendations
- Maintaining conversation context for follow-up questions`
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Generate simulated AI response for testing
 *
 * This provides realistic responses when using test API keys,
 * enabling comprehensive testing without incurring API costs.
 *
 * Response resolution order:
 * 1. Context-dependent questions (conversation memory)
 * 2. Role-specific response generators
 * 3. Default intelligent response
 *
 * @param persona - The agent's persona configuration
 * @param prompt - The user's prompt/question
 * @param context - Conversation history for context awareness
 * @returns Simulated response string
 *
 * @example
 * ```typescript
 * const response = generateTestResponse(
 *   PERSONAS.priya,
 *   'define the MVP for a todo app',
 *   []
 * )
 * // Returns detailed MVP definition
 * ```
 */
export function generateTestResponse(
  persona: AgentPersona,
  prompt: string,
  context: ConversationMessage[]
): string {
  // 1. Check for context-dependent questions (conversation memory)
  const contextResponse = handleContextQuestion(prompt, context)
  if (contextResponse) {
    return contextResponse
  }

  // 2. Try role-specific response generator
  const roleGenerator = ROLE_RESPONSE_GENERATORS[persona.role]
  if (roleGenerator) {
    const roleResponse = roleGenerator(persona, prompt, context)
    if (roleResponse) {
      return roleResponse
    }
  }

  // 3. Fall back to default intelligent response
  return generateDefaultResponse(persona, prompt)
}
