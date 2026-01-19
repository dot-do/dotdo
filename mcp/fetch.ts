// fetch tool - MCP tool that fetches a single Thing by $id with enrichments
// See do-7rf.2.3

export { createFetchTool, type FetchParams, type FetchToolDeps, type EnrichedThing } from './tools/fetch'
import type { MCPTool } from './server'

/**
 * Default fetch tool (requires dependencies injection via createFetchTool)
 *
 * Usage:
 *   const fetchTool = createFetchTool({ things, relationships, events })
 *   server.addTool(fetchTool)
 */
export const fetchTool: MCPTool = {
  name: 'fetch',
  description: 'Fetch a single Thing by $id with optional enrichments (relationships, events)',
  inputSchema: {
    type: 'object',
    properties: {
      $id: { type: 'string' },
      include: { type: 'array', items: { type: 'string', enum: ['relationships', 'events'] } }
    },
    required: ['$id']
  },
  execute: async () => {
    throw new Error('fetchTool must be created with createFetchTool(deps)')
  }
}
