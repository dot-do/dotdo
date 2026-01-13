/**
 * Workflows Graph Module
 *
 * Provides graph-based workflow primitives using the DO Graph data model.
 *
 * @module workflows/graph
 */

// WorkflowInstance Thing with verb form state
export {
  createInstance,
  getInstance,
  getInstanceState,
  startInstance,
  completeInstance,
  pauseInstance,
  resumeInstance,
  failInstance,
  queryInstancesByState,
  type WorkflowInstanceThing,
  type WorkflowInstanceData,
  type CreateInstanceInput,
  type QueryInstanceOptions,
  type InstanceState,
} from './instance-thing'
