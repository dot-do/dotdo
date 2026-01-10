/**
 * dotdo - Durable Object Framework
 *
 * A comprehensive framework for building applications with Cloudflare Durable Objects.
 *
 * ## DO Class Hierarchy
 *
 * ```
 * DOTiny (~15KB)        - Identity, db, fetch, toJSON
 *    |
 *    v
 * DO (~80KB)            - + WorkflowContext, stores, events, scheduling
 *    |
 *    v
 * DOFull (~120KB)       - + Lifecycle, sharding, branching, promotion
 * ```
 *
 * ## Entry Points (by size)
 *
 * - `dotdo/tiny` - Minimal DO (DOTiny, ~15KB)
 * - `dotdo/base` - Core DO with workflow context (DO, ~80KB)
 * - `dotdo`      - Full DO with fs/git/bash mixins (DOFull + mixins)
 * - `dotdo/full` - Same as default (all capabilities)
 *
 * @example
 * ```ts
 * // Full capabilities (default)
 * import { DO, Agent, Workflow } from 'dotdo'
 *
 * // Minimal footprint
 * import { DO } from 'dotdo/tiny'
 *
 * // Core without lifecycle ops
 * import { DO } from 'dotdo/base'
 * ```
 */

// Re-export DO from full.ts (includes all capabilities)
export { DO, capabilities, withFs, withGit, withBash } from './full'

// Core Durable Object classes (excluding base DO which is overridden above)
export { Agent, Human, Worker } from '../objects'
export { Entity, Collection, Directory, Package, Product } from '../objects'
export { Business, App, Site, SaaS } from '../objects'
export { Workflow } from '../objects'
export { Function } from '../objects'
export { Service, API, SDK, CLI } from '../objects'

// Type definitions
export * from '../types'

// Code snippets for common patterns
export * from '../snippets'

// Client SDK - $() function for Cap'n Web RPC
export { $ } from '../sdk/index.js'
export type { ChainStep, RpcError, RpcPromise, RpcClient } from '../sdk/index.js'
