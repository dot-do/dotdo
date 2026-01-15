/**
 * Objects Layer Exports - Main Entry Point
 *
 * This module exports all DO classes required by wrangler.toml bindings.
 * This is the main entry point specified in wrangler.toml.
 *
 * @module objects
 */

// Export all DO classes for wrangler bindings
export { DOCore, type DOCoreEnv } from '../core/DOCore'
export { DOSemantic } from '../semantic/DOSemantic'
export { DOStorageClass } from '../storage/DOStorage'
export { DOWorkflowClass } from '../workflow/DOWorkflow'
export { DOFull, type DOFullEnv } from './DOFull'
export { McpServer } from '../mcp/server'

// Default worker handler
import { DOFull, type DOFullEnv } from './DOFull'

export default {
  async fetch(request: Request, env: DOFullEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}
