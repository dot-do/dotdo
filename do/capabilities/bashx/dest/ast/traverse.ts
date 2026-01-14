/**
 * AST Traversal Utilities
 *
 * Visitor pattern and extraction utilities for bash AST.
 */

import type { Program, BashNode, Command, Redirect } from '../types.js'

/**
 * Visitor callbacks for AST traversal.
 * Each callback receives the specific node type it's named for.
 */
export interface Visitor {
  Program?: (node: Program) => void
  Command?: (node: Command) => void
  // Add more as needed when traversal is implemented
}

/**
 * Visit all nodes in an AST with callbacks
 */
export function visit(_ast: Program, _visitor: Visitor): void {
  // TODO: Implement visitor pattern
  throw new Error('Not implemented')
}

/**
 * Extract all commands from an AST
 */
export function extractCommands(_ast: Program): Command[] {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Extract all file paths from an AST (from arguments and redirects)
 */
export function extractFiles(_ast: Program): { reads: string[]; writes: string[] } {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Extract all redirects from an AST
 */
export function extractRedirects(_ast: Program): Redirect[] {
  // TODO: Implement
  throw new Error('Not implemented')
}
