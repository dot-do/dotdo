/**
 * File Operation Tools for Agents
 *
 * Tools for reading, writing, and editing files from the filesystem.
 * These are core tools that enable agents to interact with codebases.
 *
 * @module agents/tools/file-tools
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { AgentTool } from './types'

/**
 * Write content to a file.
 *
 * Creates the file and any parent directories if they don't exist.
 * Overwrites existing content if the file already exists.
 *
 * @example
 * ```typescript
 * await writeFileTool.execute({
 *   path: '/path/to/file.ts',
 *   content: 'export const hello = "world"'
 * })
 * ```
 */
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

/**
 * Read the contents of a file.
 *
 * Returns the file content as a string, or an error if the file doesn't exist.
 *
 * @example
 * ```typescript
 * const result = await readFileTool.execute({
 *   path: '/path/to/file.ts'
 * })
 * // result.content contains the file contents
 * ```
 */
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

/**
 * Edit a file by replacing text.
 *
 * Finds the first occurrence of `old_string` and replaces it with `new_string`.
 * The file must exist for editing to succeed.
 *
 * @example
 * ```typescript
 * await editFileTool.execute({
 *   path: '/path/to/file.ts',
 *   old_string: 'const value = 1',
 *   new_string: 'const value = 42'
 * })
 * ```
 */
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

/**
 * All file operation tools
 */
export const FILE_TOOLS: AgentTool[] = [writeFileTool, readFileTool, editFileTool]
