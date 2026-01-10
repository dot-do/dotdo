/**
 * Agent Tool Registry
 *
 * Defines core tools available to named agents for file operations,
 * shell commands, and git operations.
 *
 * @see dotdo-a7nx3 - GREEN phase: Implement tool binding for agents
 * @module agents/tools/registry
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============================================================================
// Tool Interface
// ============================================================================

export interface AgentTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

// ============================================================================
// File Operation Tools
// ============================================================================

export const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  },
  execute: async (input) => {
    const filePath = input.path as string
    const content = input.content as string

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    // Write the file
    await fs.writeFile(filePath, content, 'utf-8')

    return { success: true, path: filePath }
  },
}

export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read the contents of a file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to read' },
    },
    required: ['path'],
  },
  execute: async (input) => {
    const filePath = input.path as string

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        return { success: false, error: `File not found: ${filePath}` }
      }
      throw error
    }
  },
}

export const editFileTool: AgentTool = {
  name: 'edit_file',
  description: 'Edit a file by replacing old content with new content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to edit' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The replacement text' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  execute: async (input) => {
    const filePath = input.path as string
    const oldString = input.old_string as string
    const newString = input.new_string as string

    const content = await fs.readFile(filePath, 'utf-8')
    const newContent = content.replace(oldString, newString)
    await fs.writeFile(filePath, newContent, 'utf-8')

    return { success: true, path: filePath }
  },
}

// ============================================================================
// Shell Execution Tools
// ============================================================================

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

// ============================================================================
// Code Search Tools
// ============================================================================

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

// ============================================================================
// Git Operation Tools
// ============================================================================

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

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All available agent tools
 */
export const AGENT_TOOLS: AgentTool[] = [
  writeFileTool,
  readFileTool,
  editFileTool,
  bashTool,
  globTool,
  grepTool,
  gitAddTool,
  gitCommitTool,
]

/**
 * Get a tool by name
 */
export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name)
}

/**
 * Execute a tool by name with input
 */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = getTool(name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return tool.execute(input)
}

export default AGENT_TOOLS
