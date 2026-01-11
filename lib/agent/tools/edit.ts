/**
 * Edit Tool Adapter
 *
 * Maps Claude SDK Edit tool to fsx.do filesystem capabilities.
 * Performs exact string replacements with uniqueness checks.
 *
 * @module lib/agent/tools/edit
 */

import type {
  ToolAdapter,
  ToolContext,
  EditToolInput,
  EditToolOutput,
  JSONSchema,
} from './types'
import {
  FileNotFoundError,
  IsDirectoryError,
  PathTraversalError,
  NotUniqueError,
  FileNotReadError,
} from './types'

/**
 * Validate and normalize a file path
 */
function validatePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new PathTraversalError(path)
  }

  const parts = path.split('/').filter(Boolean)
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) {
        throw new PathTraversalError(path)
      }
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }

  return '/' + resolved.join('/')
}

/**
 * Count occurrences of a substring in a string
 */
function countOccurrences(text: string, search: string): number {
  if (search === '') return 0

  let count = 0
  let pos = 0

  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++
    pos += search.length
  }

  return count
}

/**
 * Replace first occurrence of a string
 */
function replaceFirst(text: string, search: string, replacement: string): string {
  const index = text.indexOf(search)
  if (index === -1) return text

  return text.slice(0, index) + replacement + text.slice(index + search.length)
}

/**
 * Edit Tool Adapter
 *
 * Performs exact string replacements in files.
 * The old_string must be unique in the file unless replace_all is true.
 */
export class EditToolAdapter implements ToolAdapter<EditToolInput, EditToolOutput> {
  readonly name = 'Edit'

  readonly description = `Performs exact string replacements in files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`

  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to modify',
      },
      old_string: {
        type: 'string',
        description: 'The text to replace',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with (must be different from old_string)',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurences of old_string (default false)',
        default: false,
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  }

  async execute(input: EditToolInput, context: ToolContext): Promise<EditToolOutput> {
    const { file_path, old_string, new_string, replace_all = false } = input
    const { fs, readFiles } = context

    // Validate path
    const normalizedPath = validatePath(file_path)

    // Check that the file was previously read
    if (!readFiles.has(normalizedPath)) {
      throw new FileNotReadError(normalizedPath)
    }

    // Check if file exists
    const exists = await fs.exists(normalizedPath)
    if (!exists) {
      throw new FileNotFoundError(normalizedPath)
    }

    // Check if it's a directory
    const stats = await fs.stat(normalizedPath)
    if (stats.isDirectory()) {
      throw new IsDirectoryError(normalizedPath)
    }

    // Read current content
    const content = await fs.readFile(normalizedPath) as string

    // Count occurrences
    const occurrences = countOccurrences(content, old_string)

    // If old_string not found, return failure
    if (occurrences === 0) {
      return {
        success: false,
        replacements_made: 0,
      }
    }

    // If not replace_all and string is not unique, throw error
    if (!replace_all && occurrences > 1) {
      throw new NotUniqueError(old_string, occurrences)
    }

    // Perform the replacement
    let newContent: string
    let replacementsMade: number

    if (replace_all) {
      // Replace all occurrences
      newContent = content.split(old_string).join(new_string)
      replacementsMade = occurrences
    } else {
      // Replace only first occurrence
      newContent = replaceFirst(content, old_string, new_string)
      replacementsMade = 1
    }

    // Write back to file
    await fs.writeFile(normalizedPath, newContent)

    return {
      success: true,
      replacements_made: replacementsMade,
      undo: {
        old_string: new_string,
        new_string: old_string,
      },
    }
  }
}
