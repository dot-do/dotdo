/**
 * Dependency Tree Builder
 *
 * Builds a dependency graph from a bash AST showing how commands depend on each other.
 * Dependencies include:
 * - Pipe dependencies (data flows through stdout/stdin)
 * - File dependencies (command writes to file that another reads)
 * - Variable dependencies (command sets variable that another uses)
 * - Conditional dependencies (command runs based on another's exit status)
 * - Sequence dependencies (commands run in order)
 * - Background/parallel execution
 *
 * @packageDocumentation
 */

import type {
  Program,
  BashNode,
  Command,
  Pipeline,
  List,
  Subshell,
  CompoundCommand,
  FunctionDef,
  Word,
} from '../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Types of dependencies between commands
 */
export type DependencyType =
  | 'pipe' // Data flows through pipe (stdout -> stdin)
  | 'file' // File written by one command, read by another
  | 'variable' // Variable set by one command, used by another
  | 'conditional' // Command runs based on exit status (&&, ||)
  | 'sequence' // Command runs after another (;)
  | 'background' // Command runs in background (&)
  | 'function' // Function definition -> function call

/**
 * A node in the dependency tree representing a command
 */
export interface DependencyNode {
  /** Unique identifier for this node */
  id: string
  /** Command name (e.g., 'ls', 'grep') */
  command: string
  /** Command arguments */
  args: string[]
  /** Subshell scope ID if in a subshell */
  scope?: string
  /** Loop variable name if this is inside a for loop */
  loopVariable?: string
  /** Execution level for parallel grouping */
  level?: number
}

/**
 * An edge in the dependency graph
 */
export interface DependencyEdge {
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
  /** Type of dependency */
  type: DependencyType
  /** File path for file dependencies */
  file?: string
  /** Variable name for variable dependencies */
  variable?: string
  /** Condition type for conditional dependencies */
  condition?: 'success' | 'failure'
  /** Whether this is a parallel execution edge */
  parallel?: boolean
  /** Data flow information for pipe dependencies */
  dataFlow?: {
    sourceFd: number
    targetFd: number
  }
}

/**
 * The complete dependency tree
 */
export interface DependencyTree {
  /** All nodes (commands) in the tree */
  nodes: DependencyNode[]
  /** All dependency edges */
  edges: DependencyEdge[]
  /** Root node of the tree */
  root: DependencyNode | null
  /** Source AST this tree was built from */
  sourceAst: Program
}

// ============================================================================
// Internal Types for Building
// ============================================================================

interface BuildContext {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
  nodeCounter: number
  scopeStack: string[]
  currentScope: string | undefined
  /** Map from variable name -> node ID that set it (in current scope) */
  variableDefinitions: Map<string, string>
  /** Map from file path -> node ID that wrote it */
  fileWrites: Map<string, string[]>
  /** Map from function name -> node ID */
  functionDefinitions: Map<string, string>
  /** Track last command node for sequence/conditional dependencies */
  lastNodeId: string | undefined
  /** For tracking loop variables */
  loopVariable: string | undefined
}

// ============================================================================
// Helpers
// ============================================================================

function generateNodeId(ctx: BuildContext): string {
  return `node_${ctx.nodeCounter++}`
}

function generateScopeId(ctx: BuildContext): string {
  return `scope_${ctx.nodeCounter++}`
}

function getWordValue(word: Word | null | undefined): string | null {
  if (!word) return null
  return word.value
}

/**
 * Extract command name from a command node
 */
function getCommandName(cmd: Command): string {
  if (cmd.name) {
    return cmd.name.value
  }
  // Assignment-only command
  if (cmd.prefix && cmd.prefix.length > 0) {
    return '' // No command name, just assignments
  }
  return ''
}

/**
 * Extract arguments from a command node
 */
function getCommandArgs(cmd: Command): string[] {
  return cmd.args.map((w) => w.value)
}

/**
 * Check if a command writes to a file (via redirects or known commands like tee)
 */
function getFileWrites(cmd: Command): string[] {
  const writes: string[] = []

  // Check redirects
  for (const redir of cmd.redirects || []) {
    if (redir.op === '>' || redir.op === '>>' || redir.op === '>|') {
      const target = getWordValue(redir.target)
      if (target) {
        writes.push(target)
      }
    }
  }

  // Check for tee command
  const name = getCommandName(cmd)
  if (name === 'tee') {
    for (const arg of cmd.args) {
      // Skip flags
      if (!arg.value.startsWith('-')) {
        writes.push(arg.value)
      }
    }
  }

  // Check for touch command
  if (name === 'touch') {
    for (const arg of cmd.args) {
      if (!arg.value.startsWith('-')) {
        writes.push(arg.value)
      }
    }
  }

  return writes
}

/**
 * Check if a command reads from a file (via redirects, args, or known commands)
 */
function getFileReads(cmd: Command): string[] {
  const reads: string[] = []

  // Check redirects
  for (const redir of cmd.redirects || []) {
    if (redir.op === '<' || redir.op === '<<' || redir.op === '<<<' || redir.op === '<>') {
      const target = getWordValue(redir.target)
      if (target) {
        reads.push(target)
      }
    }
  }

  // Check for commands that read files as args
  const name = getCommandName(cmd)
  const fileReadingCommands = ['cat', 'head', 'tail', 'sort', 'wc', 'grep', 'less', 'more']

  if (fileReadingCommands.includes(name)) {
    for (const arg of cmd.args) {
      // Skip flags
      if (!arg.value.startsWith('-')) {
        reads.push(arg.value)
      }
    }
  }

  // Check for cp/mv (first arg is source)
  if (name === 'cp' || name === 'mv') {
    const nonFlagArgs = cmd.args.filter((a) => !a.value.startsWith('-'))
    if (nonFlagArgs.length > 0) {
      reads.push(nonFlagArgs[0].value)
    }
  }

  // Check for rm (reads file before removing)
  if (name === 'rm') {
    for (const arg of cmd.args) {
      if (!arg.value.startsWith('-')) {
        reads.push(arg.value)
      }
    }
  }

  return reads
}

/**
 * Extract variable assignments from a command
 */
function getVariableAssignments(cmd: Command): string[] {
  const vars: string[] = []
  for (const assignment of cmd.prefix || []) {
    if (assignment.name) {
      vars.push(assignment.name)
    }
  }
  return vars
}

/**
 * Extract variable references from arguments (looking for $VAR patterns)
 */
function getVariableReferences(cmd: Command): string[] {
  const refs: string[] = []
  const varPattern = /\$(\w+)/g

  for (const arg of cmd.args) {
    let match
    while ((match = varPattern.exec(arg.value)) !== null) {
      refs.push(match[1])
    }
  }

  return refs
}

// ============================================================================
// Node Type Guards
// ============================================================================

function isCommand(node: BashNode): node is Command {
  return node.type === 'Command'
}

function isPipeline(node: BashNode): node is Pipeline {
  return node.type === 'Pipeline'
}

function isList(node: BashNode): node is List {
  return node.type === 'List'
}

function isSubshell(node: BashNode): node is Subshell {
  return node.type === 'Subshell'
}

function isCompoundCommand(node: BashNode): node is CompoundCommand {
  return node.type === 'CompoundCommand'
}

function isFunctionDef(node: BashNode): node is FunctionDef {
  return node.type === 'FunctionDef'
}

// ============================================================================
// Build Functions
// ============================================================================

/**
 * Process a command and add it to the tree
 */
function processCommand(
  cmd: Command,
  ctx: BuildContext,
  options: {
    edgeType?: DependencyType
    condition?: 'success' | 'failure'
    parallel?: boolean
    fromNodeId?: string
  } = {}
): string {
  const name = getCommandName(cmd)
  const args = getCommandArgs(cmd)

  // Create the node
  const nodeId = generateNodeId(ctx)
  const node: DependencyNode = {
    id: nodeId,
    command: name,
    args,
    scope: ctx.currentScope,
    loopVariable: ctx.loopVariable,
  }
  ctx.nodes.push(node)

  // Add edge from previous node if needed
  const fromId = options.fromNodeId ?? ctx.lastNodeId
  if (fromId && options.edgeType) {
    const edge: DependencyEdge = {
      from: fromId,
      to: nodeId,
      type: options.edgeType,
    }
    if (options.condition) {
      edge.condition = options.condition
    }
    if (options.parallel) {
      edge.parallel = true
    }
    ctx.edges.push(edge)
  }

  // Track variable assignments (scoped)
  const assignments = getVariableAssignments(cmd)
  for (const varName of assignments) {
    ctx.variableDefinitions.set(varName, nodeId)
  }

  // Track file writes
  const writes = getFileWrites(cmd)
  for (const file of writes) {
    if (!ctx.fileWrites.has(file)) {
      ctx.fileWrites.set(file, [])
    }
    ctx.fileWrites.get(file)!.push(nodeId)
  }

  // Check for variable dependencies
  const varRefs = getVariableReferences(cmd)
  for (const varName of varRefs) {
    const defNodeId = ctx.variableDefinitions.get(varName)
    if (defNodeId && defNodeId !== nodeId) {
      ctx.edges.push({
        from: defNodeId,
        to: nodeId,
        type: 'variable',
        variable: varName,
      })
    }
  }

  // Check for file dependencies
  const reads = getFileReads(cmd)
  for (const file of reads) {
    const writeNodes = ctx.fileWrites.get(file)
    if (writeNodes) {
      for (const writeNodeId of writeNodes) {
        if (writeNodeId !== nodeId) {
          ctx.edges.push({
            from: writeNodeId,
            to: nodeId,
            type: 'file',
            file,
          })
        }
      }
    }
  }

  return nodeId
}

/**
 * Process a pipeline
 */
// processPipeline is unused - pipeline processing is inline in processNode
// Keeping code for reference but marking as intentionally unused
// function processPipeline(pipeline: Pipeline, ctx: BuildContext): string { ... }

/**
 * Process a list (sequence, AND, OR, or background)
 */
function processList(list: List, ctx: BuildContext): { firstNodeId: string; lastNodeId: string } {
  // Process left side
  const leftResult = processNode(list.left, ctx)

  // Determine edge type based on operator
  let edgeType: DependencyType
  let condition: 'success' | 'failure' | undefined
  let parallel = false

  switch (list.operator) {
    case '&&':
      edgeType = 'conditional'
      condition = 'success'
      break
    case '||':
      edgeType = 'conditional'
      condition = 'failure'
      break
    case '&':
      edgeType = 'background'
      parallel = true
      break
    case ';':
    default:
      edgeType = 'sequence'
      break
  }

  // Process right side with edge from left
  ctx.lastNodeId = leftResult.lastNodeId

  const rightResult = processNodeWithEdge(list.right, ctx, {
    edgeType,
    condition,
    parallel,
    fromNodeId: leftResult.lastNodeId,
  })

  return {
    firstNodeId: leftResult.firstNodeId,
    lastNodeId: rightResult.lastNodeId,
  }
}

/**
 * Process a subshell
 */
function processSubshell(subshell: Subshell, ctx: BuildContext): { firstNodeId: string; lastNodeId: string } {
  // Create a new scope
  const scopeId = generateScopeId(ctx)
  ctx.scopeStack.push(scopeId)
  const savedScope = ctx.currentScope
  ctx.currentScope = scopeId

  // Save current variable definitions (subshell gets a copy)
  const savedVarDefs = new Map(ctx.variableDefinitions)

  let firstNodeId: string | undefined
  let lastNodeId: string | undefined

  for (const node of subshell.body) {
    const result = processNode(node, ctx)
    if (!firstNodeId) {
      firstNodeId = result.firstNodeId
    }
    lastNodeId = result.lastNodeId
    ctx.lastNodeId = lastNodeId
  }

  // Restore scope and variable definitions (subshell vars don't leak)
  ctx.scopeStack.pop()
  ctx.currentScope = savedScope
  ctx.variableDefinitions = savedVarDefs

  return {
    firstNodeId: firstNodeId!,
    lastNodeId: lastNodeId!,
  }
}

/**
 * Process a compound command (for, while, if, etc.)
 */
function processCompoundCommand(
  compound: CompoundCommand & { variable?: string; items?: string[]; condition?: BashNode[]; thenBranch?: BashNode[]; elseBranch?: BashNode[] },
  ctx: BuildContext
): { firstNodeId: string; lastNodeId: string } {
  let firstNodeId: string | undefined
  let lastNodeId: string | undefined

  // Handle loop variable for for loops
  if (compound.kind === 'for' && compound.variable) {
    ctx.loopVariable = compound.variable
  }

  // Handle while/until loops with condition
  if ((compound.kind === 'while' || compound.kind === 'until') && compound.condition) {
    for (const condNode of compound.condition) {
      const result = processNode(condNode, ctx)
      if (!firstNodeId) {
        firstNodeId = result.firstNodeId
      }
      lastNodeId = result.lastNodeId
      ctx.lastNodeId = lastNodeId
    }

    // Process body with conditional edge from condition
    for (const bodyNode of compound.body) {
      const result = processNodeWithEdge(bodyNode, ctx, {
        edgeType: 'conditional',
        condition: 'success',
        fromNodeId: lastNodeId,
      })
      lastNodeId = result.lastNodeId
      ctx.lastNodeId = lastNodeId
    }
  }
  // Handle if statements
  else if (compound.kind === 'if' && compound.condition) {
    // Process condition
    for (const condNode of compound.condition) {
      const result = processNode(condNode, ctx)
      if (!firstNodeId) {
        firstNodeId = result.firstNodeId
      }
      lastNodeId = result.lastNodeId
      ctx.lastNodeId = lastNodeId
    }

    const conditionNodeId = lastNodeId

    // Process then branch with success condition
    if (compound.thenBranch) {
      for (const thenNode of compound.thenBranch) {
        const result = processNodeWithEdge(thenNode, ctx, {
          edgeType: 'conditional',
          condition: 'success',
          fromNodeId: conditionNodeId,
        })
        lastNodeId = result.lastNodeId
      }
    }

    // Process else branch with failure condition
    if (compound.elseBranch) {
      for (const elseNode of compound.elseBranch) {
        const result = processNodeWithEdge(elseNode, ctx, {
          edgeType: 'conditional',
          condition: 'failure',
          fromNodeId: conditionNodeId,
        })
        lastNodeId = result.lastNodeId
      }
    }
  }
  // Handle regular compound commands (body only)
  else {
    for (const bodyNode of compound.body) {
      const result = processNode(bodyNode, ctx)
      if (!firstNodeId) {
        firstNodeId = result.firstNodeId
      }
      lastNodeId = result.lastNodeId
      ctx.lastNodeId = lastNodeId
    }
  }

  // Clear loop variable
  ctx.loopVariable = undefined

  return {
    firstNodeId: firstNodeId!,
    lastNodeId: lastNodeId!,
  }
}

/**
 * Process a function definition
 */
function processFunctionDef(funcDef: FunctionDef, ctx: BuildContext): { firstNodeId: string; lastNodeId: string } {
  // Process the function body
  const result = processNode(funcDef.body, ctx)

  // Track the function definition
  ctx.functionDefinitions.set(funcDef.name, result.firstNodeId)

  return result
}

/**
 * Generic node processor
 */
function processNode(node: BashNode, ctx: BuildContext): { firstNodeId: string; lastNodeId: string } {
  if (isCommand(node)) {
    const id = processCommand(node, ctx)
    return { firstNodeId: id, lastNodeId: id }
  } else if (isPipeline(node)) {
    const firstCmd = node.commands[0]
    const firstId = processCommand(firstCmd, ctx)
    let prevId = firstId

    for (let i = 1; i < node.commands.length; i++) {
      const cmd = node.commands[i]
      const nodeId = processCommand(cmd, ctx, {
        edgeType: 'pipe',
        fromNodeId: prevId,
      })

      // Add pipe data flow information
      const edge = ctx.edges[ctx.edges.length - 1]
      if (edge && edge.type === 'pipe') {
        edge.dataFlow = {
          sourceFd: 1,
          targetFd: 0,
        }
      }

      prevId = nodeId
    }

    return { firstNodeId: firstId, lastNodeId: prevId }
  } else if (isList(node)) {
    return processList(node, ctx)
  } else if (isSubshell(node)) {
    return processSubshell(node, ctx)
  } else if (isCompoundCommand(node)) {
    return processCompoundCommand(node as CompoundCommand & { variable?: string; condition?: BashNode[]; thenBranch?: BashNode[]; elseBranch?: BashNode[] }, ctx)
  } else if (isFunctionDef(node)) {
    return processFunctionDef(node, ctx)
  }

  // Unknown node type - shouldn't happen in well-formed AST
  throw new Error(`Unknown node type: ${(node as { type?: string }).type}`)
}

/**
 * Process a node with a specific edge type from the previous node
 */
function processNodeWithEdge(
  node: BashNode,
  ctx: BuildContext,
  options: {
    edgeType: DependencyType
    condition?: 'success' | 'failure'
    parallel?: boolean
    fromNodeId?: string
  }
): { firstNodeId: string; lastNodeId: string } {
  if (isCommand(node)) {
    const id = processCommand(node, ctx, options)
    return { firstNodeId: id, lastNodeId: id }
  } else if (isPipeline(node)) {
    // Process first command with the edge
    const firstCmd = node.commands[0]
    const firstId = processCommand(firstCmd, ctx, options)
    let prevId = firstId

    for (let i = 1; i < node.commands.length; i++) {
      const cmd = node.commands[i]
      const nodeId = processCommand(cmd, ctx, {
        edgeType: 'pipe',
        fromNodeId: prevId,
      })

      const edge = ctx.edges[ctx.edges.length - 1]
      if (edge && edge.type === 'pipe') {
        edge.dataFlow = {
          sourceFd: 1,
          targetFd: 0,
        }
      }

      prevId = nodeId
    }

    return { firstNodeId: firstId, lastNodeId: prevId }
  } else if (isList(node)) {
    // For lists, process the left side with the edge
    const leftResult = processNodeWithEdge(node.left, ctx, options)

    // Then process the rest normally
    let edgeType: DependencyType
    let condition: 'success' | 'failure' | undefined
    let parallel = false

    switch (node.operator) {
      case '&&':
        edgeType = 'conditional'
        condition = 'success'
        break
      case '||':
        edgeType = 'conditional'
        condition = 'failure'
        break
      case '&':
        edgeType = 'background'
        parallel = true
        break
      case ';':
      default:
        edgeType = 'sequence'
        break
    }

    const rightResult = processNodeWithEdge(node.right, ctx, {
      edgeType,
      condition,
      parallel,
      fromNodeId: leftResult.lastNodeId,
    })

    return {
      firstNodeId: leftResult.firstNodeId,
      lastNodeId: rightResult.lastNodeId,
    }
  } else if (isSubshell(node)) {
    // Process subshell, then add edge from first node
    const result = processSubshell(node, ctx)

    // Add edge to the first node of subshell
    if (options.fromNodeId) {
      ctx.edges.push({
        from: options.fromNodeId,
        to: result.firstNodeId,
        type: options.edgeType,
        condition: options.condition,
        parallel: options.parallel,
      })
    }

    return result
  } else {
    // For other compound structures, process normally then add the incoming edge
    const result = processNode(node, ctx)

    if (options.fromNodeId && result.firstNodeId) {
      ctx.edges.push({
        from: options.fromNodeId,
        to: result.firstNodeId,
        type: options.edgeType,
        condition: options.condition,
        parallel: options.parallel,
      })
    }

    return result
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Build a dependency tree from a bash AST
 *
 * @param ast - The parsed bash program AST
 * @returns The dependency tree
 */
export function buildDependencyTree(ast: Program): DependencyTree {
  const ctx: BuildContext = {
    nodes: [],
    edges: [],
    nodeCounter: 0,
    scopeStack: [],
    currentScope: undefined,
    variableDefinitions: new Map(),
    fileWrites: new Map(),
    functionDefinitions: new Map(),
    lastNodeId: undefined,
    loopVariable: undefined,
  }

  // Process all body nodes
  for (const node of ast.body) {
    const result = processNode(node, ctx)
    ctx.lastNodeId = result.lastNodeId
  }

  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    root: ctx.nodes.length > 0 ? ctx.nodes[0] : null,
    sourceAst: ast,
  }
}

/**
 * Get the execution order of commands respecting dependencies
 *
 * @param tree - The dependency tree
 * @returns Nodes in topological order
 */
export function getExecutionOrder(tree: DependencyTree): DependencyNode[] {
  if (tree.nodes.length === 0) {
    return []
  }

  // Build adjacency list and in-degree map
  // Background edges with parallel=true don't add to in-degree (they can run at same level)
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of tree.nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  // Track which edges are parallel background edges
  const parallelPairs = new Set<string>()

  for (const edge of tree.edges) {
    // Background edges with parallel=true don't add to dependency count
    // The commands can run simultaneously
    if (edge.type === 'background' && edge.parallel) {
      parallelPairs.add(`${edge.from}:${edge.to}`)
    } else {
      const current = inDegree.get(edge.to) || 0
      inDegree.set(edge.to, current + 1)
    }
    adjacency.get(edge.from)?.push(edge.to)
  }

  // Find nodes with no incoming edges (can start first)
  const queue: string[] = []
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId)
    }
  }

  // Topological sort with level tracking
  const result: DependencyNode[] = []
  const nodeMap = new Map(tree.nodes.map((n) => [n.id, n]))
  let level = 0

  while (queue.length > 0) {
    const levelSize = queue.length
    const levelNodes: DependencyNode[] = []

    for (let i = 0; i < levelSize; i++) {
      const nodeId = queue.shift()!
      const node = nodeMap.get(nodeId)!
      node.level = level
      levelNodes.push(node)

      for (const neighbor of adjacency.get(nodeId) || []) {
        // Check if this edge is a parallel background edge
        if (parallelPairs.has(`${nodeId}:${neighbor}`)) {
          // Parallel edges: add to queue immediately if not already queued
          if ((inDegree.get(neighbor) || 0) === 0 && !queue.includes(neighbor)) {
            queue.push(neighbor)
          }
        } else {
          const newDegree = (inDegree.get(neighbor) || 0) - 1
          inDegree.set(neighbor, newDegree)
          if (newDegree === 0) {
            queue.push(neighbor)
          }
        }
      }
    }

    result.push(...levelNodes)
    level++
  }

  // If we couldn't process all nodes, there's a cycle - return what we have
  if (result.length < tree.nodes.length) {
    // Add remaining nodes at the end
    for (const node of tree.nodes) {
      if (!result.includes(node)) {
        result.push(node)
      }
    }
  }

  return result
}

/**
 * Find the data flow path between two commands
 *
 * @param tree - The dependency tree
 * @param fromId - Source node ID
 * @param toId - Target node ID
 * @returns Array of nodes in the data flow path, or empty if no path exists
 */
export function findDataFlowPath(tree: DependencyTree, fromId: string, toId: string): DependencyNode[] {
  // Build adjacency list for data flow edges only (pipe and file)
  const adjacency = new Map<string, string[]>()

  for (const node of tree.nodes) {
    adjacency.set(node.id, [])
  }

  for (const edge of tree.edges) {
    if (edge.type === 'pipe' || edge.type === 'file') {
      adjacency.get(edge.from)?.push(edge.to)
    }
  }

  // BFS to find path
  const queue: string[][] = [[fromId]]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const path = queue.shift()!
    const current = path[path.length - 1]

    if (current === toId) {
      // Convert path of IDs to nodes
      const nodeMap = new Map(tree.nodes.map((n) => [n.id, n]))
      return path.map((id) => nodeMap.get(id)!)
    }

    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) {
        queue.push([...path, neighbor])
      }
    }
  }

  return [] // No path found
}

/**
 * Detect if the dependency tree contains cycles
 *
 * @param tree - The dependency tree
 * @returns True if cycles are detected
 */
export function detectCycles(tree: DependencyTree): boolean {
  if (tree.nodes.length === 0) {
    return false
  }

  // Build adjacency list
  const adjacency = new Map<string, string[]>()

  for (const node of tree.nodes) {
    adjacency.set(node.id, [])
  }

  for (const edge of tree.edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }

  // DFS with coloring: 0 = white (unvisited), 1 = gray (in progress), 2 = black (done)
  const color = new Map<string, number>()

  for (const node of tree.nodes) {
    color.set(node.id, 0)
  }

  function dfs(nodeId: string): boolean {
    color.set(nodeId, 1) // Mark as in progress

    for (const neighbor of adjacency.get(nodeId) || []) {
      const neighborColor = color.get(neighbor)

      if (neighborColor === 1) {
        // Back edge found - cycle detected
        return true
      }

      if (neighborColor === 0) {
        if (dfs(neighbor)) {
          return true
        }
      }
    }

    color.set(nodeId, 2) // Mark as done
    return false
  }

  // Check from all nodes
  for (const node of tree.nodes) {
    if (color.get(node.id) === 0) {
      if (dfs(node.id)) {
        return true
      }
    }
  }

  return false
}

/**
 * Get groups of commands that can run in parallel
 *
 * @param tree - The dependency tree
 * @returns Array of node groups that can execute in parallel
 */
export function getParallelGroups(tree: DependencyTree): DependencyNode[][] {
  if (tree.nodes.length === 0) {
    return []
  }

  // First, get execution order with levels
  const orderedNodes = getExecutionOrder(tree)

  // Check if any edges are parallel/background
  const parallelEdges = new Set<string>()
  for (const edge of tree.edges) {
    if (edge.type === 'background' && edge.parallel) {
      parallelEdges.add(edge.from)
      parallelEdges.add(edge.to)
    }
  }

  // Group nodes by level, respecting parallel edges
  const groups: DependencyNode[][] = []
  let currentGroup: DependencyNode[] = []
  let currentLevel = 0

  for (const node of orderedNodes) {
    const nodeLevel = node.level ?? 0

    // If we're moving to a new level and current group isn't empty
    if (nodeLevel !== currentLevel && currentGroup.length > 0) {
      // Check if any nodes in current group can be parallel
      if (currentGroup.length > 1 && currentGroup.some((n) => parallelEdges.has(n.id))) {
        // Keep them together as parallel
        groups.push(currentGroup)
      } else {
        // Split into individual groups if not parallel
        for (const n of currentGroup) {
          groups.push([n])
        }
      }
      currentGroup = []
    }

    currentLevel = nodeLevel
    currentGroup.push(node)
  }

  // Handle remaining group
  if (currentGroup.length > 0) {
    if (currentGroup.length > 1 && currentGroup.some((n) => parallelEdges.has(n.id))) {
      groups.push(currentGroup)
    } else {
      for (const n of currentGroup) {
        groups.push([n])
      }
    }
  }

  return groups
}
