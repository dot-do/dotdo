/**
 * Launch Workflow - High-level startup launch orchestration
 *
 * This module provides a declarative workflow definition for the
 * complete startup launch process. It demonstrates the pattern
 * from CLAUDE.md:
 *
 * ```typescript
 * export class MyStartup extends Startup {
 *   async launch() {
 *     const spec = priya`define the MVP for ${this.hypothesis}`
 *     let app = ralph`build ${spec}`
 *     do {
 *       app = ralph`improve ${app} per ${tom}`
 *     } while (!await tom.approve(app))
 *     mark`announce the launch`
 *     sally`start selling`
 *   }
 * }
 * ```
 *
 * @module agent-startup-launch/workflows/launch
 */

// ============================================================================
// TYPES
// ============================================================================

/** Agent identifiers */
export type AgentId = 'priya' | 'ralph' | 'tom' | 'mark' | 'sally' | 'quinn'

/** Workflow step status */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** A single step in the workflow */
export interface WorkflowStep {
  id: string
  name: string
  agent: AgentId
  action: string
  status: StepStatus
  dependsOn?: string[]
  condition?: (context: WorkflowContext) => boolean
  retry?: { maxAttempts: number; delay: number }
  timeout?: number
}

/** Workflow context passed between steps */
export interface WorkflowContext {
  hypothesis: {
    customer: string
    problem: string
    solution: string
    differentiator?: string
  }
  outputs: Record<string, unknown>
  iteration: number
  maxIterations: number
}

/** Complete workflow definition */
export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  onError?: 'fail' | 'continue' | 'retry'
}

// ============================================================================
// WORKFLOW BUILDER
// ============================================================================

/**
 * Builder for creating launch workflows
 */
export class LaunchWorkflowBuilder {
  private steps: WorkflowStep[] = []
  private workflowName: string = 'startup-launch'
  private workflowDescription: string = 'Complete startup launch workflow'

  /**
   * Set workflow metadata
   */
  name(name: string): this {
    this.workflowName = name
    return this
  }

  description(description: string): this {
    this.workflowDescription = description
    return this
  }

  /**
   * Add a step where Priya defines the product
   */
  define(action: string): this {
    this.steps.push({
      id: `define-${this.steps.length + 1}`,
      name: 'Define Product',
      agent: 'priya',
      action,
      status: 'pending',
    })
    return this
  }

  /**
   * Add a step where Ralph builds code
   */
  build(action: string): this {
    this.steps.push({
      id: `build-${this.steps.length + 1}`,
      name: 'Build Application',
      agent: 'ralph',
      action,
      status: 'pending',
      dependsOn: this.steps.length > 0 ? [this.steps[this.steps.length - 1].id] : undefined,
    })
    return this
  }

  /**
   * Add a step where Tom reviews
   */
  review(action: string): this {
    this.steps.push({
      id: `review-${this.steps.length + 1}`,
      name: 'Code Review',
      agent: 'tom',
      action,
      status: 'pending',
      dependsOn: this.steps.length > 0 ? [this.steps[this.steps.length - 1].id] : undefined,
    })
    return this
  }

  /**
   * Add a step where Mark creates marketing content
   */
  announce(action: string): this {
    this.steps.push({
      id: `announce-${this.steps.length + 1}`,
      name: 'Marketing Announcement',
      agent: 'mark',
      action,
      status: 'pending',
      dependsOn: this.steps.length > 0 ? [this.steps[this.steps.length - 1].id] : undefined,
    })
    return this
  }

  /**
   * Add a step where Sally handles sales
   */
  sell(action: string): this {
    this.steps.push({
      id: `sell-${this.steps.length + 1}`,
      name: 'Sales Strategy',
      agent: 'sally',
      action,
      status: 'pending',
      dependsOn: this.steps.length > 0 ? [this.steps[this.steps.length - 1].id] : undefined,
    })
    return this
  }

  /**
   * Add a conditional step
   */
  when(condition: (ctx: WorkflowContext) => boolean, step: WorkflowStep): this {
    this.steps.push({
      ...step,
      condition,
    })
    return this
  }

  /**
   * Add a loop of review/improve steps
   */
  reviewLoop(maxIterations: number = 3): this {
    this.steps.push({
      id: `review-loop-${this.steps.length + 1}`,
      name: 'Review and Improve Loop',
      agent: 'tom',
      action: 'review',
      status: 'pending',
      retry: { maxAttempts: maxIterations, delay: 0 },
    })
    return this
  }

  /**
   * Build the workflow definition
   */
  build(): WorkflowDefinition {
    return {
      id: `workflow-${Date.now().toString(36)}`,
      name: this.workflowName,
      description: this.workflowDescription,
      steps: this.steps,
    }
  }
}

// ============================================================================
// STANDARD LAUNCH WORKFLOW
// ============================================================================

/**
 * The standard startup launch workflow
 *
 * This implements the exact pattern from CLAUDE.md:
 * 1. Priya defines the MVP
 * 2. Ralph builds it
 * 3. Tom reviews (loop until approved)
 * 4. Mark announces
 * 5. Sally starts selling
 */
export const standardLaunchWorkflow: WorkflowDefinition = {
  id: 'standard-launch',
  name: 'Standard Startup Launch',
  description: 'Complete AI-driven startup launch workflow with 5 agents',
  steps: [
    {
      id: 'step-1-define',
      name: 'Define MVP',
      agent: 'priya',
      action: 'define the MVP for the hypothesis',
      status: 'pending',
    },
    {
      id: 'step-2-build',
      name: 'Build Application',
      agent: 'ralph',
      action: 'build the application from spec',
      status: 'pending',
      dependsOn: ['step-1-define'],
    },
    {
      id: 'step-3-review',
      name: 'Review and Iterate',
      agent: 'tom',
      action: 'review code and approve or request changes',
      status: 'pending',
      dependsOn: ['step-2-build'],
      retry: { maxAttempts: 5, delay: 0 },
    },
    {
      id: 'step-4-announce',
      name: 'Launch Announcement',
      agent: 'mark',
      action: 'create launch content and announce',
      status: 'pending',
      dependsOn: ['step-3-review'],
    },
    {
      id: 'step-5-sell',
      name: 'Start Selling',
      agent: 'sally',
      action: 'develop sales strategy and start outreach',
      status: 'pending',
      dependsOn: ['step-4-announce'],
    },
  ],
  onError: 'fail',
}

// ============================================================================
// WORKFLOW FACTORY
// ============================================================================

/**
 * Create a new launch workflow builder
 */
export function createLaunchWorkflow(): LaunchWorkflowBuilder {
  return new LaunchWorkflowBuilder()
}

/**
 * Create a minimal launch workflow (skip some steps)
 */
export function createMinimalLaunchWorkflow(): WorkflowDefinition {
  return createLaunchWorkflow()
    .name('minimal-launch')
    .description('Minimal launch workflow for quick validation')
    .define('define a simple MVP')
    .build('build minimal implementation')
    .announce('create basic launch announcement')
    .build()
}

/**
 * Create a full launch workflow with all bells and whistles
 */
export function createFullLaunchWorkflow(): WorkflowDefinition {
  return createLaunchWorkflow()
    .name('full-launch')
    .description('Full production launch workflow with QA and compliance')
    .define('define comprehensive product specification')
    .build('build production-ready implementation')
    .reviewLoop(5)
    .announce('create full marketing campaign')
    .sell('develop enterprise sales strategy')
    .build()
}

export default standardLaunchWorkflow
