/**
 * Workflow Lifecycle Benchmarks
 *
 * RED PHASE: Benchmarks for workflow engine operations.
 * Tests workflow execution, activities, signals, and queries.
 *
 * @see do-a55 - Store Benchmarks
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest'
import { CostTracker } from '../../framework/cost-tracker'
import {
  workflow,
  startWorkflowExecution,
  getWorkflowInfo,
  listWorkflows,
  terminateWorkflow,
  clearWorkflows,
} from '../../../../db/workflow/engine'
import type { WorkflowContext, WorkflowHandle } from '../../../../db/workflow/types'

describe('Workflow Lifecycle Benchmarks', () => {
  let tracker: CostTracker
  let workflowCounter = 0

  // Define test workflows
  const simpleWorkflow = workflow('simple', async (ctx: WorkflowContext, input: { value: number }) => {
    return input.value * 2
  })

  const activityWorkflow = workflow('with-activity', async (ctx: WorkflowContext, input: { name: string }) => {
    const result = await ctx.activity('greet', { input: { name: input.name } })
    return result
  })

  const sleepWorkflow = workflow('with-sleep', async (ctx: WorkflowContext, input: { ms: number }) => {
    await ctx.sleep(input.ms)
    return 'done'
  })

  const signalWorkflow = workflow('with-signal', async (ctx: WorkflowContext, input: unknown) => {
    ctx.setQueryHandler('status', () => 'waiting')
    const signal = await ctx.waitForSignal<string>('my-signal')
    return signal
  })

  const childWorkflow = workflow('child', async (ctx: WorkflowContext, input: { value: number }) => {
    return input.value + 1
  })

  const parentWorkflow = workflow('parent', async (ctx: WorkflowContext, input: { value: number }) => {
    const child = await ctx.startChild(childWorkflow, {
      workflowId: `child_${Date.now()}`,
      input: { value: input.value },
    })
    return await child.result()
  })

  beforeAll(async () => {
    tracker = new CostTracker()
  })

  beforeEach(() => {
    clearWorkflows()
    workflowCounter = 0
  })

  afterAll(async () => {
    clearWorkflows()
  })

  // =========================================================================
  // WORKFLOW START
  // =========================================================================

  bench('start simple workflow', async () => {
    await startWorkflowExecution(
      simpleWorkflow,
      `workflow_${workflowCounter++}`,
      { value: 42 },
      'default'
    )
  })

  bench('start workflow with activity', async () => {
    await startWorkflowExecution(
      activityWorkflow,
      `workflow_${workflowCounter++}`,
      { name: 'Test' },
      'default'
    )
  })

  bench('start workflow with sleep', async () => {
    await startWorkflowExecution(
      sleepWorkflow,
      `workflow_${workflowCounter++}`,
      { ms: 1 }, // Very short sleep for benchmark
      'default'
    )
  })

  bench('start workflow with signal handler', async () => {
    await startWorkflowExecution(
      signalWorkflow,
      `workflow_${workflowCounter++}`,
      {},
      'default'
    )
  })

  bench('start parent workflow (with child)', async () => {
    await startWorkflowExecution(
      parentWorkflow,
      `workflow_${workflowCounter++}`,
      { value: 10 },
      'default'
    )
  })

  // =========================================================================
  // WORKFLOW EXECUTION AND RESULT
  // =========================================================================

  bench('start and await result (simple)', async () => {
    const handle = await startWorkflowExecution(
      simpleWorkflow,
      `workflow_${workflowCounter++}`,
      { value: 42 },
      'default'
    )
    await handle.result()
  })

  bench('start and await result with timeout', async () => {
    const handle = await startWorkflowExecution(
      simpleWorkflow,
      `workflow_${workflowCounter++}`,
      { value: 42 },
      'default'
    )
    await handle.result({ timeout: '5s' })
  })

  // =========================================================================
  // QUERY OPERATIONS
  // =========================================================================

  bench('query workflow state', async () => {
    const handle = await startWorkflowExecution(
      signalWorkflow,
      `workflow_${workflowCounter++}`,
      {},
      'default'
    )
    // Wait for query handler to be registered
    await new Promise((resolve) => setTimeout(resolve, 10))
    await handle.query('status')
  })

  bench('getWorkflowInfo', async () => {
    const handle = await startWorkflowExecution(
      simpleWorkflow,
      `workflow_info_${workflowCounter++}`,
      { value: 1 },
      'default'
    )
    getWorkflowInfo(handle.workflowId)
  })

  // =========================================================================
  // SIGNAL OPERATIONS
  // =========================================================================

  bench('send signal to workflow', async () => {
    const handle = await startWorkflowExecution(
      signalWorkflow,
      `workflow_${workflowCounter++}`,
      {},
      'default'
    )
    await handle.signal('my-signal', 'hello')
  })

  bench('signal and await result', async () => {
    const handle = await startWorkflowExecution(
      signalWorkflow,
      `workflow_${workflowCounter++}`,
      {},
      'default'
    )
    await handle.signal('my-signal', 'hello')
    await handle.result()
  })

  // =========================================================================
  // CANCELLATION
  // =========================================================================

  bench('cancel workflow', async () => {
    const handle = await startWorkflowExecution(
      sleepWorkflow,
      `workflow_${workflowCounter++}`,
      { ms: 10000 },
      'default'
    )
    await handle.cancel()
  })

  bench('terminate workflow', async () => {
    const handle = await startWorkflowExecution(
      sleepWorkflow,
      `workflow_${workflowCounter++}`,
      { ms: 10000 },
      'default'
    )
    terminateWorkflow(handle.workflowId, 'benchmark termination')
  })

  // =========================================================================
  // LIST OPERATIONS
  // =========================================================================

  bench('list workflows (empty)', () => {
    listWorkflows({})
  })

  bench('list workflows (with 10 running)', async () => {
    // Start 10 workflows
    for (let i = 0; i < 10; i++) {
      await startWorkflowExecution(
        sleepWorkflow,
        `list_workflow_${workflowCounter++}`,
        { ms: 10000 },
        'default'
      )
    }
    listWorkflows({})
  })

  bench('list workflows (with 100 running)', async () => {
    // Start 100 workflows
    for (let i = 0; i < 100; i++) {
      await startWorkflowExecution(
        sleepWorkflow,
        `list_workflow_${workflowCounter++}`,
        { ms: 10000 },
        'default'
      )
    }
    listWorkflows({})
  })

  bench('list workflows by status (running)', async () => {
    for (let i = 0; i < 20; i++) {
      await startWorkflowExecution(
        sleepWorkflow,
        `list_workflow_${workflowCounter++}`,
        { ms: 10000 },
        'default'
      )
    }
    listWorkflows({ status: 'running' })
  })

  bench('list workflows by taskQueue', async () => {
    for (let i = 0; i < 20; i++) {
      await startWorkflowExecution(
        simpleWorkflow,
        `list_workflow_${workflowCounter++}`,
        { value: i },
        'special-queue'
      )
    }
    listWorkflows({ taskQueue: 'special-queue' })
  })

  bench('list workflows with pagination', async () => {
    for (let i = 0; i < 50; i++) {
      await startWorkflowExecution(
        sleepWorkflow,
        `list_workflow_${workflowCounter++}`,
        { ms: 10000 },
        'default'
      )
    }
    listWorkflows({ limit: 10, offset: 20 })
  })

  // =========================================================================
  // CONCURRENT WORKFLOW STARTS
  // =========================================================================

  bench('start 10 workflows concurrently', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      startWorkflowExecution(
        simpleWorkflow,
        `concurrent_${workflowCounter++}`,
        { value: i },
        'default'
      )
    )
    await Promise.all(promises)
  })

  bench('start 100 workflows concurrently', async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      startWorkflowExecution(
        simpleWorkflow,
        `concurrent_${workflowCounter++}`,
        { value: i },
        'default'
      )
    )
    await Promise.all(promises)
  })

  // =========================================================================
  // WORKFLOW WITH MULTIPLE ACTIVITIES
  // =========================================================================

  const multiActivityWorkflow = workflow('multi-activity', async (ctx: WorkflowContext, input: { count: number }) => {
    const results: unknown[] = []
    for (let i = 0; i < input.count; i++) {
      results.push(await ctx.activity('step', { input: { step: i } }))
    }
    return results
  })

  bench('workflow with 5 sequential activities', async () => {
    const handle = await startWorkflowExecution(
      multiActivityWorkflow,
      `workflow_${workflowCounter++}`,
      { count: 5 },
      'default'
    )
    // Note: In RED phase, activity execution isn't wired up
  })

  bench('workflow with 10 sequential activities', async () => {
    const handle = await startWorkflowExecution(
      multiActivityWorkflow,
      `workflow_${workflowCounter++}`,
      { count: 10 },
      'default'
    )
  })

  // =========================================================================
  // WORKFLOW DEFINITION
  // =========================================================================

  bench('define new workflow', () => {
    workflow(`dynamic_workflow_${Date.now()}`, async (ctx: WorkflowContext, input: unknown) => {
      return input
    })
  })

  // =========================================================================
  // TASK QUEUE OPERATIONS
  // =========================================================================

  bench('start workflows on multiple task queues', async () => {
    const queues = ['queue-a', 'queue-b', 'queue-c', 'queue-d']
    const promises = queues.map((queue) =>
      startWorkflowExecution(
        simpleWorkflow,
        `multi_queue_${workflowCounter++}`,
        { value: 1 },
        queue
      )
    )
    await Promise.all(promises)
  })
})
