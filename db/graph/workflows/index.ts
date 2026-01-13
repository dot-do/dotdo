/**
 * Workflow Graph Module
 *
 * Workflows as Things in the Graph model with state tracking via verb forms.
 *
 * Key concepts:
 * 1. **Workflow Templates**: Define workflow structure as a Thing
 * 2. **Workflow Instances**: Running instances with state
 * 3. **Verb Forms**: Use verb conjugations for state (started, running, completed, failed)
 * 4. **Step Relationships**: CONTAINS, FOLLOWS, BRANCHES_TO
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @module db/graph/workflows
 */

// Types and constants
export {
  // Type constants
  WORKFLOW_TEMPLATE_TYPE_ID,
  WORKFLOW_TEMPLATE_TYPE_NAME,
  WORKFLOW_INSTANCE_TYPE_ID,
  WORKFLOW_INSTANCE_TYPE_NAME,
  WORKFLOW_STEP_TYPE_ID,
  WORKFLOW_STEP_TYPE_NAME,
  STEP_RESULT_TYPE_ID,
  STEP_RESULT_TYPE_NAME,
  // Relationship verbs
  WORKFLOW_VERBS,
  // Template types
  type WorkflowStepType,
  type WorkflowStepData,
  type WorkflowTriggerData,
  type WorkflowTemplateData,
  type WorkflowTemplateThing,
  type WorkflowStepThing,
  // Instance types
  type InstanceState,
  type WorkflowInstanceData,
  type WorkflowInstanceThing,
  // Step execution types
  type StepExecutionState,
  type StepExecutionData,
  type StepExecutionRelationship,
  type StepResultData,
  type StepResultThing,
  // Input types
  type CreateWorkflowTemplateInput,
  type CreateWorkflowStepInput,
  type CreateWorkflowInstanceInput,
  type CreateStepExecutionInput,
  type CompleteStepExecutionInput,
  type FailStepExecutionInput,
  // Query options
  type QueryWorkflowTemplatesOptions,
  type QueryWorkflowInstancesOptions,
  type QueryStepExecutionsOptions,
} from './types'

// Template operations
export {
  // Template CRUD
  createWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplates,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
  // Step CRUD
  createWorkflowStep,
  getWorkflowStep,
  getTemplateSteps,
  // Step relationships
  createStepFollowsRelationship,
  createStepBranchRelationship,
  getFollowingSteps,
  getBranchTargets,
  // Builder
  WorkflowTemplateBuilder,
  createWorkflowTemplateBuilder,
} from './workflow-template'

// Instance operations
export {
  // Instance CRUD
  createWorkflowInstance,
  getWorkflowInstance,
  getWorkflowInstanceState,
  queryWorkflowInstances,
  queryInstancesByState,
  // State transitions
  startWorkflowInstance,
  completeWorkflowInstance,
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  failWorkflowInstance,
  cancelWorkflowInstance,
  // Step tracking
  updateInstanceCurrentStep,
  // State mapping
  verbFormToInstanceState,
  instanceStateToVerbForms,
  // Relationship queries
  getInstanceTemplateId,
  getTemplateInstances,
  recordInstanceTrigger,
  getInstanceTrigger,
} from './workflow-instance'

// Step execution operations
export {
  // Store class
  StepExecutionStore,
  createStepExecutionStore,
  // State mapping
  verbFormToStepState,
  stepStateToVerbForms,
} from './step-execution'

// WorkflowCore bridge
export {
  GraphWorkflowRuntime,
  createGraphWorkflowRuntime,
  type GraphStepResult,
  type GraphCheckpointState,
  type GraphStepExecutionOptions,
} from './workflow-core-bridge'
