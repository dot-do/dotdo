/**
 * Experiment Branch Resolution
 *
 * Deterministically assigns users to experiment branches via hash.
 *
 * This is a STUB file for TDD RED phase - all functions throw "not implemented".
 * Implementation will be added in GREEN phase.
 */

export interface Experiment {
  id: string
  thing: string
  branches: string[]
  traffic: number // 0-1, percentage in experiment
  metric: string
  status: 'draft' | 'running' | 'completed'
  winner?: string
}

/**
 * Hash function that returns a numeric value for deterministic assignment.
 * Uses the input string to produce a consistent integer.
 */
export function hash(input: string): number {
  throw new Error('hash not implemented')
}

/**
 * Get the active experiment for a given thing.
 * Returns undefined if no active experiment exists.
 */
export function getActiveExperiment(thingId: string): Experiment | undefined {
  throw new Error('getActiveExperiment not implemented')
}

/**
 * Set an active experiment for testing purposes.
 */
export function setActiveExperiment(thingId: string, experiment: Experiment): void {
  throw new Error('setActiveExperiment not implemented')
}

/**
 * Clear all registered experiments.
 */
export function clearExperiments(): void {
  throw new Error('clearExperiments not implemented')
}

/**
 * Resolve which branch a user should see for a given thing.
 *
 * Algorithm:
 * 1. Get active experiment for thingId
 * 2. If no experiment, return 'main'
 * 3. Hash userId:experimentId for traffic allocation
 * 4. If hash % 10000 > traffic * 10000, return 'main' (excluded)
 * 5. Hash userId:experimentId:branch for branch assignment
 * 6. Return branches[hash % branches.length]
 */
export function resolveBranch(userId: string, thingId: string): string {
  throw new Error('resolveBranch not implemented')
}
