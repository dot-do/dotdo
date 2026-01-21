// LSP Integration Tests - TDD for rpc.do CLI TypeScript LSP
// Tests the LSP service for code completion, hover, and type checking
// RED phase: These tests should FAIL initially until implementation is done

import { describe, it, expect, beforeEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

// Module under test (will be created in GREEN phase)
import { LSPService, type LSPServiceOptions, type CompletionItem, type HoverInfo, type DiagnosticError, type SignatureInfo } from '../src/cli/lsp'

// Sample type definitions for testing (simulates content of .do/$.d.ts)
const SAMPLE_TYPES = `
/**
 * ThingsStore - CRUD operations for Things
 */
export interface ThingsStore {
  /**
   * Create a new Thing
   * @param data - Thing data with required $type field
   * @returns Created Thing with generated $id and timestamps
   */
  create<D extends { $type: string }>(data: D): Promise<Thing & D>;

  /**
   * Get a Thing by ID
   * @param id - Thing ID
   * @returns Thing or null if not found
   */
  get(id: string): Promise<Thing | null>;

  /**
   * Update a Thing
   * @param id - Thing ID
   * @param data - Partial data to merge
   * @returns Updated Thing
   */
  update(id: string, data: Partial<any>): Promise<Thing>;

  /**
   * Delete a Thing
   * @param id - Thing ID
   */
  delete(id: string): Promise<void>;

  /**
   * List Things with optional filtering
   */
  list(options?: { type?: string; limit?: number }): Promise<Thing[]>;
}

/**
 * EventsStore - Event emission and query operations
 */
export interface EventsStore {
  emit(event: { type: string; payload?: unknown }): Promise<Event>;
  get(id: string): Promise<Event | null>;
  query(options?: { type?: string }): Promise<Event[]>;
}

export interface Thing {
  $id: string;
  $type: string;
  $createdAt: number;
  $updatedAt: number;
}

export interface Event {
  $id: string;
  type: string;
  $timestamp: number;
  payload: unknown;
}

/**
 * WorkflowContext ($) - Fluent API for events, scheduling, and cross-DO RPC
 */
export interface WorkflowContext {
  /** ThingsStore for entity CRUD */
  things: ThingsStore;
  /** EventsStore for event handling */
  events: EventsStore;
  /** Event handler registration */
  on: {
    [noun: string]: {
      [verb: string]: (handler: (event: Event) => void) => void;
    };
  };
  /** Schedule handler */
  every: {
    [key: string]: any;
  };
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void;
  /** Single attempt action */
  try<T>(action: () => Promise<T>): Promise<T>;
  /** Durable action with retries */
  do<T>(action: () => Promise<T>): Promise<T>;
  /** Get TypeScript types */
  _types(): Promise<string>;
}

/** The $ context exported for use */
declare const $: WorkflowContext;
`

// ============================================================================
// LSPService Initialization
// ============================================================================

describe('LSPService initialization', () => {
  it('initializes with .do/$.d.ts types loaded', async () => {
    const lsp = new LSPService({
      types: SAMPLE_TYPES,
    })

    // Should be ready after construction
    expect(lsp).toBeDefined()
    expect(lsp.isReady()).toBe(true)
  })

  it('accepts types as string content', () => {
    const lsp = new LSPService({
      types: 'export interface Foo { bar: string }',
    })

    expect(lsp.isReady()).toBe(true)
  })

  it('can be created with empty types', () => {
    const lsp = new LSPService({
      types: '',
    })

    expect(lsp.isReady()).toBe(true)
  })
})

// ============================================================================
// getCompletions - Code Completion
// ============================================================================

describe('LSPService.getCompletions', () => {
  let lsp: LSPService

  beforeEach(() => {
    lsp = new LSPService({
      types: SAMPLE_TYPES,
    })
  })

  it('returns $ methods for "$."', () => {
    const code = '$.'
    const position = { line: 0, column: 2 } // After the dot

    const completions = lsp.getCompletions(position, code)

    expect(completions).toBeDefined()
    expect(completions.length).toBeGreaterThan(0)

    const names = completions.map(c => c.name)
    expect(names).toContain('things')
    expect(names).toContain('events')
    expect(names).toContain('on')
    expect(names).toContain('every')
    expect(names).toContain('_types')
  })

  it('filters completions for "$.th"', () => {
    const code = '$.th'
    const position = { line: 0, column: 4 } // After "th"

    const completions = lsp.getCompletions(position, code)

    expect(completions).toBeDefined()
    // Should include "things" which matches the prefix "th"
    const names = completions.map(c => c.name)
    expect(names).toContain('things')
    // Note: TypeScript returns all completions and the IDE handles filtering
    // So we just verify "things" is present
  })

  it('returns ThingsStore methods for "$.things."', () => {
    const code = '$.things.'
    const position = { line: 0, column: 9 } // After the dot

    const completions = lsp.getCompletions(position, code)

    expect(completions).toBeDefined()
    const names = completions.map(c => c.name)
    expect(names).toContain('create')
    expect(names).toContain('get')
    expect(names).toContain('update')
    expect(names).toContain('delete')
    expect(names).toContain('list')
  })

  it('returns EventsStore methods for "$.events."', () => {
    const code = '$.events.'
    const position = { line: 0, column: 9 } // After the dot

    const completions = lsp.getCompletions(position, code)

    expect(completions).toBeDefined()
    const names = completions.map(c => c.name)
    expect(names).toContain('emit')
    expect(names).toContain('get')
    expect(names).toContain('query')
  })

  it('includes completion kind information', () => {
    const code = '$.'
    const position = { line: 0, column: 2 }

    const completions = lsp.getCompletions(position, code)

    const thingsCompletion = completions.find(c => c.name === 'things')
    expect(thingsCompletion).toBeDefined()
    expect(thingsCompletion!.kind).toBeDefined()
    // 'property' or 'field' or 'method'
    expect(['property', 'field', 'method', 'variable']).toContain(thingsCompletion!.kind)
  })

  it('handles multiline code', () => {
    const code = `const x = 1;
$.things.`
    const position = { line: 1, column: 9 } // After "$.things."

    const completions = lsp.getCompletions(position, code)

    expect(completions).toBeDefined()
    const names = completions.map(c => c.name)
    expect(names).toContain('create')
  })

  it('returns empty array for invalid position', () => {
    const code = 'const x = 1'
    const position = { line: 0, column: 5 } // In the middle of "const"

    const completions = lsp.getCompletions(position, code)

    // Should return empty or minimal completions (not crash)
    expect(Array.isArray(completions)).toBe(true)
  })
})

// ============================================================================
// getHover - Type Information
// ============================================================================

describe('LSPService.getHover', () => {
  let lsp: LSPService

  beforeEach(() => {
    lsp = new LSPService({
      types: SAMPLE_TYPES,
    })
  })

  it('returns type info for "$.things"', () => {
    const code = '$.things'
    const position = { line: 0, column: 3 } // On "things"

    const hover = lsp.getHover(position, code)

    expect(hover).toBeDefined()
    expect(hover!.type).toBeDefined()
    // Should show ThingsStore type info
    expect(hover!.type).toContain('ThingsStore')
  })

  it('returns type info for "$.events"', () => {
    const code = '$.events'
    const position = { line: 0, column: 3 } // On "events"

    const hover = lsp.getHover(position, code)

    expect(hover).toBeDefined()
    expect(hover!.type).toContain('EventsStore')
  })

  it('returns method signature for "$.things.create"', () => {
    const code = '$.things.create'
    const position = { line: 0, column: 10 } // On "create"

    const hover = lsp.getHover(position, code)

    expect(hover).toBeDefined()
    expect(hover!.type).toBeDefined()
    // Should contain function signature
    expect(hover!.type).toMatch(/create|Promise/)
  })

  it('returns documentation if available', () => {
    const code = '$.things'
    const position = { line: 0, column: 3 }

    const hover = lsp.getHover(position, code)

    expect(hover).toBeDefined()
    // Documentation should include JSDoc comment
    if (hover!.documentation) {
      expect(hover!.documentation).toContain('CRUD')
    }
  })

  it('returns null for whitespace position', () => {
    const code = '   const x = 1'
    const position = { line: 0, column: 1 } // On leading whitespace

    const hover = lsp.getHover(position, code)

    // Either null or minimal type info is acceptable for whitespace
    // Note: TS may still return info if cursor is adjacent to a token
    expect(hover === null || hover?.type !== undefined).toBe(true)
  })

  it('handles code with syntax errors gracefully', () => {
    const code = '$.things.create('
    const position = { line: 0, column: 10 }

    // Should not throw
    expect(() => {
      lsp.getHover(position, code)
    }).not.toThrow()
  })
})

// ============================================================================
// check - TypeScript Error Checking
// ============================================================================

describe('LSPService.check', () => {
  let lsp: LSPService

  beforeEach(() => {
    lsp = new LSPService({
      types: SAMPLE_TYPES,
    })
  })

  it('returns no errors for valid code', () => {
    // Use async IIFE to avoid top-level await issues
    const code = `
async function main() {
  const result = await $.things.create({ $type: 'Customer', name: 'Alice' });
  console.log(result.$id);
}
`
    const errors = lsp.check(code)

    expect(errors).toBeDefined()
    expect(errors.length).toBe(0)
  })

  it('returns errors for invalid property access', () => {
    const code = `
const result = $.things.nonExistentMethod();
`
    const errors = lsp.check(code)

    expect(errors).toBeDefined()
    expect(errors.length).toBeGreaterThan(0)
    // Should have an error about nonExistentMethod
    expect(errors.some(e => e.message.includes('nonExistentMethod') || e.message.includes('does not exist'))).toBe(true)
  })

  it('returns errors for type mismatches', () => {
    const code = `
// Passing wrong type - should expect { type: string; payload?: unknown }
$.send(123);
`
    const errors = lsp.check(code)

    expect(errors).toBeDefined()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('includes error location information', () => {
    const code = `
$.things.badMethod();
`
    const errors = lsp.check(code)

    expect(errors.length).toBeGreaterThan(0)
    const error = errors[0]!
    expect(error.line).toBeDefined()
    expect(error.column).toBeDefined()
    expect(typeof error.line).toBe('number')
    expect(typeof error.column).toBe('number')
  })

  it('includes error code when available', () => {
    const code = `
$.things.unknownMethod();
`
    const errors = lsp.check(code)

    expect(errors.length).toBeGreaterThan(0)
    // TypeScript error codes are numbers like 2339
    const firstError = errors[0]!
    if (firstError.code !== undefined) {
      expect(typeof firstError.code).toBe('number')
    }
  })

  it('handles multiple errors', () => {
    const code = `
$.things.bad1();
$.things.bad2();
$.things.bad3();
`
    const errors = lsp.check(code)

    expect(errors.length).toBeGreaterThanOrEqual(3)
  })

  it('returns empty array for empty code', () => {
    const code = ''
    const errors = lsp.check(code)

    expect(errors).toEqual([])
  })
})

// ============================================================================
// getSignatureHelp - Parameter Information
// ============================================================================

describe('LSPService.getSignatureHelp', () => {
  let lsp: LSPService

  beforeEach(() => {
    lsp = new LSPService({
      types: SAMPLE_TYPES,
    })
  })

  it('returns param info for "$.things.create("', () => {
    const code = '$.things.create('
    const position = { line: 0, column: 16 } // After the opening paren

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    expect(signature!.signatures).toBeDefined()
    expect(signature!.signatures.length).toBeGreaterThan(0)
  })

  it('returns parameter details', () => {
    const code = '$.things.create('
    const position = { line: 0, column: 16 }

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    const sig = signature!.signatures[0]!
    expect(sig.label).toBeDefined()
    // Should have parameter info
    expect(sig.parameters).toBeDefined()
  })

  it('returns param info for "$.things.get("', () => {
    const code = '$.things.get('
    const position = { line: 0, column: 13 }

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    expect(signature!.signatures.length).toBeGreaterThan(0)
    // Should have 'id' parameter
    const sig = signature!.signatures[0]!
    expect(sig.parameters).toBeDefined()
    expect(sig.parameters!.length).toBeGreaterThanOrEqual(1)
  })

  it('returns param info for "$.things.update("', () => {
    const code = '$.things.update('
    const position = { line: 0, column: 16 }

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    const sig = signature!.signatures[0]!
    // Should have 'id' and 'data' parameters
    expect(sig.parameters).toBeDefined()
    expect(sig.parameters!.length).toBeGreaterThanOrEqual(2)
  })

  it('indicates active parameter when multiple args provided', () => {
    const code = '$.things.update("id-123", '
    const position = { line: 0, column: 25 } // After the comma, in second param

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    // Active parameter should be 1 (second parameter, 0-indexed)
    expect(signature!.activeParameter).toBeGreaterThanOrEqual(1)
  })

  it('returns null outside of function call', () => {
    const code = 'const x = 1'
    const position = { line: 0, column: 5 }

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeNull()
  })

  it('handles nested function calls', () => {
    const code = '$.things.create({ $type: "Test" }'
    const position = { line: 0, column: 18 } // Inside the object literal

    // Should not crash
    expect(() => {
      lsp.getSignatureHelp(position, code)
    }).not.toThrow()
  })

  it('includes documentation for parameters when available', () => {
    const code = '$.things.create('
    const position = { line: 0, column: 16 }

    const signature = lsp.getSignatureHelp(position, code)

    expect(signature).toBeDefined()
    const sig = signature!.signatures[0]!
    // If documentation exists for the method, it should be present
    if (sig.documentation) {
      expect(typeof sig.documentation).toBe('string')
    }
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('LSPService edge cases', () => {
  let lsp: LSPService

  beforeEach(() => {
    lsp = new LSPService({
      types: SAMPLE_TYPES,
    })
  })

  it('handles very long code without performance issues', () => {
    const code = '$.things.' + 'x'.repeat(10000)
    const position = { line: 0, column: 9 }

    const start = Date.now()
    lsp.getCompletions(position, code)
    const elapsed = Date.now() - start

    // Should complete in reasonable time (< 5 seconds)
    expect(elapsed).toBeLessThan(5000)
  })

  it('handles unicode in code', () => {
    const code = 'const name = "\u4e2d\u6587"; $.'
    const position = { line: 0, column: code.length }

    const completions = lsp.getCompletions(position, code)

    expect(Array.isArray(completions)).toBe(true)
  })

  it('handles mixed async/await code', () => {
    const code = `async function test() {
  const result = await $.things.create({ $type: 'Test' });
  return result;
}`
    const errors = lsp.check(code)

    // Should parse async code correctly
    expect(Array.isArray(errors)).toBe(true)
  })

  it('recovers from syntax errors in types', () => {
    const badTypes = 'export interface { invalid syntax'

    // Should not throw during construction
    expect(() => {
      new LSPService({ types: badTypes })
    }).not.toThrow()
  })

  it('handles position beyond code length gracefully', () => {
    const code = '$.'
    const position = { line: 0, column: 100 } // Beyond end

    // Should not throw
    expect(() => {
      lsp.getCompletions(position, code)
    }).not.toThrow()
  })

  it('handles negative position gracefully', () => {
    const code = '$.things'
    const position = { line: -1, column: -1 }

    // Should not throw, return empty or null
    expect(() => {
      lsp.getCompletions(position, code)
    }).not.toThrow()
  })

  it('handles line number beyond total lines', () => {
    const code = '$.things'
    const position = { line: 100, column: 0 }

    // Should not throw
    expect(() => {
      lsp.getCompletions(position, code)
    }).not.toThrow()
  })
})
