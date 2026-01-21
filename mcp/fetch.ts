// fetch tool - MCP tool that fetches a single Thing by $id with enrichments
// See do-7rf.2.3

export { createFetchTool, type FetchParams, type FetchToolDeps, type EnrichedThing } from './tools/fetch'
import type { MCPTool } from './server'

/**
 * Default fetch tool export - NOT DIRECTLY USABLE
 *
 * IMPORTANT: This is a placeholder export that cannot be used directly.
 * You must create a configured instance using the factory function.
 *
 * Why? The fetch tool needs access to store dependencies (things, relationships,
 * events) to retrieve and enrich data. Since these are injected at runtime,
 * we use a factory pattern.
 *
 * @example Correct usage - Create tool with factory
 * ```typescript
 * import { createFetchTool } from '@dotdo/mcp'
 *
 * // Create tool with store dependencies
 * const fetchTool = createFetchTool({
 *   things: myThingsStore,
 *   relationships: myRelationshipsStore,
 *   events: myEventsStore
 * })
 * server.addTool(fetchTool)
 *
 * // Now the tool can fetch and enrich Things
 * const result = await fetchTool.execute({
 *   $id: 'user-123',
 *   include: ['relationships', 'events']
 * })
 * ```
 *
 * @example INCORRECT usage - This will throw an error
 * ```typescript
 * import { fetchTool } from '@dotdo/mcp'
 *
 * // ❌ This will fail at runtime when execute() is called
 * server.addTool(fetchTool)
 * await fetchTool.execute({ $id: 'user-123' }) // throws error
 * ```
 *
 * @throws Error with instructions when execute() is called without proper initialization
 * @see createFetchTool for the factory function to create a working tool
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
  /**
   * Placeholder execute method - WILL THROW ERROR
   *
   * This method always throws an error to guide developers to use the factory pattern.
   * The fetchTool export cannot function without store dependencies (things, relationships,
   * events) injected at runtime via createFetchTool().
   *
   * @throws Always throws with instructions to use createFetchTool() instead
   */
  execute: async () => {
    throw new Error(
      'fetchTool cannot be used directly - it requires dependency injection.\n\n' +
      'Use the factory pattern instead:\n\n' +
      '  import { createFetchTool } from "@dotdo/mcp"\n' +
      '  const fetchTool = createFetchTool({\n' +
      '    things: myThingsStore,\n' +
      '    relationships: myRelationshipsStore,\n' +
      '    events: myEventsStore\n' +
      '  })\n' +
      '  server.addTool(fetchTool)\n\n' +
      'Why? The fetch tool needs store dependencies to retrieve and enrich data.\n' +
      'Since dependencies are injected at runtime, we use a factory function.\n\n' +
      'See createFetchTool() JSDoc for complete examples and options.'
    )
  }
}
