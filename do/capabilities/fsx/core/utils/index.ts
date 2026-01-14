/**
 * Unix-like utilities for fsx.do
 *
 * This module provides Unix-style pattern matching and file discovery utilities:
 * - match/createMatcher: Pure pattern matching (no I/O)
 * - glob: File globbing with filesystem traversal
 * - find: Predicate-based file discovery (like Unix find)
 * - grep: Content search (like Unix grep)
 *
 * Key gitx use cases:
 * - .gitignore pattern matching
 * - Sparse checkout patterns
 * - File discovery for status/diff
 * - Content search (git grep)
 * - Finding large files for LFS
 *
 * @example
 * ```typescript
 * import { match, glob, find, grep } from 'fsx.do/utils'
 *
 * // Pattern matching
 * match('*.ts', 'index.ts')  // true
 *
 * // File globbing
 * const tsFiles = await glob('src/**\/*.ts')
 *
 * // Find with predicates
 * const largeFiles = await find({ size: '+1M', type: 'f' })
 *
 * // Content search
 * const todos = await grep({ pattern: 'TODO', path: '/src', recursive: true })
 * ```
 *
 * @packageDocumentation
 */

// Pattern matching
export { match, createMatcher, type MatchOptions } from '../glob/match.js'

// File globbing
export { glob, type GlobOptions } from '../glob/glob.js'

// Find (predicate-based file discovery)
export { find, type FindOptions, type FindResult } from '../find/find.js'

// Grep (content search)
export { grep, type GrepOptions, type GrepMatch, type GrepResult } from '../grep/grep.js'

// Sparse checkout pattern parsing
export { parsePattern, type ParsedPattern } from '../sparse/patterns.js'
