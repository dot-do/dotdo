/**
 * Git Operation Tools for Agents
 *
 * Tools for interacting with Git repositories.
 * Enables agents to stage files and create commits.
 *
 * @module agents/tools/git-tools
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { AgentTool } from './types'

const execAsync = promisify(exec)

/**
 * Stage files for commit.
 *
 * Adds files to the Git staging area (index).
 * Equivalent to `git add <path>`.
 *
 * @example
 * ```typescript
 * await gitAddTool.execute({
 *   path: 'src/new-feature.ts'
 * })
 * ```
 */
export const gitAddTool: AgentTool = {
  name: 'git_add',
  description: 'Stage files for commit.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory to stage' },
    },
    required: ['path'],
  },
  execute: async (input) => {
    const filePath = input.path as string

    try {
      await execAsync(`git add "${filePath}"`)
      return { success: true, path: filePath }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  },
}

/**
 * Commit staged changes.
 *
 * Creates a new Git commit with the staged changes.
 * Equivalent to `git commit -m "<message>"`.
 *
 * @example
 * ```typescript
 * await gitCommitTool.execute({
 *   message: 'feat: add new search feature'
 * })
 * ```
 */
export const gitCommitTool: AgentTool = {
  name: 'git_commit',
  description: 'Commit staged changes.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message' },
    },
    required: ['message'],
  },
  execute: async (input) => {
    const message = input.message as string

    try {
      await execAsync(`git commit -m "${message}"`)
      return { success: true, message }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  },
}

/**
 * All Git operation tools
 */
export const GIT_TOOLS: AgentTool[] = [gitAddTool, gitCommitTool]
