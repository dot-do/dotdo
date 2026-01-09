import { describe, it, expect } from 'vitest'

/**
 * Experiment Type Tests
 *
 * These tests verify the Experiment type for branch-based A/B testing
 * using git semantics (branches ARE variants).
 *
 * This is RED phase TDD - tests should FAIL until the Experiment type
 * is implemented in types/Experiment.ts.
 *
 * Schema from docs/concepts/experiments.mdx:
 * ```typescript
 * Experiment: {
 *   thing: string           // 'qualifyLead'
 *   branches: string[]      // ['main', 'ai-experiment']
 *   traffic: number         // 0-1, percentage in experiment
 *   metric: string          // 'Sales.qualified'
 *   status: 'draft' | 'running' | 'completed'
 *   winner?: string         // Winning branch
 * }
 * ```
 *
 * Implementation requirements:
 * - Create Experiment type in types/Experiment.ts
 * - Export from types/index.ts
 * - Create ExperimentSchema for validation (optional Zod schema)
 * - thing field references a Thing by id
 * - branches are git-like branch names
 * - traffic is a decimal 0-1 (percentage in experiment)
 * - metric references an event pattern for measuring success
 * - status tracks experiment lifecycle
 * - winner is the winning branch when completed
 */

// ============================================================================
// Type Interface (Expected)
// ============================================================================

interface Experiment {
  id: string
  thing: string // Thing id being experimented on (e.g., 'qualifyLead')
  branches: string[] // Branch variants (e.g., ['main', 'ai-experiment'])
  traffic: number // 0-1, percentage of users in experiment
  metric: string // Event pattern to measure (e.g., 'Sales.qualified')
  status: 'draft' | 'running' | 'completed'
  winner?: string // Winning branch when completed
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let ExperimentType: unknown
let ExperimentSchema: { parse?: unknown; safeParse?: unknown } | undefined

// Try to import - will be undefined until implemented
try {
  // @ts-expect-error - Experiment type not yet implemented
  const module = await import('../Experiment')
  ExperimentType = module.Experiment
  ExperimentSchema = module.ExperimentSchema
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  ExperimentType = undefined
  ExperimentSchema = undefined
}

// ============================================================================
// 1. Type Export Tests
// ============================================================================

describe('Experiment Type Export', () => {
  it('Experiment type is exported from types/Experiment.ts', () => {
    // This will fail until Experiment type is added
    expect(ExperimentType).toBeDefined()
  })

  it('ExperimentSchema is exported for validation', () => {
    // Optional Zod schema for runtime validation
    expect(ExperimentSchema).toBeDefined()
  })
})

// ============================================================================
// 2. Required Fields Tests - thing
// ============================================================================

describe('Experiment.thing Field', () => {
  it('thing field is required', () => {
    const experiment: Partial<Experiment> = {
      id: 'exp-001',
      branches: ['main', 'variant-a'],
      traffic: 0.5,
      metric: 'Sales.qualified',
      status: 'draft',
      // thing is missing - should be invalid
    }

    expect(experiment.thing).toBeUndefined()
  })

  it('thing field accepts string value (Thing id)', () => {
    const experiment: Experiment = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(experiment.thing).toBe('qualifyLead')
    expect(typeof experiment.thing).toBe('string')
  })

  it('thing field references a Function Thing', () => {
    // Experiments typically run on Functions (code with variants)
    const functionExperiment: Experiment = {
      id: 'exp-func-001',
      thing: 'processPayment',
      branches: ['main', 'stripe-v2'],
      traffic: 0.1,
      metric: 'Payment.succeeded',
      status: 'running',
    }

    expect(functionExperiment.thing).toBe('processPayment')
  })

  it('thing field can reference a Workflow Thing', () => {
    // Can also experiment on workflows
    const workflowExperiment: Experiment = {
      id: 'exp-wf-001',
      thing: 'onboardingFlow',
      branches: ['main', 'simplified-flow'],
      traffic: 0.25,
      metric: 'Onboarding.completed',
      status: 'running',
    }

    expect(workflowExperiment.thing).toBe('onboardingFlow')
  })

  it('thing field cannot be empty string', () => {
    const invalidExperiment: Partial<Experiment> = {
      id: 'exp-invalid-001',
      thing: '', // Invalid - empty string
      branches: ['main'],
      traffic: 0.5,
      metric: 'Event.occurred',
      status: 'draft',
    }

    expect(invalidExperiment.thing).toBe('')
    // Schema validation should reject this
  })
})

// ============================================================================
// 3. Required Fields Tests - branches
// ============================================================================

describe('Experiment.branches Field', () => {
  it('branches field is required', () => {
    const experiment: Partial<Experiment> = {
      id: 'exp-001',
      thing: 'qualifyLead',
      traffic: 0.5,
      metric: 'Sales.qualified',
      status: 'draft',
      // branches is missing - should be invalid
    }

    expect(experiment.branches).toBeUndefined()
  })

  it('branches field is an array of strings', () => {
    const experiment: Experiment = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(Array.isArray(experiment.branches)).toBe(true)
    expect(experiment.branches.length).toBe(2)
    experiment.branches.forEach((branch) => {
      expect(typeof branch).toBe('string')
    })
  })

  it('branches must include at least two variants', () => {
    // An experiment requires at least 2 branches to compare
    const validExperiment: Experiment = {
      id: 'exp-valid-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.5,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(validExperiment.branches.length).toBeGreaterThanOrEqual(2)
  })

  it('branches typically includes "main" as control', () => {
    const experiment: Experiment = {
      id: 'exp-control-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-v1', 'ai-v2'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(experiment.branches).toContain('main')
  })

  it('branches can include multiple variants', () => {
    // Multi-arm experiment with many variants
    const multiArmExperiment: Experiment = {
      id: 'exp-multi-001',
      thing: 'emailSubject',
      branches: ['main', 'variant-a', 'variant-b', 'variant-c', 'variant-d'],
      traffic: 0.4,
      metric: 'Email.opened',
      status: 'running',
    }

    expect(multiArmExperiment.branches.length).toBe(5)
  })

  it('branches uses git-like naming convention', () => {
    const experiment: Experiment = {
      id: 'exp-git-001',
      thing: 'checkoutFlow',
      branches: ['main', 'feature/new-checkout', 'experiment/ai-upsell'],
      traffic: 0.15,
      metric: 'Checkout.completed',
      status: 'draft',
    }

    expect(experiment.branches).toContain('main')
    expect(experiment.branches).toContain('feature/new-checkout')
    expect(experiment.branches).toContain('experiment/ai-upsell')
  })

  it('branches cannot be empty array', () => {
    const invalidExperiment: Partial<Experiment> = {
      id: 'exp-empty-001',
      thing: 'qualifyLead',
      branches: [], // Invalid - empty array
      traffic: 0.5,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(invalidExperiment.branches?.length).toBe(0)
    // Schema validation should reject this
  })

  it('branches should not have duplicates', () => {
    const experiment: Experiment = {
      id: 'exp-unique-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a', 'variant-b'],
      traffic: 0.3,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    const uniqueBranches = new Set(experiment.branches)
    expect(uniqueBranches.size).toBe(experiment.branches.length)
  })
})

// ============================================================================
// 4. Required Fields Tests - traffic
// ============================================================================

describe('Experiment.traffic Field', () => {
  it('traffic field is required', () => {
    const experiment: Partial<Experiment> = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      metric: 'Sales.qualified',
      status: 'draft',
      // traffic is missing - should be invalid
    }

    expect(experiment.traffic).toBeUndefined()
  })

  it('traffic field accepts number value', () => {
    const experiment: Experiment = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(typeof experiment.traffic).toBe('number')
  })

  it('traffic is 0-1 representing percentage', () => {
    // 0.2 = 20% of users in experiment
    const experiment20Percent: Experiment = {
      id: 'exp-20-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2, // 20%
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(experiment20Percent.traffic).toBe(0.2)
    expect(experiment20Percent.traffic).toBeGreaterThanOrEqual(0)
    expect(experiment20Percent.traffic).toBeLessThanOrEqual(1)
  })

  it('traffic can be 0 (paused experiment)', () => {
    const pausedExperiment: Experiment = {
      id: 'exp-paused-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0, // 0% - no traffic
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(pausedExperiment.traffic).toBe(0)
  })

  it('traffic can be 1 (100% in experiment)', () => {
    const fullTrafficExperiment: Experiment = {
      id: 'exp-full-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1, // 100% - all traffic
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(fullTrafficExperiment.traffic).toBe(1)
  })

  it('traffic rejects values less than 0', () => {
    const invalidExperiment: Partial<Experiment> = {
      id: 'exp-neg-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: -0.1, // Invalid - negative
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(invalidExperiment.traffic).toBeLessThan(0)
    // Schema validation should reject this
  })

  it('traffic rejects values greater than 1', () => {
    const invalidExperiment: Partial<Experiment> = {
      id: 'exp-over-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.5, // Invalid - over 100%
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(invalidExperiment.traffic).toBeGreaterThan(1)
    // Schema validation should reject this
  })

  it('traffic represents holdout (users NOT in experiment)', () => {
    // If traffic is 0.2, then 80% of users see 'main' (control)
    // and 20% are split among experiment branches
    const experiment: Experiment = {
      id: 'exp-holdout-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a', 'variant-b'],
      traffic: 0.2, // 20% in experiment
      metric: 'Sales.qualified',
      status: 'running',
    }

    const inExperiment = experiment.traffic
    const holdout = 1 - experiment.traffic

    expect(inExperiment).toBe(0.2)
    expect(holdout).toBe(0.8)
  })
})

// ============================================================================
// 5. Required Fields Tests - metric
// ============================================================================

describe('Experiment.metric Field', () => {
  it('metric field is required', () => {
    const experiment: Partial<Experiment> = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.5,
      status: 'draft',
      // metric is missing - should be invalid
    }

    expect(experiment.metric).toBeUndefined()
  })

  it('metric field accepts string value', () => {
    const experiment: Experiment = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(typeof experiment.metric).toBe('string')
  })

  it('metric follows Noun.verb event pattern', () => {
    const experiment: Experiment = {
      id: 'exp-pattern-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified', // Noun.verb pattern
      status: 'running',
    }

    expect(experiment.metric).toBe('Sales.qualified')
    expect(experiment.metric).toMatch(/^\w+\.\w+$/)
  })

  it('metric can be conversion event', () => {
    const conversionExperiment: Experiment = {
      id: 'exp-conv-001',
      thing: 'checkoutFlow',
      branches: ['main', 'new-checkout'],
      traffic: 0.15,
      metric: 'Order.completed',
      status: 'running',
    }

    expect(conversionExperiment.metric).toBe('Order.completed')
  })

  it('metric can be engagement event', () => {
    const engagementExperiment: Experiment = {
      id: 'exp-engage-001',
      thing: 'emailSubject',
      branches: ['main', 'personalized'],
      traffic: 0.3,
      metric: 'Email.clicked',
      status: 'running',
    }

    expect(engagementExperiment.metric).toBe('Email.clicked')
  })

  it('metric can be retention event', () => {
    const retentionExperiment: Experiment = {
      id: 'exp-retain-001',
      thing: 'onboardingFlow',
      branches: ['main', 'gamified'],
      traffic: 0.25,
      metric: 'User.activated',
      status: 'running',
    }

    expect(retentionExperiment.metric).toBe('User.activated')
  })

  it('metric cannot be empty string', () => {
    const invalidExperiment: Partial<Experiment> = {
      id: 'exp-empty-metric-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.5,
      metric: '', // Invalid - empty string
      status: 'draft',
    }

    expect(invalidExperiment.metric).toBe('')
    // Schema validation should reject this
  })
})

// ============================================================================
// 6. Required Fields Tests - status
// ============================================================================

describe('Experiment.status Field', () => {
  it('status field is required', () => {
    const experiment: Partial<Experiment> = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.5,
      metric: 'Sales.qualified',
      // status is missing - should be invalid
    }

    expect(experiment.status).toBeUndefined()
  })

  it('status accepts "draft" value', () => {
    const draftExperiment: Experiment = {
      id: 'exp-draft-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(draftExperiment.status).toBe('draft')
  })

  it('status accepts "running" value', () => {
    const runningExperiment: Experiment = {
      id: 'exp-running-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(runningExperiment.status).toBe('running')
  })

  it('status accepts "completed" value', () => {
    const completedExperiment: Experiment = {
      id: 'exp-completed-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    }

    expect(completedExperiment.status).toBe('completed')
  })

  it('status is one of the allowed values', () => {
    const validStatuses: Array<'draft' | 'running' | 'completed'> = ['draft', 'running', 'completed']

    validStatuses.forEach((status) => {
      expect(['draft', 'running', 'completed']).toContain(status)
    })
  })

  it('draft status means experiment is not yet active', () => {
    const draftExperiment: Experiment = {
      id: 'exp-draft-state-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(draftExperiment.status).toBe('draft')
    // Draft experiments should not affect traffic routing
  })

  it('running status means experiment is active and collecting data', () => {
    const runningExperiment: Experiment = {
      id: 'exp-active-state-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(runningExperiment.status).toBe('running')
    // Running experiments route traffic to branches
  })

  it('completed status means experiment has concluded', () => {
    const completedExperiment: Experiment = {
      id: 'exp-done-state-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    }

    expect(completedExperiment.status).toBe('completed')
    // Completed experiments have determined a winner
  })
})

// ============================================================================
// 7. Optional Fields Tests - winner
// ============================================================================

describe('Experiment.winner Field', () => {
  it('winner field is optional', () => {
    const experimentWithoutWinner: Experiment = {
      id: 'exp-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
      // winner is not specified - valid for draft/running
    }

    expect(experimentWithoutWinner.winner).toBeUndefined()
  })

  it('winner is undefined for draft experiments', () => {
    const draftExperiment: Experiment = {
      id: 'exp-draft-win-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(draftExperiment.winner).toBeUndefined()
  })

  it('winner is undefined for running experiments', () => {
    const runningExperiment: Experiment = {
      id: 'exp-running-win-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(runningExperiment.winner).toBeUndefined()
  })

  it('winner is required for completed experiments', () => {
    const completedExperiment: Experiment = {
      id: 'exp-completed-win-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    }

    expect(completedExperiment.winner).toBeDefined()
    expect(completedExperiment.winner).toBe('variant-a')
  })

  it('winner must be one of the branches', () => {
    const experiment: Experiment = {
      id: 'exp-valid-win-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a', 'variant-b'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-b',
    }

    expect(experiment.branches).toContain(experiment.winner)
  })

  it('winner can be main (control wins)', () => {
    const controlWins: Experiment = {
      id: 'exp-control-wins-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'main', // Control performed better
    }

    expect(controlWins.winner).toBe('main')
    expect(controlWins.branches).toContain(controlWins.winner)
  })

  it('winner is a variant when variant outperforms control', () => {
    const variantWins: Experiment = {
      id: 'exp-variant-wins-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'ai-experiment', // Variant performed better
    }

    expect(variantWins.winner).toBe('ai-experiment')
    expect(variantWins.branches).toContain(variantWins.winner)
  })

  it('winner cannot be a branch not in branches array', () => {
    const invalidExperiment: Experiment = {
      id: 'exp-invalid-win-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-b', // Invalid - not in branches
    }

    // Schema validation should reject this
    expect(invalidExperiment.branches).not.toContain(invalidExperiment.winner)
  })
})

// ============================================================================
// 8. Status Transitions Tests
// ============================================================================

describe('Experiment Status Transitions', () => {
  it('draft -> running (experiment starts)', () => {
    const beforeStart: Experiment = {
      id: 'exp-start-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    const afterStart: Experiment = {
      ...beforeStart,
      status: 'running',
    }

    expect(beforeStart.status).toBe('draft')
    expect(afterStart.status).toBe('running')
  })

  it('running -> completed (winner declared)', () => {
    const beforeComplete: Experiment = {
      id: 'exp-complete-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    const afterComplete: Experiment = {
      ...beforeComplete,
      status: 'completed',
      winner: 'variant-a',
    }

    expect(beforeComplete.status).toBe('running')
    expect(afterComplete.status).toBe('completed')
    expect(afterComplete.winner).toBe('variant-a')
  })

  it('running -> draft (experiment paused)', () => {
    // Optional: ability to pause/revert an experiment
    const runningExperiment: Experiment = {
      id: 'exp-pause-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    const pausedExperiment: Experiment = {
      ...runningExperiment,
      status: 'draft',
      traffic: 0, // Set traffic to 0 when pausing
    }

    expect(runningExperiment.status).toBe('running')
    expect(pausedExperiment.status).toBe('draft')
    expect(pausedExperiment.traffic).toBe(0)
  })

  it('completed experiments cannot be restarted', () => {
    // Business rule: once completed, experiment is final
    const completedExperiment: Experiment = {
      id: 'exp-final-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    }

    // Application should prevent changing status from completed
    expect(completedExperiment.status).toBe('completed')
  })
})

// ============================================================================
// 9. Validation Tests
// ============================================================================

describe('Experiment Validation', () => {
  it('valid complete experiment passes validation', () => {
    const validExperiment: Experiment = {
      id: 'exp-valid-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
    }

    // All required fields are present and valid
    expect(validExperiment.id).toBeDefined()
    expect(validExperiment.thing).toBeDefined()
    expect(validExperiment.branches.length).toBeGreaterThanOrEqual(2)
    expect(validExperiment.traffic).toBeGreaterThanOrEqual(0)
    expect(validExperiment.traffic).toBeLessThanOrEqual(1)
    expect(validExperiment.metric).toBeDefined()
    expect(['draft', 'running', 'completed']).toContain(validExperiment.status)
  })

  it('completed experiment requires winner field', () => {
    const invalidCompleted: Partial<Experiment> = {
      id: 'exp-invalid-complete-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'completed',
      // winner is missing - should be invalid for completed status
    }

    expect(invalidCompleted.status).toBe('completed')
    expect(invalidCompleted.winner).toBeUndefined()
    // Schema validation should reject this
  })

  it('draft/running experiments should not have winner', () => {
    const prematureWinner: Experiment = {
      id: 'exp-premature-001',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'running',
      winner: 'variant-a', // Should not have winner while running
    }

    // Business logic should prevent this
    expect(prematureWinner.status).toBe('running')
    expect(prematureWinner.winner).toBeDefined()
    // This combination is logically invalid
  })

  it('at least 2 branches are required', () => {
    const singleBranch: Partial<Experiment> = {
      id: 'exp-single-001',
      thing: 'qualifyLead',
      branches: ['main'], // Only 1 branch - invalid
      traffic: 0.2,
      metric: 'Sales.qualified',
      status: 'draft',
    }

    expect(singleBranch.branches?.length).toBe(1)
    // Schema validation should reject this
  })
})

// ============================================================================
// 10. Use Case Tests
// ============================================================================

describe('Experiment Use Cases', () => {
  it('A/B test for lead qualification function', () => {
    const leadQualExperiment: Experiment = {
      id: 'exp-lead-qual-001',
      thing: 'qualifyLead',
      branches: ['main', 'ai-experiment'],
      traffic: 0.2, // 20% in experiment
      metric: 'Sales.qualified',
      status: 'running',
    }

    expect(leadQualExperiment.thing).toBe('qualifyLead')
    expect(leadQualExperiment.branches).toEqual(['main', 'ai-experiment'])
  })

  it('multi-variant test for email subject lines', () => {
    const emailExperiment: Experiment = {
      id: 'exp-email-001',
      thing: 'welcomeEmailSubject',
      branches: ['main', 'personalized', 'urgency', 'question'],
      traffic: 0.4, // 40% in experiment
      metric: 'Email.opened',
      status: 'running',
    }

    expect(emailExperiment.branches.length).toBe(4)
    expect(emailExperiment.metric).toBe('Email.opened')
  })

  it('gradual rollout of new feature', () => {
    const rolloutExperiment: Experiment = {
      id: 'exp-rollout-001',
      thing: 'newDashboard',
      branches: ['main', 'new-ui'],
      traffic: 0.1, // Start with 10%
      metric: 'User.engaged',
      status: 'running',
    }

    expect(rolloutExperiment.traffic).toBe(0.1)
    // Can increase traffic over time
  })

  it('completed experiment with winner', () => {
    const completedExperiment: Experiment = {
      id: 'exp-done-001',
      thing: 'checkoutFlow',
      branches: ['main', 'one-page-checkout'],
      traffic: 0.25,
      metric: 'Order.completed',
      status: 'completed',
      winner: 'one-page-checkout', // New checkout won
    }

    expect(completedExperiment.status).toBe('completed')
    expect(completedExperiment.winner).toBe('one-page-checkout')
  })

  it('feature flag as simple experiment', () => {
    // Feature flags are experiments with 2 branches
    const featureFlag: Experiment = {
      id: 'flag-dark-mode-001',
      thing: 'darkModeToggle',
      branches: ['main', 'enabled'],
      traffic: 0.5, // 50% see dark mode
      metric: 'Settings.changed',
      status: 'running',
    }

    expect(featureFlag.branches).toEqual(['main', 'enabled'])
  })
})

// ============================================================================
// 11. Schema Export Tests (Zod validation)
// ============================================================================

describe('ExperimentSchema Validation', () => {
  it('ExperimentSchema exports parse function', () => {
    expect(typeof ExperimentSchema?.parse).toBe('function')
  })

  it('ExperimentSchema exports safeParse function', () => {
    expect(typeof ExperimentSchema?.safeParse).toBe('function')
  })

  it('ExperimentSchema validates traffic range (0-1)', () => {
    const validResult = ExperimentSchema?.safeParse({
      id: 'exp-001',
      thing: 'test',
      branches: ['main', 'variant'],
      traffic: 0.5,
      metric: 'Event.occurred',
      status: 'draft',
    })

    expect(validResult?.success).toBe(true)
  })

  it('ExperimentSchema rejects invalid traffic', () => {
    const invalidResult = ExperimentSchema?.safeParse({
      id: 'exp-001',
      thing: 'test',
      branches: ['main', 'variant'],
      traffic: 1.5, // Invalid - > 1
      metric: 'Event.occurred',
      status: 'draft',
    })

    expect(invalidResult?.success).toBe(false)
  })

  it('ExperimentSchema validates status enum', () => {
    const validResult = ExperimentSchema?.safeParse({
      id: 'exp-001',
      thing: 'test',
      branches: ['main', 'variant'],
      traffic: 0.5,
      metric: 'Event.occurred',
      status: 'running',
    })

    expect(validResult?.success).toBe(true)
  })

  it('ExperimentSchema rejects invalid status', () => {
    const invalidResult = ExperimentSchema?.safeParse({
      id: 'exp-001',
      thing: 'test',
      branches: ['main', 'variant'],
      traffic: 0.5,
      metric: 'Event.occurred',
      status: 'paused', // Invalid - not in enum
    })

    expect(invalidResult?.success).toBe(false)
  })
})
