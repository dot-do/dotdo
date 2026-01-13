/**
 * @module workflows/schedule-builder
 *
 * Schedule Builder - Fluent API for $.every scheduling in Durable Objects
 *
 * This module provides a fluent, human-readable scheduling DSL that converts
 * natural language patterns to cron expressions and integrates with the
 * Durable Object alarm API for reliable scheduled execution.
 *
 * ## Fluent Scheduling DSL
 *
 * The schedule builder supports multiple syntax patterns for expressing schedules:
 *
 * @example Day and time combinations
 * ```typescript
 * import { createScheduleBuilderProxy } from 'dotdo/workflows'
 *
 * const every = createScheduleBuilderProxy({ state: ctx.state })
 *
 * // Every Monday at 9am
 * every.Monday.at9am(() => {
 *   generateWeeklyReport()
 * })
 *
 * // Every Friday at 5pm
 * every.Friday.at5pm(() => {
 *   sendWeeklyNewsletter()
 * })
 *
 * // Weekdays at 8:30am
 * every.weekday.at('8:30am')(() => {
 *   sendDailyBriefing()
 * })
 * ```
 *
 * @example Interval schedules
 * ```typescript
 * // Every hour
 * every.hour(() => {
 *   checkSystemHealth()
 * })
 *
 * // Every minute
 * every.minute(() => {
 *   pingMonitoring()
 * })
 * ```
 *
 * @example Natural language (function call syntax)
 * ```typescript
 * // Parsed using AI when available, regex fallback otherwise
 * every('every 5 minutes', () => {
 *   syncExternalData()
 * })
 *
 * every('daily at 6am', () => {
 *   prepareReports()
 * })
 *
 * every('first day of month at 9am', () => {
 *   generateMonthlyInvoices()
 * })
 * ```
 *
 * ## Time Parsing
 *
 * The module supports various time formats:
 * - 12-hour format: `9am`, `9:30am`, `5pm`
 * - 24-hour format: `14:30`, `09:00`
 * - Special times: `noon`, `midnight`
 *
 * @example Time parsing
 * ```typescript
 * every.day.at('9am')(() => handleMorning())
 * every.day.at('14:30')(() => handleAfternoon())
 * every.day.atnoon(() => handleLunch())
 * every.day.atmidnight(() => handleMidnight())
 * ```
 *
 * ## Cron Expression Generation
 *
 * All fluent patterns are converted to standard 5-field cron expressions:
 *
 * | Pattern | Cron |
 * |---------|------|
 * | `every.Monday.at9am` | `0 9 * * 1` |
 * | `every.day.at6pm` | `0 18 * * *` |
 * | `every.hour` | `0 * * * *` |
 * | `every('every 5 minutes')` | `* /5 * * * *` |
 * | `every.weekday.at9am` | `0 9 * * 1-5` |
 *
 * ## AI-Powered Natural Language Parsing
 *
 * When AI environment bindings are available, complex natural language
 * schedules are parsed using Claude for greater flexibility:
 *
 * @example AI parsing with fallback
 * ```typescript
 * const every = createScheduleBuilderProxy({
 *   state: ctx.state,
 *   env: ctx.env  // Enables AI parsing
 * })
 *
 * // These work with or without AI (regex fallback)
 * every('every 5 minutes', handler)
 * every('daily at 9am', handler)
 *
 * // These require AI for accurate parsing
 * every('every second Tuesday at 3pm', handler)
 * every('last Friday of month', handler)
 * ```
 *
 * @see {@link createScheduleBuilderProxy} - Factory function
 * @see {@link parseNaturalSchedule} - Natural language parser
 * @see {@link parseCronExpression} - Cron expression parser (in ScheduleManager)
 */

/// <reference types="@cloudflare/workers-types" />

import type { ScheduleHandler } from '../types/WorkflowContext'
import { AIGatewayClient, type AIGatewayEnv, type ChatMessage } from '../lib/ai/gateway'
import type { AIConfig } from '../types/AI'

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ScheduleBuilderConfig {
  state: DurableObjectState
  onScheduleRegistered?: (cron: string, name: string, handler: ScheduleHandler) => void
  /** Environment bindings for AI (optional - enables AI-powered natural language parsing) */
  env?: AIGatewayEnv
}

// ============================================================================
// DAY AND TIME MAPPINGS
// ============================================================================

const DAYS: Record<string, string> = {
  Sunday: '0',
  Monday: '1',
  Tuesday: '2',
  Wednesday: '3',
  Thursday: '4',
  Friday: '5',
  Saturday: '6',
  day: '*',
  weekday: '1-5',
  weekend: '0,6',
}

const TIMES: Record<string, { minute: string; hour: string }> = {
  at6am: { minute: '0', hour: '6' },
  at7am: { minute: '0', hour: '7' },
  at8am: { minute: '0', hour: '8' },
  at9am: { minute: '0', hour: '9' },
  at10am: { minute: '0', hour: '10' },
  at11am: { minute: '0', hour: '11' },
  at12pm: { minute: '0', hour: '12' },
  at1pm: { minute: '0', hour: '13' },
  at2pm: { minute: '0', hour: '14' },
  at3pm: { minute: '0', hour: '15' },
  at4pm: { minute: '0', hour: '16' },
  at5pm: { minute: '0', hour: '17' },
  at6pm: { minute: '0', hour: '18' },
  atnoon: { minute: '0', hour: '12' },
  atmidnight: { minute: '0', hour: '0' },
}

// ============================================================================
// TIME PARSING
// ============================================================================

/**
 * Parse a time string into minute and hour components.
 *
 * Supports multiple time formats:
 * - 12-hour with meridiem: `9am`, `9:30pm`, `12pm`
 * - 24-hour format: `14:30`, `09:00`, `23:59`
 * - Special names: `noon`, `midnight`
 *
 * @param timeStr - Time string to parse
 * @returns Object with `minute` and `hour` as strings
 * @throws Error if the time format is invalid
 *
 * @example
 * ```typescript
 * parseTime('9am')      // { minute: '0', hour: '9' }
 * parseTime('9:30pm')   // { minute: '30', hour: '21' }
 * parseTime('noon')     // { minute: '0', hour: '12' }
 * parseTime('14:30')    // { minute: '30', hour: '14' }
 * ```
 */
function parseTime(timeStr: string): { minute: string; hour: string } {
  const lower = timeStr.toLowerCase().trim()

  // Handle special cases
  if (lower === 'noon') {
    return { minute: '0', hour: '12' }
  }
  if (lower === 'midnight') {
    return { minute: '0', hour: '0' }
  }

  // Match patterns like '9am', '9:30am', '9pm', '14:30'
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }

  let hour = parseInt(match[1]!, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]

  // Validate hour based on format
  if (meridiem) {
    // 12-hour format
    if (hour < 1 || hour > 12) {
      throw new Error(`Invalid hour for 12-hour format: ${hour}`)
    }
    if (meridiem === 'pm' && hour !== 12) {
      hour += 12
    }
    if (meridiem === 'am' && hour === 12) {
      hour = 0
    }
  } else {
    // 24-hour format
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid hour for 24-hour format: ${hour}`)
    }
  }

  // Validate minute
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute: ${minute}`)
  }

  return { minute: String(minute), hour: String(hour) }
}

// ============================================================================
// NATURAL LANGUAGE PARSING
// ============================================================================

/**
 * Cache for AI-generated cron expressions to reduce API calls
 * Maps normalized schedule strings to their cron expressions
 */
const cronCache = new Map<string, string>()

/**
 * Pre-populated cache with common patterns to reduce AI calls
 */
const COMMON_PATTERNS: Record<string, string> = {
  // Basic intervals
  'every minute': '* * * * *',
  'every hour': '0 * * * *',
  'hourly': '0 * * * *',
  'every 5 minutes': '*/5 * * * *',
  'every 10 minutes': '*/10 * * * *',
  'every 15 minutes': '*/15 * * * *',
  'every 30 minutes': '*/30 * * * *',
  'every 2 hours': '0 */2 * * *',
  'every 3 hours': '0 */3 * * *',
  'every 4 hours': '0 */4 * * *',
  'every 6 hours': '0 */6 * * *',
  'every 8 hours': '0 */8 * * *',
  'every 12 hours': '0 */12 * * *',

  // Daily patterns
  'daily at 6am': '0 6 * * *',
  'daily at 9am': '0 9 * * *',
  'daily at noon': '0 12 * * *',
  'daily at midnight': '0 0 * * *',
  'every day at 6am': '0 6 * * *',
  'every day at 9am': '0 9 * * *',
  'everyday at 6am': '0 6 * * *',
  'everyday at noon': '0 12 * * *',

  // Monthly patterns
  'first day of month': '0 0 1 * *',
  'first of month': '0 0 1 * *',
  '1st of month': '0 0 1 * *',
  'first of month at 9am': '0 9 1 * *',
  '1st of month at 6am': '0 6 1 * *',
  '15th of month': '0 0 15 * *',
  'last day of month': 'UNSUPPORTED',  // Standard cron doesn't support 'L'

  // Weekly patterns
  'weekly on monday': '0 0 * * 1',
  'weekly on friday': '0 0 * * 5',
  'every week on monday': '0 0 * * 1',
  'every week on friday at 5pm': '0 17 * * 5',

  // Weekday/weekend patterns
  'weekdays at 9am': '0 9 * * 1-5',
  'weekends at 10am': '0 10 * * 0,6',
  'every weekday at 8:30am': '30 8 * * 1-5',
}

// Initialize cache with common patterns
for (const [pattern, cron] of Object.entries(COMMON_PATTERNS)) {
  cronCache.set(pattern, cron)
}

/**
 * Validate that a string is a valid 5-field cron expression.
 *
 * Checks that the cron string has exactly 5 space-separated fields
 * and each field matches valid cron syntax (wildcards, numbers, ranges, steps).
 *
 * @param cron - Cron expression string to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * ```
 * isValidCron('0 9 * * 1')   // true (Monday 9am)
 * isValidCron('*​/5 * * * *') // true (every 5 minutes)
 * isValidCron('0 9 * *')     // false (only 4 fields)
 * isValidCron('invalid')     // false
 * ```
 */
function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false

  // Basic validation for each field
  const minutePattern = /^(\*|\d{1,2}|\*\/\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}(,\d{1,2})*)$/
  const hourPattern = /^(\*|\d{1,2}|\*\/\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}(,\d{1,2})*)$/
  const dayOfMonthPattern = /^(\*|\d{1,2}|\*\/\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}(,\d{1,2})*)$/
  const monthPattern = /^(\*|\d{1,2}|\*\/\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}(,\d{1,2})*)$/
  const dayOfWeekPattern = /^(\*|\d{1}|\*\/\d{1}|\d{1}-\d{1}|\d{1}(,\d{1})*)$/

  return (
    minutePattern.test(parts[0]!) &&
    hourPattern.test(parts[1]!) &&
    dayOfMonthPattern.test(parts[2]!) &&
    monthPattern.test(parts[3]!) &&
    dayOfWeekPattern.test(parts[4]!)
  )
}

/**
 * Parse natural language schedule strings using AI
 * Falls back to regex parsing if AI is unavailable
 *
 * Examples:
 * - 'every 5 minutes' becomes a cron running every 5 minutes
 * - 'every hour' becomes hourly cron
 * - 'daily at 9am' runs daily at 9am
 * - 'Monday at 9am' runs weekly on Monday at 9am
 * - 'weekdays at 8:30am' runs Mon-Fri at 8:30am
 * - 'first day of month' runs on the 1st at midnight
 * - 'every 2 hours' runs at minute 0 every 2 hours
 */
async function parseNaturalScheduleWithAI(
  schedule: string,
  env?: AIGatewayEnv
): Promise<string> {
  const lower = schedule.toLowerCase().trim()

  // Check cache first (includes common patterns)
  const cached = cronCache.get(lower)
  if (cached) {
    if (cached === 'UNSUPPORTED') {
      throw new Error('last day of month is not supported in standard cron')
    }
    return cached
  }

  // Try regex fallback first for basic patterns (fast path)
  try {
    const regexResult = parseNaturalScheduleRegex(lower)
    cronCache.set(lower, regexResult)
    return regexResult
  } catch {
    // Regex couldn't handle it, try AI
  }

  // If AI env is available, use AI to parse
  if (env?.ANTHROPIC_API_KEY) {
    try {
      const aiResult = await parseWithAI(schedule, env)
      if (aiResult && isValidCron(aiResult)) {
        cronCache.set(lower, aiResult)
        return aiResult
      }
    } catch {
      // AI failed, will throw below
    }
  }

  throw new Error(`Unrecognized schedule format: ${schedule}`)
}

/**
 * Use AI to convert natural language to cron expression
 */
async function parseWithAI(schedule: string, env: AIGatewayEnv): Promise<string> {
  const config: AIConfig = {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    temperature: 0,
    maxTokens: 50,
  }

  const client = new AIGatewayClient(config, env)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a cron expression generator. Convert natural language schedule descriptions to standard 5-field cron expressions.

Rules:
- Output ONLY the cron expression, nothing else
- Use standard 5-field format: minute hour dayOfMonth month dayOfWeek
- Days of week: 0=Sunday, 1=Monday, ..., 6=Saturday
- For "first day of month" or "1st of month", use day 1: 0 0 1 * *
- For hour intervals like "every N hours", use */N in hour field: 0 */N * * *
- Standard cron doesn't support "last day of month" - respond with ERROR if asked

Examples:
- "every 2 hours" -> 0 */2 * * *
- "first day of month" -> 0 0 1 * *
- "every day at 6am" -> 0 6 * * *
- "15th of month" -> 0 0 15 * *
- "every week on Friday at 5pm" -> 0 17 * * 5`,
    },
    {
      role: 'user',
      content: schedule,
    },
  ]

  const response = await client.chat(messages)
  const result = response.content.trim()

  if (result === 'ERROR' || result.includes('ERROR')) {
    throw new Error(`AI could not parse schedule: ${schedule}`)
  }

  return result
}

/**
 * Synchronous regex-based parsing (fallback for when AI is unavailable)
 * Handles the most common patterns without AI
 */
function parseNaturalScheduleRegex(schedule: string): string {
  const lower = schedule.toLowerCase().trim()

  // Match 'every N minutes'
  const everyMinutesMatch = lower.match(/every\s+(\d+)\s+minutes?/)
  if (everyMinutesMatch) {
    const interval = parseInt(everyMinutesMatch[1]!, 10)
    if (interval < 1 || interval > 59) {
      throw new Error(`Invalid minute interval: ${interval}`)
    }
    return `*/${interval} * * * *`
  }

  // Match 'every N hours'
  const everyHoursMatch = lower.match(/every\s+(\d+)\s+hours?/)
  if (everyHoursMatch) {
    const interval = parseInt(everyHoursMatch[1]!, 10)
    if (interval < 1 || interval > 23) {
      throw new Error(`Invalid hour interval: ${interval}`)
    }
    return `0 */${interval} * * *`
  }

  // Match 'every hour'
  if (lower === 'every hour' || lower === 'hourly') {
    return '0 * * * *'
  }

  // Match 'every minute'
  if (lower === 'every minute') {
    return '* * * * *'
  }

  // Match 'daily at TIME' or 'everyday at TIME' or 'every day at TIME'
  const dailyMatch = lower.match(/(?:daily|everyday|every\s+day)\s+at\s+(.+)/)
  if (dailyMatch) {
    const time = parseTime(dailyMatch[1]!)
    return `${time.minute} ${time.hour} * * *`
  }

  // Match 'weekdays at TIME' or 'every weekday at TIME'
  const weekdaysMatch = lower.match(/(?:every\s+)?weekdays?\s+at\s+(.+)/)
  if (weekdaysMatch) {
    const time = parseTime(weekdaysMatch[1]!)
    return `${time.minute} ${time.hour} * * 1-5`
  }

  // Match 'weekends at TIME'
  const weekendsMatch = lower.match(/weekends?\s+at\s+(.+)/)
  if (weekendsMatch) {
    const time = parseTime(weekendsMatch[1]!)
    return `${time.minute} ${time.hour} * * 0,6`
  }

  // Match 'DAY at TIME'
  const dayTimeMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(.+)/)
  if (dayTimeMatch) {
    const dayName = dayTimeMatch[1]!.charAt(0).toUpperCase() + dayTimeMatch[1]!.slice(1)
    const dayNum = DAYS[dayName]
    const time = parseTime(dayTimeMatch[2]!)
    return `${time.minute} ${time.hour} * * ${dayNum}`
  }

  // Match 'weekly on DAY' or 'every week on DAY'
  const weeklyMatch = lower.match(/(?:every\s+)?week(?:ly)?\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(.+))?/)
  if (weeklyMatch) {
    const dayName = weeklyMatch[1]!.charAt(0).toUpperCase() + weeklyMatch[1]!.slice(1)
    const dayNum = DAYS[dayName]
    if (weeklyMatch[2]) {
      const time = parseTime(weeklyMatch[2])
      return `${time.minute} ${time.hour} * * ${dayNum}`
    }
    return `0 0 * * ${dayNum}`
  }

  // Match 'first day of month' or 'first of month' or '1st of month'
  const firstOfMonthMatch = lower.match(/^(?:first|1st)\s+(?:day\s+)?of\s+month(?:\s+at\s+(.+))?/)
  if (firstOfMonthMatch) {
    if (firstOfMonthMatch[1]) {
      const time = parseTime(firstOfMonthMatch[1])
      return `${time.minute} ${time.hour} 1 * *`
    }
    return '0 0 1 * *'
  }

  // Match 'last day of month' - not supported in standard cron
  if (lower.includes('last day of month') || lower.includes('last of month')) {
    throw new Error('last day of month is not supported in standard cron')
  }

  // Match 'Nth of month' (e.g., '15th of month')
  const nthOfMonthMatch = lower.match(/^(\d+)(?:st|nd|rd|th)\s+(?:day\s+)?of\s+month(?:\s+at\s+(.+))?/)
  if (nthOfMonthMatch) {
    const day = parseInt(nthOfMonthMatch[1]!, 10)
    if (day < 1 || day > 31) {
      throw new Error(`Invalid day of month: ${day}`)
    }
    if (nthOfMonthMatch[2]) {
      const time = parseTime(nthOfMonthMatch[2])
      return `${time.minute} ${time.hour} ${day} * *`
    }
    return `0 0 ${day} * *`
  }

  throw new Error(`Unrecognized schedule format: ${schedule}`)
}

/**
 * Synchronous version for backward compatibility
 * Uses regex fallback only (no AI)
 */
function parseNaturalSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim()

  // Check cache first (includes common patterns)
  const cached = cronCache.get(lower)
  if (cached) {
    if (cached === 'UNSUPPORTED') {
      throw new Error('last day of month is not supported in standard cron')
    }
    return cached
  }

  return parseNaturalScheduleRegex(lower)
}

// ============================================================================
// CRON GENERATION
// ============================================================================

/**
 * Generate a cron expression for a day/time combination
 */
function toCron(day: string, time?: string | { minute: string; hour: string }): string {
  const dayNum = DAYS[day] ?? '*'

  // Handle interval shortcuts
  if (day === 'hour') {
    return '0 * * * *'
  }
  if (day === 'minute') {
    return '* * * * *'
  }

  // If no time specified, default to midnight
  if (!time) {
    return `0 0 * * ${dayNum}`
  }

  // If time is a string (from TIMES lookup or .at() method)
  if (typeof time === 'string') {
    const timeInfo = TIMES[time]
    if (timeInfo) {
      return `${timeInfo.minute} ${timeInfo.hour} * * ${dayNum}`
    }
    // Parse the time string
    const parsed = parseTime(time)
    return `${parsed.minute} ${parsed.hour} * * ${dayNum}`
  }

  // Time is already parsed
  return `${time.minute} ${time.hour} * * ${dayNum}`
}

/**
 * Generate a unique schedule name
 */
function generateScheduleName(cron: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 6)
  return `schedule-${timestamp}-${random}`
}

// ============================================================================
// SCHEDULE BUILDER PROXY
// ============================================================================

export interface ScheduleTimeProxy {
  (handler: ScheduleHandler): void
  at(time: string): (handler: ScheduleHandler) => void
  at6am: (handler: ScheduleHandler) => void
  at7am: (handler: ScheduleHandler) => void
  at8am: (handler: ScheduleHandler) => void
  at9am: (handler: ScheduleHandler) => void
  at10am: (handler: ScheduleHandler) => void
  at11am: (handler: ScheduleHandler) => void
  at12pm: (handler: ScheduleHandler) => void
  at1pm: (handler: ScheduleHandler) => void
  at2pm: (handler: ScheduleHandler) => void
  at3pm: (handler: ScheduleHandler) => void
  at4pm: (handler: ScheduleHandler) => void
  at5pm: (handler: ScheduleHandler) => void
  at6pm: (handler: ScheduleHandler) => void
  atnoon: (handler: ScheduleHandler) => void
  atmidnight: (handler: ScheduleHandler) => void
}

export interface ScheduleBuilderProxy {
  (schedule: string, handler: ScheduleHandler): void
  Monday: ScheduleTimeProxy
  Tuesday: ScheduleTimeProxy
  Wednesday: ScheduleTimeProxy
  Thursday: ScheduleTimeProxy
  Friday: ScheduleTimeProxy
  Saturday: ScheduleTimeProxy
  Sunday: ScheduleTimeProxy
  day: ScheduleTimeProxy
  weekday: ScheduleTimeProxy
  weekend: ScheduleTimeProxy
  hour: (handler: ScheduleHandler) => void
  minute: (handler: ScheduleHandler) => void
}

/**
 * Create a schedule builder proxy for fluent scheduling DSL.
 *
 * Returns a proxy object that supports both property-based fluent syntax
 * (e.g., `every.Monday.at9am`) and function call syntax for natural language
 * (e.g., `every('daily at 9am')`).
 *
 * The proxy automatically:
 * - Converts fluent patterns to cron expressions
 * - Registers schedules with the Durable Object alarm API
 * - Notifies callbacks when schedules are registered
 *
 * @param config - Configuration for the schedule builder
 * @param config.state - Durable Object state for alarm management
 * @param config.onScheduleRegistered - Optional callback when a schedule is registered
 * @param config.env - Optional environment bindings for AI-powered parsing
 * @returns A proxy object implementing the fluent scheduling DSL
 *
 * @example Basic usage in a Durable Object
 * ```typescript
 * class MyWorkflow extends DurableObject {
 *   private every: ScheduleBuilderProxy
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.every = createScheduleBuilderProxy({
 *       state: ctx.state,
 *       onScheduleRegistered: (cron, name, handler) => {
 *         console.log(`Registered schedule ${name}: ${cron}`)
 *       }
 *     })
 *   }
 *
 *   async setup() {
 *     // Fluent syntax
 *     this.every.Monday.at9am(() => this.weeklyReport())
 *
 *     // Natural language
 *     this.every('every 5 minutes', () => this.healthCheck())
 *   }
 * }
 * ```
 *
 * @example Using .at() for dynamic times
 * ```typescript
 * const every = createScheduleBuilderProxy({ state })
 *
 * // Dynamic time string
 * every.day.at('9:30am')(() => handleMeeting())
 * every.weekday.at('17:00')(() => endOfDay())
 * ```
 */
export function createScheduleBuilderProxy(config: ScheduleBuilderConfig): ScheduleBuilderProxy {
  const { state, onScheduleRegistered } = config

  /**
   * Register a schedule - stores cron and sets alarm
   */
  const registerSchedule = async (cron: string, handler: ScheduleHandler): Promise<void> => {
    const name = generateScheduleName(cron)

    // Notify callback if provided
    if (onScheduleRegistered) {
      onScheduleRegistered(cron, name, handler)
    }

    // Set alarm for next occurrence
    // This requires calculating the next run time from the cron expression
    // For now, we'll use a simple approach - in production, this would use getNextRunTime
    const nextRun = calculateNextRun(cron)
    if (nextRun) {
      await state.storage.setAlarm(nextRun)
    }
  }

  /**
   * Calculate next run time from cron expression
   * Simplified version - for full implementation, use getNextRunTime from ScheduleManager
   */
  const calculateNextRun = (cron: string): Date | null => {
    // Parse cron: minute hour dayOfMonth month dayOfWeek
    const parts = cron.split(' ')
    if (parts.length !== 5) return null

    const [minutePart, hourPart, , , dayOfWeekPart] = parts

    const now = new Date()
    let nextRun = new Date(now)

    // Start from next minute
    nextRun.setUTCSeconds(0, 0)
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1)

    // Simple iteration to find next match (max 1 week)
    const maxIterations = 60 * 24 * 7 // 1 week of minutes
    for (let i = 0; i < maxIterations; i++) {
      const minute = nextRun.getUTCMinutes()
      const hour = nextRun.getUTCHours()
      const dayOfWeek = nextRun.getUTCDay()

      if (
        matchesCronField(minute, minutePart!) &&
        matchesCronField(hour, hourPart!) &&
        matchesCronField(dayOfWeek, dayOfWeekPart!)
      ) {
        return nextRun
      }

      nextRun = new Date(nextRun.getTime() + 60000) // Add 1 minute
    }

    return null
  }

  /**
   * Check if a value matches a cron field
   */
  const matchesCronField = (value: number, field: string): boolean => {
    if (field === '*') return true

    // Handle step values like */5
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return value % step === 0
    }

    // Handle ranges like 1-5
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number)
      return value >= start! && value <= end!
    }

    // Handle lists like 0,6
    if (field.includes(',')) {
      const values = field.split(',').map(Number)
      return values.includes(value)
    }

    // Single value
    return value === parseInt(field, 10)
  }

  /**
   * Create a time proxy for a specific day
   */
  const createTimeProxy = (day: string): ScheduleTimeProxy => {
    const baseHandler = (handler: ScheduleHandler): void => {
      const cron = toCron(day)
      registerSchedule(cron, handler)
    }

    return new Proxy(baseHandler as ScheduleTimeProxy, {
      get(_, prop: string) {
        // Handle .at('time') method
        if (prop === 'at') {
          return (time: string) => (handler: ScheduleHandler) => {
            const cron = toCron(day, time)
            registerSchedule(cron, handler)
          }
        }

        // Handle preset times like at9am, atnoon
        if (TIMES[prop]) {
          return (handler: ScheduleHandler) => {
            const cron = toCron(day, prop)
            registerSchedule(cron, handler)
          }
        }

        return undefined
      },
    })
  }

  // Main proxy handler
  const baseHandler = (schedule: string, handler: ScheduleHandler): void => {
    const cron = parseNaturalSchedule(schedule)
    registerSchedule(cron, handler)
  }

  return new Proxy(baseHandler as ScheduleBuilderProxy, {
    get(_, prop: string) {
      // Handle interval shortcuts
      if (prop === 'hour') {
        return (handler: ScheduleHandler) => {
          const cron = '0 * * * *'
          registerSchedule(cron, handler)
        }
      }

      if (prop === 'minute') {
        return (handler: ScheduleHandler) => {
          const cron = '* * * * *'
          registerSchedule(cron, handler)
        }
      }

      // Handle day names and special days
      if (DAYS[prop] !== undefined) {
        return createTimeProxy(prop)
      }

      return undefined
    },
  })
}

// Export new parsing functions for testing and external use
export {
  parseNaturalSchedule,
  parseNaturalScheduleRegex,
  parseNaturalScheduleWithAI,
  isValidCron,
  cronCache,
}

/**
 * Clear the cron cache (useful for testing)
 */
export function clearCronCache(): void {
  cronCache.clear()
  // Re-initialize with common patterns
  for (const [pattern, cron] of Object.entries(COMMON_PATTERNS)) {
    cronCache.set(pattern, cron)
  }
}

export default createScheduleBuilderProxy
