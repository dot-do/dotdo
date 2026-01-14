/**
 * Flexible REST lookup utilities
 *
 * Provides functions to distinguish between ID-based and name-based lookups
 * for flexible REST endpoints like GET /api/:type/:lookup
 */

/**
 * Check if a string looks like an ID rather than a name.
 * IDs are: numeric strings, UUIDs, ULIDs, or hyphenated identifiers.
 * Names are: alphabetic words, possibly with spaces.
 *
 * @param value The string to check
 * @returns true if the value looks like an ID, false if it looks like a name
 */
export function isValidId(value: string): boolean {
  // Empty or whitespace-only strings are not IDs
  if (!value || !value.trim()) {
    return false
  }

  // Numeric string (e.g., '123', '000123', '0')
  if (/^\d+$/.test(value)) {
    return true
  }

  // UUID-like or hyphenated ID (contains hyphens and alphanumeric)
  // This covers:
  // - UUID v4: 550e8400-e29b-41d4-a716-446655440000
  // - Custom: abc-def-ghi, id-with-multiple-segments
  if (/^[a-zA-Z0-9-]+$/.test(value) && value.includes('-')) {
    return true
  }

  // ULID format: 26-character alphanumeric string (no hyphens)
  // ULIDs are: 01ARZ3NDEKTSV4RRFFQ69G5FAV
  // Pattern: exactly 26 chars, all uppercase letters or digits
  if (/^[A-Z0-9]{26}$/.test(value)) {
    return true
  }

  // Otherwise, treat as a name (alphabetic, spaces, special chars, etc.)
  return false
}

/**
 * Build a query object for looking up a resource by ID or name.
 *
 * @param value The lookup value (either an ID or name)
 * @param noun The resource type (e.g., 'Customer', 'Product')
 * @returns A query object with either $id or name property
 */
export function buildLookupQuery(value: string, noun: string): Record<string, unknown> {
  if (isValidId(value)) {
    return { $id: value }
  }
  return { name: value }
}
