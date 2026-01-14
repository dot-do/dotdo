/**
 * SyncPlan - Bidirectional data synchronization configuration
 *
 * Defines the schema and types for configuring sync operations between
 * data sources with support for:
 * - Full refresh, incremental, bidirectional, and upsert modes
 * - Field mappings with transformations
 * - Conflict resolution strategies
 * - Scheduling via CRON expressions
 * - Filtering via expressions
 *
 * @module db/primitives/sync-plan
 */

import { z } from 'zod'

// =============================================================================
// SYNC MODE
// =============================================================================

/**
 * Sync mode determines how data flows and changes are handled
 */
export const SyncModeSchema = z.enum([
  /** Complete replacement of destination data */
  'full',
  /** Only sync changes since last run using cursor */
  'incremental',
  /** Two-way sync with conflict resolution */
  'bidirectional',
  /** Insert new records, update existing based on primary key */
  'upsert',
])

export type SyncMode = z.infer<typeof SyncModeSchema>

// =============================================================================
// CONFLICT RESOLUTION
// =============================================================================

/**
 * Strategy for resolving conflicts in bidirectional sync
 */
export const ConflictResolutionStrategySchema = z.enum([
  /** Last write wins based on timestamp */
  'lww',
  /** Source always takes precedence */
  'source_wins',
  /** Destination always takes precedence */
  'destination_wins',
  /** Merge non-conflicting fields, flag conflicts */
  'merge',
  /** Custom resolution via handler function */
  'custom',
])

export type ConflictResolutionStrategy = z.infer<typeof ConflictResolutionStrategySchema>

/**
 * Conflict resolution configuration
 */
export const ConflictResolutionSchema = z.object({
  /** Resolution strategy to use */
  strategy: ConflictResolutionStrategySchema,

  /** Field to use for timestamp comparison (required for lww) */
  timestampField: z.string().optional(),

  /** Custom conflict handler name (required for custom strategy) */
  customHandler: z.string().optional(),

  /** Fields to prefer from source during merge */
  preferSourceFields: z.array(z.string()).optional(),

  /** Fields to prefer from destination during merge */
  preferDestinationFields: z.array(z.string()).optional(),
}).refine(
  (data) => {
    // lww requires timestampField
    if (data.strategy === 'lww' && !data.timestampField) {
      return false
    }
    // custom requires customHandler
    if (data.strategy === 'custom' && !data.customHandler) {
      return false
    }
    return true
  },
  {
    message: 'lww strategy requires timestampField; custom strategy requires customHandler',
  },
)

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>

// =============================================================================
// FIELD MAPPING
// =============================================================================

/**
 * Transformation to apply during field mapping
 */
export const FieldTransformSchema = z.enum([
  'none',
  'lowercase',
  'uppercase',
  'trim',
  'to_string',
  'to_number',
  'to_boolean',
  'to_date',
  'to_iso_date',
  'to_iso_datetime',
  'json_parse',
  'json_stringify',
])

export type FieldTransform = z.infer<typeof FieldTransformSchema>

/**
 * Mapping configuration for a single field
 */
export const FieldMappingSchema = z.object({
  /** Source field path (dot notation for nested fields) */
  source: z.string().min(1),

  /** Destination field path (dot notation for nested fields) */
  destination: z.string().min(1),

  /** Optional transformation to apply */
  transform: FieldTransformSchema.optional(),

  /** Default value if source is null/undefined */
  defaultValue: z.unknown().optional(),

  /** Whether this mapping is bidirectional (applies in reverse too) */
  bidirectional: z.boolean().optional().default(false),

  /** Condition expression for when to apply this mapping */
  condition: z.string().optional(),
})

export type FieldMapping = z.infer<typeof FieldMappingSchema>

// =============================================================================
// SOURCE/DESTINATION CONFIG
// =============================================================================

/**
 * Schema definition for source or destination
 */
export const EndpointSchemaSchema = z.object({
  /** Connector type (e.g., 'postgres', 'salesforce', 'duckdb') */
  type: z.string().min(1),

  /** Connection configuration (connector-specific) */
  config: z.record(z.string(), z.unknown()),

  /** Stream/table/entity name */
  stream: z.string().min(1),

  /** Optional namespace (schema, database) */
  namespace: z.string().optional(),
})

export type EndpointSchema = z.infer<typeof EndpointSchemaSchema>

// =============================================================================
// FILTER EXPRESSION
// =============================================================================

/**
 * Filter operator for expressions
 */
export const FilterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'ends_with',
  'is_null',
  'is_not_null',
])

export type FilterOperator = z.infer<typeof FilterOperatorSchema>

/**
 * Filter expression for sync operations
 */
export const FilterExpressionSchema = z.object({
  /** Field to filter on */
  field: z.string().min(1),

  /** Comparison operator */
  operator: FilterOperatorSchema,

  /** Value to compare against (not required for is_null/is_not_null) */
  value: z.unknown().optional(),
})

export type FilterExpression = z.infer<typeof FilterExpressionSchema>

// =============================================================================
// SCHEDULE
// =============================================================================

/**
 * CRON expression pattern for scheduling
 * Validates standard 5-field CRON syntax
 */
export const CronExpressionSchema = z.string().regex(
  /^(\*|([0-5]?\d)(-([0-5]?\d))?)(\/\d+)?(,(\*|([0-5]?\d)(-([0-5]?\d))?)(\/\d+)?)*\s+(\*|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?)(\/\d+)?(,(\*|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?)(\/\d+)?)*\s+(\*|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?(,(\*|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?)*\s+(\*|(1[0-2]|0?[1-9])(-((1[0-2]|0?[1-9])))?)(\/\d+)?(,(\*|(1[0-2]|0?[1-9])(-((1[0-2]|0?[1-9])))?)(\/\d+)?)*\s+(\*|[0-6](-[0-6])?)(\/\d+)?(,(\*|[0-6](-[0-6])?)(\/\d+)?)*$/,
  { message: 'Invalid CRON expression' },
)

export type CronExpression = z.infer<typeof CronExpressionSchema>

// =============================================================================
// SYNC PLAN
// =============================================================================

/**
 * Complete SyncPlan configuration
 */
export const SyncPlanSchema = z.object({
  /** Unique identifier for the sync plan */
  id: z.string().min(1),

  /** Human-readable name */
  name: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Source endpoint configuration */
  source: EndpointSchemaSchema,

  /** Destination endpoint configuration */
  destination: EndpointSchemaSchema,

  /** Field mappings from source to destination */
  fieldMappings: z.array(FieldMappingSchema).min(0),

  /** Sync mode */
  mode: SyncModeSchema,

  /** Primary key field(s) for matching records */
  primaryKey: z.union([z.string(), z.array(z.string())]),

  /** Optional CRON schedule */
  schedule: CronExpressionSchema.optional(),

  /** Optional filters to apply during sync */
  filters: z.array(FilterExpressionSchema).optional(),

  /** Conflict resolution configuration (required for bidirectional mode) */
  conflictResolution: ConflictResolutionSchema.optional(),

  /** Cursor field for incremental sync */
  cursorField: z.string().optional(),

  /** Batch size for sync operations */
  batchSize: z.number().int().positive().optional().default(1000),

  /** Whether the sync plan is enabled */
  enabled: z.boolean().optional().default(true),

  /** Rate limit (records per second) */
  rateLimit: z.number().positive().optional(),

  /** Metadata for tracking */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /** Created timestamp */
  createdAt: z.string().datetime().optional(),

  /** Updated timestamp */
  updatedAt: z.string().datetime().optional(),
}).refine(
  (data) => {
    // bidirectional mode requires conflictResolution
    if (data.mode === 'bidirectional' && !data.conflictResolution) {
      return false
    }
    // incremental mode requires cursorField
    if (data.mode === 'incremental' && !data.cursorField) {
      return false
    }
    return true
  },
  {
    message: 'bidirectional mode requires conflictResolution; incremental mode requires cursorField',
  },
)

export type SyncPlan = z.infer<typeof SyncPlanSchema>

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Parse result type
 */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError }

/**
 * Validate a SyncPlan configuration
 */
export function validateSyncPlan(data: unknown): ParseResult<SyncPlan> {
  const result = SyncPlanSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate field mappings reference existing source/destination fields
 * This is a semantic validation that requires schema information
 */
export function validateFieldMappings(
  mappings: FieldMapping[],
  sourceFields: string[],
  destinationFields: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const mapping of mappings) {
    // Check if source field exists (handle dot notation)
    const sourceRoot = mapping.source.split('.')[0]
    if (!sourceFields.includes(sourceRoot) && !sourceFields.includes(mapping.source)) {
      errors.push(`Source field '${mapping.source}' not found in source schema`)
    }

    // Check if destination field exists (handle dot notation)
    const destRoot = mapping.destination.split('.')[0]
    if (!destinationFields.includes(destRoot) && !destinationFields.includes(mapping.destination)) {
      errors.push(`Destination field '${mapping.destination}' not found in destination schema`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Type guard for SyncPlan
 */
export function isSyncPlan(data: unknown): data is SyncPlan {
  return SyncPlanSchema.safeParse(data).success
}

// =============================================================================
// SERIALIZATION
// =============================================================================

/**
 * Serialize a SyncPlan to JSON string
 */
export function serializeSyncPlan(plan: SyncPlan): string {
  return JSON.stringify(plan)
}

/**
 * Deserialize a SyncPlan from JSON string
 */
export function deserializeSyncPlan(json: string): ParseResult<SyncPlan> {
  try {
    const data = JSON.parse(json)
    return validateSyncPlan(data)
  } catch {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          message: 'Invalid JSON',
          path: [],
        },
      ]),
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a minimal SyncPlan with required fields
 */
export function createSyncPlan(
  config: Pick<SyncPlan, 'id' | 'name' | 'source' | 'destination' | 'mode' | 'primaryKey'> &
    Partial<Omit<SyncPlan, 'id' | 'name' | 'source' | 'destination' | 'mode' | 'primaryKey'>>,
): SyncPlan {
  const now = new Date().toISOString()
  return {
    fieldMappings: [],
    batchSize: 1000,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...config,
  }
}

/**
 * Create a full refresh SyncPlan
 */
export function createFullRefreshSyncPlan(
  id: string,
  name: string,
  source: EndpointSchema,
  destination: EndpointSchema,
  primaryKey: string | string[],
): SyncPlan {
  return createSyncPlan({
    id,
    name,
    source,
    destination,
    mode: 'full',
    primaryKey,
  })
}

/**
 * Create an incremental SyncPlan
 */
export function createIncrementalSyncPlan(
  id: string,
  name: string,
  source: EndpointSchema,
  destination: EndpointSchema,
  primaryKey: string | string[],
  cursorField: string,
): SyncPlan {
  return createSyncPlan({
    id,
    name,
    source,
    destination,
    mode: 'incremental',
    primaryKey,
    cursorField,
  })
}

/**
 * Create a bidirectional SyncPlan
 */
export function createBidirectionalSyncPlan(
  id: string,
  name: string,
  source: EndpointSchema,
  destination: EndpointSchema,
  primaryKey: string | string[],
  conflictResolution: ConflictResolution,
): SyncPlan {
  return createSyncPlan({
    id,
    name,
    source,
    destination,
    mode: 'bidirectional',
    primaryKey,
    conflictResolution,
  })
}

/**
 * Create an upsert SyncPlan
 */
export function createUpsertSyncPlan(
  id: string,
  name: string,
  source: EndpointSchema,
  destination: EndpointSchema,
  primaryKey: string | string[],
): SyncPlan {
  return createSyncPlan({
    id,
    name,
    source,
    destination,
    mode: 'upsert',
    primaryKey,
  })
}
