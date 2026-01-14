/**
 * Tree-sitter-bash WASM Integration
 *
 * This module provides tree-sitter-bash WASM integration for parsing
 * bash commands into syntax trees.
 *
 * @see https://tree-sitter.github.io/tree-sitter/
 * @see https://github.com/tree-sitter/tree-sitter-bash
 */

import { Parser, Language, Query, Node, Tree } from 'web-tree-sitter'
import { createRequire } from 'module'
import { readFile } from 'fs/promises'
import { hasChildrenForFieldName, getChildrenForFieldName } from './tree-sitter-types.js'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Position in source text
 */
export interface Point {
  row: number
  column: number
}

/**
 * Edit operation for incremental parsing
 */
export interface Edit {
  startIndex: number
  oldEndIndex: number
  newEndIndex: number
  startPosition: Point
  oldEndPosition: Point
  newEndPosition: Point
}

/**
 * Query capture result
 */
export interface QueryCapture {
  name: string
  node: TreeSitterNode
}

/**
 * Query match result
 */
export interface QueryMatch {
  pattern: number
  captures: QueryCapture[]
}

/**
 * Tree-sitter Query object
 */
export interface TreeSitterQuery {
  matches(node: TreeSitterNode): QueryMatch[]
  captures(node: TreeSitterNode): QueryCapture[]
}

/**
 * Tree-sitter Language object
 */
export interface TreeSitterLanguage {
  query(source: string): TreeSitterQuery
}

/**
 * Tree-sitter syntax tree node
 */
export interface TreeSitterNode {
  // Node type and text
  readonly type: string
  readonly text: string
  readonly isNamed: boolean
  readonly isError: boolean
  readonly hasError: boolean

  // Position information
  readonly startPosition: Point
  readonly endPosition: Point
  readonly startIndex: number
  readonly endIndex: number

  // Child navigation
  readonly firstChild: TreeSitterNode | null
  readonly lastChild: TreeSitterNode | null
  readonly children: TreeSitterNode[]
  readonly namedChildren: TreeSitterNode[]
  readonly childCount: number
  child(index: number): TreeSitterNode | null

  // Sibling navigation
  readonly nextSibling: TreeSitterNode | null
  readonly previousSibling: TreeSitterNode | null
  readonly nextNamedSibling: TreeSitterNode | null
  readonly previousNamedSibling: TreeSitterNode | null

  // Parent navigation
  readonly parent: TreeSitterNode | null

  // Field access
  childForFieldName(fieldName: string): TreeSitterNode | null
  childrenForFieldName(fieldName: string): TreeSitterNode[]
}

/**
 * Tree-sitter syntax tree
 */
export interface TreeSitterTree {
  readonly rootNode: TreeSitterNode

  /**
   * Edit the tree for incremental parsing
   */
  edit(edit: Edit): void
}

/**
 * Tree-sitter parser instance
 */
export interface TreeSitterParser {
  /**
   * Parse source code into a syntax tree
   * @param source - The source code to parse
   * @param oldTree - Optional previous tree for incremental parsing
   */
  parse(source: string, oldTree?: TreeSitterTree): TreeSitterTree
}

// ============================================================================
// Module State
// ============================================================================

let _initialized = false
let _initPromise: Promise<void> | null = null
let _parser: Parser | null = null
let _language: Language | null = null

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the path to the tree-sitter-bash WASM file and read it as bytes
 * @returns Buffer containing the WASM file bytes
 */
async function loadBashWasmBytes(): Promise<Buffer> {
  // Try to resolve from node_modules - try multiple package names
  const packagePaths = [
    'tree-sitter-bash/tree-sitter-bash.wasm',
    'tree-sitter-wasms/out/tree-sitter-bash.wasm',
  ]

  const require = createRequire(import.meta.url)

  for (const pkgPath of packagePaths) {
    try {
      const wasmPath = require.resolve(pkgPath)
      return await readFile(wasmPath)
    } catch {
      // Continue to next package
    }
  }

  throw new Error(
    'Could not find tree-sitter-bash WASM file. Please install tree-sitter-bash package.'
  )
}

/** Symbol for accessing the raw Node from NodeWrapper */
const RAW_NODE = Symbol('rawNode')

/** Symbol for accessing the raw Tree from TreeWrapper */
const RAW_TREE = Symbol('rawTree')

/**
 * Interface for accessing the raw Node from a wrapped TreeSitterNode
 */
interface RawNodeAccessor {
  [RAW_NODE]: Node
}

/**
 * Type guard to check if a TreeSitterNode has raw node access
 */
function hasRawNode(node: TreeSitterNode): node is TreeSitterNode & RawNodeAccessor {
  return RAW_NODE in node
}

/**
 * Get the raw Node from a TreeSitterNode, with type safety
 */
function getRawNode(node: TreeSitterNode): Node {
  if (hasRawNode(node)) {
    return node[RAW_NODE]
  }
  // This should never happen in practice since all TreeSitterNodes are NodeWrappers
  throw new Error('Unable to access raw node - node is not a NodeWrapper')
}

/**
 * Interface for accessing the raw Tree from a wrapped TreeSitterTree
 */
interface RawTreeAccessor {
  [RAW_TREE]: Tree
}

/**
 * Type guard to check if a TreeSitterTree has raw tree access
 */
function hasRawTree(tree: TreeSitterTree): tree is TreeSitterTree & RawTreeAccessor {
  return RAW_TREE in tree
}

/**
 * Get the raw Tree from a TreeSitterTree, with type safety
 */
function getRawTree(tree: TreeSitterTree): Tree {
  if (hasRawTree(tree)) {
    return tree[RAW_TREE]
  }
  // This should never happen in practice since all TreeSitterTrees are TreeWrappers
  throw new Error('Unable to access raw tree - tree is not a TreeWrapper')
}

/**
 * Wrapper class to adapt web-tree-sitter Node to our TreeSitterNode interface
 * The 0.25.x API uses properties for isNamed and hasError
 */
class NodeWrapper implements TreeSitterNode, RawNodeAccessor {
  readonly [RAW_NODE]: Node

  constructor(node: Node) {
    this[RAW_NODE] = node
  }

  /** Internal accessor for the raw node */
  private get _node(): Node {
    return this[RAW_NODE]
  }

  get type(): string {
    return this._node.type
  }

  get text(): string {
    return this._node.text
  }

  get isNamed(): boolean {
    return this._node.isNamed
  }

  get isError(): boolean {
    return this._node.type === 'ERROR'
  }

  get hasError(): boolean {
    return this._node.hasError
  }

  get startPosition(): Point {
    return this._node.startPosition
  }

  get endPosition(): Point {
    return this._node.endPosition
  }

  get startIndex(): number {
    return this._node.startIndex
  }

  get endIndex(): number {
    return this._node.endIndex
  }

  get firstChild(): TreeSitterNode | null {
    return this._node.firstChild ? new NodeWrapper(this._node.firstChild) : null
  }

  get lastChild(): TreeSitterNode | null {
    return this._node.lastChild ? new NodeWrapper(this._node.lastChild) : null
  }

  get children(): TreeSitterNode[] {
    return this._node.children.map((c) => new NodeWrapper(c))
  }

  get namedChildren(): TreeSitterNode[] {
    return this._node.namedChildren.map((c) => new NodeWrapper(c))
  }

  get childCount(): number {
    return this._node.childCount
  }

  child(index: number): TreeSitterNode | null {
    const c = this._node.child(index)
    return c ? new NodeWrapper(c) : null
  }

  get nextSibling(): TreeSitterNode | null {
    return this._node.nextSibling ? new NodeWrapper(this._node.nextSibling) : null
  }

  get previousSibling(): TreeSitterNode | null {
    return this._node.previousSibling ? new NodeWrapper(this._node.previousSibling) : null
  }

  get nextNamedSibling(): TreeSitterNode | null {
    return this._node.nextNamedSibling ? new NodeWrapper(this._node.nextNamedSibling) : null
  }

  get previousNamedSibling(): TreeSitterNode | null {
    return this._node.previousNamedSibling ? new NodeWrapper(this._node.previousNamedSibling) : null
  }

  get parent(): TreeSitterNode | null {
    return this._node.parent ? new NodeWrapper(this._node.parent) : null
  }

  childForFieldName(fieldName: string): TreeSitterNode | null {
    const c = this._node.childForFieldName(fieldName)
    return c ? new NodeWrapper(c) : null
  }

  childrenForFieldName(fieldName: string): TreeSitterNode[] {
    // Use the childrenForFieldName method if available (type-safe approach)
    if (hasChildrenForFieldName(this._node)) {
      return this._node.childrenForFieldName(fieldName).map((c: Node) => new NodeWrapper(c))
    }

    // Fallback using getChildrenForFieldName utility which filters by field name
    return getChildrenForFieldName(this._node, fieldName).map((c: Node) => new NodeWrapper(c))
  }
}

/**
 * Wrapper class to adapt web-tree-sitter Tree to our TreeSitterTree interface
 */
class TreeWrapper implements TreeSitterTree, RawTreeAccessor {
  readonly [RAW_TREE]: Tree

  constructor(tree: Tree) {
    this[RAW_TREE] = tree
  }

  /** Internal accessor for the raw tree */
  private get _tree(): Tree {
    return this[RAW_TREE]
  }

  get rootNode(): TreeSitterNode {
    return new NodeWrapper(this._tree.rootNode)
  }

  edit(edit: Edit): void {
    this._tree.edit(edit)
  }
}

/**
 * Wrapper class to adapt web-tree-sitter Language to our TreeSitterLanguage interface
 */
class LanguageWrapper implements TreeSitterLanguage {
  constructor(private readonly _lang: Language) {}

  query(source: string): TreeSitterQuery {
    const query = new Query(this._lang, source)
    return new QueryWrapper(query)
  }
}

/**
 * Wrapper class to adapt web-tree-sitter Query to our TreeSitterQuery interface
 */
class QueryWrapper implements TreeSitterQuery {
  constructor(private readonly _query: Query) {}

  matches(node: TreeSitterNode): QueryMatch[] {
    // Use type-safe getRawNode to unwrap the node
    const rawNode = getRawNode(node)
    const rawMatches = this._query.matches(rawNode)
    return rawMatches.map((m) => ({
      pattern: m.patternIndex,
      captures: m.captures.map((c) => ({
        name: c.name,
        node: new NodeWrapper(c.node),
      })),
    }))
  }

  captures(node: TreeSitterNode): QueryCapture[] {
    // Use type-safe getRawNode to unwrap the node
    const rawNode = getRawNode(node)
    const rawCaptures = this._query.captures(rawNode)
    return rawCaptures.map((c) => ({
      name: c.name,
      node: new NodeWrapper(c.node),
    }))
  }
}

/**
 * Wrapper class to adapt web-tree-sitter Parser to our TreeSitterParser interface
 */
class ParserWrapper implements TreeSitterParser {
  constructor(private readonly _parser: Parser) {}

  parse(source: string, oldTree?: TreeSitterTree): TreeSitterTree {
    // Use type-safe getRawTree to unwrap the old tree if provided
    const rawOldTree = oldTree ? getRawTree(oldTree) : undefined
    const result = this._parser.parse(source, rawOldTree)
    if (!result) {
      throw new Error('Failed to parse source code')
    }
    return new TreeWrapper(result)
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the tree-sitter WASM module
 *
 * Must be called before any parsing operations.
 * Safe to call multiple times - will only initialize once.
 *
 * @throws {Error} If WASM module fails to load
 *
 * @example
 * ```typescript
 * await initTreeSitter()
 * const tree = parseWithTreeSitter('ls -la')
 * ```
 */
export async function initTreeSitter(): Promise<void> {
  // Already initialized
  if (_initialized) {
    return
  }

  // Initialization in progress - wait for it
  if (_initPromise) {
    return _initPromise
  }

  // Start initialization
  _initPromise = (async () => {
    try {
      // Initialize the tree-sitter WASM module
      await Parser.init()

      // Load the bash language grammar from WASM bytes
      const wasmBytes = await loadBashWasmBytes()
      _language = await Language.load(wasmBytes)

      // Create the default parser and set its language
      _parser = new Parser()
      _parser.setLanguage(_language)

      _initialized = true
    } catch (error) {
      _initPromise = null
      // Better error handling to capture the actual error
      let errorMessage: string
      if (error instanceof Error) {
        errorMessage = error.stack || error.message || error.toString()
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = JSON.stringify(error)
      } else {
        errorMessage = String(error)
      }
      throw new Error(`Failed to initialize tree-sitter: ${errorMessage || 'Unknown error'}`)
    }
  })()

  return _initPromise
}

/**
 * Check if tree-sitter is initialized and ready
 */
export function isTreeSitterReady(): boolean {
  return _initialized
}

/**
 * Get the tree-sitter-bash language object
 *
 * @throws {Error} If tree-sitter is not initialized
 */
export function getTreeSitterLanguage(): TreeSitterLanguage {
  if (!_initialized || !_language) {
    throw new Error('Tree-sitter not initialized. Call initTreeSitter() first.')
  }
  return new LanguageWrapper(_language)
}

/**
 * Create a new parser instance
 *
 * Useful when you need to maintain multiple parse states
 * or do incremental parsing.
 *
 * @throws {Error} If tree-sitter is not initialized
 *
 * @example
 * ```typescript
 * const parser = createParser()
 * const tree1 = parser.parse('ls')
 * tree1.edit(...)
 * const tree2 = parser.parse('ls -la', tree1)
 * ```
 */
export function createParser(): TreeSitterParser {
  if (!_initialized || !_language) {
    throw new Error('Tree-sitter not initialized. Call initTreeSitter() first.')
  }

  const parser = new Parser()
  parser.setLanguage(_language)
  return new ParserWrapper(parser)
}

/**
 * Parse bash source code using tree-sitter
 *
 * Convenience function that uses the shared parser instance.
 * For incremental parsing, use createParser() instead.
 *
 * @param source - The bash source code to parse
 * @returns The parsed syntax tree
 * @throws {Error} If tree-sitter is not initialized
 *
 * @example
 * ```typescript
 * await initTreeSitter()
 *
 * const tree = parseWithTreeSitter('ls -la | grep foo')
 * console.log(tree.rootNode.type) // 'program'
 *
 * const pipeline = tree.rootNode.firstChild
 * console.log(pipeline.type) // 'pipeline'
 * ```
 */
export function parseWithTreeSitter(source: string): TreeSitterTree {
  if (!_initialized || !_parser) {
    throw new Error('Tree-sitter not initialized. Call initTreeSitter() first.')
  }

  // Reset the parser before each parse to prevent state corruption issues
  // that can occur with certain inputs (like heredocs in tree-sitter-bash)
  _parser.reset()

  const tree = _parser.parse(source)
  if (!tree) {
    throw new Error('Failed to parse source code')
  }
  return new TreeWrapper(tree)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Walk the syntax tree and call visitor for each node
 *
 * @param node - The root node to start walking from
 * @param visitor - Callback called for each node
 *
 * @example
 * ```typescript
 * walkTree(tree.rootNode, (node) => {
 *   if (node.type === 'command') {
 *     console.log('Found command:', node.text)
 *   }
 * })
 * ```
 */
export function walkTree(node: TreeSitterNode, visitor: (node: TreeSitterNode) => void): void {
  visitor(node)
  for (const child of node.children) {
    walkTree(child, visitor)
  }
}

/**
 * Find all nodes of a specific type in the tree
 *
 * @param node - The root node to search from
 * @param type - The node type to find
 * @returns Array of matching nodes
 *
 * @example
 * ```typescript
 * const commands = findNodesByType(tree.rootNode, 'command')
 * for (const cmd of commands) {
 *   console.log(cmd.text)
 * }
 * ```
 */
export function findNodesByType(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const results: TreeSitterNode[] = []

  walkTree(node, (n) => {
    if (n.type === type) {
      results.push(n)
    }
  })

  return results
}

/**
 * Get all error nodes in the tree
 *
 * Useful for detecting and reporting syntax errors.
 *
 * @param node - The root node to search from
 * @returns Array of error nodes
 */
export function getErrorNodes(node: TreeSitterNode): TreeSitterNode[] {
  const errors: TreeSitterNode[] = []

  walkTree(node, (n) => {
    if (n.type === 'ERROR' || n.isError) {
      errors.push(n)
    }
  })

  return errors
}

/**
 * Check if the tree has any syntax errors
 *
 * @param tree - The syntax tree to check
 * @returns true if the tree contains errors
 */
export function hasErrors(tree: TreeSitterTree): boolean {
  return tree.rootNode.hasError
}
