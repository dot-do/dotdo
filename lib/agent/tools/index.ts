/**
 * Tool Adapters for Claude Code in Workers
 *
 * Maps Claude SDK tools (Read, Write, Edit, Glob, Grep, Bash)
 * to fsx.do and bashx.do capabilities for running agents in Workers.
 *
 * @module lib/agent/tools
 */

// Types
export * from './types'

// Adapters
export { ReadToolAdapter } from './read'
export { WriteToolAdapter } from './write'
export { EditToolAdapter } from './edit'
export { GlobToolAdapter } from './glob'
export { GrepToolAdapter } from './grep'
export { BashToolAdapter } from './bash'

import type { ToolAdapter, ToolContext } from './types'
import { ReadToolAdapter } from './read'
import { WriteToolAdapter } from './write'
import { EditToolAdapter } from './edit'
import { GlobToolAdapter } from './glob'
import { GrepToolAdapter } from './grep'
import { BashToolAdapter } from './bash'

/**
 * All available tool adapters
 */
export const toolAdapters = {
  Read: new ReadToolAdapter(),
  Write: new WriteToolAdapter(),
  Edit: new EditToolAdapter(),
  Glob: new GlobToolAdapter(),
  Grep: new GrepToolAdapter(),
  Bash: new BashToolAdapter(),
} as const

/**
 * Get all tool adapters as an array
 */
export function getAllToolAdapters(): ToolAdapter[] {
  return Object.values(toolAdapters)
}

/**
 * Get a tool adapter by name
 */
export function getToolAdapter(name: string): ToolAdapter | undefined {
  return (toolAdapters as Record<string, ToolAdapter>)[name]
}

/**
 * Create a tool context for executing tools
 */
export function createToolContext(
  fs: ToolContext['fs'],
  options: {
    bash?: ToolContext['bash']
    cwd?: string
    env?: Record<string, string>
    uid?: number
    gid?: number
  } = {}
): ToolContext {
  return {
    fs,
    bash: options.bash,
    cwd: options.cwd ?? '/',
    readFiles: new Set(),
    env: options.env,
    uid: options.uid,
    gid: options.gid,
  }
}

/**
 * Execute a tool by name with the given input and context
 */
export async function executeTool<T = unknown>(
  name: string,
  input: unknown,
  context: ToolContext
): Promise<T> {
  const adapter = getToolAdapter(name)
  if (!adapter) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return adapter.execute(input, context) as Promise<T>
}
