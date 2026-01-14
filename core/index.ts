// @dotdo/core - Foundational DO runtime

// Re-export types from @org.ai/types
export type {
  WorkflowContextType,
  RelationshipOperatorType,
  ParsedFieldType,
  AIFunctionType,
  EventHandlerType,
} from '@org.ai/types'

// Core DO class with schema extension
export { DOCore, DOEnv } from './DO'
export type { DOEnv as DOCoreEnv } from './DO'
export { default as DO } from './DO'

// Schema extension API
export { DB, extendSchema } from './DB'

// WorkflowContext factory
export { createWorkflowContext } from './context'
