/**
 * @dotdo/hubspot/pipeline - Deal Pipeline Engine Tests
 *
 * Comprehensive tests for the HubSpot deal pipeline engine with stage management,
 * deal progression, and automation capabilities.
 *
 * @module @dotdo/hubspot/pipeline/tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DealPipelineEngine,
  DealPipelineError,
  type PipelineStorage,
  type Pipeline,
  type PipelineStage,
  type PipelineAutomation,
  type CreatePipelineInput,
  type CreateStageInput,
  type UpdatePipelineInput,
  type UpdateStageInput,
  type DealProgressionInput,
  type PipelineMetrics,
  type StageMetrics,
} from '../pipeline'

// =============================================================================
// Mock Storage Implementation
// =============================================================================

function createMockStorage(): PipelineStorage {
  const store = new Map<string, unknown>()

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      store.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key)
    },
    async list(options?: { prefix?: string; limit?: number; start?: string }): Promise<Map<string, unknown>> {
      const result = new Map<string, unknown>()
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? Infinity
      let count = 0

      for (const [key, value] of store.entries()) {
        if (key.startsWith(prefix)) {
          if (options?.start && key <= options.start) continue
          if (count >= limit) break
          result.set(key, value)
          count++
        }
      }

      return result
    },
  }
}

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/hubspot/pipeline - Deal Pipeline Engine', () => {
  let storage: PipelineStorage
  let engine: DealPipelineEngine

  beforeEach(() => {
    storage = createMockStorage()
    engine = new DealPipelineEngine(storage)
  })

  // ===========================================================================
  // PIPELINE CRUD (15+ tests)
  // ===========================================================================

  describe('Pipeline CRUD', () => {
    describe('createPipeline', () => {
      it('should create a pipeline with required fields', async () => {
        const pipeline = await engine.createPipeline({
          label: 'Sales Pipeline',
          displayOrder: 0,
        })

        expect(pipeline).toBeDefined()
        expect(pipeline.id).toBeTruthy()
        expect(pipeline.label).toBe('Sales Pipeline')
        expect(pipeline.displayOrder).toBe(0)
        expect(pipeline.stages).toEqual([])
        expect(pipeline.archived).toBe(false)
        expect(pipeline.createdAt).toBeTruthy()
        expect(pipeline.updatedAt).toBeTruthy()
      })

      it('should create a pipeline with initial stages', async () => {
        const pipeline = await engine.createPipeline({
          label: 'Enterprise Pipeline',
          displayOrder: 1,
          stages: [
            { label: 'Qualification', displayOrder: 0, metadata: { probability: '20' } },
            { label: 'Demo', displayOrder: 1, metadata: { probability: '40' } },
            { label: 'Proposal', displayOrder: 2, metadata: { probability: '60' } },
            { label: 'Negotiation', displayOrder: 3, metadata: { probability: '80' } },
            { label: 'Closed Won', displayOrder: 4, metadata: { probability: '100', isClosed: 'true' } },
            { label: 'Closed Lost', displayOrder: 5, metadata: { probability: '0', isClosed: 'true' } },
          ],
        })

        expect(pipeline.stages).toHaveLength(6)
        expect(pipeline.stages[0].label).toBe('Qualification')
        expect(pipeline.stages[0].metadata?.probability).toBe('20')
        expect(pipeline.stages[4].metadata?.isClosed).toBe('true')
      })

      it('should generate unique IDs for pipelines', async () => {
        const pipeline1 = await engine.createPipeline({ label: 'Pipeline 1', displayOrder: 0 })
        const pipeline2 = await engine.createPipeline({ label: 'Pipeline 2', displayOrder: 1 })

        expect(pipeline1.id).not.toBe(pipeline2.id)
      })

      it('should throw error for duplicate pipeline label', async () => {
        await engine.createPipeline({ label: 'Sales Pipeline', displayOrder: 0 })

        await expect(
          engine.createPipeline({ label: 'Sales Pipeline', displayOrder: 1 })
        ).rejects.toThrow(DealPipelineError)

        await expect(
          engine.createPipeline({ label: 'Sales Pipeline', displayOrder: 1 })
        ).rejects.toMatchObject({
          category: 'DUPLICATE_PIPELINE',
          statusCode: 409,
        })
      })

      it('should auto-assign display order if not provided', async () => {
        await engine.createPipeline({ label: 'Pipeline 1', displayOrder: 0 })
        await engine.createPipeline({ label: 'Pipeline 2', displayOrder: 1 })
        const pipeline3 = await engine.createPipeline({ label: 'Pipeline 3' })

        expect(pipeline3.displayOrder).toBe(2)
      })
    })

    describe('getPipeline', () => {
      it('should get a pipeline by ID', async () => {
        const created = await engine.createPipeline({ label: 'Test Pipeline', displayOrder: 0 })
        const retrieved = await engine.getPipeline(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.label).toBe('Test Pipeline')
      })

      it('should throw error for non-existent pipeline', async () => {
        await expect(engine.getPipeline('nonexistent-id')).rejects.toThrow(DealPipelineError)

        await expect(engine.getPipeline('nonexistent-id')).rejects.toMatchObject({
          category: 'PIPELINE_NOT_FOUND',
          statusCode: 404,
        })
      })

      it('should throw error for archived pipeline', async () => {
        const pipeline = await engine.createPipeline({ label: 'Archived Pipeline', displayOrder: 0 })
        await engine.archivePipeline(pipeline.id)

        await expect(engine.getPipeline(pipeline.id)).rejects.toThrow(DealPipelineError)
      })

      it('should get archived pipeline with includeArchived option', async () => {
        const pipeline = await engine.createPipeline({ label: 'Archived Pipeline', displayOrder: 0 })
        await engine.archivePipeline(pipeline.id)

        const retrieved = await engine.getPipeline(pipeline.id, { includeArchived: true })
        expect(retrieved.id).toBe(pipeline.id)
        expect(retrieved.archived).toBe(true)
      })
    })

    describe('updatePipeline', () => {
      it('should update pipeline label', async () => {
        const pipeline = await engine.createPipeline({ label: 'Original', displayOrder: 0 })
        const updated = await engine.updatePipeline(pipeline.id, { label: 'Updated' })

        expect(updated.label).toBe('Updated')
      })

      it('should update pipeline display order', async () => {
        const pipeline = await engine.createPipeline({ label: 'Test', displayOrder: 0 })
        const updated = await engine.updatePipeline(pipeline.id, { displayOrder: 5 })

        expect(updated.displayOrder).toBe(5)
      })

      it('should update updatedAt timestamp', async () => {
        const pipeline = await engine.createPipeline({ label: 'Test', displayOrder: 0 })
        const originalUpdated = pipeline.updatedAt

        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await engine.updatePipeline(pipeline.id, { label: 'New Label' })

        expect(updated.updatedAt).not.toBe(originalUpdated)
        expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdated).getTime())
      })

      it('should throw error when updating non-existent pipeline', async () => {
        await expect(
          engine.updatePipeline('nonexistent-id', { label: 'Test' })
        ).rejects.toThrow(DealPipelineError)
      })
    })

    describe('deletePipeline', () => {
      it('should delete a pipeline (hard delete)', async () => {
        const pipeline = await engine.createPipeline({ label: 'To Delete', displayOrder: 0 })
        await engine.deletePipeline(pipeline.id)

        await expect(engine.getPipeline(pipeline.id)).rejects.toThrow(DealPipelineError)
      })

      it('should throw error when deleting non-existent pipeline', async () => {
        await expect(engine.deletePipeline('nonexistent-id')).rejects.toThrow(DealPipelineError)
      })

      it('should prevent deletion if deals exist in pipeline', async () => {
        const pipeline = await engine.createPipeline({
          label: 'With Deals',
          displayOrder: 0,
          stages: [{ label: 'Stage 1', displayOrder: 0 }],
        })

        // Register a deal in this pipeline
        await engine.registerDealInPipeline('deal-123', pipeline.id, pipeline.stages[0].id)

        await expect(engine.deletePipeline(pipeline.id)).rejects.toThrow(DealPipelineError)
        await expect(engine.deletePipeline(pipeline.id)).rejects.toMatchObject({
          category: 'PIPELINE_HAS_DEALS',
        })
      })

      it('should allow force deletion even with deals', async () => {
        const pipeline = await engine.createPipeline({
          label: 'With Deals',
          displayOrder: 0,
          stages: [{ label: 'Stage 1', displayOrder: 0 }],
        })

        await engine.registerDealInPipeline('deal-123', pipeline.id, pipeline.stages[0].id)

        await expect(engine.deletePipeline(pipeline.id, { force: true })).resolves.not.toThrow()
        await expect(engine.getPipeline(pipeline.id)).rejects.toThrow(DealPipelineError)
      })
    })

    describe('archivePipeline', () => {
      it('should archive a pipeline (soft delete)', async () => {
        const pipeline = await engine.createPipeline({ label: 'To Archive', displayOrder: 0 })
        const archived = await engine.archivePipeline(pipeline.id)

        expect(archived.archived).toBe(true)
        expect(archived.archivedAt).toBeTruthy()
      })

      it('should not include archived pipelines in list by default', async () => {
        await engine.createPipeline({ label: 'Active', displayOrder: 0 })
        const toArchive = await engine.createPipeline({ label: 'To Archive', displayOrder: 1 })
        await engine.archivePipeline(toArchive.id)

        const pipelines = await engine.listPipelines()
        expect(pipelines.results).toHaveLength(1)
        expect(pipelines.results[0].label).toBe('Active')
      })

      it('should include archived pipelines when requested', async () => {
        await engine.createPipeline({ label: 'Active', displayOrder: 0 })
        const toArchive = await engine.createPipeline({ label: 'Archived', displayOrder: 1 })
        await engine.archivePipeline(toArchive.id)

        const pipelines = await engine.listPipelines({ includeArchived: true })
        expect(pipelines.results).toHaveLength(2)
      })
    })

    describe('listPipelines', () => {
      beforeEach(async () => {
        await engine.createPipeline({ label: 'Sales', displayOrder: 0 })
        await engine.createPipeline({ label: 'Enterprise', displayOrder: 1 })
        await engine.createPipeline({ label: 'Partner', displayOrder: 2 })
      })

      it('should list all active pipelines', async () => {
        const pipelines = await engine.listPipelines()

        expect(pipelines.results).toHaveLength(3)
      })

      it('should return pipelines sorted by display order', async () => {
        const pipelines = await engine.listPipelines()

        expect(pipelines.results[0].label).toBe('Sales')
        expect(pipelines.results[1].label).toBe('Enterprise')
        expect(pipelines.results[2].label).toBe('Partner')
      })

      it('should support pagination with limit', async () => {
        const pipelines = await engine.listPipelines({ limit: 2 })

        expect(pipelines.results).toHaveLength(2)
        expect(pipelines.paging?.next?.after).toBeTruthy()
      })

      it('should support pagination with after cursor', async () => {
        const page1 = await engine.listPipelines({ limit: 2 })
        const page2 = await engine.listPipelines({ limit: 2, after: page1.paging?.next?.after })

        expect(page2.results).toHaveLength(1)
        expect(page2.results[0].label).toBe('Partner')
      })
    })

    describe('getDefaultPipeline', () => {
      it('should return the pipeline with displayOrder 0', async () => {
        await engine.createPipeline({ label: 'Not Default', displayOrder: 1 })
        await engine.createPipeline({ label: 'Default', displayOrder: 0 })

        const defaultPipeline = await engine.getDefaultPipeline()

        expect(defaultPipeline.label).toBe('Default')
        expect(defaultPipeline.displayOrder).toBe(0)
      })

      it('should return the first pipeline when none has displayOrder 0', async () => {
        await engine.createPipeline({ label: 'Second', displayOrder: 2 })
        await engine.createPipeline({ label: 'First', displayOrder: 1 })

        const defaultPipeline = await engine.getDefaultPipeline()

        expect(defaultPipeline.label).toBe('First')
      })

      it('should throw error when no pipelines exist', async () => {
        await expect(engine.getDefaultPipeline()).rejects.toThrow(DealPipelineError)
        await expect(engine.getDefaultPipeline()).rejects.toMatchObject({
          category: 'NO_PIPELINES_EXIST',
        })
      })
    })
  })

  // ===========================================================================
  // STAGE MANAGEMENT (15+ tests)
  // ===========================================================================

  describe('Stage Management', () => {
    let pipelineId: string

    beforeEach(async () => {
      const pipeline = await engine.createPipeline({ label: 'Test Pipeline', displayOrder: 0 })
      pipelineId = pipeline.id
    })

    describe('createStage', () => {
      it('should create a stage in a pipeline', async () => {
        const stage = await engine.createStage(pipelineId, {
          label: 'New Stage',
          displayOrder: 0,
        })

        expect(stage).toBeDefined()
        expect(stage.id).toBeTruthy()
        expect(stage.label).toBe('New Stage')
        expect(stage.displayOrder).toBe(0)
        expect(stage.archived).toBe(false)
      })

      it('should create a stage with metadata', async () => {
        const stage = await engine.createStage(pipelineId, {
          label: 'Qualified',
          displayOrder: 0,
          metadata: {
            probability: '25',
            isClosed: 'false',
          },
        })

        expect(stage.metadata?.probability).toBe('25')
        expect(stage.metadata?.isClosed).toBe('false')
      })

      it('should add stage to pipeline stages array', async () => {
        await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })
        await engine.createStage(pipelineId, { label: 'Stage 2', displayOrder: 1 })

        const pipeline = await engine.getPipeline(pipelineId)
        expect(pipeline.stages).toHaveLength(2)
      })

      it('should throw error for duplicate stage label in same pipeline', async () => {
        await engine.createStage(pipelineId, { label: 'Duplicate', displayOrder: 0 })

        await expect(
          engine.createStage(pipelineId, { label: 'Duplicate', displayOrder: 1 })
        ).rejects.toThrow(DealPipelineError)

        await expect(
          engine.createStage(pipelineId, { label: 'Duplicate', displayOrder: 1 })
        ).rejects.toMatchObject({
          category: 'DUPLICATE_STAGE',
          statusCode: 409,
        })
      })

      it('should allow same stage label in different pipelines', async () => {
        const pipeline2 = await engine.createPipeline({ label: 'Pipeline 2', displayOrder: 1 })

        await engine.createStage(pipelineId, { label: 'Qualification', displayOrder: 0 })
        const stage2 = await engine.createStage(pipeline2.id, { label: 'Qualification', displayOrder: 0 })

        expect(stage2.label).toBe('Qualification')
      })

      it('should auto-assign display order based on existing stages', async () => {
        await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })
        await engine.createStage(pipelineId, { label: 'Stage 2', displayOrder: 1 })
        const stage3 = await engine.createStage(pipelineId, { label: 'Stage 3' })

        expect(stage3.displayOrder).toBe(2)
      })

      it('should throw error when adding stage to non-existent pipeline', async () => {
        await expect(
          engine.createStage('nonexistent-id', { label: 'Test', displayOrder: 0 })
        ).rejects.toThrow(DealPipelineError)
      })
    })

    describe('getStage', () => {
      it('should get a stage by ID', async () => {
        const created = await engine.createStage(pipelineId, { label: 'Test Stage', displayOrder: 0 })
        const retrieved = await engine.getStage(pipelineId, created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.label).toBe('Test Stage')
      })

      it('should throw error for non-existent stage', async () => {
        await expect(engine.getStage(pipelineId, 'nonexistent-id')).rejects.toThrow(DealPipelineError)

        await expect(engine.getStage(pipelineId, 'nonexistent-id')).rejects.toMatchObject({
          category: 'STAGE_NOT_FOUND',
          statusCode: 404,
        })
      })
    })

    describe('updateStage', () => {
      it('should update stage label', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'Original', displayOrder: 0 })
        const updated = await engine.updateStage(pipelineId, stage.id, { label: 'Updated' })

        expect(updated.label).toBe('Updated')
      })

      it('should update stage metadata', async () => {
        const stage = await engine.createStage(pipelineId, {
          label: 'Test',
          displayOrder: 0,
          metadata: { probability: '20' },
        })

        const updated = await engine.updateStage(pipelineId, stage.id, {
          metadata: { probability: '50', isClosed: 'false' },
        })

        expect(updated.metadata?.probability).toBe('50')
        expect(updated.metadata?.isClosed).toBe('false')
      })

      it('should update stage display order', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'Test', displayOrder: 0 })
        const updated = await engine.updateStage(pipelineId, stage.id, { displayOrder: 5 })

        expect(updated.displayOrder).toBe(5)
      })

      it('should throw error when updating non-existent stage', async () => {
        await expect(
          engine.updateStage(pipelineId, 'nonexistent-id', { label: 'Test' })
        ).rejects.toThrow(DealPipelineError)
      })
    })

    describe('deleteStage', () => {
      it('should delete a stage', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'To Delete', displayOrder: 0 })
        await engine.deleteStage(pipelineId, stage.id)

        await expect(engine.getStage(pipelineId, stage.id)).rejects.toThrow(DealPipelineError)
      })

      it('should remove stage from pipeline stages array', async () => {
        const stage1 = await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })
        await engine.createStage(pipelineId, { label: 'Stage 2', displayOrder: 1 })
        await engine.deleteStage(pipelineId, stage1.id)

        const pipeline = await engine.getPipeline(pipelineId)
        expect(pipeline.stages).toHaveLength(1)
        expect(pipeline.stages[0].label).toBe('Stage 2')
      })

      it('should prevent deletion if deals exist in stage', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'With Deals', displayOrder: 0 })
        await engine.registerDealInPipeline('deal-123', pipelineId, stage.id)

        await expect(engine.deleteStage(pipelineId, stage.id)).rejects.toThrow(DealPipelineError)
        await expect(engine.deleteStage(pipelineId, stage.id)).rejects.toMatchObject({
          category: 'STAGE_HAS_DEALS',
        })
      })

      it('should allow force deletion with deals', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'With Deals', displayOrder: 0 })
        await engine.registerDealInPipeline('deal-123', pipelineId, stage.id)

        await expect(engine.deleteStage(pipelineId, stage.id, { force: true })).resolves.not.toThrow()
      })
    })

    describe('archiveStage', () => {
      it('should archive a stage', async () => {
        const stage = await engine.createStage(pipelineId, { label: 'To Archive', displayOrder: 0 })
        const archived = await engine.archiveStage(pipelineId, stage.id)

        expect(archived.archived).toBe(true)
        expect(archived.archivedAt).toBeTruthy()
      })
    })

    describe('reorderStages', () => {
      it('should reorder stages by IDs', async () => {
        const stage1 = await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })
        const stage2 = await engine.createStage(pipelineId, { label: 'Stage 2', displayOrder: 1 })
        const stage3 = await engine.createStage(pipelineId, { label: 'Stage 3', displayOrder: 2 })

        await engine.reorderStages(pipelineId, [stage3.id, stage1.id, stage2.id])

        const pipeline = await engine.getPipeline(pipelineId)
        expect(pipeline.stages[0].id).toBe(stage3.id)
        expect(pipeline.stages[0].displayOrder).toBe(0)
        expect(pipeline.stages[1].id).toBe(stage1.id)
        expect(pipeline.stages[1].displayOrder).toBe(1)
        expect(pipeline.stages[2].id).toBe(stage2.id)
        expect(pipeline.stages[2].displayOrder).toBe(2)
      })

      it('should throw error if stage IDs do not match pipeline stages', async () => {
        await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })

        await expect(
          engine.reorderStages(pipelineId, ['invalid-id-1', 'invalid-id-2'])
        ).rejects.toThrow(DealPipelineError)
      })
    })

    describe('listStages', () => {
      it('should list all stages in a pipeline', async () => {
        await engine.createStage(pipelineId, { label: 'Stage 1', displayOrder: 0 })
        await engine.createStage(pipelineId, { label: 'Stage 2', displayOrder: 1 })
        await engine.createStage(pipelineId, { label: 'Stage 3', displayOrder: 2 })

        const stages = await engine.listStages(pipelineId)

        expect(stages.results).toHaveLength(3)
      })

      it('should return stages sorted by display order', async () => {
        await engine.createStage(pipelineId, { label: 'Third', displayOrder: 2 })
        await engine.createStage(pipelineId, { label: 'First', displayOrder: 0 })
        await engine.createStage(pipelineId, { label: 'Second', displayOrder: 1 })

        const stages = await engine.listStages(pipelineId)

        expect(stages.results[0].label).toBe('First')
        expect(stages.results[1].label).toBe('Second')
        expect(stages.results[2].label).toBe('Third')
      })
    })
  })

  // ===========================================================================
  // DEAL PROGRESSION (15+ tests)
  // ===========================================================================

  describe('Deal Progression', () => {
    let pipelineId: string
    let stages: PipelineStage[]

    beforeEach(async () => {
      const pipeline = await engine.createPipeline({
        label: 'Sales Pipeline',
        displayOrder: 0,
        stages: [
          { label: 'Qualification', displayOrder: 0, metadata: { probability: '20' } },
          { label: 'Demo', displayOrder: 1, metadata: { probability: '40' } },
          { label: 'Proposal', displayOrder: 2, metadata: { probability: '60' } },
          { label: 'Negotiation', displayOrder: 3, metadata: { probability: '80' } },
          { label: 'Closed Won', displayOrder: 4, metadata: { probability: '100', isClosed: 'true' } },
          { label: 'Closed Lost', displayOrder: 5, metadata: { probability: '0', isClosed: 'true' } },
        ],
      })
      pipelineId = pipeline.id
      stages = pipeline.stages
    })

    describe('registerDealInPipeline', () => {
      it('should register a deal in a pipeline stage', async () => {
        const result = await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)

        expect(result.dealId).toBe('deal-123')
        expect(result.pipelineId).toBe(pipelineId)
        expect(result.stageId).toBe(stages[0].id)
        expect(result.enteredStageAt).toBeTruthy()
      })

      it('should track deal history', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)

        const history = await engine.getDealHistory('deal-123')
        expect(history).toHaveLength(1)
        expect(history[0].stageId).toBe(stages[0].id)
      })

      it('should throw error for non-existent pipeline', async () => {
        await expect(
          engine.registerDealInPipeline('deal-123', 'nonexistent-pipeline', stages[0].id)
        ).rejects.toThrow(DealPipelineError)
      })

      it('should throw error for non-existent stage', async () => {
        await expect(
          engine.registerDealInPipeline('deal-123', pipelineId, 'nonexistent-stage')
        ).rejects.toThrow(DealPipelineError)
      })
    })

    describe('moveDealToStage', () => {
      it('should move a deal to a new stage', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        const result = await engine.moveDealToStage('deal-123', stages[1].id)

        expect(result.stageId).toBe(stages[1].id)
        expect(result.previousStageId).toBe(stages[0].id)
      })

      it('should track stage transitions in history', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[1].id)
        await engine.moveDealToStage('deal-123', stages[2].id)

        const history = await engine.getDealHistory('deal-123')
        expect(history).toHaveLength(3)
        expect(history[0].stageId).toBe(stages[0].id)
        expect(history[1].stageId).toBe(stages[1].id)
        expect(history[2].stageId).toBe(stages[2].id)
      })

      it('should calculate time in previous stage', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)

        await new Promise((resolve) => setTimeout(resolve, 50))

        const result = await engine.moveDealToStage('deal-123', stages[1].id)

        expect(result.timeInPreviousStage).toBeDefined()
        expect(result.timeInPreviousStage).toBeGreaterThanOrEqual(50)
      })

      it('should throw error when moving deal not in pipeline', async () => {
        await expect(engine.moveDealToStage('nonexistent-deal', stages[1].id)).rejects.toThrow(
          DealPipelineError
        )
        await expect(engine.moveDealToStage('nonexistent-deal', stages[1].id)).rejects.toMatchObject({
          category: 'DEAL_NOT_IN_PIPELINE',
        })
      })

      it('should allow moving deal to same stage (no-op with history)', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        const result = await engine.moveDealToStage('deal-123', stages[0].id)

        expect(result.stageId).toBe(stages[0].id)
      })

      it('should allow moving backwards in pipeline', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[2].id)
        const result = await engine.moveDealToStage('deal-123', stages[1].id)

        expect(result.stageId).toBe(stages[1].id)
      })
    })

    describe('getDealStage', () => {
      it('should get current stage for a deal', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[2].id)

        const currentStage = await engine.getDealStage('deal-123')

        expect(currentStage.stageId).toBe(stages[2].id)
        expect(currentStage.pipelineId).toBe(pipelineId)
      })

      it('should throw error for deal not in pipeline', async () => {
        await expect(engine.getDealStage('nonexistent-deal')).rejects.toThrow(DealPipelineError)
      })
    })

    describe('removeDealFromPipeline', () => {
      it('should remove a deal from pipeline tracking', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.removeDealFromPipeline('deal-123')

        await expect(engine.getDealStage('deal-123')).rejects.toThrow(DealPipelineError)
      })

      it('should preserve deal history after removal', async () => {
        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[1].id)
        await engine.removeDealFromPipeline('deal-123')

        const history = await engine.getDealHistory('deal-123')
        expect(history).toHaveLength(2)
      })
    })

    describe('moveDealToPipeline', () => {
      it('should move deal to a different pipeline', async () => {
        const pipeline2 = await engine.createPipeline({
          label: 'Partner Pipeline',
          displayOrder: 1,
          stages: [{ label: 'Start', displayOrder: 0 }],
        })

        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        const result = await engine.moveDealToPipeline('deal-123', pipeline2.id, pipeline2.stages[0].id)

        expect(result.pipelineId).toBe(pipeline2.id)
        expect(result.stageId).toBe(pipeline2.stages[0].id)
        expect(result.previousPipelineId).toBe(pipelineId)
      })

      it('should record pipeline change in history', async () => {
        const pipeline2 = await engine.createPipeline({
          label: 'Partner Pipeline',
          displayOrder: 1,
          stages: [{ label: 'Start', displayOrder: 0 }],
        })

        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToPipeline('deal-123', pipeline2.id, pipeline2.stages[0].id)

        const history = await engine.getDealHistory('deal-123')
        expect(history[1].pipelineId).toBe(pipeline2.id)
        expect(history[1].pipelineChanged).toBe(true)
      })
    })

    describe('listDealsInStage', () => {
      it('should list all deals in a stage', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-3', pipelineId, stages[1].id)

        const deals = await engine.listDealsInStage(pipelineId, stages[0].id)

        expect(deals.results).toHaveLength(2)
        expect(deals.results.map((d) => d.dealId)).toContain('deal-1')
        expect(deals.results.map((d) => d.dealId)).toContain('deal-2')
      })
    })

    describe('listDealsInPipeline', () => {
      it('should list all deals in a pipeline', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[1].id)
        await engine.registerDealInPipeline('deal-3', pipelineId, stages[2].id)

        const deals = await engine.listDealsInPipeline(pipelineId)

        expect(deals.results).toHaveLength(3)
      })

      it('should support filtering by stage', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[1].id)

        const deals = await engine.listDealsInPipeline(pipelineId, { stageId: stages[0].id })

        expect(deals.results).toHaveLength(1)
        expect(deals.results[0].dealId).toBe('deal-1')
      })
    })
  })

  // ===========================================================================
  // PIPELINE AUTOMATION (10+ tests)
  // ===========================================================================

  describe('Pipeline Automation', () => {
    let pipelineId: string
    let stages: PipelineStage[]

    beforeEach(async () => {
      const pipeline = await engine.createPipeline({
        label: 'Automated Pipeline',
        displayOrder: 0,
        stages: [
          { label: 'New', displayOrder: 0 },
          { label: 'Qualified', displayOrder: 1 },
          { label: 'Proposal', displayOrder: 2 },
          { label: 'Closed Won', displayOrder: 3, metadata: { isClosed: 'true' } },
          { label: 'Closed Lost', displayOrder: 4, metadata: { isClosed: 'true' } },
        ],
      })
      pipelineId = pipeline.id
      stages = pipeline.stages
    })

    describe('createAutomation', () => {
      it('should create a stage-based automation', async () => {
        const automation = await engine.createAutomation({
          pipelineId,
          name: 'Welcome Email',
          trigger: {
            type: 'stage_enter',
            stageId: stages[0].id,
          },
          action: {
            type: 'webhook',
            config: { url: 'https://api.example.com/welcome' },
          },
          enabled: true,
        })

        expect(automation).toBeDefined()
        expect(automation.id).toBeTruthy()
        expect(automation.name).toBe('Welcome Email')
        expect(automation.trigger.type).toBe('stage_enter')
        expect(automation.enabled).toBe(true)
      })

      it('should create a time-based automation', async () => {
        const automation = await engine.createAutomation({
          pipelineId,
          name: 'Follow-up Reminder',
          trigger: {
            type: 'time_in_stage',
            stageId: stages[1].id,
            durationMs: 3 * 24 * 60 * 60 * 1000, // 3 days
          },
          action: {
            type: 'notification',
            config: { message: 'Deal needs follow-up' },
          },
          enabled: true,
        })

        expect(automation.trigger.type).toBe('time_in_stage')
        expect(automation.trigger.durationMs).toBe(3 * 24 * 60 * 60 * 1000)
      })

      it('should create automation with conditions', async () => {
        const automation = await engine.createAutomation({
          pipelineId,
          name: 'High Value Alert',
          trigger: {
            type: 'stage_enter',
            stageId: stages[2].id,
          },
          conditions: [
            { field: 'amount', operator: 'gte', value: '50000' },
          ],
          action: {
            type: 'notification',
            config: { message: 'High value deal entered proposal stage' },
          },
          enabled: true,
        })

        expect(automation.conditions).toHaveLength(1)
        expect(automation.conditions![0].field).toBe('amount')
      })
    })

    describe('updateAutomation', () => {
      it('should update automation properties', async () => {
        const automation = await engine.createAutomation({
          pipelineId,
          name: 'Original',
          trigger: { type: 'stage_enter', stageId: stages[0].id },
          action: { type: 'webhook', config: { url: 'https://example.com' } },
          enabled: true,
        })

        const updated = await engine.updateAutomation(automation.id, {
          name: 'Updated',
          enabled: false,
        })

        expect(updated.name).toBe('Updated')
        expect(updated.enabled).toBe(false)
      })
    })

    describe('deleteAutomation', () => {
      it('should delete an automation', async () => {
        const automation = await engine.createAutomation({
          pipelineId,
          name: 'To Delete',
          trigger: { type: 'stage_enter', stageId: stages[0].id },
          action: { type: 'webhook', config: { url: 'https://example.com' } },
          enabled: true,
        })

        await engine.deleteAutomation(automation.id)

        await expect(engine.getAutomation(automation.id)).rejects.toThrow(DealPipelineError)
      })
    })

    describe('listAutomations', () => {
      it('should list all automations for a pipeline', async () => {
        await engine.createAutomation({
          pipelineId,
          name: 'Automation 1',
          trigger: { type: 'stage_enter', stageId: stages[0].id },
          action: { type: 'webhook', config: { url: 'https://example.com/1' } },
          enabled: true,
        })
        await engine.createAutomation({
          pipelineId,
          name: 'Automation 2',
          trigger: { type: 'stage_exit', stageId: stages[1].id },
          action: { type: 'webhook', config: { url: 'https://example.com/2' } },
          enabled: true,
        })

        const automations = await engine.listAutomations(pipelineId)

        expect(automations.results).toHaveLength(2)
      })

      it('should filter by enabled status', async () => {
        await engine.createAutomation({
          pipelineId,
          name: 'Enabled',
          trigger: { type: 'stage_enter', stageId: stages[0].id },
          action: { type: 'webhook', config: { url: 'https://example.com' } },
          enabled: true,
        })
        await engine.createAutomation({
          pipelineId,
          name: 'Disabled',
          trigger: { type: 'stage_enter', stageId: stages[0].id },
          action: { type: 'webhook', config: { url: 'https://example.com' } },
          enabled: false,
        })

        const enabled = await engine.listAutomations(pipelineId, { enabled: true })
        expect(enabled.results).toHaveLength(1)
        expect(enabled.results[0].name).toBe('Enabled')
      })
    })

    describe('triggerAutomations', () => {
      it('should trigger automations on stage enter', async () => {
        const actionFn = vi.fn()
        engine.onAutomationAction(actionFn)

        await engine.createAutomation({
          pipelineId,
          name: 'Stage Enter Trigger',
          trigger: { type: 'stage_enter', stageId: stages[1].id },
          action: { type: 'callback', config: { name: 'test_action' } },
          enabled: true,
        })

        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[1].id)

        expect(actionFn).toHaveBeenCalledWith(
          expect.objectContaining({
            dealId: 'deal-123',
            automationName: 'Stage Enter Trigger',
            action: expect.objectContaining({ type: 'callback' }),
          })
        )
      })

      it('should trigger automations on stage exit', async () => {
        const actionFn = vi.fn()
        engine.onAutomationAction(actionFn)

        await engine.createAutomation({
          pipelineId,
          name: 'Stage Exit Trigger',
          trigger: { type: 'stage_exit', stageId: stages[0].id },
          action: { type: 'callback', config: { name: 'exit_action' } },
          enabled: true,
        })

        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[1].id)

        expect(actionFn).toHaveBeenCalled()
      })

      it('should not trigger disabled automations', async () => {
        const actionFn = vi.fn()
        engine.onAutomationAction(actionFn)

        await engine.createAutomation({
          pipelineId,
          name: 'Disabled Automation',
          trigger: { type: 'stage_enter', stageId: stages[1].id },
          action: { type: 'callback', config: {} },
          enabled: false,
        })

        await engine.registerDealInPipeline('deal-123', pipelineId, stages[0].id)
        await engine.moveDealToStage('deal-123', stages[1].id)

        expect(actionFn).not.toHaveBeenCalled()
      })

      it('should evaluate conditions before triggering', async () => {
        const actionFn = vi.fn()
        engine.onAutomationAction(actionFn)

        await engine.createAutomation({
          pipelineId,
          name: 'Conditional Automation',
          trigger: { type: 'stage_enter', stageId: stages[1].id },
          conditions: [{ field: 'amount', operator: 'gte', value: '10000' }],
          action: { type: 'callback', config: {} },
          enabled: true,
        })

        // Deal with low amount - should not trigger
        await engine.registerDealInPipeline('deal-low', pipelineId, stages[0].id, { amount: '5000' })
        await engine.moveDealToStage('deal-low', stages[1].id)
        expect(actionFn).not.toHaveBeenCalled()

        // Deal with high amount - should trigger
        await engine.registerDealInPipeline('deal-high', pipelineId, stages[0].id, { amount: '15000' })
        await engine.moveDealToStage('deal-high', stages[1].id)
        expect(actionFn).toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // METRICS & ANALYTICS (5+ tests)
  // ===========================================================================

  describe('Metrics & Analytics', () => {
    let pipelineId: string
    let stages: PipelineStage[]

    beforeEach(async () => {
      const pipeline = await engine.createPipeline({
        label: 'Analytics Pipeline',
        displayOrder: 0,
        stages: [
          { label: 'New', displayOrder: 0 },
          { label: 'Qualified', displayOrder: 1 },
          { label: 'Proposal', displayOrder: 2 },
          { label: 'Closed Won', displayOrder: 3, metadata: { isClosed: 'true' } },
          { label: 'Closed Lost', displayOrder: 4, metadata: { isClosed: 'true' } },
        ],
      })
      pipelineId = pipeline.id
      stages = pipeline.stages
    })

    describe('getPipelineMetrics', () => {
      it('should return pipeline metrics', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[1].id)
        await engine.registerDealInPipeline('deal-3', pipelineId, stages[2].id)

        const metrics = await engine.getPipelineMetrics(pipelineId)

        expect(metrics.totalDeals).toBe(3)
        expect(metrics.dealsByStage).toBeDefined()
        expect(metrics.dealsByStage[stages[0].id]).toBe(1)
        expect(metrics.dealsByStage[stages[1].id]).toBe(1)
        expect(metrics.dealsByStage[stages[2].id]).toBe(1)
      })
    })

    describe('getStageMetrics', () => {
      it('should return stage-specific metrics', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[0].id)

        const metrics = await engine.getStageMetrics(pipelineId, stages[0].id)

        expect(metrics.dealsCount).toBe(2)
        expect(metrics.stageId).toBe(stages[0].id)
      })

      it('should calculate average time in stage', async () => {
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await new Promise((resolve) => setTimeout(resolve, 50))
        await engine.moveDealToStage('deal-1', stages[1].id)

        const metrics = await engine.getStageMetrics(pipelineId, stages[0].id)

        expect(metrics.avgTimeInStageMs).toBeGreaterThanOrEqual(50)
      })
    })

    describe('getConversionRate', () => {
      it('should calculate conversion rate between stages', async () => {
        // 3 deals enter stage 0, 2 move to stage 1
        await engine.registerDealInPipeline('deal-1', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-2', pipelineId, stages[0].id)
        await engine.registerDealInPipeline('deal-3', pipelineId, stages[0].id)

        await engine.moveDealToStage('deal-1', stages[1].id)
        await engine.moveDealToStage('deal-2', stages[1].id)

        const rate = await engine.getConversionRate(pipelineId, stages[0].id, stages[1].id)

        expect(rate).toBeCloseTo(66.67, 1) // 2/3 = 66.67%
      })
    })
  })
})
