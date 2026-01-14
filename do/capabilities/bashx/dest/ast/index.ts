/**
 * bashx AST Module
 *
 * Provides bash command parsing, validation, and analysis using tree-sitter-bash.
 *
 * @example
 * ```typescript
 * import { parse, analyze, fix } from './ast'
 *
 * // Parse a command
 * const ast = parse('find . -name "*.ts" | wc -l')
 *
 * // Analyze for safety
 * const analysis = analyze(ast)
 * // { type: 'read', impact: 'none', reversible: true }
 *
 * // Fix broken commands
 * const fixed = fix('echo "hello')
 * // { command: 'echo "hello"', changes: [{ type: 'insert', position: 'end', value: '"' }] }
 * ```
 */

export * from '../types.js'

// Parser integration - to be implemented with tree-sitter-bash
export { parse } from './parser.js'

// AST analysis utilities
export { analyze } from './analyze.js'

// Traversal utilities
export { visit, extractCommands, extractFiles, extractRedirects } from './traverse.js'

// Error detection and fixing
export { detectErrors, suggestFixes } from './fix.js'
