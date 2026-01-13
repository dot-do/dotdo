/**
 * FormEngine Analytics Module
 *
 * Tracks completion rates, drop-off points, time per field, and submission funnel.
 * Provides comprehensive analytics for form optimization.
 *
 * Architecture:
 * - Pure calculation functions (testable without class instantiation)
 * - FormAnalytics class (orchestrates tracking and analysis)
 */

import type {
  SubmissionEvent,
  FieldInteraction,
  FormAnalytics as FormAnalyticsData,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface AnalyticsStats {
  views: number
  uniqueViews: number
  starts: number
  startRate: number
  submissions: number
  completions: number
  completionRate: number
  avgCompletionTimeMs: number
  abandonments: number
}

// ============================================================================
// PURE CALCULATION UTILITIES
// ============================================================================

/**
 * Calculate median of a number array
 * Pure function - no side effects, easily testable
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Calculate average of a number array
 * Pure function - no side effects, easily testable
 */
export function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Calculate rate as percentage
 * Pure function - no side effects, easily testable
 */
export function calculateRate(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

/**
 * Count events by type from an event array
 * Pure function - filters events and returns count
 */
export function countEventsByType<T extends { type: string }>(
  events: T[],
  type: string
): number {
  return events.filter(e => e.type === type).length
}

/**
 * Extract durations from completion events
 * Pure function - filters and maps events to durations
 */
export function extractCompletionDurations<T extends { type: string; metadata?: Record<string, unknown> }>(
  events: T[]
): number[] {
  return events
    .filter(e => e.type === 'complete' && e.metadata?.duration)
    .map(e => e.metadata!.duration as number)
}

/**
 * Classify time into early/mid/late buckets for drop-off analysis
 * Pure function - returns bucket classification
 */
export function classifyTimeDropOff(timeMs: number): 'early' | 'mid' | 'late' {
  if (timeMs < 30000) return 'early'      // < 30 seconds
  if (timeMs < 120000) return 'mid'       // 30s - 2 minutes
  return 'late'                            // > 2 minutes
}

/**
 * Infer drop-off reason based on context
 * Pure function - analyzes interaction patterns to determine likely cause
 */
export type DropOffReason =
  | 'validation_error'
  | 'timeout'
  | 'slow_field'
  | 'abandonment'

export function inferDropOffReason(
  hasError: boolean,
  avgFieldTimeMs: number,
  timeBeforeDropOffMs: number
): DropOffReason {
  if (hasError) return 'validation_error'
  if (avgFieldTimeMs > 30000) return 'slow_field'
  if (timeBeforeDropOffMs > 300000) return 'timeout' // > 5 minutes
  return 'abandonment'
}

/**
 * Time-based distribution of drop-offs
 */
export interface TimeDropOffDistribution {
  early: number
  mid: number
  late: number
}

/**
 * Calculate time distribution for drop-off events
 * Pure function - categorizes times into early/mid/late buckets
 */
export function calculateTimeDistribution(times: number[]): TimeDropOffDistribution {
  return {
    early: times.filter(t => classifyTimeDropOff(t) === 'early').length,
    mid: times.filter(t => classifyTimeDropOff(t) === 'mid').length,
    late: times.filter(t => classifyTimeDropOff(t) === 'late').length,
  }
}

/** Problematic field issue type for suggestions */
export type ProblematicFieldIssue = 'high_error_rate' | 'high_abandonment' | 'slow'

/**
 * Generate optimization suggestion for a problematic field
 * Pure function - returns actionable recommendation based on issue type
 */
export function generateFieldSuggestion(issue: ProblematicFieldIssue, fieldId: string): string {
  switch (issue) {
    case 'high_error_rate':
      return `Add inline validation hints or improve input format guidance for "${fieldId}"`
    case 'high_abandonment':
      return `Simplify or provide autocomplete for "${fieldId}" to reduce friction`
    case 'slow':
      return `Consider adding autocomplete, pre-fill, or breaking "${fieldId}" into smaller parts`
  }
}

export interface FieldStats {
  interactions: number
  errorCount: number
  avgTimeMs: number
}

export interface StepStats {
  completions: number
  avgTimeMs: number
}

export interface FunnelStep {
  step: string
  count: number
  dropOff: number
  conversionRate: number
}

export interface ProblematicField {
  field: string
  issue: ProblematicFieldIssue
  value: number
  /** Suggested optimization - generated by generateFieldSuggestion */
  suggestion?: string
}

export interface AnalyticsReport {
  formId: string
  summary: AnalyticsStats
  funnel: FunnelStep[]
  fieldStats: Record<string, FieldStats>
  stepStats: Record<string, StepStats>
}

export interface ReportOptions {
  startDate?: Date
  endDate?: Date
}

export interface AnalyticsOptions {
  anonymize?: boolean
  piiFields?: string[]
  respectDNT?: boolean
}

interface TrackOptions {
  sessionId?: string
  submissionId?: string
  stepId?: string
  fieldId?: string
  referrer?: string
  device?: string
  browser?: string
}

interface StoredEvent {
  type: SubmissionEvent['type']
  timestamp: Date
  submissionId?: string
  stepId?: string
  fieldId?: string
  metadata?: Record<string, unknown>
}

interface StoredInteraction extends FieldInteraction {
  value?: unknown
}

// ============================================================================
// ANALYTICS CLASS
// ============================================================================

export class FormAnalytics {
  private formId: string
  private options: AnalyticsOptions
  private events: StoredEvent[] = []
  private interactions: Map<string, StoredInteraction[]> = new Map()
  private sessions: Set<string> = new Set()
  private fieldFocusTimes: Map<string, Date> = new Map()
  private submissionStartTimes: Map<string, Date> = new Map()
  private stepStartTimes: Map<string, Date> = new Map()
  private doNotTrack = false
  private eventListeners: Map<string, Array<(data: unknown) => void>> = new Map()

  constructor(formId: string, options: AnalyticsOptions = {}) {
    this.formId = formId
    this.options = options
  }

  // ============================================================================
  // TRACKING METHODS
  // ============================================================================

  /**
   * Track a form view
   */
  trackView(opts: TrackOptions = {}): void {
    if (this.shouldSkip()) return

    this.events.push({
      type: 'view',
      timestamp: new Date(),
      metadata: {
        referrer: opts.referrer,
        device: opts.device,
        browser: opts.browser,
      },
    })

    if (opts.sessionId) {
      this.sessions.add(opts.sessionId)
    }

    this.emitEvent({ type: 'view', timestamp: new Date() })
    this.emitStatsUpdate()
  }

  /**
   * Track form start
   */
  trackStart(opts: TrackOptions): void {
    if (this.shouldSkip()) return

    this.events.push({
      type: 'start',
      timestamp: new Date(),
      submissionId: opts.submissionId,
    })

    if (opts.submissionId) {
      this.submissionStartTimes.set(opts.submissionId, new Date())
    }

    this.emitEvent({ type: 'start', timestamp: new Date() })
    this.emitStatsUpdate()
  }

  /**
   * Track field interaction
   */
  trackFieldInteraction(interaction: Partial<FieldInteraction> & { field: string; type: FieldInteraction['type'] }): void {
    if (this.shouldSkip()) return

    const stored: StoredInteraction = {
      field: interaction.field,
      type: interaction.type,
      timestamp: interaction.timestamp || new Date(),
    }

    // Don't store PII values
    if (interaction.value !== undefined) {
      if (!this.options.anonymize && !this.options.piiFields?.includes(interaction.field)) {
        stored.value = interaction.value
      }
    }

    // Track focus time
    if (interaction.type === 'focus') {
      this.fieldFocusTimes.set(interaction.field, new Date())
    } else if (interaction.type === 'blur') {
      const focusTime = this.fieldFocusTimes.get(interaction.field)
      if (focusTime) {
        stored.duration = Date.now() - focusTime.getTime()
        this.fieldFocusTimes.delete(interaction.field)
      }
    }

    if (!this.interactions.has(interaction.field)) {
      this.interactions.set(interaction.field, [])
    }
    this.interactions.get(interaction.field)!.push(stored)
  }

  /**
   * Track step completion
   */
  trackStepComplete(opts: { submissionId?: string; stepId: string }): void {
    if (this.shouldSkip()) return

    const event: StoredEvent = {
      type: 'step_complete',
      timestamp: new Date(),
      submissionId: opts.submissionId,
      stepId: opts.stepId,
    }

    // Calculate step duration
    if (opts.submissionId) {
      const startTime = this.stepStartTimes.get(`${opts.submissionId}:${opts.stepId}`) ||
        this.submissionStartTimes.get(opts.submissionId)

      if (startTime) {
        event.metadata = { duration: Date.now() - startTime.getTime() }
      }

      // Set start time for next step
      this.stepStartTimes.set(`${opts.submissionId}:next`, new Date())
    }

    this.events.push(event)
    this.emitStatsUpdate()
  }

  /**
   * Track form submission
   */
  trackSubmit(opts: { submissionId?: string }): void {
    if (this.shouldSkip()) return

    this.events.push({
      type: 'submit',
      timestamp: new Date(),
      submissionId: opts.submissionId,
    })

    this.emitStatsUpdate()
  }

  /**
   * Track form completion
   */
  trackComplete(opts: { submissionId?: string }): void {
    if (this.shouldSkip()) return

    const event: StoredEvent = {
      type: 'complete',
      timestamp: new Date(),
      submissionId: opts.submissionId,
    }

    if (opts.submissionId) {
      const startTime = this.submissionStartTimes.get(opts.submissionId)
      if (startTime) {
        event.metadata = { duration: Date.now() - startTime.getTime() }
      }
    }

    this.events.push(event)
    this.emitStatsUpdate()
  }

  /**
   * Track abandonment
   */
  trackAbandon(opts: { submissionId?: string; stepId?: string; fieldId?: string }): void {
    if (this.shouldSkip()) return

    this.events.push({
      type: 'abandon',
      timestamp: new Date(),
      submissionId: opts.submissionId,
      stepId: opts.stepId,
      fieldId: opts.fieldId,
    })

    this.emitStatsUpdate()
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get overall statistics
   */
  getStats(): AnalyticsStats {
    const views = this.events.filter(e => e.type === 'view').length
    const starts = this.events.filter(e => e.type === 'start').length
    const submissions = this.events.filter(e => e.type === 'submit').length
    const completions = this.events.filter(e => e.type === 'complete').length
    const abandonments = this.events.filter(e => e.type === 'abandon').length

    // Calculate average completion time
    const completionTimes = this.events
      .filter(e => e.type === 'complete' && e.metadata?.duration)
      .map(e => e.metadata!.duration as number)

    const avgCompletionTimeMs = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : 0

    return {
      views,
      uniqueViews: this.sessions.size,
      starts,
      startRate: views > 0 ? (starts / views) * 100 : 0,
      submissions,
      completions,
      completionRate: starts > 0 ? (completions / starts) * 100 : 0,
      avgCompletionTimeMs,
      abandonments,
    }
  }

  /**
   * Get field statistics
   */
  getFieldStats(field: string): FieldStats {
    const interactions = this.interactions.get(field) || []

    const errorCount = interactions.filter(i => i.type === 'error').length

    // Calculate average time
    const times = interactions.filter(i => i.duration).map(i => i.duration!)
    const avgTimeMs = times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length
      : 0

    return {
      interactions: interactions.length,
      errorCount,
      avgTimeMs,
    }
  }

  /**
   * Get step statistics
   */
  getStepStats(stepId: string): StepStats {
    const stepCompletions = this.events.filter(
      e => e.type === 'step_complete' && e.stepId === stepId
    )

    const times = stepCompletions
      .filter(e => e.metadata?.duration)
      .map(e => e.metadata!.duration as number)

    const avgTimeMs = times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length
      : 0

    return {
      completions: stepCompletions.length,
      avgTimeMs,
    }
  }

  /**
   * Get field interactions
   */
  getFieldInteractions(field: string): StoredInteraction[] {
    return this.interactions.get(field) || []
  }

  /**
   * Get all events
   */
  getEvents(): StoredEvent[] {
    return [...this.events]
  }

  // ============================================================================
  // DROP-OFF ANALYSIS
  // ============================================================================

  /**
   * Get drop-off by step
   */
  getDropOffByStep(): Record<string, number> {
    const dropOff: Record<string, number> = {}

    const abandonments = this.events.filter(e => e.type === 'abandon' && e.stepId)
    for (const event of abandonments) {
      if (event.stepId) {
        dropOff[event.stepId] = (dropOff[event.stepId] || 0) + 1
      }
    }

    // Also calculate implied drop-off from step completion counts
    const stepCompletions: Record<string, number> = {}
    const stepEvents = this.events.filter(e => e.type === 'step_complete')

    for (const event of stepEvents) {
      if (event.stepId) {
        stepCompletions[event.stepId] = (stepCompletions[event.stepId] || 0) + 1
      }
    }

    // Calculate drop-off between consecutive steps
    const steps = Object.keys(stepCompletions).sort()
    for (let i = 0; i < steps.length - 1; i++) {
      const currentCount = stepCompletions[steps[i]] || 0
      const nextCount = stepCompletions[steps[i + 1]] || 0
      if (currentCount > nextCount) {
        dropOff[steps[i + 1]] = (dropOff[steps[i + 1]] || 0) + (currentCount - nextCount)
      }
    }

    return dropOff
  }

  /**
   * Get drop-off by field
   */
  getDropOffByField(): Record<string, number> {
    const dropOff: Record<string, number> = {}

    const abandonments = this.events.filter(e => e.type === 'abandon' && e.fieldId)
    for (const event of abandonments) {
      if (event.fieldId) {
        dropOff[event.fieldId] = (dropOff[event.fieldId] || 0) + 1
      }
    }

    return dropOff
  }

  /**
   * Identify problematic fields
   * Returns fields with high error rates, high abandonment, or slow completion times
   * Each field includes a suggestion for improvement using pure function
   */
  getProblematicFields(): ProblematicField[] {
    const problematic: ProblematicField[] = []
    const errorRates = this.getErrorRateByField()
    const dropOff = this.getDropOffByField()
    const timePerField = this.getTimePerField()

    // High error rate fields (> 20%)
    for (const [field, rate] of Object.entries(errorRates)) {
      if (rate > 20) {
        problematic.push({
          field,
          issue: 'high_error_rate',
          value: rate,
          suggestion: generateFieldSuggestion('high_error_rate', field),
        })
      }
    }

    // High abandonment fields (> 3 drop-offs)
    for (const [field, count] of Object.entries(dropOff)) {
      if (count > 3) {
        problematic.push({
          field,
          issue: 'high_abandonment',
          value: count,
          suggestion: generateFieldSuggestion('high_abandonment', field),
        })
      }
    }

    // Slow fields (3x average time)
    const avgTime = calculateAverage(Object.values(timePerField))
    for (const [field, time] of Object.entries(timePerField)) {
      if (time > avgTime * 3) {
        problematic.push({
          field,
          issue: 'slow',
          value: time,
          suggestion: generateFieldSuggestion('slow', field),
        })
      }
    }

    return problematic
  }

  // ============================================================================
  // TIME ANALYSIS
  // ============================================================================

  /**
   * Get average time per field
   */
  getTimePerField(): Record<string, number> {
    const times: Record<string, number> = {}

    for (const [field, interactions] of this.interactions.entries()) {
      const durations = interactions.filter(i => i.duration).map(i => i.duration!)
      if (durations.length > 0) {
        times[field] = durations.reduce((a, b) => a + b, 0) / durations.length
      }
    }

    return times
  }

  /**
   * Get fields that take longer than threshold
   */
  getSlowFields(thresholdMs: number): string[] {
    const times = this.getTimePerField()
    return Object.entries(times)
      .filter(([, time]) => time > thresholdMs)
      .map(([field]) => field)
  }

  // ============================================================================
  // ERROR RATE ANALYSIS
  // ============================================================================

  /**
   * Get error rate by field
   */
  getErrorRateByField(): Record<string, number> {
    const errorRates: Record<string, number> = {}

    for (const [field, interactions] of this.interactions.entries()) {
      const total = interactions.filter(i => i.type === 'change').length
      const errors = interactions.filter(i => i.type === 'error').length

      if (total > 0) {
        errorRates[field] = (errors / total) * 100
      }
    }

    return errorRates
  }

  /**
   * Get fields with error rate above threshold
   */
  getHighErrorRateFields(thresholdPercent: number): string[] {
    const rates = this.getErrorRateByField()
    return Object.entries(rates)
      .filter(([, rate]) => rate > thresholdPercent)
      .map(([field]) => field)
  }

  // ============================================================================
  // FUNNEL ANALYSIS
  // ============================================================================

  /**
   * Get submission funnel
   */
  getFunnel(): FunnelStep[] {
    const views = this.events.filter(e => e.type === 'view').length
    const starts = this.events.filter(e => e.type === 'start').length
    const submissions = this.events.filter(e => e.type === 'submit').length
    const completions = this.events.filter(e => e.type === 'complete').length

    // Get step completions
    const stepCompletions = new Map<string, number>()
    for (const event of this.events.filter(e => e.type === 'step_complete')) {
      if (event.stepId) {
        stepCompletions.set(event.stepId, (stepCompletions.get(event.stepId) || 0) + 1)
      }
    }

    const funnel: FunnelStep[] = [
      {
        step: 'view',
        count: views,
        dropOff: views - starts,
        conversionRate: 100,
      },
      {
        step: 'start',
        count: starts,
        dropOff: 0,
        conversionRate: views > 0 ? (starts / views) * 100 : 0,
      },
    ]

    // Add steps
    let prevCount = starts
    const stepOrder = Array.from(stepCompletions.keys()).sort()

    for (const stepId of stepOrder) {
      const count = stepCompletions.get(stepId)!
      funnel.push({
        step: stepId,
        count,
        dropOff: prevCount - count,
        conversionRate: views > 0 ? (count / views) * 100 : 0,
      })
      prevCount = count
    }

    // Add submit and complete
    funnel.push({
      step: 'submit',
      count: submissions,
      dropOff: (stepOrder.length > 0 ? stepCompletions.get(stepOrder[stepOrder.length - 1])! : starts) - submissions,
      conversionRate: views > 0 ? (submissions / views) * 100 : 0,
    })

    funnel.push({
      step: 'complete',
      count: completions,
      dropOff: submissions - completions,
      conversionRate: views > 0 ? (completions / views) * 100 : 0,
    })

    return funnel
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  /**
   * Generate a comprehensive report
   */
  generateReport(options: ReportOptions = {}): AnalyticsReport {
    let events = this.events

    // Filter by date range
    if (options.startDate || options.endDate) {
      events = events.filter(e => {
        if (options.startDate && e.timestamp < options.startDate) return false
        if (options.endDate && e.timestamp > options.endDate) return false
        return true
      })
    }

    // Temporarily swap events for calculations
    const originalEvents = this.events
    this.events = events

    const report: AnalyticsReport = {
      formId: this.formId,
      summary: this.getStats(),
      funnel: this.getFunnel(),
      fieldStats: {},
      stepStats: {},
    }

    // Get field stats
    for (const field of this.interactions.keys()) {
      report.fieldStats[field] = this.getFieldStats(field)
    }

    // Get step stats
    const steps = new Set(events.filter(e => e.stepId).map(e => e.stepId!))
    for (const stepId of steps) {
      report.stepStats[stepId] = this.getStepStats(stepId)
    }

    // Restore original events
    this.events = originalEvents

    return report
  }

  /**
   * Export events to CSV
   */
  exportCSV(): string {
    const headers = ['type', 'timestamp', 'submissionId', 'stepId', 'fieldId']
    const rows = [headers.join(',')]

    for (const event of this.events) {
      rows.push([
        event.type,
        event.timestamp.toISOString(),
        event.submissionId || '',
        event.stepId || '',
        event.fieldId || '',
      ].join(','))
    }

    return rows.join('\n')
  }

  /**
   * Export to JSON
   */
  exportJSON(): string {
    return JSON.stringify({
      events: this.events,
      stats: this.getStats(),
    })
  }

  // ============================================================================
  // PRIVACY
  // ============================================================================

  /**
   * Set Do Not Track flag
   */
  setDoNotTrack(dnt: boolean): void {
    this.doNotTrack = dnt
  }

  private shouldSkip(): boolean {
    if (this.options.respectDNT && this.doNotTrack) {
      return true
    }
    return false
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  on(event: string, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)
  }

  private emitEvent(data: unknown): void {
    const listeners = this.eventListeners.get('event') || []
    for (const listener of listeners) {
      listener(data)
    }
  }

  private emitStatsUpdate(): void {
    const listeners = this.eventListeners.get('statsUpdate') || []
    for (const listener of listeners) {
      listener(this.getStats())
    }
  }
}

// ============================================================================
// ANALYTICS COLLECTOR
// ============================================================================

export interface CollectorOptions {
  batchSize?: number
  flushInterval?: number
}

export class AnalyticsCollector {
  private analytics: FormAnalytics
  private options: CollectorOptions
  private batch: Array<() => void> = []
  private timer?: ReturnType<typeof setInterval>

  constructor(analytics: FormAnalytics, options: CollectorOptions = {}) {
    this.analytics = analytics
    this.options = options

    if (options.flushInterval) {
      this.timer = setInterval(() => this.flush(), options.flushInterval)
    }
  }

  trackFormView(): void {
    this.addToBatch(() => this.analytics.trackView())
  }

  trackFormStart(submissionId: string): void {
    this.addToBatch(() => this.analytics.trackStart({ submissionId }))
  }

  trackFieldFocus(field: string): void {
    this.addToBatch(() => this.analytics.trackFieldInteraction({ field, type: 'focus' }))
  }

  trackFieldBlur(field: string): void {
    this.addToBatch(() => this.analytics.trackFieldInteraction({ field, type: 'blur' }))
  }

  trackFieldChange(field: string, value?: unknown): void {
    this.addToBatch(() => this.analytics.trackFieldInteraction({ field, type: 'change', value }))
  }

  trackFormSubmit(submissionId: string): void {
    this.addToBatch(() => this.analytics.trackSubmit({ submissionId }))
  }

  private addToBatch(fn: () => void): void {
    if (!this.options.batchSize) {
      fn()
      return
    }

    this.batch.push(fn)

    if (this.batch.length >= this.options.batchSize) {
      this.flush()
    }
  }

  flush(): void {
    for (const fn of this.batch) {
      fn()
    }
    this.batch = []
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.flush()
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createAnalytics(formId: string, options?: AnalyticsOptions): FormAnalytics {
  return new FormAnalytics(formId, options)
}

export type { AnalyticsReport as AnalyticsReport }
