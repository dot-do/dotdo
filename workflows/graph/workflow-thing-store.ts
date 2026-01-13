/**
 * WorkflowThingStore - Specialized store for Workflow Things
 *
 * Provides a high-level API for workflow-specific operations built on top
 * of the SQLiteGraphStore. Includes validation, querying by name/trigger type,
 * cloning, and version management.
 *
 * @see dotdo-1oy0j - [GREEN] Workflow definition as Thing - schema tests
 *
 * @example
 * ```typescript
 * import { WorkflowThingStore } from './workflow-thing-store'
 * import { SQLiteGraphStore } from 'db/graph'
 *
 * const graphStore = new SQLiteGraphStore(':memory:')
 * await graphStore.initialize()
 *
 * const workflowStore = new WorkflowThingStore(graphStore)
 *
 * // Create a workflow with validation
 * const workflow = await workflowStore.create({
 *   id: 'workflow:my-workflow',
 *   name: 'my-workflow',
 *   steps: [{ name: 'step1', type: 'do' }],
 * })
 *
 * // Find by name
 * const found = await workflowStore.getByName('my-workflow')
 *
 * // List workflows with cron triggers
 * const cronWorkflows = await workflowStore.listByTriggerType('cron')
 * ```
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../../db/graph/types'
import { randomUUID } from 'crypto'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Workflow Things (rowid=100) */
export const WORKFLOW_TYPE_ID = 100

/** Type name for Workflow Things */
export const WORKFLOW_TYPE_NAME = 'Workflow'

/** Valid step types */
export const VALID_STEP_TYPES = ['do', 'sleep', 'waitForEvent'] as const

/** Valid trigger types */
export const VALID_TRIGGER_TYPES = ['event', 'cron', 'webhook', 'manual'] as const

/** Verb for linking workflow steps to functions */
export const VERB_USES_FUNCTION = 'usesFunction'

/** Verb for linking workflows to triggers */
export const VERB_TRIGGERED_BY = 'triggeredBy'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Workflow step definition.
 */
export interface WorkflowStep {
  /** Step name/identifier (required) */
  name: string
  /** Step type: 'do' (durable action), 'sleep', 'waitForEvent' */
  type: 'do' | 'sleep' | 'waitForEvent'
  /** Timeout in milliseconds */
  timeout?: number
  /** Number of retry attempts */
  retries?: number
  /** Sleep duration for 'sleep' type */
  duration?: number
  /** Event name for 'waitForEvent' type */
  event?: string
  /** Handler function or reference */
  handler?: string
}

/**
 * Workflow trigger definition.
 */
export interface WorkflowTrigger {
  /** Trigger type */
  type: 'event' | 'cron' | 'webhook' | 'manual'
  /** Trigger configuration */
  config: Record<string, unknown>
}

/**
 * Workflow configuration data stored in the Thing's data field.
 */
export interface WorkflowConfigData {
  /** Workflow name (required) */
  name: string
  /** Human-readable description */
  description?: string
  /** Semantic version string */
  version?: string
  /** Workflow step definitions */
  steps?: WorkflowStep[]
  /** Trigger definitions */
  triggers?: WorkflowTrigger[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a new Workflow via WorkflowThingStore.
 */
export interface CreateWorkflowInput extends WorkflowConfigData {
  /** Unique identifier, should start with 'workflow:' */
  id: string
}

/**
 * Validation result from WorkflowThingStore.validate().
 */
export interface ValidationResult {
  /** Whether the workflow config is valid */
  valid: boolean
  /** Array of validation error messages */
  errors: string[]
}

/**
 * Semver bump type for bumpVersion().
 */
export type VersionBumpType = 'major' | 'minor' | 'patch'

/**
 * Workflow relationship with to and verb fields.
 */
export interface WorkflowRelationship {
  /** Relationship ID */
  id: string
  /** The verb/predicate */
  verb: string
  /** Source Thing ID (workflow ID) */
  from: string
  /** Target Thing ID (function/trigger ID) */
  to: string
  /** Additional relationship data (e.g., stepName) */
  data?: Record<string, unknown> | null
}

// ============================================================================
// WorkflowThingStore CLASS
// ============================================================================

/**
 * Specialized store for Workflow Things.
 *
 * Wraps a GraphStore and provides workflow-specific operations:
 * - Validation of workflow structure
 * - Querying by name or trigger type
 * - Cloning workflows
 * - Version bumping
 */
export class WorkflowThingStore {
  constructor(private readonly graphStore: GraphStore) {}

  // =========================================================================
  // CRUD OPERATIONS
  // =========================================================================

  /**
   * Create a new Workflow Thing with validation.
   *
   * @param input - Workflow data including id and name
   * @returns The created GraphThing
   * @throws Error if validation fails
   */
  async create(input: CreateWorkflowInput): Promise<GraphThing> {
    // Validate the input
    const validation = await this.validate(input)
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '))
    }

    // Extract id and create data object
    const { id, ...workflowData } = input

    return this.graphStore.createThing({
      id,
      typeId: WORKFLOW_TYPE_ID,
      typeName: WORKFLOW_TYPE_NAME,
      data: workflowData,
    })
  }

  /**
   * Get a Workflow Thing by its ID.
   *
   * @param id - The workflow ID
   * @returns The GraphThing or null if not found
   */
  async get(id: string): Promise<GraphThing | null> {
    const thing = await this.graphStore.getThing(id)
    if (!thing || thing.typeId !== WORKFLOW_TYPE_ID) {
      return null
    }
    return thing
  }

  /**
   * List all Workflow Things.
   *
   * @param options - Query options (limit, offset, includeDeleted)
   * @returns Array of GraphThings
   */
  async list(options?: {
    limit?: number
    offset?: number
    includeDeleted?: boolean
  }): Promise<GraphThing[]> {
    return this.graphStore.getThingsByType({
      typeId: WORKFLOW_TYPE_ID,
      limit: options?.limit,
      offset: options?.offset,
      includeDeleted: options?.includeDeleted,
    })
  }

  // =========================================================================
  // QUERY OPERATIONS
  // =========================================================================

  /**
   * Find a workflow by its name field.
   *
   * @param name - The workflow name to search for
   * @returns The GraphThing or null if not found
   */
  async getByName(name: string): Promise<GraphThing | null> {
    const workflows = await this.graphStore.getThingsByType({
      typeId: WORKFLOW_TYPE_ID,
      includeDeleted: false,
    })

    return workflows.find((w) => {
      const data = w.data as WorkflowConfigData | null
      return data?.name === name
    }) ?? null
  }

  /**
   * List workflows that have a specific trigger type.
   *
   * @param triggerType - The trigger type to filter by ('event', 'cron', 'webhook', 'manual')
   * @returns Array of GraphThings with the specified trigger type
   */
  async listByTriggerType(
    triggerType: 'event' | 'cron' | 'webhook' | 'manual'
  ): Promise<GraphThing[]> {
    const workflows = await this.graphStore.getThingsByType({
      typeId: WORKFLOW_TYPE_ID,
      includeDeleted: false,
    })

    return workflows.filter((w) => {
      const data = w.data as WorkflowConfigData | null
      if (!data?.triggers || !Array.isArray(data.triggers)) {
        return false
      }
      return data.triggers.some((t) => t.type === triggerType)
    })
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Validate a workflow configuration.
   *
   * @param config - The workflow config to validate (can be partial for create input)
   * @returns ValidationResult with valid flag and error messages
   */
  async validate(
    config: Partial<WorkflowConfigData> & { id?: string }
  ): Promise<ValidationResult> {
    const errors: string[] = []

    // Validate name (required)
    if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
      errors.push('Workflow name is required')
    }

    // Validate steps array if provided
    if (config.steps !== undefined) {
      if (!Array.isArray(config.steps)) {
        errors.push('Steps must be an array')
      } else {
        config.steps.forEach((step, index) => {
          // Validate step name
          if (!step.name || typeof step.name !== 'string' || step.name.trim() === '') {
            errors.push(`Step ${index}: name is required`)
          }

          // Validate step type
          if (!step.type) {
            errors.push(`Step ${index}: type is required`)
          } else if (!VALID_STEP_TYPES.includes(step.type as typeof VALID_STEP_TYPES[number])) {
            errors.push(
              `Step ${index}: type must be one of: ${VALID_STEP_TYPES.join(', ')}`
            )
          }
        })
      }
    }

    // Validate triggers array if provided
    if (config.triggers !== undefined) {
      if (!Array.isArray(config.triggers)) {
        errors.push('Triggers must be an array')
      } else {
        config.triggers.forEach((trigger, index) => {
          // Validate trigger type
          if (!trigger.type) {
            errors.push(`Trigger ${index}: type is required`)
          } else if (!VALID_TRIGGER_TYPES.includes(trigger.type as typeof VALID_TRIGGER_TYPES[number])) {
            errors.push(
              `Trigger ${index}: type must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`
            )
          }

          // Validate trigger config
          if (trigger.config === undefined || trigger.config === null) {
            errors.push(`Trigger ${index}: config is required`)
          }
        })
      }
    }

    // Validate version format if provided
    if (config.version !== undefined && config.version !== null) {
      if (typeof config.version !== 'string') {
        errors.push('Version must be a string')
      } else if (!/^\d+\.\d+\.\d+$/.test(config.version)) {
        // Allow non-semver versions but warn-free for now
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  // =========================================================================
  // WORKFLOW OPERATIONS
  // =========================================================================

  /**
   * Clone a workflow to a new ID.
   *
   * @param sourceId - The ID of the workflow to clone
   * @param targetId - The ID for the cloned workflow
   * @returns The cloned GraphThing
   * @throws Error if source workflow not found
   */
  async clone(sourceId: string, targetId: string): Promise<GraphThing> {
    const source = await this.get(sourceId)
    if (!source) {
      throw new Error(`Workflow not found: ${sourceId}`)
    }

    const sourceData = source.data as WorkflowConfigData | null

    return this.graphStore.createThing({
      id: targetId,
      typeId: WORKFLOW_TYPE_ID,
      typeName: WORKFLOW_TYPE_NAME,
      data: sourceData ? { ...sourceData } : null,
    })
  }

  /**
   * Bump the version of a workflow.
   *
   * @param id - The workflow ID
   * @param bumpType - The type of version bump ('major', 'minor', 'patch')
   * @returns The updated GraphThing
   * @throws Error if workflow not found or has no version
   */
  async bumpVersion(id: string, bumpType: VersionBumpType): Promise<GraphThing> {
    const workflow = await this.get(id)
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`)
    }

    const data = workflow.data as WorkflowConfigData | null
    const currentVersion = data?.version ?? '0.0.0'

    // Parse version
    const parts = currentVersion.split('.').map(Number)
    let [major, minor, patch] = parts.length >= 3 ? parts : [0, 0, 0]

    // Bump based on type
    switch (bumpType) {
      case 'major':
        major = (major ?? 0) + 1
        minor = 0
        patch = 0
        break
      case 'minor':
        minor = (minor ?? 0) + 1
        patch = 0
        break
      case 'patch':
        patch = (patch ?? 0) + 1
        break
    }

    const newVersion = `${major}.${minor}.${patch}`

    // Update the workflow
    const updated = await this.graphStore.updateThing(id, {
      data: {
        ...data,
        version: newVersion,
      },
    })

    if (!updated) {
      throw new Error(`Failed to update workflow: ${id}`)
    }

    return updated
  }

  // =========================================================================
  // RELATIONSHIP OPERATIONS - Functions
  // =========================================================================

  /**
   * Link a workflow step to a Function Thing.
   *
   * Creates a relationship with verb 'usesFunction' from the workflow
   * to the function, with stepName stored in the relationship data.
   *
   * @param workflowId - The workflow Thing ID
   * @param stepName - The name of the step that uses the function
   * @param functionId - The Function Thing ID
   * @returns The created relationship
   */
  async linkFunction(
    workflowId: string,
    stepName: string,
    functionId: string
  ): Promise<GraphRelationship> {
    // Verify workflow exists
    const workflow = await this.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Create the relationship
    const relationshipId = `rel:${randomUUID()}`
    return this.graphStore.createRelationship({
      id: relationshipId,
      verb: VERB_USES_FUNCTION,
      from: workflowId,
      to: functionId,
      data: { stepName },
    })
  }

  /**
   * Get all Function Things linked to a workflow.
   *
   * @param workflowId - The workflow Thing ID
   * @returns Array of linked Function Things
   */
  async getLinkedFunctions(workflowId: string): Promise<GraphThing[]> {
    // Query relationships from the workflow with usesFunction verb
    const relationships = await this.graphStore.queryRelationshipsFrom(
      workflowId,
      { verb: VERB_USES_FUNCTION }
    )

    // Fetch the linked Function Things
    const functions: GraphThing[] = []
    for (const rel of relationships) {
      const thing = await this.graphStore.getThing(rel.to)
      if (thing) {
        functions.push(thing)
      }
    }

    return functions
  }

  /**
   * Get the Function Thing linked to a specific workflow step.
   *
   * @param workflowId - The workflow Thing ID
   * @param stepName - The step name
   * @returns The Function Thing or null if not found
   */
  async getFunctionForStep(
    workflowId: string,
    stepName: string
  ): Promise<GraphThing | null> {
    // Query relationships from the workflow with usesFunction verb
    const relationships = await this.graphStore.queryRelationshipsFrom(
      workflowId,
      { verb: VERB_USES_FUNCTION }
    )

    // Find the relationship for the specific step
    const rel = relationships.find((r) => {
      const data = r.data as { stepName?: string } | null
      return data?.stepName === stepName
    })

    if (!rel) {
      return null
    }

    return this.graphStore.getThing(rel.to)
  }

  /**
   * Remove the link between a workflow step and a Function Thing.
   *
   * @param workflowId - The workflow Thing ID
   * @param stepName - The step name
   * @param functionId - The Function Thing ID
   * @returns true if unlinked, false if relationship not found
   */
  async unlinkFunction(
    workflowId: string,
    stepName: string,
    functionId: string
  ): Promise<boolean> {
    // Query relationships from the workflow with usesFunction verb
    const relationships = await this.graphStore.queryRelationshipsFrom(
      workflowId,
      { verb: VERB_USES_FUNCTION }
    )

    // Find the relationship for the specific step and function
    const rel = relationships.find((r) => {
      const data = r.data as { stepName?: string } | null
      return r.to === functionId && data?.stepName === stepName
    })

    if (!rel) {
      return false
    }

    return this.graphStore.deleteRelationship(rel.id)
  }

  // =========================================================================
  // RELATIONSHIP OPERATIONS - Triggers
  // =========================================================================

  /**
   * Link a workflow to a Trigger/Schedule Thing.
   *
   * Creates a relationship with verb 'triggeredBy' from the workflow
   * to the trigger.
   *
   * @param workflowId - The workflow Thing ID
   * @param triggerId - The Trigger/Schedule Thing ID
   * @returns The created relationship
   */
  async linkTrigger(
    workflowId: string,
    triggerId: string
  ): Promise<GraphRelationship> {
    // Verify workflow exists
    const workflow = await this.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Create the relationship
    const relationshipId = `rel:${randomUUID()}`
    return this.graphStore.createRelationship({
      id: relationshipId,
      verb: VERB_TRIGGERED_BY,
      from: workflowId,
      to: triggerId,
    })
  }

  /**
   * Get all Trigger Things linked to a workflow.
   *
   * @param workflowId - The workflow Thing ID
   * @returns Array of linked Trigger Things
   */
  async getLinkedTriggers(workflowId: string): Promise<GraphThing[]> {
    // Query relationships from the workflow with triggeredBy verb
    const relationships = await this.graphStore.queryRelationshipsFrom(
      workflowId,
      { verb: VERB_TRIGGERED_BY }
    )

    // Fetch the linked Trigger Things
    const triggers: GraphThing[] = []
    for (const rel of relationships) {
      const thing = await this.graphStore.getThing(rel.to)
      if (thing) {
        triggers.push(thing)
      }
    }

    return triggers
  }

  /**
   * Remove the link between a workflow and a Trigger Thing.
   *
   * @param workflowId - The workflow Thing ID
   * @param triggerId - The Trigger Thing ID
   * @returns true if unlinked, false if relationship not found
   */
  async unlinkTrigger(workflowId: string, triggerId: string): Promise<boolean> {
    // Query relationships from the workflow with triggeredBy verb
    const relationships = await this.graphStore.queryRelationshipsFrom(
      workflowId,
      { verb: VERB_TRIGGERED_BY }
    )

    // Find the relationship to the specific trigger
    const rel = relationships.find((r) => r.to === triggerId)

    if (!rel) {
      return false
    }

    return this.graphStore.deleteRelationship(rel.id)
  }

  // =========================================================================
  // RELATIONSHIP QUERY
  // =========================================================================

  /**
   * Get all relationships for a workflow (both functions and triggers).
   *
   * @param workflowId - The workflow Thing ID
   * @returns Array of all relationships from the workflow
   */
  async getRelationships(workflowId: string): Promise<WorkflowRelationship[]> {
    // Query all relationships from the workflow
    const relationships = await this.graphStore.queryRelationshipsFrom(workflowId)

    return relationships.map((rel) => ({
      id: rel.id,
      verb: rel.verb,
      from: rel.from,
      to: rel.to,
      data: rel.data,
    }))
  }
}
