/**
 * Role Definition Factory
 *
 * Creates callable roles that can be invoked via template literals.
 * Roles represent job functions with specific OKRs and capabilities.
 *
 * @see dotdo-89132 - TDD: Role types and defineRole()
 * @module roles/define
 */

import type { Role, RoleConfig, PipelinePromise } from './types'

// Re-export types for convenient imports
export type { Role, RoleConfig, PipelinePromise } from './types'

/**
 * Mock mode flag for testing without API calls
 */
let mockMode = true // Default to mock mode for roles

/**
 * Enable mock mode for testing
 */
export function enableMockMode(): void {
  mockMode = true
}

/**
 * Disable mock mode
 */
export function disableMockMode(): void {
  mockMode = false
}

/**
 * Check if argument is a template literal strings array
 */
function isTemplateStringsArray(arg: unknown): arg is TemplateStringsArray {
  return Array.isArray(arg) && 'raw' in arg
}

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
 * Execute role invocation
 *
 * In mock mode, returns a placeholder response.
 * In real mode, would route to the appropriate agent implementation.
 */
async function executeRole(config: RoleConfig, prompt: string): Promise<string> {
  if (mockMode) {
    // In mock mode, return a placeholder response
    return `[${config.name}] ${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}`
  }

  // Real implementation would:
  // 1. Find the default agent for this role
  // 2. Route the prompt to that agent
  // 3. Return the agent's response
  //
  // For now, throw if not in mock mode (implementation deferred to agent integration)
  throw new Error(
    `Role "${config.name}" invocation requires an agent implementation. ` +
    `Use enableMockMode() for testing, or bind an agent to this role.`
  )
}

/**
 * Define a role with OKRs and capabilities
 *
 * Creates a callable Role that can be invoked via template literals:
 *
 * @example
 * ```typescript
 * const product = defineRole({
 *   name: 'product',
 *   okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
 *   capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
 * })
 *
 * // Usage
 * await product`plan the roadmap`
 * await product`plan ${feature} for Q1`
 * ```
 *
 * @param config - Role configuration with name, okrs, and capabilities
 * @returns A callable Role with readonly properties
 */
export function defineRole(config: RoleConfig): Role {
  // Validate config
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Role name is required and must be a string')
  }

  if (!Array.isArray(config.okrs)) {
    throw new Error('Role okrs must be an array')
  }

  if (!Array.isArray(config.capabilities)) {
    throw new Error('Role capabilities must be an array')
  }

  // Create the callable function (handles both template literal and function call)
  const role = function (
    stringsOrInput: TemplateStringsArray | string | object,
    ...values: unknown[]
  ): PipelinePromise<string> {
    let prompt: string

    if (isTemplateStringsArray(stringsOrInput)) {
      // Template literal: product`plan the roadmap`
      prompt = interpolate(stringsOrInput, values)
    } else if (typeof stringsOrInput === 'string') {
      // Direct string: product('plan the roadmap')
      prompt = stringsOrInput
    } else {
      // Object: product({ task: 'plan', context: { ... } })
      prompt = JSON.stringify(stringsOrInput, null, 2)
    }

    return createPipelinePromise(executeRole(config, prompt))
  } as Role

  // Add readonly properties
  Object.defineProperty(role, 'name', {
    value: config.name,
    writable: false,
    enumerable: true,
    configurable: false,
  })

  Object.defineProperty(role, 'okrs', {
    value: Object.freeze([...config.okrs]),
    writable: false,
    enumerable: true,
    configurable: false,
  })

  Object.defineProperty(role, 'capabilities', {
    value: Object.freeze([...config.capabilities]),
    writable: false,
    enumerable: true,
    configurable: false,
  })

  return role
}
