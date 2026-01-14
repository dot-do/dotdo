/**
 * Process Mining Primitive
 *
 * Provides business process mining capabilities for:
 * - Process Discovery: Automatically discover process models from event logs
 * - Bottleneck Analysis: Identify process bottlenecks and inefficiencies
 * - Compliance Checking: Verify process conformance against defined models
 * - Performance Metrics: Calculate cycle time, wait time, throughput
 * - Variant Analysis: Identify different paths through a process
 *
 * @module db/primitives/analytics/process-mining
 * @see dotdo-fsfsd
 */

// ============================================================================
// Types - Process Events
// ============================================================================

/**
 * A process event representing an activity in a case
 */
export interface ProcessEvent {
  /** Unique case/trace identifier (e.g., order ID, ticket ID) */
  caseId: string
  /** Activity name (e.g., 'order_placed', 'payment_received') */
  activity: string
  /** Event timestamp */
  timestamp: number
  /** Resource that performed the activity (optional) */
  resource?: string
  /** Additional event attributes */
  attributes?: Record<string, unknown>
}

/**
 * A case (trace) in the event log - a sequence of events for one process instance
 */
export interface ProcessCase {
  /** Case identifier */
  caseId: string
  /** Events in this case, sorted by timestamp */
  events: ProcessEvent[]
  /** Case start time */
  startTime: number
  /** Case end time */
  endTime: number
  /** Total duration (ms) */
  duration: number
  /** Whether the case is complete (reached end activity) */
  isComplete: boolean
}

// ============================================================================
// Types - Process Model
// ============================================================================

/**
 * A transition in the process model (edge between activities)
 */
export interface ProcessTransition {
  /** Source activity */
  from: string
  /** Target activity */
  to: string
  /** Number of times this transition occurred */
  frequency: number
  /** Average time between activities (ms) */
  avgDuration: number
  /** Median time between activities (ms) */
  medianDuration: number
  /** Min time between activities (ms) */
  minDuration: number
  /** Max time between activities (ms) */
  maxDuration: number
  /** Standard deviation of duration */
  stdDuration: number
}

/**
 * An activity node in the process model
 */
export interface ProcessActivity {
  /** Activity name */
  name: string
  /** Number of times this activity occurred */
  frequency: number
  /** Resources that performed this activity */
  resources: Map<string, number>
  /** Average processing time (time between start and complete events if available) */
  avgProcessingTime?: number
  /** Whether this is a start activity */
  isStart: boolean
  /** Whether this is an end activity */
  isEnd: boolean
}

/**
 * Discovered process model (Directly-Follows Graph)
 */
export interface ProcessModel {
  /** Activities in the model */
  activities: Map<string, ProcessActivity>
  /** Transitions between activities */
  transitions: ProcessTransition[]
  /** Start activities */
  startActivities: string[]
  /** End activities */
  endActivities: string[]
  /** Total number of cases analyzed */
  totalCases: number
  /** Number of complete cases */
  completeCases: number
  /** Number of unique variants (paths) */
  variantCount: number
}

// ============================================================================
// Types - Process Variants
// ============================================================================

/**
 * A process variant (unique path through the process)
 */
export interface ProcessVariant {
  /** Sequence of activities */
  activities: string[]
  /** Variant identifier (hash of activity sequence) */
  variantId: string
  /** Number of cases following this variant */
  frequency: number
  /** Percentage of total cases */
  percentage: number
  /** Average duration for this variant (ms) */
  avgDuration: number
  /** Example case IDs */
  exampleCases: string[]
}

// ============================================================================
// Types - Bottleneck Analysis
// ============================================================================

/**
 * Types of bottlenecks that can be detected
 */
export type BottleneckType =
  | 'waiting_time'      // High wait time between activities
  | 'processing_time'   // High processing time at an activity
  | 'resource_contention' // Resource overload
  | 'rework_loop'       // Activities that cause loops/rework
  | 'variant_divergence' // Point where process paths diverge

/**
 * A detected bottleneck in the process
 */
export interface Bottleneck {
  /** Type of bottleneck */
  type: BottleneckType
  /** Location (activity or transition) */
  location: string
  /** Severity score (0-100) */
  severity: number
  /** Description of the bottleneck */
  description: string
  /** Affected cases count */
  affectedCases: number
  /** Impact in terms of time (ms) */
  timeImpact: number
  /** Recommendations for improvement */
  recommendations: string[]
  /** Supporting metrics */
  metrics: Record<string, number>
}

/**
 * Result of bottleneck analysis
 */
export interface BottleneckAnalysisResult {
  /** Detected bottlenecks sorted by severity */
  bottlenecks: Bottleneck[]
  /** Overall process health score (0-100) */
  healthScore: number
  /** Total time lost to bottlenecks (ms) */
  totalTimeLost: number
  /** Activities with highest wait times */
  highWaitActivities: Array<{ activity: string; avgWaitTime: number }>
  /** Resources with highest load */
  overloadedResources: Array<{ resource: string; caseCount: number; avgLoad: number }>
}

// ============================================================================
// Types - Compliance Checking
// ============================================================================

/**
 * A rule for compliance checking
 */
export interface ComplianceRule {
  /** Rule identifier */
  id: string
  /** Rule name */
  name: string
  /** Rule description */
  description: string
  /** Rule type */
  type: 'sequence' | 'existence' | 'absence' | 'timing' | 'resource'
  /** Rule definition */
  definition: ComplianceRuleDefinition
}

/**
 * Rule definition types
 */
export type ComplianceRuleDefinition =
  | SequenceRule
  | ExistenceRule
  | AbsenceRule
  | TimingRule
  | ResourceRule

/**
 * Sequence rule: Activity A must be followed by Activity B
 */
export interface SequenceRule {
  type: 'sequence'
  /** Activity that must occur first */
  predecessor: string
  /** Activity that must follow */
  successor: string
  /** Whether they must be directly adjacent */
  direct?: boolean
}

/**
 * Existence rule: Activity must occur in every case
 */
export interface ExistenceRule {
  type: 'existence'
  /** Activity that must exist */
  activity: string
  /** Minimum occurrences */
  minOccurrences?: number
  /** Maximum occurrences */
  maxOccurrences?: number
}

/**
 * Absence rule: Activity must not occur
 */
export interface AbsenceRule {
  type: 'absence'
  /** Activity that must not exist */
  activity: string
}

/**
 * Timing rule: Activity must complete within time limit
 */
export interface TimingRule {
  type: 'timing'
  /** From activity (or 'start' for case start) */
  from: string | 'start'
  /** To activity (or 'end' for case end) */
  to: string | 'end'
  /** Maximum allowed time (ms) */
  maxDuration: number
}

/**
 * Resource rule: Activity must be performed by specific resource(s)
 */
export interface ResourceRule {
  type: 'resource'
  /** Activity to check */
  activity: string
  /** Allowed resources */
  allowedResources: string[]
}

/**
 * A violation of a compliance rule
 */
export interface ComplianceViolation {
  /** Rule that was violated */
  ruleId: string
  /** Rule name */
  ruleName: string
  /** Case ID where violation occurred */
  caseId: string
  /** Description of the violation */
  description: string
  /** Violation details */
  details: Record<string, unknown>
}

/**
 * Result of compliance checking
 */
export interface ComplianceResult {
  /** Overall compliance rate (0-100) */
  complianceRate: number
  /** Number of compliant cases */
  compliantCases: number
  /** Number of non-compliant cases */
  nonCompliantCases: number
  /** Total violations found */
  totalViolations: number
  /** Violations grouped by rule */
  violationsByRule: Map<string, ComplianceViolation[]>
  /** All violations */
  violations: ComplianceViolation[]
  /** Rules checked */
  rulesChecked: ComplianceRule[]
}

// ============================================================================
// Types - Performance Metrics
// ============================================================================

/**
 * Performance metrics for the overall process
 */
export interface ProcessPerformanceMetrics {
  /** Total cases analyzed */
  totalCases: number
  /** Complete cases */
  completeCases: number
  /** Completion rate (%) */
  completionRate: number

  // Cycle Time (end-to-end)
  /** Average cycle time (ms) */
  avgCycleTime: number
  /** Median cycle time (ms) */
  medianCycleTime: number
  /** Min cycle time (ms) */
  minCycleTime: number
  /** Max cycle time (ms) */
  maxCycleTime: number
  /** 95th percentile cycle time (ms) */
  p95CycleTime: number

  // Throughput
  /** Cases per time period */
  throughput: number
  /** Throughput unit (e.g., 'cases/day') */
  throughputUnit: string

  // Wait Time
  /** Average total wait time (ms) */
  avgWaitTime: number
  /** Wait time as percentage of cycle time */
  waitTimePercentage: number

  // Processing Time
  /** Average processing time (ms) */
  avgProcessingTime: number
  /** Processing time as percentage of cycle time */
  processingTimePercentage: number

  // Activity-level metrics
  /** Metrics per activity */
  activityMetrics: Map<string, ActivityMetrics>

  // Time-based analysis
  /** Metrics over time (for trend analysis) */
  timeSeriesMetrics?: TimeSeriesMetrics[]
}

/**
 * Metrics for a single activity
 */
export interface ActivityMetrics {
  /** Activity name */
  activity: string
  /** Number of occurrences */
  frequency: number
  /** Average time spent waiting before this activity (ms) */
  avgWaitTime: number
  /** Average processing time at this activity (ms) */
  avgProcessingTime: number
  /** Average time to next activity (ms) */
  avgTimeToNext: number
  /** Resources and their frequency */
  resourceFrequency: Map<string, number>
}

/**
 * Time series metrics for trend analysis
 */
export interface TimeSeriesMetrics {
  /** Period start timestamp */
  periodStart: number
  /** Period end timestamp */
  periodEnd: number
  /** Number of cases started */
  casesStarted: number
  /** Number of cases completed */
  casesCompleted: number
  /** Average cycle time in period */
  avgCycleTime: number
  /** Throughput in period */
  throughput: number
}

// ============================================================================
// Process Discovery
// ============================================================================

/**
 * Process Discovery - Discovers process models from event logs
 *
 * Uses the Directly-Follows Graph (DFG) algorithm to discover
 * the process model from a sequence of events.
 */
export class ProcessDiscovery {
  private events: ProcessEvent[] = []
  private cases: Map<string, ProcessCase> = new Map()
  private variants: Map<string, ProcessVariant> = new Map()

  constructor(events?: ProcessEvent[]) {
    if (events) {
      this.loadEvents(events)
    }
  }

  /**
   * Load events into the discovery engine
   */
  loadEvents(events: ProcessEvent[]): void {
    this.events = [...events].sort((a, b) => a.timestamp - b.timestamp)
    this.buildCases()
  }

  /**
   * Build cases from events
   */
  private buildCases(): void {
    this.cases.clear()

    // Group events by case ID
    const eventsByCase = new Map<string, ProcessEvent[]>()
    for (const event of this.events) {
      if (!eventsByCase.has(event.caseId)) {
        eventsByCase.set(event.caseId, [])
      }
      eventsByCase.get(event.caseId)!.push(event)
    }

    // Build case objects
    for (const [caseId, caseEvents] of eventsByCase) {
      const sortedEvents = caseEvents.sort((a, b) => a.timestamp - b.timestamp)
      const startTime = sortedEvents[0]!.timestamp
      const endTime = sortedEvents[sortedEvents.length - 1]!.timestamp

      this.cases.set(caseId, {
        caseId,
        events: sortedEvents,
        startTime,
        endTime,
        duration: endTime - startTime,
        isComplete: true, // Will be refined when model is discovered
      })
    }
  }

  /**
   * Discover the process model from loaded events
   */
  discover(): ProcessModel {
    const activities = new Map<string, ProcessActivity>()
    const transitionCounts = new Map<string, number>()
    const transitionDurations = new Map<string, number[]>()
    const startActivityCounts = new Map<string, number>()
    const endActivityCounts = new Map<string, number>()

    // Process each case
    for (const processCase of this.cases.values()) {
      const events = processCase.events

      for (let i = 0; i < events.length; i++) {
        const event = events[i]!
        const activityName = event.activity

        // Track activity
        if (!activities.has(activityName)) {
          activities.set(activityName, {
            name: activityName,
            frequency: 0,
            resources: new Map(),
            isStart: false,
            isEnd: false,
          })
        }

        const activity = activities.get(activityName)!
        activity.frequency++

        // Track resource
        if (event.resource) {
          const resourceCount = activity.resources.get(event.resource) || 0
          activity.resources.set(event.resource, resourceCount + 1)
        }

        // Track start activity
        if (i === 0) {
          const count = startActivityCounts.get(activityName) || 0
          startActivityCounts.set(activityName, count + 1)
        }

        // Track end activity
        if (i === events.length - 1) {
          const count = endActivityCounts.get(activityName) || 0
          endActivityCounts.set(activityName, count + 1)
        }

        // Track transition to next activity
        if (i < events.length - 1) {
          const nextEvent = events[i + 1]!
          const transitionKey = `${activityName}->${nextEvent.activity}`

          const count = transitionCounts.get(transitionKey) || 0
          transitionCounts.set(transitionKey, count + 1)

          if (!transitionDurations.has(transitionKey)) {
            transitionDurations.set(transitionKey, [])
          }
          transitionDurations.get(transitionKey)!.push(nextEvent.timestamp - event.timestamp)
        }
      }
    }

    // Mark start and end activities
    for (const [activityName, count] of startActivityCounts) {
      const activity = activities.get(activityName)!
      activity.isStart = count > 0
    }

    for (const [activityName, count] of endActivityCounts) {
      const activity = activities.get(activityName)!
      activity.isEnd = count > 0
    }

    // Build transitions
    const transitions: ProcessTransition[] = []
    for (const [key, frequency] of transitionCounts) {
      const [from, to] = key.split('->') as [string, string]
      const durations = transitionDurations.get(key) || []
      const sortedDurations = [...durations].sort((a, b) => a - b)

      transitions.push({
        from,
        to,
        frequency,
        avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        medianDuration: this.median(sortedDurations),
        minDuration: sortedDurations[0] || 0,
        maxDuration: sortedDurations[sortedDurations.length - 1] || 0,
        stdDuration: this.standardDeviation(durations),
      })
    }

    // Build variants
    this.buildVariants()

    // Determine start and end activities
    const startActivities = Array.from(activities.values())
      .filter(a => a.isStart)
      .map(a => a.name)

    const endActivities = Array.from(activities.values())
      .filter(a => a.isEnd)
      .map(a => a.name)

    return {
      activities,
      transitions: transitions.sort((a, b) => b.frequency - a.frequency),
      startActivities,
      endActivities,
      totalCases: this.cases.size,
      completeCases: Array.from(this.cases.values()).filter(c => c.isComplete).length,
      variantCount: this.variants.size,
    }
  }

  /**
   * Build process variants from cases
   */
  private buildVariants(): void {
    this.variants.clear()
    const variantCases = new Map<string, ProcessCase[]>()

    for (const processCase of this.cases.values()) {
      const activities = processCase.events.map(e => e.activity)
      const variantId = this.hashVariant(activities)

      if (!variantCases.has(variantId)) {
        variantCases.set(variantId, [])
      }
      variantCases.get(variantId)!.push(processCase)
    }

    const totalCases = this.cases.size

    for (const [variantId, cases] of variantCases) {
      const durations = cases.map(c => c.duration)
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length

      this.variants.set(variantId, {
        activities: cases[0]!.events.map(e => e.activity),
        variantId,
        frequency: cases.length,
        percentage: (cases.length / totalCases) * 100,
        avgDuration,
        exampleCases: cases.slice(0, 5).map(c => c.caseId),
      })
    }
  }

  /**
   * Get discovered variants sorted by frequency
   */
  getVariants(): ProcessVariant[] {
    if (this.variants.size === 0) {
      this.buildVariants()
    }
    return Array.from(this.variants.values()).sort((a, b) => b.frequency - a.frequency)
  }

  /**
   * Get a specific case by ID
   */
  getCase(caseId: string): ProcessCase | undefined {
    return this.cases.get(caseId)
  }

  /**
   * Get all cases
   */
  getCases(): ProcessCase[] {
    return Array.from(this.cases.values())
  }

  /**
   * Hash a variant (activity sequence) to a unique ID
   */
  private hashVariant(activities: string[]): string {
    return activities.join('|')
  }

  /**
   * Calculate median of an array
   */
  private median(sortedValues: number[]): number {
    if (sortedValues.length === 0) return 0
    const mid = Math.floor(sortedValues.length / 2)
    return sortedValues.length % 2 !== 0
      ? sortedValues[mid]!
      : (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
  }

  /**
   * Calculate standard deviation
   */
  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const squareDiffs = values.map(v => Math.pow(v - avg, 2))
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(avgSquareDiff)
  }
}

/**
 * Factory function to create a ProcessDiscovery instance
 */
export function createProcessDiscovery(events?: ProcessEvent[]): ProcessDiscovery {
  return new ProcessDiscovery(events)
}

// ============================================================================
// Bottleneck Analysis
// ============================================================================

/**
 * BottleneckAnalyzer - Identifies process bottlenecks
 *
 * Analyzes the process to find:
 * - High wait times between activities
 * - Resource contention
 * - Rework loops
 * - Process divergence points
 */
export class BottleneckAnalyzer {
  private discovery: ProcessDiscovery
  private model: ProcessModel | null = null

  constructor(discovery: ProcessDiscovery) {
    this.discovery = discovery
  }

  /**
   * Analyze the process for bottlenecks
   */
  analyze(): BottleneckAnalysisResult {
    this.model = this.discovery.discover()
    const bottlenecks: Bottleneck[] = []

    // Detect waiting time bottlenecks
    bottlenecks.push(...this.detectWaitingTimeBottlenecks())

    // Detect resource contention
    bottlenecks.push(...this.detectResourceContention())

    // Detect rework loops
    bottlenecks.push(...this.detectReworkLoops())

    // Detect variant divergence points
    bottlenecks.push(...this.detectVariantDivergence())

    // Sort by severity
    bottlenecks.sort((a, b) => b.severity - a.severity)

    // Calculate overall health score
    const healthScore = this.calculateHealthScore(bottlenecks)

    // Calculate total time lost
    const totalTimeLost = bottlenecks.reduce((sum, b) => sum + b.timeImpact, 0)

    // Get high wait activities
    const highWaitActivities = this.getHighWaitActivities()

    // Get overloaded resources
    const overloadedResources = this.getOverloadedResources()

    return {
      bottlenecks,
      healthScore,
      totalTimeLost,
      highWaitActivities,
      overloadedResources,
    }
  }

  /**
   * Detect waiting time bottlenecks
   */
  private detectWaitingTimeBottlenecks(): Bottleneck[] {
    if (!this.model) return []

    const bottlenecks: Bottleneck[] = []
    const transitions = this.model.transitions

    // Calculate average transition time
    const avgTransitionTime =
      transitions.reduce((sum, t) => sum + t.avgDuration, 0) / transitions.length

    // Identify transitions with significantly higher than average wait time
    for (const transition of transitions) {
      if (transition.avgDuration > avgTransitionTime * 2 && transition.frequency > 5) {
        const severity = Math.min(
          100,
          Math.floor((transition.avgDuration / avgTransitionTime) * 25)
        )

        bottlenecks.push({
          type: 'waiting_time',
          location: `${transition.from} -> ${transition.to}`,
          severity,
          description: `High wait time between "${transition.from}" and "${transition.to}" (avg: ${this.formatDuration(transition.avgDuration)})`,
          affectedCases: transition.frequency,
          timeImpact: (transition.avgDuration - avgTransitionTime) * transition.frequency,
          recommendations: [
            `Investigate delays between "${transition.from}" and "${transition.to}"`,
            'Consider adding parallel processing',
            'Review resource availability at this transition',
          ],
          metrics: {
            avgDuration: transition.avgDuration,
            medianDuration: transition.medianDuration,
            maxDuration: transition.maxDuration,
            frequency: transition.frequency,
          },
        })
      }
    }

    return bottlenecks
  }

  /**
   * Detect resource contention bottlenecks
   */
  private detectResourceContention(): Bottleneck[] {
    if (!this.model) return []

    const bottlenecks: Bottleneck[] = []
    const cases = this.discovery.getCases()

    // Track resource workload
    const resourceWorkload = new Map<string, { caseCount: number; activities: string[] }>()

    for (const processCase of cases) {
      for (const event of processCase.events) {
        if (event.resource) {
          if (!resourceWorkload.has(event.resource)) {
            resourceWorkload.set(event.resource, { caseCount: 0, activities: [] })
          }
          const workload = resourceWorkload.get(event.resource)!
          workload.caseCount++
          if (!workload.activities.includes(event.activity)) {
            workload.activities.push(event.activity)
          }
        }
      }
    }

    // Calculate average workload
    const workloads = Array.from(resourceWorkload.values()).map(w => w.caseCount)
    const avgWorkload = workloads.length > 0
      ? workloads.reduce((a, b) => a + b, 0) / workloads.length
      : 0

    // Identify overloaded resources
    for (const [resource, workload] of resourceWorkload) {
      if (workload.caseCount > avgWorkload * 1.5 && workload.caseCount > 10) {
        const severity = Math.min(100, Math.floor((workload.caseCount / avgWorkload) * 30))

        bottlenecks.push({
          type: 'resource_contention',
          location: resource,
          severity,
          description: `Resource "${resource}" is handling ${workload.caseCount} events (${Math.round(workload.caseCount / avgWorkload * 100)}% of average)`,
          affectedCases: workload.caseCount,
          timeImpact: 0, // Hard to estimate without more data
          recommendations: [
            `Consider redistributing workload from "${resource}"`,
            'Add additional resources for activities: ' + workload.activities.join(', '),
            'Implement workload balancing',
          ],
          metrics: {
            caseCount: workload.caseCount,
            activityCount: workload.activities.length,
            loadRatio: workload.caseCount / avgWorkload,
          },
        })
      }
    }

    return bottlenecks
  }

  /**
   * Detect rework loops in the process
   */
  private detectReworkLoops(): Bottleneck[] {
    if (!this.model) return []

    const bottlenecks: Bottleneck[] = []
    const cases = this.discovery.getCases()

    // Track activity repetitions within cases
    const activityRepetitions = new Map<string, { repeatedCases: number; totalRepeats: number }>()

    for (const processCase of cases) {
      const activityCounts = new Map<string, number>()

      for (const event of processCase.events) {
        const count = activityCounts.get(event.activity) || 0
        activityCounts.set(event.activity, count + 1)
      }

      // Check for repeated activities
      for (const [activity, count] of activityCounts) {
        if (count > 1) {
          if (!activityRepetitions.has(activity)) {
            activityRepetitions.set(activity, { repeatedCases: 0, totalRepeats: 0 })
          }
          const stats = activityRepetitions.get(activity)!
          stats.repeatedCases++
          stats.totalRepeats += count - 1
        }
      }
    }

    // Identify significant rework
    for (const [activity, stats] of activityRepetitions) {
      const reworkRate = (stats.repeatedCases / cases.length) * 100
      if (reworkRate > 10 && stats.repeatedCases > 5) {
        const severity = Math.min(100, Math.floor(reworkRate))

        bottlenecks.push({
          type: 'rework_loop',
          location: activity,
          severity,
          description: `Activity "${activity}" is repeated in ${stats.repeatedCases} cases (${reworkRate.toFixed(1)}% rework rate)`,
          affectedCases: stats.repeatedCases,
          timeImpact: 0, // Would need activity duration to calculate
          recommendations: [
            `Investigate root cause of rework at "${activity}"`,
            'Implement quality checks before this activity',
            'Consider process redesign to reduce loops',
          ],
          metrics: {
            repeatedCases: stats.repeatedCases,
            totalRepeats: stats.totalRepeats,
            reworkRate,
          },
        })
      }
    }

    return bottlenecks
  }

  /**
   * Detect process variant divergence points
   */
  private detectVariantDivergence(): Bottleneck[] {
    if (!this.model) return []

    const bottlenecks: Bottleneck[] = []
    const variants = this.discovery.getVariants()

    if (variants.length < 2) return bottlenecks

    // Find common prefix and where divergence happens
    const variantPaths = variants.map(v => v.activities)
    const divergencePoints = new Map<string, { nextActivities: Map<string, number>; totalCases: number }>()

    for (let i = 0; i < variants.length; i++) {
      const path = variantPaths[i]!
      const frequency = variants[i]!.frequency

      for (let j = 0; j < path.length - 1; j++) {
        const activity = path[j]!
        const nextActivity = path[j + 1]!

        if (!divergencePoints.has(activity)) {
          divergencePoints.set(activity, { nextActivities: new Map(), totalCases: 0 })
        }

        const point = divergencePoints.get(activity)!
        const nextCount = point.nextActivities.get(nextActivity) || 0
        point.nextActivities.set(nextActivity, nextCount + frequency)
        point.totalCases += frequency
      }
    }

    // Find activities with multiple next activities (divergence points)
    for (const [activity, point] of divergencePoints) {
      if (point.nextActivities.size > 1) {
        const totalCases = Array.from(point.nextActivities.values()).reduce((a, b) => a + b, 0)
        const mainPath = Array.from(point.nextActivities.entries())
          .sort((a, b) => b[1] - a[1])[0]
        const mainPathFrequency = mainPath ? mainPath[1] : 0
        const divergenceRate = ((totalCases - mainPathFrequency) / totalCases) * 100

        if (divergenceRate > 20 && totalCases > 10) {
          const severity = Math.min(100, Math.floor(divergenceRate / 2))

          const nextPaths = Array.from(point.nextActivities.entries())
            .map(([next, count]) => `${next} (${count})`)
            .join(', ')

          bottlenecks.push({
            type: 'variant_divergence',
            location: activity,
            severity,
            description: `Process diverges at "${activity}" with ${point.nextActivities.size} different paths: ${nextPaths}`,
            affectedCases: totalCases,
            timeImpact: 0,
            recommendations: [
              `Investigate why process diverges at "${activity}"`,
              'Consider standardizing the process flow',
              'Document decision criteria for path selection',
            ],
            metrics: {
              pathCount: point.nextActivities.size,
              divergenceRate,
              totalCases,
            },
          })
        }
      }
    }

    return bottlenecks
  }

  /**
   * Calculate overall process health score
   */
  private calculateHealthScore(bottlenecks: Bottleneck[]): number {
    if (bottlenecks.length === 0) return 100

    // Weight by severity
    const totalSeverity = bottlenecks.reduce((sum, b) => sum + b.severity, 0)
    const avgSeverity = totalSeverity / bottlenecks.length

    // More bottlenecks = lower score
    const bottleneckPenalty = Math.min(30, bottlenecks.length * 5)

    return Math.max(0, 100 - avgSeverity - bottleneckPenalty)
  }

  /**
   * Get activities with highest wait times
   */
  private getHighWaitActivities(): Array<{ activity: string; avgWaitTime: number }> {
    if (!this.model) return []

    const activityWaitTimes = new Map<string, { total: number; count: number }>()

    for (const transition of this.model.transitions) {
      if (!activityWaitTimes.has(transition.to)) {
        activityWaitTimes.set(transition.to, { total: 0, count: 0 })
      }
      const stats = activityWaitTimes.get(transition.to)!
      stats.total += transition.avgDuration * transition.frequency
      stats.count += transition.frequency
    }

    return Array.from(activityWaitTimes.entries())
      .map(([activity, stats]) => ({
        activity,
        avgWaitTime: stats.count > 0 ? stats.total / stats.count : 0,
      }))
      .sort((a, b) => b.avgWaitTime - a.avgWaitTime)
      .slice(0, 10)
  }

  /**
   * Get overloaded resources
   */
  private getOverloadedResources(): Array<{ resource: string; caseCount: number; avgLoad: number }> {
    if (!this.model) return []

    const resourceCounts = new Map<string, number>()

    for (const activity of this.model.activities.values()) {
      for (const [resource, count] of activity.resources) {
        const current = resourceCounts.get(resource) || 0
        resourceCounts.set(resource, current + count)
      }
    }

    const totalEvents = Array.from(resourceCounts.values()).reduce((a, b) => a + b, 0)
    const avgLoad = resourceCounts.size > 0 ? totalEvents / resourceCounts.size : 0

    return Array.from(resourceCounts.entries())
      .map(([resource, caseCount]) => ({
        resource,
        caseCount,
        avgLoad: avgLoad > 0 ? caseCount / avgLoad : 0,
      }))
      .sort((a, b) => b.caseCount - a.caseCount)
      .slice(0, 10)
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
    if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`
    return `${(ms / 86400000).toFixed(1)}d`
  }
}

/**
 * Factory function to create a BottleneckAnalyzer
 */
export function createBottleneckAnalyzer(discovery: ProcessDiscovery): BottleneckAnalyzer {
  return new BottleneckAnalyzer(discovery)
}

// ============================================================================
// Compliance Checking
// ============================================================================

/**
 * ComplianceChecker - Checks process conformance against rules
 *
 * Verifies that actual process execution conforms to defined rules:
 * - Sequence rules (A must precede B)
 * - Existence rules (activity must occur)
 * - Absence rules (activity must not occur)
 * - Timing rules (max duration constraints)
 * - Resource rules (who can perform what)
 */
export class ComplianceChecker {
  private rules: ComplianceRule[] = []
  private discovery: ProcessDiscovery

  constructor(discovery: ProcessDiscovery) {
    this.discovery = discovery
  }

  /**
   * Add a compliance rule
   */
  addRule(rule: ComplianceRule): this {
    this.rules.push(rule)
    return this
  }

  /**
   * Add multiple rules
   */
  addRules(rules: ComplianceRule[]): this {
    this.rules.push(...rules)
    return this
  }

  /**
   * Clear all rules
   */
  clearRules(): this {
    this.rules = []
    return this
  }

  /**
   * Check compliance against all rules
   */
  check(): ComplianceResult {
    const cases = this.discovery.getCases()
    const violations: ComplianceViolation[] = []
    const violationsByRule = new Map<string, ComplianceViolation[]>()
    const compliantCaseIds = new Set(cases.map(c => c.caseId))

    // Initialize violation tracking for each rule
    for (const rule of this.rules) {
      violationsByRule.set(rule.id, [])
    }

    // Check each case against each rule
    for (const processCase of cases) {
      for (const rule of this.rules) {
        const violation = this.checkRule(rule, processCase)
        if (violation) {
          violations.push(violation)
          violationsByRule.get(rule.id)!.push(violation)
          compliantCaseIds.delete(processCase.caseId)
        }
      }
    }

    const compliantCases = compliantCaseIds.size
    const nonCompliantCases = cases.length - compliantCases
    const complianceRate = cases.length > 0 ? (compliantCases / cases.length) * 100 : 100

    return {
      complianceRate,
      compliantCases,
      nonCompliantCases,
      totalViolations: violations.length,
      violationsByRule,
      violations,
      rulesChecked: this.rules,
    }
  }

  /**
   * Check a single rule against a case
   */
  private checkRule(rule: ComplianceRule, processCase: ProcessCase): ComplianceViolation | null {
    const definition = rule.definition

    switch (definition.type) {
      case 'sequence':
        return this.checkSequenceRule(rule, definition, processCase)
      case 'existence':
        return this.checkExistenceRule(rule, definition, processCase)
      case 'absence':
        return this.checkAbsenceRule(rule, definition, processCase)
      case 'timing':
        return this.checkTimingRule(rule, definition, processCase)
      case 'resource':
        return this.checkResourceRule(rule, definition, processCase)
      default:
        return null
    }
  }

  /**
   * Check sequence rule: A must be followed by B
   */
  private checkSequenceRule(
    rule: ComplianceRule,
    definition: SequenceRule,
    processCase: ProcessCase
  ): ComplianceViolation | null {
    const activities = processCase.events.map(e => e.activity)
    const predIndex = activities.indexOf(definition.predecessor)

    // If predecessor doesn't exist, rule doesn't apply
    if (predIndex === -1) return null

    // Find successor after predecessor
    const remainingActivities = activities.slice(predIndex + 1)

    if (definition.direct) {
      // Must be immediately after
      if (remainingActivities[0] !== definition.successor) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          caseId: processCase.caseId,
          description: `"${definition.successor}" must immediately follow "${definition.predecessor}"`,
          details: {
            predecessor: definition.predecessor,
            successor: definition.successor,
            actualNext: remainingActivities[0] || 'none',
          },
        }
      }
    } else {
      // Must appear somewhere after
      if (!remainingActivities.includes(definition.successor)) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          caseId: processCase.caseId,
          description: `"${definition.successor}" must follow "${definition.predecessor}"`,
          details: {
            predecessor: definition.predecessor,
            successor: definition.successor,
            activitiesAfter: remainingActivities,
          },
        }
      }
    }

    return null
  }

  /**
   * Check existence rule: Activity must occur
   */
  private checkExistenceRule(
    rule: ComplianceRule,
    definition: ExistenceRule,
    processCase: ProcessCase
  ): ComplianceViolation | null {
    const activities = processCase.events.map(e => e.activity)
    const occurrences = activities.filter(a => a === definition.activity).length

    const minOccurrences = definition.minOccurrences ?? 1
    const maxOccurrences = definition.maxOccurrences ?? Infinity

    if (occurrences < minOccurrences) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        caseId: processCase.caseId,
        description: `"${definition.activity}" must occur at least ${minOccurrences} time(s), found ${occurrences}`,
        details: {
          activity: definition.activity,
          required: minOccurrences,
          actual: occurrences,
        },
      }
    }

    if (occurrences > maxOccurrences) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        caseId: processCase.caseId,
        description: `"${definition.activity}" must occur at most ${maxOccurrences} time(s), found ${occurrences}`,
        details: {
          activity: definition.activity,
          maxAllowed: maxOccurrences,
          actual: occurrences,
        },
      }
    }

    return null
  }

  /**
   * Check absence rule: Activity must not occur
   */
  private checkAbsenceRule(
    rule: ComplianceRule,
    definition: AbsenceRule,
    processCase: ProcessCase
  ): ComplianceViolation | null {
    const activities = processCase.events.map(e => e.activity)

    if (activities.includes(definition.activity)) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        caseId: processCase.caseId,
        description: `"${definition.activity}" must not occur in the process`,
        details: {
          activity: definition.activity,
          occurrences: activities.filter(a => a === definition.activity).length,
        },
      }
    }

    return null
  }

  /**
   * Check timing rule: Max duration constraint
   */
  private checkTimingRule(
    rule: ComplianceRule,
    definition: TimingRule,
    processCase: ProcessCase
  ): ComplianceViolation | null {
    let fromTime: number
    let toTime: number

    if (definition.from === 'start') {
      fromTime = processCase.startTime
    } else {
      const fromEvent = processCase.events.find(e => e.activity === definition.from)
      if (!fromEvent) return null // From activity doesn't exist
      fromTime = fromEvent.timestamp
    }

    if (definition.to === 'end') {
      toTime = processCase.endTime
    } else {
      const toEvent = processCase.events.find(e => e.activity === definition.to)
      if (!toEvent) return null // To activity doesn't exist
      toTime = toEvent.timestamp
    }

    const duration = toTime - fromTime

    if (duration > definition.maxDuration) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        caseId: processCase.caseId,
        description: `Duration from "${definition.from}" to "${definition.to}" exceeds limit (${this.formatDuration(duration)} > ${this.formatDuration(definition.maxDuration)})`,
        details: {
          from: definition.from,
          to: definition.to,
          actualDuration: duration,
          maxDuration: definition.maxDuration,
          excessDuration: duration - definition.maxDuration,
        },
      }
    }

    return null
  }

  /**
   * Check resource rule: Activity must be performed by allowed resource
   */
  private checkResourceRule(
    rule: ComplianceRule,
    definition: ResourceRule,
    processCase: ProcessCase
  ): ComplianceViolation | null {
    for (const event of processCase.events) {
      if (event.activity === definition.activity && event.resource) {
        if (!definition.allowedResources.includes(event.resource)) {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            caseId: processCase.caseId,
            description: `"${definition.activity}" was performed by "${event.resource}" who is not authorized`,
            details: {
              activity: definition.activity,
              actualResource: event.resource,
              allowedResources: definition.allowedResources,
            },
          }
        }
      }
    }

    return null
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
    if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`
    return `${(ms / 86400000).toFixed(1)}d`
  }
}

/**
 * Factory function to create a ComplianceChecker
 */
export function createComplianceChecker(discovery: ProcessDiscovery): ComplianceChecker {
  return new ComplianceChecker(discovery)
}

// ============================================================================
// Performance Metrics
// ============================================================================

/**
 * PerformanceAnalyzer - Calculates process performance metrics
 *
 * Computes:
 * - Cycle time statistics
 * - Throughput
 * - Wait time analysis
 * - Activity-level metrics
 * - Time series for trend analysis
 */
export class PerformanceAnalyzer {
  private discovery: ProcessDiscovery
  private throughputUnit: string = 'cases/day'

  constructor(discovery: ProcessDiscovery) {
    this.discovery = discovery
  }

  /**
   * Set the throughput unit for calculations
   */
  setThroughputUnit(unit: string): this {
    this.throughputUnit = unit
    return this
  }

  /**
   * Analyze process performance
   */
  analyze(): ProcessPerformanceMetrics {
    const cases = this.discovery.getCases()
    const model = this.discovery.discover()

    if (cases.length === 0) {
      return this.emptyMetrics()
    }

    // Calculate cycle times
    const cycleTimes = cases.map(c => c.duration).sort((a, b) => a - b)
    const completeCases = cases.filter(c => c.isComplete)

    // Calculate throughput
    const throughput = this.calculateThroughput(cases)

    // Calculate wait and processing times
    const { avgWaitTime, avgProcessingTime } = this.calculateTimeSplit(cases, model)
    const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length

    // Calculate activity metrics
    const activityMetrics = this.calculateActivityMetrics(cases, model)

    return {
      totalCases: cases.length,
      completeCases: completeCases.length,
      completionRate: (completeCases.length / cases.length) * 100,

      avgCycleTime,
      medianCycleTime: this.median(cycleTimes),
      minCycleTime: cycleTimes[0] || 0,
      maxCycleTime: cycleTimes[cycleTimes.length - 1] || 0,
      p95CycleTime: this.percentile(cycleTimes, 95),

      throughput,
      throughputUnit: this.throughputUnit,

      avgWaitTime,
      waitTimePercentage: avgCycleTime > 0 ? (avgWaitTime / avgCycleTime) * 100 : 0,

      avgProcessingTime,
      processingTimePercentage: avgCycleTime > 0 ? (avgProcessingTime / avgCycleTime) * 100 : 0,

      activityMetrics,
    }
  }

  /**
   * Analyze with time series data for trend analysis
   */
  analyzeWithTimeSeries(granularity: 'day' | 'week' | 'month' = 'day'): ProcessPerformanceMetrics {
    const metrics = this.analyze()
    const cases = this.discovery.getCases()

    if (cases.length === 0) {
      return metrics
    }

    // Group cases by period
    const casesByPeriod = new Map<number, ProcessCase[]>()

    for (const processCase of cases) {
      const periodStart = this.getPeriodStart(processCase.startTime, granularity)
      if (!casesByPeriod.has(periodStart)) {
        casesByPeriod.set(periodStart, [])
      }
      casesByPeriod.get(periodStart)!.push(processCase)
    }

    // Calculate metrics for each period
    const timeSeriesMetrics: TimeSeriesMetrics[] = []
    const sortedPeriods = Array.from(casesByPeriod.keys()).sort((a, b) => a - b)

    for (const periodStart of sortedPeriods) {
      const periodCases = casesByPeriod.get(periodStart)!
      const periodEnd = this.getPeriodEnd(periodStart, granularity)

      const casesStarted = periodCases.length
      const casesCompleted = periodCases.filter(c => c.endTime < periodEnd).length

      const cycleTimes = periodCases.map(c => c.duration)
      const avgCycleTime = cycleTimes.length > 0
        ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
        : 0

      const periodDuration = periodEnd - periodStart
      const throughput = casesCompleted / (periodDuration / (24 * 60 * 60 * 1000))

      timeSeriesMetrics.push({
        periodStart,
        periodEnd,
        casesStarted,
        casesCompleted,
        avgCycleTime,
        throughput,
      })
    }

    metrics.timeSeriesMetrics = timeSeriesMetrics
    return metrics
  }

  /**
   * Calculate throughput
   */
  private calculateThroughput(cases: ProcessCase[]): number {
    if (cases.length < 2) return 0

    const minStart = Math.min(...cases.map(c => c.startTime))
    const maxEnd = Math.max(...cases.map(c => c.endTime))
    const totalDuration = maxEnd - minStart

    // Convert to cases per day
    const daysElapsed = totalDuration / (24 * 60 * 60 * 1000)
    return daysElapsed > 0 ? cases.length / daysElapsed : 0
  }

  /**
   * Calculate wait vs processing time split
   */
  private calculateTimeSplit(
    cases: ProcessCase[],
    model: ProcessModel
  ): { avgWaitTime: number; avgProcessingTime: number } {
    let totalWaitTime = 0
    let totalProcessingTime = 0
    let count = 0

    for (const processCase of cases) {
      for (let i = 0; i < processCase.events.length - 1; i++) {
        const current = processCase.events[i]!
        const next = processCase.events[i + 1]!
        const transitionTime = next.timestamp - current.timestamp

        // For simplicity, assume all transition time is wait time
        // In a more sophisticated implementation, we'd track start/complete events
        totalWaitTime += transitionTime
        count++
      }
    }

    // Processing time = cycle time - wait time
    const avgCycleTime = cases.length > 0
      ? cases.reduce((sum, c) => sum + c.duration, 0) / cases.length
      : 0
    const avgWaitTime = count > 0 ? totalWaitTime / cases.length : 0
    const avgProcessingTime = Math.max(0, avgCycleTime - avgWaitTime)

    return { avgWaitTime, avgProcessingTime }
  }

  /**
   * Calculate activity-level metrics
   */
  private calculateActivityMetrics(
    cases: ProcessCase[],
    model: ProcessModel
  ): Map<string, ActivityMetrics> {
    const metrics = new Map<string, ActivityMetrics>()

    // Initialize metrics for all activities
    for (const [name, activity] of model.activities) {
      metrics.set(name, {
        activity: name,
        frequency: activity.frequency,
        avgWaitTime: 0,
        avgProcessingTime: 0,
        avgTimeToNext: 0,
        resourceFrequency: new Map(activity.resources),
      })
    }

    // Calculate wait times and time to next
    const waitTimes = new Map<string, number[]>()
    const timesToNext = new Map<string, number[]>()

    for (const processCase of cases) {
      for (let i = 0; i < processCase.events.length; i++) {
        const event = processCase.events[i]!

        // Wait time (time from previous event to this one)
        if (i > 0) {
          const prevEvent = processCase.events[i - 1]!
          const waitTime = event.timestamp - prevEvent.timestamp

          if (!waitTimes.has(event.activity)) {
            waitTimes.set(event.activity, [])
          }
          waitTimes.get(event.activity)!.push(waitTime)
        }

        // Time to next
        if (i < processCase.events.length - 1) {
          const nextEvent = processCase.events[i + 1]!
          const timeToNext = nextEvent.timestamp - event.timestamp

          if (!timesToNext.has(event.activity)) {
            timesToNext.set(event.activity, [])
          }
          timesToNext.get(event.activity)!.push(timeToNext)
        }
      }
    }

    // Update metrics with calculated values
    for (const [activity, activityMetrics] of metrics) {
      const waits = waitTimes.get(activity) || []
      const nexts = timesToNext.get(activity) || []

      if (waits.length > 0) {
        activityMetrics.avgWaitTime = waits.reduce((a, b) => a + b, 0) / waits.length
      }

      if (nexts.length > 0) {
        activityMetrics.avgTimeToNext = nexts.reduce((a, b) => a + b, 0) / nexts.length
      }
    }

    return metrics
  }

  /**
   * Get period start based on granularity
   */
  private getPeriodStart(timestamp: number, granularity: 'day' | 'week' | 'month'): number {
    const date = new Date(timestamp)

    switch (granularity) {
      case 'day':
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      case 'week': {
        const dayOfWeek = date.getUTCDay()
        const diff = (dayOfWeek + 6) % 7
        return Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() - diff
        )
      }
      case 'month':
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    }
  }

  /**
   * Get period end based on granularity
   */
  private getPeriodEnd(periodStart: number, granularity: 'day' | 'week' | 'month'): number {
    const date = new Date(periodStart)

    switch (granularity) {
      case 'day':
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
      case 'week':
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7)
      case 'month':
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    }
  }

  /**
   * Calculate median
   */
  private median(sortedValues: number[]): number {
    if (sortedValues.length === 0) return 0
    const mid = Math.floor(sortedValues.length / 2)
    return sortedValues.length % 2 !== 0
      ? sortedValues[mid]!
      : (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0
    const index = Math.ceil((p / 100) * sortedValues.length) - 1
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))]!
  }

  /**
   * Return empty metrics structure
   */
  private emptyMetrics(): ProcessPerformanceMetrics {
    return {
      totalCases: 0,
      completeCases: 0,
      completionRate: 0,
      avgCycleTime: 0,
      medianCycleTime: 0,
      minCycleTime: 0,
      maxCycleTime: 0,
      p95CycleTime: 0,
      throughput: 0,
      throughputUnit: this.throughputUnit,
      avgWaitTime: 0,
      waitTimePercentage: 0,
      avgProcessingTime: 0,
      processingTimePercentage: 0,
      activityMetrics: new Map(),
    }
  }
}

/**
 * Factory function to create a PerformanceAnalyzer
 */
export function createPerformanceAnalyzer(discovery: ProcessDiscovery): PerformanceAnalyzer {
  return new PerformanceAnalyzer(discovery)
}

// ============================================================================
// Fluent Builder API
// ============================================================================

/**
 * ProcessMiningBuilder - Fluent API for process mining queries
 */
export class ProcessMiningBuilder {
  private events: ProcessEvent[] = []
  private discovery: ProcessDiscovery | null = null
  private complianceRules: ComplianceRule[] = []

  /**
   * Load events into the builder
   */
  from(events: ProcessEvent[]): this {
    this.events = events
    this.discovery = createProcessDiscovery(events)
    return this
  }

  /**
   * Discover the process model
   */
  discoverModel(): ProcessModel {
    this.ensureDiscovery()
    return this.discovery!.discover()
  }

  /**
   * Get process variants
   */
  variants(): ProcessVariant[] {
    this.ensureDiscovery()
    return this.discovery!.getVariants()
  }

  /**
   * Analyze bottlenecks
   */
  bottlenecks(): BottleneckAnalysisResult {
    this.ensureDiscovery()
    return createBottleneckAnalyzer(this.discovery!).analyze()
  }

  /**
   * Add a compliance rule
   */
  rule(rule: ComplianceRule): this {
    this.complianceRules.push(rule)
    return this
  }

  /**
   * Add a sequence rule
   */
  mustFollow(predecessor: string, successor: string, direct?: boolean): this {
    this.complianceRules.push({
      id: `seq_${predecessor}_${successor}`,
      name: `${predecessor} must be followed by ${successor}`,
      description: direct
        ? `"${successor}" must immediately follow "${predecessor}"`
        : `"${successor}" must follow "${predecessor}"`,
      type: 'sequence',
      definition: { type: 'sequence', predecessor, successor, direct },
    })
    return this
  }

  /**
   * Add an existence rule
   */
  mustExist(activity: string, minOccurrences?: number, maxOccurrences?: number): this {
    this.complianceRules.push({
      id: `exist_${activity}`,
      name: `${activity} must exist`,
      description: `"${activity}" must occur in every case`,
      type: 'existence',
      definition: { type: 'existence', activity, minOccurrences, maxOccurrences },
    })
    return this
  }

  /**
   * Add an absence rule
   */
  mustNotExist(activity: string): this {
    this.complianceRules.push({
      id: `absent_${activity}`,
      name: `${activity} must not exist`,
      description: `"${activity}" must not occur`,
      type: 'absence',
      definition: { type: 'absence', activity },
    })
    return this
  }

  /**
   * Add a timing rule
   */
  maxDuration(from: string | 'start', to: string | 'end', maxDurationMs: number): this {
    this.complianceRules.push({
      id: `timing_${from}_${to}`,
      name: `Max duration from ${from} to ${to}`,
      description: `Duration from "${from}" to "${to}" must not exceed ${maxDurationMs}ms`,
      type: 'timing',
      definition: { type: 'timing', from, to, maxDuration: maxDurationMs },
    })
    return this
  }

  /**
   * Add a resource rule
   */
  onlyByResources(activity: string, allowedResources: string[]): this {
    this.complianceRules.push({
      id: `resource_${activity}`,
      name: `${activity} resource restriction`,
      description: `"${activity}" can only be performed by: ${allowedResources.join(', ')}`,
      type: 'resource',
      definition: { type: 'resource', activity, allowedResources },
    })
    return this
  }

  /**
   * Check compliance against all added rules
   */
  checkCompliance(): ComplianceResult {
    this.ensureDiscovery()
    const checker = createComplianceChecker(this.discovery!)
    checker.addRules(this.complianceRules)
    return checker.check()
  }

  /**
   * Calculate performance metrics
   */
  performance(): ProcessPerformanceMetrics {
    this.ensureDiscovery()
    return createPerformanceAnalyzer(this.discovery!).analyze()
  }

  /**
   * Calculate performance metrics with time series
   */
  performanceWithTrends(
    granularity: 'day' | 'week' | 'month' = 'day'
  ): ProcessPerformanceMetrics {
    this.ensureDiscovery()
    return createPerformanceAnalyzer(this.discovery!).analyzeWithTimeSeries(granularity)
  }

  /**
   * Get the underlying discovery instance
   */
  getDiscovery(): ProcessDiscovery {
    this.ensureDiscovery()
    return this.discovery!
  }

  /**
   * Ensure discovery is initialized
   */
  private ensureDiscovery(): void {
    if (!this.discovery) {
      throw new Error('No events loaded. Call .from(events) first.')
    }
  }
}

/**
 * Factory function to create a ProcessMiningBuilder
 */
export function processMining(): ProcessMiningBuilder {
  return new ProcessMiningBuilder()
}

// ============================================================================
// Convenience Rule Builders
// ============================================================================

/**
 * Create a sequence rule
 */
export function sequenceRule(
  id: string,
  predecessor: string,
  successor: string,
  direct?: boolean
): ComplianceRule {
  return {
    id,
    name: `${predecessor} -> ${successor}`,
    description: direct
      ? `"${successor}" must immediately follow "${predecessor}"`
      : `"${successor}" must eventually follow "${predecessor}"`,
    type: 'sequence',
    definition: { type: 'sequence', predecessor, successor, direct },
  }
}

/**
 * Create an existence rule
 */
export function existenceRule(
  id: string,
  activity: string,
  minOccurrences?: number,
  maxOccurrences?: number
): ComplianceRule {
  return {
    id,
    name: `${activity} must exist`,
    description: `"${activity}" must occur`,
    type: 'existence',
    definition: { type: 'existence', activity, minOccurrences, maxOccurrences },
  }
}

/**
 * Create an absence rule
 */
export function absenceRule(id: string, activity: string): ComplianceRule {
  return {
    id,
    name: `${activity} must not exist`,
    description: `"${activity}" must not occur`,
    type: 'absence',
    definition: { type: 'absence', activity },
  }
}

/**
 * Create a timing rule
 */
export function timingRule(
  id: string,
  from: string | 'start',
  to: string | 'end',
  maxDuration: number
): ComplianceRule {
  return {
    id,
    name: `Max duration ${from} to ${to}`,
    description: `Duration must not exceed ${maxDuration}ms`,
    type: 'timing',
    definition: { type: 'timing', from, to, maxDuration },
  }
}

/**
 * Create a resource rule
 */
export function resourceRule(
  id: string,
  activity: string,
  allowedResources: string[]
): ComplianceRule {
  return {
    id,
    name: `${activity} resource restriction`,
    description: `Only specific resources can perform "${activity}"`,
    type: 'resource',
    definition: { type: 'resource', activity, allowedResources },
  }
}
