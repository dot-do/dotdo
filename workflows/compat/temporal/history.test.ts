/**
 * Temporal Workflow History Compat Layer Tests
 *
 * Tests for Temporal History API compatibility including:
 * - History event types
 * - History iteration
 * - History filtering
 * - History replay
 * - History size limits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WorkflowClient,
  proxyActivities,
  sleep,
  defineSignal,
  setHandler,
  condition,
  workflowInfo,
  setSearchAttributes,
} from './index'

// ============================================================================
// HISTORY TYPES
// ============================================================================

type HistoryEventType =
  | 'WorkflowExecutionStarted'
  | 'WorkflowTaskScheduled'
  | 'WorkflowTaskStarted'
  | 'WorkflowTaskCompleted'
  | 'WorkflowTaskFailed'
  | 'ActivityTaskScheduled'
  | 'ActivityTaskStarted'
  | 'ActivityTaskCompleted'
  | 'ActivityTaskFailed'
  | 'ActivityTaskTimedOut'
  | 'TimerStarted'
  | 'TimerFired'
  | 'TimerCanceled'
  | 'WorkflowExecutionSignaled'
  | 'WorkflowExecutionCompleted'
  | 'WorkflowExecutionFailed'
  | 'WorkflowExecutionCanceled'
  | 'WorkflowExecutionTerminated'
  | 'WorkflowExecutionContinuedAsNew'
  | 'ChildWorkflowExecutionStarted'
  | 'ChildWorkflowExecutionCompleted'
  | 'ChildWorkflowExecutionFailed'
  | 'UpsertWorkflowSearchAttributes'
  | 'WorkflowPropertiesModified'

interface HistoryEvent {
  eventId: number
  eventTime: Date
  eventType: HistoryEventType
  attributes: Record<string, unknown>
}

interface WorkflowHistory {
  events: HistoryEvent[]
  pageToken?: string
}

interface GetHistoryOptions {
  workflowId: string
  runId?: string
  pageSize?: number
  nextPageToken?: string
  waitForNewEvent?: boolean
  eventFilterType?: HistoryEventType
  skipArchival?: boolean
}

// ============================================================================
// HISTORY CLIENT IMPLEMENTATION
// ============================================================================

class WorkflowHistoryClient {
  private histories = new Map<string, HistoryEvent[]>()
  private eventIdCounters = new Map<string, number>()

  constructor() {}

  /**
   * Start recording history for a workflow
   */
  startWorkflow(workflowId: string, runId: string, workflowType: string, args: unknown[]): void {
    const key = this.getKey(workflowId, runId)
    this.histories.set(key, [])
    this.eventIdCounters.set(key, 0)

    this.addEvent(workflowId, runId, 'WorkflowExecutionStarted', {
      workflowType: { name: workflowType },
      input: { payloads: args.map((a) => ({ data: JSON.stringify(a) })) },
      originalExecutionRunId: runId,
      parentWorkflowExecution: null,
      workflowTaskTimeout: { seconds: 10 },
    })

    this.addEvent(workflowId, runId, 'WorkflowTaskScheduled', {
      taskQueue: { name: 'default' },
    })
  }

  /**
   * Record an activity scheduled event
   */
  scheduleActivity(workflowId: string, runId: string, activityType: string, input: unknown[]): number {
    return this.addEvent(workflowId, runId, 'ActivityTaskScheduled', {
      activityType: { name: activityType },
      input: { payloads: input.map((a) => ({ data: JSON.stringify(a) })) },
      scheduleToCloseTimeout: { seconds: 300 },
      startToCloseTimeout: { seconds: 60 },
    })
  }

  /**
   * Record an activity started event
   */
  startActivity(workflowId: string, runId: string, scheduledEventId: number): number {
    return this.addEvent(workflowId, runId, 'ActivityTaskStarted', {
      scheduledEventId,
      attempt: 1,
    })
  }

  /**
   * Record an activity completed event
   */
  completeActivity(workflowId: string, runId: string, scheduledEventId: number, result: unknown): number {
    return this.addEvent(workflowId, runId, 'ActivityTaskCompleted', {
      scheduledEventId,
      result: { payloads: [{ data: JSON.stringify(result) }] },
    })
  }

  /**
   * Record an activity failed event
   */
  failActivity(workflowId: string, runId: string, scheduledEventId: number, error: Error): number {
    return this.addEvent(workflowId, runId, 'ActivityTaskFailed', {
      scheduledEventId,
      failure: {
        message: error.message,
        stackTrace: error.stack,
      },
    })
  }

  /**
   * Record a timer started event
   */
  startTimer(workflowId: string, runId: string, duration: string | number, timerId: string): number {
    return this.addEvent(workflowId, runId, 'TimerStarted', {
      timerId,
      startToFireTimeout: typeof duration === 'number' ? { seconds: duration / 1000 } : { raw: duration },
    })
  }

  /**
   * Record a timer fired event
   */
  fireTimer(workflowId: string, runId: string, startedEventId: number, timerId: string): number {
    return this.addEvent(workflowId, runId, 'TimerFired', {
      startedEventId,
      timerId,
    })
  }

  /**
   * Record a timer canceled event
   */
  cancelTimer(workflowId: string, runId: string, startedEventId: number, timerId: string): number {
    return this.addEvent(workflowId, runId, 'TimerCanceled', {
      startedEventId,
      timerId,
    })
  }

  /**
   * Record a signal event
   */
  signal(workflowId: string, runId: string, signalName: string, input: unknown[]): number {
    return this.addEvent(workflowId, runId, 'WorkflowExecutionSignaled', {
      signalName,
      input: { payloads: input.map((a) => ({ data: JSON.stringify(a) })) },
    })
  }

  /**
   * Record search attributes update
   */
  upsertSearchAttributes(workflowId: string, runId: string, attributes: Record<string, unknown>): number {
    return this.addEvent(workflowId, runId, 'UpsertWorkflowSearchAttributes', {
      searchAttributes: { indexedFields: attributes },
    })
  }

  /**
   * Record workflow completion
   */
  completeWorkflow(workflowId: string, runId: string, result: unknown): number {
    return this.addEvent(workflowId, runId, 'WorkflowExecutionCompleted', {
      result: { payloads: [{ data: JSON.stringify(result) }] },
    })
  }

  /**
   * Record workflow failure
   */
  failWorkflow(workflowId: string, runId: string, error: Error): number {
    return this.addEvent(workflowId, runId, 'WorkflowExecutionFailed', {
      failure: {
        message: error.message,
        stackTrace: error.stack,
      },
    })
  }

  /**
   * Record workflow cancellation
   */
  cancelWorkflow(workflowId: string, runId: string): number {
    return this.addEvent(workflowId, runId, 'WorkflowExecutionCanceled', {})
  }

  /**
   * Record workflow termination
   */
  terminateWorkflow(workflowId: string, runId: string, reason?: string): number {
    return this.addEvent(workflowId, runId, 'WorkflowExecutionTerminated', {
      reason,
    })
  }

  /**
   * Get workflow history
   */
  getHistory(options: GetHistoryOptions): WorkflowHistory {
    const key = this.getKey(options.workflowId, options.runId ?? '')
    const allEvents = this.histories.get(key) ?? []

    let events = allEvents

    // Apply event type filter
    if (options.eventFilterType) {
      events = events.filter((e) => e.eventType === options.eventFilterType)
    }

    // Apply pagination
    const pageSize = options.pageSize ?? 100
    const startIndex = options.nextPageToken ? parseInt(options.nextPageToken, 10) : 0
    const endIndex = startIndex + pageSize
    const pageEvents = events.slice(startIndex, endIndex)

    return {
      events: pageEvents,
      pageToken: endIndex < events.length ? String(endIndex) : undefined,
    }
  }

  /**
   * Iterate through all history events
   */
  async *iterateHistory(options: GetHistoryOptions): AsyncGenerator<HistoryEvent> {
    let pageToken: string | undefined
    do {
      const { events, pageToken: nextToken } = this.getHistory({
        ...options,
        nextPageToken: pageToken,
      })
      for (const event of events) {
        yield event
      }
      pageToken = nextToken
    } while (pageToken)
  }

  /**
   * Get history length
   */
  getHistoryLength(workflowId: string, runId?: string): number {
    const key = this.getKey(workflowId, runId ?? '')
    return this.histories.get(key)?.length ?? 0
  }

  /**
   * Get last event
   */
  getLastEvent(workflowId: string, runId?: string): HistoryEvent | undefined {
    const key = this.getKey(workflowId, runId ?? '')
    const events = this.histories.get(key)
    return events?.[events.length - 1]
  }

  /**
   * Find events by type
   */
  findEventsByType(workflowId: string, runId: string | undefined, eventType: HistoryEventType): HistoryEvent[] {
    const key = this.getKey(workflowId, runId ?? '')
    const events = this.histories.get(key) ?? []
    return events.filter((e) => e.eventType === eventType)
  }

  /**
   * Clear history for testing
   */
  clear(): void {
    this.histories.clear()
    this.eventIdCounters.clear()
  }

  private getKey(workflowId: string, runId: string): string {
    return runId ? `${workflowId}::${runId}` : workflowId
  }

  private addEvent(
    workflowId: string,
    runId: string,
    eventType: HistoryEventType,
    attributes: Record<string, unknown>
  ): number {
    const key = this.getKey(workflowId, runId)
    const events = this.histories.get(key) ?? []
    const counter = (this.eventIdCounters.get(key) ?? 0) + 1

    this.eventIdCounters.set(key, counter)

    const event: HistoryEvent = {
      eventId: counter,
      eventTime: new Date(),
      eventType,
      attributes,
    }

    events.push(event)
    this.histories.set(key, events)

    return counter
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Temporal Workflow History Compat Layer', () => {
  let client: WorkflowClient
  let historyClient: WorkflowHistoryClient

  beforeEach(() => {
    vi.useRealTimers()
    client = new WorkflowClient()
    historyClient = new WorkflowHistoryClient()
  })

  afterEach(() => {
    historyClient.clear()
  })

  describe('History Event Recording', () => {
    it('should record workflow execution started event', () => {
      historyClient.startWorkflow('wf-1', 'run-1', 'TestWorkflow', [{ input: 'value' }])

      const history = historyClient.getHistory({ workflowId: 'wf-1', runId: 'run-1' })

      expect(history.events.length).toBeGreaterThan(0)
      expect(history.events[0].eventType).toBe('WorkflowExecutionStarted')
      expect(history.events[0].attributes.workflowType).toEqual({ name: 'TestWorkflow' })
    })

    it('should record activity events', () => {
      historyClient.startWorkflow('wf-2', 'run-2', 'ActivityWorkflow', [])

      const scheduledId = historyClient.scheduleActivity('wf-2', 'run-2', 'sendEmail', ['test@example.com'])
      historyClient.startActivity('wf-2', 'run-2', scheduledId)
      historyClient.completeActivity('wf-2', 'run-2', scheduledId, { sent: true })

      const history = historyClient.getHistory({ workflowId: 'wf-2', runId: 'run-2' })

      const activityEvents = history.events.filter((e) =>
        e.eventType.startsWith('Activity')
      )
      expect(activityEvents.length).toBe(3)
    })

    it('should record timer events', () => {
      historyClient.startWorkflow('wf-3', 'run-3', 'TimerWorkflow', [])

      const timerId = historyClient.startTimer('wf-3', 'run-3', '5s', 'timer-1')
      historyClient.fireTimer('wf-3', 'run-3', timerId, 'timer-1')

      const history = historyClient.getHistory({ workflowId: 'wf-3', runId: 'run-3' })

      const timerStarted = history.events.find((e) => e.eventType === 'TimerStarted')
      const timerFired = history.events.find((e) => e.eventType === 'TimerFired')

      expect(timerStarted).toBeDefined()
      expect(timerFired).toBeDefined()
      expect(timerFired?.attributes.startedEventId).toBe(timerId)
    })

    it('should record timer cancellation', () => {
      historyClient.startWorkflow('wf-4', 'run-4', 'CancelTimerWorkflow', [])

      const timerId = historyClient.startTimer('wf-4', 'run-4', '1h', 'timer-cancel')
      historyClient.cancelTimer('wf-4', 'run-4', timerId, 'timer-cancel')

      const history = historyClient.getHistory({ workflowId: 'wf-4', runId: 'run-4' })

      const timerCanceled = history.events.find((e) => e.eventType === 'TimerCanceled')
      expect(timerCanceled).toBeDefined()
    })

    it('should record signal events', () => {
      historyClient.startWorkflow('wf-5', 'run-5', 'SignalWorkflow', [])
      historyClient.signal('wf-5', 'run-5', 'approve', [true, 'Approved by manager'])

      const history = historyClient.getHistory({ workflowId: 'wf-5', runId: 'run-5' })

      const signalEvent = history.events.find((e) => e.eventType === 'WorkflowExecutionSignaled')
      expect(signalEvent).toBeDefined()
      expect(signalEvent?.attributes.signalName).toBe('approve')
    })

    it('should record search attribute updates', () => {
      historyClient.startWorkflow('wf-6', 'run-6', 'SearchAttrWorkflow', [])
      historyClient.upsertSearchAttributes('wf-6', 'run-6', {
        CustomerId: 'cust-123',
        Status: 'processing',
      })

      const history = historyClient.getHistory({ workflowId: 'wf-6', runId: 'run-6' })

      const upsertEvent = history.events.find((e) => e.eventType === 'UpsertWorkflowSearchAttributes')
      expect(upsertEvent).toBeDefined()
    })

    it('should record workflow completion', () => {
      historyClient.startWorkflow('wf-7', 'run-7', 'CompleteWorkflow', [])
      historyClient.completeWorkflow('wf-7', 'run-7', { status: 'success' })

      const history = historyClient.getHistory({ workflowId: 'wf-7', runId: 'run-7' })

      const completedEvent = history.events.find((e) => e.eventType === 'WorkflowExecutionCompleted')
      expect(completedEvent).toBeDefined()
    })

    it('should record workflow failure', () => {
      historyClient.startWorkflow('wf-8', 'run-8', 'FailWorkflow', [])
      historyClient.failWorkflow('wf-8', 'run-8', new Error('Workflow failed'))

      const history = historyClient.getHistory({ workflowId: 'wf-8', runId: 'run-8' })

      const failedEvent = history.events.find((e) => e.eventType === 'WorkflowExecutionFailed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.attributes.failure).toHaveProperty('message', 'Workflow failed')
    })

    it('should record workflow cancellation', () => {
      historyClient.startWorkflow('wf-9', 'run-9', 'CancelWorkflow', [])
      historyClient.cancelWorkflow('wf-9', 'run-9')

      const history = historyClient.getHistory({ workflowId: 'wf-9', runId: 'run-9' })

      const canceledEvent = history.events.find((e) => e.eventType === 'WorkflowExecutionCanceled')
      expect(canceledEvent).toBeDefined()
    })

    it('should record workflow termination', () => {
      historyClient.startWorkflow('wf-10', 'run-10', 'TerminateWorkflow', [])
      historyClient.terminateWorkflow('wf-10', 'run-10', 'Manual termination')

      const history = historyClient.getHistory({ workflowId: 'wf-10', runId: 'run-10' })

      const terminatedEvent = history.events.find((e) => e.eventType === 'WorkflowExecutionTerminated')
      expect(terminatedEvent).toBeDefined()
      expect(terminatedEvent?.attributes.reason).toBe('Manual termination')
    })
  })

  describe('History Retrieval', () => {
    it('should retrieve full history', () => {
      historyClient.startWorkflow('wf-full', 'run-full', 'FullHistoryWorkflow', [])
      historyClient.scheduleActivity('wf-full', 'run-full', 'task1', [])
      historyClient.startTimer('wf-full', 'run-full', '1s', 'timer-1')
      historyClient.signal('wf-full', 'run-full', 'update', [])
      historyClient.completeWorkflow('wf-full', 'run-full', 'done')

      const history = historyClient.getHistory({ workflowId: 'wf-full', runId: 'run-full' })

      expect(history.events.length).toBeGreaterThanOrEqual(5)
    })

    it('should paginate history', () => {
      historyClient.startWorkflow('wf-page', 'run-page', 'PageWorkflow', [])
      for (let i = 0; i < 10; i++) {
        historyClient.scheduleActivity('wf-page', 'run-page', `task-${i}`, [])
      }

      const page1 = historyClient.getHistory({
        workflowId: 'wf-page',
        runId: 'run-page',
        pageSize: 5,
      })

      expect(page1.events.length).toBeLessThanOrEqual(5)
      expect(page1.pageToken).toBeDefined()

      const page2 = historyClient.getHistory({
        workflowId: 'wf-page',
        runId: 'run-page',
        pageSize: 5,
        nextPageToken: page1.pageToken,
      })

      expect(page2.events.length).toBeLessThanOrEqual(5)
    })

    it('should filter history by event type', () => {
      historyClient.startWorkflow('wf-filter', 'run-filter', 'FilterWorkflow', [])
      historyClient.scheduleActivity('wf-filter', 'run-filter', 'activity1', [])
      historyClient.startTimer('wf-filter', 'run-filter', '1s', 't1')
      historyClient.scheduleActivity('wf-filter', 'run-filter', 'activity2', [])

      const filteredHistory = historyClient.getHistory({
        workflowId: 'wf-filter',
        runId: 'run-filter',
        eventFilterType: 'ActivityTaskScheduled',
      })

      expect(filteredHistory.events.every((e) => e.eventType === 'ActivityTaskScheduled')).toBe(true)
      expect(filteredHistory.events.length).toBe(2)
    })

    it('should iterate through history', async () => {
      historyClient.startWorkflow('wf-iter', 'run-iter', 'IterWorkflow', [])
      for (let i = 0; i < 15; i++) {
        historyClient.scheduleActivity('wf-iter', 'run-iter', `task-${i}`, [])
      }

      const events: HistoryEvent[] = []
      for await (const event of historyClient.iterateHistory({
        workflowId: 'wf-iter',
        runId: 'run-iter',
        pageSize: 5,
      })) {
        events.push(event)
      }

      // 2 startup events + 15 activity events
      expect(events.length).toBe(17)
    })
  })

  describe('History Event IDs', () => {
    it('should assign sequential event IDs', () => {
      historyClient.startWorkflow('wf-seq', 'run-seq', 'SeqWorkflow', [])
      historyClient.scheduleActivity('wf-seq', 'run-seq', 'task1', [])
      historyClient.scheduleActivity('wf-seq', 'run-seq', 'task2', [])
      historyClient.scheduleActivity('wf-seq', 'run-seq', 'task3', [])

      const history = historyClient.getHistory({ workflowId: 'wf-seq', runId: 'run-seq' })

      for (let i = 0; i < history.events.length; i++) {
        expect(history.events[i].eventId).toBe(i + 1)
      }
    })

    it('should reference previous event IDs correctly', () => {
      historyClient.startWorkflow('wf-ref', 'run-ref', 'RefWorkflow', [])
      const scheduledId = historyClient.scheduleActivity('wf-ref', 'run-ref', 'task', [])
      historyClient.startActivity('wf-ref', 'run-ref', scheduledId)
      historyClient.completeActivity('wf-ref', 'run-ref', scheduledId, 'result')

      const history = historyClient.getHistory({ workflowId: 'wf-ref', runId: 'run-ref' })

      const startedEvent = history.events.find((e) => e.eventType === 'ActivityTaskStarted')
      const completedEvent = history.events.find((e) => e.eventType === 'ActivityTaskCompleted')

      expect(startedEvent?.attributes.scheduledEventId).toBe(scheduledId)
      expect(completedEvent?.attributes.scheduledEventId).toBe(scheduledId)
    })
  })

  describe('History Length', () => {
    it('should track history length', () => {
      historyClient.startWorkflow('wf-len', 'run-len', 'LenWorkflow', [])

      expect(historyClient.getHistoryLength('wf-len', 'run-len')).toBe(2) // Started + TaskScheduled

      historyClient.scheduleActivity('wf-len', 'run-len', 'task', [])
      expect(historyClient.getHistoryLength('wf-len', 'run-len')).toBe(3)

      historyClient.startTimer('wf-len', 'run-len', '1s', 't1')
      expect(historyClient.getHistoryLength('wf-len', 'run-len')).toBe(4)
    })

    it('should return 0 for non-existent workflow', () => {
      expect(historyClient.getHistoryLength('non-existent')).toBe(0)
    })
  })

  describe('Find Events', () => {
    it('should find all events of a specific type', () => {
      historyClient.startWorkflow('wf-find', 'run-find', 'FindWorkflow', [])
      historyClient.scheduleActivity('wf-find', 'run-find', 'task1', [])
      historyClient.scheduleActivity('wf-find', 'run-find', 'task2', [])
      historyClient.scheduleActivity('wf-find', 'run-find', 'task3', [])
      historyClient.startTimer('wf-find', 'run-find', '1s', 't1')

      const activityEvents = historyClient.findEventsByType('wf-find', 'run-find', 'ActivityTaskScheduled')
      expect(activityEvents.length).toBe(3)

      const timerEvents = historyClient.findEventsByType('wf-find', 'run-find', 'TimerStarted')
      expect(timerEvents.length).toBe(1)
    })

    it('should get last event', () => {
      historyClient.startWorkflow('wf-last', 'run-last', 'LastWorkflow', [])
      historyClient.scheduleActivity('wf-last', 'run-last', 'task', [])
      historyClient.completeWorkflow('wf-last', 'run-last', 'done')

      const lastEvent = historyClient.getLastEvent('wf-last', 'run-last')
      expect(lastEvent?.eventType).toBe('WorkflowExecutionCompleted')
    })
  })

  describe('Activity Failure History', () => {
    it('should record activity failure with error details', () => {
      historyClient.startWorkflow('wf-fail', 'run-fail', 'FailActivityWorkflow', [])
      const scheduledId = historyClient.scheduleActivity('wf-fail', 'run-fail', 'failingTask', [])
      historyClient.startActivity('wf-fail', 'run-fail', scheduledId)

      const error = new Error('Activity failed: Connection timeout')
      error.stack = 'Error: Activity failed\n    at failingTask (task.ts:10)'
      historyClient.failActivity('wf-fail', 'run-fail', scheduledId, error)

      const history = historyClient.getHistory({ workflowId: 'wf-fail', runId: 'run-fail' })
      const failedEvent = history.events.find((e) => e.eventType === 'ActivityTaskFailed')

      expect(failedEvent?.attributes.failure).toBeDefined()
      expect((failedEvent?.attributes.failure as any).message).toBe('Activity failed: Connection timeout')
    })
  })

  describe('Complex Workflow History', () => {
    it('should record a complete order workflow history', () => {
      const wfId = 'order-wf'
      const runId = 'order-run'

      // Start workflow
      historyClient.startWorkflow(wfId, runId, 'OrderWorkflow', [{ orderId: 'ORD-123' }])

      // Validate order (activity)
      const validate = historyClient.scheduleActivity(wfId, runId, 'validateOrder', ['ORD-123'])
      historyClient.startActivity(wfId, runId, validate)
      historyClient.completeActivity(wfId, runId, validate, { valid: true })

      // Wait for approval (signal)
      historyClient.startTimer(wfId, runId, '24h', 'approval-timer')

      // Receive approval signal
      historyClient.signal(wfId, runId, 'orderApproved', [true, 'Manager approved'])
      historyClient.cancelTimer(wfId, runId, 5, 'approval-timer') // Cancel the timeout

      // Update status
      historyClient.upsertSearchAttributes(wfId, runId, { Status: 'approved' })

      // Process payment (activity)
      const payment = historyClient.scheduleActivity(wfId, runId, 'processPayment', ['ORD-123', 100])
      historyClient.startActivity(wfId, runId, payment)
      historyClient.completeActivity(wfId, runId, payment, { transactionId: 'TXN-456' })

      // Complete workflow
      historyClient.completeWorkflow(wfId, runId, { status: 'completed', orderId: 'ORD-123' })

      // Verify complete history
      const history = historyClient.getHistory({ workflowId: wfId, runId })

      // Check all expected event types are present
      const eventTypes = history.events.map((e) => e.eventType)
      expect(eventTypes).toContain('WorkflowExecutionStarted')
      expect(eventTypes).toContain('ActivityTaskScheduled')
      expect(eventTypes).toContain('ActivityTaskCompleted')
      expect(eventTypes).toContain('TimerStarted')
      expect(eventTypes).toContain('WorkflowExecutionSignaled')
      expect(eventTypes).toContain('TimerCanceled')
      expect(eventTypes).toContain('UpsertWorkflowSearchAttributes')
      expect(eventTypes).toContain('WorkflowExecutionCompleted')
    })
  })

  describe('Integration with WorkflowClient', () => {
    it('should track history length in workflowInfo', async () => {
      async function historyLengthWorkflow() {
        const info1 = workflowInfo()
        const len1 = info1.historyLength

        // Do some operations
        setSearchAttributes({ step: 1 })

        await new Promise((resolve) => setTimeout(resolve, 10))

        setSearchAttributes({ step: 2 })

        const info2 = workflowInfo()
        const len2 = info2.historyLength

        return { initial: len1, final: len2, increased: len2 > len1 }
      }

      const result = await client.execute(historyLengthWorkflow, {
        taskQueue: 'test',
      })

      expect(result.increased).toBe(true)
    })
  })
})
