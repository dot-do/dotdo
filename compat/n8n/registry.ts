/**
 * n8n Node Registry
 *
 * Registry for node type implementations.
 */

import type { INodeType } from './types'

/**
 * Registry for node type implementations.
 *
 * Provides:
 * - Node registration
 * - Node lookup by name
 * - Duplicate detection
 */
export class NodeRegistry {
  private nodes: Map<string, INodeType> = new Map()

  /**
   * Register a node type
   *
   * @param node - Node type implementation
   * @throws Error if node with same name is already registered
   */
  register(node: INodeType): void {
    const name = node.description.name

    if (this.nodes.has(name)) {
      throw new Error(`Node type '${name}' is already registered`)
    }

    this.nodes.set(name, node)
  }

  /**
   * Get a node type by name
   *
   * @param name - Node type name
   * @returns Node type implementation or undefined if not found
   */
  get(name: string): INodeType | undefined {
    return this.nodes.get(name)
  }

  /**
   * Check if a node type is registered
   *
   * @param name - Node type name
   * @returns True if registered
   */
  has(name: string): boolean {
    return this.nodes.has(name)
  }

  /**
   * List all registered node type names
   *
   * @returns Array of node type names
   */
  list(): string[] {
    return Array.from(this.nodes.keys())
  }

  /**
   * Unregister a node type
   *
   * @param name - Node type name
   * @returns True if node was removed
   */
  unregister(name: string): boolean {
    return this.nodes.delete(name)
  }

  /**
   * Get all registered nodes
   *
   * @returns Array of node type implementations
   */
  getAll(): INodeType[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Clear all registered nodes
   */
  clear(): void {
    this.nodes.clear()
  }

  /**
   * Get nodes by group
   *
   * @param group - Node group to filter by
   * @returns Array of node types in the group
   */
  getByGroup(group: string): INodeType[] {
    return Array.from(this.nodes.values()).filter((node) => node.description.group.includes(group as 'trigger' | 'transform' | 'output' | 'input'))
  }
}
