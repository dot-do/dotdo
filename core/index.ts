/**
 * Core exports for dotdo DO hierarchy
 *
 * Class Hierarchy:
 * DOCore      (~5KB)   State, alarms, routing
 * DOSemantic  (~20KB)  Nouns, Verbs, Things, Actions, operators
 * DOStorage   (~40KB)  InMemory + Pipeline + SQLite + Iceberg
 * DOWorkflow  (~60KB)  WorkflowContext ($), cascade, scheduling
 * DOFull      (~80KB)  AI, human-in-loop, fanout, streaming
 */

// Export all DO classes
export { DOCore, type DOCoreEnv } from './DOCore'
export { DOSemantic, type DOSemanticEnv, type Noun, type Verb, type Thing, type ActionResult } from '../semantic/DOSemantic'
export { DOStorageClass, DOStorage, type DOStorageEnv } from '../storage/DOStorage'
export { DOWorkflowClass, DOWorkflow, type DOWorkflowEnv } from '../workflow/DOWorkflow'
export { DOFull, type DOFullEnv } from '../objects/DOFull'

// Re-export storage layer components
export {
  InMemoryStateManager,
  type ThingData,
  type CreateThingInput,
  type InMemoryStateManagerOptions,
  type StateManagerStats,
} from '../storage/in-memory-state-manager'

// Re-export workflow context
export {
  createWorkflowContext,
  type WorkflowContext,
  type CreateContextOptions,
  type Event,
  type CascadeOptions,
  type CascadeResult,
} from '../workflow/workflow-context'

// Default worker handler
import { DOCore, type DOCoreEnv } from './DOCore'
import { DOSemantic } from '../semantic/DOSemantic'
import { DOStorageClass } from '../storage/DOStorage'
import { DOWorkflowClass } from '../workflow/DOWorkflow'
import { DOFull } from '../objects/DOFull'

// Full environment type with all DO classes
export interface Env {
  DOCore: DurableObjectNamespace<DOCore>
  DOSemantic: DurableObjectNamespace<DOSemantic>
  DOStorage: DurableObjectNamespace<DOStorageClass>
  DOWorkflow: DurableObjectNamespace<DOWorkflowClass>
  DOFull: DurableObjectNamespace<DOFull>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    // Default to DOFull for the main worker
    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}
