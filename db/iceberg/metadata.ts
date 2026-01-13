/**
 * Iceberg Metadata Parser
 *
 * Parses Iceberg table metadata.json files for fast point lookups.
 * This enables direct navigation to data files without R2 SQL overhead,
 * reducing query latency from 500ms-2s to 50-150ms.
 *
 * Supports both Iceberg format version 1 (legacy) and version 2 (current).
 *
 * @module db/iceberg/metadata
 * @see https://iceberg.apache.org/spec/#table-metadata
 */

// ============================================================================
// Types - Iceberg Specification Types
// ============================================================================

/**
 * Iceberg table metadata structure (format version 1 and 2)
 *
 * This is the root object in a metadata.json file that describes
 * the complete state of an Iceberg table.
 *
 * @see https://iceberg.apache.org/spec/#table-metadata-fields
 */
export interface IcebergMetadata {
  /** Format version (1 or 2) */
  formatVersion: number
  /** UUID for the table, generated on initial creation */
  tableUuid: string
  /** Base location of the table (e.g., s3://bucket/warehouse/table) */
  location: string
  /** Monotonically increasing sequence number for commits */
  lastSequenceNumber: number
  /** Timestamp (ms) when metadata was last updated */
  lastUpdatedMs: number
  /** Highest field ID across all schemas */
  lastColumnId: number
  /** ID of the current schema */
  currentSchemaId: number
  /** All schemas that have been used by the table */
  schemas: IcebergSchema[]
  /** ID of the default partition spec */
  defaultSpecId: number
  /** All partition specs used by the table */
  partitionSpecs: PartitionSpec[]
  /** Highest partition field ID */
  lastPartitionId: number
  /** ID of the default sort order */
  defaultSortOrderId: number
  /** All sort orders used by the table */
  sortOrders: SortOrder[]
  /** ID of the current snapshot, or null for empty tables */
  currentSnapshotId: number | null
  /** All valid snapshots for the table */
  snapshots: Snapshot[]
  /** Log of snapshot changes (optional) */
  snapshotLog?: SnapshotLogEntry[]
  /** Log of metadata file changes (optional) */
  metadataLog?: MetadataLogEntry[]
  /** Named references to snapshots (branches and tags) */
  refs?: Record<string, SnapshotRef>
  /** Table properties */
  properties?: Record<string, string>
}

/**
 * Iceberg schema definition
 *
 * Schemas are immutable once created. Schema evolution creates
 * new schemas with incremented schema IDs.
 *
 * @see https://iceberg.apache.org/spec/#schemas-and-data-types
 */
export interface IcebergSchema {
  /** Unique ID for this schema */
  schemaId: number
  /** Always 'struct' for top-level schemas */
  type: 'struct'
  /** Fields in this schema */
  fields: SchemaField[]
  /** Field IDs that uniquely identify a row (optional) */
  identifierFieldIds?: number[]
}

/**
 * Schema field definition
 *
 * Each field has a unique ID that is stable across schema evolution.
 * Field IDs are never reused.
 */
export interface SchemaField {
  /** Unique field ID (stable across schema evolution) */
  id: number
  /** Field name */
  name: string
  /** Whether the field is required (non-nullable) */
  required: boolean
  /** Field type (primitive string or nested NestedType) */
  type: string | NestedType
  /** Documentation for the field (optional) */
  doc?: string
  /** Initial default value for new rows (optional) */
  initialDefault?: unknown
  /** Write default for existing rows (optional) */
  writeDefault?: unknown
}

/**
 * Nested type for complex fields (struct, list, map)
 *
 * @see https://iceberg.apache.org/spec/#nested-types
 */
export interface NestedType {
  /** Nested type kind */
  type: 'struct' | 'list' | 'map'
  /** Fields for struct types */
  fields?: SchemaField[]
  /** Element field ID for list types */
  elementId?: number
  /** Element type for list types */
  element?: string | NestedType
  /** Whether list elements are required */
  elementRequired?: boolean
  /** Key field ID for map types */
  keyId?: number
  /** Key type for map types (always required) */
  key?: string
  /** Value field ID for map types */
  valueId?: number
  /** Value type for map types */
  value?: string | NestedType
  /** Whether map values are required */
  valueRequired?: boolean
}

/**
 * Partition specification
 *
 * Defines how data is partitioned for efficient querying.
 *
 * @see https://iceberg.apache.org/spec/#partitioning
 */
export interface PartitionSpec {
  /** Unique ID for this spec */
  specId: number
  /** Partition fields */
  fields: PartitionField[]
}

/**
 * Partition field definition
 *
 * Maps a source column to a partition value using a transform.
 */
export interface PartitionField {
  /** ID of the source column in the schema */
  sourceId: number
  /** ID of this partition field */
  fieldId: number
  /** Name of the partition field */
  name: string
  /** Transform to apply (identity, bucket[N], truncate[N], year, month, day, hour) */
  transform: string
}

/**
 * Sort order specification
 *
 * Defines the default ordering for data in data files.
 *
 * @see https://iceberg.apache.org/spec/#sorting
 */
export interface SortOrder {
  /** Unique ID for this sort order */
  orderId: number
  /** Sort fields */
  fields: SortField[]
}

/**
 * Sort field definition
 */
export interface SortField {
  /** ID of the source column */
  sourceId: number
  /** Transform to apply before sorting */
  transform: string
  /** Sort direction */
  direction: 'asc' | 'desc'
  /** Null ordering */
  nullOrder: 'nulls-first' | 'nulls-last'
}

/**
 * Snapshot definition
 *
 * A snapshot represents the state of a table at a point in time.
 * Each snapshot references a manifest list containing all data files.
 *
 * @see https://iceberg.apache.org/spec/#snapshots
 */
export interface Snapshot {
  /** Unique snapshot ID */
  snapshotId: number
  /** ID of the parent snapshot (for lineage) */
  parentSnapshotId?: number
  /** Sequence number of this snapshot */
  sequenceNumber: number
  /** Timestamp (ms) when snapshot was created */
  timestampMs: number
  /** Path to the manifest list file */
  manifestList: string
  /** Summary of the snapshot operation */
  summary: SnapshotSummary
  /** Schema ID used for this snapshot */
  schemaId?: number
}

/**
 * Snapshot summary with operation and metrics
 */
export interface SnapshotSummary {
  /** Type of operation that created this snapshot */
  operation: 'append' | 'replace' | 'overwrite' | 'delete'
  /** Additional string metrics (added-files-size, added-records, etc.) */
  [key: string]: string
}

/**
 * Snapshot log entry for tracking snapshot history
 */
export interface SnapshotLogEntry {
  /** Timestamp when snapshot became current */
  timestampMs: number
  /** Snapshot ID */
  snapshotId: number
}

/**
 * Metadata log entry for tracking metadata file history
 */
export interface MetadataLogEntry {
  /** Timestamp when metadata file was written */
  timestampMs: number
  /** Path to the metadata file */
  metadataFile: string
}

/**
 * Snapshot reference (branch or tag)
 *
 * Branches track mutable state, tags are immutable references.
 */
export interface SnapshotRef {
  /** Snapshot ID this reference points to */
  snapshotId: number
  /** Reference type */
  type: 'branch' | 'tag'
  /** Minimum snapshots to keep for branch (optional) */
  minSnapshotsToKeep?: number
  /** Maximum age of snapshots to keep (optional) */
  maxSnapshotAgeMs?: number
  /** Maximum age of the reference itself (optional) */
  maxRefAgeMs?: number
}

// ============================================================================
// Types - Parser Result Types
// ============================================================================

/**
 * Parsed metadata result with essential fields for point lookups
 *
 * This is the simplified view returned by parseMetadata() containing
 * only the fields needed for efficient data file navigation.
 */
export interface ParsedMetadata {
  /** Current snapshot ID (null if table is empty) */
  currentSnapshotId: number | null
  /** Current schema (null if no schemas defined) */
  currentSchema: IcebergSchema | null
  /** All schemas for schema evolution support */
  schemas: IcebergSchema[]
  /** Current partition spec (null if unpartitioned) */
  partitionSpec: PartitionSpec | null
  /** Base table location */
  location: string
  /** Iceberg format version (1 or 2) */
  formatVersion: number
  /** Table properties */
  properties: Record<string, string>
}

/**
 * Successful parse result
 */
export interface ParseResult<T> {
  success: true
  data: T
}

/**
 * Error result with actionable error information
 */
export interface ParseError {
  success: false
  /** Human-readable error message with actionable details */
  error: string
  /** Error category for programmatic handling */
  code: ParseErrorCode
}

/**
 * Error codes for parse failures
 *
 * - INVALID_JSON: Input is not valid JSON
 * - INVALID_FORMAT: JSON structure doesn't match Iceberg spec
 * - MISSING_REQUIRED: Required field is missing
 * - UNSUPPORTED_VERSION: Format version is not supported
 */
export type ParseErrorCode = 'INVALID_JSON' | 'INVALID_FORMAT' | 'MISSING_REQUIRED' | 'UNSUPPORTED_VERSION'

/** Result type for parseMetadata() */
export type ParseMetadataResult = ParseResult<ParsedMetadata> | ParseError

// ============================================================================
// Internal Helper Functions
// ============================================================================

/** Raw JSON data type for type-safe property access */
type RawObject = Record<string, unknown>

/**
 * Creates a parse error with consistent formatting
 *
 * @param code - Error category
 * @param message - Human-readable error message
 * @returns ParseError object
 */
function createParseError(code: ParseErrorCode, message: string): ParseError {
  return { success: false, error: message, code }
}

/**
 * Maps a raw JSON field to a SchemaField
 *
 * @param rawField - Raw field object from JSON
 * @returns Typed SchemaField
 */
function mapRawFieldToSchemaField(rawField: RawObject): SchemaField {
  return {
    id: rawField.id as number,
    name: rawField.name as string,
    required: rawField.required as boolean,
    type: rawField.type as string | NestedType,
    doc: rawField.doc as string | undefined,
  }
}

/**
 * Maps a raw JSON partition field to a PartitionField
 *
 * @param rawField - Raw partition field from JSON
 * @returns Typed PartitionField
 */
function mapRawFieldToPartitionField(rawField: RawObject): PartitionField {
  return {
    sourceId: rawField['source-id'] as number,
    fieldId: rawField['field-id'] as number,
    name: rawField.name as string,
    transform: rawField.transform as string,
  }
}

/**
 * Parses a raw JSON schema into an IcebergSchema
 *
 * @param rawSchema - Raw schema object from JSON
 * @returns Parsed IcebergSchema or null if invalid
 */
function parseRawSchema(rawSchema: RawObject): IcebergSchema | null {
  if (!rawSchema.fields || !Array.isArray(rawSchema.fields)) {
    return null
  }

  const fields = (rawSchema.fields as RawObject[]).map(mapRawFieldToSchemaField)

  return {
    schemaId: (rawSchema['schema-id'] as number) ?? 0,
    type: 'struct',
    fields,
    identifierFieldIds: rawSchema['identifier-field-ids'] as number[] | undefined,
  }
}

/**
 * Parses schemas from v2 metadata format
 *
 * @param data - Raw metadata object
 * @returns Array of parsed schemas or ParseError
 */
function parseSchemasV2(data: RawObject): IcebergSchema[] | ParseError {
  const rawSchemas = data.schemas as RawObject[]
  const schemas: IcebergSchema[] = []

  for (const rawSchema of rawSchemas) {
    const schema = parseRawSchema(rawSchema)
    if (schema === null) {
      return createParseError(
        'INVALID_FORMAT',
        'Invalid format: schema fields must be an array. Ensure each schema has a "fields" property containing an array of field definitions.'
      )
    }
    schemas.push(schema)
  }

  return schemas
}

/**
 * Parses schema from v1 metadata format (single schema object)
 *
 * @param data - Raw metadata object
 * @returns Array containing single schema
 */
function parseSchemaV1(data: RawObject): IcebergSchema[] {
  if (!data.schema) {
    return []
  }

  const rawSchema = data.schema as RawObject
  const fields = (rawSchema.fields as RawObject[]) || []

  return [
    {
      schemaId: 0,
      type: 'struct',
      fields: fields.map(mapRawFieldToSchemaField),
    },
  ]
}

/**
 * Parses partition spec from v2 format (partition-specs array)
 *
 * @param data - Raw metadata object
 * @returns Partition spec or null
 */
function parsePartitionSpecV2(data: RawObject): PartitionSpec | null {
  const specs = data['partition-specs'] as RawObject[] | undefined
  if (!specs || !Array.isArray(specs)) {
    return null
  }

  const defaultSpecId = (data['default-spec-id'] as number) || 0
  const rawSpec = specs.find((s) => s['spec-id'] === defaultSpecId)

  if (!rawSpec) {
    return null
  }

  const fields = (rawSpec.fields as RawObject[]) || []

  return {
    specId: rawSpec['spec-id'] as number,
    fields: fields.map(mapRawFieldToPartitionField),
  }
}

/**
 * Parses partition spec from v1 format (partition-spec array)
 *
 * @param data - Raw metadata object
 * @returns Partition spec or null
 */
function parsePartitionSpecV1(data: RawObject): PartitionSpec | null {
  const spec = data['partition-spec'] as RawObject[] | undefined
  if (!spec || !Array.isArray(spec)) {
    return null
  }

  return {
    specId: 0,
    fields: spec.map(mapRawFieldToPartitionField),
  }
}

// ============================================================================
// Public Parser Functions
// ============================================================================

/**
 * Parse Iceberg metadata.json content
 *
 * Parses a metadata.json string and extracts the essential fields needed
 * for efficient point lookups and data file navigation.
 *
 * @example
 * ```typescript
 * const result = parseMetadata(metadataJsonString)
 * if (result.success) {
 *   console.log('Snapshot ID:', result.data.currentSnapshotId)
 *   console.log('Location:', result.data.location)
 * } else {
 *   console.error(`Parse failed [${result.code}]: ${result.error}`)
 * }
 * ```
 *
 * @param content - Raw JSON string from metadata.json file
 * @returns ParseMetadataResult with parsed data or error details
 */
export function parseMetadata(content: string): ParseMetadataResult {
  // Step 1: Parse JSON
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return createParseError(
      'INVALID_JSON',
      'Invalid JSON: failed to parse metadata content. Ensure the file contains valid JSON.'
    )
  }

  // Step 2: Validate basic structure
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createParseError(
      'INVALID_FORMAT',
      'Invalid format: metadata must be an object. The root of metadata.json should be a JSON object, not an array or primitive.'
    )
  }

  const data = raw as RawObject

  // Step 3: Check required fields with actionable error messages
  if (!('format-version' in data)) {
    return createParseError(
      'MISSING_REQUIRED',
      'Missing required field: format-version. Every Iceberg metadata file must include "format-version" (1 or 2).'
    )
  }

  if (!('location' in data)) {
    return createParseError(
      'MISSING_REQUIRED',
      'Missing required field: location. The "location" field specifies the base path for table data (e.g., "s3://bucket/warehouse/table").'
    )
  }

  // Step 4: Validate format version
  const formatVersion = data['format-version'] as number
  if (formatVersion !== 1 && formatVersion !== 2) {
    return createParseError(
      'UNSUPPORTED_VERSION',
      `Unsupported format version: ${formatVersion}. This parser supports Iceberg format versions 1 and 2. Received version ${formatVersion}.`
    )
  }

  // Step 5: V2 requires schemas array
  if (formatVersion === 2 && !('schemas' in data)) {
    return createParseError(
      'MISSING_REQUIRED',
      'Missing required field: schemas (required for v2). Iceberg v2 metadata must include a "schemas" array with at least one schema definition.'
    )
  }

  // Step 6: Parse schemas based on format version
  let schemas: IcebergSchema[]
  if (formatVersion === 2) {
    const schemasResult = parseSchemasV2(data)
    if (!Array.isArray(schemasResult)) {
      return schemasResult // Return the ParseError
    }
    schemas = schemasResult
  } else {
    schemas = parseSchemaV1(data)
  }

  // Step 7: Get and validate current schema
  const currentSchemaId = formatVersion === 2 ? (data['current-schema-id'] as number) : 0
  const currentSchema = schemas.find((s) => s.schemaId === currentSchemaId) || null

  if (schemas.length > 0 && currentSchema === null) {
    return createParseError(
      'INVALID_FORMAT',
      `Invalid format: current-schema-id ${currentSchemaId} references non-existent schema. Available schema IDs: ${schemas.map((s) => s.schemaId).join(', ')}.`
    )
  }

  // Step 8: Parse partition spec based on format version
  const partitionSpec = parsePartitionSpecV2(data) || parsePartitionSpecV1(data)

  // Step 9: Validate current snapshot ID references a valid snapshot
  const currentSnapshotId = (data['current-snapshot-id'] as number | null) ?? null
  const snapshots = (data.snapshots as RawObject[]) || []

  if (currentSnapshotId !== null) {
    const snapshotExists = snapshots.some((s) => s['snapshot-id'] === currentSnapshotId)
    if (!snapshotExists) {
      const availableIds = snapshots.map((s) => s['snapshot-id']).slice(0, 5)
      const suffix = snapshots.length > 5 ? ` (and ${snapshots.length - 5} more)` : ''
      return createParseError(
        'INVALID_FORMAT',
        `Invalid format: current-snapshot-id ${currentSnapshotId} references non-existent snapshot. Available snapshot IDs: ${availableIds.join(', ')}${suffix}.`
      )
    }
  }

  // Step 10: Parse properties
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
 * Retrieves the snapshot referenced by currentSnapshotId from the
 * snapshots array. Returns null for empty tables or if the snapshot
 * ID is not found.
 *
 * @example
 * ```typescript
 * const snapshot = getCurrentSnapshot(metadata)
 * if (snapshot) {
 *   console.log('Manifest list:', snapshot.manifestList)
 * }
 * ```
 *
 * @param metadata - Full IcebergMetadata object
 * @returns Current Snapshot or null if no current snapshot
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
 * Looks up a schema by its unique schema ID. Useful for finding
 * the schema associated with a specific snapshot.
 *
 * @example
 * ```typescript
 * const schema = getSchemaById(metadata, snapshot.schemaId)
 * if (schema) {
 *   console.log('Fields:', schema.fields.map(f => f.name))
 * }
 * ```
 *
 * @param metadata - Full IcebergMetadata object
 * @param schemaId - Schema ID to find
 * @returns IcebergSchema or null if not found
 */
export function getSchemaById(metadata: IcebergMetadata, schemaId: number): IcebergSchema | null {
  return metadata.schemas.find((s) => s.schemaId === schemaId) || null
}

/**
 * Get field names from a schema
 *
 * Extracts the names of all top-level fields in a schema.
 *
 * @example
 * ```typescript
 * const fieldNames = getFieldNames(schema)
 * // ['ns', 'type', 'id', 'ts', 'data']
 * ```
 *
 * @param schema - IcebergSchema to extract field names from
 * @returns Array of field names
 */
export function getFieldNames(schema: IcebergSchema): string[] {
  return schema.fields.map((f) => f.name)
}

/**
 * Get partition field names from a partition spec
 *
 * Returns the source field names (from the schema) for each partition field.
 * This is useful for understanding which columns are used for partitioning.
 *
 * Note: Returns the source field name, not the partition field name.
 * For example, a bucket partition on "id" with name "id_bucket" will
 * return "id", not "id_bucket".
 *
 * @example
 * ```typescript
 * const partitionCols = getPartitionFieldNames(spec, schema)
 * // ['ns', 'type'] for identity partitioning
 * ```
 *
 * @param spec - PartitionSpec to extract field names from
 * @param schema - Associated IcebergSchema for source field lookup
 * @returns Array of source field names used in partitioning
 */
export function getPartitionFieldNames(spec: PartitionSpec, schema: IcebergSchema): string[] {
  return spec.fields.map((pf) => {
    // Look up the source field by ID to get the actual column name
    const sourceField = schema.fields.find((f) => f.id === pf.sourceId)
    // Fall back to partition field name if source field not found
    return sourceField?.name || pf.name
  })
}

/**
 * Validate metadata against Iceberg specification
 *
 * Performs structural validation to check if an object conforms to
 * the Iceberg metadata specification. This is a type guard that
 * narrows the type to IcebergMetadata.
 *
 * Note: This performs minimal validation for efficiency. Use parseMetadata()
 * for complete validation with detailed error messages.
 *
 * @example
 * ```typescript
 * if (validateMetadata(json)) {
 *   // json is now typed as IcebergMetadata
 *   console.log('Format version:', json['format-version'])
 * }
 * ```
 *
 * @param metadata - Unknown value to validate
 * @returns True if metadata conforms to Iceberg spec structure
 */
export function validateMetadata(metadata: unknown): metadata is IcebergMetadata {
  // Check basic object structure
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false
  }

  const data = metadata as RawObject

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
