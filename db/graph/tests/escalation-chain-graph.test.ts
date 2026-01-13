/**
 * Escalation Chain Graph Queries Tests
 *
 * Tests for graph queries for escalation chains that cascade errors through
 * capability tiers: Code -> Generative -> Agentic -> Human
 *
 * Uses GraphEngine for integration - NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-b9atm - [GREEN] Implement escalation chain graph queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../index'
import {
  EscalationChainGraph,
  ESCALATION_LABELS,
  ESCALATION_EDGES,
  TIER_ORDER,
} from '../escalation-chain-graph'

describe('Escalation Chain Graph Queries', () => {
  let graph: GraphEngine
  let escalationGraph: EscalationChainGraph

  beforeEach(async () => {
    graph = new GraphEngine()
    escalationGraph = new EscalationChainGraph(graph)
  })

  // ==========================================================================
  // 1. Chain Operations
  // ==========================================================================

  describe('Chain Operations', () => {
    it('should create an escalation chain', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Connection failed',
        errorCode: 'ECONNREFUSED',
        severity: 'medium',
      })

      expect(chain).toBeDefined()
      expect(chain.label).toBe(ESCALATION_LABELS.chain)
      expect(chain.properties.errorMessage).toBe('Connection failed')
      expect(chain.properties.errorCode).toBe('ECONNREFUSED')
      expect(chain.properties.severity).toBe('medium')
      expect(chain.properties.success).toBe(false)
      expect(chain.properties.exhausted).toBe(false)
      expect(chain.properties.startedAt).toBeDefined()
    })

    it('should get an escalation chain by ID', async () => {
      const created = await escalationGraph.createChain({
        errorMessage: 'Test error',
        severity: 'low',
      })

      const retrieved = await escalationGraph.getChain(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.properties.errorMessage).toBe('Test error')
    })

    it('should complete a chain as successful', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      const completed = await escalationGraph.completeChain(chain.id, true, 'generative')

      expect(completed.properties.success).toBe(true)
      expect(completed.properties.exhausted).toBe(false)
      expect(completed.properties.completedAt).toBeDefined()
    })

    it('should complete a chain as exhausted', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'high',
      })

      const completed = await escalationGraph.completeChain(chain.id, false)

      expect(completed.properties.success).toBe(false)
      expect(completed.properties.exhausted).toBe(true)
      expect(completed.properties.completedAt).toBeDefined()
    })

    it('should include metadata in chain', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
        metadata: { userId: 'user-123', operation: 'purchase' },
      })

      expect(chain.properties.metadata).toEqual({
        userId: 'user-123',
        operation: 'purchase',
      })
    })
  })

  // ==========================================================================
  // 2. Step Operations
  // ==========================================================================

  describe('Step Operations', () => {
    it('should record an escalation step', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      const step = await escalationGraph.recordStep(chain.id, {
        tier: 'code',
        success: false,
        error: 'Retry exhausted',
        duration: 1500,
      })

      expect(step.label).toBe(ESCALATION_LABELS.step)
      expect(step.properties.chainId).toBe(chain.id)
      expect(step.properties.tier).toBe('code')
      expect(step.properties.success).toBe(false)
      expect(step.properties.error).toBe('Retry exhausted')
      expect(step.properties.duration).toBe(1500)
      expect(step.properties.stepIndex).toBe(0)
    })

    it('should record multiple steps with incrementing indices', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      const step1 = await escalationGraph.recordStep(chain.id, {
        tier: 'code',
        success: false,
        duration: 100,
      })

      const step2 = await escalationGraph.recordStep(chain.id, {
        tier: 'generative',
        success: false,
        duration: 200,
      })

      const step3 = await escalationGraph.recordStep(chain.id, {
        tier: 'agentic',
        success: true,
        duration: 300,
        resolution: 'Fixed by agent',
      })

      expect(step1.properties.stepIndex).toBe(0)
      expect(step2.properties.stepIndex).toBe(1)
      expect(step3.properties.stepIndex).toBe(2)
      expect(step3.properties.resolution).toBe('Fixed by agent')
    })

    it('should create ESCALATED_TO edges between steps', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: true, duration: 200 })

      const edges = await graph.queryEdges({ type: ESCALATION_EDGES.escalatedTo })

      expect(edges.length).toBe(1)
      expect(edges[0]?.type).toBe(ESCALATION_EDGES.escalatedTo)
    })

    it('should get all steps for a chain', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
      await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: true, duration: 300 })

      const steps = await escalationGraph.getChainSteps(chain.id)

      expect(steps.length).toBe(3)
      expect(steps[0]?.properties.tier).toBe('code')
      expect(steps[1]?.properties.tier).toBe('generative')
      expect(steps[2]?.properties.tier).toBe('agentic')
    })

    it('should get the last step in a chain', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: true, duration: 200 })

      const lastStep = await escalationGraph.getLastStep(chain.id)

      expect(lastStep?.properties.tier).toBe('generative')
      expect(lastStep?.properties.success).toBe(true)
    })
  })

  // ==========================================================================
  // 3. Target Operations
  // ==========================================================================

  describe('Target Operations', () => {
    it('should register an escalation target', async () => {
      const target = await escalationGraph.registerTarget({
        type: 'role',
        name: 'Code Handler',
        tier: 'code',
        priority: 1,
        sla: 5000,
      })

      expect(target.label).toBe(ESCALATION_LABELS.target)
      expect(target.properties.name).toBe('Code Handler')
      expect(target.properties.tier).toBe('code')
      expect(target.properties.available).toBe(true)
      expect(target.properties.sla).toBe(5000)
    })

    it('should update target availability', async () => {
      const target = await escalationGraph.registerTarget({
        type: 'human',
        name: 'Support Agent',
        tier: 'human',
      })

      const updated = await escalationGraph.setTargetAvailability(target.id, false)

      expect(updated.properties.available).toBe(false)
    })

    it('should update target metrics', async () => {
      const target = await escalationGraph.registerTarget({
        type: 'service',
        name: 'AI Service',
        tier: 'generative',
      })

      const updated = await escalationGraph.updateTargetMetrics(target.id, {
        successRate: 0.85,
        avgResponseTime: 250,
      })

      expect(updated.properties.successRate).toBe(0.85)
      expect(updated.properties.avgResponseTime).toBe(250)
    })

    it('should get targets for a tier', async () => {
      await escalationGraph.registerTarget({ type: 'role', name: 'Handler 1', tier: 'code', priority: 1 })
      await escalationGraph.registerTarget({ type: 'role', name: 'Handler 2', tier: 'code', priority: 2 })
      await escalationGraph.registerTarget({ type: 'human', name: 'Agent', tier: 'human' })

      const codeTargets = await escalationGraph.getTargetsForTier('code')
      const humanTargets = await escalationGraph.getTargetsForTier('human')

      expect(codeTargets.length).toBe(2)
      expect(humanTargets.length).toBe(1)
    })

    it('should filter targets by availability', async () => {
      const t1 = await escalationGraph.registerTarget({ type: 'role', name: 'Available', tier: 'code' })
      const t2 = await escalationGraph.registerTarget({ type: 'role', name: 'Unavailable', tier: 'code' })
      await escalationGraph.setTargetAvailability(t2.id, false)

      const availableTargets = await escalationGraph.getTargetsForTier('code', { availableOnly: true })

      expect(availableTargets.length).toBe(1)
      expect(availableTargets[0]?.properties.name).toBe('Available')
    })

    it('should filter targets by SLA', async () => {
      await escalationGraph.registerTarget({ type: 'role', name: 'Fast', tier: 'code', sla: 1000 })
      await escalationGraph.registerTarget({ type: 'role', name: 'Slow', tier: 'code', sla: 10000 })

      const fastTargets = await escalationGraph.getTargetsForTier('code', { maxSla: 5000 })

      expect(fastTargets.length).toBe(1)
      expect(fastTargets[0]?.properties.name).toBe('Fast')
    })
  })

  // ==========================================================================
  // 4. Chain Traversal Queries
  // ==========================================================================

  describe('Chain Traversal Queries', () => {
    it('should traverse an escalation chain', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
      await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: true, duration: 300 })

      const traversal = await escalationGraph.traverseChain(chain.id)

      expect(traversal.chain).toBeDefined()
      expect(traversal.steps.length).toBe(3)
      expect(traversal.depth).toBe(3)
      expect(traversal.resolvedByTier).toBe('agentic')
    })

    it('should filter traversal by successful steps only', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: true, duration: 200 })

      const traversal = await escalationGraph.traverseChain(chain.id, { successfulOnly: true })

      expect(traversal.steps.length).toBe(1)
      expect(traversal.steps[0]?.properties.tier).toBe('generative')
    })

    it('should filter traversal by tier', async () => {
      const chain = await escalationGraph.createChain({
        errorMessage: 'Test',
        severity: 'medium',
      })

      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
      await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: true, duration: 300 })

      const traversal = await escalationGraph.traverseChain(chain.id, { tier: 'generative' })

      expect(traversal.steps.length).toBe(1)
      expect(traversal.steps[0]?.properties.tier).toBe('generative')
    })

    it('should get escalation path between tiers', () => {
      const path = escalationGraph.getEscalationPath('code', 'human')

      expect(path).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should return empty path for invalid tier progression', () => {
      const path = escalationGraph.getEscalationPath('human', 'code')

      expect(path).toEqual([])
    })

    it('should get chains resolved by specific tier', async () => {
      // Create chains resolved at different tiers
      const chain1 = await escalationGraph.createChain({ errorMessage: 'Test 1', severity: 'low' })
      await escalationGraph.recordStep(chain1.id, { tier: 'code', success: true, duration: 100 })

      const chain2 = await escalationGraph.createChain({ errorMessage: 'Test 2', severity: 'medium' })
      await escalationGraph.recordStep(chain2.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain2.id, { tier: 'generative', success: true, duration: 200 })

      const chain3 = await escalationGraph.createChain({ errorMessage: 'Test 3', severity: 'medium' })
      await escalationGraph.recordStep(chain3.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain3.id, { tier: 'generative', success: true, duration: 200 })

      const codeResolved = await escalationGraph.getChainsResolvedByTier('code')
      const genResolved = await escalationGraph.getChainsResolvedByTier('generative')

      expect(codeResolved.length).toBe(1)
      expect(genResolved.length).toBe(2)
    })
  })

  // ==========================================================================
  // 5. Find Next Escalation Target
  // ==========================================================================

  describe('Find Next Escalation Target', () => {
    beforeEach(async () => {
      // Set up targets for each tier
      await escalationGraph.registerTarget({ type: 'role', name: 'Code Handler', tier: 'code', priority: 1 })
      await escalationGraph.registerTarget({ type: 'service', name: 'AI Service', tier: 'generative', priority: 1 })
      await escalationGraph.registerTarget({ type: 'service', name: 'Agent Service', tier: 'agentic', priority: 1 })
      await escalationGraph.registerTarget({ type: 'human', name: 'Support Agent', tier: 'human', priority: 1 })
    })

    it('should find next target from code tier', async () => {
      const nextTarget = await escalationGraph.findNextTarget({ currentTier: 'code' })

      expect(nextTarget).toBeDefined()
      expect(nextTarget?.properties.tier).toBe('generative')
    })

    it('should find next target from generative tier', async () => {
      const nextTarget = await escalationGraph.findNextTarget({ currentTier: 'generative' })

      expect(nextTarget?.properties.tier).toBe('agentic')
    })

    it('should find next target from agentic tier', async () => {
      const nextTarget = await escalationGraph.findNextTarget({ currentTier: 'agentic' })

      expect(nextTarget?.properties.tier).toBe('human')
    })

    it('should return null when at human tier', async () => {
      const nextTarget = await escalationGraph.findNextTarget({ currentTier: 'human' })

      expect(nextTarget).toBeNull()
    })

    it('should start from code tier when no current tier specified', async () => {
      const nextTarget = await escalationGraph.findNextTarget()

      expect(nextTarget?.properties.tier).toBe('code')
    })

    it('should filter by availability', async () => {
      const genTarget = await graph.queryNodes({
        label: ESCALATION_LABELS.target,
        where: { tier: 'generative' },
      })
      await escalationGraph.setTargetAvailability(genTarget[0]!.id, false)

      const nextTarget = await escalationGraph.findNextTarget({
        currentTier: 'code',
        availableOnly: true,
      })

      // Should skip unavailable generative and go to agentic
      expect(nextTarget?.properties.tier).toBe('agentic')
    })

    it('should prefer high success rate targets', async () => {
      // Add another generative target with higher success rate
      await escalationGraph.registerTarget({
        type: 'service',
        name: 'Premium AI',
        tier: 'generative',
        priority: 2,
      })
      const targets = await escalationGraph.getTargetsForTier('generative')
      await escalationGraph.updateTargetMetrics(targets[0]!.id, { successRate: 0.7 })
      await escalationGraph.updateTargetMetrics(targets[1]!.id, { successRate: 0.95 })

      const nextTarget = await escalationGraph.findNextTarget({
        currentTier: 'code',
        preferHighSuccessRate: true,
      })

      expect(nextTarget?.properties.successRate).toBe(0.95)
    })

    it('should exclude specified targets', async () => {
      const targets = await escalationGraph.getTargetsForTier('generative')

      const nextTarget = await escalationGraph.findNextTarget({
        currentTier: 'code',
        excludeTargets: [targets[0]!.id],
      })

      // Should skip to agentic since only generative target is excluded
      expect(nextTarget?.properties.tier).toBe('agentic')
    })

    it('should get full escalation chain from target', async () => {
      const codeTargets = await escalationGraph.getTargetsForTier('code')
      const chain = await escalationGraph.getTargetEscalationChain(codeTargets[0]!.id)

      expect(chain.length).toBe(3) // generative, agentic, human
      expect(chain[0]?.properties.tier).toBe('generative')
      expect(chain[1]?.properties.tier).toBe('agentic')
      expect(chain[2]?.properties.tier).toBe('human')
    })
  })

  // ==========================================================================
  // 6. Metrics Calculation
  // ==========================================================================

  describe('Metrics Calculation', () => {
    beforeEach(async () => {
      // Create various chains with different outcomes

      // Successful at code tier
      const chain1 = await escalationGraph.createChain({ errorMessage: 'Error 1', severity: 'low' })
      await escalationGraph.recordStep(chain1.id, { tier: 'code', success: true, duration: 100 })
      await escalationGraph.completeChain(chain1.id, true, 'code')

      // Successful at generative tier
      const chain2 = await escalationGraph.createChain({ errorMessage: 'Error 2', severity: 'medium' })
      await escalationGraph.recordStep(chain2.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain2.id, { tier: 'generative', success: true, duration: 200 })
      await escalationGraph.completeChain(chain2.id, true, 'generative')

      // Successful at agentic tier
      const chain3 = await escalationGraph.createChain({ errorMessage: 'Error 3', severity: 'high', errorCode: 'E001' })
      await escalationGraph.recordStep(chain3.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain3.id, { tier: 'generative', success: false, duration: 200 })
      await escalationGraph.recordStep(chain3.id, { tier: 'agentic', success: true, duration: 300 })
      await escalationGraph.completeChain(chain3.id, true, 'agentic')

      // Exhausted (all tiers failed)
      const chain4 = await escalationGraph.createChain({ errorMessage: 'Error 4', severity: 'critical', errorCode: 'E001' })
      await escalationGraph.recordStep(chain4.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain4.id, { tier: 'generative', success: false, duration: 200 })
      await escalationGraph.recordStep(chain4.id, { tier: 'agentic', success: false, duration: 300 })
      await escalationGraph.recordStep(chain4.id, { tier: 'human', success: false, duration: 400 })
      await escalationGraph.completeChain(chain4.id, false)
    })

    it('should calculate overall metrics', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.totalChains).toBe(4)
      expect(metrics.successfulChains).toBe(3)
      expect(metrics.exhaustedChains).toBe(1)
      expect(metrics.successRate).toBe(0.75)
    })

    it('should count resolutions by tier', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.resolvedByTier.code).toBe(1)
      expect(metrics.resolvedByTier.generative).toBe(1)
      expect(metrics.resolvedByTier.agentic).toBe(1)
      expect(metrics.resolvedByTier.human).toBe(0)
    })

    it('should count by severity', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.bySeverity.low).toBe(1)
      expect(metrics.bySeverity.medium).toBe(1)
      expect(metrics.bySeverity.high).toBe(1)
      expect(metrics.bySeverity.critical).toBe(1)
    })

    it('should calculate average escalation depth', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      // (1 + 2 + 3 + 4) / 4 = 2.5
      expect(metrics.averageEscalationDepth).toBe(2.5)
    })

    it('should get top error codes', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.topErrorCodes.length).toBeGreaterThan(0)
      expect(metrics.topErrorCodes[0]?.code).toBe('E001')
      expect(metrics.topErrorCodes[0]?.count).toBe(2)
    })

    it('should get tier-specific metrics', async () => {
      const codeMetrics = await escalationGraph.getTierMetrics('code')

      expect(codeMetrics.totalAttempts).toBe(4)
      expect(codeMetrics.successCount).toBe(1)
      expect(codeMetrics.failureCount).toBe(3)
      expect(codeMetrics.successRate).toBe(0.25)
    })

    it('should calculate tier escalation rate', async () => {
      const codeMetrics = await escalationGraph.getTierMetrics('code')

      // 3 failures at code tier, 3 escalated to generative = 100% escalation rate
      expect(codeMetrics.escalationRate).toBe(1)
    })
  })

  // ==========================================================================
  // 7. Pattern Detection
  // ==========================================================================

  describe('Pattern Detection', () => {
    it('should detect tier bottleneck', async () => {
      // Create multiple chains that all fail at generative tier
      for (let i = 0; i < 5; i++) {
        const chain = await escalationGraph.createChain({ errorMessage: `Error ${i}`, severity: 'medium' })
        await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
        await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
        await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: true, duration: 300 })
        await escalationGraph.completeChain(chain.id, true, 'agentic')
      }

      const patterns = await escalationGraph.detectPatterns({ minOccurrences: 3 })

      const bottleneck = patterns.find(p =>
        p.type === 'tier-bottleneck' &&
        p.affectedTiers.includes('generative')
      )
      expect(bottleneck).toBeDefined()
    })

    it('should detect repeated escalation pattern', async () => {
      // Create multiple chains that all exhaust all tiers
      for (let i = 0; i < 5; i++) {
        const chain = await escalationGraph.createChain({ errorMessage: `Error ${i}`, severity: 'high' })
        await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
        await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
        await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: false, duration: 300 })
        await escalationGraph.recordStep(chain.id, { tier: 'human', success: false, duration: 400 })
        await escalationGraph.completeChain(chain.id, false)
      }

      const patterns = await escalationGraph.detectPatterns({ minOccurrences: 3 })

      const exhaustionPattern = patterns.find(p =>
        p.type === 'repeated-escalation' &&
        p.description.includes('exhaust all tiers')
      )
      expect(exhaustionPattern).toBeDefined()
      expect(exhaustionPattern?.severity).toBe('high')
    })

    it('should detect error code that always fails', async () => {
      // Create multiple chains with same error code that all fail
      for (let i = 0; i < 4; i++) {
        const chain = await escalationGraph.createChain({
          errorMessage: `Error ${i}`,
          errorCode: 'PROBLEMATIC_ERROR',
          severity: 'high',
        })
        await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
        await escalationGraph.recordStep(chain.id, { tier: 'generative', success: false, duration: 200 })
        await escalationGraph.recordStep(chain.id, { tier: 'agentic', success: false, duration: 300 })
        await escalationGraph.recordStep(chain.id, { tier: 'human', success: false, duration: 400 })
        await escalationGraph.completeChain(chain.id, false)
      }

      const patterns = await escalationGraph.detectPatterns({ minOccurrences: 2 })

      const errorCodePattern = patterns.find(p =>
        p.description.includes('PROBLEMATIC_ERROR')
      )
      expect(errorCodePattern).toBeDefined()
    })
  })

  // ==========================================================================
  // 8. Graph Statistics
  // ==========================================================================

  describe('Graph Statistics', () => {
    it('should get graph statistics', async () => {
      const chain = await escalationGraph.createChain({ errorMessage: 'Test', severity: 'medium' })
      await escalationGraph.recordStep(chain.id, { tier: 'code', success: false, duration: 100 })
      await escalationGraph.recordStep(chain.id, { tier: 'generative', success: true, duration: 200 })
      await escalationGraph.registerTarget({ type: 'role', name: 'Handler', tier: 'code' })

      const stats = await escalationGraph.getGraphStats()

      expect(stats.chainCount).toBe(1)
      expect(stats.stepCount).toBe(2)
      expect(stats.targetCount).toBe(1)
      expect(stats.totalNodes).toBeGreaterThanOrEqual(4)
    })
  })

  // ==========================================================================
  // 9. Cleanup and Maintenance
  // ==========================================================================

  describe('Cleanup and Maintenance', () => {
    it('should cleanup old chains', async () => {
      // Create chains with explicit old timestamps
      const oldChain = await escalationGraph.createChain({ errorMessage: 'Old', severity: 'low' })
      // Manually update the startedAt to be old
      await graph.updateNode(oldChain.id, { startedAt: Date.now() - 100000 })
      await escalationGraph.recordStep(oldChain.id, { tier: 'code', success: true, duration: 100 })

      const newChain = await escalationGraph.createChain({ errorMessage: 'New', severity: 'low' })
      await escalationGraph.recordStep(newChain.id, { tier: 'code', success: true, duration: 100 })

      // Cleanup chains older than 50 seconds
      const removed = await escalationGraph.cleanupOldChains(Date.now() - 50000)

      expect(removed).toBe(1)

      const remainingChains = await graph.queryNodes({ label: ESCALATION_LABELS.chain })
      expect(remainingChains.length).toBe(1)
      expect(remainingChains[0]?.properties.errorMessage).toBe('New')
    })
  })

  // ==========================================================================
  // 10. Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty chain traversal', async () => {
      const chain = await escalationGraph.createChain({ errorMessage: 'Test', severity: 'low' })

      const traversal = await escalationGraph.traverseChain(chain.id)

      expect(traversal.chain).toBeDefined()
      expect(traversal.steps.length).toBe(0)
      expect(traversal.depth).toBe(0)
    })

    it('should handle non-existent chain', async () => {
      const chain = await escalationGraph.getChain('non-existent-id')
      const traversal = await escalationGraph.traverseChain('non-existent-id')

      expect(chain).toBeNull()
      expect(traversal.chain).toBeNull()
      expect(traversal.steps.length).toBe(0)
    })

    it('should handle metrics with no chains', async () => {
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.totalChains).toBe(0)
      expect(metrics.successRate).toBe(0)
      expect(metrics.averageEscalationDepth).toBe(0)
    })

    it('should handle findNextTarget with no targets registered', async () => {
      const target = await escalationGraph.findNextTarget({ currentTier: 'code' })

      expect(target).toBeNull()
    })

    it('should handle re-registering same target', async () => {
      await escalationGraph.registerTarget({ type: 'role', name: 'Handler', tier: 'code', priority: 1 })
      await escalationGraph.registerTarget({ type: 'role', name: 'Handler', tier: 'code', priority: 2 })

      const targets = await escalationGraph.getTargetsForTier('code')

      expect(targets.length).toBe(1)
      expect(targets[0]?.properties.priority).toBe(2) // Updated
    })
  })
})
