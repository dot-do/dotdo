/**
 * Workflow Visibility API Tests
 *
 * Tests for Temporal-like workflow visibility - list and query running workflows.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WorkflowVisibilityStore,
  createWorkflowVisibilityStore,
} from '../store'
import {
  WorkflowMetadata,
  WorkflowStatus,
  WorkflowQuery,
  ListWorkflowsOptions,
  ListWorkflowsResult,
} from '../types'
import { listWorkflows, queryWorkflows } from '../index'

describe('Workflow Visibility API', () => {
  let store: WorkflowVisibilityStore

  beforeEach(() => {
    store = createWorkflowVisibilityStore()
  })

  // ============================================================================
  // Store and Retrieve Workflow Metadata
  // ============================================================================

  describe('store and retrieve workflow metadata', () => {
    it('should store workflow metadata on start', async () => {
      const metadata: WorkflowMetadata = {
        workflowId: 'order-123',
        runId: 'run-abc',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
        searchAttributes: { customerId: 'cust-456' },
      }

      await store.upsert(metadata)
      const retrieved = await store.get('order-123')

      expect(retrieved).toEqual(metadata)
    })

    it('should update workflow metadata on complete', async () => {
      const metadata: WorkflowMetadata = {
        workflowId: 'order-123',
        runId: 'run-abc',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      }

      await store.upsert(metadata)

      const completedMetadata: WorkflowMetadata = {
        ...metadata,
        status: WorkflowStatus.COMPLETED,
        closeTime: new Date('2026-01-10T10:05:00Z'),
      }

      await store.upsert(completedMetadata)
      const retrieved = await store.get('order-123')

      expect(retrieved?.status).toBe(WorkflowStatus.COMPLETED)
      expect(retrieved?.closeTime).toEqual(new Date('2026-01-10T10:05:00Z'))
    })

    it('should update workflow metadata on fail', async () => {
      const metadata: WorkflowMetadata = {
        workflowId: 'order-123',
        runId: 'run-abc',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      }

      await store.upsert(metadata)

      const failedMetadata: WorkflowMetadata = {
        ...metadata,
        status: WorkflowStatus.FAILED,
        closeTime: new Date('2026-01-10T10:02:00Z'),
      }

      await store.upsert(failedMetadata)
      const retrieved = await store.get('order-123')

      expect(retrieved?.status).toBe(WorkflowStatus.FAILED)
    })

    it('should return null for non-existent workflow', async () => {
      const retrieved = await store.get('non-existent')
      expect(retrieved).toBeNull()
    })
  })

  // ============================================================================
  // Query by Type
  // ============================================================================

  describe('query by type', () => {
    beforeEach(async () => {
      // Add test workflows of different types
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'order-2',
        runId: 'run-2',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:01:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'payment-1',
        runId: 'run-3',
        workflowType: 'paymentWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:02:00Z'),
        taskQueue: 'payments',
      })
    })

    it('should filter workflows by type', async () => {
      const result = await listWorkflows(store, {
        query: 'WorkflowType = "orderWorkflow"',
      })

      expect(result.workflows).toHaveLength(2)
      expect(result.workflows.every(w => w.workflowType === 'orderWorkflow')).toBe(true)
    })

    it('should return empty for non-matching type', async () => {
      const result = await listWorkflows(store, {
        query: 'WorkflowType = "nonExistentWorkflow"',
      })

      expect(result.workflows).toHaveLength(0)
    })
  })

  // ============================================================================
  // Query by Status
  // ============================================================================

  describe('query by status', () => {
    beforeEach(async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'order-2',
        runId: 'run-2',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date('2026-01-10T10:01:00Z'),
        closeTime: new Date('2026-01-10T10:05:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'order-3',
        runId: 'run-3',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.FAILED,
        startTime: new Date('2026-01-10T10:02:00Z'),
        closeTime: new Date('2026-01-10T10:03:00Z'),
        taskQueue: 'orders',
      })
    })

    it('should filter workflows by RUNNING status', async () => {
      const result = await listWorkflows(store, {
        query: 'Status = "RUNNING"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].workflowId).toBe('order-1')
    })

    it('should filter workflows by COMPLETED status', async () => {
      const result = await listWorkflows(store, {
        query: 'Status = "COMPLETED"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].workflowId).toBe('order-2')
    })

    it('should filter workflows by FAILED status', async () => {
      const result = await listWorkflows(store, {
        query: 'Status = "FAILED"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].workflowId).toBe('order-3')
    })
  })

  // ============================================================================
  // Pagination
  // ============================================================================

  describe('pagination', () => {
    beforeEach(async () => {
      // Add 10 test workflows
      for (let i = 1; i <= 10; i++) {
        await store.upsert({
          workflowId: `order-${i}`,
          runId: `run-${i}`,
          workflowType: 'orderWorkflow',
          status: WorkflowStatus.RUNNING,
          startTime: new Date(`2026-01-10T10:${String(i).padStart(2, '0')}:00Z`),
          taskQueue: 'orders',
        })
      }
    })

    it('should respect pageSize limit', async () => {
      const result = await listWorkflows(store, {
        pageSize: 3,
      })

      expect(result.workflows).toHaveLength(3)
      expect(result.nextPageToken).toBeDefined()
    })

    it('should return all workflows when pageSize is larger', async () => {
      const result = await listWorkflows(store, {
        pageSize: 100,
      })

      expect(result.workflows).toHaveLength(10)
      expect(result.nextPageToken).toBeUndefined()
    })

    it('should return next page with cursor', async () => {
      const firstPage = await listWorkflows(store, {
        pageSize: 3,
      })

      expect(firstPage.workflows).toHaveLength(3)
      expect(firstPage.nextPageToken).toBeDefined()

      const secondPage = await listWorkflows(store, {
        pageSize: 3,
        nextPageToken: firstPage.nextPageToken,
      })

      expect(secondPage.workflows).toHaveLength(3)
      // Ensure no overlap
      const firstPageIds = firstPage.workflows.map(w => w.workflowId)
      const secondPageIds = secondPage.workflows.map(w => w.workflowId)
      expect(firstPageIds.some(id => secondPageIds.includes(id))).toBe(false)
    })

    it('should iterate through all pages', async () => {
      const allWorkflows: WorkflowMetadata[] = []
      let nextPageToken: string | undefined

      do {
        const result = await listWorkflows(store, {
          pageSize: 3,
          nextPageToken,
        })
        allWorkflows.push(...result.workflows)
        nextPageToken = result.nextPageToken
      } while (nextPageToken)

      expect(allWorkflows).toHaveLength(10)
    })
  })

  // ============================================================================
  // Combined Filters
  // ============================================================================

  describe('combined filters', () => {
    beforeEach(async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
        searchAttributes: { customerId: 'cust-100', region: 'us-west' },
      })
      await store.upsert({
        workflowId: 'order-2',
        runId: 'run-2',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date('2026-01-10T10:01:00Z'),
        closeTime: new Date('2026-01-10T10:05:00Z'),
        taskQueue: 'orders',
        searchAttributes: { customerId: 'cust-100', region: 'us-east' },
      })
      await store.upsert({
        workflowId: 'payment-1',
        runId: 'run-3',
        workflowType: 'paymentWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:02:00Z'),
        taskQueue: 'payments',
        searchAttributes: { customerId: 'cust-100' },
      })
    })

    it('should filter by type AND status', async () => {
      const result = await listWorkflows(store, {
        query: 'WorkflowType = "orderWorkflow" AND Status = "RUNNING"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].workflowId).toBe('order-1')
    })

    it('should filter by search attribute', async () => {
      const result = await listWorkflows(store, {
        query: 'customerId = "cust-100"',
      })

      expect(result.workflows).toHaveLength(3)
    })

    it('should filter by type AND search attribute', async () => {
      const result = await listWorkflows(store, {
        query: 'WorkflowType = "orderWorkflow" AND customerId = "cust-100"',
      })

      expect(result.workflows).toHaveLength(2)
    })

    it('should filter by multiple conditions', async () => {
      const result = await listWorkflows(store, {
        query: 'WorkflowType = "orderWorkflow" AND Status = "RUNNING" AND region = "us-west"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].workflowId).toBe('order-1')
    })
  })

  // ============================================================================
  // Search Attributes
  // ============================================================================

  describe('search attributes', () => {
    it('should store and query custom search attributes', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
        searchAttributes: {
          customerId: 'cust-123',
          orderTotal: 99.99,
          priority: 'high',
        },
      })

      const result = await listWorkflows(store, {
        query: 'priority = "high"',
      })

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].searchAttributes?.priority).toBe('high')
    })

    it('should update search attributes', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
        searchAttributes: { priority: 'low' },
      })

      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
        searchAttributes: { priority: 'high' },
      })

      const retrieved = await store.get('order-1')
      expect(retrieved?.searchAttributes?.priority).toBe('high')
    })
  })

  // ============================================================================
  // Query Parser
  // ============================================================================

  describe('query parser', () => {
    it('should parse simple equality', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })

      const result = await queryWorkflows(store, {
        filters: [{ field: 'WorkflowType', operator: '=', value: 'orderWorkflow' }],
      })

      expect(result.workflows).toHaveLength(1)
    })

    it('should handle invalid query gracefully', async () => {
      const result = await listWorkflows(store, {
        query: 'invalid query syntax without operators',
      })

      // Should return all workflows when query is invalid (fail open for listing)
      // Or throw an error - implementation decision
      expect(result.workflows).toBeDefined()
    })

    it('should handle empty query', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })

      const result = await listWorkflows(store, {})

      expect(result.workflows).toHaveLength(1)
    })
  })

  // ============================================================================
  // Delete Workflow Metadata
  // ============================================================================

  describe('delete workflow metadata', () => {
    it('should delete workflow metadata', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date('2026-01-10T10:00:00Z'),
        closeTime: new Date('2026-01-10T10:05:00Z'),
        taskQueue: 'orders',
      })

      await store.delete('order-1')
      const retrieved = await store.get('order-1')

      expect(retrieved).toBeNull()
    })

    it('should not throw when deleting non-existent workflow', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // List All Workflows
  // ============================================================================

  describe('list all workflows', () => {
    it('should list all workflows without filters', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'payment-1',
        runId: 'run-2',
        workflowType: 'paymentWorkflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date('2026-01-10T10:01:00Z'),
        closeTime: new Date('2026-01-10T10:02:00Z'),
        taskQueue: 'payments',
      })

      const result = await listWorkflows(store, {})

      expect(result.workflows).toHaveLength(2)
    })

    it('should order workflows by startTime descending', async () => {
      await store.upsert({
        workflowId: 'order-1',
        runId: 'run-1',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T10:00:00Z'),
        taskQueue: 'orders',
      })
      await store.upsert({
        workflowId: 'order-2',
        runId: 'run-2',
        workflowType: 'orderWorkflow',
        status: WorkflowStatus.RUNNING,
        startTime: new Date('2026-01-10T11:00:00Z'),
        taskQueue: 'orders',
      })

      const result = await listWorkflows(store, {})

      // Most recent first
      expect(result.workflows[0].workflowId).toBe('order-2')
      expect(result.workflows[1].workflowId).toBe('order-1')
    })
  })
})
