/**
 * WorkflowTemplate Store
 *
 * Manages WorkflowTemplate Things in the graph model.
 * Templates define the structure of a workflow including steps and their relationships.
 *
 * @see dotdo-ywyc4 - Workflows as Graph Things
 * @module db/graph/workflows/workflow-template
 */

import type { GraphStore } from '../types'
import {
  WORKFLOW_TEMPLATE_TYPE_ID,
  WORKFLOW_TEMPLATE_TYPE_NAME,
  WORKFLOW_STEP_TYPE_ID,
  WORKFLOW_STEP_TYPE_NAME,
  WORKFLOW_VERBS,
  type WorkflowTemplateThing,
  type WorkflowStepThing,
  type WorkflowTemplateData,
  type WorkflowStepData,
  type CreateWorkflowTemplateInput,
  type CreateWorkflowStepInput,
  type QueryWorkflowTemplatesOptions,
} from './types'

// ============================================================================
// ID GENERATION
// ============================================================================

let templateCounter = 0
let stepCounter = 0

/**
 * Generate a unique template ID
 */
function generateTemplateId(): string {
  templateCounter++
  return `template:${Date.now().toString(36)}-${templateCounter.toString(36)}`
}

/**
 * Generate a unique step ID
 */
function generateStepId(templateId: string, stepName: string): string {
  stepCounter++
  return `step:${templateId.replace('template:', '')}:${stepName}`
}

// ============================================================================
// TEMPLATE CRUD OPERATIONS
// ============================================================================

/**
 * Create a new WorkflowTemplate
 *
 * @param store - GraphStore instance
 * @param input - Template creation data
 * @returns The created WorkflowTemplateThing
 */
export async function createWorkflowTemplate(
  store: GraphStore,
  input: CreateWorkflowTemplateInput
): Promise<WorkflowTemplateThing> {
  const id = input.id ?? generateTemplateId()

  const templateData: WorkflowTemplateData = {
    name: input.name,
    description: input.description,
    version: input.version,
    tags: input.tags,
    triggers: input.triggers,
    timeout: input.timeout,
    metadata: input.metadata,
  }

  const thing = await store.createThing({
    id,
    typeId: WORKFLOW_TEMPLATE_TYPE_ID,
    typeName: WORKFLOW_TEMPLATE_TYPE_NAME,
    data: templateData as Record<string, unknown>,
  })

  return thing as unknown as WorkflowTemplateThing
}

/**
 * Get a WorkflowTemplate by ID
 *
 * @param store - GraphStore instance
 * @param id - Template ID
 * @returns The template or null if not found
 */
export async function getWorkflowTemplate(
  store: GraphStore,
  id: string
): Promise<WorkflowTemplateThing | null> {
  const thing = await store.getThing(id)

  if (!thing || thing.typeId !== WORKFLOW_TEMPLATE_TYPE_ID) {
    return null
  }

  return thing as unknown as WorkflowTemplateThing
}

/**
 * List workflow templates with filtering
 *
 * @param store - GraphStore instance
 * @param options - Query options
 * @returns Array of templates
 */
export async function listWorkflowTemplates(
  store: GraphStore,
  options: QueryWorkflowTemplatesOptions = {}
): Promise<WorkflowTemplateThing[]> {
  const things = await store.getThingsByType({
    typeId: WORKFLOW_TEMPLATE_TYPE_ID,
    typeName: WORKFLOW_TEMPLATE_TYPE_NAME,
    limit: options.limit,
    offset: options.offset,
    includeDeleted: options.includeDeleted,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  })

  let results = things as unknown as WorkflowTemplateThing[]

  // Filter by tag if specified
  if (options.tag) {
    results = results.filter(
      (t) => t.data?.tags?.includes(options.tag!)
    )
  }

  return results
}

/**
 * Update a WorkflowTemplate
 *
 * @param store - GraphStore instance
 * @param id - Template ID
 * @param updates - Fields to update
 * @returns The updated template or null if not found
 */
export async function updateWorkflowTemplate(
  store: GraphStore,
  id: string,
  updates: Partial<WorkflowTemplateData>
): Promise<WorkflowTemplateThing | null> {
  const existing = await getWorkflowTemplate(store, id)
  if (!existing) {
    return null
  }

  const mergedData: WorkflowTemplateData = {
    ...(existing.data || { name: '', version: '1.0.0' }),
    ...updates,
  }

  const updated = await store.updateThing(id, {
    data: mergedData as Record<string, unknown>,
  })

  return updated as unknown as WorkflowTemplateThing
}

/**
 * Delete a WorkflowTemplate (soft delete)
 *
 * @param store - GraphStore instance
 * @param id - Template ID
 * @returns The deleted template or null if not found
 */
export async function deleteWorkflowTemplate(
  store: GraphStore,
  id: string
): Promise<WorkflowTemplateThing | null> {
  const existing = await getWorkflowTemplate(store, id)
  if (!existing) {
    return null
  }

  const deleted = await store.deleteThing(id)
  return deleted as unknown as WorkflowTemplateThing
}

// ============================================================================
// STEP CRUD OPERATIONS
// ============================================================================

/**
 * Create a WorkflowStep and link it to a template
 *
 * @param store - GraphStore instance
 * @param input - Step creation data
 * @returns The created WorkflowStepThing
 */
export async function createWorkflowStep(
  store: GraphStore,
  input: CreateWorkflowStepInput
): Promise<WorkflowStepThing> {
  const id = input.id ?? generateStepId(input.templateId, input.name)

  const stepData: WorkflowStepData = {
    name: input.name,
    type: input.type,
    description: input.description,
    index: input.index,
    config: input.config,
    handler: input.handler,
    metadata: input.metadata,
  }

  const thing = await store.createThing({
    id,
    typeId: WORKFLOW_STEP_TYPE_ID,
    typeName: WORKFLOW_STEP_TYPE_NAME,
    data: stepData as Record<string, unknown>,
  })

  // Create CONTAINS relationship from template to step
  await store.createRelationship({
    id: `rel:contains:${input.templateId}:${id}`,
    verb: WORKFLOW_VERBS.CONTAINS,
    from: input.templateId,
    to: id,
    data: { index: input.index },
  })

  return thing as unknown as WorkflowStepThing
}

/**
 * Get a WorkflowStep by ID
 *
 * @param store - GraphStore instance
 * @param id - Step ID
 * @returns The step or null if not found
 */
export async function getWorkflowStep(
  store: GraphStore,
  id: string
): Promise<WorkflowStepThing | null> {
  const thing = await store.getThing(id)

  if (!thing || thing.typeId !== WORKFLOW_STEP_TYPE_ID) {
    return null
  }

  return thing as unknown as WorkflowStepThing
}

/**
 * Get all steps for a template, ordered by index
 *
 * @param store - GraphStore instance
 * @param templateId - Template ID
 * @returns Array of steps ordered by index
 */
export async function getTemplateSteps(
  store: GraphStore,
  templateId: string
): Promise<WorkflowStepThing[]> {
  // Query CONTAINS relationships from template
  const containsRels = await store.queryRelationshipsFrom(templateId, {
    verb: WORKFLOW_VERBS.CONTAINS,
  })

  // Fetch each step
  const steps: WorkflowStepThing[] = []
  for (const rel of containsRels) {
    const step = await getWorkflowStep(store, rel.to)
    if (step) {
      steps.push(step)
    }
  }

  // Sort by index
  steps.sort((a, b) => {
    const aIndex = a.data?.index ?? 0
    const bIndex = b.data?.index ?? 0
    return aIndex - bIndex
  })

  return steps
}

/**
 * Create a FOLLOWS relationship between steps
 *
 * @param store - GraphStore instance
 * @param fromStepId - Source step ID
 * @param toStepId - Target step ID (the step that follows)
 */
export async function createStepFollowsRelationship(
  store: GraphStore,
  fromStepId: string,
  toStepId: string
): Promise<void> {
  await store.createRelationship({
    id: `rel:follows:${fromStepId}:${toStepId}`,
    verb: WORKFLOW_VERBS.FOLLOWS,
    from: fromStepId,
    to: toStepId,
  })
}

/**
 * Create a BRANCHES_TO relationship for conditional branching
 *
 * @param store - GraphStore instance
 * @param fromStepId - Decision step ID
 * @param toStepId - Target step ID
 * @param condition - The condition expression
 */
export async function createStepBranchRelationship(
  store: GraphStore,
  fromStepId: string,
  toStepId: string,
  condition: string
): Promise<void> {
  await store.createRelationship({
    id: `rel:branchesTo:${fromStepId}:${toStepId}`,
    verb: WORKFLOW_VERBS.BRANCHES_TO,
    from: fromStepId,
    to: toStepId,
    data: { condition },
  })
}

/**
 * Get the steps that follow a given step
 *
 * @param store - GraphStore instance
 * @param stepId - Step ID
 * @returns Array of following steps
 */
export async function getFollowingSteps(
  store: GraphStore,
  stepId: string
): Promise<WorkflowStepThing[]> {
  const followsRels = await store.queryRelationshipsFrom(stepId, {
    verb: WORKFLOW_VERBS.FOLLOWS,
  })

  const steps: WorkflowStepThing[] = []
  for (const rel of followsRels) {
    const step = await getWorkflowStep(store, rel.to)
    if (step) {
      steps.push(step)
    }
  }

  return steps
}

/**
 * Get the steps that a decision step can branch to
 *
 * @param store - GraphStore instance
 * @param stepId - Decision step ID
 * @returns Array of { step, condition } objects
 */
export async function getBranchTargets(
  store: GraphStore,
  stepId: string
): Promise<Array<{ step: WorkflowStepThing; condition: string }>> {
  const branchRels = await store.queryRelationshipsFrom(stepId, {
    verb: WORKFLOW_VERBS.BRANCHES_TO,
  })

  const targets: Array<{ step: WorkflowStepThing; condition: string }> = []
  for (const rel of branchRels) {
    const step = await getWorkflowStep(store, rel.to)
    if (step) {
      const condition = (rel.data as { condition?: string })?.condition ?? ''
      targets.push({ step, condition })
    }
  }

  return targets
}

// ============================================================================
// TEMPLATE BUILDER UTILITY
// ============================================================================

/**
 * Build a complete workflow template with steps and relationships
 */
export class WorkflowTemplateBuilder {
  private store: GraphStore
  private templateId: string | null = null
  private steps: Array<{ input: CreateWorkflowStepInput; follows?: string }> = []

  constructor(store: GraphStore) {
    this.store = store
  }

  /**
   * Set the template ID (internal use after async creation)
   */
  private setTemplateId(id: string): this {
    this.templateId = id
    return this
  }

  /**
   * Create the template and return builder for chaining
   * Note: This is async, so use await before chaining
   */
  async createTemplate(input: CreateWorkflowTemplateInput): Promise<WorkflowTemplateBuilder> {
    const template = await createWorkflowTemplate(this.store, input)
    this.templateId = template.id
    return this
  }

  /**
   * Add a step to the template (synchronous for chaining after createTemplate)
   */
  addStep(
    input: Omit<CreateWorkflowStepInput, 'templateId'>,
    options?: { follows?: string }
  ): this {
    if (!this.templateId) {
      throw new Error('Must call createTemplate() first')
    }

    this.steps.push({
      input: { ...input, templateId: this.templateId },
      follows: options?.follows,
    })

    return this
  }

  /**
   * Build all steps and relationships
   */
  async build(): Promise<{
    template: WorkflowTemplateThing
    steps: WorkflowStepThing[]
  }> {
    if (!this.templateId) {
      throw new Error('Must call createTemplate() first')
    }

    const template = await getWorkflowTemplate(this.store, this.templateId)
    if (!template) {
      throw new Error('Template not found')
    }

    const createdSteps: Map<string, WorkflowStepThing> = new Map()

    // Create all steps
    for (const { input } of this.steps) {
      const step = await createWorkflowStep(this.store, input)
      createdSteps.set(input.name, step)
    }

    // Create FOLLOWS relationships
    for (const { input, follows } of this.steps) {
      if (follows) {
        const fromStep = createdSteps.get(follows)
        const toStep = createdSteps.get(input.name)
        if (fromStep && toStep) {
          await createStepFollowsRelationship(this.store, fromStep.id, toStep.id)
        }
      }
    }

    return {
      template,
      steps: Array.from(createdSteps.values()).sort(
        (a, b) => (a.data?.index ?? 0) - (b.data?.index ?? 0)
      ),
    }
  }
}

/**
 * Create a WorkflowTemplateBuilder
 */
export function createWorkflowTemplateBuilder(store: GraphStore): WorkflowTemplateBuilder {
  return new WorkflowTemplateBuilder(store)
}
