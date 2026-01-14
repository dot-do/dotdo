/**
 * @dotdo/hubspot/pipeline - Deal Pipeline Engine
 *
 * Complete implementation of HubSpot deal pipeline engine with stage management,
 * deal progression tracking, automation capabilities, and analytics.
 *
 * @example
 * ```typescript
 * import { DealPipelineEngine } from '@dotdo/hubspot/pipeline'
 *
 * const engine = new DealPipelineEngine(storage)
 *
 * // Create a pipeline
 * const pipeline = await engine.createPipeline({
 *   label: 'Sales Pipeline',
 *   displayOrder: 0,
 *   stages: [
 *     { label: 'Qualification', displayOrder: 0 },
 *     { label: 'Closed Won', displayOrder: 1, metadata: { isClosed: 'true' } },
 *   ],
 * })
 *
 * // Register and progress deals
 * await engine.registerDealInPipeline('deal-123', pipeline.id, stages[0].id)
 * await engine.moveDealToStage('deal-123', stages[1].id)
 * ```
 *
 * @module @dotdo/hubspot/pipeline
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Storage interface for pipeline data persistence
 */
export interface PipelineStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number; start?: string }): Promise<Map<string, unknown>>
}

/**
 * Pipeline stage definition
 */
export interface PipelineStage {
  id: string
  label: string
  displayOrder: number
  metadata?: {
    probability?: string
    isClosed?: string
    ticketState?: string
    [key: string]: string | undefined
  }
  createdAt?: string
  updatedAt?: string
  archived?: boolean
  archivedAt?: string
}

/**
 * Pipeline definition
 */
export interface Pipeline {
  id: string
  label: string
  displayOrder: number
  stages: PipelineStage[]
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Input for creating a pipeline
 */
export interface CreatePipelineInput {
  label: string
  displayOrder?: number
  stages?: CreateStageInput[]
}

/**
 * Input for creating a stage
 */
export interface CreateStageInput {
  label: string
  displayOrder?: number
  metadata?: PipelineStage['metadata']
}

/**
 * Input for updating a pipeline
 */
export interface UpdatePipelineInput {
  label?: string
  displayOrder?: number
}

/**
 * Input for updating a stage
 */
export interface UpdateStageInput {
  label?: string
  displayOrder?: number
  metadata?: PipelineStage['metadata']
}

/**
 * Deal position in pipeline
 */
export interface DealPosition {
  dealId: string
  pipelineId: string
  stageId: string
  enteredStageAt: string
  properties?: Record<string, string>
}

/**
 * Deal progression result
 */
export interface DealProgressionResult {
  dealId: string
  pipelineId: string
  stageId: string
  previousStageId?: string
  previousPipelineId?: string
  enteredStageAt: string
  timeInPreviousStage?: number
  pipelineChanged?: boolean
}

/**
 * Deal history entry
 */
export interface DealHistoryEntry {
  dealId: string
  pipelineId: string
  stageId: string
  enteredAt: string
  exitedAt?: string
  pipelineChanged?: boolean
}

/**
 * Pipeline automation trigger type
 */
export type AutomationTriggerType = 'stage_enter' | 'stage_exit' | 'time_in_stage'

/**
 * Automation condition
 */
export interface AutomationCondition {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value: string
}

/**
 * Automation trigger configuration
 */
export interface AutomationTrigger {
  type: AutomationTriggerType
  stageId: string
  durationMs?: number
}

/**
 * Automation action type
 */
export type AutomationActionType = 'webhook' | 'notification' | 'callback' | 'email' | 'task'

/**
 * Automation action configuration
 */
export interface AutomationAction {
  type: AutomationActionType
  config: Record<string, unknown>
}

/**
 * Pipeline automation definition
 */
export interface PipelineAutomation {
  id: string
  pipelineId: string
  name: string
  trigger: AutomationTrigger
  conditions?: AutomationCondition[]
  action: AutomationAction
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Input for creating an automation
 */
export interface CreateAutomationInput {
  pipelineId: string
  name: string
  trigger: AutomationTrigger
  conditions?: AutomationCondition[]
  action: AutomationAction
  enabled: boolean
}

/**
 * Input for updating an automation
 */
export interface UpdateAutomationInput {
  name?: string
  trigger?: AutomationTrigger
  conditions?: AutomationCondition[]
  action?: AutomationAction
  enabled?: boolean
}

/**
 * Pipeline metrics
 */
export interface PipelineMetrics {
  pipelineId: string
  totalDeals: number
  dealsByStage: Record<string, number>
  avgTimeInPipelineMs?: number
}

/**
 * Stage metrics
 */
export interface StageMetrics {
  pipelineId: string
  stageId: string
  dealsCount: number
  avgTimeInStageMs?: number
}

/**
 * Deal progression input (for typing)
 */
export interface DealProgressionInput {
  dealId: string
  stageId: string
}

/**
 * Paging information
 */
interface Paging {
  next?: { after: string }
}

/**
 * List result
 */
interface ListResult<T> {
  results: T[]
  paging?: Paging | null
}

/**
 * Automation action callback event
 */
export interface AutomationActionEvent {
  dealId: string
  automationId: string
  automationName: string
  action: AutomationAction
  triggeredAt: string
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Pipeline engine error
 */
export class DealPipelineError extends Error {
  category: string
  statusCode: number
  correlationId: string

  constructor(message: string, category: string, statusCode: number = 400) {
    super(message)
    this.name = 'DealPipelineError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = `corr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(prefix: string = 'pipe'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// DealPipelineEngine Class
// =============================================================================

/**
 * Deal Pipeline Engine
 *
 * Manages deal pipelines, stages, deal progression, and automations
 */
export class DealPipelineEngine {
  private storage: PipelineStorage
  private automationCallbacks: Array<(event: AutomationActionEvent) => void> = []

  // Storage key prefixes
  private readonly PREFIX = {
    pipeline: 'pipeline:',
    dealPosition: 'deal_pos:',
    dealHistory: 'deal_hist:',
    automation: 'automation:',
    stageDeals: 'stage_deals:',
  }

  constructor(storage: PipelineStorage) {
    this.storage = storage
  }

  // ===========================================================================
  // Pipeline CRUD Operations
  // ===========================================================================

  /**
   * Create a new pipeline
   */
  async createPipeline(input: CreatePipelineInput): Promise<Pipeline> {
    // Check for duplicate label
    const existing = await this.listAllPipelines()
    const duplicate = existing.find(
      (p) => !p.archived && p.label.toLowerCase() === input.label.toLowerCase()
    )
    if (duplicate) {
      throw new DealPipelineError(
        `Pipeline with label "${input.label}" already exists`,
        'DUPLICATE_PIPELINE',
        409
      )
    }

    const id = generateId('pipeline')
    const timestamp = now()

    // Auto-assign display order if not provided
    let displayOrder = input.displayOrder
    if (displayOrder === undefined) {
      const maxOrder = Math.max(...existing.filter((p) => !p.archived).map((p) => p.displayOrder), -1)
      displayOrder = maxOrder + 1
    }

    // Create stages with IDs
    const stages: PipelineStage[] = (input.stages ?? []).map((s, index) => ({
      id: generateId('stage'),
      label: s.label,
      displayOrder: s.displayOrder ?? index,
      metadata: s.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }))

    const pipeline: Pipeline = {
      id,
      label: input.label,
      displayOrder,
      stages,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.pipeline}${id}`, pipeline)
    return pipeline
  }

  /**
   * Get a pipeline by ID
   */
  async getPipeline(
    pipelineId: string,
    options?: { includeArchived?: boolean }
  ): Promise<Pipeline> {
    const pipeline = await this.storage.get<Pipeline>(
      `${this.PREFIX.pipeline}${pipelineId}`
    )

    if (!pipeline) {
      throw new DealPipelineError(
        `Pipeline not found: ${pipelineId}`,
        'PIPELINE_NOT_FOUND',
        404
      )
    }

    if (pipeline.archived && !options?.includeArchived) {
      throw new DealPipelineError(
        `Pipeline is archived: ${pipelineId}`,
        'PIPELINE_ARCHIVED',
        404
      )
    }

    return pipeline
  }

  /**
   * Update a pipeline
   */
  async updatePipeline(
    pipelineId: string,
    input: UpdatePipelineInput
  ): Promise<Pipeline> {
    const pipeline = await this.getPipeline(pipelineId)
    const timestamp = now()

    const updated: Pipeline = {
      ...pipeline,
      label: input.label ?? pipeline.label,
      displayOrder: input.displayOrder ?? pipeline.displayOrder,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, updated)
    return updated
  }

  /**
   * Delete a pipeline (hard delete)
   */
  async deletePipeline(
    pipelineId: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const pipeline = await this.getPipeline(pipelineId, { includeArchived: true })

    // Check if pipeline has deals
    if (!options?.force) {
      const dealsCount = await this.countDealsInPipeline(pipelineId)
      if (dealsCount > 0) {
        throw new DealPipelineError(
          `Pipeline has ${dealsCount} deals. Use force option to delete anyway.`,
          'PIPELINE_HAS_DEALS',
          400
        )
      }
    }

    await this.storage.delete(`${this.PREFIX.pipeline}${pipelineId}`)
  }

  /**
   * Archive a pipeline (soft delete)
   */
  async archivePipeline(pipelineId: string): Promise<Pipeline> {
    const pipeline = await this.getPipeline(pipelineId)
    const timestamp = now()

    const archived: Pipeline = {
      ...pipeline,
      archived: true,
      archivedAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, archived)
    return archived
  }

  /**
   * List all pipelines
   */
  async listPipelines(options?: {
    includeArchived?: boolean
    limit?: number
    after?: string
  }): Promise<ListResult<Pipeline>> {
    const all = await this.listAllPipelines()
    let filtered = all

    if (!options?.includeArchived) {
      filtered = filtered.filter((p) => !p.archived)
    }

    // Sort by display order
    filtered.sort((a, b) => a.displayOrder - b.displayOrder)

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = filtered.findIndex((p) => p.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = filtered.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < filtered.length

    return {
      results: paged,
      paging: hasMore ? { next: { after: paged[paged.length - 1]?.id ?? '' } } : null,
    }
  }

  /**
   * Get the default pipeline
   */
  async getDefaultPipeline(): Promise<Pipeline> {
    const pipelines = await this.listPipelines()

    if (pipelines.results.length === 0) {
      throw new DealPipelineError(
        'No pipelines exist',
        'NO_PIPELINES_EXIST',
        404
      )
    }

    // Find pipeline with displayOrder 0 or first one
    const defaultPipeline =
      pipelines.results.find((p) => p.displayOrder === 0) ?? pipelines.results[0]

    return defaultPipeline
  }

  // ===========================================================================
  // Stage Management Operations
  // ===========================================================================

  /**
   * Create a stage in a pipeline
   */
  async createStage(
    pipelineId: string,
    input: CreateStageInput
  ): Promise<PipelineStage> {
    const pipeline = await this.getPipeline(pipelineId)
    const timestamp = now()

    // Check for duplicate label
    const duplicate = pipeline.stages.find(
      (s) => !s.archived && s.label.toLowerCase() === input.label.toLowerCase()
    )
    if (duplicate) {
      throw new DealPipelineError(
        `Stage with label "${input.label}" already exists in pipeline`,
        'DUPLICATE_STAGE',
        409
      )
    }

    // Auto-assign display order
    let displayOrder = input.displayOrder
    if (displayOrder === undefined) {
      const maxOrder = Math.max(
        ...pipeline.stages.filter((s) => !s.archived).map((s) => s.displayOrder),
        -1
      )
      displayOrder = maxOrder + 1
    }

    const stage: PipelineStage = {
      id: generateId('stage'),
      label: input.label,
      displayOrder,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    pipeline.stages.push(stage)
    pipeline.updatedAt = timestamp

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, pipeline)
    return stage
  }

  /**
   * Get a stage by ID
   */
  async getStage(pipelineId: string, stageId: string): Promise<PipelineStage> {
    const pipeline = await this.getPipeline(pipelineId)
    const stage = pipeline.stages.find((s) => s.id === stageId && !s.archived)

    if (!stage) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    return stage
  }

  /**
   * Update a stage
   */
  async updateStage(
    pipelineId: string,
    stageId: string,
    input: UpdateStageInput
  ): Promise<PipelineStage> {
    const pipeline = await this.getPipeline(pipelineId)
    const stageIndex = pipeline.stages.findIndex((s) => s.id === stageId)

    if (stageIndex === -1) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    const timestamp = now()
    const stage = pipeline.stages[stageIndex]

    const updated: PipelineStage = {
      ...stage,
      label: input.label ?? stage.label,
      displayOrder: input.displayOrder ?? stage.displayOrder,
      metadata: input.metadata ?? stage.metadata,
      updatedAt: timestamp,
    }

    pipeline.stages[stageIndex] = updated
    pipeline.updatedAt = timestamp

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, pipeline)
    return updated
  }

  /**
   * Delete a stage
   */
  async deleteStage(
    pipelineId: string,
    stageId: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const pipeline = await this.getPipeline(pipelineId)
    const stageIndex = pipeline.stages.findIndex((s) => s.id === stageId)

    if (stageIndex === -1) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    // Check if stage has deals
    if (!options?.force) {
      const dealsCount = await this.countDealsInStage(pipelineId, stageId)
      if (dealsCount > 0) {
        throw new DealPipelineError(
          `Stage has ${dealsCount} deals. Use force option to delete anyway.`,
          'STAGE_HAS_DEALS',
          400
        )
      }
    }

    pipeline.stages.splice(stageIndex, 1)
    pipeline.updatedAt = now()

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, pipeline)
  }

  /**
   * Archive a stage
   */
  async archiveStage(pipelineId: string, stageId: string): Promise<PipelineStage> {
    const pipeline = await this.getPipeline(pipelineId)
    const stageIndex = pipeline.stages.findIndex((s) => s.id === stageId)

    if (stageIndex === -1) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    const timestamp = now()
    const stage = pipeline.stages[stageIndex]

    const archived: PipelineStage = {
      ...stage,
      archived: true,
      archivedAt: timestamp,
      updatedAt: timestamp,
    }

    pipeline.stages[stageIndex] = archived
    pipeline.updatedAt = timestamp

    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, pipeline)
    return archived
  }

  /**
   * Reorder stages
   */
  async reorderStages(pipelineId: string, stageIds: string[]): Promise<void> {
    const pipeline = await this.getPipeline(pipelineId)
    const timestamp = now()

    // Validate that all stage IDs match
    const activeStages = pipeline.stages.filter((s) => !s.archived)
    const activeStageIds = new Set(activeStages.map((s) => s.id))
    const providedIds = new Set(stageIds)

    if (activeStageIds.size !== providedIds.size) {
      throw new DealPipelineError(
        'Stage IDs do not match pipeline stages',
        'INVALID_STAGE_ORDER',
        400
      )
    }

    for (const id of stageIds) {
      if (!activeStageIds.has(id)) {
        throw new DealPipelineError(
          `Stage not found: ${id}`,
          'INVALID_STAGE_ORDER',
          400
        )
      }
    }

    // Reorder stages
    const stageMap = new Map(pipeline.stages.map((s) => [s.id, s]))
    pipeline.stages = stageIds.map((id, index) => {
      const stage = stageMap.get(id)!
      return {
        ...stage,
        displayOrder: index,
        updatedAt: timestamp,
      }
    })

    // Add any archived stages back
    for (const stage of activeStages) {
      if (!stageIds.includes(stage.id)) {
        pipeline.stages.push(stage)
      }
    }

    pipeline.updatedAt = timestamp
    await this.storage.put(`${this.PREFIX.pipeline}${pipelineId}`, pipeline)
  }

  /**
   * List stages in a pipeline
   */
  async listStages(pipelineId: string): Promise<ListResult<PipelineStage>> {
    const pipeline = await this.getPipeline(pipelineId)
    const stages = pipeline.stages
      .filter((s) => !s.archived)
      .sort((a, b) => a.displayOrder - b.displayOrder)

    return { results: stages }
  }

  // ===========================================================================
  // Deal Progression Operations
  // ===========================================================================

  /**
   * Register a deal in a pipeline
   */
  async registerDealInPipeline(
    dealId: string,
    pipelineId: string,
    stageId: string,
    properties?: Record<string, string>
  ): Promise<DealPosition> {
    // Validate pipeline and stage
    const pipeline = await this.getPipeline(pipelineId)
    const stage = pipeline.stages.find((s) => s.id === stageId && !s.archived)

    if (!stage) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    const timestamp = now()

    const position: DealPosition = {
      dealId,
      pipelineId,
      stageId,
      enteredStageAt: timestamp,
      properties,
    }

    // Store deal position
    await this.storage.put(`${this.PREFIX.dealPosition}${dealId}`, position)

    // Add to history
    const historyEntry: DealHistoryEntry = {
      dealId,
      pipelineId,
      stageId,
      enteredAt: timestamp,
    }
    await this.addHistoryEntry(dealId, historyEntry)

    // Track deal in stage for counting
    await this.addDealToStage(pipelineId, stageId, dealId)

    return position
  }

  /**
   * Move a deal to a new stage
   */
  async moveDealToStage(
    dealId: string,
    stageId: string
  ): Promise<DealProgressionResult> {
    const position = await this.getDealPosition(dealId)
    const pipeline = await this.getPipeline(position.pipelineId)
    const stage = pipeline.stages.find((s) => s.id === stageId && !s.archived)

    if (!stage) {
      throw new DealPipelineError(
        `Stage not found: ${stageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    const timestamp = now()
    const previousStageId = position.stageId
    const enteredPrevious = new Date(position.enteredStageAt).getTime()
    const timeInPreviousStage = Date.now() - enteredPrevious

    // Update history - close previous entry
    await this.closeHistoryEntry(dealId, previousStageId, timestamp)

    // Remove from previous stage tracking
    await this.removeDealFromStageTracking(position.pipelineId, previousStageId, dealId)

    // Update position
    const newPosition: DealPosition = {
      ...position,
      stageId,
      enteredStageAt: timestamp,
    }
    await this.storage.put(`${this.PREFIX.dealPosition}${dealId}`, newPosition)

    // Add new history entry
    const historyEntry: DealHistoryEntry = {
      dealId,
      pipelineId: position.pipelineId,
      stageId,
      enteredAt: timestamp,
    }
    await this.addHistoryEntry(dealId, historyEntry)

    // Add to new stage tracking
    await this.addDealToStage(position.pipelineId, stageId, dealId)

    // Trigger automations
    await this.triggerStageAutomations(
      dealId,
      position.pipelineId,
      previousStageId,
      stageId,
      position.properties
    )

    return {
      dealId,
      pipelineId: position.pipelineId,
      stageId,
      previousStageId,
      enteredStageAt: timestamp,
      timeInPreviousStage,
    }
  }

  /**
   * Get current stage for a deal
   */
  async getDealStage(dealId: string): Promise<DealPosition> {
    return this.getDealPosition(dealId)
  }

  /**
   * Remove a deal from pipeline tracking
   */
  async removeDealFromPipeline(dealId: string): Promise<void> {
    const position = await this.getDealPosition(dealId)

    // Close history entry
    await this.closeHistoryEntry(dealId, position.stageId, now())

    // Remove from stage tracking
    await this.removeDealFromStageTracking(position.pipelineId, position.stageId, dealId)

    // Remove position
    await this.storage.delete(`${this.PREFIX.dealPosition}${dealId}`)
  }

  /**
   * Move a deal to a different pipeline
   */
  async moveDealToPipeline(
    dealId: string,
    newPipelineId: string,
    newStageId: string
  ): Promise<DealProgressionResult> {
    const position = await this.getDealPosition(dealId)
    const newPipeline = await this.getPipeline(newPipelineId)
    const newStage = newPipeline.stages.find((s) => s.id === newStageId && !s.archived)

    if (!newStage) {
      throw new DealPipelineError(
        `Stage not found: ${newStageId}`,
        'STAGE_NOT_FOUND',
        404
      )
    }

    const timestamp = now()
    const previousPipelineId = position.pipelineId
    const previousStageId = position.stageId

    // Close previous history entry
    await this.closeHistoryEntry(dealId, previousStageId, timestamp)

    // Remove from previous stage tracking
    await this.removeDealFromStageTracking(previousPipelineId, previousStageId, dealId)

    // Update position
    const newPosition: DealPosition = {
      dealId,
      pipelineId: newPipelineId,
      stageId: newStageId,
      enteredStageAt: timestamp,
      properties: position.properties,
    }
    await this.storage.put(`${this.PREFIX.dealPosition}${dealId}`, newPosition)

    // Add new history entry
    const historyEntry: DealHistoryEntry = {
      dealId,
      pipelineId: newPipelineId,
      stageId: newStageId,
      enteredAt: timestamp,
      pipelineChanged: true,
    }
    await this.addHistoryEntry(dealId, historyEntry)

    // Add to new stage tracking
    await this.addDealToStage(newPipelineId, newStageId, dealId)

    return {
      dealId,
      pipelineId: newPipelineId,
      stageId: newStageId,
      previousPipelineId,
      previousStageId,
      enteredStageAt: timestamp,
      pipelineChanged: true,
    }
  }

  /**
   * Get deal history
   */
  async getDealHistory(dealId: string): Promise<DealHistoryEntry[]> {
    const historyKey = `${this.PREFIX.dealHistory}${dealId}`
    const history = await this.storage.get<DealHistoryEntry[]>(historyKey)
    return history ?? []
  }

  /**
   * List deals in a stage
   */
  async listDealsInStage(
    pipelineId: string,
    stageId: string
  ): Promise<ListResult<DealPosition>> {
    const dealsKey = `${this.PREFIX.stageDeals}${pipelineId}:${stageId}`
    const dealIds = await this.storage.get<string[]>(dealsKey) ?? []

    const results: DealPosition[] = []
    for (const dealId of dealIds) {
      try {
        const position = await this.getDealPosition(dealId)
        if (position.stageId === stageId) {
          results.push(position)
        }
      } catch {
        // Deal may have been removed
      }
    }

    return { results }
  }

  /**
   * List deals in a pipeline
   */
  async listDealsInPipeline(
    pipelineId: string,
    options?: { stageId?: string }
  ): Promise<ListResult<DealPosition>> {
    const pipeline = await this.getPipeline(pipelineId)
    const results: DealPosition[] = []

    for (const stage of pipeline.stages) {
      if (options?.stageId && stage.id !== options.stageId) continue
      if (stage.archived) continue

      const stageDeals = await this.listDealsInStage(pipelineId, stage.id)
      results.push(...stageDeals.results)
    }

    return { results }
  }

  // ===========================================================================
  // Automation Operations
  // ===========================================================================

  /**
   * Register a callback for automation actions
   */
  onAutomationAction(callback: (event: AutomationActionEvent) => void): void {
    this.automationCallbacks.push(callback)
  }

  /**
   * Create an automation
   */
  async createAutomation(input: CreateAutomationInput): Promise<PipelineAutomation> {
    // Validate pipeline exists
    await this.getPipeline(input.pipelineId)

    const id = generateId('auto')
    const timestamp = now()

    const automation: PipelineAutomation = {
      id,
      pipelineId: input.pipelineId,
      name: input.name,
      trigger: input.trigger,
      conditions: input.conditions,
      action: input.action,
      enabled: input.enabled,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.automation}${id}`, automation)
    return automation
  }

  /**
   * Get an automation by ID
   */
  async getAutomation(automationId: string): Promise<PipelineAutomation> {
    const automation = await this.storage.get<PipelineAutomation>(
      `${this.PREFIX.automation}${automationId}`
    )

    if (!automation) {
      throw new DealPipelineError(
        `Automation not found: ${automationId}`,
        'AUTOMATION_NOT_FOUND',
        404
      )
    }

    return automation
  }

  /**
   * Update an automation
   */
  async updateAutomation(
    automationId: string,
    input: UpdateAutomationInput
  ): Promise<PipelineAutomation> {
    const automation = await this.getAutomation(automationId)
    const timestamp = now()

    const updated: PipelineAutomation = {
      ...automation,
      name: input.name ?? automation.name,
      trigger: input.trigger ?? automation.trigger,
      conditions: input.conditions ?? automation.conditions,
      action: input.action ?? automation.action,
      enabled: input.enabled ?? automation.enabled,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.automation}${automationId}`, updated)
    return updated
  }

  /**
   * Delete an automation
   */
  async deleteAutomation(automationId: string): Promise<void> {
    await this.getAutomation(automationId)
    await this.storage.delete(`${this.PREFIX.automation}${automationId}`)
  }

  /**
   * List automations for a pipeline
   */
  async listAutomations(
    pipelineId: string,
    options?: { enabled?: boolean }
  ): Promise<ListResult<PipelineAutomation>> {
    const all = await this.listAllAutomations()
    let filtered = all.filter((a) => a.pipelineId === pipelineId)

    if (options?.enabled !== undefined) {
      filtered = filtered.filter((a) => a.enabled === options.enabled)
    }

    return { results: filtered }
  }

  // ===========================================================================
  // Metrics & Analytics
  // ===========================================================================

  /**
   * Get pipeline metrics
   */
  async getPipelineMetrics(pipelineId: string): Promise<PipelineMetrics> {
    const pipeline = await this.getPipeline(pipelineId)
    const dealsByStage: Record<string, number> = {}
    let totalDeals = 0

    for (const stage of pipeline.stages) {
      if (stage.archived) continue
      const count = await this.countDealsInStage(pipelineId, stage.id)
      dealsByStage[stage.id] = count
      totalDeals += count
    }

    return {
      pipelineId,
      totalDeals,
      dealsByStage,
    }
  }

  /**
   * Get stage metrics
   */
  async getStageMetrics(pipelineId: string, stageId: string): Promise<StageMetrics> {
    const dealsCount = await this.countDealsInStage(pipelineId, stageId)

    // Calculate average time in stage from history (both completed and current deals)
    let totalTime = 0
    let dealsWithTimeData = 0

    // Get all deal positions to find deals that have been in this stage
    const allPositions = await this.getAllDealPositions()
    const processedDeals = new Set<string>()

    for (const position of allPositions) {
      if (position.pipelineId !== pipelineId) continue

      const history = await this.getDealHistory(position.dealId)

      // Find all entries for this stage in history
      for (const entry of history) {
        if (entry.stageId !== stageId) continue
        if (processedDeals.has(`${position.dealId}:${entry.enteredAt}`)) continue
        processedDeals.add(`${position.dealId}:${entry.enteredAt}`)

        const entered = new Date(entry.enteredAt).getTime()

        if (entry.exitedAt) {
          // Deal has left the stage - use actual time
          const exited = new Date(entry.exitedAt).getTime()
          totalTime += exited - entered
          dealsWithTimeData++
        } else if (position.stageId === stageId) {
          // Deal is still in this stage - use time so far
          totalTime += Date.now() - entered
          dealsWithTimeData++
        }
      }
    }

    const avgTimeInStageMs = dealsWithTimeData > 0 ? totalTime / dealsWithTimeData : undefined

    return {
      pipelineId,
      stageId,
      dealsCount,
      avgTimeInStageMs,
    }
  }

  /**
   * Get conversion rate between stages
   */
  async getConversionRate(
    pipelineId: string,
    fromStageId: string,
    toStageId: string
  ): Promise<number> {
    // Get all deals that were ever in fromStage
    const allPositions = await this.getAllDealPositions()
    let dealsInFromStage = 0
    let dealsMovedToToStage = 0

    for (const position of allPositions) {
      if (position.pipelineId !== pipelineId) continue

      const history = await this.getDealHistory(position.dealId)
      const wasInFromStage = history.some((h) => h.stageId === fromStageId)
      const movedToToStage = history.some((h) => h.stageId === toStageId)

      if (wasInFromStage) {
        dealsInFromStage++
        if (movedToToStage) {
          dealsMovedToToStage++
        }
      }
    }

    if (dealsInFromStage === 0) return 0
    return (dealsMovedToToStage / dealsInFromStage) * 100
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private async listAllPipelines(): Promise<Pipeline[]> {
    const map = await this.storage.list({ prefix: this.PREFIX.pipeline })
    return Array.from(map.values()) as Pipeline[]
  }

  private async listAllAutomations(): Promise<PipelineAutomation[]> {
    const map = await this.storage.list({ prefix: this.PREFIX.automation })
    return Array.from(map.values()) as PipelineAutomation[]
  }

  private async getDealPosition(dealId: string): Promise<DealPosition> {
    const position = await this.storage.get<DealPosition>(
      `${this.PREFIX.dealPosition}${dealId}`
    )

    if (!position) {
      throw new DealPipelineError(
        `Deal not in pipeline: ${dealId}`,
        'DEAL_NOT_IN_PIPELINE',
        404
      )
    }

    return position
  }

  private async getAllDealPositions(): Promise<DealPosition[]> {
    const map = await this.storage.list({ prefix: this.PREFIX.dealPosition })
    return Array.from(map.values()) as DealPosition[]
  }

  private async addHistoryEntry(
    dealId: string,
    entry: DealHistoryEntry
  ): Promise<void> {
    const historyKey = `${this.PREFIX.dealHistory}${dealId}`
    const history = (await this.storage.get<DealHistoryEntry[]>(historyKey)) ?? []
    history.push(entry)
    await this.storage.put(historyKey, history)
  }

  private async closeHistoryEntry(
    dealId: string,
    stageId: string,
    exitedAt: string
  ): Promise<void> {
    const historyKey = `${this.PREFIX.dealHistory}${dealId}`
    const history = (await this.storage.get<DealHistoryEntry[]>(historyKey)) ?? []

    // Find the last entry for this stage that hasn't been closed
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].stageId === stageId && !history[i].exitedAt) {
        history[i].exitedAt = exitedAt
        break
      }
    }

    await this.storage.put(historyKey, history)
  }

  private async addDealToStage(
    pipelineId: string,
    stageId: string,
    dealId: string
  ): Promise<void> {
    const key = `${this.PREFIX.stageDeals}${pipelineId}:${stageId}`
    const dealIds = (await this.storage.get<string[]>(key)) ?? []
    if (!dealIds.includes(dealId)) {
      dealIds.push(dealId)
      await this.storage.put(key, dealIds)
    }
  }

  private async removeDealFromStageTracking(
    pipelineId: string,
    stageId: string,
    dealId: string
  ): Promise<void> {
    const key = `${this.PREFIX.stageDeals}${pipelineId}:${stageId}`
    const dealIds = (await this.storage.get<string[]>(key)) ?? []
    const index = dealIds.indexOf(dealId)
    if (index !== -1) {
      dealIds.splice(index, 1)
      await this.storage.put(key, dealIds)
    }
  }

  private async countDealsInStage(pipelineId: string, stageId: string): Promise<number> {
    const key = `${this.PREFIX.stageDeals}${pipelineId}:${stageId}`
    const dealIds = (await this.storage.get<string[]>(key)) ?? []
    return dealIds.length
  }

  private async countDealsInPipeline(pipelineId: string): Promise<number> {
    const pipeline = await this.getPipeline(pipelineId, { includeArchived: true })
    let count = 0

    for (const stage of pipeline.stages) {
      count += await this.countDealsInStage(pipelineId, stage.id)
    }

    return count
  }

  private async triggerStageAutomations(
    dealId: string,
    pipelineId: string,
    previousStageId: string,
    newStageId: string,
    dealProperties?: Record<string, string>
  ): Promise<void> {
    const automations = await this.listAutomations(pipelineId, { enabled: true })

    for (const automation of automations.results) {
      let shouldTrigger = false

      // Check trigger conditions
      if (
        automation.trigger.type === 'stage_enter' &&
        automation.trigger.stageId === newStageId
      ) {
        shouldTrigger = true
      } else if (
        automation.trigger.type === 'stage_exit' &&
        automation.trigger.stageId === previousStageId
      ) {
        shouldTrigger = true
      }

      if (!shouldTrigger) continue

      // Check conditions
      if (automation.conditions && dealProperties) {
        const conditionsMet = automation.conditions.every((condition) => {
          const dealValue = dealProperties[condition.field]
          if (dealValue === undefined) return false

          switch (condition.operator) {
            case 'eq':
              return dealValue === condition.value
            case 'neq':
              return dealValue !== condition.value
            case 'gt':
              return Number(dealValue) > Number(condition.value)
            case 'gte':
              return Number(dealValue) >= Number(condition.value)
            case 'lt':
              return Number(dealValue) < Number(condition.value)
            case 'lte':
              return Number(dealValue) <= Number(condition.value)
            case 'contains':
              return dealValue.includes(condition.value)
            default:
              return false
          }
        })

        if (!conditionsMet) continue
      }

      // Trigger callbacks
      const event: AutomationActionEvent = {
        dealId,
        automationId: automation.id,
        automationName: automation.name,
        action: automation.action,
        triggeredAt: now(),
      }

      for (const callback of this.automationCallbacks) {
        try {
          callback(event)
        } catch (error) {
          // Log but don't fail on callback errors
          console.error('Automation callback error:', error)
        }
      }
    }
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default DealPipelineEngine
