import { z } from 'zod'

export const ObservabilityEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['log', 'exception', 'request', 'do_method']),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  script: z.string().min(1),
  timestamp: z.number().int().nonnegative(),

  requestId: z.string().optional(),
  method: z.string().optional(),
  url: z.string().optional(),
  status: z.number().int().min(100).max(599).optional(),
  duration: z.number().nonnegative().optional(),

  doName: z.string().optional(),
  doId: z.string().optional(),
  doMethod: z.string().optional(),

  message: z.array(z.string()).optional(),
  stack: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type ObservabilityEvent = z.infer<typeof ObservabilityEventSchema>

export function validateObservabilityEvent(data: unknown): {
  success: boolean
  errors: Array<{ field: string; message: string }>
  data?: ObservabilityEvent
} {
  const result = ObservabilityEventSchema.safeParse(data)

  if (result.success) {
    return {
      success: true,
      errors: [],
      data: result.data,
    }
  }

  const errors = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }))

  return {
    success: false,
    errors,
  }
}

// ============================================================================
// ObsFilter - Filter type for querying observability events
// ============================================================================

export const ObsFilterSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    type: z.enum(['log', 'exception', 'request', 'do_method']).optional(),
    script: z.string().optional(),
    requestId: z.string().optional(),
    doName: z.string().optional(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: 'from must be less than or equal to to',
    path: ['from'],
  })

export type ObsFilter = z.infer<typeof ObsFilterSchema>

/**
 * Interface for ObservabilityEvent used in filtering.
 * This is a simplified interface for the matchesFilter function.
 */
interface FilterableEvent {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  type: 'log' | 'exception' | 'request' | 'do_method'
  script: string
  requestId?: string
  doName?: string
  message?: string | string[]
}

/**
 * Check if an observability event matches the given filter.
 * Filter fields use AND logic - all specified fields must match.
 *
 * @param event - The observability event to check
 * @param filter - The filter criteria
 * @returns true if the event matches all filter criteria
 */
export function matchesFilter(
  event: FilterableEvent,
  filter: ObsFilter
): boolean {
  // Empty filter matches everything
  if (Object.keys(filter).length === 0) return true

  // Check each filter field (AND logic)
  if (filter.level && event.level !== filter.level) return false
  if (filter.type && event.type !== filter.type) return false
  if (filter.script && event.script !== filter.script) return false
  if (filter.requestId && event.requestId !== filter.requestId) return false
  if (filter.doName && event.doName !== filter.doName) return false
  if (filter.from !== undefined && event.timestamp < filter.from) return false
  if (filter.to !== undefined && event.timestamp > filter.to) return false

  return true
}

/**
 * Validate an ObsFilter object and return detailed error information.
 *
 * @param filter - The filter object to validate
 * @returns Validation result with success flag and any errors
 */
export function validateObsFilter(filter: unknown): {
  success: boolean
  errors: Array<{ field: string; message: string }>
} {
  const result = ObsFilterSchema.safeParse(filter)

  if (result.success) {
    return {
      success: true,
      errors: [],
    }
  }

  const errors = result.error.issues.map((issue) => {
    let field: string

    if (issue.path.length > 0) {
      field = String(issue.path[0])
    } else if (
      issue.code === 'unrecognized_keys' &&
      'keys' in issue &&
      Array.isArray(issue.keys) &&
      issue.keys.length > 0
    ) {
      // For unrecognized keys, extract the field name from the keys array
      field = String(issue.keys[0])
    } else {
      field = 'unknown'
    }

    return {
      field,
      message: issue.message,
    }
  })

  return {
    success: false,
    errors,
  }
}
