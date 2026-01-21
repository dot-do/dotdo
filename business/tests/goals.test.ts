/**
 * Goals API / OKR System Tests
 *
 * TDD Red-Green-Refactor tests for the GoalsAPI and ObjectiveBuilder.
 *
 * Tests cover:
 * - ObjectiveBuilder fluent API
 * - Objective persistence via save()
 * - GoalsAPI.progress() calculation
 * - GoalsAPI.list() querying
 * - Status determination (on-track, at-risk, behind)
 *
 * Uses HTTP fetch API pattern per DO testing conventions.
 *
 * @module business/tests/goals.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Objective, KeyResult } from '../types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ProgressResult {
  overall: number
  keyResults: Array<{ name: string; progress: number; status: string }>
  status: 'on-track' | 'at-risk' | 'behind' | 'completed'
  recommendations?: string[]
}

interface CreateObjectiveRequest {
  name: string
  description?: string
  keyResults: Array<{
    name: string
    target: number
    unit?: string
    metricKey?: string
  }>
  period: string
  owner?: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Create an objective via HTTP API
 */
async function createObjective(
  stub: DurableObjectStub,
  data: CreateObjectiveRequest
): Promise<Objective> {
  const response = await stub.fetch('https://business/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create objective: ${error}`)
  }

  return response.json() as Promise<Objective>
}

/**
 * List objectives via HTTP API
 */
async function listObjectives(
  stub: DurableObjectStub,
  period?: string
): Promise<Objective[]> {
  const url = period
    ? `https://business/goals?period=${encodeURIComponent(period)}`
    : 'https://business/goals'

  const response = await stub.fetch(url)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to list objectives: ${error}`)
  }

  return response.json() as Promise<Objective[]>
}

/**
 * Get progress for an objective via HTTP API
 */
async function getProgress(
  stub: DurableObjectStub,
  nameOrId: string
): Promise<ProgressResult> {
  const response = await stub.fetch(
    `https://business/goals/${encodeURIComponent(nameOrId)}/progress`
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get progress: ${error}`)
  }

  return response.json() as Promise<ProgressResult>
}

/**
 * Update an objective via HTTP API
 */
async function updateObjective(
  stub: DurableObjectStub,
  id: string,
  updates: Partial<Objective>
): Promise<Objective> {
  const response = await stub.fetch(`https://business/goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to update objective: ${error}`)
  }

  return response.json() as Promise<Objective>
}

// ============================================================================
// OBJECTIVE CREATION TESTS
// ============================================================================

describe('Objective Creation', () => {
  it('should create objective with name', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Increase Revenue',
      keyResults: [{ name: '$100K MRR', target: 100000 }],
      period: 'Q1-2024',
    })

    expect(objective).toBeDefined()
    expect(objective.name).toBe('Increase Revenue')
  })

  it('should create objective with multiple key results', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Growth Goals',
      keyResults: [
        { name: '$100K MRR', target: 100000 },
        { name: '1000 customers', target: 1000, unit: 'customers' },
        { name: '50% retention', target: 50, unit: '%' },
      ],
      period: 'Q2-2024',
    })

    expect(objective.keyResults).toHaveLength(3)
    expect(objective.keyResults[0].name).toBe('$100K MRR')
    expect(objective.keyResults[1].name).toBe('1000 customers')
    expect(objective.keyResults[2].name).toBe('50% retention')
  })

  it('should set period correctly', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Q3 Goals',
      keyResults: [{ name: 'Revenue target', target: 200000 }],
      period: 'Q3-2024',
    })

    expect(objective.period).toBeDefined()
    expect(objective.period.name).toBe('Q3-2024')
  })

  it('should set owner correctly', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'CEO Goals',
      keyResults: [{ name: 'Strategic target', target: 1000000 }],
      period: '2024',
      owner: 'ceo@company.com',
    })

    expect(objective.owner).toBe('ceo@company.com')
  })

  it('should set description correctly', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Revenue Goal',
      description: 'Grow revenue by expanding to new markets',
      keyResults: [{ name: '$500K ARR', target: 500000 }],
      period: 'H1-2024',
    })

    expect(objective.description).toBe('Grow revenue by expanding to new markets')
  })
})

// ============================================================================
// OBJECTIVE PERSISTENCE TESTS
// ============================================================================

describe('Objective Persistence', () => {
  it('should generate unique id on save', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Test Objective',
      keyResults: [{ name: 'Test KR', target: 100 }],
      period: 'Q1-2024',
    })

    expect(objective.id).toBeDefined()
    expect(typeof objective.id).toBe('string')
    expect(objective.id.length).toBeGreaterThan(0)
  })

  it('should persist objective to things store', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Persistent Goal',
      keyResults: [{ name: 'Persistent KR', target: 100 }],
      period: 'Q1-2024',
    })

    // Verify it's actually stored by listing objectives
    const objectives = await listObjectives(stub)
    const found = objectives.find((o) => o.id === objective.id)

    expect(found).toBeDefined()
    expect(found?.name).toBe('Persistent Goal')
  })

  it('should set createdAt timestamp on save', async () => {
    const stub = getStub()
    const beforeSave = new Date()

    const objective = await createObjective(stub, {
      name: 'Timestamped Goal',
      keyResults: [{ name: 'Test KR', target: 100 }],
      period: 'Q1-2024',
    })

    expect(objective.createdAt).toBeDefined()
    expect(new Date(objective.createdAt).getTime()).toBeGreaterThanOrEqual(
      beforeSave.getTime()
    )
  })

  it('should save key results with targets', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'KR Test',
      keyResults: [
        { name: 'Revenue', target: 100000, unit: '$' },
        { name: 'Users', target: 500, unit: 'users' },
      ],
      period: 'Q1-2024',
    })

    expect(objective.keyResults[0].targetValue).toBe(100000)
    expect(objective.keyResults[0].unit).toBe('$')
    expect(objective.keyResults[1].targetValue).toBe(500)
    expect(objective.keyResults[1].unit).toBe('users')
  })

  it('should initialize key result currentValue to 0', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Initial Values',
      keyResults: [{ name: 'Test KR', target: 100 }],
      period: 'Q1-2024',
    })

    expect(objective.keyResults[0].currentValue).toBe(0)
  })
})

// ============================================================================
// GOALS API LIST TESTS
// ============================================================================

describe('GoalsAPI.list()', () => {
  it('should return empty array when no objectives exist', async () => {
    const stub = getStub()

    const objectives = await listObjectives(stub)

    expect(objectives).toEqual([])
  })

  it('should return all saved objectives', async () => {
    const stub = getStub()

    await createObjective(stub, {
      name: 'Goal 1',
      keyResults: [{ name: 'KR 1', target: 100 }],
      period: 'Q1-2024',
    })

    await createObjective(stub, {
      name: 'Goal 2',
      keyResults: [{ name: 'KR 2', target: 200 }],
      period: 'Q1-2024',
    })

    const objectives = await listObjectives(stub)

    expect(objectives).toHaveLength(2)
    expect(objectives.map((o) => o.name)).toContain('Goal 1')
    expect(objectives.map((o) => o.name)).toContain('Goal 2')
  })

  it('should filter objectives by period', async () => {
    const stub = getStub()

    await createObjective(stub, {
      name: 'Q1 Goal',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q1-2024',
    })

    await createObjective(stub, {
      name: 'Q2 Goal',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q2-2024',
    })

    const q1Objectives = await listObjectives(stub, 'Q1-2024')

    expect(q1Objectives).toHaveLength(1)
    expect(q1Objectives[0].name).toBe('Q1 Goal')
  })
})

// ============================================================================
// GOALS API PROGRESS TESTS
// ============================================================================

describe('GoalsAPI.progress()', () => {
  it('should calculate overall progress from key results', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Progress Test',
      keyResults: [
        { name: 'KR1', target: 100 },
        { name: 'KR2', target: 100 },
      ],
      period: 'Q1-2024',
    })

    // Update key result values
    await updateObjective(stub, objective.id, {
      keyResults: [
        { ...objective.keyResults[0], currentValue: 50 }, // 50% progress
        { ...objective.keyResults[1], currentValue: 100 }, // 100% progress
      ],
    })

    const progress = await getProgress(stub, objective.name)

    // Average of 50% and 100% = 75%
    expect(progress.overall).toBe(0.75)
  })

  it('should return progress for each key result', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'KR Progress Test',
      keyResults: [
        { name: 'Revenue', target: 100 },
        { name: 'Users', target: 200 },
      ],
      period: 'Q1-2024',
    })

    await updateObjective(stub, objective.id, {
      keyResults: [
        { ...objective.keyResults[0], currentValue: 75 },
        { ...objective.keyResults[1], currentValue: 50 },
      ],
    })

    const progress = await getProgress(stub, objective.name)

    expect(progress.keyResults).toHaveLength(2)
    expect(progress.keyResults[0].name).toBe('Revenue')
    expect(progress.keyResults[0].progress).toBe(0.75)
    expect(progress.keyResults[1].name).toBe('Users')
    expect(progress.keyResults[1].progress).toBe(0.25)
  })

  it('should handle 0 target gracefully', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Zero Target',
      keyResults: [{ name: 'No target', target: 0 }],
      period: 'Q1-2024',
    })

    const progress = await getProgress(stub, objective.name)

    // With target 0, progress should be 0 (avoid division by zero)
    expect(progress.overall).toBe(0)
    expect(progress.keyResults[0].progress).toBe(0)
  })

  it('should return completed status when all KRs at 100%', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Completed Test',
      keyResults: [
        { name: 'KR1', target: 100 },
        { name: 'KR2', target: 100 },
      ],
      period: 'Q1-2024',
    })

    await updateObjective(stub, objective.id, {
      keyResults: [
        { ...objective.keyResults[0], currentValue: 100 },
        { ...objective.keyResults[1], currentValue: 100 },
      ],
    })

    const progress = await getProgress(stub, objective.name)

    expect(progress.status).toBe('completed')
  })

  it('should find objective by id or name', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Findable Goal',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q1-2024',
    })

    // By name
    const progressByName = await getProgress(stub, 'Findable Goal')
    expect(progressByName).toBeDefined()

    // By id
    const progressById = await getProgress(stub, objective.id)
    expect(progressById).toBeDefined()
    expect(progressById.overall).toBe(progressByName.overall)
  })
})

// ============================================================================
// STATUS DETERMINATION TESTS
// ============================================================================

describe('OKR Status Determination', () => {
  it('should be on-track when progress >= 60%', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'On Track Test',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q1-2024',
    })

    // Progress 60% should be on-track
    await updateObjective(stub, objective.id, {
      keyResults: [{ ...objective.keyResults[0], currentValue: 60 }],
    })

    const progress = await getProgress(stub, objective.name)

    expect(['on-track', 'completed']).toContain(progress.status)
  })

  it('should be at-risk when progress between 30-60%', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'At Risk Test',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q1-2024',
    })

    // 40% progress = at-risk
    await updateObjective(stub, objective.id, {
      keyResults: [{ ...objective.keyResults[0], currentValue: 40 }],
    })

    const progress = await getProgress(stub, objective.name)

    expect(progress.status).toBe('at-risk')
  })

  it('should be behind when progress < 30%', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Behind Test',
      keyResults: [{ name: 'KR', target: 100 }],
      period: 'Q1-2024',
    })

    // Only 10% progress
    await updateObjective(stub, objective.id, {
      keyResults: [{ ...objective.keyResults[0], currentValue: 10 }],
    })

    const progress = await getProgress(stub, objective.name)

    expect(progress.status).toBe('behind')
  })

  it('should set individual key result status correctly', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Mixed Status',
      keyResults: [
        { name: 'Good KR', target: 100 },
        { name: 'Bad KR', target: 100 },
      ],
      period: 'Q1-2024',
    })

    await updateObjective(stub, objective.id, {
      keyResults: [
        { ...objective.keyResults[0], currentValue: 100 }, // 100%
        { ...objective.keyResults[1], currentValue: 10 }, // 10%
      ],
    })

    const progress = await getProgress(stub, objective.name)

    expect(progress.keyResults[0].status).toBe('completed')
    expect(['at-risk', 'behind']).toContain(progress.keyResults[1].status)
  })
})

// ============================================================================
// METRIC KEY INTEGRATION TESTS
// ============================================================================

describe('MetricKey Integration', () => {
  it('should accept metricKey in keyResult', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Metric Test',
      keyResults: [{ name: '$100K MRR', target: 100000, metricKey: 'mrr' }],
      period: 'Q1-2024',
    })

    expect(objective.keyResults[0].metricKey).toBe('mrr')
  })

  it('should support dotted metric paths', async () => {
    const stub = getStub()

    const objective = await createObjective(stub, {
      name: 'Nested Metric Test',
      keyResults: [
        { name: '1000 customers', target: 1000, metricKey: 'customers.count' },
      ],
      period: 'Q1-2024',
    })

    expect(objective.keyResults[0].metricKey).toBe('customers.count')
  })
})
