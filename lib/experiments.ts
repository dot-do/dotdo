/**
 * Experiment Branch Resolution
 *
 * Deterministically assigns users to experiment branches via hash.
 */

import { hashToInt } from '../workflows/hash'

export interface Experiment {
  id: string
  thing: string
  branches: string[]
  traffic: number // 0-1, percentage in experiment
  metric: string
  status: 'draft' | 'running' | 'completed'
  winner?: string
}

// In-memory storage for experiments (keyed by thingId)
const experiments: Map<string, Experiment> = new Map()

/**
 * Hash function that returns a numeric value for deterministic assignment.
 * Uses SHA-256 internally via the centralized hashing system.
 *
 * @deprecated Use hashToInt from workflows/hash directly for new code
 */
export function hash(input: string): number {
  return hashToInt(input)
}

/**
 * Get the active experiment for a given thing.
 * Returns undefined if no active experiment exists.
 *
 * An experiment is considered active if:
 * - status is 'running', OR
 * - status is 'completed' AND has a winner set
 */
export function getActiveExperiment(thingId: string): Experiment | undefined {
  const experiment = experiments.get(thingId)
  if (!experiment) return undefined

  // Draft experiments are not active
  if (experiment.status === 'draft') return undefined

  // Completed experiments without a winner are not active
  if (experiment.status === 'completed' && !experiment.winner) return undefined

  // Running experiments or completed with winner are active
  return experiment
}

/**
 * Set an active experiment for testing purposes.
 */
export function setActiveExperiment(thingId: string, experiment: Experiment): void {
  experiments.set(thingId, experiment)
}

/**
 * Clear all registered experiments.
 */
export function clearExperiments(): void {
  experiments.clear()
}

/**
 * Resolve which branch a user should see for a given thing.
 *
 * Algorithm:
 * 1. Get active experiment for thingId
 * 2. If no experiment, return 'main'
 * 3. If completed with winner, return winner
 * 4. If branches array is empty, return 'main'
 * 5. Hash userId:experimentId for traffic allocation
 * 6. If hash % 10000 >= traffic * 10000, return 'main' (excluded)
 * 7. Hash userId:experimentId:branch for branch assignment
 * 8. Return branches[hash % branches.length]
 */
export function resolveBranch(userId: string, thingId: string): string {
  const experiment = getActiveExperiment(thingId)

  // No active experiment - return main
  if (!experiment) return 'main'

  // Completed experiment with winner - always return winner
  if (experiment.status === 'completed' && experiment.winner) {
    return experiment.winner
  }

  // Handle empty branches array gracefully
  if (experiment.branches.length === 0) {
    return 'main'
  }

  // Traffic allocation check using 10000 buckets for precision
  const trafficHash = hash(`${userId}:${experiment.id}`)
  const trafficThreshold = experiment.traffic * 10000

  // If hash result is >= threshold, user is excluded from experiment
  if (trafficHash % 10000 >= trafficThreshold) {
    return 'main'
  }

  // User is in experiment - determine branch assignment
  const branchHash = hash(`${userId}:${experiment.id}:branch`)
  const branchIndex = branchHash % experiment.branches.length

  return experiment.branches[branchIndex]!
}
