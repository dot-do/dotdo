/**
 * Dependency Graph - builds and manages type dependencies for cascade generation
 */

import type {
  GenerationParsedSchema,
  EngineDepGraph,
  EngineDepNode,
  EngineDepEdge,
  CascadeOperator,
} from '../types'

import { CircularDependencyError } from '../types'

/** Primitive types that don't create dependencies */
export const PRIMITIVE_TYPES = new Set(['string', 'number', 'boolean', 'date', 'email', 'url', 'object', 'array'])

/**
 * Build a dependency graph from a parsed schema
 */
export function buildDependencyGraph(schema: GenerationParsedSchema): EngineDepGraph {
  const nodes: Record<string, EngineDepNode> = {}
  const edges: EngineDepEdge[] = []

  // Initialize nodes for all types
  for (const typeName of Object.keys(schema.types)) {
    nodes[typeName] = {
      name: typeName,
      dependsOn: [],
      dependedOnBy: [],
      softDependsOn: [],
    }
  }

  // Process fields to build edges
  for (const [typeName, typeInfo] of Object.entries(schema.types)) {
    for (const [fieldName, field] of Object.entries(typeInfo.fields)) {
      const target = field.target
      const operator = field.operator

      if (!target || PRIMITIVE_TYPES.has(target)) continue

      const isArray = field.isArray ?? false
      const isSoft = operator === '~>' || operator === '<~'
      const isOptionalField = field.optional || field.isOptional

      // Add edge (mark optional in fieldName for cycle detection)
      edges.push({
        from: typeName,
        to: target,
        isArray,
        operator: operator ?? '->',
        fieldName: isOptionalField ? `${fieldName}?` : fieldName,
      })

      // Ensure target node exists (might be external)
      if (!nodes[target]) {
        nodes[target] = {
          name: target,
          dependsOn: [],
          dependedOnBy: [],
          softDependsOn: [],
        }
      }

      if (isSoft || isOptionalField) {
        // Soft dependency (fuzzy search) or optional field
        if (!nodes[typeName]!.softDependsOn.includes(target)) {
          nodes[typeName]!.softDependsOn.push(target)
        }
      } else {
        // Hard dependency
        if (!nodes[typeName]!.dependsOn.includes(target)) {
          nodes[typeName]!.dependsOn.push(target)
        }
        if (!nodes[target]!.dependedOnBy.includes(typeName)) {
          nodes[target]!.dependedOnBy.push(typeName)
        }
      }
    }
  }

  return { nodes, edges }
}

/**
 * Compute topological order for generating types
 * Returns types in order such that dependencies come before dependents
 */
export function topologicalSort(
  graph: EngineDepGraph,
  rootType: string,
  ignoreOptional = false
): string[] {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const result: string[] = []

  function visit(typeName: string, path: string[]) {
    if (visited.has(typeName)) return
    if (visiting.has(typeName)) {
      // Circular dependency detected
      const cycleStart = path.indexOf(typeName)
      const cyclePath = [...path.slice(cycleStart), typeName]
      throw new CircularDependencyError(cyclePath)
    }

    visiting.add(typeName)

    const node = graph.nodes[typeName]
    if (node) {
      for (const dep of node.dependsOn) {
        // Check if this dependency is optional and should be ignored
        if (ignoreOptional) {
          const edge = graph.edges.find((e) => e.from === typeName && e.to === dep)
          if (edge && graph.nodes[dep]) {
            // Check if field has optional marker
            const fieldIsOptional = edge.fieldName.endsWith('?')
            if (fieldIsOptional) continue
          }
        }
        visit(dep, [...path, typeName])
      }
    }

    visiting.delete(typeName)
    visited.add(typeName)
    result.push(typeName)
  }

  visit(rootType, [])

  return result
}

/**
 * Detect all cycles in the dependency graph
 * @param graph - The dependency graph to check
 * @param options - Options for cycle detection
 * @param schema - Optional schema for checking optional fields
 */
export function detectCycles(
  graph: EngineDepGraph,
  options: { ignoreOptional?: boolean } = {},
  schema?: GenerationParsedSchema
): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(node: string, path: string[]): void {
    if (recStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node)
      const cycle = [...path.slice(cycleStart), node]
      cycles.push(cycle)
      return
    }

    if (visited.has(node)) return

    visited.add(node)
    recStack.add(node)

    const nodeInfo = graph.nodes[node]
    if (nodeInfo) {
      for (const dep of nodeInfo.dependsOn) {
        // Skip optional dependencies if configured
        if (options.ignoreOptional) {
          const edge = graph.edges.find((e) => e.from === node && e.to === dep)
          if (edge) {
            // Check if field has optional: true in schema
            if (schema) {
              const typeInfo = schema.types[node]
              if (typeInfo) {
                const field = typeInfo.fields[edge.fieldName]
                if (field?.optional || field?.isOptional) continue
              }
            }
            // Also check if fieldName ends with ?
            if (edge.fieldName.endsWith('?')) continue
          }
        }
        dfs(dep, [...path, node])
      }
    }

    recStack.delete(node)
  }

  for (const node of Object.keys(graph.nodes)) {
    dfs(node, [])
  }

  return cycles
}

/**
 * Get parallel generation groups - types that can be generated concurrently
 */
export function getParallelGroups(graph: EngineDepGraph, rootType: string): string[][] {
  const inDegree: Record<string, number> = {}
  const relevantNodes = new Set<string>()

  // First, find all nodes reachable from root
  function findReachable(node: string): void {
    if (relevantNodes.has(node)) return
    relevantNodes.add(node)
    const nodeInfo = graph.nodes[node]
    if (nodeInfo) {
      for (const dep of nodeInfo.dependsOn) {
        findReachable(dep)
      }
    }
  }
  findReachable(rootType)

  // Initialize in-degrees for relevant nodes only
  for (const node of relevantNodes) {
    inDegree[node] = 0
  }

  // Count incoming edges
  for (const node of relevantNodes) {
    const nodeInfo = graph.nodes[node]
    if (nodeInfo) {
      for (const dep of nodeInfo.dependsOn) {
        if (relevantNodes.has(dep)) {
          inDegree[node]!++
        }
      }
    }
  }

  const groups: string[][] = []

  while (Object.keys(inDegree).length > 0) {
    // Find all nodes with in-degree 0
    const group = Object.entries(inDegree)
      .filter(([, degree]) => degree === 0)
      .map(([node]) => node)

    if (group.length === 0) {
      // Remaining nodes have cycles
      break
    }

    groups.push(group)

    // Remove processed nodes and update in-degrees
    for (const node of group) {
      delete inDegree[node]
      // Reduce in-degree of nodes that depend on this node
      for (const dependent of graph.nodes[node]?.dependedOnBy ?? []) {
        if (dependent in inDegree) {
          inDegree[dependent]!--
        }
      }
    }
  }

  return groups
}

/**
 * Get dependencies for a specific type
 */
export function getDependencies(schema: GenerationParsedSchema, typeName: string): string[] {
  const typeInfo = schema.types[typeName]
  if (!typeInfo) return []

  const deps: string[] = []
  for (const field of Object.values(typeInfo.fields)) {
    if (field.target && !PRIMITIVE_TYPES.has(field.target)) {
      if (!deps.includes(field.target)) {
        deps.push(field.target)
      }
    }
  }
  return deps
}
