/**
 * Capability Tier Routing Extended Tests - [RED] Phase
 *
 * TDD failing tests for advanced capability tier routing features:
 * - Cost optimization (budget constraints, cost tracking, tier cost estimation)
 * - Graph-based tier queries (worker capacity, load balancing, tier analytics)
 * - Advanced routing configuration (custom tier profiles, fallback chains)
 * - Tier performance monitoring
 *
 * These tests are designed to FAIL initially - they define the expected
 * behavior for features that need to be implemented.
 *
 * NO MOCKS - use real components per CLAUDE.md guidelines.
 *
 * @module workers/capability-tier-routing-extended
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine } from '../../db/graph'
import {
  CapabilityTierRouter,
  TIER_ORDER,
  type CapabilityTier,
  type TaskRequest,
  type TierRouteResult,
  TierRegistry,
} from '../capability-tier-routing'

// =============================================================================
// TEST SETUP
// =============================================================================

describe('Capability Tier Routing - Extended Tests [RED]', () => {
  let graph: GraphEngine
  let router: CapabilityTierRouter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    router = new CapabilityTierRouter(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. COST OPTIMIZATION
  // ===========================================================================

  describe('Cost Optimization', () => {
    describe('Tier Cost Estimation', () => {
      it('should estimate cost for each tier', async () => {
        // Each tier has different cost profiles
        // Expected costs per request:
        // - code: $0.0001 (compute only)
        // - generative: $0.01 (LLM tokens)
        // - agentic: $0.10 (multiple LLM calls + tools)
        // - human: $1.00+ (human time)

        const codeCost = await router.estimateTierCost('code')
        const generativeCost = await router.estimateTierCost('generative')
        const agenticCost = await router.estimateTierCost('agentic')
        const humanCost = await router.estimateTierCost('human')

        expect(codeCost).toBeLessThan(generativeCost)
        expect(generativeCost).toBeLessThan(agenticCost)
        expect(agenticCost).toBeLessThan(humanCost)

        // Specific cost assertions
        expect(codeCost).toBeLessThan(0.001)
        expect(generativeCost).toBeLessThan(0.05)
        expect(agenticCost).toBeLessThan(0.50)
        expect(humanCost).toBeGreaterThan(0.50)
      })

      it('should estimate task cost based on complexity and tier', async () => {
        const simpleTask: TaskRequest = {
          id: 'task-simple',
          type: 'lookup',
          complexity: 2,
        }

        const complexTask: TaskRequest = {
          id: 'task-complex',
          type: 'approve',
          complexity: 9,
        }

        const simpleCost = await router.estimateTaskCost(simpleTask)
        const complexCost = await router.estimateTaskCost(complexTask)

        expect(simpleCost.estimatedCost).toBeLessThan(complexCost.estimatedCost)
        expect(simpleCost.tier).toBe('code')
        expect(complexCost.tier).toBe('human')
      })
    })

    describe('Budget Constraints', () => {
      it('should enforce budget limits on routing', async () => {
        await router.registerWorker({
          id: 'worker-human',
          tier: 'human',
          endpoint: 'http://human:3000',
        })

        // Set a budget constraint
        router.setBudget({
          maxCostPerTask: 0.05, // Only allow code/generative tier
          dailyBudget: 10.0,
          monthlyBudget: 100.0,
        })

        // Task that would normally go to human tier
        const expensiveTask: TaskRequest = {
          id: 'task-expensive',
          type: 'approve',
          complexity: 9,
          requiredTools: ['approve'],
        }

        // Should reject or downgrade due to budget constraint
        const result = await router.route(expensiveTask, { enforceBudget: true })

        expect(result.budgetViolation).toBe(true)
        expect(result.tier).not.toBe('human')
      })

      it('should track cumulative spending', async () => {
        router.setBudget({
          maxCostPerTask: 1.0,
          dailyBudget: 1.0,
          monthlyBudget: 10.0,
        })

        // Register workers
        await router.registerWorker({
          id: 'worker-gen',
          tier: 'generative',
          endpoint: 'http://gen:3000',
        })

        // Route multiple tasks to accumulate cost
        for (let i = 0; i < 50; i++) {
          await router.route({
            id: `task-${i}`,
            type: 'generate',
            complexity: 4,
          })
        }

        const spending = await router.getSpending()

        expect(spending.today).toBeGreaterThan(0)
        expect(spending.thisMonth).toBeGreaterThan(0)
        expect(spending.totalTasks).toBe(50)
      })

      it('should pause routing when daily budget exhausted', async () => {
        router.setBudget({
          maxCostPerTask: 0.10,
          dailyBudget: 0.50, // Very low budget
          monthlyBudget: 100.0,
        })

        await router.registerWorker({
          id: 'worker-gen',
          tier: 'generative',
          endpoint: 'http://gen:3000',
        })

        // Exhaust budget
        for (let i = 0; i < 10; i++) {
          await router.route({
            id: `task-${i}`,
            type: 'generate',
            complexity: 4,
          })
        }

        // Next routing should fail due to budget
        await expect(
          router.route(
            { id: 'task-over-budget', type: 'generate', complexity: 4 },
            { enforceBudget: true }
          )
        ).rejects.toThrow(/budget exhausted|daily limit/i)
      })
    })

    describe('Cost-Optimized Routing', () => {
      it('should select cheapest tier that can handle task', async () => {
        await router.registerWorker({
          id: 'worker-code',
          tier: 'code',
          endpoint: 'http://code:3000',
        })
        await router.registerWorker({
          id: 'worker-gen',
          tier: 'generative',
          endpoint: 'http://gen:3000',
        })
        await router.registerWorker({
          id: 'worker-agentic',
          tier: 'agentic',
          endpoint: 'http://agentic:3000',
        })

        // Task with complexity 4 could go to generative
        // But if code tier can attempt it first, it should
        const task: TaskRequest = {
          id: 'task-optimize',
          type: 'analyze',
          complexity: 4,
        }

        const result = await router.route(task, { optimizeCost: true })

        // Should try cheapest viable tier first
        expect(result.costOptimized).toBe(true)
        expect(result.tier).toBe('code') // Try cheapest first
        expect(result.fallbackChain).toEqual(['code', 'generative'])
      })

      it('should provide cost comparison across tiers', async () => {
        const task: TaskRequest = {
          id: 'task-compare',
          type: 'summarize',
          complexity: 4,
        }

        const comparison = await router.compareTierCosts(task)

        expect(comparison).toHaveLength(4) // All 4 tiers
        expect(comparison[0]!.tier).toBe('code')
        expect(comparison[0]!.cost).toBeLessThan(comparison[1]!.cost)

        // Each entry should have success probability
        for (const entry of comparison) {
          expect(entry.successProbability).toBeGreaterThanOrEqual(0)
          expect(entry.successProbability).toBeLessThanOrEqual(1)
        }
      })

      it('should calculate expected cost including retries', async () => {
        const task: TaskRequest = {
          id: 'task-expected',
          type: 'complex-analysis',
          complexity: 7,
        }

        const expectedCost = await router.calculateExpectedCost(task)

        // Expected cost factors in:
        // - Base tier cost
        // - Probability of escalation
        // - Cost of higher tiers if escalated
        expect(expectedCost.baseCost).toBeDefined()
        expect(expectedCost.expectedTotalCost).toBeGreaterThanOrEqual(expectedCost.baseCost)
        expect(expectedCost.escalationProbability).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // 2. GRAPH-BASED TIER QUERIES
  // ===========================================================================

  describe('Graph-Based Tier Queries', () => {
    beforeEach(async () => {
      // Register multiple workers per tier
      for (let i = 0; i < 3; i++) {
        await router.registerWorker({
          id: `worker-code-${i}`,
          tier: 'code',
          endpoint: `http://code${i}:3000`,
        })
      }
      for (let i = 0; i < 2; i++) {
        await router.registerWorker({
          id: `worker-gen-${i}`,
          tier: 'generative',
          endpoint: `http://gen${i}:3000`,
        })
      }
      await router.registerWorker({
        id: 'worker-agentic-0',
        tier: 'agentic',
        endpoint: 'http://agentic0:3000',
      })
      await router.registerWorker({
        id: 'worker-human-0',
        tier: 'human',
        endpoint: 'http://human0:3000',
      })
    })

    describe('Worker Capacity Queries', () => {
      it('should query total capacity per tier', async () => {
        const capacity = await router.getTierCapacity()

        expect(capacity.code).toBe(3)
        expect(capacity.generative).toBe(2)
        expect(capacity.agentic).toBe(1)
        expect(capacity.human).toBe(1)
      })

      it('should query available (non-busy) workers per tier', async () => {
        // Mark some workers as busy
        await router.updateWorkerStatus('worker-code-0', 'busy')
        await router.updateWorkerStatus('worker-code-1', 'busy')
        await router.updateWorkerStatus('worker-gen-0', 'busy')

        const available = await router.getAvailableCapacity()

        expect(available.code).toBe(1)
        expect(available.generative).toBe(1)
        expect(available.agentic).toBe(1)
        expect(available.human).toBe(1)
      })

      it('should query workers with specific tool capabilities', async () => {
        // Register workers with additional tools
        await router.registerWorker({
          id: 'worker-special',
          tier: 'code',
          endpoint: 'http://special:3000',
          additionalTools: ['custom-tool', 'special-analyzer'],
        })

        const workers = await router.queryWorkersByCapability('special-analyzer')

        expect(workers).toHaveLength(1)
        expect(workers[0]!.id).toBe('worker-special')
      })
    })

    describe('Routing Analytics via Graph', () => {
      it('should query routing statistics by tier', async () => {
        // Route tasks to generate history
        await router.route({ id: 't1', type: 'lookup', complexity: 1 })
        await router.route({ id: 't2', type: 'lookup', complexity: 2 })
        await router.route({ id: 't3', type: 'generate', complexity: 4 })
        await router.route({ id: 't4', type: 'plan', complexity: 7 })
        await router.route({ id: 't5', type: 'approve', complexity: 9 })

        const stats = await router.getRoutingStatistics()

        expect(stats.routesByTier.code).toBe(2)
        expect(stats.routesByTier.generative).toBe(1)
        expect(stats.routesByTier.agentic).toBe(1)
        expect(stats.routesByTier.human).toBe(1)
        expect(stats.totalRoutes).toBe(5)
      })

      it('should query escalation rates by tier', async () => {
        // Route and escalate some tasks
        const t1 = { id: 'e1', type: 'x', complexity: 2 }
        const t2 = { id: 'e2', type: 'x', complexity: 2 }
        const t3 = { id: 'e3', type: 'x', complexity: 2 }

        await router.route(t1)
        await router.route(t2)
        await router.route(t3)

        // Escalate 2 of 3
        await router.escalate(t1, 'code', 'failed')
        await router.escalate(t2, 'code', 'failed')

        const escalationRates = await router.getEscalationRates()

        expect(escalationRates.code).toBeCloseTo(0.67, 1) // 2/3
        expect(escalationRates.generative).toBe(0)
      })

      it('should query task-worker graph patterns', async () => {
        // Create routing history
        await router.route({ id: 'pattern-1', type: 'a', complexity: 1 })
        await router.route({ id: 'pattern-2', type: 'a', complexity: 1 })
        await router.route({ id: 'pattern-3', type: 'a', complexity: 1 })

        // Query using Cypher-like pattern
        const results = await graph.matchCypher(`
          MATCH (t:Task)-[:ASSIGNED_TO]->(w:Worker)
          WHERE w.tier = 'code'
          RETURN t, w
        `)

        expect(results.matches.length).toBeGreaterThanOrEqual(3)
      })

      it('should find most utilized workers via graph', async () => {
        // Route many tasks
        for (let i = 0; i < 20; i++) {
          await router.route({ id: `util-${i}`, type: 'lookup', complexity: 1 })
        }

        const utilization = await router.getWorkerUtilization()

        // Should have utilization data for workers
        expect(utilization.length).toBeGreaterThan(0)
        expect(utilization[0]).toHaveProperty('workerId')
        expect(utilization[0]).toHaveProperty('taskCount')
        expect(utilization[0]).toHaveProperty('tier')
      })
    })

    describe('Tier Performance Graph Queries', () => {
      it('should track average latency per tier', async () => {
        // Route tasks and record completion times
        for (let i = 0; i < 5; i++) {
          const result = await router.route({
            id: `lat-code-${i}`,
            type: 'lookup',
            complexity: 1,
          })
          await router.recordTaskCompletion(result.workerId!, `lat-code-${i}`, {
            latencyMs: 10 + i * 5,
            success: true,
          })
        }

        for (let i = 0; i < 5; i++) {
          const result = await router.route({
            id: `lat-gen-${i}`,
            type: 'generate',
            complexity: 4,
          })
          await router.recordTaskCompletion(result.workerId!, `lat-gen-${i}`, {
            latencyMs: 500 + i * 100,
            success: true,
          })
        }

        const latencyStats = await router.getTierLatencyStats()

        expect(latencyStats.code.avgLatencyMs).toBeLessThan(latencyStats.generative.avgLatencyMs)
        expect(latencyStats.code.p50LatencyMs).toBeDefined()
        expect(latencyStats.code.p99LatencyMs).toBeDefined()
      })

      it('should track success rates per tier', async () => {
        // Route and record outcomes
        for (let i = 0; i < 10; i++) {
          const result = await router.route({
            id: `sr-${i}`,
            type: 'lookup',
            complexity: 1,
          })
          await router.recordTaskCompletion(result.workerId!, `sr-${i}`, {
            latencyMs: 10,
            success: i < 8, // 80% success
          })
        }

        const successRates = await router.getTierSuccessRates()

        expect(successRates.code).toBeCloseTo(0.8, 1)
      })
    })
  })

  // ===========================================================================
  // 3. ADVANCED ROUTING CONFIGURATION
  // ===========================================================================

  describe('Advanced Routing Configuration', () => {
    describe('Custom Tier Profiles', () => {
      it('should create custom tier profile between generative and agentic', async () => {
        const registry = new TierRegistry()

        registry.registerProfile('hybrid-ai', {
          complexityRange: [5, 7],
          tools: ['generate', 'analyze', 'simple-browse'],
          escalatesTo: 'agentic',
        })

        const profile = registry.getProfile('hybrid-ai')

        expect(profile).toBeDefined()
        expect(profile!.complexityRange).toEqual([5, 7])
        expect(profile!.tools).toContain('simple-browse')
        expect(profile!.escalatesTo).toBe('agentic')
      })

      it('should route to custom tier profile when applicable', async () => {
        await router.registerCustomTier('specialist', {
          complexityRange: [3, 4],
          tools: ['specialized-tool'],
          escalatesTo: 'generative',
          costMultiplier: 0.5, // 50% cheaper than generative
        })

        await router.registerWorker({
          id: 'specialist-worker',
          tier: 'specialist' as CapabilityTier, // Custom tier
          endpoint: 'http://specialist:3000',
        })

        const task: TaskRequest = {
          id: 'custom-tier-task',
          type: 'specialized',
          complexity: 3,
          requiredTools: ['specialized-tool'],
        }

        const result = await router.route(task)

        expect(result.tier).toBe('specialist')
      })
    })

    describe('Fallback Chain Configuration', () => {
      it('should configure custom escalation path', async () => {
        // Instead of code -> generative -> agentic -> human
        // Configure: code -> agentic (skip generative for certain tasks)
        router.setEscalationPath('urgent', ['code', 'agentic', 'human'])

        await router.registerWorker({
          id: 'w-code',
          tier: 'code',
          endpoint: 'http://code:3000',
        })
        await router.registerWorker({
          id: 'w-agentic',
          tier: 'agentic',
          endpoint: 'http://agentic:3000',
        })

        const task: TaskRequest = {
          id: 'urgent-task',
          type: 'urgent-operation',
          complexity: 2,
          metadata: { escalationPath: 'urgent' },
        }

        const result = await router.route(task)
        expect(result.tier).toBe('code')

        // Escalate should skip generative
        const escalated = await router.escalate(task, 'code', 'failed')
        expect(escalated.tier).toBe('agentic')
        expect(escalated.skippedTiers).toContain('generative')
      })

      it('should support tier exclusion for sensitive tasks', async () => {
        router.setTierExclusions('pii-task', ['generative', 'agentic']) // Only code or human

        const piiTask: TaskRequest = {
          id: 'pii-task-1',
          type: 'pii-processing',
          complexity: 5, // Would normally go to generative
          metadata: { exclusionPolicy: 'pii-task' },
        }

        // Register workers
        await router.registerWorker({
          id: 'w-code',
          tier: 'code',
          endpoint: 'http://code:3000',
        })
        await router.registerWorker({
          id: 'w-human',
          tier: 'human',
          endpoint: 'http://human:3000',
        })

        const result = await router.route(piiTask)

        // Should skip generative/agentic and go to code or human
        expect(['code', 'human']).toContain(result.tier)
      })
    })

    describe('Load Balancing Strategies', () => {
      it('should support round-robin load balancing (default)', async () => {
        await router.registerWorker({ id: 'rr-1', tier: 'code', endpoint: 'http://rr1:3000' })
        await router.registerWorker({ id: 'rr-2', tier: 'code', endpoint: 'http://rr2:3000' })
        await router.registerWorker({ id: 'rr-3', tier: 'code', endpoint: 'http://rr3:3000' })

        const workers: string[] = []
        for (let i = 0; i < 6; i++) {
          const result = await router.route({ id: `rr-task-${i}`, type: 'x', complexity: 1 })
          workers.push(result.workerId!)
        }

        // Should cycle through workers
        expect(workers).toEqual(['rr-1', 'rr-2', 'rr-3', 'rr-1', 'rr-2', 'rr-3'])
      })

      it('should support least-connections load balancing', async () => {
        router.setLoadBalancingStrategy('least-connections')

        await router.registerWorker({ id: 'lc-1', tier: 'code', endpoint: 'http://lc1:3000' })
        await router.registerWorker({ id: 'lc-2', tier: 'code', endpoint: 'http://lc2:3000' })
        await router.registerWorker({ id: 'lc-3', tier: 'code', endpoint: 'http://lc3:3000' })

        // Simulate active connections
        await router.updateWorkerConnections('lc-1', 5)
        await router.updateWorkerConnections('lc-2', 2)
        await router.updateWorkerConnections('lc-3', 10)

        const result = await router.route({ id: 'lc-task', type: 'x', complexity: 1 })

        // Should route to worker with least connections
        expect(result.workerId).toBe('lc-2')
      })

      it('should support weighted load balancing', async () => {
        router.setLoadBalancingStrategy('weighted')

        await router.registerWorker({
          id: 'wt-1',
          tier: 'code',
          endpoint: 'http://wt1:3000',
          additionalTools: [],
          // @ts-expect-error - weight property to be added
          weight: 3,
        })
        await router.registerWorker({
          id: 'wt-2',
          tier: 'code',
          endpoint: 'http://wt2:3000',
          additionalTools: [],
          // @ts-expect-error - weight property to be added
          weight: 1,
        })

        const workerCounts: Record<string, number> = { 'wt-1': 0, 'wt-2': 0 }
        for (let i = 0; i < 100; i++) {
          const result = await router.route({ id: `wt-task-${i}`, type: 'x', complexity: 1 })
          workerCounts[result.workerId!]++
        }

        // wt-1 should get ~75% of traffic (3/(3+1))
        expect(workerCounts['wt-1']).toBeGreaterThan(60)
        expect(workerCounts['wt-2']).toBeLessThan(40)
      })
    })
  })

  // ===========================================================================
  // 4. TIER PERFORMANCE MONITORING
  // ===========================================================================

  describe('Tier Performance Monitoring', () => {
    describe('Real-time Health Checks', () => {
      it('should health check workers and mark unhealthy ones', async () => {
        await router.registerWorker({
          id: 'health-1',
          tier: 'code',
          endpoint: 'http://healthy:3000',
        })
        await router.registerWorker({
          id: 'health-2',
          tier: 'code',
          endpoint: 'http://unhealthy:3000',
        })

        // Simulate health check failure
        await router.recordHealthCheckResult('health-2', {
          healthy: false,
          latencyMs: 5000,
          error: 'Connection timeout',
        })

        const healthStatus = await router.getWorkersHealthStatus('code')

        expect(healthStatus.healthy).toContain('health-1')
        expect(healthStatus.unhealthy).toContain('health-2')
      })

      it('should auto-remove unhealthy workers from routing pool', async () => {
        await router.registerWorker({
          id: 'auto-remove-1',
          tier: 'code',
          endpoint: 'http://worker1:3000',
        })
        await router.registerWorker({
          id: 'auto-remove-2',
          tier: 'code',
          endpoint: 'http://worker2:3000',
        })

        // Configure auto-removal after 3 consecutive failures
        router.setHealthCheckPolicy({
          consecutiveFailuresBeforeRemoval: 3,
          checkIntervalMs: 30000,
        })

        // Simulate 3 failures
        for (let i = 0; i < 3; i++) {
          await router.recordHealthCheckResult('auto-remove-2', {
            healthy: false,
            latencyMs: 5000,
            error: 'Timeout',
          })
        }

        // Worker should be removed from pool
        const workers = await router.getWorkersByTier('code')
        const activeWorkerIds = workers.filter(w => w.status !== 'offline').map(w => w.id)

        expect(activeWorkerIds).not.toContain('auto-remove-2')
      })
    })

    describe('Tier Degradation Alerts', () => {
      it('should emit alert when tier success rate drops', async () => {
        const alerts: any[] = []
        router.onAlert((alert) => alerts.push(alert))

        router.setAlertThresholds({
          minSuccessRate: 0.9, // Alert if below 90%
          maxLatencyMs: 1000,
        })

        // Record multiple failures
        for (let i = 0; i < 10; i++) {
          await router.recordTaskCompletion('worker-1', `task-${i}`, {
            latencyMs: 100,
            success: i < 5, // 50% success rate
          })
        }

        // Should have triggered alert
        expect(alerts.length).toBeGreaterThan(0)
        expect(alerts[0].type).toBe('success_rate_degraded')
        expect(alerts[0].currentRate).toBeLessThan(0.9)
      })

      it('should emit alert when tier latency exceeds threshold', async () => {
        const alerts: any[] = []
        router.onAlert((alert) => alerts.push(alert))

        router.setAlertThresholds({
          minSuccessRate: 0.5,
          maxLatencyMs: 500,
        })

        // Record high latency tasks
        for (let i = 0; i < 5; i++) {
          await router.recordTaskCompletion('worker-1', `slow-task-${i}`, {
            latencyMs: 2000,
            success: true,
          })
        }

        expect(alerts.some(a => a.type === 'latency_threshold_exceeded')).toBe(true)
      })
    })

    describe('Tier Capacity Planning', () => {
      it('should calculate recommended capacity based on load', async () => {
        // Register current workers
        await router.registerWorker({ id: 'cap-1', tier: 'code', endpoint: 'http://c1:3000' })
        await router.registerWorker({ id: 'cap-2', tier: 'code', endpoint: 'http://c2:3000' })

        // Simulate high load
        for (let i = 0; i < 100; i++) {
          await router.route({ id: `cap-task-${i}`, type: 'x', complexity: 1 })
        }

        const recommendations = await router.getCapacityRecommendations()

        expect(recommendations.code).toBeDefined()
        expect(recommendations.code.currentCapacity).toBe(2)
        expect(recommendations.code.recommendedCapacity).toBeGreaterThanOrEqual(2)
        expect(recommendations.code.utilizationRate).toBeGreaterThan(0)
      })

      it('should predict required capacity for forecasted load', async () => {
        const forecast = await router.forecastCapacityNeeds({
          expectedTasksPerHour: 10000,
          complexityDistribution: {
            code: 0.5, // 50% complexity 1-2
            generative: 0.3, // 30% complexity 3-5
            agentic: 0.15, // 15% complexity 6-8
            human: 0.05, // 5% complexity 9-10
          },
        })

        expect(forecast.requiredWorkers.code).toBeGreaterThan(0)
        expect(forecast.requiredWorkers.generative).toBeGreaterThan(0)
        expect(forecast.estimatedCost).toBeGreaterThan(0)
      })
    })
  })

  // ===========================================================================
  // 5. EDGE CASES AND ERROR HANDLING
  // ===========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle no available workers gracefully', async () => {
      // No workers registered
      const task: TaskRequest = {
        id: 'orphan-task',
        type: 'lookup',
        complexity: 1,
      }

      const result = await router.route(task)

      expect(result.workerId).toBeNull()
      expect(result.tier).toBe('code') // Still selects tier
      expect(result.reason).toContain('no available workers')
    })

    it('should queue tasks when all workers busy', async () => {
      await router.registerWorker({
        id: 'busy-worker',
        tier: 'code',
        endpoint: 'http://busy:3000',
      })

      // Mark worker as busy
      await router.updateWorkerStatus('busy-worker', 'busy')

      router.enableQueueing({ maxQueueSize: 100, maxWaitMs: 60000 })

      const task: TaskRequest = {
        id: 'queued-task',
        type: 'lookup',
        complexity: 1,
      }

      const result = await router.route(task, { allowQueueing: true })

      expect(result.queued).toBe(true)
      expect(result.queuePosition).toBeDefined()
    })

    it('should handle conflicting tool requirements', async () => {
      const task: TaskRequest = {
        id: 'conflict-task',
        type: 'special',
        complexity: 1,
        requiredTools: ['approve', 'calculate'], // approve is human-only, calculate is code
      }

      // Should route to tier that has both tools (human has all tools)
      await router.registerWorker({
        id: 'full-stack',
        tier: 'human',
        endpoint: 'http://human:3000',
      })

      const result = await router.route(task)

      expect(result.tier).toBe('human')
    })

    it('should handle rapid tier fluctuation (circuit breaker)', async () => {
      // Enable circuit breaker
      router.enableCircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 30000,
      })

      await router.registerWorker({
        id: 'flaky-worker',
        tier: 'code',
        endpoint: 'http://flaky:3000',
      })

      // Simulate rapid failures
      for (let i = 0; i < 6; i++) {
        await router.recordTaskCompletion('flaky-worker', `fail-${i}`, {
          latencyMs: 100,
          success: false,
        })
      }

      // Circuit should be open
      const circuitStatus = await router.getCircuitBreakerStatus('code')

      expect(circuitStatus.state).toBe('open')
      expect(circuitStatus.failureCount).toBeGreaterThanOrEqual(5)
    })
  })
})
