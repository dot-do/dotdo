import type { RpcPromise } from 'capnweb'

// ============================================================================
// THING - Base entity type (fully qualified URL identity)
// ============================================================================

export interface ThingData {
  // Fully qualified URLs for unambiguous identity
  $id: string // URL: 'https://startups.studio/headless.ly'
  $type: string // URL: 'https://startups.studio/Startup' (Noun URL)

  // Core fields
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>

  // Timestamps
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

// Parsed from $id for convenience (computed, not stored)
export interface ThingIdentity {
  url: URL // Parsed URL object
  ns: string // Namespace/DO: 'https://startups.studio'
  path: string // Path after ns: 'headless.ly'
}

export interface Thing extends ThingData {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY (computed from $id)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly identity: ThingIdentity

  // A Thing that IS a DO has $id matching its namespace
  readonly isDO: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS (merged from relationships table)
  // ═══════════════════════════════════════════════════════════════════════════

  // Outbound edges by verb (camelCase)
  // e.g., { manages: { $type: 'https://schema.org/Person', $id: '...', name: 'John' } }
  relationships: Record<string, Thing | Thing[]>

  // Inbound edges by reverse verb
  // e.g., { managedBy: { $type: 'https://startups.studio/Business', $id: '...', name: 'Acme' } }
  references: Record<string, Thing | Thing[]>

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // Update this Thing
  update(data: Partial<ThingData>): RpcPromise<Thing>

  // Delete this Thing
  delete(): RpcPromise<void>

  // Promote this Thing to its own DO (becomes a namespace)
  promote(): RpcPromise<ThingDO>

  // Create a relationship to another Thing/URL
  relate(verb: string, to: string | Thing): RpcPromise<void>

  // Remove a relationship
  unrelate(verb: string, to: string | Thing): RpcPromise<void>
}

// ============================================================================
// THING DO - A Thing that has been promoted to its own Durable Object
// ============================================================================

export interface ThingDO extends Thing {
  // This Thing IS a DO (namespace)
  readonly isDO: true

  // Can contain its own Things collections
  collection<T extends Thing = Thing>(noun: string): import('./Things').Things<T>
}

// ═══════════════════════════════════════════════════════════════════════════
// URL PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export function parseThingId($id: string): ThingIdentity {
  // $id is a fully qualified URL
  // Examples:
  //   'https://startups.studio/headless.ly'
  //   'https://headless.ly/App/main'
  //   'https://startups.studio/Startup' (a Noun/type itself)

  const url = new URL($id)
  const ns = `${url.protocol}//${url.host}`
  const path = url.pathname.slice(1) // Remove leading /

  return { url, ns, path }
}

export function buildThingId(ns: string, path: string): string {
  // ns: 'https://startups.studio'
  // path: 'headless.ly'
  // → 'https://startups.studio/headless.ly'
  return `${ns}/${path}`
}

export function isThingADO(thing: Thing): boolean {
  // A Thing is a DO when its $id IS the namespace (no path)
  const { path } = parseThingId(thing.$id)
  return path === '' || thing.$id === thing.identity.ns
}
