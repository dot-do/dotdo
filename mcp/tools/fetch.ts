// fetch tool - MCP tool that fetches a single Thing by $id with enrichments
import type { MCPTool } from '../server'
import type { ThingsStore } from '../../db/things'
import type { RelationshipsStore } from '../../db/relationships'
import type { EventsStore } from '../../db/events'

export interface FetchParams {
  $id: string
  include?: ('relationships' | 'events')[]
}

export interface FetchToolDeps {
  things: ThingsStore
  relationships: RelationshipsStore
  events: EventsStore
}

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
      // Validate params
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: expected object')
      }

      const { $id, include = [] } = params as FetchParams

      // Validate $id
      if (!$id || typeof $id !== 'string') {
        throw new Error('Invalid $id: expected non-empty string')
      }

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
