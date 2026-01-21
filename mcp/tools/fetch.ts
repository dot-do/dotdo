/**
 * Fetch Tool - MCP tool that fetches a single Thing by $id with enrichments
 *
 * @module @dotdo/mcp/tools/fetch
 *
 * This tool is decoupled from @dotdo/db (do-7jse) and uses local type definitions.
 * Any store implementation that matches the interfaces in ../types.ts can be used.
 *
 * @example
 * ```typescript
 * import { createFetchTool } from '@dotdo/mcp'
 *
 * // With @dotdo/db stores (they implement the interfaces)
 * import { createThingsStore, createRelationshipsStore, createEventsStore } from '@dotdo/db'
 *
 * const fetchTool = createFetchTool({
 *   things: createThingsStore(),
 *   relationships: createRelationshipsStore(),
 *   events: createEventsStore()
 * })
 * ```
 */

import type { MCPTool } from '../server'
import type { ThingsStore, RelationshipsStore, EventsStore } from '../types'

export interface FetchParams {
  $id: string
  include?: ('relationships' | 'events')[]
}

/**
 * Type guard for FetchParams
 * Validates that the value is a valid FetchParams object
 */
export function isFetchParams(value: unknown): value is FetchParams {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // $id is required and must be a non-empty string
  if (typeof obj['$id'] !== 'string' || obj['$id'].length === 0) {
    return false
  }

  // include is optional, but if present must be an array of valid values
  if (obj['include'] !== undefined) {
    if (!Array.isArray(obj['include'])) {
      return false
    }
    const validIncludes = ['relationships', 'events']
    for (const item of obj['include']) {
      if (typeof item !== 'string' || !validIncludes.includes(item)) {
        return false
      }
    }
  }

  return true
}

/**
 * Dependencies for fetch tool
 * Uses minimal interfaces from ../types.ts instead of @dotdo/db
 */
export interface FetchToolDeps {
  /** ThingsStore for retrieving Things by $id */
  things: ThingsStore
  /** RelationshipsStore for enriching with related Things */
  relationships: RelationshipsStore
  /** EventsStore for enriching with event history */
  events: EventsStore
}

/**
 * Enriched Thing result with optional relationships and events
 */
export interface EnrichedThing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
  _links?: {
    self: string
  }
  _relationships?: Array<{
    subject: string
    predicate: string
    object: string
    $createdAt: number
  }>
  _events?: Array<{
    $id: string
    type: string
    payload: unknown
    $timestamp: number
    source?: string
    correlationId?: string
  }>
}

/**
 * Factory function to create a fetch tool that retrieves Things with optional enrichments
 *
 * This is the correct way to create a fetch tool. The default `fetchTool` export
 * is a placeholder and will throw an error if used directly.
 *
 * @param deps - Store dependencies for fetching and enriching data
 * @param deps.things - ThingsStore for retrieving Things by $id
 * @param deps.relationships - RelationshipsStore for enriching with related Things
 * @param deps.events - EventsStore for enriching with event history
 *
 * @returns A configured MCPTool ready to be added to an MCP server
 *
 * @example Basic usage - Fetch without enrichments
 * ```typescript
 * import { createFetchTool } from '@dotdo/mcp'
 * import { createMCPServer } from '@dotdo/mcp'
 *
 * const server = createMCPServer()
 * const fetchTool = createFetchTool({
 *   things: myThingsStore,
 *   relationships: myRelationshipsStore,
 *   events: myEventsStore
 * })
 * server.addTool(fetchTool)
 *
 * // Fetch a Thing by $id
 * const user = await fetchTool.execute({ $id: 'user-123' })
 * // Result: { $id: 'user-123', $type: 'User', name: 'Alice', ... }
 * ```
 *
 * @example Fetch with enrichments
 * ```typescript
 * // Fetch with relationships and events
 * const enrichedUser = await fetchTool.execute({
 *   $id: 'user-123',
 *   include: ['relationships', 'events']
 * })
 * // Result includes:
 * // - _relationships: [{ subject: 'user-123', predicate: 'owns', object: 'order-456' }, ...]
 * // - _events: [{ $id: 'evt-1', type: 'user.created', ... }, ...]
 * ```
 *
 * @example With @dotdo/db stores
 * ```typescript
 * import { createThingsStore, createRelationshipsStore, createEventsStore } from '@dotdo/db'
 *
 * const fetchTool = createFetchTool({
 *   things: createThingsStore(),
 *   relationships: createRelationshipsStore(),
 *   events: createEventsStore()
 * })
 * ```
 *
 * @throws Error if Thing not found or if invalid parameters provided
 */
export function createFetchTool(deps: FetchToolDeps): MCPTool {
  const { things, relationships, events } = deps

  return {
    name: 'fetch',
    description: 'Fetch a single Thing by $id with optional enrichments (relationships, events)',
    inputSchema: {
      type: 'object',
      properties: {
        $id: {
          type: 'string',
          description: 'The unique identifier of the Thing to fetch'
        },
        include: {
          type: 'array',
          description: 'Optional enrichments to include: "relationships", "events"',
          items: {
            type: 'string',
            enum: ['relationships', 'events']
          }
        }
      },
      required: ['$id']
    },
    execute: async (params: unknown): Promise<EnrichedThing> => {
      // Validate params using type guard
      if (!isFetchParams(params)) {
        throw new Error('Invalid parameters: expected object with valid $id string')
      }

      const { $id, include = [] } = params

      // Fetch the Thing
      const thing = await things.get($id)
      if (!thing) {
        throw new Error(`Thing not found: ${$id}`)
      }

      // Build enriched result
      const result: EnrichedThing = {
        ...thing,
        _links: {
          self: `/things/${$id}`
        }
      }

      // Include relationships if requested
      if (include.includes('relationships')) {
        // Get both outbound (where this Thing is subject) and inbound (where this Thing is object)
        const [outbound, inbound] = await Promise.all([
          relationships.find({ subject: $id }),
          relationships.find({ object: $id })
        ])

        result._relationships = [...outbound, ...inbound]
      }

      // Include events if requested
      if (include.includes('events')) {
        // Get recent events related to this Thing (max 100)
        const recentEvents = await events.query({
          source: $id,
          limit: 100
        })

        result._events = recentEvents
      }

      return result
    }
  }
}
