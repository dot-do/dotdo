/**
 * Smart Reverse Detection
 *
 * Issue: dotdo-gxsn4
 *
 * Detects if a property name is a reverse form of a known relationship type.
 * For example, "followedBy" is the reverse of "follows".
 *
 * This enables ergonomic graph traversal syntax:
 * - `user.$follows` -> outgoing 'follows' edges
 * - `user.$followedBy` -> incoming 'follows' edges (auto-detected reverse)
 *
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-smart-reverse.ts
 */

/**
 * Result of reverse detection analysis.
 */
export interface ReverseDetectionResult {
  /** True if the property name is a reverse form (e.g., "followedBy") */
  isReverse: boolean
  /** The canonical relationship type (e.g., "follows" from "followedBy") */
  relType: string
  /** The traversal direction: "in" for reverse, "out" for direct */
  direction: 'in' | 'out'
}

/**
 * Detects if a property name is a reverse form of a known relationship type.
 *
 * RED PHASE STUB - This is intentionally not implemented.
 * Tests should fail until GREEN phase implementation.
 *
 * @param prop - The property name to analyze (e.g., "followedBy", "likedBy")
 * @param knownRelTypes - Set of known relationship types in the schema
 * @returns Analysis result with isReverse, relType, and direction
 *
 * @example
 * const known = new Set(['follows', 'likes'])
 * detectReverse('followedBy', known) // { isReverse: true, relType: 'follows', direction: 'in' }
 * detectReverse('follows', known)    // { isReverse: false, relType: 'follows', direction: 'out' }
 * detectReverse('unknown', known)    // { isReverse: false, relType: 'unknown', direction: 'out' }
 */
export function detectReverse(prop: string, knownRelTypes: Set<string>): ReverseDetectionResult {
  // RED PHASE: Intentionally incorrect implementation
  // This will cause all reverse detection tests to fail
  // GREEN phase will implement proper pattern matching

  // Only check if it's a direct known relationship
  if (knownRelTypes.has(prop)) {
    return {
      isReverse: false,
      relType: prop,
      direction: 'out',
    }
  }

  // Stub: Return as unknown relationship (tests will fail for reverse detection)
  return {
    isReverse: false,
    relType: prop,
    direction: 'out',
  }
}
