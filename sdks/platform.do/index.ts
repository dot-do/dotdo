/**
 * platform.do - Platform SDK with typed $ context
 *
 * This package provides a typed $ proxy for accessing platform services:
 * - $.Functions - Serverless function management
 * - $.Workflows - Durable workflow execution
 * - $.Agents - AI agent invocation
 * - $.Database - SQL database operations
 *
 * It also re-exports all functionality from sdk.do for convenience.
 *
 * @module platform.do
 *
 * @example
 * ```typescript
 * import { $, createClient } from 'platform.do'
 *
 * // Access platform services via typed $
 * const fn = await $.Functions.create({ name: 'hello' })
 * const result = await $.Functions.invoke('hello', { name: 'World' })
 *
 * // Or create your own client
 * const client = createClient({ url: 'https://custom.api.do' })
 * ```
 */

// Re-export everything from sdk.do
export * from 'sdk.do'

// Export platform-specific types
export type {
  PlatformContext,
  FunctionsService,
  WorkflowsService,
  AgentsService,
  DatabaseService,
  FunctionDef,
  Function,
  WorkflowDef,
  WorkflowStep,
  Workflow,
  WorkflowRun,
  AgentDef,
  Agent,
  QueryResult,
  ExecuteResult,
} from './types'

import { createClient } from 'sdk.do'
import type { PlatformContext, FunctionsService, WorkflowsService, AgentsService, DatabaseService } from './types'

/**
 * Default platform API URL
 */
const PLATFORM_API_URL = 'https://apis.do'

/**
 * Platform service keys that should be enumerable
 */
const PLATFORM_SERVICES = ['Functions', 'Workflows', 'Agents', 'Database'] as const

/**
 * Create a typed platform context proxy
 *
 * The proxy provides typed access to platform services while maintaining
 * compatibility with the underlying RPC client from sdk.do.
 *
 * @param baseUrl - Base URL for the platform API (default: https://apis.do)
 * @returns Typed PlatformContext proxy
 */
function createPlatformContext(baseUrl: string = PLATFORM_API_URL): PlatformContext {
  // Create the underlying RPC client
  const client = createClient({ url: baseUrl })

  // Create service proxies that delegate to the client
  // Each service is a nested proxy on the client
  const services: Record<string, unknown> = {}

  for (const serviceName of PLATFORM_SERVICES) {
    services[serviceName] = (client as Record<string, unknown>)[serviceName]
  }

  // Create a proxy that exposes services as enumerable properties
  // The services are dynamically created proxies from createClient,
  // so we need to cast through unknown for TypeScript
  return new Proxy(services as unknown as PlatformContext, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return target[prop as keyof PlatformContext]
      }
      // Fall through to underlying client for other properties
      return (client as Record<string, unknown>)[prop as string]
    },

    // Make platform services enumerable
    ownKeys() {
      return [...PLATFORM_SERVICES]
    },

    // Required for ownKeys to work correctly
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && PLATFORM_SERVICES.includes(prop as typeof PLATFORM_SERVICES[number])) {
        return {
          configurable: true,
          enumerable: true,
          value: target[prop as keyof PlatformContext],
        }
      }
      return undefined
    },
  })
}

/**
 * The typed $ platform context for accessing platform services.
 *
 * @example
 * ```typescript
 * import { $ } from 'platform.do'
 *
 * // Functions
 * const fn = await $.Functions.create({ name: 'hello', code: '...' })
 * const result = await $.Functions.invoke('hello', { name: 'World' })
 *
 * // Workflows
 * const wf = await $.Workflows.create({ name: 'onboarding' })
 * const run = await $.Workflows.run('onboarding', { userId: '123' })
 *
 * // Agents
 * const agent = await $.Agents.create({ name: 'assistant' })
 * const response = await $.Agents.invoke('assistant', 'Hello!')
 *
 * // Database
 * const { rows } = await $.Database.query('SELECT * FROM users')
 * ```
 */
export const $: PlatformContext = createPlatformContext()
