/**
 * CRDT Item IDs
 *
 * Each item in a CRDT has a unique ID consisting of:
 * - clientId: Unique identifier for the client/replica
 * - clock: Logical timestamp from the client's Lamport clock
 *
 * This combination guarantees global uniqueness without coordination.
 */

export interface ItemId {
  clientId: string
  clock: number
}

/**
 * Compare two ItemIds for ordering
 * Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareIds(a: ItemId, b: ItemId): number {
  // First compare by clock (older items first)
  if (a.clock !== b.clock) {
    return a.clock - b.clock
  }
  // Tie-break by clientId (lexicographic)
  return a.clientId.localeCompare(b.clientId)
}

/**
 * Check if two ItemIds are equal
 */
export function idsEqual(a: ItemId | null | undefined, b: ItemId | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.clientId === b.clientId && a.clock === b.clock
}

/**
 * Serialize ItemId to string for use as Map key
 */
export function idToString(id: ItemId): string {
  return `${id.clientId}:${id.clock}`
}

/**
 * Parse ItemId from string
 */
export function stringToId(str: string): ItemId {
  const [clientId, clockStr] = str.split(':')
  return {
    clientId,
    clock: parseInt(clockStr, 10),
  }
}

/**
 * Generate a random client ID
 */
export function generateClientId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Create an ItemId from components
 */
export function createId(clientId: string, clock: number): ItemId {
  return { clientId, clock }
}
