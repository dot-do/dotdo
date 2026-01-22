/**
 * Children Manager for Parent DO
 *
 * Manages child DO registration, discovery, and tracking:
 * - Maintains a registry of known child DOs
 * - Tracks heartbeats and health status
 * - Supports dynamic discovery
 * - Provides child information queries
 *
 * @module examples/example.com.ai/src/children-manager
 */

import type { ChildDOInfo } from './types'

/**
 * Children Manager
 *
 * Tracks and manages child DOs that report to this parent.
 */
export class ChildrenManager {
  private children: Map<string, ChildDOInfo> = new Map()

  constructor() {}

  /**
   * Register a new child DO
   */
  register(childId: string, info: Omit<ChildDOInfo, 'id'>): ChildDOInfo {
    const childInfo: ChildDOInfo = {
      id: childId,
      ...info,
    }
    this.children.set(childId, childInfo)
    return childInfo
  }

  /**
   * Update child's last seen timestamp (heartbeat)
   */
  heartbeat(childId: string): void {
    const child = this.children.get(childId)
    if (child) {
      child.lastSeen = Date.now()
    }
  }

  /**
   * Increment event count for a child
   */
  incrementEventCount(childId: string): void {
    const child = this.children.get(childId)
    if (child) {
      child.eventCount++
    }
  }

  /**
   * List all registered children
   */
  async list(): Promise<ChildDOInfo[]> {
    return Array.from(this.children.values())
  }

  /**
   * Get specific child info
   */
  async get(childId: string): Promise<ChildDOInfo | null> {
    return this.children.get(childId) ?? null
  }

  /**
   * Discover new children (in a real implementation, this would query DNS, KV, etc.)
   * For now, returns currently known children
   */
  async discover(): Promise<ChildDOInfo[]> {
    // In a real implementation, this might:
    // - Query a discovery service
    // - Scan DNS for subdomains
    // - Check a KV namespace for registered children
    return this.list()
  }

  /**
   * Get count of registered children
   */
  async count(): Promise<number> {
    return this.children.size
  }

  /**
   * Remove a child from the registry
   */
  remove(childId: string): boolean {
    return this.children.delete(childId)
  }

  /**
   * Check if a child is healthy (seen within threshold)
   */
  isHealthy(childId: string, thresholdMs: number = 5 * 60 * 1000): boolean {
    const child = this.children.get(childId)
    if (!child) return false
    return Date.now() - child.lastSeen < thresholdMs
  }
}

/**
 * Create the $.children proxy interface
 */
export function createChildrenProxy(manager: ChildrenManager): {
  list: () => Promise<ChildDOInfo[]>
  get: (childId: string) => Promise<ChildDOInfo | null>
  discover: () => Promise<ChildDOInfo[]>
  count: () => Promise<number>
} {
  return {
    list: () => manager.list(),
    get: (childId: string) => manager.get(childId),
    discover: () => manager.discover(),
    count: () => manager.count(),
  }
}
