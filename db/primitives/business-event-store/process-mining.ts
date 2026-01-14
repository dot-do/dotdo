/**
 * Process Mining - Business process analysis from event logs
 *
 * Provides process mining capabilities for business events:
 * - Process discovery from event logs
 * - Conformance checking against process models
 * - Bottleneck detection
 * - Variant analysis (different paths through process)
 * - Performance metrics (cycle time, wait time, throughput)
 *
 * Uses the 5W+H dimensions to analyze business processes:
 * - Case ID: from correlationId or what[0]
 * - Activity: from why (business step) or action
 * - Timestamp: from when
 * - Resource: from who (actor)
 *
 * @module db/primitives/business-event-store/process-mining
 */

import type { BusinessEvent, EventQuery, QueryOptions } from './index'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Mapping configuration for extracting process mining fields from events
 */
export interface ProcessMiningFieldMapping {
  /** Field to use as case ID (default: correlationId or what[0]) */
  caseIdField?: string | ((event: BusinessEvent) => string)
  /** Field to use as activity (default: why) */
  activityField?: string | ((event: BusinessEvent) => string)
  /** Field to use as timestamp (default: when) */
  timestampField?: string | ((event: BusinessEvent) => Date)
  /** Field to use as resource (default: who) */
  resourceField?: string | ((event: BusinessEvent) => string | undefined)
}

/**
 * A single activity instance in a process trace
 */
export interface ActivityInstance {
  /** Unique identifier for this instance */
  id: string
  /** Case ID this activity belongs to */
  caseId: string
  /** Activity name */
  activity: string
  /** Start timestamp */
  startTime: Date
  /** End timestamp (for activity duration) */
  endTime?: Date
  /** Resource that performed this activity */
  resource?: string
  /** Original event */
  event: BusinessEvent
}

/**
 * A complete trace (sequence of activities for a case)
 */
export interface ProcessTrace {
  /** Case identifier */
  caseId: string
  /** Ordered sequence of activities */
  activities: ActivityInstance[]
  /** First activity timestamp */
  startTime: Date
  /** Last activity timestamp */
  endTime: Date
  /** Total duration in milliseconds */
  duration: number
  /** Trace as activity string sequence */
  variant: string
}

/**
 * Transition between two activities
 */
export interface ActivityTransition {
  /** Source activity */
  from: string
  /** Target activity */
  to: string
  /** Number of times this transition occurred */
  count: number
  /** Transition durations in milliseconds */
  durations: number[]
  /** Average transition time */
  avgDuration: number
  /** Min transition time */
  minDuration: number
  /** Max transition time */
  maxDuration: number
}

/**
 * Discovered process model
 */
export interface ProcessModel {
  /** All unique activities discovered */
  activities: string[]
  /** Start activities (first in traces) */
  startActivities: Map<string, number>
  /** End activities (last in traces) */
  endActivities: Map<string, number>
  /** All transitions between activities */
  transitions: Map<string, ActivityTransition>
  /** Activity frequencies */
  activityFrequencies: Map<string, number>
  /** Total number of traces analyzed */
  traceCount: number
  /** Total number of events analyzed */
  eventCount: number
}

/**
 * Process variant (unique path through process)
 */
export interface ProcessVariant {
  /** Variant identifier (activity sequence as string) */
  variant: string
  /** Activity sequence */
  activities: string[]
  /** Number of cases following this variant */
  count: number
  /** Percentage of total cases */
  percentage: number
  /** Average duration for cases with this variant */
  avgDuration: number
  /** Min duration */
  minDuration: number
  /** Max duration */
  maxDuration: number
  /** Case IDs following this variant */
  caseIds: string[]
}

/**
 * Conformance checking deviation
 */
export interface ConformanceDeviation {
  /** Case ID where deviation occurred */
  caseId: string
  /** Type of deviation */
  type: 'missing_activity' | 'unexpected_activity' | 'wrong_order' | 'invalid_transition'
  /** Expected activity/behavior */
  expected?: string
  /** Actual activity/behavior */
  actual?: string
  /** Position in trace where deviation occurred */
  position: number
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Conformance checking result
 */
export interface ConformanceResult {
  /** Fitness score (0-1, how many traces conform) */
  fitness: number
  /** Number of conforming traces */
  conformingTraces: number
  /** Total traces checked */
  totalTraces: number
  /** All deviations found */
  deviations: ConformanceDeviation[]
  /** Deviations grouped by type */
  deviationsByType: Map<string, ConformanceDeviation[]>
}

/**
 * Expected process model for conformance checking
 */
export interface ExpectedProcessModel {
  /** Required start activities */
  startActivities?: string[]
  /** Required end activities */
  endActivities?: string[]
  /** Allowed transitions (if empty, all discovered transitions are allowed) */
  allowedTransitions?: Array<{ from: string; to: string }>
  /** Required activities (must appear in trace) */
  requiredActivities?: string[]
  /** Forbidden activities (must not appear) */
  forbiddenActivities?: string[]
  /** Activity ordering constraints */
  orderingConstraints?: Array<{ before: string; after: string }>
}

/**
 * Bottleneck information
 */
export interface Bottleneck {
  /** Activity or transition with bottleneck */
  location: string
  /** Type of bottleneck */
  type: 'activity' | 'transition'
  /** Average time spent */
  avgTime: number
  /** Median time spent */
  medianTime: number
  /** Min time spent */
  minTime: number
  /** 95th percentile time */
  p95Time: number
  /** Max time */
  maxTime: number
  /** Number of occurrences */
  count: number
  /** Severity score (normalized 0-1) */
  severity: number
  /** Potential impact (time saved if optimized) */
  potentialSavings: number
}

/**
 * Performance metrics for a process
 */
export interface ProcessPerformanceMetrics {
  /** Average cycle time (case start to end) */
  avgCycleTime: number
  /** Median cycle time */
  medianCycleTime: number
  /** Min cycle time */
  minCycleTime: number
  /** Max cycle time */
  maxCycleTime: number
  /** 95th percentile cycle time */
  p95CycleTime: number
  /** Throughput (cases per time period) */
  throughput: {
    casesPerHour: number
    casesPerDay: number
  }
  /** Total cases analyzed */
  totalCases: number
  /** Activity-level performance */
  activityPerformance: Map<string, ActivityPerformance>
  /** Transition-level performance */
  transitionPerformance: Map<string, TransitionPerformance>
}

/**
 * Performance metrics for a single activity
 */
export interface ActivityPerformance {
  /** Activity name */
  activity: string
  /** Count of executions */
  count: number
  /** Average wait time (from previous activity end to this start) */
  avgWaitTime: number
  /** Average service time (activity duration) */
  avgServiceTime?: number
  /** Resource utilization */
  resourceUtilization?: Map<string, number>
}

/**
 * Performance metrics for a transition
 */
export interface TransitionPerformance {
  /** From activity */
  from: string
  /** To activity */
  to: string
  /** Count of transitions */
  count: number
  /** Average transition time */
  avgTime: number
  /** Median transition time */
  medianTime: number
  /** Min transition time */
  minTime: number
  /** Max transition time */
  maxTime: number
}

/**
 * Options for process mining analysis
 */
export interface ProcessMiningOptions {
  /** Field mapping configuration */
  fieldMapping?: ProcessMiningFieldMapping
  /** Filter for cases (by start/end time) */
  timeRange?: {
    start?: Date
    end?: Date
  }
  /** Filter cases by specific IDs */
  caseIds?: string[]
  /** Filter by activities */
  activities?: string[]
  /** Min trace length to consider */
  minTraceLength?: number
  /** Max trace length to consider */
  maxTraceLength?: number
}

// =============================================================================
// Process Mining Query Engine
// =============================================================================

/**
 * ProcessMiningEngine - Main class for process mining queries
 */
export class ProcessMiningEngine {
  private fieldMapping: ProcessMiningFieldMapping

  constructor(fieldMapping?: ProcessMiningFieldMapping) {
    this.fieldMapping = fieldMapping || {}
  }

  // ===========================================================================
  // Field Extraction
  // ===========================================================================

  /**
   * Extract case ID from an event
   */
  getCaseId(event: BusinessEvent): string {
    if (typeof this.fieldMapping.caseIdField === 'function') {
      return this.fieldMapping.caseIdField(event)
    }
    if (typeof this.fieldMapping.caseIdField === 'string') {
      return this.extractField(event, this.fieldMapping.caseIdField) as string
    }
    // Default: use correlationId or first what element
    return event.correlationId || event.what[0] || event.id
  }

  /**
   * Extract activity name from an event
   */
  getActivity(event: BusinessEvent): string {
    if (typeof this.fieldMapping.activityField === 'function') {
      return this.fieldMapping.activityField(event)
    }
    if (typeof this.fieldMapping.activityField === 'string') {
      return this.extractField(event, this.fieldMapping.activityField) as string
    }
    // Default: use why (business step) or action
    return event.why || event.action || 'unknown'
  }

  /**
   * Extract timestamp from an event
   */
  getTimestamp(event: BusinessEvent): Date {
    if (typeof this.fieldMapping.timestampField === 'function') {
      return this.fieldMapping.timestampField(event)
    }
    if (typeof this.fieldMapping.timestampField === 'string') {
      const value = this.extractField(event, this.fieldMapping.timestampField)
      return value instanceof Date ? value : new Date(value as string | number)
    }
    return event.when
  }

  /**
   * Extract resource from an event
   */
  getResource(event: BusinessEvent): string | undefined {
    if (typeof this.fieldMapping.resourceField === 'function') {
      return this.fieldMapping.resourceField(event)
    }
    if (typeof this.fieldMapping.resourceField === 'string') {
      return this.extractField(event, this.fieldMapping.resourceField) as string | undefined
    }
    return event.who
  }

  // ===========================================================================
  // Trace Extraction
  // ===========================================================================

  /**
   * Extract process traces from events
   */
  extractTraces(events: BusinessEvent[], options?: ProcessMiningOptions): ProcessTrace[] {
    // Group events by case ID
    const caseEvents = new Map<string, BusinessEvent[]>()

    for (const event of events) {
      const caseId = this.getCaseId(event)

      // Apply filters
      if (options?.caseIds && !options.caseIds.includes(caseId)) {
        continue
      }

      const activity = this.getActivity(event)
      if (options?.activities && !options.activities.includes(activity)) {
        continue
      }

      const timestamp = this.getTimestamp(event)
      if (options?.timeRange) {
        if (options.timeRange.start && timestamp < options.timeRange.start) {
          continue
        }
        if (options.timeRange.end && timestamp > options.timeRange.end) {
          continue
        }
      }

      if (!caseEvents.has(caseId)) {
        caseEvents.set(caseId, [])
      }
      caseEvents.get(caseId)!.push(event)
    }

    // Convert to traces
    const traces: ProcessTrace[] = []

    for (const [caseId, caseEventList] of caseEvents) {
      // Sort events by timestamp
      caseEventList.sort((a, b) => this.getTimestamp(a).getTime() - this.getTimestamp(b).getTime())

      // Apply length filters
      if (options?.minTraceLength && caseEventList.length < options.minTraceLength) {
        continue
      }
      if (options?.maxTraceLength && caseEventList.length > options.maxTraceLength) {
        continue
      }

      // Create activity instances
      const activities: ActivityInstance[] = caseEventList.map((event, idx) => ({
        id: `${caseId}-${idx}`,
        caseId,
        activity: this.getActivity(event),
        startTime: this.getTimestamp(event),
        resource: this.getResource(event),
        event,
      }))

      const startTime = activities[0].startTime
      const endTime = activities[activities.length - 1].startTime
      const duration = endTime.getTime() - startTime.getTime()

      // Create variant string
      const variant = activities.map((a) => a.activity).join(' -> ')

      traces.push({
        caseId,
        activities,
        startTime,
        endTime,
        duration,
        variant,
      })
    }

    return traces
  }

  // ===========================================================================
  // Process Discovery
  // ===========================================================================

  /**
   * Discover process model from event logs
   */
  discoverProcess(events: BusinessEvent[], options?: ProcessMiningOptions): ProcessModel {
    const traces = this.extractTraces(events, options)

    const model: ProcessModel = {
      activities: [],
      startActivities: new Map(),
      endActivities: new Map(),
      transitions: new Map(),
      activityFrequencies: new Map(),
      traceCount: traces.length,
      eventCount: events.length,
    }

    const activitySet = new Set<string>()

    for (const trace of traces) {
      const activities = trace.activities

      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i].activity
        activitySet.add(activity)

        // Count activity frequency
        model.activityFrequencies.set(
          activity,
          (model.activityFrequencies.get(activity) || 0) + 1
        )

        // Track start activities
        if (i === 0) {
          model.startActivities.set(
            activity,
            (model.startActivities.get(activity) || 0) + 1
          )
        }

        // Track end activities
        if (i === activities.length - 1) {
          model.endActivities.set(
            activity,
            (model.endActivities.get(activity) || 0) + 1
          )
        }

        // Track transitions
        if (i < activities.length - 1) {
          const nextActivity = activities[i + 1]
          const transitionKey = `${activity} -> ${nextActivity.activity}`

          let transition = model.transitions.get(transitionKey)
          if (!transition) {
            transition = {
              from: activity,
              to: nextActivity.activity,
              count: 0,
              durations: [],
              avgDuration: 0,
              minDuration: 0,
              maxDuration: 0,
            }
            model.transitions.set(transitionKey, transition)
          }

          transition.count++
          const duration = nextActivity.startTime.getTime() - activities[i].startTime.getTime()
          transition.durations.push(duration)
        }
      }
    }

    // Calculate transition statistics
    for (const transition of model.transitions.values()) {
      if (transition.durations.length > 0) {
        transition.avgDuration =
          transition.durations.reduce((a, b) => a + b, 0) / transition.durations.length
        transition.minDuration = Math.min(...transition.durations)
        transition.maxDuration = Math.max(...transition.durations)
      }
    }

    model.activities = Array.from(activitySet)

    return model
  }

  // ===========================================================================
  // Variant Analysis
  // ===========================================================================

  /**
   * Analyze process variants (different paths through the process)
   */
  analyzeVariants(events: BusinessEvent[], options?: ProcessMiningOptions): ProcessVariant[] {
    const traces = this.extractTraces(events, options)
    const variantMap = new Map<string, { traces: ProcessTrace[]; durations: number[] }>()

    for (const trace of traces) {
      const variant = trace.activities.map((a) => a.activity).join(' -> ')

      if (!variantMap.has(variant)) {
        variantMap.set(variant, { traces: [], durations: [] })
      }

      const entry = variantMap.get(variant)!
      entry.traces.push(trace)
      entry.durations.push(trace.duration)
    }

    const variants: ProcessVariant[] = []
    const totalCases = traces.length

    for (const [variant, data] of variantMap) {
      const activities = variant.split(' -> ')
      const durations = data.durations
      const sortedDurations = [...durations].sort((a, b) => a - b)

      variants.push({
        variant,
        activities,
        count: data.traces.length,
        percentage: totalCases > 0 ? (data.traces.length / totalCases) * 100 : 0,
        avgDuration:
          durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        minDuration: durations.length > 0 ? sortedDurations[0] : 0,
        maxDuration: durations.length > 0 ? sortedDurations[sortedDurations.length - 1] : 0,
        caseIds: data.traces.map((t) => t.caseId),
      })
    }

    // Sort by count descending
    variants.sort((a, b) => b.count - a.count)

    return variants
  }

  // ===========================================================================
  // Conformance Checking
  // ===========================================================================

  /**
   * Check conformance of event logs against an expected process model
   */
  checkConformance(
    events: BusinessEvent[],
    expectedModel: ExpectedProcessModel,
    options?: ProcessMiningOptions
  ): ConformanceResult {
    const traces = this.extractTraces(events, options)
    const deviations: ConformanceDeviation[] = []
    let conformingTraces = 0

    // Build allowed transitions set for quick lookup
    const allowedTransitions = new Set<string>()
    if (expectedModel.allowedTransitions) {
      for (const t of expectedModel.allowedTransitions) {
        allowedTransitions.add(`${t.from} -> ${t.to}`)
      }
    }

    // Build ordering constraints for quick lookup
    const mustBeBefore = new Map<string, Set<string>>()
    if (expectedModel.orderingConstraints) {
      for (const constraint of expectedModel.orderingConstraints) {
        if (!mustBeBefore.has(constraint.after)) {
          mustBeBefore.set(constraint.after, new Set())
        }
        mustBeBefore.get(constraint.after)!.add(constraint.before)
      }
    }

    for (const trace of traces) {
      const activities = trace.activities.map((a) => a.activity)
      let traceConforms = true
      const seenActivities = new Set<string>()

      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i]

        // Check forbidden activities
        if (expectedModel.forbiddenActivities?.includes(activity)) {
          deviations.push({
            caseId: trace.caseId,
            type: 'unexpected_activity',
            actual: activity,
            position: i,
            context: { reason: 'forbidden_activity' },
          })
          traceConforms = false
        }

        // Check start activity constraint
        if (i === 0 && expectedModel.startActivities) {
          if (!expectedModel.startActivities.includes(activity)) {
            deviations.push({
              caseId: trace.caseId,
              type: 'unexpected_activity',
              expected: expectedModel.startActivities.join(' | '),
              actual: activity,
              position: 0,
              context: { reason: 'invalid_start_activity' },
            })
            traceConforms = false
          }
        }

        // Check end activity constraint
        if (i === activities.length - 1 && expectedModel.endActivities) {
          if (!expectedModel.endActivities.includes(activity)) {
            deviations.push({
              caseId: trace.caseId,
              type: 'unexpected_activity',
              expected: expectedModel.endActivities.join(' | '),
              actual: activity,
              position: i,
              context: { reason: 'invalid_end_activity' },
            })
            traceConforms = false
          }
        }

        // Check transition constraints
        if (i < activities.length - 1 && allowedTransitions.size > 0) {
          const transitionKey = `${activity} -> ${activities[i + 1]}`
          if (!allowedTransitions.has(transitionKey)) {
            deviations.push({
              caseId: trace.caseId,
              type: 'invalid_transition',
              expected: 'allowed transition',
              actual: transitionKey,
              position: i,
            })
            traceConforms = false
          }
        }

        // Check ordering constraints
        const requiredBefore = mustBeBefore.get(activity)
        if (requiredBefore) {
          for (const required of requiredBefore) {
            if (!seenActivities.has(required)) {
              deviations.push({
                caseId: trace.caseId,
                type: 'wrong_order',
                expected: `${required} before ${activity}`,
                actual: `${activity} without preceding ${required}`,
                position: i,
              })
              traceConforms = false
            }
          }
        }

        seenActivities.add(activity)
      }

      // Check required activities
      if (expectedModel.requiredActivities) {
        for (const required of expectedModel.requiredActivities) {
          if (!seenActivities.has(required)) {
            deviations.push({
              caseId: trace.caseId,
              type: 'missing_activity',
              expected: required,
              position: activities.length,
            })
            traceConforms = false
          }
        }
      }

      if (traceConforms) {
        conformingTraces++
      }
    }

    // Group deviations by type
    const deviationsByType = new Map<string, ConformanceDeviation[]>()
    for (const deviation of deviations) {
      if (!deviationsByType.has(deviation.type)) {
        deviationsByType.set(deviation.type, [])
      }
      deviationsByType.get(deviation.type)!.push(deviation)
    }

    return {
      fitness: traces.length > 0 ? conformingTraces / traces.length : 1,
      conformingTraces,
      totalTraces: traces.length,
      deviations,
      deviationsByType,
    }
  }

  // ===========================================================================
  // Bottleneck Detection
  // ===========================================================================

  /**
   * Detect bottlenecks in the process
   */
  detectBottlenecks(
    events: BusinessEvent[],
    options?: ProcessMiningOptions & { topN?: number }
  ): Bottleneck[] {
    const model = this.discoverProcess(events, options)
    const bottlenecks: Bottleneck[] = []

    // Calculate global statistics for severity normalization
    let maxTransitionTime = 0
    for (const transition of model.transitions.values()) {
      if (transition.avgDuration > maxTransitionTime) {
        maxTransitionTime = transition.avgDuration
      }
    }

    // Analyze transitions for bottlenecks
    for (const [key, transition] of model.transitions) {
      const durations = transition.durations
      if (durations.length === 0) continue

      const sortedDurations = [...durations].sort((a, b) => a - b)
      const medianIdx = Math.floor(sortedDurations.length / 2)
      const p95Idx = Math.floor(sortedDurations.length * 0.95)

      const median = sortedDurations[medianIdx]
      const p95 = sortedDurations[Math.min(p95Idx, sortedDurations.length - 1)]
      const severity = maxTransitionTime > 0 ? transition.avgDuration / maxTransitionTime : 0

      // Calculate potential savings (time above median * count)
      const potentialSavings = transition.count * Math.max(0, transition.avgDuration - median)

      bottlenecks.push({
        location: key,
        type: 'transition',
        avgTime: transition.avgDuration,
        medianTime: median,
        minTime: transition.minDuration,
        p95Time: p95,
        maxTime: transition.maxDuration,
        count: transition.count,
        severity,
        potentialSavings,
      })
    }

    // Sort by severity descending
    bottlenecks.sort((a, b) => b.severity - a.severity)

    // Return top N if specified
    const topN = options?.topN ?? bottlenecks.length
    return bottlenecks.slice(0, topN)
  }

  // ===========================================================================
  // Performance Metrics
  // ===========================================================================

  /**
   * Calculate performance metrics for the process
   */
  calculatePerformance(
    events: BusinessEvent[],
    options?: ProcessMiningOptions
  ): ProcessPerformanceMetrics {
    const traces = this.extractTraces(events, options)
    const model = this.discoverProcess(events, options)

    // Calculate cycle times
    const cycleTimes = traces.map((t) => t.duration)
    const sortedCycleTimes = [...cycleTimes].sort((a, b) => a - b)

    // Calculate activity performance
    const activityPerformance = new Map<string, ActivityPerformance>()
    const activityWaitTimes = new Map<string, number[]>()

    for (const trace of traces) {
      for (let i = 0; i < trace.activities.length; i++) {
        const activity = trace.activities[i]

        if (!activityWaitTimes.has(activity.activity)) {
          activityWaitTimes.set(activity.activity, [])
        }

        // Calculate wait time (time from previous activity to this one)
        if (i > 0) {
          const prevActivity = trace.activities[i - 1]
          const waitTime = activity.startTime.getTime() - prevActivity.startTime.getTime()
          activityWaitTimes.get(activity.activity)!.push(waitTime)
        }
      }
    }

    for (const [activity, waitTimes] of activityWaitTimes) {
      activityPerformance.set(activity, {
        activity,
        count: model.activityFrequencies.get(activity) || 0,
        avgWaitTime:
          waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0,
      })
    }

    // Calculate transition performance
    const transitionPerformance = new Map<string, TransitionPerformance>()

    for (const [key, transition] of model.transitions) {
      const durations = transition.durations
      const sortedDurations = [...durations].sort((a, b) => a - b)
      const medianIdx = Math.floor(sortedDurations.length / 2)

      transitionPerformance.set(key, {
        from: transition.from,
        to: transition.to,
        count: transition.count,
        avgTime: transition.avgDuration,
        medianTime: sortedDurations.length > 0 ? sortedDurations[medianIdx] : 0,
        minTime: transition.minDuration,
        maxTime: transition.maxDuration,
      })
    }

    // Calculate throughput
    const timeSpan =
      traces.length > 0
        ? Math.max(...traces.map((t) => t.endTime.getTime())) -
          Math.min(...traces.map((t) => t.startTime.getTime()))
        : 0

    const hoursInSpan = timeSpan / (1000 * 60 * 60)
    const daysInSpan = timeSpan / (1000 * 60 * 60 * 24)

    return {
      avgCycleTime:
        cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0,
      medianCycleTime:
        sortedCycleTimes.length > 0
          ? sortedCycleTimes[Math.floor(sortedCycleTimes.length / 2)]
          : 0,
      minCycleTime: sortedCycleTimes.length > 0 ? sortedCycleTimes[0] : 0,
      maxCycleTime:
        sortedCycleTimes.length > 0 ? sortedCycleTimes[sortedCycleTimes.length - 1] : 0,
      p95CycleTime:
        sortedCycleTimes.length > 0
          ? sortedCycleTimes[Math.floor(sortedCycleTimes.length * 0.95)]
          : 0,
      throughput: {
        casesPerHour: hoursInSpan > 0 ? traces.length / hoursInSpan : 0,
        casesPerDay: daysInSpan > 0 ? traces.length / daysInSpan : 0,
      },
      totalCases: traces.length,
      activityPerformance,
      transitionPerformance,
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get case statistics
   */
  getCaseStatistics(events: BusinessEvent[], options?: ProcessMiningOptions): {
    totalCases: number
    completedCases: number
    avgActivitiesPerCase: number
    minActivitiesPerCase: number
    maxActivitiesPerCase: number
  } {
    const traces = this.extractTraces(events, options)
    const activityCounts = traces.map((t) => t.activities.length)

    return {
      totalCases: traces.length,
      completedCases: traces.length, // All extracted traces are considered complete
      avgActivitiesPerCase:
        activityCounts.length > 0
          ? activityCounts.reduce((a, b) => a + b, 0) / activityCounts.length
          : 0,
      minActivitiesPerCase: activityCounts.length > 0 ? Math.min(...activityCounts) : 0,
      maxActivitiesPerCase: activityCounts.length > 0 ? Math.max(...activityCounts) : 0,
    }
  }

  /**
   * Get resource statistics
   */
  getResourceStatistics(events: BusinessEvent[], options?: ProcessMiningOptions): {
    resources: string[]
    activityByResource: Map<string, Map<string, number>>
    casesByResource: Map<string, Set<string>>
  } {
    const traces = this.extractTraces(events, options)
    const resources = new Set<string>()
    const activityByResource = new Map<string, Map<string, number>>()
    const casesByResource = new Map<string, Set<string>>()

    for (const trace of traces) {
      for (const activity of trace.activities) {
        const resource = activity.resource
        if (!resource) continue

        resources.add(resource)

        // Track activities per resource
        if (!activityByResource.has(resource)) {
          activityByResource.set(resource, new Map())
        }
        const activityMap = activityByResource.get(resource)!
        activityMap.set(activity.activity, (activityMap.get(activity.activity) || 0) + 1)

        // Track cases per resource
        if (!casesByResource.has(resource)) {
          casesByResource.set(resource, new Set())
        }
        casesByResource.get(resource)!.add(trace.caseId)
      }
    }

    return {
      resources: Array.from(resources),
      activityByResource,
      casesByResource,
    }
  }

  /**
   * Filter events by process criteria
   */
  filterEvents(
    events: BusinessEvent[],
    criteria: {
      activities?: string[]
      resources?: string[]
      caseIds?: string[]
      timeRange?: { start?: Date; end?: Date }
    }
  ): BusinessEvent[] {
    return events.filter((event) => {
      if (criteria.caseIds) {
        const caseId = this.getCaseId(event)
        if (!criteria.caseIds.includes(caseId)) return false
      }

      if (criteria.activities) {
        const activity = this.getActivity(event)
        if (!criteria.activities.includes(activity)) return false
      }

      if (criteria.resources) {
        const resource = this.getResource(event)
        if (!resource || !criteria.resources.includes(resource)) return false
      }

      if (criteria.timeRange) {
        const timestamp = this.getTimestamp(event)
        if (criteria.timeRange.start && timestamp < criteria.timeRange.start) return false
        if (criteria.timeRange.end && timestamp > criteria.timeRange.end) return false
      }

      return true
    })
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private extractField(event: BusinessEvent, field: string): unknown {
    const parts = field.split('.')
    let current: unknown = event

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Factory function to create a ProcessMiningEngine instance
 */
export function createProcessMiningEngine(
  fieldMapping?: ProcessMiningFieldMapping
): ProcessMiningEngine {
  return new ProcessMiningEngine(fieldMapping)
}
