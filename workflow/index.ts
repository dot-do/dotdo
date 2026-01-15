/**
 * Workflow Layer Exports
 *
 * This module exports the DOWorkflow class and related types.
 * DOWorkflow extends DOStorage with WorkflowContext ($).
 *
 * @module workflow
 */

// Export DOWorkflow class and types
export { DOWorkflowClass, DOWorkflowClass as DOWorkflow, type DOWorkflowEnv } from './DOWorkflow'

// Export WorkflowContext types
export {
  createWorkflowContext,
  type WorkflowContext,
  type CreateContextOptions,
  type Event,
  type CascadeOptions,
  type CascadeResult,
} from './workflow-context'
