/**
 * Core exports for dotdo DO hierarchy
 *
 * This module exports only core-level abstractions.
 * Each layer has its own barrel export to maintain proper layered architecture:
 *
 * - core/index.ts     -> DOCore (this file)
 * - semantic/index.ts -> DOSemantic
 * - storage/index.ts  -> DOStorageClass
 * - workflow/index.ts -> DOWorkflowClass
 * - objects/index.ts  -> DOFull
 *
 * Class Hierarchy (one-way dependency):
 * DOCore (~5KB) <- DOSemantic <- DOStorage <- DOWorkflow <- DOFull
 *
 * NOTE: For wrangler bindings, use api/index.ts which re-exports all DO classes.
 * The core barrel intentionally exports only core-level code to prevent
 * circular dependencies and maintain clean layered architecture.
 */

// Export core-level class and types only
export { DOCore, type DOCoreEnv } from './DOCore'

// Default worker handler for DOCore
import { DOCore, type DOCoreEnv } from './DOCore'

export default {
  async fetch(request: Request, env: DOCoreEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOCore.idFromName(ns)
    const stub = env.DOCore.get(id)

    return stub.fetch(request)
  },
}
