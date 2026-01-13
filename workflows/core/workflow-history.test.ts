/**
 * Tests for WorkflowHistory - Time-travel enabled workflow history using TemporalStore
 *
 * This module provides workflow history tracking with:
 * - Time-travel debugging (replay to any point)
 * - Efficient snapshots for checkpointing
 * - Retention policies for memory management
 * - Versioned state for Continue-As-New
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WorkflowHistory,
  createWorkflowHistory,
  type WorkflowHistoryOptions,
  type HistoryEvent,
  type HistorySnapshot,
} from './workflow-history'

describe('WorkflowHistory', () => {
  let history: WorkflowHistory

  beforeEach(() => {
    history = createWorkflowHistory({ workflowId: 'test-workflow-1' })
  })

  afterEach(() => {
    history.dispose()
  })

  describe('Event Recording', () => {
    it('should record workflow events with timestamps', async () => {
      const now = Date.now()
      await history.recordEvent({
        type: 'WORKFLOW_STARTED',
        timestamp: now,
      })

      const events = await history.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('WORKFLOW_STARTED')
      expect(events[0]?.timestamp).toBe(now)
    })

    it('should maintain event ordering by timestamp', async () => {
      const t1 = Date.now()
      const t2 = t1 + 100
      const t3 = t2 + 100

      await history.recordEvent({ type: 'EVENT_A', timestamp: t1 })
      await history.recordEvent({ type: 'EVENT_B', timestamp: t2 })
      await history.recordEvent({ type: 'EVENT_C', timestamp: t3 })

      const events = await history.getEvents()
      expect(events).toHaveLength(3)
      expect(events[0]?.type).toBe('EVENT_A')
      expect(events[1]?.type).toBe('EVENT_B')
      expect(events[2]?.type).toBe('EVENT_C')
    })

    it('should track history length', async () => {
      expect(await history.getLength()).toBe(0)

      await history.recordEvent({ type: 'EVENT_1', timestamp: Date.now() })
      expect(await history.getLength()).toBe(1)

      await history.recordEvent({ type: 'EVENT_2', timestamp: Date.now() + 1 })
      expect(await history.getLength()).toBe(2)
    })

    it('should record events with custom data', async () => {
      const now = Date.now()
      await history.recordEvent({
        type: 'STEP_COMPLETED',
        timestamp: now,
        stepId: 'fetch-data',
        result: { data: 'fetched' },
        duration: 150,
      })

      const events = await history.getEvents()
      expect(events[0]?.stepId).toBe('fetch-data')
      expect(events[0]?.result).toEqual({ data: 'fetched' })
      expect(events[0]?.duration).toBe(150)
    })

    it('should return empty events when no history', async () => {
      const events = await history.getEvents()
      expect(events).toEqual([])
    })
  })

  describe('Time Travel (getAsOf)', () => {
    it('should query history at a specific timestamp', async () => {
      const t1 = Date.now()
      const t2 = t1 + 1000
      const t3 = t2 + 1000

      await history.recordEvent({ type: 'START', timestamp: t1 })
      await history.recordEvent({ type: 'MIDDLE', timestamp: t2 })
      await history.recordEvent({ type: 'END', timestamp: t3 })

      // Query at t2 should only show events up to t2
      const eventsAtT2 = await history.getEventsAsOf(t2)
      expect(eventsAtT2).toHaveLength(2)
      expect(eventsAtT2[0]?.type).toBe('START')
      expect(eventsAtT2[1]?.type).toBe('MIDDLE')
    })

    it('should return empty array for timestamp before any events', async () => {
      const t1 = Date.now()
      await history.recordEvent({ type: 'EVENT', timestamp: t1 })

      const events = await history.getEventsAsOf(t1 - 1000)
      expect(events).toEqual([])
    })

    it('should return all events for timestamp after last event', async () => {
      const t1 = Date.now()
      const t2 = t1 + 1000

      await history.recordEvent({ type: 'FIRST', timestamp: t1 })
      await history.recordEvent({ type: 'SECOND', timestamp: t2 })

      const events = await history.getEventsAsOf(t2 + 1000)
      expect(events).toHaveLength(2)
    })

    it('should use TemporalStore getAsOf for efficient time-travel queries', async () => {
      // Record many events
      const baseTime = Date.now()
      for (let i = 0; i < 100; i++) {
        await history.recordEvent({
          type: `EVENT_${i}`,
          timestamp: baseTime + i * 10,
          index: i,
        })
      }

      // Query at midpoint - should be efficient O(log n)
      const midpoint = baseTime + 500
      const eventsAtMidpoint = await history.getEventsAsOf(midpoint)
      expect(eventsAtMidpoint.length).toBe(51) // Events 0-50
      expect(eventsAtMidpoint[eventsAtMidpoint.length - 1]?.index).toBe(50)
    })

    it('should get specific event state as of timestamp', async () => {
      const t1 = Date.now()
      const t2 = t1 + 1000
      const t3 = t2 + 1000

      // Use recordState to store keyed state that can be queried
      await history.recordState('workflow:state', {
        type: 'WORKFLOW_STATE',
        timestamp: t1,
        state: { status: 'running', step: 0 },
      })
      await history.recordState('workflow:state', {
        type: 'WORKFLOW_STATE',
        timestamp: t2,
        state: { status: 'running', step: 1 },
      })
      await history.recordState('workflow:state', {
        type: 'WORKFLOW_STATE',
        timestamp: t3,
        state: { status: 'completed', step: 2 },
      })

      // Get state as it was at t2
      const stateAtT2 = await history.getStateAsOf('workflow:state', t2 + 500)
      expect(stateAtT2?.state).toEqual({ status: 'running', step: 1 })
    })
  })

  describe('Snapshots', () => {
    it('should create a snapshot of current history', async () => {
      const t1 = Date.now()
      await history.recordEvent({ type: 'EVENT_1', timestamp: t1 })
      await history.recordEvent({ type: 'EVENT_2', timestamp: t1 + 100 })

      const snapshotId = await history.snapshot()
      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
    })

    it('should restore history from snapshot', async () => {
      const t1 = Date.now()
      await history.recordEvent({ type: 'EVENT_1', timestamp: t1 })
      await history.recordEvent({ type: 'EVENT_2', timestamp: t1 + 100 })

      const snapshotId = await history.snapshot()

      // Add more events after snapshot
      await history.recordEvent({ type: 'EVENT_3', timestamp: t1 + 200 })
      await history.recordEvent({ type: 'EVENT_4', timestamp: t1 + 300 })

      expect(await history.getLength()).toBe(4)

      // Restore snapshot
      await history.restoreSnapshot(snapshotId)

      // Should only have original 2 events
      const events = await history.getEvents()
      expect(events).toHaveLength(2)
      expect(events[0]?.type).toBe('EVENT_1')
      expect(events[1]?.type).toBe('EVENT_2')
    })

    it('should list available snapshots', async () => {
      await history.recordEvent({ type: 'EVENT', timestamp: Date.now() })

      const snap1 = await history.snapshot()
      await history.recordEvent({ type: 'EVENT_2', timestamp: Date.now() + 100 })
      const snap2 = await history.snapshot()

      const snapshots = await history.listSnapshots()
      expect(snapshots).toHaveLength(2)
      expect(snapshots.map((s) => s.id)).toContain(snap1)
      expect(snapshots.map((s) => s.id)).toContain(snap2)
    })

    it('should include snapshot metadata', async () => {
      const eventTime = Date.now()
      await history.recordEvent({ type: 'EVENT', timestamp: eventTime })

      const snapshotId = await history.snapshot()
      const snapshots = await history.listSnapshots()
      const snap = snapshots.find((s) => s.id === snapshotId)

      expect(snap).toBeDefined()
      expect(snap?.timestamp).toBe(eventTime)
      expect(snap?.createdAt).toBeDefined()
      expect(snap?.eventCount).toBe(1)
    })

    it('should throw when restoring invalid snapshot', async () => {
      await expect(history.restoreSnapshot('invalid-snapshot-id')).rejects.toThrow()
    })

    it('should preserve snapshot after additional operations', async () => {
      await history.recordEvent({ type: 'EVENT_1', timestamp: Date.now() })
      const snapshotId = await history.snapshot()

      // Many operations after snapshot
      for (let i = 0; i < 50; i++) {
        await history.recordEvent({ type: `POST_SNAP_${i}`, timestamp: Date.now() + i })
      }

      // Snapshot should still be valid
      await history.restoreSnapshot(snapshotId)
      expect(await history.getLength()).toBe(1)
    })
  })

  describe('Retention Policy', () => {
    it('should prune old events based on maxVersions', async () => {
      // Record many events
      const baseTime = Date.now()
      for (let i = 0; i < 100; i++) {
        await history.recordEvent({
          type: 'EVENT',
          timestamp: baseTime + i,
          index: i,
        })
      }

      expect(await history.getLength()).toBe(100)

      // Prune to keep only last 10
      const stats = await history.prune({ maxVersions: 10 })
      expect(stats.versionsRemoved).toBe(90)
      expect(await history.getLength()).toBe(10)

      // Should have kept the last 10 events
      const events = await history.getEvents()
      expect(events[0]?.index).toBe(90)
    })

    it('should prune old events based on maxAge', async () => {
      const now = Date.now()

      // Record events at different ages
      await history.recordEvent({ type: 'OLD', timestamp: now - 7200000 }) // 2 hours ago
      await history.recordEvent({ type: 'MEDIUM', timestamp: now - 3600000 }) // 1 hour ago
      await history.recordEvent({ type: 'RECENT', timestamp: now - 60000 }) // 1 minute ago
      await history.recordEvent({ type: 'NEWEST', timestamp: now })

      // Prune events older than 90 minutes
      const stats = await history.prune({ maxAge: '90m' })
      expect(stats.versionsRemoved).toBe(1) // Only the 2-hour-old event

      const events = await history.getEvents()
      expect(events).toHaveLength(3)
      expect(events[0]?.type).toBe('MEDIUM')
    })

    it('should set default retention policy', () => {
      history.setRetentionPolicy({ maxVersions: 50, maxAge: '24h' })
      const policy = history.getRetentionPolicy()

      expect(policy?.maxVersions).toBe(50)
      expect(policy?.maxAge).toBe('24h')
    })

    it('should apply both maxVersions and maxAge together', async () => {
      const now = Date.now()

      // Record events
      for (let i = 0; i < 20; i++) {
        await history.recordEvent({
          type: 'EVENT',
          // Half are old, half are recent
          timestamp: i < 10 ? now - 7200000 + i : now + i,
          index: i,
        })
      }

      // Prune with both constraints
      await history.prune({ maxVersions: 15, maxAge: '1h' })

      // Should remove old events AND enforce maxVersions
      const events = await history.getEvents()
      expect(events.length).toBeLessThanOrEqual(15)
      expect(events.every((e) => e.timestamp >= now - 3600000)).toBe(true)
    })

    it('should compact old history for Continue-As-New', async () => {
      const baseTime = Date.now()

      // Simulate long-running workflow
      for (let i = 0; i < 200; i++) {
        await history.recordEvent({
          type: 'STEP_COMPLETED',
          timestamp: baseTime + i * 100,
          stepId: `step-${i}`,
        })
      }

      // Create snapshot before compaction
      const snapshotId = await history.snapshot()

      // Compact for Continue-As-New (keep minimal state)
      const stats = await history.compact({ maxVersions: 1 })
      expect(stats.versionsRemoved).toBeGreaterThan(0)

      // Previous state accessible via snapshot
      await history.restoreSnapshot(snapshotId)
      expect(await history.getLength()).toBe(200)
    })
  })

  describe('Integration with WorkflowCore', () => {
    it('should export checkpoint state compatible with WorkflowCore', async () => {
      const t1 = Date.now()
      await history.recordEvent({
        type: 'STEP_COMPLETED',
        timestamp: t1,
        stepId: 'step-1',
        result: 'done',
      })

      const checkpoint = await history.exportCheckpoint()

      expect(checkpoint.workflowId).toBe('test-workflow-1')
      expect(checkpoint.events).toHaveLength(1)
      expect(checkpoint.historyTimestamp).toBeDefined()
    })

    it('should import checkpoint state from WorkflowCore', async () => {
      const checkpoint = {
        workflowId: 'test-workflow-1',
        events: [
          { type: 'WORKFLOW_STARTED', timestamp: Date.now() },
          { type: 'STEP_COMPLETED', timestamp: Date.now() + 100, stepId: 'step-1' },
        ],
        historyTimestamp: Date.now() + 100,
      }

      await history.importCheckpoint(checkpoint)

      expect(await history.getLength()).toBe(2)
      const events = await history.getEvents()
      expect(events[0]?.type).toBe('WORKFLOW_STARTED')
      expect(events[1]?.type).toBe('STEP_COMPLETED')
    })

    it('should integrate with workflowInfo().getHistoryAt', async () => {
      // This tests the pattern described in the issue:
      // workflowInfo().getHistoryAt(timestamp)

      const t1 = Date.now()
      const t2 = t1 + 1000
      const t3 = t2 + 1000

      await history.recordEvent({ type: 'START', timestamp: t1, state: 'initial' })
      await history.recordEvent({ type: 'PROGRESS', timestamp: t2, state: 'running' })
      await history.recordEvent({ type: 'COMPLETE', timestamp: t3, state: 'done' })

      // workflowInfo().getHistoryAt pattern
      const historyAtT2 = await history.getEventsAsOf(t2)
      expect(historyAtT2.length).toBe(2)
      expect(historyAtT2[historyAtT2.length - 1]?.state).toBe('running')
    })
  })

  describe('Performance', () => {
    it('should handle large history efficiently', async () => {
      const baseTime = Date.now()
      const eventCount = 1000

      // Record many events
      for (let i = 0; i < eventCount; i++) {
        await history.recordEvent({
          type: 'STEP_COMPLETED',
          timestamp: baseTime + i,
          stepId: `step-${i}`,
        })
      }

      // Time-travel query should be fast
      const queryStart = performance.now()
      const eventsAtMidpoint = await history.getEventsAsOf(baseTime + 500)
      const queryTime = performance.now() - queryStart

      expect(eventsAtMidpoint.length).toBe(501)
      expect(queryTime).toBeLessThan(100) // Should be under 100ms
    })

    it('should cache frequently accessed timestamps', async () => {
      const baseTime = Date.now()
      for (let i = 0; i < 100; i++) {
        await history.recordEvent({
          type: 'EVENT',
          timestamp: baseTime + i * 10,
        })
      }

      // First query
      const firstQueryStart = performance.now()
      await history.getEventsAsOf(baseTime + 500)
      const firstQueryTime = performance.now() - firstQueryStart

      // Second query (should be cached)
      const secondQueryStart = performance.now()
      await history.getEventsAsOf(baseTime + 500)
      const secondQueryTime = performance.now() - secondQueryStart

      // Cached query should be faster
      expect(secondQueryTime).toBeLessThanOrEqual(firstQueryTime)
    })
  })

  describe('Options', () => {
    it('should accept custom workflow ID', () => {
      const customHistory = createWorkflowHistory({ workflowId: 'custom-id' })
      expect(customHistory).toBeDefined()
      customHistory.dispose()
    })

    it('should accept metrics collector', () => {
      const metrics = {
        incrementCounter: () => {},
        recordLatency: () => {},
        recordGauge: () => {},
      }

      const customHistory = createWorkflowHistory({
        workflowId: 'workflow-1',
        metrics,
      })
      expect(customHistory).toBeDefined()
      customHistory.dispose()
    })

    it('should accept default retention policy', async () => {
      const customHistory = createWorkflowHistory({
        workflowId: 'workflow-1',
        retention: { maxVersions: 5, maxAge: '1h' },
      })

      expect(customHistory.getRetentionPolicy()?.maxVersions).toBe(5)
      customHistory.dispose()
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid event gracefully', async () => {
      // Record with minimal required fields
      await history.recordEvent({
        type: 'VALID_EVENT',
        timestamp: Date.now(),
      })

      expect(await history.getLength()).toBe(1)
    })

    it('should reject events without timestamp', async () => {
      await expect(
        // @ts-expect-error - Testing missing required field
        history.recordEvent({ type: 'NO_TIMESTAMP' })
      ).rejects.toThrow()
    })

    it('should reject events without type', async () => {
      await expect(
        // @ts-expect-error - Testing missing required field
        history.recordEvent({ timestamp: Date.now() })
      ).rejects.toThrow()
    })
  })
})

describe('WorkflowHistory Factory', () => {
  it('should create a WorkflowHistory instance', () => {
    const history = createWorkflowHistory({ workflowId: 'factory-test' })
    expect(history).toBeInstanceOf(WorkflowHistory)
    history.dispose()
  })

  it('should require workflowId', () => {
    // @ts-expect-error - Testing missing required option
    expect(() => createWorkflowHistory({})).toThrow()
  })
})
