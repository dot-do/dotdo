/**
 * Workflow Primitives - Workflow Worker
 */

import type { WorkflowDefinition, ActivityDefinition } from './types'

export interface WorkflowWorkerOptions {
  taskQueue: string
  workflows: WorkflowDefinition[]
  activities: ActivityDefinition[]
}

/**
 * Workflow worker for executing workflows
 */
export class WorkflowWorker {
  readonly taskQueue: string
  private workflows: Map<string, WorkflowDefinition>
  private activities: Map<string, ActivityDefinition>
  private running = false
  private shutdownRequested = false
  private shutdownResolve?: () => void

  constructor(options: WorkflowWorkerOptions) {
    this.taskQueue = options.taskQueue
    this.workflows = new Map(options.workflows.map((w) => [w.name, w]))
    this.activities = new Map(options.activities.map((a) => [a.name, a]))
  }

  /**
   * Start the worker
   */
  async run(): Promise<void> {
    this.running = true
    this.shutdownRequested = false

    return new Promise<void>((resolve) => {
      this.shutdownResolve = resolve

      // In a real implementation, this would poll for tasks
      // For now, workflows are executed inline when started
      const checkShutdown = () => {
        if (this.shutdownRequested) {
          this.running = false
          resolve()
        } else {
          setTimeout(checkShutdown, 10)
        }
      }
      checkShutdown()
    })
  }

  /**
   * Gracefully shutdown the worker
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true
    // Wait for run() to complete
    await new Promise<void>((resolve) => {
      if (!this.running) {
        resolve()
        return
      }
      const check = () => {
        if (!this.running) {
          resolve()
        } else {
          setTimeout(check, 10)
        }
      }
      check()
    })
  }

  /**
   * Get registered workflow
   */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name)
  }

  /**
   * Get registered activity
   */
  getActivity(name: string): ActivityDefinition | undefined {
    return this.activities.get(name)
  }
}
