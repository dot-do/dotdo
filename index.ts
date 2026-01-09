/**
 * dotdo - Durable Object Framework
 *
 * A comprehensive framework for building applications with Cloudflare Durable Objects.
 *
 * The default export includes all capabilities (fs, git, bash).
 * For tree-shakeable imports, use:
 * - dotdo/tiny - Minimal DO (no capabilities)
 * - dotdo/fs   - DO with filesystem
 * - dotdo/git  - DO with filesystem + git
 * - dotdo/bash - DO with filesystem + bash
 * - dotdo/full - DO with all capabilities (same as default)
 *
 * @example
 * ```ts
 * import { DO, Agent, Workflow } from 'dotdo'
 * import { Thing, Noun, Verb } from 'dotdo/types'
 * ```
 */

// Re-export DO from full.ts (includes all capabilities)
export { DO, capabilities, withFs, withGit, withBash } from './full'

// Core Durable Object classes (excluding base DO which is overridden above)
export { Agent, Human, Worker } from './objects'
export { Entity, Collection, Directory, Package, Product } from './objects'
export { Business, App, Site, SaaS } from './objects'
export { Workflow } from './objects'
export { Function } from './objects'
export { Service, API, SDK, CLI } from './objects'

// Type definitions
export * from './types'

// Code snippets for common patterns
export * from './snippets'
