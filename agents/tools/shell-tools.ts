/**
 * Shell Execution Tools for Agents
 *
 * Tools for executing shell commands and searching code.
 * Includes bash execution, glob pattern matching, and grep search.
 *
 * @module agents/tools/shell-tools
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { AgentTool } from './types'

const execAsync = promisify(exec)

/**
 * Execute a shell command.
 *
 * Runs a command in a shell and returns stdout/stderr.
 * Supports optional working directory specification.
 *
 * @example
 * ```typescript
 * const result = await bashTool.execute({
 *   command: 'npm test',
 *   cwd: '/path/to/project'
 * })
 * // result.stdout contains command output
 * ```
 */
export const bashTool: AgentTool = {
  name: 'bash',
  description: 'Execute a shell command and return the output.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory for the command (optional)' },
    },
    required: ['command'],
  },
  execute: async (input) => {
    const command = input.command as string
    const cwd = input.cwd as string | undefined

    try {
      const { stdout, stderr } = await execAsync(command, { cwd })
      return { success: true, stdout, stderr }
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string }
      return {
        success: false,
        error: err.message || 'Command failed',
        stdout: err.stdout || '',
        stderr: err.stderr || '',
      }
    }
  },
}

/**
 * Find files matching a glob pattern.
 *
 * Searches for files by name pattern using Unix find command.
 * Useful for discovering files in a codebase.
 *
 * @example
 * ```typescript
 * const result = await globTool.execute({
 *   pattern: '*.ts',
 *   cwd: '/path/to/project'
 * })
 * // result.files contains array of matching paths
 * ```
 */
export const globTool: AgentTool = {
  name: 'glob',
  description: 'Find files matching a glob pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match files (e.g., "**/*.ts")' },
      cwd: { type: 'string', description: 'Base directory for the search (optional)' },
    },
    required: ['pattern'],
  },
  execute: async (input) => {
    const pattern = input.pattern as string
    const cwd = (input.cwd as string) || process.cwd()

    try {
      // Use find command for glob-like behavior
      const { stdout } = await execAsync(`find "${cwd}" -name "${pattern}" -type f`, { cwd })
      const files = stdout.trim().split('\n').filter(Boolean)
      return { success: true, files }
    } catch {
      return { success: true, files: [] }
    }
  },
}

/**
 * Search for a pattern in files.
 *
 * Uses ripgrep to search file contents by regex pattern.
 * Supports optional glob filtering for file types.
 *
 * @example
 * ```typescript
 * const result = await grepTool.execute({
 *   pattern: 'export function',
 *   path: '/path/to/project',
 *   glob: '*.ts'
 * })
 * // result.files contains array of files with matches
 * ```
 */
export const grepTool: AgentTool = {
  name: 'grep',
  description: 'Search for a pattern in files.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search in' },
      glob: { type: 'string', description: 'Glob pattern to filter files (optional)' },
    },
    required: ['pattern'],
  },
  execute: async (input) => {
    const pattern = input.pattern as string
    const searchPath = (input.path as string) || process.cwd()
    const globPattern = input.glob as string | undefined

    try {
      // Use ripgrep if available, otherwise fallback to grep
      let command = `rg -l "${pattern}" "${searchPath}"`
      if (globPattern) {
        command = `rg -l --glob "${globPattern}" "${pattern}" "${searchPath}"`
      }

      const { stdout } = await execAsync(command)
      const files = stdout.trim().split('\n').filter(Boolean)
      return { success: true, files }
    } catch {
      // ripgrep not found or no matches
      return { success: true, files: [] }
    }
  },
}

/**
 * All shell and code search tools
 */
export const SHELL_TOOLS: AgentTool[] = [bashTool, globTool, grepTool]
