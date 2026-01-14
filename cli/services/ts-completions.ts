/**
 * TypeScript Language Service for REPL Autocomplete
 *
 * Provides intelligent code completions based on TypeScript's
 * language service, with support for custom type definitions.
 */

import ts from 'typescript'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

export interface CompletionResult {
  name: string
  kind: ts.ScriptElementKind
  sortText: string
}

// Get TypeScript lib directory
function getLibDir(): string {
  try {
    const tsPath = require.resolve('typescript')
    return dirname(tsPath)
  } catch {
    return ''
  }
}

const libDir = getLibDir()

/**
 * Create a language service host for REPL completions
 */
function createHost(
  fileName: string,
  code: string,
  contextTypes: string
): ts.LanguageServiceHost {
  // Combine context types with user code
  const fullCode = `${contextTypes}\n${code}`

  return {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      if (name === fileName) {
        return ts.ScriptSnapshot.fromString(fullCode)
      }
      // Try reading from filesystem for lib files
      try {
        const content = readFileSync(name, 'utf-8')
        return ts.ScriptSnapshot.fromString(content)
      } catch {
        return undefined
      }
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
    }),
    getDefaultLibFileName: () => join(libDir, 'lib.es5.d.ts'),
    fileExists: (path) => {
      if (path === fileName) return true
      return existsSync(path)
    },
    readFile: (path) => {
      if (path === fileName) return fullCode
      try {
        return readFileSync(path, 'utf-8')
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Get TypeScript completions for code at a given position
 */
export function getCompletions(
  code: string,
  position: number,
  typesPath?: string
): string[] {
  const fileName = '/repl.ts'

  // Build context types
  let contextTypes = getDefaultContextTypes()

  // Load custom types if available
  if (typesPath && existsSync(typesPath)) {
    try {
      const typesContent = readFileSync(typesPath, 'utf-8')
      contextTypes = `${typesContent}\n${contextTypes}`
    } catch {
      // Ignore read errors
    }
  }

  // Adjust position for prepended context types
  const adjustedPosition = position + contextTypes.length + 1

  const host = createHost(fileName, code, contextTypes)
  const service = ts.createLanguageService(host)

  try {
    const completions = service.getCompletionsAtPosition(
      fileName,
      adjustedPosition,
      {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      }
    )

    if (!completions?.entries) {
      return []
    }

    // Filter and sort completions
    return completions.entries
      .filter((entry) => {
        // Exclude internal/private entries
        if (entry.name.startsWith('_')) return false
        // Prioritize relevant completions
        return true
      })
      .sort((a, b) => {
        // Prioritize by kind and sortText
        if (a.sortText !== b.sortText) {
          return a.sortText.localeCompare(b.sortText)
        }
        return a.name.localeCompare(b.name)
      })
      .map((entry) => entry.name)
      .slice(0, 20)
  } catch {
    return []
  }
}

/**
 * Get detailed completions with kind information
 */
export function getDetailedCompletions(
  code: string,
  position: number,
  typesPath?: string
): CompletionResult[] {
  const fileName = '/repl.ts'

  // Build context types
  let contextTypes = getDefaultContextTypes()

  if (typesPath && existsSync(typesPath)) {
    try {
      const typesContent = readFileSync(typesPath, 'utf-8')
      contextTypes = `${typesContent}\n${contextTypes}`
    } catch {
      // Ignore
    }
  }

  const adjustedPosition = position + contextTypes.length + 1

  const host = createHost(fileName, code, contextTypes)
  const service = ts.createLanguageService(host)

  try {
    const completions = service.getCompletionsAtPosition(fileName, adjustedPosition, undefined)

    if (!completions?.entries) {
      return []
    }

    return completions.entries
      .filter((entry) => !entry.name.startsWith('_'))
      .map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        sortText: entry.sortText,
      }))
      .slice(0, 20)
  } catch {
    return []
  }
}

/**
 * Default type definitions for REPL context
 * Provides types for $, things, events, etc.
 */
function getDefaultContextTypes(): string {
  return `
// REPL Context Types
interface ThingsStore {
  list(options?: { $type?: string; limit?: number }): Promise<any[]>
  get(id: string): Promise<any>
  create(data: Record<string, any>): Promise<any>
  update(id: string, data: Record<string, any>): Promise<any>
  delete(id: string): Promise<void>
}

interface EventsStore {
  list(options?: { limit?: number }): Promise<any[]>
  emit(event: { $type: string; [key: string]: any }): Promise<void>
}

interface ActionsStore {
  list(options?: { limit?: number }): Promise<any[]>
  run(action: { $type: string; [key: string]: any }): Promise<any>
}

interface ScheduleBuilder {
  Monday: ScheduleBuilder
  Tuesday: ScheduleBuilder
  Wednesday: ScheduleBuilder
  Thursday: ScheduleBuilder
  Friday: ScheduleBuilder
  Saturday: ScheduleBuilder
  Sunday: ScheduleBuilder
  day: ScheduleBuilder
  hour: ScheduleBuilder
  minute: ScheduleBuilder
  at(time: string): (handler: () => void) => void
  at9am: (handler: () => void) => void
  at6pm: (handler: () => void) => void
}

interface EventHandler {
  [key: string]: {
    [key: string]: (handler: (event: any) => void) => void
  }
}

interface WorkflowContext {
  things: ThingsStore
  events: EventsStore
  actions: ActionsStore
  on: EventHandler
  every: ScheduleBuilder
  send(event: any): void
  try<T>(action: () => T): Promise<T>
  do<T>(action: () => T): Promise<T>
}

declare const $: WorkflowContext
`
}

/**
 * Create a reusable completion service instance
 */
export function createCompletionService(typesPath?: string) {
  return {
    getCompletions: (code: string, position: number) =>
      getCompletions(code, position, typesPath),
    getDetailedCompletions: (code: string, position: number) =>
      getDetailedCompletions(code, position, typesPath),
  }
}
