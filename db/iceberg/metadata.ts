/**
 * Iceberg Metadata Parser
 *
 * Parses Iceberg table metadata.json files for fast point lookups.
 * This enables direct navigation to data files without R2 SQL overhead.
 *
 * @see https://iceberg.apache.org/spec/#table-metadata
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Iceberg table metadata structure (format version 2)
 */
export interface IcebergMetadata {
  formatVersion: number
  tableUuid: string
  location: string
  lastSequenceNumber: number
  lastUpdatedMs: number
  lastColumnId: number
  currentSchemaId: number
  schemas: IcebergSchema[]
  defaultSpecId: number
  partitionSpecs: PartitionSpec[]
  lastPartitionId: number
  defaultSortOrderId: number
  sortOrders: SortOrder[]
  currentSnapshotId: number | null
  snapshots: Snapshot[]
  snapshotLog?: SnapshotLogEntry[]
  metadataLog?: MetadataLogEntry[]
  refs?: Record<string, SnapshotRef>
  properties?: Record<string, string>
}

/**
 * Iceberg schema definition
 */
export interface IcebergSchema {
  schemaId: number
  type: 'struct'
  fields: SchemaField[]
  identifierFieldIds?: number[]
}

/**
 * Schema field definition
 */
export interface SchemaField {
  id: number
  name: string
  required: boolean
  type: string | NestedType
  doc?: string
  initialDefault?: unknown
  writeDefault?: unknown
}

/**
 * Nested type for complex fields (struct, list, map)
 */
export interface NestedType {
  type: 'struct' | 'list' | 'map'
  fields?: SchemaField[]
  elementId?: number
  element?: string | NestedType
  elementRequired?: boolean
  keyId?: number
  key?: string
  valueId?: number
  value?: string | NestedType
  valueRequired?: boolean
}

/**
 * Partition specification
 */
export interface PartitionSpec {
  specId: number
  fields: PartitionField[]
}

/**
 * Partition field definition
 */
export interface PartitionField {
  sourceId: number
  fieldId: number
  name: string
  transform: string
}

/**
 * Sort order specification
 */
export interface SortOrder {
  orderId: number
  fields: SortField[]
}

/**
 * Sort field definition
 */
export interface SortField {
  sourceId: number
  transform: string
  direction: 'asc' | 'desc'
  nullOrder: 'nulls-first' | 'nulls-last'
}

/**
 * Snapshot definition
 */
export interface Snapshot {
  snapshotId: number
  parentSnapshotId?: number
  sequenceNumber: number
  timestampMs: number
  manifestList: string
  summary: SnapshotSummary
  schemaId?: number
}

/**
 * Snapshot summary with operation and metrics
 */
export interface SnapshotSummary {
  operation: 'append' | 'replace' | 'overwrite' | 'delete'
  [key: string]: string
}

/**
 * Snapshot log entry
 */
export interface SnapshotLogEntry {
  timestampMs: number
  snapshotId: number
}

/**
 * Metadata log entry
 */
export interface MetadataLogEntry {
  timestampMs: number
  metadataFile: string
}

/**
 * Snapshot reference (branch or tag)
 */
export interface SnapshotRef {
  snapshotId: number
  type: 'branch' | 'tag'
  minSnapshotsToKeep?: number
  maxSnapshotAgeMs?: number
  maxRefAgeMs?: number
}

// ============================================================================
// Parser Result Types
// ============================================================================

export interface ParsedMetadata {
  currentSnapshotId: number | null
  currentSchema: IcebergSchema | null
  schemas: IcebergSchema[]
  partitionSpec: PartitionSpec | null
  location: string
  formatVersion: number
  properties: Record<string, string>
}

export interface ParseResult<T> {
  success: true
  data: T
}

export interface ParseError {
  success: false
  error: string
  code: 'INVALID_JSON' | 'INVALID_FORMAT' | 'MISSING_REQUIRED' | 'UNSUPPORTED_VERSION'
}

export type ParseMetadataResult = ParseResult<ParsedMetadata> | ParseError

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse Iceberg metadata.json content
 *
 * @param content - Raw JSON string from metadata.json file
 * @returns Parsed metadata or error
 */
export function parseMetadata(content: string): ParseMetadataResult {
  // Parse JSON
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return {
      success: false,
      error: 'Invalid JSON: failed to parse metadata content',
      code: 'INVALID_JSON',
    }
  }

  // Validate basic structure
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      success: false,
      error: 'Invalid format: metadata must be an object',
      code: 'INVALID_FORMAT',
    }
  }

  const data = raw as Record<string, unknown>

  // Check required fields
  if (!('format-version' in data)) {
    return {
      success: false,
      error: 'Missing required field: format-version',
      code: 'MISSING_REQUIRED',
    }
  }

  if (!('location' in data)) {
    return {
      success: false,
      error: 'Missing required field: location',
      code: 'MISSING_REQUIRED',
    }
  }

  const formatVersion = data['format-version'] as number
  if (formatVersion !== 1 && formatVersion !== 2) {
    return {
      success: false,
      error: `Unsupported format version: ${formatVersion}`,
      code: 'UNSUPPORTED_VERSION',
    }
  }

  // V2 requires schemas array
  if (formatVersion === 2 && !('schemas' in data)) {
    return {
      success: false,
      error: 'Missing required field: schemas (required for v2)',
      code: 'MISSING_REQUIRED',
    }
  }

  // Parse schemas
  let schemas: IcebergSchema[] = []
  if (formatVersion === 2 && data.schemas) {
    const rawSchemas = data.schemas as Array<Record<string, unknown>>
    for (const rawSchema of rawSchemas) {
      if (!rawSchema.fields || !Array.isArray(rawSchema.fields)) {
        return {
          success: false,
          error: 'Invalid format: schema fields must be an array',
          code: 'INVALID_FORMAT',
        }
      }
      schemas.push({
        schemaId: rawSchema['schema-id'] as number,
        type: 'struct',
        fields: (rawSchema.fields as Array<Record<string, unknown>>).map((f) => ({
          id: f.id as number,
          name: f.name as string,
          required: f.required as boolean,
          type: f.type as string | NestedType,
          doc: f.doc as string | undefined,
        })),
        identifierFieldIds: rawSchema['identifier-field-ids'] as number[] | undefined,
      })
    }
  } else if (formatVersion === 1 && data.schema) {
    // V1 has single schema object
    const rawSchema = data.schema as Record<string, unknown>
    schemas.push({
      schemaId: 0,
      type: 'struct',
      fields: ((rawSchema.fields as Array<Record<string, unknown>>) || []).map((f) => ({
        id: f.id as number,
        name: f.name as string,
        required: f.required as boolean,
        type: f.type as string | NestedType,
        doc: f.doc as string | undefined,
      })),
    })
  }

  // Get current schema ID
  const currentSchemaId = formatVersion === 2 ? (data['current-schema-id'] as number) : 0

  // Validate current-schema-id references a valid schema
  const currentSchema = schemas.find((s) => s.schemaId === currentSchemaId) || null
  if (schemas.length > 0 && currentSchema === null) {
    return {
      success: false,
      error: `Invalid format: current-schema-id ${currentSchemaId} references non-existent schema`,
      code: 'INVALID_FORMAT',
    }
  }

  // Parse partition specs
  let partitionSpec: PartitionSpec | null = null
  if (data['partition-specs'] && Array.isArray(data['partition-specs'])) {
    const defaultSpecId = (data['default-spec-id'] as number) || 0
    const rawSpec = (data['partition-specs'] as Array<Record<string, unknown>>).find(
      (s) => s['spec-id'] === defaultSpecId
    )
    if (rawSpec) {
      partitionSpec = {
        specId: rawSpec['spec-id'] as number,
        fields: ((rawSpec.fields as Array<Record<string, unknown>>) || []).map((f) => ({
          sourceId: f['source-id'] as number,
          fieldId: f['field-id'] as number,
          name: f.name as string,
          transform: f.transform as string,
        })),
      }
    }
  } else if (data['partition-spec'] && Array.isArray(data['partition-spec'])) {
    // V1 format
    partitionSpec = {
      specId: 0,
      fields: (data['partition-spec'] as Array<Record<string, unknown>>).map((f) => ({
        sourceId: f['source-id'] as number,
        fieldId: f['field-id'] as number,
        name: f.name as string,
        transform: f.transform as string,
      })),
    }
  }

  // Parse current snapshot ID
  const currentSnapshotId = (data['current-snapshot-id'] as number | null) ?? null

  // Validate current-snapshot-id references a valid snapshot
  const snapshots = (data.snapshots as Array<Record<string, unknown>>) || []
  if (currentSnapshotId !== null) {
    const snapshotExists = snapshots.some((s) => s['snapshot-id'] === currentSnapshotId)
    if (!snapshotExists) {
      return {
        success: false,
        error: `Invalid format: current-snapshot-id ${currentSnapshotId} references non-existent snapshot`,
        code: 'INVALID_FORMAT',
      }
    }
  }

  // Parse properties
  const properties = (data.properties as Record<string, string>) || {}

  return {
    success: true,
    data: {
      currentSnapshotId,
      currentSchema,
      schemas,
      partitionSpec,
      location: data.location as string,
      formatVersion,
      properties,
    },
  }
}

/**
 * Get the current snapshot from parsed metadata
 *
 * @param metadata - Parsed Iceberg metadata
 * @returns Current snapshot or null if no snapshots exist
 */
export function getCurrentSnapshot(metadata: IcebergMetadata): Snapshot | null {
  if (metadata.currentSnapshotId === null) {
    return null
  }
  return metadata.snapshots.find((s) => s.snapshotId === metadata.currentSnapshotId) || null
}

/**
 * Get schema by ID from metadata
 *
 * @param metadata - Parsed Iceberg metadata
 * @param schemaId - Schema ID to find
 * @returns Schema or null if not found
 */
export function getSchemaById(metadata: IcebergMetadata, schemaId: number): IcebergSchema | null {
  return metadata.schemas.find((s) => s.schemaId === schemaId) || null
}

/**
 * Get field names from a schema
 *
 * @param schema - Iceberg schema
 * @returns Array of field names
 */
export function getFieldNames(schema: IcebergSchema): string[] {
  return schema.fields.map((f) => f.name)
}

/**
 * Get partition field names from a partition spec
 *
 * @param spec - Partition specification
 * @param schema - Associated schema
 * @returns Array of partition field names (source field names, not partition field names)
 */
export function getPartitionFieldNames(spec: PartitionSpec, schema: IcebergSchema): string[] {
  return spec.fields.map((pf) => {
    // Find the source field in the schema by sourceId
    const sourceField = schema.fields.find((f) => f.id === pf.sourceId)
    return sourceField?.name || pf.name
  })
}

/**
 * Validate metadata against Iceberg specification
 *
 * @param metadata - Raw parsed JSON
 * @returns Validation result
 */
export function validateMetadata(metadata: unknown): metadata is IcebergMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false
  }

  const data = metadata as Record<string, unknown>

  // Check format-version exists and is a number
  if (!('format-version' in data) || typeof data['format-version'] !== 'number') {
    return false
  }

  // Check location exists and is a string
  if (!('location' in data) || typeof data['location'] !== 'string') {
    return false
  }

  // For v2, check schemas is an array
  if (data['format-version'] === 2) {
    if (!('schemas' in data) || !Array.isArray(data.schemas)) {
      return false
    }
  }

  return true
}
