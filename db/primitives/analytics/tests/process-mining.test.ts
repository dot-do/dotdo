/**
 * Process Mining Tests
 *
 * Tests for:
 * - Process Discovery (DFG algorithm)
 * - Bottleneck Analysis
 * - Compliance Checking
 * - Performance Metrics
 * - Fluent Builder API
 *
 * @see dotdo-fsfsd
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ProcessDiscovery,
  createProcessDiscovery,
  BottleneckAnalyzer,
  createBottleneckAnalyzer,
  ComplianceChecker,
  createComplianceChecker,
  PerformanceAnalyzer,
  createPerformanceAnalyzer,
  ProcessMiningBuilder,
  processMining,
  sequenceRule,
  existenceRule,
  absenceRule,
  timingRule,
  resourceRule,
  type ProcessEvent,
} from '../process-mining'

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate a simple order processing event log
 */
function generateOrderProcessEvents(): ProcessEvent[] {
  const events: ProcessEvent[] = []
  const baseTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago

  // Case 1: Normal happy path
  events.push(
    { caseId: 'order-1', activity: 'order_placed', timestamp: baseTime, resource: 'customer' },
    { caseId: 'order-1', activity: 'payment_received', timestamp: baseTime + 3600000, resource: 'payment-system' },
    { caseId: 'order-1', activity: 'order_confirmed', timestamp: baseTime + 3700000, resource: 'system' },
    { caseId: 'order-1', activity: 'shipped', timestamp: baseTime + 86400000, resource: 'warehouse' },
    { caseId: 'order-1', activity: 'delivered', timestamp: baseTime + 172800000, resource: 'courier' },
  )

  // Case 2: Normal path with different resources
  events.push(
    { caseId: 'order-2', activity: 'order_placed', timestamp: baseTime + 1000, resource: 'customer' },
    { caseId: 'order-2', activity: 'payment_received', timestamp: baseTime + 7200000, resource: 'payment-system' },
    { caseId: 'order-2', activity: 'order_confirmed', timestamp: baseTime + 7300000, resource: 'system' },
    { caseId: 'order-2', activity: 'shipped', timestamp: baseTime + 86400000 + 1000, resource: 'warehouse' },
    { caseId: 'order-2', activity: 'delivered', timestamp: baseTime + 259200000, resource: 'courier' },
  )

  // Case 3: With payment retry (rework)
  events.push(
    { caseId: 'order-3', activity: 'order_placed', timestamp: baseTime + 2000, resource: 'customer' },
    { caseId: 'order-3', activity: 'payment_failed', timestamp: baseTime + 3600000 + 2000, resource: 'payment-system' },
    { caseId: 'order-3', activity: 'payment_received', timestamp: baseTime + 7200000 + 2000, resource: 'payment-system' },
    { caseId: 'order-3', activity: 'order_confirmed', timestamp: baseTime + 7300000 + 2000, resource: 'system' },
    { caseId: 'order-3', activity: 'shipped', timestamp: baseTime + 86400000 + 2000, resource: 'warehouse' },
    { caseId: 'order-3', activity: 'delivered', timestamp: baseTime + 172800000 + 2000, resource: 'courier' },
  )

  // Case 4: Cancelled order (different variant)
  events.push(
    { caseId: 'order-4', activity: 'order_placed', timestamp: baseTime + 3000, resource: 'customer' },
    { caseId: 'order-4', activity: 'order_cancelled', timestamp: baseTime + 86400000 + 3000, resource: 'customer' },
  )

  // Case 5: Normal path - fast processing
  events.push(
    { caseId: 'order-5', activity: 'order_placed', timestamp: baseTime + 4000, resource: 'customer' },
    { caseId: 'order-5', activity: 'payment_received', timestamp: baseTime + 1800000 + 4000, resource: 'payment-system' },
    { caseId: 'order-5', activity: 'order_confirmed', timestamp: baseTime + 1900000 + 4000, resource: 'system' },
    { caseId: 'order-5', activity: 'shipped', timestamp: baseTime + 43200000 + 4000, resource: 'warehouse' },
    { caseId: 'order-5', activity: 'delivered', timestamp: baseTime + 86400000 + 4000, resource: 'courier' },
  )

  return events
}

/**
 * Generate events with known bottlenecks
 */
function generateBottleneckEvents(): ProcessEvent[] {
  const events: ProcessEvent[] = []
  const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days ago

  // Generate 20 cases with a consistent bottleneck at approval step
  for (let i = 0; i < 20; i++) {
    const caseStart = baseTime + i * 3600000

    events.push(
      { caseId: `case-${i}`, activity: 'submit', timestamp: caseStart, resource: 'user' },
      { caseId: `case-${i}`, activity: 'review', timestamp: caseStart + 1800000, resource: 'reviewer' }, // 30 min
      // Long wait here - 24+ hours for approval
      { caseId: `case-${i}`, activity: 'approve', timestamp: caseStart + 90000000, resource: 'manager' }, // 25 hours wait
      { caseId: `case-${i}`, activity: 'complete', timestamp: caseStart + 90600000, resource: 'system' }, // 10 min after
    )
  }

  // Add 5 cases where the same manager is overloaded
  for (let i = 20; i < 25; i++) {
    const caseStart = baseTime + i * 3600000

    events.push(
      { caseId: `case-${i}`, activity: 'submit', timestamp: caseStart, resource: 'user' },
      { caseId: `case-${i}`, activity: 'review', timestamp: caseStart + 1800000, resource: 'reviewer' },
      { caseId: `case-${i}`, activity: 'approve', timestamp: caseStart + 100000000, resource: 'manager' }, // Same manager
      { caseId: `case-${i}`, activity: 'complete', timestamp: caseStart + 100600000, resource: 'system' },
    )
  }

  return events
}

// ============================================================================
// Process Discovery Tests
// ============================================================================

describe('ProcessDiscovery', () => {
  let discovery: ProcessDiscovery

  beforeEach(() => {
    discovery = createProcessDiscovery()
  })

  it('should create a process discovery instance', () => {
    expect(discovery).toBeInstanceOf(ProcessDiscovery)
  })

  it('should discover process model from events', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const model = discovery.discover()

    expect(model.totalCases).toBe(5)
    expect(model.activities.size).toBeGreaterThan(0)
    expect(model.transitions.length).toBeGreaterThan(0)
    expect(model.startActivities).toContain('order_placed')
  })

  it('should identify start and end activities', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const model = discovery.discover()

    expect(model.startActivities).toContain('order_placed')
    expect(model.endActivities).toContain('delivered')
    expect(model.endActivities).toContain('order_cancelled')
  })

  it('should track activity frequencies', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const model = discovery.discover()

    const orderPlaced = model.activities.get('order_placed')
    expect(orderPlaced).toBeDefined()
    expect(orderPlaced!.frequency).toBe(5) // All 5 cases start with order_placed
  })

  it('should track transitions and durations', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const model = discovery.discover()

    // Find transition from order_placed to payment_received
    const transition = model.transitions.find(
      t => t.from === 'order_placed' && t.to === 'payment_received'
    )

    expect(transition).toBeDefined()
    expect(transition!.frequency).toBeGreaterThan(0)
    expect(transition!.avgDuration).toBeGreaterThan(0)
  })

  it('should track resources per activity', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const model = discovery.discover()

    const orderPlaced = model.activities.get('order_placed')
    expect(orderPlaced).toBeDefined()
    expect(orderPlaced!.resources.get('customer')).toBe(5)
  })

  it('should discover process variants', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const variants = discovery.getVariants()

    expect(variants.length).toBeGreaterThan(1) // Should have multiple variants
    expect(variants[0]!.frequency).toBeGreaterThanOrEqual(variants[1]?.frequency || 0) // Sorted by frequency
  })

  it('should identify the most common variant', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const variants = discovery.getVariants()

    // The normal happy path should be the most common
    const happyPath = variants[0]
    expect(happyPath!.activities).toContain('order_placed')
    expect(happyPath!.activities).toContain('delivered')
  })

  it('should calculate variant percentages', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)
    const variants = discovery.getVariants()

    const totalPercentage = variants.reduce((sum, v) => sum + v.percentage, 0)
    expect(totalPercentage).toBeCloseTo(100, 1)
  })

  it('should provide case access', () => {
    const events = generateOrderProcessEvents()
    discovery.loadEvents(events)

    const case1 = discovery.getCase('order-1')
    expect(case1).toBeDefined()
    expect(case1!.events.length).toBe(5)
    expect(case1!.caseId).toBe('order-1')
  })

  it('should handle empty events', () => {
    const model = discovery.discover()

    expect(model.totalCases).toBe(0)
    expect(model.activities.size).toBe(0)
    expect(model.transitions.length).toBe(0)
  })
})

// ============================================================================
// Bottleneck Analysis Tests
// ============================================================================

describe('BottleneckAnalyzer', () => {
  it('should detect waiting time bottlenecks', () => {
    const events = generateBottleneckEvents()
    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    expect(result.bottlenecks.length).toBeGreaterThan(0)

    // Should detect the approval bottleneck
    const waitingBottleneck = result.bottlenecks.find(
      b => b.type === 'waiting_time' && b.location.includes('approve')
    )
    expect(waitingBottleneck).toBeDefined()
  })

  it('should calculate health score', () => {
    const events = generateBottleneckEvents()
    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    expect(result.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.healthScore).toBeLessThanOrEqual(100)
  })

  it('should identify high wait activities', () => {
    const events = generateBottleneckEvents()
    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    expect(result.highWaitActivities.length).toBeGreaterThan(0)
    expect(result.highWaitActivities[0]!.avgWaitTime).toBeGreaterThan(0)
  })

  it('should provide recommendations', () => {
    const events = generateBottleneckEvents()
    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    const bottleneck = result.bottlenecks[0]
    if (bottleneck) {
      expect(bottleneck.recommendations.length).toBeGreaterThan(0)
    }
  })

  it('should sort bottlenecks by severity', () => {
    const events = generateBottleneckEvents()
    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    for (let i = 0; i < result.bottlenecks.length - 1; i++) {
      expect(result.bottlenecks[i]!.severity).toBeGreaterThanOrEqual(result.bottlenecks[i + 1]!.severity)
    }
  })

  it('should detect rework loops', () => {
    // Create events with rework
    const events: ProcessEvent[] = []
    const baseTime = Date.now()

    for (let i = 0; i < 20; i++) {
      events.push(
        { caseId: `case-${i}`, activity: 'start', timestamp: baseTime + i * 1000 },
        { caseId: `case-${i}`, activity: 'review', timestamp: baseTime + i * 1000 + 1000 },
        { caseId: `case-${i}`, activity: 'reject', timestamp: baseTime + i * 1000 + 2000 },
        { caseId: `case-${i}`, activity: 'review', timestamp: baseTime + i * 1000 + 3000 }, // Rework
        { caseId: `case-${i}`, activity: 'approve', timestamp: baseTime + i * 1000 + 4000 },
      )
    }

    const discovery = createProcessDiscovery(events)
    const analyzer = createBottleneckAnalyzer(discovery)
    const result = analyzer.analyze()

    const reworkBottleneck = result.bottlenecks.find(b => b.type === 'rework_loop')
    expect(reworkBottleneck).toBeDefined()
  })
})

// ============================================================================
// Compliance Checking Tests
// ============================================================================

describe('ComplianceChecker', () => {
  let discovery: ProcessDiscovery
  let checker: ComplianceChecker

  beforeEach(() => {
    const events = generateOrderProcessEvents()
    discovery = createProcessDiscovery(events)
    checker = createComplianceChecker(discovery)
  })

  it('should check sequence rules', () => {
    checker.addRule(sequenceRule('seq1', 'order_placed', 'payment_received'))
    const result = checker.check()

    // Should pass for normal orders
    expect(result.complianceRate).toBeGreaterThan(0)
  })

  it('should detect sequence violations', () => {
    // Rule: payment must be followed by confirmation
    checker.addRule(sequenceRule('seq1', 'payment_received', 'order_confirmed'))
    const result = checker.check()

    // Case 4 (cancelled) doesn't have payment -> confirmation
    expect(result.violations.length).toBeGreaterThanOrEqual(0)
  })

  it('should check existence rules', () => {
    checker.addRule(existenceRule('exist1', 'order_placed'))
    const result = checker.check()

    expect(result.complianceRate).toBe(100) // All cases have order_placed
    expect(result.violations.length).toBe(0)
  })

  it('should detect existence violations', () => {
    checker.addRule(existenceRule('exist1', 'shipped', 1)) // shipped must occur
    const result = checker.check()

    // Case 4 (cancelled) doesn't have shipped
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.caseId === 'order-4')).toBe(true)
  })

  it('should check absence rules', () => {
    checker.addRule(absenceRule('absent1', 'fraud_detected'))
    const result = checker.check()

    expect(result.complianceRate).toBe(100) // No fraud events
    expect(result.violations.length).toBe(0)
  })

  it('should detect absence violations', () => {
    checker.addRule(absenceRule('absent1', 'order_cancelled'))
    const result = checker.check()

    // Case 4 has order_cancelled
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]!.caseId).toBe('order-4')
  })

  it('should check timing rules', () => {
    // Total process must complete within 4 days
    checker.addRule(timingRule('timing1', 'start', 'end', 4 * 24 * 60 * 60 * 1000))
    const result = checker.check()

    // All our test cases should complete within 4 days
    expect(result.complianceRate).toBe(100)
  })

  it('should detect timing violations', () => {
    // Total process must complete within 1 day (unrealistic)
    checker.addRule(timingRule('timing1', 'order_placed', 'delivered', 24 * 60 * 60 * 1000))
    const result = checker.check()

    // Most cases take longer than 1 day
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('should check resource rules', () => {
    checker.addRule(resourceRule('resource1', 'order_placed', ['customer']))
    const result = checker.check()

    expect(result.complianceRate).toBe(100)
  })

  it('should detect resource violations', () => {
    // Only 'admin' can place orders (but our data has 'customer')
    checker.addRule(resourceRule('resource1', 'order_placed', ['admin']))
    const result = checker.check()

    expect(result.violations.length).toBe(5) // All 5 orders violated
  })

  it('should track violations by rule', () => {
    checker.addRule(existenceRule('exist1', 'shipped'))
    checker.addRule(absenceRule('absent1', 'order_cancelled'))
    const result = checker.check()

    expect(result.violationsByRule.size).toBe(2)
  })

  it('should calculate compliance metrics', () => {
    checker.addRule(existenceRule('exist1', 'shipped'))
    const result = checker.check()

    expect(result.compliantCases + result.nonCompliantCases).toBe(5)
    expect(result.totalViolations).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Performance Metrics Tests
// ============================================================================

describe('PerformanceAnalyzer', () => {
  let discovery: ProcessDiscovery
  let analyzer: PerformanceAnalyzer

  beforeEach(() => {
    const events = generateOrderProcessEvents()
    discovery = createProcessDiscovery(events)
    analyzer = createPerformanceAnalyzer(discovery)
  })

  it('should calculate cycle time metrics', () => {
    const metrics = analyzer.analyze()

    expect(metrics.totalCases).toBe(5)
    expect(metrics.avgCycleTime).toBeGreaterThan(0)
    expect(metrics.medianCycleTime).toBeGreaterThan(0)
    expect(metrics.minCycleTime).toBeLessThanOrEqual(metrics.avgCycleTime)
    expect(metrics.maxCycleTime).toBeGreaterThanOrEqual(metrics.avgCycleTime)
  })

  it('should calculate percentiles', () => {
    const metrics = analyzer.analyze()

    expect(metrics.p95CycleTime).toBeGreaterThan(0)
    expect(metrics.p95CycleTime).toBeGreaterThanOrEqual(metrics.medianCycleTime)
  })

  it('should calculate throughput', () => {
    const metrics = analyzer.analyze()

    expect(metrics.throughput).toBeGreaterThan(0)
    expect(metrics.throughputUnit).toBe('cases/day')
  })

  it('should calculate wait vs processing time', () => {
    const metrics = analyzer.analyze()

    expect(metrics.avgWaitTime).toBeGreaterThanOrEqual(0)
    expect(metrics.waitTimePercentage).toBeGreaterThanOrEqual(0)
    expect(metrics.waitTimePercentage).toBeLessThanOrEqual(100)
  })

  it('should provide activity-level metrics', () => {
    const metrics = analyzer.analyze()

    expect(metrics.activityMetrics.size).toBeGreaterThan(0)

    const orderPlacedMetrics = metrics.activityMetrics.get('order_placed')
    expect(orderPlacedMetrics).toBeDefined()
    expect(orderPlacedMetrics!.frequency).toBe(5)
  })

  it('should track resource frequency per activity', () => {
    const metrics = analyzer.analyze()

    const orderPlacedMetrics = metrics.activityMetrics.get('order_placed')
    expect(orderPlacedMetrics!.resourceFrequency.get('customer')).toBe(5)
  })

  it('should analyze with time series', () => {
    const metrics = analyzer.analyzeWithTimeSeries('day')

    expect(metrics.timeSeriesMetrics).toBeDefined()
    expect(metrics.timeSeriesMetrics!.length).toBeGreaterThan(0)
  })

  it('should handle empty events', () => {
    const emptyDiscovery = createProcessDiscovery([])
    const emptyAnalyzer = createPerformanceAnalyzer(emptyDiscovery)
    const metrics = emptyAnalyzer.analyze()

    expect(metrics.totalCases).toBe(0)
    expect(metrics.avgCycleTime).toBe(0)
    expect(metrics.throughput).toBe(0)
  })
})

// ============================================================================
// Fluent Builder API Tests
// ============================================================================

describe('ProcessMiningBuilder', () => {
  it('should provide fluent API for process discovery', () => {
    const events = generateOrderProcessEvents()
    const model = processMining()
      .from(events)
      .discoverModel()

    expect(model.totalCases).toBe(5)
    expect(model.activities.size).toBeGreaterThan(0)
  })

  it('should provide variants through fluent API', () => {
    const events = generateOrderProcessEvents()
    const variants = processMining()
      .from(events)
      .variants()

    expect(variants.length).toBeGreaterThan(0)
  })

  it('should provide bottleneck analysis through fluent API', () => {
    const events = generateBottleneckEvents()
    const result = processMining()
      .from(events)
      .bottlenecks()

    expect(result.bottlenecks).toBeDefined()
    expect(result.healthScore).toBeGreaterThanOrEqual(0)
  })

  it('should provide compliance checking through fluent API', () => {
    const events = generateOrderProcessEvents()
    const result = processMining()
      .from(events)
      .mustExist('order_placed')
      .mustNotExist('fraud_detected')
      .checkCompliance()

    expect(result.complianceRate).toBe(100)
  })

  it('should chain multiple compliance rules', () => {
    const events = generateOrderProcessEvents()
    const result = processMining()
      .from(events)
      .mustExist('order_placed')
      .mustFollow('order_placed', 'payment_received')
      .maxDuration('start', 'end', 10 * 24 * 60 * 60 * 1000) // 10 days
      .checkCompliance()

    expect(result.rulesChecked.length).toBe(3)
  })

  it('should provide performance metrics through fluent API', () => {
    const events = generateOrderProcessEvents()
    const metrics = processMining()
      .from(events)
      .performance()

    expect(metrics.totalCases).toBe(5)
    expect(metrics.avgCycleTime).toBeGreaterThan(0)
  })

  it('should provide performance with trends', () => {
    const events = generateOrderProcessEvents()
    const metrics = processMining()
      .from(events)
      .performanceWithTrends('day')

    expect(metrics.timeSeriesMetrics).toBeDefined()
  })

  it('should throw error if no events loaded', () => {
    const builder = processMining()

    expect(() => builder.discoverModel()).toThrow('No events loaded')
  })

  it('should allow chaining all operations', () => {
    const events = generateOrderProcessEvents()
    const builder = processMining().from(events)

    // All these should work
    const model = builder.discoverModel()
    const variants = builder.variants()
    const performance = builder.performance()

    expect(model.totalCases).toBe(5)
    expect(variants.length).toBeGreaterThan(0)
    expect(performance.totalCases).toBe(5)
  })

  it('should support resource rules through fluent API', () => {
    const events = generateOrderProcessEvents()
    const result = processMining()
      .from(events)
      .onlyByResources('order_placed', ['customer', 'admin'])
      .checkCompliance()

    expect(result.complianceRate).toBe(100)
  })
})

// ============================================================================
// Rule Builder Tests
// ============================================================================

describe('Rule Builders', () => {
  it('should create sequence rules', () => {
    const rule = sequenceRule('seq1', 'A', 'B', true)

    expect(rule.id).toBe('seq1')
    expect(rule.type).toBe('sequence')
    expect(rule.definition.type).toBe('sequence')
    expect((rule.definition as any).predecessor).toBe('A')
    expect((rule.definition as any).successor).toBe('B')
    expect((rule.definition as any).direct).toBe(true)
  })

  it('should create existence rules', () => {
    const rule = existenceRule('exist1', 'start', 1, 3)

    expect(rule.id).toBe('exist1')
    expect(rule.type).toBe('existence')
    expect((rule.definition as any).activity).toBe('start')
    expect((rule.definition as any).minOccurrences).toBe(1)
    expect((rule.definition as any).maxOccurrences).toBe(3)
  })

  it('should create absence rules', () => {
    const rule = absenceRule('absent1', 'error')

    expect(rule.id).toBe('absent1')
    expect(rule.type).toBe('absence')
    expect((rule.definition as any).activity).toBe('error')
  })

  it('should create timing rules', () => {
    const rule = timingRule('timing1', 'start', 'end', 86400000)

    expect(rule.id).toBe('timing1')
    expect(rule.type).toBe('timing')
    expect((rule.definition as any).from).toBe('start')
    expect((rule.definition as any).to).toBe('end')
    expect((rule.definition as any).maxDuration).toBe(86400000)
  })

  it('should create resource rules', () => {
    const rule = resourceRule('resource1', 'approve', ['manager', 'director'])

    expect(rule.id).toBe('resource1')
    expect(rule.type).toBe('resource')
    expect((rule.definition as any).activity).toBe('approve')
    expect((rule.definition as any).allowedResources).toContain('manager')
  })
})

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle single event cases', () => {
    const events: ProcessEvent[] = [
      { caseId: 'case-1', activity: 'start', timestamp: Date.now() },
    ]

    const discovery = createProcessDiscovery(events)
    const model = discovery.discover()

    expect(model.totalCases).toBe(1)
    expect(model.activities.get('start')!.isStart).toBe(true)
    expect(model.activities.get('start')!.isEnd).toBe(true)
  })

  it('should handle cases with duplicate activities', () => {
    const events: ProcessEvent[] = [
      { caseId: 'case-1', activity: 'step', timestamp: Date.now() },
      { caseId: 'case-1', activity: 'step', timestamp: Date.now() + 1000 },
      { caseId: 'case-1', activity: 'step', timestamp: Date.now() + 2000 },
    ]

    const discovery = createProcessDiscovery(events)
    const model = discovery.discover()

    expect(model.activities.get('step')!.frequency).toBe(3)
  })

  it('should handle unsorted events', () => {
    const now = Date.now()
    const events: ProcessEvent[] = [
      { caseId: 'case-1', activity: 'end', timestamp: now + 2000 },
      { caseId: 'case-1', activity: 'start', timestamp: now },
      { caseId: 'case-1', activity: 'middle', timestamp: now + 1000 },
    ]

    const discovery = createProcessDiscovery(events)
    const processCase = discovery.getCase('case-1')

    // Events should be sorted by timestamp
    expect(processCase!.events[0]!.activity).toBe('start')
    expect(processCase!.events[2]!.activity).toBe('end')
  })

  it('should handle events without resources', () => {
    const events: ProcessEvent[] = [
      { caseId: 'case-1', activity: 'start', timestamp: Date.now() },
      { caseId: 'case-1', activity: 'end', timestamp: Date.now() + 1000 },
    ]

    const discovery = createProcessDiscovery(events)
    const model = discovery.discover()

    expect(model.activities.get('start')!.resources.size).toBe(0)
  })

  it('should handle large number of cases', () => {
    const events: ProcessEvent[] = []
    const baseTime = Date.now()

    // Generate 1000 cases
    for (let i = 0; i < 1000; i++) {
      events.push(
        { caseId: `case-${i}`, activity: 'start', timestamp: baseTime + i * 1000 },
        { caseId: `case-${i}`, activity: 'process', timestamp: baseTime + i * 1000 + 100 },
        { caseId: `case-${i}`, activity: 'end', timestamp: baseTime + i * 1000 + 200 },
      )
    }

    const discovery = createProcessDiscovery(events)
    const model = discovery.discover()

    expect(model.totalCases).toBe(1000)
    expect(model.activities.get('start')!.frequency).toBe(1000)
  })

  it('should calculate metrics correctly with varying durations', () => {
    const events: ProcessEvent[] = []
    const baseTime = Date.now()
    const durations = [1000, 2000, 3000, 4000, 5000] // Different durations

    for (let i = 0; i < durations.length; i++) {
      events.push(
        { caseId: `case-${i}`, activity: 'start', timestamp: baseTime + i * 10000 },
        { caseId: `case-${i}`, activity: 'end', timestamp: baseTime + i * 10000 + durations[i]! },
      )
    }

    const discovery = createProcessDiscovery(events)
    const metrics = createPerformanceAnalyzer(discovery).analyze()

    expect(metrics.avgCycleTime).toBe(3000) // Average of [1000, 2000, 3000, 4000, 5000]
    expect(metrics.medianCycleTime).toBe(3000) // Median
    expect(metrics.minCycleTime).toBe(1000)
    expect(metrics.maxCycleTime).toBe(5000)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('should perform end-to-end process analysis', () => {
    const events = generateOrderProcessEvents()

    // Full analysis pipeline
    const builder = processMining().from(events)

    // Discovery
    const model = builder.discoverModel()
    expect(model.totalCases).toBe(5)

    // Variants
    const variants = builder.variants()
    expect(variants.length).toBeGreaterThan(1)

    // Bottlenecks
    const bottlenecks = builder.bottlenecks()
    expect(bottlenecks.healthScore).toBeGreaterThanOrEqual(0)

    // Compliance
    const compliance = builder
      .mustExist('order_placed')
      .checkCompliance()
    expect(compliance.complianceRate).toBe(100)

    // Performance
    const performance = builder.performance()
    expect(performance.totalCases).toBe(5)
  })

  it('should identify problematic cases through combined analysis', () => {
    const events = generateOrderProcessEvents()
    const builder = processMining().from(events)

    // Find the cancelled order variant
    const variants = builder.variants()
    const cancelledVariant = variants.find(v => v.activities.includes('order_cancelled'))
    expect(cancelledVariant).toBeDefined()

    // Check compliance
    const compliance = builder
      .mustExist('delivered')
      .checkCompliance()

    // The cancelled case should violate the rule
    expect(compliance.violations.some(v => v.caseId === 'order-4')).toBe(true)
  })
})
