/**
 * WorkflowOrchestrator Tests
 *
 * TDD Red-Green-Refactor: These tests are written FIRST, before implementation.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  WorkflowOrchestrator,
  WorkflowBuilder,
  DAGExecutor,
  StepRunner,
  CompensationManager,
  ExecutionStore,
  TriggerManager,
} from './index'
import type {
  Workflow,
  WorkflowStep,
  WorkflowExecution,
  WorkflowContext,
  StepResult,
  ExecutionStatus,
} from './types'

// =============================================================================
// Test Helpers
// =============================================================================

function createSimpleStep(
  id: string,
  handler: (ctx: WorkflowContext) => Promise<unknown>,
  options?: Partial<WorkflowStep>
): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    handler,
    ...options,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Single Step Workflow
// =============================================================================

describe('Single step workflow', () => {
  test('executes a single step and returns output', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'simple-workflow',
      name: 'Simple Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          return { message: 'Hello, World!' }
        }),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('simple-workflow', {})

    expect(execution.status).toBe('completed')
    expect(execution.outputs).toEqual({ message: 'Hello, World!' })
  })

  test('provides workflow context to step handler', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let receivedContext: WorkflowContext | null = null

    const workflow: Workflow = {
      id: 'context-workflow',
      name: 'Context Workflow',
      steps: [
        createSimpleStep('step1', async (ctx) => {
          receivedContext = ctx
          return ctx.inputs
        }),
      ],
    }

    orchestrator.register(workflow)
    await orchestrator.execute('context-workflow', { name: 'test' })

    expect(receivedContext).not.toBeNull()
    expect(receivedContext!.workflowId).toBe('context-workflow')
    expect(receivedContext!.inputs).toEqual({ name: 'test' })
  })
})

// =============================================================================
// Multi-Step Sequential
// =============================================================================

describe('Multi-step sequential workflow', () => {
  test('executes steps in dependency order', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const executionOrder: string[] = []

    const workflow: Workflow = {
      id: 'sequential-workflow',
      name: 'Sequential Workflow',
      steps: [
        createSimpleStep(
          'step1',
          async () => {
            executionOrder.push('step1')
            return { value: 1 }
          }
        ),
        createSimpleStep(
          'step2',
          async () => {
            executionOrder.push('step2')
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step3',
          async () => {
            executionOrder.push('step3')
            return { value: 3 }
          },
          { dependencies: ['step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('sequential-workflow', {})

    expect(execution.status).toBe('completed')
    expect(executionOrder).toEqual(['step1', 'step2', 'step3'])
  })

  test('passes outputs between sequential steps', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'chained-workflow',
      name: 'Chained Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ count: 1 })),
        createSimpleStep(
          'step2',
          async (ctx) => {
            const prev = ctx.getStepOutput<{ count: number }>('step1')
            return { count: (prev?.count ?? 0) + 1 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step3',
          async (ctx) => {
            const prev = ctx.getStepOutput<{ count: number }>('step2')
            return { count: (prev?.count ?? 0) + 1 }
          },
          { dependencies: ['step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('chained-workflow', {})

    expect(execution.status).toBe('completed')
    expect(execution.outputs).toEqual({ count: 3 })
  })
})

// =============================================================================
// Parallel Step Execution (DAG)
// =============================================================================

describe('Parallel step execution (DAG)', () => {
  test('executes independent steps in parallel', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const startTimes: Record<string, number> = {}
    const endTimes: Record<string, number> = {}

    const workflow: Workflow = {
      id: 'parallel-workflow',
      name: 'Parallel Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          startTimes.step1 = Date.now()
          await delay(50)
          endTimes.step1 = Date.now()
          return { value: 1 }
        }),
        createSimpleStep('step2', async () => {
          startTimes.step2 = Date.now()
          await delay(50)
          endTimes.step2 = Date.now()
          return { value: 2 }
        }),
        createSimpleStep('step3', async () => {
          startTimes.step3 = Date.now()
          await delay(50)
          endTimes.step3 = Date.now()
          return { value: 3 }
        }),
      ],
    }

    orchestrator.register(workflow)
    const startTime = Date.now()
    const execution = await orchestrator.execute('parallel-workflow', {})
    const totalTime = Date.now() - startTime

    expect(execution.status).toBe('completed')
    // If parallel, total time should be around 50ms (+ overhead), not 150ms
    expect(totalTime).toBeLessThan(120)
  })

  test('respects dependencies in DAG execution', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const executionOrder: string[] = []

    // DAG structure:
    //     step1
    //    /     \
    // step2   step3
    //    \     /
    //     step4

    const workflow: Workflow = {
      id: 'dag-workflow',
      name: 'DAG Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          executionOrder.push('step1')
          return { value: 1 }
        }),
        createSimpleStep(
          'step2',
          async () => {
            executionOrder.push('step2')
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step3',
          async () => {
            executionOrder.push('step3')
            return { value: 3 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step4',
          async () => {
            executionOrder.push('step4')
            return { value: 4 }
          },
          { dependencies: ['step2', 'step3'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('dag-workflow', {})

    expect(execution.status).toBe('completed')
    // step1 must come first
    expect(executionOrder[0]).toBe('step1')
    // step4 must come last
    expect(executionOrder[3]).toBe('step4')
    // step2 and step3 can be in any order but must be between step1 and step4
    expect(executionOrder.slice(1, 3).sort()).toEqual(['step2', 'step3'])
  })
})

// =============================================================================
// Step Dependencies
// =============================================================================

describe('Step dependencies', () => {
  test('detects circular dependencies', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'circular-workflow',
      name: 'Circular Workflow',
      steps: [
        createSimpleStep('step1', async () => ({}), { dependencies: ['step3'] }),
        createSimpleStep('step2', async () => ({}), { dependencies: ['step1'] }),
        createSimpleStep('step3', async () => ({}), { dependencies: ['step2'] }),
      ],
    }

    expect(() => orchestrator.register(workflow)).toThrow(/circular dependency/i)
  })

  test('detects missing dependency references', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'missing-dep-workflow',
      name: 'Missing Dependency Workflow',
      steps: [
        createSimpleStep('step1', async () => ({}), { dependencies: ['nonexistent'] }),
      ],
    }

    expect(() => orchestrator.register(workflow)).toThrow(/dependency.*not found/i)
  })
})

// =============================================================================
// Step Retry on Failure
// =============================================================================

describe('Step retry on failure', () => {
  test('retries failed step up to maxAttempts', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let attempts = 0

    const workflow: Workflow = {
      id: 'retry-workflow',
      name: 'Retry Workflow',
      steps: [
        createSimpleStep(
          'flaky-step',
          async () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Temporary failure')
            }
            return { success: true }
          },
          {
            retry: { maxAttempts: 3 },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('retry-workflow', {})

    expect(execution.status).toBe('completed')
    expect(attempts).toBe(3)
  })

  test('fails after exhausting all retry attempts', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let attempts = 0

    const workflow: Workflow = {
      id: 'fail-workflow',
      name: 'Fail Workflow',
      steps: [
        createSimpleStep(
          'always-fail',
          async () => {
            attempts++
            throw new Error('Permanent failure')
          },
          {
            retry: { maxAttempts: 3 },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('fail-workflow', {})

    expect(execution.status).toBe('failed')
    expect(attempts).toBe(3)
    expect(execution.error?.message).toBe('Permanent failure')
  })

  test('applies exponential backoff between retries', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const attemptTimes: number[] = []

    const workflow: Workflow = {
      id: 'backoff-workflow',
      name: 'Backoff Workflow',
      steps: [
        createSimpleStep(
          'backoff-step',
          async () => {
            attemptTimes.push(Date.now())
            if (attemptTimes.length < 3) {
              throw new Error('Retry me')
            }
            return { done: true }
          },
          {
            retry: {
              maxAttempts: 3,
              delayMs: 20,
              backoffMultiplier: 2,
            },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    await orchestrator.execute('backoff-workflow', {})

    // Delay between attempt 1 and 2 should be ~20ms
    const delay1 = attemptTimes[1] - attemptTimes[0]
    // Delay between attempt 2 and 3 should be ~40ms (20 * 2)
    const delay2 = attemptTimes[2] - attemptTimes[1]

    expect(delay1).toBeGreaterThanOrEqual(15) // Allow some variance
    expect(delay2).toBeGreaterThan(delay1)
  })
})

// =============================================================================
// Workflow Timeout
// =============================================================================

describe('Workflow timeout', () => {
  test('times out step that exceeds timeout', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'timeout-workflow',
      name: 'Timeout Workflow',
      steps: [
        createSimpleStep(
          'slow-step',
          async () => {
            await delay(200)
            return { done: true }
          },
          { timeout: 50 }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('timeout-workflow', {})

    expect(execution.status).toBe('failed')
    expect(execution.error?.message).toMatch(/timeout/i)
  })

  test('times out entire workflow that exceeds timeout', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'workflow-timeout',
      name: 'Workflow Timeout',
      timeout: 50,
      steps: [
        createSimpleStep('step1', async () => {
          await delay(30)
          return { value: 1 }
        }),
        createSimpleStep(
          'step2',
          async () => {
            await delay(30)
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('workflow-timeout', {})

    expect(execution.status).toBe('failed')
    expect(execution.error?.message).toMatch(/workflow.*timeout/i)
  })
})

// =============================================================================
// Pause / Resume
// =============================================================================

describe('Pause and resume', () => {
  test('pauses workflow execution', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const executionOrder: string[] = []

    const workflow: Workflow = {
      id: 'pausable-workflow',
      name: 'Pausable Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          executionOrder.push('step1')
          return { value: 1 }
        }),
        createSimpleStep(
          'step2',
          async () => {
            await delay(100)
            executionOrder.push('step2')
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step3',
          async () => {
            executionOrder.push('step3')
            return { value: 3 }
          },
          { dependencies: ['step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)

    // Start execution without awaiting
    const executionPromise = orchestrator.execute('pausable-workflow', {})

    // Wait for step1 to complete
    await delay(20)

    // Get execution ID and pause
    const status = orchestrator.getStatus(orchestrator.getActiveExecutionId('pausable-workflow')!)
    await orchestrator.pause(status!.id)

    // Wait a bit and verify step3 hasn't run
    await delay(150)
    expect(executionOrder).not.toContain('step3')

    // Resume and complete
    await orchestrator.resume(status!.id)
    const execution = await executionPromise

    expect(execution.status).toBe('completed')
    expect(executionOrder).toContain('step3')
  })

  test('resumes paused workflow from correct step', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let step2Executions = 0

    const workflow: Workflow = {
      id: 'resume-workflow',
      name: 'Resume Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ value: 1 })),
        createSimpleStep(
          'step2',
          async () => {
            step2Executions++
            await delay(50)
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
      ],
    }

    orchestrator.register(workflow)

    const executionPromise = orchestrator.execute('resume-workflow', {})

    // Wait for step2 to start
    await delay(10)

    const execId = orchestrator.getActiveExecutionId('resume-workflow')!
    await orchestrator.pause(execId)

    await delay(100)
    await orchestrator.resume(execId)

    const execution = await executionPromise

    expect(execution.status).toBe('completed')
    // Step2 should complete, not restart
    expect(step2Executions).toBe(1)
  })
})

// =============================================================================
// Cancel Execution
// =============================================================================

describe('Cancel execution', () => {
  test('cancels running workflow and prevents subsequent steps', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const executionOrder: string[] = []

    // Workflow with 3 steps: step1 -> step2 -> step3
    // We cancel after step1 completes but before step2 and step3 start
    const workflow: Workflow = {
      id: 'cancellable-workflow',
      name: 'Cancellable Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          executionOrder.push('step1')
          await delay(50)  // Give time for cancel to be called
          return { value: 1 }
        }),
        createSimpleStep(
          'step2',
          async () => {
            executionOrder.push('step2')
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
        createSimpleStep(
          'step3',
          async () => {
            executionOrder.push('step3')
            return { value: 3 }
          },
          { dependencies: ['step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)

    const executionPromise = orchestrator.execute('cancellable-workflow', {})

    await delay(20)  // Cancel while step1 is still running

    const execId = orchestrator.getActiveExecutionId('cancellable-workflow')!
    await orchestrator.cancel(execId)

    const execution = await executionPromise

    expect(execution.status).toBe('cancelled')
    // step1 completes (it was already running), but step2 and step3 should not start
    expect(executionOrder).toContain('step1')
    expect(executionOrder).not.toContain('step2')
    expect(executionOrder).not.toContain('step3')
  })

  test('triggers compensation on cancel', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const compensations: string[] = []

    const workflow: Workflow = {
      id: 'compensate-cancel-workflow',
      name: 'Compensate Cancel Workflow',
      steps: [
        createSimpleStep(
          'step1',
          async () => ({ resource: 'created' }),
          {
            compensation: async () => {
              compensations.push('step1')
            },
          }
        ),
        createSimpleStep(
          'step2',
          async () => {
            await delay(100)
            return { value: 2 }
          },
          { dependencies: ['step1'] }
        ),
      ],
    }

    orchestrator.register(workflow)

    const executionPromise = orchestrator.execute('compensate-cancel-workflow', {})

    await delay(20)

    const execId = orchestrator.getActiveExecutionId('compensate-cancel-workflow')!
    await orchestrator.cancel(execId)

    await executionPromise

    expect(compensations).toContain('step1')
  })
})

// =============================================================================
// Compensation (Rollback)
// =============================================================================

describe('Compensation (rollback)', () => {
  test('executes compensation handlers on failure in reverse order', async () => {
    const orchestrator = new WorkflowOrchestrator()
    const compensations: string[] = []

    const workflow: Workflow = {
      id: 'compensation-workflow',
      name: 'Compensation Workflow',
      steps: [
        createSimpleStep(
          'step1',
          async () => ({ created: 'resource1' }),
          {
            compensation: async () => {
              compensations.push('step1')
            },
          }
        ),
        createSimpleStep(
          'step2',
          async () => ({ created: 'resource2' }),
          {
            dependencies: ['step1'],
            compensation: async () => {
              compensations.push('step2')
            },
          }
        ),
        createSimpleStep(
          'step3',
          async () => {
            throw new Error('Step 3 failed')
          },
          { dependencies: ['step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('compensation-workflow', {})

    expect(execution.status).toBe('failed')
    // Compensations should run in reverse order
    expect(compensations).toEqual(['step2', 'step1'])
  })

  test('passes step output to compensation handler', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let compensationOutput: unknown = null

    const workflow: Workflow = {
      id: 'compensation-output-workflow',
      name: 'Compensation Output Workflow',
      steps: [
        createSimpleStep(
          'step1',
          async () => ({ resourceId: 'abc123' }),
          {
            compensation: async (_ctx, output) => {
              compensationOutput = output
            },
          }
        ),
        createSimpleStep(
          'step2',
          async () => {
            throw new Error('Failed')
          },
          { dependencies: ['step1'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    await orchestrator.execute('compensation-output-workflow', {})

    expect(compensationOutput).toEqual({ resourceId: 'abc123' })
  })
})

// =============================================================================
// Input/Output Passing Between Steps
// =============================================================================

describe('Input/output passing between steps', () => {
  test('uses inputMapping to transform step inputs', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'input-mapping-workflow',
      name: 'Input Mapping Workflow',
      steps: [
        createSimpleStep('fetch-user', async () => ({
          user: { id: 1, name: 'Alice', email: 'alice@example.com' },
        })),
        createSimpleStep(
          'send-email',
          async (_ctx, input: { to: string; subject: string }) => {
            return { sent: true, to: input.to }
          },
          {
            dependencies: ['fetch-user'],
            inputMapping: (ctx) => {
              const userData = ctx.getStepOutput<{ user: { email: string } }>('fetch-user')
              return {
                to: userData?.user.email ?? '',
                subject: 'Welcome!',
              }
            },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('input-mapping-workflow', {})

    expect(execution.status).toBe('completed')
    expect(execution.outputs).toEqual({ sent: true, to: 'alice@example.com' })
  })

  test('provides all outputs in context', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let contextOutputs: Record<string, unknown> = {}

    const workflow: Workflow = {
      id: 'outputs-workflow',
      name: 'Outputs Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ a: 1 })),
        createSimpleStep('step2', async () => ({ b: 2 })),
        createSimpleStep(
          'step3',
          async (ctx) => {
            contextOutputs = { ...ctx.outputs }
            return { c: 3 }
          },
          { dependencies: ['step1', 'step2'] }
        ),
      ],
    }

    orchestrator.register(workflow)
    await orchestrator.execute('outputs-workflow', {})

    expect(contextOutputs.step1).toEqual({ a: 1 })
    expect(contextOutputs.step2).toEqual({ b: 2 })
  })
})

// =============================================================================
// Conditional Steps
// =============================================================================

describe('Conditional steps', () => {
  test('skips step when condition returns false', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let step2Executed = false

    const workflow: Workflow = {
      id: 'conditional-workflow',
      name: 'Conditional Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ shouldContinue: false })),
        createSimpleStep(
          'step2',
          async () => {
            step2Executed = true
            return { executed: true }
          },
          {
            dependencies: ['step1'],
            condition: (ctx) => {
              const prev = ctx.getStepOutput<{ shouldContinue: boolean }>('step1')
              return prev?.shouldContinue ?? false
            },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('conditional-workflow', {})

    expect(execution.status).toBe('completed')
    expect(step2Executed).toBe(false)
    expect(execution.steps.get('step2')?.status).toBe('skipped')
  })

  test('executes step when condition returns true', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let step2Executed = false

    const workflow: Workflow = {
      id: 'conditional-true-workflow',
      name: 'Conditional True Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ shouldContinue: true })),
        createSimpleStep(
          'step2',
          async () => {
            step2Executed = true
            return { executed: true }
          },
          {
            dependencies: ['step1'],
            condition: (ctx) => {
              const prev = ctx.getStepOutput<{ shouldContinue: boolean }>('step1')
              return prev?.shouldContinue ?? false
            },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('conditional-true-workflow', {})

    expect(execution.status).toBe('completed')
    expect(step2Executed).toBe(true)
  })

  test('supports async conditions', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'async-condition-workflow',
      name: 'Async Condition Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ value: 10 })),
        createSimpleStep(
          'step2',
          async () => ({ doubled: true }),
          {
            dependencies: ['step1'],
            condition: async (ctx) => {
              await delay(10)
              const prev = ctx.getStepOutput<{ value: number }>('step1')
              return (prev?.value ?? 0) > 5
            },
          }
        ),
      ],
    }

    orchestrator.register(workflow)
    const execution = await orchestrator.execute('async-condition-workflow', {})

    expect(execution.status).toBe('completed')
    expect(execution.steps.get('step2')?.status).toBe('completed')
  })
})

// =============================================================================
// Sub-workflows
// =============================================================================

describe('Sub-workflows', () => {
  test('executes sub-workflow as a step', async () => {
    const orchestrator = new WorkflowOrchestrator()

    // Register sub-workflow
    const subWorkflow: Workflow = {
      id: 'sub-workflow',
      name: 'Sub Workflow',
      steps: [
        createSimpleStep('sub-step1', async (ctx) => ({
          doubled: (ctx.inputs.value as number) * 2,
        })),
      ],
    }
    orchestrator.register(subWorkflow)

    // Register parent workflow
    const parentWorkflow: Workflow = {
      id: 'parent-workflow',
      name: 'Parent Workflow',
      steps: [
        createSimpleStep('get-value', async () => ({ value: 5 })),
        createSimpleStep(
          'run-sub',
          async (ctx) => {
            const prev = ctx.getStepOutput<{ value: number }>('get-value')
            const subExecution = await orchestrator.execute('sub-workflow', {
              value: prev?.value,
            })
            return subExecution.outputs
          },
          { dependencies: ['get-value'] }
        ),
      ],
    }
    orchestrator.register(parentWorkflow)

    const execution = await orchestrator.execute('parent-workflow', {})

    expect(execution.status).toBe('completed')
    expect(execution.outputs).toEqual({ doubled: 10 })
  })

  test('propagates sub-workflow failure to parent', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const subWorkflow: Workflow = {
      id: 'failing-sub-workflow',
      name: 'Failing Sub Workflow',
      steps: [
        createSimpleStep('fail-step', async () => {
          throw new Error('Sub-workflow failed')
        }),
      ],
    }
    orchestrator.register(subWorkflow)

    const parentWorkflow: Workflow = {
      id: 'parent-fail-workflow',
      name: 'Parent Fail Workflow',
      steps: [
        createSimpleStep('run-sub', async () => {
          const subExecution = await orchestrator.execute('failing-sub-workflow', {})
          if (subExecution.status === 'failed') {
            throw subExecution.error
          }
          return subExecution.outputs
        }),
      ],
    }
    orchestrator.register(parentWorkflow)

    const execution = await orchestrator.execute('parent-fail-workflow', {})

    expect(execution.status).toBe('failed')
    expect(execution.error?.message).toBe('Sub-workflow failed')
  })
})

// =============================================================================
// Retry Failed Step
// =============================================================================

describe('Retry specific failed step', () => {
  test('retries specific failed step', async () => {
    const orchestrator = new WorkflowOrchestrator()
    let failOnce = true

    const workflow: Workflow = {
      id: 'retry-step-workflow',
      name: 'Retry Step Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ value: 1 })),
        createSimpleStep(
          'step2',
          async () => {
            if (failOnce) {
              failOnce = false
              throw new Error('Temporary failure')
            }
            return { value: 2 }
          },
          { dependencies: ['step1'], retry: { maxAttempts: 1 } }
        ),
      ],
    }

    orchestrator.register(workflow)
    let execution = await orchestrator.execute('retry-step-workflow', {})

    expect(execution.status).toBe('failed')

    // Retry the failed step
    execution = await orchestrator.retry(execution.id, 'step2')

    expect(execution.status).toBe('completed')
    expect(execution.outputs).toEqual({ value: 2 })
  })
})

// =============================================================================
// Execution Store
// =============================================================================

describe('ExecutionStore', () => {
  test('stores and retrieves executions', () => {
    const store = new ExecutionStore()

    const execution: WorkflowExecution = {
      id: 'exec-1',
      workflowId: 'workflow-1',
      status: 'running',
      steps: new Map(),
      inputs: {},
      startedAt: new Date(),
      metadata: { startedAt: new Date(), retryCount: 0 },
    }

    store.save(execution)
    const retrieved = store.get('exec-1')

    expect(retrieved).toEqual(execution)
  })

  test('lists executions by workflow', () => {
    const store = new ExecutionStore()

    store.save({
      id: 'exec-1',
      workflowId: 'workflow-1',
      status: 'completed',
      steps: new Map(),
      inputs: {},
      startedAt: new Date(),
      metadata: { startedAt: new Date(), retryCount: 0 },
    })

    store.save({
      id: 'exec-2',
      workflowId: 'workflow-1',
      status: 'running',
      steps: new Map(),
      inputs: {},
      startedAt: new Date(),
      metadata: { startedAt: new Date(), retryCount: 0 },
    })

    store.save({
      id: 'exec-3',
      workflowId: 'workflow-2',
      status: 'completed',
      steps: new Map(),
      inputs: {},
      startedAt: new Date(),
      metadata: { startedAt: new Date(), retryCount: 0 },
    })

    const workflow1Executions = store.listByWorkflow('workflow-1')
    expect(workflow1Executions).toHaveLength(2)
    expect(workflow1Executions.map((e) => e.id)).toEqual(['exec-1', 'exec-2'])
  })
})

// =============================================================================
// DAG Executor
// =============================================================================

describe('DAGExecutor', () => {
  test('builds correct execution order from DAG', () => {
    const executor = new DAGExecutor()

    const steps: WorkflowStep[] = [
      createSimpleStep('a', async () => ({})),
      createSimpleStep('b', async () => ({}), { dependencies: ['a'] }),
      createSimpleStep('c', async () => ({}), { dependencies: ['a'] }),
      createSimpleStep('d', async () => ({}), { dependencies: ['b', 'c'] }),
    ]

    const levels = executor.buildExecutionLevels(steps)

    // Level 0: a (no deps)
    // Level 1: b, c (both depend on a)
    // Level 2: d (depends on b and c)
    expect(levels).toHaveLength(3)
    expect(levels[0].map((s) => s.id)).toEqual(['a'])
    expect(levels[1].map((s) => s.id).sort()).toEqual(['b', 'c'])
    expect(levels[2].map((s) => s.id)).toEqual(['d'])
  })
})

// =============================================================================
// StepRunner
// =============================================================================

describe('StepRunner', () => {
  test('runs step with timeout', async () => {
    const runner = new StepRunner()

    const result = await runner.run(
      createSimpleStep('test', async () => {
        await delay(10)
        return { done: true }
      }),
      {} as WorkflowContext,
      { timeout: 100 }
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ done: true })
    expect(result.duration).toBeGreaterThanOrEqual(10)
  })

  test('fails step on timeout', async () => {
    const runner = new StepRunner()

    const result = await runner.run(
      createSimpleStep('slow', async () => {
        await delay(100)
        return { done: true }
      }),
      {} as WorkflowContext,
      { timeout: 20 }
    )

    expect(result.success).toBe(false)
    expect(result.error?.message).toMatch(/timeout/i)
  })
})

// =============================================================================
// CompensationManager
// =============================================================================

describe('CompensationManager', () => {
  test('executes compensations in reverse order', async () => {
    const manager = new CompensationManager()
    const order: string[] = []

    manager.register('step1', async () => {
      order.push('comp1')
    }, { output: 1 })

    manager.register('step2', async () => {
      order.push('comp2')
    }, { output: 2 })

    manager.register('step3', async () => {
      order.push('comp3')
    }, { output: 3 })

    await manager.compensate({} as WorkflowContext)

    expect(order).toEqual(['comp3', 'comp2', 'comp1'])
  })
})

// =============================================================================
// TriggerManager
// =============================================================================

describe('TriggerManager', () => {
  test('registers and matches event triggers', () => {
    const manager = new TriggerManager()

    manager.register('workflow-1', {
      type: 'event',
      config: { eventName: 'user.created' },
    })

    manager.register('workflow-2', {
      type: 'event',
      config: { eventName: 'order.placed' },
    })

    const matches = manager.matchEvent('user.created')
    expect(matches).toEqual(['workflow-1'])
  })

  test('registers webhook triggers', () => {
    const manager = new TriggerManager()

    manager.register('workflow-1', {
      type: 'webhook',
      config: { webhookPath: '/hooks/deploy' },
    })

    const match = manager.matchWebhook('/hooks/deploy')
    expect(match).toBe('workflow-1')
  })
})

// =============================================================================
// WorkflowBuilder
// =============================================================================

describe('WorkflowBuilder', () => {
  test('builds workflow with fluent API', () => {
    const workflow = new WorkflowBuilder('my-workflow')
      .name('My Workflow')
      .description('A test workflow')
      .step('step1', async () => ({ value: 1 }))
      .step('step2', async () => ({ value: 2 }), {
        dependencies: ['step1'],
        retry: { maxAttempts: 3 },
      })
      .timeout(5000)
      .trigger({ type: 'manual' })
      .build()

    expect(workflow.id).toBe('my-workflow')
    expect(workflow.name).toBe('My Workflow')
    expect(workflow.description).toBe('A test workflow')
    expect(workflow.steps).toHaveLength(2)
    expect(workflow.steps[0].id).toBe('step1')
    expect(workflow.steps[1].dependencies).toEqual(['step1'])
    expect(workflow.timeout).toBe(5000)
    expect(workflow.triggers).toHaveLength(1)
  })

  test('supports conditional steps in builder', () => {
    const workflow = new WorkflowBuilder('conditional-builder')
      .step('check', async () => ({ proceed: true }))
      .step(
        'action',
        async () => ({ done: true }),
        {
          dependencies: ['check'],
          condition: (ctx) => ctx.getStepOutput<{ proceed: boolean }>('check')?.proceed ?? false,
        }
      )
      .build()

    expect(workflow.steps[1].condition).toBeDefined()
  })
})

// =============================================================================
// Get Status
// =============================================================================

describe('getStatus', () => {
  test('returns current execution status', async () => {
    const orchestrator = new WorkflowOrchestrator()

    const workflow: Workflow = {
      id: 'status-workflow',
      name: 'Status Workflow',
      steps: [
        createSimpleStep('step1', async () => {
          await delay(50)
          return { value: 1 }
        }),
      ],
    }

    orchestrator.register(workflow)

    const executionPromise = orchestrator.execute('status-workflow', {})

    await delay(10)

    const execId = orchestrator.getActiveExecutionId('status-workflow')!
    const status = orchestrator.getStatus(execId)

    expect(status).not.toBeNull()
    expect(status!.status).toBe('running')

    const execution = await executionPromise
    const finalStatus = orchestrator.getStatus(execution.id)

    expect(finalStatus!.status).toBe('completed')
  })
})

// =============================================================================
// Events
// =============================================================================

describe('Workflow events', () => {
  test('emits events during execution', async () => {
    const events: string[] = []
    const orchestrator = new WorkflowOrchestrator({
      onEvent: (event) => {
        events.push(event.type)
      },
    })

    const workflow: Workflow = {
      id: 'events-workflow',
      name: 'Events Workflow',
      steps: [
        createSimpleStep('step1', async () => ({ value: 1 })),
      ],
    }

    orchestrator.register(workflow)
    await orchestrator.execute('events-workflow', {})

    expect(events).toContain('workflow:started')
    expect(events).toContain('step:started')
    expect(events).toContain('step:completed')
    expect(events).toContain('workflow:completed')
  })
})
