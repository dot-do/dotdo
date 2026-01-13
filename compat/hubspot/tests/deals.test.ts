/**
 * @dotdo/hubspot/deals - HubSpot Deal Pipeline Operations Tests (RED Phase)
 *
 * Comprehensive failing tests for HubSpot deal pipeline operations.
 * These tests are designed to FAIL until the implementation is complete.
 *
 * Tests cover:
 * 1. Create Deal (10+ tests)
 * 2. Get Deal (5+ tests)
 * 3. Update Deal (8+ tests)
 * 4. Delete Deal (3+ tests)
 * 5. List Deals (5+ tests)
 * 6. Deal Pipelines (15+ tests)
 * 7. Deal Stages (12+ tests)
 * 8. Move Deal Through Stages (8+ tests)
 * 9. Deal Associations (15+ tests)
 *
 * @module @dotdo/hubspot/deals/tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HubSpotLocal,
  InMemoryStorage,
  type Deal,
  type Pipeline,
  type PipelineStage,
  type Contact,
  type Company,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/hubspot/deals - Deal Pipeline Operations', () => {
  let storage: InMemoryStorage
  let hubspot: HubSpotLocal

  beforeEach(async () => {
    storage = new InMemoryStorage()
    hubspot = new HubSpotLocal(storage)
    // Initialize default pipelines
    await hubspot.initialize()
  })

  // ===========================================================================
  // CREATE DEAL (10+ tests)
  // ===========================================================================

  describe('Create Deal', () => {
    it('should create a deal with required fields', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'New Sales Opportunity',
          dealstage: 'appointmentscheduled',
        },
      })

      expect(deal).toBeDefined()
      expect(deal.id).toBeTruthy()
      expect(deal.properties.dealname).toBe('New Sales Opportunity')
      expect(deal.properties.dealstage).toBe('appointmentscheduled')
      expect(deal.archived).toBe(false)
      expect(deal.createdAt).toBeTruthy()
      expect(deal.updatedAt).toBeTruthy()
    })

    it('should create a deal with amount', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Big Contract',
          dealstage: 'qualifiedtobuy',
          amount: '250000',
        },
      })

      expect(deal.properties.amount).toBe('250000')
    })

    it('should create a deal with custom pipeline', async () => {
      // First create a custom pipeline
      const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
        label: 'Enterprise Sales',
        displayOrder: 1,
        stages: [
          { id: 'enterprise_lead', label: 'Enterprise Lead', displayOrder: 0 },
          { id: 'enterprise_qual', label: 'Qualified', displayOrder: 1 },
          { id: 'enterprise_won', label: 'Closed Won', displayOrder: 2 },
        ],
      })

      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Enterprise Deal',
          dealstage: 'enterprise_lead',
          pipeline: pipeline.id,
        },
      })

      expect(deal.properties.pipeline).toBe(pipeline.id)
      expect(deal.properties.dealstage).toBe('enterprise_lead')
    })

    it('should create a deal with close date', async () => {
      const closeDate = '2025-12-31T00:00:00.000Z'
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Year End Deal',
          dealstage: 'appointmentscheduled',
          closedate: closeDate,
        },
      })

      expect(deal.properties.closedate).toBe(closeDate)
    })

    it('should create a deal with owner', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Assigned Deal',
          dealstage: 'appointmentscheduled',
          hubspot_owner_id: 'owner-12345',
        },
      })

      expect(deal.properties.hubspot_owner_id).toBe('owner-12345')
    })

    it('should create a deal with deal type', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Renewal',
          dealstage: 'appointmentscheduled',
          dealtype: 'existingbusiness',
        },
      })

      expect(deal.properties.dealtype).toBe('existingbusiness')
    })

    it('should create a deal with custom properties', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Custom Props Deal',
          dealstage: 'appointmentscheduled',
          custom_source: 'referral',
          custom_priority: 'high',
          custom_region: 'APAC',
        },
      })

      expect(deal.properties.custom_source).toBe('referral')
      expect(deal.properties.custom_priority).toBe('high')
      expect(deal.properties.custom_region).toBe('APAC')
    })

    it('should default pipeline to "default" when not specified', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Default Pipeline Deal',
          dealstage: 'appointmentscheduled',
        },
      })

      expect(deal.properties.pipeline).toBe('default')
    })

    it('should generate unique IDs for deals', async () => {
      const deal1 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal 1', dealstage: 'appointmentscheduled' },
      })
      const deal2 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal 2', dealstage: 'appointmentscheduled' },
      })

      expect(deal1.id).not.toBe(deal2.id)
    })

    it('should create a deal with description', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Descriptive Deal',
          dealstage: 'appointmentscheduled',
          description: 'This is a detailed description of the sales opportunity',
        },
      })

      expect(deal.properties.description).toBe('This is a detailed description of the sales opportunity')
    })
  })

  // ===========================================================================
  // GET DEAL (5+ tests)
  // ===========================================================================

  describe('Get Deal', () => {
    it('should get a deal by ID', async () => {
      const created = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Get Test', dealstage: 'appointmentscheduled', amount: '5000' },
      })

      const retrieved = await hubspot.crm.deals.basicApi.getById(created.id)

      expect(retrieved.id).toBe(created.id)
      expect(retrieved.properties.dealname).toBe('Get Test')
      expect(retrieved.properties.amount).toBe('5000')
    })

    it('should get a deal with specific properties', async () => {
      const created = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Props Test',
          dealstage: 'qualifiedtobuy',
          amount: '10000',
          description: 'Hidden',
        },
      })

      const retrieved = await hubspot.crm.deals.basicApi.getById(created.id, {
        properties: ['dealname', 'amount'],
      })

      expect(retrieved.properties.dealname).toBe('Props Test')
      expect(retrieved.properties.amount).toBe('10000')
    })

    it('should throw error for non-existent deal', async () => {
      await expect(
        hubspot.crm.deals.basicApi.getById('nonexistent-deal-id')
      ).rejects.toThrow()
    })

    it('should throw error for archived deal', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Archived Deal', dealstage: 'appointmentscheduled' },
      })
      await hubspot.crm.deals.basicApi.archive(deal.id)

      await expect(hubspot.crm.deals.basicApi.getById(deal.id)).rejects.toThrow()
    })

    it('should get deal with associations', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Assoc Deal', dealstage: 'appointmentscheduled' },
      })
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'deal-contact@example.com' },
      })

      await hubspot.crm.associations.v4.basicApi.create(
        'deals',
        deal.id,
        'contacts',
        contact.id,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
      )

      const retrieved = await hubspot.crm.deals.basicApi.getById(deal.id, {
        associations: ['contacts'],
      })

      expect(retrieved.associations).toBeDefined()
      expect(retrieved.associations?.contacts).toBeDefined()
    })
  })

  // ===========================================================================
  // UPDATE DEAL (8+ tests)
  // ===========================================================================

  describe('Update Deal', () => {
    it('should update deal name', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Original Name', dealstage: 'appointmentscheduled' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealname: 'Updated Name' },
      })

      expect(updated.properties.dealname).toBe('Updated Name')
    })

    it('should update deal amount', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Amount Deal', dealstage: 'appointmentscheduled', amount: '1000' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { amount: '5000' },
      })

      expect(updated.properties.amount).toBe('5000')
    })

    it('should update deal stage', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Stage Deal', dealstage: 'appointmentscheduled' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'qualifiedtobuy' },
      })

      expect(updated.properties.dealstage).toBe('qualifiedtobuy')
    })

    it('should preserve existing properties when updating', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Preserve Props',
          dealstage: 'appointmentscheduled',
          amount: '10000',
          description: 'Original description',
        },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealname: 'New Name' },
      })

      expect(updated.properties.dealname).toBe('New Name')
      expect(updated.properties.amount).toBe('10000')
      expect(updated.properties.description).toBe('Original description')
    })

    it('should update lastmodifieddate on update', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Modified Deal', dealstage: 'appointmentscheduled' },
      })
      const originalModified = deal.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealname: 'Modified' },
      })

      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalModified).getTime()
      )
    })

    it('should throw error when updating non-existent deal', async () => {
      await expect(
        hubspot.crm.deals.basicApi.update('nonexistent', { properties: { dealname: 'Test' } })
      ).rejects.toThrow()
    })

    it('should update deal owner', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Owner Deal', dealstage: 'appointmentscheduled' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { hubspot_owner_id: 'new-owner-id' },
      })

      expect(updated.properties.hubspot_owner_id).toBe('new-owner-id')
    })

    it('should update deal close date', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Date Deal',
          dealstage: 'appointmentscheduled',
          closedate: '2025-06-30T00:00:00.000Z',
        },
      })

      const newCloseDate = '2025-12-31T00:00:00.000Z'
      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { closedate: newCloseDate },
      })

      expect(updated.properties.closedate).toBe(newCloseDate)
    })
  })

  // ===========================================================================
  // DELETE DEAL (3+ tests)
  // ===========================================================================

  describe('Delete Deal', () => {
    it('should archive (soft delete) a deal', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Archive Me', dealstage: 'appointmentscheduled' },
      })

      await hubspot.crm.deals.basicApi.archive(deal.id)

      await expect(hubspot.crm.deals.basicApi.getById(deal.id)).rejects.toThrow()
    })

    it('should throw error when archiving non-existent deal', async () => {
      await expect(
        hubspot.crm.deals.basicApi.archive('nonexistent-deal')
      ).rejects.toThrow()
    })

    it('should clean up associations when archiving deal', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Assoc Archive', dealstage: 'appointmentscheduled' },
      })
      const contact = await hubspot.crm.contacts.basicApi.create({
        properties: { email: 'cleanup@example.com' },
      })

      await hubspot.crm.associations.v4.basicApi.create(
        'deals',
        deal.id,
        'contacts',
        contact.id,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
      )

      await hubspot.crm.deals.basicApi.archive(deal.id)

      // The contact should no longer have association to the archived deal
      const contactDeals = await hubspot.crm.associations.v4.basicApi.getAll(
        'contacts',
        contact.id,
        'deals'
      )
      expect(contactDeals.results).toHaveLength(0)
    })
  })

  // ===========================================================================
  // LIST DEALS (5+ tests)
  // ===========================================================================

  describe('List Deals', () => {
    beforeEach(async () => {
      await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal Alpha', dealstage: 'appointmentscheduled', amount: '10000' },
      })
      await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal Beta', dealstage: 'qualifiedtobuy', amount: '25000' },
      })
      await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Deal Gamma', dealstage: 'closedwon', amount: '50000' },
      })
    })

    it('should list all deals', async () => {
      const result = await hubspot.crm.deals.basicApi.getPage()

      expect(result.results).toHaveLength(3)
    })

    it('should list deals with pagination', async () => {
      const page1 = await hubspot.crm.deals.basicApi.getPage({ limit: 2 })

      expect(page1.results).toHaveLength(2)
      expect(page1.paging?.next?.after).toBeTruthy()
    })

    it('should list deals with cursor pagination', async () => {
      const page1 = await hubspot.crm.deals.basicApi.getPage({ limit: 2 })
      const page2 = await hubspot.crm.deals.basicApi.getPage({
        limit: 2,
        after: page1.paging?.next?.after,
      })

      expect(page2.results).toHaveLength(1)
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })

    it('should not include archived deals in list', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Archived Deal', dealstage: 'appointmentscheduled' },
      })
      await hubspot.crm.deals.basicApi.archive(deal.id)

      const result = await hubspot.crm.deals.basicApi.getPage()

      expect(result.results.find((d) => d.id === deal.id)).toBeUndefined()
    })

    it('should list deals with specific properties', async () => {
      const result = await hubspot.crm.deals.basicApi.getPage({
        properties: ['dealname', 'amount'],
      })

      expect(result.results[0].properties.dealname).toBeTruthy()
      expect(result.results[0].properties.amount).toBeTruthy()
    })
  })

  // ===========================================================================
  // DEAL PIPELINES (15+ tests)
  // ===========================================================================

  describe('Deal Pipelines', () => {
    describe('Get Pipelines', () => {
      it('should get all deal pipelines', async () => {
        const result = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')

        expect(result.results).toBeDefined()
        expect(Array.isArray(result.results)).toBe(true)
      })

      it('should include default pipeline', async () => {
        const result = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')

        const defaultPipeline = result.results.find((p) => p.id === 'default')
        expect(defaultPipeline).toBeDefined()
        expect(defaultPipeline?.label).toBeTruthy()
      })

      it('should get a specific pipeline by ID', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.getById('deals', 'default')

        expect(pipeline).toBeDefined()
        expect(pipeline.id).toBe('default')
        expect(pipeline.stages).toBeDefined()
        expect(Array.isArray(pipeline.stages)).toBe(true)
      })

      it('should throw error for non-existent pipeline', async () => {
        await expect(
          hubspot.crm.pipelines.pipelinesApi.getById('deals', 'nonexistent')
        ).rejects.toThrow()
      })
    })

    describe('Create Pipeline', () => {
      it('should create a new deal pipeline', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Partner Sales',
          displayOrder: 2,
          stages: [
            { id: 'partner_lead', label: 'Partner Lead', displayOrder: 0 },
            { id: 'partner_qualified', label: 'Partner Qualified', displayOrder: 1 },
            { id: 'partner_won', label: 'Partner Won', displayOrder: 2 },
          ],
        })

        expect(pipeline).toBeDefined()
        expect(pipeline.id).toBeTruthy()
        expect(pipeline.label).toBe('Partner Sales')
        expect(pipeline.stages).toHaveLength(3)
      })

      it('should create pipeline with metadata on stages', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Weighted Pipeline',
          displayOrder: 3,
          stages: [
            {
              id: 'stage_10',
              label: '10% Probability',
              displayOrder: 0,
              metadata: { probability: '0.1' },
            },
            {
              id: 'stage_50',
              label: '50% Probability',
              displayOrder: 1,
              metadata: { probability: '0.5' },
            },
            {
              id: 'stage_100',
              label: 'Closed Won',
              displayOrder: 2,
              metadata: { probability: '1.0', isClosed: 'true' },
            },
          ],
        })

        expect(pipeline.stages[0].metadata?.probability).toBe('0.1')
        expect(pipeline.stages[2].metadata?.isClosed).toBe('true')
      })

      it('should generate unique pipeline IDs', async () => {
        const pipeline1 = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Pipeline 1',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage 1', displayOrder: 0 }],
        })
        const pipeline2 = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Pipeline 2',
          displayOrder: 2,
          stages: [{ id: 's1', label: 'Stage 1', displayOrder: 0 }],
        })

        expect(pipeline1.id).not.toBe(pipeline2.id)
      })
    })

    describe('Update Pipeline', () => {
      it('should update pipeline label', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Original Label',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage', displayOrder: 0 }],
        })

        const updated = await hubspot.crm.pipelines.pipelinesApi.update('deals', pipeline.id, {
          label: 'Updated Label',
        })

        expect(updated.label).toBe('Updated Label')
      })

      it('should update pipeline display order', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Reorder Pipeline',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage', displayOrder: 0 }],
        })

        const updated = await hubspot.crm.pipelines.pipelinesApi.update('deals', pipeline.id, {
          displayOrder: 5,
        })

        expect(updated.displayOrder).toBe(5)
      })

      it('should update pipeline stages', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Stage Update Pipeline',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage 1', displayOrder: 0 }],
        })

        const updated = await hubspot.crm.pipelines.pipelinesApi.update('deals', pipeline.id, {
          stages: [
            { id: 's1', label: 'Stage 1', displayOrder: 0 },
            { id: 's2', label: 'Stage 2', displayOrder: 1 },
          ],
        })

        expect(updated.stages).toHaveLength(2)
      })
    })

    describe('Archive Pipeline', () => {
      it('should archive a pipeline', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Archive Me Pipeline',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage', displayOrder: 0 }],
        })

        await hubspot.crm.pipelines.pipelinesApi.archive('deals', pipeline.id)

        await expect(
          hubspot.crm.pipelines.pipelinesApi.getById('deals', pipeline.id)
        ).rejects.toThrow()
      })

      it('should not include archived pipeline in list', async () => {
        const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
          label: 'Hidden Pipeline',
          displayOrder: 1,
          stages: [{ id: 's1', label: 'Stage', displayOrder: 0 }],
        })

        await hubspot.crm.pipelines.pipelinesApi.archive('deals', pipeline.id)

        const result = await hubspot.crm.pipelines.pipelinesApi.getAll('deals')
        expect(result.results.find((p) => p.id === pipeline.id)).toBeUndefined()
      })

      it('should throw error when archiving non-existent pipeline', async () => {
        await expect(
          hubspot.crm.pipelines.pipelinesApi.archive('deals', 'nonexistent')
        ).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // DEAL STAGES (12+ tests)
  // ===========================================================================

  describe('Deal Stages', () => {
    describe('Get Stages', () => {
      it('should get all stages for a pipeline', async () => {
        const result = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')

        expect(result.results).toBeDefined()
        expect(Array.isArray(result.results)).toBe(true)
        expect(result.results.length).toBeGreaterThan(0)
      })

      it('should get a specific stage by ID', async () => {
        const stages = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')
        const firstStageId = stages.results[0].id

        const stage = await hubspot.crm.pipelines.pipelineStagesApi.getById(
          'deals',
          'default',
          firstStageId
        )

        expect(stage).toBeDefined()
        expect(stage.id).toBe(firstStageId)
      })

      it('should throw error for non-existent stage', async () => {
        await expect(
          hubspot.crm.pipelines.pipelineStagesApi.getById('deals', 'default', 'nonexistent')
        ).rejects.toThrow()
      })

      it('should return stages with proper ordering', async () => {
        const result = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')

        const orders = result.results.map((s) => s.displayOrder)
        expect(orders).toEqual([...orders].sort((a, b) => a - b))
      })
    })

    describe('Create Stage', () => {
      it('should create a new stage in a pipeline', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Custom Stage',
          displayOrder: 99,
        })

        expect(stage).toBeDefined()
        expect(stage.id).toBeTruthy()
        expect(stage.label).toBe('Custom Stage')
      })

      it('should create stage with metadata', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Weighted Stage',
          displayOrder: 100,
          metadata: { probability: '0.75' },
        })

        expect(stage.metadata?.probability).toBe('0.75')
      })

      it('should add stage to pipeline stages array', async () => {
        await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Added Stage',
          displayOrder: 101,
        })

        const stages = await hubspot.crm.pipelines.pipelineStagesApi.getAll('deals', 'default')
        const addedStage = stages.results.find((s) => s.label === 'Added Stage')

        expect(addedStage).toBeDefined()
      })
    })

    describe('Update Stage', () => {
      it('should update stage label', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Original Stage',
          displayOrder: 102,
        })

        const updated = await hubspot.crm.pipelines.pipelineStagesApi.update(
          'deals',
          'default',
          stage.id,
          { label: 'Updated Stage' }
        )

        expect(updated.label).toBe('Updated Stage')
      })

      it('should update stage display order', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Reorder Stage',
          displayOrder: 50,
        })

        const updated = await hubspot.crm.pipelines.pipelineStagesApi.update(
          'deals',
          'default',
          stage.id,
          { displayOrder: 25 }
        )

        expect(updated.displayOrder).toBe(25)
      })

      it('should update stage metadata', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Meta Stage',
          displayOrder: 103,
          metadata: { probability: '0.5' },
        })

        const updated = await hubspot.crm.pipelines.pipelineStagesApi.update(
          'deals',
          'default',
          stage.id,
          { metadata: { probability: '0.75' } }
        )

        expect(updated.metadata?.probability).toBe('0.75')
      })
    })

    describe('Archive Stage', () => {
      it('should archive (remove) a stage from pipeline', async () => {
        const stage = await hubspot.crm.pipelines.pipelineStagesApi.create('deals', 'default', {
          label: 'Archive Stage',
          displayOrder: 104,
        })

        await hubspot.crm.pipelines.pipelineStagesApi.archive('deals', 'default', stage.id)

        await expect(
          hubspot.crm.pipelines.pipelineStagesApi.getById('deals', 'default', stage.id)
        ).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // MOVE DEAL THROUGH STAGES (8+ tests)
  // ===========================================================================

  describe('Move Deal Through Stages', () => {
    it('should move deal forward through stages', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Progress Deal', dealstage: 'appointmentscheduled' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'qualifiedtobuy' },
      })

      expect(updated.properties.dealstage).toBe('qualifiedtobuy')
    })

    it('should move deal backward through stages', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Regress Deal', dealstage: 'qualifiedtobuy' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'appointmentscheduled' },
      })

      expect(updated.properties.dealstage).toBe('appointmentscheduled')
    })

    it('should move deal to closed won', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Won Deal', dealstage: 'decisionmakerboughtin' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'closedwon' },
      })

      expect(updated.properties.dealstage).toBe('closedwon')
    })

    it('should move deal to closed lost', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Lost Deal', dealstage: 'qualifiedtobuy' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'closedlost' },
      })

      expect(updated.properties.dealstage).toBe('closedlost')
    })

    it('should reopen closed deal', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Reopen Deal', dealstage: 'closedlost' },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'appointmentscheduled' },
      })

      expect(updated.properties.dealstage).toBe('appointmentscheduled')
    })

    it('should move deal to custom stage in custom pipeline', async () => {
      const pipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
        label: 'Custom Move Pipeline',
        displayOrder: 10,
        stages: [
          { id: 'custom_new', label: 'New', displayOrder: 0 },
          { id: 'custom_progress', label: 'In Progress', displayOrder: 1 },
          { id: 'custom_complete', label: 'Complete', displayOrder: 2 },
        ],
      })

      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Custom Pipeline Deal',
          dealstage: 'custom_new',
          pipeline: pipeline.id,
        },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'custom_complete' },
      })

      expect(updated.properties.dealstage).toBe('custom_complete')
    })

    it('should change deal pipeline and stage simultaneously', async () => {
      const newPipeline = await hubspot.crm.pipelines.pipelinesApi.create('deals', {
        label: 'Target Pipeline',
        displayOrder: 11,
        stages: [{ id: 'target_stage', label: 'Target Stage', displayOrder: 0 }],
      })

      const deal = await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Pipeline Switch Deal',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
        },
      })

      const updated = await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: {
          pipeline: newPipeline.id,
          dealstage: 'target_stage',
        },
      })

      expect(updated.properties.pipeline).toBe(newPipeline.id)
      expect(updated.properties.dealstage).toBe('target_stage')
    })

    it('should track stage history', async () => {
      const deal = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'History Deal', dealstage: 'appointmentscheduled' },
      })

      await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'qualifiedtobuy' },
      })
      await hubspot.crm.deals.basicApi.update(deal.id, {
        properties: { dealstage: 'closedwon' },
      })

      // Implementation should track stage history
      const retrieved = await hubspot.crm.deals.basicApi.getById(deal.id, {
        propertiesWithHistory: ['dealstage'],
      })

      expect(retrieved.propertiesWithHistory).toBeDefined()
      expect(retrieved.propertiesWithHistory?.dealstage).toBeDefined()
      expect(retrieved.propertiesWithHistory?.dealstage.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ===========================================================================
  // DEAL ASSOCIATIONS (15+ tests)
  // ===========================================================================

  describe('Deal Associations', () => {
    describe('Associate Deal to Contact', () => {
      it('should associate a deal to a contact', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Contact Deal', dealstage: 'appointmentscheduled' },
        })
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'deal-contact@example.com', firstname: 'Deal', lastname: 'Contact' },
        })

        const result = await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )

        expect(result).toBeDefined()
      })

      it('should get deal associations with contacts', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Contacts Deal', dealstage: 'appointmentscheduled' },
        })
        const contact1 = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'contact1@example.com' },
        })
        const contact2 = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'contact2@example.com' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact1.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact2.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'contacts'
        )

        expect(associations.results).toHaveLength(2)
      })

      it('should remove deal-contact association', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Remove Assoc Deal', dealstage: 'appointmentscheduled' },
        })
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'remove-assoc@example.com' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )

        await hubspot.crm.associations.v4.basicApi.archive(
          'deals',
          deal.id,
          'contacts',
          contact.id
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'contacts'
        )
        expect(associations.results).toHaveLength(0)
      })
    })

    describe('Associate Deal to Company', () => {
      it('should associate a deal to a company', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Company Deal', dealstage: 'appointmentscheduled' },
        })
        const company = await hubspot.crm.companies.basicApi.create({
          properties: { name: 'Deal Company', domain: 'dealcompany.com' },
        })

        const result = await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'companies',
          company.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }]
        )

        expect(result).toBeDefined()
      })

      it('should get deal associations with companies', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Multi Company Deal', dealstage: 'appointmentscheduled' },
        })
        const company1 = await hubspot.crm.companies.basicApi.create({
          properties: { name: 'Company 1' },
        })
        const company2 = await hubspot.crm.companies.basicApi.create({
          properties: { name: 'Company 2' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'companies',
          company1.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'companies',
          company2.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'companies'
        )

        expect(associations.results).toHaveLength(2)
      })

      it('should set primary company for deal', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Primary Company Deal', dealstage: 'appointmentscheduled' },
        })
        const company = await hubspot.crm.companies.basicApi.create({
          properties: { name: 'Primary Company' },
        })

        // Primary association uses typeId 341
        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'companies',
          company.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'companies'
        )

        expect(associations.results).toHaveLength(1)
        expect(associations.results[0].associationTypes[0].typeId).toBe(341)
      })
    })

    describe('Associate Deal to Line Items', () => {
      it('should associate line item to deal', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Line Item Deal', dealstage: 'appointmentscheduled' },
        })
        const lineItem = await hubspot.crm.lineItems.basicApi.create({
          properties: { name: 'Product A', quantity: '2', price: '500' },
        })

        const result = await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'line_items',
          lineItem.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 19 }]
        )

        expect(result).toBeDefined()
      })

      it('should get all line items for a deal', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Multi Line Deal', dealstage: 'appointmentscheduled' },
        })
        const lineItem1 = await hubspot.crm.lineItems.basicApi.create({
          properties: { name: 'Product 1', quantity: '1', price: '100' },
        })
        const lineItem2 = await hubspot.crm.lineItems.basicApi.create({
          properties: { name: 'Product 2', quantity: '3', price: '200' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'line_items',
          lineItem1.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 19 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'line_items',
          lineItem2.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 19 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'line_items'
        )

        expect(associations.results).toHaveLength(2)
      })
    })

    describe('Batch Associations', () => {
      it('should batch create deal-contact associations', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Batch Assoc Deal', dealstage: 'appointmentscheduled' },
        })
        const contact1 = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'batch1@example.com' },
        })
        const contact2 = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'batch2@example.com' },
        })

        const result = await hubspot.crm.associations.v4.batchApi.create(
          'deals',
          'contacts',
          {
            inputs: [
              {
                from: { id: deal.id },
                to: { id: contact1.id },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
              },
              {
                from: { id: deal.id },
                to: { id: contact2.id },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
              },
            ],
          }
        )

        expect(result.status).toBe('COMPLETE')
        expect(result.results).toHaveLength(2)
      })

      it('should batch read deal associations', async () => {
        const deal1 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Batch Read 1', dealstage: 'appointmentscheduled' },
        })
        const deal2 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Batch Read 2', dealstage: 'appointmentscheduled' },
        })
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'batch-read@example.com' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal1.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal2.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )

        const result = await hubspot.crm.associations.v4.batchApi.read(
          'deals',
          'contacts',
          { inputs: [{ id: deal1.id }, { id: deal2.id }] }
        )

        expect(result.results).toHaveLength(2)
      })
    })

    describe('Association Labels', () => {
      it('should create association with custom label', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Label Deal', dealstage: 'appointmentscheduled' },
        })
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'labeled@example.com' },
        })

        // Custom user-defined association type
        const result = await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'USER_DEFINED', associationTypeId: 100 }]
        )

        expect(result).toBeDefined()
      })

      it('should get associations with labels', async () => {
        const deal = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Labels Get Deal', dealstage: 'appointmentscheduled' },
        })
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'labels-get@example.com' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'deals',
          deal.id,
          'contacts',
          contact.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'deals',
          deal.id,
          'contacts'
        )

        expect(associations.results[0].associationTypes).toBeDefined()
        expect(associations.results[0].associationTypes.length).toBeGreaterThan(0)
      })
    })

    describe('Cross-Object Association Queries', () => {
      it('should find deals for a specific contact', async () => {
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: { email: 'multi-deal@example.com' },
        })
        const deal1 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Contact Deal 1', dealstage: 'appointmentscheduled' },
        })
        const deal2 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Contact Deal 2', dealstage: 'qualifiedtobuy' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'contacts',
          contact.id,
          'deals',
          deal1.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 4 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'contacts',
          contact.id,
          'deals',
          deal2.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 4 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'contacts',
          contact.id,
          'deals'
        )

        expect(associations.results).toHaveLength(2)
      })

      it('should find deals for a specific company', async () => {
        const company = await hubspot.crm.companies.basicApi.create({
          properties: { name: 'Multi Deal Company' },
        })
        const deal1 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Company Deal 1', dealstage: 'appointmentscheduled' },
        })
        const deal2 = await hubspot.crm.deals.basicApi.create({
          properties: { dealname: 'Company Deal 2', dealstage: 'qualifiedtobuy' },
        })

        await hubspot.crm.associations.v4.basicApi.create(
          'companies',
          company.id,
          'deals',
          deal1.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 6 }]
        )
        await hubspot.crm.associations.v4.basicApi.create(
          'companies',
          company.id,
          'deals',
          deal2.id,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 6 }]
        )

        const associations = await hubspot.crm.associations.v4.basicApi.getAll(
          'companies',
          company.id,
          'deals'
        )

        expect(associations.results).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // SEARCH DEALS (Additional tests)
  // ===========================================================================

  describe('Search Deals', () => {
    beforeEach(async () => {
      await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Enterprise Deal',
          dealstage: 'qualifiedtobuy',
          amount: '100000',
          pipeline: 'default',
        },
      })
      await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'SMB Deal',
          dealstage: 'appointmentscheduled',
          amount: '5000',
          pipeline: 'default',
        },
      })
      await hubspot.crm.deals.basicApi.create({
        properties: {
          dealname: 'Won Deal',
          dealstage: 'closedwon',
          amount: '50000',
          pipeline: 'default',
        },
      })
    })

    it('should search deals by query', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        query: 'Enterprise',
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.dealname).toBe('Enterprise Deal')
    })

    it('should search deals by stage filter', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.dealname).toBe('Won Deal')
    })

    it('should search deals by amount range', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'amount', operator: 'GTE', value: '50000' }],
          },
        ],
      })

      expect(result.total).toBe(2) // Enterprise and Won
    })

    it('should search deals with multiple filters', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
              { propertyName: 'amount', operator: 'GTE', value: '10000' },
            ],
          },
        ],
      })

      expect(result.total).toBe(1)
      expect(result.results[0].properties.dealname).toBe('Enterprise Deal')
    })

    it('should search deals with sorting', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        sorts: [{ propertyName: 'amount', direction: 'DESCENDING' }],
      })

      expect(result.results[0].properties.dealname).toBe('Enterprise Deal')
    })

    it('should search deals by pipeline', async () => {
      const result = await hubspot.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [{ propertyName: 'pipeline', operator: 'EQ', value: 'default' }],
          },
        ],
      })

      expect(result.total).toBe(3)
    })
  })

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  describe('Batch Operations', () => {
    it('should batch create deals', async () => {
      const result = await hubspot.crm.deals.batchApi.create({
        inputs: [
          { properties: { dealname: 'Batch Deal 1', dealstage: 'appointmentscheduled' } },
          { properties: { dealname: 'Batch Deal 2', dealstage: 'qualifiedtobuy' } },
          { properties: { dealname: 'Batch Deal 3', dealstage: 'closedwon', amount: '10000' } },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(3)
    })

    it('should batch read deals', async () => {
      const deal1 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Read Deal 1', dealstage: 'appointmentscheduled' },
      })
      const deal2 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Read Deal 2', dealstage: 'qualifiedtobuy' },
      })

      const result = await hubspot.crm.deals.batchApi.read({
        inputs: [{ id: deal1.id }, { id: deal2.id }],
        properties: ['dealname', 'dealstage'],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
    })

    it('should batch update deals', async () => {
      const deal1 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Update Deal 1', dealstage: 'appointmentscheduled' },
      })
      const deal2 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Update Deal 2', dealstage: 'appointmentscheduled' },
      })

      const result = await hubspot.crm.deals.batchApi.update({
        inputs: [
          { id: deal1.id, properties: { dealstage: 'qualifiedtobuy' } },
          { id: deal2.id, properties: { dealstage: 'closedwon' } },
        ],
      })

      expect(result.status).toBe('COMPLETE')
      expect(result.results).toHaveLength(2)
    })

    it('should batch archive deals', async () => {
      const deal1 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Archive Deal 1', dealstage: 'appointmentscheduled' },
      })
      const deal2 = await hubspot.crm.deals.basicApi.create({
        properties: { dealname: 'Archive Deal 2', dealstage: 'appointmentscheduled' },
      })

      const result = await hubspot.crm.deals.batchApi.archive({
        inputs: [{ id: deal1.id }, { id: deal2.id }],
      })

      expect(result).toBeUndefined() // Archive typically returns void

      await expect(hubspot.crm.deals.basicApi.getById(deal1.id)).rejects.toThrow()
      await expect(hubspot.crm.deals.basicApi.getById(deal2.id)).rejects.toThrow()
    })

    it('should handle partial failures in batch create', async () => {
      // Create a duplicate scenario or invalid data
      const result = await hubspot.crm.deals.batchApi.create({
        inputs: [
          { properties: { dealname: 'Valid Deal', dealstage: 'appointmentscheduled' } },
          { properties: { dealname: '', dealstage: 'appointmentscheduled' } }, // Invalid - empty name
        ],
      })

      expect(result.results.length + (result.errors?.length ?? 0)).toBe(2)
    })
  })
})
