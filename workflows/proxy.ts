/**
 * Pipeline Proxy System for ai-workflows
 *
 * Enables fluent domain-driven workflow syntax:
 *   const result = await $.Inventory(product).check()
 *   const priorities = await $.Roadmap(startup).prioritizeBacklog()
 *
 * The $ proxy intercepts property access and method calls to build
 * a pipeline that executes steps through the runtime.
 */

import { hashContext, hashPipeline } from './hash'

export interface WorkflowRuntime {
  executeStep<T>(stepId: string, pipeline: Pipeline, args: unknown[]): Promise<T>
}

export interface Pipeline {
  path: string[]
  context: unknown
  contextHash: string
  runtime: WorkflowRuntime
}

// Type for the pipeline proxy returned by domain functions
export type PipelineProxy = {
  [key: string]: PipelineProxy
} & ((...args: unknown[]) => Promise<unknown>)

// Type for the workflow API (the $ object)
export type WorkflowAPI = {
  [domain: string]: (context: unknown) => PipelineProxy
}

/**
 * Generate a step ID from path and context hash using the centralized hashing system
 */
function generateStepId(path: string[], contextHash: string): string {
  return hashPipeline(path, contextHash)
}

/**
 * Creates the pipeline proxy that handles property access and method calls.
 *
 * The proxy has two behaviors:
 * 1. Property access (get trap): Returns a new proxy with extended path
 * 2. Method call (apply trap): Executes the step via runtime and returns Promise
 */
function createPipelineProxy(pipeline: Pipeline): PipelineProxy {
  // Create a function as the base so it can be called (apply trap works)
  const fn = function () {} as unknown as PipelineProxy

  return new Proxy(fn, {
    // Handle property access - extend the path
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Create a new pipeline with extended path
      return createPipelineProxy({
        ...pipeline,
        path: [...pipeline.path, prop],
      })
    },

    // Handle method calls - execute the step
    apply(_target, _thisArg, args: unknown[]) {
      const stepId = generateStepId(pipeline.path, pipeline.contextHash)
      return pipeline.runtime.executeStep(stepId, pipeline, args)
    },
  })
}

/**
 * Creates the main workflow proxy ($).
 *
 * Usage:
 *   const $ = createWorkflowProxy(runtime)
 *   const result = await $.Inventory(product).check()
 *
 * The proxy intercepts property access to create domain factories.
 * Each domain factory captures context and returns a pipeline proxy.
 */
export function createWorkflowProxy(runtime: WorkflowRuntime): WorkflowAPI {
  return new Proxy({} as WorkflowAPI, {
    get(_target, domain: string | symbol) {
      if (typeof domain === 'symbol') {
        return undefined
      }

      // Return a function that captures context and creates pipeline proxy
      return (context: unknown): PipelineProxy => {
        const contextHash = hashContext(context)

        return createPipelineProxy({
          path: [domain],
          context,
          contextHash,
          runtime,
        })
      }
    },
  })
}
